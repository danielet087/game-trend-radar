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


if __name__ == "__main__":
    unittest.main()
