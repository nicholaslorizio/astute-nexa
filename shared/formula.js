/*
 * Astute Nexa Grid formula engine.
 * Original implementation (no third-party code). Runs in the browser and in Node.
 *
 * Model: a workbook is { sheets: [{ name, cells: { "A1": "raw input", ... } }] }.
 * Raw input starting with "=" is a formula. Everything else is a literal
 * (numbers are parsed, TRUE/FALSE become booleans).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.NexaFormula = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  class FErr {
    constructor(code) { this.code = code; }
    toString() { return this.code; }
  }
  const ERR = {
    DIV0: new FErr('#DIV/0!'), VALUE: new FErr('#VALUE!'), REF: new FErr('#REF!'),
    NAME: new FErr('#NAME?'), NA: new FErr('#N/A'), NUM: new FErr('#NUM!'),
    CIRC: new FErr('#CIRC!'), PARSE: new FErr('#ERROR!'),
  };
  const isErr = (v) => v instanceof FErr;

  // ---------- addresses ----------
  function colToNum(col) {
    let n = 0;
    for (const ch of col.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
    return n;
  }
  function numToCol(n) {
    let s = '';
    while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); }
    return s;
  }
  function parseAddr(a) {
    const m = /^\$?([A-Za-z]{1,3})\$?(\d{1,7})$/.exec(a);
    if (!m) return null;
    return { col: colToNum(m[1]), row: parseInt(m[2], 10) };
  }
  const addr = (col, row) => numToCol(col) + row;

  // ---------- tokenizer ----------
  function tokenize(src) {
    const t = [];
    let i = 0;
    const s = src;
    while (i < s.length) {
      const c = s[i];
      if (/\s/.test(c)) { i++; continue; }
      if (c === '"') {
        let j = i + 1, str = '';
        while (j < s.length) {
          if (s[j] === '"') { if (s[j + 1] === '"') { str += '"'; j += 2; continue; } break; }
          str += s[j++];
        }
        if (j >= s.length) throw ERR.PARSE;
        t.push({ type: 'str', v: str }); i = j + 1; continue;
      }
      if (/[0-9.]/.test(c)) {
        const m = /^(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?/.exec(s.slice(i));
        if (!m) throw ERR.PARSE;
        t.push({ type: 'num', v: parseFloat(m[0]) }); i += m[0].length; continue;
      }
      // quoted sheet name: 'My Sheet'!A1
      if (c === "'") {
        const m = /^'((?:[^']|'')+)'!(\$?[A-Za-z]{1,3}\$?\d+(?::\$?[A-Za-z]{1,3}\$?\d+)?)/.exec(s.slice(i));
        if (!m) throw ERR.PARSE;
        t.push(refToken(m[2], m[1].replace(/''/g, "'"))); i += m[0].length; continue;
      }
      if (/[A-Za-z_$]/.test(c)) {
        const rest = s.slice(i);
        let m = /^([A-Za-z_][A-Za-z0-9_.]*)!(\$?[A-Za-z]{1,3}\$?\d+(?::\$?[A-Za-z]{1,3}\$?\d+)?)/.exec(rest);
        if (m) { t.push(refToken(m[2], m[1])); i += m[0].length; continue; }
        m = /^\$?[A-Za-z]{1,3}\$?\d+(?::\$?[A-Za-z]{1,3}\$?\d+)?(?![A-Za-z0-9_(])/.exec(rest);
        if (m) { t.push(refToken(m[0], null)); i += m[0].length; continue; }
        m = /^[A-Za-z_][A-Za-z0-9_.]*/.exec(rest);
        const word = m[0];
        i += word.length;
        const up = word.toUpperCase();
        if (up === 'TRUE' || up === 'FALSE') { t.push({ type: 'bool', v: up === 'TRUE' }); continue; }
        t.push({ type: 'name', v: up }); continue;
      }
      const two = s.slice(i, i + 2);
      if (two === '<=' || two === '>=' || two === '<>') { t.push({ type: 'op', v: two }); i += 2; continue; }
      if ('+-*/^&=<>%'.includes(c)) { t.push({ type: 'op', v: c }); i++; continue; }
      if (c === '(' || c === ')' || c === ',' || c === ';') { t.push({ type: c === ';' ? ',' : c }); i++; continue; }
      throw ERR.PARSE;
    }
    return t;
  }
  function refToken(text, sheet) {
    const parts = text.split(':');
    const a = parseAddr(parts[0]);
    const b = parts[1] ? parseAddr(parts[1]) : null;
    if (!a || (parts[1] && !b)) throw ERR.REF;
    if (b) {
      return { type: 'range', sheet, c1: Math.min(a.col, b.col), r1: Math.min(a.row, b.row), c2: Math.max(a.col, b.col), r2: Math.max(a.row, b.row) };
    }
    return { type: 'ref', sheet, col: a.col, row: a.row };
  }

  // ---------- parser (precedence climbing) ----------
  function parse(src) {
    const toks = tokenize(src);
    let p = 0;
    const peek = () => toks[p];
    const next = () => toks[p++];
    const isOp = (v) => peek() && peek().type === 'op' && peek().v === v;

    function primary() {
      const tk = next();
      if (!tk) throw ERR.PARSE;
      switch (tk.type) {
        case 'num': return { k: 'lit', v: tk.v };
        case 'str': return { k: 'lit', v: tk.v };
        case 'bool': return { k: 'lit', v: tk.v };
        case 'ref': return { k: 'ref', sheet: tk.sheet, col: tk.col, row: tk.row };
        case 'range': return { k: 'range', sheet: tk.sheet, c1: tk.c1, r1: tk.r1, c2: tk.c2, r2: tk.r2 };
        case '(': { const e = comparison(); if (!next() || toks[p - 1].type !== ')') throw ERR.PARSE; return e; }
        case 'name': {
          if (peek() && peek().type === '(') {
            next();
            const args = [];
            if (peek() && peek().type === ')') { next(); return { k: 'call', name: tk.v, args }; }
            for (;;) {
              if (peek() && (peek().type === ',' || peek().type === ')')) args.push({ k: 'lit', v: null });
              else args.push(comparison());
              const sep = next();
              if (!sep) throw ERR.PARSE;
              if (sep.type === ')') break;
              if (sep.type !== ',') throw ERR.PARSE;
            }
            return { k: 'call', name: tk.v, args };
          }
          return { k: 'name', v: tk.v };
        }
        case 'op':
          if (tk.v === '-') return { k: 'neg', e: unaryOperand() };
          if (tk.v === '+') return unaryOperand();
          throw ERR.PARSE;
        default: throw ERR.PARSE;
      }
    }
    function unaryOperand() { return postfix(); }
    function postfix() {
      let e = primary();
      while (isOp('%')) { next(); e = { k: 'pct', e }; }
      return e;
    }
    function power() {
      let e = postfix();
      while (isOp('^')) { next(); e = { k: 'bin', op: '^', a: e, b: postfix() }; }
      return e;
    }
    function mul() {
      let e = power();
      while (isOp('*') || isOp('/')) { const op = next().v; e = { k: 'bin', op, a: e, b: power() }; }
      return e;
    }
    function add() {
      let e = mul();
      while (isOp('+') || isOp('-')) { const op = next().v; e = { k: 'bin', op, a: e, b: mul() }; }
      return e;
    }
    function concat() {
      let e = add();
      while (isOp('&')) { next(); e = { k: 'bin', op: '&', a: e, b: add() }; }
      return e;
    }
    function comparison() {
      let e = concat();
      while (peek() && peek().type === 'op' && ['=', '<>', '<', '>', '<=', '>='].includes(peek().v)) {
        const op = next().v; e = { k: 'bin', op, a: e, b: concat() };
      }
      return e;
    }
    const ast = comparison();
    if (p !== toks.length) throw ERR.PARSE;
    return ast;
  }

  // ---------- coercion ----------
  function toNum(v) {
    if (isErr(v)) return v;
    if (v === null || v === undefined || v === '') return 0;
    if (typeof v === 'number') return v;
    if (typeof v === 'boolean') return v ? 1 : 0;
    const n = Number(String(v).trim());
    if (String(v).trim() !== '' && !Number.isNaN(n)) return n;
    return ERR.VALUE;
  }
  function toStr(v) {
    if (v === null || v === undefined) return '';
    if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
    if (typeof v === 'number') return formatNumber(v);
    return String(v);
  }
  function toBool(v) {
    if (isErr(v)) return v;
    if (typeof v === 'boolean') return v;
    if (typeof v === 'number') return v !== 0;
    if (v === null || v === undefined || v === '') return false;
    const s = String(v).toUpperCase();
    if (s === 'TRUE') return true;
    if (s === 'FALSE') return false;
    return ERR.VALUE;
  }
  function formatNumber(n) {
    if (!Number.isFinite(n)) return '#NUM!';
    if (Number.isInteger(n)) return String(n);
    return String(parseFloat(n.toPrecision(12)));
  }
  function flatten(args) {
    const out = [];
    for (const a of args) {
      if (Array.isArray(a)) for (const row of a) for (const v of row) out.push(v);
      else out.push(a);
    }
    return out;
  }
  // numbers from ranges (skip text/blank), direct args coerced
  function nums(args, rawArgs) {
    const out = [];
    args.forEach((a, i) => {
      if (Array.isArray(a)) {
        for (const row of a) for (const v of row) {
          if (isErr(v)) throw v;
          if (typeof v === 'number') out.push(v);
        }
      } else {
        if (a === null && rawArgs && rawArgs[i] && rawArgs[i].k === 'ref') return;
        const n = toNum(a);
        if (isErr(n)) throw n;
        out.push(n);
      }
    });
    return out;
  }

  // ---------- criteria (SUMIF/COUNTIF) ----------
  function makeCriteria(crit) {
    if (typeof crit === 'number' || typeof crit === 'boolean') return (v) => v === crit;
    const s = toStr(crit);
    const m = /^(<=|>=|<>|<|>|=)?(.*)$/.exec(s);
    const op = m[1] || '=';
    const rhs = m[2];
    const rn = rhs.trim() !== '' && !Number.isNaN(Number(rhs)) ? Number(rhs) : null;
    const wild = /[*?]/.test(rhs) ? new RegExp('^' + rhs.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.') + '$', 'i') : null;
    return (v) => {
      if (rn !== null && typeof v === 'number') {
        switch (op) {
          case '=': return v === rn; case '<>': return v !== rn; case '<': return v < rn;
          case '>': return v > rn; case '<=': return v <= rn; case '>=': return v >= rn;
        }
      }
      const vs = toStr(v).toLowerCase();
      const r = rhs.toLowerCase();
      switch (op) {
        case '=': return wild ? wild.test(toStr(v)) : vs === r;
        case '<>': return wild ? !wild.test(toStr(v)) : vs !== r;
        case '<': return vs < r; case '>': return vs > r; case '<=': return vs <= r; case '>=': return vs >= r;
      }
      return false;
    };
  }

  // ---------- dates (Excel-style serials, 1900 system) ----------
  const EPOCH = Date.UTC(1899, 11, 30);
  const dateToSerial = (y, m, d) => (Date.UTC(y, m - 1, d) - EPOCH) / 86400000;
  const serialToDate = (s) => new Date(EPOCH + Math.floor(s) * 86400000);

  function lookupEq(a, b) {
    if (typeof a === 'string' && typeof b === 'string') return a.toLowerCase() === b.toLowerCase();
    return a === b;
  }

  // ---------- functions ----------
  const FN = {
    SUM: (a, r) => nums(a, r).reduce((x, y) => x + y, 0),
    AVERAGE: (a, r) => { const n = nums(a, r); return n.length ? n.reduce((x, y) => x + y, 0) / n.length : ERR.DIV0; },
    MIN: (a, r) => { const n = nums(a, r); return n.length ? Math.min(...n) : 0; },
    MAX: (a, r) => { const n = nums(a, r); return n.length ? Math.max(...n) : 0; },
    MEDIAN: (a, r) => {
      const n = nums(a, r).sort((x, y) => x - y);
      if (!n.length) return ERR.NUM;
      const h = Math.floor(n.length / 2);
      return n.length % 2 ? n[h] : (n[h - 1] + n[h]) / 2;
    },
    STDEV: (a, r) => {
      const n = nums(a, r); if (n.length < 2) return ERR.DIV0;
      const m = n.reduce((x, y) => x + y, 0) / n.length;
      return Math.sqrt(n.reduce((s, x) => s + (x - m) ** 2, 0) / (n.length - 1));
    },
    COUNT: (a) => flatten(a).filter((v) => typeof v === 'number').length,
    COUNTA: (a) => flatten(a).filter((v) => v !== null && v !== '' && v !== undefined).length,
    COUNTBLANK: (a) => flatten(a).filter((v) => v === null || v === '' || v === undefined).length,
    PRODUCT: (a, r) => nums(a, r).reduce((x, y) => x * y, 1),
    ROUND: ([n, d]) => { n = toNum(n); d = toNum(d ?? 0); if (isErr(n)) return n; const f = 10 ** d; return Math.round((n + Number.EPSILON * Math.sign(n)) * f) / f; },
    ROUNDUP: ([n, d]) => { n = toNum(n); d = toNum(d ?? 0); const f = 10 ** d; return Math.sign(n) * Math.ceil(Math.abs(n) * f - 1e-9) / f; },
    ROUNDDOWN: ([n, d]) => { n = toNum(n); d = toNum(d ?? 0); const f = 10 ** d; return Math.sign(n) * Math.floor(Math.abs(n) * f + 1e-9) / f; },
    INT: ([n]) => { n = toNum(n); return isErr(n) ? n : Math.floor(n); },
    MOD: ([n, d]) => { n = toNum(n); d = toNum(d); if (isErr(n)) return n; if (isErr(d)) return d; if (d === 0) return ERR.DIV0; return n - d * Math.floor(n / d); },
    ABS: ([n]) => { n = toNum(n); return isErr(n) ? n : Math.abs(n); },
    SQRT: ([n]) => { n = toNum(n); if (isErr(n)) return n; return n < 0 ? ERR.NUM : Math.sqrt(n); },
    POWER: ([a, b]) => { a = toNum(a); b = toNum(b); if (isErr(a)) return a; if (isErr(b)) return b; return a ** b; },
    PI: () => Math.PI,
    CEILING: ([n, s]) => { n = toNum(n); s = toNum(s ?? 1); if (s === 0) return 0; return Math.ceil(n / s) * s; },
    FLOOR: ([n, s]) => { n = toNum(n); s = toNum(s ?? 1); if (s === 0) return ERR.DIV0; return Math.floor(n / s) * s; },
    RAND: () => Math.random(),
    RANDBETWEEN: ([a, b]) => { a = Math.ceil(toNum(a)); b = Math.floor(toNum(b)); return a + Math.floor(Math.random() * (b - a + 1)); },
    IF: ([c, t, f]) => { const b = toBool(c); if (isErr(b)) return b; return b ? (t === undefined ? true : t) : (f === undefined ? false : f); },
    IFERROR: ([v, alt]) => (isErr(v) ? alt : v),
    IFNA: ([v, alt]) => (v === ERR.NA ? alt : v),
    AND: (a) => { const v = flatten(a).filter((x) => x !== null && x !== ''); if (!v.length) return ERR.VALUE; for (const x of v) { const b = toBool(x); if (isErr(b)) return b; if (!b) return false; } return true; },
    OR: (a) => { const v = flatten(a).filter((x) => x !== null && x !== ''); if (!v.length) return ERR.VALUE; for (const x of v) { const b = toBool(x); if (isErr(b)) return b; if (b) return true; } return false; },
    XOR: (a) => flatten(a).filter((x) => toBool(x) === true).length % 2 === 1,
    NOT: ([v]) => { const b = toBool(v); return isErr(b) ? b : !b; },
    ISBLANK: ([v]) => v === null || v === undefined || v === '',
    ISNUMBER: ([v]) => typeof v === 'number',
    ISTEXT: ([v]) => typeof v === 'string' && v !== '',
    ISERROR: ([v]) => isErr(v),
    LEN: ([s]) => toStr(s).length,
    LEFT: ([s, n]) => toStr(s).slice(0, n === undefined ? 1 : toNum(n)),
    RIGHT: ([s, n]) => { const str = toStr(s); const k = n === undefined ? 1 : toNum(n); return k <= 0 ? '' : str.slice(-k); },
    MID: ([s, start, n]) => toStr(s).substr(toNum(start) - 1, toNum(n)),
    UPPER: ([s]) => toStr(s).toUpperCase(),
    LOWER: ([s]) => toStr(s).toLowerCase(),
    PROPER: ([s]) => toStr(s).toLowerCase().replace(/(^|[^a-z])([a-z])/g, (m, p, c) => p + c.toUpperCase()),
    TRIM: ([s]) => toStr(s).trim().replace(/\s+/g, ' '),
    CONCAT: (a) => flatten(a).map(toStr).join(''),
    CONCATENATE: (a) => flatten(a).map(toStr).join(''),
    TEXTJOIN: ([d, ignore, ...rest]) => flatten(rest).filter((v) => !(toBool(ignore) && (v === null || v === ''))).map(toStr).join(toStr(d)),
    SUBSTITUTE: ([s, from, to]) => toStr(s).split(toStr(from)).join(toStr(to)),
    REPT: ([s, n]) => toStr(s).repeat(Math.max(0, toNum(n))),
    FIND: ([needle, hay, start]) => { const i = toStr(hay).indexOf(toStr(needle), (start ? toNum(start) : 1) - 1); return i < 0 ? ERR.VALUE : i + 1; },
    SEARCH: ([needle, hay, start]) => { const i = toStr(hay).toLowerCase().indexOf(toStr(needle).toLowerCase(), (start ? toNum(start) : 1) - 1); return i < 0 ? ERR.VALUE : i + 1; },
    VALUE: ([s]) => toNum(s),
    TEXT: ([v, fmt]) => formatValue(v, toStr(fmt)),
    TODAY: () => { const d = new Date(); return dateToSerial(d.getFullYear(), d.getMonth() + 1, d.getDate()); },
    NOW: () => { const d = new Date(); return dateToSerial(d.getFullYear(), d.getMonth() + 1, d.getDate()) + (d.getHours() * 3600 + d.getMinutes() * 60 + d.getSeconds()) / 86400; },
    DATE: ([y, m, d]) => dateToSerial(toNum(y), toNum(m), toNum(d)),
    YEAR: ([s]) => serialToDate(toNum(s)).getUTCFullYear(),
    MONTH: ([s]) => serialToDate(toNum(s)).getUTCMonth() + 1,
    DAY: ([s]) => serialToDate(toNum(s)).getUTCDate(),
    WEEKDAY: ([s]) => serialToDate(toNum(s)).getUTCDay() + 1,
    DAYS: ([e, s]) => toNum(e) - toNum(s),
    EDATE: ([s, m]) => { const d = serialToDate(toNum(s)); return dateToSerial(d.getUTCFullYear(), d.getUTCMonth() + 1 + toNum(m), d.getUTCDate()); },
    VLOOKUP: ([key, table, col, approx]) => {
      if (!Array.isArray(table)) return ERR.VALUE;
      const c = toNum(col);
      if (c < 1 || c > (table[0] || []).length) return ERR.REF;
      const exact = approx !== undefined && approx !== null && toBool(approx) === false;
      if (exact) { for (const row of table) if (lookupEq(row[0], key)) return row[c - 1]; return ERR.NA; }
      let hit = null;
      for (const row of table) { if (row[0] === null) continue; if (row[0] <= key) hit = row; else break; }
      return hit ? hit[c - 1] : ERR.NA;
    },
    HLOOKUP: ([key, table, rowN, approx]) => {
      if (!Array.isArray(table)) return ERR.VALUE;
      const r = toNum(rowN);
      if (r < 1 || r > table.length) return ERR.REF;
      const exact = approx !== undefined && approx !== null && toBool(approx) === false;
      const head = table[0];
      if (exact) { const i = head.findIndex((v) => lookupEq(v, key)); return i < 0 ? ERR.NA : table[r - 1][i]; }
      let hit = -1;
      head.forEach((v, i) => { if (v !== null && v <= key) hit = i; });
      return hit < 0 ? ERR.NA : table[r - 1][hit];
    },
    XLOOKUP: ([key, look, ret, notFound]) => {
      if (!Array.isArray(look) || !Array.isArray(ret)) return ERR.VALUE;
      const lv = flatten([look]);
      const rv = flatten([ret]);
      const i = lv.findIndex((v) => lookupEq(v, key));
      if (i < 0) return notFound === undefined ? ERR.NA : notFound;
      return rv[i] === undefined ? ERR.NA : rv[i];
    },
    INDEX: ([table, r, c]) => {
      if (!Array.isArray(table)) return ERR.VALUE;
      let ri = toNum(r ?? 1), ci = toNum(c ?? 1);
      if (table.length === 1 && c === undefined) { ci = ri; ri = 1; }
      const row = table[ri - 1];
      if (!row || row[ci - 1] === undefined) return ERR.REF;
      return row[ci - 1];
    },
    MATCH: ([key, look, type]) => {
      const lv = flatten([look]);
      const t = type === undefined ? 1 : toNum(type);
      if (t === 0) { const i = lv.findIndex((v) => lookupEq(v, key)); return i < 0 ? ERR.NA : i + 1; }
      let hit = -1;
      lv.forEach((v, i) => { if (v !== null && (t > 0 ? v <= key : v >= key)) hit = i; });
      return hit < 0 ? ERR.NA : hit + 1;
    },
    SUMIF: ([range, crit, sumRange]) => {
      const test = makeCriteria(crit);
      const rv = flatten([range]); const sv = sumRange ? flatten([sumRange]) : rv;
      let s = 0; rv.forEach((v, i) => { if (test(v) && typeof sv[i] === 'number') s += sv[i]; });
      return s;
    },
    COUNTIF: ([range, crit]) => { const test = makeCriteria(crit); return flatten([range]).filter(test).length; },
    AVERAGEIF: ([range, crit, avgRange]) => {
      const test = makeCriteria(crit);
      const rv = flatten([range]); const av = avgRange ? flatten([avgRange]) : rv;
      const hits = []; rv.forEach((v, i) => { if (test(v) && typeof av[i] === 'number') hits.push(av[i]); });
      return hits.length ? hits.reduce((x, y) => x + y, 0) / hits.length : ERR.DIV0;
    },
    SUMIFS: ([sumRange, ...pairs]) => {
      const sv = flatten([sumRange]);
      const tests = [];
      for (let i = 0; i < pairs.length; i += 2) tests.push([flatten([pairs[i]]), makeCriteria(pairs[i + 1])]);
      let s = 0;
      sv.forEach((v, i) => { if (tests.every(([r, t]) => t(r[i])) && typeof v === 'number') s += v; });
      return s;
    },
    COUNTIFS: (pairs) => {
      const tests = [];
      for (let i = 0; i < pairs.length; i += 2) tests.push([flatten([pairs[i]]), makeCriteria(pairs[i + 1])]);
      if (!tests.length) return 0;
      return tests[0][0].filter((_, i) => tests.every(([r, t]) => t(r[i]))).length;
    },
    PMT: ([rate, nper, pv, fv, type]) => {
      rate = toNum(rate); nper = toNum(nper); pv = toNum(pv); fv = toNum(fv ?? 0); type = toNum(type ?? 0);
      if (rate === 0) return -(pv + fv) / nper;
      const f = (1 + rate) ** nper;
      return -(rate * (pv * f + fv)) / ((1 + rate * type) * (f - 1));
    },
    FV: ([rate, nper, pmt, pv, type]) => {
      rate = toNum(rate); nper = toNum(nper); pmt = toNum(pmt); pv = toNum(pv ?? 0); type = toNum(type ?? 0);
      if (rate === 0) return -(pv + pmt * nper);
      const f = (1 + rate) ** nper;
      return -(pv * f + pmt * (1 + rate * type) * (f - 1) / rate);
    },
    NPV: ([rate, ...rest]) => { rate = toNum(rate); return nums(rest).reduce((s, v, i) => s + v / (1 + rate) ** (i + 1), 0); },
  };
  const FUNCTION_NAMES = Object.keys(FN).sort();
  const LAZY = new Set(['IF', 'IFERROR', 'IFNA']);

  function formatValue(v, fmt) {
    const n = toNum(v);
    if (isErr(n)) return toStr(v);
    if (/^0(\.0+)?%$/.test(fmt)) { const d = (fmt.split('.')[1] || '%').length - 1; return (n * 100).toFixed(d) + '%'; }
    if (/^\$?#,##0(\.0+)?$/.test(fmt)) {
      const d = fmt.includes('.') ? fmt.split('.')[1].length : 0;
      return (fmt.startsWith('$') ? '$' : '') + n.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
    }
    if (/^0(\.0+)?$/.test(fmt)) return n.toFixed(fmt.includes('.') ? fmt.split('.')[1].length : 0);
    if (/^(yyyy-mm-dd|mm\/dd\/yyyy|m\/d\/yyyy)$/i.test(fmt)) {
      const d = serialToDate(n);
      const y = d.getUTCFullYear(), m = d.getUTCMonth() + 1, dd = d.getUTCDate();
      const p = (x) => String(x).padStart(2, '0');
      if (/^yyyy/i.test(fmt)) return `${y}-${p(m)}-${p(dd)}`;
      if (/^mm/i.test(fmt)) return `${p(m)}/${p(dd)}/${y}`;
      return `${m}/${dd}/${y}`;
    }
    return toStr(v);
  }

  // ---------- literal parsing ----------
  function parseLiteral(raw) {
    if (raw === null || raw === undefined) return null;
    const s = String(raw);
    if (s === '') return null;
    const t = s.trim();
    if (/^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/.test(t)) return parseFloat(t);
    if (/^[-+]?\d+(\.\d+)?%$/.test(t)) return parseFloat(t) / 100;
    if (/^\$-?[\d,]+(\.\d+)?$/.test(t)) return parseFloat(t.replace(/[$,]/g, ''));
    const up = t.toUpperCase();
    if (up === 'TRUE') return true;
    if (up === 'FALSE') return false;
    return s;
  }

  // ---------- workbook ----------
  class Workbook {
    constructor(data) {
      this.sheets = (data && data.sheets && data.sheets.length ? data.sheets : [{ name: 'Sheet1', cells: {} }])
        .map((s) => ({ name: s.name, cells: { ...(s.cells || {}) } }));
      this.astCache = new Map();
      this.values = new Map();
    }
    sheetIndex(name) {
      if (name === null || name === undefined) return null;
      const i = this.sheets.findIndex((s) => s.name.toLowerCase() === String(name).toLowerCase());
      return i;
    }
    setCell(sheetIdx, a, raw) {
      const cells = this.sheets[sheetIdx].cells;
      if (raw === '' || raw === null || raw === undefined) delete cells[a.toUpperCase()];
      else cells[a.toUpperCase()] = String(raw);
      this.values.clear();
    }
    getRaw(sheetIdx, a) { return this.sheets[sheetIdx].cells[a.toUpperCase()]; }
    getValue(sheetIdx, a) { return this._eval(sheetIdx, a.toUpperCase(), new Set()); }
    getDisplay(sheetIdx, a) {
      const v = this.getValue(sheetIdx, a);
      if (isErr(v)) return v.code;
      if (Array.isArray(v)) return toStr(v[0] && v[0][0]);
      return toStr(v);
    }
    recalc() { this.values.clear(); }
    _eval(si, a, visiting) {
      const key = si + '!' + a;
      if (this.values.has(key)) return this.values.get(key);
      const raw = this.sheets[si].cells[a];
      let v;
      if (raw === undefined) v = null;
      else if (typeof raw === 'string' && raw.startsWith('=') && raw.length > 1) {
        if (visiting.has(key)) return ERR.CIRC;
        visiting.add(key);
        try {
          let ast = this.astCache.get(raw);
          if (!ast) { ast = parse(raw.slice(1)); this.astCache.set(raw, ast); }
          v = this._evalNode(ast, si, visiting);
          if (Array.isArray(v)) v = v[0] ? v[0][0] : null;
          if (v === null) v = 0;
          if (typeof v === 'number' && !Number.isFinite(v)) v = ERR.NUM;
        } catch (e) {
          v = isErr(e) ? e : ERR.PARSE;
        }
        visiting.delete(key);
      } else v = parseLiteral(raw);
      this.values.set(key, v);
      return v;
    }
    _evalNode(n, si, visiting) {
      switch (n.k) {
        case 'lit': return n.v;
        case 'ref': {
          const s = n.sheet === null ? si : this.sheetIndex(n.sheet);
          if (s < 0) return ERR.REF;
          return this._eval(s, addr(n.col, n.row), visiting);
        }
        case 'range': {
          const s = n.sheet === null ? si : this.sheetIndex(n.sheet);
          if (s < 0) return ERR.REF;
          if ((n.r2 - n.r1 + 1) * (n.c2 - n.c1 + 1) > 2_000_000) return ERR.REF;
          const out = [];
          for (let r = n.r1; r <= n.r2; r++) {
            const row = [];
            for (let c = n.c1; c <= n.c2; c++) row.push(this._eval(s, addr(c, r), visiting));
            out.push(row);
          }
          return out;
        }
        case 'name': return ERR.NAME;
        case 'neg': { const v = toNum(this._scalar(n.e, si, visiting)); return isErr(v) ? v : -v; }
        case 'pct': { const v = toNum(this._scalar(n.e, si, visiting)); return isErr(v) ? v : v / 100; }
        case 'bin': {
          const a = this._scalar(n.a, si, visiting);
          const b = this._scalar(n.b, si, visiting);
          if (isErr(a)) return a;
          if (isErr(b)) return b;
          if (n.op === '&') return toStr(a) + toStr(b);
          if (['=', '<>', '<', '>', '<=', '>='].includes(n.op)) return compare(a, b, n.op);
          const x = toNum(a), y = toNum(b);
          if (isErr(x)) return x;
          if (isErr(y)) return y;
          switch (n.op) {
            case '+': return x + y; case '-': return x - y; case '*': return x * y;
            case '/': return y === 0 ? ERR.DIV0 : x / y;
            case '^': return x ** y;
          }
          return ERR.VALUE;
        }
        case 'call': {
          const f = FN[n.name];
          if (!f) return ERR.NAME;
          if (LAZY.has(n.name)) {
            const first = this._evalNode(n.args[0] || { k: 'lit', v: null }, si, visiting);
            const sc = Array.isArray(first) ? (first[0] ? first[0][0] : null) : first;
            if (n.name === 'IF') {
              const b = toBool(sc);
              if (isErr(b)) return b;
              const branch = b ? n.args[1] : n.args[2];
              if (!branch) return b;
              return this._evalNode(branch, si, visiting);
            }
            if (n.name === 'IFERROR' ? isErr(sc) : sc === ERR.NA) return n.args[1] ? this._evalNode(n.args[1], si, visiting) : 0;
            return sc;
          }
          const args = n.args.map((a) => this._evalNode(a, si, visiting));
          const propagate = !['IFERROR', 'ISERROR', 'COUNT', 'COUNTA', 'COUNTBLANK', 'ISBLANK', 'ISNUMBER', 'ISTEXT'].includes(n.name);
          if (propagate) for (const a of args) if (isErr(a)) return a;
          try { return f(args, n.args); } catch (e) { if (isErr(e)) return e; return ERR.VALUE; }
        }
      }
      return ERR.VALUE;
    }
    _scalar(n, si, visiting) {
      const v = this._evalNode(n, si, visiting);
      if (Array.isArray(v)) return v.length === 1 && v[0].length === 1 ? v[0][0] : ERR.VALUE;
      return v;
    }
    toJSON() { return { sheets: this.sheets.map((s) => ({ name: s.name, cells: s.cells })) }; }
  }

  function compare(a, b, op) {
    let x = a, y = b;
    if (typeof x === 'string' && typeof y === 'string') { x = x.toLowerCase(); y = y.toLowerCase(); }
    if (x === null) x = typeof y === 'string' ? '' : 0;
    if (y === null) y = typeof x === 'string' ? '' : 0;
    if (typeof x !== typeof y) {
      // numbers < text < booleans (spreadsheet convention)
      const rank = (v) => (typeof v === 'number' ? 0 : typeof v === 'string' ? 1 : 2);
      x = rank(x); y = rank(y);
    }
    switch (op) {
      case '=': return x === y; case '<>': return x !== y; case '<': return x < y;
      case '>': return x > y; case '<=': return x <= y; case '>=': return x >= y;
    }
    return false;
  }

  /** Shift relative references in a formula when it is copied by (dc, dr). */
  // With `st` ({rowAt,rowN} or {colAt,colN}) it moves references for an inserted or deleted row or column instead.
  function shiftFormula(raw, dc, dr, st) {
    if (typeof raw !== 'string' || !raw.startsWith('=')) return raw;
    let out = '';
    let i = 0;
    const s = raw;
    while (i < s.length) {
      if (s[i] === '"') { const j = s.indexOf('"', i + 1); const end = j < 0 ? s.length : j + 1; out += s.slice(i, end); i = end; continue; }
      const m = /^(\$?)([A-Za-z]{1,3})(\$?)(\d{1,7})(?![A-Za-z0-9_(])/.exec(s.slice(i));
      const prev = s[i - 1];
      if (m && !(prev && /[A-Za-z0-9_]/.test(prev))) {
        let col = colToNum(m[2]), row = parseInt(m[4], 10);
        let gone = false;
        if (st) {
          const move = (v, at, n) => { if (n < 0 && v >= at && v < at - n) { gone = true; return v; } return v >= at ? v + n : v; };
          if (st.rowAt) row = move(row, st.rowAt, st.rowN);
          if (st.colAt) col = move(col, st.colAt, st.colN);
        } else {
          if (!m[1]) col += dc;
          if (!m[3]) row += dr;
        }
        out += gone || col < 1 || row < 1 ? '#REF!' : `${m[1]}${numToCol(col)}${m[3]}${row}`;
        i += m[0].length; continue;
      }
      out += s[i++];
    }
    return out;
  }

  return { Workbook, parse, tokenize, colToNum, numToCol, parseAddr, addr, isErr, ERR, FUNCTION_NAMES, formatValue, shiftFormula, parseLiteral, dateToSerial };
});
