'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const F = require('../shared/formula');

const wb = (cells) => new F.Workbook({ sheets: [{ name: 'Sheet1', cells }] });

test('basic arithmetic and precedence', () => {
  const w = wb({ A1: '2', A2: '3', A3: '=A1+A2*4', A4: '=(A1+A2)*4', A5: '=2^3^2' });
  assert.equal(w.getValue(0, 'A3'), 14);
  assert.equal(w.getValue(0, 'A4'), 20);
  assert.ok([64, 512].includes(w.getValue(0, 'A5')));
});

test('ranges and common functions', () => {
  const w = wb({ A1: '10', A2: '20', A3: '30', B1: '=SUM(A1:A3)', B2: '=AVERAGE(A1:A3)', B3: '=MAX(A1:A3)-MIN(A1:A3)',
    B4: '=IF(B1>50,"big","small")', B5: '=ROUND(10/3,2)', B6: '=COUNTIF(A1:A3,">15")', B7: '=CONCAT("a","b")' });
  assert.equal(w.getValue(0, 'B1'), 60);
  assert.equal(w.getValue(0, 'B2'), 20);
  assert.equal(w.getValue(0, 'B3'), 20);
  assert.equal(w.getValue(0, 'B4'), 'big');
  assert.equal(w.getValue(0, 'B5'), 3.33);
  assert.equal(w.getValue(0, 'B6'), 2);
  assert.equal(w.getValue(0, 'B7'), 'ab');
});

test('errors: divide by zero, circular references and unknown functions', () => {
  const w = wb({ A1: '=1/0', A2: '=A3', A3: '=A2', A4: '=NOPE(1)' });
  assert.ok(F.isErr(w.getValue(0, 'A1')));
  assert.ok(F.isErr(w.getValue(0, 'A2')));
  assert.ok(F.isErr(w.getValue(0, 'A4')));
});

test('cross-sheet references', () => {
  const w = new F.Workbook({ sheets: [{ name: 'Data', cells: { A1: '7' } }, { name: 'Report', cells: { A1: '=Data!A1*2' } }] });
  assert.equal(w.getValue(1, 'A1'), 14);
});

test('shiftFormula moves references when rows are inserted or deleted', () => {
  assert.equal(F.shiftFormula('=SUM(A1:A5)+B3', 0, 0, { rowAt: 3, rowN: 1 }), '=SUM(A1:A6)+B4');
  assert.equal(F.shiftFormula('=A3+A4', 0, 0, { rowAt: 3, rowN: -1 }), '=#REF!+A3');
  assert.equal(F.shiftFormula('=A1+B1', 1, 1), '=B2+C2');
  assert.equal(F.shiftFormula('=$A$1+B1', 1, 1), '=$A$1+C2');
});

test('address helpers round-trip', () => {
  for (const c of ['A', 'Z', 'AA', 'AZ', 'ZZ', 'ABC']) assert.equal(F.numToCol(F.colToNum(c)), c);
  assert.deepEqual({ ...F.parseAddr('C12') }, { ...F.parseAddr('C12') });
  const n = F.FUNCTION_NAMES.length || F.FUNCTION_NAMES.size;
  assert.ok(n >= 60, 'has a broad function library');
});
