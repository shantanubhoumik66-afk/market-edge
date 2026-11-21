/* Bill reading with Google Gemini (free tier) + bill images from a Google Drive folder. */
'use strict';

const GEMINI_DEFAULT_MODEL = 'gemini-2.5-flash';

const BILL_SCHEMA = {
  type: 'OBJECT',
  properties: {
    distributor: { type: 'STRING', description: 'Seller / distributor / wholesaler company name printed at the top of the bill (NOT the buyer pharmacy)' },
    distributor_gstin: { type: 'STRING', description: 'GSTIN of the seller, 15 characters, empty if not printed' },
    distributor_address: { type: 'STRING' },
    distributor_phone: { type: 'STRING' },
    distributor_licence: { type: 'STRING', description: 'Drug licence number(s) of the seller (D.L. No)' },
    invoice_no: { type: 'STRING' },
    invoice_date: { type: 'STRING', description: 'Invoice date as DD-MM-YYYY' },
    bill_total: { type: 'NUMBER', description: 'Final grand total / net payable of the whole bill' },
    items: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          item: { type: 'STRING', description: 'Product / medicine name with strength and form exactly as printed, e.g. DOLO 650 TAB' },
          mfg: { type: 'STRING', description: 'Manufacturer / company short name (column Mfg, Co., Company, MFR)' },
          hsn: { type: 'STRING', description: 'HSN code, digits only' },
          batch: { type: 'STRING' },
          exp: { type: 'STRING', description: 'Expiry as M/YY, e.g. 8/26' },
          pack: { type: 'STRING', description: 'Pack size as printed, e.g. 10S, 1x15, 100ML' },
          qty: { type: 'NUMBER', description: 'Billed (charged) quantity in packs/strips, without free' },
          free: { type: 'NUMBER', description: 'Free / scheme / bonus quantity, 0 if none' },
          mrp: { type: 'NUMBER', description: 'MRP per pack' },
          rate: { type: 'NUMBER', description: 'Purchase rate per pack BEFORE discount and BEFORE GST (column Rate / PTR)' },
          disc_percent: { type: 'NUMBER', description: 'Trade discount percent on this line (column Disc%, D%, CD%). If only a discount amount is printed, give amount/(qty*rate)*100. 0 if none' },
          cgst_percent: { type: 'NUMBER', description: 'CGST percent. If only total GST% is printed, give half of it' },
          sgst_percent: { type: 'NUMBER', description: 'SGST percent. If only total GST% is printed, give half of it. For IGST bills give half of IGST here and in cgst' },
          amount: { type: 'NUMBER', description: 'Line amount exactly as printed in the last amount column' },
        },
        required: ['item', 'qty', 'rate'],
      },
    },
  },
  required: ['items'],
};

const PROMPT = `You read Indian pharmacy purchase bills (GST tax invoices from medicine distributors / wholesalers).
The layout differs between distributors. Read EVERY product line of the table, top to bottom, including lines that continue on later pages.
Rules:
- Read numbers exactly as printed. Do not invent values. If a value is not printed, use 0 for numbers and "" for text.
- qty is the charged quantity; free (scheme, bonus, F.Qty, "+1" in "10+1") is separate.
- rate is the per-pack purchase price before discount and before GST (PTR / Rate). If the bill only shows a price that already includes GST, convert it back to the price before GST.
- Expiry: always give M/YY (e.g. "03/27" -> "3/27", "MAR-2027" -> "3/27").
- Ignore subtotal, tax summary, round-off and total rows: they are not items.
- The distributor is the SELLER at the top, not the buyer pharmacy.
Return JSON only.`;

/* phone photos can be 5-10 MB: shrink to ~2400 px, enough for the AI to read small print */
async function prepareImage(blob) {
  if (blob.type === 'application/pdf') return { mime: 'application/pdf', data: await b64(blob) };
  if (!/^image\//.test(blob.type) || blob.size < 1.5e6) return { mime: blob.type || 'image/jpeg', data: await b64(blob) };
  const bmp = await createImageBitmap(blob);
  const k = Math.min(1, 2400 / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas'); c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
  c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
  const out = await new Promise(r => c.toBlob(r, 'image/jpeg', 0.9));
  return { mime: 'image/jpeg', data: await b64(out) };
}
const b64 = blob => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1]); r.onerror = rej; r.readAsDataURL(blob); });

