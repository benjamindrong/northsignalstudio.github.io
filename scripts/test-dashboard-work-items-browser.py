#!/usr/bin/env python3
"""HOME-29 production-path browser verification using only Python stdlib + Chrome/Chromium."""

from __future__ import annotations

import json
import os
import shutil
import socket
import subprocess
import sys
import threading
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DASHBOARD = ROOT / "dashboard"
INDEX = DASHBOARD / "index.html"
DISPLAY = DASHBOARD / "display.html"
PASS_PHRASE = "home29-local-verification"

MAIN_FIXTURE = DASHBOARD / "home29-test-index-python.html"
DISPLAY_CHILD_FIXTURE = DASHBOARD / "home29-test-index-display-python.html"
DISPLAY_FIXTURE = DASHBOARD / "home29-test-display-python.html"
GENERATED = (MAIN_FIXTURE, DISPLAY_CHILD_FIXTURE, DISPLAY_FIXTURE)


def fail(message: str) -> None:
    raise RuntimeError(message)


def chrome_path() -> str:
    candidates = [
        shutil.which("google-chrome"),
        shutil.which("google-chrome-stable"),
        shutil.which("chromium"),
        shutil.which("chromium-browser"),
        "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
        str(Path.home() / "Applications/Google Chrome.app/Contents/MacOS/Google Chrome"),
        "/Applications/Chromium.app/Contents/MacOS/Chromium",
        str(Path.home() / "Applications/Chromium.app/Contents/MacOS/Chromium"),
        "/Applications/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing",
    ]
    for candidate in candidates:
        if candidate and Path(candidate).is_file() and os.access(candidate, os.X_OK):
            return candidate
    fail("Chrome/Chromium was not found. Install Google Chrome or make a Chrome/Chromium executable available.")


def assert_production_markers(index_html: str) -> None:
    work_items = '<script src="./work-items.js"></script>'
    refresh_health = '<script src="./refresh-health.js"></script>'
    if work_items not in index_html:
        fail("dashboard/index.html does not load ./work-items.js; HOME-29 production wiring is not present yet.")
    if refresh_health not in index_html:
        fail("dashboard/index.html does not load ./refresh-health.js.")
    if index_html.index(work_items) > index_html.index(refresh_health):
        fail("dashboard/index.html must load work-items.js before refresh-health.js.")
    for marker in ("DashboardWorkItems", "renderFlight", "renderGithub", "renderRecent"):
        if marker not in index_html:
            fail(f"dashboard/index.html is missing HOME-29 production marker: {marker}")


def inject_before(html: str, marker: str, injected: str) -> str:
    if marker not in html:
        fail(f"Fixture injection marker not found: {marker}")
    return html.replace(marker, injected + "\n" + marker, 1)


def inject_before_body_end(html: str, injected: str) -> str:
    if "</body>" not in html:
        fail("HTML fixture has no </body> marker.")
    return html.replace("</body>", injected + "\n</body>", 1)


