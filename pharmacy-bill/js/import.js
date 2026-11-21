/* Import the existing PHARMACY_BILL.xlsm workbook (runs on this device, the file is never uploaded). */
'use strict';

const SYSTEM_SHEETS = ['BILL ENTRY', 'MEDICINE SEARCH', 'STOCKS', 'EXPIRY SEARCH', 'SALES INVOICE', 'SALES', 'SALEITEMS', 'GST',
  'PARTY DETAILS', 'PURCHASE DETAILS', 'INVOICEPRINT', 'NET FIX LOG', 'STOCKADJUST', 'STOCKADJUST UNDONE', 'IMPORTFORMATS'];

function loadXLSX() {
  if (window.XLSX) return Promise.resolve();
  return new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = 'vendor/xlsx.full.min.js';
    s.onload = res; s.onerror = () => rej(new Error('Could not load the Excel reader.'));
    document.head.appendChild(s);
  });
}

/* Excel serial number -> {y,m,d} */
function serial(v) { const p = XLSX.SSF.parse_date_code(v); return p ? { y: p.y, m: p.m, d: p.d } : null; }
function dateCell(v) {
  if (typeof v === 'number' && v > 20000) { const p = serial(v); return p ? p.y + '-' + String(p.m).padStart(2, '0') + '-' + String(p.d).padStart(2, '0') : ''; }
  return DB.toISO(v);
}
/* Expiry typed as 8/26 sometimes became a date in Excel: turn it back to M/YY the same way the macro did */
function expCell(v) {
  if (typeof v === 'number' && v > 20000) {
    const p = serial(v); if (!p) return '';
    const thisYear = new Date().getFullYear();
    const yy = p.d === 1 ? p.y % 100 : p.y <= thisYear ? p.d : p.y % 100;
    return p.m + '/' + String(yy).padStart(2, '0');
  }
  return DB.expNorm(v);
}
const txt = v => v == null ? '' : String(v).trim();

const ALIAS = {
  billDate: ['bill date', 'date'], invoiceNo: ['invoice no', 'bill no'], distributor: ['distributor name', 'distributor'],
  item: ['item name'], mfg: ['mfg'], hsn: ['hsn code', 'hsn'], batch: ['batch no', 'batch'], exp: ['exp date', 'expiry', 'exp'],
  qty: ['quantity', 'qty'], free: ['free quantity', 'free qty', 'free'], mrp: ['mrp'], rate: ['rate'], disc: ['discount', 'disc'],
  cgst: ['cgst'], sgst: ['sgst'], gst: ['gst'], net: ['net amount', 'amount'],
};
function headMap(row) {
  const h = row.map(x => txt(x).toLowerCase());
  const out = {};
  for (const [k, names] of Object.entries(ALIAS)) { for (const n of names) { const i = h.indexOf(n); if (i >= 0) { out[k] = i; break; } } }
  return out;
}

async function importWorkbook(file, onProgress) {
  await loadXLSX();
  const wb = XLSX.read(await file.arrayBuffer(), { type: 'array', cellDates: false });
  const purchases = [], parties = [], sales = [], saleItems = [], adjust = [], adjustUndone = [];
  const report = { sheets: 0, lines: 0 };
  const rowsOf = n => XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, raw: true, defval: null, blankrows: false });

  for (const name of wb.SheetNames) {
    if (SYSTEM_SHEETS.includes(name.toUpperCase())) continue;
    const rows = rowsOf(name);
    if (!rows.length) continue;
    const h = headMap(rows[0]);
    if (h.item == null || h.qty == null) continue;              // not a distributor sheet
    report.sheets++;
    for (let i = 1; i < rows.length; i++) {
      const r = rows[i], g = k => h[k] == null ? null : r[h[k]];
      const item = txt(g('item'));
      if (!item) continue;
      let cg = DB.num(g('cgst')), sg = DB.num(g('sgst'));
      if (!cg && !sg && DB.num(g('gst'))) { cg = sg = DB.num(g('gst')) / 2; }
      purchases.push({
        billDate: dateCell(g('billDate')), invoiceNo: txt(g('invoiceNo')), distributor: txt(g('distributor')) || name,
        item: item.toUpperCase(), mfg: txt(g('mfg')), hsn: txt(g('hsn')), batch: txt(g('batch')).toUpperCase(), exp: expCell(g('exp')),
        qty: DB.num(g('qty')), free: DB.num(g('free')), mrp: DB.num(g('mrp')), rate: DB.num(g('rate')), disc: DB.num(g('disc')),
        cgst: cg, sgst: sg, net: DB.num(g('net')), source: 'excel',
      });
    }
    onProgress && onProgress('Read ' + name);
  }
  report.lines = purchases.length;

  // Party Details: header row has "Distributor Name" in column C
  if (wb.Sheets['Party Details']) {
    const rows = rowsOf('Party Details');
    const hr = rows.findIndex(r => r && txt(r[2]).toLowerCase() === 'distributor name' && txt(r[1]).toLowerCase() === 'sr');
    if (hr >= 0) for (const r of rows.slice(hr + 1)) {
      const n = txt(r[2]); if (!n) continue;
      parties.push({ name: n.toUpperCase(), address: txt(r[3]), gstin: txt(r[4]).toUpperCase(), pan: txt(r[5]).toUpperCase(), phone: txt(r[6]), licence: txt(r[7]) });
    }
  }
  if (wb.Sheets['Sales']) for (const r of rowsOf('Sales').slice(1)) {
    if (!txt(r[1])) continue;
    sales.push({ patient: txt(r[0]), invoiceNo: txt(r[1]), date: dateCell(r[2]), total: DB.num(r[3]), address: txt(r[4]), doctor: txt(r[5]), drReg: txt(r[6]) });
  }
  if (wb.Sheets['SaleItems']) for (const r of rowsOf('SaleItems').slice(1)) {
    if (!txt(r[1])) continue;
    saleItems.push({ date: dateCell(r[0]), item: txt(r[1]).toUpperCase(), qtyPacks: DB.num(r[2]), batch: txt(r[3]).toUpperCase(), invoiceNo: txt(r[4]),
      mrp: DB.num(r[5]), disc: DB.num(r[6]), net: DB.num(r[7]), pack: DB.num(r[8]), strip: DB.num(r[9]), loose: DB.num(r[10]), exp: expCell(r[11]),
      gst: DB.num(r[12]), patient: txt(r[13]), mfg: txt(r[14]), hsn: txt(r[15]), freePcs: DB.num(r[16]) });
  }
  const adj = (n, arr, undone) => { if (wb.Sheets[n]) for (const r of rowsOf(n).slice(1)) {
    if (!txt(r[1])) continue;
    const a = { date: dateCell(r[0]), item: txt(r[1]).toUpperCase(), batch: txt(r[2]).toUpperCase(), add: DB.num(r[3]), reduce: DB.num(r[4]), reason: txt(r[5]), enteredOn: txt(r[6]) };
    if (undone) a.undoneOn = txt(r[7]);
    arr.push(a);
  } };
  adj('StockAdjust', adjust); adj('StockAdjust Undone', adjustUndone, true);

  // Shop name for the header
  let shop = '';
  if (wb.Sheets['Sales Invoice']) { const c = wb.Sheets['Sales Invoice']['A1']; shop = c ? txt(c.v) : ''; }

  // the per-distributor sheets also give distributors that are not in Party Details
  const known = new Set(parties.map(p => DB.normKey(p.name)));
  for (const l of purchases) { const k = DB.normKey(l.distributor); if (k && !known.has(k)) { known.add(k); parties.push({ name: k, address: '', gstin: '', pan: '', phone: '', licence: '' }); } }

  return { purchases, parties, sales, saleItems, adjust, adjustUndone, shop, report };
}

