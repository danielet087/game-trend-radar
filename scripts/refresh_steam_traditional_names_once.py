"""Fill published Steam titles from Steam's actual Traditional Chinese Store locale.

One-time presentation metadata update. Never request Community Followers,
infer unofficial translations, alter a release date or image URL, or restore
any recurring GitHub Action.
"""
from __future__ import annotations

import argparse
import json
import logging
import re
import time
from datetime import datetime, timezone
from pathlib import Path

import requests

LOG = logging.getLogger(__name__)
STORE_URL = "https://api.steampowered.com/IStoreBrowseService/GetItems/v1/"
HAN = re.compile(r"[\u3400-\u9fff]")
BATCH_SIZE = 35


def official_zh_title(original: str, localized: object) -> str | None:
    """Only use an actual Han-containing Steam tchinese title, never machine translation."""
    if not isinstance(localized, str):
        return None
    title = localized.strip()
    if not title or not HAN.search(title):
        return None
    if len(title) > 240:
        return None
    return title


def get_names(session: requests.Session, ids: list[int]) -> dict[int, str]:
    names: dict[int, str] = {}
    last = 0.0
    for pos in range(0, len(ids), BATCH_SIZE):
        batch = ids[pos:pos + BATCH_SIZE]
        payload = {
            "ids": [{"appid": appid} for appid in batch],
            "context": {
                "country_code": "TW",
                "language": "tchinese",
                "steam_realm": 1,
            },
            "data_request": {"include_basic_info": True},
        }
        for attempt in range(4):
            time.sleep(max(0.0, 1.5 - (time.monotonic() - last)))
            last = time.monotonic()
            try:
                resp = session.get(
                    STORE_URL,
                    params={"input_json": json.dumps(payload, separators=(",", ":"))},
                    timeout=30,
                )
                if resp.status_code == 429:
                    LOG.warning("Steam Store localized-title HTTP 429; backing off")
                    time.sleep(20 * (attempt + 1))
                    continue
                resp.raise_for_status()
                rows = (resp.json().get("response") or {}).get("store_items") or []
                for row in rows:
                    if (
                        isinstance(row, dict)
                        and isinstance(row.get("appid"), int)
                        and row["appid"] in batch
                        and isinstance(row.get("name"), str)
                        and row["name"].strip()
                    ):
                        names[row["appid"]] = row["name"].strip()
                break
            except (requests.RequestException, ValueError, TypeError) as error:
                LOG.warning("Steam locale lookup retry %d: %s", attempt + 1, error)
                if attempt < 3:
                    time.sleep(5 * (attempt + 1))
        else:
            raise RuntimeError(
                f"Steam title lookup failed for batch {pos // BATCH_SIZE + 1}; "
                "not changing published files"
            )
        LOG.info("NAMES_FETCHED %d/%d resolved=%d",
                 min(pos + len(batch), len(ids)), len(ids), len(names))
    missing = sorted(set(ids) - names.keys())
    if missing:
        raise RuntimeError(
            f"Steam tchinese names unavailable for {len(missing)} apps, "
            f"sample {missing[:9]}; leaving public JSON unchanged"
        )
    return names


def add_names(games: list[dict], localized: dict[int, str]) -> int:
    translated = 0
    for game in games:
        english = str(game.get("name_en") or game["name"]).strip()
        game["name_en"] = english
        chinese = official_zh_title(english, localized[int(game["appid"])])
        if chinese:
            game["name_zh_tw"] = chinese
            translated += 1
        # If tchinese has no Chinese name, do NOT manufacture a title.
        # An existing reviewed zh-TW title must not be erased.
    return translated


def run(data_dir: Path) -> dict[str, int]:
    filenames = ("steam_upcoming.json", "steam_preview.json")
    docs = {name: json.loads((data_dir / name).read_text(encoding="utf-8"))
            for name in filenames}
    for name, payload in docs.items():
        if not isinstance(payload.get("games"), list):
            raise RuntimeError(f"Invalid public {name} games")
    official = docs["steam_upcoming.json"]["games"]
    if not 50 <= len(official) <= 200:
        raise RuntimeError("Unexpected public game count; refusing title update")
    ids = sorted({
        int(game["appid"])
        for payload in docs.values()
        for game in payload["games"] + (payload.get("recent_games") or [])
    })
    session = requests.Session()
    session.headers["User-Agent"] = "GameTrendRadarSteamTWTitleSync/1.0"
    names = get_names(session, ids)
    result: dict[str, int] = {}
    now = datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")
    for filename, doc in docs.items():
        localized = add_names(doc["games"], names)
        if isinstance(doc.get("recent_games"), list):
            add_names(doc["recent_games"], names)
        doc["official_zh_tw_titles_checked_at"] = now
        doc["official_zh_tw_titles_provider"] = "Steam IStoreBrowseService/GetItems tchinese TW"
        result[filename] = localized
        LOG.info("TITLE_RESULT %s total=%d official_zh_tw=%d fallback_en=%d",
                 filename, len(doc["games"]), localized,
                 len(doc["games"]) - localized)
    # All API checks succeed before either public file changes.
    for filename, doc in docs.items():
        (data_dir / filename).write_text(
            json.dumps(doc, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
    return result


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--data-dir", type=Path, default=Path("data"))
    args = parser.parse_args()
    logging.basicConfig(level=logging.INFO,
                        format="%(asctime)s %(levelname)s %(message)s")
    print("TITLES_UPDATED", json.dumps(run(args.data_dir), ensure_ascii=False))