FETCH_STUB = r'''<script>
(() => {
  'use strict';
  const PASS = 'home29-local-verification';
  const text = new TextEncoder();
  const fixedSalt = Uint8Array.from([11,22,33,44,55,66,77,88,99,110,121,132,143,154,165,176]);
  const fixedIv = Uint8Array.from([1,3,5,7,9,11,13,15,17,19,21,23]);
  const b64 = bytes => btoa(String.fromCharCode(...bytes));
  const iso = minute => `2026-09-03T18:${String(minute).padStart(2,'0')}:00Z`;
  const jiraUrl = key => `https://example.atlassian.net/browse/${key}`;
  const prUrl = number => `https://github.com/benjamindrong/northsignalstudio.github.io/pull/${number}`;
  const longJira = 'HOME-29 long summary proving expanded Jira content wraps completely without ellipsis across compact dashboard presentation.';
  const longPr = 'HOME-23 long pull request title proving expanded GitHub content remains readable and fully visible on compact presentation.';

  const baseIssues = () => [
    { key:'HOME-29', projectKey:'HOME', projectName:'Homepage Dashboard', summary:longJira, status:'In Progress', statusCategory:'indeterminate', lastMove:iso(10), updatedAt:iso(10), url:jiraUrl('HOME-29') },
    { key:'HOME-23', projectKey:'HOME', projectName:'Homepage Dashboard', summary:'Linked Jira ticket preserving compact identity and counterpart navigation', status:'In Review', statusCategory:'indeterminate', lastMove:iso(9), updatedAt:iso(9), url:jiraUrl('HOME-23') },
    { key:'HOME-27', projectKey:'HOME', projectName:'Homepage Dashboard', summary:'Existing recently done row keeps header identity stable', status:'Done', statusCategory:'done', lastMove:iso(8), updatedAt:iso(8), url:jiraUrl('HOME-27') },
    { key:'HOME-30', projectKey:'HOME', projectName:'Homepage Dashboard', summary:'Row removed by later revision', status:'To Do', statusCategory:'new', lastMove:iso(7), updatedAt:iso(7), url:jiraUrl('HOME-30') },
    ...Array.from({length:16}, (_, i) => ({ key:`MYR-${300+i}`, projectKey:'MYR', projectName:'MyRAM', summary:`Filler row ${i} for deterministic scroll preservation`, status:'To Do', statusCategory:'new', lastMove:iso(6), updatedAt:iso(6), url:jiraUrl(`MYR-${300+i}`) }))
  ];

  function jiraPayload(revision) {
    const issues = baseIssues();
    if (revision >= 1) {
      const home29 = issues.find(issue => issue.key === 'HOME-29');
      home29.summary = revision >= 5 ? `${longJira} Automatic refresh revision 5.` : `${longJira} Updated in place.`;
      home29.status = 'Done';
      home29.statusCategory = 'done';
      home29.lastMove = iso(20 + revision);
      home29.updatedAt = iso(20 + revision);
      const removeIndex = issues.findIndex(issue => issue.key === 'HOME-30');
      issues.splice(removeIndex, 1);
      issues.push({ key:'HOME-32', projectKey:'HOME', projectName:'Homepage Dashboard', summary:'Inserted row', status:'Blocked', statusCategory:'indeterminate', lastMove:iso(29), updatedAt:iso(29), url:jiraUrl('HOME-32') });
    }
    return { generatedAt: iso(30 + revision), projects:['HOME','MYR'], issues, benchmarkReview:{ state:'unavailable', message:'HOME-29 local browser fixture' } };
  }

  function githubPayload(revision) {
    const linkNumber = revision >= 2 ? 8 : 7;
    const linkedTitle = revision >= 3 ? 'Relationship removed from this pull request title' : longPr;
    const pulls = [
      { repository:'benjamindrong/northsignalstudio.github.io', number:linkNumber, title:linkedTitle, url:prUrl(linkNumber), state:'OPEN', stateClass:'review', attentionRank:1, updatedAt:iso(12 + revision) },
      { repository:'benjamindrong/HomepageDashboard', number:40, title:'Independent PR row retained during refresh', url:'https://github.com/benjamindrong/HomepageDashboard/pull/40', state:'OPEN', stateClass:'progress', attentionRank:2, updatedAt:iso(11 + revision) },
    ];
    if (revision >= 1) pulls.push({ repository:'benjamindrong/northsignalstudio.github.io', number:29, title:'HOME-29 relationship appears after refresh', url:prUrl(29), state:'OPEN', stateClass:'review', attentionRank:0, updatedAt:iso(28 + revision) });
    if (revision >= 4) pulls.push({ repository:'benjamindrong/HomepageDashboard', number:99, title:'Automatic refresh inserted PR', url:'https://github.com/benjamindrong/HomepageDashboard/pull/99', state:'OPEN', stateClass:'todo', attentionRank:0, updatedAt:iso(39) });
    return { generatedAt: iso(31 + revision), pullRequests: pulls };
  }

  const state = window.__home29Fixture = { revision:0, jiraFail:false, githubFail:false, requests:[] };
  const keyPromise = (async () => {
    const material = await crypto.subtle.importKey('raw', text.encode(PASS), 'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey({ name:'PBKDF2', hash:'SHA-256', salt:fixedSalt, iterations:1000 }, material, { name:'AES-GCM', length:256 }, false, ['encrypt']);
  })();
  state.keyReady = keyPromise;

  async function encrypt(payload) {
    const key = await keyPromise;
    const bytes = new Uint8Array(await crypto.subtle.encrypt({ name:'AES-GCM', iv:fixedIv, tagLength:128 }, key, text.encode(JSON.stringify(payload))));
    const tag = bytes.slice(bytes.length - 16);
    const ciphertext = bytes.slice(0, bytes.length - 16);
    return { iterations:1000, salt:b64(fixedSalt), iv:b64(fixedIv), ciphertext:b64(ciphertext), tag:b64(tag) };
  }

  const jsonResponse = value => new Response(JSON.stringify(value), { status:200, headers:{'Content-Type':'application/json'} });
  const realFetch = window.fetch.bind(window);
  window.fetch = async (input, init) => {
    const raw = typeof input === 'string' ? input : input.url;
    const url = new URL(raw, location.href);
    state.requests.push(url.pathname);
    if (url.pathname.endsWith('/jira-flight-control.config.json')) return jsonResponse({ dataUrl:'./home29-test-jira.enc.json' });
    if (url.pathname.endsWith('/github-prs.config.json')) return jsonResponse({ dataUrl:'./home29-test-github.enc.json' });
    if (url.pathname.endsWith('/home29-test-jira.enc.json')) {
      if (state.jiraFail) return new Response('controlled Jira failure', {status:503});
      return jsonResponse(await encrypt(jiraPayload(state.revision)));
    }
    if (url.pathname.endsWith('/home29-test-github.enc.json')) {
      if (state.githubFail) return new Response('controlled GitHub failure', {status:503});
      return jsonResponse(await encrypt(githubPayload(state.revision)));
    }
    return realFetch(input, init);
  };
})();
</script>'''


