"""Build public read-only projections from the authoritative database state."""
from __future__ import annotations

from copy import deepcopy
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import subprocess
import sys

from radar_core.publication import SubprocessGitRepository, publish_with_retry, snapshot_revision
from radar_core.storage import primary
from scripts import sync_scheduler_queue_status as queue

PATHS = ("data/insights-state.json", "data/activity.json", "data/growth.json",
         "data/scheduler_queue_status.json")


def frozen_queue():
    if primary.enabled():
        # A primary read error stops the job before projection. It cannot be
        # mistaken for a missing queue or replaced with the Git backup.
        value = primary.read_json(queue.SOURCE_REPOSITORY, "data/scheduler_queue_status.json")
        return queue.validate_snapshot(value)
    try:
        return queue.validate_snapshot(queue.fetch_snapshot())
    except (OSError, ValueError, TypeError):
        return None


def publish(root, *, observed_at=None, repository=None, queue_snapshot=None):
    root = Path(root).resolve()
    clock = observed_at or datetime.now(timezone.utc).replace(microsecond=0)
    if clock.tzinfo is None or clock.utcoffset() is None:
        raise ValueError("An aware observation clock is required")
    observation = clock.astimezone(timezone.utc).isoformat()
    frozen = deepcopy(queue_snapshot)
    payload_revision = snapshot_revision({"observed_at": observation, "queue": frozen})
    repository = repository or SubprocessGitRepository(root, disposable_checkout=True)
    input_revision = repository.head_revision()

    def apply(current):
        subprocess.run([sys.executable, "-B", str(current / "scripts/build_radar_insights.py"),
                        "--data-dir", str(current / "data"), "--observed-at", observation],
                       check=True, timeout=120, capture_output=True, text=True)
        if frozen is not None:
            queue.sync_snapshot(current / "data/scheduler_queue_status.json",
                                fetcher=lambda: deepcopy(frozen))
        elif queue.read_valid_backup(current / "data/scheduler_queue_status.json") is None:
            raise ValueError("No valid queue snapshot is available")

    return publish_with_retry(repository, apply, paths=PATHS,
                              message="data: project database activity, growth and queue status",
                              input_revision=input_revision, payload_revision=payload_revision,
                              max_attempts=5)


def main():
    receipt = publish(Path.cwd(), queue_snapshot=frozen_queue())
    print(json.dumps(receipt.to_dict(), sort_keys=True))
    if os.environ.get("GITHUB_OUTPUT"):
        with open(os.environ["GITHUB_OUTPUT"], "a", encoding="utf-8") as stream:
            stream.write("changed=" + str(receipt.changed).lower() + "\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
