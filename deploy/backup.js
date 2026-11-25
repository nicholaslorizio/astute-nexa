'use strict';
// Nightly copy of every workspace database, kept for 7 days, in <NEXA_DATA>/backups/<date>/.
// Safe while Nexa runs: SQLite's VACUUM INTO writes a consistent copy.
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const data = process.env.NEXA_DATA || '/var/lib/astute-nexa';
const ws = path.join(data, 'workspaces');
const day = new Date().toISOString().slice(0, 10);
const out = path.join(data, 'backups', day);
fs.mkdirSync(out, { recursive: true });
for (const name of fs.existsSync(ws) ? fs.readdirSync(ws) : []) {
  const db = path.join(ws, name, 'nexa.db');
  if (!fs.existsSync(db)) continue;
  const dest = path.join(out, name + '.db');
  fs.rmSync(dest, { force: true });
  const d = new DatabaseSync(db, { readOnly: true });
  d.exec(`VACUUM INTO '${dest.replace(/'/g, "''")}'`);
  d.close();
}
const keep = 7;
const days = fs.readdirSync(path.join(data, 'backups')).sort();
for (const old of days.slice(0, Math.max(0, days.length - keep))) fs.rmSync(path.join(data, 'backups', old), { recursive: true, force: true });
console.log('Backed up workspaces to', out);
