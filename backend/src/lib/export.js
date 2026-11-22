// Exports de rapports : Excel mis en forme et PDF lisible (colonnes proportionnées, totaux, pagination).
import ExcelJS from 'exceljs'
import { makePdf, header, table, num, fdt } from './dossier-pdf.js'
const TOT = /HTG|Net|Payé|Reste|Total|Base|Commission|Prime|Déduction|Avance|Nombre|Consultations|Interventions|Valeur|Marge|Revenus|Réalisées|Prothèses|Quantité|Montant/i, NOTOT = /taux|unit\.|minimum|disponible/i
const isDate = v => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v), isNum = (c, v) => c[2] === 'n' && v !== '' && v != null && !isNaN(v)
const totalsOf = (cols, rows) => cols.map(c => c[2] === 'n' && TOT.test(c[1]) && !NOTOT.test(c[1]) && !/^(currency|rate)$/.test(c[0]) ? rows.reduce((s, r) => s + (isNum(c, r[c[0]]) ? Number(r[c[0]]) : 0), 0) : null)
export async function xlsx({ clinic, title, period, cols, rows, by, safe }) {
  const wb = new ExcelJS.Workbook(); wb.creator = clinic.name || 'DENTAL'; const ws = wb.addWorksheet(title.replace(/[\\/?*[\]:]/g, ' ').slice(0, 31), { views: [{ state: 'frozen', ySplit: 5 }], pageSetup: { orientation: cols.length > 6 ? 'landscape' : 'portrait', fitToPage: true, fitToWidth: 1, fitToHeight: 0 } })
  const n = cols.length; const put = (r, v, f) => { const c = ws.getCell(r, 1); c.value = v; Object.assign(c, f); ws.mergeCells(r, 1, r, n) }
  put(1, (clinic.name || 'DENTAL').toUpperCase(), { font: { bold: true, size: 16, color: { argb: 'FF1D6FD8' } } })
  put(2, title, { font: { bold: true, size: 13 } }); put(3, [period, `${rows.length} ligne(s)`, `Généré le ${fdt(new Date())} par ${by}`].filter(Boolean).join('   ·   '), { font: { size: 9, color: { argb: 'FF5B6778' } } })
  const hr = ws.getRow(5); cols.forEach((c, i) => { const x = hr.getCell(i + 1); x.value = c[1]; x.font = { bold: true, color: { argb: 'FFFFFFFF' } }; x.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1D6FD8' } }; x.alignment = { vertical: 'middle', horizontal: c[2] === 'n' ? 'right' : 'left', wrapText: true }; x.border = { bottom: { style: 'thin', color: { argb: 'FF1558B0' } } } }); hr.height = 24
  rows.forEach((r, ri) => { const row = ws.getRow(6 + ri); cols.forEach((c, i) => { const v = r[c[0]], x = row.getCell(i + 1)
    if (isNum(c, v)) { x.value = Number(v); x.numFmt = /^(qty|n|stock|min_stock|consultations|interventions|prostheses)$/.test(c[0]) ? '#,##0.##' : '#,##0.00'; x.alignment = { horizontal: 'right' } }
    else if (isDate(v)) { x.value = new Date(v + 'T12:00:00Z'); x.numFmt = 'dd/mm/yyyy'; x.alignment = { horizontal: 'left' } } else x.value = safe(v)
    x.border = { bottom: { style: 'hair', color: { argb: 'FFD5DCE7' } } }; if (ri % 2) x.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF6F9FE' } } }) })
  const t = totalsOf(cols, rows); if (rows.length && t.some(v => v != null)) { const row = ws.getRow(6 + rows.length); cols.forEach((c, i) => { const x = row.getCell(i + 1); x.font = { bold: true }; x.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE3ECFA' } }; x.border = { top: { style: 'thin' } }
    if (i === 0) x.value = 'TOTAL'; if (t[i] != null) { x.value = t[i]; x.numFmt = '#,##0.00'; x.alignment = { horizontal: 'right' } } }) }
  cols.forEach((c, i) => { const len = Math.max(c[1].length, ...rows.slice(0, 300).map(r => String(r[c[0]] ?? '').length)); ws.getColumn(i + 1).width = Math.min(46, Math.max(12, len + 3)) })
  if (rows.length) ws.autoFilter = { from: { row: 5, column: 1 }, to: { row: 5 + rows.length, column: n } }
  return Buffer.from(await wb.xlsx.writeBuffer()) }
export function pdf(res, name, { clinic, title, period, cols, rows, by }) {
  const land = cols.length > 5, t = totalsOf(cols, rows)
  const wts = cols.map(c => { const len = Math.max(c[1].length * .8, rows.slice(0, 200).reduce((s, r) => s + String(r[c[0]] ?? '').length, 0) / Math.max(1, Math.min(200, rows.length))); return Math.min(34, Math.max(7, len)) })
  const fmt = (c, v) => isNum(c, v) ? (/^(qty|n|stock|min_stock|consultations|interventions|prostheses)$/.test(c[0]) ? Number(v).toLocaleString('fr-FR') : num(v)) : isDate(v) ? v.split('-').reverse().join('/') : String(v ?? '')
  makePdf(res, name, doc => { header(doc, clinic, title, [period, `${rows.length} ligne(s)`].filter(Boolean).join('   ·   '))
    table(doc, cols.map((c, i) => ({ h: c[1], w: wts[i], a: c[2] === 'n' ? 'right' : 'left' })), rows.slice(0, 3000).map(r => cols.map(c => fmt(c, r[c[0]]))), { totals: rows.length && t.some(v => v != null) ? cols.map((c, i) => i === 0 && t[i] == null ? 'TOTAL' : t[i] != null ? num(t[i]) : '') : null }) },
    { footer: `${clinic.name || 'DENTAL'}   ·   édité par ${by}   ·   ${fdt(new Date())}`, landscape: land }) }
