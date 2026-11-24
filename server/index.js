'use strict';
// Start Astute Nexa. Settings come from environment variables (see README).
const path = require('node:path');
const os = require('node:os');
const { createServer } = require('./app');

function start({ open = false } = {}) {
  const port = +(process.env.PORT || 4580);
  const host = process.env.HOST || '0.0.0.0';
  const dataDir = process.env.NEXA_DATA || path.join(os.homedir(), '.astute-nexa');
  const { server } = createServer({
    dbPath: path.join(dataDir, 'nexa.db'),
    secureCookies: process.env.NEXA_SECURE_COOKIES === '1',
    trustProxy: process.env.NEXA_TRUST_PROXY === '1',
    smtpUrl: process.env.NEXA_SMTP_URL || null,
    smtpFrom: process.env.NEXA_SMTP_FROM || null,
    maxUpload: (+process.env.NEXA_MAX_UPLOAD_MB || 100) * 1024 * 1024,
    quotaBytes: (+process.env.NEXA_QUOTA_GB || 0) * 1024 ** 3,
  });
  server.listen(port, host, () => {
    const url = `http://localhost:${port}`;
    console.log(`\n  Astute Nexa is running at ${url}\n  Your data is stored in ${dataDir}\n  Press Ctrl+C to stop.\n`);
    if (open) openBrowser(url);
  });
  return server;
}

function openBrowser(url) {
  const { spawn } = require('node:child_process');
  const cmd = process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]] : process.platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]];
  try { spawn(cmd[0], cmd[1], { stdio: 'ignore', detached: true }).unref(); } catch { /* no browser available */ }
}

if (require.main === module) start({ open: process.env.NEXA_OPEN === '1' });
module.exports = { start };
