// Documents PDF cliniques : fiche patient complète, fiche de consultation, exports de rapports.
import PDFDocument from 'pdfkit'
const BLUE = '#1d6fd8', INK = '#0f1b33', GREY = '#5b6778'
const TZ = 'America/Port-au-Prince'
// Les polices standard du PDF n'ont pas les espaces insécables fines de fr-FR : on les remplace.
const sp = s => String(s ?? '').replace(/[  ]/g, ' ')
export const fd = d => d ? new Date(d).toLocaleDateString('fr-FR', { timeZone: TZ }) : '—'
export const fdt = d => d ? sp(new Date(d).toLocaleString('fr-FR', { timeZone: TZ, dateStyle: 'short', timeStyle: 'short' })) : '—'
const fday = d => !d ? '—' : typeof d === 'string' ? d.slice(0, 10).split('-').reverse().join('/') : new Date(d).toLocaleDateString('fr-FR')
export const age = d => d ? Math.floor((Date.now() - new Date(d)) / 31557600000) : null
export const num = (n, c) => sp(Number(n || 0).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })) + (c ? ' ' + c : '')
const W = doc => doc.page.width - 80, BOT = doc => doc.page.height - 52

export function makePdf(res, name, build, { footer = '', landscape = false } = {}) {
  const doc = new PDFDocument({ size: 'A4', layout: landscape ? 'landscape' : 'portrait', margin: 40, bufferPages: true, info: { Title: name } })
  res.setHeader('Content-Type', 'application/pdf'); res.setHeader('Content-Disposition', `inline; filename="${name}.pdf"`)
  doc.pipe(res); build(doc)
  const r = doc.bufferedPageRange()
  for (let i = 0; i < r.count; i++) { doc.switchToPage(i); const b = doc.page.margins.bottom; doc.page.margins.bottom = 0; const y = doc.page.height - 32
    doc.moveTo(40, y - 8).lineTo(40 + W(doc), y - 8).lineWidth(.5).strokeColor('#e3e8ef').stroke()
    doc.font('Helvetica').fontSize(7.5).fillColor('#8a94a6').text(sp(footer), 40, y, { width: W(doc) - 80, lineBreak: false }).text(`Page ${i + 1} / ${r.count}`, 40 + W(doc) - 80, y, { width: 80, align: 'right', lineBreak: false }); doc.page.margins.bottom = b }
  doc.end()
}
// ── Aides génériques (utilisées aussi par les exports de rapports) ──
export function header(doc, cl, title, sub) {
  doc.rect(0, 0, doc.page.width, 6).fill(BLUE)
  doc.fillColor(INK).font('Helvetica-Bold').fontSize(19).text((cl.name || 'DENTAL').toUpperCase(), 40, 24, { width: W(doc) })
  doc.font('Helvetica').fontSize(8.5).fillColor(GREY).text([cl.address, cl.phone && 'Tél : ' + cl.phone].filter(Boolean).join('   ·   '), 40, doc.y + 1, { width: W(doc) })
  const y = doc.y + 6; doc.moveTo(40, y).lineTo(40 + W(doc), y).lineWidth(1.4).strokeColor(BLUE).stroke()
  doc.fillColor(INK).font('Helvetica-Bold').fontSize(14).text(title, 40, y + 10, { width: W(doc) })
  if (sub) doc.font('Helvetica').fontSize(9).fillColor(GREY).text(sub, 40, doc.y + 1, { width: W(doc) })
  doc.y += 8; doc.x = 40
}
export const section = (doc, t) => { if (doc.y > BOT(doc) - 60) doc.addPage(); const y = doc.y + 6
  doc.rect(40, y, 3, 12).fill(BLUE); doc.fillColor(INK).font('Helvetica-Bold').fontSize(10).text(t.toUpperCase(), 48, y + 1, { width: W(doc) - 8 }); doc.y = y + 20; doc.x = 40 }
export const kv = (doc, pairs, cols = 2) => { const w = W(doc) / cols; let y = doc.y
  pairs.forEach(([k, v], i) => { const c = i % cols; if (!c && i) y += 30; if (y + 30 > BOT(doc)) { doc.addPage(); y = 40 }
    doc.font('Helvetica').fontSize(7).fillColor(GREY).text(String(k).toUpperCase(), 40 + c * w, y, { width: w - 10, lineBreak: false })
    doc.font('Helvetica-Bold').fontSize(9.5).fillColor(INK).text(sp(v ?? '') || '—', 40 + c * w, y + 10, { width: w - 10, height: 14, ellipsis: true }) })
  doc.y = y + 32; doc.x = 40 }
export const box = (doc, label, text, minH = 36) => { const t = sp(text || '—'); doc.font('Helvetica').fontSize(9.5)
  const h = Math.max(minH, doc.heightOfString(t, { width: W(doc) - 16 }) + 14); if (doc.y + h + 14 > BOT(doc)) doc.addPage()
  doc.font('Helvetica-Bold').fontSize(7.5).fillColor(GREY).text(label.toUpperCase(), 40, doc.y, { width: W(doc) }); const y = doc.y + 2
  doc.roundedRect(40, y, W(doc), h, 5).lineWidth(.7).strokeColor('#d5dce7').stroke(); doc.font('Helvetica').fontSize(9.5).fillColor(INK).text(t, 48, y + 7, { width: W(doc) - 16 }); doc.y = y + h + 8; doc.x = 40 }
