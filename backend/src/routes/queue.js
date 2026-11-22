// ═══ Salle d'attente numérotée (file d'attente du jour) ═══
// Arrivée → numéro du jour (ordre d'arrivée, les urgences passent devant) → appelé → en consultation → terminé (ou absent).
// Synchronisé avec les rendez-vous : un patient avec rendez-vous qui arrive reçoit aussi un numéro, et son rendez-vous suit les étapes.
const TZ = 'America/Port-au-Prince', UUID = /^[0-9a-f-]{36}$/i
const today = () => new Date().toLocaleDateString('en-CA', { timeZone: TZ })
const weekday = d => new Date(d + 'T12:00:00Z').getUTCDay()   // 0 = dimanche … 6 = samedi
const capOf = (cap, d) => { const w = weekday(d); return w >= 1 && w <= 5 ? Math.max(0, parseInt(cap?.[w]) || 0) : 0 }   // 0 = pas de limite
const NEXT = { call: ['waiting'], start: ['waiting', 'called'], done: ['in_consult', 'called'], absent: ['waiting', 'called'], cancel: ['waiting', 'called'], requeue: ['called', 'absent'] }

export default function (app, { pool, q, need, audit, fail, wrap, clean }) {
  const Q = need('manage_queue')
  const tx = async fn => { const c = await pool.connect(); try { await c.query('begin'); const r = await fn(c); await c.query('commit'); return r } catch (e) { await c.query('rollback'); throw e } finally { c.release() } }
  const E = (s, m) => ({ err: [s, m] })
  const SEL = `select t.*, coalesce(p.last_name||' '||p.first_name, t.visitor_name) name, p.file_number, coalesce(p.phone, t.phone) phone_, u.first_name||' '||u.last_name doctor, a.starts_at appt_at
    from queue_tickets t left join patients p on p.id=t.patient_id left join users u on u.id=t.doctor_id left join appointments a on a.id=t.appointment_id`

  // ── tableau de la journée ──
  app.get('/api/queue', Q, wrap(async (req, res) => {
    const cid = req.user.clinic_id, day = /^\d{4}-\d{2}-\d{2}$/.test(req.query.day || '') ? req.query.day : today()
    const cl = (await q('select queue_capacity from clinics where id=$1', [cid])).rows[0], cap = capOf(cl?.queue_capacity, day)
    const tickets = (await q(SEL + ' where t.clinic_id=$1 and t.day=$2 order by t.number', [cid, day])).rows
    const due = t => t.appt_at && new Date(t.appt_at).getTime() <= Date.now() + 15 * 6e4   // rendez-vous à l'heure : ne fait pas la queue
    const waiting = tickets.filter(t => t.status === 'waiting' || t.status === 'called').sort((a, b) => (a.status === 'called' ? -1 : 0) - (b.status === 'called' ? -1 : 0) || b.priority - a.priority || due(b) - due(a) || a.number - b.number)
    for (const t of waiting) t.appt_due = !!due(t)
    waiting.forEach((t, i) => { t.position = i + 1 })
    const done = tickets.filter(t => t.status === 'done' && t.started_at && t.finished_at), consult = done.length ? Math.round(done.reduce((s, t) => s + (new Date(t.finished_at) - new Date(t.started_at)), 0) / done.length / 6e4) : null
    const started = tickets.filter(t => t.started_at), wait = started.length ? Math.round(started.reduce((s, t) => s + (new Date(t.started_at) - new Date(t.arrived_at)), 0) / started.length / 6e4) : null
    const doctors = Math.max(1, Number((await q("select count(*)::int n from users where clinic_id=$1 and role='DENTIST' and status='active'", [cid])).rows[0].n))
    for (const t of waiting) t.eta_min = Math.round((t.position - 1) * (consult || 20) / doctors)
    const appts = (await q(`select a.id, a.starts_at, a.reason, a.status, p.id patient_id, p.last_name||' '||p.first_name name, p.file_number, u.first_name||' '||u.last_name doctor, a.doctor_id
      from appointments a join patients p on p.id=a.patient_id join users u on u.id=a.doctor_id
      where a.clinic_id=$1 and a.status not in ('cancelled','no_show','done') and (a.starts_at at time zone '${TZ}')::date=$2::date
        and not exists (select 1 from queue_tickets t where t.appointment_id=a.id and t.status<>'cancelled') order by a.starts_at`, [cid, day])).rows
    const used = tickets.filter(t => t.status !== 'cancelled').length
    res.json({ day, capacity: cap, used, remaining: cap ? Math.max(0, cap - used) : null, full: !!cap && used >= cap, booked: appts.length, weekly: cl?.queue_capacity || {},
      next_number: (tickets.at(-1)?.number || 0) + 1, waiting, in_consult: tickets.filter(t => t.status === 'in_consult'), finished: tickets.filter(t => ['done', 'absent', 'cancelled'].includes(t.status)).reverse(),
      stats: { waiting: waiting.length, in_consult: tickets.filter(t => t.status === 'in_consult').length, done: tickets.filter(t => t.status === 'done').length, absent: tickets.filter(t => t.status === 'absent').length, avg_wait: wait, avg_consult: consult, doctors },
      appointments: appts }) }))

  // ── enregistrer une arrivée : numéro attribué dans l'ordre d'arrivée ──
  app.post('/api/queue', Q, wrap(async (req, res) => {
    const b = req.body, cid = req.user.clinic_id, day = today(), priority = b.priority === true || b.priority === 'on'
    const out = await tx(async c => {
      let patientId = null, apptId = null, doctorId = UUID.test(b.doctor_id || '') ? b.doctor_id : null, reason = clean(b.reason, 200)
      if (UUID.test(b.appointment_id || '')) { const a = (await c.query("select id, patient_id, doctor_id, reason from appointments where id=$1 and clinic_id=$2 and status not in ('cancelled','no_show')", [b.appointment_id, cid])).rows[0]; if (!a) return E(404, 'Rendez-vous introuvable')
        apptId = a.id; patientId = a.patient_id; doctorId = doctorId || a.doctor_id; reason = reason || a.reason }
      else if (b.patient_file) { const p = (await c.query('select id from patients where clinic_id=$1 and file_number=$2 and deleted_at is null', [cid, clean(b.patient_file, 30)])).rows[0]; if (!p) return E(404, 'Patient introuvable'); patientId = p.id }
      else if (UUID.test(b.patient_id || '')) patientId = b.patient_id
      const visitor = patientId ? null : clean(b.visitor_name, 120); if (!patientId && !visitor) return E(400, 'Choisissez un patient ou indiquez le nom de la personne')
      if (patientId) { const dup = (await c.query("select number from queue_tickets where clinic_id=$1 and day=$2 and patient_id=$3 and status in ('waiting','called','in_consult')", [cid, day, patientId])).rows[0]; if (dup) return E(409, `Cette personne est déjà dans la file (n° ${dup.number})`) }
      // capacité du jour (lundi → vendredi) ; une urgence est toujours acceptée
      const cap = capOf((await c.query('select queue_capacity from clinics where id=$1', [cid])).rows[0]?.queue_capacity, day)
      const used = Number((await c.query("select count(*)::int n from queue_tickets where clinic_id=$1 and day=$2 and status<>'cancelled'", [cid, day])).rows[0].n)
      if (cap && used >= cap && !priority) return E(409, `Capacité du jour atteinte (${used}/${cap}) : proposez un rendez-vous un autre jour, ou cochez « Urgence » si la personne doit être vue aujourd'hui`)
      const number = Number((await c.query('select coalesce(max(number),0)+1 n from queue_tickets where clinic_id=$1 and day=$2', [cid, day])).rows[0].n)
      const t = (await c.query('insert into queue_tickets(clinic_id,day,number,patient_id,visitor_name,phone,appointment_id,doctor_id,reason,priority,created_by) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) returning id, number',
        [cid, day, number, patientId, visitor, patientId ? null : clean(b.phone, 30), apptId, doctorId, reason, priority, req.user.id])).rows[0]
      if (apptId) await c.query("update appointments set arrived_at=coalesce(arrived_at,now()), status=case when status='planned' then 'confirmed' else status end where id=$1", [apptId])
      return { ...t, over_capacity: !!cap && used >= cap }
    })
    if (out.err) return fail(res, ...out.err)
    await audit(req, 'QUEUE_ARRIVAL', 'queue_tickets', out.id, { number: out.number, priority }); res.json(out) }))

  // ── étapes : appeler, faire entrer, terminer, absent, annuler, remettre dans la file ──
  const step = async (req, id, s) => tx(async c => {
    const t = (await c.query('select * from queue_tickets where id=$1 and clinic_id=$2 for update', [id, req.user.clinic_id])).rows[0]; if (!t) return E(404, 'Ticket introuvable')
    if (!NEXT[s]?.includes(t.status)) return E(409, 'Action impossible dans l\'état actuel')
    const set = { call: "status='called', called_at=now()", start: "status='in_consult', called_at=coalesce(called_at,now()), started_at=now()", done: "status='done', started_at=coalesce(started_at,now()), finished_at=now()",
      absent: "status='absent'", cancel: "status='cancelled'", requeue: "status='waiting', called_at=null" }[s]
    await c.query(`update queue_tickets set ${set}, updated_by=$2 where id=$1`, [t.id, req.user.id])
    if (t.appointment_id) { if (s === 'start') await c.query('update appointments set arrived_at=coalesce(arrived_at,now()), seated_at=coalesce(seated_at,now()) where id=$1', [t.appointment_id])
      if (s === 'done') await c.query("update appointments set seated_at=coalesce(seated_at,now()), finished_at=coalesce(finished_at,now()), status='done' where id=$1", [t.appointment_id]) }
    return { id: t.id, number: t.number, status: s } })
  app.post('/api/queue/:id/step', Q, wrap(async (req, res) => { if (!UUID.test(req.params.id)) return fail(res, 404, 'Ticket introuvable')
    const out = await step(req, req.params.id, String(req.body.step || '')); if (out.err) return fail(res, ...out.err)
    await audit(req, 'QUEUE_' + String(req.body.step).toUpperCase(), 'queue_tickets', out.id, { number: out.number }); res.json(out) }))
  // appeler le suivant : urgences d'abord, puis l'ordre d'arrivée (éventuellement pour un médecin précis)
  app.post('/api/queue/next', Q, wrap(async (req, res) => {
    const doc = UUID.test(req.body.doctor_id || '') ? req.body.doctor_id : null
    const t = (await q(`select t.id from queue_tickets t left join appointments a on a.id=t.appointment_id where t.clinic_id=$1 and t.day=$2 and t.status='waiting' ${doc ? 'and (t.doctor_id=$3 or t.doctor_id is null)' : ''} order by t.priority desc, (a.starts_at is not null and a.starts_at <= now() + interval '15 minutes') desc, t.number limit 1`, doc ? [req.user.clinic_id, today(), doc] : [req.user.clinic_id, today()])).rows[0]
    if (!t) return fail(res, 404, 'Personne n\'attend pour le moment')
    const out = await step(req, t.id, 'call'); if (out.err) return fail(res, ...out.err)
    const full = (await q(SEL + ' where t.id=$1', [t.id])).rows[0]; await audit(req, 'QUEUE_CALL', 'queue_tickets', t.id, { number: full.number }); res.json(full) }))
  // le médecin prend un patient en attente : il passe « en consultation » (avec ce médecin) ; son rendez-vous suit
  app.post('/api/queue/:id/take', Q, wrap(async (req, res) => { if (!UUID.test(req.params.id)) return fail(res, 404, 'Ticket introuvable')
    const out = await tx(async c => {
      const t = (await c.query('select * from queue_tickets where id=$1 and clinic_id=$2 for update', [req.params.id, req.user.clinic_id])).rows[0]; if (!t) return E(404, 'Ticket introuvable')
      if (!['waiting', 'called'].includes(t.status)) return E(409, t.status === 'in_consult' ? 'Ce patient est déjà en consultation' : 'Ce patient n\'est plus en attente')
      const doc = req.user.role === 'DENTIST' ? req.user.id : UUID.test(req.body.doctor_id || '') ? req.body.doctor_id : t.doctor_id
      await c.query("update queue_tickets set status='in_consult', called_at=coalesce(called_at,now()), started_at=now(), doctor_id=$2, updated_by=$3 where id=$1", [t.id, doc, req.user.id])
      if (t.appointment_id) await c.query('update appointments set arrived_at=coalesce(arrived_at,now()), seated_at=coalesce(seated_at,now()) where id=$1', [t.appointment_id])
      return { id: t.id, number: t.number, patient_id: t.patient_id } })
    if (out.err) return fail(res, ...out.err)
    await audit(req, 'QUEUE_START', 'queue_tickets', out.id, { number: out.number }); res.json(out) }))
  // personne non inscrite : son ticket est rattaché au dossier qui vient d'être créé
  app.post('/api/queue/:id/link', Q, wrap(async (req, res) => { if (!UUID.test(req.params.id) || !UUID.test(req.body.patient_id || '')) return fail(res, 400, 'Données invalides')
    const out = await tx(async c => {
      const t = (await c.query('select * from queue_tickets where id=$1 and clinic_id=$2 for update', [req.params.id, req.user.clinic_id])).rows[0]; if (!t) return E(404, 'Ticket introuvable')
      if (t.patient_id && t.patient_id !== req.body.patient_id) return E(409, 'Ce ticket est déjà rattaché à un autre dossier')
      if (!(await c.query('select 1 from patients where id=$1 and clinic_id=$2', [req.body.patient_id, req.user.clinic_id])).rowCount) return E(404, 'Patient introuvable')
      const dup = (await c.query("select number from queue_tickets where clinic_id=$1 and day=$2 and patient_id=$3 and id<>$4 and status in ('waiting','called','in_consult')", [req.user.clinic_id, t.day, req.body.patient_id, t.id])).rows[0]
      if (dup) return E(409, 'Ce patient a déjà le ticket n° ' + dup.number)
      await c.query('update queue_tickets set patient_id=$2, updated_by=$3 where id=$1', [t.id, req.body.patient_id, req.user.id]); return { id: t.id, number: t.number } })
    if (out.err) return fail(res, ...out.err)
    await audit(req, 'QUEUE_LINKED', 'queue_tickets', out.id, { number: out.number, patient_id: req.body.patient_id }); res.json(out) }))
  // capacité par jour (lundi → vendredi)
  app.post('/api/queue/capacity', Q, wrap(async (req, res) => {
    const cap = {}; for (const w of [1, 2, 3, 4, 5]) { const v = parseInt(req.body[w] ?? req.body['d' + w]); if (!(v >= 0 && v <= 500)) return fail(res, 400, 'Capacité invalide (0 à 500 ; 0 = pas de limite)'); cap[w] = v }
    await q('update clinics set queue_capacity=$2 where id=$1', [req.user.clinic_id, JSON.stringify(cap)]); await audit(req, 'QUEUE_CAPACITY', 'clinics', req.user.clinic_id, cap); res.json(cap) }))
}
