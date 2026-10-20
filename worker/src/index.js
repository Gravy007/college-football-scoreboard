import { buildPushPayload } from '@block65/webcrypto-web-push';

const SCOREBOARD = 'https://site.api.espn.com/apis/site/v2/sports/football/college-football/scoreboard';
const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET,POST,OPTIONS',
  'access-control-allow-headers': 'content-type',
  'cache-control': 'no-store'
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { ...CORS, 'content-type': 'application/json; charset=utf-8' } });
}
function text(data, status = 200) {
  return new Response(data, { status, headers: { ...CORS, 'content-type': 'text/plain; charset=utf-8' } });
}
function base64url(bytes) {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}
async function sha256(textValue) {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(textValue)));
  return base64url(digest);
}
function schoolName(team = {}) { return team.location || team.shortDisplayName || team.abbreviation || 'Unknown'; }
function normalize(value) { return String(value || '').trim().toLowerCase(); }
function orderedTeams(comp = {}) {
  const teams = [...(comp.competitors || [])];
  teams.sort((a, b) => ({ away: 0, home: 1 }[a.homeAway] ?? 2) - ({ away: 0, home: 1 }[b.homeAway] ?? 2));
  return teams;
}
function rankOf(c) {
  const n = Number(c?.curatedRank?.current);
  return Number.isFinite(n) && n > 0 && n <= 25 ? n : null;
}
function teamLabel(c) {
  const r = rankOf(c);
  return `${r ? `#${r} ` : ''}${c?.team?.abbreviation || schoolName(c?.team || {})}`;
}
function gameScores(teams) {
  return teams.map(t => Number(t.score));
}
function scoreLine(teams) {
  const away = teams.find(t => t.homeAway === 'away') || teams[0];
  const home = teams.find(t => t.homeAway === 'home') || teams[1];
  return `${teamLabel(away)} ${away?.score ?? '–'}, ${teamLabel(home)} ${home?.score ?? '–'}`;
}
function stateOf(e) { return e.status?.type?.state || 'pre'; }
function periodOf(e) { return Number(e.status?.period ?? e.competitions?.[0]?.status?.period ?? 0); }
function clockOf(e) { return e.status?.displayClock || e.competitions?.[0]?.status?.displayClock || ''; }
function detailOf(e) {
  const type = e.status?.type || {};
  if (isHalftime(e)) return 'Halftime';
  const p = periodOf(e), clock = clockOf(e);
  const q = p > 4 ? `${p - 4}OT` : p > 0 ? `Q${p}` : 'Live';
  return `${q}${clock ? ` ${clock}` : ''}`;
}
function isHalftime(e) {
  const t = e.status?.type || {};
  return /half/i.test(`${t.name || ''} ${t.description || ''} ${t.detail || ''} ${t.shortDetail || ''}`) || (periodOf(e) === 2 && /^0{1,2}:00(?:\.0)?$/.test(clockOf(e)));
}
function networkOf(comp = {}) {
  for (const b of comp.broadcasts || []) {
    if (Array.isArray(b.names) && b.names.length) return b.names.join(' / ');
    if (b.name) return b.name;
    if (b.shortName) return b.shortName;
  }
  return '';
}
function matchupTop15VsUnranked(e) {
  const teams = orderedTeams(e.competitions?.[0] || {});
  if (teams.length < 2) return null;
  const [a, b] = teams, ar = rankOf(a), br = rankOf(b);
  if (ar !== null && ar <= 15 && br === null) return { ranked: a, underdog: b, teams };
  if (br !== null && br <= 15 && ar === null) return { ranked: b, underdog: a, teams };
  return null;
}
function finalUnderdogWin(e) {
  if (stateOf(e) !== 'post') return false;
  const m = matchupTop15VsUnranked(e);
  if (!m) return false;
  if (m.underdog.winner === true) return true;
  const rs = Number(m.ranked.score), us = Number(m.underdog.score);
  return Number.isFinite(rs) && Number.isFinite(us) && us > rs;
}
function nextUpsetActive(e, wasActive) {
  if (stateOf(e) !== 'in') return false;
  const m = matchupTop15VsUnranked(e);
  if (!m) return false;
  const rs = Number(m.ranked.score), us = Number(m.underdog.score);
  if (!Number.isFinite(rs) || !Number.isFinite(us)) return !!wasActive;
  if (wasActive) return !(rs > us); // a tie keeps the alert alive
  return periodOf(e) === 4 && us > rs;
}
function centralYMD(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date);
  const get = type => parts.find(p => p.type === type)?.value;
  return `${get('year')}${get('month')}${get('day')}`;
}
function addCentralDays(compact, offset) {
  const y = Number(compact.slice(0,4)), m = Number(compact.slice(4,6)), d = Number(compact.slice(6,8));
  const dt = new Date(Date.UTC(y, m - 1, d + offset, 12));
  return `${dt.getUTCFullYear()}${String(dt.getUTCMonth()+1).padStart(2,'0')}${String(dt.getUTCDate()).padStart(2,'0')}`;
}
function eventSnapshot(e, upsetActive) {
  const teams = orderedTeams(e.competitions?.[0] || {});
  return {
    state: stateOf(e),
    scores: teams.map(t => String(t.score ?? '')),
    halftime: isHalftime(e),
    upsetActive: !!upsetActive,
    lastSeen: Date.now()
  };
}
function favoriteGame(e, favorites = []) {
  const fav = new Set(favorites.map(normalize));
  return orderedTeams(e.competitions?.[0] || {}).some(t => fav.has(normalize(schoolName(t.team || {}))));
}
function notificationUrl(sub) { return sub.appUrl || '/'; }