// cols : [{ h: 'Titre', w: poids relatif, a: 'right' }]
export function table(doc, cols, rows, { totals } = {}) {
  const tw = W(doc), sum = cols.reduce((s, c) => s + c.w, 0), cw = cols.map(c => c.w / sum * tw); let y = doc.y
  const draw = (cells, mode) => { cells = cells.map(sp); doc.font(mode === 'head' || mode === 'tot' ? 'Helvetica-Bold' : 'Helvetica').fontSize(mode === 'head' ? 7.5 : 8.5)
    const h = Math.max(mode === 'head' ? 20 : 15, ...cells.map((t, i) => doc.heightOfString(String(t ?? ''), { width: cw[i] - 12 }))) + (mode === 'head' ? 0 : 9)
    if (y + h > BOT(doc)) { doc.addPage(); y = 40; if (mode !== 'head') draw(cols.map(c => c.h), 'head'); doc.font(mode === 'tot' ? 'Helvetica-Bold' : 'Helvetica').fontSize(8.5) }
    if (mode === 'head') doc.roundedRect(40, y, tw, h, 4).fill(INK); else if (mode === 'tot') doc.rect(40, y, tw, h).fill('#e8f1fd'); else if (mode === 'z') doc.rect(40, y, tw, h).fill('#f5f7fb')
    doc.fillColor(mode === 'head' ? '#fff' : INK); let x = 40
    cells.forEach((t, i) => { doc.text(mode === 'head' ? String(t).toUpperCase() : String(t ?? ''), x + 6, y + (mode === 'head' ? 6.5 : 4.5), { width: cw[i] - 12, align: cols[i].a || 'left', characterSpacing: mode === 'head' ? .3 : 0 }); x += cw[i] })
    y += h; if (mode !== 'head') doc.moveTo(40, y).lineTo(40 + tw, y).lineWidth(.4).strokeColor('#e3e8ef').stroke() }
  draw(cols.map(c => c.h), 'head')
  if (!rows.length) { doc.font('Helvetica-Oblique').fontSize(9).fillColor(GREY).text('Aucune donnée.', 46, y + 7); y += 24 }
  rows.forEach((r, i) => draw(r, i % 2 ? 'z' : ''))
  if (totals) draw(totals, 'tot')
  doc.y = y + 10; doc.x = 40 }

// ── Mise en page moderne de la fiche patient ──
const C = { brand: BLUE, ink: INK, grey: GREY, line: '#e3e8ef', soft: '#f3f6fb', red: '#d93a3a', redBg: '#fdecec', warn: '#c27a0e', warnBg: '#fff4e0', ok: '#12804a' }
const STATE = { saine: ['Saine', '#e3f6ec', '#12804a'], carie: ['Cariée', '#fbd5d5', '#c62828'], a_extraire: ['À extraire', '#ffe1bd', '#c46a00'], extraite: ['Extraite', '#ffffff', '#8a94a6'], absente: ['Non présente', '#f7e3e5', '#b07a82'], restauree: ['Restaurée', '#d6e7fd', '#1558b0'],
  couronne: ['Couronne', '#fbeec0', '#a87b12'], implant: ['Implant', '#e1e6ee', '#4a5568'], bridge: ['Bridge', '#e9e1fd', '#5a3fd1'], anomalie: ['Anomalie', '#ffd8e8', '#b4235f'] }
const ensure = (doc, h) => { if (doc.y + h > BOT(doc)) { doc.addPage(); doc.y = 44 } }
function topHeader(doc, cl, title, meta) {
  const w = W(doc); doc.rect(0, 0, doc.page.width, 6).fill(C.brand)
  doc.roundedRect(40, 26, 38, 38, 10).fill(C.brand); doc.font('Helvetica-Bold').fontSize(18).fillColor('#fff').text(sp(cl.name || 'D').trim()[0].toUpperCase(), 40, 36, { width: 38, align: 'center' })
  doc.font('Helvetica-Bold').fontSize(14.5).fillColor(C.ink).text(sp(cl.name || 'DENTAL'), 88, 27, { width: 240 })
  const info = [cl.address, cl.phone && 'Tél. ' + cl.phone].filter(Boolean).map(sp).join('\n'); if (info) doc.font('Helvetica').fontSize(8).fillColor(C.grey).text(info, 88, doc.y + 1, { width: 240 })
  const leftEnd = doc.y
  doc.font('Helvetica-Bold').fontSize(18).fillColor(C.brand).text(title, 330, 25, { width: 40 + w - 330, align: 'right' })
  let y = 50; for (const [k, v] of meta) { doc.font('Helvetica').fontSize(8).fillColor(C.grey).text(k, 330, y, { width: 95, align: 'right' }); doc.font('Helvetica-Bold').fontSize(8.5).fillColor(C.ink).text(sp(v), 430, y - .5, { width: 40 + w - 430, align: 'right' }); y += 12 }
  y = Math.max(y, leftEnd) + 10; doc.moveTo(40, y).lineTo(40 + w, y).lineWidth(.8).strokeColor(C.line).stroke(); doc.x = 40; doc.y = y + 14
}
function heading(doc, t, sub) { ensure(doc, 120); const y = doc.y + 4
  doc.roundedRect(40, y, 4, 15, 2).fill(C.brand); doc.font('Helvetica-Bold').fontSize(10.5).fillColor(C.ink).text(t, 52, y + 2, { continued: !!sub }); if (sub) doc.font('Helvetica').fontSize(8.5).fillColor(C.grey).text('   ' + sub)
  doc.x = 40; doc.y = y + 24 }
