/* The guest side of a call link: someone without an account types a name and joins one call.
   They only ever talk to the signalling socket for that one call; nothing else in the workspace is reachable. */
'use strict';
(function () {
  const $ = (id) => document.getElementById(id);
  const path = location.pathname;
  const at = path.lastIndexOf('/call/');
  const base = at > 0 ? path.slice(0, at) : '';
  const token = at >= 0 ? path.slice(at + 6).split('/')[0] : '';
  const api = (p) => `${base}/api/guest/call/${encodeURIComponent(token)}${p}`;
  const FALLBACK_ICE = { iceServers: [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun.cloudflare.com:3478'] }] };
  const ICONS = {
    mic: '<path d="M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3Z"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/>',
    micoff: '<path d="M9 9v3a3 3 0 0 0 5.1 2.1M15 9.3V6a3 3 0 0 0-5.7-1.3"/><path d="M5 11a7 7 0 0 0 11.3 5.5M19 11a7 7 0 0 1-.6 2.8M12 18v3M3 3l18 18"/>',
    cam: '<rect x="3" y="6" width="13" height="12" rx="2"/><path d="m16 10 5-3v10l-5-3"/>',
    camoff: '<path d="M16 16v1a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h2m4 0h5a1 1 0 0 1 1 1v3.3l5-3.3v10M3 3l18 18"/>',
    end: '<path d="M3 15.5c5-4.7 13-4.7 18 0l-2.2 2.2a1 1 0 0 1-1.3.1l-2.6-1.8a1 1 0 0 1-.4-.9l.2-1.9a11 11 0 0 0-5.4 0l.2 1.9a1 1 0 0 1-.4.9l-2.6 1.8a1 1 0 0 1-1.3-.1Z"/>',
  };
  const svg = (n) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[n]}</svg>`;
  const show = (id) => { for (const s of ['s-load', 's-join', 's-call', 's-done']) $(s).hidden = s !== id; };
  const store = { get(k) { try { return localStorage.getItem(k); } catch { return null; } }, set(k, v) { try { localStorage.setItem(k, v); } catch { /* private mode */ } } };

  let host = 'Your host';
  let G = null; // the call while it's on

  function done(title, text, again) {
    leave(true);
    $('d-title').textContent = title;
    $('d-text').textContent = text;
    $('d-again').hidden = !again;
    show('s-done');
  }
  const ended = () => done('This call has ended', 'The call link has ended. Ask for a new link to call again.', false);

  async function check() {
    try {
      const r = await fetch(api(''), { cache: 'no-store' });
      if (r.status === 404) return false;
      if (!r.ok) return null;
      const d = await r.json();
      host = d.host || host;
      return true;
    } catch { return null; }
  }

  async function start() {
    if (!token) return ended();
    const ok = await check();
    if (ok === false) return ended();
    if (ok === null) { $('s-load').firstElementChild.textContent = 'Could not reach the call. Check your internet, then reload this page.'; return; }
    $('j-title').textContent = `${host} invited you to a video call`;
    $('j-name').value = store.get('nexa.guestName') || '';
    show('s-join');
    setTimeout(() => { if (!$('j-name').value) $('j-name').focus(); }, 50);
  }

  async function media(video) {
    if (!window.isSecureContext || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) throw new Error('This page needs to be opened from its https link.');
    const audio = { echoCancellation: true, noiseSuppression: true, autoGainControl: true };
    const cam = { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } };
    try { return await navigator.mediaDevices.getUserMedia({ audio, video: video ? cam : false }); } catch (err) {
      if (video) { try { return await navigator.mediaDevices.getUserMedia({ audio }); } catch { /* fall through to the message below */ } }
      throw new Error(err && err.name === 'NotAllowedError'
        ? 'The call needs your microphone. Tap Allow when your phone asks. On iPhone you can turn it on in Settings > Safari > Microphone.'
        : 'Your phone could not start the microphone. Close other apps that use it and try again.');
    }
  }
  async function ice() {
    try {
      const r = await Promise.race([fetch(api('/ice'), { cache: 'no-store' }).then((x) => (x.ok ? x.json() : null)), new Promise((ok) => setTimeout(() => ok(null), 5000))]);
      if (r && Array.isArray(r.iceServers) && r.iceServers.length) return { iceServers: r.iceServers, iceTransportPolicy: r.iceTransportPolicy === 'relay' ? 'relay' : 'all' };
    } catch { /* public STUN below */ }
    return FALLBACK_ICE;
  }

  async function join(video) {
    const name = $('j-name').value.replace(/\s+/g, ' ').trim();
    if (!name) { $('j-err').textContent = 'Type your name first.'; $('j-name').focus(); return; }
    store.set('nexa.guestName', name);
    $('j-err').textContent = '';
    for (const b of document.querySelectorAll('#j-form button')) b.disabled = true;
    try {
      const [stream, cfg] = await Promise.all([media(video), ice()]);
      G = { name, stream, ice: cfg, peers: new Map(), names: new Map(), muted: false, camOff: !stream.getVideoTracks().length, me: null, cid: null, tries: 0, gone: false };
      $('c-me').srcObject = stream;
      $('c-me').classList.toggle('off', G.camOff);
      paintButtons();
      show('s-call');
      lock();
      connect();
    } catch (err) {
      $('j-err').textContent = err.message || String(err);
    } finally {
      for (const b of document.querySelectorAll('#j-form button')) b.disabled = false;
    }
  }

  // ---------- the socket for this one call ----------
  function connect() {
    if (!G || G.gone) return;
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${proto}//${location.host}${base}/ws/guest?t=${encodeURIComponent(token)}&name=${encodeURIComponent(G.name)}`);
    G.ws = ws;
    let opened = false;
    ws.onopen = () => { opened = true; G.tries = 0; };
    ws.onmessage = (e) => { let m; try { m = JSON.parse(e.data); } catch { return; } onMessage(m); };
    ws.onclose = async (e) => {
      if (!G || G.ws !== ws || G.gone) return;
      if (e.code === 4003) return done('You were removed from the call', 'The host removed you from this call.', false);
      if (e.code === 4004) return ended();
      for (const pid of [...G.peers.keys()]) drop(pid);
      status('Reconnecting…');
      if (!opened && (await check()) === false) return ended();
      const wait = Math.min(15000, 1000 * 2 ** Math.min(G.tries++, 4));
      setTimeout(connect, wait);
    };
  }
  const send = (m) => { if (G && G.ws && G.ws.readyState === 1) G.ws.send(JSON.stringify(m)); };
  const sendState = () => send({ t: 'call.state', channel_id: G.cid, muted: G.muted, video: !G.camOff });

  function onMessage(m) {
    if (!G) return;
    if (m.t === 'hello') { G.me = m.user_id; G.cid = m.channel_id; send({ t: 'call.join', channel_id: G.cid }); return; }
    if (m.channel_id && m.channel_id !== G.cid) return;
    if (m.t === 'call.joined') {
      for (const x of m.participants || []) G.names.set(x.id, x.name);
      for (const pid of [...G.peers.keys()]) if (!m.peers.includes(pid)) drop(pid);
      for (const p of m.peers) reset(p);
      sendState(); waiting();
    } else if (m.t === 'call.peer') {
      G.names.set(m.user_id, m.name); reset(m.user_id); waiting();
    } else if (m.t === 'call.left') {
      drop(m.user_id); waiting();
    } else if (m.t === 'call.full') {
      done('This call is full', 'Only 8 people can be in a call at once. Try again later.', true);
    } else if (m.t === 'call.signal') {
      if (m.name) G.names.set(m.from, m.name);
      signal(m);
    } else if (m.t === 'call.state') {
      const t = document.querySelector(`[data-peer="${CSS.escape(m.user_id)}"] .gc-name`);
      if (t) t.textContent = (G.names.get(m.user_id) || '') + (m.muted ? ' 🔇' : '');
    }
  }
  function status(text) { $('c-status').textContent = text; }
  function waiting() {
    if (!G) return;
    const n = G.peers.size;
    status(n ? `In the call with ${[...G.peers.keys()].map((id) => G.names.get(id) || 'someone').join(', ')}` : `Waiting for ${host} to join…`);
    $('c-grid').classList.toggle('many', n > 1);
  }

  // ---------- one connection per person (same "perfect negotiation" as the app) ----------
  async function setLocal(pc) {
    try { await pc.setLocalDescription(); } catch (err) {
      if (!err || err.name !== 'TypeError') throw err;
      await pc.setLocalDescription(await (pc.signalingState === 'have-remote-offer' ? pc.createAnswer() : pc.createOffer()));
    }
  }
  const plain = (d) => (d && d.toJSON ? d.toJSON() : { type: d.type, sdp: d.sdp });
  const connected = (pc) => pc.connectionState === 'connected' || ['connected', 'completed'].includes(pc.iceConnectionState);

  function tile(pid) {
    let t = document.querySelector(`[data-peer="${CSS.escape(pid)}"]`);
    if (!t) {
      t = document.createElement('div');
      t.className = 'gc-tile'; t.dataset.peer = pid;
      const v = document.createElement('video'); v.autoplay = true; v.playsInline = true; v.setAttribute('playsinline', '');
      const n = document.createElement('span'); n.className = 'gc-name'; n.textContent = G.names.get(pid) || '';
      const note = document.createElement('div'); note.className = 'gc-note'; note.setAttribute('role', 'status'); note.textContent = 'Connecting…';
      t.append(v, n, note);
      $('c-grid').append(t);
    }
    return t;
  }
  function note(pid, text) { const t = document.querySelector(`[data-peer="${CSS.escape(pid)}"] .gc-note`); if (t) t.textContent = text; }
  function play(t, stream) {
    const v = t.querySelector('video');
    if (v.srcObject !== stream) v.srcObject = stream;
    v.play().catch(() => {
      if (t.querySelector('.gc-tap')) return;
      const b = document.createElement('button'); b.className = 'gc-tap'; b.type = 'button'; b.textContent = 'Tap to hear them';
      b.onclick = () => v.play().then(() => b.remove(), () => {});
      t.append(b);
    });
  }
  function reset(pid) { if (!G || pid === G.me) return; drop(pid); peer(pid); }
  function peer(pid) {
    let pc;
    try { pc = new RTCPeerConnection(G.ice); } catch { pc = new RTCPeerConnection(FALLBACK_ICE); }
    const p = { pc, polite: G.me > pid, makingOffer: false, ignore: false, queue: Promise.resolve(), restarts: 0, timers: {}, remote: null };
    G.peers.set(pid, p);
    tile(pid);
    for (const tr of G.stream.getTracks()) pc.addTrack(tr, G.stream);
    p.send = (data) => send({ t: 'call.signal', channel_id: G.cid, to: pid, data });
    pc.onicecandidate = (e) => { if (e.candidate && G && G.peers.get(pid) === p) p.send({ candidate: e.candidate.toJSON ? e.candidate.toJSON() : e.candidate }); };
    pc.ontrack = (e) => {
      let s = e.streams && e.streams[0];
      if (!s) { s = p.remote || new MediaStream(); s.addTrack(e.track); }
      p.remote = s;
      play(tile(pid), s);
    };
    pc.onnegotiationneeded = async () => {
      try { p.makingOffer = true; await setLocal(pc); p.send({ description: plain(pc.localDescription) }); } catch (err) { console.warn('offer', err); } finally { p.makingOffer = false; }
    };
    const watch = () => {
      if (!G || G.peers.get(pid) !== p) return;
      if (connected(pc)) { clearTimeout(p.timers.retry); p.restarts = 0; note(pid, ''); return; }
      const st = pc.connectionState || pc.iceConnectionState;
      if (st === 'disconnected') {
        note(pid, 'Reconnecting…');
        clearTimeout(p.timers.retry);
        p.timers.retry = setTimeout(() => restart(pid, p), 5000);
      } else if (st === 'failed') restart(pid, p);
    };
    pc.onconnectionstatechange = watch;
    pc.oniceconnectionstatechange = watch;
    p.timers.first = setTimeout(() => { if (G && G.peers.get(pid) === p && !connected(pc)) note(pid, 'Still connecting. If this lasts, try Wi-Fi or mobile data instead.'); }, 25000);
    waiting();
    return p;
  }
  function restart(pid, p) {
    if (!G || G.peers.get(pid) !== p || connected(p.pc)) return;
    if (p.restarts >= 3) return note(pid, 'The call connection dropped. Check your internet, or hang up and join again.');
    p.restarts++;
    try { p.pc.restartIce(); } catch { return reset(pid); }
    clearTimeout(p.timers.retry);
    p.timers.retry = setTimeout(() => restart(pid, p), 12000);
  }
  function signal(m) {
    let p = G.peers.get(m.from);
    const { description, candidate } = m.data || {};
    if (!p) {
      if (!description || description.type !== 'offer') return;
      p = peer(m.from);
    }
    p.queue = p.queue.then(() => handle(m.from, p, description, candidate));
  }
  async function handle(pid, p, description, candidate) {
    if (!G || G.peers.get(pid) !== p) return;
    const { pc } = p;
    try {
      if (description) {
        const collision = description.type === 'offer' && (p.makingOffer || pc.signalingState !== 'stable');
        p.ignore = !p.polite && collision;
        if (p.ignore) return;
        if (collision) await pc.setLocalDescription({ type: 'rollback' }).catch(() => {});
        await pc.setRemoteDescription(description);
        if (description.type === 'offer') { await setLocal(pc); p.send({ description: plain(pc.localDescription) }); }
      } else if (candidate) {
        try { await pc.addIceCandidate(candidate); } catch (err) { if (!p.ignore) console.warn('candidate', err); }
      }
    } catch (err) { console.warn('signal', err); }
  }
  function drop(pid) {
    const p = G && G.peers.get(pid);
    if (p) {
      for (const t of Object.values(p.timers)) clearTimeout(t);
      p.pc.onicecandidate = p.pc.ontrack = p.pc.onnegotiationneeded = p.pc.onconnectionstatechange = p.pc.oniceconnectionstatechange = null;
      p.pc.close(); G.peers.delete(pid);
    }
    const t = document.querySelector(`[data-peer="${CSS.escape(pid)}"]`);
    if (t) t.remove();
  }

  // ---------- the three buttons ----------
  function paintButtons() {
    const mic = $('c-mic'), cam = $('c-cam');
    mic.setAttribute('aria-pressed', String(G.muted));
    mic.querySelector('.gc-ico').innerHTML = svg(G.muted ? 'micoff' : 'mic');
    mic.querySelector('.gc-lbl').textContent = G.muted ? 'Unmute' : 'Mute';
    cam.setAttribute('aria-pressed', String(G.camOff));
    cam.querySelector('.gc-ico').innerHTML = svg(G.camOff ? 'camoff' : 'cam');
    cam.querySelector('.gc-lbl').textContent = G.camOff ? 'Camera on' : 'Camera off';
    $('c-end').querySelector('.gc-ico').innerHTML = svg('end');
  }
  $('c-mic').onclick = () => {
    if (!G) return;
    G.muted = !G.muted;
    G.stream.getAudioTracks().forEach((t) => { t.enabled = !G.muted; });
    paintButtons(); sendState();
  };
  $('c-cam').onclick = async () => {
    if (!G) return;
    const vt = G.stream.getVideoTracks()[0];
    if (vt) { G.camOff = !G.camOff; vt.enabled = !G.camOff; } else {
      try {
        const s = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } } });
        const t = s.getVideoTracks()[0];
        G.stream.addTrack(t); G.camOff = false;
        for (const p of G.peers.values()) p.pc.addTrack(t, G.stream);
        $('c-me').srcObject = G.stream;
      } catch { status('Your phone would not turn on the camera. You can carry on with sound.'); return; }
    }
    $('c-me').classList.toggle('off', G.camOff);
    paintButtons(); sendState();
  };
  $('c-end').onclick = () => done('You left the call', 'Thanks for calling. You can join again with the same link while the call is on.', true);
  $('d-again').onclick = () => start();

  function leave(quiet) {
    if (!G) return;
    G.gone = true;
    if (!quiet || (G.ws && G.ws.readyState === 1)) send({ t: 'call.leave', channel_id: G.cid });
    for (const pid of [...G.peers.keys()]) drop(pid);
    G.stream.getTracks().forEach((t) => t.stop());
    try { if (G.ws) G.ws.close(1000); } catch { /* already closed */ }
    if (G.lock) G.lock.release().catch(() => {});
    $('c-me').srcObject = null;
    G = null;
  }
  // keep the phone's screen on while the call is on, where the browser allows it
  async function lock() {
    try {
      if (!G || !navigator.wakeLock) return;
      const l = await navigator.wakeLock.request('screen');
      if (!G) { l.release().catch(() => {}); return; }
      G.lock = l;
      l.addEventListener('release', () => { if (G && G.lock === l) G.lock = null; });
    } catch { /* optional */ }
  }
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && G && !G.lock) lock(); });
  addEventListener('pagehide', () => { if (G) send({ t: 'call.leave', channel_id: G.cid }); });

  $('j-form').addEventListener('submit', (e) => { e.preventDefault(); join(true); });
  $('j-audio').onclick = () => join(false);
  start();
}());
