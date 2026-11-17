import json
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import patch
import contextlib
import io
import os

from radar_core.storage import documents, primary, primary_store
from radar_core.storage.sql import SqliteClient
from scripts import site_twitch_views as views

SOURCE = views.REPOSITORY + "@" + views.BRANCH
DATABASE = {
    "data/twitch_history/2026-11-17.json": b'{"hours": [1, 2]}',
    "data/twitch_history_compact/2026-11-17.json": b'{"games": {"1": 2}}',
    "data/twitch_series/index.json": b'{"games": {}}',
}


def site(root: Path, files):
    for path, raw in {"index.html": b"<html>", "data/catalog.json": b"{}", **files}.items():
        (root / path).parent.mkdir(parents=True, exist_ok=True)
        (root / path).write_bytes(raw)
    return root


class SiteTwitchViewsTests(unittest.TestCase):
    def setUp(self):
        self.temporary = TemporaryDirectory()
        self.tmp = Path(self.temporary.name)
        self.database = SqliteClient(self.tmp / "radar.sqlite")
        documents.initialize(self.database)
        primary_store.bootstrap_primary(self.database, SOURCE, DATABASE, "seed")
        patcher = patch.object(primary, "client", lambda: self.database)
        patcher.start()
        self.addCleanup(patcher.stop)

    def tearDown(self):
        self.database.close()
        self.temporary.cleanup()

    def test_verify_reports_every_difference_and_changes_nothing(self):
        root = site(self.tmp / "site", {
            "data/twitch_history/2026-11-17.json": b'{"hours": [1]}',          # older than the database
            "data/twitch_history_compact/2026-11-17.json": DATABASE["data/twitch_history_compact/2026-11-17.json"],
            "data/twitch_history_close/2026-11-16.json": b'{"close": 1}',      # only in Git
        })
        before = views.site_views(root)
        output = io.StringIO()
        with contextlib.redirect_stdout(output):
            status, report = views.run(root, "verify")
        self.assertEqual((status, report["status"]), (0, "different"))
        self.assertEqual((report["only_git"], report["only_database"], report["different"]), (1, 1, 1))
        self.assertEqual(report["examples"]["different"], ["data/twitch_history/2026-11-17.json"])
        self.assertEqual(views.site_views(root), before)
        self.assertIn("differ from Git", output.getvalue())

    def test_verify_of_an_identical_copy_and_overlay_replace_git_files(self):
        root = site(self.tmp / "site", DATABASE)
        self.assertEqual(views.run(root, "verify")[1]["status"], "verified")
        stale = site(self.tmp / "other", {"data/twitch_history_close/2026-11-16.json": b"{}"})
        status, report = views.run(stale, "overlay")
        self.assertEqual((status, report["status"]), (0, "overlaid"))
        self.assertEqual(views.site_views(stale), DATABASE)
        self.assertEqual((stale / "data/catalog.json").read_bytes(), b"{}")

    def test_an_unreachable_database_only_warns_in_verify_and_stops_an_overlay(self):
        def unreachable(*args, **kwargs):
            raise type("StorageError", (Exception,), {"code": "SQL_UNAVAILABLE"})("down")

        root = site(self.tmp / "site", DATABASE)
        output = io.StringIO()
        with patch.object(primary, "read_files", unreachable), contextlib.redirect_stdout(output):
            self.assertEqual(views.run(root, "verify"),
                             (0, {"mode": "verify", "status": "unavailable", "code": "SQL_UNAVAILABLE"}))
            self.assertEqual(views.run(root, "overlay")[0], 1)
        self.assertIn("deploying the Git copy", output.getvalue())
        self.assertEqual(views.site_views(root), DATABASE)

    def test_main_writes_the_report_to_the_job_summary(self):
        summary = self.tmp / "summary.md"
        with patch.dict(os.environ, {"GITHUB_STEP_SUMMARY": str(summary)}), contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(views.main([str(site(self.tmp / "site", DATABASE)), "--mode", "verify"]), 0)
        text = summary.read_text(encoding="utf-8")
        self.assertIn("### Twitch views (verify)", text)
        self.assertEqual(json.loads(text.split("```json\n")[1].split("\n```")[0])["status"], "verified")


if __name__ == "__main__":
    unittest.main()
