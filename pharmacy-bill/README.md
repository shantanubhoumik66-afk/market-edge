# Pharmacy Bill

A modern web app version of the **PHARMACY_BILL.xlsm** workbook. It works on Android and desktop (install it from Chrome or Edge with "Install app" / "Add to Home screen") and reads distributor bills automatically with Google Gemini (free tier).

## Screens (same as the Excel tabs)
| App screen | Excel tab |
|---|---|
| Scan bills (Google Drive folder, upload, camera) | new: automatic bill reading |
| Bill Entry | BILL ENTRY |
| Distributor ledger | one sheet per distributor (THE CAPITAL, S.K. PHARMA, ...) |
| Purchase Details | Purchase Details |
| Party Details | Party Details |
| Stocks (with Adjust stock, Undo, Adjust log) | Stocks, StockAdjust, StockAdjust Undone |
| Medicine Search | Medicine Search |
| Expiry Search | Expiry Search |
| Dashboard | new: stock value, monthly purchases, expiring stock |

Sales Invoice, invoice printing and the GST summary come in stage 2. Sales already in the workbook are imported and counted in stock.

## Calculations (copied from the workbook macros)
- **Net Amount** = Quantity × Rate × (1 − Discount% / 100) × (1 + (CGST% + SGST%) / 100). Free quantity is not charged.
- **Remaining stock** per medicine + batch = Purchased + Free + Add − Reduce − Sold.
- **Stock value** = Remaining × cost per pack, where cost per pack = money paid ÷ all packs received (free packs make it cheaper).
- Rounding follows Excel VBA `Round` (halves to even). Checked against the real workbook: all 2,092 batches and all quantity totals match. 3 batches differ by 1 paisa, because Excel keeps extra hidden digits when a value lands exactly on half a paisa.

## How automatic bill reading works
1. The bill photo or PDF (from the Drive folder, an upload or the camera) is sent to Gemini with a fixed list of fields: distributor, GSTIN, invoice no, date, and for every line item, Mfg, HSN, batch, expiry, qty, free, MRP, rate, disc %, CGST %, SGST % and amount.
2. The answer is put into **your** Bill Entry format:
   - The distributor is matched by GSTIN, then by name.
   - Medicine names are matched to the names already in stock ("DOLO-650 TAB" → "DOLO 650 TAB").
   - Empty Mfg, HSN or GST is filled from older bills.
   - Expiry is converted to M/YY.
3. Every line is checked:
   - Your Net Amount formula is compared with the amount printed on the bill.
   - The sum is compared with the bill total.
   - Missing batch, expiry or MRP is highlighted, and so is a rate above MRP.
4. You check it next to the bill image and press **Save bill**. Nothing goes into stock before that.

## Setup
- **Gemini key (free):** Settings → follow the link to aistudio.google.com/app/apikey → paste the key → Test.
- **Google Drive folder:** Settings → step-by-step guide (create a free Google Cloud OAuth Client ID once, then paste the folder link).
- **Your data:** Settings → *Import Excel workbook* → choose PHARMACY_BILL.xlsm. The file is read on the device and never uploaded.

## Where the data is kept
In this browser on this device (IndexedDB), and it keeps working offline. Use **Settings → Download backup** regularly, and *Restore backup* to move the data to another device. Live sync between phone and PC (cloud database) is the next step.

## Files
`index.html`, `css/app.css`, `js/db.js` (data + calculations), `js/import.js` (Excel import/export), `js/ai.js` (Gemini + Google Drive), `js/app.js` (screens), `sw.js` (offline), `vendor/xlsx.full.min.js` (SheetJS, Apache-2.0).
No build step: host the folder on any static web host (for example GitHub Pages) with HTTPS.