async function readBill(blobs) {
  const key = DB.getSetting('geminiKey', '');
  if (!key) throw new Error('Add your free Gemini API key in Settings first.');
  const model = DB.getSetting('geminiModel', GEMINI_DEFAULT_MODEL) || GEMINI_DEFAULT_MODEL;
  const parts = [];
  for (const b of [].concat(blobs)) { const p = await prepareImage(b); parts.push({ inline_data: { mime_type: p.mime, data: p.data } }); }
  parts.push({ text: PROMPT });
  const body = { contents: [{ role: 'user', parts }], generationConfig: { temperature: 0, responseMimeType: 'application/json', responseSchema: BILL_SCHEMA } };
  let res, tries = 0;
  for (;;) {
    res = await fetch('https://generativelanguage.googleapis.com/v1beta/models/' + encodeURIComponent(model) + ':generateContent', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key }, body: JSON.stringify(body) });
    if ((res.status === 429 || res.status === 503) && tries++ < 2) { await new Promise(r => setTimeout(r, 4000 * tries)); continue; }
    break;
  }
  if (!res.ok) {
    let msg = res.status + ''; try { msg = (await res.json()).error.message; } catch (e) {}
    if (res.status === 429) throw new Error('Gemini free limit reached for now. Wait a minute (or until tomorrow for the daily limit) and try again.');
    if (res.status === 400 && /api key/i.test(msg)) throw new Error('The Gemini API key is not valid. Check it in Settings.');
    throw new Error('Gemini error: ' + msg);
  }
  const j = await res.json();
  const t = j.candidates && j.candidates[0] && j.candidates[0].content && j.candidates[0].content.parts.map(p => p.text || '').join('');
  if (!t) throw new Error('Gemini returned no result (the image may be unreadable).');
  return normaliseBill(JSON.parse(t));
}

/* Compact form for matching names: "DOLO-650 TAB." == "DOLO 650 TAB" */
const compact = s => DB.normKey(s).replace(/[^A-Z0-9]/g, '');
function similarity(a, b) {
  const ta = new Set(DB.normKey(a).split(/[^A-Z0-9]+/).filter(Boolean)), tb = new Set(DB.normKey(b).split(/[^A-Z0-9]+/).filter(Boolean));
  if (!ta.size || !tb.size) return 0;
  let n = 0; ta.forEach(x => { if (tb.has(x)) n++; });
  return n / Math.max(ta.size, tb.size);
}
function matchDistributor(name, gstin) {
  const g = String(gstin || '').toUpperCase().replace(/\s/g, '');
  if (g) { const p = DB.D.parties.find(p => p.gstin && p.gstin.toUpperCase() === g); if (p) return { name: p.name, how: 'GSTIN' }; }
  if (!name) return null;
  const c = compact(name);
  let p = DB.D.parties.find(p => compact(p.name) === c);
  if (p) return { name: p.name, how: 'name' };
  let best = null, bs = 0;
  for (const p of DB.D.parties) { const s = similarity(name, p.name); if (s > bs) { bs = s; best = p; } }
  return bs >= 0.6 ? { name: best.name, how: 'similar name', guess: true } : null;
}
/* Use the stock name of a medicine when the bill spells it a little differently, so stock adds up */
function matchItem(name) {
  const names = DB.itemNames(), c = compact(name);
  const exact = names.find(n => compact(n) === c);
  if (exact) return { name: exact, sure: true };
  let best = null, bs = 0;
  for (const n of names) { const s = similarity(name, n); if (s > bs) { bs = s; best = n; } }
  return bs >= 0.75 ? { name: best, sure: false } : null;
}

