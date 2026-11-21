// Crew app: sign in, pick tonight's route and crew, then Start / Complete each site.
import { backend } from './backend.js';
import {
  $, $$, esc, t12, dur, hrs, addrList, mapLink, legs, getGeo, twoTap, toast, errText, lsGet, lsSet,
  crewEmail, pinPassword, visitIndex, registerSW, PLANS, YARD, dayTime
} from './common.js';

const app = $('#app');
const S = { user: null, ident: null, event: null, active: [], routes: [], people: [], sites: {}, visits: [], visitsMeta: {}, route: null, crew: null, unsubs: [] };
const PICK = 'dr-pick';   // {eventId, routeId} chosen on this phone
const HOME = 'dr-home';   // {eventId, routeId} of their own route while they help on another one
const crewKey = () => 'dr-crew-' + (S.event && S.event.id) + '-' + (S.route && S.route.id);
let tick = null, installEvt = null, gotoSite = null, query = '';

registerSW();
window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); installEvt = e; });
window.addEventListener('online', netBadge); window.addEventListener('offline', netBadge);

function clearWatches() { S.unsubs.forEach(u => { try { u(); } catch (e) {} }); S.unsubs = []; }

backend.onAuth(async user => {
  clearWatches(); S.user = user; S.ident = null;
  $('#menuBtn').hidden = !user; $('#net').hidden = !user;
  if (!user) return showLogin();
  try { S.ident = await backend.get('uids/' + user.uid); } catch (e) { S.ident = null; }
  if (!S.ident || S.ident.active === false) {
    app.innerHTML = `<div class="card" style="margin-top:24px"><h2>Login not active</h2><p>This login isn’t set up for routes yet. Ask the office to check it.</p><button class="btn" id="out">Sign out</button></div>`;
    $('#out').onclick = () => backend.signOut(); return;
  }
  startWatches();
});

/* ---------- Sign in ---------- */
async function showLogin() {
  $('#title').textContent = 'Dispatch Routes';
  app.innerHTML = `<div class="login">
    <div class="brand"><b>Dispatch Routes</b><span class="muted">Heninger Landscaping</span></div>
    <div class="tabs" role="tablist"><button role="tab" aria-selected="true" data-t="crew">Crew</button><button role="tab" aria-selected="false" data-t="office">Office</button></div>
    <div id="lcrew">
      <label class="f" for="who">Your name</label>
      <select id="who"><option value="">Loading names…</option></select>
      <label class="f" id="pinlbl">Your PIN</label>
      <div class="pinbox" id="pinbox"></div>
      <div class="keypad">${[1,2,3,4,5,6,7,8,9].map(n => `<button type="button" data-k="${n}">${n}</button>`).join('')}<button type="button" data-k="c" aria-label="Clear">Clear</button><button type="button" data-k="0">0</button><button type="button" data-k="b" aria-label="Delete">⌫</button></div>
      <div class="err" id="lerr"></div>
      <button class="btn primary full" id="lgo" type="button">Sign in</button>
    </div>
    <div id="loffice" hidden>
      <label class="f" for="em">Email</label><input id="em" type="email" autocomplete="username">
      <label class="f" for="pw">Password</label><input id="pw" type="password" autocomplete="current-password">
      <div class="err" id="oerr"></div>
      <button class="btn primary full" id="ogo" type="button">Sign in</button>
      <p class="small muted">Office staff can also open the <a href="admin.html">office dashboard</a>.</p>
    </div>
  </div>`;
  $$('.tabs button').forEach(b => b.onclick = () => { $$('.tabs button').forEach(x => x.setAttribute('aria-selected', x === b)); $('#lcrew').hidden = b.dataset.t !== 'crew'; $('#loffice').hidden = b.dataset.t !== 'office'; });
  let pin = '', len = 4;
  const show = () => {
    const box = $('#pinbox'); if (box.children.length !== len) box.innerHTML = '<span></span>'.repeat(len);
    $$('#pinbox span').forEach((s, i) => { s.textContent = pin[i] ? '•' : ''; s.classList.toggle('f', i === pin.length); });
    $('#pinlbl').textContent = `Your ${len}-digit PIN`;
  };
  show();
  $$('.keypad button').forEach(b => b.onclick = () => { const k = b.dataset.k; if (k === 'c') pin = ''; else if (k === 'b') pin = pin.slice(0, -1); else if (pin.length < len) pin += k; show(); $('#lerr').textContent = ''; });
  let roster = [];
  try { const r = await backend.get('roster/public'); roster = (r && r.people || []).slice().sort((a, b) => a.name.localeCompare(b.name)); } catch (e) {}
  const last = lsGet('dr-last-who', '');
  $('#who').innerHTML = roster.length ? '<option value="">Choose your name</option>' + roster.map(p => `<option value="${esc(p.id)}" ${p.id === last ? 'selected' : ''}>${esc(p.name)}</option>`).join('')
    : '<option value="">No names yet: the office adds crew</option>';
  const setLen = () => { const p = roster.find(x => x.id === $('#who').value); len = p ? (p.len || (p.pv === 2 ? 4 : 6)) : 4; pin = pin.slice(0, len); show(); };
  $('#who').onchange = setLen; setLen();
  $('#lgo').onclick = async () => {
    const id = $('#who').value, p = roster.find(x => x.id === id);
    if (!p) return $('#lerr').textContent = 'Choose your name first.';
    if (pin.length !== len) return $('#lerr').textContent = `Enter all ${len} digits of your PIN.`;
    $('#lgo').disabled = true; $('#lgo').textContent = 'Signing in…';
    try { await backend.signIn(crewEmail(p.id, p.gen), pinPassword(pin, p.pv)); lsSet('dr-last-who', p.id); }
    catch (e) { $('#lerr').textContent = errText(e); pin = ''; show(); $('#lgo').disabled = false; $('#lgo').textContent = 'Sign in'; }
  };
  $('#ogo').onclick = async () => {
    $('#ogo').disabled = true;
    try { await backend.signIn($('#em').value.trim(), $('#pw').value); }
    catch (e) { $('#oerr').textContent = errText(e).replace('name and PIN', 'email and password'); $('#ogo').disabled = false; }
  };
}

