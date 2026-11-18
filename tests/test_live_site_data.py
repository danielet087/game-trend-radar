"""The data record every deploy publishes, and the restore from the live site."""
import contextlib
import hashlib
import io
import json
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest

from scripts import live_site_data as live

LIVE = {
    "data/catalog.json": b'{"games": [1, 2]}',
    "data/twitch_collection_status.json": b'{"schema_version": 1}',
    "data/games/1.json": b'{"appid": 1}',
    "data/twitch_series/index.json": b'{"games": []}',
    "data/README.md": b"notes",
}


def write(root: Path, files: dict[str, bytes]) -> Path:
    for path, raw in files.items():
        (root / path).parent.mkdir(parents=True, exist_ok=True)
        (root / path).write_bytes(raw)
    return root


def documents(root: Path) -> dict[str, bytes]:
    return {path.relative_to(root).as_posix(): path.read_bytes()
            for path in sorted((root / "data").rglob("*")) if path.is_file()}


class LiveSite:
    """A fake live site: its data files plus the record its deploy wrote."""

    def __init__(self, tmp: Path, files=LIVE):
        self.root = write(tmp / "live", files)
        with contextlib.redirect_stdout(io.StringIO()):
            live.record(self.root, "c" * 40)
        self.overrides, self.requests = {}, []

    def fetch(self, url: str):
        self.requests.append(url)
        self.assert_cache_busted(url)
        path = url[len(live.LIVE_SITE):].split("?")[0]
        if path in self.overrides:
            return self.overrides[path]
        target = self.root / path
        return target.read_bytes() if target.is_file() else None

    @staticmethod
    def assert_cache_busted(url: str):
        if "?deploy=" not in url:
            raise AssertionError("live reads must bypass caches")


def is_data(path: str) -> bool:
    return path.endswith(".json") and not path.startswith("data/twitch_series/")


class RecordTests(unittest.TestCase):
    def setUp(self):
        self.temporary = TemporaryDirectory()
        self.tmp = Path(self.temporary.name)
        self.addCleanup(self.temporary.cleanup)

    def test_record_lists_every_data_file_with_its_digest(self):
        root = write(self.tmp / "site", {**LIVE, "index.html": b"<html>"})
        report = live.record(root, "c" * 40)
        self.assertEqual((report["status"], report["files"]), ("recorded", len(LIVE)))
        value = json.loads((root / live.RECORD).read_text())
        self.assertEqual((value["schema_version"], value["commit"]), (1, "c" * 40))
        self.assertEqual(value["files"]["data/catalog.json"],
                         {"sha256": hashlib.sha256(LIVE["data/catalog.json"]).hexdigest(),
                          "bytes": len(LIVE["data/catalog.json"])})
        self.assertNotIn("index.html", value["files"])

    def test_record_refuses_symlinks(self):
        root = write(self.tmp / "site", LIVE)
        (root / "data/link.json").symlink_to(root / "data/catalog.json")
        with self.assertRaises(live.LiveDataError) as raised:
            live.record(root)
        self.assertEqual(raised.exception.code, "SYMLINK")


