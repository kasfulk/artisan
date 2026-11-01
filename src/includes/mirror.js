/* Artisan Web Mirror — vanilla JS client
 *
 * WebSocket message schema (server → client):
 *   { state: { on, recording, state, btLCD, etLCD, timeLCD, bt, et, rorBt, rorEt,
 *              unitBt, unitEt, title, samples },
 *     curve: { t:[], bt:[], et:[], rorBt:[], rorEt:[] },
 *     events: [{ type, label, time, value }] }
 *
 * Control (client → server):  { cmd: string, token: string }
 * Control ack (server → client): { ack: string, ok: boolean, queued?: boolean, error?: string }
 *   ok+queued: the command was accepted and handed to the GUI thread; it may still be
 *   refused there (e.g. an unsaved profile blocks START), which shows up as an unchanged
 *   state in the following snapshots.
 *   error values: "unauthorized" | "unknown-command" | "bad-message" | "controller-error"
 *
 * Handshake: on WS open, send empty string "" to receive last snapshot.
 */
(function () {
    'use strict';

    // --- Constants ---
    var WS_PATH = 'websocket';
    var RECONNECT_MIN = 500;
    var RECONNECT_MAX = 5000;
    var EVENT_LABELS = { 0: 'CHARGE', 1: 'DRY', 2: 'FCs', 3: 'FCe', 4: 'SCs', 5: 'SCe', 6: 'DROP' };
    var EVENT_CMD_TO_TYPE = { charge: 0, dry: 1, fcs: 2, fce: 3, scs: 4, sce: 5, drop: 6 };

    // --- State ---
    var ws = null;
    var reconnectDelay = RECONNECT_MIN;
    var reconnectTimer = null;
    var currentState = null;
    var currentCurve = null;
    var currentEvents = null;
    var showRor = true;
    var token = '';
    var tokenErrorVisible = false;
    var animFrameId = 0;

    // --- DOM refs ---
    var el = {};

    function cacheDom() {
        el.btLcd = document.getElementById('bt-lcd');
        el.etLcd = document.getElementById('et-lcd');
        el.timeLcd = document.getElementById('time-lcd');
        el.rorLcd = document.getElementById('ror-lcd');
        el.stateLcd = document.getElementById('state-lcd');
        el.btUnit = document.getElementById('bt-unit');
        el.etUnit = document.getElementById('et-unit');
        el.connStatus = document.getElementById('connection-status');
        el.canvas = document.getElementById('roast-chart');
        el.rorToggle = document.getElementById('ror-toggle');
        el.btnStartStop = document.getElementById('btn-start-stop');
        el.btnOff = document.getElementById('btn-off');
        el.tokenInput = document.getElementById('token-input');
        el.btnSaveToken = document.getElementById('btn-save-token');
        el.tokenError = document.getElementById('token-error');
        el.eventBtns = document.querySelectorAll('.btn-event');
    }

    // --- Token management ---
    function loadToken() {
        var hash = location.hash.replace(/^#/, '');
        if (hash) {
            token = hash;
            try { localStorage.setItem('mirror_token', hash); } catch (e) { /* ignore */ }
        } else {
            try { token = localStorage.getItem('mirror_token') || ''; } catch (e) { token = ''; }
        }
        el.tokenInput.value = token;
    }

    function saveToken() {
        token = el.tokenInput.value.trim();
        try { localStorage.setItem('mirror_token', token); } catch (e) { /* ignore */ }
        if (token) {
            location.hash = '#' + token;
        }
        hideTokenError();
    }

    function showTokenError() {
        tokenErrorVisible = true;
        el.tokenError.classList.remove('hidden');
    }

    function hideTokenError() {
        tokenErrorVisible = false;
        el.tokenError.classList.add('hidden');
    }

    // --- WebSocket ---
    function wsUrl() {
        var proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
        return proto + '//' + location.host + '/' + WS_PATH;
    }

    function connectWs() {
        if (ws && (ws.readyState === WebSocket.CONNECTING || ws.readyState === WebSocket.OPEN)) {
            return;
        }
        ws = new WebSocket(wsUrl());

        ws.onopen = function () {
            reconnectDelay = RECONNECT_MIN;
            setConnected(true);
            ws.send(''); // handshake: request last snapshot
        };

        ws.onmessage = function (evt) {
            var msg;
            try { msg = JSON.parse(evt.data); } catch (e) { return; }

            // Control ack
            if (msg.ack !== undefined) {
                handleAck(msg);
                return;
            }

            // Snapshot
            if (msg.state || msg.curve || msg.events) {
                handleSnapshot(msg);
            }
        };

        ws.onclose = function () {
            setConnected(false);
            scheduleReconnect();
        };

        ws.onerror = function () {
            // onclose will fire after this
        };
    }

    function scheduleReconnect() {
        if (reconnectTimer) return;
        reconnectTimer = setTimeout(function () {
            reconnectTimer = null;
            connectWs();
        }, reconnectDelay);
        reconnectDelay = Math.min(reconnectDelay * 1.5, RECONNECT_MAX);
    }

    function setConnected(connected) {
        el.connStatus.className = connected ? 'connected' : 'disconnected';
    }

    function sendCommand(cmd) {
        if (!ws || ws.readyState !== WebSocket.OPEN) return;
        ws.send(JSON.stringify({ cmd: cmd, token: token }));
    }

    // --- Message handlers ---
    function handleAck(msg) {
        if (!msg.ok && msg.error === 'unauthorized') {
            showTokenError();
            el.tokenInput.focus();
            el.tokenInput.select();
        }
    }

    function handleSnapshot(msg) {
        if (msg.state) currentState = msg.state;
        if (msg.curve) currentCurve = msg.curve;
        if (msg.events !== undefined) currentEvents = msg.events;
        updateLCDs();
        updateButtons();
        scheduleRedraw();
    }

    // --- LCD updates ---
    function updateLCDs() {
        if (!currentState) return;
        var s = currentState;
        el.btLcd.textContent = s.btLCD || '--';
        el.etLcd.textContent = s.etLCD || '--';
        el.timeLcd.textContent = s.timeLCD || '00:00';
        el.btUnit.textContent = s.unitBt || '°C';
        el.etUnit.textContent = s.unitEt || '°C';

        var ror = s.rorBt;
        el.rorLcd.textContent = (ror !== null && ror !== undefined && !isNaN(ror))
            ? Number(ror).toFixed(1) : '--';

        var stateStr = (s.state || 'off').toUpperCase();
        el.stateLcd.textContent = stateStr;
    }

    // --- Button state ---
    function updateButtons() {
        if (!currentState) return;
        var s = currentState;
        var recording = !!s.recording;
        var isOn = !!s.on;
        var stateStr = s.state || 'off';

        // START/STOP toggle
        if (recording) {
            el.btnStartStop.textContent = 'STOP';
            el.btnStartStop.classList.add('recording');
        } else {
            el.btnStartStop.textContent = 'START';
            el.btnStartStop.classList.remove('recording');
        }
        el.btnStartStop.disabled = !isOn;

        // OFF button
        el.btnOff.disabled = !isOn;

        // Event buttons
        var existingTypes = {};
        if (currentEvents) {
            for (var i = 0; i < currentEvents.length; i++) {
                existingTypes[currentEvents[i].type] = true;
            }
        }

        for (var j = 0; j < el.eventBtns.length; j++) {
            var btn = el.eventBtns[j];
            var cmd = btn.getAttribute('data-cmd');
            var typeNum = EVENT_CMD_TO_TYPE[cmd];
            var disabled = !recording || !isOn;
            // CHARGE disabled if already present
            if (cmd === 'charge' && existingTypes[0]) disabled = true;
            // DROP disabled if already present
            if (cmd === 'drop' && existingTypes[6]) disabled = true;
            // Other events disabled if already present
            if (typeNum !== undefined && typeNum !== 0 && typeNum !== 6 && existingTypes[typeNum]) {
                disabled = true;
            }
            btn.disabled = disabled;
        }
    }

    // --- Canvas chart ---
    var chartCtx = null;

    function initChart() {
        chartCtx = el.canvas.getContext('2d');
        setupResizeObserver();
    }

    function setupResizeObserver() {
        var ro = new ResizeObserver(function () { scheduleRedraw(); });
        ro.observe(el.canvas.parentElement);
    }

    function scheduleRedraw() {
        if (animFrameId) return;
        animFrameId = requestAnimationFrame(function () {
            animFrameId = 0;
            drawChart();
        });
    }

    function drawChart() {
        if (!chartCtx || !currentCurve) return;

        var canvas = el.canvas;
        var parent = canvas.parentElement;
        var dpr = window.devicePixelRatio || 1;
        var rect = parent.getBoundingClientRect();
        var controlsH = document.getElementById('chart-controls').getBoundingClientRect().height;
        var w = rect.width - 16; // padding
        var h = rect.height - controlsH - 16;
        if (w < 50 || h < 50) return;

        canvas.width = Math.round(w * dpr);
        canvas.height = Math.round(h * dpr);
        canvas.style.width = w + 'px';
        canvas.style.height = h + 'px';

        var ctx = chartCtx;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

        // Margins
        var ml = 50, mr = showRor ? 50 : 10, mt = 10, mb = 30;
        var pw = w - ml - mr;
        var ph = h - mt - mb;
        if (pw < 10 || ph < 10) return;

        var curve = currentCurve;
        var t = curve.t || [];
        var bt = curve.bt || [];
        var et = curve.et || [];
        var rorBt = curve.rorBt || [];
        var rorEt = curve.rorEt || [];

        // Compute ranges
        var tMin = 0, tMax = 1;
        if (t.length > 0) {
            tMax = t[t.length - 1];
            if (tMax <= 0) tMax = 1;
        }

        // Temp range (left axis)
        var tempMin = 0, tempMax = 300;
        for (var i = 0; i < bt.length; i++) {
            if (bt[i] !== null && bt[i] !== undefined) {
                if (bt[i] < tempMin) tempMin = bt[i];
                if (bt[i] > tempMax) tempMax = bt[i];
            }
        }
        for (var j = 0; j < et.length; j++) {
            if (et[j] !== null && et[j] !== undefined) {
                if (et[j] < tempMin) tempMin = et[j];
                if (et[j] > tempMax) tempMax = et[j];
            }
        }
        // Add padding
        var tempPad = (tempMax - tempMin) * 0.1 || 20;
        tempMin = Math.max(0, tempMin - tempPad);
        tempMax = tempMax + tempPad;

        // RoR range (right axis)
        var rorMin = 0, rorMax = 30;
        if (showRor) {
            for (var k = 0; k < rorBt.length; k++) {
                if (rorBt[k] !== null && rorBt[k] !== undefined) {
                    if (rorBt[k] > rorMax) rorMax = rorBt[k];
                }
            }
            for (var k2 = 0; k2 < rorEt.length; k2++) {
                if (rorEt[k2] !== null && rorEt[k2] !== undefined) {
                    if (rorEt[k2] > rorMax) rorMax = rorEt[k2];
                }
            }
            rorMax = Math.ceil(rorMax / 5) * 5 || 30;
        }

        // Clear
        ctx.clearRect(0, 0, w, h);

        // Background
        ctx.fillStyle = '#1e1e1e';
        ctx.fillRect(ml, mt, pw, ph);

        // Helper: map data to pixel
        function xPx(tVal) { return ml + (tVal / tMax) * pw; }
        function yTempPx(v) { return mt + ph - ((v - tempMin) / (tempMax - tempMin)) * ph; }
        function yRorPx(v) { return mt + ph - ((v - rorMin) / (rorMax - rorMin)) * ph; }

        // Gridlines
        ctx.strokeStyle = '#333';
        ctx.lineWidth = 0.5;
        // Horizontal grid (temp)
        var tempStep = niceStep(tempMax - tempMin, 5);
        var tempStart = Math.ceil(tempMin / tempStep) * tempStep;
        ctx.beginPath();
        for (var tv = tempStart; tv <= tempMax; tv += tempStep) {
            var gy = yTempPx(tv);
            ctx.moveTo(ml, gy);
            ctx.lineTo(ml + pw, gy);
        }
        ctx.stroke();

        // Vertical grid (time)
        var timeStep = niceTimeStep(tMax);
        ctx.beginPath();
        for (var ts = 0; ts <= tMax; ts += timeStep) {
            var gx = xPx(ts);
            ctx.moveTo(gx, mt);
            ctx.lineTo(gx, mt + ph);
        }
        ctx.stroke();

        // Axes labels
        ctx.fillStyle = '#888';
        ctx.font = '11px -apple-system, sans-serif';
        ctx.textAlign = 'right';
        ctx.textBaseline = 'middle';
        for (var lv = tempStart; lv <= tempMax; lv += tempStep) {
            ctx.fillText(Math.round(lv) + '°', ml - 4, yTempPx(lv));
        }

        // Right axis (RoR)
        if (showRor) {
            ctx.textAlign = 'left';
            var rorStep = niceStep(rorMax - rorMin, 5);
            for (var rv = 0; rv <= rorMax; rv += rorStep) {
                ctx.fillText(rv.toFixed(0), ml + pw + 4, yRorPx(rv));
            }
        }

        // X axis labels (time mm:ss)
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        for (var xt = 0; xt <= tMax; xt += timeStep) {
            ctx.fillText(formatTime(xt), xPx(xt), mt + ph + 4);
        }

        // Event markers
        if (currentEvents) {
            ctx.save();
            ctx.setLineDash([4, 3]);
            ctx.lineWidth = 1;
            ctx.font = '10px -apple-system, sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'bottom';
            for (var ei = 0; ei < currentEvents.length; ei++) {
                var ev = currentEvents[ei];
                if (ev.time === null || ev.time === undefined || !isFinite(ev.time)) continue;
                var ex = xPx(ev.time);
                if (ex < ml || ex > ml + pw) continue;
                ctx.strokeStyle = '#ffa726';
                ctx.fillStyle = '#ffa726';
                ctx.beginPath();
                ctx.moveTo(ex, mt);
                ctx.lineTo(ex, mt + ph);
                ctx.stroke();
                ctx.fillText(ev.label || EVENT_LABELS[ev.type] || '', ex, mt - 1);
            }
            ctx.restore();
        }

        // Draw curves
        drawLine(ctx, t, et, xPx, yTempPx, '#66bb6a', 1.5, ml, mt, pw, ph);
        drawLine(ctx, t, bt, xPx, yTempPx, '#ff9800', 1.5, ml, mt, pw, ph);
        if (showRor) {
            // as on the Artisan chart: RoR BT solid, RoR ET dashed
            drawLine(ctx, t, rorEt, xPx, yRorPx, '#42a5f5', 1.2, ml, mt, pw, ph, [4, 3]);
            drawLine(ctx, t, rorBt, xPx, yRorPx, '#42a5f5', 1.2, ml, mt, pw, ph);
        }

        // Axis border
        ctx.strokeStyle = '#555';
        ctx.lineWidth = 1;
        ctx.setLineDash([]);
        ctx.strokeRect(ml, mt, pw, ph);
    }

    function drawLine(ctx, tArr, vArr, xFn, yFn, color, lineW, ml, mt, pw, ph, dash) {
        if (!tArr.length || !vArr.length) return;
        ctx.save();
        ctx.beginPath();
        ctx.rect(ml, mt, pw, ph);
        ctx.clip();

        ctx.strokeStyle = color;
        ctx.lineWidth = lineW;
        ctx.lineJoin = 'round';
        ctx.setLineDash(dash || []);
        ctx.beginPath();
        var started = false;
        var len = Math.min(tArr.length, vArr.length);
        for (var i = 0; i < len; i++) {
            if (vArr[i] === null || vArr[i] === undefined) {
                started = false;
                continue;
            }
            var px = xFn(tArr[i]);
            var py = yFn(vArr[i]);
            if (!started) {
                ctx.moveTo(px, py);
                started = true;
            } else {
                ctx.lineTo(px, py);
            }
        }
        ctx.stroke();
        ctx.restore();
    }

    function niceStep(range, targetTicks) {
        if (range <= 0) return 1;
        var rough = range / targetTicks;
        var pow = Math.pow(10, Math.floor(Math.log10(rough)));
        var norm = rough / pow;
        var nice;
        if (norm < 1.5) nice = 1;
        else if (norm < 3) nice = 2;
        else if (norm < 7) nice = 5;
        else nice = 10;
        return nice * pow;
    }

    function niceTimeStep(maxT) {
        if (maxT <= 0) return 60;
        var target = maxT / 6;
        var steps = [10, 15, 30, 60, 120, 300, 600];
        for (var i = 0; i < steps.length; i++) {
            if (steps[i] >= target) return steps[i];
        }
        return 600;
    }

    function formatTime(sec) {
        var m = Math.floor(sec / 60);
        var s = Math.floor(sec % 60);
        return (m < 10 ? '0' : '') + m + ':' + (s < 10 ? '0' : '') + s;
    }

    // --- Event wiring ---
    function wireEvents() {
        el.rorToggle.addEventListener('change', function () {
            showRor = el.rorToggle.checked;
            scheduleRedraw();
        });

        el.btnStartStop.addEventListener('click', function () {
            if (!currentState) return;
            sendCommand(currentState.recording ? 'stop' : 'start');
        });

        el.btnOff.addEventListener('click', function () {
            sendCommand('off');
        });

        for (var i = 0; i < el.eventBtns.length; i++) {
            el.eventBtns[i].addEventListener('click', function () {
                sendCommand(this.getAttribute('data-cmd'));
            });
        }

        el.btnSaveToken.addEventListener('click', saveToken);
        el.tokenInput.addEventListener('keydown', function (e) {
            if (e.key === 'Enter') saveToken();
        });
    }

    // --- Init ---
    function init() {
        cacheDom();
        loadToken();
        wireEvents();
        initChart();
        connectWs();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
