"""Publication retries can reuse one observation instant across Taiwan midnight."""
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]


class InsightsPublicationClockTests(unittest.TestCase):
    def invoke(self, root, *args):
        return subprocess.run([sys.executable, "-B", str(ROOT / "scripts/build_radar_insights.py"),
                               "--data-dir", str(root), *args], capture_output=True, text=True)

    def test_explicit_aware_clock_controls_baseline_and_taiwan_date(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "catalog.json").write_text(json.dumps({"count": 1, "games": [{
                "appid": 1, "name": "Game", "followers": 5000,
                "release_start": "2026-10-09", "release_precision": "day",
                "follower_checked_at": "2026-10-08T15:00:00Z"}]}))
            result = self.invoke(root, "--observed-at", "2026-10-08T15:59:59Z")
            self.assertEqual(result.returncode, 0, result.stderr)
            first = {name: (root / name).read_bytes() for name in (
                "insights-state.json", "activity.json", "growth.json")}
            state = json.loads(first["insights-state.json"])
            self.assertEqual(state["started_at"], "2026-10-08T15:59:59Z")
            self.assertEqual(state["records"]["1"]["first_seen_at"], "2026-10-08T15:59:59Z")
            self.assertEqual(json.loads(first["growth.json"])["as_of"], "2026-10-08")
            again = self.invoke(root, "--observed-at", "2026-10-08T15:59:59Z")
            self.assertEqual(again.returncode, 0, again.stderr)
            self.assertEqual(first, {name: (root / name).read_bytes() for name in first})

    def test_naive_or_invalid_clock_is_rejected_before_writing_public_files(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            for value in ("2026-10-08T23:59:59", "bad-time"):
                result = self.invoke(root, "--observed-at", value)
                self.assertNotEqual(result.returncode, 0)
                self.assertFalse((root / "growth.json").exists())

    def test_default_cli_still_uses_current_aware_clock(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "catalog.json").write_text('{"count":0,"games":[]}')
            result = self.invoke(root)
            self.assertEqual(result.returncode, 0, result.stderr)
            state = json.loads((root / "insights-state.json").read_text())
            self.assertTrue(state["started_at"].endswith("Z"))

    def test_terminal_group_gap_metadata_is_published_without_zeroing_historical_followers(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            rows = [{"appid": aid, "name": f"Game {aid}", "followers": 6000,
                     "release_start": "2026-11-01", "release_precision": "day",
                     "follower_checked_at": "2026-10-09T01:00:00Z"} for aid in [1, 2]]
            (root / "catalog.json").write_text(json.dumps({"count": 2, "games": rows}))
            first = self.invoke(root, "--observed-at", "2026-10-10T01:00:00Z")
            self.assertEqual(first.returncode, 0, first.stderr)
            history = json.loads((root / "growth.json").read_text())["games"][1]["history"]
            report = {"coverage_schema_version": 2, "generated_at": "2026-10-11T00:00:00Z",
                      "collection_date_taipei": "2026-10-11", "eligible": 2, "eligible_appids": [1, 2],
                      "published_eligible_appids": [1, 2], "published_resolvable_appids": [1],
                      "reason": "completed", "errors": [], "pending": [],
                      "measurement_complete": False, "collection_complete": True,
                      "measurements": [{"appid": 1, "at": "2026-10-11T00:00:00Z",
                                        "followers": 6100, "source": "steam_community"}],
                      "unavailable": [{"appid": 2, "reason": "official_group_not_found", "group_resolution": {
                          "source": "Steam ISteamUser/ResolveVanityURL", "status": "not_found", "http": 200,
                          "api_result": 42, "attempted": True, "checked_at": "2026-10-10T23:00:00Z",
                          "retry_at": "2026-10-12T23:00:00Z"}}]}
            (root / "report.json").write_text(json.dumps(report))
            result = self.invoke(root, "--measurements", str(root / "report.json"),
                                 "--observed-at", "2026-10-11T01:00:00Z")
            self.assertEqual(result.returncode, 0, result.stderr)
            growth = json.loads((root / "growth.json").read_text())
            collection = growth["collection"]
            self.assertEqual(collection["coverage"], {"eligible": 2, "measured": 1, "unavailable": 1, "pending": 0})
            self.assertTrue(collection["collection_complete"])
            self.assertFalse(collection["measurement_complete"])
            self.assertEqual(growth["games"][1]["history"], history)
            self.assertEqual(json.loads((root / "insights-state.json").read_text())["collection"], collection)
            again = self.invoke(root, "--observed-at", "2026-10-11T02:00:00Z")
            self.assertEqual(again.returncode, 0, again.stderr)
            self.assertEqual(json.loads((root / "growth.json").read_text())["collection"], collection)

    def test_newer_canonical_receipt_uses_delivery_clock_while_events_and_history_stay_frozen(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            frozen, delivery = "2026-10-02T01:20:00Z", "2026-10-02T01:40:00Z"
            (root / "catalog.json").write_text('{"count":0,"games":[]}')
            baseline = self.invoke(root, "--observed-at", "2026-10-01T01:00:00Z")
            self.assertEqual(baseline.returncode, 0, baseline.stderr)
            rows = [{"appid": aid, "name": f"Game {aid}", "followers": 6000,
                     "release_start": "2026-11-01", "release_precision": "day",
                     "follower_checked_at": "2026-09-29T01:00:00Z"} for aid in [1, 2]]
            (root / "catalog.json").write_text(json.dumps({"count": 2, "games": rows}))
            original = {"source": "Steam ISteamUser/ResolveVanityURL", "status": "not_found", "http": 200,
                        "api_result": 42, "attempted": True, "checked_at": "2026-10-02T01:10:00Z",
                        "retry_at": "2026-10-03T01:00:00Z"}
            canonical = {**original, "checked_at": "2026-10-02T01:30:00Z"}
            report = {"coverage_schema_version": 2, "generated_at": frozen, "coverage_checked_at": delivery,
                      "collection_date_taipei": "2026-10-02", "eligible": 2, "eligible_appids": [1, 2],
                      "published_eligible_appids": [1, 2], "published_resolvable_appids": [1],
                      "checkpoint_group_resolutions": {"2": canonical},
                      "reason": "completed", "errors": [], "pending": [],
                      "measurement_complete": False, "collection_complete": True,
                      "measurements": [{"appid": 1, "at": "2026-10-02T01:19:00Z",
                                        "followers": 6100, "source": "steam_community"}],
                      "unavailable": [{"appid": 2, "reason": "official_group_not_found", "group_resolution": original}]}
            (root / "report.json").write_text(json.dumps(report))
            result = self.invoke(root, "--measurements", str(root / "report.json"), "--observed-at", frozen)
            self.assertEqual(result.returncode, 0, result.stderr)
            state = json.loads((root / "insights-state.json").read_text())
            growth = json.loads((root / "growth.json").read_text())
            activity = json.loads((root / "activity.json").read_text())
            self.assertTrue(growth["collection"]["collection_complete"])
            self.assertEqual(growth["collection"]["coverage"], {"eligible": 2, "measured": 1, "unavailable": 1, "pending": 0})
            self.assertEqual(growth["collection"]["coverage_checked_at"], delivery)
            self.assertEqual(state["updated_at"], frozen)
            self.assertTrue(all(row["first_seen_at"] == frozen for row in state["records"].values()))
            self.assertTrue(all(event["at"] == frozen for event in activity["events"]))
            self.assertEqual(growth["games"][0]["history"][-1]["at"], "2026-10-02T01:19:00Z")
            self.assertEqual(growth["games"][1]["history"][-1]["at"], "2026-09-29T01:00:00Z")


if __name__ == "__main__":
    unittest.main()
