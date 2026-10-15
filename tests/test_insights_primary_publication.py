"""Insights replay frozen inputs while the shared publisher owns DB/Git delivery."""
from copy import deepcopy
from datetime import datetime, timezone
import json
from pathlib import Path
import shutil
import subprocess

import tempfile
import unittest
from unittest.mock import patch

from radar_core.publication import SubprocessGitRepository
from radar_core.storage import documents, primary, primary_store
from radar_core.storage.sql import SqliteClient, StorageError
from scripts import publish_radar_insights as publication

ROOT = Path(__file__).resolve().parents[1]
FRONTEND = "danielet087/game-trend-radar@main"
BACKEND = publication.queue.SOURCE_REPOSITORY + "@main"
OBSERVED = datetime(2026, 10, 8, 15, 59, 59, tzinfo=timezone.utc)


def queue_snapshot():
    return {
        "schema_version": 1, "generated_at": "2026-10-08T15:00:00Z", "today_taipei": "2026-10-08",
        "source": {"repository": publication.queue.SOURCE_REPOSITORY},
        "summary": {"normal_pending": 1, "twitch_priority_pending": 0, "parked": 0,
                    "ready_pending": 1, "total_pending": 1},
        "queue": [{"position": 1, "appid": 42, "name": "Waiting game", "priority": False}],
        "parked": [], "cooldown": {"active": False, "until": None, "next_eligible_slot": None},
        "events": [],
    }


def git(root, *args):
    return subprocess.run(["git", *args], cwd=root, check=True, stdout=subprocess.PIPE,
                          stderr=subprocess.PIPE).stdout.decode().strip()


def assert_primary_queue_failure(self, invalid):
    self.patch_environment(RADAR_DATABASE_PRIMARY="1")
    def primary_read(*args):
        if invalid:
            return {"schema_version": 1, "queue": []}
        raise StorageError("NETWORK_ERROR")
    self.patch_object(primary, "read_json", primary_read)
    self.patch_object(publication.queue, "fetch_snapshot", lambda: self.fail("Git is not the queue authority"))
    self.patch_object(publication.queue, "read_valid_backup", lambda *args: self.fail("No stale queue fallback"))
    self.patch_object(publication, "publish", lambda *args, **kwargs: self.fail("Must fail before publication"))
    with self.assertRaises((StorageError, ValueError)):
        publication.main()


