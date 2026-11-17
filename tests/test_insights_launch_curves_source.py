"""Launch curves keep refreshing after the Twitch series leave Git."""
import json
from pathlib import Path
import subprocess

import pytest

from radar_core.storage import documents, primary, primary_store
from radar_core.storage.sql import SqliteClient, StorageError
from scripts import publish_radar_insights as insights

SERIES = {"data/twitch_series/index.json": b'{"schema_version": 1}',
          "data/twitch_series/42/2026-11.json": b'{"hours": {}}'}


def fake_builder(calls):
    def run(argv, **kwargs):
        data = Path(argv[argv.index("--data-dir") + 1])
        calls.append({"data": data, "series": sorted(p.relative_to(data).as_posix()
                      for p in (data / "twitch_series").rglob("*.json")),
                      "catalog": (data / "catalog.json").read_bytes()})
        (data / "twitch-launch-curves.json").write_text('{"built_from": "%s"}' % data.name)
        return subprocess.CompletedProcess(argv, 0, "", "")
    return run


@pytest.fixture
def checkout(tmp_path):
    root = tmp_path / "checkout"
    (root / "data").mkdir(parents=True)
    (root / "data/catalog.json").write_bytes(b'{"games": []}')
    return root


def test_series_in_the_checkout_are_used_as_before(checkout, monkeypatch):
    for path, raw in SERIES.items():
        (checkout / path).parent.mkdir(parents=True, exist_ok=True)
        (checkout / path).write_bytes(raw)
    calls = []
    monkeypatch.setattr(insights.subprocess, "run", fake_builder(calls))
    monkeypatch.setattr(insights.primary, "read_files", lambda *a, **k: pytest.fail("no database read needed"))
    insights._launch_curves(checkout)
    assert calls[0]["data"] == checkout / "data"


def test_series_only_in_the_database_build_from_its_copy(checkout, tmp_path, monkeypatch):
    database = SqliteClient(tmp_path / "radar.sqlite")
    documents.initialize(database)
    primary_store.bootstrap_primary(database, f"{insights.VIEWS_REPOSITORY}@{insights.VIEWS_BRANCH}", SERIES, "seed")
    monkeypatch.setattr(primary, "client", lambda: database)
    monkeypatch.setenv("RADAR_DATABASE_PRIMARY", "1")
    calls = []
    monkeypatch.setattr(insights.subprocess, "run", fake_builder(calls))
    insights._launch_curves(checkout)
    assert calls[0]["series"] == ["twitch_series/42/2026-11.json", "twitch_series/index.json"]
    assert calls[0]["catalog"] == b'{"games": []}'
    assert json.loads((checkout / "data/twitch-launch-curves.json").read_text())["built_from"] == "data"
    assert not (checkout / "data/twitch_series").exists()
    database.close()


def test_an_unavailable_database_preserves_the_existing_projection(checkout, monkeypatch, capsys):
    monkeypatch.setenv("RADAR_DATABASE_PRIMARY", "1")
    (checkout / "data/twitch-launch-curves.json").write_text('{"previous": true}')

    def down(*args, **kwargs):
        raise StorageError("SQL_UNAVAILABLE", "down")

    monkeypatch.setattr(insights.primary, "read_files", down)
    insights._launch_curves(checkout)
    assert json.loads((checkout / "data/twitch-launch-curves.json").read_text()) == {"previous": True}
    assert "preserving the existing projection" in capsys.readouterr().err
