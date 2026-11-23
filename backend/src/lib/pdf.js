import PDFDocument from 'pdfkit'
// Les polices standard du PDF ne contiennent pas les espaces insécables fines utilisées par fr-FR : on les remplace.
const sp = s => String(s ?? '').replace(/[  ]/g, ' ')
export const m = (n, c) => sp(Number(n).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })) + ' ' + c
const fd = d => new Date(d).toLocaleDateString('fr-FR', { timeZone: 'America/Port-au-Prince' })
// Date sans heure (colonne SQL « date ») : pas de conversion de fuseau, sinon on recule d'un jour
const fday = d => typeof d === 'string' ? d.slice(0, 10).split('-').reverse().join('/') : new Date(d).toLocaleDateString('fr-FR')
const C = { brand: '#1d6fd8', dark: '#0f1b33', text: '#1b2430', muted: '#6b7788', line: '#e3e8ef', soft: '#f3f6fb', ok: '#12804a', warn: '#c27a0e', err: '#d93a3a' }
const L = 48, R = 547, W = R - L, BOTTOM = 780

export function pipe(res, name, build, opts = {}) {
  const doc = new PDFDocument({ size: opts.size || 'A4', margin: opts.margin ?? 48, bufferPages: true, info: { Title: name } })
  res.setHeader('Content-Type', 'application/pdf'); res.setHeader('Content-Disposition', `inline; filename="${name}.pdf"`)
  doc.pipe(res); build(doc); doc.end()
}

// Reçu format TICKET pour imprimante thermique (rouleau 58 ou 80 mm) : colonne unique, compact.
export const receiptThermalPdf = (doc, { clinic, pay, inv, patient, paid }) => {
  const voided = !!pay.voided_at
  const pad = doc.page.margins.left, W = doc.page.width - pad * 2, X = pad
  const ctr = (t, f, s, c = '#000') => doc.font(f).fontSize(s).fillColor(c).text(t, X, doc.y, { width: W, align: 'center' })
  const div = () => { doc.moveDown(.25); const y = doc.y; doc.moveTo(X, y).lineTo(X + W, y).dash(1, { space: 2 }).strokeColor('#999').lineWidth(.5).stroke().undash(); doc.moveDown(.25) }
  const row = (l, v, b = false) => { const y = doc.y
    doc.font('Helvetica').fontSize(8).fillColor('#444').text(l, X, y, { width: W * 0.5 })
    doc.font(b ? 'Helvetica-Bold' : 'Helvetica').fontSize(8).fillColor('#000').text(String(v), X + W * 0.5, y, { width: W * 0.5, align: 'right' })
    doc.y = Math.max(doc.y, y + 11) }
  ctr(clinic?.name || 'Clinique', 'Helvetica-Bold', 11)
  if (clinic?.address) ctr(clinic.address, 'Helvetica', 7, '#555')
  if (clinic?.phone) ctr('Tél. ' + clinic.phone, 'Helvetica', 7, '#555')
  doc.moveDown(.25)
  ctr(voided ? 'REÇU — ANNULÉ' : 'REÇU DE PAIEMENT', 'Helvetica-Bold', 9, voided ? C.err : C.brand)
  div()
  row('N° reçu', pay.receipt_number, true); row('Date', fd(pay.created_at)); row('Facture', inv.number)
  div()
  row('Patient', who(patient))
  if (patient?.file_number) row('Dossier', patient.file_number)
  if (patient?.phone) row('Tél.', patient.phone)
  div()
  doc.moveDown(.15)
  ctr('MONTANT REÇU', 'Helvetica-Bold', 7, '#555')
  ctr(m(pay.amount, pay.currency), 'Helvetica-Bold', 15, voided ? C.err : '#000')
  ctr('Mode : ' + sp(pay.method).replace(/^./, c => c.toUpperCase()), 'Helvetica', 8, '#555')
  div()
  row('Total facture', m(inv.total, inv.currency))
  if (pay.currency !== inv.currency) row('Imputé', m(pay.applied_amount, inv.currency))
  if (paid != null) { row('Payé à ce jour', m(paid, inv.currency)); row('Solde restant', m(Math.max(0, Number(inv.total) - paid), inv.currency), true) }
  if (voided) { row('Annulé le', fd(pay.voided_at), true); if (pay.void_reason) row('Motif', pay.void_reason) }
  div()
  doc.moveDown(.15)
  ctr('Merci de votre confiance.', 'Helvetica', 8, '#555')
  ctr('À conserver comme preuve de paiement.', 'Helvetica', 7, '#888')
}