/* ---------- Live data ---------- */
function startWatches() {
  let got = { ev: false, routes: false, people: false, sites: false };
  const ready = () => got.ev && got.routes && got.people && got.sites;
  const fail = e => { app.innerHTML = `<div class="banner warn">Can’t load routes: ${esc(errText(e))}</div>`; };
  S.unsubs.push(backend.watchList('events', [['active', '==', true]], evs => {
    S.active = evs.sort((a, b) => (a.startMs || 0) - (b.startMs || 0)); got.ev = true; if (ready()) render();
  }, fail));
  S.unsubs.push(backend.watchList('routes', [], rs => { S.routes = rs.sort((a, b) => (a.order || 0) - (b.order || 0)); got.routes = true; if (ready()) render(); }, fail));
  S.unsubs.push(backend.watchList('people', [], ps => { S.people = ps; got.people = true; if (ready()) render(); }, fail));
  S.unsubs.push(backend.watchList('sites', [], ss => { S.sites = Object.fromEntries(ss.map(s => [s.id, s])); got.sites = true; if (ready()) render(); }, fail));
}
let visitUnsub = null, visitFor = null;
function watchVisits() {
  const want = S.event ? S.event.id : null;
  if (want === visitFor) return;
  if (visitUnsub) { visitUnsub(); visitUnsub = null; }
  visitFor = want; S.visits = [];
  if (!want) return;
  let lastSig = null;
  visitUnsub = backend.watchList('visits', [['eventId', '==', want]], (vs, m) => {
    S.visits = vs; S.visitsMeta = m; netBadge();
    // Only redraw when this crew's own route changed, so a half-done two-tap isn't reset by other crews' updates.
    const rid = (lsGet(PICK, null) || {}).routeId;
    const sig = JSON.stringify(vs.filter(v => v.routeId === rid).map(v => [v.id, v.status, v.addrTicks, v.nfMs, v.endMs]).sort());
    if (sig === lastSig && S.route) return;
    lastSig = sig; render();
  });
  S.unsubs.push(() => { if (visitUnsub) visitUnsub(); visitUnsub = null; visitFor = null; });
}
function netBadge() {
  const n = $('#net'); if (!n) return;
  const pend = S.visitsMeta && S.visitsMeta.pending;
  n.className = 'net' + (!navigator.onLine ? ' off' : pend ? ' pend' : '');
  n.querySelector('span').textContent = !navigator.onLine ? 'No signal – saving on phone' : pend ? 'Sending…' : 'Online';
}

