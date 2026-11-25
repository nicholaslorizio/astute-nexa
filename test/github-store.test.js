'use strict';
// The GitHub save keeps workspaces across restarts, against a stand-in for GitHub's API.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const { createGithubStore } = require('../server/github-store');

function fakeGithub() {
  const blobs = new Map(); const trees = new Map(); const commits = new Map(); const refs = new Map();
  let calls = 0;
  const sha = () => crypto.randomBytes(20).toString('hex');
  const server = http.createServer((req, res) => {
    calls++;
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      const j = body ? JSON.parse(body) : null;
      const send = (code, o) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(o)); };
      if (req.headers.authorization !== 'Bearer tok') return send(401, { message: 'Bad credentials' });
      const u = new URL(req.url, 'http://x');
      let m;
      if (req.method === 'GET' && (m = /\/git\/ref\/heads\/(.+)$/.exec(u.pathname))) {
        if (!refs.size) return send(409, { message: 'Git Repository is empty.' });
        const c = refs.get(decodeURIComponent(m[1]));
        return c ? send(200, { object: { sha: c, type: 'commit' } }) : send(404, { message: 'Not Found' });
      }
      if (req.method === 'GET' && (m = /\/git\/commits\/(\w+)$/.exec(u.pathname))) return commits.has(m[1]) ? send(200, { sha: m[1], tree: { sha: commits.get(m[1]).tree } }) : send(404, {});
      if (req.method === 'GET' && (m = /\/git\/trees\/([^/]+)$/.exec(u.pathname))) {
        if (trees.has(m[1])) return send(200, { tree: trees.get(m[1]) });
        const c = refs.get(decodeURIComponent(m[1]));
        if (!c) return send(409, { message: 'Git Repository is empty.' });
        return send(200, { tree: trees.get(commits.get(c).tree) });
      }
      if (req.method === 'GET' && (m = /\/git\/blobs\/(\w+)$/.exec(u.pathname))) return send(200, { content: blobs.get(m[1]), encoding: 'base64' });
      if (req.method === 'POST' && u.pathname.endsWith('/git/blobs')) { const s = sha(); blobs.set(s, j.content); return send(201, { sha: s }); }
      if (req.method === 'POST' && u.pathname.endsWith('/git/trees')) { const s = sha(); trees.set(s, j.tree); return send(201, { sha: s }); }
      if (req.method === 'POST' && u.pathname.endsWith('/git/commits')) { const s = sha(); commits.set(s, j); return send(201, { sha: s }); }
      if (req.method === 'PATCH' && (m = /\/git\/refs\/heads\/(.+)$/.exec(u.pathname))) {
        if (!refs.has(m[1])) return send(422, { message: 'Reference does not exist' });
        refs.set(m[1], j.sha); return send(200, {});
      }
      if (req.method === 'POST' && u.pathname.endsWith('/git/refs')) { refs.set(j.ref.replace('refs/heads/', ''), j.sha); return send(201, {}); }
      send(404, { message: 'Not Found' });
    });
  });
  const seed = () => { const b = sha(); blobs.set(b, Buffer.from('# data').toString('base64')); const t = sha(); trees.set(t, [{ path: 'README.md', mode: '100644', type: 'blob', sha: b }]); const c = sha(); commits.set(c, { tree: t, parents: [] }); refs.set('main', c); };
  return new Promise((r) => server.listen(0, '127.0.0.1', () => r({ server, seed, api: 'http://127.0.0.1:' + server.address().port, refs, commits, trees, calls: () => calls })));
}

function makeWorkspace(dataDir, name, text) {
  const dir = path.join(dataDir, 'workspaces', name);
  fs.mkdirSync(dir, { recursive: true });
  const db = new DatabaseSync(path.join(dir, 'nexa.db'));
  db.exec('PRAGMA journal_mode = WAL; CREATE TABLE IF NOT EXISTS t (v TEXT)');
  db.prepare('INSERT INTO t (v) VALUES (?)').run(text);
  return db;
}
const read = (dataDir, name) => { const d = new DatabaseSync(path.join(dataDir, 'workspaces', name, 'nexa.db'), { readOnly: true }); const r = d.prepare('SELECT v FROM t ORDER BY rowid').all().map((x) => x.v); d.close(); return r; };

