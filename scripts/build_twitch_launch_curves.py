"""Summarize the first seven complete Taipei days of matched Steam releases."""
from __future__ import annotations

import argparse
from datetime import datetime, time, timedelta, timezone
import json
from pathlib import Path
from statistics import median

try:
    from scripts.build_radar_insights import day, stamp, write
except ModuleNotFoundError:
    from build_radar_insights import day, stamp, write


TAIPEI = timezone(timedelta(hours=8))
DAYS = 7
MIN_HOURS = 12
CHINESE_HOT_VIEWERS = 100
CHINESE_HOT_HOURS = 4
CHINESE_INDEPENDENT_SOURCE = "helix_language_filter"
GENRES = {
    "Action": "動作", "Adventure": "冒險", "RPG": "角色扮演", "Strategy": "策略",
    "Simulation": "模擬", "Casual": "休閒", "Racing": "競速", "Sports": "運動",
    "Massively Multiplayer": "大型多人連線",
}


def release_metadata(game, catalog):
    reference = game.get("release_reference") or {}
    released = day(reference.get("date"))
    if (reference.get("source_type") != "steam_taiwan_store_date"
            or reference.get("precision") != "day" or released is None):
        return None
    steam = catalog.get(reference.get("steam_appid"))
    raw_genres = steam.get("genres") if steam else None
    if (not isinstance(raw_genres, list) or not all(isinstance(genre, str) for genre in raw_genres)
            or steam.get("release_start") != reference["date"]):
        return None
    genres = [genre for genre in GENRES if genre in raw_genres]
    if not genres:
        return None
    return released, "early_access" if "Early Access" in raw_genres else "standard_store_date", genres


def chinese_heat(viewers):
    hits = sum(value >= CHINESE_HOT_VIEWERS for value in viewers)
    if hits >= CHINESE_HOT_HOURS:
        return True
    if hits + 24 - len(viewers) < CHINESE_HOT_HOURS:
        return False
    return None


def launch_days(series_root, game_id, expected):
    daily = [[] for _ in range(DAYS)]
    chinese = [[] for _ in range(DAYS)]
    sources = [set() for _ in range(DAYS)]
    for month, slots in expected.items():
        path = series_root / game_id / f"{month}.json"
        chunk = json.loads(path.read_text(encoding="utf-8"))
        if (chunk.get("schema_version") != 1 or chunk.get("timezone") != "Asia/Taipei"
                or chunk.get("game_id") != game_id or chunk.get("month") != month):
            raise ValueError(f"Invalid Twitch launch history for {game_id}/{month}")
        for hour, (expected_stamp, offset) in slots.items():
            row = chunk["hours"].get(hour)
            viewers = row.get("viewer_count") if isinstance(row, dict) else None
            if type(viewers) is int and viewers >= 0 and row.get("generated_at") == expected_stamp:
                daily[offset].append(viewers)
                regions = row.get("audience_regions")
                region = regions.get("zh") if isinstance(regions, dict) else None
                if not isinstance(region, dict):
                    continue
                regional_count = region.get("viewer_count")
                source = region.get("measurement_source")
                if (type(regional_count) is not int or regional_count < 0
                        or source not in (None, CHINESE_INDEPENDENT_SOURCE)
                        or source is None and regional_count > viewers):
                    continue
                chinese[offset].append(regional_count)
                sources[offset].add(source or "global_census")
    curve = {"daily": [median(values) if len(values) >= MIN_HOURS else None for values in daily]}
    if any(sources):
        curve["audience_regions"] = {"zh": {
            "daily": [median(values) if len(values) >= MIN_HOURS else None for values in chinese],
            "heat": [chinese_heat(values) for values in chinese],
            "measurement_sources": [None if not day_sources else next(iter(day_sources)) if len(day_sources) == 1 else "mixed"
                                    for day_sources in sources],
        }}
    return curve


def build(data_dir):
    root = data_dir / "twitch_series"
    index = json.loads((root / "index.json").read_text(encoding="utf-8"))
    generated = stamp(index.get("generated_at"))
    if index.get("schema_version") != 1 or index.get("timezone") != "Asia/Taipei" or not generated:
        raise ValueError("A valid Twitch series index is required")
    catalog = json.loads((data_dir / "catalog.json").read_text(encoding="utf-8"))
    by_app = {str(game["appid"]): game for game in catalog["games"]}
    complete_through = generated.astimezone(TAIPEI).date()
    slots_by_day = {}
    for month, hours in index["months"].items():
        for hour, received in hours.items():
            instant, receipt = stamp(hour), stamp(received)
            if instant and receipt and receipt <= generated:
                local = instant.astimezone(TAIPEI)
                if local.date() < complete_through and not (local.minute or local.second or local.microsecond):
                    slots_by_day.setdefault(local.date(), []).append((month, hour, received))
    output = {}
    for game_id, game in sorted(index["games"].items()):
        if (game.get("archive_eligible") is not True or not game_id.isascii()
                or not game_id.isdecimal() or game_id.startswith("0") or len(game_id) > 16):
            continue
        reference = release_metadata(game, by_app)
        if not reference:
            continue
        released, edition, genres = reference
        expected = {}
        for offset in range(DAYS):
            target = released + timedelta(days=offset + 1)
            for month, hour, received in slots_by_day.get(target, []):
                if month in game.get("months", []):
                    expected.setdefault(month, {})[hour] = (received, offset)
        curve = launch_days(root, game_id, expected)
        output[game_id] = {"date": released.isoformat(), "edition": edition, "genres": genres, **curve}
    # The window changes at Taipei midnight; stable data needs no hourly Git commit.
    cutoff = datetime.combine(complete_through, time.min, TAIPEI).astimezone(timezone.utc)
    return {"schema_version": 1, "generated_at": cutoff.isoformat().replace("+00:00", "Z"),
            "genres": GENRES, "games": output}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data-dir", type=Path, default=Path("data"))
    args = parser.parse_args()
    write(args.data_dir / "twitch-launch-curves.json", build(args.data_dir))


if __name__ == "__main__":
    main()