// Grille libellé / valeur dans un encadré doux
function grid(doc, pairs, cols = 3) {
  const w = W(doc), cw = (w - 24) / cols, rows = Math.ceil(pairs.length / cols), rh = 30; ensure(doc, Math.min(rows, 4) * rh + 20)
  let y = doc.y, top = y; const startPage = doc.bufferedPageRange().count
  const bg = (from, to) => doc.roundedRect(40, from, w, to - from, 8).fill(C.soft)
  // fond dessiné ligne par ligne pour supporter les sauts de page
  for (let r = 0; r < rows; r++) {
    if (y + rh + 12 > BOT(doc)) { doc.addPage(); y = 44 }
    doc.rect(40, y, w, rh + (r === 0 ? 8 : 0) + (r === rows - 1 ? 8 : 0)).fill(C.soft)
    const yy = y + (r === 0 ? 8 : 0)
    for (let c = 0; c < cols; c++) { const p = pairs[r * cols + c]; if (!p) continue; const x = 52 + c * cw
      doc.font('Helvetica').fontSize(7).fillColor(C.grey).text(sp(p[0]).toUpperCase(), x, yy + 3, { width: cw - 12, lineBreak: false, characterSpacing: .3 })
      doc.font('Helvetica-Bold').fontSize(9.5).fillColor(p[2] || C.ink).text(sp(p[1] ?? '') || '—', x, yy + 13, { width: cw - 12, lineBreak: false, ellipsis: true }) }
    y += rh + (r === 0 ? 8 : 0) + (r === rows - 1 ? 8 : 0)
  }
  void top; void startPage; doc.x = 40; doc.y = y + 12 }
function textBox(doc, label, text) { const t = sp(text || '—'); doc.font('Helvetica').fontSize(9.5); const h = doc.heightOfString(t, { width: W(doc) - 24 }) + 30; ensure(doc, h + 8)
  const y = doc.y; doc.roundedRect(40, y, W(doc), h, 8).lineWidth(.7).strokeColor(C.line).stroke()
  doc.font('Helvetica-Bold').fontSize(7).fillColor(C.grey).text(label.toUpperCase(), 52, y + 9, { characterSpacing: .4 }); doc.font('Helvetica').fontSize(9.5).fillColor(C.ink).text(t, 52, y + 20, { width: W(doc) - 24 })
  doc.x = 40; doc.y = y + h + 10 }
function chips(doc, items, fg, bg) { let x = 40, y = doc.y; doc.font('Helvetica-Bold').fontSize(8.5)
  for (const t of items) { const w = doc.widthOfString(sp(t)) + 18; if (x + w > 40 + W(doc)) { x = 40; y += 22 } if (y + 20 > BOT(doc)) { doc.addPage(); y = 44; x = 40 }
    doc.roundedRect(x, y, w, 17, 8.5).fill(bg); doc.fillColor(fg).text(sp(t), x, y + 4.5, { width: w, align: 'center', lineBreak: false }); x += w + 6 }
  doc.x = 40; doc.y = y + 26 }
function alertsBox(doc, alerts) {
  if (!alerts.length) return
  const w = W(doc); doc.font('Helvetica').fontSize(8.5)
  const lines = alerts.map(a => ({ a, h: doc.heightOfString(sp(a.text), { width: w - 48 }) + 15 })), h = lines.reduce((s, l) => s + l.h, 0) + 30; ensure(doc, Math.min(h, 300))
  let y = doc.y; const danger = alerts.some(a => a.level === 'danger')
  doc.roundedRect(40, y, w, h, 10).fill(danger ? C.redBg : C.warnBg)
  doc.font('Helvetica-Bold').fontSize(8).fillColor(danger ? C.red : C.warn).text('POINTS D\'ATTENTION MÉDICAUX', 54, y + 11, { characterSpacing: .6 }); y += 27
  for (const { a, h: lh } of lines) { if (y + lh > BOT(doc)) { doc.addPage(); y = 44 }
    const col = a.level === 'danger' ? C.red : a.level === 'warn' ? C.warn : C.brand
    doc.circle(58, y + 5, 3).fill(col); doc.font('Helvetica-Bold').fontSize(9).fillColor(C.ink).text(sp(a.title), 68, y, { width: w - 48 })
    doc.font('Helvetica').fontSize(8.5).fillColor(C.grey).text(sp(a.text), 68, doc.y + 1, { width: w - 48 }); y += lh }
  doc.x = 40; doc.y = y + 14 }
