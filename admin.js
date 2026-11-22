// Office: live dashboard, snow events, reports, routes & sites, people & PINs, import/backup.
import { backend } from './backend.js';
import {
  $, $$, esc, t12, day, dayTime, dur, hrs, slug, addrList, mapLink, parseLatLon, twoTap, toast, errText,
  crewEmail, pinPassword, randPin, visitIndex, geoLink, metres, PLANS, lsGet, lsSet, drawRouteMap, YARD
} from './common.js';

const app = $('#app');
const S = { user: null, ident: null, me: null, events: [], viewEventId: null, repEventId: null, routes: [], sites: {}, people: [], visitsBy: {}, crewsBy: {}, watchers: {}, tab: lsGet('dr-admin-tab', 'dash'), unsubs: [] };
const OPEN_FLAG_MS = 3 * 3600e3, SHORT_MS = 5 * 60e3, FAR_M = 400;

function clear() { S.unsubs.forEach(u => { try { u(); } catch (e) {} }); S.unsubs = []; Object.values(S.watchers).forEach(u => { try { u(); } catch (e) {} }); S.watchers = {}; S.visitsBy = {}; }
$('#outBtn').onclick = () => backend.signOut();
$('#acctBtn').onclick = () => accountDialog();

backend.onAuth(async user => {
  clear(); S.user = user; $('#outBtn').hidden = $('#acctBtn').hidden = !user; $('#who').textContent = user ? user.email || '' : '';
  if (!user) return loginView();
  try { S.ident = await backend.get('uids/' + user.uid); } catch (e) { S.ident = null; }
  if (S.ident && S.ident.role === 'admin' && S.ident.active !== false) return start();
  // Signed in, but this login isn't linked to an office admin. Show what an admin needs to link it; the owner's very first setup lives behind a fold.
  app.innerHTML = `<div class="card" style="margin-top:20px"><h2>This login isn’t linked to the office yet</h2>
    <p>You’re signed in as <b>${esc(user.email || '')}</b>, but this login isn’t set up as an office admin.</p>
    <p>Ask an office admin to open <b>People &amp; PINs → Link login</b> and paste this login ID:</p>
    <div class="pinshow" style="font-size:1rem;letter-spacing:0;word-break:break-all">${esc(user.uid)}</div>
    <p><button class="btn" id="out2" type="button">Sign out</button></p>
    <details><summary class="small muted">First-time setup (the owner only)</summary>
      <p class="small">Only for the owner login named in the security rules, right after publishing them.</p>
      <label class="f" for="nm">Your full name</label><input id="nm" value="">
      <div class="err" id="serr"></div><button class="btn primary" id="fin" type="button">Finish setup</button></details></div>`;
  $('#out2').onclick = () => backend.signOut();
  $('#fin').onclick = async () => {
    const name = $('#nm').value.trim() || 'Owner', id = slug(name.split(' ')[0]);
    try {
      await backend.batch([
        { op: 'set', path: 'people/' + id, data: { name, role: 'admin', active: true, emailUid: user.uid, email: user.email || '' }, merge: true },
        { op: 'set', path: 'uids/' + user.uid, data: { personId: id, role: 'admin', active: true } }
      ]);
      location.reload();
    } catch (e) { $('#serr').textContent = /permission/.test(e.code || '') ? 'This login isn’t the owner login in the security rules. Check the rules were published with this login’s ID.' : errText(e); }
  };
});

function loginView() {
  app.innerHTML = `<div class="login"><div class="brand"><b>Office sign-in</b><span class="muted">Dispatch Routes</span></div>
    <label class="f" for="em">Email</label><input id="em" type="email" autocomplete="username">
    <label class="f" for="pw">Password</label><input id="pw" type="password" autocomplete="current-password">
    <div class="err" id="err"></div><button class="btn primary full" id="go" type="button">Sign in</button>
    <p><button class="link" id="forgot" type="button">Forgot password?</button></p>
    <p class="small muted">Crews sign in on the <a href="index.html">crew app</a> with their name and PIN.</p></div>`;
  const go = async () => { try { await backend.signIn($('#em').value.trim(), $('#pw').value); } catch (e) { $('#err').textContent = errText(e).replace('name and PIN', 'email and password'); } };
  $('#forgot').onclick = async () => {
    const em = $('#em').value.trim();
    if (!/^\S+@\S+\.\S+$/.test(em)) { $('#err').textContent = 'Type your email above first, then tap Forgot password.'; return; }
    try { await backend.resetPassword(em); } catch (e) { /* same message either way, so emails can't be probed */ }
    $('#err').textContent = ''; toast('If that email has an office login, a reset link is on its way. Check junk mail too.');
  };
  $('#go').onclick = go; $('#pw').onkeydown = e => { if (e.key === 'Enter') go(); };
}

