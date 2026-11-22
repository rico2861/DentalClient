import { isAssigned } from '../core/permissions.js'
// Dossier patient : résumé complet, modification, désactivation / réactivation (jamais de suppression), PDF adaptés.
import { makePdf, patientPdf, consultationPdf, diagnosticPdf } from '../lib/dossier-pdf.js'
import { advice } from '../lib/clinical-advice.js'
import { openJson, openExam } from '../lib/protect.js'
const UUID = /^[0-9a-f-]{36}$/, FIELDS = ['last_name', 'first_name', 'phone', 'phone2', 'address', 'department', 'zone', 'profession', 'emergency_contact', 'emergency_phone', 'marital_status', 'email', 'id_number', 'birth_place', 'insurance', 'insurance_number', 'referred_by', 'notes']
export default function (app, { q, need, audit, fail, wrap, clean }) {
  const isAdmin = u => u.role === 'OWNER' || String(u.role).startsWith('ADMIN')
  const access = async (req, id) => { const p = UUID.test(id) ? (await q('select * from patients where id=$1 and clinic_id=$2', [id, req.user.clinic_id])).rows[0] : null
    return p && (req.perms.has('view_all_patients') || (req.perms.has('view_assigned_patients') && await isAssigned(q, p.id, req.user.id))) ? p : null }
  const name = async id => id ? (await q("select first_name||' '||last_name n from users where id=$1", [id])).rows[0]?.n ?? null : null
  const money = x => Math.round(x * 100) / 100
  const financeOf = async p => { const { rows } = await q(`select i.id,i.number,i.currency,i.total::float8 total,i.created_at,coalesce((select sum(y.applied_amount) from payments y where y.invoice_id=i.id and y.voided_at is null),0)::float8 paid from invoices i where i.patient_id=$1 and i.kind='invoice' and i.status='issued' order by i.created_at desc`, [p.id])
    const by = {}; for (const r of rows) { const c = by[r.currency] ??= { currency: r.currency, total: 0, paid: 0 }; c.total += r.total; c.paid += r.paid }
    const totals = Object.values(by).map(c => ({ ...c, total: money(c.total), paid: money(c.paid), balance: money(c.total - c.paid) }))
    return { status: !rows.length ? 'none' : totals.every(c => c.balance <= 0) ? 'paid' : totals.some(c => c.paid > 0) ? 'partial' : 'unpaid', totals, invoices: rows.map(r => ({ ...r, balance: money(r.total - r.paid) })) } }
  app.get('/api/patients/:id/summary', need('view_medical_records'), wrap(async (req, res) => {
    const p = await access(req, req.params.id); if (!p) return fail(res, 404, 'Dossier introuvable ou accès refusé')
    const [ap, pl, fin] = await Promise.all([
      q("select a.id,a.starts_at,a.duration_min,a.reason,a.chair,a.status,u.first_name||' '||u.last_name doctor from appointments a join users u on u.id=a.doctor_id where a.patient_id=$1 order by a.starts_at desc limit 100", [p.id]),
      q(`select pl.id,pl.diagnosis,pl.status,pl.start_date,pl.end_date,coalesce(json_agg(json_build_object('description',i.description,'tooth',i.tooth,'teeth',i.teeth,'price',i.price,'status',i.status,'done_at',i.done_at,'sessions_planned',i.sessions_planned,'sessions_done',i.sessions_done,'doctor',(select u.first_name||' '||u.last_name from users u where u.id=i.doctor_id)) order by i.id) filter (where i.id is not null),'[]'::json) items from treatment_plans pl left join treatment_plan_items i on i.plan_id=pl.id where pl.patient_id=$1 group by pl.id order by pl.created_at desc`, [p.id]),
      req.perms.has('view_finances') ? financeOf(p) : null])
    res.json({ patient: { ...p, primary_doctor: await name(p.primary_doctor_id), deleted_by_name: await name(p.deleted_by) }, appointments: ap.rows, plans: pl.rows, finance: fin }) }))
  app.post('/api/patients/:id/update', need('edit_patients'), wrap(async (req, res) => {
    const p = await access(req, req.params.id); if (!p) return fail(res, 404, 'Accès refusé'); const b = req.body, sets = [], args = [p.id], add = (k, v) => { args.push(v); sets.push(`${k}=$${args.length}`) }
    for (const k of FIELDS) if (k in b) { const v = clean(b[k], 200); if ((k === 'last_name' || k === 'first_name') && !v) return fail(res, 400, 'Nom et prénom requis'); add(k, v || null) }
    if ('birth_date' in b) add('birth_date', /^\d{4}-\d{2}-\d{2}$/.test(b.birth_date || '') ? b.birth_date : null)
    if ('sex' in b) add('sex', ['M', 'F'].includes(b.sex) ? b.sex : null)
    if ('children_count' in b) add('children_count', b.children_count === '' || b.children_count == null ? null : Math.min(30, Math.max(0, parseInt(b.children_count) || 0)))
    if ('discount_percent' in b) add('discount_percent', b.discount_percent === '' || b.discount_percent == null ? 0 : Math.min(100, Math.max(0, Math.round((parseFloat(String(b.discount_percent).replace(',', '.')) || 0) * 100) / 100)))
    if (!sets.length) return fail(res, 400, 'Rien à modifier')
    await q(`update patients set ${sets.join(',')} where id=$1`, args); await audit(req, 'PATIENT_UPDATED', 'patients', p.id); res.json({ ok: true }) }))
  app.post('/api/patients/:id/archive', need('edit_patients'), wrap(async (req, res) => {
    if (!isAdmin(req.user)) return fail(res, 403, 'Réservé aux administrateurs'); const p = await access(req, req.params.id); if (!p) return fail(res, 404, 'Accès refusé')
    const reason = clean(req.body.reason, 300); if (!reason) return fail(res, 400, 'Motif obligatoire')
    await q("update patients set status='archived', deleted_at=now(), deleted_by=$2, delete_reason=$3 where id=$1", [p.id, req.user.id, reason]); await audit(req, 'PATIENT_ARCHIVED', 'patients', p.id, { reason }); res.json({ ok: true }) }))
  app.post('/api/patients/:id/restore', need('edit_patients'), wrap(async (req, res) => {
    if (!isAdmin(req.user)) return fail(res, 403, 'Réservé aux administrateurs'); const p = await access(req, req.params.id); if (!p) return fail(res, 404, 'Accès refusé')
    await q("update patients set status='active', deleted_at=null, deleted_by=null, delete_reason=null where id=$1", [p.id]); await audit(req, 'PATIENT_RESTORED', 'patients', p.id); res.json({ ok: true }) }))
  const clinic = async req => (await q('select name,address,phone from clinics where id=$1', [req.user.clinic_id])).rows[0] || {}
  // fiche diagnostique (même présentation que la fiche papier) : remplie pour un patient, ou vierge à imprimer
  app.get('/api/fiche-diagnostique-vierge', need('view_medical_records', 'create_patients'), wrap(async (req, res) => {
    const cl = await clinic(req); makePdf(res, 'fiche-diagnostique-vierge', doc => diagnosticPdf(doc, { clinic: cl }), { footer: (cl.name || 'DENTAL') + '  ·  Fiche diagnostique' }) }))
  app.get('/api/patients/:id/diagnostic', need('view_medical_records'), wrap(async (req, res) => {
    const p = await access(req, req.params.id); if (!p) return fail(res, 404, 'Dossier introuvable ou accès refusé')
    const [cl, h, ex, th, doctor] = await Promise.all([clinic(req), q('select data from medical_histories where patient_id=$1', [p.id]), q('select * from dental_examinations where patient_id=$1 order by examined_at desc limit 1', [p.id]),
      q('select distinct on (tooth_fdi) tooth_fdi,state from tooth_states where patient_id=$1 order by tooth_fdi, recorded_at desc', [p.id]), name(p.primary_doctor_id)])
    await audit(req, 'PATIENT_PDF', 'patients', p.id, { kind: 'fiche diagnostique' })
    makePdf(res, 'fiche-diagnostique-' + p.file_number, doc => diagnosticPdf(doc, { clinic: cl, p, h: openJson(h.rows[0]?.data) ?? {}, exam: openExam(ex.rows[0]), teeth: new Map(th.rows.map(t => [t.tooth_fdi, t.state])), doctor }),
      { footer: (cl.name || 'DENTAL') + '  ·  Fiche diagnostique  ·  Dossier ' + p.file_number + '  ·  Document médical confidentiel' }) }))
  app.get('/api/patients/:id/pdf', need('view_medical_records'), wrap(async (req, res) => {
    const p = await access(req, req.params.id); if (!p) return fail(res, 404, 'Dossier introuvable ou accès refusé')
    const [cl, h, ex, th, co, ap, fin, doctor] = await Promise.all([clinic(req), q('select data from medical_histories where patient_id=$1', [p.id]),
      q('select * from dental_examinations where patient_id=$1 order by examined_at desc limit 1', [p.id]), q('select distinct on (tooth_fdi) tooth_fdi,state from tooth_states where patient_id=$1 order by tooth_fdi, recorded_at desc', [p.id]),
      q("select c.*,u.first_name||' '||u.last_name doctor from consultations c join users u on u.id=c.doctor_id where c.patient_id=$1 order by consulted_at desc limit 40", [p.id]),
      q("select a.starts_at,a.reason,a.status,u.first_name||' '||u.last_name doctor from appointments a join users u on u.id=a.doctor_id where a.patient_id=$1 order by a.starts_at desc limit 60", [p.id]),
      req.perms.has('view_finances') ? financeOf(p) : null, name(p.primary_doctor_id)])
    await audit(req, 'PATIENT_PDF', 'patients', p.id)
    const hd = openJson(h.rows[0]?.data) ?? {}, upcoming = ap.rows.filter(a => new Date(a.starts_at) > new Date() && ['planned', 'confirmed'].includes(a.status)).length
    const adv = advice({ h: hd, teeth: th.rows, consults: co.rows, upcoming, exam: openExam(ex.rows[0]) })
    makePdf(res, `dossier-${p.file_number}`, doc => patientPdf(doc, { clinic: cl, p, doctor, h: hd, exam: openExam(ex.rows[0]), teeth: new Map(th.rows.map(t => [t.tooth_fdi, t.state])), consults: co.rows, appts: ap.rows, finance: fin, advice: adv }), { footer: `${cl.name || 'DENTAL'}  ·  Dossier ${p.file_number}  ·  confidentiel` }) }))
  app.get('/api/consultations/:id/pdf', need('view_medical_records'), wrap(async (req, res) => {
    if (!UUID.test(req.params.id)) return fail(res, 404, 'Introuvable')
    const c = (await q("select c.*,u.first_name||' '||u.last_name doctor,pu.first_name||' '||pu.last_name primary_doctor from consultations c join users u on u.id=c.doctor_id left join users pu on pu.id=c.primary_doctor_id where c.id=$1 and c.clinic_id=$2", [req.params.id, req.user.clinic_id])).rows[0]
    const p = c && await access(req, c.patient_id); if (!p) return fail(res, 404, 'Introuvable ou accès refusé')
    const [cl, h] = await Promise.all([clinic(req), q('select data from medical_histories where patient_id=$1', [p.id])]); await audit(req, 'CONSULTATION_PDF', 'consultations', c.id)
    makePdf(res, `consultation-${p.file_number}-${new Date(c.consulted_at).toISOString().slice(0, 10)}`, doc => consultationPdf(doc, { clinic: cl, p, c, allergies: openJson(h.rows[0]?.data)?.allergies }), { footer: `${cl.name || 'DENTAL'}  ·  Dossier ${p.file_number}  ·  confidentiel` }) }))
}
