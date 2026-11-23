// Couche base de données — DEUX modes, même interface (pool.query / pool.connect / q).
//
//  • PGlite EMBARQUÉ (défaut, mode bureau) : PostgreSQL complet dans Node.js, aucun
//    serveur à installer, données dans backend/data/db (DB_DIR). Une seule connexion,
//    requêtes sérialisées. Inchangé tant que DATABASE_URL n'est pas défini.
//  • Postgres/SUPABASE (mode instance web partagée) : activé par DATABASE_URL
//    (ou CLINIC_DB_URL). Toutes les tables du clinique vivent dans un SCHÉMA DÉDIÉ
//    (DB_SCHEMA, défaut « app ») — isolé du schéma « saas » de BackendDental, donc
//    aucune collision (clinics/payments/users) et aucune requête à réécrire.
//
// Dans les deux cas : mêmes types de retour que « pg » (bigint/numeric en chaînes,
// date à minuit local), même contexte d'auteur (dl.actor) pour l'historique.
import fs from 'fs'
import net from 'net'
import { AsyncLocalStorage } from 'async_hooks'
import { config } from '../config/env.js'
import { applyPendingRestore } from '../lib/backup-restore.js'

// Auteur de la requête en cours (utilisateur, poste, motif) : transmis à la base avant
// chaque requête, pour que l'historique des modifications sache QUI et POURQUOI.
export const actorCtx = new AsyncLocalStorage()
const actorTag = () => { const a = actorCtx.getStore(); return a ? JSON.stringify({ id: a.id, n: a.n, ip: a.ip, r: a.r || '' }) : JSON.stringify({ n: 'Système' }) }

// Conversion des paramètres (identique pour les deux moteurs) :
// Date → ISO (timestamptz), objet → JSON (jsonb), undefined → null.
const norm = v => v === undefined ? null
  : v instanceof Date ? v.toISOString()
  : (v && typeof v === 'object' && !Array.isArray(v) && !ArrayBuffer.isView(v)) ? JSON.stringify(v) : v

