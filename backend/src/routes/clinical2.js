import { isAssigned } from '../core/permissions.js'
import { sealJson, openJson, sealText, openExam } from '../lib/protect.js'
const HY = ['toothpaste_brand', 'toothpaste_type', 'fluoride', 'whitening', 'sensitive', 'tartar_control', 'natural', 'brushing_frequency', 'flosses', 'mouthwash', 'other_habits'], BOOL = new Set(['fluoride', 'whitening', 'sensitive', 'tartar_control', 'natural', 'flosses', 'mouthwash'])
export default function (app, { q, need, audit, fail, wrap, clean }) {
  const access = async (req, id) => { const p = /^[0-9a-f-]{36}$/.test(id) ? (await q('select * from patients where id=$1 and clinic_id=$2', [id, req.user.clinic_id])).rows[0] : null
    return p && (req.perms.has('view_all_patients') || (req.perms.has('view_assigned_patients') && await isAssigned(q, p.id, req.user.id))) ? p : null }
  app.get('/api/patients/:id/hygiene', need('view_medical_records'), wrap(async (req, res) => { const p = await access(req, req.params.id); if (!p) return fail(res, 404, 'Accès refusé')
    const r = (await q('select data,updated_at from patient_hygiene where patient_id=$1', [p.id])).rows[0]; res.json({ data: openJson(r?.data) ?? {}, updated_at: r?.updated_at ?? null }) }))
  app.post('/api/patients/:id/hygiene', need('edit_medical_records'), wrap(async (req, res) => { const p = await access(req, req.params.id); if (!p) return fail(res, 404, 'Accès refusé'); const d = {}
    for (const k of HY) if (k in req.body) d[k] = BOOL.has(k) ? req.body[k] === true : clean(req.body[k], 300)
    await q('insert into patient_hygiene(patient_id,clinic_id,data,updated_by) values($1,$2,$3,$4) on conflict(patient_id) do update set data=$3,updated_by=$4,updated_at=now()', [p.id, req.user.clinic_id, sealJson(d), req.user.id])
    await audit(req, 'HYGIENE_UPDATED', 'patient_hygiene', p.id); res.json({ ok: true }) }))
  app.get('/api/patients/:id/exams', need('view_medical_records'), wrap(async (req, res) => { const p = await access(req, req.params.id); if (!p) return fail(res, 404, 'Accès refusé')
    res.json((await q("select e.id,e.examined_at,e.head,e.face,e.atm,e.tongue,e.periodontium,e.tooth_morphology,e.observations,u.first_name||' '||u.last_name doctor from dental_examinations e join users u on u.id=e.doctor_id where e.patient_id=$1 order by e.examined_at desc", [p.id])).rows.map(openExam)) }))
  app.post('/api/patients/:id/exams', need('edit_medical_records'), wrap(async (req, res) => { const p = await access(req, req.params.id); if (!p) return fail(res, 404, 'Accès refusé'); const b = req.body, f = ['head', 'face', 'atm', 'tongue', 'periodontium', 'tooth_morphology', 'observations'].map(k => clean(b[k], 1000))
    if (!f.some(Boolean)) return fail(res, 400, 'Renseignez au moins un champ')   // chaque examen est conservé (historique non modifiable)
    const { rows: [e] } = await q('insert into dental_examinations(clinic_id,patient_id,doctor_id,head,face,atm,tongue,periodontium,tooth_morphology,observations) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) returning id', [req.user.clinic_id, p.id, req.user.id, ...f.map(sealText)])
    await audit(req, 'EXAM_CREATED', 'dental_examinations', e.id, { patient_id: p.id }); res.json(e) }))
}
