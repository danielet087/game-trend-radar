"""Both module and direct-script insights entries require Radar Core."""
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

from radar_core.domain import twitch_admission as core
from scripts import build_radar_insights, twitch_steam_admission as compatibility


class CoreConsumerTests(unittest.TestCase):
    def test_legacy_api_exports_the_shared_rules(self):
        expected = {
            "EVIDENCE_SOURCES", "METHOD", "TAIPEI", "TW_STORE_DATE_AUTHORITY",
            "TW_STORE_DATE_PROVIDER", "aware_time", "decimal_id",
            "has_taiwan_store_date_authority", "has_twitch_admission",
            "is_twitch_qualified", "normalize_twitch_admission",
            "preserve_twitch_admission", "resolve_store_release_day",
            "valid_enrollment", "validate_twitch_snapshot",
        }
        self.assertEqual(set(compatibility.__all__), expected)
        for name in expected:
            with self.subTest(name=name):
                self.assertIs(getattr(compatibility, name), getattr(core, name))

    def test_insights_uses_shared_qualification(self):
        self.assertIs(build_radar_insights.is_twitch_qualified, core.is_twitch_qualified)

    def test_direct_script_entry_loads_installed_core_outside_repo(self):
        script = Path(__file__).resolve().parents[1] / "scripts/build_radar_insights.py"
        with tempfile.TemporaryDirectory() as directory:
            result = subprocess.run(
                [sys.executable, str(script), "--help"],
                cwd=directory, env={**os.environ, "PYTHONPATH": ""},
                capture_output=True, text=True, timeout=15,
            )
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("usage:", result.stdout)


if __name__ == "__main__":
    unittest.main()
