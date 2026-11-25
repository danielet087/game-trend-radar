from datetime import datetime, timedelta, timezone
import json
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest

from scripts.build_twitch_launch_curves import build, closest, launch_start, predict

ROOT = Path(__file__).resolve().parents[1]
HOUR = 3600
TAIPEI = timezone(timedelta(hours=8))


def at(text):
    return int(datetime.fromisoformat(text.replace("Z", "+00:00")).timestamp())


def iso(instant):
    return datetime.fromtimestamp(instant, timezone.utc).isoformat().replace("+00:00", "Z")


class LaunchStartCasesTests(unittest.TestCase):
    """The site (src/features/twitch/launch-model.js) runs the same cases."""

    def test_shared_cases(self):
        fixture = json.loads((ROOT / "tests/fixtures/launch-start-cases.json").read_text(encoding="utf-8"))
        launch = at(fixture["launch_at"])
        for case in fixture["cases"]:
            with self.subTest(case["name"]):
                hours = {}
                for start, end, status, viewers in case["runs"]:
                    for offset in range(start, end):
                        moment = launch + offset * HOUR
                        hours[moment] = (status, viewers if status == "observed" else None,
                                         0 if status == "missing" else moment + 600)
                result = launch_start(hours, launch, launch + case["now"] * HOUR, walk_back=case["walk_back"])
                self.assertEqual(result, (launch + case["start"] * HOUR, case["basis"]))


class LaunchForecastCasesTests(unittest.TestCase):
    """The site (src/features/twitch/launch-model.js) runs the same cases."""

    def test_shared_cases(self):
        fixture = json.loads((ROOT / "tests/fixtures/launch-forecast-cases.json").read_text(encoding="utf-8"))
        for case in fixture["cases"]:
            with self.subTest(case["name"]):
                samples = [tuple(sample) for sample in case["samples"]]
                self.assertEqual(sorted(list(sample) for sample in closest(samples, case["base"])), case["chosen"])
                guess = predict(samples, case["base"])
                self.assertEqual(guess["launches"], case["launches"])
                for key in ("ratio", "median", "low", "high"):
                    self.assertAlmostEqual(guess[key], case[key], delta=1e-12 * max(1, abs(case[key])))
                self.assertEqual({str(key): value for key, value in guess["chances"].items()}, case["chances"])

    def test_a_big_launch_is_compared_with_big_launches(self):
        samples = [(50 + n, 0.0) for n in range(20)] + [(1000 * (n + 1), 0.2) for n in range(60)]
        guess = predict(samples, 100000)
        self.assertEqual((guess["launches"], guess["chances"][3000]), (40, 1.0))
        self.assertEqual(predict(samples[:40], 100000)["launches"], 40)


class Series:
    """A tiny data folder laid out like the site's ./data/."""

    def __init__(self, data, generated_at):
        self.data, self.generated_at = data, generated_at
        self.months, self.games, self.chunks = {}, {}, {}

    def hours(self, start, end):
        for moment in range(at(start), at(end), HOUR):
            key = iso(moment)
            month = datetime.fromtimestamp(moment, TAIPEI).strftime("%Y-%m")
            self.months.setdefault(month, {})[key] = iso(moment + 600)

    def game(self, game_id, record, values, zh=None):
        """``values`` maps an hour to viewers; hours collected without a value are absent."""
        rows = sorted(values)
        self.games[game_id] = {"archive_eligible": True, "first_hour": iso(rows[0]), "last_hour": iso(rows[-1]),
                               "months": [], **record}
        for moment, viewers in values.items():
            key = iso(moment)
            month = datetime.fromtimestamp(moment, TAIPEI).strftime("%Y-%m")
            if viewers is None:
                continue
            row = {"generated_at": self.months[month][key], "viewer_count": viewers}
            if zh and moment in zh:
                row["audience_regions"] = {"zh": zh[moment]}
            self.chunks.setdefault((game_id, month), {})[key] = row
            if month not in self.games[game_id]["months"]:
                self.games[game_id]["months"].append(month)

    def write(self, catalog, facts=None):
        root = self.data / "twitch_series"
        root.mkdir(parents=True, exist_ok=True)
        (root / "index.json").write_text(json.dumps({"schema_version": 1, "timezone": "Asia/Taipei",
            "generated_at": self.generated_at, "months": self.months, "games": self.games}), encoding="utf-8")
        for (game_id, month), hours in self.chunks.items():
            (root / game_id).mkdir(exist_ok=True)
            (root / game_id / f"{month}.json").write_text(json.dumps({"schema_version": 1, "timezone": "Asia/Taipei",
                "game_id": game_id, "month": month, "hours": hours}), encoding="utf-8")
        (self.data / "catalog.json").write_text(json.dumps({"games": catalog}), encoding="utf-8")
        if facts is not None:
            (self.data / "store_facts.json").write_text(json.dumps({"games": facts}), encoding="utf-8")


