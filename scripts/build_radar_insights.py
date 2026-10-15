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
import re
from urllib.parse import unquote, urlsplit

try:
    from scripts.twitch_steam_admission import is_twitch_qualified
except ModuleNotFoundError:
    from twitch_steam_admission import is_twitch_qualified

TAIPEI = timezone(timedelta(hours=8))
POST_RELEASE_DAYS = 30
NINTENDO_PLATFORMS = {"NS": 130, "NS2": 508}
IGDB_PLATFORMS = {**NINTENDO_PLATFORMS, "PS5": 167}
NINTENDO_GAME_TYPES = {"main_game", "standalone_expansion", "remake", "remaster", "expanded_game", "port"}
NINTENDO_OFFICIAL_DATE_DOMAINS = {"nintendo.com", "nintendo.com.hk", "nintendo.co.jp",
                                  "sega.com", "konami.com", "playtombraider.com"}
PS5_PRODUCT_ID = r"[A-Z]{2}[0-9]{4}-[A-Z0-9]{9}_[A-Z0-9]{2}-[A-Z0-9]{16}"
ACTIVITY_REASONS = {
    "steam_daily_search", "twitch_rankings", "igdb_update",
    "steam_official_verification", "steam_metadata_refresh", "steam_catalog_sync",
    "steam_recent_release", "legacy_unrecorded",
}


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
        if (not twitch_qualified and (type(count) is not int or count < 0 or (count < 5000
                and not (count > 3000 and row.get("recent_source") in {"direct_release", "tracked_release"})))):
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


def official_nintendo_date_url(value, platform=None):
    if not isinstance(value, str):
        return False
    try:
        url = urlsplit(value)
        if platform == "PS5":
            return bool(ps5_taiwan_official_url(value))
        domains = NINTENDO_OFFICIAL_DATE_DOMAINS
        return (url.scheme == "https" and not url.username and not url.password and url.port is None
                and bool(url.hostname) and any(url.hostname == host or url.hostname.endswith("." + host)
                                              for host in domains))
    except ValueError:
        return False


def ps5_taiwan_official_url(value):
    """Return a Taiwan Sony product identity; generic or other-region pages are not proof."""
    if not isinstance(value, str) or not 0 < len(value) <= 2000:
        return None
    try:
        url = urlsplit(value)
        if (url.scheme != "https" or url.username or url.password or url.port is not None
                or url.query or url.fragment):
            return None
        if url.hostname == "store.playstation.com":
            match = re.fullmatch(r"/(?:zh-hant-tw|en-tw)/(?:product/(" + PS5_PRODUCT_ID
                                 + r")|concept/([1-9][0-9]{0,11}))/?", url.path)
            return {"product_id": match[1], "concept_id": match[2]} if match else None
        if url.hostname == "www.playstation.com" and re.fullmatch(
                r"/(?:zh-hant-tw|en-tw)/games/[a-z0-9-]+/?", url.path):
            return {"product_id": None, "concept_id": None}
        return None
    except ValueError:
        return None


def hong_kong_official_nintendo_date_url(value):
    if not isinstance(value, str) or not 0 < len(value) <= 2000:
        return False
    try:
        url = urlsplit(value)
        decoded_path = unquote(url.path)
        if (url.scheme != "https" or url.username or url.password or url.port is not None
                or url.query or url.fragment or "\\" in decoded_path
                or any(part in {".", ".."} for part in decoded_path.split("/"))):
            return False
        return ((url.hostname in {"nintendo.com.hk", "www.nintendo.com.hk", "store.nintendo.com.hk"}
                 and url.path not in {"", "/", "/index.html", "/index.htm"})
                or (url.hostname == "www.nintendo.com" and url.path.startswith("/hk/")
                    and url.path[len("/hk/"):] not in {"", "index.html", "index.htm"}))
    except ValueError:
        return False


