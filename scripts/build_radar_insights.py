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

try:
    from scripts.twitch_steam_admission import is_twitch_qualified
except ModuleNotFoundError:
    from twitch_steam_admission import is_twitch_qualified

TAIPEI = timezone(timedelta(hours=8))
POST_RELEASE_DAYS = 30
NINTENDO_PLATFORMS = {"NS": 130, "NS2": 508}
NINTENDO_GAME_TYPES = {"main_game", "standalone_expansion", "remake", "remaster", "expanded_game", "port"}


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
        # An explicit imported Twitch source is independent of Steam Followers.
        # Verify the complete admission and Steam row before taking that branch.
        instant = stamp(row.get("release_time_utc"))
        release = row.get("release_start")
        twitch_qualified = is_twitch_qualified(row)
        if (not twitch_qualified and (row.get("release_date_conflict") is True
                or (row.get("release_end") and row["release_end"] != release)
                or (row.get("release_timestamp_taipei_date") and row["release_timestamp_taipei_date"] != release)
                or (row.get("release_time_utc") is not None
                    and (not instant or instant.astimezone(TAIPEI).date().isoformat() != release)))):
            continue
        if (not twitch_qualified and count < 5000
                and not (count > 3000 and row.get("recent_source") in {"direct_release", "tracked_release"})):
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


def accepted_nintendo(catalog, now):
    """Validate public qualifications before changing optional Nintendo state.

    A broken or partial catalog must not deactivate previously accepted games.
    Content screening is performed by the publisher; this consumer checks its
    explicit result rather than inventing a second adult-keyword policy.
    """
    source = catalog.get("source") if isinstance(catalog, dict) else None
    instant = stamp(catalog.get("generated_at")) if isinstance(catalog, dict) else None
    window = catalog.get("window") if isinstance(catalog, dict) else None
    rows = catalog.get("games") if isinstance(catalog, dict) else None
    if (not isinstance(catalog, dict) or type(catalog.get("schema_version")) is not int
            or catalog.get("schema_version") != 1
            or not isinstance(source, dict) or source.get("provider") != "IGDB"
            or source.get("complete") is not True or type(source.get("hypes_threshold")) is not int
            or source.get("hypes_threshold") != 30 or source.get("platform_ids_verified") != [130, 508]
            or any(type(value) is not int for value in source["platform_ids_verified"])
            or not instant or instant > now
            or not isinstance(window, dict) or window.get("end_inclusive") is not False
            or window.get("time_zone") != "Asia/Taipei"
            or not day(window.get("start")) or not day(window.get("end"))
            or day(window["end"]) - day(window["start"]) != timedelta(days=365)
            or day(window["start"]) != instant.astimezone(TAIPEI).date()
            or not isinstance(rows, list)):
        raise ValueError("Complete Nintendo catalog with a valid source timestamp required")
    start, end = day(window["start"]), day(window["end"])
    result = {}
    for row in rows:
        if not isinstance(row, dict):
            raise ValueError("Qualified Nintendo public rows required")
        igdb_id, hypes = row.get("igdb_id"), row.get("hypes")
        key = f"igdb:{igdb_id}"
        if (not isinstance(igdb_id, int) or isinstance(igdb_id, bool) or igdb_id <= 0
                or row.get("id") != key or key in result
                or not isinstance(hypes, int) or isinstance(hypes, bool) or hypes < 30
                or row.get("hypes_status") != "available" or row.get("popularity_status") != "qualified"
                or row.get("calendar_eligible") is not True or row.get("sexual_content_screened") is not True
                or row.get("game_type") not in NINTENDO_GAME_TYPES
                or not isinstance(row.get("platforms"), list) or not row["platforms"]
                or not isinstance(row.get("releases"), list) or not row["releases"]):
            raise ValueError("Qualified, uniquely identified Nintendo public rows required")
        platforms = set()
        for platform in row["platforms"]:
            if (not isinstance(platform, dict) or platform.get("code") not in NINTENDO_PLATFORMS
                    or type(platform.get("id")) is not int
                    or platform.get("id") != NINTENDO_PLATFORMS[platform["code"]]
                    or isinstance(platform.get("id"), bool) or platform["code"] in platforms):
                raise ValueError("Native Nintendo platform identities required")
            platforms.add(platform["code"])
        releases = {}
        for release in row["releases"]:
            if (not isinstance(release, dict) or release.get("platform") not in platforms
                    or release.get("platform") in releases or release.get("precision") != "day"
                    or release.get("source") != "IGDB" or not day(release.get("date"))
                    or not start <= day(release["date"]) < end):
                raise ValueError("Exact, unique Nintendo platform release dates in the source window required")
            releases[release["platform"]] = release["date"]
        name = row.get("display_name") or row.get("name_zh_tw") or row.get("name_en")
        if not isinstance(name, str) or not name.strip():
            raise ValueError("Nintendo display name required")
        result[key] = {"igdb_id": igdb_id, "name": name, "releases": releases}
    return instant, result


