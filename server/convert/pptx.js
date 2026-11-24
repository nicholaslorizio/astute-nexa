'use strict';
// Deck presentations <-> .pptx
// Canvas is 960 x 540 px (16:9). PowerPoint 16:9 is 10in x 5.625in = 9144000 x 5143500 EMU.
const PptxGenJS = require('pptxgenjs');
const JSZip = require('jszip');
const { parseDocument } = require('htmlparser2');
const { THEMES } = require('../../shared/themes');

const PX_PER_IN = 96;
const EMU_PER_PX = 9525;
const MAX_SLIDES = 300;

const strip = (c) => (c || '').replace('#', '').toUpperCase();

async function deckToPptx(content, { title } = {}) {
  const deck = normalizeDeck(content);
  const theme = THEMES[deck.theme] || THEMES.aurora;
  const pres = new PptxGenJS();
  pres.layout = 'LAYOUT_16x9';
  pres.title = title || 'Presentation';
  pres.company = 'Astute Nexa';
  for (const s of deck.slides) {
    const slide = pres.addSlide();
    slide.background = { color: strip(s.bg || theme.bg) };
    for (const el of s.elements) {
      const pos = { x: el.x / PX_PER_IN, y: el.y / PX_PER_IN, w: el.w / PX_PER_IN, h: el.h / PX_PER_IN };
      const st = el.style || {};
      if (el.type === 'text') {
        slide.addText(String(el.text || ''), {
          ...pos,
          fontFace: st.font === 'mono' ? 'Consolas' : theme.fontPptx,
          fontSize: Math.max(6, Math.round((st.size || 24) * 0.75)),
          color: strip(st.color || theme.text),
          bold: !!st.bold, italic: !!st.italic, underline: st.underline ? { style: 'sng' } : undefined,
          align: st.align || 'left', valign: st.valign || 'top',
          fill: st.fill ? { color: strip(st.fill) } : undefined,
          bullet: st.bullets ? true : undefined,
          margin: 4,
        });
      } else if (el.type === 'shape') {
        slide.addShape(st.shape === 'ellipse' ? pres.ShapeType.ellipse : st.shape === 'round' ? pres.ShapeType.roundRect : pres.ShapeType.rect, {
          ...pos,
          fill: { color: strip(st.fill || theme.accent) },
          line: st.stroke ? { color: strip(st.stroke), width: 1 } : { type: 'none' },
          rectRadius: st.shape === 'round' ? 0.15 : undefined,
        });
        if (el.text) slide.addText(String(el.text), { ...pos, align: 'center', valign: 'middle', color: strip(st.color || '#FFFFFF'), fontSize: Math.round((st.size || 24) * 0.75), fontFace: theme.fontPptx, bold: !!st.bold });
      } else if (el.type === 'image' && /^data:image\/(png|jpe?g|gif|svg\+xml);base64,/i.test(el.src || '')) {
        slide.addImage({ data: el.src.replace(/^data:/, ''), ...pos });
      }
    }
    if (s.notes) slide.addNotes(String(s.notes));
  }
  return pres.write({ outputType: 'nodebuffer' });
}

async function pptxToDeck(buffer) {
  const zip = await JSZip.loadAsync(buffer);
  const order = await slideOrder(zip);
  const slides = [];
  for (const path of order.slice(0, MAX_SLIDES)) {
    const xml = await zip.file(path).async('string');
    const relsPath = path.replace(/slides\/(slide\d+\.xml)$/, 'slides/_rels/$1.rels');
    const rels = zip.file(relsPath) ? parseRels(await zip.file(relsPath).async('string')) : {};
    const notesTarget = Object.values(rels).find((r) => /notesSlide/.test(r.type));
    let notes = '';
    if (notesTarget) {
      const np = resolvePath(path, notesTarget.target);
      if (zip.file(np)) notes = textRuns(parseDocument(await zip.file(np).async('string'), { xmlMode: true })).filter((t) => !/^\d+$/.test(t)).join('\n');
    }
    slides.push(await parseSlide(xml, rels, path, zip, notes));
  }
  return { theme: 'aurora', slides: slides.length ? slides : [blankSlide()] };
}

async function slideOrder(zip) {
  const pres = zip.file('ppt/presentation.xml');
  const presRels = zip.file('ppt/_rels/presentation.xml.rels');
  if (pres && presRels) {
    const rels = parseRels(await presRels.async('string'));
    const dom = parseDocument(await pres.async('string'), { xmlMode: true });
    const ids = findAll(dom, 'p:sldId').map((n) => n.attribs['r:id']).filter(Boolean);
    const paths = ids.map((id) => rels[id] && resolvePath('ppt/presentation.xml', rels[id].target)).filter((p) => p && zip.file(p));
    if (paths.length) return paths;
  }
  return Object.keys(zip.files).filter((p) => /^ppt\/slides\/slide\d+\.xml$/.test(p))
    .sort((a, b) => +a.match(/(\d+)\.xml$/)[1] - +b.match(/(\d+)\.xml$/)[1]);
}

