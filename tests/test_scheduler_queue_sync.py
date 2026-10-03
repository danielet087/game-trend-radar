import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from urllib.error import URLError

spec = importlib.util.spec_from_file_location(
    "queue_sync", Path(__file__).parents[1] / "scripts/sync_scheduler_queue_status.py"
)
M = importlib.util.module_from_spec(spec)
spec.loader.exec_module(M)


def snapshot():
    return {
        "schema_version": 1, "generated_at": "2026-10-03T07:47:37Z", "today_taipei": "2026-10-03",
        "source": {"repository": M.SOURCE_REPOSITORY},
        "summary": {"normal_pending": 1, "twitch_priority_pending": 1, "parked": 1,
                    "ready_pending": 2, "total_pending": 3},
        "queue": [{"position": 1, "appid": 3219630, "name": "Halloween: The Game", "priority": True},
                  {"position": 2, "appid": 5158320, "name": "Deer Hunting", "priority": False}],
        "parked": [{"appid": 4435490, "name": "Call of Duty"}],
        "cooldown": {"active": True, "until": "2026-10-03T08:01:49Z",
                     "next_eligible_slot": "2026-10-03T09:00:00Z"},
        "events": [{"at": "2026-10-03T06:01:49Z", "status": "rate_limited", "http": 429}],
    }


class QueueSyncTests(unittest.TestCase):
    def test_actual_membership_and_priority_must_match_dynamic_totals(self):
        self.assertEqual(M.validate_snapshot(snapshot())["summary"]["total_pending"], 3)
        for change in (
            lambda data: data["summary"].update(total_pending=77),
            lambda data: data["queue"][1].update(appid=3219630),
            lambda data: data["queue"][0].update(priority=False),
            lambda data: data["queue"][1].update(position=3),
            lambda data: data["summary"].update(parked=True),
            lambda data: data.update(generated_at="2026-10-03T07:47:37"),
        ):
            data = snapshot()
            change(data)
            with self.subTest(data=data), self.assertRaises(ValueError):
                M.validate_snapshot(data)

    def test_network_or_invalid_source_keeps_backup_bytes_and_timestamp(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / "queue.json"
            original = json.dumps(snapshot(), ensure_ascii=False).encode("utf-8")
            output.write_bytes(original)
            def unavailable():
                raise URLError("test offline")
            for fetcher in (unavailable, lambda: {"schema_version": 1}):
                self.assertEqual(M.sync_snapshot(output, fetcher=fetcher), "retained_after_error")
                self.assertEqual(output.read_bytes(), original)

    def test_missing_valid_backup_is_an_error_instead_of_a_fake_empty_queue(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / "queue.json"
            for current in (None, '{"schema_version":1,"queue":[]}'):
                if current is not None:
                    output.write_text(current)
                with self.assertRaises(ValueError):
                    M.sync_snapshot(output, fetcher=lambda: {})
                self.assertEqual(output.read_text() if output.exists() else None, current)

    def test_newer_snapshot_is_written_atomically_without_relabeling_source_time(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / "queue.json"
            data = snapshot()
            self.assertEqual(M.sync_snapshot(output, fetcher=lambda: data), "updated")
            self.assertEqual(json.loads(output.read_text()), data)
            self.assertEqual(M.sync_snapshot(output, fetcher=lambda: data), "unchanged")
            self.assertEqual(list(Path(directory).glob("*.tmp")), [])

    def test_delayed_older_source_cannot_roll_back_a_newer_remote_backup(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / "queue.json"
            newer = snapshot()
            newer["generated_at"] = "2026-10-03T08:00:00Z"
            output.write_text(json.dumps(newer))
            before = output.read_bytes()
            self.assertEqual(M.sync_snapshot(output, fetcher=snapshot), "retained_newer")
            self.assertEqual(output.read_bytes(), before)


if __name__ == "__main__":
    unittest.main()
