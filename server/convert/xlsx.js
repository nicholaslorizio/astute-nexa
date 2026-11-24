'use strict';
// Grid workbooks <-> .xlsx / .csv
const ExcelJS = require('exceljs');
const { Workbook: FormulaBook, parseAddr, numToCol, isErr } = require('../../shared/formula');

const MAX_CELLS = 500000;

async function gridToXlsx(content) {
  const data = normalize(content);
  const calc = new FormulaBook(data);
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Astute Nexa Grid';
  data.sheets.forEach((sheet, si) => {
    const ws = wb.addWorksheet(safeSheetName(sheet.name, si));
    for (const [a, raw] of Object.entries(sheet.cells)) {
      const cell = ws.getCell(a);
      if (typeof raw === 'string' && raw.startsWith('=')) {
        const v = calc.getValue(si, a);
        cell.value = { formula: raw.slice(1), result: isErr(v) ? { error: v.code } : v };
      } else {
        const v = calc.getValue(si, a);
        cell.value = v;
      }
      const st = sheet.styles && sheet.styles[a];
      if (st) {
        cell.font = { bold: !!st.b, italic: !!st.i, underline: !!st.u, color: st.color ? { argb: 'FF' + st.color.replace('#', '') } : undefined };
        if (st.bg) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF' + st.bg.replace('#', '') } };
        if (st.align) cell.alignment = { horizontal: st.align };
        if (st.fmt) cell.numFmt = st.fmt;
      }
    }
    for (const [col, w] of Object.entries(sheet.colWidths || {})) ws.getColumn(col).width = Math.max(4, Math.round(w / 7));
    if (sheet.frozen) ws.views = [{ state: 'frozen', xSplit: sheet.frozen.cols || 0, ySplit: sheet.frozen.rows || 0 }];
  });
  return Buffer.from(await wb.xlsx.writeBuffer());
}

async function xlsxToGrid(buffer) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  const sheets = [];
  let count = 0;
  wb.eachSheet((ws) => {
    const cells = {};
    const styles = {};
    const colWidths = {};
    ws.eachRow({ includeEmpty: false }, (row) => {
      row.eachCell({ includeEmpty: false }, (cell) => {
        if (++count > MAX_CELLS) return;
        const raw = cellRaw(cell);
        if (raw === null || raw === '') return;
        cells[cell.address] = raw;
        const st = {};
        if (cell.font && cell.font.bold) st.b = 1;
        if (cell.font && cell.font.italic) st.i = 1;
        if (cell.font && cell.font.underline) st.u = 1;
        if (cell.alignment && ['left', 'center', 'right'].includes(cell.alignment.horizontal)) st.align = cell.alignment.horizontal;
        if (cell.fill && cell.fill.fgColor && cell.fill.fgColor.argb && cell.fill.pattern === 'solid') st.bg = '#' + cell.fill.fgColor.argb.slice(-6);
        if (cell.numFmt && cell.numFmt !== 'General') st.fmt = cell.numFmt;
        if (Object.keys(st).length) styles[cell.address] = st;
      });
    });
    ws.columns && ws.columns.forEach((c, i) => { if (c && c.width && c.width !== 9) colWidths[numToCol(i + 1)] = Math.round(c.width * 7); });
    sheets.push({ name: ws.name, cells, styles, colWidths });
  });
  if (count > MAX_CELLS) throw Object.assign(new Error('This workbook has more than 500,000 cells, which is above the Grid limit.'), { status: 413 });
  return { sheets: sheets.length ? sheets : [{ name: 'Sheet1', cells: {} }] };
}

function cellRaw(cell) {
  const v = cell.value;
  if (v === null || v === undefined) return null;
  if (typeof v === 'object') {
    if (v.formula || v.sharedFormula) {
      if (v.formula) return '=' + v.formula;
      // shared formula: fall back to computed result
      return v.result === undefined ? null : String(v.result);
    }
    if (v.richText) return v.richText.map((r) => r.text).join('');
    if (v.text !== undefined) return String(v.text);
    if (v instanceof Date) {
      const serial = (v.getTime() - Date.UTC(1899, 11, 30)) / 86400000;
      return String(serial);
    }
    if (v.error) return v.error;
    return null;
  }
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
  return String(v);
}

function gridToCsv(content, sheetIdx = 0) {
  const data = normalize(content);
  const calc = new FormulaBook(data);
  const sheet = data.sheets[sheetIdx] || data.sheets[0];
  let maxR = 0, maxC = 0;
  for (const a of Object.keys(sheet.cells)) { const p = parseAddr(a); if (p) { maxR = Math.max(maxR, p.row); maxC = Math.max(maxC, p.col); } }
  const lines = [];
  for (let r = 1; r <= maxR; r++) {
    const row = [];
    for (let c = 1; c <= maxC; c++) {
      const s = calc.getDisplay(data.sheets.indexOf(sheet), numToCol(c) + r);
      row.push(/[",\n\r]/.test(s) || /^[=+\-@]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s);
    }
    lines.push(row.join(','));
  }
  return lines.join('\r\n');
}

function csvToGrid(text) {
  const cells = {};
  const rows = parseCsv(String(text).replace(/^﻿/, ''));
  rows.forEach((row, r) => row.forEach((v, c) => {
    if (v === '') return;
    // never import a CSV value as a live formula (CSV injection)
    cells[numToCol(c + 1) + (r + 1)] = /^=/.test(v) ? "'" + v : v;
  }));
  return { sheets: [{ name: 'Sheet1', cells }] };
}
function parseCsv(s) {
  const rows = [];
  let row = [], field = '', q = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) {
      if (c === '"') { if (s[i + 1] === '"') { field += '"'; i++; } else q = false; } else field += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && s[i + 1] === '\n') i++; row.push(field); rows.push(row); row = []; field = ''; }
    else field += c;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows;
}

function normalize(content) {
  const c = typeof content === 'string' ? JSON.parse(content || '{}') : (content || {});
  const sheets = Array.isArray(c.sheets) && c.sheets.length ? c.sheets : [{ name: 'Sheet1', cells: {} }];
  return { sheets: sheets.map((s, i) => ({ name: String(s.name || `Sheet${i + 1}`), cells: s.cells || {}, styles: s.styles || {}, colWidths: s.colWidths || {}, frozen: s.frozen })) };
}
function safeSheetName(name, i) {
  const n = String(name || '').replace(/[\\/?*[\]:]/g, ' ').slice(0, 31).trim();
  return n || `Sheet${i + 1}`;
}

module.exports = { gridToXlsx, xlsxToGrid, gridToCsv, csvToGrid };