function normaliseBill(x) {
  const lines = (x.items || []).filter(i => i && i.item && (DB.num(i.qty) > 0 || DB.num(i.free) > 0)).map(i => {
    let cg = DB.num(i.cgst_percent), sg = DB.num(i.sgst_percent);
    if (cg && !sg) sg = cg; if (sg && !cg) cg = sg;
    const l = {
      item: DB.normKey(i.item), mfg: String(i.mfg || '').toUpperCase().trim(), hsn: String(i.hsn || '').replace(/\D/g, ''),
      batch: String(i.batch || '').toUpperCase().trim(), exp: DB.expNorm(i.exp), qty: DB.num(i.qty), free: DB.num(i.free),
      mrp: DB.num(i.mrp), rate: DB.num(i.rate), disc: DB.r2(DB.num(i.disc_percent)), cgst: cg, sgst: sg, billAmount: DB.num(i.amount),
    };
    const m = matchItem(l.item);
    if (m && m.sure) l.item = m.name; else if (m) l.suggest = m.name;
    const info = DB.itemInfo().get(l.item);   // fill blanks from an older bill of the same medicine
    if (info) { if (!l.mfg) l.mfg = info.mfg || ''; if (!l.hsn) l.hsn = info.hsn || ''; if (!l.cgst && !l.sgst) { l.cgst = DB.num(info.cgst); l.sgst = DB.num(info.sgst); } }
    l.net = DB.calcNet(l);
    return l;
  });
  return {
    distributorRaw: String(x.distributor || '').trim(), distributorMatch: matchDistributor(x.distributor, x.distributor_gstin),
    gstin: String(x.distributor_gstin || '').toUpperCase().replace(/\s/g, ''), address: x.distributor_address || '', phone: x.distributor_phone || '',
    licence: x.distributor_licence || '', invoiceNo: String(x.invoice_no || '').trim(), billDate: DB.toISO(x.invoice_date) || '',
    billTotal: DB.num(x.bill_total), lines,
  };
}

/* ---------------- Google Drive folder ---------------- */
let _token = null, _tokenExp = 0;
function loadGIS() {
  if (window.google && google.accounts && google.accounts.oauth2) return Promise.resolve();
  return new Promise((res, rej) => {
    const s = document.createElement('script'); s.src = 'https://accounts.google.com/gsi/client';
    s.onload = res; s.onerror = () => rej(new Error('Could not reach Google sign-in. Check the internet connection.'));
    document.head.appendChild(s);
  });
}
async function driveToken(interactive) {
  if (_token && Date.now() < _tokenExp) return _token;
  const cid = DB.getSetting('driveClientId', '');
  if (!cid) throw new Error('Add your Google OAuth Client ID in Settings to connect Google Drive.');
  await loadGIS();
  return new Promise((res, rej) => {
    const tc = google.accounts.oauth2.initTokenClient({
      client_id: cid, scope: 'https://www.googleapis.com/auth/drive.readonly',
      callback: r => { if (r.error) return rej(new Error('Google sign-in: ' + r.error)); _token = r.access_token; _tokenExp = Date.now() + (r.expires_in - 60) * 1000; res(_token); },
      error_callback: e => rej(new Error('Google sign-in was closed (' + (e.type || 'error') + ').')),
    });
    tc.requestAccessToken({ prompt: interactive ? '' : 'none' });
  });
}
const folderId = s => { s = String(s || '').trim(); const m = s.match(/folders\/([\w-]+)/) || s.match(/[?&]id=([\w-]+)/); return m ? m[1] : s; };

async function driveList() {
  const t = await driveToken(true), f = folderId(DB.getSetting('driveFolder', ''));
  if (!f) throw new Error('Paste your Google Drive bills folder link in Settings.');
  const q = `'${f}' in parents and trashed=false and (mimeType contains 'image/' or mimeType='application/pdf')`;
  const url = 'https://www.googleapis.com/drive/v3/files?pageSize=200&orderBy=createdTime desc&fields=files(id,name,mimeType,createdTime,size,thumbnailLink)&q=' + encodeURIComponent(q);
  const r = await fetch(url, { headers: { Authorization: 'Bearer ' + t } });
  if (r.status === 404) throw new Error('Drive folder not found. Check the folder link in Settings.');
  if (!r.ok) throw new Error('Drive error ' + r.status);
  return (await r.json()).files || [];
}
async function driveFile(id) {
  const t = await driveToken(true);
  const r = await fetch('https://www.googleapis.com/drive/v3/files/' + id + '?alt=media', { headers: { Authorization: 'Bearer ' + t } });
  if (!r.ok) throw new Error('Could not download the file from Drive (' + r.status + ')');
  return r.blob();
}

window.AI = { readBill, normaliseBill, matchItem, matchDistributor, driveList, driveFile, GEMINI_DEFAULT_MODEL };