def assert_real_builder_replay(self, tmp_path):
    """A real CAS conflict reruns the builder, without recollecting or losing another writer."""
    self.patch_environment(RADAR_DATABASE_PRIMARY="1")
    database = SqliteClient(tmp_path / "primary.sqlite")
    try:
        documents.initialize(database)
        catalog = {"count": 1, "games": [{"appid": 1, "name": "Database game", "followers": 6000,
            "release_start": "2026-10-09", "release_precision": "day",
            "follower_checked_at": "2026-10-08T15:00:00Z"}]}
        source_files = {"data/catalog.json": json.dumps(catalog).encode(),
                        "data/twitch_live.json": b'{"channels":["original"]}\n',
                        "data/nintendo_master.json": b'{"unrelated_history":[1,2,3]}\n'}
        primary_store.bootstrap_primary(database, FRONTEND, source_files, "a" * 40)
        primary_store.bootstrap_primary(database, BACKEND,
            {"data/scheduler_queue_status.json": json.dumps(queue_snapshot()).encode()}, "b" * 40)
        self.patch_object(primary, "client", lambda: database)

        seed, remote, work = tmp_path / "seed", tmp_path / "remote.git", tmp_path / "work"
        (seed / "scripts").mkdir(parents=True)
        (seed / "data").mkdir()
        # Run the production builder and its real shared admission adapter.
        for name in ("build_radar_insights.py", "twitch_steam_admission.py"):
            shutil.copyfile(ROOT / "scripts" / name, seed / "scripts" / name)
        (seed / "data/catalog.json").write_text('{"count":0,"games":[]}\n')
        (seed / "README.md").write_text("Frontend source code remains intact\n")
        git(seed, "init", "-b", "main")
        git(seed, "config", "user.email", "test@example.com")
        git(seed, "config", "user.name", "Test")
        git(seed, "add", ".")
        git(seed, "commit", "-m", "initial")
        git(tmp_path, "clone", "--bare", str(seed), str(remote))
        git(tmp_path, "clone", str(remote), str(work))

        reads = []
        original_read = primary.read_json
        def read_once(*args, **kwargs):
            reads.append(args)
            return original_read(*args, **kwargs)
        self.patch_object(primary, "read_json", read_once)
        self.patch_object(publication.queue, "fetch_snapshot", lambda: self.fail("Retry must not fetch Git queue"))
        frozen = publication.frozen_queue()
        expected_queue = deepcopy(frozen)
        builder_clocks = []
        original_run = subprocess.run
        def record_builder(argv, **kwargs):
            if any(str(arg).endswith("build_radar_insights.py") for arg in argv):
                builder_clocks.append(argv[argv.index("--observed-at") + 1])
            return original_run(argv, **kwargs)
        self.patch_object(subprocess, "run", record_builder)

        class ConcurrentWriter(SubprocessGitRepository):
            raced = False
            def stage_commit(self, paths, message):
                if not self.raced:
                    self.raced = True
                    head, _ = primary_store.read_files(database, FRONTEND)
                    primary_store.publish_patch(database, FRONTEND, base_generation=head["generation"],
                        changed={"data/twitch_live.json": b'{"channels":["newer-concurrent-channel"]}\n'},
                        operation_id="concurrent-twitch")
                    # Even mutation of the caller's queue after collection must
                    # not change the frozen payload replayed by this publisher.
                    frozen["queue"][0]["name"] = "Changed after freezing"
                return super().stage_commit(paths, message)

        repository = ConcurrentWriter(work, disposable_checkout=True,
                                      primary=primary.GitPrimary(FRONTEND, database))
        receipt = publication.publish(work, observed_at=OBSERVED, repository=repository, queue_snapshot=frozen)
        assert receipt.attempts == 2
        assert len(reads) == 1 and builder_clocks == [OBSERVED.isoformat(), OBSERVED.isoformat()]
        head, actual = primary_store.read_files(database, FRONTEND)
        state = json.loads(actual["data/insights-state.json"])
        growth = json.loads(actual["data/growth.json"])
        assert state["started_at"] == "2026-10-08T15:59:59Z"
        assert state["records"]["1"]["first_seen_at"] == "2026-10-08T15:59:59Z"
        assert growth["as_of"] == "2026-10-08"
        assert growth["games"][0]["history"][-1]["followers"] == 6000
        assert json.loads(actual["data/scheduler_queue_status.json"]) == expected_queue
        assert actual["data/catalog.json"] == source_files["data/catalog.json"]
        assert actual["data/nintendo_master.json"] == source_files["data/nintendo_master.json"]
        assert json.loads(actual["data/twitch_live.json"])["channels"] == ["newer-concurrent-channel"]
        assert git(remote, "show", "main:README.md") == "Frontend source code remains intact"
        assert git(remote, "rev-parse", "main") == receipt.published_revision
        for name in publication.PATHS:
            assert json.loads(git(remote, "show", "main:" + name)) == json.loads(actual[name])
        assert primary_store.projection_pending(database, FRONTEND) == []
        proof = primary_store.resolve_git_revision(database, FRONTEND, receipt.published_revision)
        assert proof["manifest_digest"] == head["manifest_digest"]
        assert primary_store.read_files(database, BACKEND)[1]["data/scheduler_queue_status.json"] == json.dumps(expected_queue).encode()
    finally:
        database.close()


class InsightsPrimaryPublicationTests(unittest.TestCase):
    def patch_object(self, target, name, value):
        context = patch.object(target, name, value)
        self.addCleanup(context.stop)
        return context.start()

    def patch_environment(self, **values):
        import os
        context = patch.dict(os.environ, values)
        self.addCleanup(context.stop)
        context.start()

    def test_primary_queue_error_is_fail_closed(self):
        assert_primary_queue_failure(self, False)

    def test_invalid_primary_queue_is_fail_closed(self):
        assert_primary_queue_failure(self, True)

    def test_real_database_builder_publication_replay(self):
        with tempfile.TemporaryDirectory() as directory:
            assert_real_builder_replay(self, Path(directory))


if __name__ == "__main__":
    unittest.main()
