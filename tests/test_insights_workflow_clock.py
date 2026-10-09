"""Exercise the production publication shell across a simulated Taiwan midnight."""
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import textwrap
import unittest


ROOT = Path(__file__).resolve().parents[1]
FROZEN = "2026-10-08T15:59:59Z"
AFTER_MIDNIGHT = "2026-10-08T16:00:01Z"
OUTPUTS = ("insights-state.json", "activity.json", "growth.json", "scheduler_queue_status.json")


def publication_script():
    """Read the actual multiline shell step without adding a YAML dependency."""
    lines = (ROOT / ".github/workflows/radar-insights.yml").read_text().splitlines()
    start = lines.index("      - name: Derive current activity without calling Steam")
    run = next(index for index in range(start + 1, len(lines)) if lines[index] == "        run: |")
    end = next(index for index in range(run + 1, len(lines)) if lines[index].startswith("      - name:"))
    return textwrap.dedent("\n".join(lines[run + 1:end])) + "\n"


# Only Git, the system clock, and HTTP transport are replaced. The production
# shell and both real Python entry points execute from an isolated working copy.
TOOLS = r'''
import importlib.util
import json
import os
from pathlib import Path
import socket
import sys
from datetime import datetime, timezone

root = Path(os.environ["RADAR_WORKFLOW_TEST_ROOT"])
state_path = root / "tool-state.json"
state = json.loads(state_path.read_text())
tool, args = Path(sys.argv[0]).name, sys.argv[1:]
with (root / "calls.jsonl").open("a") as handle:
    handle.write(json.dumps([tool, *args]) + "\n")

def save():
    state_path.write_text(json.dumps(state))

def no_network(*args, **kwargs):
    raise AssertionError("Workflow acceptance must not open a network connection")
socket.socket.connect = no_network
socket.create_connection = no_network

if tool == "date":
    if args != ["-u", "+%Y-%m-%dT%H:%M:%SZ"]:
        raise AssertionError(args)
    print(state["clock"])
elif tool == "git":
    if args[0] == state.get("fail_command"):
        sys.exit(7)
    if args[0] == "reset":
        for path in (root / "data").glob("*.json"):
            path.unlink()
        for name, content in state["baseline"].items():
            (root / "data" / name).write_text(content)
    elif args[0] == "diff":
        current = {path.name: path.read_text() for path in (root / "data").glob("*.json")}
        sys.exit(0 if current == state["baseline"] else 1)
    elif args[0] == "commit":
        state["publications"].append({name: (root / "data" / name).read_text() for name in state["outputs"]})
        save()
    elif args[0] == "push":
        state["pushes"] += 1
        state["clock"] = "2026-10-08T16:00:01Z"
        save()
        sys.exit(0 if state["pushes"] > state["push_failures"] else 1)
    elif args[0] not in {"config", "fetch", "add"}:
        raise AssertionError(args)
elif tool == "python":
    script = root / args[0]
    sys.path.insert(0, str(script.parent))
    spec = importlib.util.spec_from_file_location("workflow_entry", script)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    sys.argv = args
    if script.name == "build_radar_insights.py":
        class Clock(datetime):
            @classmethod
            def now(cls, tz=None):
                value = datetime.fromisoformat(state["clock"].replace("Z", "+00:00"))
                return value.astimezone(tz) if tz is not None else value.replace(tzinfo=None)
        module.datetime = Clock
    elif script.name == "sync_scheduler_queue_status.py":
        class Response:
            def __enter__(self): return self
            def __exit__(self, *args): pass
            def geturl(self): return module.SOURCE_URL
            def read(self, limit):
                if limit != module.MAX_BYTES + 1:
                    raise AssertionError(limit)
                return json.dumps(state["queue"]).encode()
        def fetch(request, timeout):
            if request.full_url != module.SOURCE_URL or request.get_method() != "GET" or timeout != 20:
                raise AssertionError("Queue transport contract changed")
            return Response()
        module.urlopen = fetch
    else:
        raise AssertionError(script)
    module.main()
else:
    raise AssertionError(tool)
'''


