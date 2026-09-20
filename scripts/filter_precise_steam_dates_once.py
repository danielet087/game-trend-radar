"""One-time exact-date-only public Steam catalogue screening.

Steam's IStoreQueryService can return 12/31 or quarter-end placeholder timestamps
even when storefront release text is merely '2026' or 'Q2 2027'. Trust the
independent Store Browse release.coming_soon_display field instead; only
'date_full' means an actual published calendar day. NEVER request Followers,
modify image URLs, or reinitialize candidate data.
"""
from __future__ import annotations

import argparse
import json
import logging
import time
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

import requests

LOG = logging.getLogger(__name__)
URL = "https://api.steampowered.com/IStoreBrowseService/GetItems/v1/"
BATCH_SIZE = 30
RETRIES = 4
SLEEP_SECONDS = 1.5


def fetch_public_release_displays(
    session: requests.Session, appids: set[int],
) -> dict[int, dict]:
    ids = sorted(appids)
    info: dict[int, dict] = {}
    last_start = 0.0
    for start in range(0, len(ids), BATCH_SIZE):
        batch = ids[start:start + BATCH_SIZE]
        request = {
            "ids": [{"appid": id_} for id_ in batch],
            "context": {
                "country_code": "TW", "language": "english", "steam_realm": 1,
            },
            "data_request": {"include_release": True},
        }
        success = False
        for attempt in range(RETRIES):
            time.sleep(max(0.0, SLEEP_SECONDS - (time.monotonic() - last_start)))
            last_start = time.monotonic()
            try:
                response = session.get(
                    URL,
                    params={"input_json": json.dumps(request, separators=(",", ":"))},
                    timeout=30,
                )
                if response.status_code == 429:
                    LOG.warning("Steam Store Browse rate limit; pausing batch")
                    time.sleep(15 * (attempt + 1))
                    continue
                response.raise_for_status()
                result = response.json()
                rows = (result.get("response") or {}).get("store_items") or []
                for row in rows:
                    if not isinstance(row, dict):
                        continue
                    appid = row.get("appid")
                    release = row.get("release")
                    if (
                        isinstance(appid, int)
                        and appid in batch
                        and isinstance(release, dict)
                        and isinstance(release.get("coming_soon_display"), str)
                    ):
                        info[appid] = release
                success = True
                break
            except (requests.RequestException, ValueError, TypeError) as error:
                LOG.warning("Steam release-display lookup retry %d: %s",
                            attempt + 1, error)
                if attempt < RETRIES - 1:
                    time.sleep(5 * (attempt + 1))
        if not success:
            raise RuntimeError(
                f"Steam public release-display API failed for batch {start}; "
                "not changing public JSON"
            )
        LOG.info("DISPLAY_LOOKUP checked=%d/%d usable=%d",
                 min(start + len(batch), len(ids)), len(ids), len(info))
    missing = sorted(appids - info.keys())
    if missing:
        raise RuntimeError(
            f"Steam release display missing for {len(missing)} apps; "
            f"sample={missing[:10]}; not changing public JSON"
        )
    return info


def screen_precise_games(
    games: list[dict], displays: dict[int, dict],
) -> tuple[list[dict], list[dict]]:
    precise: list[dict] = []
    vague: list[dict] = []
    for existing in games:
        game = dict(existing)
        appid = int(game["appid"])
        release = displays[appid]
        label = release["coming_soon_display"]
        # A timestamp or release_precision='day' alone is NOT adequate:
        # Steam itself explicitly marks its 12/31 dates as date_year.
        if (
            label == "date_full"
            and game.get("release_precision") == "day"
            and isinstance(game.get("release_start"), str)
        ):
            game["release_display_precision"] = label
            precise.append(game)
        else:
            vague.append({
                "appid": appid,
                "name": game.get("name"),
                "store_release_display": label,
                "previous_calendar_day": game.get("release_start"),
            })
    return precise, vague


def run(data_dir: Path) -> dict:
    paths = [data_dir / "steam_upcoming.json", data_dir / "steam_preview.json"]
    docs = {path: json.loads(path.read_text(encoding="utf-8"))
            for path in paths}
    for path, doc in docs.items():
        if not isinstance(doc.get("games"), list):
            raise RuntimeError(f"Invalid published games in {path}")
    official = docs[paths[0]]
    original_count = len(official["games"])
    if not 200 <= original_count <= 1000:
        raise RuntimeError(
            f"Unexpected official source count {original_count}; not altering catalogue"
        )
    appids = {
        int(row["appid"])
        for doc in docs.values()
        for row in doc["games"]
    }
    session = requests.Session()
    session.headers["User-Agent"] = "GameTrendRadarExactStoreDateFilter/1.0"
    displays = fetch_public_release_displays(session, appids)
    LOG.info("STEAM_DISPLAY_TYPES %s",
             json.dumps(dict(Counter(
                 x.get("coming_soon_display") for x in displays.values()
             )), ensure_ascii=False))
    results: dict[Path, tuple[list[dict], list[dict]]] = {}
    for path, doc in docs.items():
        results[path] = screen_precise_games(doc["games"], displays)
    verified, excluded = results[paths[0]]
    if not verified or not excluded:
        raise RuntimeError(
            "Expected a mixture of precise and vague dates; inspect API "
            "before changing the public catalogue"
        )
    # Check preservation of all surviving public records before any write.
    old_by_id = {int(g["appid"]): g for g in official["games"]}
    for game in verified:
        original = old_by_id[game["appid"]]
        assert {k: v for k, v in game.items()
                if k != "release_display_precision"} == original
        assert int(game["followers"]) >= 5000
    stamp = datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")
    for path, doc in docs.items():
        kept, skipped = results[path]
        doc["games"] = kept
        if "count" in doc:
            doc["count"] = len(kept)
        doc["release_display_verified_at"] = stamp
        doc["release_display_source"] = "Steam IStoreBrowseService/GetItems release.coming_soon_display"
        doc["release_display_requirement"] = "date_full"
        doc["release_display_screening"] = {
            "original": len(kept) + len(skipped),
            "exact_dates": len(kept),
            "excluded_vague": len(skipped),
            "excluded_by_type": dict(Counter(
                x["store_release_display"] for x in skipped
            )),
        }
        LOG.info("SCREEN_RESULT %s original=%d exact=%d excluded=%d types=%s",
                 path.name, len(kept) + len(skipped), len(kept),
                 len(skipped), doc["release_display_screening"]["excluded_by_type"])
    # All validation and API work above must succeed BEFORE modifying files.
    for path, doc in docs.items():
        path.write_text(
            json.dumps(doc, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
        )
    return {"initial": original_count, "visible": len(verified),
            "excluded": len(excluded)}


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--data-dir", type=Path, default=Path("data"))
    args = parser.parse_args()
    logging.basicConfig(level=logging.INFO,
                        format="%(asctime)s %(levelname)s %(message)s")
    print("FILTER_COMPLETE", json.dumps(run(args.data_dir)), flush=True)
