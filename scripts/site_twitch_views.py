"""Add the database-only Twitch views to an assembled Pages site.

usage: python scripts/site_twitch_views.py SITE_DIR --mode verify|overlay

The raw day files, 24-hour compact views, closing views and per-game series
live in the storage source danielet087/game-trend-radar@twitch-views, which is
never projected to Git.

verify   compare the database copy with the files Git put in SITE_DIR and report
         every difference; SITE_DIR is unchanged and a failure only warns.
overlay  replace SITE_DIR's view files with the database copy; any failure
         stops the deploy, so the live site keeps its previous version.

Files already in SITE_DIR are passed as hash-verified cache candidates, so only
changed documents are downloaded. Only names, counts and digests are printed.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import sys

REPOSITORY = "danielet087/game-trend-radar"
BRANCH = "twitch-views"
PREFIXES = ("data/twitch_history/", "data/twitch_history_compact/", "data/twitch_history_close/",
            "data/twitch_series/")


def site_views(site: Path) -> dict[str, bytes]:
    files = {}
    for prefix in PREFIXES:
        base = site / prefix
        if base.is_dir():
            for path in sorted(base.rglob("*.json")):
                if path.is_symlink():
                    raise ValueError("Twitch views cannot use symlinks")
                files[path.relative_to(site).as_posix()] = path.read_bytes()
    return files


def database_views(known: dict[str, bytes]):
    from radar_core.storage import primary
    head, files = primary.read_files(REPOSITORY, paths=PREFIXES, branch=BRANCH, known_files=known)
    if any(not path.startswith(PREFIXES) or not path.endswith(".json") for path in files):
        raise ValueError("The views source holds a document outside its directories")
    return head, files


def compare(git_files: dict[str, bytes], database_files: dict[str, bytes]) -> dict:
    digest = lambda raw: hashlib.sha256(raw).hexdigest()
    return {
        "only_git": sorted(set(git_files) - set(database_files)),
        "only_database": sorted(set(database_files) - set(git_files)),
        "different": sorted(path for path in set(git_files) & set(database_files)
                            if digest(git_files[path]) != digest(database_files[path])),
    }


def overlay(site: Path, database_files: dict[str, bytes]) -> None:
    for path in site_views(site):
        (site / path).unlink()
    for path, raw in database_files.items():
        target = site / path
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(raw)


def summarize(mode: str, head: dict, git_files: dict, database_files: dict, differences: dict) -> dict:
    return {"mode": mode, "generation": head["generation"], "git_files": len(git_files),
            "database_files": len(database_files),
            "database_bytes": sum(map(len, database_files.values())),
            **{key: len(paths) for key, paths in differences.items()},
            "examples": {key: paths[:10] for key, paths in differences.items() if paths}}


def run(site: Path, mode: str) -> tuple[int, dict]:
    git_files = site_views(site)
    try:
        head, database_files = database_views(git_files)
    except Exception as error:
        code = getattr(error, "code", type(error).__name__)
        if mode == "overlay":
            return 1, {"mode": mode, "status": "error", "code": code}
        print(f"::warning::Twitch views could not be read from the database ({code}); deploying the Git copy.")
        return 0, {"mode": mode, "status": "unavailable", "code": code}
    differences = compare(git_files, database_files)
    report = summarize(mode, head, git_files, database_files, differences)
    if mode == "overlay":
        if not database_files:
            return 1, {**report, "status": "error", "code": "NO_DATABASE_VIEWS"}
        overlay(site, database_files)
        return 0, {**report, "status": "overlaid"}
    if any(differences.values()):
        print("::warning::Twitch views in the database differ from Git: " +
              ", ".join(f"{key}={len(paths)}" for key, paths in differences.items()))
    return 0, {**report, "status": "verified" if not any(differences.values()) else "different"}


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("site", type=Path)
    parser.add_argument("--mode", choices=("verify", "overlay"), required=True)
    args = parser.parse_args(argv)
    status, report = run(args.site.resolve(), args.mode)
    text = json.dumps(report, ensure_ascii=False, indent=2)
    print(text)
    summary = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary:
        with open(summary, "a", encoding="utf-8") as stream:
            stream.write(f"### Twitch views ({args.mode})\n\n```json\n{text}\n```\n")
    return status


if __name__ == "__main__":
    sys.exit(main())
