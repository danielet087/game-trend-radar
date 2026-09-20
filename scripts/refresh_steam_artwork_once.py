"""One-time public Steam art metadata refresh; NEVER request Followers.

GetItems returns actual hashed header/main-capsule filenames in bulk.
Only modify artwork fields in existing public JSON documents.
"""
from __future__ import annotations

import argparse
import json
import logging
import time
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urljoin, urlsplit

import requests

LOGGER = logging.getLogger(__name__)
STORE_URL = "https://api.steampowered.com/IStoreBrowseService/GetItems/v1/"
ASSET_BASE = "https://shared.akamai.steamstatic.com/store_item_assets/"
BATCH_SIZE = 30
ALLOWED_HOSTS = ("steamstatic.com", "steamcdn-a.akamaihd.net")


def steam_asset_url(appid: int, fmt: object, filename: object) -> str:
    """Build a Steam-supplied path; do not guess hashes from a small capsule."""
    if not isinstance(fmt, str) or not isinstance(filename, str):
        return ""
    if "${FILENAME}" not in fmt or not filename or ".." in filename.split("/"):
        return ""
    url = urljoin(ASSET_BASE, fmt.replace("${FILENAME}", filename))
    parsed = urlsplit(url)
    if parsed.scheme != "https" or not any(
        parsed.hostname == host or (parsed.hostname or "").endswith("." + host)
        for host in ALLOWED_HOSTS
    ):
        return ""
    path = parsed.path
    if (f"/steam/apps/{appid}/" not in path
            or ".." in path.split("/")
            or not path.lower().endswith((".jpg", ".jpeg", ".png", ".webp"))):
        return ""
    return url


def get_artwork(session: requests.Session, ids: list[int],
                *, interval: float = 1.5) -> dict[int, dict[str, str]]:
    found: dict[int, dict[str, str]] = {}
    last_request = 0.0
    for offset in range(0, len(ids), BATCH_SIZE):
        batch = ids[offset:offset + BATCH_SIZE]
        payload = {
            "ids": [{"appid": appid} for appid in batch],
            "context": {"country_code": "TW", "language": "english", "steam_realm": 1},
            "data_request": {"include_assets": True},
        }
        for attempt in range(4):
            time.sleep(max(0.0, interval - (time.monotonic() - last_request)))
            last_request = time.monotonic()
            try:
                resp = session.get(
                    STORE_URL,
                    params={"input_json": json.dumps(payload, separators=(",", ":"))},
                    timeout=30,
                )
                if resp.status_code == 429:
                    LOGGER.warning("Steam Store image lookup throttled; backing off")
                    time.sleep(20 * (attempt + 1))
                    continue
                resp.raise_for_status()
                rows = (resp.json().get("response") or {}).get("store_items") or []
                for row in rows:
                    if not isinstance(row, dict):
                        continue
                    try:
                        appid = int(row.get("appid"))
                    except (ValueError, TypeError):
                        continue
                    if appid not in batch:
                        continue
                    assets = row.get("assets") or {}
                    if not isinstance(assets, dict):
                        continue
                    fmt = assets.get("asset_url_format")
                    header = steam_asset_url(appid, fmt, assets.get("header"))
                    main = steam_asset_url(appid, fmt, assets.get("main_capsule"))
                    if header or main:
                        found[appid] = {
                            "header_image": header,
                            "main_capsule_image": main,
                        }
                break
            except (requests.RequestException, ValueError, TypeError) as exc:
                LOGGER.warning("Steam Store image lookup batch retry %d: %s",
                               attempt + 1, exc)
                if attempt < 3:
                    time.sleep(6 * (attempt + 1))
        LOGGER.info("Artwork lookup: %d/%d Apps; %d usable",
                    min(offset + len(batch), len(ids)), len(ids), len(found))
    return found


def enrich(games: list[dict], art: dict[int, dict[str, str]]) -> tuple[int, int]:
    headers = mains = 0
    for game in games:
        supplied = art.get(int(game["appid"])) or {}
        if supplied.get("header_image"):
            game["header_image"] = supplied["header_image"]
            headers += 1
        if supplied.get("main_capsule_image"):
            game["main_capsule_image"] = supplied["main_capsule_image"]
            mains += 1
    return headers, mains


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--data-dir", type=Path, default=Path("data"))
    args = parser.parse_args()
    docs: dict[Path, dict] = {}
    for name in ("steam_upcoming.json", "steam_preview.json"):
        path = args.data_dir / name
        doc = json.loads(path.read_text(encoding="utf-8"))
        if not isinstance(doc.get("games"), list):
            raise RuntimeError("Invalid games array: " + str(path))
        docs[path] = doc
    official = docs[args.data_dir / "steam_upcoming.json"]
    ids = sorted({int(g["appid"]) for g in official["games"]})
    if len(ids) < 200 or len(ids) > 1000:
        raise RuntimeError("Unexpected official dataset; refusing bulk image update")
    session = requests.Session()
    session.headers["User-Agent"] = "GameTrendRadarArtworkSync/1.0"
    art = get_artwork(session, ids)
    if len(art) < max(1, len(ids) // 2):
        raise RuntimeError(
            f"Only {len(art)}/{len(ids)} image records; preserving original JSON"
        )
    stamp = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    for path, doc in docs.items():
        headers, mains = enrich(doc["games"], art)
        if isinstance(doc.get("recent_games"), list):
            enrich(doc["recent_games"], art)
        if path.name == "steam_upcoming.json" and headers < len(ids) // 2:
            raise RuntimeError("Too few official headers; preserving existing JSON")
        doc["artwork_refreshed_at"] = stamp
        doc["artwork_provider"] = "Steam IStoreBrowseService/GetItems assets"
        path.write_text(
            json.dumps(doc, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
        )
        LOGGER.info("UPDATED %s: headers=%d mains=%d total=%d",
                    path, headers, mains, len(doc["games"]))
    LOGGER.info("RESULT official=%d assets=%d missing=%d",
                len(ids), len(art), len(ids) - len(art))


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO,
                        format="%(asctime)s %(levelname)s %(message)s")
    main()