def nintendo_event_time(instant, receipt, now):
    if (isinstance(receipt, dict) and type(receipt.get("schema_version")) is int
            and receipt.get("schema_version") == 1 and receipt.get("complete") is True
            and receipt.get("status") == "published"
            and stamp(receipt.get("generated_at")) == instant):
        published = stamp(receipt.get("published_at"))
        if published and instant <= published <= now:
            return published
    return instant


def merge_nintendo(state, catalog, now, receipt=None):
    if catalog is None:
        return
    instant, current = accepted_nintendo(catalog, now)
    previous_time = stamp(state.get("nintendo_source_at"))
    if previous_time and instant < previous_time:
        return  # A lagging checkout must not roll back the accepted state.
    digest = hashlib.sha256(json.dumps(current, sort_keys=True).encode()).hexdigest()
    if previous_time and instant == previous_time and state.get("nintendo_source_digest") not in {None, digest}:
        raise ValueError("Conflicting Nintendo catalogs share a source timestamp")
    at = nintendo_event_time(instant, receipt, now).astimezone(timezone.utc).isoformat().replace("+00:00", "Z")
    records = state.setdefault("nintendo_records", {})
    for record in records.values():
        record["active"] = False
    for key, row in current.items():
        prior = records.get(key)
        first = prior is None
        if first:
            prior = {"igdb_id": row["igdb_id"], "game_id": key, "first_seen_at": at,
                     "first_seen_basis": "source_catalog", "release_dates": {}}
            records[key] = prior
        # Remember previously seen dates while the game/platform is outside the
        # public window; returning qualifications are not new games.
        changes = {}
        for platform, release in row["releases"].items():
            old = prior["release_dates"].get(platform)
            kind = "added" if first else "platform_added" if old is None else "release_date" if old != release else None
            if kind:
                changes.setdefault((kind, release, old), []).append(platform)
        prior.update(name=row["name"], active=True, current_releases=row["releases"])
        prior["release_dates"].update(row["releases"])
        for (kind, release, old), platforms in changes.items():
            event = {"source": "nintendo", "igdb_id": row["igdb_id"], "game_id": key,
                     "platforms": sorted(platforms, key=lambda item: NINTENDO_PLATFORMS[item]),
                     "type": kind, "name": row["name"], "date": release, "at": at}
            if kind == "release_date":
                event["previous_date"] = old
            event["id"] = hashlib.sha256(json.dumps(event, sort_keys=True).encode()).hexdigest()[:20]
            state["events"].append(event)
    state["nintendo_source_at"] = instant.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")
    state["nintendo_source_digest"] = digest


def update(previous, catalog, *, observed_at, measurements=None, nintendo_catalog=None, nintendo_receipt=None):
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
    merge_nintendo(state, nintendo_catalog, now, nintendo_receipt)
    state["events"] = sorted({event["id"]: event for event in state["events"]
                              if stamp(event.get("at"))}.values(),
                             key=lambda event: stamp(event["at"]))[-250:]
    # Do not rewrite files merely because an identical catalog was polled again.
    if state != previous:
        state["updated_at"] = observed_at
    return state


def projections(state, today):
    records = state["records"]
    nintendo = state.get("nintendo_records", {})
    events = []
    for event in state["events"]:
        instant = stamp(event.get("at"))
        record = (nintendo.get(event.get("game_id"), {}) if event.get("source") == "nintendo"
                  else records.get(str(event.get("appid")), {}))
        if (record.get("active") and instant
                and 0 <= (today - instant.astimezone(TAIPEI).date()).days <= 14):
            events.append({**event, "name": record["name"]})
    events.sort(key=lambda event: stamp(event["at"]))
    activity = {"version": 1, "generated_at": state.get("updated_at"),
                "started_at": state["started_at"], "events": list(reversed(events))[:40]}
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
                   observed_at=observed, measurements=measurements,
                   nintendo_catalog=load(args.data_dir / "nintendo_upcoming.json"),
                   nintendo_receipt=load(args.data_dir / "nintendo_refresh_status.json"))
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
