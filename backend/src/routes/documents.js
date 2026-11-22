import { isAssigned } from '../core/permissions.js'
import express from 'express'; import fs from 'fs/promises'; import path from 'path'; import crypto from 'crypto'; import jwt from 'jsonwebtoken'
import { pipe } from '../lib/pdf.js'
import { sealFile, openFile } from '../lib/protect.js'
const DIR = path.resolve(process.env.STORAGE_DIR || './storage'), UUID = /^[0-9a-f-]{36}$/
const KINDS = ['radiographie', 'photo', 'pdf', 'ordonnance', 'devis', 'consentement', 'plan_signe'], CK = ['treatment_consent', 'prosthesis_quote', 'treatment_plan', 'intervention_authorization']
const TEMPLATES = { treatment_consent: "Je soussigné(e) reconnais avoir été informé(e) par le praticien de mon état bucco-dentaire, du traitement proposé, de ses alternatives, de ses risques et de son coût. J'ai pu poser mes questions et j'accepte de recevoir le traitement.",
  prosthesis_quote: "Je soussigné(e) accepte le devis de prothèse dentaire qui m'a été présenté (type, matériaux, délais et prix) et m'engage à régler les sommes convenues.",
  treatment_plan: "Je soussigné(e) approuve le plan de traitement qui m'a été présenté (interventions, nombre de séances et coût estimé) et comprends qu'il peut être ajusté selon l'évolution clinique.",
  intervention_authorization: "Je soussigné(e) autorise le praticien à réaliser l'intervention décrite après m'avoir expliqué son déroulement, ses risques et ses suites." }
