import { isAssigned } from '../core/permissions.js'
import { advice } from '../lib/clinical-advice.js'
import { billService, validAmounts, actingDoctor, payProblem, syncTeeth } from '../lib/billing-core.js'
import { sealJson, openJson } from '../lib/protect.js'
const HK = ['blood_pressure','diabetes','hemophilia','hiv','smoking','alcohol','pregnancy','blood_group','allergies','medications','cardiovascular','pulmonary','epilepsy','stomach','cancer','migraines','other','observations','brushing','motif','scaling_grade','bridge_from','bridge_to','remark']
const STATES = ['saine','carie','extraite','absente','a_extraire','restauree','couronne','implant','bridge','anomalie']
const FDI = n => Number.isInteger(n) && ((n >= 11 && n <= 48 && n % 10 >= 1 && n % 10 <= 8 && Math.floor(n / 10) <= 4) || (n >= 51 && n <= 85 && n % 10 >= 1 && n % 10 <= 5))
export default function (app, { pool, q, need, audit, fail, wrap, clean }) {
  const access = async (req, id) => {
    const p = /^[0-9a-f-]{36}$/.test(id) ? (await q('select * from patients where id=$1 and clinic_id=$2', [id, req.user.clinic_id])).rows[0] : null
    if (!p) return null
    return req.perms.has('view_all_patients') || (req.perms.has('view_assigned_patients') && await isAssigned(q, p.id, req.user.id)) ? p : null }
  app.get('/api/doctors', need('view_medical_records', 'view_all_patients', 'view_finances', 'manage_appointments', 'manage_queue', 'manage_payroll'), wrap(async (req, res) => res.json((await q(
    "select id,first_name||' '||last_name name from users where clinic_id=$1 and status='active' and role in ('DENTIST','OWNER','ADMIN_MEDICAL') order by last_name", [req.user.clinic_id])).rows)))
  app.get('/api/patients/:id/record', need('view_medical_records'), wrap(async (req, res) => {
    const p = await access(req, req.params.id); if (!p) return fail(res, 404, 'Dossier introuvable ou accès refusé')
    await audit(req, 'RECORD_VIEWED', 'patients', p.id)
    const [h, c, t, th, d, ex, up] = await Promise.all([
      q('select data,updated_at from medical_histories where patient_id=$1', [p.id]),
      q(`select c.*,u.first_name||' '||u.last_name doctor,pu.first_name||' '||pu.last_name primary_doctor,i.id invoice_id,i.number invoice_number,i.subtotal::float8 inv_amount,i.discount::float8 inv_discount,i.total::float8 inv_total,i.status inv_status,
        (select coalesce(sum(y.applied_amount),0) from payments y where y.invoice_id=i.id and y.voided_at is null)::float8 inv_paid,
        (select string_agg(distinct y.method, ', ') from payments y where y.invoice_id=i.id and y.voided_at is null) inv_methods
        from consultations c join users u on u.id=c.doctor_id left join users pu on pu.id=c.primary_doctor_id left join lateral (select * from invoices x where x.consultation_id=c.id and x.status<>'cancelled' order by x.created_at desc limit 1) i on true where c.patient_id=$1 order by consulted_at desc`, [p.id]),
      q('select distinct on (tooth_fdi) tooth_fdi,state from tooth_states where patient_id=$1 order by tooth_fdi, recorded_at desc', [p.id]),
      q("select s.tooth_fdi,s.state,s.note,s.recorded_at,u.first_name||' '||u.last_name doctor from tooth_states s join users u on u.id=s.doctor_id where patient_id=$1 order by recorded_at desc limit 200", [p.id]),
      q("select h.started_at,h.ended_at,u.first_name||' '||u.last_name doctor from patient_doctor_history h join users u on u.id=h.doctor_id where patient_id=$1 order by started_at desc", [p.id]),
      q('select examined_at from dental_examinations where patient_id=$1 order by examined_at desc limit 1', [p.id]),
      q("select count(*)::int n from appointments where patient_id=$1 and starts_at>now() and status in ('planned','confirmed')", [p.id])])
    const timeline = [...c.rows.map(x => ({ at: x.consulted_at, text: `Consultation : ${x.reason || ''} ${x.diagnosis ? '— ' + x.diagnosis : ''}`, doctor: x.doctor })),
      ...th.rows.map(x => ({ at: x.recorded_at, text: `Dent ${x.tooth_fdi} : ${x.state}`, doctor: x.doctor }))].sort((a, b) => new Date(b.at) - new Date(a.at))
    res.json({ patient: p, history: openJson(h.rows[0]?.data) ?? {}, history_at: h.rows[0]?.updated_at, consultations: c.rows, teeth: t.rows, tooth_log: th.rows, doctors: d.rows, timeline,
      advice: advice({ h: openJson(h.rows[0]?.data) ?? {}, teeth: t.rows, consults: c.rows, upcoming: up.rows[0].n, exam: ex.rows[0] }) }) }))
  app.post('/api/patients/:id/history', need('edit_medical_records'), wrap(async (req, res) => {
    const p = await access(req, req.params.id); if (!p) return fail(res, 404, 'Accès refusé')
    const data = {}; for (const k of HK) if (k in req.body) data[k] = typeof req.body[k] === 'boolean' ? req.body[k] : clean(req.body[k], 500)
    await q('insert into medical_histories(patient_id,clinic_id,data,updated_by) values($1,$2,$3,$4) on conflict(patient_id) do update set data=$3, updated_by=$4, updated_at=now()', [p.id, req.user.clinic_id, sealJson(data), req.user.id])   // chiffré
    await audit(req, 'MEDICAL_HISTORY_UPDATED', 'medical_histories', p.id); res.json({ ok: true }) }))
  app.post('/api/patients/:id/consultations', need('edit_medical_records'), wrap(async (req, res) => {
    const p = await access(req, req.params.id); if (!p) return fail(res, 404, 'Accès refusé'); const b = req.body
    const doc = actingDoctor(req, b.doctor_id); if (!(await q("select 1 from users where id=$1 and clinic_id=$2 and status='active'", [doc, req.user.clinic_id])).rowCount) return fail(res, 400, 'Médecin invalide')
    const teeth = String(b.teeth ?? '').split(/[ ,;]+/).filter(Boolean).map(Number); if (!teeth.every(FDI)) return fail(res, 400, 'Numéros de dents FDI invalides')
    if (b.cost && !/^\d{1,10}(\.\d{1,2})?$/.test(String(b.cost))) return fail(res, 400, 'Coût invalide')
    const bad = validAmounts({ amount: b.cost || 0, discount: b.discount || 0, paid: b.paid || 0 }) || payProblem(b); if (bad) return fail(res, 400, bad)
    // L'acte est enregistré et comptabilisé ensemble : facture au nom du médecin qui a réalisé l'acte, remise et paiement éventuels
    const cx = await pool.connect(); let c, bill = null
    try { await cx.query('begin')
      c = (await cx.query('insert into consultations(clinic_id,patient_id,doctor_id,primary_doctor_id,reason,diagnosis,treatment,teeth,cost,notes,created_by) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) returning id',
        [req.user.clinic_id, p.id, doc, p.primary_doctor_id, clean(b.reason), clean(b.diagnosis, 1000), clean(b.treatment, 1000), teeth, b.cost || null, clean(b.notes, 2000), req.user.id])).rows[0]
      if (Number(b.cost) > 0 ) bill = await billService(cx, { clinicId: req.user.clinic_id, patientId: p.id, doctorId: doc, userId: req.user.id, description: [clean(b.reason), teeth.length ? 'dents ' + teeth.join(', ') : ''].filter(Boolean).join(' · '), amount: b.cost, discount: b.discount, paid: b.paid, method: clean(b.method, 30), reference: clean(b.reference, 80), consultationId: c.id })
      c.teeth_updated = await syncTeeth(cx, { clinicId: req.user.clinic_id, patientId: p.id, teeth, label: [b.reason, b.treatment].filter(Boolean).join(' '), doctorId: doc })
      await cx.query('commit') } catch (e) { await cx.query('rollback'); throw e } finally { cx.release() }
    await audit(req, 'CONSULTATION_CREATED', 'consultations', c.id, { patient_id: p.id, invoice: bill?.number }); res.json({ ...c, bill }) }))
  app.post('/api/patients/:id/teeth', need('edit_medical_records'), wrap(async (req, res) => {
    const p = await access(req, req.params.id); if (!p) return fail(res, 404, 'Accès refusé'); const n = Number(req.body.tooth_fdi)
    if (!FDI(n) || !STATES.includes(req.body.state)) return fail(res, 400, 'Dent ou état invalide')
    const { rows: [t] } = await q('insert into tooth_states(clinic_id,patient_id,tooth_fdi,state,note,doctor_id) values($1,$2,$3,$4,$5,$6) returning id', [req.user.clinic_id, p.id, n, req.body.state, clean(req.body.note, 300), req.user.id])
    await audit(req, 'TOOTH_STATE', 'tooth_states', t.id, { patient_id: p.id, tooth: n, state: req.body.state }); res.json({ ok: true }) }))
  app.post('/api/patients/:id/primary-doctor', need('edit_patients'), wrap(async (req, res) => {
    const p = await access(req, req.params.id); if (!p) return fail(res, 404, 'Accès refusé')
    if (!(await q("select 1 from users where id=$1 and clinic_id=$2 and status='active'", [req.body.doctor_id, req.user.clinic_id])).rowCount) return fail(res, 400, 'Médecin invalide')
    const c = await pool.connect()
    try { await c.query('begin'); await c.query('update patient_doctor_history set ended_at=now() where patient_id=$1 and ended_at is null', [p.id])
      await c.query('insert into patient_doctor_history(patient_id,doctor_id,changed_by) values($1,$2,$3)', [p.id, req.body.doctor_id, req.user.id])
      await c.query('update patients set primary_doctor_id=$2 where id=$1', [p.id, req.body.doctor_id]); await c.query('commit') } catch (e) { await c.query('rollback'); throw e } finally { c.release() }
    await audit(req, 'PRIMARY_DOCTOR_CHANGED', 'patients', p.id); res.json({ ok: true }) }))
}
