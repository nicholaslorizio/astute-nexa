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
// With NEXA_GITHUB_REPO set, data is kept in a private GitHub repo (see deploy/RENDER.md).
function startCloud({ port, host, dataDir }) {
  const { createCloud, providersFromEnv } = require('./cloud');
  const store = require('./github-store').githubStoreFromEnv(process.env, dataDir);
  // Keep trying while GitHub can't be reached, instead of giving up. The host keeps the old copy
  // running until this one answers, and starting without the saved data would lose it.
  const restore = async () => {
    for (let wait = 5000; ; wait = Math.min(wait * 2, 60000)) {
      try { return await store.restore(); } catch (e) {
        if (e.permanent) throw e;
        console.error(`Could not load workspaces from GitHub (${e.message}). Trying again in ${wait / 1000} seconds.`);
        await new Promise((r) => setTimeout(r, wait));
      }
    }
  };
  const ready = store ? restore() : Promise.resolve();
  return ready.then(() => {
    const cloud = createCloud({
      dataDir,
      publicUrl: process.env.NEXA_PUBLIC_URL || process.env.RENDER_EXTERNAL_URL || '',
      secureCookies: process.env.NEXA_SECURE_COOKIES === '1',
      trustProxy: process.env.NEXA_TRUST_PROXY === '1',
      maxWorkspaces: +process.env.NEXA_MAX_WORKSPACES || 100,
      workspaceQuotaBytes: (+process.env.NEXA_WORKSPACE_GB || 1) * 1024 ** 3,
      maxUpload: (+process.env.NEXA_MAX_UPLOAD_MB || 25) * 1024 * 1024,
      ...(process.env.NEXA_MIN_FREE_MB ? { minFreeBytes: +process.env.NEXA_MIN_FREE_MB * 1024 * 1024 } : {}),
      providers: providersFromEnv(),
    });
    const { server } = cloud;
    server.listen(port, host, () => console.log(`Astute Nexa online is running on port ${port}. Workspaces are stored in ${dataDir}/workspaces`));
    if (store) {
      store.start({ release: cloud.release });
      let stopping = false;
      const finish = async () => {
        if (stopping) return; stopping = true;
        console.log('Saving workspaces to GitHub before stopping...');
        await store.stop();
        process.exit(0);
      };
      process.on('SIGTERM', finish);
      process.on('SIGINT', finish);
    }
    return server;
  }).catch((e) => { console.error('Astute Nexa could not start: ' + e.message); process.exit(1); });
}

function openBrowser(url) {
  const { spawn } = require('node:child_process');
  const cmd = process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]] : process.platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]];
  try { spawn(cmd[0], cmd[1], { stdio: 'ignore', detached: true }).unref(); } catch { /* no browser available */ }
}

if (require.main === module) start({ open: process.env.NEXA_OPEN === '1' });
module.exports = { start };
