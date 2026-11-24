/* Grid: spreadsheets on the shared Nexa formula engine. */
'use strict';
(function () {
  const { h, $, $$, clear, icon, toast, fail, modal, menu, promptBox, confirmBox } = Nexa;
  const F = window.NexaFormula;
  const ROWS = 200, COLS = 40, DEFAULT_W = 100;
  const NUM_FORMATS = [['', 'Automatic'], ['0', 'Number, no decimals'], ['0.00', 'Number, 2 decimals'], ['#,##0', 'Thousands'], ['$#,##0', 'Currency'], ['$#,##0.00', 'Currency with cents'], ['0%', 'Percent'], ['0.0%', 'Percent, 1 decimal'], ['yyyy-mm-dd', 'Date (2026-01-31)'], ['m/d/yyyy', 'Date (1/31/2026)']];

  Nexa.Router.add('/grid/:id', ({ id }) => Nexa.openEditor({
    id, appId: 'grid',
    exportFormats: [{ label: 'Excel workbook (.xlsx)', fmt: 'xlsx' }, { label: 'CSV (this sheet)', fmt: 'csv' }],
    build({ body, content, canEdit, changed }) {
      const data = content && content.sheets ? content : { sheets: [{ name: 'Sheet1', cells: {} }] };
      for (const s of data.sheets) { s.cells = s.cells || {}; s.styles = s.styles || {}; s.colWidths = s.colWidths || {}; }
      let wb = new F.Workbook(data);
      let si = 0;
      let cur = { c: 1, r: 1 }, anchor = { c: 1, r: 1 };
      const undo = [], redo = [];
      const sheet = () => data.sheets[si];
      const A = (c, r) => F.numToCol(c) + r;

      const addr = h('input', { class: 'addr', value: 'A1', 'aria-label': 'Cell address' });
      const fx = h('input', { 'aria-label': 'Formula bar', placeholder: canEdit ? 'Type a value or =formula' : '', readOnly: !canEdit });
      const fbar = h('div', { class: 'fbar' }, addr, h('span', { class: 'fx' }, 'fx'), fx);
      const table = h('table', { class: 'sheet' });
      const wrap = h('div', { class: 'grid-wrap', tabIndex: 0 }, table);
      const tabs = h('div', { class: 'tabs' });
      const status = h('div', { class: 'statusbar' });
      const fmtSel = h('select', { title: 'Number format' }, NUM_FORMATS.map(([v, l]) => h('option', { value: v }, l)));
      const tbtn = (ic, title, fn) => h('button', { class: 'btn', type: 'button', title, 'aria-label': title, onclick: fn }, icon(ic, 16));
      const fill = h('input', { type: 'color', value: '#EDE9FF', title: 'Fill color' });
      const ink = h('input', { type: 'color', value: '#141A33', title: 'Text color' });
      const toolbar = canEdit ? h('div', { class: 'toolbar' },
        tbtn('undo', 'Undo (Ctrl+Z)', () => doUndo()), tbtn('redo', 'Redo (Ctrl+Y)', () => doRedo()), h('span', { class: 'sep' }),
        tbtn('bold', 'Bold', () => toggleStyle('b')), tbtn('italic', 'Italic', () => toggleStyle('i')), tbtn('underline', 'Underline', () => toggleStyle('u')),
        ink, fill, h('span', { class: 'sep' }),
        tbtn('alignL', 'Align left', () => setStyle({ align: 'left' })), tbtn('alignC', 'Center', () => setStyle({ align: 'center' })), tbtn('alignR', 'Align right', () => setStyle({ align: 'right' })),
        h('span', { class: 'sep' }), fmtSel, h('span', { class: 'sep' }),
        tbtn('sum', 'AutoSum', autoSum), tbtn('sort', 'Sort by this column', (e) => sortMenu(e.currentTarget)), tbtn('freeze', 'Freeze top row', freeze), tbtn('chart', 'Chart from selection', chart),
        h('button', { class: 'btn', type: 'button', title: 'Clear formatting', onclick: () => setStyle(null) }, 'Clear')) : null;
      fill.addEventListener('input', () => setStyle({ bg: fill.value }));
      ink.addEventListener('input', () => setStyle({ color: ink.value }));
      fmtSel.addEventListener('change', () => setStyle({ fmt: fmtSel.value || undefined }));
      body.append(toolbar || h('div', {}), fbar, wrap, tabs, status);

      // ---------- rendering ----------
      function colW(c) { return sheet().colWidths[F.numToCol(c)] || DEFAULT_W; }
      function build() {
        clear(table);
        const cg = h('colgroup', {}, h('col', { style: { width: '52px' } }));
        for (let c = 1; c <= COLS; c++) cg.append(h('col', { style: { width: colW(c) + 'px' } }));
        const head = h('tr', {}, h('th', { class: 'rh corner' }));
        for (let c = 1; c <= COLS; c++) {
          const th = h('th', { 'data-c': c }, F.numToCol(c));
          const grip = h('span', { style: { position: 'absolute', right: 0, top: 0, bottom: 0, width: '6px', cursor: 'col-resize' } });
          th.style.position = 'sticky';
          grip.addEventListener('mousedown', (e) => resizeCol(e, c));
          th.append(grip);
          th.addEventListener('click', (e) => { if (e.target === grip) return; anchor = { c, r: 1 }; cur = { c, r: ROWS }; paintSel(); });
          head.append(th);
        }
        const tb = h('tbody');
        const frozen = sheet().frozen && sheet().frozen.rows;
        for (let r = 1; r <= ROWS; r++) {
          const tr = h('tr', { class: frozen && r <= frozen ? 'frozen' : '' }, h('th', { class: 'rh', 'data-r': r }, r));
          for (let c = 1; c <= COLS; c++) tr.append(h('td', { 'data-a': A(c, r) }));
          tb.append(tr);
        }
        table.append(cg, h('thead', {}, head), tb);
        paintAll(); paintSel(); drawTabs();
      }
      function cellEl(a) { return table.querySelector(`td[data-a="${a}"]`); }
      function paintCell(a) {
        const td = cellEl(a); if (!td) return;
        const st = sheet().styles[a] || {};
        const raw = sheet().cells[a];
        let v = raw === undefined || raw === '' ? null : wb.getValue(si, a);
        let text = v === null ? '' : st.fmt ? F.formatValue(v, st.fmt) : wb.getDisplay(si, a);
        td.textContent = text;
        td.className = '';
        if (F.isErr(v)) td.classList.add('err');
        else if (typeof v === 'number') td.classList.add('num');
        td.style.fontWeight = st.b ? '700' : ''; td.style.fontStyle = st.i ? 'italic' : ''; td.style.textDecoration = st.u ? 'underline' : '';
        td.style.color = st.color || ''; td.style.background = st.bg || ''; td.style.textAlign = st.align || '';
        td.style.fontSize = st.size ? st.size + 'px' : '';
        td.title = F.isErr(v) ? errHelp(v) : '';
      }
      function paintAll() { wb.recalc(); $$('td', table).forEach((td) => { if (td.textContent || sheet().cells[td.dataset.a] !== undefined || sheet().styles[td.dataset.a]) paintCell(td.dataset.a); }); for (const a of Object.keys(sheet().cells)) paintCell(a); for (const a of Object.keys(sheet().styles)) paintCell(a); }
      const errHelp = (v) => ({ '#DIV/0!': 'Divided by zero', '#REF!': 'Points at a cell that does not exist', '#NAME?': 'Unknown function name', '#VALUE!': 'Wrong kind of value', '#CIRC!': 'This formula refers back to itself', '#N/A': 'No match found', '#NUM!': 'Number out of range' })[String(v)] || '';
      function range() { return { c1: Math.min(anchor.c, cur.c), c2: Math.max(anchor.c, cur.c), r1: Math.min(anchor.r, cur.r), r2: Math.max(anchor.r, cur.r) }; }
      function eachSel(fn) { const g = range(); for (let r = g.r1; r <= g.r2; r++) for (let c = g.c1; c <= g.c2; c++) fn(A(c, r), c, r); }
      function paintSel() {
        $$('td.sel,td.cur', table).forEach((td) => td.classList.remove('sel', 'cur'));
        $$('th.hi', table).forEach((t) => t.classList.remove('hi'));
        const g = range();
        if ((g.r2 - g.r1 + 1) * (g.c2 - g.c1 + 1) <= 5000) eachSel((a) => { const td = cellEl(a); if (td) td.classList.add('sel'); });
        const a = A(cur.c, cur.r);
        const td = cellEl(a); if (td) { td.classList.add('cur'); td.scrollIntoView({ block: 'nearest', inline: 'nearest' }); }
        for (let c = g.c1; c <= g.c2; c++) { const t = table.querySelector(`th[data-c="${c}"]`); if (t) t.classList.add('hi'); }
        for (let r = g.r1; r <= Math.min(g.r2, ROWS); r++) { const t = table.querySelector(`th[data-r="${r}"]`); if (t) t.classList.add('hi'); }
        addr.value = g.c1 === g.c2 && g.r1 === g.r2 ? a : `${A(g.c1, g.r1)}:${A(g.c2, g.r2)}`;
        const raw = sheet().cells[a];
        if (document.activeElement !== fx) fx.value = raw === undefined ? '' : raw;
        const st = sheet().styles[a] || {};
        fmtSel.value = st.fmt || '';
        // status bar stats
        let n = 0, sum = 0, count = 0;
        eachSel((x) => { if (sheet().cells[x] === undefined) return; count++; const v = wb.getValue(si, x); if (typeof v === 'number') { n++; sum += v; } });
        clear(status);
        if (count > 1) status.append(h('span', {}, `Count ${count}`));
        if (n > 1) status.append(h('span', {}, `Sum ${+sum.toFixed(10)}`), h('span', {}, `Average ${+(sum / n).toFixed(6)}`));
      }
      function drawTabs() {
        clear(tabs);
        data.sheets.forEach((s, i) => {
          const t = h('div', { class: 'tab' + (i === si ? ' on' : ''), onclick: () => { si = i; build(); } }, s.name);
          if (canEdit) t.addEventListener('contextmenu', (e) => { e.preventDefault(); menu(e, [
            { label: 'Rename', icon: 'edit', onClick: async () => { const n = await promptBox('Rename sheet', 'Sheet name', s.name); if (n && n.trim()) { renameSheet(i, n.trim()); } } },
            data.sheets.length > 1 && { label: 'Delete sheet', icon: 'trash', danger: true, onClick: async () => { if (await confirmBox('Delete this sheet?', `“${s.name}” and everything on it will be removed.`, 'Delete', true)) { snapshot(); data.sheets.splice(i, 1); si = 0; rebuildWb(); build(); changed(); } } },
          ]); });
          tabs.append(t);
        });
        if (canEdit) tabs.append(h('button', { class: 'btn ghost icon sm', title: 'Add sheet', onclick: () => { snapshot(); let n = data.sheets.length + 1; while (data.sheets.some((s) => s.name === 'Sheet' + n)) n++; data.sheets.push({ name: 'Sheet' + n, cells: {}, styles: {}, colWidths: {} }); si = data.sheets.length - 1; rebuildWb(); build(); changed(); } }, icon('plus', 14)));
        tabs.append(h('span', { class: 'grow' }), h('span', { class: 'muted small', style: { padding: '0 8px' } }, `${F.FUNCTION_NAMES.length} functions · right-click a tab to rename`));
      }
      function renameSheet(i, name) {
        snapshot();
        const old = data.sheets[i].name;
        const q = (n) => (/^[A-Za-z_][\w]*$/.test(n) ? n : `'${n.replace(/'/g, "''")}'`);
        for (const s of data.sheets) for (const [k, v] of Object.entries(s.cells)) if (typeof v === 'string' && v.startsWith('=')) s.cells[k] = v.split(q(old) + '!').join(q(name) + '!');
        data.sheets[i].name = name; rebuildWb(); build(); changed();
      }
      function rebuildWb() { wb = new F.Workbook(data); }

      // ---------- editing ----------
      function snapshot() { undo.push(JSON.stringify(data.sheets)); if (undo.length > 100) undo.shift(); redo.length = 0; }
      function doUndo() { if (!undo.length) return; redo.push(JSON.stringify(data.sheets)); data.sheets = JSON.parse(undo.pop()); si = Math.min(si, data.sheets.length - 1); rebuildWb(); build(); changed(); }
      function doRedo() { if (!redo.length) return; undo.push(JSON.stringify(data.sheets)); data.sheets = JSON.parse(redo.pop()); rebuildWb(); build(); changed(); }
      function setRaw(a, raw, noSnap) {
        if (!canEdit) return;
        if (!noSnap) snapshot();
        if (raw === '' || raw === undefined || raw === null) delete sheet().cells[a]; else sheet().cells[a] = String(raw);
        wb.setCell(si, a, raw === undefined ? '' : String(raw));
        changed();
      }
      function commitMany(fn) { snapshot(); fn(); rebuildWb(); paintAll(); paintSel(); changed(); }
      function setStyle(patch) {
        if (!canEdit) return;
        commitMany(() => eachSel((a) => {
          if (patch === null) { delete sheet().styles[a]; return; }
          const st = { ...(sheet().styles[a] || {}), ...patch };
          for (const k of Object.keys(st)) if (st[k] === undefined) delete st[k];
          if (Object.keys(st).length) sheet().styles[a] = st; else delete sheet().styles[a];
        }));
      }
      function toggleStyle(k) { const on = !(sheet().styles[A(cur.c, cur.r)] || {})[k]; setStyle({ [k]: on ? 1 : undefined }); }
      function autoSum() {
        // sum the numbers above (or to the left of) the current cell
        let r = cur.r - 1; while (r >= 1 && typeof wb.getValue(si, A(cur.c, r)) === 'number') r--;
        if (r < cur.r - 1) { setRaw(A(cur.c, cur.r), `=SUM(${A(cur.c, r + 1)}:${A(cur.c, cur.r - 1)})`); paintAll(); paintSel(); return; }
        let c = cur.c - 1; while (c >= 1 && typeof wb.getValue(si, A(c, cur.r)) === 'number') c--;
        if (c < cur.c - 1) { setRaw(A(cur.c, cur.r), `=SUM(${A(c + 1, cur.r)}:${A(cur.c - 1, cur.r)})`); paintAll(); paintSel(); return; }
        startEdit('=SUM(');
      }
      function sortMenu(anchorEl) {
        const g = range();
        menu(anchorEl, [{ label: `Sort rows by column ${F.numToCol(cur.c)}`, header: true },
          { label: 'A to Z, smallest first', onClick: () => sortBy(1) }, { label: 'Z to A, largest first', onClick: () => sortBy(-1) },
          { label: g.r1 === g.r2 ? 'Tip: select the rows to sort first' : `Rows ${g.r1} to ${g.r2}`, header: true }]);
        function sortBy(dir) {
          let { r1, r2 } = g;
          if (r1 === r2) { r1 = 1; r2 = 1; for (const a of Object.keys(sheet().cells)) r2 = Math.max(r2, +a.match(/\d+/)[0]); if (sheet().cells[A(cur.c, 1)] && typeof wb.getValue(si, A(cur.c, 1)) === 'string') r1 = 2; }
          commitMany(() => {
            const rows = [];
            for (let r = r1; r <= r2; r++) { const row = {}; const sty = {}; for (let c = 1; c <= COLS; c++) { const a = A(c, r); if (sheet().cells[a] !== undefined) row[c] = sheet().cells[a]; if (sheet().styles[a]) sty[c] = sheet().styles[a]; } rows.push({ row, sty, key: wb.getValue(si, A(cur.c, r)) }); }
            rows.sort((x, y) => { const a = x.key, b = y.key; if (a === null || a === undefined) return 1; if (b === null || b === undefined) return -1; return (typeof a === 'number' && typeof b === 'number' ? a - b : String(a).localeCompare(String(b), undefined, { numeric: true })) * dir; });
            rows.forEach((x, i) => { const r = r1 + i; for (let c = 1; c <= COLS; c++) { const a = A(c, r); if (x.row[c] !== undefined) sheet().cells[a] = x.row[c]; else delete sheet().cells[a]; if (x.sty[c]) sheet().styles[a] = x.sty[c]; else delete sheet().styles[a]; } });
          });
        }
      }
      function freeze() { snapshot(); const s = sheet(); s.frozen = s.frozen && s.frozen.rows ? undefined : { rows: 1, cols: 0 }; build(); changed(); toast(s.frozen ? 'Top row frozen' : 'Rows unfrozen'); }
      function chart() {
        const g = range();
        const labels = [], series = [];
        for (let r = g.r1; r <= g.r2; r++) {
          const lab = wb.getValue(si, A(g.c1, r)); const vals = [];
          for (let c = g.c1 + 1; c <= g.c2; c++) { const v = wb.getValue(si, A(c, r)); vals.push(typeof v === 'number' ? v : null); }
          if (vals.some((v) => v !== null)) { labels.push(lab === null ? '' : String(lab)); series.push(vals); }
        }
        if (!series.length) return toast('Select labels in the first column and numbers next to them.', 'bad');
        const kind = h('div', { class: 'seg' });
        const box = h('div', { class: 'chart-box' });
        let type = 'bar';
        const draw = () => { clear(box).append(renderChart(type, labels, series)); $$('button', kind).forEach((b) => b.classList.toggle('on', b.dataset.t === type)); };
        for (const [t, l] of [['bar', 'Bars'], ['line', 'Line'], ['pie', 'Pie']]) kind.append(h('button', { type: 'button', 'data-t': t, onclick: () => { type = t; draw(); } }, l));
        draw();
        modal({ title: 'Chart', wide: true, body: [kind, box, h('p', { class: 'muted small', style: { margin: 0 } }, 'Right-click the chart to copy or save it as an image.')], actions: [{ label: 'Close' }] });
      }
      function resizeCol(e, c) {
        e.preventDefault(); e.stopPropagation();
        const x0 = e.clientX, w0 = colW(c);
        const col = table.querySelectorAll('col')[c];
        const mv = (ev) => { col.style.width = Math.max(30, w0 + ev.clientX - x0) + 'px'; };
        const up = (ev) => { removeEventListener('mousemove', mv); removeEventListener('mouseup', up); if (canEdit) { sheet().colWidths[F.numToCol(c)] = Math.max(30, w0 + ev.clientX - x0); changed(); } };
        addEventListener('mousemove', mv); addEventListener('mouseup', up);
      }

      // in-cell editor
      let editor = null, hints = null;
      function startEdit(initial) {
        if (!canEdit) return;
        const td = cellEl(A(cur.c, cur.r)); if (!td) return;
        const wr = wrap.getBoundingClientRect(), r = td.getBoundingClientRect();
        editor = h('input', { class: 'cell-editor', value: initial !== undefined ? initial : (sheet().cells[A(cur.c, cur.r)] || '') });
        Object.assign(editor.style, { left: (r.left - wr.left + wrap.scrollLeft) + 'px', top: (r.top - wr.top + wrap.scrollTop) + 'px', width: Math.max(r.width, 160) + 'px', height: r.height + 'px' });
        wrap.append(editor); editor.focus();
        editor.setSelectionRange(editor.value.length, editor.value.length);
        editor.addEventListener('input', () => { fx.value = editor.value; showHints(editor); });
        editor.addEventListener('keydown', (e) => {
          if (hints && ['ArrowDown', 'ArrowUp', 'Tab'].includes(e.key) && hints.items.length) {
            e.preventDefault();
            if (e.key === 'Tab') return pickHint(editor);
            hints.sel = (hints.sel + (e.key === 'ArrowDown' ? 1 : -1) + hints.items.length) % hints.items.length; drawHints();
            return;
          }
          if (e.key === 'Enter') { e.preventDefault(); finishEdit(true); move(0, e.shiftKey ? -1 : 1); }
          else if (e.key === 'Tab') { e.preventDefault(); finishEdit(true); move(e.shiftKey ? -1 : 1, 0); }
          else if (e.key === 'Escape') { e.preventDefault(); finishEdit(false); }
        });
        editor.addEventListener('blur', () => setTimeout(() => { if (editor && document.activeElement !== editor) finishEdit(true); }, 120));
      }
      function finishEdit(commit) {
        if (!editor) return;
        const v = editor.value; const ed = editor; editor = null; hideHints(); ed.remove();
        if (commit && v !== (sheet().cells[A(cur.c, cur.r)] || '')) { setRaw(A(cur.c, cur.r), v); paintAll(); }
        paintSel(); wrap.focus();
      }
      function showHints(input) {
        const m = input.value.match(/^=.*?([A-Z]{2,})$/i);
        if (!m) return hideHints();
        const items = F.FUNCTION_NAMES.filter((n) => n.startsWith(m[1].toUpperCase())).slice(0, 8);
        if (!items.length) return hideHints();
        if (!hints) { hints = { el: h('div', { class: 'fn-hints' }), items: [], sel: 0, word: '' }; wrap.append(hints.el); }
        Object.assign(hints, { items, sel: 0, word: m[1], input });
        hints.el.style.left = input.style.left; hints.el.style.top = (parseFloat(input.style.top) + input.offsetHeight + 2) + 'px';
        drawHints();
      }
      function drawHints() { clear(hints.el); hints.items.forEach((n, i) => hints.el.append(h('div', { class: i === hints.sel ? 'sel' : '', onmousedown: (e) => { e.preventDefault(); hints.sel = i; pickHint(hints.input); } }, n))); }
      function pickHint(input) { const n = hints.items[hints.sel]; input.value = input.value.slice(0, input.value.length - hints.word.length) + n + '('; fx.value = input.value; hideHints(); input.focus(); }
      function hideHints() { if (hints) { hints.el.remove(); hints = null; } }

      function move(dc, dr, extend) {
        cur = { c: Math.max(1, Math.min(COLS, cur.c + dc)), r: Math.max(1, Math.min(ROWS, cur.r + dr)) };
        if (!extend) anchor = { ...cur };
        paintSel();
      }

      // mouse selection
      let dragging = false;
      table.addEventListener('mousedown', (e) => {
        const td = e.target.closest('td'); const rh = e.target.closest('th.rh');
        if (rh && rh.dataset.r) { anchor = { c: 1, r: +rh.dataset.r }; cur = { c: COLS, r: +rh.dataset.r }; paintSel(); return; }
        if (!td) return;
        if (editor) {
          if (editor.value.startsWith('=')) { e.preventDefault(); const a = td.dataset.a; editor.value += a; fx.value = editor.value; editor.focus(); return; }
          finishEdit(true);
        }
        const [, col, row] = td.dataset.a.match(/([A-Z]+)(\d+)/);
        const p = { c: F.colToNum(col), r: +row };
        if (e.shiftKey) cur = p; else { anchor = p; cur = p; }
        dragging = true; paintSel(); wrap.focus();
      });
      table.addEventListener('mouseover', (e) => { if (!dragging) return; const td = e.target.closest('td'); if (!td) return; const [, col, row] = td.dataset.a.match(/([A-Z]+)(\d+)/); cur = { c: F.colToNum(col), r: +row }; paintSel(); });
      addEventListener('mouseup', () => { dragging = false; });
      table.addEventListener('dblclick', (e) => { if (e.target.closest('td')) startEdit(); });
      wrap.addEventListener('contextmenu', (e) => {
        if (!canEdit || !e.target.closest('td')) return;
        e.preventDefault();
        menu(e, [
          { label: 'Cut', hint: 'Ctrl X', onClick: () => clip(true) }, { label: 'Copy', hint: 'Ctrl C', onClick: () => clip(false) },
          '-', { label: 'Insert row above', onClick: () => shiftRows(cur.r, 1) }, { label: 'Delete row', onClick: () => shiftRows(cur.r, -1) },
          { label: 'Insert column left', onClick: () => shiftCols(cur.c, 1) }, { label: 'Delete column', onClick: () => shiftCols(cur.c, -1) },
          '-', { label: 'Clear contents', onClick: () => commitMany(() => eachSel((a) => delete sheet().cells[a])) },
        ]);
      });

      // keyboard
      wrap.addEventListener('keydown', (e) => {
        if (editor) return;
        const mod = e.ctrlKey || e.metaKey;
        const k = e.key;
        if (k === 'ArrowUp') { e.preventDefault(); move(0, mod ? -ROWS : -1, e.shiftKey); }
        else if (k === 'ArrowDown') { e.preventDefault(); move(0, mod ? ROWS : 1, e.shiftKey); }
        else if (k === 'ArrowLeft') { e.preventDefault(); move(mod ? -COLS : -1, 0, e.shiftKey); }
        else if (k === 'ArrowRight') { e.preventDefault(); move(mod ? COLS : 1, 0, e.shiftKey); }
        else if (k === 'Tab') { e.preventDefault(); move(e.shiftKey ? -1 : 1, 0); }
        else if (k === 'Enter') { e.preventDefault(); if (e.shiftKey) move(0, -1); else startEdit(); }
        else if (k === 'F2') { e.preventDefault(); startEdit(); }
        else if (k === 'Delete' || k === 'Backspace') { e.preventDefault(); if (canEdit) commitMany(() => eachSel((a) => delete sheet().cells[a])); }
        else if (mod && k.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? doRedo() : doUndo(); }
        else if (mod && k.toLowerCase() === 'y') { e.preventDefault(); doRedo(); }
        else if (mod && k.toLowerCase() === 'b') { e.preventDefault(); toggleStyle('b'); }
        else if (mod && k.toLowerCase() === 'i') { e.preventDefault(); toggleStyle('i'); }
        else if (mod && k.toLowerCase() === 'a') { e.preventDefault(); anchor = { c: 1, r: 1 }; cur = { c: COLS, r: ROWS }; paintSel(); }
        else if (!mod && !e.altKey && k.length === 1 && canEdit) { e.preventDefault(); startEdit(k); }
      });
      // clipboard (tab-separated, works with other spreadsheet apps)
      let clipSrc = null;
      function clip(cut) {
        const g = range(); const lines = [];
        for (let r = g.r1; r <= g.r2; r++) { const row = []; for (let c = g.c1; c <= g.c2; c++) { const v = wb.getValue(si, A(c, r)); row.push(v === null ? '' : String(v)); } lines.push(row.join('\t')); }
        clipSrc = { g, cut, text: lines.join('\n'), cells: JSON.parse(JSON.stringify(sheet().cells)), styles: JSON.parse(JSON.stringify(sheet().styles)) };
        navigator.clipboard && navigator.clipboard.writeText(clipSrc.text).catch(() => {});
        toast(cut ? 'Cut' : 'Copied');
      }
      wrap.addEventListener('copy', (e) => { if (editor) return; e.preventDefault(); clip(false); e.clipboardData.setData('text/plain', clipSrc.text); });
      wrap.addEventListener('cut', (e) => { if (editor || !canEdit) return; e.preventDefault(); clip(true); e.clipboardData.setData('text/plain', clipSrc.text); });
      wrap.addEventListener('paste', (e) => {
        if (editor || !canEdit) return;
        e.preventDefault();
        const text = e.clipboardData.getData('text/plain');
        commitMany(() => {
          if (clipSrc && clipSrc.text === text) {
            // internal paste keeps formulas (shifted) and styles
            const { g } = clipSrc;
            for (let r = g.r1; r <= g.r2; r++) for (let c = g.c1; c <= g.c2; c++) {
              const from = A(c, r), to = A(cur.c + c - g.c1, cur.r + r - g.r1);
              const raw = clipSrc.cells[from];
              if (raw === undefined) delete sheet().cells[to]; else sheet().cells[to] = raw.startsWith('=') ? F.shiftFormula(raw, cur.c - g.c1, cur.r - g.r1) : raw;
              if (clipSrc.styles[from]) sheet().styles[to] = { ...clipSrc.styles[from] };
            }
            if (clipSrc.cut) { for (let r = g.r1; r <= g.r2; r++) for (let c = g.c1; c <= g.c2; c++) { const a = A(c, r); const inside = c >= cur.c && c < cur.c + g.c2 - g.c1 + 1 && r >= cur.r && r < cur.r + g.r2 - g.r1 + 1; if (!inside) { delete sheet().cells[a]; delete sheet().styles[a]; } } clipSrc = null; }
          } else {
            text.replace(/\r/g, '').replace(/\n$/, '').split('\n').forEach((line, dr) => line.split('\t').forEach((v, dc) => {
              const a = A(cur.c + dc, cur.r + dr); if (cur.c + dc > COLS || cur.r + dr > ROWS) return;
              if (v === '') delete sheet().cells[a]; else sheet().cells[a] = v;
            }));
          }
        });
      });
      function shiftRows(at, n) {
        commitMany(() => {
          const s = sheet(); const nc = {}, ns = {};
          const map = (a) => { const [, col, row] = a.match(/([A-Z]+)(\d+)/); const r = +row; if (n < 0 && r === at) return null; return col + (r >= at ? r + n : r); };
          for (const [a, v] of Object.entries(s.cells)) { const t = map(a); if (t) nc[t] = typeof v === 'string' && v.startsWith('=') ? F.shiftFormula(v, 0, 0, { rowAt: at, rowN: n }) : v; }
          for (const [a, v] of Object.entries(s.styles)) { const t = map(a); if (t) ns[t] = v; }
          s.cells = nc; s.styles = ns;
        });
      }
      function shiftCols(at, n) {
        commitMany(() => {
          const s = sheet(); const nc = {}, ns = {}, nw = {};
          const map = (a) => { const [, col, row] = a.match(/([A-Z]+)(\d+)/); const c = F.colToNum(col); if (n < 0 && c === at) return null; return F.numToCol(c >= at ? c + n : c) + row; };
          for (const [a, v] of Object.entries(s.cells)) { const t = map(a); if (t) nc[t] = typeof v === 'string' && v.startsWith('=') ? F.shiftFormula(v, 0, 0, { colAt: at, colN: n }) : v; }
          for (const [a, v] of Object.entries(s.styles)) { const t = map(a); if (t) ns[t] = v; }
          for (const [col, w] of Object.entries(s.colWidths)) { const c = F.colToNum(col); if (n < 0 && c === at) continue; nw[F.numToCol(c >= at ? c + n : c)] = w; }
          s.cells = nc; s.styles = ns; s.colWidths = nw;
        });
        build();
      }

      // formula bar
      fx.addEventListener('input', () => showHints(fx));
      fx.addEventListener('keydown', (e) => {
        if (hints && e.key === 'Tab') { e.preventDefault(); return pickHint(fx); }
        if (e.key === 'Enter') { e.preventDefault(); hideHints(); setRaw(A(cur.c, cur.r), fx.value); paintAll(); move(0, 1); wrap.focus(); }
        if (e.key === 'Escape') { hideHints(); fx.value = sheet().cells[A(cur.c, cur.r)] || ''; wrap.focus(); }
      });
      addr.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter') return;
        e.preventDefault();
        const [a, b] = addr.value.toUpperCase().split(':');
        try { const p = F.parseAddr(a); anchor = { c: p.col, r: p.row }; cur = b ? (() => { const q = F.parseAddr(b); return { c: q.col, r: q.row }; })() : { ...anchor }; paintSel(); wrap.focus(); } catch { toast('Type a cell like B12', 'bad'); }
      });

      build();
      setTimeout(() => wrap.focus(), 50);
      return { getContent: () => ({ sheets: data.sheets }), destroy: () => hideHints() };
    },
  }));

  // ---------- simple SVG charts ----------
  const PALETTE = ['#6D4BFF', '#22C7E8', '#FF6B4A', '#10B981', '#F59E0B', '#EC4899', '#3B82F6', '#14B8D4'];
  function renderChart(type, labels, series) {
    const W = 760, H = 380, P = { l: 56, r: 20, t: 20, b: 60 };
    const s = Nexa.svg('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': 'Chart' });
    const text = (x, y, t, a = {}) => { const el = Nexa.svg('text', { x, y, 'font-size': 12, fill: 'currentColor', ...a }); el.textContent = t; return el; };
    if (type === 'pie') {
      const vals = series.map((r) => Math.max(0, r[0] || 0)); const tot = vals.reduce((a, b) => a + b, 0) || 1;
      let ang = -Math.PI / 2; const cx = 210, cy = H / 2, R = 150;
      vals.forEach((v, i) => {
        const a2 = ang + (v / tot) * Math.PI * 2;
        const large = a2 - ang > Math.PI ? 1 : 0;
        const d = vals.length === 1 ? `M${cx - R},${cy}a${R},${R} 0 1,0 ${R * 2},0a${R},${R} 0 1,0 -${R * 2},0` : `M${cx},${cy}L${cx + R * Math.cos(ang)},${cy + R * Math.sin(ang)}A${R},${R} 0 ${large} 1 ${cx + R * Math.cos(a2)},${cy + R * Math.sin(a2)}Z`;
        s.append(Nexa.svg('path', { d, fill: PALETTE[i % PALETTE.length], stroke: 'var(--bg-2)', 'stroke-width': 2 }));
        s.append(Nexa.svg('rect', { x: 420, y: 40 + i * 24, width: 14, height: 14, rx: 3, fill: PALETTE[i % PALETTE.length] }), text(442, 52 + i * 24, `${labels[i]} · ${Math.round((v / tot) * 100)}%`));
        ang = a2;
      });
      return s;
    }
    const all = series.flat().filter((v) => v !== null);
    const max = Math.max(0, ...all), min = Math.min(0, ...all);
    const span = max - min || 1;
    const y = (v) => P.t + (H - P.t - P.b) * (1 - (v - min) / span);
    const cw = (W - P.l - P.r) / labels.length;
    for (let i = 0; i <= 4; i++) { const v = min + (span * i) / 4; s.append(Nexa.svg('line', { x1: P.l, x2: W - P.r, y1: y(v), y2: y(v), stroke: 'currentColor', 'stroke-opacity': 0.12 }), text(P.l - 8, y(v) + 4, +v.toPrecision(3), { 'text-anchor': 'end', 'fill-opacity': 0.6 })); }
    const nS = series[0].length;
    if (type === 'bar') {
      const bw = (cw * 0.7) / nS;
      series.forEach((row, i) => row.forEach((v, j) => { if (v === null) return; const x = P.l + i * cw + cw * 0.15 + j * bw; s.append(Nexa.svg('rect', { x, y: Math.min(y(v), y(0)), width: Math.max(1, bw - 2), height: Math.abs(y(v) - y(0)), rx: 3, fill: PALETTE[j % PALETTE.length] })); }));
    } else {
      for (let j = 0; j < nS; j++) {
        const pts = series.map((row, i) => (row[j] === null ? null : `${P.l + i * cw + cw / 2},${y(row[j])}`)).filter(Boolean);
        s.append(Nexa.svg('polyline', { points: pts.join(' '), fill: 'none', stroke: PALETTE[j % PALETTE.length], 'stroke-width': 3, 'stroke-linejoin': 'round' }));
        pts.forEach((p) => { const [cx, cy] = p.split(','); s.append(Nexa.svg('circle', { cx, cy, r: 4, fill: PALETTE[j % PALETTE.length] })); });
      }
    }
    labels.forEach((l, i) => s.append(text(P.l + i * cw + cw / 2, H - P.b + 20, l.slice(0, 14), { 'text-anchor': 'middle', 'fill-opacity': 0.75 })));
    return s;
  }
})();