// ── Éléments de mise en page ──
const header = (doc, cl, title, meta) => {
  doc.rect(0, 0, doc.page.width, 6).fill(C.brand)
  doc.roundedRect(L, 34, 40, 40, 10).fill(C.brand)
  doc.font('Helvetica-Bold').fontSize(19).fillColor('#fff').text(sp(cl?.name || 'C').trim()[0].toUpperCase(), L, 45, { width: 40, align: 'center' })
  doc.font('Helvetica-Bold').fontSize(15).fillColor(C.dark).text(sp(cl?.name), L + 52, 35, { width: 230 })
  const info = [cl?.address, cl?.phone && 'Tél. ' + cl.phone].filter(Boolean).map(sp).join('\n')
  if (info) doc.font('Helvetica').fontSize(8.5).fillColor(C.muted).text(info, L + 52, doc.y + 2, { width: 230, lineGap: 1 })
  const leftEnd = doc.y
  doc.font('Helvetica-Bold').fontSize(21).fillColor(C.brand).text(title, 300, 32, { width: R - 300, align: 'right', characterSpacing: .5 })
  let y = 62
  for (const [k, v] of meta) { doc.font('Helvetica').fontSize(8.5).fillColor(C.muted).text(k, 300, y, { width: 95, align: 'right' }); doc.font('Helvetica-Bold').fontSize(9).fillColor(C.dark).text(sp(v), 400, y - .5, { width: R - 400, align: 'right' }); y += 14 }
  y = Math.max(y, leftEnd) + 14
  doc.moveTo(L, y).lineTo(R, y).lineWidth(1).strokeColor(C.line).stroke()
  doc.x = L; doc.y = y + 18
}
const pill = (doc, text, color, right, y) => {
  doc.font('Helvetica-Bold').fontSize(8.5); const w = doc.widthOfString(text) + 22
  doc.save().fillOpacity(.12).roundedRect(right - w, y, w, 20, 10).fill(color).restore()
  doc.fillColor(color).text(text, right - w, y + 6, { width: w, align: 'center', lineBreak: false })
}
// Encadré « destinataire » à gauche + statut à droite
const parties = (doc, label, lines, status) => {
  const y = doc.y, h = 76; lines = lines.filter(Boolean).map(sp)
  doc.roundedRect(L, y, 310, h, 9).fill(C.soft)
  doc.font('Helvetica-Bold').fontSize(7.5).fillColor(C.muted).text(label, L + 15, y + 13, { characterSpacing: .8 })
  doc.font('Helvetica-Bold').fontSize(12).fillColor(C.dark).text(lines[0] || '—', L + 15, y + 27, { width: 280, lineBreak: false, ellipsis: true })
  doc.font('Helvetica').fontSize(9).fillColor(C.text).text(lines.slice(1).join('\n'), L + 15, y + 44, { width: 280, height: 28, ellipsis: true, lineGap: 1 })
  if (status) { doc.font('Helvetica-Bold').fontSize(7.5).fillColor(C.muted).text('STATUT', 380, y + 13, { width: R - 380, align: 'right', characterSpacing: .8 }); pill(doc, status[0], status[1], R, y + 28) }
  doc.x = L; doc.y = y + h + 22
}
// Tableau : cols = [{ t: titre, w: largeur, a: alignement }]
const table = (doc, cols, rows) => {
  let y = doc.y
  const head = () => { doc.roundedRect(L, y, W, 24, 6).fill(C.dark); let x = L
    doc.font('Helvetica-Bold').fontSize(8).fillColor('#fff'); cols.forEach(c => { doc.text(c.t.toUpperCase(), x + 10, y + 8.5, { width: c.w - 20, align: c.a || 'left', characterSpacing: .5, lineBreak: false }); x += c.w }); y += 24 }
  head()
  rows.forEach((r, k) => {
    doc.font('Helvetica').fontSize(9.5)
    const h = Math.max(...r.map((t, i) => doc.heightOfString(sp(t), { width: cols[i].w - 20 }))) + 14
    if (y + h > BOTTOM) { doc.addPage(); y = 48; head() }
    if (k % 2) doc.rect(L, y, W, h).fill(C.soft)
    let x = L; r.forEach((t, i) => { doc.font(i ? 'Helvetica' : 'Helvetica-Bold').fontSize(9.5).fillColor(i ? C.text : C.dark).text(sp(t), x + 10, y + 7, { width: cols[i].w - 20, align: cols[i].a || 'left' }); x += cols[i].w })
    y += h
  })
  if (!rows.length) { doc.font('Helvetica').fontSize(9.5).fillColor(C.muted).text('Aucune ligne.', L + 10, y + 8); y += 26 }
  doc.moveTo(L, y).lineTo(R, y).lineWidth(1).strokeColor(C.line).stroke()
  doc.x = L; doc.y = y + 16
}
// Bloc de totaux aligné à droite : [libellé, valeur, style ('brand' | 'soft' | undefined)]
const totals = (doc, lines) => {
  const x = 317, w = R - x; let y = doc.y
  if (y + lines.length * 26 > BOTTOM) { doc.addPage(); y = 48 }
  for (const [l, v, s] of lines) {
    if (s) { doc.roundedRect(x, y, w, 30, 7).fill(s === 'brand' ? C.brand : C.soft); const c = s === 'brand' ? '#fff' : C.dark
      doc.font('Helvetica-Bold').fontSize(10.5).fillColor(c).text(l, x + 13, y + 10, { width: 110, lineBreak: false }).text(v, x + 120, y + 10, { width: w - 133, align: 'right', lineBreak: false }); y += 36 }
    else { doc.font('Helvetica').fontSize(9.5).fillColor(C.muted).text(l, x + 13, y, { width: 110, lineBreak: false }); doc.fillColor(C.text).text(v, x + 120, y, { width: w - 133, align: 'right', lineBreak: false }); y += 19 }
  }
  doc.x = L; doc.y = y + 8
}
// Liste libellé / valeur sur toute la largeur
const kv = (doc, rows) => {
  let y = doc.y
  for (const [k, v, strong] of rows) {
    doc.font('Helvetica').fontSize(9.5).fillColor(C.muted).text(k, L, y, { width: 220 })
    doc.font(strong ? 'Helvetica-Bold' : 'Helvetica').fillColor(strong ? C.dark : C.text).text(sp(v), L + 230, y, { width: W - 230, align: 'right' })
    y = Math.max(doc.y, y + 12) + 9; doc.moveTo(L, y - 5).lineTo(R, y - 5).lineWidth(.6).strokeColor(C.line).stroke()
  }
  doc.x = L; doc.y = y + 8
}
const note = (doc, text) => { if (doc.y > BOTTOM - 30) doc.addPage(); doc.font('Helvetica').fontSize(8).fillColor(C.muted).text(sp(text), L, doc.y, { width: W, lineGap: 1 }); doc.moveDown(.4) }
const section = (doc, t) => { if (doc.y > BOTTOM - 60) doc.addPage(); doc.font('Helvetica-Bold').fontSize(8).fillColor(C.muted).text(t, L, doc.y, { characterSpacing: .8 }); doc.moveDown(.6) }
const signature = (doc, label) => {
  let y = Math.max(doc.y + 26, 640); if (y > BOTTOM - 40) { doc.addPage(); y = 120 }
  doc.moveTo(R - 190, y + 40).lineTo(R, y + 40).lineWidth(.8).strokeColor('#b8c2d1').stroke()
  doc.font('Helvetica').fontSize(8.5).fillColor(C.muted).text(label, R - 190, y + 46, { width: 190, align: 'center' })
}
// Pied de page sur chaque page (numérotation)
const footer = (doc, text) => {
  const r = doc.bufferedPageRange()
  for (let i = r.start; i < r.start + r.count; i++) {
    doc.switchToPage(i); const b = doc.page.margins.bottom; doc.page.margins.bottom = 0
    const y = doc.page.height - 38
    doc.moveTo(L, y - 9).lineTo(R, y - 9).lineWidth(.6).strokeColor(C.line).stroke()
    doc.font('Helvetica').fontSize(7.5).fillColor(C.muted).text(sp(text), L, y, { width: W - 90, lineBreak: false, ellipsis: true })
    doc.text(`Page ${i - r.start + 1} / ${r.count}`, R - 90, y, { width: 90, align: 'right', lineBreak: false })
    doc.page.margins.bottom = b
  }
}
const who = p => p ? `${p.last_name} ${p.first_name}` : '—'