test('saves workspaces to GitHub and brings them back on a fresh disk', async () => {
  const gh = await fakeGithub();
  const quiet = () => {};
  const a = fs.mkdtempSync(path.join(os.tmpdir(), 'nexa-gh-a-'));
  try {
    const s1 = createGithubStore({ repo: 'nick/nexa-data', token: 'tok', dataDir: a, api: gh.api, log: quiet });
    await assert.rejects(s1.restore(), /is empty/);
    gh.seed();
    assert.equal(await s1.restore(), 0);
    fs.writeFileSync(path.join(a, 'cloud-secret'), 'secret-1');
    const db1 = makeWorkspace(a, 'acme', 'hello');
    const db2 = makeWorkspace(a, 'beta', 'one');
    assert.equal(await s1.save(), 3);
    const before = gh.calls();
    assert.equal(await s1.save(), 0, 'nothing changed, nothing uploaded');
    assert.equal(gh.calls() - before, 1, 'only one quick look at what is on GitHub');
    db1.prepare('INSERT INTO t (v) VALUES (?)').run('world');
    assert.equal(await s1.save(), 1, 'only the changed workspace goes up');
    db1.close(); db2.close();
    const commit = gh.commits.get(gh.refs.get('main'));
    assert.deepEqual(commit.parents, [], 'one commit, no history');

    // A restart on a wiped disk.
    const b = fs.mkdtempSync(path.join(os.tmpdir(), 'nexa-gh-b-'));
    const s2 = createGithubStore({ repo: 'nick/nexa-data', token: 'tok', dataDir: b, api: gh.api, log: quiet });
    assert.equal(await s2.restore(), 2);
    assert.deepEqual(read(b, 'acme'), ['hello', 'world']);
    assert.deepEqual(read(b, 'beta'), ['one']);
    assert.equal(fs.readFileSync(path.join(b, 'cloud-secret'), 'utf8'), 'secret-1');
    assert.equal(await s2.save(), 0, 'freshly restored data is not uploaded again');

    // A deleted workspace leaves the repo on the next save.
    fs.rmSync(path.join(b, 'workspaces', 'beta'), { recursive: true });
    const db3 = new DatabaseSync(path.join(b, 'workspaces', 'acme', 'nexa.db'));
    db3.prepare('INSERT INTO t (v) VALUES (?)').run('again');
    db3.close();
    await s2.stop();
    const paths = gh.trees.get(gh.commits.get(gh.refs.get('main')).tree).map((e) => e.path).sort();
    assert.deepEqual(paths, ['README.md', 'cloud-secret', 'workspaces/acme.db.gz']);
    fs.rmSync(b, { recursive: true, force: true });
  } finally {
    fs.rmSync(a, { recursive: true, force: true });
    gh.server.close();
  }
});

test('during a deploy, the old and new copies keep each other’s saves', async () => {
  const gh = await fakeGithub();
  gh.seed();
  const quiet = () => {};
  const dirs = [];
  const tmp = (n) => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'nexa-gh-' + n + '-')); dirs.push(d); return d; };
  const store = (dataDir) => createGithubStore({ repo: 'nick/nexa-data', token: 'tok', dataDir, api: gh.api, log: quiet });
  const add = (dataDir, name, text) => { const d = new DatabaseSync(path.join(dataDir, 'workspaces', name, 'nexa.db')); d.prepare('INSERT INTO t (v) VALUES (?)').run(text); d.close(); };
  try {
    // The old copy is running with two workspaces.
    const a = tmp('old');
    const oldCopy = store(a);
    await oldCopy.restore();
    makeWorkspace(a, 'acme', 'hello').close();
    makeWorkspace(a, 'shared', 'one').close();
    await oldCopy.save();

    // The new copy starts and restores while the old one keeps running.
    const b = tmp('new');
    const newCopy = store(b);
    assert.equal(await newCopy.restore(), 2);
    const released = [];
    newCopy.start({ release: (name) => { released.push(name); return true; }, fastMs: 1e9, fastForMs: 1e9 });

    // In the overlap, people keep working on the old copy, a workspace is made there, and it saves as it stops.
    add(a, 'acme', 'last minute');
    makeWorkspace(a, 'fresh', 'made during deploy').close();
    // Meanwhile on the new copy a workspace is made and another one is changed.
    makeWorkspace(b, 'beta', 'new copy').close();
    add(b, 'shared', 'two');
    add(a, 'shared', 'old side');
    await oldCopy.stop();

    // The new copy's next save brings in the old copy's last work and keeps everything.
    assert.ok(await newCopy.save() > 0);
    assert.deepEqual(released, ['acme'], 'the open workspace is closed before its newer copy goes in');
    assert.deepEqual(read(b, 'acme'), ['hello', 'last minute']);
    assert.deepEqual(read(b, 'fresh'), ['made during deploy']);
    await newCopy.stop();

    // A later restart on a wiped disk finds every workspace.
    const c = tmp('later');
    assert.equal(await store(c).restore(), 4);
    assert.deepEqual(read(c, 'acme'), ['hello', 'last minute']);
    assert.deepEqual(read(c, 'fresh'), ['made during deploy']);
    assert.deepEqual(read(c, 'beta'), ['new copy']);
    assert.deepEqual(read(c, 'shared'), ['one', 'two'], 'a workspace changed on both copies keeps the running copy’s version');
  } finally {
    for (const d of dirs) fs.rmSync(d, { recursive: true, force: true });
    gh.server.close();
  }
});