// Odontogramme : couronnes dessinées avec dégradé, couleur selon l'état
function toothShape(doc, n, x, y, w, h, s, upper) {
  const pos = n % 10, molar = pos >= 6 || (n > 50 && pos >= 4), r = molar ? 5 : pos === 3 ? 7 : 4
  const [, bg, fg] = STATE[s] || ['', '#ffffff', '#8a94a6']
  // racine
  if (s !== 'extraite' && s !== 'absente') { doc.save(); const rx = x + w / 2, rl = h * .55; const ry = upper ? y - rl + 4 : y + h - 4
    doc.roundedRect(rx - w * .22, ry, w * .44, rl, w * .2).fill('#efe6d2'); if (molar) doc.roundedRect(rx - w * .38, ry + (upper ? 4 : 0), w * .2, rl - 4, w * .1).fill('#efe6d2').roundedRect(rx + w * .18, ry + (upper ? 4 : 0), w * .2, rl - 4, w * .1).fill('#efe6d2'); doc.restore() }
  if (s === 'implant') { const rx = x + w / 2, ry = upper ? y - h * .55 + 4 : y + h - 4; doc.rect(rx - 3, ry, 6, h * .55).fill('#8a94a6'); for (let k = 0; k < 4; k++) doc.moveTo(rx - 5, ry + 3 + k * 4).lineTo(rx + 5, ry + 5 + k * 4).lineWidth(.8).strokeColor('#5b6778').stroke() }
  // couronne
  const g = doc.linearGradient(x, y, x, y + h); g.stop(0, '#ffffff').stop(1, s && s !== 'extraite' && s !== 'absente' ? bg : '#f1ece0')
  if (s === 'extraite' || s === 'absente') { doc.save().fillOpacity(s === 'absente' ? .22 : .4).ellipse(x + w / 2, y + h / 2, w * .36, h * .28).fill('#d97f89').restore() }   // dent absente : simple creux de gencive
  else { doc.roundedRect(x, y, w, h, r).fill(g); doc.roundedRect(x, y, w, h, r).lineWidth(.9).strokeColor(s ? fg : '#c9bfa6').stroke() }
  const cx = x + w / 2, cy = y + h / 2
  if (s === 'carie') doc.circle(cx, cy, Math.min(w, h) * .2).fill('#7a2e1a')
  else if (s === 'restauree') doc.roundedRect(cx - w * .22, cy - h * .18, w * .44, h * .36, 3).fill('#2f6fcf')
  else if (s === 'a_extraire') doc.moveTo(x + 4, y + 4).lineTo(x + w - 4, y + h - 4).moveTo(x + w - 4, y + 4).lineTo(x + 4, y + h - 4).lineWidth(1.6).strokeColor('#c46a00').stroke()
  else if (s === 'anomalie') doc.font('Helvetica-Bold').fontSize(10).fillColor(fg).text('!', x, cy - 5, { width: w, align: 'center', lineBreak: false })
  else if (s === 'bridge') doc.moveTo(x - 2, cy).lineTo(x + w + 2, cy).lineWidth(2.2).strokeColor(fg).stroke()
  else if (molar && s !== 'extraite' && s !== 'absente') doc.moveTo(cx - w * .22, cy).lineTo(cx + w * .22, cy).moveTo(cx, cy - h * .2).lineTo(cx, cy + h * .2).lineWidth(.6).strokeColor('#c9bfa6').stroke()
  doc.font('Helvetica-Bold').fontSize(7).fillColor(s && s !== 'saine' ? fg : C.grey).text(String(n), x - 2, upper ? y + h + 3 : y - 10, { width: w + 4, align: 'center', lineBreak: false })
}
function odontogram(doc, teeth) {
  const st = teeth, prim = [55, 54, 53, 52, 51, 61, 62, 63, 64, 65, 85, 84, 83, 82, 81, 71, 72, 73, 74, 75].some(n => st.has(n))
  const w = W(doc), tw = (w - 30) / 16, th = 24; ensure(doc, prim ? 260 : 170)
  let y = doc.y; doc.roundedRect(40, y, w, prim ? 238 : 150, 10).lineWidth(.7).strokeColor(C.line).stroke()
  const row = (list, yy, upper, x0, ww) => list.forEach((n, i) => toothShape(doc, n, x0 + i * ww + 2, yy, ww - 4, th, st.get(n), upper))
  doc.font('Helvetica-Bold').fontSize(7).fillColor(C.grey).text('MAXILLAIRE (HAUT)', 52, y + 9).text('DROITE DU PATIENT', 52, y + 9, { width: w - 24, align: 'right' })
  row([18, 17, 16, 15, 14, 13, 12, 11, 21, 22, 23, 24, 25, 26, 27, 28], y + 36, true, 55, tw)
  doc.moveTo(40 + w / 2, y + 22).lineTo(40 + w / 2, y + 134).dash(2, { space: 3 }).lineWidth(.6).strokeColor('#c9d2df').stroke().undash()
  doc.moveTo(56, y + 79).lineTo(40 + w - 16, y + 79).dash(2, { space: 3 }).lineWidth(.6).strokeColor('#c9d2df').stroke().undash()
  row([48, 47, 46, 45, 44, 43, 42, 41, 31, 32, 33, 34, 35, 36, 37, 38], y + 98, false, 55, tw)
  doc.font('Helvetica-Bold').fontSize(7).fillColor(C.grey).text('MANDIBULE (BAS)', 52, y + 137)
  if (prim) { const pw = tw * .82, x0 = 40 + (w - 10 * pw) / 2; doc.font('Helvetica-Bold').fontSize(7).fillColor(C.grey).text('DENTS TEMPORAIRES', 40, y + 152, { width: w, align: 'center' })
    row([55, 54, 53, 52, 51, 61, 62, 63, 64, 65], y + 174, true, x0, pw); row([85, 84, 83, 82, 81, 71, 72, 73, 74, 75], y + 210, false, x0, pw) }
  doc.y = y + (prim ? 238 : 150) + 10; doc.x = 40
  // légende avec totaux
  const counts = {}; for (const v of st.values()) counts[v] = (counts[v] || 0) + 1
  let x = 40; y = doc.y; doc.font('Helvetica').fontSize(8)
  for (const [k, [l, bg, fg]] of Object.entries(STATE)) { const t = `${l}${counts[k] ? ' (' + counts[k] + ')' : ''}`, tw2 = doc.widthOfString(t) + 26; if (x + tw2 > 40 + w) { x = 40; y += 16 }
    doc.roundedRect(x, y, 11, 11, 3).fill(bg).roundedRect(x, y, 11, 11, 3).lineWidth(.7).strokeColor(fg).stroke(); doc.fillColor(counts[k] ? C.ink : C.grey).text(t, x + 15, y + 1.5, { lineBreak: false }); x += tw2 }
  doc.x = 40; doc.y = y + 22 }