// ── Documents ──
export const invoicePdf = (doc, { clinic, inv, items, patient, paid }) => {
  const pro = inv.kind === 'proforma', cur = inv.currency, rest = Math.max(0, Number(inv.total) - paid)
  header(doc, clinic, pro ? 'PROFORMA' : 'FACTURE', [['N°', inv.number], ['Date', fd(inv.created_at)], ['Devise', cur]])
  const status = inv.status === 'cancelled' ? ['ANNULÉE', C.err] : inv.status === 'converted' ? ['CONVERTIE EN FACTURE', C.muted] : pro ? ['DEVIS', C.brand]
    : rest <= 0 ? ['PAYÉE', C.ok] : paid > 0 ? ['PARTIELLEMENT PAYÉE', C.warn] : ['À PAYER', C.warn]
  parties(doc, pro ? 'DEVIS ÉTABLI POUR' : 'FACTURÉ À', [who(patient), patient?.file_number && `Dossier ${patient.file_number}`, [patient?.phone && `Tél. ${patient.phone}`, patient?.address].filter(Boolean).join(' · ')], status)
  table(doc, [{ t: 'Prestation', w: 229 }, { t: 'Qté', w: 50, a: 'right' }, { t: 'Prix unitaire', w: 110, a: 'right' }, { t: 'Montant', w: 110, a: 'right' }],
    items.map(i => [i.description, sp(Number(i.qty).toLocaleString('fr-FR')), m(i.unit_price, cur), m(i.line_total, cur)]))
  const t = [['Sous-total', m(inv.subtotal, cur)]]; if (Number(inv.discount)) t.push(['Remise', '- ' + m(inv.discount, cur)])
  t.push([pro ? 'TOTAL ESTIMÉ' : 'TOTAL', m(inv.total, cur), 'brand'])
  if (!pro && inv.status !== 'cancelled') t.push(['Déjà payé', m(paid, cur)], ['Solde à payer', m(rest, cur), 'soft'])
  totals(doc, t)
  doc.moveDown(.6)
  if (inv.notes) note(doc, 'Note : ' + inv.notes)
  if (inv.rate_htg_per_usd) note(doc, `Taux appliqué à l'émission : 1 USD = ${Number(inv.rate_htg_per_usd)} HTG.`)
  if (pro) note(doc, 'Document non comptable : ce devis n\'a pas valeur de facture. Les montants peuvent évoluer selon le traitement réellement effectué.')
  footer(doc, `${clinic?.name || ''} · ${pro ? 'Proforma' : 'Facture'} ${inv.number} · Merci de votre confiance.`)
}

