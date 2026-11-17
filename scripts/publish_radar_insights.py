"""Build public read-only projections from the authoritative database state."""
from __future__ import annotations

from copy import deepcopy
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import time

from radar_core.publication import SubprocessGitRepository, publish_with_retry, snapshot_revision
from radar_core.storage import primary
from radar_core.storage.sql import StorageError
from scripts import sync_scheduler_queue_status as queue

PATHS = ("data/insights-state.json", "data/activity.json", "data/growth.json",
         "data/scheduler_queue_status.json", "data/twitch-launch-curves.json")
# Heavy Steam jobs can hold the storage lease past one bounded wait. A busy
# lease fails before any write, so the whole publication can simply run again.
LEASE_RETRIES = 2
LEASE_RETRY_SECONDS = 90
# The per-game series also live in this database-only source; once the views
# flag moves them out of the frontend's Git history the launch curves are built
# from that copy (a stale Git copy is then ignored).
VIEWS_REPOSITORY, VIEWS_BRANCH = "danielet087/game-trend-radar", "twitch-views"
SERIES_PATH = "data/twitch_series/"
VIEWS_FLAG = "data/publication/twitch_views.json"


def _launch_curves(current):
    """Refresh the launch curves; preserve the existing projection on failure."""
    builder = [sys.executable, "-B", str(current / "scripts/build_twitch_launch_curves.py")]
    try:
        if not (current / VIEWS_FLAG).is_file() and (current / SERIES_PATH / "index.json").is_file():
            subprocess.run([*builder, "--data-dir", str(current / "data")],
                           check=True, timeout=120, capture_output=True, text=True)
            return
        if not primary.enabled():
            return
        _, files = primary.read_files(VIEWS_REPOSITORY, paths=(SERIES_PATH,), branch=VIEWS_BRANCH)
        if SERIES_PATH + "index.json" not in files:
            return
        with tempfile.TemporaryDirectory(prefix="radar-launch-curves.") as scratch:
            data = Path(scratch) / "data"
            for path, raw in files.items():
                target = Path(scratch) / path
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_bytes(raw)
            shutil.copyfile(current / "data/catalog.json", data / "catalog.json")
            subprocess.run([*builder, "--data-dir", str(data)],
                           check=True, timeout=120, capture_output=True, text=True)
            shutil.copyfile(data / "twitch-launch-curves.json", current / "data/twitch-launch-curves.json")
    except (subprocess.CalledProcessError, subprocess.TimeoutExpired, StorageError, OSError):
        print("Launch curves could not be refreshed; preserving the existing projection.", file=sys.stderr)


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
        _launch_curves(current)
        if frozen is not None:
            queue.sync_snapshot(current / "data/scheduler_queue_status.json",
                                fetcher=lambda: deepcopy(frozen))
        elif queue.read_valid_backup(current / "data/scheduler_queue_status.json") is None:
            raise ValueError("No valid queue snapshot is available")

    return publish_with_retry(repository, apply, paths=PATHS,
                              message="data: project database activity, growth and queue status",
                              input_revision=input_revision, payload_revision=payload_revision,
                              max_attempts=5)


def publish_when_lease_frees(root, queue_snapshot, *, sleep=time.sleep):
    for attempt in range(LEASE_RETRIES + 1):
        try:
            return publish(root, queue_snapshot=queue_snapshot)
        except StorageError as error:
            if error.code != "LEASE_BUSY" or attempt == LEASE_RETRIES:
                raise
            print(f"Storage lease is busy; retrying in {LEASE_RETRY_SECONDS} seconds.", file=sys.stderr)
            sleep(LEASE_RETRY_SECONDS)


def main():
    receipt = publish_when_lease_frees(Path.cwd(), frozen_queue())
    print(json.dumps(receipt.to_dict(), sort_keys=True))
    if os.environ.get("GITHUB_OUTPUT"):
        with open(os.environ["GITHUB_OUTPUT"], "a", encoding="utf-8") as stream:
            stream.write("changed=" + str(receipt.changed).lower() + "\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
