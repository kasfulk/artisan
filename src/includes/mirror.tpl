<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="utf-8"/>
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
    <meta name="apple-mobile-web-app-capable" content="yes">
    <meta name="apple-mobile-web-app-status-bar-style" content="black">
    <meta name="mobile-web-app-capable" content="yes">
    <title>Artisan Web Mirror</title>
    <link rel="stylesheet" href="mirror.css">
    <script src="mirror.js" defer></script>
</head>
<body>
    <div id="mirror-app">
        <header id="mirror-header">
            <h1>Artisan Mirror</h1>
            <div id="connection-status" class="disconnected">●</div>
        </header>

        <main id="mirror-main">
            <section id="lcd-panel">
                <div class="lcd-row">
                    <div class="lcd-item">
                        <span class="lcd-label">BT</span>
                        <span id="bt-lcd" class="lcd-value">--</span>
                        <span id="bt-unit" class="lcd-unit">°C</span>
                    </div>
                    <div class="lcd-item">
                        <span class="lcd-label">ET</span>
                        <span id="et-lcd" class="lcd-value">--</span>
                        <span id="et-unit" class="lcd-unit">°C</span>
                    </div>
                    <div class="lcd-item">
                        <span class="lcd-label">TIME</span>
                        <span id="time-lcd" class="lcd-value">00:00</span>
                    </div>
                </div>
                <div class="lcd-row lcd-sub">
                    <div class="lcd-item">
                        <span class="lcd-label">RoR BT</span>
                        <span id="ror-lcd" class="lcd-value">--</span>
                    </div>
                    <div class="lcd-item">
                        <span class="lcd-label">STATE</span>
                        <span id="state-lcd" class="lcd-value">OFF</span>
                    </div>
                </div>
            </section>

            <section id="chart-panel">
                <div id="chart-controls">
                    <label>
                        <input type="checkbox" id="ror-toggle" checked>
                        Show RoR
                    </label>
                </div>
                <canvas id="roast-chart"></canvas>
            </section>

            <section id="control-panel">
                <div class="control-group">
                    <button id="btn-start-stop" class="btn-primary" disabled>START</button>
                    <button id="btn-off" class="btn-danger" disabled>OFF</button>
                </div>
                <div class="control-group">
                    <button class="btn-event" data-cmd="charge" disabled>CHARGE</button>
                    <button class="btn-event" data-cmd="dry" disabled>DRY</button>
                    <button class="btn-event" data-cmd="fcs" disabled>FCs</button>
                    <button class="btn-event" data-cmd="fce" disabled>FCe</button>
                    <button class="btn-event" data-cmd="scs" disabled>SCs</button>
                    <button class="btn-event" data-cmd="sce" disabled>SCe</button>
                    <button class="btn-event" data-cmd="drop" disabled>DROP</button>
                </div>
                <div class="control-group token-group">
                    <label for="token-input">Token:</label>
                    <input type="text" id="token-input" placeholder="Enter token">
                    <button id="btn-save-token">Save</button>
                </div>
                <div id="token-error" class="hidden">Invalid token</div>
            </section>
        </main>
    </div>
</body>
</html>