export const receiptPdf = (doc, { clinic, pay, inv, patient, paid }) => {
  const voided = !!pay.voided_at
  header(doc, clinic, 'REÇU', [['N°', pay.receipt_number], ['Date', fd(pay.created_at)], ['Facture', inv.number]])
  parties(doc, 'REÇU DE', [who(patient), patient?.file_number && `Dossier ${patient.file_number}`, patient?.phone && `Tél. ${patient.phone}`], voided ? ['PAIEMENT ANNULÉ', C.err] : ['PAIEMENT REÇU', C.ok])
  // Montant mis en avant
  const y = doc.y
  doc.roundedRect(L, y, W, 84, 12).fill(voided ? '#fdecec' : C.brand); const fg = voided ? C.err : '#fff'
  doc.font('Helvetica-Bold').fontSize(8).fillColor(fg).text('MONTANT REÇU', L + 22, y + 18, { characterSpacing: .8 })
  doc.font('Helvetica-Bold').fontSize(28).fillColor(fg).text(m(pay.amount, pay.currency), L + 22, y + 34, { width: 300, lineBreak: false })
  doc.font('Helvetica').fontSize(8.5).fillColor(fg).text('Mode de paiement', R - 182, y + 22, { width: 160, align: 'right' })
  doc.font('Helvetica-Bold').fontSize(13).fillColor(fg).text(sp(pay.method).replace(/^./, c => c.toUpperCase()), R - 182, y + 38, { width: 160, align: 'right', lineBreak: false })
  doc.x = L; doc.y = y + 106
  section(doc, 'DÉTAIL')
  const rows = [['Facture', inv.number], ['Total de la facture', m(inv.total, inv.currency)]]
  if (pay.currency !== inv.currency) rows.push(['Imputé sur la facture', `${m(pay.applied_amount, inv.currency)} (taux ${Number(pay.rate_htg_per_usd)} HTG/USD)`])
  if (paid != null) rows.push(['Total payé à ce jour', m(paid, inv.currency)], ['Solde restant', m(Math.max(0, Number(inv.total) - paid), inv.currency), true])
  if (voided) rows.push(['Annulé le', fd(pay.voided_at), true], ["Motif de l'annulation", pay.void_reason || '—'])
  kv(doc, rows)
  signature(doc, 'Signature et cachet de la clinique')
  footer(doc, `${clinic?.name || ''} · Reçu ${pay.receipt_number} · À conserver comme preuve de paiement.`)
}

