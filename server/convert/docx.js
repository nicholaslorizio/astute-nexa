'use strict';
// Write documents <-> .docx
const docx = require('docx');
const mammoth = require('mammoth');
const { parseDocument } = require('htmlparser2');
const { sanitizeDocHtml } = require('../sanitize');

const {
  Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType, ExternalHyperlink,
  Table, TableRow, TableCell, WidthType, ImageRun, LevelFormat, BorderStyle,
} = docx;

const HEADINGS = { h1: HeadingLevel.HEADING_1, h2: HeadingLevel.HEADING_2, h3: HeadingLevel.HEADING_3, h4: HeadingLevel.HEADING_4 };
const ALIGN = { left: AlignmentType.LEFT, center: AlignmentType.CENTER, right: AlignmentType.RIGHT, justify: AlignmentType.JUSTIFIED };

function styleOf(el) {
  const out = {};
  const s = (el.attribs && el.attribs.style) || '';
  for (const part of s.split(';')) {
    const [k, v] = part.split(':').map((x) => x && x.trim());
    if (k && v) out[k.toLowerCase()] = v;
  }
  return out;
}
function hex(color) {
  if (!color) return undefined;
  const m = /^#([0-9a-f]{6})$/i.exec(color) || /^#([0-9a-f]{3})$/i.exec(color);
  if (m) return m[1].length === 3 ? m[1].split('').map((c) => c + c).join('') : m[1];
  const rgb = /rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/.exec(color);
  if (rgb) return [rgb[1], rgb[2], rgb[3]].map((n) => (+n).toString(16).padStart(2, '0')).join('');
  return undefined;
}

function runsFrom(nodes, fmt = {}) {
  const out = [];
  for (const n of nodes) {
    if (n.type === 'text') {
      const text = n.data.replace(/\s+/g, ' ');
      if (text) out.push(new TextRun({ text, bold: fmt.b, italics: fmt.i, underline: fmt.u ? {} : undefined, strike: fmt.s, color: fmt.color, highlight: fmt.mark ? 'yellow' : undefined, font: fmt.code ? 'Consolas' : undefined, superScript: fmt.sup, subScript: fmt.sub }));
      continue;
    }
    if (n.type !== 'tag') continue;
    const tag = n.name;
    const f = { ...fmt };
    if (tag === 'strong' || tag === 'b') f.b = true;
    if (tag === 'em' || tag === 'i') f.i = true;
    if (tag === 'u') f.u = true;
    if (tag === 's' || tag === 'strike' || tag === 'del') f.s = true;
    if (tag === 'mark') f.mark = true;
    if (tag === 'code') f.code = true;
    if (tag === 'sup') f.sup = true;
    if (tag === 'sub') f.sub = true;
    const st = styleOf(n);
    if (st.color) f.color = hex(st.color);
    if (st['font-weight'] === 'bold' || +st['font-weight'] >= 600) f.b = true;
    if (tag === 'br') { out.push(new TextRun({ text: '', break: 1 })); continue; }
    if (tag === 'a' && n.attribs.href && /^https?:|^mailto:/i.test(n.attribs.href)) {
      out.push(new ExternalHyperlink({ link: n.attribs.href, children: runsFrom(n.children, { ...f, u: true, color: '2F6BFF' }) }));
      continue;
    }
    if (tag === 'img') { const img = imageRun(n); if (img) out.push(img); continue; }
    out.push(...runsFrom(n.children || [], f));
  }
  return out;
}

function imageRun(n) {
  const m = /^data:image\/(png|jpe?g|gif);base64,(.+)$/i.exec(n.attribs.src || '');
  if (!m) return null;
  const data = Buffer.from(m[2], 'base64');
  const w = Math.min(+n.attribs.width || 480, 600);
  const h = +n.attribs.height || Math.round(w * 0.6);
  return new ImageRun({ type: m[1].toLowerCase().startsWith('jp') ? 'jpg' : m[1].toLowerCase(), data, transformation: { width: w, height: h } });
}

