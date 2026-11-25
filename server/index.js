'use strict';
// Start Astute Nexa. Settings come from environment variables (see README).
const path = require('node:path');
const os = require('node:os');
const { createServer } = require('./app');

function start({ open = false } = {}) {
  const port = +(process.env.PORT || 4580);
  const host = process.env.HOST || '0.0.0.0';
  const dataDir = process.env.NEXA_DATA || path.join(os.homedir(), '.astute-nexa');
  if (process.env.NEXA_CLOUD === '1') return startCloud({ port, host, dataDir });
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

// Many workspaces on one server, for the online version. See deploy/README.md.
function startCloud({ port, host, dataDir }) {
  const { createCloud, providersFromEnv } = require('./cloud');
  const { server } = createCloud({
    dataDir,
    publicUrl: process.env.NEXA_PUBLIC_URL || '',
    secureCookies: process.env.NEXA_SECURE_COOKIES === '1',
    trustProxy: process.env.NEXA_TRUST_PROXY === '1',
    maxWorkspaces: +process.env.NEXA_MAX_WORKSPACES || 100,
    workspaceQuotaBytes: (+process.env.NEXA_WORKSPACE_GB || 1) * 1024 ** 3,
    maxUpload: (+process.env.NEXA_MAX_UPLOAD_MB || 25) * 1024 * 1024,
    providers: providersFromEnv(),
  });
  server.listen(port, host, () => console.log(`Astute Nexa online is running on port ${port}. Workspaces are stored in ${dataDir}/workspaces`));
  return server;
}

function openBrowser(url) {
  const { spawn } = require('node:child_process');
  const cmd = process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]] : process.platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]];
  try { spawn(cmd[0], cmd[1], { stdio: 'ignore', detached: true }).unref(); } catch { /* no browser available */ }
}

if (require.main === module) start({ open: process.env.NEXA_OPEN === '1' });
module.exports = { start };
