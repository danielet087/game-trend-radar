"""One-time cleanup: remove sexually explicit Steam games from public catalogue.

Reads Steam Store Browse content_descriptorids in batches; 3 = Adult Only
Sexual Content, 4 = Frequent Nudity or Sexual Content. Some Nudity/Sexual
Content (1), general maturity (5), romance, and violence (2) are NOT enough
to remove a game. A strong NSFW description together with leading sexual
tags also catches adult releases lacking content descriptors. Never queries
followers or alters dates, images, or the previously verified 247-app state.
"""
from __future__ import annotations

import argparse
import json
import logging
import re
import time
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

import requests

LOG = logging.getLogger(__name__)
STORE = "https://api.steampowered.com/IStoreBrowseService/GetItems/v1/"
BATCH = 30
BAD_IDS = frozenset({3, 4})
TAG_SEXUAL = 12095
TAG_NUDITY = 6650
TAG_HENTAI = 9130
# Strong indicators of content purpose, not merely a nonsexual mature rating.
EXPLICIT_DESCRIPTION = re.compile(
    r"\b(?:nsfw|hentai|pornograph(?:y|ic)|erotic(?:a)?|sex game|adult game|"
    r"sexually explicit|explicit sexual|uncensored sexual|sex scenes|"
    r"sexual acts|lots of sex)\b", re.I,
)


def lookup_content(session: requests.Session, appids: set[int]) -> dict[int, dict]:
    ids = sorted(appids)
    results: dict[int, dict] = {}
    last = 0.0
    for index in range(0, len(ids), BATCH):
        chunk = ids[index:index + BATCH]
        payload = {
            "ids": [{"appid": appid} for appid in chunk],
            "context": {"country_code": "TW", "language": "english", "steam_realm": 1},
            "data_request": {"include_basic_info": True, "include_tag_count": 20},
        }
        success = False
        for attempt in range(4):
            time.sleep(max(0.0, 1.5 - (time.monotonic() - last)))
            last = time.monotonic()
            try:
                res = session.get(
                    STORE, params={"input_json": json.dumps(payload, separators=(",", ":"))},
                    timeout=30,
                )
                if res.status_code == 429:
                    LOG.warning("Steam Store rate limited; cooldown before retry")
                    time.sleep(20 * (attempt + 1))
                    continue
                res.raise_for_status()
                items = (res.json().get("response") or {}).get("store_items") or []
                for item in items:
                    if (
                        isinstance(item, dict)
                        and isinstance(item.get("appid"), int)
                        and item["appid"] in chunk
                    ):
                        results[item["appid"]] = item
                success = True
                break
            except (requests.RequestException, ValueError, TypeError) as exc:
                LOG.warning("Steam content lookup retry %d: %s", attempt + 1, exc)
                if attempt < 3:
                    time.sleep(5 * (attempt + 1))
        if not success:
            raise RuntimeError(f"Steam metadata unavailable for batch {index}; data unchanged")
        LOG.info("CONTENT_LOOKUP checked=%d/%d available=%d",
                 min(index + len(chunk), len(ids)), len(ids), len(results))
    missing = sorted(appids - results.keys())
    if missing:
        raise RuntimeError(f"Steam content metadata missing for {len(missing)} appids: {missing[:12]}")
    return results


def reason(item: dict) -> str | None:
    """Only target pornographic/sex-focused games; not mature games in general."""
    descriptors = {
        int(value) for value in item.get("content_descriptorids") or []
        if isinstance(value, int) and not isinstance(value, bool)
    }
    if descriptors & BAD_IDS:
        return "Steam sexually explicit/frequent sexual-content descriptor 3/4"
    tags = [tag.get("tagid") for tag in item.get("tags") or []
            if isinstance(tag, dict)]
    short = str((item.get("basic_info") or {}).get("short_description") or "")
    if (
        TAG_SEXUAL in tags[:5]
        and (TAG_HENTAI in tags[:10] or TAG_NUDITY in tags[:5])
        and EXPLICIT_DESCRIPTION.search(short)
    ):
        return "Steam primary sexual tags with explicit/NSFW game description"
    return None


def filter_rows(
    rows: list[dict], store: dict[int, dict],
) -> tuple[list[dict], list[dict]]:
    kept, removed = [], []
    for original in rows:
        appid = int(original["appid"])
        why = reason(store[appid])
        if why:
            removed.append({"appid": appid, "name": original.get("name"), "reason": why})
        else:
            kept.append(original)
    return kept, removed


def run(data_dir: Path) -> dict:
    paths = [data_dir / "steam_upcoming.json", data_dir / "steam_preview.json"]
    docs = {p: json.loads(p.read_text(encoding="utf-8")) for p in paths}
    official = docs[paths[0]]
    before = official["games"]
    if not 70 <= len(before) <= 300:
        raise RuntimeError("Unexpected official game count; refuse to update")
    ids = {int(game["appid"]) for d in docs.values()
           for game in d.get("games", []) + d.get("recent_games", [])}
    session = requests.Session()
    session.headers["User-Agent"] = "GameTrendRadarSexFocusedFilter/1.0"
    store = lookup_content(session, ids)
    results = {p: filter_rows(doc["games"], store) for p, doc in docs.items()}
    kept, excluded = results[paths[0]]
    if not kept or not excluded:
        raise RuntimeError("Unexpected adult filtering result; data unchanged")
    # Confirm no retained title had original metadata modified.
    by_appid = {int(item["appid"]): item for item in before}
    for row in kept:
        assert row is by_appid[int(row["appid"])]
        assert int(row["followers"]) >= 5000
        assert row["release_display_precision"] == "date_full"
    stamp = datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")
    for path, doc in docs.items():
        retained, removed = results[path]
        doc["games"] = retained
        if "count" in doc:
            doc["count"] = len(retained)
        doc["sexual_content_filter"] = {
            "applied_at": stamp,
            "provider": "Steam IStoreBrowseService/GetItems content_descriptorids, tags, basic_info",
            "exclusion": "descriptor 3/4 or strong primary sexual tags + explicit description",
            "original_count": len(retained) + len(removed),
            "visible_count": len(retained),
            "excluded_count": len(removed),
        }
        LOG.info("FILTER_RESULT %s original=%d retained=%d excluded=%d",
                 path.name, len(retained) + len(removed), len(retained),
                 len(removed))
        for entry in removed:
            LOG.info("EXCLUDED %s %s %s", entry["appid"], entry["name"], entry["reason"])
    # No JSON is touched before all requests, screen, and preservation checks pass.
    for path, doc in docs.items():
        path.write_text(
            json.dumps(doc, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
        )
    return {"original": len(before), "retained": len(kept),
            "excluded": len(excluded)}


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--data-dir", type=Path, default=Path("data"))
    args = parser.parse_args()
    logging.basicConfig(level=logging.INFO,
                        format="%(asctime)s %(levelname)s %(message)s")
    print("FILTER_COMPLETE", json.dumps(run(args.data_dir)), flush=True)
