scope: web-mirror
session: 2026-11-02-054716-webmirror
stage: TESTING
status: PASS
updated: 2026-11-02 06:35

# Test report

Commands run from `/Users/kasjfulkurniawan/Projects/roasting-app/artisan/src` with the project venv
`../.venv/bin/python` (system `python3` lacks the deps). `hypothesis` and `mypy` were installed into the
venv for these runs; `ruff` via `uvx`.

## 1. Unit tests — PASS

```
$ ../.venv/bin/python -m pytest test/unitary/artisanlib/test_canvas.py \
      test/unitary/artisanlib/test_webmirror.py -q -p no:warnings
============================= 141 passed in 0.63s ==============================
```

- `test_webmirror.py` (7): publish JSON validity + `_last_message` caching, empty-message snapshot on
  connect, valid command ack, unknown command, wrong token, missing token, malformed JSON.
- `test_canvas.py::TestMirrorSnapshot` (3, new): CHARGE → time origin with negative pre-charge
  samples; unset CHARGE (−1) → time from first sample; NaN/None → `null`, payload JSON-serialisable.

The snapshot tests build a `SimpleNamespace` stub and call the method unbound
(`tgraphcanvas.mirrorSnapshot(stub, ...)`), the same style already used by the other canvas tests; no
real `tgraphcanvas` instance or Qt bootstrap needed.

## 2. Ruff — PASS

Proof the verdict line is real, on a deliberately bad file first:

```
$ uvx ruff check /tmp/ruff_probe.py
/tmp/ruff_probe.py:1: [F401] `os` imported but unused
PROBE_EXIT=1

$ uvx ruff check artisanlib/webmirror.py artisanlib/weblcds.py artisanlib/canvas.py \
      artisanlib/curves.py artisanlib/main.py test/unitary/artisanlib/test_webmirror.py \
      test/unitary/artisanlib/test_canvas.py --output-format=concise
All checks passed!
CLEAN_EXIT=0
```

## 3. mypy — PASS

```
$ ../.venv/bin/python -m mypy artisanlib/webmirror.py test/unitary/artisanlib/test_webmirror.py
Success: no issues found in 2 source files
```

Scope limited to the new module and its tests. Full-repo mypy/ruff/pylint run in CI
(`.github/workflows/mypy.yml`, `ruff.yaml`, `pylint.yaml`) against Python 3.12; this venv is 3.14, so a
whole-tree run would mostly report interpreter/config drift unrelated to this diff.

## 4. JS syntax — PASS

```
$ node --check src/includes/mirror.js   # exit 0
```

## 5. End-to-end smoke of the served page — PASS

Harness `/tmp/mirror_smoke.py` instantiates the real `WebMirror` on port 18081 with a fake
`MirrorController`, publishes three snapshots (240 synthetic points, 2 events), and drives real
Chromium via Playwright.

```
✓ Server started
✓ Published snapshot 3: bt=188.9, et=205.2
✓ HTML served correctly, no external CDN links
✓ Received snapshot: bt=188.9, et=205.2, time=04:42        (ws connect, no prior publish wait)
✓ Rejected: {'ack': 'start', 'ok': False, 'error': 'unauthorized'}
✓ Accepted: {'ack': 'start', 'ok': True, 'queued': True}
✓ Canvas has dimensions: 920x481.96875
✓ BT value visible in page / ✓ ET value visible in page
✓ Screenshot saved to /tmp/mirror.png
✓ Server stopped
```

### 5b. Chart rendering proven by pixels, not by looking

`/tmp/mirror_pixel_check.py` publishes constant `rorBt = 20` and `rorEt = 5` (two separated horizontal
bands), loads the page in Chromium, reads the canvas with `getImageData`, and counts pixels matching
RoR blue `#42a5f5` per row:

```
canvas 920 x 482 | blue pixel count total 1285
densest blue rows (y, pixels): [(157, 818), (378, 467)]
bands: [(157, 157, 818), (378, 378, 467)]
solid band max = 818 px, dashed band max = 467 px
PASS: solid RoR BT + dashed RoR ET both rendered; dashed line has gaps
PIXEL_EXIT=0
```

818 continuous pixels (RoR BT solid) versus 467 (RoR ET dashed, 57% coverage) in a distinct row band:
the dashed RoR ET fix renders, no eyeballing required.

## 6. Snapshot generator with real data shapes — PASS

Covered permanently by `TestMirrorSnapshot` (section 1). Additionally probed interactively against the
real module (QApplication + `artisanviewerMode` bootstrap required by `plus.*` imports):

```
t [-30.0, 0.0, 30.0] timeLCD 00:30 state roasting rorBt 7.0
events [{'type': 0, 'label': 'CHARGE', 'time': 0.0, 'value': 180.0},
        {'type': 13, 'label': 'D', 'time': 30.0, 'value': 190.0}]
json bytes 442
nocharge t [0.0, 60.0] bt [None, 180.0] et [None, 201.0] timeLCD '01:00' events []
```

## Not run

- Full app launch / GUI interaction: needs a display and a machine connection. The desktop wiring
  (`startWebMirror`, `stopWebMirror`, token gate, Curves-dialog group) is covered statically, the server
  behaviour by the harness.
- Packaging build (PyInstaller mac/win): specs verified by diff —
  `src/artisan-mac.spec` and `src/artisan-win.spec` each add `includes/mirror.tpl|js|css` (+3 lines).