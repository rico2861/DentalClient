// Restauration d'une sauvegarde : appliquée au DÉMARRAGE du serveur, avant l'ouverture de la base.
// Rien n'est supprimé : la base et les documents actuels sont mis de côté (dossiers « .avant-restauration-<date> »).
import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import { config } from '../config/env.js'

export const BDIR = () => config.backupDir
export const MARKER = () => path.join(BDIR(), 'RESTORE.json')
export const LOG = () => path.join(BDIR(), 'journal.json')
export const sha256 = buf => crypto.createHash('sha256').update(buf).digest('hex')
export const readJson = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')) } catch { return d } }
// journal des opérations (sauvegardes, vérifications, restaurations) — conservé à côté des sauvegardes
export const journal = entry => { try { fs.mkdirSync(BDIR(), { recursive: true }); const l = readJson(LOG(), []); l.unshift({ at: new Date().toISOString(), ...entry }); fs.writeFileSync(LOG(), JSON.stringify(l.slice(0, 3000), null, 1)) } catch {} }

export async function applyPendingRestore(dbDir) {
  const m = readJson(MARKER(), null); if (!m) return null
  const stamp = new Date().toISOString().replace(/[:.]/g, '-'), src = path.join(BDIR(), String(m.id).replace(/[^\w.-]/g, ''))
  const undo = []   // retour arrière : en cas d'échec, tout est remis exactement en place
  try {
    const man = readJson(path.join(src, 'manifest.json'), null); if (!man) throw new Error('Sauvegarde introuvable : ' + m.id)
    const buf = fs.readFileSync(path.join(src, 'db.tar.gz')); if (sha256(buf) !== man.db_sha256) throw new Error('Empreinte de la sauvegarde incorrecte : fichier altéré')
    // documents et images : les actuels sont mis de côté, ceux de la sauvegarde sont copiés
    const st = config.storageDir, bst = path.join(src, 'storage'), stBak = `${st}.avant-restauration-${stamp}`
    if (fs.existsSync(bst)) {
      if (fs.existsSync(st)) { fs.renameSync(st, stBak); undo.push(() => { fs.rmSync(st, { recursive: true, force: true }); fs.renameSync(stBak, st) }) }
      else undo.push(() => fs.rmSync(st, { recursive: true, force: true }))
      fs.cpSync(bst, st, { recursive: true }) }
    // base actuelle mise de côté (jamais supprimée) ; la sauvegarde sera chargée dans un dossier vide
    const dbBak = `${dbDir}.avant-restauration-${stamp}`
    if (fs.existsSync(dbDir) && fs.readdirSync(dbDir).length) { fs.renameSync(dbDir, dbBak); undo.push(() => { fs.rmSync(dbDir, { recursive: true, force: true }); fs.renameSync(dbBak, dbDir) }) }
    fs.mkdirSync(dbDir, { recursive: true })
    fs.rmSync(MARKER(), { force: true })
    // nouvelle chaîne de sauvegarde (les journaux d'avant restent liés aux anciennes complètes)
    try { const ci = path.join(BDIR(), '_chaine', 'index.json'), c = readJson(ci, null); if (c) { c.epoch = (c.epoch || 1) + 1; c.cursor = null; fs.writeFileSync(ci, JSON.stringify(c, null, 1)) } } catch {}
    journal({ op: 'restore_applied', id: m.id, by: m.by, ok: true, note: `Base et documents précédents conservés dans « .avant-restauration-${stamp} »` })
    console.log(`Restauration de la sauvegarde ${m.id} appliquée. Ancienne base conservée : ${dbDir}.avant-restauration-${stamp}`)
    return new Blob([buf])
  } catch (e) {
    for (const f of undo.reverse()) { try { f() } catch (u) { console.error('Retour arrière incomplet :', u.message) } }
    try { fs.renameSync(MARKER(), path.join(BDIR(), `RESTORE.echec-${stamp}.json`)) } catch {}
    journal({ op: 'restore_failed', id: m.id, by: m.by, ok: false, error: e.message })
    console.error('Restauration annulée, la base actuelle est conservée :', e.message)
    return null
  }
}