def flat(start, hours, viewers):
    return {at(start) + offset * HOUR: viewers for offset in range(hours)}


class LaunchCurvesTests(unittest.TestCase):
    def test_launches_count_days_every_24_hours_from_their_start_and_fit_the_forecast(self):
        with TemporaryDirectory() as temporary:
            data = Path(temporary)
            series = Series(data, "2026-11-20T04:30:00Z")
            series.hours("2026-10-20T00:00:00Z", "2026-11-20T04:00:00Z")
            # Streamed at launch level for three days before the launch (deluxe early access).
            deluxe = {**flat("2026-10-29T03:00:00Z", 72, 800), **flat("2026-11-01T03:00:00Z", 24, 2000),
                      **flat("2026-11-02T03:00:00Z", 24 * 6, 500)}
            series.game("42", {"release_reference": {"date": "2026-11-01", "precision": "day",
                                                     "source_type": "steam_taiwan_store_date", "steam_appid": "800"}}, deluxe)
            # Early Access, then the full release: two launches; the full release keeps its own instant.
            early = {**flat("2026-10-26T09:00:00Z", 24 * 3, 300), **flat("2026-10-29T09:00:00Z", 24 * 12, 90),
                     **flat("2026-11-10T08:00:00Z", 24 * 2, 900)}
            zh = {moment: {"viewer_count": 120, "measurement_source": "helix_language_filter"}
                  for moment in range(at("2026-10-26T09:00:00Z"), at("2026-10-26T13:00:00Z"), HOUR)}
            series.game("43", {"release_reference": {"date": "2026-11-10", "precision": "day",
                                                     "source_type": "steam_taiwan_store_date", "steam_appid": "801"},
                               "launches": {"early_access": {"date": "2026-10-26"}, "full_release": {"date": "2026-11-10"}}},
                        early, zh)
            # Upcoming: listed with empty days so the page can show same-genre curves.
            series.game("44", {"release_reference": {"date": "2026-12-01", "precision": "day",
                                                     "source_type": "steam_taiwan_store_date", "steam_appid": "802"}},
                        flat("2026-11-19T00:00:00Z", 3, 40))
            # Forty launches without a Steam genre only train the forecast: days 7-9 at a fifth of the first day.
            for n in range(40):
                start = at("2026-10-22T04:00:00Z") + n * 12 * HOUR
                values = {start + offset * HOUR: 1000 if offset < 48 else 200 for offset in range(216)}
                day = datetime.fromtimestamp(start, TAIPEI).date().isoformat()
                series.game(str(100 + n), {"release_reference": {"date": day, "precision": "day",
                                                                  "source_type": "igdb_first_release_date"}}, values)
            series.write([
                {"appid": 800, "release_start": "2026-11-01", "release_time_utc": "2026-11-01T03:20:00Z", "genres": ["Action"]},
                {"appid": 801, "release_start": "2026-11-10", "release_time_utc": "2026-11-10T08:00:00Z", "genres": ["Strategy", "Early Access"]},
                {"appid": 802, "release_start": "2026-12-01", "release_time_utc": "2026-12-01T02:00:00Z", "genres": ["Action"]},
            ], {"801": {"early_access": {"active": False, "started_at": "2026-10-26T09:41:00Z", "full_release_at": "2026-11-10T07:00:00Z"}}})
            projected = build(data)

            self.assertEqual(projected["schema_version"], 2)
            self.assertEqual(projected["generated_at"], "2026-11-20T04:00:00Z")
            self.assertEqual(sorted(projected["games"]), ["42", "43", "44"])
            [deluxe_launch] = projected["games"]["42"]["launches"]
            self.assertEqual({key: deluxe_launch[key] for key in ("kind", "date", "launch_at", "start_at", "start_basis")},
                             {"kind": "release", "date": "2026-11-01", "launch_at": "2026-11-01T03:00:00Z",
                              "start_at": "2026-10-29T03:00:00Z", "start_basis": "pre_launch"})
            self.assertEqual(deluxe_launch["daily"], [800, 800, 800, 2000, 500, 500, 500])
            self.assertNotIn("audience_regions", deluxe_launch)

            ea, full = projected["games"]["43"]["launches"]
            self.assertEqual((ea["kind"], ea["launch_at"], ea["start_at"], ea["start_basis"]),
                             ("early_access", "2026-10-26T09:00:00Z", "2026-10-26T09:00:00Z", "launch"))
            self.assertEqual(ea["daily"], [300, 300, 300, 90, 90, 90, 90])
            self.assertEqual(ea["audience_regions"]["zh"]["daily"], [None] * 7)
            self.assertEqual(ea["audience_regions"]["zh"]["heat"], [True, None, None, None, None, None, None])
            self.assertEqual(ea["audience_regions"]["zh"]["measurement_sources"], ["helix_language_filter"] + [None] * 6)
            self.assertEqual((full["kind"], full["date"], full["launch_at"], full["start_at"], full["start_basis"]),
                             ("full_release", "2026-11-10", "2026-11-10T08:00:00Z", "2026-11-10T08:00:00Z", "launch"))
            self.assertEqual(full["daily"], [900, 900] + [None] * 5)
            self.assertEqual(projected["games"]["43"]["genres"], ["Strategy"])
            [upcoming] = projected["games"]["44"]["launches"]
            self.assertEqual((upcoming["launch_at"], upcoming["daily"]), ("2026-12-01T02:00:00Z", [None] * 7))

            forecast = projected["forecast"]
            self.assertEqual(forecast["trained_through"], "2026-11-19T16:00:00Z")
            # The deluxe launch's days 7-9 ended in time too; the others are a fifth of their first 24 and 48 hours.
            self.assertEqual(forecast["checkpoints"]["24"].count(0.2), 40)
            self.assertEqual(sorted(set(forecast["checkpoints"]["24"])), [0.2, 0.3, 0.625])
            self.assertEqual(forecast["launches"], len(forecast["checkpoints"]["24"]))
            # Each ratio is published beside the size it came from (the first 24 or 48 hours' median).
            self.assertEqual(sorted(ratio for _, ratio in forecast["samples"]["24"]), forecast["checkpoints"]["24"])
            self.assertEqual(forecast["samples"]["24"].count([1000, 0.2]), 40)
            self.assertEqual(forecast["samples"]["48"].count([1000, 0.2]), 40)
            backtest = forecast["backtest"]["48"]
            self.assertGreater(backtest["launches"], 0)
            self.assertEqual(set(backtest["thresholds"]), {"100", "1000", "3000"})

            # Without new hours the projection does not change.
            index_path = data / "twitch_series/index.json"
            index = json.loads(index_path.read_text())
            index["generated_at"] = "2026-11-20T05:10:00Z"
            index_path.write_text(json.dumps(index))
            self.assertEqual(build(data), projected)

    def test_an_empty_index_projects_no_launches(self):
        with TemporaryDirectory() as temporary:
            data = Path(temporary)
            (data / "twitch_series").mkdir()
            (data / "twitch_series/index.json").write_text(json.dumps({"schema_version": 1, "timezone": "Asia/Taipei",
                "generated_at": "2026-10-08T15:00:00Z", "months": {}, "games": {}}))
            (data / "catalog.json").write_text('{"games": []}')
            projected = build(data)
            self.assertEqual((projected["schema_version"], projected["games"], projected["forecast"]), (2, {}, None))


if __name__ == "__main__":
    unittest.main()
