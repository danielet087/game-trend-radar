"""Compare a local site tree with what GitHub Pages serves, file by file.

usage:
  python scripts/verify_pages_tree.py SITE_DIR BASE_URL --report REPORT
  python scripts/verify_pages_tree.py --evaluate REPORT [--skip-list FILE]

The first form downloads every non-hidden file under SITE_DIR from
BASE_URL/<path> and records whether its SHA-256 matches the local bytes. The
second form fails (exit 1) on any mismatch or missing file, except paths in
--skip-list: files a newer deployment changed while the comparison ran.
"""
from __future__ import annotations

import argparse
from concurrent.futures import ThreadPoolExecutor
import hashlib
import json
from pathlib import Path
import sys
import time
from urllib.error import HTTPError, URLError
from urllib.parse import quote
from urllib.request import Request, urlopen

WORKERS = 16
ATTEMPTS = 3


def site_files(root: Path) -> list[str]:
    files = []
    for path in sorted(root.rglob("*")):
        relative = path.relative_to(root)
        if path.is_file() and not any(part.startswith(".") for part in relative.parts):
            files.append(relative.as_posix())
    return files


def fetch_digest(url: str) -> tuple[str | None, str | None]:
    # Identity encoding: the bytes on the wire are the bytes Pages stores.
    request = Request(url, headers={"Accept-Encoding": "identity", "Cache-Control": "no-cache",
                                    "User-Agent": "game-trend-radar-pages-verify"})
    problem = "unavailable"
    for attempt in range(ATTEMPTS):
        try:
            with urlopen(request, timeout=60) as response:
                digest = hashlib.sha256()
                for block in iter(lambda: response.read(1 << 20), b""):
                    digest.update(block)
                return digest.hexdigest(), None
        except HTTPError as error:
            if error.code == 404:
                return None, "missing"
            problem = f"http_{error.code}"
        except (URLError, TimeoutError, OSError) as error:
            problem = type(error).__name__
        time.sleep(2 * (attempt + 1))
    return None, problem


def compare(root: Path, base_url: str) -> dict:
    files = site_files(root)
    base = base_url.rstrip("/") + "/"

    def check(name: str) -> tuple[str, str]:
        local = hashlib.sha256((root / name).read_bytes()).hexdigest()
        remote, problem = fetch_digest(base + quote(name))
        return name, problem or ("match" if remote == local else "mismatch")

    with ThreadPoolExecutor(WORKERS) as pool:
        results = dict(pool.map(check, files))
    return {"bytes": sum((root / name).stat().st_size for name in files), "results": results}


def evaluate(report: dict, skip: set[str]) -> dict:
    results = report["results"]
    problems = {name: state for name, state in sorted(results.items()) if state != "match" and name not in skip}
    return {"files": len(results), "bytes": report["bytes"],
            "matched": sum(state == "match" for state in results.values()),
            "skipped_changed_meanwhile": sorted(name for name in results if name in skip),
            "problem_count": len(problems), "problems": dict(list(problems.items())[:50])}


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("site", type=Path, nargs="?")
    parser.add_argument("base_url", nargs="?")
    parser.add_argument("--report", type=Path)
    parser.add_argument("--evaluate", type=Path)
    parser.add_argument("--skip-list", type=Path)
    args = parser.parse_args(argv)
    if args.evaluate:
        skip = set(filter(None, args.skip_list.read_text(encoding="utf-8").splitlines())) if args.skip_list else set()
        summary = evaluate(json.loads(args.evaluate.read_text(encoding="utf-8")), skip)
        print(json.dumps(summary, ensure_ascii=False, indent=2))
        return 1 if summary["problem_count"] else 0
    if not (args.site and args.base_url and args.report):
        parser.error("SITE_DIR, BASE_URL and --report are required to compare")
    report = compare(args.site.resolve(), args.base_url)
    args.report.write_text(json.dumps(report, ensure_ascii=False), encoding="utf-8")
    states = list(report["results"].values())
    print(f"compared {len(states)} files: {states.count('match')} match, {len(states) - states.count('match')} differ")
    return 0


if __name__ == "__main__":
    sys.exit(main())
