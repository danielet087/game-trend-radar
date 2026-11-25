"""Launch curves keep refreshing after the Twitch series leave Git."""
import contextlib
from datetime import datetime, timezone
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
                      "catalog": (data / "catalog.json").read_bytes(),
                      "facts": (data / "store_facts.json").read_bytes() if (data / "store_facts.json").is_file() else None})
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
        (self.checkout / "data/store_facts.json").write_bytes(b'{"games": {}}')
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
        self.assertEqual(calls[0]["facts"], b'{"games": {}}')
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



def fake_review(calls, fail=False):
    """The builder as above, and the monthly review writing what it was given."""
    builder = fake_builder(calls)

    def run(argv, **kwargs):
        if argv[0] != "node":
            return builder(argv, **kwargs)
        if fail:
            raise subprocess.CalledProcessError(1, argv)
        data, out, stamp = Path(argv[2]), Path(argv[3]), argv[4]
        calls.append({"review": data, "at": stamp, "curves": (data / "twitch-launch-curves.json").is_file()})
        out.write_text(json.dumps({"schema_version": 1, "generated_at": stamp, "checks": []}))
        return subprocess.CompletedProcess(argv, 0, "", "")
    return run


class RuleReviewTests(unittest.TestCase):
    """The monthly rule review rides on the launch curves' data, once per Taiwan month."""

    def setUp(self):
        self.temporary = TemporaryDirectory()
        self.checkout = Path(self.temporary.name) / "checkout"
        for path, raw in SERIES.items():
            (self.checkout / path).parent.mkdir(parents=True, exist_ok=True)
            (self.checkout / path).write_bytes(raw)
        (self.checkout / "data/catalog.json").write_bytes(b'{"games": []}')

    def tearDown(self):
        self.temporary.cleanup()

    def review(self):
        return json.loads((self.checkout / insights.REVIEW).read_text())

    def test_the_first_projection_of_a_month_writes_the_review_after_the_curves(self):
        calls = []
        with patch.object(insights.subprocess, "run", fake_review(calls)):
            insights._launch_curves(self.checkout, datetime(2026, 11, 30, 16, 17, tzinfo=timezone.utc))
        self.assertEqual(calls[1], {"review": self.checkout / "data", "at": "2026-11-30T16:17:00Z", "curves": True})
        self.assertEqual(self.review()["generated_at"], "2026-11-30T16:17:00Z")
        self.assertIn(insights.REVIEW, insights.PATHS)

    def test_it_runs_again_only_in_a_new_taiwan_month(self):
        (self.checkout / insights.REVIEW).write_text(json.dumps({"generated_at": "2026-11-30T16:17:00Z"}))
        calls = []
        with patch.object(insights.subprocess, "run", fake_review(calls)):
            # 2026-12-01 07:59 in Taiwan is still the month of the last review.
            insights._launch_curves(self.checkout, datetime(2026, 11, 30, 23, 59, tzinfo=timezone.utc))
            self.assertEqual(len(calls), 1)
            insights._launch_curves(self.checkout, datetime(2026, 12, 31, 16, 0, tzinfo=timezone.utc))
        self.assertEqual(len(calls), 3)
        self.assertEqual(self.review()["generated_at"], "2026-12-31T16:00:00Z")

    def test_a_failed_review_keeps_the_previous_one_and_the_curves(self):
        previous = {"generated_at": "2026-10-31T16:17:00Z", "checks": ["kept"]}
        (self.checkout / insights.REVIEW).write_text(json.dumps(previous))
        errors = io.StringIO()
        with patch.object(insights.subprocess, "run", fake_review([], fail=True)), contextlib.redirect_stderr(errors):
            insights._launch_curves(self.checkout, datetime(2026, 11, 30, 16, 17, tzinfo=timezone.utc))
        self.assertEqual(self.review(), previous)
        self.assertTrue((self.checkout / "data/twitch-launch-curves.json").is_file())
        self.assertIn("keeping the previous one", errors.getvalue())

    def test_without_an_observation_time_no_review_runs(self):
        calls = []
        with patch.object(insights.subprocess, "run", fake_review(calls)):
            insights._launch_curves(self.checkout)
        self.assertEqual(len(calls), 1)
        self.assertFalse((self.checkout / insights.REVIEW).exists())


if __name__ == "__main__":
    unittest.main()