/* Replace all business data with the workbook's data */
async function applyImport(x) {
  await DB.clearStores(['parties', 'purchases', 'sales', 'saleItems', 'adjust', 'adjustUndone']);
  await DB.putMany('parties', x.parties);
  await DB.putMany('purchases', x.purchases);
  if (x.sales.length) await DB.putMany('sales', x.sales);
  if (x.saleItems.length) await DB.putMany('saleItems', x.saleItems);
  if (x.adjust.length) await DB.putMany('adjust', x.adjust);
  if (x.adjustUndone.length) await DB.putMany('adjustUndone', x.adjustUndone);
  if (x.shop && !DB.getSetting('shopName')) await DB.setSetting('shopName', x.shop);
}

/* Export everything back to an Excel file in the same layout (one sheet per distributor) */
async function exportWorkbook() {
  await loadXLSX();
  const wb = XLSX.utils.book_new();
  const H = ['Bill Date', 'Invoice No', 'Distributor Name', 'Item Name', 'Mfg', 'HSN Code', 'Batch No', 'Exp Date', 'Quantity', 'Free Quantity', 'MRP', 'Rate', 'Discount', 'CGST', 'SGST', 'Net Amount'];
  const st = DB.stock().rows;
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Product Name', 'Batch No', 'Purchased', 'Free', 'Total Qty', 'Sold Qty', 'Add Stock', 'Reduce Stock', 'Remaining', 'Total Value'],
    ...st.map(s => [s.name, s.batch, s.pur, s.free, s.total, s.sold, s.add, s.red, s.rem, s.value])]), 'Stocks');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Distributor Name', 'Address', 'GSTIN', 'PAN', 'Phone No', 'Licence No', 'Bills', 'Total Purchase'],
    ...DB.partyStats().map(p => [p.name, p.address, p.gstin, p.pan, p.phone, p.licence, p.bills, p.total])]), 'Party Details');
  const by = new Map();
  for (const l of DB.D.purchases) { const k = DB.normKey(l.distributor) || 'UNKNOWN'; if (!by.has(k)) by.set(k, []); by.get(k).push(l); }
  const used = new Set(['STOCKS', 'PARTY DETAILS']);
  for (const [k, ls] of [...by.entries()].sort()) {
    let n = k.replace(/[\\\/\?\*\[\]:]/g, ' ').slice(0, 31).trim(); let i = 2;
    while (used.has(n.toUpperCase())) n = k.slice(0, 28) + ' ' + i++;
    used.add(n.toUpperCase());
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([H, ...ls.map(l => [DB.showDate(l.billDate), l.invoiceNo, l.distributor, l.item, l.mfg, l.hsn, l.batch, l.exp, l.qty, l.free, l.mrp, l.rate, l.disc, l.cgst, l.sgst, l.net])]), n);
  }
  XLSX.writeFile(wb, 'PHARMACY_BILL_export_' + DB.todayISO() + '.xlsx');
}

window.Importer = { importWorkbook, applyImport, exportWorkbook, loadXLSX };
