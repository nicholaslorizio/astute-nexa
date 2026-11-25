/* Cadence: calendar with week and month views, invites, free/busy and .ics import and export. */
'use strict';
(function () {
  const { h, $, $$, clear, icon, api, toast, fail, modal, avatar, confirmBox, download, pickFile } = Nexa;
  const HOUR = 3600000, DAY = 86400000;
  const COLORS = ['#EC4899', '#7C5CFF', '#3B82F6', '#10B981', '#F59E0B', '#FF6B4A', '#14B8D4', '#64748B'];
  const PX = 48; // pixels per hour in week view
  let C = null;

  const startOfDay = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
  const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
  const startOfWeek = (d) => addDays(startOfDay(d), -new Date(d).getDay());
  const sameDay = (a, b) => new Date(a).toDateString() === new Date(b).toDateString();
  const hm = (t) => new Date(t).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const pad = (n) => String(n).padStart(2, '0');
  const dateVal = (t) => { const d = new Date(t); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
  const timeVal = (t) => { const d = new Date(t); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
  // This device's time zone, so repeating events keep their local weekday and hour.
  const TZ = (() => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch { return ''; } })();
  const tzq = TZ ? '&tz=' + encodeURIComponent(TZ) : '';
  const parseLocal = (date, time) => new Date(`${date}T${time || '00:00'}`).getTime();

  async function open(q) {
    const view = Nexa.shell('cadence');
    if (!Nexa.state.users.length) Nexa.state.users = (await api.get('/api/users')).users;
    const head = h('header', { class: 'c-head' });
    const side = h('aside', { class: 'c-side' });
    const main = h('div', { class: 'week' });
    view.append(h('div', { class: 'cadence' }, head, h('div', { class: 'c-body' }, side, main)));
    C = { mode: (q && q.mode) || (innerWidth < 700 ? 'day' : 'week'), cursor: new Date(), head, side, main, events: [], pending: [] };
    await load();
    const reload = () => C && load();
    const offs = ['event.invite', 'event.rsvp', 'event.cancelled'].map((t) => Nexa.rt.on(t, (m) => {
      reload();
      if (t === 'event.invite') toast(`${m.from} invited you to ${m.title}`);
      if (t === 'event.rsvp') toast(`${m.from} ${m.response} ${m.title}`);
      if (t === 'event.cancelled') toast(`${m.title} was cancelled`);
    }));
    const tick = setInterval(() => C && C.mode !== 'month' && drawNow(), 60000);
    return { leave: () => { offs.forEach((f) => f()); clearInterval(tick); C = null; } };
  }

  function range() {
    if (C.mode === 'month') { const f = new Date(C.cursor.getFullYear(), C.cursor.getMonth(), 1); const s = startOfWeek(f); return [s, addDays(s, 42)]; }
    if (C.mode === 'day') { const s = startOfDay(C.cursor); return [s, addDays(s, 1)]; }
    const s = startOfWeek(C.cursor); return [s, addDays(s, 7)];
  }
  async function load() {
    const [from, to] = range();
    try { const r = await api.get(`/api/events?from=${from.getTime()}&to=${to.getTime()}${tzq}`); C.events = r.events; C.pending = r.pending; } catch (e) { fail(e); }
    if (!C) return;
    drawHead(); drawSide(); C.mode === 'month' ? drawMonth() : drawWeek();
  }
  function move(dir) {
    if (dir === 0) C.cursor = new Date();
    else if (C.mode === 'month') C.cursor = new Date(C.cursor.getFullYear(), C.cursor.getMonth() + dir, 1);
    else C.cursor = addDays(C.cursor, dir * (C.mode === 'day' ? 1 : 7));
    load();
  }

  function drawHead() {
    const [from, to] = range();
    const label = C.mode === 'month' ? C.cursor.toLocaleDateString([], { month: 'long', year: 'numeric' })
      : C.mode === 'day' ? C.cursor.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' })
        : `${from.toLocaleDateString([], { month: 'short', day: 'numeric' })} – ${addDays(to, -1).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })}`;
    const seg = h('div', { class: 'seg' }, ['day', 'week', 'month'].map((m) => h('button', { class: C.mode === m ? 'on' : '', onclick: () => { C.mode = m; load(); } }, m[0].toUpperCase() + m.slice(1))));
    clear(C.head).append(
      h('button', { class: 'btn primary', onclick: () => newEvent() }, icon('plus', 16), 'New event'),
      h('button', { class: 'btn', onclick: () => move(0) }, 'Today'),
      h('button', { class: 'btn ghost icon', 'aria-label': 'Previous', onclick: () => move(-1) }, icon('chevL')),
      h('button', { class: 'btn ghost icon', 'aria-label': 'Next', onclick: () => move(1) }, icon('chevR')),
      h('h2', {}, label), h('span', { class: 'grow' }), seg);
  }

  function drawSide() {
    const cur = C.cursor;
    const first = new Date(cur.getFullYear(), cur.getMonth(), 1);
    const s = startOfWeek(first);
    const mini = h('div', { class: 'mini-cal' }, ['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((d) => h('span', { class: 'muted' }, d)));
    for (let i = 0; i < 42; i++) {
      const d = addDays(s, i);
      mini.append(h('button', { class: (sameDay(d, Date.now()) ? 'today ' : '') + (d.getMonth() !== cur.getMonth() ? 'other' : ''), onclick: () => { C.cursor = d; if (C.mode === 'month') C.mode = 'week'; load(); } }, d.getDate()));
    }
    const pend = C.pending.map((e) => h('div', { class: 'card', style: { padding: '10px', marginBottom: '8px' } },
      h('b', { class: 'ellipsis', style: { display: 'block' } }, e.title), h('div', { class: 'muted small' }, `${new Date(e.start_at).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })} · ${hm(e.start_at)}`),
      h('div', { class: 'muted small' }, 'From ' + e.owner_name),
      h('div', { class: 'row', style: { marginTop: '6px', gap: '4px' } }, rsvpBtns(e))));
    clear(C.side).append(
      h('div', { class: 'row', style: { marginBottom: '6px' } }, h('b', { class: 'grow' }, cur.toLocaleDateString([], { month: 'long', year: 'numeric' }))),
      mini,
      C.pending.length ? h('div', {}, h('div', { class: 'sect', style: { padding: '0 0 6px' } }, `Invites (${C.pending.length})`), pend) : null,
      h('div', { class: 'sect', style: { padding: '10px 0 6px' } }, 'Calendar file'),
      h('button', { class: 'btn sm', style: { width: '100%', marginBottom: '6px' }, onclick: importIcs }, icon('upload', 14), 'Import .ics'),
      h('button', { class: 'btn sm', style: { width: '100%' }, onclick: () => download('/api/calendar.ics') }, icon('download', 14), 'Export my calendar'),
      h('p', { class: 'muted small', style: { lineHeight: 1.5 } }, 'Bring events over from Outlook, Google Calendar or Apple Calendar by exporting an .ics file there and importing it here.'));
  }
  function rsvpBtns(e, after) {
    return [['accepted', 'Yes'], ['tentative', 'Maybe'], ['declined', 'No']].map(([r, l]) => h('button', { class: 'btn sm' + (e.my_response === r ? ' primary' : ''), type: 'button', onclick: async () => {
      try { await api.post(`/api/events/${e.id}/rsvp`, { response: r }); toast(r === 'accepted' ? 'Accepted' : r === 'declined' ? 'Declined' : 'Marked as maybe'); after && after(); load(); } catch (err) { fail(err); }
    } }, l));
  }
  async function importIcs() {
    const [f] = await pickFile('.ics,text/calendar');
    if (!f) return;
    try { const r = await api.post('/api/calendar/import', { ics: await f.text() }); toast(`Imported ${r.imported} event${r.imported === 1 ? '' : 's'}`); load(); } catch (e) { fail(e); }
  }

  function evColor(e) { return e.color || 'var(--cadence)'; }
  function drawWeek() {
    C.main.className = 'week';
    const [from] = range();
    const n = C.mode === 'day' ? 1 : 7;
    const cols = `56px repeat(${n}, 1fr)`;
    const days = Array.from({ length: n }, (_, i) => addDays(from, i));
    const head = h('div', { class: 'week-head', style: { gridTemplateColumns: cols } }, h('div'), days.map((d) => h('div', { class: sameDay(d, Date.now()) ? 'today' : '' }, d.toLocaleDateString([], { weekday: 'short' }), h('b', {}, d.getDate()))));
    const allDay = h('div', { class: 'week-head', style: { gridTemplateColumns: cols, top: '62px' } }, h('div', { class: 'muted small' }, 'all day'), days.map((d) => h('div', { style: { padding: '2px' } },
      C.events.filter((e) => e.all_day && e.start_at < addDays(d, 1).getTime() && e.end_at >= d.getTime()).map((e) => h('div', { class: 'chip', style: { background: evColor(e), color: '#fff', borderRadius: '5px', padding: '1px 6px', fontSize: '11px', cursor: 'pointer', textAlign: 'left' }, onclick: () => details(e) }, e.title)))));
    const grid = h('div', { class: 'week-grid', style: { gridTemplateColumns: cols } });
    grid.append(h('div', {}, Array.from({ length: 24 }, (_, i) => h('div', { class: 'hour-label' }, i ? new Date(2000, 0, 1, i).toLocaleTimeString([], { hour: 'numeric' }) : ''))));
    for (const d of days) {
      const col = h('div', { class: 'day-col', 'data-day': d.getTime() }, Array.from({ length: 48 }, (_, i) => h('div', { class: 'slot', style: { height: PX / 2 + 'px' }, onclick: () => {
        const s = d.getTime() + i * HOUR / 2; newEvent({ start_at: s, end_at: s + HOUR });
      } })));
      const evs = C.events.filter((e) => !e.all_day && e.start_at < addDays(d, 1).getTime() && e.end_at > d.getTime());
      layout(evs).forEach(({ e, lane, lanes }) => {
        const s = Math.max(e.start_at, d.getTime()), en = Math.min(e.end_at, addDays(d, 1).getTime());
        const top = (s - d.getTime()) / HOUR * PX, height = Math.max(20, (en - s) / HOUR * PX - 2);
        col.append(h('div', { class: 'ev' + (e.my_response === 'pending' ? ' pending' : ''), style: { top: top + 'px', height: height + 'px', background: evColor(e), left: `calc(${lane / lanes * 100}% + 3px)`, width: `calc(${100 / lanes}% - 6px)`, right: 'auto', opacity: e.my_response === 'declined' ? 0.5 : 1 },
          onclick: (ev) => { ev.stopPropagation(); details(e); } }, h('b', { class: 'ellipsis' }, e.title), height > 34 ? h('span', {}, `${hm(e.start_at)} – ${hm(e.end_at)}`) : null, e.huddle && height > 50 ? h('div', {}, icon('video', 12), ' Huddle call') : null));
      });
      grid.append(col);
    }
    clear(C.main).append(head, allDay, grid);
    drawNow();
    const now = new Date();
    C.main.scrollTop = Math.max(0, (days.some((d) => sameDay(d, now)) ? now.getHours() - 2 : 7) * PX);
  }
  // Puts overlapping events side by side.
  function layout(evs) {
    const sorted = [...evs].sort((a, b) => a.start_at - b.start_at || b.end_at - a.end_at);
    const out = []; let group = [], groupEnd = 0;
    const flush = () => { const lanes = Math.max(1, ...group.map((g) => g.lane + 1)); group.forEach((g) => { g.lanes = lanes; out.push(g); }); group = []; };
    for (const e of sorted) {
      if (group.length && e.start_at >= groupEnd) flush();
      const used = new Set(group.filter((g) => g.e.end_at > e.start_at).map((g) => g.lane));
      let lane = 0; while (used.has(lane)) lane++;
      group.push({ e, lane }); groupEnd = Math.max(groupEnd, e.end_at);
    }
    flush();
    return out;
  }
  function drawNow() {
    $$('.now-line', C.main).forEach((n) => n.remove());
    const col = $$('.day-col', C.main).find((c) => sameDay(+c.dataset.day, Date.now()));
    if (!col) return;
    const n = new Date();
    col.append(h('div', { class: 'now-line', style: { top: (n.getHours() + n.getMinutes() / 60) * PX + 'px' } }));
  }

  function drawMonth() {
    C.main.className = 'month';
    const [from] = range();
    clear(C.main);
    for (const d of ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']) C.main.append(h('div', { class: 'muted small', style: { padding: '6px', borderBottom: '1px solid var(--line)', fontWeight: 650 } }, d));
    for (let i = 0; i < 42; i++) {
      const d = addDays(from, i);
      const evs = C.events.filter((e) => e.start_at < addDays(d, 1).getTime() && e.end_at >= d.getTime() && (e.all_day || e.end_at > d.getTime()));
      C.main.append(h('div', { class: 'cell' + (d.getMonth() !== C.cursor.getMonth() ? ' other' : ''), onclick: (ev) => { if (ev.target === ev.currentTarget || ev.target.classList.contains('d')) { const s = d.getTime() + 9 * HOUR; newEvent({ start_at: s, end_at: s + HOUR }); } } },
        h('div', { class: 'd', style: sameDay(d, Date.now()) ? { color: 'var(--cadence)' } : {} }, d.getDate()),
        evs.slice(0, 3).map((e) => h('div', { class: 'chip', style: { background: evColor(e) }, onclick: () => details(e) }, (e.all_day ? '' : hm(e.start_at) + ' ') + e.title)),
        evs.length > 3 ? h('div', { class: 'muted small', style: { cursor: 'pointer' }, onclick: () => { C.cursor = d; C.mode = 'day'; load(); } }, `+${evs.length - 3} more`) : null));
    }
  }

  function details(e) {
    const people = e.attendees.map((a) => h('div', { class: 'person', style: { padding: '6px 0' } }, avatar({ id: a.user_id || a.addr, name: a.name || a.addr }, 'sm'),
      h('div', { class: 'grow' }, a.name || a.addr, h('div', { class: 'muted small' }, a.addr)),
      h('span', { class: 'pill', style: { color: a.response === 'accepted' ? 'var(--ok)' : a.response === 'declined' ? 'var(--bad)' : 'var(--text-3)' } }, { accepted: 'Going', declined: 'Not going', tentative: 'Maybe', pending: 'No reply yet' }[a.response] || a.response)));
    const when = e.all_day ? new Date(e.start_at).toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' }) + ' (all day)'
      : `${new Date(e.start_at).toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' })}, ${hm(e.start_at)} – ${hm(e.end_at)}`;
    modal({ title: e.title, body: [
      h('div', { class: 'row' }, h('span', { style: { width: '12px', height: '12px', borderRadius: '4px', background: evColor(e) } }), h('b', {}, when)),
      e.recurrence !== 'none' ? h('div', { class: 'muted small' }, 'Repeats ' + { daily: 'every day', weekdays: 'every weekday', weekly: 'every week', monthly: 'every month' }[e.recurrence]) : null,
      e.location ? h('div', {}, icon('folder', 14), ' ', e.location) : null,
      e.description ? h('p', { style: { whiteSpace: 'pre-wrap', margin: 0 } }, e.description) : null,
      h('div', { class: 'muted small' }, 'Organizer: ' + (e.owner_name || 'Unknown')),
      e.attendees.length ? h('div', {}, h('b', { class: 'small' }, `${e.attendees.length} guest${e.attendees.length === 1 ? '' : 's'}`), people) : null,
      e.my_response && e.my_response !== 'owner' ? h('div', { class: 'row' }, h('span', { class: 'muted small grow' }, 'Going?'), rsvpBtns(e, () => $$('.scrim').forEach((s) => s.remove()))) : null,
    ], actions: [
      e.huddle ? { label: 'Join Huddle call', kind: 'primary', onClick: () => joinCall(e) } : null,
      { label: 'Download .ics', onClick: () => { download(`/api/events/${e.id}/ics`); return false; } },
      e.can_edit ? { label: 'Delete', kind: 'danger', onClick: async () => { if (!(await confirmBox('Cancel this event?', e.attendees.length ? 'Guests will be told it was cancelled.' : 'It will be removed from your calendar.', 'Cancel event', true))) return false; await api.del('/api/events/' + e.id).catch(fail); load(); } } : null,
      e.can_edit ? { label: 'Edit', kind: e.huddle ? '' : 'primary', onClick: () => editor(e) } : { label: 'Close' },
    ].filter(Boolean) });
  }
  async function joinCall(e) {
    const ids = [...new Set([e.owner_id, ...e.attendees.map((a) => a.user_id)].filter((x) => x && x !== Nexa.state.user.id))];
    try {
      const r = await api.post('/api/dm', { user_ids: ids.length ? ids : [Nexa.state.user.id] });
      Nexa.router.go('#/huddle/' + r.channel.id);
      setTimeout(() => Nexa.call.start(r.channel.id, e.title, true), 400);
    } catch (err) { fail(err); }
  }

  function newEvent(init = {}) {
    const s = init.start_at || (() => { const d = new Date(); d.setMinutes(0, 0, 0); return d.getTime() + HOUR; })();
    editor({ title: init.title || '', start_at: s, end_at: init.end_at || s + HOUR, all_day: false, recurrence: 'none', description: '', location: '', color: COLORS[0], huddle: !!init.huddle, attendees: [] });
  }
  function editor(e) {
    const title = h('input', { class: 'input', value: e.title, placeholder: 'Add a title', required: true });
    const date = h('input', { class: 'input', type: 'date', value: dateVal(e.start_at) });
    const start = h('input', { class: 'input', type: 'time', value: timeVal(e.start_at), step: 300 });
    const endDate = h('input', { class: 'input', type: 'date', value: dateVal(e.end_at) });
    const end = h('input', { class: 'input', type: 'time', value: timeVal(e.end_at), step: 300 });
    const allDay = h('input', { type: 'checkbox', checked: e.all_day });
    const rec = h('select', { class: 'select' }, [['none', 'Does not repeat'], ['daily', 'Every day'], ['weekdays', 'Every weekday'], ['weekly', 'Every week'], ['monthly', 'Every month']].map(([v, l]) => h('option', { value: v }, l)));
    rec.value = e.recurrence || 'none';
    const loc = h('input', { class: 'input', value: e.location || '', placeholder: 'Room, address or link' });
    const desc = h('textarea', { class: 'input', rows: 3, placeholder: 'Agenda or notes' }, e.description || '');
    const huddle = h('input', { type: 'checkbox', checked: e.huddle });
    const guests = h('input', { class: 'input', list: 'nexa-people', value: e.attendees.map((a) => a.addr).join(', '), placeholder: 'Emails, separated by commas' });
    const dl = h('datalist', { id: 'nexa-people' }, Nexa.state.users.filter((u) => u.id !== Nexa.state.user.id).map((u) => h('option', { value: u.email }, u.name)));
    let color = e.color || COLORS[0];
    const swatches = h('div', { class: 'row', style: { gap: '6px' } });
    const drawSw = () => { clear(swatches); COLORS.forEach((c) => swatches.append(h('button', { type: 'button', 'aria-label': 'Color', style: { width: '22px', height: '22px', borderRadius: '50%', border: c === color ? '3px solid var(--text)' : '2px solid transparent', background: c, cursor: 'pointer' }, onclick: () => { color = c; drawSw(); } }))); };
    drawSw();
    const fb = h('div', {});
    const times = h('div', { class: 'row' }, h('label', { class: 'field grow' }, 'Starts', h('div', { class: 'row' }, date, start)), h('label', { class: 'field grow' }, 'Ends', h('div', { class: 'row' }, endDate, end)));
    const sync = () => { start.disabled = end.disabled = allDay.checked; };
    allDay.addEventListener('change', sync); sync();
    start.addEventListener('change', () => { const dur = Math.max(15 * 60000, parseLocal(endDate.value, end.value) - parseLocal(date.value, start.value)); if (dur > 0) return; const s2 = parseLocal(date.value, start.value) + HOUR; endDate.value = dateVal(s2); end.value = timeVal(s2); });
    date.addEventListener('change', () => { if (endDate.value < date.value) endDate.value = date.value; });

    // free/busy for the people being invited
    const checkBusy = Nexa.debounce(async () => {
      const addrs = guests.value.split(/[,;]/).map((x) => x.trim().toLowerCase()).filter(Boolean);
      const us = Nexa.state.users.filter((u) => addrs.includes(u.email.toLowerCase()));
      clear(fb);
      if (!us.length || allDay.checked) return;
      const s0 = parseLocal(date.value, start.value), e0 = parseLocal(endDate.value, end.value);
      const day0 = startOfDay(s0).getTime() + 7 * HOUR, day1 = day0 + 13 * HOUR;
      try {
        const r = await api.get(`/api/freebusy?users=${us.map((u) => u.id).join(',')}&from=${day0}&to=${day1}${tzq}`);
        fb.append(h('div', { class: 'muted small', style: { margin: '4px 0' } }, 'Their day, 7 AM to 8 PM (red is busy, the outline is your pick)'));
        for (const u of us) {
          const strip = h('div', { class: 'fb-strip grow' });
          const pct = (t) => Math.min(100, Math.max(0, (t - day0) / (day1 - day0) * 100));
          const busy = (r.busy[u.id] || []).filter((b) => b.start_at !== e.start_at || !e.id);
          for (const b of busy) strip.append(h('i', { style: { left: pct(b.start_at) + '%', width: (pct(b.end_at) - pct(b.start_at)) + '%' } }));
          strip.append(h('b', { style: { left: pct(s0) + '%', width: Math.max(1, pct(e0) - pct(s0)) + '%' } }));
          const clash = busy.some((b) => b.start_at < e0 && b.end_at > s0);
          fb.append(h('div', { class: 'row', style: { marginBottom: '4px' } }, h('span', { class: 'small ellipsis', style: { width: '110px' } }, u.name), strip, h('span', { class: 'small', style: { width: '54px', color: clash ? 'var(--bad)' : 'var(--ok)' } }, clash ? 'Busy' : 'Free')));
        }
      } catch { /* free/busy is a hint only */ }
    }, 400);
    [guests, date, start, end, endDate].forEach((x) => x.addEventListener('change', checkBusy));
    guests.addEventListener('input', checkBusy);
    checkBusy();

    modal({ title: e.id ? 'Edit event' : 'New event', wide: true, body: [
      h('label', { class: 'field' }, 'Title', title), times,
      h('div', { class: 'row', style: { flexWrap: 'wrap' } }, h('label', { class: 'check' }, allDay, 'All day'), h('span', { class: 'grow' }), rec),
      h('label', { class: 'field' }, 'Guests', guests, dl), fb,
      h('label', { class: 'check' }, huddle, 'Add a Huddle video call'),
      h('label', { class: 'field' }, 'Where', loc), h('label', { class: 'field' }, 'Notes', desc), h('div', { class: 'row' }, h('span', { class: 'small muted' }, 'Color'), swatches),
    ], actions: [{ label: 'Cancel' }, { label: e.id ? 'Save' : 'Create', kind: 'primary', submit: true, onClick: async () => {
      const ad = allDay.checked;
      const s0 = ad ? parseLocal(date.value) : parseLocal(date.value, start.value);
      const e0 = ad ? parseLocal(endDate.value) + DAY - 60000 : parseLocal(endDate.value, end.value);
      if (!(e0 > s0)) { toast('The end has to be after the start.', 'bad'); return false; }
      const body = { title: title.value, start_at: s0, end_at: e0, all_day: ad, recurrence: rec.value, location: loc.value, description: desc.value, color, huddle: huddle.checked, attendees: guests.value, ...(TZ ? { tz: TZ } : {}) };
      try {
        if (e.id) await api.patch('/api/events/' + e.id, body); else await api.post('/api/events', body);
        toast(e.id ? 'Event saved' : 'Event created'); if (C) { C.cursor = new Date(s0); load(); }
      } catch (err) { fail(err); return false; }
    } }] });
    setTimeout(() => title.focus(), 50);
  }

  Nexa.Router.add('/cadence', (p) => open({ mode: new URLSearchParams(p.qs || '').get('view') }));
  Nexa.apps.cadence = { newEvent };
})();
