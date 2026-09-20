"""One-time Steam-sourced title and interface-language metadata for published games.

Steam Store Browse supported_languages[].elanguage: English=0,
Simplified Chinese=6, Traditional Chinese=7. 'supported' means game language
support (interface; subtitles/full audio are separate), unlike an available
Chinese storefront page. Titles are obtained from independent Store locales.
Never query Followers or alter release dates, cover URLs, existing title IDs.
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
STORE = "https://api.steampowered.com/IStoreBrowseService/GetItems/v1/"
LANGUAGES = {"english": 0, "schinese": 6, "tchinese": 7}
BATCH = 30
HAN = re.compile(r"[\u3400-\u9fff]")


def official_chinese_title(value: object) -> str | None:
    """Never machine-translate an English storefront fallback title."""
    if not isinstance(value, str):
        return None
    name = value.strip()
    return name if name and len(name) <= 240 and HAN.search(name) else None


def read_support(row: dict) -> dict[str, bool | None]:
    langs = row.get("supported_languages")
    if not isinstance(langs, list) or not langs:
        return {"tchinese": None, "schinese": None, "english": None}
    allowed = {
        item["elanguage"] for item in langs
        if isinstance(item, dict)
        and type(item.get("elanguage")) is int
        and item.get("supported") is True
    }
    return {
        "tchinese": LANGUAGES["tchinese"] in allowed,
        "schinese": LANGUAGES["schinese"] in allowed,
        "english": LANGUAGES["english"] in allowed,
    }


def fetch_metadata(session: requests.Session, ids: list[int],
                   *, interval: float = 1.5) -> dict[int, dict]:
    all_data: dict[int, dict] = {id_: {} for id_ in ids}
    last_call = 0.0
    for pos in range(0, len(ids), BATCH):
        batch = ids[pos:pos + BATCH]
        for lang in ("english", "tchinese", "schinese"):
            request = {
                "ids": [{"appid": id_} for id_ in batch],
                "context": {
                    "country_code": "TW", "language": lang, "steam_realm": 1,
                },
                "data_request": {
                    "include_basic_info": True,
                    "include_supported_languages": True,
                },
            }
            response_data = None
            for attempt in range(4):
                time.sleep(max(0.0, interval - (time.monotonic() - last_call)))
                last_call = time.monotonic()
                try:
                    response = session.get(
                        STORE,
                        params={"input_json": json.dumps(request, separators=(",", ":"))},
                        timeout=30,
                    )
                    if response.status_code == 429:
                        LOG.warning("Steam metadata HTTP 429: retry after cooldown")
                        time.sleep(20 * (attempt + 1))
                        continue
                    response.raise_for_status()
                    payload = response.json()
                    response_data = (payload.get("response") or {}).get("store_items") or []
                    break
                except (requests.RequestException, ValueError, TypeError) as error:
                    LOG.warning("Steam %s batch retry %d: %s", lang, attempt + 1, error)
                    if attempt < 3:
                        time.sleep(5 * (attempt + 1))
            if response_data is None:
                raise RuntimeError(
                    f"Could not fetch {lang} Store metadata at batch {pos}; "
                    "not changing published data"
                )
            resolved = set()
            for row in response_data:
                if (
                    not isinstance(row, dict)
                    or type(row.get("appid")) is not int
                    or row["appid"] not in all_data
                    or row["appid"] not in batch
                ):
                    continue
                resolved.add(row["appid"])
                result = all_data[row["appid"]]
                title = row.get("name")
                if isinstance(title, str) and title.strip():
                    result["name_" + lang] = title.strip()
                if lang == "english":
                    result["support"] = read_support(row)
            missing = sorted(set(batch) - resolved)
            if missing:
                raise RuntimeError(
                    f"Steam Store {lang} missing {len(missing)} entries: {missing[:8]}; "
                    "not changing published data"
                )
        LOG.info("LANGUAGE_LOOKUP checked=%d/%d",
                 min(pos + len(batch), len(ids)), len(ids))
    return all_data


def update_titles(games: list[dict], metadata: dict[int, dict]) -> dict[str, int]:
    stats = {
        "total": 0, "traditional_supported": 0,
        "simplified_only": 0, "neither_chinese": 0,
        "unpublished_support": 0, "zh_tw_titles": 0, "zh_cn_titles": 0,
    }
    for game in games:
        item = metadata[int(game["appid"])]
        support = item.get("support")
        if not isinstance(support, dict):
            raise RuntimeError(f"No Steam support info for app {game['appid']}")
        stats["total"] += 1
        game["name_en"] = str(game.get("name_en") or game["name"]).strip()
        tw = official_chinese_title(item.get("name_tchinese"))
        cn = official_chinese_title(item.get("name_schinese"))
        if tw:
            game["name_zh_tw"] = tw
            stats["zh_tw_titles"] += 1
        if cn:
            game["name_zh_cn"] = cn
            stats["zh_cn_titles"] += 1
        game["language_support"] = support
        if support["tchinese"] is True:
            stats["traditional_supported"] += 1
        elif support["schinese"] is True:
            stats["simplified_only"] += 1
        elif support["tchinese"] is None or support["schinese"] is None:
            stats["unpublished_support"] += 1
        else:
            stats["neither_chinese"] += 1
    return stats


def run(data_dir: Path) -> dict:
    files = ("steam_upcoming.json", "steam_preview.json")
    docs = {p: json.loads((data_dir / p).read_text(encoding="utf-8"))
            for p in files}
    for filename, doc in docs.items():
        if not isinstance(doc.get("games"), list):
            raise RuntimeError(f"Invalid {filename} games array")
    official = docs["steam_upcoming.json"]["games"]
    if not 70 <= len(official) <= 200:
        raise RuntimeError("Unexpected official list size: refusing update")
    ids = sorted({
        int(game["appid"])
        for doc in docs.values()
        for game in doc["games"] + (doc.get("recent_games") or [])
    })
    session = requests.Session()
    session.headers["User-Agent"] = "GameTrendRadarGameLanguagesTW/1.0"
    metadata = fetch_metadata(session, ids)
    now = datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")
    result = {}
    for filename, doc in docs.items():
        stats = update_titles(doc["games"], metadata)
        if isinstance(doc.get("recent_games"), list):
            update_titles(doc["recent_games"], metadata)
        doc["language_support_checked_at"] = now
        doc["language_support_source"] = (
            "Steam Store Browse GetItems supported_languages + English/tchinese/schinese TW names"
        )
        doc["language_support_summary"] = stats
        result[filename] = stats
        LOG.info("LANGUAGE_RESULT %s %s", filename,
                 json.dumps(stats, ensure_ascii=False))
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
    print("LANGUAGES_UPDATED", json.dumps(run(args.data_dir), ensure_ascii=False))
