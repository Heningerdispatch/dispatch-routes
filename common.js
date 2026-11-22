// Shared helpers for the crew app and the office pages.
export const YARD = { name: 'Heninger Yard 1', address: '4605 1st Street SE, Calgary', lat: 51.01185, lon: -114.06036, q: '4605%201%20St%20SE%2C%20Calgary%2C%20AB' };
export const PLANS = {
  plow: { label: 'Full plow routes', short: 'Plow' },
  drivelanes: { label: 'Drive lane only routes', short: 'Drive lanes' },
  sidewalk: { label: 'Sidewalk crews', short: 'Sidewalks' },
  day: { label: 'Day crew', short: 'Day crew' },
  sanding: { label: 'Sanding', short: 'Sanding' },
  quick: { label: 'Quick jobs', short: 'Quick job' }
};
export const CREW_DOMAIN = 'crew.dispatch-routes-a9a58.firebaseapp.com';
export const crewEmail = (personId, gen) => `${personId}.${gen || 1}@${CREW_DOMAIN}`;
/* PINs set from v2 on can be 4 digits; Firebase needs 6+ characters, so the stored password wraps the PIN. */
export const pinPassword = (pin, v) => v === 2 ? `dr-${pin}-pin` : pin;

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const slug = s => String(s).toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'x';
export function t12(ms) { if (!ms) return ''; const d = new Date(ms); let h = d.getHours(); const m = d.getMinutes(), ap = h < 12 ? 'AM' : 'PM'; h = h % 12 || 12; return `${h}:${String(m).padStart(2, '0')} ${ap}`; }
export const day = ms => ms ? new Date(ms).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' }) : '';
export const dayTime = ms => ms ? `${day(ms)} ${t12(ms)}` : '';
export function dur(ms) { if (ms == null || ms < 0) return ''; const m = Math.round(ms / 60000); if (m < 60) return `${m} min`; const h = Math.floor(m / 60); return `${h} h ${String(m % 60).padStart(2, '0')} min`; }
export const hrs = (lo, hi) => lo == null ? '' : (hi != null && hi !== lo ? `${lo}–${hi} hrs` : `${lo} hr${lo === 1 ? '' : 's'}`);
export const randPin = () => String(Math.floor(Math.random() * 1e6)).padStart(6, '0');

/* "6115 & 6143 4 St SE" -> two addresses; ranges like "324 – 328 39th Ave" stay one building. */
export function addrList(addresses) {
  const out = [];
  for (const a of addresses || []) {
    const m = String(a).match(/^\s*(\d+)\s*&\s*(\d+)\s+(.+)$/);
    if (m) out.push(`${m[1]} ${m[3]}`, `${m[2]} ${m[3]}`); else if (String(a).trim()) out.push(String(a).trim());
  }
  return out;
}
export const siteQ = s => s.q || ((s.lat != null && s.lon != null) ? `${s.lat},${s.lon}` : encodeURIComponent((addrList(s.addresses)[0] || s.name) + ', AB'));
export const mapLink = s => `https://www.google.com/maps/search/?api=1&query=${siteQ(s)}`;
/* Google Maps directions in legs of up to 10 points: yard -> stops -> (last leg back to yard is left out). */
export function legs(stops) {
  const pts = [YARD.q, ...stops.map(siteQ)], out = [];
  for (let a = 0; a < pts.length - 1;) { const b = Math.min(a + 9, pts.length - 1); out.push({ from: a, to: b, url: 'https://www.google.com/maps/dir/' + pts.slice(a, b + 1).join('/') }); a = b; }
  return out;
}
/* Read a Google Maps link or "lat, lon" text and return coordinates, or null. Short maps.app.goo.gl links can't be read here. */
export function parseLatLon(text) {
  const s = String(text || '');
  let m = s.match(/!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/) || s.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/) || s.match(/[?&](?:query|q|ll|center|destination)=(-?\d+\.\d+)(?:,|%2C)\s*(-?\d+\.\d+)/) || s.match(/^\s*(-?\d{1,2}\.\d+)\s*,\s*(-?\d{2,3}\.\d+)\s*$/);
  if (!m) return null;
  const lat = +m[1], lon = +m[2];
  return (lat > 40 && lat < 60 && lon < -100 && lon > -125) ? { lat, lon } : null;
}

/* GPS: never blocks the crew. Resolves {lat, lon, acc} or null within ~8 s. */
export function getGeo() {
  return new Promise(res => {
    if (!navigator.geolocation) return res(null);
    let done = false; const fin = v => { if (!done) { done = true; res(v); } };
    setTimeout(() => fin(null), 9000);
    try {
      navigator.geolocation.getCurrentPosition(p => fin({ lat: +p.coords.latitude.toFixed(6), lon: +p.coords.longitude.toFixed(6), acc: Math.round(p.coords.accuracy) }),
        () => fin(null), { enableHighAccuracy: true, timeout: 8000, maximumAge: 60000 });
    } catch (e) { fin(null); }
  });
}
export const geoLink = g => g ? `https://www.google.com/maps/search/?api=1&query=${g.lat},${g.lon}` : '';
export function metres(a, b) {   // straight-line distance between two {lat, lon}
  if (!a || !b || a.lat == null || b.lat == null) return null;
  const R = 6371000, r = x => x * Math.PI / 180, dLa = r(b.lat - a.lat), dLo = r(b.lon - a.lon);
  const h = Math.sin(dLa / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(dLo / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(h)));
}