class InsightsWorkflowClockTests(unittest.TestCase):
    def run_workflow(self, *, push_failures=1, fail_command=None, unchanged=False):
        with tempfile.TemporaryDirectory(prefix="radar-insights-workflow-") as directory:
            root = Path(directory)
            (root / "data").mkdir()
            (root / "scripts").mkdir()
            (root / "bin").mkdir()
            for name in ("build_radar_insights.py", "sync_scheduler_queue_status.py", "twitch_steam_admission.py"):
                shutil.copyfile(ROOT / "scripts" / name, root / "scripts" / name)
            catalog = {"version": 3, "count": 2, "games": [
                {"appid": aid, "name": f"Game {aid}", "followers": 6000,
                 "release_start": "2026-10-09", "release_precision": "day",
                 "follower_checked_at": "2026-10-08T15:50:00Z"}
                for aid in (1, 2)]}
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
            environment = {**os.environ, "PYTHONDONTWRITEBYTECODE": "1", "PYTHONPATH": "",
                           "RADAR_WORKFLOW_TEST_ROOT": str(root), "GITHUB_OUTPUT": str(root / "github-output"),
                           "PATH": str(root / "bin") + os.pathsep + os.environ["PATH"]}
            if unchanged:
                result = subprocess.run([sys.executable, "-B", str(root / "scripts/build_radar_insights.py"),
                                         "--observed-at", FROZEN], cwd=root, env=environment,
                                        capture_output=True, text=True, timeout=15)
                self.assertEqual(result.returncode, 0, result.stderr)
                (root / "data/scheduler_queue_status.json").write_text(json.dumps(queue, ensure_ascii=False, indent=2) + "\n")
            initial = {path.name: path.read_text() for path in (root / "data").glob("*.json")}
            state = {"clock": FROZEN, "push_failures": push_failures, "pushes": 0, "publications": [],
                     "fail_command": fail_command, "baseline": initial, "outputs": OUTPUTS, "queue": queue}
            (root / "tool-state.json").write_text(json.dumps(state))
            (root / "github-output").write_text("")
            helper = root / "bin/tools.py"
            helper.write_text("#!" + sys.executable + "\n" + textwrap.dedent(TOOLS))
            helper.chmod(0o755)
            for name in ("git", "date", "python"):
                (root / "bin" / name).symlink_to(helper)
            result = subprocess.run(["bash", "-c", publication_script()], cwd=root, env=environment,
                                    capture_output=True, text=True, timeout=30)
            final = json.loads((root / "tool-state.json").read_text())
            calls = [json.loads(line) for line in (root / "calls.jsonl").read_text().splitlines()]
            output = (root / "github-output").read_text()
            return result, final, calls, output

    def assert_publication_clock(self, state, attempts):
        self.assertEqual(len(state["publications"]), attempts)
        self.assertEqual(state["clock"], AFTER_MIDNIGHT)
        first = state["publications"][0]
        self.assertTrue(all(publication == first for publication in state["publications"]))
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

    def assert_call_order(self, calls, attempts, *, commits=True):
        prefix = [["git", "config", "user.name", "github-actions[bot]"],
                  ["git", "config", "user.email", "41898282+github-actions[bot]@users.noreply.github.com"],
                  ["date", "-u", "+%Y-%m-%dT%H:%M:%SZ"]]
        iteration = [["git", "fetch", "origin", "main"], ["git", "reset", "--hard", "origin/main"],
                     ["python", "scripts/build_radar_insights.py", "--observed-at", FROZEN],
                     ["python", "scripts/sync_scheduler_queue_status.py"],
                     ["git", "add", *["data/" + name for name in OUTPUTS]],
                     ["git", "diff", "--cached", "--quiet"]]
        if commits:
            iteration += [["git", "commit", "-m", "data: record public activity, growth and queue status"],
                          ["git", "push", "origin", "HEAD:main"]]
        self.assertEqual(calls, prefix + iteration * attempts)

    def test_retry_across_taiwan_midnight_keeps_one_clock_and_succeeds(self):
        result, state, calls, output = self.run_workflow(push_failures=1)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(output, "changed=true\n")
        self.assertEqual(state["pushes"], 2)
        self.assert_publication_clock(state, 2)
        self.assert_call_order(calls, 2)

    def test_five_failed_pushes_keep_clock_and_fail_without_success_receipt(self):
        result, state, calls, output = self.run_workflow(push_failures=5)
        self.assertEqual(result.returncode, 1, result.stderr)
        self.assertIn("Concurrent publication did not settle", result.stdout)
        self.assertEqual(output, "")
        self.assertEqual(state["pushes"], 5)
        self.assert_publication_clock(state, 5)
        self.assert_call_order(calls, 5)

    def test_identical_projection_still_exits_without_commit_or_push(self):
        result, state, calls, output = self.run_workflow(unchanged=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(output, "changed=false\n")
        self.assertEqual(state["pushes"], 0)
        self.assertEqual(state["publications"], [])
        self.assert_call_order(calls, 1, commits=False)

    def test_upstream_fetch_failure_still_stops_before_projection_or_push(self):
        result, state, calls, output = self.run_workflow(fail_command="fetch")
        self.assertEqual(result.returncode, 7, result.stderr)
        self.assertEqual(output, "")
        self.assertEqual(state["pushes"], 0)
        self.assertEqual(state["publications"], [])
        self.assertEqual(calls[-1], ["git", "fetch", "origin", "main"])
        self.assertEqual(sum(call[0] == "date" for call in calls), 1)
        self.assertFalse(any(call[0] == "python" for call in calls))


if __name__ == "__main__":
    unittest.main()