MAIN_DRIVER = r'''<script>
(async () => {
  'use strict';
  const result = document.createElement('pre');
  result.id = 'home29PythonResult';
  document.body.appendChild(result);
  const checks = {};
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
  const tick = async () => { await Promise.resolve(); await wait(0); await Promise.resolve(); };
  const assert = (condition, name) => { checks[name] = Boolean(condition); if (!condition) throw new Error(name); };
  const rowById = id => document.querySelector(`[data-work-id="${CSS.escape(id)}"]`);
  const counterpart = row => row?.querySelector('.work-counterpart-link');

  try {
    await window.__home29Fixture.keyReady;
    const form = document.getElementById('unlockForm');
    const input = document.getElementById('unlockPassphrase');
    input.value = 'home29-local-verification';
    form.dispatchEvent(new Event('submit', { bubbles:true, cancelable:true }));
    for (let i=0; i<50 && !rowById('HOME-29'); i++) await wait(20);
    await tick();
    for (let i=0; i<50 && !counterpart(rowById('HOME-23')); i++) await wait(20);

    const home29 = rowById('HOME-29');
    const home23 = rowById('HOME-23');
    const pr7 = rowById('benjamindrong/northsignalstudio.github.io#7');
    assert(home29 && home23 && pr7, 'initial production rows render');
    assert(home29.querySelector('.work-disclosure')?.getAttribute('aria-expanded') === 'false', 'initial Jira row collapsed');
    assert(pr7.querySelector('.work-disclosure')?.getAttribute('aria-expanded') === 'false', 'initial PR row collapsed');

    home29.querySelector('.work-disclosure').click();
    pr7.querySelector('.work-disclosure').click();
    assert(home29.querySelector('[data-work-details]').hidden === false, 'Jira expanded detail visible');
    assert(pr7.querySelector('[data-work-details]').hidden === false, 'PR expanded detail visible');
    assert(home29.querySelector('[data-work-details]').textContent.includes('long summary'), 'full Jira summary exposed');
    assert(pr7.querySelector('[data-work-details]').textContent.includes('long pull request title'), 'full PR title exposed');

    const flightRows = document.getElementById('flightRows');
    flightRows.scrollTop = 60;
    const scrollBefore = flightRows.scrollTop;
    const home29Primary = home29.querySelector('.work-primary-link');
    const home29Disclosure = home29.querySelector('.work-disclosure');
    const home23Primary = home23.querySelector('.work-primary-link');
    const home23Counterpart = counterpart(home23);
    const activeHeader = document.querySelector('[data-work-header-id="HOME:active"]');
    const doneHeader = document.querySelector('[data-work-header-id="HOME:recently-done"]');
    assert(home23Counterpart?.href.endsWith('/pull/7'), 'initial HOME-23 counterpart resolves');
    home29Disclosure.focus();

    window.__home29Fixture.revision = 1;
    await window.dashboardRefresh();
    await tick();
    const home29After = rowById('HOME-29');
    const home23After = rowById('HOME-23');
    assert(home29After === home29, 'surviving Jira row object preserved');
    assert(home29After.querySelector('.work-primary-link') === home29Primary, 'primary link object preserved');
    assert(home29After.querySelector('.work-disclosure') === home29Disclosure, 'disclosure object preserved');
    assert(document.activeElement === home29Disclosure, 'focused surviving control preserved');
    assert(flightRows.scrollTop === scrollBefore, 'panel scrollTop preserved');
    assert(home29After.dataset.workExpanded === 'true' && !home29After.querySelector('[data-work-details]').hidden, 'Jira expansion preserved');
    assert(rowById('GITHUB:benjamindrong/northsignalstudio.github.io#7')?.dataset.workExpanded !== undefined, 'Recently Active stable GitHub identity rendered');
    assert(document.querySelector('[data-work-header-id="HOME:active"]') === activeHeader, 'active header identity preserved');
    assert(document.querySelector('[data-work-header-id="HOME:recently-done"]') === doneHeader, 'recently-done header identity preserved');
    assert(home29After.compareDocumentPosition(doneHeader) & Node.DOCUMENT_POSITION_PRECEDING, 'HOME-29 regrouped under recently-done ordering');
    assert(!rowById('HOME-30') && rowById('HOME-32'), 'insertion and removal reconciled');
    assert(home29After.querySelector('.flight-status').textContent === 'Done', 'status updates in place');
    assert(home29After.querySelector('[data-work-details]').textContent.includes('Updated in place'), 'summary updates in place');
    assert(counterpart(home23After) === home23Counterpart, 'unchanged counterpart node preserved');
    assert(home23After.querySelector('.work-primary-link') === home23Primary, 'linked primary node preserved');
    assert(counterpart(home29After)?.href.endsWith('/pull/29'), 'relationship appearance applied in place');

    window.__home29Fixture.revision = 2;
    await window.dashboardRefresh();
    await tick();
    const changedCounterpart = counterpart(rowById('HOME-23'));
    assert(changedCounterpart && changedCounterpart !== home23Counterpart && changedCounterpart.href.endsWith('/pull/8'), 'relationship destination change replaces counterpart only');
    assert(rowById('HOME-23') === home23, 'destination change preserves outer row');

    window.__home29Fixture.revision = 3;
    await window.dashboardRefresh();
    await tick();
    assert(!counterpart(rowById('HOME-23')), 'relationship removal clears counterpart in place');
    assert(rowById('HOME-23') === home23, 'relationship removal preserves outer row');

    const retainedJira = rowById('HOME-29');
    window.__home29Fixture.jiraFail = true;
    window.__home29Fixture.revision = 4;
    await window.dashboardRefresh();
    await tick();
    assert(rowById('HOME-29') === retainedJira, 'Jira failure retains Jira row');
    assert([...document.querySelectorAll('[data-work-kind="recent"]')].some(row => row.dataset.workId === 'JIRA:HOME-29'), 'Recently Active retains failed Jira source payload');
    assert(rowById('GITHUB:benjamindrong/HomepageDashboard#99'.toLowerCase()) || document.querySelector('[data-work-id$="#99"]'), 'successful GitHub sibling updates during Jira failure');
    window.__home29Fixture.jiraFail = false;

    const retainedGithub = document.querySelector('[data-work-id="benjamindrong/homepagedashboard#40"]');
    window.__home29Fixture.githubFail = true;
    await window.dashboardRefresh();
    await tick();
    assert(document.querySelector('[data-work-id="benjamindrong/homepagedashboard#40"]') === retainedGithub, 'GitHub failure retains GitHub row');
    window.__home29Fixture.githubFail = false;

    const nested = document.querySelectorAll('a a, a button, button a').length;
    assert(nested === 0, 'no nested interactive controls');
    assert(rowById('HOME-29').querySelector('.work-primary-link').href === 'https://example.atlassian.net/browse/HOME-29', 'primary destination correct');
    const mobileHome23 = rowById('HOME-23');
    assert(mobileHome23.querySelector('.flight-key').scrollWidth <= mobileHome23.querySelector('.flight-key').clientWidth, '390px Jira key visible');
    assert(mobileHome23.querySelector('.flight-move').scrollWidth <= mobileHome23.querySelector('.flight-move').clientWidth, '390px Last Move visible');
    assert(document.documentElement.scrollWidth <= document.documentElement.clientWidth, '390px collapsed/expanded no document overflow');
    const detailsStyle = getComputedStyle(rowById('HOME-29').querySelector('[data-work-details]'));
    assert(detailsStyle.whiteSpace !== 'nowrap' && detailsStyle.textOverflow !== 'ellipsis', 'expanded details wrap without ellipsis');

    window.__home29Fixture.revision = 5;
    for (let i=0; i<20 && !window.dashboardRefreshState().refreshing && !rowById('HOME-29').querySelector('[data-work-details]').textContent.includes('Automatic refresh revision 5'); i++) {
      await wait(1000);
      await tick();
    }
    if (window.dashboardRefreshState().refreshing) await window.dashboardRefresh();
    await tick();
    assert(rowById('HOME-29').querySelector('[data-work-details]').textContent.includes('Automatic refresh revision 5'), 'production 15-second automatic refresh observed');

    document.documentElement.dataset.home29Python = 'pass';
    result.textContent = JSON.stringify({ pass:true, checks });
  } catch (error) {
    document.documentElement.dataset.home29Python = 'fail';
    result.textContent = JSON.stringify({
      pass:false,
      error:String(error?.stack || error),
      checks,
      diagnostics:{
        hidden:document.hidden,
        visibilityState:document.visibilityState,
        revision:window.__home29Fixture.revision,
        requests:window.__home29Fixture.requests,
        refreshState:window.dashboardRefreshState?.()
      }
    });
  }
})();
</script>'''


