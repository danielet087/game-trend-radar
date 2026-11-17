import json

import pytest

from radar_core.storage import documents, primary, primary_store
from radar_core.storage.sql import SqliteClient
from scripts import site_twitch_views as views

SOURCE = views.REPOSITORY + "@" + views.BRANCH
DATABASE = {
    "data/twitch_history/2026-11-17.json": b'{"hours": [1, 2]}',
    "data/twitch_history_compact/2026-11-17.json": b'{"games": {"1": 2}}',
    "data/twitch_series/index.json": b'{"games": {}}',
}


@pytest.fixture
def database(tmp_path, monkeypatch):
    client = SqliteClient(tmp_path / "radar.sqlite")
    documents.initialize(client)
    primary_store.bootstrap_primary(client, SOURCE, DATABASE, "seed")
    monkeypatch.setattr(primary, "client", lambda: client)
    yield client
    client.close()


def site(tmp_path, files):
    root = tmp_path / "site"
    for path, raw in {"index.html": b"<html>", "data/catalog.json": b"{}", **files}.items():
        (root / path).parent.mkdir(parents=True, exist_ok=True)
        (root / path).write_bytes(raw)
    return root


def test_verify_reports_every_difference_and_changes_nothing(database, tmp_path, capsys):
    root = site(tmp_path, {
        "data/twitch_history/2026-11-17.json": b'{"hours": [1]}',          # older than the database
        "data/twitch_history_compact/2026-11-17.json": DATABASE["data/twitch_history_compact/2026-11-17.json"],
        "data/twitch_history_close/2026-11-16.json": b'{"close": 1}',      # only in Git
    })
    before = views.site_views(root)
    status, report = views.run(root, "verify")
    assert status == 0 and report["status"] == "different"
    assert (report["only_git"], report["only_database"], report["different"]) == (1, 1, 1)
    assert report["examples"]["different"] == ["data/twitch_history/2026-11-17.json"]
    assert views.site_views(root) == before
    assert "differ from Git" in capsys.readouterr().out


def test_verify_of_an_identical_copy_and_overlay_replace_git_files(database, tmp_path):
    root = site(tmp_path, DATABASE)
    assert views.run(root, "verify")[1]["status"] == "verified"
    stale = site(tmp_path / "other", {"data/twitch_history_close/2026-11-16.json": b"{}"})
    status, report = views.run(stale, "overlay")
    assert status == 0 and report["status"] == "overlaid"
    assert views.site_views(stale) == DATABASE
    assert (stale / "data/catalog.json").read_bytes() == b"{}"


def test_an_unreachable_database_only_warns_in_verify_and_stops_an_overlay(tmp_path, monkeypatch, capsys):
    def unreachable(*args, **kwargs):
        raise type("StorageError", (Exception,), {"code": "SQL_UNAVAILABLE"})("down")

    monkeypatch.setattr(primary, "read_files", unreachable)
    root = site(tmp_path, DATABASE)
    assert views.run(root, "verify") == (0, {"mode": "verify", "status": "unavailable", "code": "SQL_UNAVAILABLE"})
    assert "deploying the Git copy" in capsys.readouterr().out
    assert views.run(root, "overlay")[0] == 1
    assert views.site_views(root) == DATABASE


def test_main_writes_the_report_to_the_job_summary(database, tmp_path, monkeypatch):
    summary = tmp_path / "summary.md"
    monkeypatch.setenv("GITHUB_STEP_SUMMARY", str(summary))
    assert views.main([str(site(tmp_path, DATABASE)), "--mode", "verify"]) == 0
    text = summary.read_text(encoding="utf-8")
    assert "### Twitch views (verify)" in text
    assert json.loads(text.split("```json\n")[1].split("\n```")[0])["status"] == "verified"
