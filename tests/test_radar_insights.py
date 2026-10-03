import importlib.util
from copy import deepcopy
from pathlib import Path
from datetime import date
import unittest

spec = importlib.util.spec_from_file_location("insights", Path(__file__).parents[1] / "scripts/build_radar_insights.py")
M = importlib.util.module_from_spec(spec)
spec.loader.exec_module(M)


def catalog(*rows):
    return {"count": len(rows), "games": list(rows)}


def game(aid=1, **fields):
    return {"appid": aid, "name": "Test", "release_start": "2026-09-01", "followers": 6000,
            "follower_checked_at": "2026-09-01T15:00:00Z", **fields}


def twitch_game(aid=2, **fields):
    return game(aid, followers=812, release_precision="day",
        release_end="2026-09-01", release_time_utc="2026-08-31T17:00:00Z",
        release_timestamp_taipei_date="2026-09-01",
        release_display_precision="date_full", release_date_timezone="Asia/Taipei",
        steam_type="game", sexual_content_screened=True,
        twitch_admission={"schema_version": 1, "method": "twitch_igdb_external_steam_v1",
            "appid": aid, "twitch_game_id": "100", "igdb_id": "200",
            "checked_at": "2026-09-28T00:00:00Z", "source_frontend_commit": "a" * 40,
            "source_enrollment": {"source": "igdb_first_release_date",
                "observed_at": "2026-09-01T00:00:00Z", "viewer_count": 7200, "min_viewers": 7000}},
        **fields)


def twitch_store_authority(**fields):
    return {**twitch_game(2638890), "name": "Onimusha: Way of the Sword",
        "release_start": "2026-09-03", "release_end": "2026-09-03",
        "release_store_date": "2026-09-03", "release_time_utc": "2026-09-04T00:00:00Z",
        "release_timestamp_taipei_date": "2026-09-04", "release_date_conflict": True,
        "release_date_normalization": "steam_taiwan_store_date_authoritative",
        "release_display_provider": "Steam Store appdetails cc=TW l=tchinese",
        "release_date_verified_at": "2026-10-03T13:00:00Z", **fields}


