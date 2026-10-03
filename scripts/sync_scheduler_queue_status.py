"""Keep the URL-only scheduler page's public queue fallback current.

Reads one published backend snapshot. Never queries Steam or changes the queue.
An unavailable, invalid or older source cannot replace an existing valid backup.
"""
from __future__ import annotations

import argparse
from datetime import date, datetime, timedelta, timezone
import json
import os
from pathlib import Path
import sys
import tempfile
from urllib.request import Request, urlopen

SOURCE_REPOSITORY = "danielet087/game-trend-radar-backend"
SOURCE_URL = (
    f"https://raw.githubusercontent.com/{SOURCE_REPOSITORY}/main/"
    "data/scheduler_queue_status.json"
)
DEFAULT_OUTPUT = Path(__file__).resolve().parents[1] / "data/scheduler_queue_status.json"
MAX_BYTES = 8 * 1024 * 1024
TAIPEI = timezone(timedelta(hours=8))


def timestamp(value):
    if not isinstance(value, str):
        raise ValueError("Expected a timezone-aware timestamp")
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        raise ValueError("Timestamp has no timezone")
    return parsed


def count(value):
    if type(value) is not int or value < 0:
        raise ValueError("Queue counts must be nonnegative integers")
    return value


def validate_snapshot(data):
    """Validate membership as well as totals; a zero count is never fabricated."""
    if not isinstance(data, dict) or type(data.get("schema_version")) is not int or data["schema_version"] != 1:
        raise ValueError("Unsupported queue snapshot schema")
    generated = timestamp(data.get("generated_at"))
    today = data.get("today_taipei")
    if not isinstance(today, str) or date.fromisoformat(today).isoformat() != today:
        raise ValueError("Invalid Taipei snapshot date")
    if today != generated.astimezone(TAIPEI).date().isoformat():
        raise ValueError("Snapshot date does not match its generation time")
    source = data.get("source")
    if not isinstance(source, dict) or source.get("repository") != SOURCE_REPOSITORY:
        raise ValueError("Unexpected queue source")
    summary, queue, parked = data.get("summary"), data.get("queue"), data.get("parked")
    if not isinstance(summary, dict) or not isinstance(queue, list) or not isinstance(parked, list):
        raise ValueError("Incomplete queue snapshot")
    normal, priority, paused, ready, total = (
        count(summary.get(key)) for key in (
            "normal_pending", "twitch_priority_pending", "parked", "ready_pending", "total_pending"
        )
    )
    if normal + priority != ready or ready + paused != total or len(queue) != ready or len(parked) != paused:
        raise ValueError("Queue totals do not match the complete membership")
    seen = set()
    for row in [*queue, *parked]:
        aid = row.get("appid") if isinstance(row, dict) else None
        if type(aid) is not int or not 0 < aid < 10**10 or aid in seen:
            raise ValueError("Invalid or duplicate Steam App ID")
        seen.add(aid)
        if not isinstance(row.get("name"), str):
            raise ValueError("Missing game name")
    if any(type(row.get("priority")) is not bool for row in queue):
        raise ValueError("Queue priority must be explicit")
    if sum(row["priority"] for row in queue) != priority:
        raise ValueError("Twitch priority count does not match membership")
    if any(row.get("position") != index for index, row in enumerate(queue, 1)):
        raise ValueError("Queue positions are not complete and ordered")
    for key in ("today_attempts", "today_successes", "today_429"):
        if key in summary:
            count(summary[key])
    cooldown = data.get("cooldown")
    if not isinstance(cooldown, dict) or type(cooldown.get("active")) is not bool:
        raise ValueError("Invalid cooldown state")
    for key in ("until", "next_eligible_slot"):
        if cooldown.get(key) is not None:
            timestamp(cooldown[key])
    events = data.get("events")
    if not isinstance(events, list):
        raise ValueError("Missing actual queue events")
    for event in events:
        if not isinstance(event, dict):
            raise ValueError("Invalid queue event")
        timestamp(event.get("at"))
    return data


def fetch_snapshot():
    request = Request(SOURCE_URL, headers={
        "Accept": "application/json",
        "User-Agent": "GameTrendRadar-QueueSnapshot/1.0",
        "Cache-Control": "no-cache",
    })
    with urlopen(request, timeout=20) as response:
        # urllib may follow redirects; only this fixed public snapshot is allowed.
        if response.geturl() != SOURCE_URL:
            raise ValueError("Unexpected snapshot redirect")
        body = response.read(MAX_BYTES + 1)
    if len(body) > MAX_BYTES:
        raise ValueError("Queue snapshot exceeds the size limit")
    return json.loads(body.decode("utf-8"))


def read_valid_backup(output):
    try:
        return validate_snapshot(json.loads(output.read_text(encoding="utf-8")))
    except (OSError, ValueError, TypeError):
        return None


def atomic_write(output, data):
    text = json.dumps(data, ensure_ascii=False, indent=2) + "\n"
    if output.exists() and output.read_bytes() == text.encode("utf-8"):
        return False
    output.parent.mkdir(parents=True, exist_ok=True)
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(
            "w", encoding="utf-8", dir=output.parent, prefix=".scheduler-queue-", suffix=".tmp", delete=False
        ) as handle:
            temporary = Path(handle.name)
            handle.write(text)
            handle.flush()
            os.fsync(handle.fileno())
        temporary.replace(output)
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)
    return True


def sync_snapshot(output=DEFAULT_OUTPUT, *, fetcher=fetch_snapshot):
    output = Path(output)
    backup = read_valid_backup(output)
    try:
        incoming = validate_snapshot(fetcher())
    except (OSError, ValueError, TypeError):
        if backup is None:
            raise ValueError("Source unavailable or invalid, and no valid queue backup exists") from None
        return "retained_after_error"
    if backup is not None and timestamp(incoming["generated_at"]) < timestamp(backup["generated_at"]):
        return "retained_newer"
    return "updated" if atomic_write(output, incoming) else "unchanged"


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    args = parser.parse_args()
    try:
        result = sync_snapshot(args.output)
    except (OSError, ValueError, TypeError):
        print("::error::Queue snapshot sync failed; existing file was not replaced.", file=sys.stderr)
        return 1
    if result == "retained_after_error":
        print("::warning::Queue source unavailable or invalid; retained the existing valid backup and its original timestamp.")
    elif result == "retained_newer":
        print("Queue source is older; retained the newer valid backup.")
    else:
        print(f"Public queue backup: {result}.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
