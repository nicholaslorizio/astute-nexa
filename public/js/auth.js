/* Sign-up, sign-in, team join link and invite screens. */
'use strict';
(function () {
  const { h, icon, logo, api, APPS, clear } = Nexa;

  function hero() {
    return h('div', { class: 'auth-hero' },
      h('div', { class: 'row', style: { gap: '12px' } }, logo(40), h('b', { style: { fontSize: '20px' } }, 'Astute Nexa')),
      h('div', {},
        h('h1', {}, 'Your whole office.', h('br'), 'One sign-in.'),
        h('p', {}, 'Docs, sheets, slides, chat, video calls, mail, calendar and files that work together. Free to start, private by default, and yours to host.'),
        h('div', { class: 'app-dots' }, APPS.map((a) => h('span', {}, h('i', { style: { background: a.color } }), a.name)))),
      h('div', { class: 'muted small', style: { color: '#8D95C2' } }, 'Opens your .docx, .xlsx and .pptx files. Open source under AGPL-3.0.'));
  }
  function frame(card) {
    const root = clear(document.getElementById('app'));
    root.append(h('div', { class: 'auth' }, hero(), h('div', { class: 'auth-card' }, card)));
    setTimeout(() => { const i = root.querySelector('.auth-card input'); if (i) i.focus(); }, 30);
  }
  const field = (label, attrs) => h('label', { class: 'field' }, label, h('input', { class: 'input', required: true, ...attrs }));
  function pwField(label = 'Password') {
    const input = h('input', { class: 'input', type: 'password', name: 'password', required: true, minlength: '12', autocomplete: 'new-password', placeholder: 'At least 12 characters' });
    const meter = h('div', { style: { height: '4px', borderRadius: '4px', background: 'var(--bg-4)', overflow: 'hidden' } }, h('i', { style: { display: 'block', height: '100%', width: '0', transition: 'width .2s, background .2s' } }));
    const hint = h('span', { class: 'muted small' }, 'Use letters plus a number or symbol.');
    input.addEventListener('input', () => {
      const v = input.value;
      let s = 0; if (v.length >= 12) s++; if (v.length >= 16) s++; if (/[a-z]/i.test(v) && /[\d\W_]/.test(v)) s++; if (/[A-Z]/.test(v) && /[a-z]/.test(v)) s++;
      const bar = meter.firstChild;
      bar.style.width = (s / 4 * 100) + '%';
      bar.style.background = s <= 1 ? 'var(--bad)' : s === 2 ? 'var(--warn)' : 'var(--ok)';
    });
    const toggle = h('button', { type: 'button', class: 'btn ghost sm', onclick: () => { input.type = input.type === 'password' ? 'text' : 'password'; toggle.textContent = input.type === 'password' ? 'Show' : 'Hide'; } }, 'Show');
    return h('label', { class: 'field' }, h('span', { class: 'row' }, label, h('span', { class: 'grow' }), toggle), input, meter, hint);
  }
  // Google and Apple buttons appear only when the server has them switched on.
  const SSO_NAMES = { google: 'Continue with Google', apple: 'Continue with Apple' };
  function ssoButtons(extra) {
    const list = (Nexa.state.sso || []).filter((p) => SSO_NAMES[p]);
    if (!list.length) return null;
    const q = new URLSearchParams(extra || {}).toString();
    return h('div', { class: 'col', style: { gap: '8px' } },
      list.map((p) => h('a', { class: 'btn big', href: `/sso/${p}/start${q ? '?' + q : ''}` }, SSO_NAMES[p])),
      h('p', { class: 'muted small', style: { textAlign: 'center', margin: '2px 0' } }, 'or use your email'));
  }
  const otherWorkspace = () => (Nexa.state.cloud ? h('p', { class: 'auth-foot' }, h('a', { href: '/w/' }, 'Open a different workspace')) : null);
  function submitter(form, fn) {
    const err = h('div', { class: 'err', role: 'alert' });
    const btn = form.querySelector('button[type=submit]');
    btn.before(err);
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      err.textContent = '';
      btn.disabled = true;
      const data = Object.fromEntries(new FormData(form));
      try { await fn(data); } catch (ex) { err.textContent = ex.message; btn.disabled = false; }
    });
  }

  Nexa.auth = {
    setup() {
      const form = h('form', {},
        field('Your name', { name: 'name', autocomplete: 'name', placeholder: 'Alex Rivera' }),
        field('Work email', { name: 'email', type: 'email', autocomplete: 'email', placeholder: 'you@company.com' }),
        pwField(),
        h('details', {}, h('summary', { class: 'muted small', style: { cursor: 'pointer' } }, 'More options'),
          h('div', { class: 'col', style: { marginTop: '10px' } },
            h('label', { class: 'field' }, 'Team or company name', h('input', { class: 'input', name: 'workspace', placeholder: 'Defaults to your name' })),
            h('label', { class: 'check' }, h('input', { type: 'checkbox', name: 'sample', checked: true }), 'Add a sample doc, budget and deck'))),
        h('button', { class: 'btn primary big', type: 'submit' }, 'Create my workspace'));
      submitter(form, async (d) => {
        const workspace = (d.workspace || '').trim() || (d.name.trim().split(/\s+/)[0] + '’s team');
        await api.post('/api/setup', { name: d.name, email: d.email, password: d.password, workspace, sampleContent: !!d.sample });
        location.hash = '#/home';
        await Nexa.boot(true);
      });
      frame([h('span', { class: 'pill brand' }, icon('sparkle', 14), 'Free while in early access'),
        h('h2', { style: { marginTop: '14px' } }, 'Create your workspace'),
        h('p', { class: 'muted', style: { margin: 0 } }, 'Three fields and you’re in. You’ll be the owner, and you can invite your team with one link.'),
        form,
        h('p', { class: 'auth-foot' }, 'Your data stays on this server. Nothing is sent to Astute.')]);
    },
    login() {
      const form = h('form', {},
        field('Email', { name: 'email', type: 'email', autocomplete: 'username' }),
        h('label', { class: 'field' }, 'Password', h('input', { class: 'input', type: 'password', name: 'password', required: true, autocomplete: 'current-password' })),
        h('button', { class: 'btn primary big', type: 'submit' }, 'Sign in'));
      submitter(form, async (d) => { await api.post('/api/login', d); await Nexa.boot(true); });
      frame([h('h2', {}, 'Welcome back'), h('p', { class: 'muted', style: { margin: 0 } }, `Sign in to ${Nexa.state.workspace}.`), ssoButtons(), form,
        h('p', { class: 'auth-foot' }, 'New here? Ask your admin for the team link, or for an invite.'), otherWorkspace()]);
    },
    async join(token) {
      let info;
      try { info = await api.get('/api/join/' + encodeURIComponent(token)); } catch (e) { return this.dead(e.message); }
      const form = h('form', {},
        field('Your name', { name: 'name', autocomplete: 'name' }),
        field(info.domain ? `Email (@${info.domain})` : 'Email', { name: 'email', type: 'email', autocomplete: 'email', placeholder: info.domain ? `you@${info.domain}` : 'you@company.com' }),
        pwField(),
        h('button', { class: 'btn primary big', type: 'submit' }, `Join ${info.workspace}`));
      submitter(form, async (d) => { await api.post('/api/join/' + encodeURIComponent(token), d); location.hash = '#/home'; await Nexa.boot(true); });
      frame([h('span', { class: 'pill brand' }, 'Team link'), h('h2', { style: { marginTop: '14px' } }, `Join ${info.workspace}`),
        h('p', { class: 'muted', style: { margin: 0 } }, 'Make your account and you’ll land straight in the team chat.'), ssoButtons({ join: token }), form,
        h('p', { class: 'auth-foot' }, h('a', { href: '#/login' }, 'Already have an account? Sign in'))]);
    },
    async invite(token) {
      let info;
      try { info = await api.get('/api/invites/' + encodeURIComponent(token)); } catch (e) { return this.dead(e.message); }
      const form = h('form', {},
        h('label', { class: 'field' }, 'Email', h('input', { class: 'input', value: info.email, disabled: true })),
        field('Your name', { name: 'name', autocomplete: 'name' }),
        pwField(),
        h('button', { class: 'btn primary big', type: 'submit' }, 'Accept invite'));
      submitter(form, async (d) => { await api.post(`/api/invites/${encodeURIComponent(token)}/accept`, d); location.hash = '#/home'; await Nexa.boot(true); });
      frame([h('span', { class: 'pill brand' }, `Invited as ${info.role}`), h('h2', { style: { marginTop: '14px' } }, `Join ${info.workspace}`), ssoButtons({ invite: token }), form]);
    },
    dead(msg) {
      frame([h('h2', {}, 'That link didn’t work'), h('p', { class: 'muted' }, msg), h('a', { class: 'btn', href: '#/login' }, 'Go to sign in')]);
    },
  };
})();
