scope: web-mirror
session: 2026-11-02-054716-webmirror
stage: CODE_REVIEW
status: PASS
updated: 2026-11-02 06:10

# Review — WebMirror (uncommitted feature, verified this run)

Reviewer: omp (orchestrator), after the delegated `MirrorReview` agent delivered an audit in its
transcript (`history://MirrorReview`) rather than in its result envelope.

## Verdict: PASS

## Criteria

| # | Criterion | Verdict | Evidence |
|---|---|---|---|
| 1 | Live chart BT/ET/RoR, timer, markers, status | PASS | `src/includes/mirror.js:279-424` draws canvas; screenshot `/tmp/mirror.png` shows BT 188.9, ET 205.2, TIME 04:42, RoR BT 8.4, STATE ROASTING, CHARGE/FCs markers |
| 2 | Controls token-gated, GUI-thread queued | PASS | token gate `src/artisanlib/main.py:19801` (`secrets.compare_digest`); queue `main.py:19805`; `canvas.py:2233` connects `mirrorControlSignal` with `Qt.QueuedConnection`; state re-checked per command `canvas.py:5472-5505` |
| 3 | No CDN, no XSS sink | PASS | `mirror.tpl` references only `mirror.css`/`mirror.js`; `mirror.js` writes via `textContent` only; canvas labels via `fillText` |
| 4 | Fresh client gets current snapshot | PASS | `webmirror.py:96-100` replies to empty message with `_last_message`; E2E confirmed |

## Findings

1. **`curve.rorEt` was published but never drawn** — dead payload, and the chart showed only RoR BT
   while Artisan's chart shows RoR ET dashed. Fixed: `mirror.js:287-330,421-425` now includes
   `rorEt` in the right-axis range and draws it dashed through the new `dash` argument of `drawLine`
   (`mirror.js:434,444`). Verified by screenshot after the change.
2. **Full snapshot resent every publish** (P3, accepted). Payload grows with roast length
   (~30KB at 15min/1Hz). Kept deliberately: it makes reconnect trivial and the page stateless.
   Marked with a `ponytail:` comment at `canvas.py:5459-5461` naming the upgrade path
   (incremental points plus a full snapshot for new clients).
3. **Token persists in QSettings + client `localStorage`/URL hash** (P3, accepted). Deliberate for a
   LAN mirror so a phone keeps access across restarts. Consequence: rotate the token before exposing
   Artisan beyond a trusted network. No code change.
4. **Port field disabled while the server runs** (`curves.py:1433`) — user must stop, change, restart,
   mirroring the WebLCDs behaviour. Accepted, no live rebind.
5. **Changelog**: no `wiki/ReleaseHistory.md` entry added. The v4.2.2 section is upstream's released
   notes, and a fork-local bullet there misrepresents the release and conflicts on sync. Recorded
   here instead: write the entry when this is proposed upstream.
6. **Translations**: `src/build-derived.sh:75` runs `pylupdate6pro.py` during the build, so the new
   `QApplication.translate` strings ('Web Mirror', 'Token', the two error messages) are extracted
   automatically. No manual step.
7. **Deprecated `web.Application(debug=True)`** in the shared base class (`weblcds.py:55`) logged a
   `DeprecationWarning` in every WebMirror test run. Removed; all four web views share the fixed base.

## Tests added

`test_canvas.py::TestMirrorSnapshot` (3 tests) pins the snapshot contract that the reviewer could only
verify by reading: CHARGE→time origin, unset-CHARGE fallback, NaN/None→null. Stub-self style, no Qt
bootstrap. `pytest test_canvas.py test_webmirror.py` → 141 passed.

## Scope check

Diff is feature-only: `webmirror.py` (new), `mirror.tpl|js|css` (new), `canvas.py` glue,
`curves.py` settings UI, `main.py` lifecycle, `weblcds.py` deprecation one-liner, both PyInstaller specs,
two test modules. No drive-by refactors.