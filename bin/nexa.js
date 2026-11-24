#!/usr/bin/env node
'use strict';
// `npx github:<owner>/astute-nexa` runs this: starts Nexa and opens it in the browser.
const [major, minor] = process.versions.node.split('.').map(Number);
if (major < 22 || (major === 22 && minor < 5)) {
  console.error('Astute Nexa needs Node.js 22.5 or newer. Get it free at https://nodejs.org');
  process.exit(1);
}
process.removeAllListeners('warning');
process.on('warning', (w) => { if (w.name !== 'ExperimentalWarning') console.warn(w); });
require('../server/index.js').start({ open: !process.argv.includes('--no-open') });
