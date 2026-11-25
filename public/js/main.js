/* Start-up: decide between setup, sign-in, join links and the app, then route. */
'use strict';
(function () {
  const { api } = Nexa;
  const PUBLIC = [/^\/join\/([\w-]+)/, /^\/invite\/([\w-]+)/];

  Nexa.boot = async function boot(force) {
    let s;
    try { s = await api.get('/api/state'); } catch (e) {
      document.getElementById('app').textContent = 'Nexa could not reach its server. Check that it is running, then reload this page.';
      return;
    }
    Nexa.state.workspace = s.workspace;
    Nexa.state.user = s.user;
    Nexa.state.sourceUrl = s.sourceUrl; Nexa.state.version = s.version;
    Nexa.state.linkBase = s.linkBase || ''; Nexa.state.sso = s.sso || []; Nexa.state.cloud = s.cloud || null;
    const hash = location.hash.slice(1);
    const [, joinTok] = hash.match(PUBLIC[0]) || [];
    const [, inviteTok] = hash.match(PUBLIC[1]) || [];
    if (s.setupNeeded) return Nexa.auth.setup();
    if (!s.user) {
      Nexa.rt.close();
      if (joinTok) return Nexa.auth.join(joinTok);
      if (inviteTok) return Nexa.auth.invite(inviteTok);
      return Nexa.auth.login();
    }
    if (joinTok || inviteTok || hash === '/login') location.hash = '#/home';
    try { Nexa.state.users = (await api.get('/api/users')).users; } catch { Nexa.state.users = [s.user]; }
    Nexa.rt.connect();
    if (force) document.getElementById('app').textContent = '';
    Nexa.router.resolve();
  };

  Nexa.Router.add('/home', () => { Nexa.home(); });
  Nexa.Router.add('/people', () => { Nexa.people(); });
  Nexa.Router.add('/login', () => Nexa.router.go('#/home'));
  Nexa.Router.add('/join/:token', () => Nexa.router.go('#/home'));
  Nexa.Router.add('/invite/:token', () => Nexa.router.go('#/home'));

  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    addEventListener('load', () => navigator.serviceWorker?.register?.('/sw.js')?.catch(() => {}));
  }
  Nexa.boot();
})();
