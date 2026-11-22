// Sauvegardes : base complète (copie cohérente) + documents/images, VÉRIFIÉES avant d'être déclarées réussies.
// Chaque sauvegarde = un dossier backups/<id>/ contenant db.tar.gz, storage/ et manifest.json.
// Documents : les fichiers inchangés depuis la sauvegarde précédente sont des liens physiques (aucune place en plus),
// seuls les nouveaux ou modifiés sont copiés. Conservation intelligente (voir applyRetention).
import fs from 'fs'
import path from 'path'
import { PGlite } from '@electric-sql/pglite'
import { config } from '../config/env.js'
import { q, dumpDbWithLsn } from '../db/pool.js'
import { BDIR, MARKER, LOG, sha256, readJson, journal } from './backup-restore.js'
import { indexSnapshot, afterFull, afterFullWritten, mirrorRemove, pruneChain } from './backup-plus.js'

const SETTINGS = () => path.join(BDIR(), 'reglages.json')
const COUNTED = ['users', 'employees', 'patients', 'medical_histories', 'consultations', 'tooth_states', 'treatment_plans', 'treatment_plan_items', 'appointments', 'documents', 'prostheses', 'invoices', 'invoice_items', 'payments', 'expenses', 'cash_movements', 'payroll_records', 'commission_payments', 'stock_movements', 'tariffs', 'audit_logs']
export const FREQ = { '1h': 1, '6h': 6, daily: 24, weekly: 168 }
export const getSettings = () => ({ auto: true, frequency: 'daily', weekly: true, weekly_keep: 12, retention_days: 30, keep_min: 5, diff_hours: 6, log_minutes: 15, mirror_dir: '', ...readJson(SETTINGS(), {}) })
export const DIFF_H = [0, 1, 2, 4, 6, 12], LOG_M = [0, 5, 15, 30, 60]
export const saveSettings = s => { fs.mkdirSync(BDIR(), { recursive: true }); const cur = getSettings()
  const next = { auto: s.auto === undefined ? cur.auto : !!s.auto, frequency: FREQ[s.frequency] ? s.frequency : cur.frequency, weekly: s.weekly === undefined ? cur.weekly : !!s.weekly, weekly_keep: Math.min(520, Math.max(1, parseInt(s.weekly_keep) || cur.weekly_keep)), retention_days: Math.min(3650, Math.max(1, parseInt(s.retention_days) || cur.retention_days)), keep_min: cur.keep_min,
    diff_hours: s.diff_hours !== undefined && DIFF_H.includes(Number(s.diff_hours)) ? Number(s.diff_hours) : cur.diff_hours, log_minutes: s.log_minutes !== undefined && LOG_M.includes(Number(s.log_minutes)) ? Number(s.log_minutes) : cur.log_minutes, mirror_dir: s.mirror_dir !== undefined ? String(s.mirror_dir) : cur.mirror_dir }
  fs.writeFileSync(SETTINGS(), JSON.stringify(next, null, 1)); return next }
const counts = async run => { const o = {}; for (const t of COUNTED) { try { o[t] = Number((await run(`select count(*)::int n from ${t}`)).rows[0].n) } catch {} } return o }
const walkFiles = d => { const out = []; const w = (p, rel) => { for (const e of fs.readdirSync(p, { withFileTypes: true })) { const f = path.join(p, e.name), r = rel ? rel + '/' + e.name : e.name; if (e.isDirectory()) w(f, r); else if (!e.name.endsWith('.chiffrement')) out.push(r) } }; if (fs.existsSync(d)) w(d, ''); return out }
const freeBytes = d => { try { const s = fs.statfsSync(d); return s.bavail * s.bsize } catch { return Infinity } }
const MB = n => Math.round(n / 1048576)

// copie des documents : liste figée au départ ; fichier identique (taille + date) dans la sauvegarde précédente → lien physique
function copyStorage(src, dest, prevDir) { const files = walkFiles(src); let linked = 0, copied = 0, size = 0
  for (const rel of files) { const s = path.join(src, ...rel.split('/')), d = path.join(dest, ...rel.split('/')); let st; try { st = fs.statSync(s) } catch { continue }   // supprimé pendant la copie
    fs.mkdirSync(path.dirname(d), { recursive: true }); size += st.size
    const p = prevDir && path.join(prevDir, ...rel.split('/'))
    if (p) { try { const ps = fs.statSync(p); if (ps.size === st.size && Math.abs(ps.mtimeMs - st.mtimeMs) < 2) { fs.linkSync(p, d); linked++; continue } } catch {} }
    fs.copyFileSync(s, d); fs.utimesSync(d, st.atime, st.mtime); copied++ }   // date d'origine conservée : permet le lien la prochaine fois
  return { files: linked + copied, linked, copied, size, expected: files.length } }

