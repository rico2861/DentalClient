// Base de données EMBARQUÉE : PGlite = PostgreSQL complet exécuté dans Node.js.
// Aucun serveur ni logiciel à installer. Les données sont dans backend/data/db (DB_DIR pour changer).
import fs from 'fs'
import net from 'net'
import { PGlite } from '@electric-sql/pglite'
import { AsyncLocalStorage } from 'async_hooks'
import { config } from '../config/env.js'
import { applyPendingRestore } from '../lib/backup-restore.js'

const dir = config.dbDir
// Une base embarquée ne supporte qu'UN programme à la fois : si le port du serveur est déjà pris (DENTAL tourne
// déjà, souvent dans une autre fenêtre), on s'arrête AVANT d'ouvrir la base, pour ne jamais l'abîmer.
if (!dir.startsWith('memory://') && process.env.DL_SKIP_PORT_CHECK !== '1') {
  const busy = await new Promise(res => { const t = net.createServer(); t.once('error', e => res(e.code === 'EADDRINUSE')); t.once('listening', () => t.close(() => res(false))); t.listen(config.port, process.env.HOST || '0.0.0.0') })
  if (busy) { console.error(`\n✖ Le port ${config.port} est déjà utilisé : DENTAL tourne probablement déjà (ouvrez http://localhost:${config.port}).\n  La base n'a pas été ouverte (une seule instance à la fois, pour ne pas l'abîmer).\n  Pour relancer ici : fermez l'autre fenêtre du serveur (ou Ctrl+C dedans), puis refaites : npm start\n`); process.exit(1) } }
if (!dir.startsWith('memory://')) fs.mkdirSync(dir, { recursive: true })
// restauration demandée depuis l'application : appliquée ici, au démarrage, avant d'ouvrir la base
const restored = dir.startsWith('memory://') ? null : await applyPendingRestore(dir)

// Mêmes types de retour que le module « pg » : bigint et numeric en chaînes, date en minuit local.
let db
try {
  db = new PGlite(dir, { ...(restored ? { loadDataDir: restored } : {}), parsers: {
    20: v => v,
    1700: v => v,
    1082: v => { const [y, m, d] = v.split('-').map(Number); return new Date(y, m - 1, d) }
  } })
  await db.waitReady
  // fuseau horaire de la clinique : « aujourd'hui », les totaux du jour et du mois suivent l'heure d'Haïti, pas l'heure UTC
  await db.exec("set timezone to '" + String(process.env.CLINIC_TZ || 'America/Port-au-Prince').replace(/'/g, '') + "'")
} catch (e) {
  // base illisible (souvent après un arrêt brutal) : message clair et procédure de récupération, rien n'est modifié
  console.error('\n✖ La base de données ne s\'ouvre pas (' + (e.message || e) + ').')
  console.error('  Cela arrive après un arrêt brutal pendant une écriture (coupure de courant, fenêtre fermée…).')
  console.error('  Pour repartir de la dernière sauvegarde vérifiée (rien n\'est supprimé, la base actuelle est mise de côté) :')
  console.error('      npm run restaurer')
  console.error('      npm start\n')
  process.exit(1)
}

const norm = v => v === undefined ? null
  : v instanceof Date ? v.toISOString()
  : (v && typeof v === 'object' && !Array.isArray(v) && !ArrayBuffer.isView(v)) ? JSON.stringify(v) : v

async function run(text, params) {
  let r
  if (params === undefined || params === null) { const rs = await db.exec(text); r = rs[rs.length - 1] || { rows: [] } }
  else r = await db.query(text, params.map(norm))
  const rows = r.rows || []
  return { rows, rowCount: r.affectedRows > 0 ? r.affectedRows : rows.length, fields: r.fields }
}

// Auteur de la requête en cours (utilisateur, poste, motif) : transmis à la base avant chaque requête ou transaction,
// pour que l'historique des modifications (migration 027) sache QUI a modifié et POURQUOI. Hors requête : « Système ».
export const actorCtx = new AsyncLocalStorage()
let lastTag = null
const tagActor = async () => { const a = actorCtx.getStore(), t = a ? JSON.stringify({ id: a.id, n: a.n, ip: a.ip, r: a.r || '' }) : JSON.stringify({ n: 'Système' })
  if (t !== lastTag) { await db.query("select set_config('dl.actor', $1, false)", [t]); lastTag = t } }
// Une seule connexion : les requêtes (et chaque transaction) passent l'une après l'autre.
let tail = Promise.resolve()
const acquire = () => { let release; const prev = tail; tail = new Promise(r => { release = r }); return prev.then(() => release) }

export const pool = {
  async query(text, params) { const release = await acquire(); try { await tagActor(); return await run(text, params) } finally { release() } },
  async connect() { const release = await acquire(); try { await tagActor() } catch {} let open = true; return { query: run, release() { if (open) { open = false; release() } } } },
  async end() { const release = await acquire(); try { await db.close() } finally { release() } }
}
export const q = (text, params) => pool.query(text, params)
// copie complète et cohérente de la base (aucune requête ne passe pendant l'export)
export const dumpDb = async () => { const release = await acquire(); try { return await db.dumpDataDir('gzip') } finally { release() } }
// même copie + position exacte du journal des transactions au même instant (la valeur stockée dans la copie est pré-allouée)
export const dumpDbWithLsn = async (countTables = []) => { const release = await acquire(); try { let lsn = null; const counts = {}
    // comptages faits sous le même verrou que la copie : aucune écriture ne peut se glisser entre les deux
    for (const t of countTables) { try { counts[t] = Number((await run(`select count(*)::int n from ${t}`, [])).rows[0].n) } catch {} }
    try { const r = (await run('select last_value, is_called from dl_changelog_lsn_seq', [])).rows[0]; lsn = r.is_called ? Number(r.last_value) : Number(r.last_value) - 1 } catch {} return { blob: await db.dumpDataDir('gzip'), lsn, counts } } finally { release() } }