class RestoreTests(unittest.TestCase):
    def setUp(self):
        self.temporary = TemporaryDirectory()
        self.tmp = Path(self.temporary.name)
        self.addCleanup(self.temporary.cleanup)
        self.live = LiveSite(self.tmp)
        # The new build: older Git data, one file the live site no longer has, other files untouched.
        self.site = write(self.tmp / "site", {
            "index.html": b"<html>new code</html>", "data/catalog.json": b'{"games": [1]}',
            "data/games/9.json": b'{"appid": 9}', "data/README.md": b"new notes",
            "data/twitch_series/index.json": b'{"games": ["git"]}'})

    def restore(self, **options):
        return live.restore(self.site, is_data, fetch=self.live.fetch, token="run-1", **options)

    def test_restores_exactly_the_live_files_that_are_selected(self):
        report = self.restore(required=("data/catalog.json",))
        self.assertEqual((report["status"], report["files"], report["removed"]), ("restored", 3, 1))
        self.assertEqual(report["live_commit"], "c" * 40)
        restored = documents(self.site)
        for path in ("data/catalog.json", "data/twitch_collection_status.json", "data/games/1.json"):
            self.assertEqual(restored[path], LIVE[path])
        self.assertNotIn("data/games/9.json", restored)
        # Unselected files keep the new build's bytes.
        self.assertEqual(restored["data/README.md"], b"new notes")
        self.assertEqual(restored["data/twitch_series/index.json"], b'{"games": ["git"]}')
        self.assertEqual((self.site / "index.html").read_bytes(), b"<html>new code</html>")
        self.assertTrue(all(url.endswith("?deploy=run-1") for url in self.live.requests))

    def test_any_mismatch_or_gap_changes_nothing(self):
        before = documents(self.site)
        cases = {
            "LIVE_DATA_CHANGED": {"data/games/1.json": b'{"appid": 2}'},
            "INCOMPLETE_LIVE_DATA": {},
            "NO_LIVE_RECORD": {live.RECORD: None},
            "INVALID_LIVE_RECORD": {live.RECORD: json.dumps(
                {"schema_version": 1, "files": {"../etc/passwd": {"sha256": "0" * 64, "bytes": 1}}}).encode()},
        }
        for code, overrides in cases.items():
            with self.subTest(code=code):
                self.live.overrides = overrides
                required = ("data/missing.json",) if code == "INCOMPLETE_LIVE_DATA" else ()
                with self.assertRaises(live.LiveDataError) as raised:
                    self.restore(required=required)
                self.assertEqual(raised.exception.code, code)
                self.assertEqual(documents(self.site), before)

    def test_a_missing_live_file_is_a_mismatch(self):
        self.live.overrides = {"data/games/1.json": None}
        with self.assertRaises(live.LiveDataError) as raised:
            self.restore()
        self.assertEqual(raised.exception.code, "LIVE_DATA_CHANGED")

    def test_safe_paths(self):
        for path, expected in (("data/a.json", True), ("data/x/../a.json", False), ("/data/a.json", False),
                               ("data/./a.json", False), ("other/a.json", False), ("data\\a.json", False)):
            with self.subTest(path=path):
                self.assertIs(live._safe(path), expected)


class FetchTests(unittest.TestCase):
    def test_transient_failures_retry_and_404_means_absent(self):
        import urllib.error
        from unittest.mock import patch

        calls = []

        class Response(io.BytesIO):
            def __enter__(self):
                return self

            def __exit__(self, *args):
                return False

        def urlopen(request, timeout):
            calls.append(request.full_url)
            if len(calls) == 1:
                raise urllib.error.HTTPError(request.full_url, 503, "busy", {}, None)
            if "missing" in request.full_url:
                raise urllib.error.HTTPError(request.full_url, 404, "missing", {}, None)
            return Response(b"body")

        with patch.object(live.urllib.request, "urlopen", urlopen), patch.object(live.time, "sleep", lambda s: None):
            self.assertEqual(live._fetch(live.LIVE_SITE + "data/a.json?deploy=1"), b"body")
            self.assertIsNone(live._fetch(live.LIVE_SITE + "data/missing.json?deploy=1"))
        self.assertEqual(len(calls), 3)

        def forbidden(request, timeout):
            raise urllib.error.HTTPError(request.full_url, 403, "no", {}, None)

        with patch.object(live.urllib.request, "urlopen", forbidden):
            with self.assertRaises(live.LiveDataError) as raised:
                live._fetch(live.LIVE_SITE + "data/a.json")
        self.assertEqual(raised.exception.code, "LIVE_SITE_UNAVAILABLE")


if __name__ == "__main__":
    unittest.main()