/* ---------- Data ---------- */
function start() {
  S.me = S.ident.personId;
  const fail = e => toast(errText(e), 'bad');
  S.unsubs.push(backend.watchList('events', [], es => {
    S.events = es.sort((a, b) => (b.startMs || 0) - (a.startMs || 0));
    running().forEach(e => ensureVisits(e.id)); if (S.viewEventId) ensureVisits(S.viewEventId);
    draw();
  }, fail));
  S.unsubs.push(backend.watchList('routes', [], rs => { S.routes = rs.sort((a, b) => (a.order || 0) - (b.order || 0)); draw(); }, fail));
  S.unsubs.push(backend.watchList('sites', [], ss => { S.sites = Object.fromEntries(ss.map(s => [s.id, s])); draw(); }, fail));
  S.unsubs.push(backend.watchList('people', [], ps => { S.people = ps.sort((a, b) => a.name.localeCompare(b.name)); draw(); }, fail));
  setInterval(() => { if (S.tab === 'dash') draw(); }, 60000);
}
const running = () => S.events.filter(e => e.active === true).sort((a, b) => (a.startMs || 0) - (b.startMs || 0));
function ensureVisits(eid) {
  if (!eid || S.watchers[eid]) return;
  S.watchers[eid] = backend.watchList('visits', [['eventId', '==', eid]], vs => { S.visitsBy[eid] = vs; if (S.tab === 'dash' || S.tab === 'reports') draw(); });
  S.watchers[eid + '-crews'] = backend.watchList('crews', [['eventId', '==', eid]], cs => { S.crewsBy[eid] = Object.fromEntries(cs.map(c => [c.routeId, c])); if (S.tab === 'dash') draw(); });
}
const visitsOf = eid => S.visitsBy[eid] || [];
const pname = id => (S.people.find(p => p.id === id) || {}).name || id || '';
const first = id => pname(id).split(' ')[0];
const evRoutes = ev => !ev ? [] : S.routes.filter(r => (ev.routes ? ev.routes.includes(r.id) : [ev.plowPlan || 'plow', 'sidewalk', 'day'].includes(r.plan)) && (!r.archived || ev.routes));
const stopsOf = r => (r.stops || []).map((st, i) => ({ ...st, n: i + 1, site: S.sites[st.siteId] })).filter(s => s.site);
const evById = id => S.events.find(e => e.id === id) || null;
const fileSafe = t => String(t).replace(/[\\/:*?"<>|]/g, '-');

/* ---------- Shell ---------- */
const TABS = [['dash', 'Live dashboard'], ['events', 'Snow events'], ['reports', 'Reports'], ['routes', 'Routes & sites'], ['people', 'People & PINs'], ['data', 'Import & backup']];
let drawQueued = false;
function draw() { if (drawQueued) return; drawQueued = true; requestAnimationFrame(() => { drawQueued = false; drawNow(); }); }
function drawNowForce() { const ae = document.activeElement; if (ae && ae.blur) ae.blur(); drawNow(); }
function drawNow() {
  if (!S.ident || S.busy) return;
  if (document.activeElement && /INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName) && app.contains(document.activeElement) && S.tab !== 'dash') return; // don't wipe a form being typed in
  const y = window.scrollY, ae = document.activeElement, keepId = ae && ae.id && app.contains(ae) ? ae.id : null, caret = keepId && ae.selectionStart != null ? ae.selectionStart : null;
  app.innerHTML = `<nav class="otabs noprint" role="tablist">${TABS.map(([k, l]) => `<button role="tab" type="button" data-tab="${k}" aria-selected="${S.tab === k}">${l}</button>`).join('')}</nav><div id="pane"></div>`;
  $$('[data-tab]').forEach(b => b.onclick = () => { S.tab = b.dataset.tab; lsSet('dr-admin-tab', S.tab); drawNow(); });
  ({ dash, events, reports, routes: routesTab, people, data })[S.tab]($('#pane'));
  window.scrollTo(0, y);
  if (keepId) { const el = document.getElementById(keepId); if (el) { el.focus({ preventScroll: true }); if (caret != null && el.setSelectionRange) el.setSelectionRange(caret, caret); } }
}

/* ---------- Dialog ---------- */
function dialog(title, body, buttons) {
  const d = $('#dlg'); $('#dlgH').textContent = title; $('#dlgB').innerHTML = body; const f = $('#dlgF'); f.innerHTML = '';
  for (const b of buttons) {
    const el = document.createElement('button'); el.type = 'button'; el.className = 'btn ' + (b.cls || ''); el.textContent = b.label;
    if (b.two) twoTap(el, b.two, () => b.run(d)); else el.onclick = () => b.run ? b.run(d) : d.close();
    f.appendChild(el);
  }
  if (!d.open) d.showModal();
  return d;
}

/* ---------- Live dashboard ---------- */
function routeStats(r, vis) {
  const stops = stopsOf(r), vi = visitIndex(vis.filter(v => v.routeId === r.id));
  const vOf = s => vi[r.id + '|' + s.siteId] || [];
  const all = vis.filter(v => v.routeId === r.id && v.status !== 'cancelled');
  const open = all.find(v => v.status === 'open');
  const done = stops.filter(s => vOf(s).some(v => v.status === 'done'));
  const last = Math.max(0, ...all.map(v => Math.max(v.startMs || 0, v.endMs || 0)));
  const latest = all.slice().sort((a, b) => (b.startMs || 0) - (a.startMs || 0))[0];
  const flags = [];
  if (open && Date.now() - open.startMs > OPEN_FLAG_MS) flags.push(['red', `Open ${dur(Date.now() - open.startMs)}`]);
  const short = all.filter(v => v.status === 'done' && v.endMs - v.startMs < SHORT_MS).length; if (short) flags.push(['amber', `${short} under 5 min`]);
  const nogps = all.filter(v => v.status === 'done' && (!v.startGeo || !v.endGeo)).length; if (nogps) flags.push(['amber', `${nogps} no GPS`]);
  const far = all.filter(v => { const s = S.sites[v.siteId]; const d = metres(s, v.startGeo); return d != null && d > FAR_M; }).length; if (far) flags.push(['amber', `${far} started far from site`]);
  const nextS = stops.find(s => !vOf(s).some(v => v.status === 'done') && !(open && open.siteId === s.siteId));
  return { stops, vOf, all, open, done, last, latest, flags, nextS };
}
function dash(p) {
  const view = S.viewEventId ? evById(S.viewEventId) : null;
  const list = view ? [view] : running();
  if (!list.length) {
    const lastEv = S.events[0];
    p.innerHTML = `<div class="card"><h2>No snow event running</h2><p>Start one on the <b>Snow events</b> tab. Crews see their routes as soon as it starts.</p>
      ${lastEv ? `<p><button class="link" id="seeLast" type="button">See the last one: ${esc(lastEv.name)}</button></p>` : ''}</div>`;
    const sl = $('#seeLast'); if (sl) sl.onclick = () => { S.viewEventId = lastEv.id; ensureVisits(lastEv.id); drawNow(); };
    return;
  }
  p.innerHTML = (view ? `<p class="noprint"><button class="link" id="backLive" type="button">← Back to the running snow events</button></p>` : '') +
    `<div class="card noprint" style="padding:10px 12px"><input id="dashFind" type="search" placeholder="🔍 Find a site: name, client or address" value="${esc(dashFind)}" autocomplete="off"><div id="dashHits">${dashHits(list)}</div></div>` + list.map(ev => {
    const rs = evRoutes(ev), vis = visitsOf(ev.id);
    const tot = rs.reduce((a, r) => { const st = routeStats(r, vis); a.d += st.done.length; a.t += st.stops.length; a.o += st.open ? 1 : 0; return a; }, { d: 0, t: 0, o: 0 });
    return `<section style="margin-bottom:22px"><div class="row" style="justify-content:space-between;margin:6px 0"><div><h2 style="margin:0">${esc(ev.name || 'Snow event')}</h2>
        <div class="muted small">${ev.active === true ? '<b style="color:var(--ok)">● Running</b>' : 'Ended ' + esc(dayTime(ev.endMs))} · started ${esc(dayTime(ev.startMs))} by ${esc(first(ev.startedBy))} · ${rs.length} route${rs.length === 1 ? '' : 's'}</div></div>
        <div class="muted"><b>${tot.d} of ${tot.t}</b> sites done · ${tot.o} crew${tot.o === 1 ? '' : 's'} on site now</div></div>
      ${['quick', 'plow', 'drivelanes', 'sanding', 'sidewalk', 'day'].map(pl => { const l = rs.filter(r => r.plan === pl); if (!l.length) return '';
        return `<h3>${esc(PLANS[pl].label)}</h3><div class="grid">${l.map(r => routeCard(r, ev)).join('')}</div>`; }).join('')}</section>`;
  }).join('');
  const bl = $('#backLive'); if (bl) bl.onclick = () => { S.viewEventId = null; drawNow(); };
  const wire = () => $$('[data-rd]', p).forEach(b => b.onclick = () => routeDetail(b.dataset.rd, b.dataset.ev));
  $$('[data-qadd]', p).forEach(b => b.onclick = () => addForm(S.routes.find(x => x.id === b.dataset.qadd)));
  const f = $('#dashFind'); f.oninput = () => { dashFind = f.value; $('#dashHits').innerHTML = dashHits(list); wire(); };
  wire();
}
// Where is a site tonight? Status on every route it's on in the shown snow event(s), with who did it and when.
let dashFind = '';
function dashHits(list) {
  const words = dashFind.toLowerCase().split(/\s+/).filter(Boolean); if (!words.length) return '';
  const hits = Object.values(S.sites).filter(s => { const hay = [s.name, s.owner || '', ...addrList(s.addresses)].join(' ').toLowerCase(); return words.every(w => hay.includes(w)); }).slice(0, 10);
  if (!hits.length) return '<p class="small muted" style="margin:8px 0 0">No site matches.</p>';
  return '<div style="margin-top:6px">' + hits.map(s => {
    const rows = list.flatMap(ev => evRoutes(ev).filter(r => (r.stops || []).some(x => x.siteId === s.id)).map(r => {
      const vs = visitsOf(ev.id).filter(v => v.routeId === r.id && v.siteId === s.id && v.status !== 'cancelled').sort((a, b) => a.startMs - b.startMs);
      const open = vs.find(v => v.status === 'open'), done = vs.filter(v => v.status === 'done');
      const who = v => esc((v.crew || [v.startBy]).map(first).join(', '));
      const status = open ? `<b style="color:var(--accent)">On site</b> since ${t12(open.startMs)} (${dur(Date.now() - open.startMs)}) · ${who(open)}`
        : done.length ? done.map((v, i) => `<b style="color:var(--ok)">✓ ${done.length > 1 ? 'Visit ' + (i + 1) : 'Done'}</b> ${t12(v.startMs)}–${t12(v.endMs)} · ${dur(v.endMs - v.startMs)} · ${who(v)}`).join('<br>')
        : '<span class="muted">Not started</span>';
      return `<div class="row" style="justify-content:space-between;gap:8px;border-left:5px solid ${esc(r.color || '#1d5fa8')};padding:4px 0 4px 8px;margin-top:4px">
        <div class="small"><b>${esc(r.label)}</b>${list.length > 1 ? ' <span class="muted">· ' + esc(ev.name || '') + '</span>' : ''}<br>${status}</div>
        <button class="btn sm" type="button" data-rd="${esc(r.id)}" data-ev="${esc(ev.id)}">Details & fixes</button></div>`;
    }));
    return `<div class="stoprow" style="display:block;padding:8px 0;border-bottom:1px solid var(--line)"><b>${esc(s.name)}</b> <span class="muted small">${esc(s.owner || '')}${s.owner ? ' · ' : ''}${addrList(s.addresses).map(esc).join(' / ')}</span>
      ${rows.length ? rows.join('') : `<div class="small muted">Not on ${list.length > 1 ? 'any running snow event’s' : 'this snow event’s'} routes.</div>`}</div>`;
  }).join('') + '</div>';
}
function routeCard(r, ev) {
  const st = routeStats(r, visitsOf(ev.id));
  const ci = (S.crewsBy[ev.id] || {})[r.id];
  // No sign-on yet: use the latest visit by one of this route's own crew (not someone helping from another route).
  const own = st.all.filter(v => (r.members || []).includes(v.startBy)).sort((a, b) => (b.startMs || 0) - (a.startMs || 0))[0];
  const tonight = ci ? ci.crew : own ? own.crew : null;
  const crewLine = tonight && tonight.length
    ? `<b>Crew:</b> ${esc(tonight.map(pname).join(', '))}${ci ? ` <span class="muted">· signed on ${t12(ci.at)}${ci.by && ci.crew.length > 1 ? ' on ' + esc(first(ci.by)) + '’s phone' : ''}</span>` : ''}`
    : `<span class="muted">Usual crew: ${esc((r.members || []).map(pname).join(', ') || r.crewLabel || 'none set')}</span>`;
  const now = st.open ? `<div class="now" style="color:var(--accent)">On site: ${esc(S.sites[st.open.siteId] ? S.sites[st.open.siteId].name : '')} · ${dur(Date.now() - st.open.startMs)}</div>`
    : st.done.length === st.stops.length && st.stops.length ? `<div class="now" style="color:var(--ok)">✓ Route complete</div>`
    : st.all.length ? `<div class="now">Driving / between sites · next: ${esc(st.nextS ? st.nextS.site.name : '')}</div>` : `<div class="now muted">Not started</div>`;
  return `<div class="rcard" style="--c:${esc(r.color || '#1d5fa8')}"><div class="row" style="justify-content:space-between"><h3>${esc(r.label)}</h3><b>${st.done.length}/${st.stops.length}</b></div>
    <div class="crew">${crewLine}${r.machine ? ` <span class="muted">· ${esc(r.machine)}</span>` : ''}</div>
    <div class="prog"><div class="bar"><b style="width:${st.stops.length ? st.done.length / st.stops.length * 100 : 0}%"></b></div></div>
    ${now}<div class="small muted">${st.last ? 'Last activity ' + t12(st.last) + ' (' + dur(Date.now() - st.last) + ' ago)' : ''}</div>
    <div>${st.flags.map(([c, t]) => `<span class="flag ${c}">${esc(t)}</span>`).join('')}</div>
    <p style="margin:8px 0 0" class="row"><button class="btn sm" type="button" data-rd="${esc(r.id)}" data-ev="${esc(ev.id)}">Details & fixes</button>${r.temp && ev.active === true ? `<button class="btn sm" type="button" data-qadd="${esc(r.id)}">+ Add a site</button>` : ''}</p></div>`;
}
function visitLine(v, site) {
  const fl = [];
  if (v.status === 'open') fl.push(`<span class="flag amber">open ${dur(Date.now() - v.startMs)}</span>`);
  if (v.status === 'done' && v.endMs - v.startMs < SHORT_MS) fl.push('<span class="flag amber">under 5 min</span>');
  const d = metres(site, v.startGeo); if (d != null && d > FAR_M) fl.push(`<span class="flag amber">started ${d > 1500 ? (d / 1000).toFixed(1) + ' km' : d + ' m'} from site</span>`);
  if (v.editedBy) fl.push(`<span class="flag green">edited by ${esc(first(v.editedBy))}</span>`);
  return `${t12(v.startMs)}–${v.endMs ? t12(v.endMs) : '…'} ${v.endMs ? '· ' + dur(v.endMs - v.startMs) : ''} · ${esc((v.crew || [v.startBy]).map(first).join(', '))}
    ${v.nfMs ? ' · Nektar & FLHA ✓' : ''} ${v.startGeo ? `· <a href="${geoLink(v.startGeo)}" target="_blank" rel="noopener">start GPS</a>` : ''} ${v.endGeo ? `<a href="${geoLink(v.endGeo)}" target="_blank" rel="noopener">end GPS</a>` : ''} ${fl.join('')}`;
}
function routeDetail(rid, eid) {
  const r = S.routes.find(x => x.id === rid), ev = evById(eid); if (!r || !ev) return;
  const st = routeStats(r, visitsOf(eid));
  const body = `<p class="muted small">${esc(ev.name || '')}. Times are when the crew tapped Start and Complete.</p>` + st.stops.map(s => {
    const vs = st.vOf(s);
    return `<div class="stoprow"><span class="n">${s.n}</span><div><b>${esc(s.site.name)}</b> <span class="muted small">${esc(hrs(s.lo, s.hi))}</span>
      ${vs.length ? vs.map(v => `<div class="small">${v.status === 'done' ? '✓' : '●'} ${visitLine(v, s.site)}
        <span class="noprint">${v.status === 'open' ? `<button class="link" data-close="${v.id}" type="button">Close now</button> · ` : ''}<button class="link" data-edit="${v.id}" type="button">Edit times</button> · <button class="link" data-del="${v.id}" type="button">Delete</button></span></div>`).join('')
        : '<div class="small muted">Not visited</div>'}</div><span></span></div>`;
  }).join('');
  const canAdd = r.temp && ev.active === true;
  const d = dialog(`${r.label} · ${st.done.length}/${st.stops.length} done`, body, [...(canAdd ? [{ label: '+ Add a site', cls: 'primary', run: () => addForm(r, () => routeDetail(rid, eid)) }] : []), { label: 'Close' }]);
  $$('[data-close]', d).forEach(b => twoTap(b, 'Tap again to close it now', () => upd(b.dataset.close, { status: 'done', endMs: Date.now(), endBy: S.me, editedBy: S.me, editedMs: Date.now() }, rid, eid)));
  $$('[data-del]', d).forEach(b => twoTap(b, 'Tap again to delete this visit', () => backend.del('visits/' + b.dataset.del).then(() => { toast('Visit deleted'); routeDetail(rid, eid); }).catch(e => toast(errText(e), 'bad'))));
  $$('[data-edit]', d).forEach(b => b.onclick = () => editVisit(b.dataset.edit, rid, eid));
}
function upd(id, data, rid, eid) { backend.update('visits/' + id, data).then(() => { toast('Saved'); if (rid) setTimeout(() => routeDetail(rid, eid), 50); }).catch(e => toast(errText(e), 'bad')); }
const toLocal = ms => { if (!ms) return ''; const d = new Date(ms - new Date(ms).getTimezoneOffset() * 60000); return d.toISOString().slice(0, 16); };
function editVisit(id, rid, eid) {
  const v = visitsOf(eid).find(x => x.id === id); if (!v) return;
  dialog('Edit visit times', `<p class="muted small">${esc((S.sites[v.siteId] || {}).name || '')}. The report shows that you edited it.</p>
    <label class="f">Start</label><input type="datetime-local" id="vs" value="${toLocal(v.startMs)}">
    <label class="f">Complete</label><input type="datetime-local" id="ve" value="${toLocal(v.endMs)}">
    <label class="f"><input type="checkbox" id="vnf" ${v.nfMs ? 'checked' : ''} style="width:auto"> Nektar Task &amp; FLHA confirmed</label>`,
    [{ label: 'Cancel', run: () => routeDetail(rid, eid) }, { label: 'Save', cls: 'primary', run: () => {
      const s = new Date($('#vs').value).getTime(), e = $('#ve').value ? new Date($('#ve').value).getTime() : null;
      if (!s || (e && e < s)) return toast('Check the times', 'bad');
      upd(id, { startMs: s, endMs: e, status: e ? 'done' : 'open', nfMs: $('#vnf').checked ? (v.nfMs || e || s) : null, editedBy: S.me, editedMs: Date.now() }, rid, eid);
    } }]);
}

/* ---------- Snow events ---------- */
function events(p) {
  const run = running(), busy = {};
  for (const e of run) for (const r of evRoutes(e)) busy[r.id] = e;
  const def = 'Snow event – ' + day(Date.now()) + ' ' + t12(Date.now());
  const plans = ['plow', 'drivelanes', 'sanding', 'sidewalk', 'day'].map(pl => [pl, S.routes.filter(r => r.plan === pl && !r.archived && !r.hidden)]).filter(x => x[1].length);
  const hiddenN = S.routes.filter(r => !r.archived && r.hidden).length;
  p.innerHTML = `${run.length ? `<h2>Running now</h2>${run.map(e => `<div class="card"><div class="row" style="justify-content:space-between"><div><b>${esc(e.name)}</b>
        <div class="muted small">Started ${esc(dayTime(e.startMs))} · ${evRoutes(e).map(r => esc(r.label)).join(', ')}</div></div>
        <button class="btn danger" data-end="${e.id}" type="button">${e.quick ? 'End this quick job' : 'End this snow event'}</button></div></div>`).join('')}
      <p class="small muted">Save its report first if you want a copy (Reports tab).</p>` : ''}
    <div class="card"><h2>Start a snow event</h2>
      <p class="muted small">Tick the routes going out. You can run more than one snow event at once, for example sidewalks at 5 AM and plows at 8 PM. A route already in a running event can’t be added to another.</p>
      <label class="f" for="evn">Name</label><input id="evn" value="${esc(def)}">
      ${plans.map(([pl, rs]) => `<h3 class="row" style="justify-content:space-between">${esc(PLANS[pl].label)} <button class="link" data-all="${pl}" type="button">Select all</button></h3>
        <div class="checks">${rs.map(r => `<label style="${busy[r.id] ? 'opacity:.55' : ''}"><input type="checkbox" data-plan="${pl}" value="${r.id}" ${busy[r.id] ? 'disabled' : ''}>
          ${esc(r.label)}${r.crewLabel ? ' · ' + esc(r.crewLabel) : ''}${busy[r.id] ? ` <span class="small muted">(in ${esc(busy[r.id].name)})</span>` : ''}</label>`).join('')}</div>`).join('')}
      <p class="small muted">Full plow routes and drive lane routes use the same machines, so usually tick one or the other.${hiddenN ? ` ${hiddenN} hidden route${hiddenN > 1 ? 's aren’t' : ' isn’t'} listed; show ${hiddenN > 1 ? 'them' : 'it'} on Routes &amp; sites.` : ''}</p>
      <div class="err" id="everr"></div>
      <button class="btn go" id="startEv" type="button">Start snow event</button></div>
    ${quickJobCard()}
    <h2>Past snow events</h2>
    <div class="tscroll"><table class="t"><thead><tr><th>Name</th><th>Started</th><th>Ended</th><th>Routes</th><th></th></tr></thead><tbody>
    ${S.events.map(e => `<tr><td>${esc(e.name)}</td><td>${esc(dayTime(e.startMs))}</td><td>${e.active === true ? '<b>Running</b>' : esc(dayTime(e.endMs))}</td><td>${evRoutes(e).length}</td>
      <td><button class="link" data-view="${e.id}" type="button">View</button> · <button class="link" data-rep="${e.id}" type="button">Report</button>${canDeleteEvents() ? ` · <button class="link" data-editev="${e.id}" type="button">Edit</button>` : ''}${canDeleteEvents() && e.active !== true ? ` · <button class="link" data-delev="${e.id}" type="button" style="color:var(--warn)">Delete</button>` : ''}</td></tr>`).join('') || '<tr><td colspan="5" class="muted">None yet</td></tr>'}</tbody></table></div>`;
  $$('[data-all]', p).forEach(b => b.onclick = () => { const bs = $$(`input[data-plan="${b.dataset.all}"]:not(:disabled)`, p); const on = bs.some(x => !x.checked); bs.forEach(x => { x.checked = on; }); b.textContent = on ? 'Clear' : 'Select all'; });
  twoTap($('#startEv'), 'Tap again to start it', async () => {
    const routes = $$('input[data-plan]:checked', p).map(i => i.value);
    if (!routes.length) { $('#everr').textContent = 'Tick at least one route.'; return; }
    const id = backend.newId('events');
    try {
      await backend.set('events/' + id, { name: $('#evn').value.trim() || def, routes, startMs: Date.now(), startedBy: S.me, active: true });
      ensureVisits(id); S.viewEventId = null; S.tab = 'dash'; lsSet('dr-admin-tab', 'dash'); toast('Snow event started'); drawNow();
    } catch (e) { toast(errText(e), 'bad'); }
  });
  $$('[data-end]', p).forEach(b => twoTap(b, 'Tap again to end it', async () => {
    const ev = evById(b.dataset.end);
    // A quick job's route is only for that job: put it away when the job ends (it stays in that event's report).
    const temp = S.routes.filter(r => r.temp && (ev.routes || []).includes(r.id)).map(r => ({ op: 'update', path: 'routes/' + r.id, data: { archived: true } }));
    try { await backend.batch([{ op: 'update', path: 'events/' + b.dataset.end, data: { active: false, endMs: Date.now(), endedBy: S.me } }, ...temp]); toast(temp.length ? 'Quick job ended' : 'Snow event ended'); } catch (e) { toast(errText(e), 'bad'); }
  }));
  wireQuickJob(p);
  $$('[data-editev]', p).forEach(b => b.onclick = () => editEvent(b.dataset.editev));
  $$('[data-delev]', p).forEach(b => twoTap(b, 'Tap again to delete for good', () => deleteEvent(b.dataset.delev)));
  $$('[data-view]', p).forEach(b => b.onclick = () => { S.viewEventId = b.dataset.view; ensureVisits(S.viewEventId); S.tab = 'dash'; drawNow(); });
  $$('[data-rep]', p).forEach(b => b.onclick = () => { S.repEventId = b.dataset.rep; ensureVisits(S.repEventId); S.tab = 'reports'; drawNow(); });
}

/* Editing and deleting snow events is for Jody only.
   The app hides the button from everyone else; firestore.rules also limits deleting events to the owner login. */
function canDeleteEvents() {
  const me = S.people.find(x => x.id === S.me);
  return !!me && /^jody\b/i.test((me.name || '').trim());
}
async function deleteEvent(eid) {
  const ev = evById(eid);
  if (!ev || ev.active === true || !canDeleteEvents()) return;
  try {
    const [vs, cs] = await Promise.all([backend.list('visits', [['eventId', '==', eid]]), backend.list('crews', [['eventId', '==', eid]])]);
    const ops = [...vs.map(v => ({ op: 'delete', path: 'visits/' + v.id })), ...cs.map(c => ({ op: 'delete', path: 'crews/' + c.id }))];
    for (let i = 0; i < ops.length; i += 400) await backend.batch(ops.slice(i, i + 400));
    await backend.del('events/' + eid);
    if (S.watchers[eid]) { try { S.watchers[eid](); } catch (e) {} delete S.watchers[eid]; }
    if (S.watchers[eid + '-crews']) { try { S.watchers[eid + '-crews'](); } catch (e) {} delete S.watchers[eid + '-crews']; }
    delete S.visitsBy[eid]; delete S.crewsBy[eid];
    if (S.viewEventId === eid) S.viewEventId = null;
    if (S.repEventId === eid) S.repEventId = null;
    toast('Snow event deleted');
  } catch (e) { toast(errText(e), 'bad'); }
}

/* Jody only: change a snow event's name, start and end times, and which routes are in it. */
function editEvent(eid) {
  const ev = evById(eid); if (!ev || !canDeleteEvents()) return;
  const cur = new Set(evRoutes(ev).map(r => r.id));
  const busy = {}; for (const e of running()) if (e.id !== eid) for (const r of evRoutes(e)) busy[r.id] = e;
  const vis = visitsOf(eid);
  const plans = Object.keys(PLANS).map(pl => [pl, S.routes.filter(r => r.plan === pl && (cur.has(r.id) || (!r.archived && !r.hidden)))]).filter(x => x[1].length);
  const body = `<label class="f" for="eeN">Name</label><input id="eeN" value="${esc(ev.name || '')}">
    <label class="f" for="eeS">Started</label><input id="eeS" type="datetime-local" value="${toLocal(ev.startMs)}">
    ${ev.active === true ? '<p class="small muted">Still running: end it from the Snow events tab.</p>' : `<label class="f" for="eeE">Ended</label><input id="eeE" type="datetime-local" value="${toLocal(ev.endMs)}">`}
    ${plans.map(([pl, rs]) => `<h3>${esc(PLANS[pl].label)}</h3><div class="checks">${rs.map(r => {
      const n = vis.filter(v => v.routeId === r.id && v.status !== 'cancelled').length, dis = ev.active === true && busy[r.id] && !cur.has(r.id);
      return `<label style="${dis ? 'opacity:.55' : ''}"><input type="checkbox" data-eer value="${r.id}" ${cur.has(r.id) ? 'checked' : ''} ${dis ? 'disabled' : ''}>${esc(r.label)}${r.crewLabel ? ' · ' + esc(r.crewLabel) : ''}${n ? ` <span class="small muted">(${n} site visit${n > 1 ? 's' : ''} logged)</span>` : ''}</label>`; }).join('')}</div>`).join('')}
    <p class="small muted">Taking a route out hides its logged visits from this event’s dashboard and report. Ticking it again brings them back.</p><div class="err" id="eeErr"></div>`;
  dialog('Edit snow event', body, [{ label: 'Cancel' }, { label: 'Save', cls: 'primary', run: async d => {
    const routes = $$('input[data-eer]:checked', d).map(i => i.value);
    const sMs = $('#eeS').value ? new Date($('#eeS').value).getTime() : ev.startMs;
    const eMs = $('#eeE') && $('#eeE').value ? new Date($('#eeE').value).getTime() : ev.endMs;
    if (!routes.length) { $('#eeErr').textContent = 'Keep at least one route.'; return; }
    if (ev.active !== true && eMs && sMs && eMs < sMs) { $('#eeErr').textContent = 'The end time is before the start time.'; return; }
    const data = { name: $('#eeN').value.trim() || ev.name, startMs: sMs, routes };
    if (ev.active !== true && eMs) data.endMs = eMs;
    try { await backend.update('events/' + eid, data); ensureVisits(eid); d.close(); toast('Snow event saved'); } catch (e) { $('#eeErr').textContent = errText(e); }
  } }]);
}

/* ---------- Quick job: a one-off route with just the sites you pick, run as its own event ---------- */
const QJ = { name: '', sites: [], crew: [], q: '' };
const qjDefault = () => 'Quick job – ' + day(Date.now()) + ' ' + t12(Date.now());
function quickJobCard() {
  const ppl = S.people.filter(x => x.active !== false).sort((a, b) => a.name.localeCompare(b.name));
  return `<div class="card" id="qjCard"><h2>Quick job</h2>
    <p class="muted small">For one-off work: only the sites you pick go out, as their own route and their own event, so the report shows just those sites. Crews see it at the top of their route list.</p>
    <label class="f" for="qjName">Name</label><input id="qjName" value="${esc(QJ.name)}" placeholder="${esc(qjDefault())}">
    <label class="f" for="qjFind">Add sites</label><input id="qjFind" type="search" value="${esc(QJ.q)}" placeholder="Search a site name, client or address" autocomplete="off">
    <div id="qjHits"></div>
    <p class="small" style="margin:6px 0"><button class="link" id="qjNew" type="button">+ Site isn’t in the list: add a new site</button></p>
    <div id="qjList">${qjListHTML()}</div>
    <details style="margin-top:10px" ${QJ.crew.length ? 'open' : ''}><summary><b>Who’s going</b> <span class="muted small">(optional: it shows as their route at the top of the crew app)</span></summary>
      <div class="checks" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(190px,1fr));gap:4px 8px">${ppl.map(x => `<label style="margin:0;padding:6px 8px"><input type="checkbox" data-qjc="${esc(x.id)}" ${QJ.crew.includes(x.id) ? 'checked' : ''}>${esc(x.name)}</label>`).join('')}</div></details>
    <div class="err" id="qjErr"></div>
    <button class="btn go" id="qjGo" type="button">Start quick job</button></div>`;
}
function qjListHTML() {
  if (!QJ.sites.length) return '<p class="small muted">No sites added yet.</p>';
  return `<ol class="small" style="padding-left:20px">${QJ.sites.map((id, i) => { const s = S.sites[id] || { name: id };
    return `<li style="margin:4px 0"><b>${esc(s.name)}</b> <span class="muted">${addrList(s.addresses).map(esc).join(' / ')}</span> <button class="link" data-qjrm="${i}" type="button">Remove</button></li>`; }).join('')}</ol>`;
}
function qjHitsHTML() {
  const words = QJ.q.toLowerCase().split(/\s+/).filter(Boolean); if (!words.length) return '';
  const hits = Object.values(S.sites).filter(s => { const hay = [s.name, s.owner || '', ...addrList(s.addresses)].join(' ').toLowerCase(); return words.every(w => hay.includes(w)); }).slice(0, 8);
  if (!hits.length) return '<p class="small muted">No site matches. Use “add a new site” below.</p>';
  return hits.map(s => `<div class="row" style="justify-content:space-between;border-bottom:1px solid var(--line);padding:5px 0"><span class="small"><b>${esc(s.name)}</b> <span class="muted">${esc(s.owner || '')}${s.owner ? ' · ' : ''}${addrList(s.addresses).map(esc).join(' / ')}</span></span>
    ${QJ.sites.includes(s.id) ? '<span class="small muted">Added</span>' : `<button class="btn sm" data-qjadd="${esc(s.id)}" type="button">+ Add</button>`}</div>`).join('');
}
function wireQuickJob(p) {
  if (!$('#qjCard')) return;
  const refresh = () => {
    $('#qjHits').innerHTML = qjHitsHTML(); $('#qjList').innerHTML = qjListHTML();
    $$('[data-qjadd]', p).forEach(b => b.onclick = () => { QJ.sites.push(b.dataset.qjadd); refresh(); });
    $$('[data-qjrm]', p).forEach(b => b.onclick = () => { QJ.sites.splice(+b.dataset.qjrm, 1); refresh(); });
  };
  $('#qjName').oninput = e => { QJ.name = e.target.value; };
  $('#qjFind').oninput = e => { QJ.q = e.target.value; refresh(); };
  $$('[data-qjc]', p).forEach(c => c.onchange = () => { QJ.crew = $$('[data-qjc]:checked', p).map(x => x.dataset.qjc); });
  refresh();
  $('#qjNew').onclick = () => dialog('New site for this quick job', siteFields({ name: QJ.q }, {}), [{ label: 'Cancel' }, { label: 'Add site', cls: 'primary', run: async d => {
    const v = readSite(null); if (!v) return;
    let id = slug(v.site.name) || 'site'; while (S.sites[id]) id += '-2';
    try { await backend.set('sites/' + id, v.site); S.sites[id] = { id, ...v.site }; QJ.sites.push(id); QJ.q = ''; d.close(); drawNow(); toast('Site added'); } catch (e) { toast(errText(e), 'bad'); }
  } }]);
  twoTap($('#qjGo'), 'Tap again to send it out', async () => {
    if (!QJ.sites.length) { $('#qjErr').textContent = 'Add at least one site.'; return; }
    const name = QJ.name.trim() || qjDefault();
    // Planned hours: copy from the site's regular route if it has one.
    const stops = QJ.sites.map(id => { const st = S.routes.filter(r => !r.archived && !r.temp).flatMap(r => r.stops || []).find(x => x.siteId === id) || {}; return { siteId: id, lo: st.lo ?? null, hi: st.hi ?? st.lo ?? null }; });
    const rid = backend.newId('routes'), eid = backend.newId('events');
    try {
      await backend.batch([
        { op: 'set', path: 'routes/' + rid, data: { plan: 'quick', temp: true, label: name, order: 0, color: '#7c3aed', area: 'Quick job', crewLabel: QJ.crew.map(first).join(' & '), machine: '', members: QJ.crew, stops, archived: false, hidden: false } },
        { op: 'set', path: 'events/' + eid, data: { name, routes: [rid], startMs: Date.now(), startedBy: S.me, active: true, quick: true } }]);
      QJ.name = ''; QJ.sites = []; QJ.crew = []; QJ.q = '';
      ensureVisits(eid); S.viewEventId = null; S.tab = 'dash'; lsSet('dr-admin-tab', 'dash'); toast('Quick job sent out'); drawNow();
    } catch (e) { toast(errText(e), 'bad'); }
  });
}

/* ---------- Reports ---------- */
function reportRows(ev, routeId) {
  const rows = [], vis = visitsOf(ev.id);
  for (const r of evRoutes(ev).filter(r => !routeId || r.id === routeId)) {
    const st = routeStats(r, vis);
    for (const s of st.stops) {
      const vs = st.vOf(s);
      if (!vs.length) rows.push({ r, s, v: null });
      vs.forEach(v => rows.push({ r, s, v }));
    }
  }
  return rows;
}
function rowFlags(s, v) {
  if (!v) return 'NOT DONE';
  const f = [];
  if (v.status === 'open') f.push('Still open');
  if (v.status === 'done' && v.endMs - v.startMs < SHORT_MS) f.push('Under 5 min');
  if (!v.startGeo || (v.status === 'done' && !v.endGeo)) f.push('No GPS');
  const d = metres(s.site, v.startGeo); if (d != null && d > FAR_M) f.push(`Started ${d} m from site`);
  if (v.editedBy) f.push('Edited by ' + first(v.editedBy));
  return f.join('; ');
}
function reports(p) {
  const ev = evById(S.repEventId) || running()[0] || S.events[0] || null;
  if (ev) ensureVisits(ev.id);
  p.innerHTML = `<div class="card noprint"><div class="row">
    <label class="grow">Snow event<select id="rev">${S.events.map(e => `<option value="${e.id}" ${ev && e.id === ev.id ? 'selected' : ''}>${esc(e.name)}${e.active === true ? ' (running)' : ''}</option>`).join('')}</select></label>
    <label class="grow">Route<select id="rrt"><option value="">All routes</option>${evRoutes(ev).map(r => `<option value="${r.id}">${esc(PLANS[r.plan].short)} · ${esc(r.label)}</option>`).join('')}</select></label></div>
    <p class="row"><button class="btn" id="rcsv" type="button">Save for Excel (.csv)</button><button class="btn" id="rprint" type="button">Print</button></p></div><div id="rbody"></div>`;
  if (!ev) { $('#rbody').innerHTML = '<p class="muted">No snow events yet.</p>'; return; }
  $('#rev').onchange = () => { S.repEventId = $('#rev').value; ensureVisits(S.repEventId); $('#rev').blur(); drawNow(); };
  const body = () => {
    const rows = reportRows(ev, $('#rrt').value), doneN = rows.filter(x => x.v && x.v.status === 'done').length;
    $('#rbody').innerHTML = `<h2>${esc(ev.name)}</h2><p class="muted">Started ${esc(dayTime(ev.startMs))}${ev.endMs ? ' · ended ' + esc(dayTime(ev.endMs)) : ''} · ${doneN} completed visits · ${rows.filter(x => !x.v).length} sites not done</p>
      <div class="tscroll"><table class="t"><thead><tr><th>Route</th><th>#</th><th>Site</th><th>Address(es)</th><th>Visit</th><th>Start</th><th>Complete</th><th>Time on site</th><th>Planned</th><th>Crew</th><th>Nektar &amp; FLHA</th><th>GPS</th><th>Flags</th></tr></thead><tbody>
      ${rows.map(({ r, s, v }) => `<tr style="${v ? '' : 'background:var(--warn-bg)'}"><td>${esc(r.label)}</td><td>${s.n}</td><td><b>${esc(s.site.name)}</b></td><td>${addrList(s.site.addresses).map(esc).join('<br>')}</td>
        <td>${v ? v.n || 1 : ''}</td><td>${v ? esc(dayTime(v.startMs)) : ''}</td><td>${v && v.endMs ? esc(dayTime(v.endMs)) : ''}</td><td>${v && v.endMs ? dur(v.endMs - v.startMs) : ''}</td><td>${esc(hrs(s.lo, s.hi))}</td>
        <td>${v ? esc((v.crew || []).map(first).join(', ')) : ''}</td><td>${v && v.nfMs ? 'Confirmed' : ''}</td>
        <td>${v && v.startGeo ? `<a href="${geoLink(v.startGeo)}" target="_blank" rel="noopener">start</a>` : ''} ${v && v.endGeo ? `<a href="${geoLink(v.endGeo)}" target="_blank" rel="noopener">end</a>` : ''}</td>
        <td>${esc(rowFlags(s, v))}</td></tr>`).join('')}</tbody></table></div>`;
  };
  $('#rrt').onchange = body; body();
  $('#rprint').onclick = () => window.print();
  $('#rcsv').onclick = () => {
    const rows = reportRows(ev, $('#rrt').value), q = x => `"${String(x ?? '').replace(/"/g, '""')}"`;
    const out = [['Snow event', 'Route', 'Stop #', 'Site', 'Client', 'Address(es)', 'Visit #', 'Start', 'Complete', 'Minutes on site', 'Planned hrs', 'Crew', 'Nektar & FLHA', 'Start GPS', 'Complete GPS', 'Flags'].map(q).join(',')];
    for (const { r, s, v } of rows) out.push([ev.name, r.label, s.n, s.site.name, s.site.owner, addrList(s.site.addresses).join(' / '), v ? v.n || 1 : '', v ? dayTime(v.startMs) : '', v && v.endMs ? dayTime(v.endMs) : '',
      v && v.endMs ? Math.round((v.endMs - v.startMs) / 60000) : '', hrs(s.lo, s.hi), v ? (v.crew || []).map(pname).join(', ') : '', v && v.nfMs ? 'Confirmed' : '',
      v && v.startGeo ? `${v.startGeo.lat},${v.startGeo.lon}` : '', v && v.endGeo ? `${v.endGeo.lat},${v.endGeo.lon}` : '', rowFlags(s, v)].map(q).join(','));
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob(['﻿' + out.join('\r\n')], { type: 'text/csv' }));
    a.download = `${fileSafe(ev.name)}${$('#rrt').value ? ' - ' + fileSafe($('#rrt').selectedOptions[0].textContent) : ''}.csv`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  };
}

