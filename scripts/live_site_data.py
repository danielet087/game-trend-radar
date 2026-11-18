"""Record the data a deploy publishes, and restore it from the live site.

usage: python scripts/live_site_data.py record SITE_DIR [--commit SHA]

Every deploy writes site-data.json at the site root: the sha256 and size of each
file under data/. When a later deploy cannot read the database, the data steps
(scripts/site_data.py, scripts/site_twitch_views.py) restore their files from the
live site instead. Every download must match the live record before anything in
SITE_DIR changes, so the data can neither go backwards nor be partial, and the
new code still deploys. Without a valid live record the step stops the deploy and
the live site keeps its previous version, as before.

RADAR_DEPLOY_LIVE_DATA=1 makes the data steps take this path without reading the
database (a manual drill; the data deployed is exactly what is live).
"""
from __future__ import annotations

import argparse
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import sys
import time
import urllib.error
import urllib.request

LIVE_SITE = "https://danielet087.github.io/game-trend-radar/"
RECORD = "site-data.json"
DRILL = "RADAR_DEPLOY_LIVE_DATA"
WORKERS = 16
ATTEMPTS = 3


class LiveDataError(Exception):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code


def drill() -> bool:
    return os.environ.get(DRILL) == "1"


def site_files(site: Path) -> dict[str, dict]:
    """sha256 and size of every file under SITE_DIR/data, by site-relative path."""
    files = {}
    base = site / "data"
    if base.is_dir():
        for path in sorted(base.rglob("*")):
            if path.is_symlink():
                raise LiveDataError("SYMLINK", "Site data cannot use symlinks")
            if path.is_file():
                raw = path.read_bytes()
                files[path.relative_to(site).as_posix()] = {"sha256": hashlib.sha256(raw).hexdigest(),
                                                            "bytes": len(raw)}
    return files


def record(site: Path, commit: str | None = None) -> dict:
    files = site_files(site)
    value = {"schema_version": 1, "commit": commit,
             "built_at": datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z"),
             "files": files}
    (site / RECORD).write_text(json.dumps(value, sort_keys=True, separators=(",", ":")) + "\n", encoding="utf-8")
    return {"status": "recorded", "files": len(files), "bytes": sum(item["bytes"] for item in files.values())}


def _fetch(url: str) -> bytes | None:
    """The body at url, or None for 404. Other failures raise after retries."""
    request = urllib.request.Request(url, headers={"Cache-Control": "no-cache",
                                                   "User-Agent": "game-trend-radar-deploy"})
    for attempt in range(ATTEMPTS):
        try:
            with urllib.request.urlopen(request, timeout=60) as response:
                return response.read()
        except urllib.error.HTTPError as error:
            if error.code == 404:
                return None
            if attempt + 1 == ATTEMPTS or error.code < 500 and error.code != 429:
                raise LiveDataError("LIVE_SITE_UNAVAILABLE", f"The live site answered HTTP {error.code}") from None
        except (urllib.error.URLError, TimeoutError, OSError):
            if attempt + 1 == ATTEMPTS:
                raise LiveDataError("LIVE_SITE_UNAVAILABLE", "The live site could not be reached") from None
        time.sleep(2 * (attempt + 1))
    raise AssertionError("unreachable")


def _url(path: str, token: str) -> str:
    return LIVE_SITE + path + "?deploy=" + token


def _safe(path) -> bool:
    if not isinstance(path, str) or not path.startswith("data/") or "\\" in path:
        return False
    parts = PurePosixPath(path).parts
    return PurePosixPath(path).as_posix() == path and ".." not in parts and "." not in parts


def live_record(token: str, fetch=None) -> dict:
    raw = (fetch or _fetch)(_url(RECORD, token))
    if raw is None:
        raise LiveDataError("NO_LIVE_RECORD", "The live site has no data record")
    try:
        value = json.loads(raw)
    except ValueError:
        value = None
    files = value.get("files") if isinstance(value, dict) and value.get("schema_version") == 1 else None
    if not isinstance(files, dict) or not all(
            _safe(path) and isinstance(item, dict) and isinstance(item.get("sha256"), str)
            and re.fullmatch(r"[0-9a-f]{64}", item["sha256"]) and type(item.get("bytes")) is int
            and item["bytes"] >= 0 for path, item in files.items()):
        raise LiveDataError("INVALID_LIVE_RECORD", "The live site's data record is not valid")
    return value


def restore(site: Path, select, *, required=(), fetch=None, token=None) -> dict:
    """Replace the selected data files of SITE_DIR with the live site's verified copies.

    Selected files the live site does not have are removed. Nothing changes
    unless every selected live file was downloaded and matched the record.
    """
    token = token or os.environ.get("GITHUB_RUN_ID") or str(int(time.time()))
    fetch = fetch or _fetch
    live = live_record(token, fetch)
    wanted = {path: item for path, item in live["files"].items() if select(path)}
    missing = [path for path in required if path not in wanted]
    if missing:
        raise LiveDataError("INCOMPLETE_LIVE_DATA", "The live site lacks " + ", ".join(missing))

    def download(path):
        raw = fetch(_url(path, token))
        item = wanted[path]
        if raw is None or len(raw) != item["bytes"] or hashlib.sha256(raw).hexdigest() != item["sha256"]:
            raise LiveDataError("LIVE_DATA_CHANGED", "A live file does not match the live record")
        return path, raw

    with ThreadPoolExecutor(max_workers=WORKERS) as pool:
        downloaded = dict(pool.map(download, sorted(wanted)))
    current = [path for path in site_files(site) if select(path)]
    for path in current:
        if path not in downloaded:
            (site / path).unlink()
    for path, raw in downloaded.items():
        target = site / path
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(raw)
    return {"status": "restored", "source": "live_site", "files": len(downloaded),
            "bytes": sum(map(len, downloaded.values())), "removed": len(set(current) - set(downloaded)),
            "live_commit": live.get("commit"), "live_built_at": live.get("built_at")}


def fetch_live(path: str, token: str | None = None, fetch=None) -> bytes | None:
    """One file of the live site, or None when it has none."""
    return (fetch or _fetch)(_url(path, token or os.environ.get("GITHUB_RUN_ID") or str(int(time.time()))))


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    commands = parser.add_subparsers(dest="command", required=True)
    command = commands.add_parser("record")
    command.add_argument("site", type=Path)
    command.add_argument("--commit", default="")
    args = parser.parse_args(argv)
    try:
        report = record(args.site.resolve(), args.commit.strip() or None)
    except LiveDataError as error:
        print(json.dumps({"status": "error", "code": error.code}))
        return 1
    print(json.dumps(report))
    return 0


if __name__ == "__main__":
    sys.exit(main())
