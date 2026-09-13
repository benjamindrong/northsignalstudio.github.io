#!/usr/bin/env python3
"""CI driver for the HOME-29 production browser harness with sufficient virtual time."""

from __future__ import annotations

import importlib.util
import json
import threading
from functools import partial
from pathlib import Path

HERE = Path(__file__).resolve().parent
HARNESS_PATH = HERE / "test-dashboard-work-items-browser.py"
SPEC = importlib.util.spec_from_file_location("home29_browser_harness", HARNESS_PATH)
if SPEC is None or SPEC.loader is None:
    raise RuntimeError("Unable to load HOME-29 browser harness.")
HARNESS = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(HARNESS)


def main() -> int:
    executable = HARNESS.chrome_path()
    HARNESS.make_fixtures()
    port = HARNESS.free_port()
    handler = partial(HARNESS.QuietHandler, directory=str(HARNESS.ROOT))
    server = HARNESS.ThreadingHTTPServer(("127.0.0.1", port), handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        main_dom = HARNESS.run_chrome(
            executable,
            f"http://127.0.0.1:{port}/dashboard/{HARNESS.MAIN_FIXTURE.name}",
            120000,
        )
        main_result = HARNESS.parse_result(main_dom, "home29PythonResult")
        if not main_result.get("pass"):
            raise RuntimeError("HOME-29 production-path browser gate failed:\n" + json.dumps(main_result, indent=2))

        display_dom = HARNESS.run_chrome(
            executable,
            f"http://127.0.0.1:{port}/dashboard/{HARNESS.DISPLAY_FIXTURE.name}",
            12000,
        )
        display_result = HARNESS.parse_result(display_dom, "home29DisplayPythonResult")
        if not display_result.get("pass"):
            raise RuntimeError("HOME-29 Display Mode browser gate failed:\n" + json.dumps(display_result, indent=2))

        print("HOME-29 CI production-path browser gate: PASS")
        print(json.dumps({"main": main_result, "display": display_result}, indent=2))
        return 0
    finally:
        server.shutdown()
        server.server_close()
        HARNESS.cleanup()


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        HARNESS.cleanup()
        print(f"HOME-29 CI production-path browser gate: FAIL\n{exc}")
        raise SystemExit(1)
