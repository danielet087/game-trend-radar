"""Convert Simplified Chinese Steam title *display* text into Traditional Chinese.

Steam's source names and actual supported game languages remain unchanged.
Uses OpenCC's phrase-aware s2t dictionary, not character-by-character guessing.
No network requests, no Steam Followers queries, no changes to dates/art/IDs.
"""
from __future__ import annotations

import argparse
import json
import logging
import re
from pathlib import Path

from opencc import OpenCC

LOG = logging.getLogger(__name__)
HAN = re.compile(r"[\u3400-\u9fff]")
NAME_FIELDS = (
    ("name_zh_tw", "name_zh_tw_traditional"),
    ("name_zh_cn", "name_zh_cn_traditional"),
    ("name_en", "name_en_traditional"),
)
CONVERT = OpenCC("s2t")


def convert_names(games: list[dict]) -> dict[str, int]:
    counts = {"rows": len(games), "cn_titles": 0,
              "cn_changed": 0, "tw_changed": 0, "en_changed": 0}
    for game in games:
        if not isinstance(game, dict) or "appid" not in game:
            raise ValueError("Invalid game record")
        for original, derived in NAME_FIELDS:
            title = game.get(original)
            if not isinstance(title, str) or not HAN.search(title):
                game.pop(derived, None)
                continue
            result = CONVERT.convert(title)
            if not result or not HAN.search(result):
                raise ValueError(f"Conversion did not produce a title: {game['appid']}")
            game[derived] = result
            if original == "name_zh_cn":
                counts["cn_titles"] += 1
            if result != title:
                key = {"name_zh_cn": "cn_changed",
                       "name_zh_tw": "tw_changed",
                       "name_en": "en_changed"}[original]
                counts[key] += 1
    return counts


def run(data_dir: Path) -> dict[str, dict[str, int]]:
    documents = {}
    results = {}
    for filename in ("steam_upcoming.json", "steam_preview.json"):
        path = data_dir / filename
        doc = json.loads(path.read_text(encoding="utf-8"))
        if not isinstance(doc.get("games"), list):
            raise ValueError(f"Invalid game list {path}")
        documents[path] = doc
    official = documents[data_dir / "steam_upcoming.json"]
    if not 50 <= len(official["games"]) <= 200:
        raise RuntimeError("Unexpected official public game count")
    for path, doc in documents.items():
        results[path.name] = convert_names(doc["games"])
        if isinstance(doc.get("recent_games"), list):
            results[path.name + ":recent"] = convert_names(doc["recent_games"])
        LOG.info("TRADITIONAL_DISPLAY %s %s", path.name, results[path.name])
    # Validate both outputs BEFORE writing either; retain original Steam locale.
    for path, doc in documents.items():
        path.write_text(
            json.dumps(doc, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
    return results


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--data-dir", type=Path, default=Path("data"))
    args = parser.parse_args()
    logging.basicConfig(level=logging.INFO,
                        format="%(asctime)s %(levelname)s %(message)s")
    print("TRADITIONAL_CONVERTED",
          json.dumps(run(args.data_dir), ensure_ascii=False), flush=True)
