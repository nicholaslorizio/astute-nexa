'use strict';
// Astute Nexa desktop launcher. Used by the Windows app, the Mac app and the Linux bundle.
// It starts the Nexa server on this computer only and opens Nexa in its own window.
// Closing that window stops Nexa. Opening the app again while it runs brings the window back.
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const http = require('node:http');
const { spawn, spawnSync } = require('node:child_process');
const { createRequire } = require('node:module');

const isWin = process.platform === 'win32';
const isMac = process.platform === 'darwin';
// The app files sit next to the launcher: <install>/app on Windows and Linux, Contents/Resources/app on Mac.
const here = path.dirname(process.execPath);
const appDir = [path.join(here, 'app'), path.join(here, '..', 'Resources', 'app'), path.join(__dirname || here, '..')]
  .find((d) => fs.existsSync(path.join(d, 'server', 'index.js')));
const dataDir = process.env.NEXA_DATA || (isWin ? path.join(process.env.LOCALAPPDATA || os.homedir(), 'Astute Nexa', 'data')
  : isMac ? path.join(os.homedir(), 'Library', 'Application Support', 'Astute Nexa') : path.join(os.homedir(), '.astute-nexa'));
fs.mkdirSync(dataDir, { recursive: true });

// The Windows app has no console window, so everything is written to a log file instead.
const logFile = path.join(dataDir, 'nexa.log');
const log = (...a) => { try { fs.appendFileSync(logFile, `[${new Date().toISOString()}] ${a.map(String).join(' ')}\n`); } catch { /* ignore */ } };
console.log = console.info = console.warn = console.error = log;
process.removeAllListeners('warning');
process.on('warning', (w) => { if (w.name !== 'ExperimentalWarning') log(w.stack || w); });

function alertBox(text) {
  log('ALERT', text);
  try {
    if (isWin) spawnSync('mshta', [`vbscript:Execute("MsgBox ""${text.replace(/"/g, "'")}"",16,""Astute Nexa"":close")`]);
    else if (isMac) spawnSync('osascript', ['-e', `display alert "Astute Nexa" message "${text.replace(/"/g, "'")}"`]);
  } catch { /* nothing more we can do */ }
}

function ping(port) {
  return new Promise((resolve) => {
    const req = http.get({ host: '127.0.0.1', port, path: '/api/state', timeout: 1500 }, (res) => {
      let body = ''; res.on('data', (c) => { body += c; });
      res.on('end', () => { try { resolve('setupNeeded' in JSON.parse(body)); } catch { resolve(false); } });
    });
    req.on('error', () => resolve(false)); req.on('timeout', () => { req.destroy(); resolve(false); });
  });
}
function portFree(port) {
  return new Promise((resolve) => {
    const s = require('node:net').createServer().once('error', () => resolve(false)).once('listening', () => s.close(() => resolve(true))).listen(port, '127.0.0.1');
  });
}

function findAppBrowser() {
  const c = [];
  if (isWin) {
    for (const base of [process.env['ProgramFiles(x86)'], process.env.ProgramFiles, process.env.LOCALAPPDATA].filter(Boolean)) {
      c.push(path.join(base, 'Microsoft', 'Edge', 'Application', 'msedge.exe'), path.join(base, 'Google', 'Chrome', 'Application', 'chrome.exe'));
    }
  } else if (isMac) {
    c.push('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
      '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser', '/Applications/Chromium.app/Contents/MacOS/Chromium');
  } else {
    for (const b of ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser', 'microsoft-edge', 'brave-browser']) {
      const r = spawnSync('sh', ['-c', `command -v ${b}`], { encoding: 'utf8' });
      if (r.status === 0 && r.stdout.trim()) c.push(r.stdout.trim());
    }
  }
  return c.find((p) => { try { return fs.statSync(p).isFile(); } catch { return false; } });
}

// Opens Nexa in its own app window. Resolves when that window is closed.
function openWindow(url) {
  const browser = findAppBrowser();
  if (browser) {
    const child = spawn(browser, [`--app=${url}`, `--user-data-dir=${path.join(dataDir, 'window')}`, '--no-first-run',
      '--no-default-browser-check', '--window-size=1320,880'], { stdio: 'ignore', windowsHide: false });
    return new Promise((resolve) => { child.on('exit', resolve); child.on('error', () => resolve(openDefault(url))); });
  }
  return openDefault(url);
}
function openDefault(url) {
  // No app-window browser found: use the normal browser. Nexa then keeps running until the computer restarts or it's quit.
  const c = isWin ? spawn('cmd', ['/c', 'start', '', url], { stdio: 'ignore', windowsHide: true })
    : spawn(isMac ? 'open' : 'xdg-open', [url], { stdio: 'ignore', detached: true });
  c.on('error', () => log(`No browser could be opened. Open ${url} yourself.`));
  c.unref();
  return new Promise(() => {});
}

async function main() {
  if (!appDir) return alertBox('Astute Nexa could not find its files. Please reinstall it.');
  let port = +(process.env.PORT || 4580);
  if (await ping(port)) { await openWindow(`http://localhost:${port}`); return process.exit(0); }
  while (!(await portFree(port))) { port++; if (port > 4600) return alertBox('Astute Nexa could not find a free port to start on.'); }
  process.env.PORT = String(port);
  process.env.HOST = process.env.HOST || '127.0.0.1';
  process.env.NEXA_DATA = dataDir;
  log(`Starting Astute Nexa from ${appDir} on port ${port}, data in ${dataDir}`);
  const appRequire = createRequire(path.join(appDir, 'package.json'));
  const server = appRequire('./server/index.js').start({ open: false });
  server.on('error', (e) => { alertBox('Astute Nexa could not start: ' + e.message); process.exit(1); });
  server.on('listening', async () => {
    await openWindow(`http://localhost:${port}`);
    log('Window closed, stopping Astute Nexa');
    server.close(); setTimeout(() => process.exit(0), 1500).unref();
  });
}
process.on('uncaughtException', (e) => { alertBox('Astute Nexa hit a problem: ' + (e && e.message)); process.exit(1); });
main();