/* ---------- Routes & sites ---------- */
let rsPlan = lsGet('dr-rs-plan', 'sidewalk'), rsRoute = lsGet('dr-rs-route', null), rsFind = '';
function routeOverviewCard(r) {
  const stops = stopsOf(r);
  const lo = stops.reduce((a, s) => a + (s.lo || 0), 0), hi = stops.reduce((a, s) => a + (s.hi ?? s.lo ?? 0), 0);
  const noHrs = stops.filter(s => s.lo == null).length, est = stops.filter(s => s.site.pinExact === false).length, dl = stops.filter(s => s.site.deadline).length;
  const crew = (r.members || []).map(pname).join(', ');
  return `<div class="rcard" style="--c:${esc(r.color || '#1d5fa8')};${r.hidden ? 'opacity:.6' : ''}"><div class="row" style="justify-content:space-between"><h3>${esc(r.label)}${r.hidden ? ' <span class="flag amber">Hidden</span>' : ''}</h3><b>${stops.length} stops</b></div>
    <div class="crew">${crew ? esc(crew) : `<span class="muted">${esc(r.crewLabel || 'No usual crew set')}</span>`}${r.machine ? ` <span class="muted">· ${esc(r.machine)}</span>` : ''}</div>
    <div class="small muted" style="margin-top:4px">${esc(r.area || '')}</div>
    ${r.plan !== 'drivelanes' && lo ? `<div class="small" style="margin-top:4px">Planned: <b>${lo === hi ? lo : lo + '–' + hi} hrs</b> on site</div>` : ''}
    <div>${dl ? `<span class="flag red">${dl} deadline${dl > 1 ? 's' : ''}</span>` : ''}${est ? `<span class="flag amber">${est} pin${est > 1 ? 's' : ''} estimated</span>` : ''}${r.plan !== 'drivelanes' && noHrs ? `<span class="flag amber">${noHrs} without hours</span>` : ''}</div>
    <p class="row" style="margin:8px 0 0"><button class="btn sm" type="button" data-open="${esc(r.id)}">Open route</button><button class="btn sm" type="button" data-hide="${esc(r.id)}">${r.hidden ? 'Show to crews' : 'Hide'}</button></p></div>`;
}
/* ---------- All-routes map on Routes & sites: every route's sites in its route colour, filtered by type ---------- */
const MAP_PLANS = ['plow', 'drivelanes', 'sanding', 'sidewalk', 'day'];
let allMapView = null;
function allMapHTML() {
  const cur = lsGet('dr-allmap-plan', 'plow'), open = lsGet('dr-allmap-open', true);
  const plans = MAP_PLANS.filter(pl => S.routes.some(x => x.plan === pl && !x.archived));
  return `<details class="mapbox card noprint" id="allMap" ${open ? 'open' : ''}><summary>Map of all routes and sites</summary>
    <div class="row" style="margin:6px 0;flex-wrap:wrap">${plans.map(pl => `<button class="btn sm ${pl === cur ? 'primary' : ''}" data-mapplan="${pl}" type="button">${esc(PLANS[pl].label)}</button>`).join('')}</div>
    <div id="allRmap" class="rmap" style="height:480px"></div>
    <div id="allMapKey" class="maplegend"></div>
    <p class="small muted" style="margin:4px 0 0">Each colour is one route; numbers are the stop order. Tap a pin for the site, or a route name below the map to open it.</p></details>`;
}
function loadLeafletOnce() {
  if (window.L) return Promise.resolve(window.L);
  return new Promise((ok, bad) => {
    if (!document.querySelector('link[href*="leaflet.css"]')) { const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css'; document.head.appendChild(l); }
    const sc = document.createElement('script'); sc.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js'; sc.onload = () => ok(window.L); sc.onerror = bad; document.head.appendChild(sc);
  });
}
async function drawAllMap() {
  const el = $('#allRmap'); if (!el) return;
  const plan = lsGet('dr-allmap-plan', 'plow');
  const routes = S.routes.filter(x => x.plan === plan && !x.archived).sort((a, b) => (a.order || 0) - (b.order || 0));
  let L; try { L = await loadLeafletOnce(); } catch (e) { el.innerHTML = '<p class="small muted" style="padding:12px">The map needs an internet connection to load.</p>'; return; }
  if (!el.isConnected) return;
  if (el._map) { el._map.remove(); el._map = null; }
  const map = L.map(el, { scrollWheelZoom: false }); el._map = map;
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '&copy; OpenStreetMap' }).addTo(map);
  const yard = [YARD.lat, YARD.lon], all = [yard];
  const pin = (label, bg) => L.divIcon({ className: 'rpin', html: `<span style="background:${bg}">${label}</span>`, iconSize: [26, 26], iconAnchor: [13, 13], popupAnchor: [0, -12] });
  L.marker(yard, { icon: pin('Y', '#1f2a36'), zIndexOffset: 2000 }).addTo(map).bindPopup(`<b>${esc(YARD.name)}</b><br>${esc(YARD.address)}`);
  for (const r of routes) {
    const color = r.color || '#1d5fa8';
    const pts = stopsOf(r).filter(s => s.site.lat != null && s.site.lon != null);
    if (!pts.length) continue;
    const line = [yard, ...pts.map(s => [s.site.lat, s.site.lon])];
    L.polyline(line, { color, weight: 3, opacity: 0.7, dashArray: '6 6' }).addTo(map);
    for (const s of pts) {
      all.push([s.site.lat, s.site.lon]);
      L.marker([s.site.lat, s.site.lon], { icon: pin(s.n, color) }).addTo(map)
        .bindPopup(`<b>${esc(r.label)} · stop ${s.n}</b><br>${esc(s.site.name)}${s.site.owner ? '<br>' + esc(s.site.owner) : ''}<br>${addrList(s.site.addresses).map(esc).join('<br>')}`);
    }
  }
  if (allMapView && allMapView.plan === plan) map.setView(allMapView.c, allMapView.z); else map.fitBounds(L.latLngBounds(all), { padding: [24, 24] });
  map.on('moveend', () => { allMapView = { plan, c: map.getCenter(), z: map.getZoom() }; });
  setTimeout(() => map.invalidateSize(), 50);
  const key = $('#allMapKey');
  if (key) {
    key.innerHTML = routes.map(r => `<button class="link" data-open="${esc(r.id)}" type="button" style="color:inherit;text-decoration:none"><i style="background:${esc(r.color || '#1d5fa8')}"></i>${esc(r.label)}${r.crewLabel ? ' · ' + esc(r.crewLabel) : ''}</button>`).join('');
    $$('[data-open]', key).forEach(b => b.onclick = () => { rsRoute = b.dataset.open; lsSet('dr-rs-route', rsRoute); window.scrollTo(0, 0); drawNow(); });
  }
}
function wireAllMap(p) {
  const box = $('#allMap', p); if (!box) return;
  let was = box.open;
  box.addEventListener('toggle', () => { if (box.open === was) return; was = box.open; lsSet('dr-allmap-open', box.open); if (box.open) drawAllMap(); });
  $$('[data-mapplan]', box).forEach(b => b.onclick = () => { lsSet('dr-allmap-plan', b.dataset.mapplan); $$('[data-mapplan]', box).forEach(x => x.classList.toggle('primary', x === b)); drawAllMap(); });
  if (box.open) drawAllMap();
}

