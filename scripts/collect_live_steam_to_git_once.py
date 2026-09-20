"""One approved live Steam Store refresh for the existing published catalogue.

Updates both public JSON files only after all official Store Browse lookups
succeed and verifies full-day release precision / absence of explicit sexual
content. Refreshes two actual Steam Community XML memberCount values if
available; 429 never becomes a made-up count. The 96-game catalogue, original
Followers of non-sampled games and private 11,467-game state stay untouched.
"""
from __future__ import annotations

import argparse
import copy
import json
import logging
import time
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from pathlib import Path

import requests
from opencc import OpenCC

from scripts.refresh_steam_artwork_once import get_artwork, enrich as enrich_artwork
from scripts.refresh_steam_game_languages_once import fetch_metadata, update_titles
from scripts.convert_public_names_to_traditional_once import convert_names
from scripts.filter_precise_steam_dates_once import fetch_public_release_displays

LOG = logging.getLogger(__name__)
CONVERT = OpenCC("s2t")
FOLLOWERS_URL = "https://steamcommunity.com/games/{appid}/memberslistxml/"
# Two high-follower titles: ensure this pilot can't accidentally remove games.
SAMPLE_FOLLOWER_COUNT = 2


def read_followers(xml: str) -> int:
    root = ET.fromstring(xml)
    for path in ("memberCount", "groupDetails/memberCount", ".//memberCount"):
        node = root.find(path)
        if node is not None and node.text:
            value = node.text.replace(",", "").strip()
            if value.isdigit():
                return int(value)
    raise ValueError("No valid Steam Community memberCount")


def refresh_follower_sample(
    session: requests.Session, games: list[dict],
    *, interval: float = 30.0,
) -> list[dict]:
    results: list[dict] = []
    last_start = 0.0
    selected = sorted(games, key=lambda g: -int(g["followers"]))[:SAMPLE_FOLLOWER_COUNT]
    for row in selected:
        appid = int(row["appid"])
        time.sleep(max(0.0, interval - (time.monotonic() - last_start)))
        last_start = time.monotonic()
        old = int(row["followers"])
        record = {"appid": appid, "old": old, "new": None, "status": "unavailable"}
        try:
            response = session.get(FOLLOWERS_URL.format(appid=appid),
                                   params={"xml": 1}, timeout=30)
            if response.status_code == 429:
                record["status"] = "rate_limited"
            else:
                response.raise_for_status()
                count = read_followers(response.text)
                if 5000 <= count <= max(old * 5, 5000):
                    record["new"] = count
                    record["status"] = "verified"
                else:
                    record["status"] = "unexpected_count_not_published"
        except (requests.RequestException, ValueError, ET.ParseError) as exc:
            LOG.warning("Steam official Followers sample app=%s: %s", appid, exc)
            record["status"] = "request_failed"
        results.append(record)
        LOG.info("OFFICIAL_FOLLOWERS app=%s status=%s old=%s new=%s",
                 appid, record["status"], old, record["new"])
        if record["status"] == "rate_limited":
            # Do not retry aggressively or force extra 429 requests.
            break
    return results


def validate_store_rows(existing: list[dict], releases: dict[int, dict]) -> None:
    for game in existing:
        appid = int(game["appid"])
        row = releases.get(appid)
        if not isinstance(row, dict):
            raise RuntimeError(f"No official Steam release metadata for {appid}")
        if row.get("coming_soon_display") != "date_full":
            raise RuntimeError(
                f"Steam date no longer exact for {appid}: "
                f"{row.get('coming_soon_display')}; refusing unsafe publish"
            )
        if game.get("release_display_precision") != "date_full":
            raise RuntimeError(f"Existing published release not screened: {appid}")


