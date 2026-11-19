"""The frozen test data stays small, consistent and complete for the tests that name games."""
import json
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import patch

from scripts import make_test_site_data as make

FIXTURE = Path(__file__).resolve().parent / "fixtures" / "site-data"


def game(appid, followers=100, date="2026-12-01"):
    return {"appid": appid, "followers": followers, "release_start": date}


class MakeTests(unittest.TestCase):
    def test_trims_every_file_to_the_chosen_games(self):
        with TemporaryDirectory() as tmp:
            source, target = Path(tmp) / "data", Path(tmp) / "fixture"
            rows = [game(1), game(2), game(5356470), game(4, 6000, "2027-01-01")]
            files = {
                "catalog.json": {"version": 3, "generated_at": "2026-11-18T00:00:00Z", "count": 4, "games": rows},
                "steam_upcoming.json": {"version": 2, "count": 4, "games": rows},
                "steam_preview.json": {"games": [game(2), game(9)], "recent_games": []},
                "nintendo_upcoming.json": {"schema_version": 1, "games": [{"igdb_id": 7}]},
                "activity.json": {"version": 1, "events": [{"appid": 2}, {"appid": 9}, {"igdb_id": 7}]},
                "growth.json": {"version": 1, "games": [{"appid": 1}, {"appid": 9}]},
                "games/1.json": game(1), "games/5356470.json": game(5356470), "games/9.json": game(9),
                "media/2.json": {"schema_version": 1, "appid": 2}, "media/9.json": {"schema_version": 1, "appid": 9},
                "store_facts.json": {"schema_version": 1, "checked_at": "2026-11-18T00:00:00Z",
                                     "games": {"1": {"steam_deck": "verified"}, "9": {"steam_deck": "playable"}}},
            }
            for name, value in files.items():
                (source / name).parent.mkdir(parents=True, exist_ok=True)
                (source / name).write_text(json.dumps(value))
            with patch.object(make, "TARGET", target):
                report = make.make(source, 2)
            read = lambda name: json.loads((target / name).read_text())
            # The first two games, the named one and one in the Followers window.
            self.assertEqual([row["appid"] for row in read("catalog.json")["games"]], [1, 2, 5356470, 4])
            self.assertEqual((read("catalog.json")["count"], report["games"], report["game_files"]), (4, 4, 2))
            self.assertEqual([row["appid"] for row in read("steam_preview.json")["games"]], [2])
            self.assertEqual(read("activity.json")["events"], [{"appid": 2}, {"igdb_id": 7}])
            self.assertEqual(read("growth.json")["games"], [{"appid": 1}])
            self.assertEqual(sorted(path.name for path in (target / "games").iterdir()), ["1.json", "5356470.json"])
            # game.html's Steam media follows the chosen games too.
            self.assertEqual(sorted(path.name for path in (target / "media").iterdir()), ["2.json"])
            self.assertEqual(report["media_files"], 1)
            self.assertEqual(read("store_facts.json")["games"], {"1": {"steam_deck": "verified"}})
            self.assertEqual(report["store_facts_games"], 1)

    def test_the_committed_fixture_is_consistent(self):
        read = lambda name: json.loads((FIXTURE / name).read_text())
        catalog = read("catalog.json")
        appids = {row["appid"] for row in catalog["games"]}
        self.assertEqual(catalog["count"], len(appids))
        self.assertGreaterEqual(len(appids), 72)  # games.html shows 36 and then 72 cards
        self.assertTrue(set(make.NAMED) <= appids)
        self.assertTrue(any(make.followers_window(row) for row in catalog["games"]))
        self.assertTrue({row["appid"] for row in read("steam_upcoming.json")["games"]} <= appids)
        self.assertTrue({int(path.stem) for path in (FIXTURE / "games").glob("*.json")} <= appids)
        media = {int(path.stem) for path in (FIXTURE / "media").glob("*.json")}
        self.assertTrue(media and media <= appids)
        store = {int(key) for key in read("store_facts.json")["games"]}
        self.assertTrue(store and store <= appids)
        self.assertLess(sum(path.stat().st_size for path in FIXTURE.rglob("*") if path.is_file()), 4_000_000)


if __name__ == "__main__":
    unittest.main()
