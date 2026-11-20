// Data layer: Firebase Auth + Firestore (offline cache on). The rest of the app only talks to `backend`.
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js';
import {
  getAuth, initializeAuth, inMemoryPersistence, onAuthStateChanged, signInWithEmailAndPassword,
  createUserWithEmailAndPassword, signOut, updatePassword, sendPasswordResetEmail
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js';
import {
  initializeFirestore, persistentLocalCache, persistentMultipleTabManager, doc, collection, getDoc, getDocs,
  setDoc, updateDoc, deleteDoc, onSnapshot, query, where, writeBatch, serverTimestamp
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';
import { firebaseConfig } from './firebase-config.js';

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
let db;
try {
  db = initializeFirestore(app, { localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }) });
} catch (e) {
  db = initializeFirestore(app, {});   // private browsing etc.: still works, just without offline cache
}
let secondary = null;   // a second, memory-only sign-in used by the office to create crew logins without signing out

const clean = snap => (snap.exists() ? { id: snap.id, ...snap.data() } : null);
const q = (coll, wheres = []) => (wheres.length ? query(collection(db, coll), ...wheres.map(([f, op, v]) => where(f, op, v))) : collection(db, coll));
const meta = s => ({ pending: s.metadata.hasPendingWrites, fromCache: s.metadata.fromCache });

export const backend = {
  kind: 'firebase',
  onAuth(cb) { return onAuthStateChanged(auth, u => cb(u ? { uid: u.uid, email: u.email } : null)); },
  currentUser() { const u = auth.currentUser; return u ? { uid: u.uid, email: u.email } : null; },
  async signIn(email, pw) { const r = await signInWithEmailAndPassword(auth, email, pw); return r.user.uid; },
  signOut() { return signOut(auth); },
  async createOwnLogin(email, pw) { const r = await createUserWithEmailAndPassword(auth, email, pw); return r.user.uid; },
  async createLogin(email, pw) {
    if (!secondary) {
      const sApp = initializeApp(firebaseConfig, 'create-logins');
      secondary = initializeAuth(sApp, { persistence: inMemoryPersistence });
    }
    const r = await createUserWithEmailAndPassword(secondary, email, pw);
    const uid = r.user.uid;
    await signOut(secondary);
    return uid;
  },
  changePassword(pw) { return updatePassword(auth.currentUser, pw); },
  resetPassword(email) { return sendPasswordResetEmail(auth, email); },
  async get(path) { return clean(await getDoc(doc(db, path))); },
  async list(coll, wheres) { return (await getDocs(q(coll, wheres))).docs.map(clean); },
  watch(path, cb, onErr) { return onSnapshot(doc(db, path), { includeMetadataChanges: true }, s => cb(clean(s), meta(s)), e => onErr && onErr(e)); },
  watchList(coll, wheres, cb, onErr) { return onSnapshot(q(coll, wheres), { includeMetadataChanges: true }, s => cb(s.docs.map(clean), meta(s)), e => onErr && onErr(e)); },
  set(path, data, opts) { return setDoc(doc(db, path), data, opts && opts.merge ? { merge: true } : {}); },
  update(path, data) { return updateDoc(doc(db, path), data); },
  del(path) { return deleteDoc(doc(db, path)); },
  batch(ops) {
    const b = writeBatch(db);
    for (const o of ops) {
      const r = doc(db, o.path);
      if (o.op === 'delete') b.delete(r); else if (o.op === 'update') b.update(r, o.data); else b.set(r, o.data, o.merge ? { merge: true } : {});
    }
    return b.commit();
  },
  serverTime: () => serverTimestamp(),
  newId(coll) { return doc(collection(db, coll)).id; }
};