const myId = () => S.ident && S.ident.personId;
const personName = id => (S.people.find(p => p.id === id) || {}).name || 'Someone';
const evRoutes = ev => !ev ? [] : S.routes.filter(r => !r.archived && !r.hidden && (ev.routes ? ev.routes.includes(r.id) : [ev.plowPlan || 'plow', 'sidewalk', 'day'].includes(r.plan)));

/* ---------- Screens ---------- */
function render() {
  clearInterval(tick); tick = null;
  if (!S.active.length) {
    S.event = null; watchVisits();
    $('#title').textContent = 'Dispatch Routes';
    app.innerHTML = `<div class="card" style="margin-top:20px"><h2>No snow event running</h2><p>The office starts each snow event. When it starts, your route shows here.</p><p class="muted small">Signed in as ${esc(personName(myId()))}.</p></div>`;
    return;
  }
  const pick = lsGet(PICK, null) || {};
  S.event = S.active.find(e => e.id === pick.eventId) || null;
  S.route = S.event ? evRoutes(S.event).find(r => r.id === pick.routeId) || null : null;
  if (!S.route) { S.event = null; watchVisits(); return showPick(); }
  watchVisits();
  S.crew = lsGet(crewKey(), null);
  if (!S.crew) return showCrew();
  showRoute();
}

function showPick() {
  $('#title').textContent = 'Pick your route';
  const me = myId();
  // Their usual route(s) in the running snow events, shown first so nobody has to remember.
  const usual = S.active.flatMap(ev => evRoutes(ev).filter(r => (r.members || []).includes(me)).map(r => ({ ev, r })));
  const usualHTML = usual.length
    ? `<div class="banner info" style="margin-top:6px"><div>Your route${usual.length > 1 ? 's' : ''} tonight:</div><div class="pick" style="margin-top:8px">${usual.map(({ ev, r }) =>
        `<button type="button" data-e="${esc(ev.id)}" data-r="${esc(r.id)}" class="mine" style="--c:${esc(r.color || '#1d5fa8')}"><b>${esc(r.label)}${r.crewLabel ? ' · ' + esc(r.crewLabel) : ''}</b><small>${esc(ev.name || '')} · ${esc(r.area || '')} · ${(r.stops || []).length} stops</small></button>`).join('')}</div>
        <div class="small muted" style="margin-top:6px">Tap it to start, or pick a different route below if the office moved you tonight.</div></div>`
    : `<div class="banner info" style="margin-top:6px">You don’t have a usual route in tonight’s snow event${S.active.length > 1 ? 's' : ''}. Check with the office which route you’re on, then pick it below.</div>`;
  app.innerHTML = `${searchHTML()}<h2>Which route are you on?</h2>${usualHTML}<h3 style="margin-top:18px">All routes running now</h3>` + S.active.map(ev => {
    const rs = evRoutes(ev);
    const groups = ['quick', 'plow', 'drivelanes', 'sidewalk', 'day'].map(p => [p, rs.filter(r => r.plan === p)]).filter(g => g[1].length);
    return `<div class="card" style="padding:10px 12px"><h2 style="margin:0">${esc(ev.name || 'Snow event')}</h2><div class="muted small">Started ${esc(dayTime(ev.startMs))}</div>` +
      groups.map(([p, list]) => `<h3>${esc(PLANS[p].label)}</h3><div class="pick">${list.map(r => `<button type="button" data-e="${esc(ev.id)}" data-r="${esc(r.id)}" class="${(r.members || []).includes(me) ? 'mine' : ''}" style="--c:${esc(r.color || '#1d5fa8')}"><b>${esc(r.label)}${r.crewLabel ? ' · ' + esc(r.crewLabel) : ''}</b><small>${esc(r.area || '')} · ${(r.stops || []).length} stops</small></button>`).join('')}</div>`).join('') + '</div>';
  }).join('');
  $$('.pick button').forEach(b => b.onclick = () => { lsSet(PICK, { eventId: b.dataset.e, routeId: b.dataset.r }); lsSet(HOME, null); render(); });
  wireSearch();
}