// une sauvegarde à la fois ; une demande identique pendant qu'une autre tourne réutilise la même, sinon elle attend son tour
let running = null, runningKey = null
export function createBackup({ kind = 'manuelle', by = null, partial = false } = {}) {
  const key = kind + (partial ? ':p' : '')
  if (running && runningKey === key && kind !== 'avant-restauration') return running
  const prev = running || Promise.resolve()
  const job = prev.catch(() => {}).then(() => { runningKey = key; return doBackup(kind, by, partial) }).finally(() => { if (running === job) { running = null; runningKey = null } })
  running = job; return job }
async function doBackup(kind, by, partial = false) {
  // nom unique à la milliseconde : une sauvegarde ne peut jamais en écraser une autre
  let id = new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, 23) + '_' + kind.slice(0, 4), dir = path.join(BDIR(), id)
  for (let i = 2; fs.existsSync(dir); i++) { id = id.replace(/(-\d+)?$/, '') + '-' + i; dir = path.join(BDIR(), id) }
  try {
    // place disque : au moins 2 fois la dernière sauvegarde (ou 200 Mo), vérifiée avant de commencer
    const last = listBackups()[0], need = Math.max(200 * 1048576, 2 * ((last?.db_size || 0) + (partial ? 0 : (last?.files_new_size ?? last?.files_size ?? 0))))
    fs.mkdirSync(BDIR(), { recursive: true }); const free = freeBytes(BDIR()); if (free < need) throw new Error(`Espace disque insuffisant : ${MB(free)} Mo libres, ${MB(need)} Mo nécessaires. Libérez de la place ou réduisez la durée de conservation.`)
    fs.mkdirSync(dir, { recursive: true })
    const { blob, lsn, counts: live } = await dumpDbWithLsn(COUNTED), snapAt = new Date().toISOString(), buf = Buffer.from(await blob.arrayBuffer())
    fs.writeFileSync(path.join(dir, 'db.tar.gz'), buf)
    const prevStore = !partial && listBackups().find(b => !b.partial && fs.existsSync(path.join(BDIR(), b.id, 'storage')))
    const st = partial ? { files: 0, linked: 0, copied: 0, size: 0, expected: 0 } : copyStorage(config.storageDir, path.join(dir, 'storage'), prevStore && path.join(BDIR(), prevStore.id, 'storage'))
    // VÉRIFICATION : le fichier écrit est relu, rechargé dans une base temporaire, puis recompté
    const written = fs.readFileSync(path.join(dir, 'db.tar.gz')), hash = sha256(written); if (hash !== sha256(buf)) throw new Error('Écriture du fichier de sauvegarde incorrecte')
    const tmp = new PGlite({ loadDataDir: new Blob([written]) }); await tmp.waitReady
    const back = await counts(t => tmp.query(t)), ix = await indexSnapshot(tmp); ix.lsn = lsn; await tmp.close()   // empreinte de chaque ligne : base des différentielles
    const diff = COUNTED.filter(t => t in live && back[t] !== live[t]); if (diff.length) throw new Error('Contenu différent après rechargement : ' + diff.join(', '))
    if (!partial && walkFiles(path.join(dir, 'storage')).length !== st.files) throw new Error(`Documents incomplets (${walkFiles(path.join(dir, 'storage')).length}/${st.files})`)
    const seq = (readJson(path.join(BDIR(), 'sequence.json'), { n: listBackups().length }).n || 0) + 1
    const man = { id, seq, kind, by, created_at: snapAt, db_size: written.length, db_sha256: hash, files: st.files, files_size: st.size, files_new_size: partial ? 0 : st.size - 0, files_linked: st.linked, files_copied: st.copied, counts: back, verified: true, ...(partial ? { partial: true } : {}) }
    if (!partial) { let ns = 0; for (const rel of walkFiles(path.join(dir, 'storage'))) { try { if (fs.statSync(path.join(dir, 'storage', ...rel.split('/'))).nlink <= 1) ns += fs.statSync(path.join(dir, 'storage', ...rel.split('/'))).size } catch {} } man.files_new_size = ns }   // place réellement occupée
    afterFull(man, dir, ix)
    fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(man, null, 1))
    fs.writeFileSync(path.join(BDIR(), 'sequence.json'), JSON.stringify({ n: seq }))
    try { await afterFullWritten(man) } catch (x) { journal({ op: 'mirror', id, ok: false, error: x.message }) }
    journal({ op: 'backup', id, kind, by, ok: true, size: written.length + man.files_new_size, linked: st.linked })
    const removed = applyRetention(); return { ...man, removed }
  } catch (e) {
    try { fs.rmSync(dir, { recursive: true, force: true }) } catch {}   // jamais de sauvegarde incomplète laissée comme « valable »
    journal({ op: 'backup', id, kind, by, ok: false, error: e.message })
    try { const c = (await q('select id from clinics limit 1')).rows[0]; if (c) await q("insert into notifications(clinic_id,perm,kind,title,text) values($1,'view_audit_logs','backup_failed','Échec de la sauvegarde',$2)", [c.id, e.message]) } catch {}
    throw e
  }
}
export const listBackups = () => { if (!fs.existsSync(BDIR())) return []
  return fs.readdirSync(BDIR(), { withFileTypes: true }).filter(d => d.isDirectory()).map(d => readJson(path.join(BDIR(), d.name, 'manifest.json'), null)).filter(Boolean).sort((a, b) => b.created_at.localeCompare(a.created_at)) }

