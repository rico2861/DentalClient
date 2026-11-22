const AMT = /^\d{1,10}(\.\d{1,2})?$/, UUID = /^[0-9a-f-]{36}$/
const ORDER = ['prescription','impression','preparation','sent_lab','manufacturing','returned','fitting','adjustment','ready','placed']
const TYPES = ['Couronne','Implant','Bridge / Pont','Prothèse partielle amovible','Prothèse totale','Facette dentaire','Inlay','Onlay','Prothèse implanto-portée']
const PLAN_NEXT = { draft: ['pending', 'cancelled'], pending: ['approved', 'draft', 'cancelled'], approved: ['in_progress', 'suspended', 'cancelled'], in_progress: ['suspended', 'done', 'cancelled'], suspended: ['in_progress', 'cancelled'], done: [], cancelled: [] }
import { clinicCfg, doctorWindows, localWeekday, localMin, fmtHm } from '../lib/intel.js'
import { billService, validAmounts, COMMISSION_SQL, withCommission, actingDoctor, lockedDoctor, payProblem, syncTeeth, payPlan } from '../lib/billing-core.js'
const FDI = n => Number.isInteger(n) && n >= 11 && n <= 48 && n % 10 >= 1 && n % 10 <= 8 && Math.floor(n / 10) <= 4
export default function (app, { pool, q, need, audit, fail, wrap, clean }) {
  const tx = async fn => { const c = await pool.connect(); try { await c.query('begin'); const r = await fn(c); await c.query('commit'); return r } catch (e) { await c.query('rollback'); throw e } finally { c.release() } }
  const E = (s, m) => ({ err: [s, m] }), done = (res, o, f) => o.err ? fail(res, ...o.err) : res.json(f ? f(o) : o)
  const patient = async (cid, file) => (await q('select id,primary_doctor_id from patients where clinic_id=$1 and file_number=$2', [cid, clean(file, 30)])).rows[0]
  const teethOf = s => String(s ?? '').split(/[ ,;]+/).filter(Boolean).map(Number)
  const A = ['manage_appointments']

  // ── Rendez-vous (aucune double réservation médecin / fauteuil) ──
  const overlap = (c, cid, doc, chair, start, dur, skip) => c.query(
    `select 1 from appointments where clinic_id=$1 and status in ('planned','confirmed') and id<>coalesce($6::uuid,'00000000-0000-0000-0000-000000000000'::uuid) and starts_at < ($4::timestamptz + $5*interval '1 minute')
     and starts_at + duration_min*interval '1 minute' > $4::timestamptz and (doctor_id=$2 or ($3::text is not null and chair=$3::text)) limit 1`, [cid, doc, chair, start, dur, skip ?? null])
  app.get('/api/appointments', need(...A), wrap(async (req, res) => {
    const d = s => /^\d{4}-\d{2}-\d{2}$/.test(s || '') ? s : null, from = d(req.query.from) || new Date().toLocaleDateString('en-CA', { timeZone: 'America/Port-au-Prince' }), to = d(req.query.to) || from
    res.json((await q(`select a.id,a.starts_at,a.duration_min,a.reason,a.chair,a.status,a.doctor_id,a.arrived_at,a.seated_at,a.finished_at,p.id patient_id,p.file_number,p.last_name||' '||p.first_name patient,u.first_name||' '||u.last_name doctor
      from appointments a join patients p on p.id=a.patient_id join users u on u.id=a.doctor_id where a.clinic_id=$1 and a.starts_at >= ($2::date::timestamp at time zone 'America/Port-au-Prince') and a.starts_at < (($3::date+1)::timestamp at time zone 'America/Port-au-Prince') order by a.starts_at`, [req.user.clinic_id, from, to])).rows) }))
  app.post('/api/appointments', need(...A), wrap(async (req, res) => {
    const b = req.body; if (lockedDoctor(req)) b.doctor_id = req.user.id; const dur = parseInt(b.duration_min) || 30, t = Date.parse(b.starts_at); if (isNaN(t) || dur < 5 || dur > 480) return fail(res, 400, 'Date ou durée invalide')
    // heures de service du médecin : vérifiées AVANT la transaction (la base embarquée n'a qu'une connexion)
    { const cfg = await clinicCfg(req.user.clinic_id), st = new Date(t), wd = localWeekday(st), m0 = localMin(st), win = doctorWindows(cfg, b.doctor_id, wd)
      if (cfg.schedules[b.doctor_id] && !win.some(([a, z]) => m0 >= a && m0 + dur <= z)) { const DN = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi']; return fail(res, 409, `Ce médecin n'est pas en service le ${DN[wd]} à ${fmtHm(m0)}${win.length ? ` (en service : ${win.map(([a, z]) => fmtHm(a) + '–' + fmtHm(z)).join(', ')})` : ' (pas de service ce jour-là)'}. Choisissez un autre créneau ou un autre médecin.`) } }
    const out = await tx(async c => {
      await c.query('select pg_advisory_xact_lock(hashtext($1))', [req.user.clinic_id])
      const pat = (await c.query('select id from patients where clinic_id=$1 and file_number=$2', [req.user.clinic_id, clean(b.patient_file, 30)])).rows[0]; if (!pat) return E(404, 'Patient introuvable')
      if (!UUID.test(b.doctor_id || '') || !(await c.query("select 1 from users where id=$1 and clinic_id=$2 and status='active'", [b.doctor_id, req.user.clinic_id])).rowCount) return E(400, 'Médecin invalide')
      const chair = clean(b.chair, 30); if ((await overlap(c, req.user.clinic_id, b.doctor_id, chair, new Date(t).toISOString(), dur)).rowCount) return E(409, 'Conflit : médecin ou fauteuil déjà réservé sur ce créneau')
      return (await c.query('insert into appointments(clinic_id,patient_id,doctor_id,starts_at,duration_min,reason,chair,created_by) values($1,$2,$3,$4,$5,$6,$7,$8) returning id', [req.user.clinic_id, pat.id, b.doctor_id, new Date(t).toISOString(), dur, clean(b.reason), chair, req.user.id])).rows[0] })
    if (!out.err) await audit(req, 'APPOINTMENT_CREATED', 'appointments', out.id); done(res, out) }))
  app.post('/api/appointments/:id/status', need(...A), wrap(async (req, res) => {
    const s = req.body.status, out = await tx(async c => {
      const a = (await c.query('select * from appointments where id=$1 and clinic_id=$2 for update', [req.params.id, req.user.clinic_id])).rows[0]; if (!a) return E(404, 'Introuvable')
      const ok = { planned: ['confirmed', 'cancelled', 'no_show', 'done'], confirmed: ['cancelled', 'no_show', 'done'] }[a.status] || []; if (!ok.includes(s)) return E(409, 'Transition non autorisée')
      await c.query('update appointments set status=$2 where id=$1', [a.id, s])
      if (s === 'no_show') await c.query("insert into follow_up_reminders(clinic_id,patient_id,doctor_id,kind,reason,due_date,created_by) values($1,$2,$3,'rdv_manque','Rendez-vous non honoré',current_date,$4)", [a.clinic_id, a.patient_id, a.doctor_id, req.user.id])
      return {} })
    if (!out.err) await audit(req, 'APPOINTMENT_' + s.toUpperCase(), 'appointments', req.params.id); done(res, out, () => ({ ok: true })) }))
  app.post('/api/appointments/:id/flow', need(...A), wrap(async (req, res) => {
    const step = req.body.step; if (!['arrived', 'seated', 'finished', 'undo'].includes(step)) return fail(res, 400, 'Étape invalide')
    const out = await tx(async c => {
      const a = (await c.query('select * from appointments where id=$1 and clinic_id=$2 for update', [req.params.id, req.user.clinic_id])).rows[0]; if (!a) return E(404, 'Introuvable')
      if (lockedDoctor(req) && a.doctor_id !== req.user.id) return E(403, 'Rendez-vous d\'un autre médecin')
      if (['cancelled', 'no_show'].includes(a.status)) return E(409, 'Rendez-vous annulé ou absent')
      if (step === 'arrived') { if (a.arrived_at) return E(409, 'Arrivée déjà enregistrée'); await c.query("update appointments set arrived_at=now(), status=case when status='planned' then 'confirmed' else status end where id=$1", [a.id]) }
      if (step === 'seated') { if (a.seated_at) return E(409, 'Déjà au fauteuil'); await c.query('update appointments set arrived_at=coalesce(arrived_at,now()), seated_at=now() where id=$1', [a.id]) }
      if (step === 'finished') { if (a.finished_at) return E(409, 'Déjà terminé'); await c.query("update appointments set arrived_at=coalesce(arrived_at,now()), seated_at=coalesce(seated_at,now()), finished_at=now(), status='done' where id=$1", [a.id]) }
      if (step === 'undo') { if (a.finished_at) await c.query("update appointments set finished_at=null, status='confirmed' where id=$1", [a.id]); else if (a.seated_at) await c.query('update appointments set seated_at=null where id=$1', [a.id]); else await c.query('update appointments set arrived_at=null where id=$1', [a.id]) }
      // même file d'attente que la salle d'attente : arrivée = numéro du jour ; consultation / fin suivent le ticket
      const tk = (await c.query("select id from queue_tickets where appointment_id=$1 and status<>'cancelled'", [a.id])).rows[0]
      if (step === 'arrived' && !tk) { const day = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Port-au-Prince' }), n = (await c.query('select coalesce(max(number),0)+1 n from queue_tickets where clinic_id=$1 and day=$2', [a.clinic_id, day])).rows[0].n
        await c.query('insert into queue_tickets(clinic_id,day,number,patient_id,appointment_id,doctor_id,reason,created_by) values($1,$2,$3,$4,$5,$6,$7,$8) on conflict do nothing', [a.clinic_id, day, n, a.patient_id, a.id, a.doctor_id, a.reason, req.user.id]) }
      if (tk && step === 'seated') await c.query("update queue_tickets set status='in_consult', called_at=coalesce(called_at,now()), started_at=coalesce(started_at,now()) where id=$1 and status in ('waiting','called')", [tk.id])
      if (tk && step === 'finished') await c.query("update queue_tickets set status='done', started_at=coalesce(started_at,now()), finished_at=now() where id=$1 and status not in ('done','cancelled')", [tk.id])
      if (tk && step === 'undo') await c.query("update queue_tickets set status=case when status='done' then 'in_consult' when status='in_consult' then 'waiting' else 'cancelled' end, finished_at=case when status='done' then null else finished_at end, started_at=case when status='in_consult' then null else started_at end where id=$1", [tk.id])
      return (await c.query('select arrived_at,seated_at,finished_at,status from appointments where id=$1', [a.id])).rows[0] })
    if (!out.err) await audit(req, 'APPOINTMENT_FLOW', 'appointments', req.params.id, { step }); done(res, out) }))
  // salle d'attente du jour : qui attend, depuis combien de temps, qui est au fauteuil
  app.get('/api/waiting', need(...A), wrap(async (req, res) => {
    const mine = lockedDoctor(req), rows = (await q(`select a.id,a.starts_at,a.duration_min,a.reason,a.chair,a.status,a.arrived_at,a.seated_at,a.finished_at,p.id patient_id,p.last_name||' '||p.first_name patient,p.phone,u.first_name||' '||u.last_name doctor
      from appointments a join patients p on p.id=a.patient_id join users u on u.id=a.doctor_id where a.clinic_id=$1 and a.status not in ('cancelled') and (a.starts_at at time zone 'America/Port-au-Prince')::date=(now() at time zone 'America/Port-au-Prince')::date ${mine ? 'and a.doctor_id=$2' : 'and $2::uuid is not null'} order by a.starts_at`, [req.user.clinic_id, req.user.id])).rows
    res.json({ now: new Date().toISOString(), rows }) }))
  app.post('/api/appointments/:id/reschedule', need(...A), wrap(async (req, res) => {
    const t = Date.parse(req.body.starts_at); if (isNaN(t)) return fail(res, 400, 'Date invalide')
    { const a = (await q('select clinic_id,doctor_id,duration_min from appointments where id=$1 and clinic_id=$2', [req.params.id, req.user.clinic_id])).rows[0]
      if (a) { const cfg = await clinicCfg(a.clinic_id), st = new Date(t), wd = localWeekday(st), m0 = localMin(st), win = doctorWindows(cfg, a.doctor_id, wd); if (cfg.schedules[a.doctor_id] && !win.some(([x, z]) => m0 >= x && m0 + a.duration_min <= z)) return fail(res, 409, `Le médecin n'est pas en service à ${fmtHm(m0)} ce jour-là${win.length ? ` (en service : ${win.map(([x, z]) => fmtHm(x) + '–' + fmtHm(z)).join(', ')})` : ''}`) } }
    const out = await tx(async c => { await c.query('select pg_advisory_xact_lock(hashtext($1))', [req.user.clinic_id])
      const a = (await c.query("select * from appointments where id=$1 and clinic_id=$2 and status in ('planned','confirmed') for update", [req.params.id, req.user.clinic_id])).rows[0]; if (!a) return E(404, 'Introuvable ou non modifiable')
      if ((await overlap(c, a.clinic_id, a.doctor_id, a.chair, new Date(t).toISOString(), a.duration_min, a.id)).rowCount) return E(409, 'Conflit de créneau')
      await c.query("update appointments set starts_at=$2, status='planned' where id=$1", [a.id, new Date(t).toISOString()]); return {} })
    if (!out.err) await audit(req, 'APPOINTMENT_RESCHEDULED', 'appointments', req.params.id); done(res, out, () => ({ ok: true })) }))

  // ── Rappels de suivi ──
  app.get('/api/reminders', need(...A, 'edit_medical_records'), wrap(async (req, res) => res.json((await q(
    "select r.id,r.kind,r.reason,r.due_date,r.status,p.id patient_id,p.file_number,p.phone,p.last_name||' '||p.first_name patient,(r.status='pending' and r.due_date<current_date) overdue from follow_up_reminders r join patients p on p.id=r.patient_id where r.clinic_id=$1 and r.status='pending' order by r.due_date limit 100", [req.user.clinic_id])).rows)))
  app.post('/api/reminders', need(...A, 'edit_medical_records'), wrap(async (req, res) => {
    const p = await patient(req.user.clinic_id, req.body.patient_file); if (!p || !/^\d{4}-\d{2}-\d{2}$/.test(req.body.due_date || '')) return fail(res, 400, 'Patient ou date invalide')
    const { rows: [r] } = await q('insert into follow_up_reminders(clinic_id,patient_id,doctor_id,kind,reason,due_date,created_by) values($1,$2,$3,$4,$5,$6,$7) returning id', [req.user.clinic_id, p.id, p.primary_doctor_id, clean(req.body.kind, 40) || 'controle', clean(req.body.reason), req.body.due_date, req.user.id]); res.json(r) }))
  app.post('/api/reminders/:id/done', need(...A, 'edit_medical_records'), wrap(async (req, res) => {
    const r = await q("update follow_up_reminders set status='done', done_at=now() where id=$1 and clinic_id=$2 and status='pending' returning id", [req.params.id, req.user.clinic_id]); if (!r.rowCount) return fail(res, 404, 'Introuvable'); res.json({ ok: true }) }))

  // ── Plans de traitement ──
  const PLAN_SQL = `select p.*,pa.file_number,pa.last_name||' '||pa.first_name patient,u.first_name||' '||u.last_name responsible,
    (select coalesce(sum(price) filter (where status<>'cancelled'),0) from treatment_plan_items where plan_id=p.id)::numeric(14,2)::text total,
    (select count(*) filter (where status='done') from treatment_plan_items where plan_id=p.id)::int done_n,(select count(*) filter (where status<>'cancelled') from treatment_plan_items where plan_id=p.id)::int active_n,
    (select coalesce(sum(y.amount_htg),0) from payments y join invoices i on i.id=y.invoice_id where i.plan_id=p.id and y.voided_at is null)::numeric(14,2)::text paid
    from treatment_plans p join patients pa on pa.id=p.patient_id left join users u on u.id=p.responsible_doctor_id`
  const shape = p => ({ ...p, balance: (Math.round(Number(p.total) * 100) - Math.round(Number(p.paid) * 100)) / 100, progress: p.active_n ? Math.round(100 * p.done_n / p.active_n) : 0, remaining: p.active_n - p.done_n })
  const PERM = ['manage_treatment_plans', 'view_medical_records']
  app.get('/api/plans', need(...PERM), wrap(async (req, res) => res.json((await q(PLAN_SQL + ' where p.clinic_id=$1 order by p.created_at desc limit 50', [req.user.clinic_id])).rows.map(shape))))
  app.get('/api/plans/:id', need(...PERM), wrap(async (req, res) => {
    if (!UUID.test(req.params.id)) return fail(res, 404, 'Introuvable'); const p = (await q(PLAN_SQL + ' where p.clinic_id=$1 and p.id=$2', [req.user.clinic_id, req.params.id])).rows[0]; if (!p) return fail(res, 404, 'Introuvable')
    const items = (await q("select i.id,i.description,i.tooth,i.teeth,i.price::text,i.status,i.done_at,i.sessions_planned,i.sessions_done,i.postponed_reason,u.first_name||' '||u.last_name doctor from treatment_plan_items i left join users u on u.id=i.doctor_id where plan_id=$1 order by description", [p.id])).rows
    res.json({ ...shape(p), items }) }))
  app.post('/api/plans', need('manage_treatment_plans'), wrap(async (req, res) => {
    const b = req.body, items = Array.isArray(b.items) ? b.items.slice(0, 50) : [], pat = await patient(req.user.clinic_id, b.patient_file); if (!pat || !items.length) return fail(res, 400, 'Patient et interventions requis')
    for (const i of items) { i.teeth = teethOf(i.teeth ?? i.tooth); if (!clean(i.description) || !AMT.test(String(i.price)) || !i.teeth.every(FDI)) return fail(res, 400, `Intervention invalide : ${clean(i.description) || 'sans nom'} (prix ou numéro de dent)`) }
    const teeth = teethOf(b.teeth); if (!teeth.every(FDI)) return fail(res, 400, 'Dents invalides')
    const out = await tx(async c => {
      const { rows: [p] } = await c.query('insert into treatment_plans(clinic_id,patient_id,primary_doctor_id,responsible_doctor_id,diagnosis,objective,teeth,sessions,start_date,end_date,notes,created_by) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) returning id',
        [req.user.clinic_id, pat.id, pat.primary_doctor_id, actingDoctor(req, b.responsible_doctor_id), clean(b.diagnosis, 1000), clean(b.objective, 1000), teeth, parseInt(b.sessions) || null, b.start_date || null, b.end_date || null, clean(b.notes, 1000), req.user.id])
      for (const i of items) await c.query('insert into treatment_plan_items(plan_id,description,tooth,teeth,sessions_planned,price,doctor_id) values($1,$2,$3,$4,$5,$6,$7)', [p.id, clean(i.description), i.teeth[0] || null, i.teeth, Math.min(60, Math.max(1, parseInt(i.sessions) || 1)), i.price, lockedDoctor(req) ? req.user.id : UUID.test(i.doctor_id || '') ? i.doctor_id : null]); return p })
    await audit(req, 'PLAN_CREATED', 'treatment_plans', out.id); res.json(out) }))
  app.post('/api/plans/:id/status', need('manage_treatment_plans'), wrap(async (req, res) => {
    const out = await tx(async c => { const p = (await c.query('select id,status from treatment_plans where id=$1 and clinic_id=$2 for update', [req.params.id, req.user.clinic_id])).rows[0]; if (!p) return E(404, 'Introuvable')
      if (!PLAN_NEXT[p.status].includes(req.body.status)) return E(409, `Transition ${p.status} → ${req.body.status} non autorisée`); await c.query('update treatment_plans set status=$2 where id=$1', [p.id, req.body.status]); return {} })
    if (!out.err) await audit(req, 'PLAN_STATUS', 'treatment_plans', req.params.id, { status: req.body.status }); done(res, out, () => ({ ok: true })) }))
  app.post('/api/plans/:id/items/:item/status', need('manage_treatment_plans'), wrap(async (req, res) => {
    if (!UUID.test(req.params.id) || !UUID.test(req.params.item)) return fail(res, 404, 'Intervention introuvable')
    const s = req.body.status, b = req.body; if (!['todo', 'in_progress', 'postponed', 'done', 'cancelled'].includes(s)) return fail(res, 400, 'Statut invalide')
    if (s === 'postponed' && !clean(b.reason, 200)) return fail(res, 400, 'Motif du report obligatoire')
    const doc = actingDoctor(req, b.doctor_id), nt = b.teeth == null ? null : teethOf(b.teeth); if (nt && !nt.every(FDI)) return fail(res, 400, 'Numéros de dents invalides')
    let bill = null
    const out = await tx(async c => {
      const p = (await c.query('select id,status,patient_id from treatment_plans where id=$1 and clinic_id=$2 for update', [req.params.id, req.user.clinic_id])).rows[0]; if (!p) return E(404, 'Plan introuvable')
      if (!['approved', 'in_progress'].includes(p.status)) return E(409, "Le plan doit être approuvé ou en cours")
      const it = (await c.query('select id,description,tooth,teeth,price,status from treatment_plan_items where id=$1 and plan_id=$2 for update', [req.params.item, p.id])).rows[0]; if (!it) return E(404, 'Intervention introuvable')
      if (nt && ['done', 'in_progress'].includes(s)) { await c.query('update treatment_plan_items set teeth=$2, tooth=$3 where id=$1', [it.id, nt, nt[0] || null]); it.teeth = nt }
      if (s === 'done' && it.status === 'done') return E(409, 'Intervention déjà terminée')
      if (['done', 'cancelled'].includes(it.status) && s !== it.status) return E(409, 'Intervention déjà terminée ou annulée')
      await c.query('update treatment_plan_items set postponed_reason=$2 where id=$1', [it.id, s === 'postponed' ? clean(b.reason, 200) : null])
      const amount = b.amount ?? it.price; if (s === 'done') { const bad = validAmounts({ amount, discount: b.discount || 0, paid: b.paid || 0 }) || payProblem(b); if (bad) return E(400, bad) }
      const r = await c.query("update treatment_plan_items set status=$3, done_at=case when $3='done' then now() end, doctor_id=case when $3 in ('done','in_progress') then $4::uuid else doctor_id end where id=$1 and plan_id=$2 returning id", [it.id, p.id, s, doc]); if (!r.rowCount) return E(404, 'Intervention introuvable')
      // acte terminé : facturé au médecin qui l'a réalisé (réduction et paiement éventuels)
      if (s === 'done' && b.bill !== false && Number(it.price) > 0) {
                bill = await billService(c, { clinicId: req.user.clinic_id, patientId: p.patient_id, doctorId: doc, userId: req.user.id, description: it.description + (it.teeth?.length ? (it.teeth.length > 1 ? ' · dents ' : ' · dent ') + it.teeth.join(', ') : ''), amount, discount: b.discount, paid: b.paid, method: clean(b.method, 30), reference: clean(b.reference, 80), planId: p.id, planItemId: it.id }) }
      if (s === 'done') await syncTeeth(c, { clinicId: req.user.clinic_id, patientId: p.patient_id, teeth: it.teeth || [], label: it.description, doctorId: doc })
      const { rows: [k] } = await c.query("select count(*) filter (where status<>'cancelled') a, count(*) filter (where status='done') d from treatment_plan_items where plan_id=$1", [p.id])
      if (Number(k.a) > 0 && k.a === k.d) await c.query("update treatment_plans set status='done' where id=$1", [p.id]); else if (p.status === 'approved') await c.query("update treatment_plans set status='in_progress' where id=$1", [p.id]); return {} })
    if (!out.err) await audit(req, 'PLAN_ITEM_STATUS', 'treatment_plan_items', req.params.item, { status: s, invoice: bill?.number }); done(res, out, () => ({ ok: true, bill })) }))

  // ── Séance réalisée : avancement « n / prévues », enregistrée dans l'historique du patient ──
  app.post('/api/plans/:id/items/:item/session', need('manage_treatment_plans'), wrap(async (req, res) => {
    if (!UUID.test(req.params.id) || !UUID.test(req.params.item)) return fail(res, 404, 'Intervention introuvable')
    const b = req.body, doc = actingDoctor(req, b.doctor_id), nt = b.teeth == null ? null : teethOf(b.teeth); if (nt && !nt.every(FDI)) return fail(res, 400, 'Numéros de dents invalides')
    const out = await tx(async c => {
      const p = (await c.query('select id,status,patient_id,primary_doctor_id from treatment_plans where id=$1 and clinic_id=$2 for update', [req.params.id, req.user.clinic_id])).rows[0]; if (!p) return E(404, 'Plan introuvable')
      if (!['approved', 'in_progress'].includes(p.status)) return E(409, 'Le plan doit être approuvé ou en cours')
      const it = (await c.query('select * from treatment_plan_items where id=$1 and plan_id=$2 for update', [req.params.item, p.id])).rows[0]; if (!it) return E(404, 'Intervention introuvable')
      if (['done', 'cancelled'].includes(it.status)) return E(409, 'Intervention déjà terminée ou annulée')
      if (it.sessions_done >= it.sessions_planned) return E(409, 'Toutes les séances prévues sont réalisées : terminez l\'intervention')
      const n = it.sessions_done + 1; if (nt) { await c.query('update treatment_plan_items set teeth=$2, tooth=$3 where id=$1', [it.id, nt, nt[0] || null]); it.teeth = nt }
      await c.query("update treatment_plan_items set sessions_done=$2, status='in_progress', postponed_reason=null, doctor_id=$3 where id=$1", [it.id, n, doc])
      await c.query("insert into consultations(clinic_id,patient_id,doctor_id,primary_doctor_id,reason,treatment,teeth,notes,created_by) values($1,$2,$3,$4,$5,$6,$7,$8,$9)",
        [req.user.clinic_id, p.patient_id, doc, p.primary_doctor_id, `Séance ${n}/${it.sessions_planned} · ${it.description}`, clean(b.treatment, 1000) || it.description, it.teeth?.length ? it.teeth : it.tooth ? [it.tooth] : [], clean(b.notes, 2000), req.user.id])
      if (p.status === 'approved') await c.query("update treatment_plans set status='in_progress' where id=$1", [p.id])
      return { sessions_done: n, sessions_planned: it.sessions_planned, last: n >= it.sessions_planned } })
    if (!out.err) await audit(req, 'PLAN_SESSION', 'treatment_plan_items', req.params.item, out); done(res, out) }))

  // ── Tableau de bord personnel : uniquement l'activité du médecin connecté ──
  // Ce que la clinique doit à un membre du personnel : commissions non versées (12 derniers mois, hors fiches de paie) + fiches de paie non soldées
  const owedTo = async (cid, uid) => {
    const emp = (await q('select id,base_salary::float8 base_salary,coalesce(commission_pct,0)::float8 commission_pct,job_title from employees where user_id=$1 and clinic_id=$2', [uid, cid])).rows[0] || null
    const months = []; for (let k = 0; k < 12; k++) { const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - k); const per = d.toISOString().slice(0, 7)
      const r = (await q(COMMISSION_SQL + 'and u.id=$3', [cid, per + '-01', uid])).rows.map(withCommission)[0]; if (!r || !r.commission) continue
      const pd = Number((await q('select coalesce(sum(amount),0) s from commission_payments where clinic_id=$1 and doctor_id=$2 and period=$3', [cid, uid, per])).rows[0].s)
      const ip = Number((await q('select coalesce(sum(r.commissions),0) s from payroll_records r join employees e on e.id=r.employee_id where e.user_id=$1 and r.period=$2', [uid, per])).rows[0].s)
      months.push({ period: per, commission: r.commission, paid_direct: pd, in_payroll: ip, remaining: Math.max(0, Math.round((r.commission - pd - ip) * 100) / 100), collected: r.collected, billed: r.billed }) }
    const payroll = emp ? (await q("select id,period,base::float8 base,commissions::float8 commissions,bonuses::float8 bonuses,deductions::float8 deductions,deduction_details,other_deductions::float8 other_deductions,advances::float8 advances,net::float8 net,paid::float8 paid,status from payroll_records where employee_id=$1 order by period desc limit 12", [emp.id])).rows : []
    const comm = months.reduce((s, m) => s + m.remaining, 0), sal = payroll.reduce((s, p) => s + Math.max(0, p.net - p.paid), 0)
    return { employee: emp, months, payroll, commissions_due: Math.round(comm * 100) / 100, payroll_due: Math.round(sal * 100) / 100, total_due: Math.round((comm + sal) * 100) / 100 } }
  app.get('/api/me/activity', need(), wrap(async (req, res) => {
    const m = /^\d{4}-\d{2}$/.test(req.query.month || '') ? req.query.month : new Date().toLocaleDateString('en-CA', { timeZone: 'America/Port-au-Prince' }).slice(0, 7), d0 = m + '-01', me = req.user.id, cid = req.user.clinic_id
    const kpi = (await q(COMMISSION_SQL + 'and u.id=$3', [cid, d0, me])).rows.map(withCommission)[0] || null
    if (kpi) { kpi.paid_direct = Number((await q('select coalesce(sum(amount),0) s from commission_payments where clinic_id=$1 and doctor_id=$2 and period=$3', [cid, me, m])).rows[0].s)
      kpi.in_payroll = Number((await q('select coalesce(sum(r.commissions),0) s from payroll_records r join employees e on e.id=r.employee_id where e.user_id=$1 and r.period=$2', [me, m])).rows[0].s)
      kpi.remaining = Math.max(0, Math.round((kpi.commission - kpi.paid_direct - kpi.in_payroll) * 100) / 100) }
    // Tous les actes du médecin, quelle que soit la façon dont ils ont été saisis : intervention du dossier, intervention de plan terminée, prothèse ou facture directe
    const ACTS = `select c.id,c.consulted_at at_,c.reason,c.teeth::int[] teeth,c.patient_id,i.total,i.currency,i.id invoice_id from consultations c left join lateral (select * from invoices x where x.consultation_id=c.id and x.status<>'cancelled' limit 1) i on true where c.doctor_id=$1 and c.clinic_id=$2
      union all select it.id,it.done_at,it.description,coalesce(nullif(it.teeth,'{}'),case when it.tooth is null then '{}'::smallint[] else array[it.tooth] end)::int[],t.patient_id,i.total,i.currency,i.id from treatment_plan_items it join treatment_plans t on t.id=it.plan_id left join lateral (select * from invoices x where x.plan_item_id=it.id and x.status<>'cancelled' limit 1) i on true where it.doctor_id=$1 and t.clinic_id=$2 and it.status='done'
      union all select i.id,i.created_at,coalesce((select string_agg(description,', ') from invoice_items where invoice_id=i.id),'Acte facturé'),'{}'::int[],i.patient_id,i.total,i.currency,i.id from invoices i where i.doctor_id=$1 and i.clinic_id=$2 and i.kind='invoice' and i.status<>'cancelled' and i.consultation_id is null and i.plan_item_id is null`
    const [patients, acts, all, upcoming, items] = await Promise.all([
      q(`with a as (${ACTS}) select p.id,p.last_name||' '||p.first_name patient,p.file_number,count(*)::int n,max(a.at_) last,min(a.at_) first,(array_agg(a.reason order by a.at_ desc))[1] last_reason from a join patients p on p.id=a.patient_id group by p.id order by max(a.at_) desc limit 300`, [me, cid]),
      q(`with a as (${ACTS}) select a.id,a.at_ consulted_at,a.reason,a.teeth,p.id patient_id,p.last_name||' '||p.first_name patient,a.total::float8 total,a.currency,coalesce((select sum(y.applied_amount) from payments y where y.invoice_id=a.invoice_id and y.voided_at is null),0)::float8 paid
          from a join patients p on p.id=a.patient_id where a.at_>=$3::date and a.at_<($3::date+interval '1 month') order by a.at_ desc limit 300`, [me, cid, d0]),
      q(`with a as (${ACTS}) select (select count(*) from a)::int acts,(select count(distinct patient_id) from a)::int patients,
          (select coalesce(sum(i.total * case when i.currency='USD' then coalesce(i.rate_htg_per_usd,0) else 1 end),0) from invoices i where i.doctor_id=$1 and i.kind='invoice' and i.status<>'cancelled')::float8 billed,
          (select coalesce(sum(y.amount_htg),0) from payments y join invoices i on i.id=y.invoice_id where i.doctor_id=$1 and y.voided_at is null)::float8 collected,
          (select coalesce(sum(amount),0) from commission_payments where doctor_id=$1)::float8 commissions_paid`, [me, cid]),
      q("select a.id,a.starts_at,a.duration_min,a.reason,a.status,p.id patient_id,p.last_name||' '||p.first_name patient from appointments a join patients p on p.id=a.patient_id where a.doctor_id=$1 and a.starts_at>now() and a.status in ('planned','confirmed') order by a.starts_at limit 8", [me]),
      q("select i.id,i.description,i.status,i.sessions_planned,i.sessions_done,t.id plan_id,p.id patient_id,p.last_name||' '||p.first_name patient from treatment_plan_items i join treatment_plans t on t.id=i.plan_id join patients p on p.id=t.patient_id where t.clinic_id=$2 and (i.doctor_id=$1 or (i.doctor_id is null and t.responsible_doctor_id=$1)) and i.status in ('todo','in_progress','postponed') and t.status in ('approved','in_progress') order by i.status desc limit 30", [me, cid])])
    res.json({ month: m, kpi, patients: patients.rows, acts: acts.rows, all: all.rows[0], upcoming: upcoming.rows, items: items.rows, owed: await owedTo(cid, me) }) }))
  // Tableau de bord personnel selon le rôle (médecin, accueil, assistant, prothésiste, stock) : uniquement les données utiles à la personne
  app.get('/api/me/dashboard', need(), wrap(async (req, res) => {
    const cid = req.user.clinic_id, me = req.user.id, role = req.user.role, P = req.perms, out = { role }, TZ = "'America/Port-au-Prince'"
    const today = "(a.starts_at at time zone " + TZ + ")::date = (now() at time zone " + TZ + ")::date"
    if (P.has('manage_appointments') || role === 'DENTIST') out.today = (await q(`select a.id,a.starts_at,a.duration_min,a.reason,a.status,a.chair,p.id patient_id,p.last_name||' '||p.first_name patient,p.phone,u.first_name||' '||u.last_name doctor
      from appointments a join patients p on p.id=a.patient_id left join users u on u.id=a.doctor_id where a.clinic_id=$1 and ${today} ${role === 'DENTIST' ? 'and a.doctor_id=$2' : 'and $2::uuid is not null'} order by a.starts_at`, [cid, me])).rows
    if (role === 'DENTIST') {
      const m0 = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Port-au-Prince' }).slice(0, 7) + '-01', k = (await q(COMMISSION_SQL + 'and u.id=$3', [cid, m0, me])).rows.map(withCommission)[0]
      out.month = k; out.owed = await owedTo(cid, me)
      out.items = (await q("select i.id,i.description,i.status,i.teeth,i.sessions_planned,i.sessions_done,t.id plan_id,p.id patient_id,p.last_name||' '||p.first_name patient from treatment_plan_items i join treatment_plans t on t.id=i.plan_id join patients p on p.id=t.patient_id where t.clinic_id=$2 and (i.doctor_id=$1 or (i.doctor_id is null and t.responsible_doctor_id=$1)) and i.status in ('todo','in_progress','postponed') and t.status in ('approved','in_progress') order by i.status desc limit 8", [me, cid])).rows
      out.recent = (await q("select c.id,c.consulted_at,c.reason,c.teeth,p.id patient_id,p.last_name||' '||p.first_name patient from consultations c join patients p on p.id=c.patient_id where c.doctor_id=$1 and c.clinic_id=$2 order by c.consulted_at desc limit 6", [me, cid])).rows
      out.week = (await q("select count(*)::int n from appointments where doctor_id=$1 and starts_at between now() and now()+interval '7 days' and status in ('planned','confirmed')", [me])).rows[0].n }
    if (P.has('manage_appointments') && role !== 'DENTIST') {
      out.tomorrow = (await q(`select count(*) filter (where status='planned')::int to_confirm, count(*)::int total from appointments where clinic_id=$1 and (starts_at at time zone ${TZ})::date = (now() at time zone ${TZ})::date + 1`, [cid])).rows[0]
      out.reminders = (await q("select r.id,r.reason,r.due_date,p.id patient_id,p.last_name||' '||p.first_name patient,p.phone from follow_up_reminders r join patients p on p.id=r.patient_id where r.clinic_id=$1 and r.status='pending' and r.due_date<=current_date+3 order by r.due_date limit 8", [cid])).rows
      out.new_patients = (await q("select count(*)::int n from patients where clinic_id=$1 and registered_at>=current_date-7", [cid])).rows[0].n }
    if (P.has('manage_prostheses') && role !== 'DENTIST') out.prostheses = (await q("select x.id,x.ref,x.step,x.created_at,p.last_name||' '||p.first_name patient,t.name type from prostheses x join patients p on p.id=x.patient_id left join prosthesis_types t on t.id=x.type_id where x.clinic_id=$1 and x.step<>'placed' order by x.created_at desc limit 10", [cid])).rows
    if (P.has('manage_inventory')) out.stock = (await q("select name,stock::float8 stock,min_stock::float8 min_stock from (select p.name,p.min_stock,coalesce(sum(l.qty_remaining) filter (where l.expiry is null or l.expiry>=current_date),0) stock from products p left join product_lots l on l.product_id=p.id where p.clinic_id=$1 group by p.id) t where stock<=min_stock order by name limit 10", [cid])).rows
    if (role !== 'OWNER') out.owed ??= await owedTo(cid, me)
    res.json(out) }))

  // ── Prothèses & laboratoires ──
  const PR = ['manage_prostheses']
  app.get('/api/prosthesis-types', need(...PR), wrap(async (req, res) => { for (const n of TYPES) await q('insert into prosthesis_types(clinic_id,name) values($1,$2) on conflict do nothing', [req.user.clinic_id, n])
    res.json((await q('select id,name from prosthesis_types where clinic_id=$1 order by name', [req.user.clinic_id])).rows) }))
  app.post('/api/prosthesis-types', need(...PR), wrap(async (req, res) => { const n = clean(req.body.name, 80); if (!n) return fail(res, 400, 'Nom requis'); await q('insert into prosthesis_types(clinic_id,name) values($1,$2) on conflict do nothing', [req.user.clinic_id, n]); res.json({ ok: true }) }))
  app.get('/api/laboratories', need(...PR), wrap(async (req, res) => res.json((await q('select id,name,phone,technician from laboratories where clinic_id=$1 order by name', [req.user.clinic_id])).rows)))
  app.post('/api/laboratories', need(...PR), wrap(async (req, res) => { const n = clean(req.body.name); if (!n) return fail(res, 400, 'Nom requis'); res.json((await q('insert into laboratories(clinic_id,name,phone,technician) values($1,$2,$3,$4) returning id', [req.user.clinic_id, n, clean(req.body.phone, 30), clean(req.body.technician)])).rows[0]) }))
  app.get('/api/prostheses', need(...PR), wrap(async (req, res) => res.json((await q(
    `select x.id,x.ref,x.step,x.patient_id,x.teeth,pa.file_number,x.price::text,x.material_cost::text,x.lab_cost::text,(x.price-x.material_cost-x.lab_cost)::numeric(14,2)::text margin,x.placed_at,t.name type,l.name lab,pa.last_name||' '||pa.first_name patient,u.first_name||' '||u.last_name doctor,
     case when x.step in ('prescription','impression','preparation') then 'waiting' when x.step in ('sent_lab','manufacturing') then 'at_lab' when x.step='placed' then 'done' else 'in_progress' end grp,
     exists(select 1 from expenses e where e.source_type='prosthesis_lab' and e.source_id=x.id::text) lab_paid
     from prostheses x join prosthesis_types t on t.id=x.type_id join patients pa on pa.id=x.patient_id join users u on u.id=x.doctor_id left join laboratories l on l.id=x.lab_id where x.clinic_id=$1 order by x.created_at desc limit 100`, [req.user.clinic_id])).rows)))
  app.post('/api/prostheses', need(...PR), wrap(async (req, res) => {
    const b = req.body, pat = await patient(req.user.clinic_id, b.patient_file); if (!pat || !UUID.test(b.type_id || '')) return fail(res, 400, 'Patient ou type invalide')
    const LBL = { material_cost: 'Coût des matériaux', lab_cost: 'Coût du laboratoire', price: 'Prix facturé' }
    for (const k of Object.keys(LBL)) { if (b[k] != null) b[k] = String(b[k]).replace(/[\s\u00a0\u202f]/g, '').replace(',', '.'); if (b[k] && !AMT.test(b[k])) return fail(res, 400, LBL[k] + ' invalide') }
    if (b.bill !== false && Number(b.price) > 0) { const bad = validAmounts({ amount: b.price, discount: b.discount || 0, paid: b.paid || 0 }) || payProblem(b); if (bad) return fail(res, 400, bad) }
    let bill = null; const teeth = teethOf(b.teeth); if (!teeth.every(FDI)) return fail(res, 400, 'Dents invalides')
    const out = await tx(async c => { const ref = `PRT-${new Date().getFullYear()}-${String((await c.query("select nextval('prosthesis_seq') n")).rows[0].n).padStart(5, '0')}`
      const { rows: [x] } = await c.query('insert into prostheses(clinic_id,ref,patient_id,primary_doctor_id,doctor_id,type_id,teeth,material,color,lab_id,technician,material_cost,lab_cost,price,instructions,created_by) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) returning id,ref',
        [req.user.clinic_id, ref, pat.id, pat.primary_doctor_id, actingDoctor(req, b.doctor_id), b.type_id, teeth, clean(b.material, 80), clean(b.color, 40), UUID.test(b.lab_id || '') ? b.lab_id : null, clean(b.technician), b.material_cost || 0, b.lab_cost || 0, b.price || 0, clean(b.instructions, 1000), req.user.id])
      await c.query("insert into prosthesis_steps(prosthesis_id,step,by_user) values($1,'prescription',$2)", [x.id, req.user.id])
      if (b.bill !== false && Number(b.price) > 0) { const tn = (await c.query('select name from prosthesis_types where id=$1', [b.type_id])).rows[0]?.name || 'Prothèse'
        bill = await billService(c, { clinicId: req.user.clinic_id, patientId: pat.id, doctorId: actingDoctor(req, b.doctor_id), userId: req.user.id, description: `${tn} · ${ref}${teeth.length ? ' · dents ' + teeth.join(', ') : ''}`, amount: b.price, discount: b.discount, paid: b.paid, method: clean(b.method, 30), reference: clean(b.reference, 80) }) }
      return x })
    await audit(req, 'PROSTHESIS_CREATED', 'prostheses', out.id, { invoice: bill?.number }); res.json({ ...out, bill }) }))
  app.post('/api/prostheses/:id/step', need(...PR), wrap(async (req, res) => {   // cycle strict : une étape à la fois, historique immuable
    const out = await tx(async c => {
      const x = (await c.query('select * from prostheses where id=$1 and clinic_id=$2 for update', [req.params.id, req.user.clinic_id])).rows[0]; if (!x) return E(404, 'Introuvable')
      const next = ORDER[ORDER.indexOf(x.step) + 1]; if (!next || req.body.step !== next) return E(409, `Étape suivante attendue : ${next ?? 'aucune (prothèse posée)'}`)
      await c.query('update prostheses set step=$2, manufactured_at=case when $2=\'returned\' then current_date else manufactured_at end, placed_at=case when $2=\'placed\' then current_date else placed_at end where id=$1', [x.id, next])
      await c.query('insert into prosthesis_steps(prosthesis_id,step,note,by_user) values($1,$2,$3,$4)', [x.id, next, clean(req.body.note, 300), req.user.id])
      if (next === 'placed') await c.query("insert into follow_up_reminders(clinic_id,patient_id,doctor_id,kind,reason,due_date,created_by) values($1,$2,$3,'controle_prothese','Contrôle après pose de prothèse',current_date+14,$4)", [x.clinic_id, x.patient_id, x.doctor_id, req.user.id]); return { step: next } })
    if (!out.err) await audit(req, 'PROSTHESIS_STEP', 'prostheses', req.params.id, { step: out.step }); done(res, out) }))
  app.post('/api/prostheses/:id/pay-lab', need(...PR, 'manage_finances'), wrap(async (req, res) => {   // coût labo = une seule dépense
    if (!req.perms.has('manage_finances') || !req.perms.has('manage_prostheses')) return fail(res, 403, 'Permission refusée')
    const out = await tx(async c => { const x = (await c.query('select * from prostheses where id=$1 and clinic_id=$2 for update', [req.params.id, req.user.clinic_id])).rows[0]; if (!x) return E(404, 'Introuvable'); if (!(Number(x.lab_cost) > 0)) return E(400, 'Aucun coût de laboratoire')
      try { await c.query('savepoint s'); await c.query("insert into expenses(clinic_id,category,description,amount,currency,amount_htg,status,paid_at,source_type,source_id,created_by) values($1,'Laboratoire',$2,$3,'HTG',$3,'paid',now(),'prosthesis_lab',$4,$5)", [x.clinic_id, 'Labo ' + x.ref, x.lab_cost, x.id, req.user.id]) } catch (e) { if (e.code === '23505') return E(409, 'Laboratoire déjà payé'); throw e }
      await c.query("select cash_post($1,'HTG','out',$2,$3,$4,'prosthesis_lab',$5,$6)", [x.clinic_id, x.lab_cost, 'LAB-' + x.id.slice(0, 8), 'Labo ' + x.ref, x.id, req.user.id]); return {} })
    if (!out.err) await audit(req, 'LAB_PAID', 'prostheses', req.params.id); done(res, out, () => ({ ok: true })) }))

  // ── Commissions des médecins : taux × encaissé sur les actes que chacun a réalisés ──
  const boss = req => req.perms.has('view_finances') || req.user.role === 'OWNER' || String(req.user.role).startsWith('ADMIN')
  app.get('/api/commissions', need(), wrap(async (req, res) => {
    if (!boss(req)) return fail(res, 403, 'Permission refusée')
    const m = /^\d{4}-\d{2}$/.test(req.query.month || '') ? req.query.month + '-01' : new Date().toLocaleDateString('en-CA', { timeZone: 'America/Port-au-Prince' }).slice(0, 7) + '-01'
    const per = m.slice(0, 7), rows = (await q(COMMISSION_SQL + 'order by u.last_name', [req.user.clinic_id, m])).rows.map(withCommission)
    for (const r of rows) { const d = (await q('select coalesce(sum(amount),0)::float8 s from commission_payments where clinic_id=$1 and doctor_id=$2 and period=$3', [req.user.clinic_id, r.id, per])).rows[0].s
      const pr = (await q("select coalesce(sum(r.commissions),0)::float8 s from payroll_records r join employees e on e.id=r.employee_id where e.user_id=$1 and r.period=$2 and r.clinic_id=$3", [r.id, per, req.user.clinic_id])).rows[0].s
      r.paid_direct = d; r.in_payroll = pr; r.remaining = Math.max(0, Math.round((r.commission - d - pr) * 100) / 100)
      const e = (await q('select id,base_salary::float8 base from employees where user_id=$1', [r.id])).rows[0]; r.base_salary = e?.base || 0
      r.payroll = e ? (await q('select id,net::float8 net,paid::float8 paid,deductions::float8 deductions,status from payroll_records where employee_id=$1 and period=$2', [e.id, per])).rows[0] || null : null }
    const cpay = (await q("select cp.id,cp.doctor_id,cp.amount::float8 amount,cp.method,cp.note,cp.created_at,u.first_name||' '||u.last_name who from commission_payments cp join users u on u.id=cp.paid_by where cp.clinic_id=$1 and cp.period=$2 order by cp.created_at desc", [req.user.clinic_id, per])).rows
    const detail = req.query.doctor && UUID.test(req.query.doctor) ? (await q(`select i.id,i.number,i.created_at,i.total::float8 total,i.discount::float8 discount,p.last_name||' '||p.first_name patient,p.id patient_id,
      (select coalesce(sum(y.amount_htg),0) from payments y where y.invoice_id=i.id and y.voided_at is null and y.created_at>=$3::date and y.created_at<($3::date+interval '1 month'))::float8 collected,
      (select string_agg(it.description, ', ') from invoice_items it where it.invoice_id=i.id) service
      from invoices i join patients p on p.id=i.patient_id where i.clinic_id=$1 and i.doctor_id=$2 and i.kind='invoice' and i.status<>'cancelled' and (i.created_at>=$3::date and i.created_at<($3::date+interval '1 month')
        or exists(select 1 from payments y where y.invoice_id=i.id and y.voided_at is null and y.created_at>=$3::date and y.created_at<($3::date+interval '1 month'))) order by i.created_at desc limit 300`, [req.user.clinic_id, req.query.doctor, m])).rows : null
    res.json({ month: m.slice(0, 7), rows, detail, payments: cpay, basis: (await q('select commission_basis b from clinics where id=$1', [req.user.clinic_id])).rows[0]?.b || 'collected' }) }))
  app.post('/api/commissions/pay', need(), wrap(async (req, res) => {
    if (!(req.perms.has('manage_payroll') || req.user.role === 'OWNER' || String(req.user.role).startsWith('ADMIN'))) return fail(res, 403, 'Permission refusée')
    const b = req.body, per = String(b.period || ''), amt = String(b.amount ?? '').replace(/\s/g, '').replace(',', '.'), method = clean(b.method, 30)
    if (!UUID.test(b.doctor_id || '') || !/^\d{4}-\d{2}$/.test(per) || !AMT.test(amt) || Number(amt) <= 0 || !method) return fail(res, 400, 'Paiement invalide')
    const row = (await q(COMMISSION_SQL + 'and u.id=$3', [req.user.clinic_id, per + '-01', b.doctor_id])).rows.map(withCommission)[0]; if (!row) return fail(res, 404, 'Médecin introuvable')
    const out = await tx(async c => { await c.query('select pg_advisory_xact_lock(hashtext($1))', ['commission:' + b.doctor_id + ':' + per])
      const d = Number((await c.query('select coalesce(sum(amount),0) s from commission_payments where clinic_id=$1 and doctor_id=$2 and period=$3', [req.user.clinic_id, b.doctor_id, per])).rows[0].s)
      const pr = Number((await c.query("select coalesce(sum(r.commissions),0) s from payroll_records r join employees e on e.id=r.employee_id where e.user_id=$1 and r.period=$2 and r.clinic_id=$3", [b.doctor_id, per, req.user.clinic_id])).rows[0].s)
      const rest = Math.round((row.commission - d - pr) * 100); if (Math.round(Number(amt) * 100) > rest) return E(409, `Le montant dépasse la commission restante (${(Math.max(0, rest) / 100).toFixed(2)} HTG)`)
      const cp = (await c.query('insert into commission_payments(clinic_id,doctor_id,period,amount,method,note,paid_by) values($1,$2,$3,$4,$5,$6,$7) returning id', [req.user.clinic_id, b.doctor_id, per, amt, method, clean(b.note, 200), req.user.id])).rows[0]
      await c.query("insert into expenses(clinic_id,category,description,amount,currency,amount_htg,status,paid_at,source_type,source_id,created_by) values($1,'Salaires',$2,$3,'HTG',$3,'paid',now(),'commission',$4,$5)", [req.user.clinic_id, `Commission ${row.doctor} ${per}`, amt, cp.id, req.user.id])
      await c.query("select cash_post($1,'HTG','out',$2,$3,$4,'commission',$5,$6)", [req.user.clinic_id, amt, 'COM-' + cp.id.slice(0, 8), `Commission ${row.doctor} ${per}`, cp.id, req.user.id]); return cp })
    if (out.err) return fail(res, ...out.err); await audit(req, 'COMMISSION_PAID', 'commission_payments', out.id, { doctor: b.doctor_id, period: per, amount: amt }); res.json({ ok: true }) }))
  app.post('/api/commissions/basis', need(), wrap(async (req, res) => {
    if (!(req.user.role === 'OWNER' || String(req.user.role).startsWith('ADMIN'))) return fail(res, 403, "Réservé à l'administration")
    const b = req.body.basis; if (!['collected', 'billed'].includes(b)) return fail(res, 400, 'Base invalide')
    await q('update clinics set commission_basis=$2 where id=$1', [req.user.clinic_id, b]); await audit(req, 'COMMISSION_BASIS', 'clinics', req.user.clinic_id, { basis: b }); res.json({ ok: true }) }))
  app.post('/api/doctors/:id/commission', need(), wrap(async (req, res) => {
    if (!(req.perms.has('manage_payroll') || req.user.role === 'OWNER' || String(req.user.role).startsWith('ADMIN'))) return fail(res, 403, 'Permission refusée')
    const pct = Number(req.body.pct); if (!UUID.test(req.params.id) || !(pct >= 0 && pct <= 100)) return fail(res, 400, 'Taux invalide (0 à 100 %)')
    const u = (await q("select id,first_name,last_name,job_title from users where id=$1 and clinic_id=$2", [req.params.id, req.user.clinic_id])).rows[0]; if (!u) return fail(res, 404, 'Médecin introuvable')
    const e = (await q('select id,base_salary from employees where user_id=$1', [u.id])).rows[0]
    if (!(pct > 0) && !(Number(e?.base_salary) > 0)) return fail(res, 400, 'Ce médecin n\'a pas de salaire fixe : le pourcentage ne peut pas être 0. Définissez d\'abord un salaire fixe (Personnel & paie).')
    if (e) await q('update employees set commission_pct=$2 where id=$1', [e.id, pct])
    else await q("insert into employees(clinic_id,user_id,first_name,last_name,job_title,base_salary,commission_pct) values($1,$2,$3,$4,$5,0,$6)", [req.user.clinic_id, u.id, u.first_name, u.last_name, u.job_title || 'Médecin dentiste', pct])
    await audit(req, 'COMMISSION_RATE', 'users', u.id, { pct }); res.json({ ok: true }) }))

  // ── Statistiques médecins (revenus générés ≠ salaire ≠ qualité des soins) ──
  app.get('/api/doctors/stats', need('view_medical_records', 'view_finances'), wrap(async (req, res) => {
    if (!(req.perms.has('view_finances') || req.user.role === 'OWNER' || String(req.user.role).startsWith('ADMIN'))) return fail(res, 403, 'Permission refusée')   // statistiques des médecins : direction et finances uniquement
    const m = /^\d{4}-\d{2}$/.test(req.query.month || '') ? req.query.month + '-01' : new Date().toLocaleDateString('en-CA', { timeZone: 'America/Port-au-Prince' }).slice(0, 7) + '-01', all = req.perms.has('view_finances')
    res.json((await q(`select u.id,u.first_name||' '||u.last_name doctor,
      (select count(*) from consultations c where c.doctor_id=u.id and c.consulted_at>=$2::date and c.consulted_at<($2::date+interval '1 month'))::int consultations,
      (select count(*) from treatment_plan_items i where i.doctor_id=u.id and i.status='done' and i.done_at>=$2::date and i.done_at<($2::date+interval '1 month'))::int interventions,
      (select coalesce(sum(i.price),0) from treatment_plan_items i where i.doctor_id=u.id and i.status='done' and i.done_at>=$2::date and i.done_at<($2::date+interval '1 month'))::numeric(14,2)::text generated_htg,
      (select count(*) from patients p where p.primary_doctor_id=u.id)::int patients_followed,
      (select count(*) from treatment_plans t where t.responsible_doctor_id=u.id and t.status in ('approved','in_progress'))::int plans_in_progress,
      (select count(*) from treatment_plans t where t.responsible_doctor_id=u.id and t.status='done')::int plans_done,
      (select count(*) from prostheses x where x.doctor_id=u.id and x.placed_at>=$2::date and x.placed_at<($2::date+interval '1 month'))::int prostheses_placed,
      (select count(*) from appointments a where a.doctor_id=u.id and a.starts_at>now() and a.status in ('planned','confirmed'))::int upcoming_appointments
      from users u where u.clinic_id=$1 and u.status='active' and u.role in ('DENTIST','OWNER','ADMIN_MEDICAL') and ($3 or u.id=$4) order by u.last_name`, [req.user.clinic_id, m, all, req.user.id])).rows) }))
}