function showCrew() {
  const r = S.route, me = myId();
  const helping = isHelping();
  const pre = new Set(helping ? [me] : [me, ...(r.members || [])]);
  const ppl = S.people.filter(p => p.active !== false).sort((a, b) => (pre.has(b.id) - pre.has(a.id)) || a.name.localeCompare(b.name));
  $('#title').textContent = r.label;
  app.innerHTML = `<h2>Who’s with you tonight?</h2><p class="muted small">${helping ? `You’re doing a site on ${esc(r.label)}. Tick anyone who’s with you.` : `${esc(r.label)}. Untick anyone who isn’t here and tick anyone filling in.`}</p>
    <div class="checks">${ppl.map(p => `<label><input type="checkbox" value="${esc(p.id)}" ${pre.has(p.id) ? 'checked' : ''} ${p.id === me ? 'disabled' : ''}>${esc(p.name)}${p.id === me ? ' (you)' : ''}</label>`).join('')}</div>
    <p><button class="btn primary full" id="crewGo" type="button">${helping ? 'Go to the site' : 'Start route'}</button></p><p><button class="link" id="back" type="button">Pick a different route</button></p>`;
  $('#crewGo').onclick = () => {
    const ids = [me, ...$$('.checks input:checked').map(i => i.value).filter(v => v !== me)];
    lsSet(crewKey(), ids);
    // Tell the office who's out on this route tonight (shows on the dashboard before the first site).
    if (!helping) save(backend.set(`crews/${S.event.id}__${r.id}`, { eventId: S.event.id, routeId: r.id, crew: ids, by: me, at: Date.now() }));
    render();
  };
  $('#back').onclick = () => { lsSet(PICK, null); lsSet(HOME, null); render(); };
}

function stopsOf(r) { return (r.stops || []).map((st, i) => ({ ...st, n: i + 1, site: S.sites[st.siteId] })).filter(s => s.site); }

function showRoute() {
  const r = S.route, stops = stopsOf(r), me = myId();
  const vi = visitIndex(S.visits.filter(v => v.routeId === r.id));
  const vOf = s => vi[r.id + '|' + s.siteId] || [];
  const open = S.visits.find(v => v.routeId === r.id && v.status === 'open');
  const isDone = s => vOf(s).some(v => v.status === 'done');
  const doneN = stops.filter(isDone).length;
  const next = stops.find(s => !isDone(s) && !(open && open.siteId === s.siteId));
  $('#title').textContent = r.label;
  const keepScroll = window.scrollY, home = lsGet(HOME, null), homeR = isHelping() && S.routes.find(x => x.id === home.routeId);
  app.innerHTML = `${searchHTML()}${isHelping() ? `<div class="banner info helpbar"><span>You’re doing a site on <b>${esc(r.label)}</b>.</span>${homeR ? `<button class="btn sm" id="goHome" type="button">← Back to ${esc(homeR.label)}</button>` : ''}</div>` : ''}<div class="card rhead" style="--c:${esc(r.color || '#1d5fa8')}">
      <h2>${esc(r.label)}</h2>
      <div class="muted small">${esc(S.event.name || '')} · Crew: ${S.crew.map(id => esc(personName(id))).join(', ')}</div>
      <div class="prog"><b>${doneN} of ${stops.length} done</b> <span class="muted small">${open ? '· On site: ' + esc(S.sites[open.siteId] ? S.sites[open.siteId].name : '') : next ? '· Next: ' + esc(next.site.name) : '· Route complete'}</span>
        <div class="bar"><b style="width:${stops.length ? doneN / stops.length * 100 : 0}%"></b></div></div>
      <div class="legs">${legs(stops.map(s => s.site)).map((l, i) => `<a class="btn sm" target="_blank" rel="noopener" href="${esc(l.url)}">Directions ${l.from === 0 ? 'Yard' : l.from}–${l.to} ↗</a>`).join('')}</div>
    </div>
    ${doneN === stops.length && stops.length ? '<div class="banner ok">✓ All stops done. Head back to the yard.</div>' : ''}
    <ol class="stops" style="--c:${esc(r.color || '#1d5fa8')}">${stops.map(s => stopHTML(s, vOf(s), open, next)).join('')}</ol>
    <div class="yardrow"><span class="num">Y</span><span>Back to ${esc(YARD.name)}</span></div>`;
  window.scrollTo(0, keepScroll);
  wireStops(stops, vOf, open); wireSearch();
  if ($('#goHome')) $('#goHome').onclick = () => { lsSet(PICK, home); lsSet(HOME, null); window.scrollTo(0, 0); render(); };
  if (gotoSite) { const li = $(`li.stop[data-site="${CSS.escape(gotoSite)}"]`); gotoSite = null;
    if (li) { li.scrollIntoView({ block: 'center' }); li.classList.add('flash'); setTimeout(() => li.classList.remove('flash'), 2500); } }
  tick = setInterval(() => $$('[data-since]').forEach(e => { e.textContent = dur(Date.now() - +e.dataset.since); }), 30000);
}