function blocksFrom(nodes, ctx = { listLevel: -1, list: null }) {
  const out = [];
  let inline = [];
  const flush = () => {
    if (inline.length) {
      const runs = runsFrom(inline);
      if (runs.length) out.push(new Paragraph({ children: runs }));
      inline = [];
    }
  };
  for (const n of nodes) {
    if (n.type === 'text' || (n.type === 'tag' && !isBlock(n.name))) { inline.push(n); continue; }
    if (n.type !== 'tag') continue;
    flush();
    const st = styleOf(n);
    const alignment = ALIGN[st['text-align']];
    switch (n.name) {
      case 'p': case 'div':
        if (n.children.some((c) => c.type === 'tag' && isBlock(c.name))) out.push(...blocksFrom(n.children, ctx));
        else out.push(new Paragraph({ children: runsFrom(n.children), alignment }));
        break;
      case 'h1': case 'h2': case 'h3': case 'h4':
        out.push(new Paragraph({ heading: HEADINGS[n.name], children: runsFrom(n.children), alignment }));
        break;
      case 'blockquote':
        out.push(new Paragraph({ children: runsFrom(n.children, { i: true }), indent: { left: 720 }, border: { left: { style: BorderStyle.SINGLE, size: 12, color: '7C5CFF', space: 8 } } }));
        break;
      case 'pre':
        for (const line of textOf(n).split('\n')) out.push(new Paragraph({ children: [new TextRun({ text: line, font: 'Consolas' })] }));
        break;
      case 'hr':
        out.push(new Paragraph({ children: [], border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: 'C9CCD6', space: 1 } } }));
        break;
      case 'ul': case 'ol': {
        const level = ctx.listLevel + 1;
        for (const li of n.children.filter((c) => c.type === 'tag' && c.name === 'li')) {
          const inlineKids = li.children.filter((c) => !(c.type === 'tag' && (c.name === 'ul' || c.name === 'ol')));
          const nested = li.children.filter((c) => c.type === 'tag' && (c.name === 'ul' || c.name === 'ol'));
          out.push(new Paragraph({ children: runsFrom(inlineKids), numbering: { reference: n.name === 'ol' ? 'nexa-numbers' : 'nexa-bullets', level: Math.min(level, 2) } }));
          if (nested.length) out.push(...blocksFrom(nested, { listLevel: level }));
        }
        break;
      }
      case 'table': {
        const rows = [];
        const walk = (el) => { for (const c of el.children || []) { if (c.type !== 'tag') continue; if (c.name === 'tr') rows.push(c); else walk(c); } };
        walk(n);
        if (!rows.length) break;
        const cols = Math.max(...rows.map((r) => r.children.filter((c) => c.type === 'tag' && (c.name === 'td' || c.name === 'th')).length));
        out.push(new Table({
          width: { size: 100, type: WidthType.PERCENTAGE },
          rows: rows.map((r) => {
            const cells = r.children.filter((c) => c.type === 'tag' && (c.name === 'td' || c.name === 'th'));
            while (cells.length < cols) cells.push({ type: 'tag', name: 'td', children: [], attribs: {} });
            return new TableRow({
              children: cells.map((c) => new TableCell({
                children: [new Paragraph({ children: runsFrom(c.children, { b: c.name === 'th' }) })],
              })),
            });
          }),
        }));
        break;
      }
      case 'img': { const img = imageRun(n); if (img) out.push(new Paragraph({ children: [img] })); break; }
      default: out.push(...blocksFrom(n.children || [], ctx));
    }
  }
  flush();
  return out;
}
const BLOCKS = new Set(['p', 'div', 'h1', 'h2', 'h3', 'h4', 'ul', 'ol', 'li', 'blockquote', 'pre', 'hr', 'table', 'thead', 'tbody', 'tr', 'td', 'th', 'section']);
const isBlock = (t) => BLOCKS.has(t);
const textOf = (n) => (n.type === 'text' ? n.data : (n.children || []).map(textOf).join(''));

async function htmlToDocx(html, { title } = {}) {
  const dom = parseDocument(sanitizeDocHtml(html || ''));
  const children = blocksFrom(dom.children);
  const listLevels = (fmt, chars) => [0, 1, 2].map((level) => ({
    level, format: fmt, text: fmt === LevelFormat.BULLET ? chars[level] : `%${level + 1}.`,
    alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 720 * (level + 1), hanging: 360 } } },
  }));
  const doc = new Document({
    title: title || 'Document',
    creator: 'Astute Nexa Write',
    styles: { default: { document: { run: { font: 'Calibri', size: 22 } } } },
    numbering: {
      config: [
        { reference: 'nexa-bullets', levels: listLevels(LevelFormat.BULLET, ['•', '◦', '▪']) },
        { reference: 'nexa-numbers', levels: listLevels(LevelFormat.DECIMAL, []) },
      ],
    },
    sections: [{ children: children.length ? children : [new Paragraph('')] }],
  });
  return Packer.toBuffer(doc);
}

async function docxToHtml(buffer) {
  const { value } = await mammoth.convertToHtml({ buffer }, {
    styleMap: ['u => u', 'strike => s'],
  });
  return sanitizeDocHtml(value);
}

module.exports = { htmlToDocx, docxToHtml };