function routesTab(p) {
  const r = rsRoute ? S.routes.find(x => x.id === rsRoute && !x.archived) : null;
  if (!r) {
    // Overview: every route as a card, grouped by plan, plus a site finder.
    const q = rsFind.trim().toLowerCase();
    const hits = q ? Object.values(S.sites).filter(s => (s.name + ' ' + (s.owner || '') + ' ' + (s.addresses || []).join(' ')).toLowerCase().includes(q)).slice(0, 12) : [];
    p.innerHTML = `<div class="card noprint"><label class="f" for="rsFind" style="margin-top:0">Find a site</label>
        <input id="rsFind" placeholder="Site name, client or address" value="${esc(rsFind)}" autocomplete="off">
        <div id="rsHits">${q ? (hits.map(s => `<div class="stoprow" style="grid-template-columns:minmax(0,1fr) auto"><div><b>${esc(s.name)}</b> <span class="muted small">${esc(s.owner || '')} · ${addrList(s.addresses).map(esc).join(' / ')}</span></div>
          <div class="row">${S.routes.filter(x => !x.archived && (x.stops || []).some(y => y.siteId === s.id)).map(x => `<button class="btn sm" data-open="${esc(x.id)}" type="button" style="border-color:${esc(x.color || '#1d5fa8')}">${esc(PLANS[x.plan].short)} · ${esc(x.label)}</button>`).join('') || '<span class="small muted">Not on any route</span>'}</div></div>`).join('') || '<p class="small muted">No sites match.</p>') : ''}</div></div>` + allMapHTML() +
      ['plow', 'drivelanes', 'sanding', 'sidewalk', 'day'].map(pl => {
        const list = S.routes.filter(x => x.plan === pl && !x.archived);
        const allHidden = list.length && list.every(x => x.hidden);
        return `<div class="row" style="justify-content:space-between;margin-top:14px"><h2 style="margin:0">${esc(PLANS[pl].label)}${allHidden ? ' <span class="flag amber">Hidden from crews</span>' : ''}</h2>
          <div class="row">${list.length ? `<button class="btn sm" data-hideall="${pl}" data-to="${allHidden ? 'show' : 'hide'}" type="button">${allHidden ? 'Show all' : 'Hide all'}</button>` : ''}<button class="btn sm" data-new="${pl}" type="button">+ New route</button></div></div>
          <div class="grid" style="margin-top:8px">${list.map(routeOverviewCard).join('') || '<p class="muted">No routes yet.</p>'}</div>`;
      }).join('');
    const f = $('#rsFind');
    f.oninput = () => { rsFind = f.value; const pos = f.selectionStart; drawNowForce(); const g = $('#rsFind'); if (g) { g.focus(); g.setSelectionRange(pos, pos); } };
    $$('[data-open]', p).forEach(b => b.onclick = () => { rsRoute = b.dataset.open; lsSet('dr-rs-route', rsRoute); window.scrollTo(0, 0); drawNow(); });
    $$('[data-new]', p).forEach(b => b.onclick = () => { rsPlan = b.dataset.new; lsSet('dr-rs-plan', rsPlan); routeForm(null); });
    const busy = new Set(running().flatMap(e => evRoutes(e).map(x => x.id)));
    const setHidden = async (ids, hide) => {
      if (hide && ids.some(id => busy.has(id))) return toast('A route in a running snow event can’t be hidden. End that event first.', 'bad');
      try { await backend.batch(ids.map(id => ({ op: 'update', path: 'routes/' + id, data: { hidden: hide } }))); toast(hide ? 'Hidden from crews' : 'Showing to crews'); } catch (e) { toast(errText(e), 'bad'); }
    };
    $$('[data-hide]', p).forEach(b => b.onclick = () => { const x = S.routes.find(y => y.id === b.dataset.hide); setHidden([x.id], !x.hidden); });
    $$('[data-hideall]', p).forEach(b => twoTap(b, b.dataset.to === 'hide' ? 'Tap again to hide all' : 'Tap again to show all', () =>
      setHidden(S.routes.filter(x => x.plan === b.dataset.hideall && !x.archived).map(x => x.id), b.dataset.to === 'hide')));
    wireAllMap(p);
    return;
  }
  rsPlan = r.plan;
  p.innerHTML = `<p class="noprint"><button class="link" id="rsBack" type="button">← All routes</button> <span class="muted small">· ${esc(PLANS[r.plan].label)}</span></p><div id="rsBody"></div>`;
  $('#rsBack').onclick = () => { rsRoute = null; lsSet('dr-rs-route', null); drawNow(); };
  const stops = stopsOf(r), crewNames = (r.members || []).map(pname).join(', ');
  $('#rsBody').innerHTML = `<div class="card rhead" style="--c:${esc(r.color || '#1d5fa8')}"><div class="row" style="justify-content:space-between"><div><h2>${esc(r.label)}</h2>
      <div class="muted small">${esc(r.area || '')}${r.machine ? ' · ' + esc(r.machine) : ''} · Crew: ${esc(crewNames || r.crewLabel || 'none set')}</div></div>
      <button class="btn sm" id="editRoute" type="button">Route settings & crew</button></div>
      <details class="mapbox" ${lsGet('dr-admin-map', true) ? 'open' : ''}><summary>Route map</summary><div id="rmap" class="rmap"></div><p class="small muted" style="margin:4px 0 0">Numbers follow the stop order below. Dashed line: the driving order from the yard and back (straight lines, not roads).</p></details></div>
    <div class="card" style="padding:0">${stops.map((s, i) => `<div class="stoprow"><span class="n">${s.n}</span>
      <div><b>${esc(s.site.name)}</b> <span class="muted small">${esc(s.site.owner || '')} · ${addrList(s.site.addresses).map(esc).join(' / ')} ${hrs(s.lo, s.hi) ? '· ' + esc(hrs(s.lo, s.hi)) : ''}</span>
        ${s.site.deadline ? `<span class="flag red">${esc(s.site.deadline)}</span>` : ''}${s.site.pinExact === false ? '<span class="flag amber">pin estimated</span>' : ''}</div>
      <div class="row"><button class="btn sm" data-up="${i}" ${i ? '' : 'disabled'} aria-label="Move up">↑</button><button class="btn sm" data-dn="${i}" ${i < stops.length - 1 ? '' : 'disabled'} aria-label="Move down">↓</button>
        <button class="btn sm" data-ed="${i}" type="button">Edit</button><button class="btn sm" data-mv="${i}" type="button">Move</button><button class="btn sm danger" data-rm="${i}" type="button">Remove</button></div></div>`).join('') || '<p class="muted" style="padding:12px">No stops yet.</p>'}</div>
    <p class="row"><button class="btn primary" id="addStop" type="button">+ Add a site to this route</button></p>`;
  const setStops = (ns, msg) => backend.update('routes/' + r.id, { stops: ns }).then(() => toast(msg || 'Saved')).catch(e => toast(errText(e), 'bad'));
  const raw = (r.stops || []).filter(st => S.sites[st.siteId]);
  $$('[data-up]').forEach(b => b.onclick = () => { const i = +b.dataset.up, ns = raw.slice(); [ns[i - 1], ns[i]] = [ns[i], ns[i - 1]]; setStops(ns, 'Moved up'); });
  $$('[data-dn]').forEach(b => b.onclick = () => { const i = +b.dataset.dn, ns = raw.slice(); [ns[i + 1], ns[i]] = [ns[i], ns[i + 1]]; setStops(ns, 'Moved down'); });
  $$('[data-rm]').forEach(b => twoTap(b, 'Tap again', () => { const ns = raw.slice(); ns.splice(+b.dataset.rm, 1); setStops(ns, 'Removed from this route'); }));
  $$('[data-ed]').forEach(b => b.onclick = () => siteForm(r, +b.dataset.ed));
  $$('[data-mv]').forEach(b => b.onclick = () => moveForm(r, +b.dataset.mv));
  $('#addStop').onclick = () => addForm(r);
  $('#editRoute').onclick = () => routeForm(r);
  const box = $('#rsBody .mapbox'), draw = () => drawRouteMap($('#rmap'), stops, { key: 'office-' + r.id, color: r.color });
  let was = box.open;
  box.addEventListener('toggle', () => { if (box.open === was) return; was = box.open; lsSet('dr-admin-map', box.open); if (box.open) draw(); });
  if (box.open) draw();
}
function siteFields(s, st) {
  s = s || {}; st = st || {};
  return `<label class="f">Site name</label><input id="sName" value="${esc(s.name || '')}">
    <label class="f">Client / property owner</label><input id="sOwner" value="${esc(s.owner || '')}">
    <label class="f">Address(es), one per line</label><textarea id="sAddr" rows="2">${esc((s.addresses || []).join('\n'))}</textarea>
    <label class="f">Map pin: paste a Google Maps link from your browser, or “lat, lon”</label><input id="sPin" placeholder="https://www.google.com/maps/place/…" value="${s.lat != null ? `${s.lat}, ${s.lon}` : ''}">
    <div class="small muted">Short “maps.app.goo.gl” links can’t be read here: open the link, then copy the long address from the browser bar.</div>
    <div class="two"><div><label class="f">Planned hrs (this route)</label><input id="sLo" inputmode="decimal" value="${st.lo ?? ''}"></div><div><label class="f">Up to hrs (if a range)</label><input id="sHi" inputmode="decimal" value="${st.hi ?? ''}"></div></div>
    <label class="f">Deadline (shows in red)</label><input id="sDead" value="${esc(s.deadline || '')}" placeholder="e.g. Must be done by 5:00 AM">
    <label class="f">Access: keys, gate or lockbox codes, who to call</label><input id="sAcc" value="${esc(s.access || '')}">
    <label class="f">Snow piles: where to put them, where never to pile</label><input id="sPile" value="${esc(s.piles || '')}">
    <label class="f">Hazards</label><input id="sHaz" value="${esc(s.hazards || '')}">
    <label class="f">Other notes</label><input id="sNote" value="${esc(s.notes || '')}">
    <label class="f">Site map file name (in the maps folder on GitHub)</label><input id="sMap" value="${esc(s.mapFile || '')}" placeholder="e.g. fidelity.pdf">`;
}
function readSite(old) {
  const pin = $('#sPin').value.trim(), ll = pin ? parseLatLon(pin) : null;
  if (pin && !ll) { toast('Couldn’t read that map pin. Paste the long Google Maps link or “lat, lon”.', 'bad'); return null; }
  const name = $('#sName').value.trim(); if (!name) { toast('Site name is needed', 'bad'); return null; }
  const num = id => { const v = $(id).value.trim(); return v === '' ? null : +v; };
  const moved = ll && (!old || old.lat !== ll.lat || old.lon !== ll.lon);
  return { site: { name, owner: $('#sOwner').value.trim(), addresses: $('#sAddr').value.split('\n').map(x => x.trim()).filter(Boolean),
      lat: ll ? ll.lat : (old ? old.lat ?? null : null), lon: ll ? ll.lon : (old ? old.lon ?? null : null), q: moved ? `${ll.lat},${ll.lon}` : (old ? old.q || null : null),
      pinExact: moved ? true : (old ? old.pinExact !== false : false), deadline: $('#sDead').value.trim(), access: $('#sAcc').value.trim(), piles: $('#sPile').value.trim(),
      hazards: $('#sHaz').value.trim(), notes: $('#sNote').value.trim(), mapFile: $('#sMap').value.trim() },
    lo: num('#sLo'), hi: num('#sHi') };
}
function siteForm(r, i) {
  const st = r.stops[i], s = S.sites[st.siteId];
  const other = S.routes.filter(x => x.id !== r.id && (x.stops || []).some(y => y.siteId === st.siteId)).map(x => PLANS[x.plan].short + ' ' + x.label);
  dialog('Edit site', `${other.length ? `<p class="small muted">Name, address, pin and notes also change on: ${esc(other.join(', '))}. Hours are for this route only.</p>` : ''}${siteFields(s, st)}`,
    [{ label: 'Cancel' }, { label: 'Save', cls: 'primary', run: async d => {
      const v = readSite(s); if (!v) return;
      const ns = r.stops.slice(); ns[i] = { ...st, lo: v.lo, hi: v.hi ?? v.lo };
      try { await backend.batch([{ op: 'set', path: 'sites/' + st.siteId, data: v.site, merge: true }, { op: 'update', path: 'routes/' + r.id, data: { stops: ns } }]); d.close(); toast('Site saved'); } catch (e) { toast(errText(e), 'bad'); }
    } }]);
}
function addForm(r, after) {
  const used = new Set((r.stops || []).map(s => s.siteId));
  const opts = Object.values(S.sites).filter(s => !used.has(s.id)).sort((a, b) => a.name.localeCompare(b.name));
  const d = dialog(`Add a site to ${r.label}`, `<label class="f">Find a site</label><input id="aFind" type="search" placeholder="Type a name or address to narrow the list" autocomplete="off"><select id="aPick" style="margin-top:6px"><option value="__new">+ A new site</option>${opts.map(s => `<option value="${s.id}">${esc(s.name)} – ${esc(addrList(s.addresses)[0] || '')}</option>`).join('')}</select>
    <label class="f">Put it at stop number</label><input id="aPos" inputmode="numeric" value="${(r.stops || []).length + 1}">
    <div id="aNew">${siteFields(null, null)}</div><div id="aOld" hidden><div class="two"><div><label class="f">Planned hrs</label><input id="oLo" inputmode="decimal"></div><div><label class="f">Up to hrs</label><input id="oHi" inputmode="decimal"></div></div></div>`,
    [{ label: 'Cancel' }, { label: 'Add', cls: 'primary', run: async d => {
      const pos = Math.max(1, Math.min((r.stops || []).length + 1, parseInt($('#aPos').value, 10) || 1)) - 1, ns = (r.stops || []).slice(), ops = [];
      if ($('#aPick').value === '__new') {
        const v = readSite(null); if (!v) return;
        let id = slug(v.site.name); while (S.sites[id]) id += '-2';
        ops.push({ op: 'set', path: 'sites/' + id, data: v.site }); ns.splice(pos, 0, { siteId: id, lo: v.lo, hi: v.hi ?? v.lo });
      } else {
        const lo = $('#oLo').value.trim() === '' ? null : +$('#oLo').value, hi = $('#oHi').value.trim() === '' ? lo : +$('#oHi').value;
        ns.splice(pos, 0, { siteId: $('#aPick').value, lo, hi });
      }
      ops.push({ op: 'update', path: 'routes/' + r.id, data: { stops: ns } });
      try { await backend.batch(ops); d.close(); toast(r.temp ? 'Site added: crews see it right away' : 'Site added'); if (after) setTimeout(after, 50); } catch (e) { toast(errText(e), 'bad'); }
    } }]);
  $('#aPick').onchange = () => { const n = $('#aPick').value === '__new'; $('#aNew').hidden = !n; $('#aOld').hidden = n; };
  $('#aFind').oninput = () => {
    const w = $('#aFind').value.toLowerCase().split(/\s+/).filter(Boolean); let firstHit = null;
    $$('#aPick option').forEach(o => { if (o.value === '__new') return; const hit = w.every(x => o.textContent.toLowerCase().includes(x)); o.hidden = !hit; if (hit && !firstHit) firstHit = o; });
    $('#aPick').value = w.length && firstHit ? firstHit.value : '__new'; $('#aPick').onchange();
  };
}
function moveForm(r, i) {
  const st = r.stops[i], others = S.routes.filter(x => x.plan === r.plan && x.id !== r.id);
  dialog(`Move ${S.sites[st.siteId].name}`, `<label class="f">To route</label><select id="mTo">${others.map(x => `<option value="${x.id}">${esc(x.label)}${x.crewLabel ? ' · ' + esc(x.crewLabel) : ''}</option>`).join('')}</select>
    <label class="f">At stop number (blank = last)</label><input id="mPos" inputmode="numeric">`,
    [{ label: 'Cancel' }, { label: 'Move', cls: 'primary', run: async d => {
      const to = S.routes.find(x => x.id === $('#mTo').value); if (!to) return;
      const from = r.stops.slice(); from.splice(i, 1);
      const dest = (to.stops || []).filter(x => x.siteId !== st.siteId), pos = parseInt($('#mPos').value, 10);
      dest.splice(pos ? Math.max(0, Math.min(dest.length, pos - 1)) : dest.length, 0, st);
      try { await backend.batch([{ op: 'update', path: 'routes/' + r.id, data: { stops: from } }, { op: 'update', path: 'routes/' + to.id, data: { stops: dest } }]); d.close(); toast('Moved to ' + to.label); } catch (e) { toast(errText(e), 'bad'); }
    } }]);
}
function routeForm(r) {
  const isNew = !r; r = r || { plan: rsPlan, label: '', area: '', crewLabel: '', machine: '', color: '#1d5fa8', members: [] };
  const crew = S.people.filter(p => p.active !== false);
  dialog(isNew ? 'New route' : 'Route settings & crew', `<label class="f">Route name</label><input id="rL" value="${esc(r.label)}" placeholder="e.g. Sidewalk Crew 5">
    <label class="f">Area</label><input id="rA" value="${esc(r.area || '')}">
    <div class="two"><div><label class="f">Machine (optional)</label><input id="rM" value="${esc(r.machine || '')}"></div><div><label class="f">Colour</label><input id="rC" type="color" value="${esc(r.color || '#1d5fa8')}" style="height:44px"></div></div>
    <label class="f">Usual crew (they see this route first)</label><div class="checks">${crew.map(p => `<label><input type="checkbox" value="${p.id}" ${(r.members || []).includes(p.id) ? 'checked' : ''}>${esc(p.name)}</label>`).join('')}</div>
    ${isNew ? '' : '<p class="small muted">To retire a route, use “Archive route”: it disappears for crews but stays in old reports.</p>'}`,
    [{ label: 'Cancel' }, ...(isNew ? [] : [{ label: 'Archive route', cls: 'danger', two: 'Tap again to archive', run: async d => { await backend.update('routes/' + r.id, { archived: true }).catch(e => toast(errText(e), 'bad')); d.close(); rsRoute = null; lsSet('dr-rs-route', null); } }]),
      { label: 'Save', cls: 'primary', run: async d => {
        const label = $('#rL').value.trim(); if (!label) return toast('Route name is needed', 'bad');
        const members = $$('#dlgB .checks input:checked').map(i => i.value);
        const crewLabel = members.map(id => first(id)).join(members.length > 2 ? ', ' : ' & ').replace(/, ([^,]*)$/, ' & $1');
        const data = { label, area: $('#rA').value.trim(), machine: $('#rM').value.trim(), color: $('#rC').value, members, crewLabel };
        try {
          if (isNew) { const id = r.plan + '-' + slug(label); await backend.set('routes/' + id, { ...data, plan: r.plan, order: Math.max(0, ...S.routes.map(x => x.order || 0)) + 1, stops: [] }); rsRoute = id; lsSet('dr-rs-route', id); }
          else await backend.update('routes/' + r.id, data);
          d.close(); toast('Route saved');
        } catch (e) { toast(errText(e), 'bad'); }
      } }]);
}

