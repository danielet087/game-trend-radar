import contextlib
import io
import json
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import patch

from radar_core.storage import data_home, documents, primary, primary_store
from radar_core.storage.sql import SqliteClient, StorageError
from scripts import site_data

SOURCE = site_data.REPOSITORY + "@" + site_data.BRANCH
SEED = {
    "data/catalog.json": b'{"games": [1]}',
    "data/twitch_collection_status.json": b'{"schema_version": 1}',
    "data/games/1.json": b'{"appid": 1}',
}
PUBLISHED = "a" * 40


def site(root: Path, files):
    for path, raw in {"index.html": b"<html>", "data/README.md": b"notes", **files}.items():
        (root / path).parent.mkdir(parents=True, exist_ok=True)
        (root / path).write_bytes(raw)
    return root


class SiteDataTests(unittest.TestCase):
    def setUp(self):
        self.temporary = TemporaryDirectory()
        self.tmp = Path(self.temporary.name)
        self.database = SqliteClient(self.tmp / "radar.sqlite")
        documents.initialize(self.database)
        primary_store.bootstrap_primary(self.database, SOURCE, SEED, "seed")
        # Generation 2 is what Git commit PUBLISHED holds; generation 3 is newer.
        self.projected = {**SEED, "data/games/2.json": b'{"appid": 2}'}
        receipt = self.write({"data/games/2.json": b'{"appid": 2}'}, "projected")
        primary_store.acknowledge_projection(self.database, SOURCE, "projected", PUBLISHED,
                                             generation=receipt["generation"],
                                             manifest_digest=receipt["manifest_digest"])
        self.write({"data/catalog.json": b'{"games": [1, 2]}'}, "newer")
        patcher = patch.object(primary, "client", lambda: self.database)
        patcher.start()
        self.addCleanup(patcher.stop)

    def tearDown(self):
        self.database.close()
        self.temporary.cleanup()

    def write(self, changed, operation, deleted=()):
        head, _ = primary_store.read_files(self.database, SOURCE)
        return primary_store.publish_patch(self.database, SOURCE, base_generation=head["generation"],
                                           changed=changed, deleted=deleted, operation_id=operation)

    def quiet(self, *args):
        output = io.StringIO()
        with contextlib.redirect_stdout(output):
            result = site_data.run(*args)
        return result, output.getvalue()

    def test_verify_compares_git_with_the_version_its_commit_was_projected_from(self):
        # A newer database generation (catalog with two games) is not a difference.
        root = site(self.tmp / "site", self.projected)
        (status, report), _ = self.quiet(root, "verify", PUBLISHED)
        self.assertEqual((status, report["status"], report["generation"]), (0, "verified", 2))
        self.assertEqual((report["site_documents"], report["database_documents"]), (4, 4))

    def test_verify_reports_every_difference_and_changes_nothing(self):
        root = site(self.tmp / "site", {
            **SEED,                                            # no data/games/2.json
            "data/games/1.json": b'{"appid": 1, "stale": true}',
            "data/extra.json": b"{}",
        })
        before = site_data.site_documents(root)
        (status, report), output = self.quiet(root, "verify", PUBLISHED)
        self.assertEqual((status, report["status"]), (0, "different"))
        self.assertEqual((report["only_site"], report["only_database"], report["different"]), (1, 1, 1))
        self.assertEqual(report["examples"], {"only_site": ["data/extra.json"],
                                              "only_database": ["data/games/2.json"],
                                              "different": ["data/games/1.json"]})
        self.assertEqual(site_data.site_documents(root), before)
        self.assertIn("differs from Git", output)

    def test_verify_only_warns_when_the_database_cannot_answer(self):
        root = site(self.tmp / "site", self.projected)
        for commit, expected in ((None, "NO_DATA_COMMIT"), ("not-a-commit", "NO_DATA_COMMIT")):
            (status, report), output = self.quiet(root, "verify", commit)
            self.assertEqual((status, report["status"], report["code"]), (0, "unavailable", expected))
        (status, report), output = self.quiet(root, "verify", "b" * 40)  # never projected
        self.assertEqual((status, report["status"]), (0, "unavailable"))
        self.assertIn("deploying the Git copy", output)
        def offline():
            raise StorageError("DATABASE_UNAVAILABLE", "offline")
        with patch.object(primary, "client", offline):
            (status, report), _ = self.quiet(root, "verify", PUBLISHED)
        self.assertEqual((status, report["code"]), (0, "DATABASE_UNAVAILABLE"))
        self.assertEqual(site_data.site_documents(root), self.projected)

    def test_overlay_serves_the_newest_database_version_and_records_it(self):
        views = {"data/twitch_history/2026-11-17.json": b'{"hours": []}',
                 "data/twitch_series/index.json": b'{"games": {}}'}
        root = site(self.tmp / "site", {**self.projected, **views, "data/stale.json": b"{}"})
        (status, report), _ = self.quiet(root, "overlay")
        self.assertEqual((status, report["status"], report["generation"]), (0, "overlaid", 3))
        head, expected = primary_store.read_files(self.database, SOURCE)
        self.assertEqual(site_data.site_documents(root), expected)
        self.assertEqual((root / "data/catalog.json").read_bytes(), b'{"games": [1, 2]}')
        self.assertFalse((root / "data/stale.json").exists())
        # Twitch views, other site files and non-document files are left alone.
        for path, raw in {**views, "index.html": b"<html>", "data/README.md": b"notes"}.items():
            self.assertEqual((root / path).read_bytes(), raw)
        record = json.loads((root / site_data.BUILD_RECORD).read_text())
        self.assertEqual((record["source"], record["generation"], record["manifest_digest"], record["documents"]),
                         (SOURCE, 3, head["manifest_digest"], 4))

    def test_overlay_keeps_the_previous_site_on_any_failure(self):
        root = site(self.tmp / "site", self.projected)
        def offline():
            raise StorageError("DATABASE_UNAVAILABLE", "offline")
        with patch.object(primary, "client", offline):
            (status, report), _ = self.quiet(root, "overlay")
        self.assertEqual((status, report["code"]), (1, "DATABASE_UNAVAILABLE"))
        self.write({}, "drop-receipt", deleted=("data/twitch_collection_status.json",))
        (status, report), _ = self.quiet(root, "overlay")
        self.assertEqual((status, report["code"], report["missing"]),
                         (1, "NO_DATABASE_DATA", ["data/twitch_collection_status.json"]))
        self.assertEqual(site_data.site_documents(root), self.projected)
        self.assertFalse((root / site_data.BUILD_RECORD).exists())

    def flag(self, site_home, git_projection=True, operation="flag"):
        return self.write({data_home.FLAG: data_home.document(site=site_home, git_projection=git_projection)},
                          operation)

    def test_auto_verifies_until_the_database_flag_moves_the_site(self):
        root = site(self.tmp / "site", self.projected)
        (status, report), _ = self.quiet(root, "auto", PUBLISHED)
        self.assertEqual((status, report["mode"], report["status"]), (0, "verify", "verified"))
        self.assertEqual(report["selected_by"]["flag"], "absent")
        self.assertEqual(site_data.site_documents(root), self.projected)
        self.flag("git")
        (status, report), _ = self.quiet(root, "auto", PUBLISHED)
        self.assertEqual((status, report["mode"], report["selected_by"]["site"]), (0, "verify", "git"))
        self.assertFalse((root / site_data.BUILD_RECORD).exists())

    def test_auto_overlays_once_the_flag_says_database(self):
        root = site(self.tmp / "site", self.projected)
        self.flag("database", git_projection=False)
        (status, report), _ = self.quiet(root, "auto", PUBLISHED)
        self.assertEqual((status, report["mode"], report["status"]), (0, "overlay", "overlaid"))
        self.assertEqual(report["selected_by"], {"site": "database", "git_projection": False,
                                                 "flag": "present", "flag_generation": 4})
        head, expected = primary_store.read_files(self.database, SOURCE)
        self.assertEqual(site_data.site_documents(root), expected)
        self.assertIn(data_home.FLAG, expected)
        self.assertEqual(json.loads((root / site_data.BUILD_RECORD).read_text())["generation"], 4)

    def test_auto_stops_the_deploy_without_a_valid_answer(self):
        root = site(self.tmp / "site", self.projected)
        def offline():
            raise StorageError("DATABASE_UNAVAILABLE", "offline")
        with patch.object(primary, "client", offline):
            (status, report), _ = self.quiet(root, "auto", PUBLISHED)
        self.assertEqual((status, report["mode"], report["code"]), (1, "auto", "DATABASE_UNAVAILABLE"))
        self.write({data_home.FLAG: b'{"schema_version": 1, "site": "git", "git_projection": false}'}, "bad-flag")
        (status, report), _ = self.quiet(root, "auto", PUBLISHED)
        self.assertEqual((status, report["code"]), (1, "INVALID_DATA_HOME"))
        self.assertEqual(site_data.site_documents(root), self.projected)

    def test_overlay_can_rebuild_the_version_the_live_site_records(self):
        live = site(self.tmp / "live", self.projected)
        (status, _), _ = self.quiet(live, "overlay")
        recorded = json.loads((live / site_data.BUILD_RECORD).read_text())["manifest_digest"]
        self.write({"data/games/3.json": b'{"appid": 3}'}, "after-deploy")
        rebuilt = site(self.tmp / "rebuilt", self.projected)
        (status, report), _ = self.quiet(rebuilt, "overlay", None, recorded)
        self.assertEqual((status, report["manifest_digest"]), (0, recorded))
        self.assertEqual(site_data.site_documents(rebuilt), site_data.site_documents(live))
        self.assertNotIn("data/games/3.json", site_data.site_documents(rebuilt))
        (status, report), _ = self.quiet(rebuilt, "overlay", None, "not-a-digest")
        self.assertEqual((status, report["code"]), (1, "INVALID_REVISION"))

    def test_site_documents_skip_views_other_files_and_reject_symlinks(self):
        root = site(self.tmp / "site", {"data/games/1.json": b"{}", "data/twitch_series/1/2026-11.json": b"{}",
                                        "data/rows.jsonl": b"{}\n"})
        self.assertEqual(set(site_data.site_documents(root)), {"data/games/1.json", "data/rows.jsonl"})
        (root / "data/link.json").symlink_to(root / "data/games/1.json")
        with self.assertRaises(ValueError):
            site_data.site_documents(root)

    def test_main_prints_a_summary_without_document_contents(self):
        root = site(self.tmp / "site", self.projected)
        output = io.StringIO()
        with contextlib.redirect_stdout(output):
            status = site_data.main([str(root), "--mode", "verify", "--data-commit", PUBLISHED])
        self.assertEqual(status, 0)
        self.assertIn('"status": "verified"', output.getvalue())
        self.assertNotIn('"appid"', output.getvalue())


if __name__ == "__main__":
    unittest.main()
