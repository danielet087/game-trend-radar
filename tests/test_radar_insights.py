import importlib.util
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


class InsightTests(unittest.TestCase):
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