/* ---------- People & PINs ---------- */
async function rebuildRoster() {
  const people = (await backend.list('people')).filter(p => p.active !== false && p.pinUid);
  await backend.set('roster/public', { people: people.map(p => ({ id: p.id, name: p.name, gen: p.gen || 1, pv: p.pinV || 1, len: p.pinLen || 6 })).sort((a, b) => a.name.localeCompare(b.name)) });
}
function people(p) {
  p.innerHTML = `<div class="row" style="justify-content:space-between"><h2>People</h2><div class="row"><button class="btn" id="linkL" type="button">Link login</button><button class="btn primary" id="addP" type="button">+ Add person</button></div></div>
    <p class="muted small">Crew sign in on the crew app with their name and PIN (the last 4 digits of their phone). Office admins sign in on the office page with an email and password, and can also have a PIN to log sites in the crew app, for example when they go out on equipment.</p>
    <div class="tscroll"><table class="t"><thead><tr><th>Name</th><th>Role</th><th>Crew PIN</th><th>Office login</th><th>Status</th><th></th></tr></thead><tbody>
    ${S.people.map(x => `<tr style="${x.active === false ? 'opacity:.55' : ''}"><td><b>${esc(x.name)}</b></td><td>${x.role === 'admin' ? 'Office admin' + (x.pinUid ? ' + crew' : '') : 'Crew'}</td>
      <td>${x.pinUid ? (x.pinLen ? x.pinLen + ' digits · ' : '') + 'set ' + esc(day(x.pinSetMs)) : '<span class="muted">No PIN yet</span>'}</td><td>${x.emailUid ? esc(x.email || 'Yes') : ''}</td><td>${x.active === false ? 'Turned off' : 'Active'}</td>
      <td class="row"><button class="btn sm" data-pin="${x.id}" type="button" ${x.active === false ? 'disabled' : ''}>${x.pinUid ? 'Change PIN' : 'Set PIN'}</button>
        ${x.role === 'admin' && !x.emailUid ? `<button class="btn sm" data-office="${x.id}" type="button">Office login</button>` : ''}
        ${x.emailUid && x.email ? `<button class="btn sm" data-pw="${x.id}" type="button">Office password</button>` : ''}
        <button class="btn sm" data-pe="${x.id}" type="button">Edit</button>
        ${x.id === S.me ? '' : `<button class="btn sm ${x.active === false ? '' : 'danger'}" data-act="${x.id}" type="button">${x.active === false ? 'Turn on' : 'Turn off'}</button>`}</td></tr>`).join('') || '<tr><td colspan="6" class="muted">No people yet. Add them here or import the starting data.</td></tr>'}</tbody></table></div>`;
  $('#addP').onclick = () => personForm(null);
  $$('[data-pe]').forEach(b => b.onclick = () => personForm(S.people.find(x => x.id === b.dataset.pe)));
  $$('[data-pin]').forEach(b => b.onclick = () => pinForm(S.people.find(x => x.id === b.dataset.pin)));
  $('#linkL').onclick = () => linkForm();
  $$('[data-office]').forEach(b => b.onclick = () => officeLogin(S.people.find(x => x.id === b.dataset.office)));
  $$('[data-pw]').forEach(b => b.onclick = () => officePassword(S.people.find(x => x.id === b.dataset.pw)));
  $$('[data-act]').forEach(b => twoTap(b, 'Tap again', () => setActive(S.people.find(x => x.id === b.dataset.act))));
}
function personForm(x) {
  const isNew = !x; x = x || { name: '', role: 'crew' };
  dialog(isNew ? 'Add person' : 'Edit person', `<label class="f">Full name (shown on the sign-in list)</label><input id="pN" value="${esc(x.name)}">
    <label class="f">Role</label><select id="pR"><option value="crew" ${x.role !== 'admin' ? 'selected' : ''}>Crew</option><option value="admin" ${x.role === 'admin' ? 'selected' : ''}>Office admin (dashboard, fixes, routes, people)</option></select>`,
    [{ label: 'Cancel' }, { label: 'Save', cls: 'primary', run: async d => {
      const name = $('#pN').value.trim(), role = $('#pR').value; if (!name) return toast('Name is needed', 'bad');
      try {
        if (isNew) { let id = slug(name.split(' ')[0]); if (S.people.some(p => p.id === id)) id = slug(name); while (S.people.some(p => p.id === id)) id += '-2'; await backend.set('people/' + id, { name, role, active: true }); }
        else {
          const ops = [{ op: 'update', path: 'people/' + x.id, data: { name, role } }];
          for (const u of [x.pinUid, x.emailUid].filter(Boolean)) ops.push({ op: 'set', path: 'uids/' + u, data: { personId: x.id, role: u === x.pinUid && role === 'admin' ? 'crew' : role, active: x.active !== false } });
          await backend.batch(ops); if (x.pinUid) await rebuildRoster();
        }
        d.close(); toast('Saved');
      } catch (e) { toast(errText(e), 'bad'); }
    } }]);
}
function pinForm(x) {
  dialog(`${x.pinUid ? 'Change' : 'Set'} PIN`, `<label class="f" for="fN">Full name (shown on the crew sign-in list)</label><input id="fN" value="${esc(x.name)}">
    <label class="f" for="fP">PIN: last 4 digits of their phone number</label><input id="fP" inputmode="numeric" maxlength="6" autocomplete="off" placeholder="e.g. 4567">
    ${x.pinUid ? '<p class="small muted">Their old PIN stops working as soon as you save.</p>' : ''}`,
    [{ label: 'Cancel' }, { label: 'Save', cls: 'primary', run: async d => {
      const name = $('#fN').value.trim(), pin = $('#fP').value.trim();
      if (!name) return toast('Name is needed', 'bad');
      if (!/^\d{4,6}$/.test(pin)) return toast('Enter 4 digits (or up to 6)', 'bad');
      try { await setPin({ ...x, name }, pin); d.close(); toast(`PIN set for ${name.split(' ')[0]}`); } catch (e) { toast(errText(e), 'bad'); }
    } }]);
}
async function setPin(x, pin) {
  let gen = (x.gen || 0) + 1, uid = null;
  for (let tries = 0; !uid; tries++) {   // a login name already taken (by anyone) is skipped, never reused
    try { uid = await backend.createLogin(crewEmail(x.id, gen), pinPassword(pin, 2)); }
    catch (e) { if (/email-already-in-use/.test(e.code || '') && tries < 8) gen++; else throw e; }
  }
  const ops = [{ op: 'set', path: 'uids/' + uid, data: { personId: x.id, role: 'crew', active: true } },
    { op: 'update', path: 'people/' + x.id, data: { name: x.name, gen, pinUid: uid, pinSetMs: Date.now(), pinV: 2, pinLen: pin.length } }];
  if (x.pinUid) ops.push({ op: 'delete', path: 'uids/' + x.pinUid });   // old PIN stops working
  if (x.emailUid) ops.push({ op: 'set', path: 'uids/' + x.emailUid, data: { personId: x.id, role: x.role === 'admin' ? 'admin' : 'crew', active: x.active !== false } });
  await backend.batch(ops); await rebuildRoster();
}
function linkForm() {
  dialog('Link an office login', `<p class="small">Use this when someone can sign in to the office page but sees “This login isn’t linked to the office yet”. That screen shows their login ID; paste it here.</p>
    <label class="f" for="lP">Person</label><select id="lP">${S.people.filter(p => p.active !== false).map(p => `<option value="${p.id}">${esc(p.name)}</option>`).join('')}</select>
    <label class="f" for="lU">Login ID</label><input id="lU" autocomplete="off" placeholder="e.g. gquk4cVmnWS6KicVrVbSEDtl2l12">
    <label class="f" for="lE">Their email (optional, for your records)</label><input id="lE" type="email">`,
    [{ label: 'Cancel' }, { label: 'Link as office admin', cls: 'primary', run: async d => {
      const uid = $('#lU').value.trim(), x = S.people.find(p => p.id === $('#lP').value);
      if (!/^[A-Za-z0-9]{6,128}$/.test(uid)) return toast('That doesn’t look like a login ID', 'bad');
      try {
        await backend.batch([{ op: 'set', path: 'uids/' + uid, data: { personId: x.id, role: 'admin', active: true } },
          { op: 'update', path: 'people/' + x.id, data: { role: 'admin', emailUid: uid, ...($('#lE').value.trim() ? { email: $('#lE').value.trim() } : {}) } }]);
        d.close(); toast(`Linked to ${x.name}. They can refresh the office page now.`);
      } catch (e) { toast(errText(e), 'bad'); }
    } }]);
}
function accountDialog() {
  dialog('Your office login', `<p class="small muted">Signed in as ${esc((S.user && S.user.email) || '')}.</p>
    <label class="f" for="n1">New password (8+ characters)</label><input id="n1" type="password" autocomplete="new-password">
    <label class="f" for="n2">Type it again</label><input id="n2" type="password" autocomplete="new-password">`,
    [{ label: 'Close' }, { label: 'Change password', cls: 'primary', run: async d => {
      const a = $('#n1').value, b = $('#n2').value;
      if (a.length < 8) return toast('Use at least 8 characters', 'bad');
      if (a !== b) return toast('The two passwords don’t match', 'bad');
      try { await backend.changePassword(a); d.close(); toast('Password changed'); }
      catch (e) { toast(/recent-login/.test(e.code || '') ? 'For security, sign out and back in, then change it right away.' : errText(e), 'bad'); }
    } }]);
}
function officeLogin(x) {
  dialog(`Office login for ${x.name}`, `<label class="f">Their email</label><input id="oE" type="email">
    <label class="f">Temporary password (8+ characters)</label><input id="oP" value="${randPin()}${randPin().slice(0, 2)}">
    <p class="small muted">They sign in on the office page with this email and password. Share the password privately.</p>`,
    [{ label: 'Cancel' }, { label: 'Create login', cls: 'primary', run: async d => {
      const email = $('#oE').value.trim(), pw = $('#oP').value;
      if (!/^\S+@\S+\.\S+$/.test(email) || pw.length < 8) return toast('Enter an email and a password of 8+ characters', 'bad');
      try { const uid = await backend.createLogin(email, pw);
        await backend.batch([{ op: 'set', path: 'uids/' + uid, data: { personId: x.id, role: 'admin', active: true } }, { op: 'update', path: 'people/' + x.id, data: { emailUid: uid, email } }]);
        d.close(); toast('Office login created'); } catch (e) { toast(errText(e), 'bad'); }
    } }]);
}
// Firebase's free plan can't change someone else's password directly, so there are two ways:
// email them a reset link, or (after the old login is deleted in the Firebase console) make a new login with a password you choose.
const USERS_URL = 'https://console.firebase.google.com/project/dispatch-routes-a9a58/authentication/users';
function officePassword(x) {
  const self = x.id === S.me;
  dialog(`Office password for ${x.name}`, `<p class="small">Their office login: <b>${esc(x.email)}</b></p>
    <h3 style="margin:14px 0 4px">Send a reset email</h3>
    <p class="small muted">Firebase emails them a link to choose a new password. Ask them to check junk mail if it doesn't show up in a few minutes.</p>
    <button class="btn primary" id="pwMail" type="button">Email a reset link to ${esc(x.email)}</button>
    ${self ? `<p class="small muted" style="margin-top:14px">To change your own password right now, use <b>Account</b> at the top of the page.</p>` : `
    <details style="margin-top:16px"><summary><b>Or set a password for them</b></summary>
      <ol class="small">
        <li>Open <a href="${USERS_URL}" target="_blank" rel="noopener">Firebase → Authentication → Users ↗</a>, find <b>${esc(x.email)}</b>, tap its <b>⋮</b> menu and choose <b>Delete account</b>.</li>
        <li>Come back here, type the new password and tap <b>Set password</b>.</li>
      </ol>
      <label class="f" for="pwNew">New password (8+ characters)</label><input id="pwNew" autocomplete="off" value="${randPin()}${randPin().slice(0, 2)}">
      <p class="small muted">Share it with them privately. They can change it later from <b>Account</b>.</p>
      <button class="btn" id="pwSet" type="button">Set password</button>
    </details>`}`, [{ label: 'Close' }]);
  $('#pwMail').onclick = async () => {
    const b = $('#pwMail'); b.disabled = true; b.textContent = 'Sending…';
    try { await backend.resetPassword(x.email); b.textContent = 'Reset email sent'; toast(`Reset email sent to ${x.email}`); }
    catch (e) { b.disabled = false; b.textContent = `Email a reset link to ${x.email}`; toast(/user-not-found/.test(e.code || '') ? 'There’s no login for that email any more. Use “Set a password” below.' : errText(e), 'bad'); }
  };
  const set = $('#pwSet'); if (!set) return;
  set.onclick = async () => {
    const pw = $('#pwNew').value;
    if (pw.length < 8) return toast('Use at least 8 characters', 'bad');
    set.disabled = true; set.textContent = 'Setting…';
    try {
      const uid = await backend.createLogin(x.email, pw);
      const ops = [{ op: 'set', path: 'uids/' + uid, data: { personId: x.id, role: x.role === 'admin' ? 'admin' : 'crew', active: x.active !== false } },
        { op: 'update', path: 'people/' + x.id, data: { emailUid: uid } }];
      if (x.emailUid && x.emailUid !== uid) ops.push({ op: 'delete', path: 'uids/' + x.emailUid });
      await backend.batch(ops);
      $('#dlg').close(); toast(`New password set for ${x.name.split(' ')[0]}`);
    } catch (e) {
      set.disabled = false; set.textContent = 'Set password';
      toast(/email-already-in-use/.test(e.code || '') ? `${x.email} still has a login. Delete it in Firebase first (step 1), then try again.` : errText(e), 'bad');
    }
  };
}
async function setActive(x) {
  const on = x.active === false, ops = [{ op: 'update', path: 'people/' + x.id, data: { active: on } }];
  for (const u of [x.pinUid, x.emailUid].filter(Boolean)) ops.push({ op: 'update', path: 'uids/' + u, data: { active: on } });
  try { await backend.batch(ops); await rebuildRoster(); toast(on ? 'Turned on' : 'Turned off: they can’t sign in'); } catch (e) { toast(errText(e), 'bad'); }
}

