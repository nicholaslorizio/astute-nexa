'use strict';
// Keeps the online version's data in a private GitHub repo, for hosts whose disk is wiped on restart
// (like Render's free plan). On start it downloads every workspace; while running it uploads the
// workspaces that changed, at most once a minute, and once more when the host stops the server.
// Each save starts from what is on GitHub at that moment, so during a deploy, when the old and new
// copies of the server run side by side for a little while, neither copy wipes out the other's saves.
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

function createGithubStore({ repo, token, branch = 'main', dataDir, api = 'https://api.github.com', intervalMs = 60000, log = console.log, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) }) {
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo || '')) throw new Error('NEXA_GITHUB_REPO must look like owner/name');
  if (!token) throw new Error('NEXA_GITHUB_TOKEN is missing');
  const wsRoot = path.join(dataDir, 'workspaces');
  const saved = new Map(); // path in repo -> { sha1 of content, mtime key } as last restored, pulled or uploaded
  let tree = new Map(); // path in repo -> blob sha as this server last saw it on GitHub
  let seen = { commit: null, files: new Map() }; // the last commit read from GitHub, and its files
  let timers = [];
  let queue = Promise.resolve();
  let release = () => true; // closes an open workspace so a newer copy can replace it (set by start)

  async function gh(method, url, body) {
    for (let attempt = 0; ; attempt++) {
      let r;
      try {
        r = await fetch(api + url, {
          method,
          headers: { authorization: 'Bearer ' + token, accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28', 'user-agent': 'astute-nexa', ...(body ? { 'content-type': 'application/json' } : {}) },
          body: body ? JSON.stringify(body) : undefined,
          signal: AbortSignal.timeout(30000),
        });
      } catch (e) {
        // GitHub could not be reached at all (network down, DNS, timeout): try again a few times.
        if (attempt >= 3) throw new Error(`GitHub ${method} ${url.split('?')[0]} could not be reached: ${e.message}`);
        await sleep(2000 * (attempt + 1));
        continue;
      }
      if (r.ok) return r.status === 204 ? null : r.json();
      if (r.status === 404 || r.status === 409) { const e = new Error('GitHub ' + r.status); e.status = r.status; throw e; }
      if (attempt >= 3 || (r.status < 500 && r.status !== 403 && r.status !== 429)) throw new Error(`GitHub ${method} ${url.split('?')[0]} failed: ${r.status} ${(await r.text()).slice(0, 200)}`);
      await sleep(2000 * (attempt + 1));
    }
  }
  const R = '/repos/' + repo;
  const wsPath = (p) => { const m = /^workspaces\/([a-z0-9-]+)\.db\.gz$/.exec(p); return m && m[1]; };
  const dbOf = (name) => path.join(wsRoot, name, 'nexa.db');

  /** The commit on GitHub now and its files, or an empty list when the branch doesn't exist yet. */
  async function remote() {
    let ref;
    try { ref = await gh('GET', `${R}/git/ref/heads/${encodeURIComponent(branch)}`); } catch (e) {
      if (e.status === 404) return { commit: null, files: new Map() };
      throw e;
    }
    const commit = ref.object.sha;
    if (commit === seen.commit) return { commit, files: new Map(seen.files) };
    const c = await gh('GET', `${R}/git/commits/${commit}`);
    const t = await gh('GET', `${R}/git/trees/${c.tree.sha}?recursive=1`);
    const files = new Map();
    for (const item of t.tree || []) if (item.type === 'blob') files.set(item.path, item.sha);
    seen = { commit, files };
    return { commit, files: new Map(files) };
  }

  async function fetchBlob(p, sha) {
    const b = await gh('GET', `${R}/git/blobs/${sha}`);
    const buf = Buffer.from(b.content, 'base64');
    return wsPath(p) ? zlib.gunzipSync(buf) : buf;
  }
  // Puts a downloaded file in place. It runs without pausing, so no request can open the old copy halfway.
  function install(p, sha, buf) {
    const name = wsPath(p);
    const dest = name ? dbOf(name) : path.join(dataDir, 'cloud-secret');
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    const tmp = dest + '.incoming';
    fs.writeFileSync(tmp, buf, { mode: 0o600 });
    for (const ext of ['-wal', '-shm']) fs.rmSync(dest + ext, { force: true });
    fs.renameSync(tmp, dest);
    saved.set(p, { hash: sha1(buf), key: mtimeKey(dest) });
    tree.set(p, sha);
  }

  /** Downloads every saved workspace into the data folder. Call before the server starts. */
  async function restore() {
    fs.mkdirSync(wsRoot, { recursive: true });
    let r;
    try {
      // An empty repo answers 409, and a missing branch 404: both mean the settings need fixing.
      r = await remote();
      if (!r.commit) { const e = new Error(`can't find branch ${branch} in the GitHub repo ${repo}. Check NEXA_GITHUB_REPO and that the token can reach that repo.`); e.permanent = true; throw e; }
    } catch (e) {
      if (e.status === 409) { const e2 = new Error(`the GitHub repo ${repo} is empty. Add a README to it on GitHub, then restart.`); e2.permanent = true; throw e2; }
      throw e;
    }
    let n = 0;
    for (const [p, sha] of r.files) {
      if (wsPath(p) || p === 'cloud-secret') { install(p, sha, await fetchBlob(p, sha)); if (wsPath(p)) n++; } else tree.set(p, sha);
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
  // A clean copy of a workspace's database, the same however its write-ahead log happens to look.
  function snapshot(name) {
    const tmp = path.join(os.tmpdir(), `nexa-save-${name}-${process.pid}.db`);
    fs.rmSync(tmp, { force: true });
    const d = new DatabaseSync(dbOf(name), { readOnly: true });
    try { d.exec(`VACUUM INTO '${tmp.replace(/'/g, "''")}'`); } finally { d.close(); }
    const raw = fs.readFileSync(tmp);
    fs.rmSync(tmp, { force: true });
    return raw;
  }
  /** True when a workspace was changed here since it was last restored, pulled or uploaded. */
  function changedHere(p, name) {
    const s = saved.get(p);
    if (!s) return true;
    const key = mtimeKey(dbOf(name));
    if (s.key === key) return false;
    const hash = sha1(snapshot(name));
    if (hash === s.hash) { saved.set(p, { hash, key }); return false; }
    return true;
  }

  // Brings in workspaces another copy of the server saved since this one last looked. This matters
  // during a deploy, when the old copy keeps running (and saves once more as it stops) after the new
  // copy has restored. A workspace changed on both sides keeps this copy's version.
  async function pull(r) {
    for (const [p, sha] of r.files) {
      const name = wsPath(p);
      if (!name || tree.get(p) === sha) continue;
      const buf = await fetchBlob(p, sha);
      // From here to the end of the loop body nothing waits, so the workspace can't change in between.
      if (fs.existsSync(dbOf(name))) {
        if (changedHere(p, name)) {
          log(`GitHub save: workspace ${name} changed in two places; keeping this server's copy.`);
          tree.set(p, sha); // this server's copy replaces it on the next save
          continue;
        }
        if (!release(name)) continue;
      }
      install(p, sha, buf);
      log(`GitHub save: brought in the newer copy of workspace ${name}.`);
    }
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
      if (!fs.existsSync(dbOf(name))) continue;
      const p = `workspaces/${name}.db.gz`;
      const key = mtimeKey(dbOf(name));
      if (saved.get(p)?.key === key) continue;
      const raw = snapshot(name);
      const hash = sha1(raw);
      if (saved.get(p)?.hash === hash) { saved.set(p, { hash, key }); continue; }
      const buf = zlib.gzipSync(raw, { level: 6 });
      if (buf.length > MAX_BLOB) { log(`GitHub save: workspace ${name} is too big to save (${Math.round(buf.length / 1048576)} MB).`); continue; }
      out.push({ path: p, buf, hash, key });
    }
    return out;
  }

  async function saveOnce({ pullFirst = true } = {}) {
    for (let tries = 0; ; tries++) {
      const r = await remote();
      if (pullFirst) await pull(r);
      const files = changedFiles();
      // Start from what is on GitHub now, not from what this server restored, so another copy's saves are kept.
      const next = new Map(r.files);
      // Drop workspaces deleted here. One this server never had, or that changed on GitHub since, stays.
      let dropped = 0;
      for (const [p, sha] of [...next]) {
        const name = wsPath(p);
        if (name && !fs.existsSync(dbOf(name)) && tree.get(p) === sha) { next.delete(p); dropped++; }
      }
      if (!files.length && !dropped) return 0;
      for (const f of files) {
        const b = await gh('POST', `${R}/git/blobs`, { content: f.buf.toString('base64'), encoding: 'base64' });
        next.set(f.path, b.sha);
      }
      const t = await gh('POST', `${R}/git/trees`, { tree: [...next].map(([p, sha]) => ({ path: p, mode: '100644', type: 'blob', sha })) });
      const c = await gh('POST', `${R}/git/commits`, { message: 'Astute Nexa data ' + new Date().toISOString(), tree: t.sha, parents: [] });
      // If another copy saved while this one was uploading, start over from its save.
      const now = await remote().then((x) => x.commit, () => r.commit);
      if (now !== r.commit && tries < 3) { log('GitHub save: another server saved at the same moment; merging again.'); continue; }
      if (r.commit) await gh('PATCH', `${R}/git/refs/heads/${encodeURIComponent(branch)}`, { sha: c.sha, force: true });
      else await gh('POST', `${R}/git/refs`, { ref: 'refs/heads/' + branch, sha: c.sha });
      for (const f of files) tree.set(f.path, next.get(f.path));
      for (const [p] of tree) if (wsPath(p) && !next.has(p)) tree.delete(p);
      seen = { commit: c.sha, files: new Map(next) };
      for (const f of files) saved.set(f.path, { hash: f.hash, key: f.key });
      return files.length;
    }
  }

  // Saves and pulls take turns, so they never overlap.
  function exclusive(fn) {
    const run = queue.then(fn);
    queue = run.catch(() => {});
    return run;
  }
  /** Uploads whatever changed, after bringing in newer saves from another copy. */
  function save() {
    return exclusive(() => saveOnce()).catch((e) => { log('GitHub save failed: ' + e.message); return -1; });
  }
  /** Only brings in newer saves from another copy. */
  function sync() {
    return exclusive(async () => { await pull(await remote()); }).catch((e) => { log('GitHub check failed: ' + e.message); });
  }
  /**
   * Saves every minute. For the first few minutes it also checks every 10 seconds for the old copy's
   * last save during a deploy. opts.release(name) should close that workspace if it is open, and
   * return false if it can't be replaced right now.
   */
  function start(opts = {}) {
    if (timers.length) return;
    if (opts.release) release = opts.release;
    const fastMs = opts.fastMs ?? 10000, fastForMs = opts.fastForMs ?? 3 * 60000;
    const fast = setInterval(sync, fastMs);
    const slow = setInterval(save, intervalMs);
    const endFast = setTimeout(() => clearInterval(fast), fastForMs);
    timers = [fast, slow, endFast];
    for (const t of timers) t.unref();
  }
  /** The last save as the server stops. It skips pulling, since this copy is going away. */
  async function stop() {
    for (const t of timers) { clearInterval(t); clearTimeout(t); }
    timers = [];
    return exclusive(() => saveOnce({ pullFirst: false })).catch((e) => { log('GitHub save failed: ' + e.message); return -1; });
  }

  return { restore, save, sync, start, stop };
}

function githubStoreFromEnv(env, dataDir) {
  if (!env.NEXA_GITHUB_REPO) return null;
  return createGithubStore({ repo: env.NEXA_GITHUB_REPO, token: env.NEXA_GITHUB_TOKEN, branch: env.NEXA_GITHUB_BRANCH || 'main', dataDir, ...(env.NEXA_GITHUB_API ? { api: env.NEXA_GITHUB_API } : {}) });
}

module.exports = { createGithubStore, githubStoreFromEnv };