def run(data_dir: Path) -> dict:
    filenames = ("steam_upcoming.json", "steam_preview.json")
    docs = {name: json.loads((data_dir / name).read_text(encoding="utf-8"))
            for name in filenames}
    official = docs["steam_upcoming.json"]
    if not 70 <= len(official.get("games") or []) <= 200:
        raise RuntimeError("Unexpected official Steam catalogue size")
    games = [
        game for doc in docs.values()
        for game in (doc["games"] + (doc.get("recent_games") or []))
    ]
    ids = sorted({int(row["appid"]) for row in games})
    if any(int(game["followers"]) < 5000 for game in official["games"]):
        raise RuntimeError("Published catalogue has a game below 5000")
    if any(game.get("release_display_precision") != "date_full"
           for game in official["games"]):
        raise RuntimeError("Published catalogue includes vague release date")
    session = requests.Session()
    session.headers["User-Agent"] = "GameTrendRadarLiveSteamGitPilot/1.0"
    LOG.info("LIVE_COLLECT_START official=%s all_appids=%s",
             len(official["games"]), len(ids))
    # All of these read Steam directly; no cached/unofficial Store guesses.
    locales = fetch_metadata(session, ids, interval=1.5)
    artwork = get_artwork(session, ids, interval=1.5)
    releases = fetch_public_release_displays(session, set(ids))
    for doc in docs.values():
        validate_store_rows(doc["games"], releases)
    if len(artwork) < len(ids) * .95:
        raise RuntimeError("Too few real Steam artwork records; preserving JSON")
    # Do not fetch Community followers until every Store metadata check passes.
    followers = refresh_follower_sample(session, official["games"])
    followers_by_id = {
        entry["appid"]: entry for entry in followers
        if entry["status"] == "verified"
    }
    timestamp = datetime.now(timezone.utc).replace(
        microsecond=0).isoformat().replace("+00:00", "Z")
    refreshed: dict[str, dict] = {}
    for filename, doc in docs.items():
        values = doc["games"]
        language_stats = update_titles(values, locales)
        image_headers, image_mains = enrich_artwork(values, artwork)
        convert_names(values)
        if isinstance(doc.get("recent_games"), list):
            update_titles(doc["recent_games"], locales)
            enrich_artwork(doc["recent_games"], artwork)
            convert_names(doc["recent_games"])
        updated_followers = 0
        for game in values + (doc.get("recent_games") or []):
            sample = followers_by_id.get(int(game["appid"]))
            if sample:
                game["followers"] = sample["new"]
                game["follower_checked_at"] = timestamp
                updated_followers += 1
        if any(game.get("release_display_precision") != "date_full"
               for game in doc["games"]):
            raise RuntimeError(f"Date gate unexpectedly changed for {filename}")
        doc["steam_live_collection_test"] = {
            "collected_at": timestamp,
            "store_provider": "Steam IStoreBrowseService/GetItems (TW)",
            "official_followers_provider": "Steam Community memberslistxml",
            "store_appids_checked": len(ids),
            "public_games": len(values),
            "release_precision_verified": len(values),
            "artwork_headers_fetched": image_headers,
            "artwork_main_capsules_fetched": image_mains,
            "language_summary": language_stats,
            "follower_sample": followers,
            "follower_values_updated_in_file": updated_followers,
        }
        # This is explicitly a metadata-check timestamp, NOT a claim that all
        # 96 official Followers counts were freshly re-verified.
        doc["steam_store_metadata_checked_at"] = timestamp
        refreshed[filename] = {
            "games": len(values), "language": language_stats,
            "followers_updated": updated_followers,
        }
    # Save all results only after validation, no original private state touched.
    for filename, doc in docs.items():
        (data_dir / filename).write_text(
            json.dumps(doc, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
    LOG.info("LIVE_COLLECT_SUCCESS %s", json.dumps(refreshed, ensure_ascii=False))
    return refreshed


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--data-dir", type=Path, default=Path("data"))
    args = parser.parse_args()
    logging.basicConfig(level=logging.INFO,
                        format="%(asctime)s %(levelname)s %(message)s")
    print("LIVE_COLLECTION_REPORT",
          json.dumps(run(args.data_dir), ensure_ascii=False), flush=True)
