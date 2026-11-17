import contextlib
import functools
import http.server
import io
import json
from pathlib import Path
from tempfile import TemporaryDirectory
import threading
import unittest

from scripts import verify_pages_tree as verify


def serve(root):
    handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=str(root))
    handler.log_message = lambda *args: None
    server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return server, f"http://127.0.0.1:{server.server_address[1]}/site"


class VerifyPagesTreeTests(unittest.TestCase):
    def test_live_tree_comparison_reports_changes_missing_files_and_skips(self):
        with TemporaryDirectory() as temporary:
            tmp = Path(temporary)
            local, served = tmp / "local", tmp / "served" / "site"
            for root in (local, served):
                (root / "data" / "games").mkdir(parents=True)
                (root / "index.html").write_text("<html>radar</html>", encoding="utf-8")
                (root / "data" / "catalog.json").write_text('{"games": 1}', encoding="utf-8")
                (root / "data" / "games" / "名 稱.json").write_text("{}", encoding="utf-8")
                (root / ".nojekyll").write_text("", encoding="utf-8")
            (local / "data" / "live.json").write_text('{"hour": 2}', encoding="utf-8")
            (served / "data" / "live.json").write_text('{"hour": 1}', encoding="utf-8")
            (local / "data" / "only-local.json").write_text("{}", encoding="utf-8")

            server, base = serve(tmp / "served")
            report_path = tmp / "report.json"
            try:
                with contextlib.redirect_stdout(io.StringIO()):
                    self.assertEqual(verify.main([str(local), base, "--report", str(report_path)]), 0)
            finally:
                server.shutdown()
            results = json.loads(report_path.read_text(encoding="utf-8"))["results"]
            self.assertNotIn(".nojekyll", results)  # hidden files are never published
            self.assertEqual(results["data/games/名 稱.json"], "match")
            self.assertEqual(results["data/live.json"], "mismatch")
            self.assertEqual(results["data/only-local.json"], "missing")

            summary = verify.evaluate(json.loads(report_path.read_text(encoding="utf-8")), set())
            self.assertEqual((summary["matched"], summary["problem_count"]), (3, 2))
            skip = tmp / "changed.txt"
            with contextlib.redirect_stdout(io.StringIO()):
                skip.write_text("data/live.json\n", encoding="utf-8")
                self.assertEqual(verify.main(["--evaluate", str(report_path), "--skip-list", str(skip)]), 1)
                skip.write_text("data/live.json\ndata/only-local.json\n", encoding="utf-8")
                self.assertEqual(verify.main(["--evaluate", str(report_path), "--skip-list", str(skip)]), 0)


if __name__ == "__main__":
    unittest.main()
