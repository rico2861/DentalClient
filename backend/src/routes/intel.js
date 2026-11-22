// Routes du moteur d'intelligence opérationnelle. Toute erreur du moteur reste confinée ici : la clinique continue de fonctionner.
import { computeAll, suggestSlots, clinicCfg, fmtHm } from '../lib/intel.js'
export default function (app, { q, need, audit, fail, wrap }) {
  const admin = req => req.user.role === 'OWNER' || String(req.user.role).startsWith('ADMIN')
  const safe = fn => wrap(async (req, res) => { try { await fn(req, res) } catch (e) { console.error('Moteur d\'intelligence :', e.message); if (!res.headersSent) res.json({ enabled: false, unavailable: true, error: 'Moteur momentanément indisponible : les fonctions de la clinique ne sont pas affectées.' }) } })
  const results = async cid => Object.fromEntries((await q('select kind,data,computed_at,ms from intel_results where clinic_id=$1', [cid])).rows.map(r => [r.kind, { ...r.data && { data: r.data }, at: r.computed_at, ms: r.ms }]))

  // tableau complet (direction) ; chaque partie respecte les permissions
  app.get('/api/intel', need(), safe(async (req, res) => { if (!admin(req)) return fail(res, 403, "Réservé à l'administration")
    const cid = req.user.clinic_id, cfg = await clinicCfg(cid), R = await results(cid)
    if (!req.perms.has('manage_inventory')) delete R.stock
    const metrics = (await q('select day::text as day,avg_wait::float8 avg_wait,p90_wait::float8 p90_wait,waits,no_show_rate::float8 no_show_rate,utilization::float8 utilization,idle_min::float8 idle_min,overrun::float8 overrun from intel_metrics where clinic_id=$1 order by day desc limit 120', [cid])).rows
    res.json({ enabled: cfg.enabled, since: cfg.since, settings: { open_time: cfg.open_time, close_time: cfg.close_time, work_days: cfg.work_days, chairs: cfg.chairs, hours: hoursOut(cfg) }, results: R, metrics }) }))
  app.post('/api/intel/run', need(), safe(async (req, res) => { if (!admin(req)) return fail(res, 403, "Réservé à l'administration")
    const cfg = await clinicCfg(req.user.clinic_id); if (!cfg.enabled) return fail(res, 409, 'Le moteur est désactivé')
    const t0 = Date.now(), r = await computeAll(req.user.clinic_id); res.json({ ok: true, ms: Date.now() - t0, ...r }) }))
  const hoursOut = cfg => Object.fromEntries([0, 1, 2, 3, 4, 5, 6].map(w => { const h = cfg.hoursFor(w); return [w, h ? { open: fmtHm(h.open), close: fmtHm(h.close) } : null] }))
  const T5 = /^([01]\d|2[0-3]):[0-5]\d$/
  // horaires de la clinique : paramètres d'ouverture jour par jour
  app.get('/api/schedules', need('manage_appointments', 'manage_users'), wrap(async (req, res) => { const cfg = await clinicCfg(req.user.clinic_id)
    const docs = (await q("select id,first_name||' '||last_name name,role from users where clinic_id=$1 and status='active' and role in ('DENTIST','OWNER','ADMIN_MEDICAL') order by last_name", [req.user.clinic_id])).rows
    const rows = (await q('select doctor_id,weekday,start_time,end_time from doctor_schedules where clinic_id=$1 order by weekday,start_time', [req.user.clinic_id])).rows
    res.json({ hours: hoursOut(cfg), chairs: cfg.chairs, doctors: docs.map(d => ({ ...d, defined: rows.some(r => r.doctor_id === d.id), ranges: [0, 1, 2, 3, 4, 5, 6].map(w => rows.filter(r => r.doctor_id === d.id && r.weekday === w).map(r => ({ start: r.start_time, end: r.end_time }))) })) }) }))
  // plages de service d'un médecin (remplace les précédentes) ; vides = suit les horaires de la clinique
  app.post('/api/schedules/:doctor', need(), wrap(async (req, res) => { if (!admin(req)) return fail(res, 403, "Réservé à l'administration")
    const d = (await q("select id,first_name||' '||last_name name from users where id=$1 and clinic_id=$2", [req.params.doctor, req.user.clinic_id])).rows[0]; if (!d) return fail(res, 404, 'Médecin introuvable')
    const days = Array.isArray(req.body.ranges) ? req.body.ranges : [], list = []
    for (let w = 0; w < 7; w++) { const rs = (days[w] || []).filter(r => r && (r.start || r.end)).sort((a, b) => String(a.start).localeCompare(String(b.start)))
      for (let i = 0; i < rs.length; i++) { const r = rs[i]; if (!T5.test(r.start || '') || !T5.test(r.end || '') || r.start >= r.end) return fail(res, 400, `Plage horaire invalide (${['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'][w]})`)
        if (i && rs[i - 1].end > r.start) return fail(res, 400, `Plages qui se chevauchent le ${['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'][w]}`); list.push([w, r.start, r.end]) } }
    await q('delete from doctor_schedules where doctor_id=$1 and clinic_id=$2', [d.id, req.user.clinic_id])
    for (const [w, s, e] of list) await q('insert into doctor_schedules(clinic_id,doctor_id,weekday,start_time,end_time) values($1,$2,$3,$4,$5)', [req.user.clinic_id, d.id, w, s, e])
    await audit(req, 'DOCTOR_SCHEDULE', 'users', d.id, { doctor: d.name, ranges: list.length }); res.json({ ok: true, ranges: list.length }) }))
  app.post('/api/intel/settings', need(), wrap(async (req, res) => { if (!admin(req)) return fail(res, 403, "Réservé à l'administration")
    const b = req.body, cur = await clinicCfg(req.user.clinic_id), T = /^([01]\d|2[0-3]):[0-5]\d$/
    let hours = null; if (b.hours && typeof b.hours === 'object') { hours = {}; for (let w = 0; w < 7; w++) { const h = b.hours[w] ?? b.hours[String(w)]; if (!h) { hours[w] = null; continue } if (!T.test(h.open || '') || !T.test(h.close || '') || h.open >= h.close) return fail(res, 400, `Horaires invalides le ${['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'][w]} : la fermeture doit être après l'ouverture`); hours[w] = { open: h.open, close: h.close } }
      if (!Object.values(hours).some(Boolean)) return fail(res, 400, 'La clinique doit être ouverte au moins un jour') }
    const open = T.test(b.open_time || '') ? b.open_time : cur.open_time, close = T.test(b.close_time || '') ? b.close_time : cur.close_time
    if (open >= close) return fail(res, 400, "L'heure de fermeture doit être après l'ouverture")
    const days = String(b.work_days ?? cur.work_days).split(',').map(Number).filter(d => d >= 0 && d <= 6), chairs = Math.min(50, Math.max(1, parseInt(b.chairs) || cur.chairs))
    if (!days.length) return fail(res, 400, 'Choisissez au moins un jour ouvré')
    const en = b.enabled === undefined ? cur.enabled : !!b.enabled
    await q('update clinics set open_time=$2,close_time=$3,work_days=$4,chairs=$5,intel_enabled=$6,intel_since=case when $6 and not intel_enabled then now() else intel_since end,hours=coalesce($7::jsonb,hours) where id=$1', [req.user.clinic_id, open, close, hours ? Object.keys(hours).filter(w => hours[w]).join(',') : [...new Set(days)].sort().join(','), chairs, en, hours ? JSON.stringify(hours) : null])
    await audit(req, 'INTEL_SETTINGS', 'clinics', req.user.clinic_id, { open, close, days, chairs, enabled: en }); res.json({ ok: true }) }))

  // créneaux conseillés à la prise de rendez-vous (accueil, médecins)
  app.get('/api/intel/slots', need('manage_appointments'), safe(async (req, res) => {
    const cfg = await clinicCfg(req.user.clinic_id); if (!cfg.enabled) return res.json({ enabled: false, slots: [] })
    const doc = req.user.role === 'DENTIST' ? req.user.id : /^[0-9a-f-]{36}$/.test(req.query.doctor_id || '') ? req.query.doctor_id : null; if (!doc) return fail(res, 400, 'Médecin requis')
    res.json({ enabled: true, ...(await suggestSlots(req.user.clinic_id, { doctorId: doc, minutes: req.query.minutes, from: req.query.from, reason: req.query.reason })) }) }))
  // accueil : recommandations sur les rendez-vous et patients à risque d'absence (données administratives seulement)
  app.get('/api/intel/reception', need('manage_appointments'), safe(async (req, res) => {
    const cfg = await clinicCfg(req.user.clinic_id); if (!cfg.enabled) return res.json({ enabled: false })
    const R = await results(req.user.clinic_id), mineOnly = req.user.role === 'DENTIST'
    const risks = (R.noshow?.data?.upcoming || []).filter(r => r.risk >= 25 && (!mineOnly || r.doctor === `${req.user.first_name} ${req.user.last_name}`)).slice(0, 8)
    res.json({ enabled: true, risks, base_rate: R.noshow?.data?.base_rate, recommendations: (R.recommendations?.data || []).filter(x => ['Rendez-vous', "Salle d'attente", 'Fréquentation'].includes(x.area)).slice(0, 4), at: R.recommendations?.at }) }))
}