test('if GitHub cannot be reached at start, the error says to try again rather than stop', async () => {
  const s = createGithubStore({ repo: 'nick/nexa-data', token: 'tok', dataDir: fs.mkdtempSync(path.join(os.tmpdir(), 'nexa-gh-down-')), api: 'http://127.0.0.1:9', log: () => {}, sleep: async () => {} });
  const e = await s.restore().then(() => null, (x) => x);
  assert.ok(e && /could not be reached/.test(e.message), String(e && e.message));
  assert.ok(!e.permanent, 'a network problem is worth retrying');
  const gh = await fakeGithub();
  try {
    const empty = createGithubStore({ repo: 'nick/nexa-data', token: 'tok', dataDir: os.tmpdir(), api: gh.api, log: () => {} });
    const e2 = await empty.restore().then(() => null, (x) => x);
    assert.ok(e2.permanent && /is empty/.test(e2.message), 'a settings problem is not retried');
  } finally { gh.server.close(); }
});

test('refuses a bad repo name or a missing token', () => {
  assert.throws(() => createGithubStore({ repo: 'not a repo', token: 'x', dataDir: os.tmpdir() }), /owner\/name/);
  assert.throws(() => createGithubStore({ repo: 'a/b', token: '', dataDir: os.tmpdir() }), /TOKEN/);
});

test('the online server keeps a new workspace across a stop and a wiped disk', async () => {
  const { spawn } = require('node:child_process');
  const gh = await fakeGithub();
  gh.seed();
  const port = 47000 + Math.floor(Math.random() * 1000);
  const base = 'http://127.0.0.1:' + port;
  const run = (dataDir) => {
    const p = spawn(process.execPath, ['--no-warnings', path.join(__dirname, '..', 'bin', 'nexa.js'), '--no-open'], {
      env: { ...process.env, NEXA_CLOUD: '1', PORT: String(port), HOST: '127.0.0.1', NEXA_DATA: dataDir, NEXA_GITHUB_REPO: 'nick/nexa-data', NEXA_GITHUB_TOKEN: 'tok', NEXA_GITHUB_API: gh.api },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    p.stdout.on('data', (d) => { out += d; }); p.stderr.on('data', (d) => { out += d; });
    p.log = () => out;
    p.ready = new Promise((res, rej) => {
      const t = setInterval(() => { if (/running on port/.test(out)) { clearInterval(t); res(); } }, 50);
      p.on('exit', () => { clearInterval(t); rej(new Error('server exited: ' + out)); });
    });
    p.done = new Promise((res) => p.on('exit', (code) => res(code)));
    return p;
  };
  const a = fs.mkdtempSync(path.join(os.tmpdir(), 'nexa-gh-e2e-a-'));
  const b = fs.mkdtempSync(path.join(os.tmpdir(), 'nexa-gh-e2e-b-'));
  try {
    const s1 = run(a);
    await s1.ready;
    const r = await fetch(base + '/cloud/create?name=acme', {
      method: 'POST', headers: { origin: base, 'x-nexa-csrf': '1', 'content-type': 'application/json' },
      body: JSON.stringify({ workspace: 'ACME', name: 'Olive', email: 'olive@acme.example', password: 'correct horse battery', sampleContent: false }),
    });
    assert.equal(r.status, 200, await r.text());
    s1.kill('SIGTERM');
    assert.equal(await s1.done, 0, s1.log());
    assert.match(s1.log(), /Saving workspaces to GitHub/);

    const s2 = run(b);
    await s2.ready;
    assert.match(s2.log(), /restored 1 workspace\b/);
    const c = await (await fetch(base + '/cloud/check?name=acme')).json();
    assert.equal(c.exists, true);
    s2.kill('SIGTERM');
    await s2.done;
  } finally {
    gh.server.close();
    fs.rmSync(a, { recursive: true, force: true });
    fs.rmSync(b, { recursive: true, force: true });
  }
});
