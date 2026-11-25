'use strict';
// Keeps the online version's data in a private GitHub repo, for hosts whose disk is wiped on restart
// (like Render's free plan). On start it downloads every workspace; while running it uploads the
// workspaces that changed, at most once a minute, and once more when the host stops the server.
// The repo holds one commit with no history, so it never grows past the data itself.
// Settings: NEXA_GITHUB_REPO (owner/name), NEXA_GITHUB_TOKEN (fine-grained, Contents read and write
// on that repo only), NEXA_GITHUB_BRANCH (default main).
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');

const MAX_BLOB = 95 * 1024 * 1024; // GitHub refuses files over 100 MB

function createGithubStore({ repo, token, branch = 'main', dataDir, api = 'https://api.github.com', intervalMs = 60000, log = console.log }) {
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo || '')) throw new Error('NEXA_GITHUB_REPO must look like owner/name');
  if (!token) throw new Error('NEXA_GITHUB_TOKEN is missing');
  const wsRoot = path.join(dataDir, 'workspaces');
  const saved = new Map(); // path in repo -> { sha1 of content, mtime key }
  let tree = new Map(); // path in repo -> blob sha currently on GitHub
  let timer = null;
  let running = null;

  async function gh(method, url, body) {
    for (let attempt = 0; ; attempt++) {
      const r = await fetch(api + url, {
        method,
        headers: { authorization: 'Bearer ' + token, accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28', 'user-agent': 'astute-nexa', ...(body ? { 'content-type': 'application/json' } : {}) },
        body: body ? JSON.stringify(body) : undefined,
      });
      if (r.ok) return r.status === 204 ? null : r.json();
      if (r.status === 404 || r.status === 409) { const e = new Error('GitHub ' + r.status); e.status = r.status; throw e; }
      if (attempt >= 3 || (r.status < 500 && r.status !== 403 && r.status !== 429)) throw new Error(`GitHub ${method} ${url.split('?')[0]} failed: ${r.status} ${(await r.text()).slice(0, 200)}`);
      await new Promise((res) => setTimeout(res, 2000 * (attempt + 1)));
    }
  }
  const R = '/repos/' + repo;

  /** Downloads every saved workspace into the data folder. Call before the server starts. */
  async function restore() {
    fs.mkdirSync(wsRoot, { recursive: true });
    let t;
    try { t = await gh('GET', `${R}/git/trees/${encodeURIComponent(branch)}?recursive=1`); } catch (e) {
      if (e.status === 409) throw new Error(`the GitHub repo ${repo} is empty. Add a README to it on GitHub, then restart.`);
      if (e.status === 404) throw new Error(`can't find branch ${branch} in the GitHub repo ${repo}. Check NEXA_GITHUB_REPO and that the token can reach that repo.`);
      throw e;
    }
    let n = 0;
    for (const item of t.tree || []) {
      if (item.type !== 'blob') continue;
      tree.set(item.path, item.sha);
      let dest;
      const m = /^workspaces\/([a-z0-9-]+)\.db\.gz$/.exec(item.path);
      if (m) dest = path.join(wsRoot, m[1], 'nexa.db');
      else if (item.path === 'cloud-secret') dest = path.join(dataDir, 'cloud-secret');
      else continue;
      const b = await gh('GET', `${R}/git/blobs/${item.sha}`);
      let buf = Buffer.from(b.content, 'base64');
      if (m) buf = zlib.gunzipSync(buf);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      for (const ext of ['-wal', '-shm']) fs.rmSync(dest + ext, { force: true });
      fs.writeFileSync(dest, buf, { mode: 0o600 });
      saved.set(item.path, { hash: sha1(buf), key: mtimeKey(dest) });
      if (m) n++;
    }
    log(`GitHub save: restored ${n} workspace${n === 1 ? '' : 's'}.`);
    return n;
  }

  const sha1 = (b) => crypto.createHash('sha1').update(b).digest('hex');
  function mtimeKey(db) {
    let k = '';
    for (const f of [db, db + '-wal']) { try { const s = fs.statSync(f); k += s.mtimeMs + ':' + s.size + ';'; } catch { k += '-;'; } }
    return k;
  }

  function changedFiles() {
    const out = [];
    const secret = path.join(dataDir, 'cloud-secret');
    if (fs.existsSync(secret)) {
      const buf = fs.readFileSync(secret);
      if (saved.get('cloud-secret')?.hash !== sha1(buf)) out.push({ path: 'cloud-secret', buf, hash: sha1(buf) });
    }
    for (const name of fs.existsSync(wsRoot) ? fs.readdirSync(wsRoot) : []) {
      if (!/^[a-z0-9-]+$/.test(name)) continue;
      const db = path.join(wsRoot, name, 'nexa.db');
      if (!fs.existsSync(db)) continue;
      const p = `workspaces/${name}.db.gz`;
      const key = mtimeKey(db);
      if (saved.get(p)?.key === key) continue;
      const tmp = path.join(os.tmpdir(), `nexa-save-${name}-${process.pid}.db`);
      fs.rmSync(tmp, { force: true });
      const d = new DatabaseSync(db, { readOnly: true });
      try { d.exec(`VACUUM INTO '${tmp.replace(/'/g, "''")}'`); } finally { d.close(); }
      const raw = fs.readFileSync(tmp);
      fs.rmSync(tmp, { force: true });
      const hash = sha1(raw);
      if (saved.get(p)?.hash === hash) { saved.set(p, { hash, key }); continue; }
      const buf = zlib.gzipSync(raw, { level: 6 });
      if (buf.length > MAX_BLOB) { log(`GitHub save: workspace ${name} is too big to save (${Math.round(buf.length / 1048576)} MB).`); continue; }
      out.push({ path: p, buf, hash, key });
    }
    return out;
  }

  async function saveOnce() {
    const files = changedFiles();
    if (!files.length) return 0;
    const entries = [];
    for (const f of files) {
      const b = await gh('POST', `${R}/git/blobs`, { content: f.buf.toString('base64'), encoding: 'base64' });
      entries.push({ path: f.path, mode: '100644', type: 'blob', sha: b.sha });
    }
    const next = new Map(tree);
    for (const e of entries) next.set(e.path, e.sha);
    // Drop workspaces that no longer exist on disk.
    for (const p of [...next.keys()]) {
      const m = /^workspaces\/([a-z0-9-]+)\.db\.gz$/.exec(p);
      if (m && !fs.existsSync(path.join(wsRoot, m[1], 'nexa.db'))) next.delete(p);
    }
    const t = await gh('POST', `${R}/git/trees`, { tree: [...next].map(([p, sha]) => ({ path: p, mode: '100644', type: 'blob', sha })) });
    const c = await gh('POST', `${R}/git/commits`, { message: 'Astute Nexa data ' + new Date().toISOString(), tree: t.sha, parents: [] });
    try { await gh('PATCH', `${R}/git/refs/heads/${encodeURIComponent(branch)}`, { sha: c.sha, force: true }); } catch (e) {
      if (e.status !== 404 && e.status !== 409 && !/422/.test(e.message)) throw e;
      await gh('POST', `${R}/git/refs`, { ref: 'refs/heads/' + branch, sha: c.sha });
    }
    tree = next;
    for (const f of files) saved.set(f.path, { hash: f.hash, key: f.key });
    return files.length;
  }

  /** Uploads whatever changed. Calls never overlap. */
  function save() {
    if (!running) running = saveOnce().catch((e) => { log('GitHub save failed: ' + e.message); return -1; }).finally(() => { running = null; });
    return running;
  }
  function start() { if (!timer) { timer = setInterval(save, intervalMs); timer.unref(); } }
  async function stop() { if (timer) clearInterval(timer); timer = null; if (running) await running; return save(); }

  return { restore, save, start, stop };
}

function githubStoreFromEnv(env, dataDir) {
  if (!env.NEXA_GITHUB_REPO) return null;
  return createGithubStore({ repo: env.NEXA_GITHUB_REPO, token: env.NEXA_GITHUB_TOKEN, branch: env.NEXA_GITHUB_BRANCH || 'main', dataDir, ...(env.NEXA_GITHUB_API ? { api: env.NEXA_GITHUB_API } : {}) });
}

module.exports = { createGithubStore, githubStoreFromEnv };
