// ═══ Chiffrement des données médicales sensibles (AES-256-GCM, authentifié) ═══
// Chiffré dans la base : antécédents médicaux, hygiène, examens dentaires. Chiffrés sur le disque : documents et radiographies.
// Conséquence : une copie volée de la base, des sauvegardes ou de la copie Supabase ne révèle pas le contenu médical.
// Clé dérivée de JWT_SECRET (backend/.env) : ne jamais le changer, et le conserver en lieu sûr avec les sauvegardes.
import crypto from 'crypto'
import fs from 'fs'
import path from 'path'

const KEY = () => { if (!process.env.JWT_SECRET) throw new Error('JWT_SECRET manquant : chiffrement impossible'); return crypto.createHash('sha256').update('dl-data-v1:' + process.env.JWT_SECRET).digest() }
const MAGIC = Buffer.from('DLENC1\n')   // en-tête des fichiers chiffrés
const PFX = 'enc:v1:'                    // préfixe des textes chiffrés

const seal = buf => { const iv = crypto.randomBytes(12), c = crypto.createCipheriv('aes-256-gcm', KEY(), iv), ct = Buffer.concat([c.update(buf), c.final()]); return Buffer.concat([iv, c.getAuthTag(), ct]) }
const open = b => { const d = crypto.createDecipheriv('aes-256-gcm', KEY(), b.subarray(0, 12)); d.setAuthTag(b.subarray(12, 28)); return Buffer.concat([d.update(b.subarray(28)), d.final()]) }

// textes (colonnes) — une valeur non chiffrée (anciennes données) est rendue telle quelle
export const sealText = v => v == null || v === '' || String(v).startsWith(PFX) ? v : PFX + seal(Buffer.from(String(v), 'utf8')).toString('base64')
export const openText = v => typeof v === 'string' && v.startsWith(PFX) ? open(Buffer.from(v.slice(PFX.length), 'base64')).toString('utf8') : v
// objets JSON (colonnes jsonb) : stockés sous la forme { "$enc": "…" }
export const sealJson = o => o && typeof o === 'object' && typeof o.$enc === 'string' ? o : { $enc: seal(Buffer.from(JSON.stringify(o ?? {}), 'utf8')).toString('base64') }
export const openJson = o => { if (typeof o === 'string') { try { o = JSON.parse(o) } catch { return o } } return o && typeof o.$enc === 'string' ? JSON.parse(open(Buffer.from(o.$enc, 'base64')).toString('utf8')) : o }
// fichiers
export const sealFile = buf => buf.subarray(0, MAGIC.length).equals(MAGIC) ? buf : Buffer.concat([MAGIC, seal(buf)])
export const openFile = buf => buf.subarray(0, MAGIC.length).equals(MAGIC) ? open(buf.subarray(MAGIC.length)) : buf
export const EXAM_FIELDS = ['head', 'face', 'atm', 'tongue', 'periodontium', 'tooth_morphology', 'observations']
export const openExam = e => { if (!e) return e; const r = { ...e }; for (const k of EXAM_FIELDS) if (k in r) r[k] = openText(r[k]); return r }

// ── au démarrage : chiffre tout ce qui ne l'est pas encore (idempotent, sans rien perdre) ──
export async function protectExisting(q, storageDir) {
  let rows = 0, files = 0
  for (const t of ['medical_histories', 'patient_hygiene']) {
    for (const r of (await q(`select patient_id, data from ${t} where not (data ? '$enc')`)).rows) { await q(`update ${t} set data=$2 where patient_id=$1`, [r.patient_id, JSON.stringify(sealJson(r.data))]); rows++ } }
  const cond = EXAM_FIELDS.map(k => `(${k} is not null and ${k} <> '' and ${k} not like 'enc:v1:%')`).join(' or ')
  const ex = (await q(`select id, ${EXAM_FIELDS.join(',')} from dental_examinations where ${cond}`)).rows
  if (ex.length) { const { pool } = await import('../db/pool.js'), c = await pool.connect()   // examens immuables : seul le chiffrement du contenu existant est autorisé
    try { await c.query('begin'); await c.query('set local session_replication_role = replica')
      for (const r of ex) { await c.query(`update dental_examinations set ${EXAM_FIELDS.map((k, i) => `${k}=$${i + 2}`).join(',')} where id=$1`, [r.id, ...EXAM_FIELDS.map(k => sealText(r[k]))]); rows++ }
      await c.query('commit') } catch (e) { await c.query('rollback'); throw e } finally { c.release() } }
  const walk = d => fs.existsSync(d) ? fs.readdirSync(d, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]) : []
  for (const f of walk(storageDir)) { const b = fs.readFileSync(f); if (b.subarray(0, MAGIC.length).equals(MAGIC)) continue
    const tmp = f + '.chiffrement'; fs.writeFileSync(tmp, sealFile(b), { mode: 0o600 }); if (!openFile(fs.readFileSync(tmp)).equals(b)) { fs.rmSync(tmp, { force: true }); continue } fs.renameSync(tmp, f); files++ }
  return { rows, files } }
