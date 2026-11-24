'use strict';
// Starter content for a new workspace, so the first screen is never empty.
const A = require('./auth');

function channels(store, ownerId) {
  const now = Date.now();
  for (const [name, topic] of [['general', 'Company-wide news and questions'], ['random', 'Everything else']]) {
    const cid = A.id('c');
    store.run("INSERT INTO channels (id, name, topic, kind, created_by, created_at) VALUES (?,?,?,'public',?,?)", cid, name, topic, ownerId, now);
    store.run('INSERT INTO channel_members (channel_id, user_id, joined_at) VALUES (?,?,?)', cid, ownerId, now);
    if (name === 'general') {
      store.run('INSERT INTO messages (id, channel_id, user_id, body, created_at) VALUES (?,?,?,?,?)', A.id('m'), cid, null,
        'Welcome to Huddle. Post updates here, start a call with the camera button, and drop files from Vault into any conversation.', now);
    }
  }
}

function files(store, ownerId) {
  const now = Date.now();
  const add = (kind, title, content) => store.run(
    'INSERT INTO files (id, kind, title, owner_id, content, size, created_at, updated_at, updated_by) VALUES (?,?,?,?,?,?,?,?,?)',
    A.id('f'), kind, title, ownerId, JSON.stringify(content), JSON.stringify(content).length, now, now, ownerId);

  add('doc', 'Welcome to Astute Nexa', { html: [
    '<h1>Welcome to Astute Nexa</h1>',
    '<p>Everything your team needs to write, plan, present and talk, in one place with one sign-in.</p>',
    '<h2>Your apps</h2>',
    '<ul><li><strong>Write</strong> for documents</li><li><strong>Grid</strong> for spreadsheets and budgets</li>',
    '<li><strong>Deck</strong> for presentations</li><li><strong>Huddle</strong> for chat and video calls</li>',
    '<li><strong>Relay</strong> for mail and <strong>Cadence</strong> for your calendar</li><li><strong>Vault</strong> for every file</li></ul>',
    '<h2>Three things to try</h2>',
    '<ol><li>Invite a teammate from <em>People</em>.</li><li>Import a .docx, .xlsx or .pptx file you already have.</li><li>Start a video call in the #general channel.</li></ol>',
    '<blockquote>Tip: press <code>Ctrl</code> + <code>K</code> anywhere to search across files and messages.</blockquote>',
  ].join('') });

  const cells = {
    A1: 'Q1 budget', A3: 'Category', B3: 'January', C3: 'February', D3: 'March', E3: 'Total',
    A4: 'Software', B4: '1200', C4: '1200', D4: '1350',
    A5: 'Marketing', B5: '800', C5: '950', D5: '1100',
    A6: 'Payroll', B6: '18000', C6: '18000', D6: '18500',
    A7: 'Travel', B7: '400', C7: '650', D7: '300',
    A8: 'Total', B8: '=SUM(B4:B7)', C8: '=SUM(C4:C7)', D8: '=SUM(D4:D7)',
  };
  for (const r of [4, 5, 6, 7, 8]) cells['E' + r] = `=SUM(B${r}:D${r})`;
  cells.A10 = 'Largest line'; cells.B10 = '=INDEX(A4:A7,MATCH(MAX(E4:E7),E4:E7,0))';
  const styles = { A1: { b: 1, size: 16 }, A8: { b: 1 }, B8: { b: 1 }, C8: { b: 1 }, D8: { b: 1 }, E8: { b: 1 } };
  for (const c of 'ABCDE') styles[c + '3'] = { b: 1, bg: '#EDE9FF' };
  for (const c of 'BCDE') for (const r of [4, 5, 6, 7, 8]) styles[c + r] = { ...(styles[c + r] || {}), fmt: '$#,##0' };
  add('sheet', 'Q1 budget', { sheets: [{ name: 'Budget', cells, styles, colWidths: { A: 140 } }] });

  add('deck', 'Kickoff', { theme: 'aurora', slides: [
    { id: 's1', elements: [
      { id: 'e1', type: 'shape', x: 80, y: 170, w: 90, h: 8, style: { shape: 'rect', fill: '#22D3EE' } },
      { id: 'e2', type: 'text', x: 80, y: 190, w: 800, h: 90, text: 'Project kickoff', style: { size: 64, bold: true } },
      { id: 'e3', type: 'text', x: 80, y: 290, w: 800, h: 50, text: 'Goals, timeline and owners', style: { size: 28, color: '#9AA3C7' } },
    ], notes: 'Welcome everyone and set the goal for the meeting.' },
    { id: 's2', elements: [
      { id: 'e1', type: 'text', x: 80, y: 60, w: 800, h: 70, text: 'What we will ship', style: { size: 44, bold: true } },
      { id: 'e2', type: 'text', x: 80, y: 160, w: 800, h: 300, text: 'A faster onboarding flow\nOne place for every team file\nWeekly reviews in Huddle', style: { size: 30, bullets: true } },
    ], notes: '' },
  ] });
}

module.exports = { channels, files };