DISPLAY_CHILD_DRIVER = r'''<script>
(async () => {
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
  await window.__home29Fixture.keyReady;
  const form = document.getElementById('unlockForm');
  const input = document.getElementById('unlockPassphrase');
  input.value = 'home29-local-verification';
  form.dispatchEvent(new Event('submit', { bubbles:true, cancelable:true }));
  for (let i=0; i<50 && !document.querySelector('[data-work-id="HOME-29"]'); i++) await wait(20);
  const row = document.querySelector('[data-work-id="HOME-29"]');
  row?.querySelector('.work-disclosure')?.click();
  document.documentElement.dataset.home29DisplayChild = row ? 'ready' : 'fail';
})();
</script>'''


DISPLAY_PARENT_DRIVER = r'''<script>
(async () => {
  const result = document.createElement('pre');
  result.id = 'home29DisplayPythonResult';
  document.body.appendChild(result);
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
  try {
    const frame = document.getElementById('dashboardFrame');
    let child = null;
    for (let i=0; i<80; i++) {
      const candidate = frame.contentDocument;
      if (candidate?.documentElement?.dataset.home29DisplayChild === 'ready') {
        child = candidate;
        break;
      }
      await wait(25);
    }
    if (!child) throw new Error('instrumented Display Mode child did not become ready');
    document.querySelector('[data-view="1"]').click();
    await wait(20);
    const githubWidget = child.querySelector('.widget--github');
    if (githubWidget?.getAttribute('data-display-active') !== 'true') throw new Error('real Display Mode controls did not activate Code Review');
    const githubRow = child.querySelector('[data-work-kind="github"]');
    if (!githubRow) throw new Error('Code Review row unavailable under Display Mode');
    githubRow.querySelector('.work-disclosure').click();
    if (githubRow.querySelector('[data-work-details]').hidden) throw new Error('disclosure did not expand under Display Mode overrides');
    const childRoot = child.documentElement;
    if (!childRoot) throw new Error('Display Mode child document root became unavailable');
    if (childRoot.scrollWidth > childRoot.clientWidth) throw new Error('Display Mode child has horizontal overflow');
    document.documentElement.dataset.home29DisplayPython = 'pass';
    result.textContent = JSON.stringify({ pass:true, active:'Code Review', expanded:true });
  } catch (error) {
    document.documentElement.dataset.home29DisplayPython = 'fail';
    result.textContent = JSON.stringify({ pass:false, error:String(error?.stack || error) });
  }
})();
</script>'''


