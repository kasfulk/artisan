scope: web-mirror
session: 2026-11-02-054716-webmirror
stage: VERIFICATION
status: PASS
updated: 2026-11-02 06:35

# Verification — acceptance criteria proven by executed commands

Full commands and output: `.agile/web-mirror/test-report-2026-11-02-054716-webmirror.md`.

| # | Criterion | Proof |
|---|---|---|
| 1 | Website served by Artisan itself, no CDN | `curl http://127.0.0.1:18081/mirror` → HTML referencing only `mirror.js`/`mirror.css`; `WebMirror(WebView)` owns the aiohttp server thread; startup hook `main.py:19473` |
| 2 | Live mirror: BT, ET, RoR, timer, markers, status | Chromium canvas readback: BT 188.9 / ET 205.2 / TIME 04:42 visible; pixel check finds two distinct RoR bands — solid 818 px, dashed 467 px (`PIXEL_EXIT=0`) |
| 3 | Fresh client receives the current snapshot | ws connect with `""` → snapshot `bt=188.9, et=205.2, time=04:42` without a new publish |
| 4 | Controls rejected without token, accepted with it | `{'ack':'start','ok':False,'error':'unauthorized'}` then `{'ack':'start','ok':True,'queued':True}`; gate `main.py:19801`, GUI-thread queue `main.py:19805`, signal connected with `Qt.ConnectionType.QueuedConnection` at `canvas.py:2233` |
| 5 | Snapshot payload correct for real roast data | `TestMirrorSnapshot` (3 tests): CHARGE→t=0 with negative pre-charge samples, unset CHARGE→time from first sample, NaN/None→`null`, JSON-serialisable |
| 6 | No regressions | `pytest test_canvas.py test_webmirror.py -q` → **141 passed**; `ruff … ` → `All checks passed!` (probe file proves the tool reports); `mypy` on the new module → clean |
| 7 | Base-class cleanup | `weblcds.py:55` `web.Application(debug=True)` → `web.Application()`; the aiohttp deprecation warning that appeared in every WebMirror test run is gone |

## Changes made this run

- `src/includes/mirror.js` — dashed RoR ET drawn (`curve.rorEt` was published but unused), included in the
  right-axis range; `drawLine` gained a `dash` argument.
- `src/artisanlib/canvas.py` — `ponytail:` comment on `updateWebMirror` naming the full-resend ceiling and
  the incremental upgrade path.
- `src/artisanlib/weblcds.py` — dropped the deprecated `debug=True` argument.
- `src/test/unitary/artisanlib/test_canvas.py` — `TestMirrorSnapshot`, 3 tests pinning the snapshot contract.
- `wiki/ReleaseHistory.md` — deliberately NOT touched (upstream release notes; entry belongs with an
  upstream PR, not in a fork).

## How to use

Settings → Curve → **Web Mirror**: tick the box (starts the server), keep or change the port
(default 8081), then open the displayed URL — `http://<host>:8081/mirror#<token>` — or scan the QR code.
The page shows the live chart and readings; enter/confirm the token on the page to unlock
START/STOP and the event buttons (DRY, FCs, FCe, SCs, SCe, DROP, CHARGE).

## Known limits

- Full snapshot per sample; fine for LAN/WiFi roast sizes, marked for incremental upgrade.
- Token lives in QSettings and in the browser (`localStorage` + URL fragment); rotate it before exposing
  Artisan outside a trusted network.
- Port changes need a stop/start of the mirror (the port field is disabled while running, as for WebLCDs).