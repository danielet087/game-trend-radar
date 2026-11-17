import functools
import http.server
import json
import threading

from scripts import verify_pages_tree as verify


def serve(root):
    handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=str(root))
    handler.log_message = lambda *args: None
    server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return server, f"http://127.0.0.1:{server.server_address[1]}/site"


def test_live_tree_comparison_reports_changes_missing_files_and_skips(tmp_path):
    local = tmp_path / "local"
    served = tmp_path / "served" / "site"
    for root in (local, served):
        (root / "data" / "games").mkdir(parents=True)
        (root / "index.html").write_text("<html>radar</html>", encoding="utf-8")
        (root / "data" / "catalog.json").write_text('{"games": 1}', encoding="utf-8")
        (root / "data" / "games" / "名 稱.json").write_text("{}", encoding="utf-8")
        (root / ".nojekyll").write_text("", encoding="utf-8")
    (local / "data" / "live.json").write_text('{"hour": 2}', encoding="utf-8")
    (served / "data" / "live.json").write_text('{"hour": 1}', encoding="utf-8")
    (local / "data" / "only-local.json").write_text("{}", encoding="utf-8")

    server, base = serve(tmp_path / "served")
    try:
        report_path = tmp_path / "report.json"
        assert verify.main([str(local), base, "--report", str(report_path)]) == 0
    finally:
        server.shutdown()
    results = json.loads(report_path.read_text(encoding="utf-8"))["results"]
    assert ".nojekyll" not in results  # hidden files are never published
    assert results["data/games/名 稱.json"] == "match"
    assert results["data/live.json"] == "mismatch"
    assert results["data/only-local.json"] == "missing"

    summary = verify.evaluate(json.loads(report_path.read_text(encoding="utf-8")), set())
    assert summary["matched"] == 3 and summary["problem_count"] == 2
    skip = tmp_path / "changed.txt"
    skip.write_text("data/live.json\n", encoding="utf-8")
    assert verify.main(["--evaluate", str(report_path), "--skip-list", str(skip)]) == 1
    skip.write_text("data/live.json\ndata/only-local.json\n", encoding="utf-8")
    assert verify.main(["--evaluate", str(report_path), "--skip-list", str(skip)]) == 0