function noteHTML(site) {
  const rows = [];
  if (site.deadline) rows.push(`<div class="deadline">⚠ ${esc(site.deadline)}</div>`);
  if (site.access) rows.push(`<div><b>Access:</b> ${esc(site.access)}</div>`);
  if (site.piles) rows.push(`<div><b>Snow piles:</b> ${esc(site.piles)}</div>`);
  if (site.hazards) rows.push(`<div><b>Hazards:</b> ${esc(site.hazards)}</div>`);
  if (site.notes) rows.push(`<div><b>Notes:</b> ${esc(site.notes)}</div>`);
  return rows.length ? `<div class="notes">${rows.join('')}</div>` : '';
}

function stopHTML(s, vs, open, next) {
  const site = s.site, adr = addrList(site.addresses), multi = adr.length > 1;
  const mine = open && open.siteId === s.siteId ? open : null;
  const done = vs.filter(v => v.status === 'done');
  const cls = mine ? 'onsite' : done.length ? 'done' : (next && next.siteId === s.siteId ? 'next' : '');
  const tag = mine ? '<span class="tag on">ON SITE</span>' : done.length ? '' : (next && next.siteId === s.siteId ? '<span class="tag next">NEXT</span>' : '');
  const ticks = (mine && mine.addrTicks) || [];
  let addrs = '';
  if (adr.length) {
    addrs = (multi && !done.length ? `<div class="multitag">${adr.length} addresses – tick each</div>` : '') +
      `<ul class="addrs ${multi ? 'multi' : ''}">${adr.map((a, i) => {
        if (!multi) return `<li>${esc(a)}</li>`;
        const got = done.length && !mine ? true : !!ticks[i];
        return `<li class="${got ? 'got' : ''} ${mine ? '' : 'locked'}" ${mine ? `data-tick="${i}" role="checkbox" tabindex="0" aria-checked="${got}"` : ''}><span class="box">${got ? '✓' : ''}</span><span>${esc(a)}</span></li>`;
      }).join('')}</ul>`;
  }
  let act = '';
  if (mine) {
    const left = multi ? adr.filter((a, i) => !ticks[i]).length : 0, nf = !!mine.nfMs;
    act = `<div class="onsince">On site since ${t12(mine.startMs)} · <span data-since="${mine.startMs}">${dur(Date.now() - mine.startMs)}</span></div>
      <label class="conf ${nf ? 'got' : ''}" data-nf role="checkbox" tabindex="0" aria-checked="${nf}"><span class="box">${nf ? '✓' : ''}</span>Nektar Task &amp; FLHA</label>
      <div class="acts"><button type="button" class="btn ${left || !nf ? '' : 'go'} full" data-complete ${left || !nf ? 'disabled' : ''}>${left ? `Tick ${left === adr.length ? 'all ' + left : left + ' more'} address${left > 1 ? 'es' : ''}` : !nf ? 'Confirm Nektar Task & FLHA' : 'Complete site'}</button>
      <button type="button" class="link" data-cancel>Started by mistake? Cancel this visit</button></div>`;
  } else {
    const lines = done.map((v, i) => `<div>✓ ${done.length > 1 ? 'Visit ' + (i + 1) + ': ' : 'Done '}${t12(v.startMs)}–${t12(v.endMs)} · ${dur(v.endMs - v.startMs)}</div>`).join('');
    const blocked = open ? `Finish ${esc((S.sites[open.siteId] || {}).name || 'the open site')} first` : '';
    act = (lines ? `<div class="visits">${lines}</div>` : '') +
      (done.length ? `<div class="acts"><button type="button" class="link" data-start ${open ? 'disabled' : ''}>${open ? blocked : '+ Start another visit'}</button></div>`
        : `<div class="acts"><button type="button" class="btn ${next && next.siteId === s.siteId && !open ? 'go' : ''} full" data-start ${open ? 'disabled' : ''}>${open ? blocked : 'Start site'}</button></div>`);
  }
  return `<li class="stop ${cls}" data-site="${esc(s.siteId)}"><span class="num">${done.length && !mine ? '✓' : s.n}</span><div class="body">
    <div class="nm">${esc(site.name)}${tag}</div><div class="owner">${esc(site.owner || '')}</div>
    ${addrs}${noteHTML(site)}
    <div class="meta">${hrs(s.lo, s.hi) ? `<span>${hrs(s.lo, s.hi)}</span>` : ''}<a href="${esc(mapLink(site))}" target="_blank" rel="noopener">Map ↗</a>${site.mapFile ? `<a href="maps/${encodeURIComponent(site.mapFile)}" target="_blank" rel="noopener">Site map ↗</a>` : ''}</div>
    ${act}</div></li>`;
}