const DB_URL = process.env.DATABASE_URL || process.env.CLINIC_DB_URL || ''
const TZ = String(process.env.CLINIC_TZ || 'America/Port-au-Prince').replace(/'/g, '')

export let pool, q, dumpDb, dumpDbWithLsn

if (DB_URL) {
  // ─────────────────────────── MODE POSTGRES / SUPABASE ───────────────────────────
  const SCHEMA = (process.env.DB_SCHEMA || 'app').replace(/[^a-z0-9_]/gi, '').toLowerCase() || 'app'
  const { default: pg } = await import('pg')
  // bigint (20) et numeric (1700) en chaînes, comme PGlite (évite la perte de précision)
  pg.types.setTypeParser(20, v => v)
  pg.types.setTypeParser(1700, v => v)
  // date (1082) → Date à minuit LOCAL (et non UTC), comme PGlite
  pg.types.setTypeParser(1082, v => { const [y, m, d] = v.split('-').map(Number); return new Date(y, m - 1, d) })

  const ssl = /supabase|railway|render|amazonaws|neon|heroku/.test(DB_URL) ? { rejectUnauthorized: false } : undefined
  // Render ne route pas l'IPv6 : préférer l'IPv4 (et utiliser le POOLER Supabase, qui est en IPv4).
  try { (await import('node:dns')).setDefaultResultOrder('ipv4first') } catch {}
  // search_path + fuseau passés au démarrage de connexion (côté serveur, aucune course)
  const options = `-c search_path=${SCHEMA},public -c timezone=${TZ}`
  const pg_pool = new pg.Pool({ connectionString: DB_URL, ssl, options, max: Number(process.env.DB_POOL_MAX) || 8 })
  pg_pool.on('error', e => console.error('Pool Postgres :', e.message))
  // Filet de sécurité : certains poolers (pgBouncer/Supavisor) ignorent les options de démarrage.
  // On refixe search_path + fuseau à l'ouverture de CHAQUE connexion (pooler en mode SESSION requis).
  pg_pool.on('connect', c => { c.query(`set search_path to ${SCHEMA}, public`).catch(() => {}); c.query(`set time zone '${TZ}'`).catch(() => {}) })

  // le schéma dédié doit exister avant les migrations
  { const c = await pg_pool.connect(); try { await c.query(`create schema if not exists ${SCHEMA}`) } finally { c.release() } }

  const runPg = async (client, text, params) => {
    const r = (params === undefined || params === null) ? await client.query(text) : await client.query(text, params.map(norm))
    const rows = r.rows || []
    return { rows, rowCount: r.rowCount ?? rows.length, fields: r.fields }
  }
  const tagPg = async client => { await client.query("select set_config('dl.actor', $1, false)", [actorTag()]) }

  pool = {
    // requête simple : un client du pool, auteur posé, requête, libération
    async query(text, params) { const c = await pg_pool.connect(); try { await tagPg(c); return await runPg(c, text, params) } finally { c.release() } },
    // transaction / suite de requêtes sur UNE même connexion (begin/commit)
    async connect() { const c = await pg_pool.connect(); try { await tagPg(c) } catch {} let open = true
      return { query: (t, p) => runPg(c, t, p), release() { if (open) { open = false; c.release() } } } },
    async end() { await pg_pool.end() }
  }
  q = (text, params) => pool.query(text, params)
  // Les sauvegardes par fichier sont propres à PGlite (mode bureau). En hébergé, les
  // sauvegardes sont gérées par l'hébergeur (Supabase/PITR) : on refuse clairement.
  const hostedBackupError = () => { throw new Error('Sauvegarde par fichier indisponible en mode Postgres hébergé (utilisez les sauvegardes gérées de la base).') }
  dumpDb = hostedBackupError
  dumpDbWithLsn = hostedBackupError
  console.log(`Base : Postgres/Supabase — schéma « ${SCHEMA} » (instance partagée).`)

} else {
  // ─────────────────────────────── MODE PGLITE EMBARQUÉ ───────────────────────────
  const { PGlite } = await import('@electric-sql/pglite')
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
    await db.exec("set timezone to '" + TZ + "'")
  } catch (e) {
    // base illisible (souvent après un arrêt brutal) : message clair et procédure de récupération, rien n'est modifié
    console.error('\n✖ La base de données ne s\'ouvre pas (' + (e.message || e) + ').')
    console.error('  Cela arrive après un arrêt brutal pendant une écriture (coupure de courant, fenêtre fermée…).')
    console.error('  Pour repartir de la dernière sauvegarde vérifiée (rien n\'est supprimé, la base actuelle est mise de côté) :')
    console.error('      npm run restaurer')
    console.error('      npm start\n')
    process.exit(1)
  }

  async function run(text, params) {
    let r
    if (params === undefined || params === null) { const rs = await db.exec(text); r = rs[rs.length - 1] || { rows: [] } }
    else r = await db.query(text, params.map(norm))
    const rows = r.rows || []
    return { rows, rowCount: r.affectedRows > 0 ? r.affectedRows : rows.length, fields: r.fields }
  }

  let lastTag = null
  const tagActor = async () => { const t = actorTag(); if (t !== lastTag) { await db.query("select set_config('dl.actor', $1, false)", [t]); lastTag = t } }
  // Une seule connexion : les requêtes (et chaque transaction) passent l'une après l'autre.
  let tail = Promise.resolve()
  const acquire = () => { let release; const prev = tail; tail = new Promise(r => { release = r }); return prev.then(() => release) }

  pool = {
    async query(text, params) { const release = await acquire(); try { await tagActor(); return await run(text, params) } finally { release() } },
    async connect() { const release = await acquire(); try { await tagActor() } catch {} let open = true; return { query: run, release() { if (open) { open = false; release() } } } },
    async end() { const release = await acquire(); try { await db.close() } finally { release() } }
  }
  q = (text, params) => pool.query(text, params)
  // copie complète et cohérente de la base (aucune requête ne passe pendant l'export)
  dumpDb = async () => { const release = await acquire(); try { return await db.dumpDataDir('gzip') } finally { release() } }
  // même copie + position exacte du journal des transactions au même instant (la valeur stockée dans la copie est pré-allouée)
  dumpDbWithLsn = async (countTables = []) => { const release = await acquire(); try { let lsn = null; const counts = {}
      // comptages faits sous le même verrou que la copie : aucune écriture ne peut se glisser entre les deux
      for (const t of countTables) { try { counts[t] = Number((await run(`select count(*)::int n from ${t}`, [])).rows[0].n) } catch {} }
      try { const r = (await run('select last_value, is_called from dl_changelog_lsn_seq', [])).rows[0]; lsn = r.is_called ? Number(r.last_value) : Number(r.last_value) - 1 } catch {} return { blob: await db.dumpDataDir('gzip'), lsn, counts } } finally { release() } }
}