const sniff = b => b.length > 12 && (b.subarray(0, 4).toString('latin1') === '%PDF' ? 'application/pdf' : b[0] === 0xff && b[1] === 0xd8 ? 'image/jpeg' : b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) ? 'image/png' : b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP' ? 'image/webp' : null) || null
const sha = b => crypto.createHash('sha256').update(b).digest('hex')
export default function (app, { q, need, audit, fail, wrap, clean }) {
  const access = async (req, id) => { const p = UUID.test(id) ? (await q('select * from patients where id=$1 and clinic_id=$2', [id, req.user.clinic_id])).rows[0] : null
    return p && (req.perms.has('view_all_patients') || (req.perms.has('view_assigned_patients') && await isAssigned(q, p.id, req.user.id))) ? p : null }
  app.get('/api/consent-templates', need('view_medical_records'), (req, res) => res.json(TEMPLATES))
  app.post('/api/patients/:id/documents', ...need('edit_medical_records'), express.raw({ type: 'application/octet-stream', limit: '10mb' }), wrap(async (req, res) => {
    const p = await access(req, req.params.id); if (!p) return fail(res, 404, 'Accès refusé'); const kind = String(req.headers['x-doc-kind'] || '')
    if (!KINDS.includes(kind) || !Buffer.isBuffer(req.body) || !req.body.length) return fail(res, 400, 'Fichier ou type invalide')
    const mime = sniff(req.body); if (!mime) return fail(res, 415, 'Format non accepté (PDF, JPEG, PNG ou WebP uniquement)')
    let name = 'document'; try { name = clean(decodeURIComponent(String(req.headers['x-file-name'] || 'document')).replace(/[\\/\x00-\x1f]/g, '_'), 120) || 'document' } catch {}
    const key = `${req.user.clinic_id}/${crypto.randomUUID()}`; await fs.mkdir(path.join(DIR, req.user.clinic_id), { recursive: true }); await fs.writeFile(path.join(DIR, key), sealFile(req.body), { mode: 0o600 })   // chiffré sur le disque
    const { rows: [d] } = await q('insert into documents(clinic_id,patient_id,kind,original_name,mime,size,sha256,storage_key,uploaded_by,consultation_id) values($1,$2,$3,$4,$5,$6,$7,$8,$9,(select id from consultations where id::text=$10 and patient_id=$2)) returning id', [req.user.clinic_id, p.id, kind, name, mime, req.body.length, sha(req.body), key, req.user.id, String(req.headers['x-consultation-id'] || '')])
    await audit(req, 'DOCUMENT_UPLOADED', 'documents', d.id, { patient_id: p.id, kind }); res.json(d) }))
  app.get('/api/patients/:id/documents', need('view_medical_records'), wrap(async (req, res) => { const p = await access(req, req.params.id); if (!p) return fail(res, 404, 'Accès refusé')
    res.json((await q("select d.id,d.kind,d.original_name,d.mime,d.size,d.created_at,d.consultation_id,c.reason consultation_reason,c.consulted_at,u.first_name||' '||u.last_name by from documents d left join users u on u.id=d.uploaded_by left join consultations c on c.id=d.consultation_id where d.patient_id=$1 and d.archived_at is null order by d.created_at desc", [p.id])).rows) }))
  const docOf = async (req) => { const d = UUID.test(req.params.id) ? (await q('select * from documents where id=$1 and clinic_id=$2 and archived_at is null', [req.params.id, req.user.clinic_id])).rows[0] : null; return d && (await access(req, d.patient_id)) ? d : null }
  app.get('/api/documents/:id/link', need('view_medical_records'), wrap(async (req, res) => { const d = await docOf(req); if (!d) return fail(res, 404, 'Introuvable')   // accès temporaire : 5 minutes, lié à l'utilisateur
    await audit(req, 'DOCUMENT_LINK', 'documents', d.id); res.json({ url: '/api/files/' + jwt.sign({ d: d.id, u: req.user.id }, process.env.JWT_SECRET, { expiresIn: '5m' }), mime: d.mime, name: d.original_name }) }))
  app.get('/api/files/:token', need('view_medical_records'), wrap(async (req, res) => {
    let t; try { t = jwt.verify(req.params.token, process.env.JWT_SECRET) } catch { return fail(res, 410, 'Lien expiré') }
    if (t.u !== req.user.id) return fail(res, 403, 'Lien non valable pour cet utilisateur'); req.params.id = t.d; const d = await docOf(req); if (!d) return fail(res, 404, 'Introuvable')
    const buf = openFile(await fs.readFile(path.join(DIR, d.storage_key))); if (sha(buf) !== d.sha256) return fail(res, 500, 'Intégrité du fichier compromise')
    await audit(req, 'DOCUMENT_VIEWED', 'documents', d.id); res.set({ 'Content-Type': d.mime, 'Content-Disposition': `inline; filename="${encodeURIComponent(d.original_name)}"`, 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' }).send(buf) }))
  app.post('/api/documents/:id/archive', need('edit_medical_records'), wrap(async (req, res) => { const d = await docOf(req); if (!d) return fail(res, 404, 'Introuvable')
    await q('update documents set archived_at=now() where id=$1', [d.id]); await audit(req, 'DOCUMENT_ARCHIVED', 'documents', d.id); res.json({ ok: true }) }))   // jamais de suppression physique

  app.post('/api/patients/:id/consents', need('edit_medical_records'), wrap(async (req, res) => {
    const p = await access(req, req.params.id); if (!p) return fail(res, 404, 'Accès refusé'); const b = req.body, signer = clean(b.signer_name, 120), body = clean(b.body, 5000)
    const m = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(b.signature || ''); if (!CK.includes(b.kind) || !signer || !body || body.length < 20 || !m) return fail(res, 400, 'Consentement incomplet (type, texte, nom du signataire et signature requis)')
    const sig = Buffer.from(m[1], 'base64'); if (sig.length > 300000 || sniff(sig) !== 'image/png') return fail(res, 400, 'Signature invalide')
    const at = new Date().toISOString(), hash = sha(JSON.stringify({ p: p.id, k: b.kind, body, signer, at, sig: sha(sig) }))
    const link = async (tbl, id) => UUID.test(id || '') && (await q(`select 1 from ${tbl} where id=$1 and clinic_id=$2 and patient_id=$3`, [id, req.user.clinic_id, p.id])).rowCount ? id : null
    const { rows: [c] } = await q('insert into patient_consents(clinic_id,patient_id,kind,plan_id,prosthesis_id,body,signer_name,signature,collected_by,signed_at,integrity_hash) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) returning id,integrity_hash',
      [req.user.clinic_id, p.id, b.kind, await link('treatment_plans', b.plan_id), await link('prostheses', b.prosthesis_id), body, signer, sig, req.user.id, at, hash])
    await audit(req, 'CONSENT_SIGNED', 'patient_consents', c.id, { patient_id: p.id, kind: b.kind }); res.json(c) }))
  app.get('/api/patients/:id/consents', need('view_medical_records'), wrap(async (req, res) => { const p = await access(req, req.params.id); if (!p) return fail(res, 404, 'Accès refusé')
    res.json((await q("select c.id,c.kind,c.signer_name,c.signed_at,c.integrity_hash,u.first_name||' '||u.last_name collected_by from patient_consents c join users u on u.id=c.collected_by where c.patient_id=$1 order by c.signed_at desc", [p.id])).rows) }))
  app.get('/api/consents/:id/pdf', need('view_medical_records'), wrap(async (req, res) => {
    const c = UUID.test(req.params.id) ? (await q('select c.*,u.first_name||\' \'||u.last_name collector,p.last_name||\' \'||p.first_name patient,p.file_number from patient_consents c join users u on u.id=c.collected_by join patients p on p.id=c.patient_id where c.id=$1 and c.clinic_id=$2', [req.params.id, req.user.clinic_id])).rows[0] : null
    if (!c || !(await access(req, c.patient_id))) return fail(res, 404, 'Introuvable'); const cl = (await q('select name,address,phone from clinics where id=$1', [req.user.clinic_id])).rows[0]
    const T = { treatment_consent: 'CONSENTEMENT À UN TRAITEMENT', prosthesis_quote: 'ACCEPTATION DE DEVIS DE PROTHÈSE', treatment_plan: 'APPROBATION DU PLAN DE TRAITEMENT', intervention_authorization: "AUTORISATION D'INTERVENTION" }
    await audit(req, 'CONSENT_PDF', 'patient_consents', c.id)
    pipe(res, 'consentement-' + c.file_number, d => { d.fontSize(18).fillColor('#1d6fd8').text(cl.name).fontSize(9).fillColor('#444').text(`${cl.address || ''} · ${cl.phone || ''}`).moveDown()
      d.fontSize(14).fillColor('#000').text(T[c.kind]).moveDown(.5).fontSize(10).text(`Patient : ${c.patient} (${c.file_number})`).moveDown().text(c.body, { align: 'justify' }).moveDown()
      d.text(`Signataire : ${c.signer_name}`).text(`Date de signature : ${new Date(c.signed_at).toLocaleString('fr-FR', { timeZone: 'America/Port-au-Prince' })}`).text(`Recueilli par : ${c.collector}`).moveDown(.5).text('Signature :'); d.image(c.signature, { width: 200 }); d.moveDown().fontSize(7).fillColor('#666').text(`Empreinte d'intégrité (SHA-256) : ${c.integrity_hash}`) }) }))
}