function wireStops(stops, vOf, open) {
  const me = myId();
  $$('li.stop').forEach(li => {
    const s = stops.find(x => x.siteId === li.dataset.site); if (!s) return;
    const mine = open && open.siteId === s.siteId ? open : null;
    const st = li.querySelector('[data-start]');
    if (st && !st.disabled) {
      const go = () => startVisit(s, vOf(s));
      if (st.classList.contains('link')) twoTap(st, 'Tap again to start another visit', go); else st.onclick = go;
    }
    if (!mine) return;
    const path = 'visits/' + mine.id;
    li.querySelectorAll('[data-tick]').forEach(el => {
      const go = () => { const t = (mine.addrTicks || []).slice(); const i = +el.dataset.tick; t[i] = !t[i]; for (let k = 0; k < t.length; k++) t[k] = !!t[k]; save(backend.update(path, { addrTicks: t })); };
      el.onclick = go; el.onkeydown = e => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); go(); } };
    });
    const nf = li.querySelector('[data-nf]');
    if (nf) { const go = () => save(backend.update(path, { nfMs: mine.nfMs ? null : Date.now() })); nf.onclick = go; nf.onkeydown = e => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); go(); } }; }
    const cb = li.querySelector('[data-complete]');
    if (cb && !cb.disabled) twoTap(cb, 'Tap again to lock', async () => {
      cb.disabled = true; cb.textContent = 'Saving… getting GPS';
      const endMs = Date.now(), geo = await getGeo();
      save(backend.update(path, { status: 'done', endMs, endSrv: backend.serverTime(), endBy: me, endGeo: geo, crew: S.crew }));
      toast(`✓ ${s.site.name} done`);
      setTimeout(() => { const nx = $('li.stop.next'); if (nx) nx.scrollIntoView({ block: 'center', behavior: 'smooth' }); }, 300);
    });
    const cx = li.querySelector('[data-cancel]');
    if (cx) twoTap(cx, 'Tap again to cancel this visit', () => save(backend.update(path, { status: 'cancelled', endMs: Date.now(), endBy: me })));
  });
}

async function startVisit(s, vs) {
  const btn = $(`li.stop[data-site="${CSS.escape(s.siteId)}"] [data-start]`);
  if (btn) { btn.disabled = true; btn.textContent = 'Starting… getting GPS'; }
  const startMs = Date.now(), geo = await getGeo();
  const id = backend.newId('visits');
  const adr = addrList(s.site.addresses);
  save(backend.set('visits/' + id, {
    eventId: S.event.id, routeId: S.route.id, siteId: s.siteId, n: vs.filter(v => v.status === 'done').length + 1, status: 'open',
    crew: S.crew, startMs, startSrv: backend.serverTime(), startBy: myId(), startGeo: geo, addrTicks: adr.length > 1 ? adr.map(() => false) : [], nfMs: null
  }));
}
function save(p) { if (p && p.catch) p.catch(e => toast(errText(e), 'bad')); }

