'use strict';
// ICE servers for Huddle calls.
//
// STUN alone lets two people connect when at least one of them is on an open network. Many home
// routers, offices, hotels and mobile carriers block that direct path, and then a call needs a TURN
// relay. Nexa does not run one itself; set one of these and it hands short-lived logins to people
// who are signed in:
//
//   Cloudflare TURN (1,000 GB a month free):  NEXA_TURN_CF_KEY_ID, NEXA_TURN_CF_API_TOKEN
//   Your own coturn (use-auth-secret):        NEXA_TURN_URLS, NEXA_TURN_SECRET
//   Any TURN service with a fixed login:      NEXA_TURN_URLS, NEXA_TURN_USERNAME, NEXA_TURN_CREDENTIAL
//
// NEXA_ICE_POLICY=relay forces every call through TURN, which is a quick way to check TURN works.
const crypto = require('crypto');

const DEFAULT_STUN = ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302', 'stun:stun.cloudflare.com:3478'];
const CF_TTL = 24 * 3600; // seconds a Cloudflare login lasts
const SECRET_TTL = 12 * 3600;

const list = (v) => String(v || '').split(',').map((s) => s.trim()).filter(Boolean);

function iceFromEnv(env = process.env) {
  return {
    stun: env.NEXA_STUN_URLS ? list(env.NEXA_STUN_URLS) : DEFAULT_STUN,
    cfKeyId: env.NEXA_TURN_CF_KEY_ID || '',
    cfToken: env.NEXA_TURN_CF_API_TOKEN || '',
    turnUrls: list(env.NEXA_TURN_URLS),
    turnUser: env.NEXA_TURN_USERNAME || '',
    turnCred: env.NEXA_TURN_CREDENTIAL || '',
    turnSecret: env.NEXA_TURN_SECRET || '',
    policy: env.NEXA_ICE_POLICY === 'relay' ? 'relay' : 'all',
  };
}

function createIce(cfg = iceFromEnv(), { fetchImpl = globalThis.fetch, log = console } = {}) {
  let cfCache = null; // { servers, until }
  let cfPending = null;
  let cfFailedAt = 0;

  async function cloudflare() {
    if (cfCache && Date.now() < cfCache.until) return cfCache.servers;
    if (Date.now() - cfFailedAt < 60 * 1000) return null; // don't hammer it after a failure
    if (!cfPending) {
      cfPending = (async () => {
        try {
          const r = await fetchImpl(`https://rtc.live.cloudflare.com/v1/turn/keys/${encodeURIComponent(cfg.cfKeyId)}/credentials/generate-ice-servers`, {
            method: 'POST',
            headers: { authorization: 'Bearer ' + cfg.cfToken, 'content-type': 'application/json' },
            body: JSON.stringify({ ttl: CF_TTL }),
            signal: AbortSignal.timeout(5000),
          });
          if (!r.ok) throw new Error('Cloudflare TURN answered ' + r.status);
          const body = await r.json();
          const servers = (Array.isArray(body.iceServers) ? body.iceServers : [body.iceServers]).filter(Boolean).map((s) => ({
            ...s,
            // port 53 often times out in browsers, Cloudflare's docs say to leave it out
            urls: [].concat(s.urls || []).filter((u) => !/:53(\?|$)/.test(u)),
          })).filter((s) => s.urls.length);
          if (!servers.length) throw new Error('Cloudflare TURN sent no servers');
          // reuse one login for half its life so a busy workspace does not ask for a new one per call
          cfCache = { servers, until: Date.now() + (CF_TTL / 2) * 1000 };
          return servers;
        } catch (err) {
          cfFailedAt = Date.now();
          log.warn && log.warn('Huddle: could not get TURN logins from Cloudflare, calls will use STUN only.', err.message);
          return null;
        } finally { cfPending = null; }
      })();
    }
    return cfPending;
  }

  function fromSecret(userId) {
    // the TURN REST convention coturn's use-auth-secret understands
    const username = `${Math.floor(Date.now() / 1000) + SECRET_TTL}:${userId}`;
    const credential = crypto.createHmac('sha1', cfg.turnSecret).update(username).digest('base64');
    return { urls: cfg.turnUrls, username, credential };
  }

  async function forUser(userId) {
    const iceServers = [];
    if (cfg.stun.length) iceServers.push({ urls: cfg.stun });
    let relay = false;
    if (cfg.cfKeyId && cfg.cfToken) {
      const cf = await cloudflare();
      if (cf) { iceServers.push(...cf); relay = true; }
    }
    if (cfg.turnUrls.length && cfg.turnSecret) { iceServers.push(fromSecret(userId)); relay = true; }
    else if (cfg.turnUrls.length && cfg.turnUser && cfg.turnCred) { iceServers.push({ urls: cfg.turnUrls, username: cfg.turnUser, credential: cfg.turnCred }); relay = true; }
    // forcing relay with no TURN set would make every call fail, so ignore it then
    return { iceServers, iceTransportPolicy: relay && cfg.policy === 'relay' ? 'relay' : 'all', relay };
  }

  return { forUser, configured: () => !!((cfg.cfKeyId && cfg.cfToken) || (cfg.turnUrls.length && (cfg.turnSecret || (cfg.turnUser && cfg.turnCred)))) };
}

module.exports = { createIce, iceFromEnv, DEFAULT_STUN };