function parseRels(xml) {
  const out = {};
  const dom = parseDocument(xml, { xmlMode: true });
  for (const r of findAll(dom, 'Relationship')) out[r.attribs.Id] = { target: r.attribs.Target, type: r.attribs.Type || '' };
  return out;
}
function resolvePath(from, target) {
  if (target.startsWith('/')) return target.slice(1);
  const parts = from.split('/'); parts.pop();
  for (const seg of target.split('/')) { if (seg === '..') parts.pop(); else if (seg !== '.') parts.push(seg); }
  return parts.join('/');
}
function findAll(node, name, out = []) {
  for (const c of node.children || []) {
    if (c.type === 'tag') { if (c.name === name) out.push(c); findAll(c, name, out); }
  }
  return out;
}
const first = (node, name) => findAll(node, name)[0];
function textRuns(node) {
  return findAll(node, 'a:p').map((p) => findAll(p, 'a:t').map((t) => (t.children[0] && t.children[0].data) || '').join('')).filter((s) => s.trim() !== '');
}
const decode = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');

function xfrm(node) {
  const off = first(node, 'a:off');
  const ext = first(node, 'a:ext');
  if (!off || !ext) return null;
  return {
    x: Math.round(+off.attribs.x / EMU_PER_PX), y: Math.round(+off.attribs.y / EMU_PER_PX),
    w: Math.max(10, Math.round(+ext.attribs.cx / EMU_PER_PX)), h: Math.max(10, Math.round(+ext.attribs.cy / EMU_PER_PX)),
  };
}

async function parseSlide(xml, rels, slidePath, zip, notes) {
  const dom = parseDocument(xml, { xmlMode: true });
  const elements = [];
  let bg;
  const bgFill = first(dom, 'p:bg');
  if (bgFill) { const c = first(bgFill, 'a:srgbClr'); if (c) bg = '#' + c.attribs.val; }
  let i = 0;
  for (const sp of findAll(dom, 'p:sp')) {
    const box = xfrm(sp) || { x: 60, y: 60 + i * 80, w: 840, h: 70 };
    const lines = findAll(sp, 'a:p').map((p) => decode(findAll(p, 'a:t').map((t) => (t.children[0] && t.children[0].data) || '').join('')));
    const text = lines.join('\n').replace(/\n+$/, '');
    const rpr = first(sp, 'a:rPr') || first(sp, 'a:defRPr');
    const sz = rpr && rpr.attribs.sz ? Math.round((+rpr.attribs.sz / 100) * (PX_PER_IN / 72)) : null;
    const isTitle = !!findAll(sp, 'p:ph').find((ph) => /title/i.test(ph.attribs.type || ''));
    const spPr = first(sp, 'p:spPr');
    const fillClr = spPr && first(spPr, 'a:solidFill') && first(first(spPr, 'a:solidFill'), 'a:srgbClr');
    const runClr = rpr && first(rpr, 'a:srgbClr');
    const geom = spPr && first(spPr, 'a:prstGeom');
    const style = {
      size: sz || (isTitle ? 40 : 22),
      bold: !!(rpr && rpr.attribs.b === '1') || isTitle,
      italic: !!(rpr && rpr.attribs.i === '1'),
      color: runClr ? '#' + runClr.attribs.val : undefined,
    };
    if (fillClr && !text) {
      elements.push({ id: 'e' + i++, type: 'shape', ...box, style: { shape: geom && geom.attribs.prst === 'ellipse' ? 'ellipse' : 'rect', fill: '#' + fillClr.attribs.val } });
    } else if (text) {
      if (fillClr) style.fill = '#' + fillClr.attribs.val;
      elements.push({ id: 'e' + i++, type: 'text', ...box, text, style });
    }
  }
  for (const pic of findAll(dom, 'p:pic')) {
    const blip = first(pic, 'a:blip');
    const rid = blip && (blip.attribs['r:embed']);
    const rel = rid && rels[rid];
    if (!rel) continue;
    const mediaPath = resolvePath(slidePath, rel.target);
    const f = zip.file(mediaPath);
    if (!f) continue;
    const ext = (mediaPath.split('.').pop() || '').toLowerCase();
    const mime = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif' }[ext];
    if (!mime) continue;
    const data = await f.async('base64');
    if (data.length > 8_000_000) continue;
    const box = xfrm(pic) || { x: 280, y: 120, w: 400, h: 300 };
    elements.push({ id: 'e' + i++, type: 'image', ...box, src: `data:${mime};base64,${data}` });
  }
  return { id: 's' + Math.random().toString(36).slice(2, 9), bg, elements, notes };
}

const blankSlide = () => ({ id: 's1', elements: [], notes: '' });

function normalizeDeck(content) {
  const c = typeof content === 'string' ? JSON.parse(content || '{}') : (content || {});
  const slides = Array.isArray(c.slides) && c.slides.length ? c.slides : [blankSlide()];
  return { theme: c.theme || 'aurora', slides: slides.map((s) => ({ ...s, elements: Array.isArray(s.elements) ? s.elements : [] })) };
}

module.exports = { deckToPptx, pptxToDeck };