// conservation intelligente :
//  · les N plus récentes sont toujours gardées ;
//  · moins de 48 h : tout est gardé ; de 48 h à « durée de conservation » : une seule par jour (la plus récente) ;
//  · hebdomadaires : gardées « N semaines » ; sauvegardes de sécurité (avant / après restauration) : les 5 dernières, 90 jours maximum ;
//  · anciens dossiers « .avant-restauration » de la base et des documents : supprimés après 30 jours (les 2 derniers sont gardés).
export function applyRetention() { const s = getSettings(), all = listBackups(), now = Date.now(), removed = [], keep = new Set(all.slice(0, s.keep_min).map(b => b.id)), days = new Set()
  let safety = 0
  for (const b of all) { const age = now - new Date(b.created_at).getTime(), day = String(b.created_at).slice(0, 10); let ok
    if (keep.has(b.id)) ok = true
    else if (['avant-restauration', 'apres-restauration'].includes(b.kind)) ok = ++safety <= 5 && age < 90 * 864e5
    else if (b.kind === 'hebdomadaire') ok = age < s.weekly_keep * 7 * 864e5
    else if (age < 2 * 864e5) ok = true
    else ok = age < s.retention_days * 864e5 && !days.has(day + (b.partial ? 'p' : ''))
    if (!['avant-restauration', 'apres-restauration', 'hebdomadaire'].includes(b.kind)) days.add(day + (b.partial ? 'p' : ''))
    if (!ok) { fs.rmSync(path.join(BDIR(), b.id), { recursive: true, force: true }); mirrorRemove(b.id); removed.push(b.id) } }
  if (removed.length) journal({ op: 'retention', ok: true, removed })
  // anciennes copies mises de côté par les restaurations
  try { for (const base of [config.dbDir, config.storageDir]) { const parent = path.dirname(base), pre = path.basename(base) + '.avant-restauration-'
      const old = fs.readdirSync(parent).filter(n => n.startsWith(pre)).sort().reverse().slice(2).filter(n => { try { return now - fs.statSync(path.join(parent, n)).mtimeMs > 30 * 864e5 } catch { return false } })
      for (const n of old) { fs.rmSync(path.join(parent, n), { recursive: true, force: true }); journal({ op: 'retention', ok: true, removed: [n], note: 'ancienne copie mise de côté par une restauration (plus de 30 jours)' }) } } } catch {}
  try { pruneChain() } catch {} return removed }
export const backupPath = id => { const b = listBackups().find(x => x.id === id); return b ? path.join(BDIR(), b.id) : null }
export const journalEntries = () => readJson(LOG(), [])
export const pendingRestore = () => readJson(MARKER(), null)
export async function requestRestore(id, by) {
  const b = listBackups().find(x => x.id === id); if (!b || !b.verified) throw new Error('Sauvegarde introuvable ou non vérifiée')
  const buf = fs.readFileSync(path.join(BDIR(), b.id, 'db.tar.gz')); if (sha256(buf) !== b.db_sha256) throw new Error('Fichier de sauvegarde altéré : restauration refusée')
  const safety = await createBackup({ kind: 'avant-restauration', by })   // sauvegarde de sécurité complète de l'état actuel
  fs.writeFileSync(MARKER(), JSON.stringify({ id: b.id, by, requested_at: new Date().toISOString(), safety: safety.id }, null, 1))
  journal({ op: 'restore_requested', id: b.id, by, ok: true, safety: safety.id }); return { id: b.id, safety: safety.id } }
export function cancelRestore(by) { const m = pendingRestore(); if (!m) return false; fs.rmSync(MARKER(), { force: true }); journal({ op: 'restore_cancelled', id: m.id, by, ok: true }); return true }
// sauvegarde automatique (vérifiée toutes les 10 minutes)
export function startScheduler() {
  const tick = async () => { try { const s = getSettings(); if (!s.auto) return; const all = listBackups(), age = k => { const b = all.find(x => x.kind === k); return b ? Date.now() - new Date(b.created_at).getTime() : Infinity }
    // hebdomadaire complète (conservée plus longtemps), puis sauvegarde périodique selon la fréquence choisie
    if (s.weekly && age('hebdomadaire') > 7 * 864e5 - 18e5) { await createBackup({ kind: 'hebdomadaire', by: 'automatique' }); return }
    if (age('auto') > FREQ[s.frequency || 'daily'] * 36e5 - 18e5) await createBackup({ kind: 'auto', by: 'automatique' }) } catch (e) { console.error('Sauvegarde automatique échouée :', e.message) } }
  setTimeout(tick, 60e3); return setInterval(tick, 10 * 60e3)
}