def accepted_nintendo_release_source(release):
    """Validate a displayed Taipei date; IGDB timestamps are not unlock-time proof."""
    source, status = release.get("source"), release.get("timezone_status")
    if status is None:
        # Previously published IGDB calendar-day rows have no audit metadata.
        # An explicit Taiwan claim or partial audit cannot use that compatibility path.
        return (release.get("platform") in NINTENDO_PLATFORMS
                and source == "IGDB" and release.get("date_basis") in {None, "regional_calendar_day"}
                and release.get("region") != "taiwan" and release.get("taiwan_release_confirmed") is not True
                and not any(key in release for key in ("timezone_status", "time_zone", "source_date",
                                                       "source_timestamp", "timestamp_taipei_date")))
    if release.get("time_zone") != "Asia/Taipei":
        return False
    source_day = release.get("source_date")
    taipei_day = release.get("timestamp_taipei_date")
    if ((source_day is not None and not day(source_day))
            or (taipei_day is not None and not day(taipei_day))):
        return False
    timestamp = release.get("source_timestamp")
    if timestamp is not None:
        if type(timestamp) is not int or timestamp < 0:
            return False
        try:
            instant = datetime.fromtimestamp(timestamp, timezone.utc)
        except (OverflowError, OSError, ValueError):
            return False
        if (source_day != instant.date().isoformat()
                or taipei_day != instant.astimezone(TAIPEI).date().isoformat()):
            return False
    basis = release.get("date_basis")
    if source == "IGDB" and basis in {"igdb_timestamp_taipei", "igdb_calendar_day"}:
        official_fields = ("official_source_url", "official_source_name", "official_verified_at",
                           "official_product_id", "official_concept_id", "official_release_time_utc")
        if (release.get("platform") not in IGDB_PLATFORMS or not day(release.get("date"))
                or not isinstance(release.get("region"), str) or not release["region"]
                or release.get("source_region") != release["region"]
                or release.get("taiwan_release_confirmed") is not False
                or any(release.get(field) is not None for field in official_fields)):
            return False
        if basis == "igdb_timestamp_taipei":
            return (status == "converted_to_taipei" and timestamp is not None
                    and taipei_day == release["date"])
        return (status == "date_only" and timestamp is None and taipei_day is None
                and source_day == release["date"])
    if source == "official_registry":
        name = release.get("official_source_name")
        if status == "hong_kong_official_date":
            official_time = release.get("official_release_time_utc")
            instant = stamp(official_time) if official_time is not None else None
            return (release.get("platform") in NINTENDO_PLATFORMS and day(release.get("date"))
                    and release.get("region") == "hong_kong"
                    and release.get("date_basis") == "hong_kong_official_calendar_day"
                    and release.get("taiwan_release_confirmed") is False
                    and isinstance(name, str) and bool(name.strip())
                    and bool(stamp(release.get("official_verified_at")))
                    and hong_kong_official_nintendo_date_url(release.get("official_source_url"))
                    and (official_time is None or instant is not None
                         and instant.astimezone(TAIPEI).date().isoformat() == release["date"]))
        if release.get("platform") == "PS5":
            proof = ps5_taiwan_official_url(release.get("official_source_url"))
            if (not proof or not stamp(release.get("official_verified_at"))
                    or proof["product_id"] and release.get("official_product_id") != proof["product_id"]):
                return False
            official_time = release.get("official_release_time_utc")
            if proof["concept_id"] and (release.get("official_concept_id") != proof["concept_id"]
                                       or release.get("official_product_id") is not None
                                       or official_time is None):
                return False
            if official_time is not None:
                instant = stamp(official_time)
                if not instant or instant.astimezone(TAIPEI).date().isoformat() != release["date"]:
                    return False
        return (status == "taiwan_official_date" and release.get("region") == "taiwan"
                and release.get("date_basis") == "taiwan_official_calendar_day"
                and release.get("taiwan_release_confirmed") is True
                and isinstance(name, str) and bool(name.strip())
                and official_nintendo_date_url(release.get("official_source_url"), release.get("platform")))
    return (source == "IGDB" and status in {"same_calendar_day", "date_only"}
            and release.get("region") != "taiwan" and release.get("source_region") != "taiwan"
            and release.get("date_basis") == "regional_calendar_day"
            and release.get("taiwan_release_confirmed") is False
            and source_day == release["date"] and (taipei_day is None or taipei_day == release["date"])
            and ((status == "same_calendar_day" and timestamp is not None)
                 or (status == "date_only" and timestamp is None)))