export const payslipPdf = (doc, { clinic, emp, r, pays }) => {
  const label = new Date(r.period + '-01T12:00:00').toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' }), rest = Math.max(0, r.net - r.paid)
  header(doc, clinic, 'BULLETIN DE PAIE', [['Période', label.replace(/^./, c => c.toUpperCase())], ['Matricule', emp.matricule || emp.id.slice(0, 8)], ['Édité le', fd(new Date())]])
  const st = { to_pay: ['À PAYER', C.warn], partial: ['PARTIELLEMENT PAYÉ', C.warn], paid: ['PAYÉ', C.ok] }[r.status] || [String(r.status).toUpperCase(), C.muted]
  parties(doc, 'SALARIÉ', [`${emp.last_name} ${emp.first_name}`, emp.job_title || 'Fonction non précisée', emp.hire_date && `Embauché le ${fday(emp.hire_date)}`], st)
  table(doc, [{ t: 'Élément', w: 349 }, { t: 'Montant', w: 150, a: 'right' }],
    [['Salaire de base', m(r.base, 'HTG')], ['Commissions sur actes', m(r.commissions, 'HTG')], ['Primes', m(r.bonuses, 'HTG')], ['SALAIRE BRUT', m(r.base + r.commissions + r.bonuses, 'HTG')], ...(r.deduction_details || []).map(d => [`Retenue : ${d.label}${d.kind === 'pct' ? ` (${String(d.value).replace('.', ',')} % du brut)` : ''}`, '- ' + m(d.amount, 'HTG')]), ...(Number(r.other_deductions) ? [['Autres déductions', '- ' + m(Number(r.other_deductions), 'HTG')]] : []), ['Avances déduites', '- ' + m(r.advances, 'HTG')]])
  totals(doc, [['NET À PAYER', m(r.net, 'HTG'), 'brand'], ['Déjà versé', m(r.paid, 'HTG')], ['Reste à verser', m(rest, 'HTG'), 'soft']])
  if (pays.length) { doc.moveDown(.6); section(doc, 'VERSEMENTS'); table(doc, [{ t: 'Date', w: 160 }, { t: 'Mode', w: 189 }, { t: 'Montant', w: 150, a: 'right' }], pays.map(p => [fd(p.paid_at), p.method, m(p.amount, 'HTG')])) }
  doc.moveDown(.4); note(doc, 'Retenues appliquées selon la fiche de l\'employé (Personnel & paie) ; les montants retenus sont à reverser aux organismes concernés.')
  signature(doc, "Signature de l'employé")
  footer(doc, `${clinic?.name || ''} · Bulletin de paie ${label} · Document confidentiel.`)
}
