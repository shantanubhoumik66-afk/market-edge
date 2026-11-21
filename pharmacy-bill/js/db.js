/* Data layer: everything is kept in IndexedDB on this device and loaded into memory at start.
   Calculations follow the rules of the original Excel macros (PHARMACY_BILL.xlsm). */
'use strict';

const DB_NAME = 'pharmacy-bill', DB_VER = 1;
const STORES = {
  parties: { keyPath: 'name' },            // distributors (Party Details)
  purchases: { keyPath: 'id', autoIncrement: true }, // every bill line (the distributor sheets)
  sales: { keyPath: 'invoiceNo' },          // sales invoices (header)
  saleItems: { keyPath: 'id', autoIncrement: true },
  adjust: { keyPath: 'id', autoIncrement: true },     // StockAdjust
  adjustUndone: { keyPath: 'id', autoIncrement: true },
  inbox: { keyPath: 'fileId' },             // bill images found in Drive / uploaded
  settings: { keyPath: 'k' },
  images: { keyPath: 'id' },               // bill photos / PDFs (not loaded into memory)
};
const NOT_IN_MEMORY = ['images'];

let _db;
function openDB() {
  if (_db) return Promise.resolve(_db);
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB_NAME, DB_VER);
    r.onupgradeneeded = () => {
      const db = r.result;
      for (const [n, o] of Object.entries(STORES)) if (!db.objectStoreNames.contains(n)) db.createObjectStore(n, o);
    };
    r.onsuccess = () => { _db = r.result; res(_db); };
    r.onerror = () => rej(r.error);
  });
}
function tx(stores, mode, fn) {
  return openDB().then(db => new Promise((res, rej) => {
    const t = db.transaction(stores, mode);
    let out;
    Promise.resolve(fn(t)).then(v => { out = v; });
    t.oncomplete = () => res(out);
    t.onerror = () => rej(t.error);
    t.onabort = () => rej(t.error);
  }));
}
const reqP = r => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });

/* In-memory copy of all data (fast search over 20k+ lines) */
const D = { parties: [], purchases: [], sales: [], saleItems: [], adjust: [], adjustUndone: [], inbox: [], settings: {} };

async function loadAll() {
  const names = Object.keys(STORES).filter(n => !NOT_IN_MEMORY.includes(n));
  await tx(names, 'readonly', async t => {
    for (const n of names) {
      const all = await reqP(t.objectStore(n).getAll());
      if (n === 'settings') { D.settings = {}; all.forEach(x => D.settings[x.k] = x.v); }
      else D[n] = all;
    }
  });
  invalidate();
}

/* put many rows; returns them with ids filled in */
async function putMany(store, rows) {
  await tx([store], 'readwrite', t => {
    const s = t.objectStore(store);
    return Promise.all(rows.map(r => reqP(s.put(r)).then(id => { if (STORES[store].autoIncrement) r.id = id; })));
  });
  const key = STORES[store].keyPath;
  const map = new Map(D[store].map(x => [x[key], x]));
  rows.forEach(r => map.set(r[key], r));
  D[store] = [...map.values()];
  invalidate();
  return rows;
}
async function delMany(store, keys) {
  await tx([store], 'readwrite', t => { const s = t.objectStore(store); keys.forEach(k => s.delete(k)); });
  const key = STORES[store].keyPath, ks = new Set(keys);
  D[store] = D[store].filter(x => !ks.has(x[key]));
  invalidate();
}
async function clearStores(names) {
  await tx(names, 'readwrite', t => names.forEach(n => t.objectStore(n).clear()));
  names.forEach(n => { if (n === 'settings') D.settings = {}; else D[n] = []; });
  invalidate();
}
async function setSetting(k, v) {
  await tx(['settings'], 'readwrite', t => t.objectStore('settings').put({ k, v }));
  D.settings[k] = v;
}
const getSetting = (k, d) => (k in D.settings ? D.settings[k] : d);

async function putImage(id, blob, name) { await tx(['images'], 'readwrite', t => t.objectStore('images').put({ id, blob, name, at: Date.now() })); return id; }
async function getImage(id) { if (!id) return null; let out; await tx(['images'], 'readonly', async t => { out = await reqP(t.objectStore('images').get(id)); }); return out || null; }
async function delImage(id) { await tx(['images'], 'readwrite', t => t.objectStore('images').delete(id)); }

/* ---------------- helpers that copy the Excel rules ---------------- */
const num = v => { if (v == null || v === '') return 0; const n = typeof v === 'number' ? v : parseFloat(String(v).replace(/[,\s₹]/g, '')); return isFinite(n) ? n : 0; };
const r2 = n => Math.round((n + Number.EPSILON) * 100) / 100;
/* Same result as Excel VBA Round(x, 2): VBA multiplies by 100 and rounds a result that is exactly .5
   to the even number (banker's rounding). Keeps amounts equal to the workbook to the paisa. */
