"""Compare or replace the data documents of an assembled Pages site with the database copy.

usage: python scripts/site_data.py SITE_DIR --mode auto --data-commit SHA
       python scripts/site_data.py SITE_DIR --mode verify --data-commit SHA
       python scripts/site_data.py SITE_DIR --mode overlay [--revision DIGEST]

The storage source danielet087/game-trend-radar@main holds every data document
the site serves, except the Twitch views (scripts/site_twitch_views.py adds them).

auto     read data/publication/data_home.json from the database: "site":
         "database" selects overlay, anything else (or no flag) verify. The
         flag is set only with the owner's approval. A database that cannot
         answer, or an invalid flag, stops the deploy: the Twitch views need
         the database at the same point anyway, and the live site keeps its
         previous version.
verify   read the database version that --data-commit (the newest commit that
         changed data/) was projected from, compare it with SITE_DIR's data
         documents and report every difference. SITE_DIR is unchanged and any
         failure only warns, so the deploy still serves the Git copy.
overlay  replace SITE_DIR's data documents with the database's newest version,
         or with the version --revision names (the manifest digest the live
         site's site-build.json records, to rebuild it for comparison), and
         record that version in site-build.json. Any failure stops the deploy,
         so the live site keeps its previous version.

Files already in SITE_DIR are passed as hash-verified cache candidates, so only
changed documents are downloaded. Only names, counts and digests are printed.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import sys

REPOSITORY = "danielet087/game-trend-radar"
BRANCH = "main"
DOCUMENT_SUFFIXES = (".json", ".jsonl", ".ndjson")
# The Twitch views come from their own database-only source.
VIEW_PREFIXES = ("data/twitch_history/", "data/twitch_history_compact/", "data/twitch_history_close/",
                 "data/twitch_series/")
# An overlay without these is not the site's data and must not replace it.
REQUIRED = ("data/catalog.json", "data/twitch_collection_status.json")
BUILD_RECORD = "site-build.json"


def managed(path: str) -> bool:
    return path.startswith("data/") and path.endswith(DOCUMENT_SUFFIXES) and not path.startswith(VIEW_PREFIXES)


def site_documents(site: Path) -> dict[str, bytes]:
    """The site's data documents that the frontend source owns."""
    files = {}
    base = site / "data"
    if base.is_dir():
        for path in sorted(base.rglob("*")):
            relative = path.relative_to(site).as_posix()
            if path.is_symlink():
                raise ValueError("Site data cannot use symlinks")
            if path.is_file() and managed(relative):
                files[relative] = path.read_bytes()
    return files


def database_documents(known: dict[str, bytes], revision: str | None = None):
    from radar_core.storage import primary
    head, files = primary.read_files(REPOSITORY, branch=BRANCH, revision=revision, known_files=known)
    return head, {path: raw for path, raw in files.items() if managed(path)}


def compare(site_files: dict[str, bytes], database_files: dict[str, bytes]) -> dict:
    digest = lambda raw: hashlib.sha256(raw).hexdigest()
    return {
        "only_site": sorted(set(site_files) - set(database_files)),
        "only_database": sorted(set(database_files) - set(site_files)),
        "different": sorted(path for path in set(site_files) & set(database_files)
                            if digest(site_files[path]) != digest(database_files[path])),
    }


def summarize(mode: str, head: dict, site_files: dict, database_files: dict, differences: dict) -> dict:
    return {"mode": mode, "generation": head.get("generation"), "manifest_digest": head.get("manifest_digest"),
            "site_documents": len(site_files), "database_documents": len(database_files),
            "database_bytes": sum(map(len, database_files.values())),
            **{key: len(paths) for key, paths in differences.items()},
            "examples": {key: paths[:10] for key, paths in differences.items() if paths}}


def _code(error: Exception) -> str:
    return getattr(error, "code", None) or type(error).__name__