/* Two-tap button: first tap arms it (shows `armed` text), second tap within 4 s runs `action`. */
export function twoTap(btn, armed, action) {
  btn.addEventListener('click', e => {
    e.stopPropagation();
    if (btn.disabled) return;
    if (!btn.classList.contains('arm')) {
      const was = btn.innerHTML; btn.classList.add('arm'); btn.textContent = armed;
      clearTimeout(btn._t); btn._t = setTimeout(() => { if (btn.isConnected) { btn.classList.remove('arm'); btn.innerHTML = was; } }, 4000);
      return;
    }
    clearTimeout(btn._t); btn.classList.remove('arm'); action();
  });
}

let toastT;
export function toast(msg, kind) {
  let t = $('#toast');
  if (!t) { t = document.createElement('div'); t.id = 'toast'; t.setAttribute('role', 'status'); document.body.appendChild(t); }
  t.textContent = msg; t.className = 'show' + (kind ? ' ' + kind : '');
  clearTimeout(toastT); toastT = setTimeout(() => { t.className = ''; }, 3500);
}
export const errText = e => {
  const c = (e && (e.code || e.message)) || '';
  if (/invalid-credential|wrong-password|user-not-found|invalid-email|invalid-login/.test(c)) return 'That name and PIN don’t match. Try again.';
  if (/too-many-requests/.test(c)) return 'Too many tries. Wait a few minutes and try again.';
  if (/network/.test(c)) return 'No connection. Sign-in needs signal the first time.';
  if (/permission-denied/.test(c)) return 'Not allowed. Ask the office to check your login.';
  if (/email-already-in-use/.test(c)) return 'That login already exists.';
  if (/weak-password/.test(c)) return 'Password must be at least 6 characters.';
  return 'Something went wrong (' + c + ').';
};
export const lsGet = (k, d) => { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } };
export const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} };

/* Visits for one event -> per route/site summary. */
export function visitIndex(visits) {
  const by = {};
  for (const v of visits) {
    if (v.status === 'cancelled') continue;
    const k = v.routeId + '|' + v.siteId; (by[k] = by[k] || []).push(v);
  }
  for (const k in by) by[k].sort((a, b) => (a.startMs || 0) - (b.startMs || 0));
  return by;
}
export function registerSW() {
  if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('./sw.js').catch(() => {});
}

/* ---------- Route map (Leaflet + OpenStreetMap, loaded only when someone opens a map) ---------- */
const LEAFLET = 'https://unpkg.com/leaflet@1.9.4/dist/';
let leafletP = null;
function loadLeaflet() {
  if (window.L) return Promise.resolve(window.L);
  if (!leafletP) leafletP = new Promise((ok, bad) => {
    const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = LEAFLET + 'leaflet.css'; document.head.appendChild(l);
    const s = document.createElement('script'); s.src = LEAFLET + 'leaflet.js';
    s.onload = () => ok(window.L); s.onerror = () => { leafletP = null; bad(new Error('no map')); };
    document.head.appendChild(s);
  });
  return leafletP;
}
const mapViews = {};   // keeps each map's zoom when the screen redraws
// stops: [{ n, site, state: 'done' | 'onsite' | 'next' | '' }]. Draws numbered pins in route order, from the yard and back.
export async function drawRouteMap(el, stops, { key, color = '#1d5fa8' } = {}) {
  if (!el) return null;
  let L;
  try { L = await loadLeaflet(); } catch (e) { el.innerHTML = '<p class="small muted" style="padding:12px">The map needs signal to load. Use the Directions buttons instead.</p>'; return null; }
  if (!el.isConnected || el._map) return el._map || null;
  const map = L.map(el, { scrollWheelZoom: false });
  el._map = map;
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '&copy; OpenStreetMap' }).addTo(map);
  const pts = stops.filter(s => s.site && s.site.lat != null && s.site.lon != null);
  const yard = [YARD.lat, YARD.lon], line = [yard, ...pts.map(s => [s.site.lat, s.site.lon]), yard];
  L.polyline(line, { color, weight: 3, opacity: 0.75, dashArray: '6 6' }).addTo(map);
  const pin = (label, bg, ring) => L.divIcon({ className: 'rpin', html: `<span style="background:${bg}${ring ? ';box-shadow:0 0 0 4px ' + ring : ''}">${label}</span>`, iconSize: [28, 28], iconAnchor: [14, 14], popupAnchor: [0, -12] });
  L.marker(yard, { icon: pin('Y', '#1f2a36') }).addTo(map).bindPopup(`<b>${esc(YARD.name)}</b><br>${esc(YARD.address)}`);
  pts.forEach(s => {
    const bg = s.state === 'done' ? '#1e7b45' : s.state === 'onsite' ? '#1d5fa8' : color;
    L.marker([s.site.lat, s.site.lon], { icon: pin(s.state === 'done' ? '✓' : s.n, bg, s.state === 'next' ? '#f5b301' : ''), zIndexOffset: s.state === 'next' || s.state === 'onsite' ? 1000 : 0 })
      .addTo(map).bindPopup(`<b>${s.n}. ${esc(s.site.name)}</b>${s.site.owner ? '<br>' + esc(s.site.owner) : ''}<br>${addrList(s.site.addresses).map(esc).join('<br>')}<br><a href="${esc(mapLink(s.site))}" target="_blank" rel="noopener">Open in Maps ↗</a>`);
  });
  const v = key && mapViews[key];
  if (v) map.setView(v.c, v.z); else map.fitBounds(L.latLngBounds(line), { padding: [24, 24] });
  if (key) map.on('moveend', () => { mapViews[key] = { c: map.getCenter(), z: map.getZoom() }; });
  setTimeout(() => map.invalidateSize(), 50);
  return map;
}
