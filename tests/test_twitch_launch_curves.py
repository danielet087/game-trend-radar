from datetime import datetime, timedelta, timezone
import json
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest

from scripts.build_twitch_launch_curves import build


class LaunchCurvesTests(unittest.TestCase):
    def test_taipei_release_alignment_coverage_edition_and_stable_daily_projection(self):
        with TemporaryDirectory() as temporary:
            data = Path(temporary)
            root = data / "twitch_series"
            (root / "42").mkdir(parents=True)
            catalog = {"games": [{"appid": 800, "release_start": "2026-10-31", "genres": ["Action", "Early Access"]}]}
            (data / "catalog.json").write_text(json.dumps(catalog), encoding="utf-8")
            reference = {"date": "2026-10-31", "precision": "day", "source_type": "steam_taiwan_store_date", "steam_appid": "800"}
            game = {"archive_eligible": True, "months": ["2026-11"], "release_reference": reference}
            games = {"42": game, "43": {**game, "release_reference": {**reference, "date": "2026-10-30"}}}
            slots, samples = {}, {}
            start = datetime(2026, 10, 31, 16, tzinfo=timezone.utc)
            for offset, count in [(0, 12), (1, 11), (2, 12), (3, 12)]:
                for hour in range(count):
                    at = start + timedelta(days=offset, hours=hour)
                    key = at.isoformat().replace("+00:00", "Z")
                    receipt = (at + timedelta(minutes=10)).isoformat().replace("+00:00", "Z")
                    slots[key] = receipt
                    samples[key] = {"generated_at": receipt, "viewer_count": [0, 700, 300, 400][offset]}
            index = {"schema_version": 1, "timezone": "Asia/Taipei", "generated_at": "2026-11-04T10:00:00Z",
                     "months": {"2026-11": slots}, "games": games}
            index_path = root / "index.json"
            index_path.write_text(json.dumps(index), encoding="utf-8")
            chunk = {"schema_version": 1, "timezone": "Asia/Taipei", "game_id": "42", "month": "2026-11", "hours": samples}
            (root / "42/2026-11.json").write_text(json.dumps(chunk), encoding="utf-8")
            projected = build(data)
            self.assertEqual(projected["games"], {"42": {"date": "2026-10-31", "edition": "early_access",
                "genres": ["Action"], "daily": [0, None, 300, None, None, None, None]}})
            index["generated_at"] = "2026-11-04T12:00:00Z"
            index_path.write_text(json.dumps(index), encoding="utf-8")
            self.assertEqual(build(data), projected)