export class NotificationState {
  constructor(ctx, env) { this.ctx = ctx; this.env = env; }

  async ensureVapid() {
    let keys = await this.ctx.storage.get('vapid');
    if (keys) return keys;
    const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
    const publicRaw = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey));
    const privateJwk = await crypto.subtle.exportKey('jwk', pair.privateKey);
    keys = { publicKey: base64url(publicRaw), privateKey: privateJwk.d };
    await this.ctx.storage.put('vapid', keys);
    return keys;
  }

  async subscriptions() { return (await this.ctx.storage.get('subscriptions')) || {}; }
  async saveSubscriptions(value) { await this.ctx.storage.put('subscriptions', value); }

  async send(subRecord, payload, tag) {
    const keys = await this.ensureVapid();
    const vapid = { subject: this.env.VAPID_SUBJECT || 'https://github.com/', publicKey: keys.publicKey, privateKey: keys.privateKey };
    const message = { data: JSON.stringify({ ...payload, tag, url: notificationUrl(subRecord) }), options: { ttl: 600 } };
    try {
      const request = await buildPushPayload(message, subRecord.subscription, vapid);
      const response = await fetch(subRecord.subscription.endpoint, request);
      return { ok: response.ok, gone: response.status === 404 || response.status === 410, status: response.status };
    } catch (error) {
      console.error('Push failed', error);
      return { ok: false, gone: false, status: 0 };
    }
  }

  async fetch(request) {
    const url = new URL(request.url);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
    if (url.pathname === '/health') return json({ ok: true, service: 'cfb-scoreboard-notifications' });
    if (url.pathname === '/vapid-public-key') {
      const keys = await this.ensureVapid();
      return json({ publicKey: keys.publicKey });
    }
    if (url.pathname === '/subscribe' && request.method === 'POST') {
      const body = await request.json().catch(() => null);
      const subscription = body?.subscription;
      if (!subscription?.endpoint || !subscription?.keys?.p256dh || !subscription?.keys?.auth) return json({ error: 'Invalid push subscription.' }, 400);
      const id = await sha256(subscription.endpoint);
      const subscriptions = await this.subscriptions();
      subscriptions[id] = {
        subscription,
        favorites: Array.isArray(body.favorites) ? body.favorites.map(String) : [],
        appUrl: typeof body.appUrl === 'string' ? body.appUrl : '',
        updatedAt: Date.now()
      };
      await this.saveSubscriptions(subscriptions);
      return json({ ok: true, id });
    }
    if (url.pathname === '/unsubscribe' && request.method === 'POST') {
      const body = await request.json().catch(() => null);
      if (!body?.endpoint) return json({ error: 'Missing endpoint.' }, 400);
      const id = await sha256(body.endpoint);
      const subscriptions = await this.subscriptions();
      delete subscriptions[id];
      await this.saveSubscriptions(subscriptions);
      return json({ ok: true });
    }
    if (url.pathname === '/check' && request.method === 'POST') {
      const result = await this.checkGames();
      return json(result);
    }
    return text('CFB Scoreboard notification service', 200);
  }

  async checkGames() {
    const subscriptions = await this.subscriptions();
    const subEntries = Object.entries(subscriptions);
    if (!subEntries.length) return { ok: true, subscriptions: 0, events: 0 };

    const today = centralYMD();
    const dates = [addCentralDays(today, -1), today];
    const responses = await Promise.all(dates.map(d => fetch(`${SCOREBOARD}?groups=80&dates=${d}&limit=500`, { headers: { 'user-agent': 'CFB-Scoreboard-Notification-Worker/1.2' } })));
    const data = await Promise.all(responses.map(r => r.ok ? r.json() : { events: [] }));
    const unique = new Map();
    for (const day of data) for (const e of day.events || []) if (e?.id) unique.set(String(e.id), e);

    const previous = (await this.ctx.storage.get('games')) || {};
    const next = { ...previous };
    const deadSubscriptions = new Set();
    let notificationsSent = 0;

    for (const [eventId, e] of unique) {
      const prev = previous[eventId];
      const wasUpset = !!prev?.upsetActive;
      const upsetActive = nextUpsetActive(e, wasUpset);
      const currentState = stateOf(e);
      const teams = orderedTeams(e.competitions?.[0] || {});
      const scores = teams.map(t => String(t.score ?? ''));
      const scoreChanged = !!prev && prev.scores?.join('|') !== scores.join('|');
      const halftime = isHalftime(e);
      const justKickoff = !!prev && prev.state === 'pre' && currentState === 'in';
      const justFinal = !!prev && prev.state !== 'post' && currentState === 'post';
      const justHalftime = !!prev && !prev.halftime && halftime;
      const justUpset = upsetActive && !wasUpset;
      const upsetFinal = justFinal && finalUnderdogWin(e);
      const network = networkOf(e.competitions?.[0] || {});
      const line = scoreLine(teams);

      // Compare the away/home scores from the previous successful check.
      // Only identify a scorer when exactly one team's points increased.
      const scoreIncreases = prev ? teams.filter((t, i) => {
        const before = Number(prev.scores?.[i]), after = Number(scores[i]);
        return Number.isFinite(before) && Number.isFinite(after) && after > before;
      }) : [];
      const scoredBy = scoreIncreases.length === 1
        ? (scoreIncreases[0].team?.abbreviation || schoolName(scoreIncreases[0].team || {})) + ' scored'
        : scoreIncreases.length > 1 ? 'Both teams scored' : 'Score corrected';

      const broadcasts = [];
      if (justUpset) broadcasts.push({ audience: 'all', title: 'UPSET ALERT', body: line + ' · ' + detailOf(e), tag: 'upset-' + eventId });
      if (upsetFinal) broadcasts.push({ audience: 'all', title: 'UPSET', body: line + ' · Final', tag: 'upset-final-' + eventId });

      if (justFinal) {
        broadcasts.push({ audience: 'favorite', title: 'Final Score', body: line + ' · Final', tag: 'favorite-final-' + eventId });
      } else {
        if (justKickoff) broadcasts.push({ audience: 'favorite', title: 'Kickoff', body: line + (network ? ' · ' + network : ''), tag: 'favorite-kickoff-' + eventId });
        if (currentState === 'in' && scoreChanged && !justKickoff) {
          broadcasts.push({ audience: 'favorite', title: 'Score Update', body: scoredBy + ' · ' + line + ' · ' + detailOf(e), tag: 'favorite-score-' + eventId + '-' + scores.join('-') });
        }
        if (justHalftime) broadcasts.push({ audience: 'favorite', title: 'Halftime', body: line + ' · Halftime', tag: 'favorite-halftime-' + eventId });
      }

      for (const note of broadcasts) {
        for (const [subId, sub] of subEntries) {
          if (note.audience === 'favorite' && !favoriteGame(e, sub.favorites)) continue;
          const result = await this.send(sub, { title: note.title, body: note.body, renotify: true }, note.tag);
          if (result.ok) notificationsSent++;
          if (result.gone) deadSubscriptions.add(subId);
        }
      }
      next[eventId] = eventSnapshot(e, upsetActive);
    }

    // Prune game snapshots not seen for 72 hours.
    const cutoff = Date.now() - 72 * 60 * 60 * 1000;
    for (const [id, snapshot] of Object.entries(next)) if ((snapshot.lastSeen || 0) < cutoff) delete next[id];
    await this.ctx.storage.put('games', next);

    if (deadSubscriptions.size) {
      for (const id of deadSubscriptions) delete subscriptions[id];
      await this.saveSubscriptions(subscriptions);
    }
    return { ok: true, subscriptions: subEntries.length - deadSubscriptions.size, events: unique.size, notificationsSent };
  }
}

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
    const id = env.NOTIFICATION_STATE.idFromName('global');
    const stub = env.NOTIFICATION_STATE.get(id);
    const response = await stub.fetch(request);
    const headers = new Headers(response.headers);
    for (const [k, v] of Object.entries(CORS)) headers.set(k, v);
    return new Response(response.body, { status: response.status, headers });
  },
  async scheduled(controller, env, ctx) {
    const id = env.NOTIFICATION_STATE.idFromName('global');
    const stub = env.NOTIFICATION_STATE.get(id);
    ctx.waitUntil(stub.fetch('https://internal/check', { method: 'POST' }));
  }
};