/* ---------- Find a site (crews who do odd sites on other routes) ---------- */
function isHelping() { const h = lsGet(HOME, null), p = lsGet(PICK, null); return !!(h && p && (h.routeId !== p.routeId || h.eventId !== p.eventId)); }
function searchHTML() {
  return `<div class="search"><input id="q" type="search" placeholder="🔍 Find a site: name or address" autocomplete="off" value="${esc(query)}"><div id="qres"></div></div>`;
}
function wireSearch() {
  const q = $('#q'); if (!q) return;
  const show = () => { query = q.value; $('#qres').innerHTML = searchResults(query); $$('#qres [data-go]').forEach(b => b.onclick = () => goTo(b.dataset.e, b.dataset.r, b.dataset.go)); };
  q.oninput = show; if (query) show();
}
function searchResults(text) {
  const words = text.toLowerCase().split(/\s+/).filter(Boolean); if (!words.length) return '';
  const hits = Object.values(S.sites).filter(st => { const hay = [st.name, st.owner, ...addrList(st.addresses)].join(' ').toLowerCase(); return words.every(w => hay.includes(w)); }).slice(0, 12);
  if (!hits.length) return '<p class="small muted">No site matches. Check the spelling or try part of the address.</p>';
  return '<div class="sres">' + hits.map(st => {
    const on = S.active.flatMap(ev => evRoutes(ev).filter(r => (r.stops || []).some(x => x.siteId === st.id)).map(r => ({ ev, r })));
    const done = () => on.length && S.visits.some(v => v.siteId === st.id && v.status === 'done');
    return `<div class="sr"><b>${esc(st.name)}</b><div class="small muted">${esc(st.owner ? st.owner + ' · ' : '')}${addrList(st.addresses).map(esc).join(' / ')}</div>
      ${on.length ? `<div class="row">${on.map(({ ev, r }) => `<button class="btn sm" type="button" data-e="${esc(ev.id)}" data-r="${esc(r.id)}" data-go="${esc(st.id)}" style="border-left:5px solid ${esc(r.color || '#1d5fa8')}">${esc(r.label)}${S.active.length > 1 ? ' · ' + esc(ev.name || '') : ''} ›</button>`).join('')}</div>`
        : '<div class="small" style="color:var(--warn)">Not on tonight’s routes. Call the office before doing it.</div>'}
      ${done() ? '<div class="small" style="color:var(--ok)">✓ Already done tonight</div>' : ''}</div>`;
  }).join('') + '</div>';
}
function goTo(eventId, routeId, siteId) {
  const cur = lsGet(PICK, null), home = lsGet(HOME, null);
  // Remember their own route so they can get back to it; if they're going to their own route, they're not helping.
  if (!home) lsSet(HOME, cur || { eventId: null, routeId: null });   // no route of their own yet: they're just doing odd sites
  const h = lsGet(HOME, null);
  if (h && h.routeId === routeId && h.eventId === eventId) lsSet(HOME, null);
  const crew = cur ? S.crew : null;   // only carry over a crew they already confirmed on their own route
  lsSet(PICK, { eventId, routeId });
  if (crew && !lsGet('dr-crew-' + eventId + '-' + routeId, null) && lsGet(HOME, null)) lsSet('dr-crew-' + eventId + '-' + routeId, crew);
  query = ''; gotoSite = siteId; render();
}

/* ---------- Menu ---------- */
$('#menuBtn').onclick = () => {
  const b = $('#menuBody');
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent) && !window.navigator.standalone;
  b.innerHTML = `<p class="muted small">Signed in as <b>${esc(personName(myId()))}</b>${S.event ? ' · ' + esc(S.event.name || '') + ' (started ' + esc(dayTime(S.event.startMs)) + ')' : ''}</p>
    <div class="acts">
      ${S.event && S.route ? '<button class="btn full" data-m="route" type="button">Change route</button><button class="btn full" data-m="crew" type="button">Change tonight’s crew</button>' : ''}
      ${installEvt ? '<button class="btn full" data-m="install" type="button">Install app on this phone</button>' : ''}
      <button class="btn full danger" data-m="out" type="button">Sign out</button>
    </div>
    ${ios ? '<p class="small muted">To install on iPhone: tap the Share button in Safari, then “Add to Home Screen”.</p>' : ''}
    ${S.ident && S.ident.role === 'admin' ? '<p><a href="admin.html">Open office dashboard</a></p>' : ''}`;
  $$('[data-m]', b).forEach(x => x.onclick = async () => {
    const m = x.dataset.m; $('#menu').close();
    if (m === 'route') { lsSet(PICK, null); lsSet(HOME, null); render(); }
    if (m === 'crew') { lsSet(crewKey(), null); render(); }
    if (m === 'install' && installEvt) { installEvt.prompt(); installEvt = null; }
    if (m === 'out') backend.signOut();
  });
  $('#menu').showModal();
};
$('#menuClose').onclick = () => $('#menu').close();
