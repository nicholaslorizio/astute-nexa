/* Deck: presentations with themes, drag and resize, speaker notes and present mode. */
'use strict';
(function () {
  const { h, $, $$, clear, icon, toast, menu, readAsDataURL, pickFile, uid } = Nexa;
  const THEMES = window.NexaThemes.THEMES;
  const W = 960, H = 540;

  function renderSlide(slide, theme, { edit, sel, onSelect } = {}) {
    const t = THEMES[theme] || THEMES.aurora;
    const el = h('div', { class: 'slide' + (edit ? ' edit-mode' : ''), style: { background: slide.bg || t.bg, color: t.text, fontFamily: t.font } });
    for (const e of slide.elements) {
      const st = e.style || {};
      const node = h('div', { class: 'el ' + e.type + (e.type === 'shape' ? ' ' + (st.shape || 'rect') : '') + (st.bullets ? ' bullets' : '') + (sel === e.id ? ' selected' : ''), 'data-id': e.id,
        style: { left: e.x + 'px', top: e.y + 'px', width: e.w + 'px', height: e.h + 'px', transform: e.r ? `rotate(${e.r}deg)` : '' } });
      if (e.type === 'text') {
        Object.assign(node.style, { fontSize: (st.size || 24) + 'px', fontWeight: st.bold ? '700' : '400', fontStyle: st.italic ? 'italic' : '', textDecoration: st.underline ? 'underline' : '', color: st.color || t.text, textAlign: st.align || 'left', background: st.fill || '', fontFamily: st.font === 'mono' ? 'var(--mono)' : '' });
        if (st.bullets) (e.text || '').split('\n').forEach((line) => node.append(h('div', { class: 'li' }, line || '​')));
        else node.textContent = e.text || '';
      } else if (e.type === 'shape') {
        Object.assign(node.style, { background: st.fill || t.accent, border: st.stroke ? `2px solid ${st.stroke}` : '', display: 'grid', placeItems: 'center', color: st.color || '#fff', fontSize: (st.size || 24) + 'px', fontWeight: st.bold ? '700' : '', textAlign: 'center' });
        if (e.text) node.textContent = e.text;
      } else if (e.type === 'image') node.append(h('img', { src: e.src || '', alt: '' }));
      if (edit && sel === e.id) node.append(h('span', { class: 'handle', 'data-handle': '1' }));
      if (onSelect) node.addEventListener('mousedown', (ev) => onSelect(ev, e, node));
      el.append(node);
    }
    return el;
  }
  Nexa.renderSlide = renderSlide;

  Nexa.Router.add('/deck/:id', ({ id, query }) => Nexa.openEditor({
    id, appId: 'deck',
    exportFormats: [{ label: 'PowerPoint (.pptx)', fmt: 'pptx' }],
    build({ body, content, canEdit, changed }) {
      const deck = content && content.slides ? content : { theme: 'aurora', slides: [{ id: 's1', elements: [] }] };
      let idx = 0, sel = null;
      const undo = [], redo = [];
      const snap = () => { undo.push(JSON.stringify(deck)); if (undo.length > 80) undo.shift(); redo.length = 0; };
      const restore = (s) => { const d = JSON.parse(s); deck.theme = d.theme; deck.slides = d.slides; idx = Math.min(idx, deck.slides.length - 1); sel = null; draw(); changed(); };
      const slide = () => deck.slides[idx];
      const elById = (eid) => slide().elements.find((e) => e.id === eid);

      const thumbs = h('div', { class: 'thumbs' });
      const stageArea = h('div', { class: 'stage-area' });
      const notes = h('textarea', { class: 'notes', placeholder: 'Speaker notes', readOnly: !canEdit });
      const inspector = h('aside', { class: 'inspector' });
      const tb = (ic, label, fn) => h('button', { class: 'btn', type: 'button', title: label, onclick: fn }, icon(ic, 16), h('span', {}, label));
      const toolbar = h('div', { class: 'toolbar' },
        canEdit ? [tb('plus', 'Slide', () => addSlide()), h('span', { class: 'sep' }), tb('text', 'Text', () => addEl('text')), tb('list', 'Bullets', () => addEl('bullets')), tb('shape', 'Shape', (e) => shapeMenu(e.currentTarget)), tb('image', 'Image', addImage), h('span', { class: 'sep' }),
          h('button', { class: 'btn', title: 'Undo', onclick: () => { if (undo.length) { redo.push(JSON.stringify(deck)); restore(undo.pop()); } } }, icon('undo', 16)),
          h('button', { class: 'btn', title: 'Redo', onclick: () => { if (redo.length) { undo.push(JSON.stringify(deck)); restore(redo.pop()); } } }, icon('redo', 16))] : null,
        h('span', { class: 'grow' }),
        h('button', { class: 'btn primary sm', onclick: () => present(idx) }, icon('play', 14), 'Present'));
      body.append(toolbar, h('div', { class: 'deck-body' }, thumbs, h('div', { class: 'stage-wrap' }, stageArea, notes), inspector));

      function fit(node) { const r = stageArea.getBoundingClientRect(); const s = Math.min((r.width - 48) / W, (r.height - 48) / H, 1.4); node.style.transform = `scale(${Math.max(0.2, s)})`; }
      let stageNode = null;
      const ro = new ResizeObserver(() => stageNode && fit(stageNode));
      ro.observe(stageArea);

      function drawThumbs() {
        clear(thumbs);
        deck.slides.forEach((s, i) => {
          const mini = renderSlide(s, deck.theme); mini.classList.add('mini');
          const t = h('div', { class: 'thumb' + (i === idx ? ' on' : ''), draggable: canEdit, onclick: () => { idx = i; sel = null; draw(); } }, h('span', { class: 'n' }, i + 1), mini);
          requestAnimationFrame(() => { mini.style.transform = `scale(${t.clientWidth / W})`; });
          if (canEdit) {
            t.addEventListener('contextmenu', (e) => { e.preventDefault(); menu(e, [
              { label: 'Duplicate slide', icon: 'copy', onClick: () => { snap(); const c = JSON.parse(JSON.stringify(s)); c.id = uid('s'); c.elements.forEach((x) => { x.id = uid('e'); }); deck.slides.splice(i + 1, 0, c); idx = i + 1; draw(); changed(); } },
              deck.slides.length > 1 && { label: 'Delete slide', icon: 'trash', danger: true, onClick: () => { snap(); deck.slides.splice(i, 1); idx = Math.max(0, Math.min(idx, deck.slides.length - 1)); draw(); changed(); } },
            ]); });
            t.addEventListener('dragstart', (e) => e.dataTransfer.setData('text/slide', String(i)));
            t.addEventListener('dragover', (e) => e.preventDefault());
            t.addEventListener('drop', (e) => { e.preventDefault(); const from = +e.dataTransfer.getData('text/slide'); if (Number.isNaN(from) || from === i) return; snap(); const [m] = deck.slides.splice(from, 1); deck.slides.splice(i, 0, m); idx = i; draw(); changed(); });
          }
          thumbs.append(t);
        });
      }
      function drawStage() {
        clear(stageArea);
        const scaler = h('div', { class: 'stage-scale' });
        stageNode = scaler;
        const node = renderSlide(slide(), deck.theme, { edit: canEdit, sel, onSelect: canEdit ? startDrag : null });
        node.addEventListener('mousedown', (e) => { if (e.target === node) { sel = null; drawStage(); drawInspector(); } });
        node.addEventListener('dblclick', (e) => { const n = e.target.closest('.el.text,.el.shape'); if (n && canEdit) editText(n); });
        scaler.append(node); stageArea.append(scaler); fit(scaler);
        notes.value = slide().notes || '';
      }
      function draw() { drawThumbs(); drawStage(); drawInspector(); }

      function drawInspector() {
        clear(inspector);
        inspector.append(h('h4', {}, 'Theme'), h('div', { class: 'theme-swatches' }, Object.entries(THEMES).map(([k, t]) => h('button', { type: 'button', class: deck.theme === k ? 'on' : '', title: t.name, disabled: !canEdit, style: { background: t.bg, color: t.text, borderColor: deck.theme === k ? '' : t.accent }, onclick: () => { snap(); deck.theme = k; draw(); changed(); } }, t.name))));
        inspector.append(h('h4', {}, 'Slide'), h('label', { class: 'field' }, 'Background', colorInput(slide().bg || (THEMES[deck.theme] || THEMES.aurora).bg, (v) => { slide().bg = v; drawStage(); drawThumbs(); })));
        const e = sel && elById(sel);
        if (!e || !canEdit) { inspector.append(h('p', { class: 'muted small' }, canEdit ? 'Click something on the slide to style it. Double-click text to edit it. Arrow keys nudge, Delete removes.' : 'View only')); return; }
        const st = e.style = e.style || {};
        const set = (k, v) => { snap(); if (v === undefined || v === '' || v === false) delete st[k]; else st[k] = v; drawStage(); drawThumbs(); changed(); };
        inspector.append(h('h4', {}, e.type === 'text' ? 'Text' : e.type === 'shape' ? 'Shape' : 'Image'));
        if (e.type !== 'image') {
          const size = h('input', { class: 'input', type: 'number', min: '8', max: '200', value: st.size || 24 });
          size.addEventListener('change', () => set('size', Math.max(8, Math.min(200, +size.value || 24))));
          inspector.append(h('div', { class: 'row' }, h('label', { class: 'field grow' }, 'Size', size), h('label', { class: 'field' }, 'Color', colorInput(st.color || (e.type === 'shape' ? '#ffffff' : (THEMES[deck.theme] || THEMES.aurora).text), (v) => set('color', v)))),
            h('div', { class: 'row' }, ['bold', 'italic', 'underline'].map((k) => h('button', { class: 'btn sm' + (st[k] ? ' on' : ''), type: 'button', onclick: () => set(k, !st[k]) }, icon(k, 14))),
              ['left', 'center', 'right'].map((a) => h('button', { class: 'btn sm' + ((st.align || 'left') === a ? ' on' : ''), type: 'button', onclick: () => set('align', a) }, icon(a === 'left' ? 'alignL' : a === 'center' ? 'alignC' : 'alignR', 14)))));
          if (e.type === 'text') inspector.append(h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: !!st.bullets, onchange: (ev) => set('bullets', ev.target.checked) }), 'Bullet list'));
        }
        if (e.type === 'shape') {
          inspector.append(h('label', { class: 'field' }, 'Fill', colorInput(st.fill || (THEMES[deck.theme] || THEMES.aurora).accent, (v) => set('fill', v))),
            h('div', { class: 'seg' }, [['rect', 'Square'], ['round', 'Rounded'], ['ellipse', 'Circle']].map(([k, l]) => h('button', { type: 'button', class: (st.shape || 'rect') === k ? 'on' : '', onclick: () => set('shape', k) }, l))));
        }
        const num = (k, label) => { const i = h('input', { class: 'input', type: 'number', value: Math.round(e[k] || 0) }); i.addEventListener('change', () => { snap(); e[k] = +i.value || 0; drawStage(); changed(); }); return h('label', { class: 'field' }, label, i); };
        inspector.append(h('h4', {}, 'Position'), h('div', { class: 'row' }, num('x', 'X'), num('y', 'Y')), h('div', { class: 'row' }, num('w', 'Width'), num('h', 'Height')), num('r', 'Rotate (degrees)'),
          h('div', { class: 'row' },
            h('button', { class: 'btn sm', type: 'button', onclick: () => { snap(); const a = slide().elements; a.push(a.splice(a.indexOf(e), 1)[0]); drawStage(); changed(); } }, 'To front'),
            h('button', { class: 'btn sm', type: 'button', onclick: () => { snap(); const a = slide().elements; a.unshift(a.splice(a.indexOf(e), 1)[0]); drawStage(); changed(); } }, 'To back'),
            h('button', { class: 'btn sm danger', type: 'button', onclick: removeSel }, icon('trash', 14))));
      }
      function colorInput(value, onPick) {
        const i = h('input', { type: 'color', value: /^#[0-9a-f]{6}$/i.test(value) ? value : '#000000', style: { width: '44px', height: '34px', border: '1px solid var(--line)', borderRadius: '8px', background: 'none' } });
        i.addEventListener('change', () => { snap(); onPick(i.value); changed(); });
        return i;
      }

      // ---------- add & edit ----------
      function addSlide() {
        snap();
        const t = THEMES[deck.theme] || THEMES.aurora;
        deck.slides.splice(idx + 1, 0, { id: uid('s'), elements: [
          { id: uid('e'), type: 'text', x: 80, y: 60, w: 800, h: 70, text: 'Slide title', style: { size: 44, bold: true } },
          { id: uid('e'), type: 'text', x: 80, y: 160, w: 800, h: 300, text: 'First point\nSecond point\nThird point', style: { size: 28, bullets: true, color: t.text } },
        ], notes: '' });
        idx++; sel = null; draw(); changed();
      }
      function addEl(kind) {
        snap();
        const e = kind === 'bullets' ? { id: uid('e'), type: 'text', x: 120, y: 160, w: 600, h: 200, text: 'Point one\nPoint two', style: { size: 28, bullets: true } }
          : { id: uid('e'), type: 'text', x: 180, y: 220, w: 600, h: 80, text: 'New text', style: { size: 36 } };
        slide().elements.push(e); sel = e.id; draw(); changed();
      }
      function shapeMenu(anchor) {
        menu(anchor, [['rect', 'Rectangle'], ['round', 'Rounded box'], ['ellipse', 'Circle']].map(([k, l]) => ({ label: l, onClick: () => {
          snap(); const e = { id: uid('e'), type: 'shape', x: 380, y: 170, w: 200, h: k === 'ellipse' ? 200 : 140, text: '', style: { shape: k } };
          slide().elements.push(e); sel = e.id; draw(); changed();
        } })));
      }
      async function addImage() {
        const [f] = await pickFile('image/png,image/jpeg,image/gif,image/webp');
        if (!f) return;
        if (f.size > 4 * 1024 * 1024) return toast('Pick an image under 4 MB.', 'bad');
        const src = await readAsDataURL(f);
        const img = new Image();
        img.onload = () => { snap(); const sc = Math.min(1, 600 / img.width, 400 / img.height); const w = Math.round(img.width * sc), hh = Math.round(img.height * sc); const e = { id: uid('e'), type: 'image', x: (W - w) / 2, y: (H - hh) / 2, w, h: hh, src }; slide().elements.push(e); sel = e.id; draw(); changed(); };
        img.src = src;
      }
      function removeSel() { if (!sel) return; snap(); slide().elements = slide().elements.filter((e) => e.id !== sel); sel = null; draw(); changed(); }
      function editText(node) {
        const e = elById(node.dataset.id); if (!e) return;
        snap();
        node.contentEditable = 'true'; node.classList.remove('bullets'); node.textContent = e.text || ''; node.focus();
        document.getSelection().selectAllChildren(node);
        const done = () => { node.contentEditable = 'false'; e.text = node.innerText.replace(/\n$/, ''); drawStage(); drawThumbs(); changed(); };
        node.addEventListener('blur', done, { once: true });
        node.addEventListener('keydown', (ev) => { if (ev.key === 'Escape') { ev.preventDefault(); node.blur(); } ev.stopPropagation(); });
      }
      function startDrag(ev, e, node) {
        if (node.isContentEditable) return;
        ev.stopPropagation();
        if (sel !== e.id) { sel = e.id; drawStage(); drawInspector(); node = stageArea.querySelector(`[data-id="${e.id}"]`); }
        const scale = stageArea.querySelector('.slide').getBoundingClientRect().width / W;
        const resizing = ev.target.dataset.handle === '1';
        const x0 = ev.clientX, y0 = ev.clientY, ox = e.x, oy = e.y, ow = e.w, oh = e.h;
        let moved = false;
        const mv = (m) => {
          const dx = (m.clientX - x0) / scale, dy = (m.clientY - y0) / scale;
          if (!moved && Math.abs(dx) + Math.abs(dy) < 3) return;
          if (!moved) { snap(); moved = true; }
          if (resizing) { e.w = Math.max(20, Math.round(ow + dx)); e.h = Math.max(20, Math.round(oh + dy)); node.style.width = e.w + 'px'; node.style.height = e.h + 'px'; }
          else {
            let nx = Math.round(ox + dx), ny = Math.round(oy + dy);
            // snap to slide center and edges
            if (Math.abs(nx + e.w / 2 - W / 2) < 8) nx = Math.round(W / 2 - e.w / 2);
            if (Math.abs(ny + e.h / 2 - H / 2) < 8) ny = Math.round(H / 2 - e.h / 2);
            e.x = nx; e.y = ny; node.style.left = nx + 'px'; node.style.top = ny + 'px';
          }
        };
        const up = () => { removeEventListener('mousemove', mv); removeEventListener('mouseup', up); if (moved) { drawThumbs(); drawInspector(); changed(); } };
        addEventListener('mousemove', mv); addEventListener('mouseup', up);
      }
      notes.addEventListener('input', () => { slide().notes = notes.value; changed(); });
      const onKey = (e) => {
        if (!canEdit || !sel || /input|textarea/i.test(document.activeElement.tagName) || document.activeElement.isContentEditable) return;
        const el = elById(sel); if (!el) return;
        const step = e.shiftKey ? 10 : 1;
        const moves = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
        if (moves[e.key]) { e.preventDefault(); el.x += moves[e.key][0]; el.y += moves[e.key][1]; drawStage(); changed(); }
        else if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); removeSel(); }
        else if ((e.ctrlKey || e.metaKey) && e.key === 'd') { e.preventDefault(); snap(); const c = { ...JSON.parse(JSON.stringify(el)), id: uid('e'), x: el.x + 20, y: el.y + 20 }; slide().elements.push(c); sel = c.id; draw(); changed(); }
      };
      addEventListener('keydown', onKey);

      // ---------- present ----------
      function present(start) {
        let i = start;
        const box = h('div', { class: 'present', tabIndex: 0 });
        const count = h('div', { class: 'count' });
        const show = () => {
          clear(box);
          const s = renderSlide(deck.slides[i], deck.theme);
          const sc = Math.min(innerWidth / W, innerHeight / H);
          s.style.transform = `scale(${sc})`;
          count.textContent = `${i + 1} / ${deck.slides.length}`;
          box.append(s, count);
        };
        const key = (e) => {
          if (['ArrowRight', 'PageDown', ' ', 'Enter'].includes(e.key)) { i = Math.min(deck.slides.length - 1, i + 1); show(); }
          else if (['ArrowLeft', 'PageUp', 'Backspace'].includes(e.key)) { i = Math.max(0, i - 1); show(); }
          else if (e.key === 'Escape') exit();
          else if (e.key === 'Home') { i = 0; show(); } else if (e.key === 'End') { i = deck.slides.length - 1; show(); }
        };
        const exit = () => { removeEventListener('keydown', key, true); removeEventListener('resize', show); box.remove(); if (document.fullscreenElement) document.exitFullscreen().catch(() => {}); };
        box.addEventListener('click', (e) => { i = e.clientX < innerWidth / 3 ? Math.max(0, i - 1) : Math.min(deck.slides.length - 1, i + 1); show(); });
        addEventListener('keydown', key, true); addEventListener('resize', show);
        document.body.append(box); show();
        if (box.requestFullscreen) box.requestFullscreen().catch(() => {});
        document.addEventListener('fullscreenchange', function f() { if (!document.fullscreenElement) { document.removeEventListener('fullscreenchange', f); if (box.isConnected) exit(); } });
      }

      draw();
      if (query && query.present === '1') setTimeout(() => present(0), 300);
      return { getContent: () => deck, destroy: () => { removeEventListener('keydown', onKey); ro.disconnect(); } };
    },
  }));
})();
