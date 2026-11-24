'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, setupOwner } = require('./helpers');

test('Word, Excel and PowerPoint files go in and come out', async (t) => {
  const srv = await startServer();
  t.after(() => srv.stop());
  const owner = await setupOwner(srv, { sampleContent: false });
  const imp = (name, buf) => owner.post('/api/import', buf, { 'x-filename': encodeURIComponent(name), 'content-type': 'application/octet-stream' });

  await t.test('a Write doc exports to .docx and imports back with its text and formatting', async () => {
    const d = (await owner.post('/api/files', { kind: 'doc', title: 'Round trip' })).body.file;
    await owner.put('/api/files/' + d.id, { baseVersion: 1, content: { html: '<h1>Quarterly plan</h1><p>Grow <b>revenue</b> by 20%.</p><ul><li>Hire two</li><li>Launch Vault</li></ul>' } });
    const x = await owner.get(`/api/files/${d.id}/export?format=docx`);
    assert.equal(x.status, 200);
    assert.equal(x.buf.slice(0, 2).toString(), 'PK');
    const back = await imp('Round trip.docx', x.buf);
    assert.equal(back.status, 201);
    const html = (await owner.get('/api/files/' + back.body.file.id)).body.content.html;
    for (const s of ['Quarterly plan', 'revenue', 'Launch Vault']) assert.ok(html.includes(s), s);
    assert.match(html, /<(b|strong)>revenue/);
    assert.match(html, /<li>/);
  });

  await t.test('a Grid sheet exports to .xlsx with formulas and imports back', async () => {
    const s = (await owner.post('/api/files', { kind: 'sheet', title: 'Budget' })).body.file;
    const content = { sheets: [{ name: 'Costs', cells: { A1: 'Item', B1: 'Cost', A2: 'Laptops', B2: '1200', A3: 'Desks', B3: '300', A4: 'Total', B4: '=SUM(B2:B3)' } }] };
    assert.equal((await owner.put('/api/files/' + s.id, { baseVersion: 1, content })).status, 200);
    const x = await owner.get(`/api/files/${s.id}/export?format=xlsx`);
    assert.equal(x.buf.slice(0, 2).toString(), 'PK');
    const back = await imp('Budget.xlsx', x.buf);
    const c = (await owner.get('/api/files/' + back.body.file.id)).body.content;
    const sh = c.sheets[0];
    assert.equal(sh.name, 'Costs');
    assert.equal(String(sh.cells.B2), '1200');
    assert.equal(sh.cells.B4, '=SUM(B2:B3)');
  });

  await t.test('a CSV file imports as a Grid sheet', async () => {
    const r = await imp('people.csv', Buffer.from('name,age\n"Lee, Ann",34\nBo,29\n'));
    assert.equal(r.status, 201);
    const cells = (await owner.get('/api/files/' + r.body.file.id)).body.content.sheets[0].cells;
    assert.equal(cells.A2, 'Lee, Ann');
    assert.equal(String(cells.B3), '29');
  });

  await t.test('a Deck exports to .pptx and imports back with slide text', async () => {
    const d = (await owner.post('/api/files', { kind: 'deck', title: 'Pitch' })).body.file;
    const cur = (await owner.get('/api/files/' + d.id)).body.content;
    cur.slides = [{ id: 's1', elements: [{ id: 'e1', type: 'text', x: 60, y: 60, w: 800, h: 120, text: 'Astute Nexa pitch', style: { size: 40 } }] },
      { id: 's2', elements: [{ id: 'e2', type: 'text', x: 60, y: 60, w: 800, h: 120, text: 'Why now', style: { size: 32 } }] }];
    assert.equal((await owner.put('/api/files/' + d.id, { baseVersion: 1, content: cur })).status, 200);
    const x = await owner.get(`/api/files/${d.id}/export?format=pptx`);
    assert.equal(x.buf.slice(0, 2).toString(), 'PK');
    const back = await imp('Pitch.pptx', x.buf);
    const deck = (await owner.get('/api/files/' + back.body.file.id)).body.content;
    assert.equal(deck.slides.length, 2);
    const text = JSON.stringify(deck.slides);
    assert.ok(text.includes('Astute Nexa pitch') && text.includes('Why now'));
  });

  await t.test('files that are not Office files are refused by import', async () => {
    const r = await imp('virus.exe', Buffer.from('MZ....'));
    assert.ok(r.status >= 400 && r.status < 500);
  });
});
