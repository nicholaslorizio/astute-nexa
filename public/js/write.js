/* Write: rich text documents. */
'use strict';
(function () {
  const { h, $, $$, clear, icon, toast, fail, modal, readAsDataURL, pickFile } = Nexa;

  function exec(cmd, val) { document.execCommand(cmd, false, val); }
  function tb(label, ic, fn, title) { return h('button', { class: 'btn', type: 'button', title: title || label, 'aria-label': title || label, onmousedown: (e) => e.preventDefault(), onclick: fn }, ic ? icon(ic, 16) : label); }

  Nexa.Router.add('/write/:id', ({ id }) => Nexa.openEditor({
    id, appId: 'write',
    exportFormats: [{ label: 'Word document (.docx)', fmt: 'docx' }, { label: 'Web page (.html)', fmt: 'html' }],
    build({ body, content, canEdit, changed }) {
      const page = h('div', { class: 'page', contentEditable: canEdit ? 'true' : 'false', spellcheck: true, html: (content && content.html) || '' });
      const outline = h('nav', { class: 'outline', 'aria-label': 'Outline' });
      const words = h('span', { class: 'muted small' });
      const block = h('select', { title: 'Text style', onchange: () => { exec('formatBlock', block.value); page.focus(); changed(); } },
        h('option', { value: 'P' }, 'Normal text'), h('option', { value: 'H1' }, 'Title'), h('option', { value: 'H2' }, 'Heading'), h('option', { value: 'H3' }, 'Subheading'), h('option', { value: 'BLOCKQUOTE' }, 'Quote'), h('option', { value: 'PRE' }, 'Code block'));
      const font = h('select', { title: 'Font', onchange: () => { page.classList.toggle('sans', font.value === 'sans'); } }, h('option', { value: 'serif' }, 'Serif'), h('option', { value: 'sans' }, 'Sans'));
      const color = h('input', { type: 'color', value: '#1B2037', title: 'Text color', oninput: () => { exec('foreColor', color.value); changed(); } });
      const mark = h('input', { type: 'color', value: '#FFF3A3', title: 'Highlight', oninput: () => { exec('hiliteColor', mark.value); changed(); } });
      const toolbar = canEdit ? h('div', { class: 'toolbar', role: 'toolbar' },
        tb('Undo', 'undo', () => exec('undo')), tb('Redo', 'redo', () => exec('redo')), h('span', { class: 'sep' }),
        block, font, h('span', { class: 'sep' }),
        tb('Bold', 'bold', () => exec('bold'), 'Bold (Ctrl+B)'), tb('Italic', 'italic', () => exec('italic'), 'Italic (Ctrl+I)'), tb('Underline', 'underline', () => exec('underline'), 'Underline (Ctrl+U)'), tb('Strike', 'strike', () => exec('strikeThrough')),
        color, mark, h('span', { class: 'sep' }),
        tb('Bullets', 'list', () => exec('insertUnorderedList')), tb('Numbers', 'olist', () => exec('insertOrderedList')), tb('Checklist', 'checklist', checklist),
        tb('Left', 'alignL', () => exec('justifyLeft')), tb('Center', 'alignC', () => exec('justifyCenter')), tb('Right', 'alignR', () => exec('justifyRight')), h('span', { class: 'sep' }),
        tb('Link', 'link', link), tb('Image', 'image', image), tb('Table', 'table', table), tb('Divider', null, () => exec('insertHorizontalRule'), 'Divider line'),
        tb('Clear formatting', null, () => exec('removeFormat'), 'Clear formatting'), h('span', { class: 'grow' }), words) : null;
      if (toolbar) $$('button', toolbar).filter((b) => b.textContent === 'Divider').forEach((b) => { b.textContent = '―'; });
      body.append(toolbar || h('div', {}), h('div', { class: 'write-body' }, outline, h('div', { class: 'write-scroll' }, page)));

      function checklist() {
        exec('insertUnorderedList');
        const sel = getSelection();
        const ul = sel.anchorNode && (sel.anchorNode.nodeType === 1 ? sel.anchorNode : sel.anchorNode.parentElement).closest('ul');
        if (ul) ul.setAttribute('data-type', 'checklist');
        changed();
      }
      page.addEventListener('click', (e) => {
        const li = e.target.closest('ul[data-type=checklist] > li');
        if (li && canEdit && e.offsetX < 22) { li.dataset.checked = li.dataset.checked === 'true' ? 'false' : 'true'; changed(); }
      });
      function link() {
        const sel = getSelection(); const range = sel.rangeCount ? sel.getRangeAt(0).cloneRange() : null;
        const url = h('input', { class: 'input', placeholder: 'https://example.com' });
        modal({ title: 'Add a link', body: h('label', { class: 'field' }, 'Web address', url), actions: [{ label: 'Cancel' }, { label: 'Add link', kind: 'primary', submit: true, onClick: () => {
          let v = url.value.trim(); if (!v) return;
          if (!/^(https?:|mailto:)/i.test(v)) v = 'https://' + v;
          page.focus(); if (range) { sel.removeAllRanges(); sel.addRange(range); }
          if (range && range.collapsed) exec('insertHTML', `<a href="${Nexa.escapeHtml(v)}">${Nexa.escapeHtml(v)}</a>`); else exec('createLink', v);
          changed();
        } }] });
      }
      async function image() {
        const [f] = await pickFile('image/png,image/jpeg,image/gif,image/webp');
        if (!f) return;
        if (f.size > 4 * 1024 * 1024) return toast('Pick an image under 4 MB.', 'bad');
        page.focus(); exec('insertImage', await readAsDataURL(f)); changed();
      }
      function table() {
        const rows = h('input', { class: 'input', type: 'number', value: '3', min: '1', max: '50' });
        const cols = h('input', { class: 'input', type: 'number', value: '3', min: '1', max: '12' });
        const sel = getSelection(); const range = sel.rangeCount ? sel.getRangeAt(0).cloneRange() : null;
        modal({ title: 'Insert table', body: h('div', { class: 'row' }, h('label', { class: 'field grow' }, 'Rows', rows), h('label', { class: 'field grow' }, 'Columns', cols)), actions: [{ label: 'Cancel' }, { label: 'Insert', kind: 'primary', submit: true, onClick: () => {
          const r = Math.min(50, +rows.value || 3), c = Math.min(12, +cols.value || 3);
          const html = '<table><tbody>' + Array.from({ length: r }, (_, i) => '<tr>' + Array.from({ length: c }, () => (i === 0 ? '<th><br></th>' : '<td><br></td>')).join('') + '</tr>').join('') + '</tbody></table><p><br></p>';
          page.focus(); if (range) { sel.removeAllRanges(); sel.addRange(range); } exec('insertHTML', html); changed();
        } }] });
      }

      function refresh() {
        clear(outline).append(h('div', { class: 'muted small', style: { padding: '0 8px 8px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.06em' } }, 'Outline'));
        const heads = $$('h1,h2,h3', page);
        if (!heads.length) outline.append(h('div', { class: 'muted small', style: { padding: '0 8px' } }, 'Headings you add show here.'));
        heads.forEach((el) => outline.append(h('a', { href: '#', class: el.tagName.toLowerCase(), onclick: (e) => { e.preventDefault(); el.scrollIntoView({ behavior: 'smooth', block: 'start' }); } }, el.textContent || '(empty heading)')));
        const n = (page.innerText.match(/\S+/g) || []).length;
        words.textContent = `${n} word${n === 1 ? '' : 's'} · ${Math.max(1, Math.round(n / 230))} min read`;
      }
      const refreshSoon = Nexa.debounce(refresh, 300);
      page.addEventListener('input', () => { changed(); refreshSoon(); });
      page.addEventListener('keyup', () => {
        const n = getSelection().anchorNode; const el = n && (n.nodeType === 1 ? n : n.parentElement);
        const b = el && el.closest('h1,h2,h3,blockquote,pre,p');
        if (b && block) block.value = b.tagName === 'P' ? 'P' : b.tagName;
      });
      page.addEventListener('paste', (e) => {
        // keep pasted content clean: plain text unless it is simple HTML; the server sanitizes again on save
        const html = e.clipboardData.getData('text/html');
        if (!html) return;
        e.preventDefault();
        const tmp = document.createElement('template'); tmp.innerHTML = html;
        tmp.content.querySelectorAll('script,style,meta,link,iframe,object,embed,form,input,button').forEach((n) => n.remove());
        tmp.content.querySelectorAll('*').forEach((n) => { [...n.attributes].forEach((a) => { if (!['href', 'src', 'colspan', 'rowspan'].includes(a.name)) n.removeAttribute(a.name); }); if (n.hasAttribute('href') && !/^(https?:|mailto:)/i.test(n.getAttribute('href'))) n.removeAttribute('href'); });
        exec('insertHTML', tmp.innerHTML);
      });
      page.addEventListener('keydown', (e) => {
        if ((e.ctrlKey || e.metaKey) && e.key === 's') { e.preventDefault(); changed(); toast('Nexa saves as you type'); }
        // markdown-style shortcuts at the start of a line
        if (e.key === ' ' && canEdit) {
          const sel = getSelection(); const n = sel.anchorNode;
          if (n && n.nodeType === 3 && sel.anchorOffset === n.textContent.length) {
            const t = n.textContent;
            const map = { '#': 'H1', '##': 'H2', '###': 'H3', '>': 'BLOCKQUOTE' };
            if (map[t] && n.parentElement.closest('.page > *, .page') ) { e.preventDefault(); n.textContent = ''; exec('formatBlock', map[t]); changed(); }
            else if (t === '-' || t === '*') { e.preventDefault(); n.textContent = ''; exec('insertUnorderedList'); changed(); }
            else if (t === '1.') { e.preventDefault(); n.textContent = ''; exec('insertOrderedList'); changed(); }
            else if (t === '[]') { e.preventDefault(); n.textContent = ''; checklist(); }
          }
        }
      });
      refresh();
      if (canEdit) setTimeout(() => page.focus(), 50);
      return { getContent: () => ({ html: page.innerHTML }) };
    },
  }));
})();
