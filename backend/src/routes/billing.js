import { payPlan, payProblem, lockedDoctor } from '../lib/billing-core.js'
import { pipe, invoicePdf, receiptPdf, receiptThermalPdf, payslipPdf } from '../lib/pdf.js'
import { makePdf, header as pdfHeader, table as pdfTable, num as pdfNum, fd as pdfFd } from '../lib/dossier-pdf.js'
const NUM = /^\d{1,10}(\.\d{1,4})?$/, c100 = v => Math.round(Number(v) * 100)
export default function (app, { pool, q, need, audit, fail, wrap, clean }) {
  const tx = async fn => { const c = await pool.connect(); try { await c.query('begin'); const r = await fn(c); await c.query('commit'); return r } catch (e) { await c.query('rollback'); throw e } finally { c.release() } }
  const rateNow = async (c, cid) => (await c.query('select rate::text from exchange_rates where clinic_id=$1 and effective_at<=now() order by effective_at desc, created_at desc limit 1', [cid])).rows[0]?.rate ?? null
  const clinic = async cid => (await q('select name,address,phone from clinics where id=$1', [cid])).rows[0]
  const E = (s, m) => ({ err: [s, m] })

  // factures sans médecin responsable : commission attribuée à personne (à corriger)
  app.get('/api/invoices/no-doctor', need('view_finances'), wrap(async (req, res) => { const r = (await q("select i.id,i.number,p.last_name||' '||p.first_name patient,i.total::text,i.created_at from invoices i join patients p on p.id=i.patient_id where i.clinic_id=$1 and i.kind='invoice' and i.status<>'cancelled' and i.doctor_id is null order by i.created_at desc", [req.user.clinic_id])).rows; res.json({ count: r.length, rows: r.slice(0, 50) }) }))
  app.get('/api/invoices', need('view_finances'), wrap(async (req, res) => {
    const kind = req.query.kind === 'proforma' ? 'proforma' : 'invoice', page = Math.max(0, parseInt(req.query.page) || 0)
    res.json((await q(`select i.id,i.number,i.kind,i.status,i.currency,i.total::text,i.created_at,p.last_name||' '||p.first_name patient,
      coalesce((select sum(applied_amount) from payments y where y.invoice_id=i.id and y.voided_at is null),0)::text paid
      from invoices i join patients p on p.id=i.patient_id where i.clinic_id=$1 and i.kind=$2 order by i.created_at desc limit 20 offset ${page * 20}`, [req.user.clinic_id, kind])).rows) }))

  app.post('/api/invoices', need('manage_finances'), wrap(async (req, res) => {
    const b = req.body, kind = b.kind === 'proforma' ? 'proforma' : 'invoice', cur = b.currency === 'USD' ? 'USD' : 'HTG'
    const items = Array.isArray(b.items) ? b.items.slice(0, 100) : []; if (!items.length) return fail(res, 400, 'Au moins une prestation')
    let sub = 0; const lines = []
    for (const i of items) { const d = clean(i.description); if (!d || !NUM.test(String(i.qty)) || !NUM.test(String(i.unit_price)) || Number(i.qty) <= 0) return fail(res, 400, 'Ligne invalide')
      const lt = Math.round(Number(i.qty) * c100(i.unit_price)); sub += lt; lines.push([d, i.qty, i.unit_price, lt / 100]) }
    const pct = b.discount_pct !== undefined && b.discount_pct !== '' ? Number(String(b.discount_pct).replace(',', '.')) : null
    if (pct !== null && !(pct >= 0 && pct <= 100)) return fail(res, 400, 'Pourcentage de remise invalide (0 à 100)')
    const disc = pct !== null ? Math.round(sub * pct / 100) : b.discount ? c100(String(b.discount).replace(',', '.')) : 0; if (!(disc >= 0 && disc <= sub)) return fail(res, 400, 'Remise invalide')
    // médecin responsable : obligatoire sur une facture (sa commission en dépend) ; un médecin est toujours lui-même
    const doc = lockedDoctor(req) ? req.user.id : /^[0-9a-f-]{36}$/.test(b.doctor_id || '') ? b.doctor_id : null
    if (kind === 'invoice' && !doc) return fail(res, 400, 'Choisissez le médecin responsable : sa commission est calculée sur cette facture')
    const out = await tx(async c => {
      const pat = (await c.query('select id from patients where clinic_id=$1 and file_number=$2', [req.user.clinic_id, clean(b.patient_file, 30)])).rows[0]; if (!pat) return E(404, 'Patient introuvable')
      if (doc && !(await c.query("select 1 from users where id=$1 and clinic_id=$2 and status='active'", [doc, req.user.clinic_id])).rowCount) return E(400, 'Médecin responsable introuvable ou désactivé')
      const rate = await rateNow(c, req.user.clinic_id); if (cur === 'USD' && !rate) return E(409, "Définissez d'abord un taux de change")
      const seq = (await c.query(`select nextval('${kind === 'invoice' ? 'invoice_seq' : 'proforma_seq'}') n`)).rows[0].n
      const num = `${kind === 'invoice' ? 'FAC' : 'PRO'}-${new Date().getFullYear()}-${String(seq).padStart(5, '0')}`
      const { rows: [inv] } = await c.query('insert into invoices(clinic_id,kind,number,patient_id,currency,rate_htg_per_usd,subtotal,discount,total,notes,created_by) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) returning id,number',
        [req.user.clinic_id, kind, num, pat.id, cur, rate, sub / 100, disc / 100, (sub - disc) / 100, clean(b.notes, 500), req.user.id])
      for (const l of lines) await c.query('insert into invoice_items(invoice_id,description,qty,unit_price,line_total) values($1,$2,$3,$4,$5)', [inv.id, ...l])
      if (doc) await c.query('update invoices set doctor_id=$1 where id=$2 and exists(select 1 from users where id=$1 and clinic_id=$3)', [doc, inv.id, req.user.clinic_id])
      if (/^[0-9a-f-]{36}$/.test(b.plan_id || '')) await c.query('update invoices set plan_id=$1 where id=$2 and exists(select 1 from treatment_plans where id=$1 and clinic_id=$3 and patient_id=$4)', [b.plan_id, inv.id, req.user.clinic_id, pat.id])
      return inv })
    if (out.err) return fail(res, ...out.err)
    await audit(req, 'INVOICE_CREATED', 'invoices', out.id, { number: out.number }); res.json(out) }))

  app.post('/api/invoices/:id/convert', need('manage_finances'), wrap(async (req, res) => {
    const out = await tx(async c => {
      const p = (await c.query("select * from invoices where id=$1 and clinic_id=$2 and kind='proforma' and status='issued' for update", [req.params.id, req.user.clinic_id])).rows[0]; if (!p) return E(404, 'Proforma introuvable ou déjà convertie')
      const rate = await rateNow(c, req.user.clinic_id); if (p.currency === 'USD' && !rate) return E(409, 'Taux de change requis')
      const n = (await c.query("select nextval('invoice_seq') n")).rows[0].n, num = `FAC-${new Date().getFullYear()}-${String(n).padStart(5, '0')}`
      const { rows: [inv] } = await c.query("insert into invoices(clinic_id,kind,number,patient_id,currency,rate_htg_per_usd,subtotal,discount,total,notes,created_by) select clinic_id,'invoice',$2,patient_id,currency,$3,subtotal,discount,total,notes,$4 from invoices where id=$1 returning id,number", [p.id, num, rate, req.user.id])
      await c.query('insert into invoice_items(invoice_id,description,qty,unit_price,line_total) select $2,description,qty,unit_price,line_total from invoice_items where invoice_id=$1', [p.id, inv.id])
      await c.query("update invoices set status='converted' where id=$1", [p.id]); return inv })
    if (out.err) return fail(res, ...out.err); await audit(req, 'PROFORMA_CONVERTED', 'invoices', out.id); res.json(out) }))

  app.post('/api/invoices/:id/cancel', need('manage_finances'), wrap(async (req, res) => {
    const reason = clean(req.body.reason, 300); if (!reason) return fail(res, 400, "Motif d'annulation obligatoire")
    const out = await tx(async c => {
      const i = (await c.query("select id,status from invoices where id=$1 and clinic_id=$2 and kind='invoice' for update", [req.params.id, req.user.clinic_id])).rows[0]; if (!i) return E(404, 'Introuvable')
      if ((await c.query('select 1 from payments where invoice_id=$1 and voided_at is null', [i.id])).rowCount) return E(409, "Annulez d'abord les paiements")
      if (i.status !== 'issued') return E(409, 'Facture déjà annulée ou convertie')
      await c.query("update invoices set status='cancelled', cancel_reason=$2, cancelled_by=$3, cancelled_at=now() where id=$1", [i.id, reason, req.user.id]); return {} })
    if (out.err) return fail(res, ...out.err); await audit(req, 'INVOICE_CANCELLED', 'invoices', req.params.id, { reason }); res.json({ ok: true }) }))

  app.get('/api/invoices/:id/pdf', need('view_finances'), wrap(async (req, res) => {
    const inv = (await q('select * from invoices where id=$1 and clinic_id=$2', [req.params.id, req.user.clinic_id])).rows[0]; if (!inv) return fail(res, 404, 'Introuvable')
    const [items, pat, paid] = await Promise.all([q('select * from invoice_items where invoice_id=$1 order by description', [inv.id]), q('select * from patients where id=$1', [inv.patient_id]),
      q('select coalesce(sum(applied_amount),0) s from payments where invoice_id=$1 and voided_at is null', [inv.id])])
    const cl = await clinic(req.user.clinic_id)
    pipe(res, inv.number, d => invoicePdf(d, { clinic: cl, inv, items: items.rows, patient: pat.rows[0], paid: Number(paid.rows[0].s) })) }))

  app.get('/api/invoices/:id/payments', need('view_finances'), wrap(async (req, res) => res.json((await q(
    'select id,receipt_number,amount::text,currency,method,reference,created_at,voided_at from payments where invoice_id=$1 and clinic_id=$2 order by created_at', [req.params.id, req.user.clinic_id])).rows)))

  app.post('/api/invoices/:id/payments', need('manage_finances'), wrap(async (req, res) => {
    const { amount, currency, method, idempotency_key: key } = req.body, cur = currency === 'USD' ? 'USD' : 'HTG'
    if (!NUM.test(String(amount)) || Number(amount) <= 0 || typeof key !== 'string' || key.length < 8 || key.length > 80 || !clean(method, 30)) return fail(res, 400, 'Paiement invalide')
    { const pb = payProblem({ paid: amount, method, reference: req.body.reference }); if (pb) return fail(res, 400, pb) }
    const out = await tx(async c => {
      const dup = (await c.query('select id,receipt_number from payments where clinic_id=$1 and idempotency_key=$2', [req.user.clinic_id, key])).rows[0]; if (dup) return { ...dup, duplicate: true }
      const inv = (await c.query("select * from invoices where id=$1 and clinic_id=$2 and kind='invoice' for update", [req.params.id, req.user.clinic_id])).rows[0]
      if (!inv) return E(404, 'Facture introuvable'); if (inv.status !== 'issued') return E(409, 'Facture non payable')
      const rate = await rateNow(c, req.user.clinic_id); if ((cur !== inv.currency || cur === 'USD') && !rate) return E(409, 'Taux de change requis')
      const a = c100(amount), r = Number(rate)
      const applied = cur === inv.currency ? a : inv.currency === 'HTG' ? Math.round(a * r) : Math.round(a / r), htg = cur === 'HTG' ? a : Math.round(a * r)
      const paid = c100((await c.query('select coalesce(sum(applied_amount),0) s from payments where invoice_id=$1 and voided_at is null', [inv.id])).rows[0].s)
      if (paid + applied > c100(inv.total)) return E(409, 'Le paiement dépasse le solde de la facture')
      const rn = `REC-${new Date().getFullYear()}-${String((await c.query("select nextval('receipt_seq') n")).rows[0].n).padStart(5, '0')}`
      const pr = (await c.query('insert into payments(clinic_id,invoice_id,receipt_number,amount,currency,rate_htg_per_usd,applied_amount,amount_htg,method,idempotency_key,created_by,reference) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) returning id,receipt_number',
        [req.user.clinic_id, inv.id, rn, a / 100, cur, rate, applied / 100, htg / 100, clean(method, 30), key, req.user.id, clean(req.body.reference, 80)])).rows[0]
      await c.query("select cash_post_m($1,$2,'in',$3,$4,$5,'payment',$6,$7,$8)", [req.user.clinic_id, cur, a / 100, rn, 'Paiement ' + inv.number, pr.id, req.user.id, clean(method, 30)]); return pr })
    if (out.err) return fail(res, ...out.err)
    if (!out.duplicate) await audit(req, 'PAYMENT_RECORDED', 'payments', out.id, { receipt: out.receipt_number }); res.json(out) }))

  app.post('/api/payments/:id/void', need('manage_finances'), wrap(async (req, res) => {
    const reason = clean(req.body.reason, 200); if (!reason) return fail(res, 400, 'Motif requis')
    const r = await q('update payments set voided_at=now(), void_reason=$3 where id=$1 and clinic_id=$2 and voided_at is null returning id,receipt_number,amount,currency', [req.params.id, req.user.clinic_id, reason])
    if (!r.rowCount) return fail(res, 404, 'Paiement introuvable ou déjà annulé')
    const v = r.rows[0]; await q('select cash_void($1,$2,$3,$4,$5)', [req.user.clinic_id, v.id, 'VOID-' + v.receipt_number, 'Annulation ' + v.receipt_number, req.user.id]); await audit(req, 'PAYMENT_VOIDED', 'payments', req.params.id, { reason }); res.json({ ok: true }) }))
  app.get('/api/payments/:id/receipt', need('view_finances'), wrap(async (req, res) => {
    const pay = (await q('select * from payments where id=$1 and clinic_id=$2', [req.params.id, req.user.clinic_id])).rows[0]; if (!pay) return fail(res, 404, 'Introuvable')
    const inv = (await q('select * from invoices where id=$1', [pay.invoice_id])).rows[0], pat = (await q('select * from patients where id=$1', [inv.patient_id])).rows[0]
    const [cl, paid] = await Promise.all([clinic(req.user.clinic_id), q('select coalesce(sum(applied_amount),0) s from payments where invoice_id=$1 and voided_at is null', [inv.id])])
    const data = { clinic: cl, pay, inv, patient: pat, paid: Number(paid.rows[0].s) }
    // Format TICKET pour imprimante thermique (rouleau 58/80 mm) via ?format=thermal[&w=58|80]
    if (req.query.format === 'thermal' || req.query.thermal === '1') {
      const w58 = String(req.query.w) === '58'
      const width = w58 ? 164.41 : 226.77   // 58 mm / 80 mm en points PDF
      const rows = 3 + 1 + (pat?.file_number ? 1 : 0) + (pat?.phone ? 1 : 0) + 1 + (pay.currency !== inv.currency ? 1 : 0) + (paid != null ? 2 : 0) + (pay.voided_at ? 2 : 0)
      const height = 195 + (cl?.address ? 11 : 0) + (cl?.phone ? 11 : 0) + rows * 11
      return pipe(res, pay.receipt_number, d => receiptThermalPdf(d, data), { size: [width, Math.max(260, height)], margin: 10 })
    }
    pipe(res, pay.receipt_number, d => receiptPdf(d, data)) }))

  // ── Facture verrouillée : détail, correction autorisée (motif obligatoire, versions conservées), historique ──
  const snap = async (c, id) => { const i = (await c.query("select i.number,i.kind,i.status,i.currency,i.subtotal::float8 subtotal,i.discount::float8 discount,i.total::float8 total,i.doctor_id,u.first_name||' '||u.last_name doctor from invoices i left join users u on u.id=i.doctor_id where i.id=$1", [id])).rows[0]
    const items = (await c.query('select description,qty::float8 qty,unit_price::float8 unit_price,line_total::float8 line_total from invoice_items where invoice_id=$1 order by description', [id])).rows; return { ...i, items } }
  app.get('/api/invoices/:id', need('view_finances'), wrap(async (req, res) => {
    if (!/^[0-9a-f-]{36}$/.test(req.params.id)) return fail(res, 404, 'Introuvable')
    const ok = (await q('select 1 from invoices where id=$1 and clinic_id=$2', [req.params.id, req.user.clinic_id])).rowCount; if (!ok) return fail(res, 404, 'Introuvable')
    const s = await snap({ query: q }, req.params.id), paid = (await q('select coalesce(sum(applied_amount),0)::float8 s from payments where invoice_id=$1 and voided_at is null', [req.params.id])).rows[0].s
    res.json({ ...s, id: req.params.id, paid }) }))
  app.post('/api/invoices/:id/correct', need('manage_finances'), wrap(async (req, res) => {
    const b = req.body, reason = clean(b.reason, 300); if (!reason) return fail(res, 400, 'Motif de la correction obligatoire')
    const items = Array.isArray(b.items) ? b.items.slice(0, 100) : []; if (!items.length) return fail(res, 400, 'Au moins une prestation')
    let sub = 0; const lines = []
    for (const i of items) { const d = clean(i.description), qt = String(i.qty).replace(',', '.'), up = String(i.unit_price).replace(',', '.'); if (!d || !NUM.test(qt) || !NUM.test(up) || Number(qt) <= 0) return fail(res, 400, 'Ligne invalide')
      const lt = Math.round(Number(qt) * c100(up)); sub += lt; lines.push([d, qt, up, lt / 100]) }
    const pct = b.discount_pct !== undefined && b.discount_pct !== '' ? Number(String(b.discount_pct).replace(',', '.')) : null; if (pct !== null && !(pct >= 0 && pct <= 100)) return fail(res, 400, 'Pourcentage invalide')
    const disc = pct !== null ? Math.round(sub * pct / 100) : b.discount ? c100(String(b.discount).replace(',', '.')) : 0; if (!(disc >= 0 && disc <= sub)) return fail(res, 400, 'Remise invalide')
    const out = await tx(async c => {
      const i = (await c.query('select id,status from invoices where id=$1 and clinic_id=$2 for update', [req.params.id, req.user.clinic_id])).rows[0]; if (!i) return E(404, 'Introuvable'); if (i.status !== 'issued') return E(409, 'Seule une facture émise (ni annulée, ni convertie) peut être corrigée')
      const paid = c100((await c.query('select coalesce(sum(applied_amount),0) s from payments where invoice_id=$1 and voided_at is null', [i.id])).rows[0].s)
      if (sub - disc < paid) return E(409, 'Le nouveau total serait inférieur aux paiements déjà reçus : annulez d\'abord un paiement')
      const before = await snap(c, i.id), doc = lockedDoctor(req) ? before.doctor_id || req.user.id : /^[0-9a-f-]{36}$/.test(b.doctor_id || '') ? b.doctor_id : before.doctor_id
      if (before.kind === 'invoice' && !doc) return E(400, 'Choisissez le médecin responsable : sa commission est calculée sur cette facture')
      await c.query('delete from invoice_items where invoice_id=$1', [i.id]); for (const l of lines) await c.query('insert into invoice_items(invoice_id,description,qty,unit_price,line_total) values($1,$2,$3,$4,$5)', [i.id, ...l])
      await c.query('update invoices set subtotal=$2,discount=$3,total=$4,doctor_id=$5 where id=$1', [i.id, sub / 100, disc / 100, (sub - disc) / 100, doc])
      const after = await snap(c, i.id); await c.query('insert into invoice_revisions(clinic_id,invoice_id,changed_by,reason,before,after) values($1,$2,$3,$4,$5,$6)', [req.user.clinic_id, i.id, req.user.id, reason, JSON.stringify(before), JSON.stringify(after)])
      return { before: before.total, after: after.total } })
    if (out.err) return fail(res, ...out.err); await audit(req, 'INVOICE_CORRECTED', 'invoices', req.params.id, { reason, ...out }); res.json({ ok: true, ...out }) }))
  app.get('/api/invoices/:id/history', need('view_finances'), wrap(async (req, res) => {
    if (!/^[0-9a-f-]{36}$/.test(req.params.id)) return fail(res, 404, 'Introuvable')
    const inv = (await q("select i.number,i.created_at,i.status,i.cancel_reason,i.cancelled_at,c.first_name||' '||c.last_name created_by_name,x.first_name||' '||x.last_name cancelled_by_name from invoices i left join users c on c.id=i.created_by left join users x on x.id=i.cancelled_by where i.id=$1 and i.clinic_id=$2", [req.params.id, req.user.clinic_id])).rows[0]; if (!inv) return fail(res, 404, 'Introuvable')
    const rev = (await q("select r.changed_at,r.reason,r.before,r.after,u.first_name||' '||u.last_name who from invoice_revisions r join users u on u.id=r.changed_by where r.invoice_id=$1 order by r.changed_at", [req.params.id])).rows
    const pays = (await q("select y.receipt_number,y.amount::float8 amount,y.currency,y.method,y.reference,y.created_at,y.voided_at,y.void_reason,u.first_name||' '||u.last_name who from payments y left join users u on u.id=y.created_by where y.invoice_id=$1 order by y.created_at", [req.params.id])).rows
    res.json({ invoice: inv, revisions: rev, payments: pays }) }))

  // ── Dettes patients : toutes les factures émises dont le solde n'est pas réglé ──
  const debtRows = async req => {
    const args = [req.user.clinic_id], w = []
    if (/^\d{4}-\d{2}-\d{2}$/.test(req.query.from || '')) { args.push(req.query.from); w.push(`i.created_at >= $${args.length}::date`) }
    if (/^\d{4}-\d{2}-\d{2}$/.test(req.query.to || '')) { args.push(req.query.to); w.push(`i.created_at < ($${args.length}::date + 1)`) }
    if (/^[0-9a-f-]{36}$/.test(req.query.doctor || '')) { args.push(req.query.doctor); w.push(`i.doctor_id = $${args.length}`) }
    const rows = (await q(`select * from (select i.id,i.number,i.created_at,i.currency,i.subtotal::float8 subtotal,i.discount::float8 discount,i.total::float8 total,i.doctor_id,
        p.id patient_id,p.last_name||' '||p.first_name patient,p.file_number,p.phone,u.first_name||' '||u.last_name doctor,
        coalesce((select sum(y.applied_amount) from payments y where y.invoice_id=i.id and y.voided_at is null),0)::float8 paid,
        (select max(y.created_at) from payments y where y.invoice_id=i.id and y.voided_at is null) last_payment,
        (current_date - i.created_at::date) age_days
      from invoices i join patients p on p.id=i.patient_id left join users u on u.id=i.doctor_id
      where i.clinic_id=$1 and i.kind='invoice' and i.status='issued' ${w.length ? 'and ' + w.join(' and ') : ''}) x where x.total - x.paid > 0.004 order by x.created_at`, args)).rows
    return rows.map(r => ({ ...r, balance: Math.round((r.total - r.paid) * 100) / 100 })) }
  app.get('/api/debts', need('view_finances'), wrap(async (req, res) => res.json(await debtRows(req))))
  app.get('/api/debts/pdf', need('view_finances'), wrap(async (req, res) => {
    const rows = await debtRows(req), cl = await clinic(req.user.clinic_id) || {}, tot = {}; for (const r of rows) tot[r.currency] = Math.round(((tot[r.currency] || 0) + r.balance) * 100) / 100
    const per = [req.query.from && 'du ' + req.query.from.split('-').reverse().join('/'), req.query.to && 'au ' + req.query.to.split('-').reverse().join('/')].filter(Boolean).join(' ') || 'toutes périodes'
    await audit(req, 'DEBTS_EXPORTED', 'invoices', null, { count: rows.length, format: 'pdf' })
    makePdf(res, 'dettes-patients-' + new Date().toLocaleDateString('en-CA', { timeZone: 'America/Port-au-Prince' }), doc => {
      pdfHeader(doc, cl, 'Dettes patients', `${rows.length} facture(s) impayée(s) · ${per} · édité le ${pdfFd(new Date())}`)
      pdfTable(doc, [{ h: 'Patient', w: 17 }, { h: 'Téléphone', w: 11 }, { h: 'Facture', w: 12 }, { h: 'Date', w: 8 }, { h: 'Âge', w: 5, a: 'right' }, { h: 'Médecin', w: 13 }, { h: 'Total', w: 11, a: 'right' }, { h: 'Remise', w: 9, a: 'right' }, { h: 'Payé', w: 11, a: 'right' }, { h: 'Solde', w: 11, a: 'right' }],
        rows.map(r => [r.patient + ' (' + r.file_number + ')', r.phone || '', r.number, pdfFd(r.created_at), r.age_days + ' j', r.doctor || '', pdfNum(r.total, r.currency), r.discount ? pdfNum(r.discount, r.currency) : '', pdfNum(r.paid, r.currency), pdfNum(r.balance, r.currency)]),
        { totals: Object.keys(tot).length ? ['TOTAL DÛ', '', '', '', '', '', '', '', '', Object.entries(tot).map(([c, v]) => pdfNum(v, c)).join('\n')] : null })
    }, { footer: `${cl.name || 'DENTAL'}  ·  Dettes patients  ·  confidentiel`, landscape: true }) }))

  // ── Personnel & paie ──
  app.get('/api/employees', need('view_salaries'), wrap(async (req, res) => res.json((await q("select e.id,e.matricule,e.first_name,e.last_name,e.job_title,e.pay_mode,e.base_salary::text,coalesce(e.commission_pct,0)::text commission_pct,e.status,e.user_id,u.role,(select coalesce(json_agg(json_build_object('id',d.id,'label',d.label,'kind',d.kind,'value',d.value::float8) order by d.created_at),'[]'::json) from employee_deductions d where d.employee_id=e.id and d.active) deductions from employees e left join users u on u.id=e.user_id where e.clinic_id=$1 order by e.last_name", [req.user.clinic_id])).rows)))
  // comptes sans fiche de rémunération (hors propriétaire)
  app.get('/api/staff/unpaid', need('view_salaries'), wrap(async (req, res) => res.json((await q("select u.id,u.first_name,u.last_name,u.role,u.job_title from users u where u.clinic_id=$1 and u.status='active' and u.role<>'OWNER' and not exists(select 1 from employees e where e.user_id=u.id and e.status='active' and (e.base_salary>0 or coalesce(e.commission_pct,0)>0)) order by u.last_name", [req.user.clinic_id])).rows)))
  // définir / modifier la rémunération d'un employé ou d'un compte (crée la fiche employé si besoin)
  app.post('/api/staff/pay', need('manage_payroll', 'manage_users'), wrap(async (req, res) => {
    const b = req.body, pp = payPlan(b); if (pp.err) return fail(res, 400, pp.err)
    let e = /^[0-9a-f-]{36}$/.test(b.employee_id || '') ? (await q('select id,user_id from employees where id=$1 and clinic_id=$2', [b.employee_id, req.user.clinic_id])).rows[0] : null
    if (!e && /^[0-9a-f-]{36}$/.test(b.user_id || '')) { const u = (await q("select id,first_name,last_name,job_title,role from users where id=$1 and clinic_id=$2 and role<>'OWNER'", [b.user_id, req.user.clinic_id])).rows[0]; if (!u) return fail(res, 404, 'Compte introuvable')
      e = (await q('select id,user_id from employees where user_id=$1', [u.id])).rows[0] || (await q("insert into employees(clinic_id,user_id,first_name,last_name,job_title,base_salary,commission_pct) values($1,$2,$3,$4,$5,0,0) returning id,user_id", [req.user.clinic_id, u.id, u.first_name, u.last_name, u.job_title || (u.role === 'DENTIST' ? 'Médecin dentiste' : null)])).rows[0] }
    if (!e) return fail(res, 404, 'Employé introuvable')
    await q("update employees set base_salary=$2, commission_pct=$3, status='active' where id=$1", [e.id, pp.base, pp.pct]); await audit(req, 'EMPLOYEE_PAY', 'employees', e.id, { base: pp.base, pct: pp.pct }); res.json({ ok: true, id: e.id, ...pp }) }))
  app.post('/api/employees', need('manage_payroll'), wrap(async (req, res) => {
    const b = req.body, fn = clean(b.first_name), ln = clean(b.last_name); if (!fn || !ln) return fail(res, 400, 'Prénom et nom obligatoires'); const pp = payPlan(b); if (pp.err) return fail(res, 400, pp.err)
    const { rows: [e] } = await q('insert into employees(clinic_id,matricule,first_name,last_name,job_title,base_salary,commission_pct,hire_date) values($1,$2,$3,$4,$5,$6,$7,$8) returning id',
      [req.user.clinic_id, clean(b.matricule, 30), fn, ln, clean(b.job_title), pp.base, pp.pct, /^\d{4}-\d{2}-\d{2}$/.test(b.hire_date || '') ? b.hire_date : null])
    await audit(req, 'EMPLOYEE_CREATED', 'employees', e.id); res.json(e) }))
  app.get('/api/payroll', need('view_salaries'), wrap(async (req, res) => res.json((await q(
    "select r.id,r.period,e.id employee_id,e.first_name||' '||e.last_name employee,r.base::text,r.commissions::text,r.bonuses::text,r.deductions::text,r.other_deductions::text,r.deduction_details,r.advances::text,r.net::text,r.paid::text,r.status from payroll_records r join employees e on e.id=r.employee_id where r.clinic_id=$1 and r.period=$2 order by e.last_name",
    [req.user.clinic_id, /^\d{4}-\d{2}$/.test(req.query.period || '') ? req.query.period : new Date().toLocaleDateString('en-CA', { timeZone: 'America/Port-au-Prince' }).slice(0, 7)])).rows)))
  // recalcule une fiche : retenues de l'employé (pourcentage du brut ou montant fixe) + autres déductions, net = brut − retenues − avances
  const recompute = async (c, id) => { const r = (await c.query('select * from payroll_records where id=$1 for update', [id])).rows[0]; if (!r) return null
    const gross = c100(r.base) + c100(r.commissions) + c100(r.bonuses), ded = (await c.query('select id,label,kind,value from employee_deductions where employee_id=$1 and active order by created_at', [r.employee_id])).rows
    const details = ded.map(d => ({ label: d.label, kind: d.kind, value: Number(d.value), amount: (d.kind === 'pct' ? Math.round(gross * Number(d.value) / 100) : c100(d.value)) / 100 }))
    const tot = details.reduce((s, d) => s + c100(d.amount), 0) + c100(r.other_deductions), net = gross - tot - c100(r.advances)
    if (net < 0) return { err: 'Les retenues dépassent le salaire brut' }; if (net < c100(r.paid)) return { err: 'Le net deviendrait inférieur au montant déjà versé' }
    await c.query('update payroll_records set deduction_details=$2, deductions=$3, net=$4 where id=$1', [id, JSON.stringify(details), tot / 100, net / 100]); return { net: net / 100 } }
  const recomputeEmployee = async eid => { for (const r of (await q('select id from payroll_records where employee_id=$1 and paid=0', [eid])).rows) await tx(c => recompute(c, r.id)) }
  app.get('/api/employees/:id/deductions', need('view_salaries'), wrap(async (req, res) => res.json((await q('select d.id,d.label,d.kind,d.value::float8 value,d.created_at from employee_deductions d join employees e on e.id=d.employee_id where d.employee_id=$1 and e.clinic_id=$2 and d.active order by d.created_at', [req.params.id, req.user.clinic_id])).rows)))
  app.post('/api/employees/:id/deductions', need('manage_payroll'), wrap(async (req, res) => {
    const e = (await q('select id from employees where id=$1 and clinic_id=$2', [req.params.id, req.user.clinic_id])).rows[0]; if (!e) return fail(res, 404, 'Employé introuvable')
    const label = clean(req.body.label, 80), kind = req.body.kind === 'pct' ? 'pct' : 'fixed', v = String(req.body.value ?? '').replace(',', '.').replace(/\s/g, '')
    if (!label || !NUM.test(v) || Number(v) <= 0 || (kind === 'pct' && Number(v) > 100)) return fail(res, 400, 'Libellé et montant (ou pourcentage 0–100) obligatoires')
    const d = (await q('insert into employee_deductions(clinic_id,employee_id,label,kind,value,created_by) values($1,$2,$3,$4,$5,$6) returning id', [req.user.clinic_id, e.id, label, kind, v, req.user.id])).rows[0]
    await recomputeEmployee(e.id); await audit(req, 'DEDUCTION_ADDED', 'employee_deductions', d.id, { employee: e.id, label, kind, value: v }); res.json(d) }))
  app.post('/api/deductions/:id/remove', need('manage_payroll'), wrap(async (req, res) => {
    const d = (await q('update employee_deductions set active=false where id=$1 and clinic_id=$2 returning employee_id,label', [req.params.id, req.user.clinic_id])).rows[0]; if (!d) return fail(res, 404, 'Introuvable')
    await recomputeEmployee(d.employee_id); await audit(req, 'DEDUCTION_REMOVED', 'employee_deductions', req.params.id, { label: d.label }); res.json({ ok: true }) }))
  app.post('/api/payroll/generate', need('manage_payroll'), wrap(async (req, res) => {
    const p = req.body.period; if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(p || '')) return fail(res, 400, 'Période invalide (AAAA-MM)')
    const r = await q("insert into payroll_records(clinic_id,employee_id,period,base,net) select clinic_id,id,$2,base_salary,base_salary from employees where clinic_id=$1 and status='active' on conflict(employee_id,period) do nothing", [req.user.clinic_id, p])
    // commissions des médecins : taux de l'employé × encaissé sur ses actes du mois (fiches non encore payées)
    const cm = await q(`with base as (select e.id eid, e.user_id uid, coalesce(e.commission_pct,0) pct,
        case when (select commission_basis from clinics where id=$1)='billed'
          then (select coalesce(sum(i.total * case when i.currency='USD' then coalesce(i.rate_htg_per_usd,0) else 1 end),0) from invoices i where i.doctor_id=e.user_id and i.status<>'cancelled' and i.kind='invoice' and i.created_at>=$2::date and i.created_at<($2::date+interval '1 month'))
          else (select coalesce(sum(y.amount_htg),0) from payments y join invoices i on i.id=y.invoice_id where i.doctor_id=e.user_id and y.voided_at is null and y.created_at>=$2::date and y.created_at<($2::date+interval '1 month')) end amt
        from employees e where e.clinic_id=$1 and e.user_id is not null),
      due as (select eid, greatest(0, round(amt * pct / 100, 2) - coalesce((select sum(cp.amount) from commission_payments cp where cp.doctor_id=base.uid and cp.period=$3 and cp.clinic_id=$1),0)) c from base)
      update payroll_records r set commissions=due.c, net=r.base + due.c + r.bonuses - r.deductions - r.advances from due
      where r.employee_id=due.eid and r.period=$3 and r.clinic_id=$1 and r.paid=0`, [req.user.clinic_id, p + '-01', p])
    for (const x of (await q('select id from payroll_records where clinic_id=$1 and period=$2 and paid=0', [req.user.clinic_id, p])).rows) await tx(c => recompute(c, x.id))
    await audit(req, 'PAYROLL_GENERATED', 'payroll_records', null, { period: p, created: r.rowCount, commissions: cm.rowCount }); res.json({ created: r.rowCount, commissions: cm.rowCount }) }))
  app.post('/api/payroll/:id/adjust', need('manage_payroll'), wrap(async (req, res) => {
    const f = ['commissions', 'bonuses', 'deductions', 'advances'], v = {}; for (const k of f) { const x = String(req.body[k] ?? '0'); if (!NUM.test(x)) return fail(res, 400, k + ' invalide'); v[k] = c100(x) }
    const out = await tx(async c => {
      const r = (await c.query('select * from payroll_records where id=$1 and clinic_id=$2 for update', [req.params.id, req.user.clinic_id])).rows[0]; if (!r) return E(404, 'Introuvable')
      await c.query('update payroll_records set commissions=$2,bonuses=$3,other_deductions=$4,advances=$5 where id=$1', [r.id, v.commissions / 100, v.bonuses / 100, v.deductions / 100, v.advances / 100])
      const k = await recompute(c, r.id); if (k?.err) throw Object.assign(new Error(k.err), { status: 409 }); return {} }).catch(e => e.status ? E(e.status, e.message) : Promise.reject(e))
    if (out.err) return fail(res, ...out.err); await audit(req, 'PAYROLL_ADJUSTED', 'payroll_records', req.params.id); res.json({ ok: true }) }))
  app.post('/api/payroll/:id/pay', need('manage_payroll'), wrap(async (req, res) => {
    const a = String(req.body.amount ?? ''); if (!NUM.test(a) || Number(a) <= 0 || !clean(req.body.method, 30)) return fail(res, 400, 'Paiement invalide')
    const out = await tx(async c => {
      const r = (await c.query('select * from payroll_records where id=$1 and clinic_id=$2 for update', [req.params.id, req.user.clinic_id])).rows[0]; if (!r) return E(404, 'Introuvable')
      const paid = c100(r.paid) + c100(a); if (paid > c100(r.net)) return E(409, 'Dépasse le net à payer')
      const pp = (await c.query('insert into payroll_payments(payroll_id,amount,method,created_by) values($1,$2,$3,$4) returning id', [r.id, a, clean(req.body.method, 30), req.user.id])).rows[0]
      await c.query("insert into expenses(clinic_id,category,description,amount,currency,amount_htg,status,paid_at,source_type,source_id,created_by) values($1,'Salaires',$2,$3,'HTG',$3,'paid',now(),'payroll_payment',$4,$5)", [req.user.clinic_id, 'Salaire ' + r.period, a, pp.id, req.user.id])
      await c.query("select cash_post($1,'HTG','out',$2,$3,$4,'payroll',$5,$6)", [req.user.clinic_id, a, 'SAL-' + pp.id.slice(0, 8), 'Salaire ' + r.period, pp.id, req.user.id])
      await c.query("update payroll_records set paid=$2, status=case when $2>=net then 'paid' else 'partial' end where id=$1", [r.id, paid / 100]); return {} })
    if (out.err) return fail(res, ...out.err); await audit(req, 'SALARY_PAID', 'payroll_records', req.params.id, { amount: a }); res.json({ ok: true }) }))
  app.get('/api/payroll/:id/payslip', need(), wrap(async (req, res) => {   // la direction / comptabilité : toutes les fiches ; chaque employé : uniquement les siennes
    const r = (await q('select * from payroll_records where id=$1 and clinic_id=$2', [req.params.id, req.user.clinic_id])).rows[0]; if (!r) return fail(res, 404, 'Introuvable')
    if (!req.perms.has('view_salaries') && !(await q('select 1 from employees where id=$1 and user_id=$2', [r.employee_id, req.user.id])).rowCount) return fail(res, 403, 'Fiche de paie d\'un autre employé')
    const emp = (await q('select * from employees where id=$1', [r.employee_id])).rows[0], pays = (await q('select * from payroll_payments where payroll_id=$1 order by paid_at', [r.id])).rows
    const cl = await clinic(req.user.clinic_id)
    pipe(res, `paie-${emp.last_name}-${r.period}`, d => payslipPdf(d, { clinic: cl, emp, r: Object.fromEntries(Object.entries(r).map(([k, v]) => [k, ['base', 'commissions', 'bonuses', 'deductions', 'other_deductions', 'advances', 'net', 'paid'].includes(k) ? Number(v) : v])), pays })) }))
}