class QuietHandler(SimpleHTTPRequestHandler):
    def log_message(self, format: str, *args: object) -> None:  # noqa: A003
        pass


def free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.bind(("127.0.0.1", 0))
        return int(sock.getsockname()[1])


def make_fixtures() -> None:
    index_html = INDEX.read_text(encoding="utf-8")
    display_html = DISPLAY.read_text(encoding="utf-8")
    assert_production_markers(index_html)

    work_items_marker = '<script src="./work-items.js"></script>'
    main = inject_before(index_html, work_items_marker, FETCH_STUB)
    main = inject_before_body_end(main, MAIN_DRIVER)
    MAIN_FIXTURE.write_text(main, encoding="utf-8")

    child = inject_before(index_html, work_items_marker, FETCH_STUB)
    child = inject_before_body_end(child, DISPLAY_CHILD_DRIVER)
    DISPLAY_CHILD_FIXTURE.write_text(child, encoding="utf-8")

    display = display_html.replace('src="./index.html"', 'src="./home29-test-index-display-python.html"', 1)
    if display == display_html:
        fail("dashboard/display.html iframe source marker was not found.")
    display = inject_before_body_end(display, DISPLAY_PARENT_DRIVER)
    DISPLAY_FIXTURE.write_text(display, encoding="utf-8")