function signatures(doc, left = 'Signature et cachet du praticien', right = 'Signature du patient') { ensure(doc, 52); const y = doc.y + 26, w = W(doc)
  doc.moveTo(40, y).lineTo(220, y).moveTo(40 + w - 180, y).lineTo(40 + w, y).lineWidth(.7).strokeColor('#b8c2d1').stroke()
  doc.font('Helvetica').fontSize(8).fillColor(C.grey).text(left, 40, y + 5, { width: 180, align: 'center' }).text(right, 40 + w - 180, y + 5, { width: 180, align: 'center' }); doc.y = y + 24 }

const yn = v => v === true ? 'Oui' : v === false ? 'Non' : (v || '—')
const COND = [['diabetes', 'Diabète'], ['hemophilia', 'Hémophilie'], ['hiv', 'VIH / Sida'], ['smoking', 'Fumeur'], ['alcohol', "Consommation d'alcool"], ['pregnancy', 'Grossesse'], ['migraines', 'Migraines'], ['cardiovascular', 'Maladie cardiovasculaire'], ['pulmonary', 'Maladie pulmonaire'], ['epilepsy', 'Épilepsie'], ['stomach', "Problème d'estomac"], ['cancer', 'Cancer']]
export function patientPdf(doc, d) { const { clinic: cl, p, doctor, h = {}, exam, teeth, consults, appts, finance, advice = { alerts: [], todo: [] } } = d
  const a = age(p.birth_date), sex = p.sex === 'M' ? 'Masculin' : p.sex === 'F' ? 'Féminin' : null
  topHeader(doc, cl, 'FICHE PATIENT', [['Dossier', p.file_number], ['Édité le', fd(new Date())], ['Statut', p.status === 'active' ? 'Actif' : 'Inactif']])
  // Carte d'identité du patient
  const w = W(doc); let y = doc.y; doc.roundedRect(40, y, w, 70, 12).fill(C.ink)
  doc.circle(76, y + 35, 22).fill('#2a4a86'); doc.font('Helvetica-Bold').fontSize(15).fillColor('#fff').text(sp((p.last_name[0] || '') + (p.first_name[0] || '')).toUpperCase(), 54, y + 28, { width: 44, align: 'center' })
  doc.font('Helvetica-Bold').fontSize(16).fillColor('#fff').text(sp(`${p.last_name} ${p.first_name}`), 110, y + 14, { width: w - 250, lineBreak: false, ellipsis: true })
  doc.font('Helvetica').fontSize(9).fillColor('#c3cee4').text([a != null && a + ' ans', sex, p.birth_date && 'né(e) le ' + fday(p.birth_date)].filter(Boolean).join('  ·  ') || '—', 110, y + 36, { width: w - 250 })
  doc.text([p.phone && 'Tél. ' + sp(p.phone), p.address && sp(p.address)].filter(Boolean).join('  ·  ') || '', 110, y + 50, { width: w - 250, lineBreak: false, ellipsis: true })
  doc.font('Helvetica').fontSize(7.5).fillColor('#8fa3c7').text('MÉDECIN TRAITANT', 40 + w - 150, y + 16, { width: 136, align: 'right' }); doc.font('Helvetica-Bold').fontSize(10).fillColor('#fff').text(sp(doctor || 'Non défini'), 40 + w - 150, y + 27, { width: 136, align: 'right', lineBreak: false, ellipsis: true })
  doc.font('Helvetica').fontSize(7.5).fillColor('#8fa3c7').text('INSCRIT LE', 40 + w - 150, y + 43, { width: 136, align: 'right' }); doc.font('Helvetica-Bold').fontSize(9).fillColor('#fff').text(fday(p.registered_at), 40 + w - 150, y + 53, { width: 136, align: 'right' })
  doc.y = y + 84; doc.x = 40
  alertsBox(doc, advice.alerts)

  heading(doc, 'Renseignements personnels')
  grid(doc, [['Téléphone', p.phone], ['Téléphone 2', p.phone2], ['Profession', p.profession], ['Adresse', p.address], ['Zone', p.zone], ['Département', p.department],
    ['Statut matrimonial', p.marital_status], ["Nombre d'enfants", p.children_count], ['Groupe sanguin', h.blood_group], ["Contact d'urgence", p.emergency_contact], ['Tél. du contact', p.emergency_phone], ['Tension artérielle', h.blood_pressure]])

  heading(doc, 'Histoire médicale')
  const pos = COND.filter(([k]) => h[k]).map(([, l]) => l)
  if (pos.length) chips(doc, pos, '#a52828', C.redBg); else { doc.font('Helvetica').fontSize(9).fillColor(C.ok).text('Aucun antécédent médical signalé.', 40, doc.y); doc.y += 8 }
  grid(doc, [['Allergies', h.allergies, h.allergies && !/^aucune?$/i.test(h.allergies) ? C.red : null], ['Médicaments en cours', h.medications], ['Brossage', h.brushing], ['Autres antécédents', h.other], ['Détartrage (grade)', h.scaling_grade], ['Bridge', [h.bridge_from, h.bridge_to].filter(Boolean).join(' à ')]], 3)
  if (h.motif || consults[0]?.reason) textBox(doc, 'Motif de consultation', h.motif || consults[0]?.reason)

  heading(doc, 'Examen stomatologique', exam ? 'du ' + fd(exam.examined_at) : 'non réalisé')
  grid(doc, [['Tête', exam?.head], ['Visage', exam?.face], ['ATM', exam?.atm], ['Langue', exam?.tongue], ['Parodonte', exam?.periodontium], ['Morphologie dentaire', exam?.tooth_morphology]], 3)
  if (exam?.observations || h.remark) textBox(doc, 'Observations', [exam?.observations, h.remark].filter(Boolean).join(' — '))

  heading(doc, 'Schéma dentaire', 'numérotation FDI')
  odontogram(doc, teeth)

  if (advice.todo.length) { heading(doc, 'Recommandations et suivi')
    advice.todo.forEach((t, i) => { doc.font('Helvetica').fontSize(9); const hh = doc.heightOfString(sp(t.text), { width: W(doc) - 30 }) + 8; ensure(doc, hh)
      const yy = doc.y; doc.circle(49, yy + 6, 7).fill(C.brand); doc.font('Helvetica-Bold').fontSize(7.5).fillColor('#fff').text(String(i + 1), 42, yy + 3, { width: 14, align: 'center' })
      doc.font('Helvetica').fontSize(9).fillColor(C.ink).text(sp(t.text), 64, yy + 1.5, { width: W(doc) - 30 }); doc.y = yy + hh })
    doc.y += 6 }

  heading(doc, 'Interventions effectuées', consults.length ? `${consults.length} au total` : '')
  table(doc, [{ h: 'Date', w: 10 }, { h: 'Médecin', w: 15 }, { h: 'Motif', w: 18 }, { h: 'Diagnostic / traitement', w: 28 }, { h: 'Dents', w: 9 }, { h: 'Coût (HTG)', w: 12, a: 'right' }],
    consults.slice(0, 40).map(c => [fd(c.consulted_at), c.doctor, c.reason, [c.diagnosis, c.treatment].filter(Boolean).join(' — '), (c.teeth || []).join(', '), c.cost ? num(c.cost) : '']))
  const next = appts.filter(x => new Date(x.starts_at) >= new Date() && ['planned', 'confirmed'].includes(x.status)).reverse()
  if (next.length) { heading(doc, 'Rendez-vous à venir'); table(doc, [{ h: 'Date et heure', w: 16 }, { h: 'Médecin', w: 18 }, { h: 'Motif', w: 28 }, { h: 'Statut', w: 10 }], next.map(x => [fdt(x.starts_at), x.doctor, x.reason, x.status === 'confirmed' ? 'Confirmé' : 'Planifié'])) }
  if (finance) { heading(doc, 'Situation financière')
    table(doc, [{ h: 'Date', w: 10 }, { h: 'Facture', w: 14 }, { h: 'Total', w: 14, a: 'right' }, { h: 'Versé', w: 14, a: 'right' }, { h: 'Balance', w: 14, a: 'right' }], finance.invoices.map(i => [fd(i.created_at), i.number, num(i.total, i.currency), num(i.paid, i.currency), num(i.balance, i.currency)]),
      { totals: finance.totals.length ? ['', 'TOTAL', finance.totals.map(t => num(t.total, t.currency)).join('\n'), finance.totals.map(t => num(t.paid, t.currency)).join('\n'), finance.totals.map(t => num(t.balance, t.currency)).join('\n')] : null }) }
  signatures(doc)
}
export function consultationPdf(doc, d) { const { clinic: cl, p, c } = d, a = age(p.birth_date)
  topHeader(doc, cl, 'CONSULTATION', [['Dossier', p.file_number], ['Date', fdt(c.consulted_at)], ['Médecin', c.doctor]])
  heading(doc, 'Patient')
  grid(doc, [['Nom et prénom', `${p.last_name} ${p.first_name}`], ['Âge', a != null ? a + ' ans' : '—'], ['Sexe', p.sex === 'M' ? 'Masculin' : p.sex === 'F' ? 'Féminin' : '—'], ['Téléphone', p.phone], ['Médecin traitant', c.primary_doctor], ['Allergies', d.allergies || '—', d.allergies && !/^aucune?$/i.test(d.allergies) ? C.red : null]])
  heading(doc, 'Intervention')
  grid(doc, [['Date et heure', fdt(c.consulted_at)], ['Médecin intervenant', c.doctor], ['Dents concernées', (c.teeth || []).join(', ')], ['Coût', c.cost ? num(c.cost, 'HTG') : '—']], 4)
  textBox(doc, 'Motif de la consultation', c.reason); textBox(doc, 'Diagnostic', c.diagnosis); textBox(doc, 'Traitement réalisé', c.treatment); textBox(doc, 'Observations et recommandations', c.notes)
  signatures(doc)
}

