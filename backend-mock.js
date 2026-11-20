// In-memory stand-in for backend-firebase.js, used only by the automated tests (never deployed to crews).
// State lives in localStorage so it survives page reloads during a test; window.__MOCK_SEED seeds it.
const KEY = 'mock-backend-v1';
const load = () => { try { return JSON.parse(localStorage.getItem(KEY)); } catch (e) { return null; } };
let S = load();
if (!S) { S = window.__MOCK_SEED ? JSON.parse(JSON.stringify(window.__MOCK_SEED)) : { docs: {}, users: {} }; }
// Each tab has its own sign-in (like separate phones); data is shared between tabs, like the real database.
S.session = JSON.parse(sessionStorage.getItem(KEY + '-session') || 'null');
const save = () => { const { session, ...rest } = S; localStorage.setItem(KEY, JSON.stringify(rest)); sessionStorage.setItem(KEY + '-session', JSON.stringify(session || null)); };
save();
window.addEventListener('storage', e => { if (e.key === KEY && e.newValue) { const n = JSON.parse(e.newValue); S.docs = n.docs; S.users = n.users; fire(); } });
const authCbs = new Set(), docWatch = new Set(), listWatch = new Set();
let n = 0;
const nowSrv = () => ({ seconds: Math.floor(Date.now() / 1000) });
const fix = d => { const o = {}; for (const [k, v] of Object.entries(d)) o[k] = v && v.__srv ? nowSrv() : v; return o; };
const collOf = p => p.split('/').slice(0, -1).join('/');
const idOf = p => p.split('/').pop();
const match = (d, wheres) => (wheres || []).every(([f, op, v]) => op === '==' ? d[f] === v : op === 'in' ? v.includes(d[f]) : op === 'array-contains' ? (d[f] || []).includes(v) : true);
const rows = (coll, wheres) => Object.entries(S.docs).filter(([p, d]) => collOf(p) === coll && match(d, wheres)).map(([p, d]) => ({ id: idOf(p), ...JSON.parse(JSON.stringify(d)) }));
function fire() {
  save();
  for (const w of docWatch) { const d = S.docs[w.path]; w.cb(d ? { id: idOf(w.path), ...JSON.parse(JSON.stringify(d)) } : null, { pending: false, fromCache: false }); }
  for (const w of listWatch) w.cb(rows(w.coll, w.wheres), { pending: false, fromCache: false });
}
const authErr = code => Object.assign(new Error(code), { code });
const perm = () => { if (window.__MOCK_DENY) throw Object.assign(new Error('permission-denied'), { code: 'permission-denied' }); };

export const backend = {
  kind: 'mock',
  onAuth(cb) { authCbs.add(cb); setTimeout(() => cb(S.session), 0); return () => authCbs.delete(cb); },
  currentUser() { return S.session; },
  async signIn(email, pw) {
    const u = S.users[email];
    if (!u || u.pw !== pw) throw authErr('auth/invalid-credential');
    S.session = { uid: u.uid, email }; save(); authCbs.forEach(cb => cb(S.session)); return u.uid;
  },
  async signOut() { S.session = null; save(); authCbs.forEach(cb => cb(null)); },
  async createOwnLogin(email, pw) { const uid = await this.createLogin(email, pw); return this.signIn(email, pw).then(() => uid); },
  async createLogin(email, pw) {
    if (S.users[email]) throw authErr('auth/email-already-in-use');
    if (String(pw).length < 6) throw authErr('auth/weak-password');
    const uid = 'uid' + (++n) + Math.random().toString(36).slice(2, 8); S.users[email] = { pw, uid }; save(); return uid;
  },
  async resetPassword(email) { if (!S.users[email]) throw authErr('auth/user-not-found'); },
  async changePassword(pw) { const s = S.session; S.users[s.email].pw = pw; save(); },
  async get(path) { const d = S.docs[path]; return d ? { id: idOf(path), ...JSON.parse(JSON.stringify(d)) } : null; },
  async list(coll, wheres) { return rows(coll, wheres); },
  watch(path, cb) { const w = { path, cb }; docWatch.add(w); setTimeout(() => { const d = S.docs[path]; cb(d ? { id: idOf(path), ...JSON.parse(JSON.stringify(d)) } : null, { pending: false, fromCache: false }); }, 0); return () => docWatch.delete(w); },
  watchList(coll, wheres, cb) { const w = { coll, wheres, cb }; listWatch.add(w); setTimeout(() => cb(rows(coll, wheres), { pending: false, fromCache: false }), 0); return () => listWatch.delete(w); },
  async set(path, data, opts) { perm(); S.docs[path] = opts && opts.merge ? { ...(S.docs[path] || {}), ...fix(data) } : fix(data); fire(); },
  async update(path, data) { perm(); if (!S.docs[path]) throw Object.assign(new Error('not-found'), { code: 'not-found' }); S.docs[path] = { ...S.docs[path], ...fix(data) }; fire(); },
  async del(path) { perm(); delete S.docs[path]; fire(); },
  async batch(ops) {
    perm();
    for (const o of ops) {
      if (o.op === 'delete') delete S.docs[o.path];
      else if (o.op === 'update') S.docs[o.path] = { ...(S.docs[o.path] || {}), ...fix(o.data) };
      else S.docs[o.path] = o.merge ? { ...(S.docs[o.path] || {}), ...fix(o.data) } : fix(o.data);
    }
    fire();
  },
  serverTime: () => ({ __srv: true }),
  newId() { return 'id' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }
};
