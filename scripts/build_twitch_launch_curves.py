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


def launch_days(series_root, game_id, expected):
    daily = [[] for _ in range(DAYS)]
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
    return [median(values) if len(values) >= MIN_HOURS else None for values in daily]


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
        output[game_id] = {"date": released.isoformat(), "edition": edition, "genres": genres, "daily": curve}
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