def accepted_nintendo(catalog, now):
    """Validate public qualifications before changing optional native IGDB state.

    A broken or partial catalog must not deactivate previously accepted games.
    Content screening is performed by the publisher; this consumer checks its
    explicit result rather than inventing a second adult-keyword policy.
    """
    source = catalog.get("source") if isinstance(catalog, dict) else None
    verified_platforms = source.get("platform_ids_verified") if isinstance(source, dict) else None
    instant = stamp(catalog.get("generated_at")) if isinstance(catalog, dict) else None
    window = catalog.get("window") if isinstance(catalog, dict) else None
    rows = catalog.get("games") if isinstance(catalog, dict) else None
    if (not isinstance(catalog, dict) or type(catalog.get("schema_version")) is not int
            or catalog.get("schema_version") != 1
            or not isinstance(source, dict) or source.get("provider") != "IGDB"
            or source.get("complete") is not True or type(source.get("hypes_threshold")) is not int
            or source.get("hypes_threshold") != 30 or not isinstance(verified_platforms, list)
            or any(type(value) is not int for value in verified_platforms)
            or len(verified_platforms) != len(set(verified_platforms))
            or set(verified_platforms) not in ({130, 508}, {130, 508, 167})
            or not instant or instant > now
            or not isinstance(window, dict) or window.get("end_inclusive") is not False
            or window.get("time_zone") != "Asia/Taipei"
            or not day(window.get("start")) or not day(window.get("end"))
            or day(window["end"]) - day(window["start"]) != timedelta(days=365)
            or day(window["start"]) != instant.astimezone(TAIPEI).date()
            or not isinstance(rows, list)):
        raise ValueError("Complete IGDB catalog with a valid source timestamp required")
    start, end = day(window["start"]), day(window["end"])
    result = {}
    for row in rows:
        if not isinstance(row, dict):
            raise ValueError("Qualified IGDB public rows required")
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
            raise ValueError("Qualified, uniquely identified IGDB public rows required")
        platforms = set()
        for platform in row["platforms"]:
            if (not isinstance(platform, dict) or platform.get("code") not in IGDB_PLATFORMS
                    or type(platform.get("id")) is not int
                    or platform.get("id") != IGDB_PLATFORMS[platform["code"]]
                    or platform["id"] not in verified_platforms
                    or isinstance(platform.get("id"), bool) or platform["code"] in platforms):
                raise ValueError("Verified native IGDB platform identities required")
            platforms.add(platform["code"])
        releases = {}
        for release in row["releases"]:
            if (not isinstance(release, dict) or release.get("platform") not in platforms
                    or release.get("platform") in releases or release.get("precision") != "day"
                    or not day(release.get("date")) or not accepted_nintendo_release_source(release)
                    or not start <= day(release["date"]) < end):
                raise ValueError("Exact, unique IGDB platform release dates in the source window required")
            releases[release["platform"]] = release["date"]
        name = row.get("display_name") or row.get("name_zh_tw") or row.get("name_en")
        if not isinstance(name, str) or not name.strip():
            raise ValueError("IGDB display name required")
        result[key] = {"igdb_id": igdb_id, "name": name, "releases": releases}
    return instant, result


def nintendo_event_time(instant, receipt, now):
    if (isinstance(receipt, dict) and type(receipt.get("schema_version")) is int
            and receipt.get("schema_version") == 1 and receipt.get("complete") is True
            and stamp(receipt.get("generated_at")) == instant):
        if receipt.get("status") == "published":
            published = stamp(receipt.get("published_at"))
            if published and instant <= published <= now:
                return published
        elif receipt.get("status") == "persisted":
            # The collection's durable commit is its activity time. Git delivery
            # is acknowledged independently and must not be inferred here.
            source = receipt.get("source")
            platforms = source.get("platform_ids_verified") if isinstance(source, dict) else None
            run_id = receipt.get("run_id")
            dates = [receipt.get(key) for key in ("target_slot", "generated_at", "committed_at")]
            if (receipt.get("storage_backend") == "turso" and receipt.get("state_persisted") is True
                    and isinstance(run_id, str) and re.fullmatch(r"[0-9]+", run_id)
                    and isinstance(source, dict) and source.get("provider") == "IGDB"
                    and source.get("complete") is True and isinstance(platforms, list)
                    and all(type(value) is int for value in platforms)
                    and len(platforms) == len(set(platforms))
                    and set(platforms) in ({130, 508}, {130, 508, 167})
                    and all(isinstance(value, str) and re.fullmatch(
                        r"[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z", value) for value in dates)):
                target, _, committed = map(stamp, dates)
                if target and committed and target <= instant <= committed <= now:
                    return committed
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
        raise ValueError("Conflicting IGDB catalogs share a source timestamp")
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
                     "platforms": sorted(platforms, key=lambda item: list(IGDB_PLATFORMS).index(item)),
                     "type": kind, "name": row["name"], "date": release, "at": at}
            if kind == "release_date":
                event["previous_date"] = old
            event["id"] = hashlib.sha256(json.dumps(event, sort_keys=True).encode()).hexdigest()[:20]
            state["events"].append(event)
    state["nintendo_source_at"] = instant.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")
    state["nintendo_source_digest"] = digest


