"""Launch curves keep refreshing after the Twitch series leave Git."""
import contextlib
import io
import json
import os
from pathlib import Path
import subprocess
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import patch

from radar_core.storage import documents, primary, primary_store
from radar_core.storage.sql import SqliteClient, StorageError
from scripts import publish_radar_insights as insights

SERIES = {"data/twitch_series/index.json": b'{"schema_version": 1}',
          "data/twitch_series/42/2026-11.json": b'{"hours": {}}'}


def fake_builder(calls):
    def run(argv, **kwargs):
        data = Path(argv[argv.index("--data-dir") + 1])
        calls.append({"data": data, "series": sorted(p.relative_to(data).as_posix()
                      for p in (data / "twitch_series").rglob("*.json")),
                      "catalog": (data / "catalog.json").read_bytes()})
        (data / "twitch-launch-curves.json").write_text('{"built_from": "%s"}' % data.name)
        return subprocess.CompletedProcess(argv, 0, "", "")
    return run


class LaunchCurvesSourceTests(unittest.TestCase):
    def setUp(self):
        self.temporary = TemporaryDirectory()
        self.tmp = Path(self.temporary.name)
        self.checkout = self.tmp / "checkout"
        (self.checkout / "data").mkdir(parents=True)
        (self.checkout / "data/catalog.json").write_bytes(b'{"games": []}')

    def tearDown(self):
        self.temporary.cleanup()

    def test_series_in_the_checkout_are_used_as_before(self):
        for path, raw in SERIES.items():
            (self.checkout / path).parent.mkdir(parents=True, exist_ok=True)
            (self.checkout / path).write_bytes(raw)
        calls = []
        with patch.object(insights.subprocess, "run", fake_builder(calls)), \
                patch.object(insights.primary, "read_files", lambda *a, **k: self.fail("no database read needed")):
            insights._launch_curves(self.checkout)
        self.assertEqual(calls[0]["data"], self.checkout / "data")

    def test_series_only_in_the_database_build_from_its_copy(self):
        database = SqliteClient(self.tmp / "radar.sqlite")
        self.addCleanup(database.close)
        documents.initialize(database)
        primary_store.bootstrap_primary(database, f"{insights.VIEWS_REPOSITORY}@{insights.VIEWS_BRANCH}", SERIES, "seed")
        calls = []
        with patch.object(primary, "client", lambda: database), \
                patch.dict(os.environ, {"RADAR_DATABASE_PRIMARY": "1"}), \
                patch.object(insights.subprocess, "run", fake_builder(calls)):
            insights._launch_curves(self.checkout)
        self.assertEqual(calls[0]["series"], ["twitch_series/42/2026-11.json", "twitch_series/index.json"])
        self.assertEqual(calls[0]["catalog"], b'{"games": []}')
        self.assertEqual(json.loads((self.checkout / "data/twitch-launch-curves.json").read_text())["built_from"], "data")
        self.assertFalse((self.checkout / "data/twitch_series").exists())

    def test_after_the_move_a_stale_git_copy_is_ignored(self):
        (self.checkout / "data/twitch_series").mkdir(parents=True)
        (self.checkout / "data/twitch_series/index.json").write_bytes(b'{"stale": true}')
        (self.checkout / insights.VIEWS_FLAG).parent.mkdir(parents=True)
        (self.checkout / insights.VIEWS_FLAG).write_text('{"schema_version": 1, "home": "database"}')
        database = SqliteClient(self.tmp / "radar.sqlite")
        self.addCleanup(database.close)
        documents.initialize(database)
        primary_store.bootstrap_primary(database, f"{insights.VIEWS_REPOSITORY}@{insights.VIEWS_BRANCH}", SERIES, "seed")
        calls = []
        with patch.object(primary, "client", lambda: database), \
                patch.dict(os.environ, {"RADAR_DATABASE_PRIMARY": "1"}), \
                patch.object(insights.subprocess, "run", fake_builder(calls)):
            insights._launch_curves(self.checkout)
        self.assertNotEqual(calls[0]["data"], self.checkout / "data")
        self.assertEqual(calls[0]["series"], ["twitch_series/42/2026-11.json", "twitch_series/index.json"])

    def test_an_unavailable_database_preserves_the_existing_projection(self):
        (self.checkout / "data/twitch-launch-curves.json").write_text('{"previous": true}')

        def down(*args, **kwargs):
            raise StorageError("SQL_UNAVAILABLE", "down")

        errors = io.StringIO()
        with patch.dict(os.environ, {"RADAR_DATABASE_PRIMARY": "1"}), \
                patch.object(insights.primary, "read_files", down), contextlib.redirect_stderr(errors):
            insights._launch_curves(self.checkout)
        self.assertEqual(json.loads((self.checkout / "data/twitch-launch-curves.json").read_text()), {"previous": True})
        self.assertIn("preserving the existing projection", errors.getvalue())


if __name__ == "__main__":
    unittest.main()
