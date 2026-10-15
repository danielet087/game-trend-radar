"""Exercise the workflow's production Python publisher across Taiwan midnight."""
from contextlib import redirect_stdout
from datetime import datetime
import io
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

from radar_core.publication import GitOperationError, PublicationError, SubprocessGitRepository
from scripts import publish_radar_insights as publication

ROOT = Path(__file__).resolve().parents[1]
FROZEN = "2026-10-08T15:59:59Z"
AFTER_MIDNIGHT = "2026-10-08T16:00:01Z"
OUTPUTS = ("insights-state.json", "activity.json", "growth.json", "scheduler_queue_status.json")


def git(root, *args):
    return subprocess.run(["git", *args], cwd=root, check=True, capture_output=True,
                          text=True).stdout.strip()


class InsightsWorkflowClockTests(unittest.TestCase):
    def run_workflow(self, *, push_failures=1, fail_fetch=False, unchanged=False):
        with tempfile.TemporaryDirectory(prefix="radar-insights-workflow-") as directory:
            parent = Path(directory)
            root, remote = parent / "checkout", parent / "remote.git"
            (root / "data").mkdir(parents=True)
            (root / "scripts").mkdir()
            for name in ("build_radar_insights.py", "twitch_steam_admission.py"):
                shutil.copyfile(ROOT / "scripts" / name, root / "scripts" / name)
            catalog = {"version": 3, "count": 2, "games": [
                {"appid": aid, "name": f"Game {aid}", "followers": 6000,
                 "release_start": "2026-10-09", "release_precision": "day",
                 "follower_checked_at": "2026-10-08T15:50:00Z"} for aid in (1, 2)]}
            previous = {"version": 1, "started_at": "2026-10-08T12:00:00Z", "updated_at": "2026-10-08T12:00:00Z",
                        "records": {"1": {"appid": 1, "name": "Game 1", "release_date": "2026-10-09",
                        "first_seen_at": "2026-10-08T12:00:00Z", "first_seen_basis": "baseline", "active": True,
                        "history": [{"at": "2026-10-08T12:00:00Z", "followers": 5500, "source": "steam_community"}]}},
                        "events": []}
            queue = {"schema_version": 1, "generated_at": "2026-10-08T15:50:00Z", "today_taipei": "2026-10-08",
                     "source": {"repository": "danielet087/game-trend-radar-backend"},
                     "summary": {"normal_pending": 0, "twitch_priority_pending": 0, "parked": 0,
                                 "ready_pending": 0, "total_pending": 0},
                     "queue": [], "parked": [], "events": [],
                     "cooldown": {"active": False, "until": None, "next_eligible_slot": None}}
            (root / "data/catalog.json").write_text(json.dumps(catalog))
            (root / "data/insights-state.json").write_text(json.dumps(previous))
            if unchanged:
                subprocess.run([sys.executable, "-B", str(root / "scripts/build_radar_insights.py"),
                                "--data-dir", str(root / "data"), "--observed-at", FROZEN],
                               check=True, capture_output=True, timeout=15)
                publication.queue.sync_snapshot(root / "data/scheduler_queue_status.json", fetcher=lambda: queue)
            git(root, "init", "-b", "main")
            git(root, "config", "user.name", "Test")
            git(root, "config", "user.email", "test@example.com")
            git(root, "add", ".")
            git(root, "commit", "-m", "initial")
            git(parent, "clone", "--bare", str(root), str(remote))
            git(root, "remote", "add", "origin", str(remote))
            original_revision = git(remote, "rev-parse", "main")
            state = {"clock": FROZEN, "pushes": 0, "publications": [], "builder_clocks": [],
                     "queue_reads": 0, "clock_reads": 0}
            output_path = parent / "github-output"
            output_path.write_text("")
            stream = io.StringIO()

            class Clock(datetime):
                @classmethod
                def now(cls, tz=None):
                    state["clock_reads"] += 1
                    value = datetime.fromisoformat(state["clock"].replace("Z", "+00:00"))
                    return value.astimezone(tz) if tz is not None else value.replace(tzinfo=None)

            class Repository(SubprocessGitRepository):
                def _run(self, *args, **kwargs):
                    if fail_fetch and args[0] == "fetch":
                        raise GitOperationError("Public snapshot fetch failed")
                    return super()._run(*args, **kwargs)

                def push(self, revision=None):
                    state["pushes"] += 1
                    state["publications"].append({name: (root / "data" / name).read_text() for name in OUTPUTS})
                    state["clock"] = AFTER_MIDNIGHT
                    return False if state["pushes"] <= push_failures else super().push(revision)

            def queue_read():
                state["queue_reads"] += 1
                return queue

            real_run = subprocess.run
            def run(argv, **kwargs):
                if any(str(arg).endswith("build_radar_insights.py") for arg in argv):
                    state["builder_clocks"].append(argv[argv.index("--observed-at") + 1])
                return real_run(argv, **kwargs)

            error = None
            with patch.dict(os.environ, {"RADAR_DATABASE_PRIMARY": "0", "GITHUB_OUTPUT": str(output_path)}):
                repository = Repository(root, disposable_checkout=True)
                with patch.object(publication, "SubprocessGitRepository", return_value=repository), \
                        patch.object(publication.Path, "cwd", return_value=root), \
                        patch.object(publication, "datetime", Clock), \
                        patch.object(publication.queue, "fetch_snapshot", side_effect=queue_read), \
                        patch.object(subprocess, "run", side_effect=run), redirect_stdout(stream):
                    try:
                        publication.main()
                    except PublicationError as failure:
                        error = failure
            state["original_revision"] = original_revision
            state["remote_revision"] = git(remote, "rev-parse", "main")
            return error, state, stream.getvalue(), output_path.read_text()

    def assert_publication_clock(self, state, attempts):
        self.assertEqual(len(state["publications"]), attempts)
        self.assertEqual(state["clock"], AFTER_MIDNIGHT)
        self.assertEqual(state["clock_reads"], 1)
        self.assertEqual(state["queue_reads"], 1)
        self.assertEqual(state["builder_clocks"], ["2026-10-08T15:59:59+00:00"] * attempts)
        first = state["publications"][0]
        self.assertTrue(all(snapshot == first for snapshot in state["publications"]))
        record, activity, growth, queue = (json.loads(first[name]) for name in OUTPUTS)
        self.assertEqual(record["updated_at"], FROZEN)
        self.assertEqual(record["records"]["2"]["first_seen_at"], FROZEN)
        self.assertEqual(activity["generated_at"], FROZEN)
        self.assertEqual(activity["events"][0]["at"], FROZEN)
        self.assertEqual(activity["events"][0]["type"], "added")
        self.assertEqual(growth["generated_at"], FROZEN)
        self.assertEqual(growth["as_of"], "2026-10-08")
        self.assertEqual({row["release_date"] for row in growth["games"]}, {"2026-10-09"})
        for row in growth["games"]:
            self.assertEqual(row["history"], [{"at": "2026-10-08T15:50:00Z", "followers": 6000, "source": "steam_community"}])
        self.assertEqual(queue["generated_at"], "2026-10-08T15:50:00Z")

    def test_workflow_invokes_the_production_module(self):
        workflow = (ROOT / ".github/workflows/radar-insights.yml").read_text()
        self.assertIn("python -m scripts.publish_radar_insights", workflow)

    def test_retry_across_taiwan_midnight_keeps_one_clock_and_succeeds(self):
        error, state, receipt, output = self.run_workflow(push_failures=1)
        self.assertIsNone(error)
        self.assertEqual(output, "changed=true\n")
        self.assertEqual(state["pushes"], 2)
        self.assertEqual(json.loads(receipt)["published_revision"], state["remote_revision"])
        self.assert_publication_clock(state, 2)

    def test_five_failed_pushes_keep_clock_and_fail_without_success_receipt(self):
        error, state, receipt, output = self.run_workflow(push_failures=5)
        self.assertIsInstance(error, PublicationError)
        self.assertEqual((receipt, output), ("", ""))
        self.assertEqual(state["pushes"], 5)
        self.assertEqual(state["remote_revision"], state["original_revision"])
        self.assert_publication_clock(state, 5)

    def test_identical_projection_requires_acknowledged_push_without_creating_a_commit(self):
        error, state, receipt, output = self.run_workflow(push_failures=0, unchanged=True)
        self.assertIsNone(error)
        self.assertEqual(output, "changed=false\n")
        self.assertEqual(state["pushes"], 1)
        self.assertEqual(state["remote_revision"], state["original_revision"])
        self.assertEqual(json.loads(receipt)["published_revision"], state["original_revision"])
        self.assert_publication_clock(state, 1)

    def test_upstream_fetch_failure_stops_before_projection_or_push(self):
        error, state, receipt, output = self.run_workflow(fail_fetch=True)
        self.assertIsInstance(error, GitOperationError)
        self.assertEqual((receipt, output), ("", ""))
        self.assertEqual(state["pushes"], 0)
        self.assertEqual(state["builder_clocks"], [])
        self.assertEqual(state["remote_revision"], state["original_revision"])


if __name__ == "__main__":
    unittest.main()