def annotate_activity_origins(state, current, origin_ledger=None, nintendo_catalog=None):
    """Freeze an event's collection cause, independently of its game platform.

    Publisher receipts describe the actual input that changed the public catalog.
    Historical Twitch admission proves additions only; it is not evidence for a
    later release-date change. Missing old pipeline evidence stays explicit.
    """
    receipts = []
    if (isinstance(origin_ledger, dict) and type(origin_ledger.get("schema_version")) is int
            and origin_ledger["schema_version"] == 1
            and isinstance(origin_ledger.get("events"), list)):
        receipts = [row for row in origin_ledger["events"] if isinstance(row, dict)
                    and type(row.get("appid")) is int and row["appid"] > 0
                    and row.get("type") in {"added", "release_date"}
                    and day(row.get("date")) and stamp(row.get("at"))
                    and row.get("update_reason") in ACTIVITY_REASONS
                    and row.get("update_reason") not in {"igdb_update", "legacy_unrecorded"}
                    and (row["type"] != "release_date" or day(row.get("previous_date")))]
    consumed = {event.get("update_context", {}).get("receipt_id") for event in state["events"]
                if isinstance(event.get("update_context"), dict)} - {None}
    for event in state["events"]:
        context = event.get("update_context")
        tentative = isinstance(context, dict) and context.get("basis") in {
            "missing_publication_receipt", "steam_catalog_date_change"}
        if event.get("update_reason") in ACTIVITY_REASONS and not tentative:
            continue  # Later admissions or publishers cannot rewrite proven causes.
        at = stamp(event.get("at"))
        if not at:
            continue
        if event.get("source") == "nintendo":
            event["update_reason"] = "igdb_update"
            event["update_context"] = {"basis": "igdb_catalog"}
            if (isinstance(nintendo_catalog, dict) and stamp(nintendo_catalog.get("generated_at"))
                    and stamp(nintendo_catalog["generated_at"]) <= at):
                event["update_context"]["catalog_at"] = nintendo_catalog["generated_at"]
            continue
        matches = []
        for receipt in receipts:
            if (receipt["appid"] != event.get("appid") or receipt["type"] != event.get("type")
                    or receipt["date"] != event.get("date")
                    or receipt.get("previous_date") != event.get("previous_date")
                    or stamp(receipt["at"]) > at + timedelta(minutes=5)):
                continue
            identity = hashlib.sha256(json.dumps(receipt, sort_keys=True).encode()).hexdigest()[:20]
            if identity not in consumed:
                matches.append((stamp(receipt["at"]), identity, receipt))
        if matches:
            _, identity, receipt = max(matches, key=lambda item: item[0])
            event["update_reason"] = receipt["update_reason"]
            event["update_context"] = {"basis": "publication_receipt", "receipt_id": identity,
                                       "at": receipt["at"]}
            consumed.add(identity)
            continue
        row = current.get(str(event.get("appid")), {})
        admission = row.get("twitch_admission")
        checked = stamp(admission.get("checked_at")) if isinstance(admission, dict) else None
        if (event.get("type") == "added" and checked and checked <= at
                and is_twitch_qualified(row)):
            event["update_reason"] = "twitch_rankings"
            event["update_context"] = {"basis": "twitch_admission", "checked_at": admission["checked_at"]}
        elif event.get("type") == "release_date":
            event["update_reason"] = "steam_metadata_refresh"
            event["update_context"] = {"basis": "steam_catalog_date_change"}
        else:
            event["update_reason"] = "legacy_unrecorded"
            event["update_context"] = {"basis": "missing_publication_receipt"}


def update(previous, catalog, *, observed_at, measurements=None, nintendo_catalog=None, nintendo_receipt=None,
           origin_ledger=None):
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
    annotate_activity_origins(state, current, origin_ledger, nintendo_catalog)
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


