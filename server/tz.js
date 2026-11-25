'use strict';
// Wall-clock time in a named time zone (like America/New_York), using only the built-in Intl data.
// Repeating calendar events are worked out in the organizer's own zone, so "every weekday at 8 PM"
// stays on Monday to Friday at 8 PM there, across daylight saving changes.

const fmts = new Map();
function fmt(tz) {
  let f = fmts.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric' });
    fmts.set(tz, f);
  }
  return f;
}

/** True when tz is a time zone name this server knows. */
function validTz(tz) {
  if (typeof tz !== 'string' || !tz || tz.length > 64) return false;
  try { fmt(tz); return true; } catch { return false; }
}

/** The wall-clock date and time at ms in tz. Month is 1 to 12. */
function parts(ms, tz) {
  const o = {};
  for (const p of fmt(tz).formatToParts(new Date(ms))) if (p.type !== 'literal') o[p.type] = +p.value;
  return { y: o.year, m: o.month, d: o.day, h: o.hour, mi: o.minute, s: o.second, ms: ((ms % 1000) + 1000) % 1000 };
}

/** How far tz is ahead of UTC at ms, in milliseconds. */
function offset(ms, tz) {
  const p = parts(ms, tz);
  return Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi, p.s, p.ms) - ms;
}

/** The moment that a wall-clock date and time in tz falls on. Month is 1 to 12; day may run past the month's end. */
function toMs(y, m, d, h, mi, s, msPart, tz) {
  const guess = Date.UTC(y, m - 1, d, h, mi, s, msPart);
  let t = guess - offset(guess, tz);
  const o2 = offset(t, tz);
  if (guess - o2 !== t) t = guess - o2; // the guess landed on the other side of a daylight saving change
  return t;
}

const daysInMonth = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();
/** 0 is Sunday, as in Date.getUTCDay. */
const weekday = (y, m, d) => new Date(Date.UTC(y, m - 1, d)).getUTCDay();

module.exports = { validTz, parts, offset, toMs, daysInMonth, weekday };