class InsightTests(unittest.TestCase):
    def test_verified_store_authority_keeps_calendar_day_and_real_follower_history(self):
        raw = twitch_store_authority()
        before = deepcopy(raw)
        self.assertEqual(list(M.accepted([raw])), ["2638890"])
        baseline = M.update(None, catalog(game()), observed_at="2026-10-03T12:00:00Z")
        changed = M.update(baseline, catalog(game(), raw), observed_at="2026-10-03T13:00:00Z")
        activity, growth = M.projections(changed, date(2026, 10, 3))
        self.assertEqual(activity["events"][0]["date"], "2026-09-03")
        record = changed["records"]["2638890"]
        self.assertEqual(record["release_date"], "2026-09-03")
        self.assertEqual(record["history"][0]["followers"], 812)
        self.assertEqual(next(g for g in growth["games"] if g["appid"] == 2638890)["release_date"], "2026-09-03")
        self.assertEqual(raw, before)

    def test_store_authority_cannot_be_forged_by_missing_proof_or_bad_date_audit(self):
        for fields in [{"release_date_normalization": None}, {"release_display_provider": "Steam Store cc=US"},
                {"release_date_verified_at": None}, {"release_date_verified_at": "2026-10-03T13:00:00"},
                {"release_store_date": None}, {"release_store_date": "2026-09-04"},
                {"release_store_date": "2026-02-30"}, {"release_end": "2026-09-04"},
                {"release_display_precision": "date_month"}, {"release_date_timezone": "UTC"},
                {"release_time_utc": None}, {"release_timestamp_taipei_date": "2026-09-03"},
                {"release_timestamp_taipei_date": None}, {"release_date_conflict": False},
                {"release_date_conflict": "true"}, {"twitch_admission": None},
                {"steam_type": "dlc"}, {"sexual_content_screened": False}, {"followers": "812"},
                {"follower_checked_at": None},
                {"followers": 6000, "twitch_admission": None},
                {"followers": 6000, "sexual_content_screened": False}]:
            with self.subTest(fields=fields):
                self.assertEqual(M.accepted([twitch_store_authority(**fields)]), {})

    def test_verified_twitch_import_records_addition_and_daily_real_followers_history(self):
        first = M.update(None, catalog(game()), observed_at="2026-09-27T00:00:00Z")
        changed = M.update(first, catalog(game(), twitch_game()), observed_at="2026-09-28T00:00:00Z")
        activity, growth = M.projections(changed, date(2026, 9, 28))
        self.assertEqual([row["appid"] for row in activity["events"]], [2])
        self.assertEqual(changed["records"]["2"]["history"][0]["followers"], 812)
        self.assertEqual([row["appid"] for row in growth["games"]], [1, 2])
        again = M.update(changed, catalog(game(), twitch_game()), observed_at="2026-09-28T01:00:00Z")
        self.assertEqual(again, changed)

    def test_low_followers_twitch_import_requires_complete_proof_and_verified_steam_row(self):
        valid = twitch_game()
        self.assertEqual(list(M.accepted([valid])), ["2"])
        bad_proofs = [None, {}, {**valid["twitch_admission"], "appid": 3},
            {**valid["twitch_admission"], "method": "manual"},
            {**valid["twitch_admission"], "source_frontend_commit": "main"}]
        for proof in bad_proofs:
            with self.subTest(proof=proof):
                self.assertEqual(M.accepted([{**valid, "twitch_admission": proof}]), {})
        for fields in [{"steam_type": "dlc"}, {"sexual_content_screened": False},
                {"release_end": "2026-09-02"}, {"release_precision": "month"},
                {"release_display_precision": "month"}, {"release_date_conflict": True},
                {"release_time_utc": "2026-08-31T15:59:59Z"},
                {"release_time_utc": None}, {"release_date_timezone": "UTC"},
                {"release_timestamp_taipei_date": "2026-08-31"},
                {"follower_checked_at": None}, {"followers": None}]:
            with self.subTest(fields=fields):
                self.assertEqual(M.accepted([{**valid, **fields}]), {})
        for fields in [{"viewer_count": 6999}, {"min_viewers": 7001},
                {"source": "steam_recent_release"}, {"qualification": "unverified"},
                {"observed_at": "2026-09-29T00:00:00Z"}]:
            broken = deepcopy(valid)
            broken["twitch_admission"]["source_enrollment"].update(fields)
            self.assertEqual(M.accepted([broken]), {})
        self.assertEqual(M.accepted([game(followers=4999)]), {})
        self.assertEqual(M.accepted([game(followers=3000, recent_source="direct_release")]), {})
        self.assertEqual(list(M.accepted([game(followers=3001, recent_source="direct_release")])), ["1"])
        self.assertEqual(list(M.accepted([game(followers=5000)])), ["1"])

    def test_date_conflict_is_rejected_without_changing_date_only_legacy_support(self):
        self.assertEqual(list(M.accepted([game()])), ["1"])
        for fields in [{"release_end": "2026-09-02"}, {"release_date_conflict": True},
                {"release_timestamp_taipei_date": "2026-08-31"},
                {"release_time_utc": "2026-08-31T15:59:59Z"}]:
            self.assertEqual(M.accepted([game(**fields)]), {})

    def test_baseline_is_not_a_fake_batch_of_new_games_and_repoll_is_idempotent(self):
        first = M.update(None, catalog(game()), observed_at="2026-09-28T00:00:00Z")
        self.assertEqual(first["events"], [])
        again = M.update(first, catalog(game()), observed_at="2026-09-28T02:00:00Z")
        self.assertEqual(first, again)
        self.assertEqual(again["records"]["1"]["history"][0]["at"], "2026-09-01T15:00:00Z")

    def test_real_addition_date_change_and_removed_games(self):
        first = M.update(None, catalog(game()), observed_at="2026-09-27T00:00:00Z")
        changed = M.update(first, catalog(game(release_start="2026-10-01"), game(2)), observed_at="2026-09-28T00:00:00Z")
        self.assertEqual([event["type"] for event in changed["events"]], ["release_date", "added"])
        final = M.update(changed, catalog(game(2)), observed_at="2026-09-28T01:00:00Z")
        activity, growth = M.projections(final, date(2026, 9, 28))
        self.assertEqual([e["appid"] for e in activity["events"]], [2])
        self.assertEqual([g["appid"] for g in growth["games"]], [2])

    def test_taipei_daily_latest_measurement_and_no_filled_days(self):
        first = M.update(None, catalog(game()), observed_at="2026-09-28T00:00:00Z", measurements=[
            {"appid": 1, "at": "2026-09-02T01:00:00Z", "followers": 6200, "source": "steam_community"},
            {"appid": 1, "at": "2026-09-01T18:00:00Z", "followers": 6100, "source": "steam_community"}])
        self.assertEqual([p["followers"] for p in first["records"]["1"]["history"]], [6000, 6200])

    def test_day_30_included_day_31_rejected_and_never_invent_measurement_time(self):
        first = M.update(None, catalog(game()), observed_at="2026-10-03T00:00:00Z", measurements=[
            {"appid": 1, "at": "2026-10-01T01:00:00Z", "followers": 6500, "source": "steam_community"},
            {"appid": 1, "at": "2026-10-02T01:00:00Z", "followers": 6800, "source": "steam_community"},
            {"appid": 1, "at": "2026-10-01T02:00:00Z", "followers": 9000, "source": "third_party"}])
        self.assertEqual(first["records"]["1"]["history"][-1]["followers"], 6500)
        self.assertTrue(M.projections(first, date(2026, 10, 1))[1]["games"][0]["tracking"])
        self.assertFalse(M.projections(first, date(2026, 10, 2))[1]["games"][0]["tracking"])

    def test_missing_or_invalid_observations_are_not_zero_growth(self):
        first = M.update(None, catalog(game(follower_checked_at=None)), observed_at="2026-09-28T00:00:00Z")
        self.assertEqual(first["records"]["1"]["history"], [])
        with self.assertRaises(ValueError):
            M.update(first, {"count": 2, "games": [game()]}, observed_at="2026-09-28T00:00:00Z")


if __name__ == "__main__":
    unittest.main()