def growth_collection(run, state, now, *, publication_now=None):
    """Project coverage separately from Followers; unavailable never is a point.

    Use the catalog actually being published, not just the collector's frozen
    cohort. Publication retries may have introduced games or a usable GroupID.
    Completion remains conservative even when that latest catalog has changed.
    Coverage is checked at delivery time; the caller's frozen observation clock
    still owns events and historical measurement timestamps.
    """
    generated = stamp(run.get("generated_at"))
    coverage_at = now
    coverage_clock_valid = True
    if "coverage_checked_at" in run:
        candidate = stamp(run["coverage_checked_at"])
        actual = publication_now if publication_now is not None else now
        coverage_clock_valid = (candidate is not None and generated is not None
                                and actual.tzinfo is not None and actual.utcoffset() is not None
                                and generated <= candidate <= actual)
        if coverage_clock_valid:
            coverage_at = candidate
    today = coverage_at.astimezone(TAIPEI).date()
    current = {int(aid) for aid, row in state["records"].items() if row.get("active")
               and today - timedelta(days=POST_RELEASE_DAYS) <= day(row["release_date"])
               <= today + timedelta(days=365)}

    def appids(value):
        if (not isinstance(value, list) or any(type(aid) is not int or aid <= 0 for aid in value)
                or len(set(value)) != len(value)):
            return None
        return set(value)

    def unavailable_receipt(receipt):
        if not isinstance(receipt, dict):
            return False
        checked, retry = stamp(receipt.get("checked_at")), stamp(receipt.get("retry_at"))
        return (coverage_clock_valid and receipt.get("source") == "Steam ISteamUser/ResolveVanityURL"
                and receipt.get("status") == "not_found" and receipt.get("attempted") is True
                and type(receipt.get("http")) is int and receipt["http"] == 200
                and type(receipt.get("api_result")) is int and receipt["api_result"] == 42
                and checked is not None and checked <= coverage_at and retry is not None
                and retry > coverage_at and retry > checked)

    original = appids(run.get("eligible_appids"))
    versioned = "coverage_schema_version" in run
    if original is None and not versioned and "eligible_appids" not in run:
        original = current
    published = appids(run.get("published_eligible_appids")) if "published_eligible_appids" in run else current
    resolvable = appids(run.get("published_resolvable_appids")) if "published_resolvable_appids" in run else set()
    checkpoint_resolvable = appids(run.get("checkpoint_resolvable_appids")) if "checkpoint_resolvable_appids" in run else set()
    checkpoint_resolutions = run.get("checkpoint_group_resolutions", {})
    valid = (coverage_clock_valid and original == current and published == current and resolvable is not None
             and checkpoint_resolvable is not None and isinstance(checkpoint_resolutions, dict))
    if "eligible" in run:
        valid = valid and type(run["eligible"]) is int and original is not None and run["eligible"] == len(original)
    if resolvable is not None:
        valid = valid and resolvable <= current
    if versioned:
        valid = (valid and type(run.get("coverage_schema_version")) is int and run["coverage_schema_version"] == 2
                 and run.get("collection_date_taipei") == today.isoformat()
                 and generated is not None and generated <= coverage_at
                 and generated.astimezone(TAIPEI).date() == today)
    measured = set()
    for point in run.get("measurements", []):
        if not isinstance(point, dict):
            valid = False
            continue
        aid, at = point.get("appid"), stamp(point.get("at"))
        if (type(aid) is not int or aid <= 0 or type(point.get("followers")) is not int
                or point["followers"] < 0 or point.get("source") != "steam_community"
                or at is None or at > now or at.astimezone(TAIPEI).date() != today
                or aid in measured):
            valid = False
            continue
        if aid in current:
            measured.add(aid)
    unavailable = []
    unavailable_ids = set()
    invalid_unavailable = {}
    for entry in run.get("unavailable", []):
        if not isinstance(entry, dict) or type(entry.get("appid")) is not int:
            valid = False
            continue
        aid, receipt = entry["appid"], entry.get("group_resolution")
        if aid not in current:
            continue
        receipt = receipt if isinstance(receipt, dict) else {}
        checked, retry = stamp(receipt.get("checked_at")), stamp(receipt.get("retry_at"))
        latest_receipt = checkpoint_resolutions.get(str(aid)) if isinstance(checkpoint_resolutions, dict) else None
        latest_checked = stamp(latest_receipt.get("checked_at")) if isinstance(latest_receipt, dict) else None
        latest_changed = latest_receipt is not None and (
            latest_checked is None or latest_checked > coverage_at or checked is None
            or (latest_checked >= checked and not unavailable_receipt(latest_receipt)))
        evidenced = (entry.get("reason") == "official_group_not_found"
                     and "followers" not in entry and "at" not in entry
                     and unavailable_receipt(receipt))
        if (not evidenced or aid in measured or aid in unavailable_ids
                or aid in (resolvable or set()) or aid in (checkpoint_resolvable or set())
                or latest_changed):
            valid = False
            invalid_unavailable[aid] = deepcopy(entry)
            continue
        unavailable.append(deepcopy(entry))
        unavailable_ids.add(aid)
    missing = current - measured - unavailable_ids
    if versioned:
        valid = (valid and type(run.get("measurement_complete")) is bool
                 and run["measurement_complete"] == (measured == current))
    pending_by_id = {entry["appid"]: deepcopy(entry) for entry in run.get("pending", [])
                     if isinstance(entry, dict) and type(entry.get("appid")) is int
                     and entry["appid"] in missing}
    for aid in sorted(missing):
        if aid not in pending_by_id:
            rejected = invalid_unavailable.get(aid)
            pending_by_id[aid] = {"appid": aid, "reason": (
                "awaiting_group_resolution" if rejected else
                "publication_cohort_changed" if original is None or aid not in original else
                "missing_measurement")}
            if rejected and isinstance(rejected.get("group_resolution"), dict):
                pending_by_id[aid]["group_resolution"] = rejected["group_resolution"]
    complete = (valid and not missing and run.get("errors", []) == [] and run.get("pending", []) == []
                and run.get("collection_complete") is True and run.get("reason") == "completed")
    measurement_complete = (valid and measured == current
                            and run.get("measurement_complete", measured == current) is True)
    collection = {"at": run.get("generated_at", now.isoformat()),
                  "status": run.get("reason", "interrupted"), "measurements": len(measured),
                  "measurement_complete": measurement_complete, "collection_complete": complete,
                  "measured_appids": sorted(measured), "unavailable": unavailable,
                  "pending": [pending_by_id[aid] for aid in sorted(pending_by_id)],
                  "coverage": {"eligible": len(current), "measured": len(measured),
                               "unavailable": len(unavailable_ids), "pending": len(missing)}}
    for key in ("coverage_schema_version", "coverage_checked_at", "eligible", "eligible_appids", "collection_date_taipei",
                "published_eligible_appids", "published_resolvable_appids", "requests", "reused",
                "checkpoint_resolvable_appids", "checkpoint_group_resolutions",
                "errors", "next_request_after_taipei", "group_resolution_requests"):
        if key in run:
            collection[key] = deepcopy(run[key])
    if collection["status"] == "completed" and not complete:
        collection["status"] = "awaiting_group_resolution" if missing else "incomplete_coverage"
    return collection


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
    parser.add_argument("--observed-at", help="Freeze a timezone-aware publication clock across Git retries")
    args = parser.parse_args()
    now = stamp(args.observed_at) if args.observed_at is not None else datetime.now(timezone.utc)
    if now is None:
        parser.error("--observed-at requires a timezone-aware ISO timestamp")
    now = now.astimezone(timezone.utc)
    observed = now.replace(microsecond=0).isoformat().replace("+00:00", "Z")
    path = args.data_dir / "insights-state.json"
    run = load(args.measurements, {}) if args.measurements else {}
    measurements = run.get("measurements", [])
    state = update(load(path), load(args.data_dir / "catalog.json"),
                   observed_at=observed, measurements=measurements,
                   nintendo_catalog=load(args.data_dir / "nintendo_upcoming.json"),
                   nintendo_receipt=load(args.data_dir / "nintendo_refresh_status.json"),
                   origin_ledger=load(args.data_dir / "publication/activity_origins.json"))
    if args.measurements:
        state["collection"] = growth_collection(run, state, now, publication_now=datetime.now(timezone.utc))
    activity, growth = projections(state, now.astimezone(TAIPEI).date())
    write(path, state)
    write(args.data_dir / "activity.json", activity)
    write(args.data_dir / "growth.json", growth)
    print(f"INSIGHTS records={len(growth['games'])} events={len(activity['events'])} measurements={len(measurements)}")


if __name__ == "__main__":
    main()