// ── Fiche diagnostique : même présentation que la fiche papier de la clinique (remplie, ou vierge à imprimer) ──
const MAR = { single: 'Célibataire', married: 'Marié(e)', divorced: 'Divorcé(e)', widowed: 'Veuf / veuve', cohabiting: 'Concubinage', celibataire: 'Célibataire', marie: 'Marié(e)' }
export function diagnosticPdf(doc, { clinic: cl = {}, p = null, h = {}, exam = null, teeth = new Map(), doctor = null }) {
  const L = 40, w = W(doc), blank = !p, val = v => blank || v == null || v === '' ? '' : sp(v)
  const yn = v => blank || v == null || v === '' ? '' : v === true || v === 'oui' || v === 'yes' ? 'Oui' : v === false || v === 'non' || v === 'no' ? 'Non' : sp(v)
  // en-tête : nom de la clinique, adresse, téléphone
  doc.fillColor('#111').font('Helvetica-Bold').fontSize(26).text(sp((cl.name || 'DENTAL').toUpperCase()), L, 34, { width: w, align: 'center' })
  doc.font('Helvetica-Bold').fontSize(10.5).text(sp('ADRESSE : ' + (cl.address || '').toUpperCase()), L, doc.y + 2, { width: w, align: 'center' })
  doc.text(sp('TÉL : ' + (cl.phone || '')), L, doc.y + 1, { width: w, align: 'center' })
  let y = doc.y + 6; doc.moveTo(L, y).lineTo(L + w, y).lineWidth(1.6).strokeColor('#111').stroke()
  doc.font('Helvetica-Bold').fontSize(14).text('Fiche diagnostique', L, y + 8, { width: w, align: 'center' })
  if (p) doc.font('Helvetica').fontSize(8).fillColor('#555').text(sp(`Dossier ${p.file_number} · édité le ${fd(new Date())}`), L, y + 11, { width: w, align: 'right' })
  const title = (t, x, yy) => { doc.font('Helvetica-Bold').fontSize(11).fillColor('#111').text(t, x, yy, { underline: true, lineBreak: false }) }
  // champ « libellé + valeur » (ligne pointillée pour écrire à la main si vide)
  const field = (label, value, x, yy, lw, fw) => { doc.font('Helvetica').fontSize(10).fillColor('#111').text(label, x, yy, { width: lw, lineBreak: false })
    const vx = x + lw, vw = fw - lw; doc.moveTo(vx, yy + 11).lineTo(vx + vw, yy + 11).lineWidth(.6).strokeColor('#999').stroke()
    if (value) doc.font('Helvetica-Bold').fontSize(9.5).fillColor('#0f2a6b').text(value, vx + 3, yy - 0.5, { width: vw - 4, lineBreak: false, ellipsis: true }) }
  // 1. renseignements personnels
  y += 34; title('Renseignement Personnel :', L, y); y += 22
  const age = p?.birth_date ? Math.floor((Date.now() - new Date(p.birth_date)) / 31557600000) + ' ans' : ''
  const c1 = [['Nom :', val(p?.last_name)], ['Prénom :', val(p?.first_name)], ['Tél. :', val([p?.phone, p?.phone2].filter(Boolean).join(' / '))], ['Âge :', val(age)]]
  const c2 = [['Département :', val(p?.department)], ['Zone :', val(p?.zone)], ["Nombre d'enfants :", val(p?.children_count)], ['Sexe :', blank ? '' : p.sex === 'M' ? 'Masculin' : p.sex === 'F' ? 'Féminin' : '']]
  c1.forEach(([l, v], i) => field(l, v, L, y + i * 18, 52, 165)); c2.forEach(([l, v], i) => field(l, v, L + 180, y + i * 18, 92, 175))
  doc.font('Helvetica').fontSize(10).fillColor('#111').text('Statut matrimonial :', L + 370, y, { width: w - 370, lineBreak: false }); field('', blank ? '' : sp(MAR[p.marital_status] || p.marital_status || ''), L + 370, y + 18, 0, w - 370)
  // 2. histoire médicale (gauche) et examen stomatologique (droite)
  y += 4 * 18 + 16; title('Histoire Médicale :', L, y); title('Examen Stomatologique :', L + 290, y); y += 22
  const HIST = [['Tension artérielle', 'blood_pressure'], ['Diabète', 'diabetes'], ['Hémophilie', 'hemophilia'], ['VIH / Sida', 'hiv'], ['Fumez-vous', 'smoking'], ['Êtes-vous alcoolique', 'alcohol'], ['Êtes-vous enceinte', 'pregnancy'], ['Groupe sanguin', 'blood_group'], ['Brossage', 'brushing'], ['Fréquente migraine', 'migraines'], ['Maladie cardiovasculaire', 'cardiovascular'], ['Maladie pulmonaire', 'pulmonary'], ['Épilepsie', 'epilepsy'], ['Problème estomac', 'stomach'], ['Allergies', 'allergies'], ['Cancer', 'cancer']]
  HIST.forEach(([l, k], i) => field(l, ['blood_pressure', 'blood_group', 'brushing', 'allergies'].includes(k) ? val(h?.[k]) : yn(h?.[k]), L, y + i * 18.5, 132, 265))
  const EX = [['Tête', 'head'], ['Visage', 'face'], ['ATM', 'atm'], ['Langue', 'tongue'], ['Parodontie', 'periodontium'], ['Morphologie dentaire', 'tooth_morphology']]
  EX.forEach(([l, k], i) => field(l, val(exam?.[k]), L + 290, y + i * 18.5, l.length > 12 ? 108 : 70, w - 290))
  if (!blank && exam?.observations) { doc.font('Helvetica').fontSize(9).fillColor('#111').text('Observations :', L + 290, y + 6 * 18.5 + 6); doc.font('Helvetica-Bold').fontSize(9).fillColor('#0f2a6b').text(sp(exam.observations), L + 290, doc.y + 2, { width: w - 290, height: 80, ellipsis: true }) }
  // 3. renseignements bucco-dentaires : légende + odontogramme (numérotation FDI)
  y += HIST.length * 18.5 + 14; title('Renseignement Bucco-Dentaire', L, y); y += 20
  const mark = (kind, x, yy, r = 4) => { doc.save().lineWidth(1.4).strokeColor('#111').fillColor('#111')
    if (kind === 'carie') doc.circle(x, yy, r).fill(); else if (kind === 'extraire') { doc.moveTo(x - r, yy - r).lineTo(x + r, yy + r).moveTo(x + r, yy - r).lineTo(x - r, yy + r).stroke() } else doc.circle(x, yy, r).stroke()
    doc.restore() }
  ;[['Pour les dents cariées', 'carie'], ['Pour les dents à extraire', 'extraire'], ['Pour les dents déjà extraites', 'extraite']].forEach(([t, k], i) => { doc.font('Helvetica').fontSize(10).fillColor('#111').text(t, L, y + i * 16, { lineBreak: false }); mark(k, L + doc.widthOfString(t) + 12, y + i * 16 + 5) })
  y += 3 * 16 + 8
  const kindOf = s => s === 'carie' ? 'carie' : s === 'a_extraire' ? 'extraire' : ['extraite', 'absente'].includes(s) ? 'extraite' : null
  const cw = (w - 16) / 16, ch = 22
  const grid = (rows, x0) => rows.forEach((row, r) => row.forEach((t, i) => { const x = x0 + i * cw, yy = y + r * ch
    doc.rect(x, yy, cw, ch).lineWidth(1).strokeColor('#111').stroke()
    doc.font('Helvetica-Bold').fontSize(9.5).fillColor('#111').text(`${Math.floor(t / 10)}.${t % 10}`, x, yy + 6.5, { width: cw, align: 'center', lineBreak: false })
    const k = !blank && kindOf(teeth.get(t)); if (k) mark(k, x + cw - 6, yy + 6, 3.2) }))
  grid([[18, 17, 16, 15, 14, 13, 12, 11], [48, 47, 46, 45, 44, 43, 42, 41]], L)
  grid([[21, 22, 23, 24, 25, 26, 27, 28], [31, 32, 33, 34, 35, 36, 37, 38]], L + 8 * cw + 16)
  y += 2 * ch + 18
  // détartrage : grade I, II ou III (entouré s'il est renseigné)
  doc.font('Helvetica-Bold').fontSize(11).fillColor('#111').text('Détartrage grade', L, y, { lineBreak: false })
  const g = String(blank ? '' : h?.scaling_grade || '').toUpperCase().replace(/^GRADE\s*/, '').trim()
  ;['I', 'II', 'III'].forEach((n, i) => { const x = L + 150 + i * 60; doc.font('Helvetica-Bold').fontSize(11).text(n, x, y, { width: 26, align: 'center', lineBreak: false }); if (g === n || g === String(i + 1)) doc.circle(x + 13, y + 5, 11).lineWidth(1.3).strokeColor('#0f2a6b').stroke() })
  // signature
  y += 40; const sig = (t, x) => { doc.moveTo(x, y + 20).lineTo(x + 180, y + 20).lineWidth(.6).strokeColor('#999').stroke(); doc.font('Helvetica').fontSize(9).fillColor('#555').text(t, x, y + 24, { width: 180, align: 'center' }) }
  sig(blank || !doctor ? 'Médecin' : sp('Dr ' + doctor), L); sig('Date : ' + (blank ? '' : fd(new Date())), L + w - 180)
}
