/* Pharmacy Bill: screens. Each screen copies a tab of PHARMACY_BILL.xlsm. */
'use strict';

const $ = id => document.getElementById(id);
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = n => '₹' + (+n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const qty = n => { n = +n || 0; return n ? (Math.round(n * 100) / 100).toLocaleString('en-IN') : ''; };
const qty0 = n => (Math.round((+n || 0) * 100) / 100).toLocaleString('en-IN');
const N = DB.num;

function toast(msg, ms) { const t = $('toast'); t.textContent = msg; t.classList.add('on'); clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove('on'), ms || 2600); }
function modal(html, wide) { $('modalBox').className = 'modal-box' + (wide ? ' wide' : ''); $('modalBox').innerHTML = html; $('modal').classList.add('on'); }
function closeModal() { $('modal').classList.remove('on'); $('modalBox').innerHTML = ''; }
$('modal').addEventListener('click', e => { if (e.target.id === 'modal') closeModal(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape' && $('modal').classList.contains('on')) closeModal(); });
function ask(title, text, okLabel, danger) {
  return new Promise(res => {
    modal(`<h3>${esc(title)}</h3><p style="margin:0 0 16px;white-space:pre-line">${esc(text)}</p>
      <div class="row-flex" style="justify-content:flex-end"><button class="btn" id="askNo">Cancel</button><button class="btn ${danger ? 'bad' : 'pri'}" id="askYes">${esc(okLabel || 'OK')}</button></div>`);
    $('askNo').onclick = () => { closeModal(); res(false); };
    $('askYes').onclick = () => { closeModal(); res(true); };
  });
}
function pickFile(accept, multiple, capture) {
  return new Promise(res => {
    const old = $('pickFile'), f = old.cloneNode(); old.replaceWith(f);
    f.accept = accept || ''; f.multiple = !!multiple; if (capture) f.setAttribute('capture', 'environment'); else f.removeAttribute('capture');
    f.onchange = () => res([...f.files]); f.click();
  });
}
function download(name, blob) { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 4000); }

/* ---------------- navigation ---------------- */
const NAV = [
  ['grp', 'Overview'], ['dashboard', 'Dashboard', '◧'],
  ['grp', 'Bills'], ['scan', 'Scan bills', '📷'], ['bill', 'Bill Entry', '✎'], ['ledger', 'Distributor ledger', '▤'], ['purchases', 'Purchase Details', '🧾'], ['parties', 'Party Details', '🏢'],
  ['grp', 'Stock'], ['stock', 'Stocks', '📦'], ['medicine', 'Medicine Search', '🔍'], ['expiry', 'Expiry Search', '⏳'],
  ['grp', 'Setup'], ['settings', 'Settings & data', '⚙'],
];
function renderNav() {
  const cur = route().page, waiting = DB.D.inbox.filter(x => x.status === 'ready').length;
  $('nav').innerHTML = NAV.map(n => n[0] === 'grp' ? `<div class="grp">${n[1]}</div>` :
    `<a href="#/${n[0]}" class="${cur === n[0] ? 'on' : ''}"><span class="ic">${n[2]}</span>${n[1]}${n[0] === 'scan' && waiting ? `<span class="cnt">${waiting}</span>` : ''}</a>`).join('');
  $('shopName').textContent = DB.getSetting('shopName', '') || 'Pharmacy Bill';
  $('dataInfo').textContent = DB.D.purchases.length ? DB.D.purchases.length.toLocaleString('en-IN') + ' bill lines · ' + DB.bills().length.toLocaleString('en-IN') + ' bills' : 'No data yet';
}
function route() {
  const h = location.hash.replace(/^#\/?/, '');
  const [page, qs] = h.split('?');
  return { page: page || 'dashboard', q: new URLSearchParams(qs || '') };
}
const go = (p, q) => { location.hash = '#/' + p + (q ? '?' + new URLSearchParams(q) : ''); };
function setTop(title, actions) { $('pageTitle').textContent = title; $('topActions').innerHTML = actions || ''; document.title = title + ' · Pharmacy Bill'; }
const PAGES = {};
let LIMIT = {};
function render() {
  const r = route();
  closeSide();
  (PAGES[r.page] || PAGES.dashboard)(r.q);
  renderNav();
}
window.addEventListener('hashchange', () => { LIMIT = {}; render(); window.scrollTo(0, 0); });
function closeSide() { $('side').classList.remove('on'); $('scrim').classList.remove('on'); }
$('menuBtn').onclick = () => { $('side').classList.add('on'); $('scrim').classList.add('on'); };
$('scrim').onclick = closeSide;
$('fab').onclick = () => go('scan');

/* table helper with "Show more" so 20,000 rows stay fast */
function table(id, cols, rows, opt) {
  opt = opt || {};
  const lim = LIMIT[id] || opt.limit || 200, shown = rows.slice(0, lim);
  const th = cols.map(c => `<th class="${c.n ? 'n' : ''}">${c.h}</th>`).join('');
  const tb = shown.map((r, i) => `<tr class="${opt.click ? 'click ' : ''}${opt.rowClass ? opt.rowClass(r) : ''}" ${opt.click ? `data-i="${i}"` : ''}>${cols.map(c => `<td class="${c.n ? 'n' : ''}">${c.f(r)}</td>`).join('')}</tr>`).join('');
  const ft = opt.foot ? `<tfoot><tr>${opt.foot.map((x, i) => `<td class="${cols[i] && cols[i].n ? 'n' : ''}">${x == null ? '' : x}</td>`).join('')}</tr></tfoot>` : '';
  const more = rows.length > lim ? `<div class="more"><button class="btn" data-more="${id}">Show more (${(rows.length - lim).toLocaleString('en-IN')} left)</button></div>` : '';
  return `<div class="tw" id="tw-${id}"><table class="t"><thead><tr>${th}</tr></thead><tbody>${tb || `<tr><td colspan="${cols.length}" class="empty">${opt.empty || 'Nothing to show.'}</td></tr>`}</tbody>${rows.length ? ft : ''}</table></div>${more}`;
}
function wireTable(id, rows, onClick, rerender) {
  const w = $('tw-' + id); if (!w) return;
  if (onClick) w.querySelector('tbody').addEventListener('click', e => { const tr = e.target.closest('tr[data-i]'); if (tr && !e.target.closest('button,a,input')) onClick(rows[+tr.dataset.i]); });
  const m = document.querySelector(`[data-more="${id}"]`);
  if (m) m.onclick = () => { LIMIT[id] = (LIMIT[id] || 200) + 500; rerender(); };
}

/* ================= DASHBOARD ================= */
PAGES.dashboard = () => {
  setTop('Dashboard', `<button class="btn pri" onclick="go('scan')">📷 <span class="lbl">Scan bills</span></button><button class="btn" onclick="go('bill')">✎ <span class="lbl">New bill</span></button>`);
  if (!DB.D.purchases.length) {
    $('page').innerHTML = `<div class="card" style="max-width:720px"><h2>Welcome 👋</h2>
      <p>Start by importing your existing Excel workbook (<b>PHARMACY_BILL.xlsm</b>). All distributors, bills, stock and adjustments are copied into this app. The file stays on this device.</p>
      <div class="row-flex"><button class="btn pri" id="dImp">⬆ Import Excel workbook</button><button class="btn" onclick="go('settings')">Settings</button></div>
      <p class="muted small" style="margin-top:14px">Then add your free Gemini key in Settings so bills are read automatically.</p></div>`;
    $('dImp').onclick = importExcelFlow; return;
  }
  const st = DB.stock().rows, now = new Date(), ym = now.getFullYear() * 100 + now.getMonth() + 1;
  const inStock = st.filter(s => s.rem > 0), val = DB.r2x(inStock.reduce((a, s) => a + s.value, 0));
  const addM = (k, m) => { let y = Math.floor(k / 100), mo = k % 100 + m; while (mo > 12) { mo -= 12; y++; } return y * 100 + mo; };
  const soon = inStock.filter(s => s.exp && s.exp >= ym && s.exp <= addM(ym, 3)), expired = inStock.filter(s => s.exp && s.exp < ym);
  const neg = st.filter(s => s.rem < 0);
  const mStart = DB.todayISO().slice(0, 8) + '01', bm = DB.bills().filter(b => (b.date || '') >= mStart);
  const ready = DB.D.inbox.filter(x => x.status === 'ready').length;
  const byDist = {}; bm.forEach(b => byDist[b.distributor] = (byDist[b.distributor] || 0) + b.total);
  const top = Object.entries(byDist).sort((a, b) => b[1] - a[1]).slice(0, 6), mx = top.length ? top[0][1] : 1;
  $('page').innerHTML = `
    ${ready ? `<div class="note ok">📥 ${ready} bill${ready > 1 ? 's are' : ' is'} read and waiting for your check. <a href="#/scan">Review now</a></div>` : ''}
    <div class="kpis">
      <div class="kpi"><span>Stock value</span><b>${money(val)}</b><small>${inStock.length.toLocaleString('en-IN')} batches in stock</small></div>
      <div class="kpi"><span>Purchases this month</span><b>${money(bm.reduce((a, b) => a + b.total, 0))}</b><small>${bm.length} bills</small></div>
      <div class="kpi ${soon.length ? 'warn' : ''}"><span>Expiring in 3 months</span><b>${soon.length}</b><small>${money(soon.reduce((a, s) => a + s.value, 0))} of stock</small></div>
      <div class="kpi ${expired.length ? 'bad' : ''}"><span>Already expired, in stock</span><b>${expired.length}</b><small>${money(expired.reduce((a, s) => a + s.value, 0))}</small></div>
      ${neg.length ? `<div class="kpi bad"><span>Negative stock</span><b>${neg.length}</b><small>sold more than purchased</small></div>` : ''}
    </div>
    <div class="grid2">
      <div class="card"><h2>Latest bills <a class="sub" href="#/purchases">All bills →</a></h2>${table('dbl', [
        { h: 'Date', f: b => esc(DB.showDate(b.date)) }, { h: 'Distributor', f: b => esc(b.distributor) }, { h: 'Invoice', f: b => esc(b.invoiceNo) }, { h: 'Value', n: 1, f: b => money(b.total) }],
        DB.bills().slice(0, 8), { click: 1, limit: 8 })}</div>
      <div class="card"><h2>This month by distributor</h2>${top.length ? top.map(([d, v]) => `<div style="margin-bottom:10px"><div class="row-flex small"><span class="grow">${esc(d)}</span><b>${money(v)}</b></div><div class="bar-h"><i style="width:${(100 * v / mx).toFixed(1)}%"></i></div></div>`).join('') : '<div class="empty">No bills this month yet.</div>'}</div>
    </div>
    <div class="card"><h2>Expiring soon (in stock) <a class="sub" href="#/expiry">Expiry Search →</a></h2>${table('dexp', [
      { h: 'Medicine', f: s => esc(s.name) }, { h: 'Batch', f: s => esc(s.batch) }, { h: 'Expiry', f: s => `<span class="pill ${s.exp < ym ? 'bad' : 'warn'}">${DB.expShow(s.exp)}</span>` },
      { h: 'In stock', n: 1, f: s => qty(s.rem) }, { h: 'Value', n: 1, f: s => money(s.value) }],
      [...expired, ...soon].sort((a, b) => a.exp - b.exp), { limit: 10, empty: 'Nothing expires in the next 3 months.' })}</div>`;
  wireTable('dbl', DB.bills().slice(0, 8), b => showBill(b.key));
};

/* ================= SCAN BILLS (inbox) ================= */
let READING = false;
PAGES.scan = () => {
  setTop('Scan bills', `<button class="btn" id="readAll">✨ <span class="lbl">Read all new</span></button>`);
  const hasKey = !!DB.getSetting('geminiKey'), hasDrive = !!(DB.getSetting('driveClientId') && DB.getSetting('driveFolder'));
  const q = DB.D.inbox.slice().sort((a, b) => (b.added || 0) - (a.added || 0));
  const st = x => ({ new: '<span class="pill">New</span>', reading: '<span class="pill info"><span class="spin"></span> Reading…</span>', ready: '<span class="pill ok">Ready to check</span>',
    saved: '<span class="pill">Saved</span>', error: '<span class="pill bad">Error</span>', skipped: '<span class="pill">Skipped</span>' }[x.status] || '');
  $('page').innerHTML = `
    ${hasKey ? '' : `<div class="note warn">Add your free Gemini API key in <a href="#/settings">Settings</a> so bills can be read automatically. You can still add images now.</div>`}
    <div class="sources">
      <div class="src" id="sDrive"><div class="big">🗂️</div><b>Google Drive folder</b><span class="muted small">${hasDrive ? 'Check the bills folder for new images' : 'Connect a folder in Settings'}</span></div>
      <div class="src" id="sUp"><div class="big">⬆</div><b>Upload images / PDF</b><span class="muted small">One file per bill, or pages of one bill</span></div>
      <div class="src" id="sCam"><div class="big">📷</div><b>Take a photo</b><span class="muted small">Flat, bright, whole bill in frame</span></div>
    </div>
    <div class="card queue"><h2>Bills <span class="sub">${q.filter(x => x.status === 'ready').length} ready · ${q.filter(x => x.status === 'new' || x.status === 'error').length} to read</span></h2>
      ${q.length ? q.slice(0, LIMIT.q || 60).map(x => `<div class="qi" data-id="${esc(x.fileId)}">
        <div class="thumb" data-thumb="${esc(x.imageId || '')}">${x.mime === 'application/pdf' ? '📄' : '🧾'}</div>
        <div class="meta"><b>${esc(x.result ? (x.result.distributorMatch ? x.result.distributorMatch.name : x.result.distributorRaw || x.name) : x.name)}</b>
          <span class="muted small">${x.result ? 'Invoice ' + esc(x.result.invoiceNo || '?') + ' · ' + x.result.lines.length + ' items · ' + money(x.result.lines.reduce((a, l) => a + N(l.net), 0)) + ' · ' : ''}${esc(x.source === 'drive' ? 'Drive' : 'Uploaded')} · ${new Date(x.added || Date.now()).toLocaleDateString('en-IN')}</span>
          ${x.error ? `<div class="small neg">${esc(x.error)}</div>` : ''}</div>
        <div class="row-flex">${st(x)}
          ${x.status === 'ready' ? `<button class="btn sm pri" data-act="review">Check &amp; save</button>` : ''}
          ${['new', 'error'].includes(x.status) ? `<button class="btn sm" data-act="read">✨ Read</button><button class="btn sm" data-act="manual">Type it</button>` : ''}
          ${x.status !== 'reading' ? `<button class="btn sm" data-act="menu" title="More">⋯</button>` : ''}</div></div>`).join('') : '<div class="empty">No bills yet. Add bill photos from Google Drive, upload them, or take a photo.</div>'}
    </div>
    <p class="muted small">Gemini free tier: each bill is one request. If it says the limit is reached, wait a minute. Nothing is saved to stock until you press <b>Save bill</b>.</p>`;
  document.querySelectorAll('[data-thumb]').forEach(async el => { const id = el.dataset.thumb; if (!id) return; const im = await DB.getImage(id); if (im && /^image\//.test(im.blob.type)) el.outerHTML = `<img class="thumb" src="${URL.createObjectURL(im.blob)}" alt="">`; });
  $('sDrive').onclick = () => hasDrive ? checkDrive(true) : go('settings', { s: 'drive' });
  $('sUp').onclick = () => addUploads(false);
  $('sCam').onclick = () => addUploads(true);
  $('readAll').onclick = readAllNew;
  document.querySelectorAll('.qi [data-act]').forEach(b => b.onclick = () => queueAction(b.closest('.qi').dataset.id, b.dataset.act));
  if (hasDrive && !PAGES.scan._checked) { PAGES.scan._checked = true; checkDrive(false); }
};
async function addUploads(camera) {
  const files = await pickFile('image/*,application/pdf', !camera, camera);
  if (!files.length) return;
  let asOne = false;
  if (files.length > 1) asOne = await ask('Several files', files.length + ' files selected.\n\nAre they pages of ONE bill? (Cancel = each file is a separate bill)', 'Yes, one bill');
  const groups = asOne ? [files] : files.map(f => [f]);
  const rows = [];
  for (const g of groups) {
    const id = 'up-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7);
    const ids = [];
    for (let i = 0; i < g.length; i++) { ids.push(await DB.putImage(id + (i ? '-p' + i : ''), g[i], g[i].name)); }
    rows.push({ fileId: id, name: g.map(f => f.name).join(' + '), source: 'upload', mime: g[0].type, imageId: ids[0], pages: ids, status: 'new', added: Date.now() });
  }
  await DB.putMany('inbox', rows);
  render();
  if (DB.getSetting('geminiKey') && await ask('Read now?', 'Read ' + rows.length + ' bill' + (rows.length > 1 ? 's' : '') + ' with Gemini now?', 'Read now')) readAllNew();
}
async function checkDrive(interactive) {
  try {
    if (interactive) toast('Checking Google Drive…');
    const files = await AI.driveList();
    const known = new Set(DB.D.inbox.map(x => x.fileId));
    const fresh = files.filter(f => !known.has(f.id)).map(f => ({ fileId: f.id, name: f.name, source: 'drive', mime: f.mimeType, status: 'new', added: Date.parse(f.createdTime) || Date.now() }));
    if (fresh.length) { await DB.putMany('inbox', fresh); toast(fresh.length + ' new bill' + (fresh.length > 1 ? 's' : '') + ' found in Drive'); render();
      if (DB.getSetting('autoRead') && DB.getSetting('geminiKey')) readAllNew(); }
    else if (interactive) toast('No new bills in the Drive folder');
  } catch (e) { if (interactive) toast(e.message, 5000); }
}
async function blobsFor(x) {
  if (x.source === 'drive' && !x.imageId) {
    const b = await AI.driveFile(x.fileId);
    const blob = b.type ? b : new Blob([b], { type: x.mime });
    x.imageId = await DB.putImage(x.fileId, blob, x.name); x.pages = [x.imageId];
    await DB.putMany('inbox', [x]);
  }
  const out = [];
  for (const id of x.pages || [x.imageId]) { const im = await DB.getImage(id); if (im) out.push(im.blob); }
  if (!out.length) throw new Error('The bill image is missing.');
  return out;
}
async function readOne(x) {
  x.status = 'reading'; x.error = ''; await DB.putMany('inbox', [x]); if (route().page === 'scan') render();
  try {
    x.result = await AI.readBill(await blobsFor(x));
    x.status = x.result.lines.length ? 'ready' : 'error';
    if (!x.result.lines.length) x.error = 'No medicine lines found. Try a clearer photo, or type it.';
  } catch (e) { x.status = 'error'; x.error = e.message; }
  await DB.putMany('inbox', [x]);
  if (route().page === 'scan') render(); else renderNav();
  return x;
}
async function readAllNew() {
  if (READING) return toast('Already reading…');
  if (!DB.getSetting('geminiKey')) { toast('Add your Gemini key in Settings first'); return go('settings'); }
  const list = DB.D.inbox.filter(x => x.status === 'new' || x.status === 'error');
  if (!list.length) return toast('No new bills to read');
  READING = true;
  try {
    for (let i = 0; i < list.length; i++) {
      toast('Reading bill ' + (i + 1) + ' of ' + list.length + '…', 60000);
      const r = await readOne(list[i]);
      if (r.status === 'error' && /limit/i.test(r.error)) break;
      if (i < list.length - 1) await new Promise(r => setTimeout(r, 4500));   // free tier: stay under the per-minute limit
    }
  } finally { READING = false; toast('Done reading'); }
}
async function queueAction(id, act) {
  const x = DB.D.inbox.find(i => i.fileId === id); if (!x) return;
  if (act === 'read') { if (!DB.getSetting('geminiKey')) { toast('Add your Gemini key in Settings first'); return go('settings'); } return readOne(x); }
  if (act === 'review' || act === 'manual') { try { if (act === 'manual') await blobsFor(x); } catch (e) { return toast(e.message); } return go('bill', { inbox: id }); }
  if (act === 'menu') {
    modal(`<h3>${esc(x.name)} <button class="btn sm x" onclick="closeModal()">✕</button></h3><div class="row-flex">
      ${x.imageId ? '<button class="btn" id="qView">View image</button>' : ''}
      ${x.status !== 'saved' ? '<button class="btn" id="qRe">✨ Read again</button><button class="btn" id="qSkip">Skip (not a bill)</button>' : ''}
      ${x.status === 'skipped' ? '<button class="btn" id="qUn">Move back to new</button>' : ''}
      <button class="btn bad" id="qDel">Remove from list</button></div>
      <p class="muted small">Removing only clears it from this list. A Drive file stays in Drive${x.source === 'drive' ? ' and will not be picked up again' : ''}.</p>`);
    if ($('qView')) $('qView').onclick = async () => { const im = await DB.getImage(x.imageId); if (im) window.open(URL.createObjectURL(im.blob), '_blank'); };
    if ($('qRe')) $('qRe').onclick = () => { closeModal(); readOne(x); };
    if ($('qSkip')) $('qSkip').onclick = async () => { x.status = 'skipped'; await DB.putMany('inbox', [x]); closeModal(); render(); };
    if ($('qUn')) $('qUn').onclick = async () => { x.status = 'new'; await DB.putMany('inbox', [x]); closeModal(); render(); };
    $('qDel').onclick = async () => {
      if (x.source === 'drive') { x.status = 'skipped'; x.hidden = true; await DB.putMany('inbox', [x]); }
      else { await DB.delMany('inbox', [x.fileId]); for (const p of x.pages || []) if (!DB.D.purchases.some(l => l.imageId === p)) await DB.delImage(p); }
      closeModal(); render();
    };
  }
}

/* ================= BILL ENTRY ================= */
const COLS = [['item', 'Item Name', 'wide'], ['mfg', 'Mfg', 'half'], ['hsn', 'HSN Code', 'half'], ['batch', 'Batch No', 'half'], ['exp', 'Exp Date', ''], ['qty', 'Quantity', '', 1],
  ['free', 'Free Qty', '', 1], ['mrp', 'MRP', '', 1], ['rate', 'Rate', '', 1], ['disc', 'Disc %', '', 1], ['cgst', 'CGST %', '', 1], ['sgst', 'SGST %', '', 1]];
const COLW = { item: 230, mfg: 90, hsn: 96, batch: 110, exp: 64, qty: 60, free: 56, mrp: 76, rate: 76, disc: 56, cgst: 58, sgst: 58 };
let BE = null;
const blankLine = () => ({ item: '', mfg: '', hsn: '', batch: '', exp: '', qty: '', free: '', mrp: '', rate: '', disc: '', cgst: '', sgst: '', net: 0 });
function saveDraft() { clearTimeout(saveDraft._h); saveDraft._h = setTimeout(() => DB.setSetting('billDraft', BE), 600); }

PAGES.bill = async q => {
  const inboxId = q.get('inbox'), editKey = q.get('edit');
  if (inboxId) {
    const x = DB.D.inbox.find(i => i.fileId === inboxId);
    if (!x) return go('scan');
    const r = x.result || { lines: [] };
    const m = r.distributorMatch;
    BE = { distributor: m ? m.name : (r.distributorRaw || '').toUpperCase(), distMatch: m, distRaw: r.distributorRaw, newParty: m ? null : (r.distributorRaw ? { gstin: r.gstin, address: r.address, phone: r.phone, licence: r.licence } : null),
      invoiceNo: r.invoiceNo || '', billDate: r.billDate || DB.todayISO(), billTotal: r.billTotal || 0, lines: r.lines.length ? r.lines.map(l => ({ ...l })) : [blankLine()],
      inboxId, imageId: x.imageId, pages: x.pages || [x.imageId], fromAI: !!x.result };
  } else if (editKey) {
    const b = DB.bills().find(b => b.key === editKey);
    if (!b) return go('purchases');
    BE = { distributor: b.distributor, invoiceNo: b.invoiceNo, billDate: b.date || DB.todayISO(), lines: b.lines.map(l => ({ ...l })), editKey, editIds: b.lines.map(l => l.id),
      imageId: b.lines.find(l => l.imageId) ? b.lines.find(l => l.imageId).imageId : null };
    BE.pages = BE.imageId ? [BE.imageId] : [];
  } else if (!BE || BE.inboxId || BE.editKey) {
    BE = DB.getSetting('billDraft', null);
    if (!BE || BE.inboxId || BE.editKey) BE = { distributor: '', invoiceNo: '', billDate: DB.todayISO(), lines: [blankLine()], pages: [] };
  }
  drawBill();
};

function drawBill() {
  setTop(BE.editKey ? 'Edit bill' : 'Bill Entry', `${BE.pages && BE.pages.filter(Boolean).length ? `<button class="btn" id="beImgT">🧾 <span class="lbl">${BE.hideImg ? 'Show' : 'Hide'} bill</span></button>` : ''}<button class="btn" id="beClear">Clear</button><button class="btn pri" id="beSave">💾 Save bill</button>`);
  const hasImg = BE.pages && BE.pages.filter(Boolean).length && !BE.hideImg;
  const names = DB.D.parties.map(p => p.name).sort();
  let notes = '';
  if (BE.fromAI) notes += `<div class="note">✨ Read by Gemini. Check each line against the bill on the right (lines with an orange mark need a look), then press <b>Save bill</b>.</div>`;
  if (BE.distMatch && BE.distMatch.guess) notes += `<div class="note warn">Distributor matched by a similar name: bill says “${esc(BE.distRaw)}”. Check it is right.</div>`;
  if (BE.newParty && !DB.D.parties.some(p => DB.normKey(p.name) === DB.normKey(BE.distributor))) notes += `<div class="note warn">“${esc(BE.distributor)}” is a new distributor. It will be added to Party Details when you save${BE.newParty.gstin ? ' (GSTIN ' + esc(BE.newParty.gstin) + ')' : ''}.</div>`;
  $('page').innerHTML = `${notes}
  <div class="be ${hasImg ? '' : 'noimg'}">
    <div>
      <div class="card"><div class="fields">
        <div><label class="l">Distributor Name *</label><input class="f" id="beDist" list="distList" value="${esc(BE.distributor)}" autocomplete="off" placeholder="Type or choose"><datalist id="distList">${names.map(n => `<option value="${esc(n)}">`).join('')}</datalist></div>
        <div><label class="l">Invoice No *</label><input class="f" id="beInv" value="${esc(BE.invoiceNo)}" autocomplete="off"></div>
        <div><label class="l">Bill Date *</label><input class="f" type="date" id="beDate" value="${esc(BE.billDate)}"></div>
      </div><div id="beDup" class="small neg" style="margin-top:6px"></div></div>
      <div class="card" style="padding:10px">
        <div class="tw lines-w"><table class="t lines"><thead><tr><th>Sr</th>${COLS.map(c => `<th class="${c[3] ? 'n' : ''}" style="min-width:${COLW[c[0]] || 64}px">${c[1]}</th>`).join('')}<th class="n" style="min-width:96px">Net Amount</th><th></th></tr></thead>
        <tbody id="beBody"></tbody></table></div>
        <datalist id="itemList">${DB.itemNames().map(n => `<option value="${esc(n)}">`).join('')}</datalist>
        <div class="row-flex" style="margin-top:10px"><button class="btn sm" id="beAdd">+ Add line</button><span class="grow"></span></div>
        <div class="totbar" id="beTot"></div>
      </div>
    </div>
    ${hasImg ? `<div class="imgpane"><div class="bar"><b>Bill image</b><span class="grow"></span><button class="btn sm" data-z="-1">−</button><button class="btn sm" data-z="1">+</button><button class="btn sm" id="beOpen">Open</button></div><div class="view" id="beImg"></div></div>` : ''}
  </div>`;
  drawLines();
  if (hasImg) showImages();
  $('beDist').oninput = e => { BE.distributor = e.target.value.toUpperCase(); dupCheck(); saveDraft(); };
  $('beDist').onchange = e => { e.target.value = BE.distributor = DB.normKey(e.target.value); dupCheck(); saveDraft(); };
  $('beInv').oninput = e => { BE.invoiceNo = e.target.value.trim(); dupCheck(); saveDraft(); };
  $('beDate').onchange = e => { BE.billDate = e.target.value; saveDraft(); };
  $('beAdd').onclick = () => { BE.lines.push(blankLine()); drawLines(); const r = $('beBody').querySelectorAll('tr.ln'); r[r.length - 1].querySelector('input').focus(); };
  $('beSave').onclick = saveBill;
  if ($('beImgT')) $('beImgT').onclick = () => { BE.hideImg = !BE.hideImg; drawBill(); };
  $('beClear').onclick = async () => { if (await ask('Clear bill', 'Clear this bill entry? Nothing is saved.', 'Clear', true)) { BE = { distributor: '', invoiceNo: '', billDate: DB.todayISO(), lines: [blankLine()], pages: [] }; DB.setSetting('billDraft', null); go('bill'); drawBill(); } };
  dupCheck();
}
let ZOOM = 1;
async function showImages() {
  const v = $('beImg'); v.innerHTML = '';
  for (const id of BE.pages.filter(Boolean)) {
    const im = await DB.getImage(id); if (!im) continue;
    const u = URL.createObjectURL(im.blob);
    v.insertAdjacentHTML('beforeend', im.blob.type === 'application/pdf' ? `<iframe src="${u}"></iframe>` : `<img src="${u}" alt="Bill" style="width:${ZOOM * 100}%">`);
  }
  document.querySelectorAll('[data-z]').forEach(b => b.onclick = () => { ZOOM = Math.max(1, Math.min(4, ZOOM + (+b.dataset.z) * .5)); v.querySelectorAll('img').forEach(i => i.style.width = ZOOM * 100 + '%'); });
  $('beOpen').onclick = () => { const i = v.querySelector('img,iframe'); if (i) window.open(i.src, '_blank'); };
}
function lineIssues(l) {
  const out = [];
  if (l.suggest && l.suggest !== l.item) out.push(`Stock has “${esc(l.suggest)}”. <button data-sug="1">Use that name</button>`);
  if (l.billAmount && N(l.qty) > 0 && N(l.rate) > 0) {
    const d = Math.abs(l.billAmount - l.net);
    if (d > Math.max(1, l.net * 0.015)) out.push(`Bill shows amount ${money(l.billAmount)}, calculated ${money(l.net)}. Check Qty, Rate, Disc % and GST.`);
  }
  if (l.item && N(l.mrp) && N(l.rate) && N(l.rate) > N(l.mrp)) out.push('Rate is higher than MRP.');
  return out;
}
function drawLines() {
  $('beBody').innerHTML = BE.lines.map((l, i) => {
    const iss = l.item ? lineIssues(l) : [];
    return `<tr class="ln ${iss.length ? 'flag' : ''}" data-i="${i}"><td class="sr">${i + 1}</td>${COLS.map(c => {
      const miss = l.item && ((c[0] === 'batch' || c[0] === 'exp') && !String(l[c[0]] || '').trim() || (c[0] === 'mrp' && !N(l.mrp)) || (c[0] === 'qty' && !N(l.qty) && !N(l.free)));
      return `<td class="${c[2]}" data-l="${c[1]}"><input data-k="${c[0]}" class="${c[3] ? 'num' : ''} ${miss ? 'missing' : ''}" ${c[3] ? 'inputmode="decimal"' : ''} ${c[0] === 'item' ? 'list="itemList"' : ''} value="${esc(l[c[0]] === 0 && c[0] !== 'qty' ? '' : l[c[0]])}" autocomplete="off"></td>`;
    }).join('')}<td class="netc half" data-l="Net Amount">${money(l.net)}</td><td data-l=""><button class="btn sm" data-del="${i}" title="Delete line">✕</button></td></tr>` +
      (iss.length ? `<tr class="hint"><td colspan="${COLS.length + 3}"><div class="linehint">⚠ ${iss.join(' · ')}</div></td></tr>` : '');
  }).join('');
  const body = $('beBody');
  body.querySelectorAll('input').forEach(inp => {
    inp.oninput = () => lineInput(inp, false);
    inp.onchange = () => lineInput(inp, true);
    inp.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); const all = [...body.querySelectorAll('input')], k = all.indexOf(inp); if (k === all.length - 1) { BE.lines.push(blankLine()); drawLines(); body.querySelectorAll('tr.ln')[BE.lines.length - 1].querySelector('input').focus(); } else all[k + 1].focus(); } };
  });
  body.querySelectorAll('[data-del]').forEach(b => b.onclick = () => { BE.lines.splice(+b.dataset.del, 1); if (!BE.lines.length) BE.lines.push(blankLine()); drawLines(); saveDraft(); });
  wireHints();
  drawTotals();
}
function lineInput(inp, done) {
  const tr = inp.closest('tr'), i = +tr.dataset.i, l = BE.lines[i], k = inp.dataset.k;
  let v = inp.value;
  if (['item', 'batch', 'mfg'].includes(k)) v = v.toUpperCase();
  l[k] = v;
  if (done) {
    if (k === 'cgst' && String(l.sgst).trim() === '') l.sgst = l.cgst;          // same as the Excel sheet: CGST fills SGST
    if (k === 'item') { l.item = DB.normKey(v); delete l.suggest; autoFill(l); }
    if (k === 'exp') l.exp = DB.expNorm(v);
  }
  l.net = DB.calcNet(l);
  updateRow(i, done ? null : inp);
  drawTotals();
  saveDraft();
}
/* refresh one line in place (values filled by the app, Net Amount, warnings) without moving the cursor */
function updateRow(i, typing) {
  const tr = $('beBody').querySelector(`tr.ln[data-i="${i}"]`); if (!tr) return;
  const l = BE.lines[i];
  tr.querySelectorAll('input[data-k]').forEach(inp => {
    const k = inp.dataset.k, want = l[k] === 0 && k !== 'qty' ? '' : String(l[k] == null ? '' : l[k]);
    if (inp !== typing && inp.value !== want) inp.value = want;
    const miss = l.item && ((k === 'batch' || k === 'exp') && !String(l[k] || '').trim() || (k === 'mrp' && !N(l.mrp)) || (k === 'qty' && !N(l.qty) && !N(l.free)));
    inp.classList.toggle('missing', !!miss);
  });
  tr.querySelector('.netc').textContent = money(l.net);
  const iss = l.item ? lineIssues(l) : [];
  tr.classList.toggle('flag', iss.length > 0);
  const nx = tr.nextElementSibling, hasHint = nx && nx.classList.contains('hint');
  if (iss.length) {
    const html = `<td colspan="${COLS.length + 3}"><div class="linehint">⚠ ${iss.join(' · ')}</div></td>`;
    if (hasHint) nx.innerHTML = html; else tr.insertAdjacentHTML('afterend', `<tr class="hint">${html}</tr>`);
    wireHints();
  } else if (hasHint) nx.remove();
}
function wireHints() {
  $('beBody').querySelectorAll('[data-sug]').forEach(b => b.onclick = () => { const tr = b.closest('tr').previousElementSibling, i = +tr.dataset.i, l = BE.lines[i]; l.item = l.suggest; delete l.suggest; autoFill(l); updateRow(i); drawTotals(); saveDraft(); });
}
/* fills Mfg, HSN, CGST, SGST, MRP from an older bill of the same item (only empty cells), like the Excel sheet */
function autoFill(l) {
  const info = DB.itemInfo().get(DB.normKey(l.item)); if (!info) return;
  if (!String(l.mfg).trim()) l.mfg = info.mfg || '';
  if (!String(l.hsn).trim()) l.hsn = info.hsn || '';
  if (String(l.cgst).trim() === '') l.cgst = info.cgst == null ? '' : info.cgst;
  if (String(l.sgst).trim() === '') l.sgst = info.sgst == null ? '' : info.sgst;
  if (!N(l.mrp) && info.mrp) l.mrp = info.mrp;
  l.net = DB.calcNet(l);
}
function drawTotals() {
  const ls = BE.lines.filter(l => String(l.item).trim());
  const net = DB.r2(ls.reduce((a, l) => a + N(l.net), 0));
  const tot = BE.billTotal ? Math.abs(BE.billTotal - net) <= Math.max(2, net * 0.01) ? `<span class="pill ok">Matches bill total ${money(BE.billTotal)}</span>` : `<span class="pill warn">Bill total says ${money(BE.billTotal)} (difference ${money(BE.billTotal - net)})</span>` : '';
  $('beTot').innerHTML = `${tot}<span class="muted">${ls.length} item${ls.length === 1 ? '' : 's'}</span><span>Qty <b>${qty0(ls.reduce((a, l) => a + N(l.qty), 0))}</b></span><span>Free <b>${qty0(ls.reduce((a, l) => a + N(l.free), 0))}</b></span><span>Total <b>${money(net)}</b></span>`;
}
function dupCheck() {
  const el = $('beDup'); if (!el) return;
  const k = DB.normKey(BE.distributor) + '|' + DB.normKey(BE.invoiceNo);
  const b = BE.invoiceNo && DB.bills().find(b => b.key === k && b.key !== BE.editKey);
  el.innerHTML = b ? `Invoice ${esc(BE.invoiceNo)} of ${esc(BE.distributor)} is already saved (${esc(DB.showDate(b.date))}, ${money(b.total)}). <a href="#" id="seeDup">See it</a>` : '';
  if (b) $('seeDup').onclick = e => { e.preventDefault(); showBill(b.key); };
}
async function saveBill() {
  const dist = DB.normKey(BE.distributor), inv = String(BE.invoiceNo || '').trim();
  if (!dist) { toast('Choose the distributor first'); return $('beDist').focus(); }
  if (!inv) { toast('Type the Invoice No'); return $('beInv').focus(); }
  if (!BE.billDate) { toast('Type the Bill Date'); return $('beDate').focus(); }
  const ls = BE.lines.filter(l => String(l.item).trim());
  if (!ls.length) return toast('Type at least one item');
  for (let i = 0; i < BE.lines.length; i++) {
    const l = BE.lines[i]; if (!String(l.item).trim()) continue;
    if (N(l.qty) <= 0 && N(l.free) <= 0) { toast('Line ' + (i + 1) + ': type the Quantity'); return focusCell(i, 'qty'); }
    if (N(l.mrp) <= 0) { toast('Line ' + (i + 1) + ': type the MRP (needed for the sales invoice)'); return focusCell(i, 'mrp'); }
  }
  const miss = BE.lines.map((l, i) => String(l.item).trim() && (!String(l.batch).trim() || !String(l.exp).trim()) ? i + 1 : 0).filter(Boolean);
  if (miss.length && !await ask('Missing batch or expiry', 'Line(s) ' + miss.join(', ') + ' have no Batch No or Exp Date.\nSave anyway?', 'Save anyway')) return;
  const k = dist + '|' + DB.normKey(inv);
  if (DB.bills().some(b => b.key === k && b.key !== BE.editKey) && !await ask('Invoice already saved', 'Invoice ' + inv + ' is already saved for ' + dist + '.\nAdd these lines again?', 'Add again', true)) return;

  if (!DB.D.parties.some(p => DB.normKey(p.name) === dist)) {
    const np = BE.newParty || {};
    await DB.putMany('parties', [{ name: dist, address: np.address || '', gstin: (np.gstin || '').toUpperCase(), pan: DB.panOf(np.gstin), phone: np.phone || '', licence: np.licence || '' }]);
  }
  if (BE.editIds && BE.editIds.length) await DB.delMany('purchases', BE.editIds);
  const rows = ls.map(l => ({
    billDate: BE.billDate, invoiceNo: inv, distributor: dist, item: DB.normKey(l.item), mfg: String(l.mfg || '').toUpperCase().trim(), hsn: String(l.hsn || '').trim(),
    batch: String(l.batch || '').toUpperCase().trim(), exp: DB.expNorm(l.exp), qty: N(l.qty), free: N(l.free), mrp: N(l.mrp), rate: N(l.rate), disc: N(l.disc),
    cgst: N(l.cgst), sgst: N(l.sgst), net: DB.calcNet(l), imageId: (BE.pages && BE.pages[0]) || null, source: BE.fromAI ? 'ai' : 'manual', savedAt: new Date().toISOString(),
  }));
  await DB.putMany('purchases', rows);
  if (BE.inboxId) { const x = DB.D.inbox.find(i => i.fileId === BE.inboxId); if (x) { x.status = 'saved'; x.invoiceNo = inv; await DB.putMany('inbox', [x]); } }
  const next = BE.inboxId ? DB.D.inbox.find(x => x.status === 'ready') : null;
  BE = null; await DB.setSetting('billDraft', null);
  toast('Bill saved: ' + rows.length + ' item(s) of invoice ' + inv);
  if (next && await ask('Bill saved', 'Next bill is ready to check. Open it?', 'Open next')) return go('bill', { inbox: next.fileId });
  go('purchases');
}
function focusCell(i, k) { const el = $('beBody').querySelector(`tr[data-i="${i}"] input[data-k="${k}"]`); if (el) { el.focus(); el.scrollIntoView({ block: 'center' }); } }

/* ---------- one bill (popup) ---------- */
async function showBill(key) {
  const b = DB.bills().find(b => b.key === key); if (!b) return;
  modal(`<h3>${esc(b.distributor)} · ${esc(b.invoiceNo)} <button class="btn sm x" onclick="closeModal()">✕</button></h3>
    <div class="row-flex small muted" style="margin-bottom:10px"><span>Bill date ${esc(DB.showDate(b.date))}</span><span>${b.lines.length} items</span><span>Total <b style="color:var(--ink)">${money(b.total)}</b></span></div>
    ${table('bl', [{ h: 'Item Name', f: l => esc(l.item) }, { h: 'Mfg', f: l => esc(l.mfg) }, { h: 'Batch', f: l => esc(l.batch) }, { h: 'Exp', f: l => esc(l.exp) }, { h: 'Qty', n: 1, f: l => qty(l.qty) }, { h: 'Free', n: 1, f: l => qty(l.free) },
      { h: 'MRP', n: 1, f: l => N(l.mrp).toFixed(2) }, { h: 'Rate', n: 1, f: l => N(l.rate).toFixed(2) }, { h: 'Disc%', n: 1, f: l => qty(l.disc) }, { h: 'GST%', n: 1, f: l => qty(N(l.cgst) + N(l.sgst)) }, { h: 'Net', n: 1, f: l => money(l.net) }], b.lines, { limit: 500 })}
    <div class="row-flex" style="margin-top:14px">${b.image || b.lines.some(l => l.imageId) ? '<button class="btn" id="bImg">🧾 Bill image</button>' : ''}<span class="grow"></span>
      <button class="btn bad" id="bDel">Delete bill</button><button class="btn pri" id="bEdit">✎ Edit</button></div>`, true);
  $('bEdit').onclick = () => { closeModal(); go('bill', { edit: key }); };
  $('bDel').onclick = async () => { if (await ask('Delete bill', 'Delete invoice ' + b.invoiceNo + ' of ' + b.distributor + ' (' + b.lines.length + ' lines, ' + money(b.total) + ')?\nStock will be reduced.', 'Delete', true)) { await DB.delMany('purchases', b.lines.map(l => l.id)); toast('Bill deleted'); render(); } };
  if ($('bImg')) $('bImg').onclick = async () => { const id = (b.lines.find(l => l.imageId) || {}).imageId; const im = await DB.getImage(id); if (im) window.open(URL.createObjectURL(im.blob), '_blank'); else toast('Image not on this device'); };
}

/* ================= DISTRIBUTOR LEDGER (one sheet per distributor) ================= */
PAGES.ledger = q => {
  const parties = DB.partyStats().filter(p => p.bills);
  const sel = q.get('d') || (parties[0] && parties[0].name) || '';
  setTop('Distributor ledger', `<button class="btn" id="lgXls">⬇ <span class="lbl">Excel</span></button>`);
  const ls = DB.D.purchases.filter(l => DB.normKey(l.distributor) === DB.normKey(sel));
  const s = (q.get('s') || '');
  const rows = ls.filter(l => DB.matchWords(l.item + ' ' + l.invoiceNo + ' ' + l.batch, s)).sort((a, b) => (b.billDate || '').localeCompare(a.billDate || '') || String(a.invoiceNo).localeCompare(String(b.invoiceNo)));
  const p = parties.find(p => p.name === sel) || {};
  $('page').innerHTML = `<div class="card"><div class="fields">
      <div><label class="l">Distributor</label><select class="f" id="lgD">${parties.map(p => `<option ${p.name === sel ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select></div>
      <div><label class="l">Search item, invoice or batch</label><input class="f" id="lgS" value="${esc(s)}" placeholder="e.g. dolo"></div></div>
      <div class="row-flex small muted" style="margin-top:10px"><span>${p.bills || 0} bills</span><span>Total purchase <b style="color:var(--ink)">${money(p.total)}</b></span>${p.gstin ? '<span>GSTIN ' + esc(p.gstin) + '</span>' : ''}</div></div>
    ${table('lg', [{ h: 'Bill Date', f: l => esc(DB.showDate(l.billDate)) }, { h: 'Invoice No', f: l => esc(l.invoiceNo) }, { h: 'Item Name', f: l => esc(l.item) }, { h: 'Mfg', f: l => esc(l.mfg) }, { h: 'HSN', f: l => esc(l.hsn) },
      { h: 'Batch No', f: l => esc(l.batch) }, { h: 'Exp', f: l => esc(l.exp) }, { h: 'Qty', n: 1, f: l => qty(l.qty) }, { h: 'Free', n: 1, f: l => qty(l.free) }, { h: 'MRP', n: 1, f: l => N(l.mrp).toFixed(2) },
      { h: 'Rate', n: 1, f: l => N(l.rate).toFixed(2) }, { h: 'Disc', n: 1, f: l => qty(l.disc) }, { h: 'CGST', n: 1, f: l => qty(l.cgst) }, { h: 'SGST', n: 1, f: l => qty(l.sgst) }, { h: 'Net Amount', n: 1, f: l => money(l.net) }],
      rows, { click: 1, foot: ['TOTAL', rows.length + ' lines', '', '', '', '', '', qty0(rows.reduce((a, l) => a + N(l.qty), 0)), qty0(rows.reduce((a, l) => a + N(l.free), 0)), '', '', '', '', '', money(rows.reduce((a, l) => a + N(l.net), 0))], empty: 'No lines.' })}`;
  $('lgD').onchange = e => go('ledger', { d: e.target.value });
  $('lgS').oninput = debounce(e => { history.replaceState(null, '', '#/ledger?' + new URLSearchParams({ d: sel, s: e.target.value })); LIMIT = {}; PAGES.ledger(route().q); $('lgS').focus(); $('lgS').setSelectionRange(99, 99); }, 250);
  $('lgXls').onclick = () => Importer.exportWorkbook();
  wireTable('lg', rows, l => showBill(DB.normKey(l.distributor) + '|' + DB.normKey(l.invoiceNo)), () => PAGES.ledger(route().q));
};
function debounce(f, ms) { let h; return e => { clearTimeout(h); h = setTimeout(() => f(e), ms); }; }

/* ================= PURCHASE DETAILS ================= */
PAGES.purchases = q => {
  const from = q.get('from') || '', to = q.get('to') || '', s = q.get('s') || '';
  setTop('Purchase Details', `<button class="btn pri" onclick="go('bill')">✎ <span class="lbl">New bill</span></button>`);
  const rows = DB.bills().filter(b => (!from || (b.date || '') >= from) && (!to || (b.date || '') <= to) && DB.matchWords(b.distributor + ' ' + b.invoiceNo, s));
  const total = rows.reduce((a, b) => a + b.total, 0);
  $('page').innerHTML = `<div class="card"><div class="fields">
      <div><label class="l">From date</label><input class="f" type="date" id="pF" value="${esc(from)}"></div><div><label class="l">To date</label><input class="f" type="date" id="pT" value="${esc(to)}"></div>
      <div><label class="l">Distributor or invoice</label><input class="f" id="pS" value="${esc(s)}"></div></div>
      <div class="chips" style="margin-top:10px">${[['This month', 0], ['Last month', 1], ['This year', 'y'], ['All', 'a']].map(([t, v]) => `<button class="chip" data-p="${v}">${t}</button>`).join('')}</div></div>
    <div class="note">${rows.length.toLocaleString('en-IN')} bill${rows.length === 1 ? '' : 's'}${from || to ? ' from ' + (DB.showDate(from) || 'start') + ' to ' + (DB.showDate(to) || 'today') : ''} · total ${money(total)}</div>
    ${table('pu', [{ h: 'Invoice Date', f: b => esc(DB.showDate(b.date)) }, { h: 'Distributor Name', f: b => esc(b.distributor) }, { h: 'Invoice No', f: b => esc(b.invoiceNo) }, { h: 'Items', n: 1, f: b => b.lines.length },
      { h: 'Total Bill Value', n: 1, f: b => money(b.total) }, { h: '', f: b => b.lines.some(l => l.source === 'ai') ? '<span class="pill info">✨ AI</span>' : '' }], rows,
      { click: 1, foot: ['TOTAL', rows.length + ' bills', '', rows.reduce((a, b) => a + b.lines.length, 0), money(total), ''], empty: 'No bills in this period.' })}`;
  const upd = () => go('purchases', Object.fromEntries(Object.entries({ from: $('pF').value, to: $('pT').value, s: $('pS').value }).filter(x => x[1])));
  $('pF').onchange = upd; $('pT').onchange = upd; $('pS').onchange = upd;
  document.querySelectorAll('[data-p]').forEach(c => c.onclick = () => {
    const d = new Date(), y = d.getFullYear(), m = d.getMonth(), iso = x => DB.toISO(x), v = c.dataset.p;
    if (v === 'a') return go('purchases');
    if (v === 'y') return go('purchases', { from: y + '-01-01', to: iso(d) });
    const a = new Date(y, m - +v, 1), b = +v ? new Date(y, m, 0) : d;
    go('purchases', { from: iso(a), to: iso(b) });
  });
  wireTable('pu', rows, b => showBill(b.key), () => PAGES.purchases(route().q));
};

/* ================= PARTY DETAILS ================= */
PAGES.parties = q => {
  const s = q.get('s') || '';
  setTop('Party Details', `<button class="btn pri" id="ptNew">+ <span class="lbl">Add distributor</span></button>`);
  const rows = DB.partyStats().filter(p => DB.matchWords(p.name + ' ' + (p.gstin || '') + ' ' + (p.address || ''), s));
  $('page').innerHTML = `<div class="card"><label class="l">Search</label><input class="f" id="ptS" value="${esc(s)}" placeholder="Name, GSTIN or address"></div>
    ${table('pt', [{ h: 'Sr', f: p => rows.indexOf(p) + 1 }, { h: 'Distributor Name', f: p => esc(p.name) + (p.missing ? ' <span class="pill warn">details missing</span>' : '') }, { h: 'Address', f: p => esc(p.address) },
      { h: 'GSTIN', f: p => p.gstin ? esc(p.gstin) + (DB.gstinOK(p.gstin) ? '' : ' <span class="pill bad">check</span>') : '' }, { h: 'PAN', f: p => esc(p.pan || DB.panOf(p.gstin)) }, { h: 'Phone No', f: p => esc(p.phone) },
      { h: 'Licence No', f: p => esc(p.licence) }, { h: 'Bills', n: 1, f: p => p.bills }, { h: 'Total Purchase', n: 1, f: p => money(p.total) }], rows,
      { click: 1, foot: ['', rows.length + ' distributors', '', '', '', '', '', rows.reduce((a, p) => a + p.bills, 0), money(rows.reduce((a, p) => a + p.total, 0))] })}`;
  $('ptS').oninput = debounce(e => { history.replaceState(null, '', '#/parties?s=' + encodeURIComponent(e.target.value)); PAGES.parties(route().q); $('ptS').focus(); $('ptS').setSelectionRange(99, 99); }, 250);
  $('ptNew').onclick = () => partyForm(null);
  wireTable('pt', rows, p => partyForm(p), () => PAGES.parties(route().q));
};
function partyForm(p) {
  const x = p || { name: '', address: '', gstin: '', phone: '', licence: '' };
  modal(`<h3>${p ? 'Edit distributor' : 'Add distributor'} <button class="btn sm x" onclick="closeModal()">✕</button></h3>
    <div class="fields">
      <div><label class="l">Distributor Name *</label><input class="f" id="fN" value="${esc(x.name)}" ${p && p.bills ? 'readonly title="Has bills: name cannot change"' : ''}></div>
      <div><label class="l">GSTIN *</label><input class="f" id="fG" value="${esc(x.gstin)}" maxlength="15" style="text-transform:uppercase"></div>
      <div style="grid-column:1/-1"><label class="l">Address *</label><input class="f" id="fA" value="${esc(x.address)}"></div>
      <div><label class="l">Phone No</label><input class="f" id="fP" value="${esc(x.phone)}" inputmode="tel"></div>
      <div><label class="l">Licence No</label><input class="f" id="fL" value="${esc(x.licence)}"></div>
    </div><div id="fMsg" class="small" style="margin:10px 0"></div>
    ${p ? `<div class="small muted">${p.bills} bills · total purchase ${money(p.total)}${p.last ? ' · last bill ' + esc(DB.showDate(p.last)) : ''}</div>` : ''}
    <div class="row-flex" style="margin-top:14px">${p && p.bills ? `<button class="btn" onclick="closeModal();go('ledger',{d:'${esc(p.name).replace(/'/g, "\\'")}'})">▤ Ledger</button>` : ''}${p && !p.bills && !p.missing ? '<button class="btn bad" id="fDel">Delete</button>' : ''}<span class="grow"></span><button class="btn" onclick="closeModal()">Cancel</button><button class="btn pri" id="fSave">Save</button></div>`);
  $('fG').oninput = () => { const g = $('fG').value.toUpperCase().trim(); $('fMsg').innerHTML = g.length === 15 ? DB.gstinOK(g) ? '<span class="pos">GSTIN looks valid · PAN ' + DB.panOf(g) + '</span>' : '<span class="neg">GSTIN format is not valid</span>' : ''; };
  $('fG').oninput();
  $('fSave').onclick = async () => {
    const name = DB.normKey($('fN').value), g = $('fG').value.toUpperCase().trim(), a = $('fA').value.trim();
    if (!name) return $('fMsg').innerHTML = '<span class="neg">Type the distributor name</span>';
    if (!a) return $('fMsg').innerHTML = '<span class="neg">Type the address</span>';
    if (!g) return $('fMsg').innerHTML = '<span class="neg">Type the GSTIN</span>';
    if (!DB.gstinOK(g) && !await ask('GSTIN looks wrong', g + ' is not a valid GSTIN format. Save anyway?', 'Save')) return;
    const other = DB.D.parties.find(q => q.gstin === g && DB.normKey(q.name) !== DB.normKey(p ? p.name : name));
    if (other && !await ask('Same GSTIN', 'GSTIN ' + g + ' is already used by ' + other.name + '. Save anyway?', 'Save')) return;
    if (!p && DB.D.parties.some(q => DB.normKey(q.name) === name)) return $('fMsg').innerHTML = '<span class="neg">This distributor already exists</span>';
    if (p && p.name !== name && !p.bills) await DB.delMany('parties', [p.name]);
    await DB.putMany('parties', [{ name, address: a, gstin: g, pan: DB.panOf(g), phone: $('fP').value.trim(), licence: $('fL').value.trim() }]);
    closeModal(); toast('Saved'); render();
  };
  if ($('fDel')) $('fDel').onclick = async () => { if (await ask('Delete', 'Delete ' + p.name + '?', 'Delete', true)) { await DB.delMany('parties', [p.name]); closeModal(); render(); } };
}

/* ================= STOCKS ================= */
PAGES.stock = q => {
  const s = q.get('s') || '', f = q.get('f') || 'all';
  setTop('Stocks', `<button class="btn" id="stUndo">↶ <span class="lbl">Undo last adjust</span></button><button class="btn" id="stLog">Adjust log</button>`);
  const { rows: all, unmatched } = DB.stock();
  const rows = all.filter(r => DB.matchWords(r.name + ' ' + r.batch, s) && (f === 'all' || (f === 'in' && r.rem > 0) || (f === 'out' && r.rem === 0) || (f === 'neg' && r.rem < 0)));
  const sum = k => rows.reduce((a, r) => a + r[k], 0), val = DB.r2x(sum('value'));
  $('page').innerHTML = `<div class="card"><div class="fields"><div><label class="l">Search medicine (all words, e.g. “dolo 650”)</label><input class="f" id="stS" value="${esc(s)}" placeholder="Medicine or batch"></div></div>
      <div class="chips" style="margin-top:10px">${[['all', 'All'], ['in', 'In stock'], ['out', 'Finished'], ['neg', 'Negative']].map(([k, t]) => `<button class="chip ${f === k ? 'on' : ''}" data-f="${k}">${t}</button>`).join('')}</div></div>
    <div class="note">Showing ${rows.length.toLocaleString('en-IN')} of ${all.length.toLocaleString('en-IN')} batch(es). Stock value: <b>${money(val)}</b>. Tap a line to add or reduce stock.</div>
    ${unmatched ? `<div class="note warn">${unmatched} sale line(s) do not match a purchased medicine + batch.</div>` : ''}
    ${table('st', [{ h: 'Product Name', f: r => esc(r.name) }, { h: 'Batch No', f: r => esc(r.batch) }, { h: 'Exp', f: r => r.exp ? DB.expShow(r.exp) : '' }, { h: 'Purchased', n: 1, f: r => qty(r.pur) }, { h: 'Free', n: 1, f: r => qty(r.free) },
      { h: 'Total Qty', n: 1, f: r => qty(r.total) }, { h: 'Sold Qty', n: 1, f: r => qty(r.sold) }, { h: 'Add Stock', n: 1, f: r => qty(r.add) }, { h: 'Reduce Stock', n: 1, f: r => qty(r.red) },
      { h: 'Remaining', n: 1, f: r => `<b>${qty(r.rem) || (r.rem === 0 ? '0' : '')}</b>` }, { h: 'Total Value', n: 1, f: r => r.value ? money(r.value) : '' }], rows,
      { click: 1, rowClass: r => r.rem < 0 ? 'neg-row' : '', foot: ['TOTAL', rows.length + ' batches', '', qty0(sum('pur')), qty0(sum('free')), qty0(sum('total')), qty0(sum('sold')), qty0(sum('add')), qty0(sum('red')), qty0(sum('rem')), money(val)] })}`;
  $('stS').oninput = debounce(e => { history.replaceState(null, '', '#/stock?' + new URLSearchParams({ s: e.target.value, f })); LIMIT = {}; PAGES.stock(route().q); $('stS').focus(); $('stS').setSelectionRange(99, 99); }, 250);
  document.querySelectorAll('[data-f]').forEach(c => c.onclick = () => go('stock', { s, f: c.dataset.f }));
  $('stUndo').onclick = undoAdjust;
  $('stLog').onclick = adjustLog;
  wireTable('st', rows, adjustForm, () => PAGES.stock(route().q));
};
function adjustForm(r) {
  modal(`<h3>Adjust stock <button class="btn sm x" onclick="closeModal()">✕</button></h3>
    <p style="margin:0 0 12px"><b>${esc(r.name)}</b> · batch ${esc(r.batch)} · now <b>${qty0(r.rem)}</b> in stock</p>
    <div class="fields"><div><label class="l">Add stock</label><input class="f" id="aA" inputmode="decimal"></div><div><label class="l">Reduce stock</label><input class="f" id="aR" inputmode="decimal"></div>
    <div style="grid-column:1/-1"><label class="l">Reason</label><select class="f" id="aW"><option>Stock count correction</option><option>Damaged / broken</option><option>Expired - returned to distributor</option><option>Expired - destroyed</option><option>Opening stock</option><option>Other</option></select></div></div>
    <div class="row-flex" style="margin-top:14px"><span class="grow"></span><button class="btn" onclick="closeModal()">Cancel</button><button class="btn pri" id="aS">Save</button></div>`);
  $('aS').onclick = async () => {
    const a = N($('aA').value), d = N($('aR').value);
    if (!a && !d) return toast('Type a quantity to add or reduce');
    const now = new Date();
    await DB.putMany('adjust', [{ date: DB.todayISO(), item: r.name, batch: r.batch === '-' ? '' : r.batch, add: a, reduce: d, reason: $('aW').value, enteredOn: now.toLocaleString('en-IN') }]);
    closeModal(); toast('Stock adjusted'); render();
  };
}
async function undoAdjust() {
  const last = DB.D.adjust.slice().sort((a, b) => (a.id || 0) - (b.id || 0)).pop();
  if (!last) return toast('No adjustment to undo');
  if (!await ask('Undo last adjustment', `${last.item} (${last.batch || '-'}): ${last.add ? '+' + last.add : ''}${last.reduce ? ' −' + last.reduce : ''}\n${last.reason}, entered ${last.enteredOn}`, 'Undo')) return;
  const { id, ...rest } = last;
  await DB.putMany('adjustUndone', [{ ...rest, undoneOn: new Date().toLocaleString('en-IN') }]);
  await DB.delMany('adjust', [id]);
  toast('Undone'); render();
}
function adjustLog() {
  const a = DB.D.adjust.slice().reverse(), u = DB.D.adjustUndone.slice().reverse();
  const cols = [{ h: 'Date', f: x => esc(DB.showDate(x.date)) }, { h: 'Medicine', f: x => esc(x.item) }, { h: 'Batch', f: x => esc(x.batch) }, { h: 'Add', n: 1, f: x => qty(x.add) }, { h: 'Reduce', n: 1, f: x => qty(x.reduce) }, { h: 'Reason', f: x => esc(x.reason) }, { h: 'Entered On', f: x => esc(x.enteredOn) }];
  modal(`<h3>Stock adjustments <button class="btn sm x" onclick="closeModal()">✕</button></h3>${table('al', cols, a, { empty: 'No adjustments.' })}
    <h3 style="margin-top:18px">Undone</h3>${table('au', [...cols, { h: 'Undone On', f: x => esc(x.undoneOn) }], u, { empty: 'Nothing undone.' })}`, true);
}

/* ================= MEDICINE SEARCH ================= */
PAGES.medicine = q => {
  const s = q.get('s') || '';
  setTop('Medicine Search');
  const rows = s.trim() ? DB.D.purchases.filter(l => DB.matchWords(l.item, s)).sort((a, b) => a.item.localeCompare(b.item) || (b.billDate || '').localeCompare(a.billDate || '')) : [];
  const st = s.trim() ? DB.stock().rows.filter(r => DB.matchWords(r.name, s) && r.rem !== 0) : [];
  $('page').innerHTML = `<div class="card"><label class="l">Medicine name</label><input class="f" id="mS" value="${esc(s)}" placeholder="Type a medicine, e.g. pantakind" list="itemList2" autocomplete="off"><datalist id="itemList2">${DB.itemNames().map(n => `<option value="${esc(n)}">`).join('')}</datalist></div>
    ${s.trim() ? `${st.length ? `<div class="card"><h2>In stock now <span class="sub">${st.length} batch(es)</span></h2>${table('ms2', [{ h: 'Medicine', f: r => esc(r.name) }, { h: 'Batch', f: r => esc(r.batch) }, { h: 'Exp', f: r => DB.expShow(r.exp) }, { h: 'MRP', n: 1, f: r => r.mrp ? r.mrp.toFixed(2) : '' }, { h: 'Remaining', n: 1, f: r => `<b class="${r.rem < 0 ? 'neg' : ''}">${qty0(r.rem)}</b>` }], st, { limit: 50 })}</div>` : ''}
      <div class="card"><h2>Purchase history <span class="sub">${rows.length} line(s)</span></h2>${table('ms', [{ h: 'Distributor Name', f: l => esc(l.distributor) }, { h: 'Medicine Name', f: l => esc(l.item) }, { h: 'Invoice No', f: l => esc(l.invoiceNo) },
        { h: 'Invoice Date', f: l => esc(DB.showDate(l.billDate)) }, { h: 'Batch No', f: l => esc(l.batch) }, { h: 'Quantity', n: 1, f: l => qty(l.qty) }, { h: 'Free Qty', n: 1, f: l => qty(l.free) }, { h: 'Rate', n: 1, f: l => N(l.rate).toFixed(2) }, { h: 'Expiry Date', f: l => esc(l.exp) }],
        rows, { click: 1, foot: ['TOTAL', '', '', '', '', qty0(rows.reduce((a, l) => a + N(l.qty), 0)), qty0(rows.reduce((a, l) => a + N(l.free), 0)), '', ''], empty: 'No purchase found.' })}</div>` : '<div class="empty">Type a medicine name to see who supplied it, at what rate, and the batches in stock.</div>'}`;
  $('mS').oninput = debounce(e => { history.replaceState(null, '', '#/medicine?s=' + encodeURIComponent(e.target.value)); LIMIT = {}; PAGES.medicine(route().q); $('mS').focus(); $('mS').setSelectionRange(99, 99); }, 300);
  wireTable('ms', rows, l => showBill(DB.normKey(l.distributor) + '|' + DB.normKey(l.invoiceNo)), () => PAGES.medicine(route().q));
};

/* ================= EXPIRY SEARCH ================= */
PAGES.expiry = q => {
  const t1 = q.get('from') || '', t2 = q.get('to') || '', onlyStock = q.get('st') !== '0';
  setTop('Expiry Search');
  let a = DB.expKey(t1 || t2), b = DB.expKey(t2 || t1); if (a > b) [a, b] = [b, a];
  const d = new Date(), ym = d.getFullYear() * 100 + d.getMonth() + 1;
  const addM = (k, m) => { let y = Math.floor(k / 100), mo = k % 100 + m; while (mo > 12) { mo -= 12; y++; } while (mo < 1) { mo += 12; y--; } return y * 100 + mo; };
  let rows = [];
  if (a) {
    // same medicine + same expiry = 1 line (like the Excel sheet); "In stock" from batch-wise stock
    const m = new Map(), stk = new Map(DB.stock().rows.map(r => [r.key, r]));
    for (const l of DB.D.purchases) {
      const k = DB.expKey(l.exp); if (!k || k < a || k > b) continue;
      const key = DB.normKey(l.item) + '|' + k;
      let x = m.get(key); if (!x) { x = { name: DB.normKey(l.item), k, q: 0, f: 0, batches: new Set(), rem: 0, val: 0 }; m.set(key, x); }
      x.q += N(l.qty); x.f += N(l.free); x.batches.add(DB.batchKey(l.batch));
    }
    for (const x of m.values()) for (const bt of x.batches) { const s = stk.get(x.name + '|' + bt); if (s && s.rem > 0) { x.rem += s.rem; x.val += s.value; } }
    rows = [...m.values()].filter(x => !onlyStock || x.rem > 0).sort((p, q) => p.k - q.k || p.name.localeCompare(q.name));
  }
  const show = k => DB.expShow(k);
  $('page').innerHTML = `<div class="card"><div class="fields"><div><label class="l">FROM (MM/YY)</label><input class="f" id="eF" value="${esc(t1)}" placeholder="e.g. 12/26"></div><div><label class="l">TO (MM/YY)</label><input class="f" id="eT" value="${esc(t2)}" placeholder="e.g. 03/27"></div></div>
    <div class="chips" style="margin-top:10px"><button class="chip" data-r="exp">Already expired</button><button class="chip" data-r="0">This month</button><button class="chip" data-r="3">Next 3 months</button><button class="chip" data-r="6">Next 6 months</button>
    <label class="chip"><input type="checkbox" id="eSt" ${onlyStock ? 'checked' : ''}> Only medicines still in stock</label></div></div>
    ${a ? `<div class="note ${rows.length ? 'warn' : 'ok'}">${rows.length ? rows.length + ' medicine line(s) expire in ' + show(a) + (b !== a ? ' to ' + show(b) : '') + ' · stock value ' + money(rows.reduce((s, x) => s + x.val, 0)) : 'No medicine found with expiry ' + show(a) + (b !== a ? ' to ' + show(b) : '')}</div>
    ${table('ex', [{ h: 'Medicine Name', f: x => esc(x.name) }, { h: 'Quantity', n: 1, f: x => qty(x.q) }, { h: 'Free Qty', n: 1, f: x => qty(x.f) }, { h: 'Total Qty', n: 1, f: x => qty0(x.q + x.f) },
      { h: 'In stock now', n: 1, f: x => `<b>${qty0(x.rem)}</b>` }, { h: 'Stock value', n: 1, f: x => x.val ? money(x.val) : '' }, { h: 'Expiry Date', f: x => `<span class="pill ${x.k < ym ? 'bad' : 'warn'}">${show(x.k)}</span>` }], rows,
      { foot: ['TOTAL', qty0(rows.reduce((s, x) => s + x.q, 0)), qty0(rows.reduce((s, x) => s + x.f, 0)), qty0(rows.reduce((s, x) => s + x.q + x.f, 0)), qty0(rows.reduce((s, x) => s + x.rem, 0)), money(rows.reduce((s, x) => s + x.val, 0)), ''] })}`
    : '<div class="empty">Type month/year like 12/26 or 03-27, or tap a quick range.</div>'}`;
  const upd = () => go('expiry', { from: $('eF').value.trim(), to: $('eT').value.trim(), st: $('eSt').checked ? '1' : '0' });
  $('eF').onchange = upd; $('eT').onchange = upd; $('eSt').onchange = upd;
  document.querySelectorAll('[data-r]').forEach(c => c.onclick = () => {
    const r = c.dataset.r;
    if (r === 'exp') return go('expiry', { from: '1/20', to: show(addM(ym, -1)), st: $('eSt').checked ? '1' : '0' });
    go('expiry', { from: show(ym), to: show(addM(ym, +r)), st: $('eSt').checked ? '1' : '0' });
  });
  wireTable('ex', rows, null, () => PAGES.expiry(route().q));
};

/* ================= SETTINGS ================= */
PAGES.settings = q => {
  setTop('Settings & data');
  const g = k => esc(DB.getSetting(k, '') || '');
  $('page').innerHTML = `
  <div class="card" id="sec-ai"><h2>✨ Automatic bill reading (Google Gemini, free)</h2>
    <ol class="steps small"><li>Open <a href="https://aistudio.google.com/app/apikey" target="_blank" rel="noopener">aistudio.google.com/app/apikey</a> and sign in with your Google account.</li>
      <li>Press <b>Create API key</b> and copy it.</li><li>Paste it below and press <b>Save</b>, then <b>Test</b>.</li></ol>
    <div class="fields" style="margin-top:10px"><div><label class="l">Gemini API key</label><input class="f" id="sKey" type="password" value="${g('geminiKey')}" autocomplete="off" placeholder="AIza..."></div>
      <div><label class="l">Model</label><input class="f" id="sModel" value="${g('geminiModel') || AI.GEMINI_DEFAULT_MODEL}"></div></div>
    <div class="row-flex" style="margin-top:12px"><button class="btn pri" id="sKeySave">Save</button><button class="btn" id="sKeyTest">Test</button><span id="sKeyMsg" class="small"></span></div>
    <p class="muted small">The key is kept only on this device. On the free tier Google may use the images to improve its products; for full privacy use a paid key.</p></div>

  <div class="card" id="sec-drive"><h2>🗂️ Google Drive bills folder</h2>
    <p class="small" style="margin-top:0">Put bill photos (from your phone or scanner) in one Drive folder. The app lists new files there and reads them.</p>
    <details class="small"><summary><b>One-time setup (about 10 minutes)</b></summary><ol class="steps">
      <li>Open <a href="https://console.cloud.google.com/" target="_blank" rel="noopener">console.cloud.google.com</a> → create a project (any name).</li>
      <li><b>APIs &amp; Services → Library</b> → enable <b>Google Drive API</b>.</li>
      <li><b>OAuth consent screen</b> → External → app name “Pharmacy Bill” → add your Gmail as a <b>Test user</b>.</li>
      <li><b>Credentials → Create credentials → OAuth client ID</b> → type <b>Web application</b> → under <i>Authorised JavaScript origins</i> add <code>${esc(location.origin)}</code>.</li>
      <li>Copy the <b>Client ID</b> (ends with .apps.googleusercontent.com) and paste it below.</li>
      <li>Open your bills folder in Drive and copy its link from the address bar.</li></ol></details>
    <div class="fields" style="margin-top:10px"><div><label class="l">OAuth Client ID</label><input class="f" id="sCid" value="${g('driveClientId')}" placeholder="....apps.googleusercontent.com"></div>
      <div><label class="l">Bills folder link</label><input class="f" id="sFolder" value="${g('driveFolder')}" placeholder="https://drive.google.com/drive/folders/..."></div></div>
    <label class="row-flex small" style="margin-top:10px"><input type="checkbox" id="sAuto" ${DB.getSetting('autoRead') ? 'checked' : ''}> Read new bills automatically when they are found</label>
    <div class="row-flex" style="margin-top:12px"><button class="btn pri" id="sDrSave">Save</button><button class="btn" id="sDrTest">Connect &amp; test</button><span id="sDrMsg" class="small"></span></div></div>

  <div class="card"><h2>🏪 Shop</h2><div class="fields"><div><label class="l">Pharmacy name</label><input class="f" id="sShop" value="${g('shopName')}"></div>
    <div><label class="l">Theme</label><select class="f" id="sTheme"><option value="">Same as device</option><option value="light">Light</option><option value="dark">Dark</option></select></div></div>
    <div class="row-flex" style="margin-top:12px"><button class="btn pri" id="sShopSave">Save</button></div></div>

  <div class="card"><h2>💾 Data</h2>
    <p class="small muted" style="margin-top:0">${DB.D.purchases.length.toLocaleString('en-IN')} bill lines · ${DB.D.parties.length} distributors · ${DB.D.saleItems.length} sale lines · ${DB.D.adjust.length} stock adjustments. Data is stored on this device. Download a backup regularly.</p>
    <div class="row-flex"><button class="btn pri" id="sImp">⬆ Import Excel workbook (.xlsm)</button><button class="btn" id="sExp">⬇ Export to Excel</button>
      <button class="btn" id="sBak">⬇ Download backup</button><button class="btn" id="sRes">⬆ Restore backup</button><button class="btn bad" id="sWipe">Delete all data</button></div>
    <p class="small muted">Use the backup file to move your data between the shop PC and your phone.</p></div>`;
  $('sTheme').value = DB.getSetting('theme', '') || '';
  if (q.get('s') === 'drive') setTimeout(() => $('sec-drive').scrollIntoView({ behavior: 'smooth' }), 50);
  $('sKeySave').onclick = async () => { await DB.setSetting('geminiKey', $('sKey').value.trim()); await DB.setSetting('geminiModel', $('sModel').value.trim()); toast('Saved'); };
  $('sKeyTest').onclick = async () => {
    await DB.setSetting('geminiKey', $('sKey').value.trim()); await DB.setSetting('geminiModel', $('sModel').value.trim());
    $('sKeyMsg').innerHTML = '<span class="spin"></span> Testing…';
    try {
      const r = await fetch('https://generativelanguage.googleapis.com/v1beta/models/' + encodeURIComponent($('sModel').value.trim() || AI.GEMINI_DEFAULT_MODEL), { headers: { 'x-goog-api-key': $('sKey').value.trim() } });
      $('sKeyMsg').innerHTML = r.ok ? '<span class="pos">✔ Key works. Bills can be read.</span>' : '<span class="neg">✖ ' + esc(((await r.json()).error || {}).message || r.status) + '</span>';
    } catch (e) { $('sKeyMsg').innerHTML = '<span class="neg">✖ No internet connection</span>'; }
  };
  const saveDrive = async () => { await DB.setSetting('driveClientId', $('sCid').value.trim()); await DB.setSetting('driveFolder', $('sFolder').value.trim()); await DB.setSetting('autoRead', $('sAuto').checked); };
  $('sDrSave').onclick = async () => { await saveDrive(); toast('Saved'); };
  $('sDrTest').onclick = async () => {
    await saveDrive(); $('sDrMsg').innerHTML = '<span class="spin"></span> Connecting…';
    try { const f = await AI.driveList(); $('sDrMsg').innerHTML = '<span class="pos">✔ Connected. ' + f.length + ' bill file(s) in the folder.</span>'; PAGES.scan._checked = false; }
    catch (e) { $('sDrMsg').innerHTML = '<span class="neg">✖ ' + esc(e.message) + '</span>'; }
  };
  $('sShopSave').onclick = async () => { await DB.setSetting('shopName', $('sShop').value.trim()); await DB.setSetting('theme', $('sTheme').value); applyTheme(); renderNav(); toast('Saved'); };
  $('sImp').onclick = importExcelFlow;
  $('sExp').onclick = () => Importer.exportWorkbook().catch(e => toast(e.message));
  $('sBak').onclick = async () => download('pharmacy-bill-backup-' + DB.todayISO() + '.json', new Blob([JSON.stringify(await DB.exportBackup())], { type: 'application/json' }));
  $('sRes').onclick = async () => {
    const [f] = await pickFile('.json,application/json'); if (!f) return;
    try { const obj = JSON.parse(await f.text()); if (!await ask('Restore backup', 'Replace ALL data on this device with the backup from ' + (obj.at || '?').slice(0, 10) + '?', 'Restore', true)) return; await DB.importBackup(obj); toast('Backup restored'); render(); }
    catch (e) { toast(e.message, 5000); }
  };
  $('sWipe').onclick = async () => { if (await ask('Delete all data', 'Delete ALL bills, distributors, stock and sales on this device? Download a backup first.', 'Delete everything', true)) { await DB.clearStores(['parties', 'purchases', 'sales', 'saleItems', 'adjust', 'adjustUndone', 'inbox']); toast('All data deleted'); render(); } };
};
async function importExcelFlow() {
  const [f] = await pickFile('.xlsm,.xlsx,.xls'); if (!f) return;
  modal('<h3><span class="spin"></span> Reading ' + esc(f.name) + '…</h3><p class="muted small" id="impMsg">This can take a few seconds.</p>');
  try {
    const x = await Importer.importWorkbook(f, m => { const e = $('impMsg'); if (e) e.textContent = m; });
    const val = x.purchases.reduce((a, l) => a + l.net, 0);
    closeModal();
    if (!await ask('Import workbook', `Found ${x.report.sheets} distributor sheets with ${x.purchases.length.toLocaleString('en-IN')} bill lines (${money(val)}), ${x.parties.length} distributors, ${x.saleItems.length} sale lines and ${x.adjust.length} stock adjustments.\n\nThis REPLACES the bills, distributors, sales and adjustments now in the app.`, 'Import', !!DB.D.purchases.length)) return;
    modal('<h3><span class="spin"></span> Saving…</h3>');
    await Importer.applyImport(x);
    closeModal(); toast('Imported ' + x.purchases.length.toLocaleString('en-IN') + ' bill lines'); go('dashboard'); render();
  } catch (e) { closeModal(); toast('Import failed: ' + e.message, 6000); console.error(e); }
}
function applyTheme() { const t = DB.getSetting('theme', ''); if (t) document.documentElement.dataset.theme = t; else delete document.documentElement.dataset.theme; }

/* ================= start ================= */
(async () => {
  try { await DB.loadAll(); } catch (e) { $('page').innerHTML = '<div class="note bad">This browser blocked local storage, so the app cannot keep data. Open it in Chrome or Edge (not a private window).</div>'; return; }
  applyTheme();
  render();
  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) navigator.serviceWorker.register('sw.js').catch(() => {});
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});   // ask the browser not to clear the data
})();