def cleanup() -> None:
    for path in GENERATED:
        try:
            path.unlink()
        except FileNotFoundError:
            pass


def run_chrome(executable: str, url: str, budget_ms: int) -> str:
    command = [
        executable,
        "--headless=new",
        "--disable-gpu",
        "--no-first-run",
        "--no-default-browser-check",
        "--disable-background-networking",
        "--window-size=390,900",
        f"--virtual-time-budget={budget_ms}",
        "--dump-dom",
        url,
    ]
    completed = subprocess.run(command, cwd=ROOT, text=True, capture_output=True, timeout=45)
    if completed.returncode != 0:
        fail(f"Chrome exited with {completed.returncode}:\n{completed.stderr[-2000:]}")
    return completed.stdout


def parse_result(dom: str, element_id: str) -> dict:
    marker = f'id="{element_id}">'
    start = dom.find(marker)
    if start < 0:
        fail(f"Browser result element {element_id} was not emitted. Chrome output did not contain the test result.")
    start += len(marker)
    end = dom.find("</pre>", start)
    if end < 0:
        fail(f"Browser result element {element_id} was malformed.")
    raw = dom[start:end].replace("&quot;", '"').replace("&amp;", "&").replace("&lt;", "<").replace("&gt;", ">")
    try:
        return json.loads(raw)
    except json.JSONDecodeError as exc:
        fail(f"Could not parse browser result JSON: {raw[:1000]} ({exc})")


def main() -> int:
    executable = chrome_path()
    make_fixtures()
    port = free_port()
    handler = partial(QuietHandler, directory=str(ROOT))
    server = ThreadingHTTPServer(("127.0.0.1", port), handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        main_dom = run_chrome(executable, f"http://127.0.0.1:{port}/dashboard/{MAIN_FIXTURE.name}", 120000)
        main_result = parse_result(main_dom, "home29PythonResult")
        if not main_result.get("pass"):
            fail("HOME-29 production-path browser gate failed:\n" + json.dumps(main_result, indent=2))

        display_dom = run_chrome(executable, f"http://127.0.0.1:{port}/dashboard/{DISPLAY_FIXTURE.name}", 6000)
        display_result = parse_result(display_dom, "home29DisplayPythonResult")
        if not display_result.get("pass"):
            fail("HOME-29 Display Mode browser gate failed:\n" + json.dumps(display_result, indent=2))

        print("HOME-29 Python production-path browser gate: PASS")
        print(json.dumps({"main": main_result, "display": display_result}, indent=2))
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
        print(f"HOME-29 Python production-path browser gate: FAIL\n{exc}", file=sys.stderr)
        raise SystemExit(1)