const r2x = n => {
  if (!isFinite(n)) return 0;
  const x = n * 100, f = Math.floor(x), d = x - f;
  return (d === 0.5 ? (f % 2 === 0 ? f : f + 1) : Math.round(x)) / 100;
};
const normKey = s => String(s || '').toUpperCase().trim().replace(/\s+/g, ' ');
const batchKey = s => { s = String(s || '').trim(); return s ? normKey(s) : '-'; };

/* Net Amount = Quantity x Rate x (1 - Discount%/100) x (1 + (CGST% + SGST%)/100). Free quantity is not charged. */
function calcNet(l) {
  const q = num(l.qty), rt = num(l.rate);
  if (q > 0 && rt > 0) return r2x(q * rt * (1 - num(l.disc) / 100) * (1 + (num(l.cgst) + num(l.sgst)) / 100));
  return num(l.net);
}

/* Expiry key: "8/26", "08-2026", "AUG-26", "01/08/26" -> 202608 ; 0 when not readable */
function expKey(s) {
  let t = String(s || '').toUpperCase().trim();
  if (!t || t === 'NA') return 0;
  t = t.replace(/[\/. ]/g, '-').replace(/-+/g, '-');
  const p = t.split('-');
  let m = 0, y = 0;
  const mon = x => { x = x.trim(); if (/^\d+$/.test(x)) return +x; const i = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'].indexOf(x.slice(0, 3)); return i + 1; };
  const yr = x => { if (!/^\d+$/.test(x.trim())) return 0; const v = +x; return v >= 2000 && v <= 2099 ? v : v >= 0 && v <= 99 ? 2000 + v : 0; };
  if (p.length === 2) { m = mon(p[0]); y = yr(p[1]); } else if (p.length === 3) { m = mon(p[1]); y = yr(p[2]); }
  return m >= 1 && m <= 12 && y > 0 ? y * 100 + m : 0;
}
const expShow = k => k ? (k % 100) + '/' + String(Math.floor(k / 100) % 100).padStart(2, '0') : '';
/* Normalise any expiry text to M/YY like the Excel sheet ("8/26") */
const expNorm = s => { const k = expKey(s); return k ? expShow(k) : String(s || '').trim(); };

/* Dates are stored as ISO yyyy-mm-dd; shown as dd-mm-yyyy like the workbook */
function toISO(v) {
  if (!v && v !== 0) return '';
  if (v instanceof Date && !isNaN(v)) return v.getFullYear() + '-' + String(v.getMonth() + 1).padStart(2, '0') + '-' + String(v.getDate()).padStart(2, '0');
  const s = String(v).trim();
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return m[1] + '-' + m[2].padStart(2, '0') + '-' + m[3].padStart(2, '0');
  m = s.match(/^(\d{1,2})[-\/. ](\d{1,2}|[A-Za-z]{3,})[-\/. ](\d{2,4})$/);
  if (m) {
    let mo = /^\d+$/.test(m[2]) ? +m[2] : ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'].indexOf(m[2].slice(0, 3).toLowerCase()) + 1;
    let y = +m[3]; if (y < 100) y += 2000;
    if (mo >= 1 && mo <= 12) return y + '-' + String(mo).padStart(2, '0') + '-' + m[1].padStart(2, '0');
  }
  return '';
}
const showDate = iso => iso ? iso.slice(8, 10) + '-' + iso.slice(5, 7) + '-' + iso.slice(0, 4) : '';
const todayISO = () => toISO(new Date());

/* ---------------- derived data (cached until something changes) ---------------- */
let _cache = {};
function invalidate() { _cache = {}; }

/* STOCK (batch wise): purchased + free + add - reduce - sold, value = remaining x cost per pack */
function stock() {
  if (_cache.stock) return _cache.stock;
  const m = new Map();
  const get = (nm, bt) => {
    const k = normKey(nm) + '|' + batchKey(bt);
    let x = m.get(k);
    if (!x) { x = { name: normKey(nm), batch: String(bt || '').trim() || '-', pur: 0, free: 0, sold: 0, add: 0, red: 0, cost: 0, exp: 0, mrp: 0, mfg: '', key: k }; m.set(k, x); }
    return x;
  };
  for (const l of D.purchases) {
    if (!l.item || normKey(l.item) === 'NA') continue;
    const x = get(l.item, l.batch);
    x.pur += num(l.qty); x.free += num(l.free);
    const rt = num(l.rate);
    if (rt > 0) x.cost += num(l.qty) * rt * (1 - num(l.disc) / 100) * (1 + (num(l.cgst) + num(l.sgst)) / 100);
    const k = expKey(l.exp); if (k) x.exp = k;
    if (num(l.mrp)) x.mrp = num(l.mrp);
    if (l.mfg) x.mfg = l.mfg;
  }
  let unmatched = 0;
  for (const s of D.saleItems) {
    if (!s.item) continue;
    if (!m.has(normKey(s.item) + '|' + batchKey(s.batch))) unmatched++;
    get(s.item, s.batch).sold += num(s.qtyPacks);
  }
  for (const a of D.adjust) { const x = get(a.item, a.batch); x.add += num(a.add); x.red += num(a.reduce); }
  const rows = [...m.values()].map(x => {
    const rem = x.pur + x.free + x.add - x.red - x.sold;
    const unit = x.pur + x.free > 0 ? x.cost / (x.pur + x.free) : 0;
    return { ...x, total: x.pur + x.free, rem: r2x(rem), value: rem > 0 ? r2x(rem * unit) : 0, unit };
  }).sort((a, b) => a.name.localeCompare(b.name) || a.batch.localeCompare(b.batch));
  return (_cache.stock = { rows, unmatched });
}

/* Info from the latest older bill of the same item: Mfg, HSN, CGST, SGST (Bill Entry auto-fill) */
function itemInfo() {
  if (_cache.itemInfo) return _cache.itemInfo;
  const m = new Map();
  for (const l of D.purchases) if (l.item) m.set(normKey(l.item), { mfg: l.mfg, hsn: l.hsn, cgst: l.cgst, sgst: l.sgst, mrp: l.mrp, rate: l.rate });
  return (_cache.itemInfo = m);
}
function itemNames() {
  if (_cache.names) return _cache.names;
  return (_cache.names = [...new Set(D.purchases.map(l => normKey(l.item)).filter(Boolean))].sort());
}

/* Bills = purchase lines grouped by distributor + invoice */
function bills() {
  if (_cache.bills) return _cache.bills;
  const m = new Map();
  for (const l of D.purchases) {
    const k = normKey(l.distributor) + '|' + normKey(l.invoiceNo);
    let b = m.get(k);
    if (!b) { b = { key: k, distributor: l.distributor, invoiceNo: l.invoiceNo, date: l.billDate, lines: [], total: 0, qty: 0, free: 0, image: null }; m.set(k, b); }
    b.lines.push(l); b.total += num(l.net); b.qty += num(l.qty); b.free += num(l.free);
    if (l.billDate && (!b.date || l.billDate < b.date)) b.date = l.billDate;
    if (l.imageFile) b.image = l.imageFile;
  }
  const arr = [...m.values()].map(b => ({ ...b, total: r2(b.total) })).sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  return (_cache.bills = arr);
}

/* Party list with bill count and total purchase (Party Details) */
function partyStats() {
  if (_cache.party) return _cache.party;
  const st = new Map();
  for (const b of bills()) {
    const k = normKey(b.distributor);
    const x = st.get(k) || { bills: 0, total: 0, last: '' };
    x.bills++; x.total += b.total; if ((b.date || '') > x.last) x.last = b.date;
    st.set(k, x);
  }
  const names = new Map(D.parties.map(p => [normKey(p.name), p]));
  for (const k of st.keys()) if (!names.has(k)) names.set(k, { name: bills().find(b => normKey(b.distributor) === k).distributor, missing: true });
  const rows = [...names.values()].map(p => ({ ...p, ...(st.get(normKey(p.name)) || { bills: 0, total: 0, last: '' }) }))
    .map(p => ({ ...p, total: r2(p.total) })).sort((a, b) => a.name.localeCompare(b.name));
  return (_cache.party = rows);
}

const gstinOK = g => /^\d{2}[A-Z]{5}\d{4}[A-Z][A-Z\d]Z[A-Z\d]$/.test(String(g || '').toUpperCase().trim());
const panOf = g => gstinOK(g) ? String(g).toUpperCase().trim().slice(2, 12) : '';

/* Multi-word search: every word must appear (like the Stocks search box) */
function matchWords(text, q) {
  const w = String(q || '').toUpperCase().trim().split(/\s+/).filter(Boolean);
  if (!w.length) return true;
  const t = String(text || '').toUpperCase();
  return w.every(x => t.includes(x));
}

/* Full backup / restore (JSON file) */
async function exportBackup() {
  const out = { app: 'pharmacy-bill', version: 1, at: new Date().toISOString() };
  for (const n of Object.keys(STORES).filter(n => !NOT_IN_MEMORY.includes(n))) out[n] = n === 'settings' ? Object.entries(D.settings).filter(([k]) => !/key|token/i.test(k)).map(([k, v]) => ({ k, v })) : D[n];
  return out;
}
async function importBackup(obj) {
  if (!obj || obj.app !== 'pharmacy-bill') throw new Error('This is not a Pharmacy Bill backup file.');
  const names = Object.keys(STORES).filter(n => n !== 'settings' && !NOT_IN_MEMORY.includes(n));
  await clearStores(names);
  for (const n of names) if (Array.isArray(obj[n]) && obj[n].length) await putMany(n, obj[n]);
  for (const s of obj.settings || []) await setSetting(s.k, s.v);
}

window.DB = { r2x, D, loadAll, putImage, getImage, delImage, putMany, delMany, clearStores, setSetting, getSetting, num, r2, normKey, batchKey, calcNet, expKey, expShow, expNorm,
  toISO, showDate, todayISO, stock, itemInfo, itemNames, bills, partyStats, gstinOK, panOf, matchWords, exportBackup, importBackup, invalidate };