def verify(site: Path, data_commit: str | None) -> tuple[int, dict]:
    if not data_commit or not re.fullmatch(r"[0-9a-f]{40}", data_commit):
        print("::warning::No data commit to compare; deploying the Git copy unchecked.")
        return 0, {"mode": "verify", "status": "unavailable", "code": "NO_DATA_COMMIT"}
    site_files = site_documents(site)
    try:
        head, database_files = database_documents(site_files, revision=data_commit)
    except Exception as error:
        code = _code(error)
        print(f"::warning::The site data could not be read from the database ({code}); deploying the Git copy.")
        return 0, {"mode": "verify", "status": "unavailable", "code": code, "data_commit": data_commit}
    differences = compare(site_files, database_files)
    report = {**summarize("verify", head, site_files, database_files, differences), "data_commit": data_commit}
    if any(differences.values()):
        print("::warning::Site data in the database differs from Git: " +
              ", ".join(f"{key}={len(paths)}" for key, paths in differences.items()))
        return 0, {**report, "status": "different"}
    return 0, {**report, "status": "verified"}


def overlay(site: Path, revision: str | None = None) -> tuple[int, dict]:
    if revision is not None and not re.fullmatch(r"[0-9a-f]{64}", revision):
        return 1, {"mode": "overlay", "status": "error", "code": "INVALID_REVISION"}
    site_files = site_documents(site)
    try:
        head, database_files = database_documents(site_files, revision=revision)
    except Exception as error:
        return 1, {"mode": "overlay", "status": "error", "code": _code(error)}
    missing = [path for path in REQUIRED if path not in database_files]
    differences = compare(site_files, database_files)
    report = summarize("overlay", head, site_files, database_files, differences)
    if missing:
        return 1, {**report, "status": "error", "code": "NO_DATABASE_DATA", "missing": missing}
    for path in site_files:
        if path not in database_files:
            (site / path).unlink()
    for path, raw in database_files.items():
        target = site / path
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(raw)
    record = {"schema_version": 1, "source": f"{REPOSITORY}@{BRANCH}", "generation": head.get("generation"),
              "manifest_digest": head.get("manifest_digest"), "revision": head.get("revision"),
              "documents": len(database_files), "bytes": report["database_bytes"]}
    (site / BUILD_RECORD).write_text(json.dumps(record, sort_keys=True) + "\n", encoding="utf-8")
    return 0, {**report, "status": "overlaid"}


def selected_mode() -> tuple[str, dict]:
    """overlay when the database's data home flag moves the site to the database."""
    from radar_core.storage import data_home
    head, home, present = data_home.current(REPOSITORY, branch=BRANCH)
    flag = {"site": home["site"], "git_projection": home["git_projection"],
            "flag": "present" if present else "absent", "flag_generation": head.get("generation")}
    return ("overlay" if home["site"] == "database" else "verify"), flag


def run(site: Path, mode: str, data_commit: str | None = None, revision: str | None = None) -> tuple[int, dict]:
    if mode == "auto":
        try:
            mode, flag = selected_mode()
        except Exception as error:
            return 1, {"mode": "auto", "status": "error", "code": _code(error)}
        status, report = run(site, mode, data_commit)
        return status, {**report, "selected_by": flag}
    if mode == "overlay":
        return overlay(site, revision)
    return verify(site, data_commit)


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("site", type=Path)
    parser.add_argument("--mode", choices=("auto", "verify", "overlay"), required=True)
    parser.add_argument("--data-commit", default="")
    parser.add_argument("--revision", default="")
    args = parser.parse_args(argv)
    status, report = run(args.site.resolve(), args.mode, args.data_commit.strip() or None,
                         args.revision.strip() or None)
    text = json.dumps(report, ensure_ascii=False, indent=2)
    print(text)
    summary = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary:
        with open(summary, "a", encoding="utf-8") as stream:
            stream.write(f"### Site data ({report.get('mode', args.mode)})\n\n```json\n{text}\n```\n")
    return status


if __name__ == "__main__":
    sys.exit(main())
