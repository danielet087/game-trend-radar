"""Derive activity and dated Followers history from accepted public records only.

No Steam requests. Measurement dates come from the source, never the build clock.
Run after catalog publication, or merge an official collector's measurements.
"""
from __future__ import annotations

import argparse
from copy import deepcopy
from datetime import date, datetime, timedelta, timezone
import hashlib
import json
from pathlib import Path

TAIPEI = timezone(timedelta(hours=8))
POST_RELEASE_DAYS = 30


def stamp(value):
    try:
        result = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        return result if result.tzinfo else None
    except (ValueError, TypeError):
        return None


def day(value):
    try:
        result = date.fromisoformat(value)
        return result if result.isoformat() == value else None
    except (ValueError, TypeError):
        return None


def accepted(rows):
    result = {}
    for row in rows:
        aid, count = row.get("appid"), row.get("followers")
        if (not isinstance(aid, int) or isinstance(aid, bool) or aid <= 0
                or not isinstance(count, int) or isinstance(count, bool) or count < 0
                or not day(row.get("release_start"))
                or row.get("release_precision", "day") != "day"):
            continue
        if count < 5000 and not (count > 3000 and row.get("recent_source") in {"direct_release", "tracked_release"}):
            continue
        result[str(aid)] = row
    return result


def merge_measurement(record, observation, now):
    at = stamp(observation.get("at") or observation.get("follower_checked_at"))
    count = observation.get("followers")
    release = day(record["release_date"])
    if (not at or at > now + timedelta(minutes=5) or not isinstance(count, int)
            or isinstance(count, bool) or count < 0
            or at.astimezone(TAIPEI).date() > release + timedelta(days=POST_RELEASE_DAYS)):
        return
    normalized = {"at": at.astimezone(timezone.utc).isoformat().replace("+00:00", "Z"),
                  "followers": count, "source": "steam_community"}
    by_day = {}
    for point in [*record.get("history", []), normalized]:
        point_time = stamp(point.get("at"))
        if not point_time:
            continue
        key = point_time.astimezone(TAIPEI).date().isoformat()
        if key not in by_day or point_time > stamp(by_day[key]["at"]):
            by_day[key] = point
    record["history"] = sorted(by_day.values(), key=lambda item: stamp(item["at"]))[-400:]


def update(previous, catalog, *, observed_at, measurements=None):
    now = stamp(observed_at)
    if not now:
        raise ValueError("Timezone-aware observation time required")
    rows = catalog.get("games")
    if (not isinstance(rows, list) or catalog.get("count", len(rows)) != len(rows)
            or len({row.get("appid") for row in rows}) != len(rows)):
        raise ValueError("Complete, deduplicated catalog required")
    state = deepcopy(previous) if previous else {
        "version": 1, "started_at": observed_at, "records": {}, "events": []}
    if state.get("version") != 1:
        raise ValueError("Unsupported insight state version")
    baseline = not previous
    current = accepted(rows)
    for record in state["records"].values():
        record["active"] = False
    for aid, row in current.items():
        name = row.get("display_name") or row.get("name_zh_tw_traditional") or row.get("name") or f"App {aid}"
        prior = state["records"].get(aid)
        event = None
        if not prior:
            prior = {"appid": int(aid), "first_seen_at": observed_at,
                     "first_seen_basis": "baseline" if baseline else "observed", "history": []}
            state["records"][aid] = prior
            if not baseline:
                event = {"type": "added"}
        elif prior["release_date"] != row["release_start"]:
            event = {"type": "release_date", "previous_date": prior["release_date"]}
        prior.update(name=name, release_date=row["release_start"], active=True)
        if event:
            event.update(appid=int(aid), name=name, date=row["release_start"], at=observed_at)
            event["id"] = hashlib.sha256(json.dumps(event, sort_keys=True).encode()).hexdigest()[:20]
            state["events"].append(event)
        merge_measurement(prior, row, now)
    for observation in measurements or []:
        aid = str(observation.get("appid"))
        if aid in current and observation.get("source") == "steam_community":
            merge_measurement(state["records"][aid], observation, now)
    state["events"] = sorted({event["id"]: event for event in state["events"]}.values(),
                             key=lambda event: event["at"])[-250:]
    # Do not rewrite files merely because an identical catalog was polled again.
    if state != previous:
        state["updated_at"] = observed_at
    return state


def projections(state, today):
    records = state["records"]
    events = [event for event in state["events"]
              if records.get(str(event["appid"]), {}).get("active")
              and (today - stamp(event["at"]).astimezone(TAIPEI).date()).days <= 14]
    activity = {"version": 1, "generated_at": state.get("updated_at"),
                "started_at": state["started_at"], "events": [
                    {**event, "name": records[str(event["appid"])]["name"]}
                    for event in list(reversed(events))[:40]]}
    games = []
    for aid, row in records.items():
        if not row.get("active"):
            continue
        until = day(row["release_date"]) + timedelta(days=POST_RELEASE_DAYS)
        games.append({"appid": int(aid), "release_date": row["release_date"],
                      "track_until": until.isoformat(), "tracking": today <= until,
                      "history": row.get("history", [])[-100:]})
    growth = {"version": 1, "generated_at": state.get("updated_at"), "as_of": today.isoformat(),
              "started_at": state["started_at"], "post_release_days": POST_RELEASE_DAYS,
              "collection": state.get("collection"),
              "games": sorted(games, key=lambda row: row["appid"])}
    return activity, growth


def load(path, default=None):
    return json.loads(path.read_text(encoding="utf-8")) if path.exists() else default


def write(path, data):
    body = json.dumps(data, ensure_ascii=False, separators=(",", ":")) + "\n"
    if not path.exists() or path.read_text(encoding="utf-8") != body:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(body, encoding="utf-8")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data-dir", type=Path, default=Path("data"))
    parser.add_argument("--measurements", type=Path)
    args = parser.parse_args()
    now = datetime.now(timezone.utc)
    observed = now.replace(microsecond=0).isoformat().replace("+00:00", "Z")
    path = args.data_dir / "insights-state.json"
    run = load(args.measurements, {}) if args.measurements else {}
    measurements = run.get("measurements", [])
    state = update(load(path), load(args.data_dir / "catalog.json"),
                   observed_at=observed, measurements=measurements)
    if args.measurements:
        state["collection"] = {"at": run.get("generated_at", observed),
                               "status": run.get("reason", "interrupted"),
                               "measurements": len(measurements)}
    activity, growth = projections(state, now.astimezone(TAIPEI).date())
    write(path, state)
    write(args.data_dir / "activity.json", activity)
    write(args.data_dir / "growth.json", growth)
    print(f"INSIGHTS records={len(growth['games'])} events={len(activity['events'])} measurements={len(measurements)}")


if __name__ == "__main__":
    main()