/* ---------- Import & backup ---------- */
function data(p) {
  p.innerHTML = `<div class="card"><h2>Import starting data</h2><p>Loads sites, routes and people from the file Claude prepared. Existing sites and routes with the same names are replaced; snow events and visits are not touched.</p>
      <input type="file" id="imp" accept=".json,application/json"><div class="err" id="ierr"></div></div>
    <div class="card"><h2>Import people &amp; PINs</h2><p>Loads the people file Claude prepared from your employee list: updates each person’s full name and sets their PIN (last 4 digits of their phone). New people are added as crew. It takes a few seconds per person; keep this page open until it says done.</p>
      <input type="file" id="impP" accept=".json,application/json"><div id="impPlog" class="small" style="white-space:pre-line;margin-top:8px">${esc(S.impLog || '')}</div></div>
    <div class="card"><h2>Backup</h2><p>Saves everything (sites, routes, people, snow events and visits) as one file you can keep.</p><button class="btn" id="bak" type="button">Save backup file</button></div>`;
  $('#imp').onchange = async () => {
    const f = $('#imp').files[0]; if (!f) return;
    try {
      const j = JSON.parse(await f.text());
      if (!j.sites || !j.routes) throw new Error('This isn’t a starting data file.');
      const ops = [
        ...j.sites.map(s => { const { id, ...d } = s; return { op: 'set', path: 'sites/' + id, data: d }; }),
        ...j.routes.map(r => { const { id, ...d } = r; return { op: 'set', path: 'routes/' + id, data: d }; }),
        ...(j.people || []).filter(x => !S.people.some(p => p.id === x.id)).map(x => ({ op: 'set', path: 'people/' + x.id, data: { name: x.name, role: x.role || 'crew', active: true } }))
      ];
      for (let i = 0; i < ops.length; i += 400) await backend.batch(ops.slice(i, i + 400));
      $('#ierr').textContent = ''; toast(`Imported ${j.sites.length} sites, ${j.routes.length} routes${j.people ? ', ' + j.people.length + ' people' : ''}`);
    } catch (e) { $('#ierr').textContent = e.message || errText(e); }
  };
  $('#impP').onchange = async () => {
    const f = $('#impP').files[0], out = $('#impPlog'); if (!f) return;
    let j; try { j = JSON.parse(await f.text()); } catch (e) { out.textContent = 'That file isn’t a people file.'; return; }
    const list = j.people || []; if (!list.length || !list.every(x => x.id && x.name)) { out.textContent = 'That file isn’t a people file.'; return; }
    $('#impP').disabled = true; S.busy = true; let ok = 0; const lines = [];
    for (const x of list) {
      try {
        let cur = (await backend.get('people/' + x.id));
        if (!cur) { await backend.set('people/' + x.id, { name: x.name, role: x.role || 'crew', active: true }); cur = { id: x.id, name: x.name, role: x.role || 'crew', active: true }; }
        if (x.pin && /^\d{4,6}$/.test(String(x.pin))) await setPin({ ...cur, id: x.id, name: x.name }, String(x.pin));
        else await backend.update('people/' + x.id, { name: x.name });
        ok++; lines.push('✓ ' + x.name);
      } catch (e) { lines.push('✗ ' + x.name + ': ' + errText(e)); }
      out.textContent = `${ok} of ${list.length} done…\n` + lines.slice(-6).join('\n');
    }
    S.impLog = `Done: ${ok} of ${list.length} people updated.\n` + lines.filter(l => l.startsWith('✗')).join('\n');
    out.textContent = S.impLog; S.busy = false;
    $('#impP').disabled = false; toast(`People updated: ${ok} of ${list.length}`); draw();
  };
  $('#bak').onclick = async () => {
    const all = {}; for (const c of ['sites', 'routes', 'people', 'events', 'visits', 'meta']) all[c] = await backend.list(c);
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([JSON.stringify(all, null, 1)], { type: 'application/json' }));
    a.download = `dispatch-routes-backup-${new Date().toISOString().slice(0, 10)}.json`; a.click();
  };
}
