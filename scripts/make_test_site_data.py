"""Freeze a small, consistent copy of the site's data for the tests.

usage: python scripts/make_test_site_data.py [SOURCE_DIR] [--games N]

Writes tests/fixtures/site-data/ from SOURCE_DIR (default data/): the first N
catalog games (plus the games the browser tests name) with their per-game and
Steam media files, and the catalog, Steam, Nintendo, activity and growth files
trimmed to them.
Tests read this copy and the preview server serves it (RADAR_SITE_DATA), so they
no longer change with every collection and keep working once data/ leaves Git.
The browser tests pin their clock to the catalog's generated_at. Regenerate only
on purpose, and review the diff like any other test change.
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path
import shutil

ROOT = Path(__file__).resolve().parent.parent
TARGET = ROOT / "tests" / "fixtures" / "site-data"
# tests/browser/growth-followers.spec.ts reads these rows.
NAMED = (5356470,)


def read(path: Path):
    return json.loads(path.read_text(encoding="utf-8"))


def write(path: Path, value) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")


def followers_window(row) -> bool:
    """growth-followers.spec.ts needs one game at 5,000+ Followers dated a year from 2026-11-10."""
    return (row.get("followers") or 0) >= 5000 and "2026-11-10" <= (row.get("release_start") or "") <= "2027-11-10"


def make(source: Path, games: int) -> dict:
    catalog = read(source / "catalog.json")
    rows = catalog["games"]
    chosen = rows[:games]
    wanted = {row["appid"] for row in chosen}
    extra = [row for row in rows if row["appid"] in NAMED and row["appid"] not in wanted]
    if not any(followers_window(row) for row in chosen + extra):
        extra += [next(row for row in rows if followers_window(row))]
    chosen += extra
    kept = {row["appid"] for row in chosen}
    missing = [appid for appid in NAMED if appid not in kept]
    if missing:
        raise SystemExit(f"The source catalog lacks the named test games {missing}")

    if TARGET.exists():
        shutil.rmtree(TARGET)
    write(TARGET / "catalog.json", {**catalog, "count": len(chosen), "games": chosen})
    for name in ("steam_upcoming.json",):
        value = read(source / name)
        trimmed = [row for row in value["games"] if row.get("appid") in kept]
        write(TARGET / name, {**value, "count": len(trimmed), "games": trimmed})
    preview = read(source / "steam_preview.json")
    write(TARGET / "steam_preview.json", {**preview,
          "games": [row for row in preview.get("games", []) if row.get("appid") in kept],
          "recent_games": [row for row in preview.get("recent_games", []) if row.get("appid") in kept]})
    write(TARGET / "nintendo_upcoming.json", read(source / "nintendo_upcoming.json"))
    activity = read(source / "activity.json")
    write(TARGET / "activity.json", {**activity, "events": [
        event for event in activity["events"] if event.get("appid") in kept or event.get("appid") is None]})
    growth = read(source / "growth.json")
    write(TARGET / "growth.json", {**growth, "games": [row for row in growth["games"] if row.get("appid") in kept]})
    copied = 0
    for appid in sorted(kept):
        path = source / "games" / f"{appid}.json"
        if path.is_file():
            write(TARGET / "games" / path.name, read(path))
            copied += 1
    media = copy_media(source, kept)
    (TARGET / "README.md").write_text(
        "# Test site data\n\n"
        f"A frozen copy of the site's data from {catalog['generated_at']}: {len(chosen)} catalog games, their files and Steam media.\n"
        "Tests read it and the preview server serves it (`RADAR_SITE_DATA`). Regenerate on purpose with\n"
        "`python scripts/make_test_site_data.py` and review the diff like any other test change.\n",
        encoding="utf-8")
    size = sum(path.stat().st_size for path in TARGET.rglob("*") if path.is_file())
    return {"games": len(chosen), "game_files": copied, "media_files": media, "bytes": size,
            "generated_at": catalog["generated_at"]}


def copy_media(source: Path, kept) -> int:
    """Steam hero art, screenshot and trailer addresses (game.html) for the chosen games."""
    copied = 0
    for appid in sorted(kept):
        path = source / "media" / f"{appid}.json"
        if path.is_file():
            write(TARGET / "media" / path.name, read(path))
            copied += 1
    return copied


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("source", nargs="?", type=Path, default=ROOT / "data")
    parser.add_argument("--games", type=int, default=110)
    args = parser.parse_args(argv)
    print(json.dumps(make(args.source.resolve(), args.games)))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
