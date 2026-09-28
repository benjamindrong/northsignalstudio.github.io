#!/usr/bin/env python3
"""Production-browser regression for Benchmark Review disclosure persistence."""

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

FIXTURE = HARNESS.DASHBOARD / "benchmark-review-disclosure-test.html"

DRIVER = r'''<script>
(async () => {
  'use strict';
  const result = document.createElement('pre');
  result.id = 'benchmarkDisclosureResult';
  document.body.appendChild(result);
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
  const tick = async () => { await Promise.resolve(); await wait(0); await Promise.resolve(); };
  const fail = message => { throw new Error(message); };

  try {
    await window.__home29Fixture.keyReady;
    const form = document.getElementById('unlockForm');
    const input = document.getElementById('unlockPassphrase');
    input.value = 'home29-local-verification';
    form.dispatchEvent(new Event('submit', { bubbles:true, cancelable:true }));

    for (let i = 0; i < 80 && !document.querySelector('.benchmark-ideas'); i++) await wait(25);
    let ideas = document.querySelector('.benchmark-ideas');
    if (!ideas) fail('Idea backlog did not render through the production dashboard.');
    if (ideas.open) fail('Idea backlog must start collapsed.');

    ideas.querySelector('summary')?.click();
    await tick();
    if (!ideas.open) fail('Idea backlog did not open from the native disclosure control.');
    const firstIdeas = ideas;

    window.__home29Fixture.revision = 1;
    await window.dashboardRefresh();
    await tick();
    ideas = document.querySelector('.benchmark-ideas');
    if (!ideas) fail('Idea backlog disappeared after dashboardRefresh().');
    if (ideas !== firstIdeas) fail('Unchanged Benchmark Review data must not reconstruct the Idea Backlog during refresh.');
    if (!ideas.open) fail('Idea backlog closed after dashboardRefresh().');

    ideas.querySelector('summary')?.click();
    await tick();
    if (ideas.open) fail('Idea backlog did not close from the native disclosure control.');
    const closedIdeas = ideas;

    window.__home29Fixture.revision = 2;
    await window.dashboardRefresh();
    await tick();
    ideas = document.querySelector('.benchmark-ideas');
    if (!ideas) fail('Idea backlog disappeared after the second dashboardRefresh().');
    if (ideas !== closedIdeas) fail('Unchanged Benchmark Review data must preserve the existing Idea Backlog DOM node.');
    if (ideas.open) fail('Closed Idea Backlog state was not preserved after dashboardRefresh().');

    const retainedMessage = 'Current BEN registry validation failed; showing last-known-good Benchmark Review data.';
    window.DashboardBenchmarkReview.render({
      state:'retained',
      authority:'jira-native',
      sourceKey:'BEN',
      sourceLabel:'Jira-native BEN registry',
      message:retainedMessage,
      selectedNext:{ key:'BEN-54', status:'Preparing' },
      pointerError:'',
      invalidRecords:[],
      runs:[
        { key:'BEN-34', title:'Retained active benchmark', source:'Homepage Dashboard', activityKind:'candidate-evaluation', type:'Candidate Evaluation', status:'Running', statusRaw:'Running', resultState:'none', resultLines:[] },
        { key:'BEN-54', title:'Retained next benchmark', source:'Homepage Dashboard', activityKind:'benchmark-testing', type:'Application Benchmark Testing', status:'Preparing', statusRaw:'Preparing', resultState:'none', resultLines:[] }
      ],
      previouslyConsidered:[],
      freshBacklog:[]
    });
    await tick();
    const retainedWarning = document.querySelector('.benchmark-retained-warning');
    if (!retainedWarning || retainedWarning.textContent !== retainedMessage) fail('Retained Benchmark Review validation warning was not rendered.');
    if (!document.querySelector('[data-benchmark-key="BEN-34"]')) fail('Retained last-known-good Benchmark Review records were not rendered.');
    if (document.querySelector('.benchmark-invalid')) fail('Retained Benchmark Review must not render current invalid registry records.');
    if (!document.getElementById('benchmarkSource')?.textContent.includes('retained')) fail('Retained Benchmark Review source metadata was not marked retained.');

    document.documentElement.dataset.benchmarkDisclosure = 'pass';
    result.textContent = JSON.stringify({
      pass:true,
      productionRefresh:true,
      unchangedRegistryNodePreserved:true,
      openStatePreserved:true,
      closedStatePreserved:true,
      retainedWarningVisible:true,
      retainedRecordsVisible:true
    });
  } catch (error) {
    document.documentElement.dataset.benchmarkDisclosure = 'fail';
    result.textContent = JSON.stringify({
      pass:false,
      error:String(error?.stack || error),
      revision:window.__home29Fixture?.revision,
      refreshState:window.dashboardRefreshState?.()
    });
  }
})();
</script>'''


def cleanup() -> None:
    try:
        FIXTURE.unlink()
    except FileNotFoundError:
        pass


def make_fixture() -> None:
    index_html = HARNESS.INDEX.read_text(encoding="utf-8")
    HARNESS.assert_production_markers(index_html)
    work_items_marker = '<script src="./work-items.js"></script>'
    html = HARNESS.inject_before(index_html, work_items_marker, HARNESS.FETCH_STUB)
    html = HARNESS.inject_before_body_end(html, DRIVER)
    FIXTURE.write_text(html, encoding="utf-8")


def main() -> int:
    executable = HARNESS.chrome_path()
    make_fixture()
    port = HARNESS.free_port()
    handler = partial(HARNESS.QuietHandler, directory=str(HARNESS.ROOT))
    server = HARNESS.ThreadingHTTPServer(("127.0.0.1", port), handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        dom = HARNESS.run_chrome(
            executable,
            f"http://127.0.0.1:{port}/dashboard/{FIXTURE.name}",
            12000,
        )
        outcome = HARNESS.parse_result(dom, "benchmarkDisclosureResult")
        if not outcome.get("pass"):
            raise RuntimeError("Benchmark Review disclosure browser regression failed:\n" + json.dumps(outcome, indent=2))
        print("Benchmark Review disclosure production-browser regression: PASS")
        print(json.dumps(outcome, indent=2))
        return 0
    finally:
        server.shutdown()
        server.server_close()
        cleanup()


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        cleanup()
        print(f"Benchmark Review disclosure production-browser regression: FAIL\n{exc}")
        raise SystemExit(1)
