/* Start page for Astute Nexa online: make a workspace or open one. */
'use strict';
(function () {
  const $ = (id) => document.getElementById(id);
  const host = location.host + '/w/';
  $('host').textContent = host; $('host2').textContent = host;
  const tabs = { new: $('tab-new'), open: $('tab-open') };
  function show(which) {
    for (const k of Object.keys(tabs)) { tabs[k].setAttribute('aria-selected', String(k === which)); $(k).hidden = k !== which; }
  }
  tabs.new.onclick = () => show('new');
  tabs.open.onclick = () => show('open');
  $('to-open').onclick = (e) => { e.preventDefault(); show('open'); $('open-form').elements.namedItem('name').focus(); };
  if (location.hash === '#open') show('open');

  const cf = $('create-form');
  const clean = (v) => String(v || '').trim().toLowerCase();
  let timer;
  cf.name.addEventListener('input', () => {
    clearTimeout(timer);
    const v = clean(cf.name.value);
    timer = setTimeout(async () => {
      if (!v) return;
      try {
        const r = await (await fetch('/cloud/check?name=' + encodeURIComponent(v))).json();
        $('name-hint').textContent = r.ok ? 'That address is free.' : r.reason;
        $('name-hint').className = 'small ' + (r.ok ? 'ok' : 'bad');
      } catch { /* offline */ }
    }, 300);
  });

  const names = { google: 'Continue with Google', apple: 'Continue with Apple' };
  const size = (b) => (b >= 1024 ** 3 ? +(b / 1024 ** 3).toFixed(1) + ' GB' : Math.round(b / 1024 ** 2) + ' MB');
  fetch('/cloud/config').then((r) => r.json()).then((c) => {
    if (c.workspaceBytes > 0) $('quota').textContent = 'Each workspace gets ' + size(c.workspaceBytes) + '.';
    if (c.current) {
      // this browser has opened a workspace before: lead with signing back in to it
      show('open');
      $('open-form').elements.namedItem('name').value = c.current;
      const b = document.createElement('a');
      b.className = 'btn primary big'; b.href = '/w/' + encodeURIComponent(c.current); b.textContent = 'Go to ' + c.current;
      const or = document.createElement('p'); or.className = 'muted small'; or.style.textAlign = 'center'; or.style.margin = '2px 0'; or.textContent = 'or type another address';
      $('last').append(b, or); $('last').hidden = false;
    }
    const list = (c.sso || []).filter((p) => names[p]);
    if (!list.length) return;
    const box = $('sso-new');
    for (const p of list) {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'btn big'; b.textContent = names[p];
      b.onclick = () => {
        const n = clean(cf.name.value);
        if (!cf.name.checkValidity() || !n) { cf.name.reportValidity(); return; }
        location.href = `/sso/${p}/start?create=${encodeURIComponent(n)}&workspace=${encodeURIComponent(cf.workspace.value.trim())}`;
      };
      box.append(b);
    }
    const or = document.createElement('p'); or.className = 'muted small'; or.style.textAlign = 'center'; or.style.margin = '2px 0'; or.textContent = 'or use your email';
    box.append(or);
    box.hidden = false;
  }).catch(() => {});

  cf.addEventListener('submit', async (e) => {
    e.preventDefault();
    $('create-err').textContent = '';
    const btn = cf.querySelector('button[type=submit]'); btn.disabled = true;
    const n = clean(cf.name.value);
    const person = cf.person.value.trim();
    const body = { name: person, email: cf.email.value.trim(), password: cf.password.value,
      workspace: cf.workspace.value.trim() || (person.split(/\s+/)[0] + '’s team'), sampleContent: cf.sample.checked };
    try {
      const r = await fetch('/cloud/create?name=' + encodeURIComponent(n), { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-nexa-csrf': '1' }, body: JSON.stringify(body) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || 'Could not make the workspace.');
      location.href = '/w/' + n + '#/home';
    } catch (ex) { $('create-err').textContent = ex.message; btn.disabled = false; }
  });

  $('open-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const n = clean(e.target.name.value);
    try {
      const r = await (await fetch('/cloud/check?name=' + encodeURIComponent(n))).json();
      if (!r.exists) { $('open-err').textContent = 'No workspace uses that address. Check the spelling with your team.'; return; }
    } catch { /* try anyway */ }
    location.href = '/w/' + n;
  });
})();
