// ═══ Stratégie de sauvegarde avancée — adaptée de SQL Server à la base embarquée (PGlite) ═══
// Complète (BACKUP DATABASE)              → backup.js : copie cohérente de la base + documents, relue et recomptée
// Partielle (READ_WRITE_FILEGROUPS)       → complète SANS les documents (base seule, plus légère)
// Différentielle (WITH DIFFERENTIAL)      → seules les lignes modifiées depuis la dernière complète (+ documents nouveaux)
// Journal des transactions (BACKUP LOG)   → chaque modification horodatée (table dl_changelog), exportée toutes les N min puis purgée
// Vérification (RESTORE VERIFYONLY / HEADERONLY / FILELISTONLY) → empreintes + rechargement réel dans une base temporaire
// Miroir (MIRROR TO)                      → copie vérifiée de chaque sauvegarde vers un second disque
// Restauration à un instant précis (STOPAT) → complète + différentielle + journaux rejoués jusqu'à l'heure choisie
// Mode mono-utilisateur (SET SINGLE_USER) → pendant une restauration, toutes les autres requêtes sont refusées
// Contrôle d'intégrité (DBCC CHECKDB)     → lecture complète de chaque table + recherche des liens orphelins
import fs from 'fs'
import path from 'path'
import zlib from 'zlib'
import crypto from 'crypto'
import { PGlite } from '@electric-sql/pglite'
import { config } from '../config/env.js'
import { q, pool } from '../db/pool.js'
import { BDIR, readJson, journal, sha256 } from './backup-restore.js'
import { listBackups, createBackup, getSettings } from './backup.js'

// tables non journalisées : techniques ou très changeantes (sessions, moteur d'analyse) — elles restent couvertes par les complètes
export const NO_LOG = new Set(['dl_changelog', 'schema_migrations', 'user_sessions', 'login_codes', 'intel_results', 'intel_metrics'])
const NO_DATA = new Set(['dl_changelog', 'schema_migrations'])   // jamais remplacées par une restauration
const CH = () => path.join(BDIR(), '_chaine'), IDX = () => path.join(CH(), 'index.json')
export const chain = () => ({ epoch: 1, cursor: null, items: [], ...readJson(IDX(), {}) })
const saveChain = c => { fs.mkdirSync(CH(), { recursive: true }); fs.writeFileSync(IDX(), JSON.stringify(c, null, 1)); mirrorFile(IDX(), '_chaine/index.json') }
// nouvelle chaîne après toute restauration : les anciens journaux restent utilisables avec les anciennes complètes
export const bumpEpoch = () => { const c = chain(); c.epoch = (c.epoch || 1) + 1; c.cursor = null; saveChain(c); return c.epoch }
export const maintenance = { on: false, why: null, since: null }
// kit de récupération (clé de chiffrement) : date du dernier téléchargement
const KIT = () => path.join(BDIR(), 'kit.json')
export const kitInfo = () => readJson(KIT(), null)
export const kitDownloaded = by => fs.writeFileSync(KIT(), JSON.stringify({ at: new Date().toISOString(), by }))

const qi = s => '"' + String(s).replace(/"/g, '""') + '"'
const stamp = () => new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, 23)   // à la milliseconde : jamais deux sauvegardes avec le même nom
const canon = v => Array.isArray(v) ? '[' + v.map(canon).join(',') + ']' : v && typeof v === 'object' ? '{' + Object.keys(v).sort().map(k => JSON.stringify(k) + ':' + canon(v[k])).join(',') + '}' : JSON.stringify(v)
const h16 = s => crypto.createHash('sha1').update(s).digest('hex').slice(0, 16)
const gz = o => zlib.gzipSync(Buffer.from(JSON.stringify(o)), { level: 6 })
const ungz = buf => JSON.parse(zlib.gunzipSync(buf).toString())
const fullOf = b => b && b.verified && b.lsn != null

// ── description des tables (fonctionne sur la base vivante comme sur une base temporaire rechargée) ──
export async function tablesMeta(run) {
  const names = (await run("select table_name from information_schema.tables where table_schema='public' and table_type='BASE TABLE' order by table_name")).rows.map(r => r.table_name)
  const out = []; for (const name of names) {
    const cols = (await run("select a.attname col, format_type(a.atttypid,a.atttypmod) typ, (a.attgenerated <> '') gen from pg_attribute a join pg_class c on c.oid=a.attrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname=$1 and a.attnum>0 and not a.attisdropped order by a.attnum", [name])).rows
    const pk = (await run("select a.attname col from pg_index i join pg_class c on c.oid=i.indrelid join pg_namespace n on n.oid=c.relnamespace join pg_attribute a on a.attrelid=c.oid and a.attnum=any(i.indkey) where n.nspname='public' and c.relname=$1 and i.indisprimary order by array_position(i.indkey, a.attnum)", [name])).rows.map(r => r.col)
    out.push({ name, cols, pk }) }
  return out }
const keyOf = (t, row) => t.pk.length ? t.pk.map(k => String(row[k])).join('\u0001') : 'h:' + h16(canon(row))
const rowsOf = async (run, t) => (await run('select row_to_json(x)::text j from ' + qi(t.name) + ' x')).rows.map(r => JSON.parse(r.j))
const lsnOf = async run => { try { const r = (await run('select last_value, is_called from dl_changelog_lsn_seq')).rows[0]; return r.is_called ? Number(r.last_value) : Number(r.last_value) - 1 } catch { return null } }

// ── déclencheurs du journal des transactions, posés sur toutes les tables métier (y compris les futures) ──
export async function ensureLogTriggers() {
  const has = new Set((await q("select c.relname from pg_trigger g join pg_class c on c.oid=g.tgrelid where g.tgname='dl_log_trg'")).rows.map(r => r.relname))
  const tables = (await q("select table_name from information_schema.tables where table_schema='public' and table_type='BASE TABLE'")).rows.map(r => r.table_name)
  let n = 0; for (const t of tables) if (!NO_LOG.has(t) && !has.has(t)) { await q('create trigger dl_log_trg after insert or update or delete on ' + qi(t) + ' for each row execute function dl_log()'); n++ }
  return n }

// ── appelé par backup.js pendant la vérification d'une complète : empreinte de chaque ligne + position dans le journal ──
export async function indexSnapshot(tmp) {
  const run = (t, p) => tmp.query(t, p), tables = (await tablesMeta(run)).filter(t => !NO_DATA.has(t.name)), index = {}; let rows = 0
  for (const t of tables) { const m = {}; for (const row of await rowsOf(run, t)) { m[keyOf(t, row)] = h16(canon(row)); rows++ } index[t.name] = m }
  return { lsn: await lsnOf(run), index, tables: tables.length, rows } }
export function afterFull(man, dir, ix) {
  const buf = gz({ lsn: ix.lsn, index: ix.index }); fs.writeFileSync(path.join(dir, 'index.json.gz'), buf)
  Object.assign(man, { lsn: ix.lsn, epoch: chain().epoch, index_sha256: sha256(buf), rows_total: ix.rows, tables_total: ix.tables, type: man.partial ? 'partielle' : 'complete' }) }
export async function afterFullWritten(man) {
  const s = getSettings()
  // journal désactivé : ce qui est dans la complète n'a pas besoin d'être gardé dans le journal
  if (!(s.log_minutes > 0 && s.auto) && man.lsn != null) { await q('delete from dl_changelog where lsn <= $1', [man.lsn]).catch(() => {}); const c = chain(); if (c.cursor != null) { c.cursor = null; saveChain(c) } }
  const m = mirrorDir(man.id, path.join(BDIR(), man.id), 'db.tar.gz', man.db_sha256)
  if (m) { man.mirror = m; fs.writeFileSync(path.join(BDIR(), man.id, 'manifest.json'), JSON.stringify(man, null, 1)) } }

// ── miroir : second disque (clé USB, disque externe, dossier réseau) ──
const mirrorRoot = () => { const d = (getSettings().mirror_dir || '').trim(); return d || null }
function mirrorDir(rel, src, mainFile, sha) { const root = mirrorRoot(); if (!root) return null
  try { const dest = path.join(root, rel); fs.mkdirSync(path.dirname(dest), { recursive: true }); fs.cpSync(src, dest, { recursive: true })
    if (mainFile && sha256(fs.readFileSync(path.join(dest, mainFile))) !== sha) throw new Error('copie différente de l\'original')
    return { ok: true, at: new Date().toISOString(), path: dest } }
  catch (e) { journal({ op: 'mirror', id: rel, ok: false, error: e.message }); return { ok: false, at: new Date().toISOString(), error: e.message } } }
function mirrorFile(src, rel) { const root = mirrorRoot(); if (!root) return; try { const dest = path.join(root, rel); fs.mkdirSync(path.dirname(dest), { recursive: true }); fs.copyFileSync(src, dest) } catch {} }
export function mirrorRemove(rel) { const root = mirrorRoot(); if (!root) return; try { fs.rmSync(path.join(root, rel), { recursive: true, force: true }) } catch {} }
export function checkMirrorDir(d) {
  d = String(d || '').trim(); if (!d) return ''
  if (!path.isAbsolute(d)) throw new Error('Indiquez un chemin complet, par exemple E:\\SauvegardesDental')
  const abs = path.resolve(d), inside = p => { const r = path.relative(path.resolve(p), abs); return !r.startsWith('..') && !path.isAbsolute(r) }
  if (inside(BDIR()) || inside(config.dbDir) || inside(config.storageDir)) throw new Error('Le miroir doit être en dehors des dossiers de l\'application (idéalement sur un autre disque)')
  try { fs.mkdirSync(abs, { recursive: true }); const t = path.join(abs, '.test-ecriture'); fs.writeFileSync(t, 'ok'); fs.rmSync(t) } catch (e) { throw new Error('Dossier miroir inaccessible en écriture : ' + e.message) }
  return abs }

// ── sauvegarde différentielle ──
const baseFull = () => { const ep = chain().epoch; return listBackups().find(b => fullOf(b) && b.epoch === ep && fs.existsSync(path.join(BDIR(), b.id, 'index.json.gz'))) }
let busy = null
const exclusive = fn => { if (busy) return busy; busy = fn().finally(() => { busy = null }); return busy }
export const createDiff = (o = {}) => exclusive(() => doDiff(o))
async function doDiff({ by = 'automatique' } = {}) {
  const base = baseFull(); if (!base) { const b = await createBackup({ kind: 'auto', by: (by || '') + ' · aucune complète de référence' }); return { full: true, ...b } }
  const ix = ungz(fs.readFileSync(path.join(BDIR(), base.id, 'index.json.gz'))), id = stamp() + '_diff', dir = path.join(CH(), id)
  const changes = {}, deleted = {}; let lsn, nrows = 0, ndel = 0
  // lecture cohérente : aucune écriture ne passe pendant la lecture (comme SQL Server pendant une sauvegarde)
  const c = await pool.connect(); const run = (t, p) => c.query(t, p)
  try { for (const t of (await tablesMeta(run)).filter(t => !NO_DATA.has(t.name))) { const prev = ix.index[t.name] || {}, seen = new Set()
      for (const row of await rowsOf(run, t)) { const k = keyOf(t, row); seen.add(k); if (prev[k] !== h16(canon(row))) { (changes[t.name] ||= []).push(row); nrows++ } }
      const del = Object.keys(prev).filter(k => !seen.has(k)); if (del.length) { deleted[t.name] = del; ndel += del.length } }
    lsn = await lsnOf(run) } finally { c.release() }
  try { fs.mkdirSync(dir, { recursive: true })
    // documents ajoutés ou modifiés depuis la complète
    let files = 0; const since = new Date(base.created_at).getTime(), root = config.storageDir
    const walk = d => fs.existsSync(d) ? fs.readdirSync(d, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]) : []
    for (const f of walk(root)) if (fs.statSync(f).mtimeMs > since) { const dest = path.join(dir, 'storage', path.relative(root, f)); fs.mkdirSync(path.dirname(dest), { recursive: true }); fs.copyFileSync(f, dest); files++ }
    const buf = gz({ base: base.id, lsn, at: new Date().toISOString(), changes, deleted }); fs.writeFileSync(path.join(dir, 'data.json.gz'), buf)
    // vérification : relu, décompressé et recompté
    const back = ungz(fs.readFileSync(path.join(dir, 'data.json.gz'))), cnt = Object.values(back.changes).reduce((a, r) => a + r.length, 0); if (cnt !== nrows) throw new Error('relecture incorrecte')
    const item = { id, type: 'differentielle', base: base.id, base_seq: base.seq, epoch: base.epoch, by, created_at: back.at, lsn, rows: nrows, deleted: ndel, tables: Object.keys(changes).length, files, size: buf.length, sha256: sha256(buf), verified: true }
    item.mirror = mirrorDir('_chaine/' + id, dir, 'data.json.gz', item.sha256)
    const ch = chain(); ch.items.push(item); saveChain(ch); journal({ op: 'backup_diff', id, by, ok: true, rows: nrows, deleted: ndel, files, size: buf.length }); pruneChain(); return item }
  catch (e) { fs.rmSync(dir, { recursive: true, force: true }); journal({ op: 'backup_diff', id, by, ok: false, error: e.message }); throw e } }

// ── sauvegarde du journal des transactions ──
export const createLog = (o = {}) => exclusive(() => doLog(o))
async function doLog({ by = 'automatique' } = {}) {
  const ch = chain(), full = listBackups().find(b => fullOf(b) && b.epoch === ch.epoch)
  if (!full) return { skipped: 'Faites d\'abord une sauvegarde complète : elle est le point de départ du journal' }
  const after = ch.cursor ?? full.lsn
  const rows = (await q('select lsn, at, tbl, op, row::text r from dl_changelog where lsn > $1 order by lsn', [after])).rows
  if (!rows.length) return { skipped: 'Aucune modification depuis la dernière sauvegarde du journal' }
  const entries = rows.map(r => [Number(r.lsn), new Date(r.at).toISOString(), r.tbl, r.op, JSON.parse(r.r)]), to = entries.at(-1)[0], id = stamp() + '_jrnl', dir = path.join(CH(), id)
  try { fs.mkdirSync(dir, { recursive: true }); const buf = gz({ after_lsn: after, to_lsn: to, entries }); fs.writeFileSync(path.join(dir, 'data.json.gz'), buf)
    const back = ungz(fs.readFileSync(path.join(dir, 'data.json.gz'))); if (back.entries.length !== entries.length || back.to_lsn !== to) throw new Error('relecture incorrecte')
    const per = {}; for (const e of entries) per[e[2]] = (per[e[2]] || 0) + 1
    const item = { id, type: 'journal', epoch: ch.epoch, by, created_at: new Date().toISOString(), after_lsn: after, to_lsn: to, from_at: entries[0][1], to_at: entries.at(-1)[1], count: entries.length, per_table: per, size: buf.length, sha256: sha256(buf), verified: true }
    item.mirror = mirrorDir('_chaine/' + id, dir, 'data.json.gz', item.sha256)
    const c2 = chain(); c2.items.push(item); c2.cursor = to; saveChain(c2)
    // les transactions sauvegardées sont retirées du journal actif (comme BACKUP LOG)
    await q('delete from dl_changelog where lsn <= $1', [to])
    journal({ op: 'backup_log', id, by, ok: true, count: entries.length, size: buf.length }); pruneChain(); return item }
  catch (e) { fs.rmSync(dir, { recursive: true, force: true }); journal({ op: 'backup_log', id, by, ok: false, error: e.message }); throw e } }

// ── conservation de la chaîne : rien d'inutilisable n'est gardé, rien d'utile n'est supprimé ──
export function pruneChain() { const ch = chain(), fulls = listBackups().filter(fullOf), ids = new Set(fulls.map(b => b.id)), oldest = fulls.at(-1)
  const keep = ch.items.filter(i => i.type === 'differentielle' ? ids.has(i.base) : oldest ? new Date(i.created_at) >= new Date(oldest.created_at) : true)
  const gone = ch.items.filter(i => !keep.includes(i)); if (!gone.length) return 0
  for (const i of gone) { fs.rmSync(path.join(CH(), i.id), { recursive: true, force: true }); mirrorRemove('_chaine/' + i.id) }
  ch.items = keep; saveChain(ch); journal({ op: 'retention', ok: true, removed: gone.map(i => i.id) }); return gone.length }

// ── plan de restauration à un instant précis (STOPAT) ──
export async function planRestore(at) {
  const T = new Date(at); if (isNaN(T)) throw new Error('Date et heure invalides'); if (T > new Date(Date.now() + 60e3)) throw new Error('Cette date est dans le futur')
  const ch = chain(), full = listBackups().find(b => fullOf(b) && new Date(b.created_at) <= T)
  if (!full) throw new Error('Aucune sauvegarde complète avant cette date (les sauvegardes faites avant l\'activation du journal ne permettent pas ce type de restauration)')
  const items = ch.items.filter(i => i.epoch === full.epoch)
  const diff = items.filter(i => i.type === 'differentielle' && i.base === full.id && new Date(i.created_at) <= T).sort((a, b) => b.created_at.localeCompare(a.created_at))[0] || null
  let cur = diff ? diff.lsn : full.lsn, covered = new Date(diff ? diff.created_at : full.created_at), gap = null; const logs = []
  if (covered < T) for (const l of items.filter(i => i.type === 'journal' && i.to_lsn > cur).sort((a, b) => a.after_lsn - b.after_lsn)) {
    if (l.after_lsn > cur) { gap = { from: covered.toISOString(), reason: 'journaux manquants entre ' + cur + ' et ' + l.after_lsn }; break }
    logs.push(l); cur = l.to_lsn; covered = new Date(l.created_at); if (covered >= T) break }
  let live = 0
  if (!gap && covered < T && full.epoch === ch.epoch && (ch.cursor ?? full.lsn) === cur) { live = Number((await q('select count(*)::int n from dl_changelog where lsn > $1 and at <= $2', [cur, T.toISOString()])).rows[0].n); covered = new Date() }
  const entries = logs.reduce((a, l) => a + l.count, 0) + live
  return { at: T.toISOString(), ok: covered >= T, until: covered.toISOString(), gap, full: { id: full.id, seq: full.seq, created_at: full.created_at, partial: !!full.partial }, diff: diff && { id: diff.id, created_at: diff.created_at, rows: diff.rows }, logs: logs.map(l => ({ id: l.id, created_at: l.created_at, count: l.count })), live, entries,
    sessions: (await q("select u.first_name||' '||u.last_name name, u.role, s.last_seen, s.ip::text ip from user_sessions s join users u on u.id=s.user_id where s.revoked_at is null and s.last_seen > now() - interval '15 minutes' order by s.last_seen desc")).rows }
}

// ── remplacement des données locales, en une seule transaction (tout ou rien) ──
async function replaceTables(target, data, partial = false) { const c = await pool.connect(); let n = 0
  try { await c.query('begin'); await c.query('set local session_replication_role = replica')
    // complète : TRUNCATE de toutes les tables ; partielle : suppression ligne à ligne (les autres tables gardent leurs liens)
    if (partial) for (const t of target) await c.query('delete from ' + qi(t.name)); else await c.query('truncate ' + target.map(t => qi(t.name)).join(', '))
    for (const t of target) { const rows = [...(data[t.name]?.values() || [])]; if (!rows.length) continue
      const cols = t.cols.filter(x => !x.gen).map(x => x.col).filter(col => rows.some(r => col in r)), list = cols.map(qi).join(',')
      for (let i = 0; i < rows.length; i += 500) { const chunk = rows.slice(i, i + 500).map(r => Object.fromEntries(cols.filter(col => col in r).map(col => [col, r[col]])))
        await c.query('insert into ' + qi(t.name) + ' (' + list + ') overriding system value select ' + list + ' from json_populate_recordset(null::' + qi(t.name) + ', $1::json)', [JSON.stringify(chunk)]); n += chunk.length } }
    for (const x of (await c.query("select table_name t, column_name col, pg_get_serial_sequence(quote_ident(table_name), column_name) seq from information_schema.columns where table_schema='public' and table_name <> 'dl_changelog' and pg_get_serial_sequence(quote_ident(table_name), column_name) is not null")).rows)
      await c.query('select setval($1, coalesce((select max(' + qi(x.col) + ') from ' + qi(x.t) + '), 0) + 1, false)', [x.seq])
    await c.query('truncate dl_changelog')   // les transactions en attente ont été exportées juste avant (createLog)
    await c.query('commit'); return n }
  catch (e) { await c.query('rollback').catch(() => {}); throw new Error('Restauration annulée, aucune donnée modifiée : ' + e.message) }
  finally { c.release() } }

// ── restauration à un instant précis, complète ou partielle (certaines tables seulement) ──
export async function restorePoint({ at, tables = [], by = 'propriétaire' }) {
  if (maintenance.on) throw new Error('Une restauration est déjà en cours')
  maintenance.on = true; maintenance.why = 'Restauration au ' + new Date(at).toLocaleString('fr-FR'); maintenance.since = new Date().toISOString()
  try {
    while (busy) await busy.catch(() => {})
    try { await doLog({ by: 'avant restauration' }) } catch {}                          // 1. tout ce qui est en attente part dans un journal (rien n'est perdu)
    const plan = await planRestore(at); if (!plan.ok) throw new Error(`Restauration impossible jusqu'à cette heure : les données ne sont couvertes que jusqu'au ${new Date(plan.until).toLocaleString('fr-FR')}`)
    const safety = await createBackup({ kind: 'avant-restauration', by })                // 2. sauvegarde de sécurité de l'état actuel
    const T = plan.at, full = listBackups().find(b => b.id === plan.full.id)
    const buf = fs.readFileSync(path.join(BDIR(), full.id, 'db.tar.gz')); if (sha256(buf) !== full.db_sha256) throw new Error('Sauvegarde complète altérée (empreinte différente)')
    const live = await tablesMeta((t, p) => q(t, p)), target = live.filter(t => !NO_DATA.has(t.name) && (!tables.length || tables.includes(t.name)))
    if (!target.length) throw new Error('Aucune table sélectionnée')
    const byName = Object.fromEntries(target.map(t => [t.name, t])), data = {}
    // 3. état de la complète (rechargée dans une base temporaire)
    const tmp = new PGlite({ loadDataDir: new Blob([buf]) }); await tmp.waitReady
    try { const snap = new Set((await tmp.query("select table_name from information_schema.tables where table_schema='public'")).rows.map(r => r.table_name))
      for (const t of target) { const m = new Map(); if (snap.has(t.name)) for (const row of await rowsOf((s, p) => tmp.query(s, p), t)) m.set(keyOf(t, row), row); data[t.name] = m } }
    finally { await tmp.close() }
    const start = plan.diff ? listBackupsChain(plan.diff.id).lsn : full.lsn
    // 4. différentielle
    if (plan.diff) { const d = ungz(fs.readFileSync(path.join(CH(), plan.diff.id, 'data.json.gz')))
      for (const [tn, rows] of Object.entries(d.changes)) if (byName[tn]) for (const r of rows) data[tn].set(keyOf(byName[tn], r), r)
      for (const [tn, ks] of Object.entries(d.deleted)) if (byName[tn]) for (const k of ks) data[tn].delete(k) }
    // 5. journaux rejoués dans l'ordre, jusqu'à l'heure choisie
    let replayed = 0; const apply = ([lsn, when, tbl, op, row]) => { if (lsn <= start || when > T || !byName[tbl]) return; const k = keyOf(byName[tbl], row); if (op === 'D') data[tbl].delete(k); else data[tbl].set(k, row); replayed++ }
    for (const l of plan.logs) { const item = chain().items.find(i => i.id === l.id), b2 = fs.readFileSync(path.join(CH(), l.id, 'data.json.gz')); if (sha256(b2) !== item.sha256) throw new Error('Journal altéré : ' + l.id); ungz(b2).entries.forEach(apply) }
    if (plan.live) (await q('select lsn, at, tbl, op, row::text r from dl_changelog where lsn > $1 and at <= $2 order by lsn', [start, T])).rows.forEach(r => apply([Number(r.lsn), new Date(r.at).toISOString(), r.tbl, r.op, JSON.parse(r.r)]))
    // 6. remplacement en une transaction
    const rows = await replaceTables(target, data, !!tables.length)
    // 7. documents : ceux de la complète et de la différentielle qui manquent sont remis (aucun document actuel n'est supprimé)
    let docs = 0; const copyMissing = src => { if (!fs.existsSync(src)) return; const walk = d => fs.readdirSync(d, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)])
      for (const f of walk(src)) { const dest = path.join(config.storageDir, path.relative(src, f)); if (!fs.existsSync(dest)) { fs.mkdirSync(path.dirname(dest), { recursive: true }); fs.copyFileSync(f, dest); docs++ } } }
    copyMissing(path.join(BDIR(), full.id, 'storage')); if (plan.diff) copyMissing(path.join(CH(), plan.diff.id, 'storage'))
    // 8. nouvelle chaîne + complète de départ
    bumpEpoch(); let after = null; try { after = (await createBackup({ kind: 'apres-restauration', by }))?.id } catch (x) { journal({ op: 'backup', ok: false, error: x.message }) }
    const res = { at: T, tables: target.length, partial: !!tables.length, rows, replayed, docs, safety: safety?.id, after, full: full.id, diff: plan.diff?.id || null, logs: plan.logs.length }
    journal({ op: 'restore_pitr', ok: true, by, at: T, rows, replayed, tables: target.length, partial: !!tables.length }); return res }
  catch (e) { journal({ op: 'restore_pitr', ok: false, by, at, error: e.message }); throw e }
  finally { maintenance.on = false; maintenance.why = null } }
const listBackupsChain = id => chain().items.find(i => i.id === id)

// ── vérification d'une sauvegarde (VERIFYONLY + rechargement réel) ──
export async function verifyBackup(id) { const t0 = Date.now()
  const item = chain().items.find(i => i.id === id)
  if (item) { const buf = fs.readFileSync(path.join(CH(), id, 'data.json.gz')); const okSha = sha256(buf) === item.sha256; let n = 0, err = null
    try { const d = ungz(buf); n = item.type === 'journal' ? d.entries.length : Object.values(d.changes).reduce((a, r) => a + r.length, 0) } catch (e) { err = e.message }
    const ok = okSha && !err && n === (item.type === 'journal' ? item.count : item.rows), r = { id, type: item.type, ok, checks: [['Empreinte SHA-256', okSha], ['Décompression et lecture', !err], [item.type === 'journal' ? `${n} transaction(s) relues` : `${n} ligne(s) relues`, n === (item.type === 'journal' ? item.count : item.rows)]], ms: Date.now() - t0 }
    const ch = chain(), it = ch.items.find(i => i.id === id); it.last_check = { at: new Date().toISOString(), ok }; saveChain(ch); journal({ op: 'verify', id, ok }); return r }
  const b = listBackups().find(x => x.id === id); if (!b) throw new Error('Sauvegarde introuvable')
  const dir = path.join(BDIR(), id), buf = fs.readFileSync(path.join(dir, 'db.tar.gz')), okSha = sha256(buf) === b.db_sha256, checks = [['Empreinte SHA-256 de la base', okSha]], tables = []
  if (okSha) { const tmp = new PGlite({ loadDataDir: new Blob([buf]) })
    try { await tmp.waitReady; checks.push(['Rechargement complet dans une base temporaire', true])
      for (const t of await tablesMeta((s, p) => tmp.query(s, p))) tables.push({ table: t.name, rows: Number((await tmp.query('select count(*)::int n from ' + qi(t.name))).rows[0].n) })
      const diffs = Object.entries(b.counts || {}).filter(([k, v]) => (tables.find(x => x.table === k)?.rows ?? v) !== v); checks.push([diffs.length ? 'Comptages différents : ' + diffs.map(x => x[0]).join(', ') : `${tables.length} tables relues, comptages identiques au manifeste`, !diffs.length]) }
    catch (e) { checks.push(['Rechargement : ' + e.message, false]) } finally { await tmp.close().catch(() => {}) } }
  if (fs.existsSync(path.join(dir, 'index.json.gz'))) checks.push(['Index des lignes (pour différentielles)', sha256(fs.readFileSync(path.join(dir, 'index.json.gz'))) === b.index_sha256])
  if (!b.partial) { const cnt = d => { let n = 0; const w = p => { if (!fs.existsSync(p)) return; for (const e of fs.readdirSync(p, { withFileTypes: true })) e.isDirectory() ? w(path.join(p, e.name)) : n++ }; w(d); return n }; const n = cnt(path.join(dir, 'storage')); checks.push([`${n} document(s) présents sur ${b.files}`, n === b.files]) }
  if (b.mirror?.path) { let okM = false; try { okM = sha256(fs.readFileSync(path.join(b.mirror.path, 'db.tar.gz'))) === b.db_sha256 } catch {} checks.push(['Copie miroir identique', okM]) }
  const ok = checks.every(c => c[1]); const man = readJson(path.join(dir, 'manifest.json'), {}); man.last_check = { at: new Date().toISOString(), ok, ms: Date.now() - t0 }; fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(man, null, 1))
  journal({ op: 'verify', id, ok }); return { id, type: b.type || 'complete', ok, checks, tables, ms: Date.now() - t0 } }

// ── en-tête et contenu d'une sauvegarde (HEADERONLY / FILELISTONLY) ──
export function inspectBackup(id) {
  const item = chain().items.find(i => i.id === id); if (item) return { header: item, files: [{ name: 'data.json.gz', size: item.size }], dependents: [] }
  const b = listBackups().find(x => x.id === id); if (!b) throw new Error('Sauvegarde introuvable')
  const dir = path.join(BDIR(), id), files = [], walk = (p, rel) => { if (!fs.existsSync(p)) return; for (const e of fs.readdirSync(p, { withFileTypes: true })) { const f = path.join(p, e.name), r = rel ? rel + '/' + e.name : e.name; e.isDirectory() ? walk(f, r) : files.push({ name: r, size: fs.statSync(f).size }) } }
  walk(dir, ''); const ch = chain()
  return { header: b, files: files.slice(0, 400), files_total: files.length, dependents: ch.items.filter(i => i.base === id || (i.type === 'journal' && i.epoch === b.epoch && i.to_lsn > b.lsn)).map(i => ({ id: i.id, type: i.type, created_at: i.created_at })) } }

// ── contrôle d'intégrité de la base vivante (DBCC CHECKDB) ──
export async function integrityCheck() { const t0 = Date.now(), out = { tables: [], orphans: [], errors: [] }
  for (const t of await tablesMeta((s, p) => q(s, p))) { try { const r = (await q('select count(*)::int n, sum(length(row_to_json(x)::text))::bigint b from ' + qi(t.name) + ' x')).rows[0]; out.tables.push({ table: t.name, rows: r.n, bytes: Number(r.b || 0) }) } catch (e) { out.errors.push({ table: t.name, error: e.message }) } }
  const fks = (await q("select c.conrelid::regclass::text child, a.attname col, c.confrelid::regclass::text parent, af.attname pcol from pg_constraint c join pg_attribute a on a.attrelid=c.conrelid and a.attnum=c.conkey[1] join pg_attribute af on af.attrelid=c.confrelid and af.attnum=c.confkey[1] where c.contype='f' and array_length(c.conkey,1)=1")).rows
  for (const f of fks) { try { const n = Number((await q(`select count(*)::int n from ${f.child} c where c.${qi(f.col)} is not null and not exists (select 1 from ${f.parent} p where p.${qi(f.pcol)} = c.${qi(f.col)})`)).rows[0].n); if (n) out.orphans.push({ ...f, n }) } catch {} }
  out.ok = !out.errors.length && !out.orphans.length; out.ms = Date.now() - t0; out.fks = fks.length; journal({ op: 'integrity', ok: out.ok, orphans: out.orphans.length, errors: out.errors.length }); return out }

// ── tableau de bord de la stratégie + recommandations ──
export async function strategyInfo() {
  const s = getSettings(), ch = chain(), fulls = listBackups().filter(fullOf), cur = fulls.find(b => b.epoch === ch.epoch), items = ch.items.filter(i => i.epoch === ch.epoch)
  const lastLog = items.filter(i => i.type === 'journal').at(-1), lastDiff = items.filter(i => i.type === 'differentielle').at(-1)
  let pending = 0, oldestPending = null; try { const r = (await q('select count(*)::int n, min(at) m from dl_changelog where lsn > $1', [ch.cursor ?? cur?.lsn ?? 0])).rows[0]; pending = r.n; oldestPending = r.m } catch {}
  let free = null; try { const st = fs.statfsSync(BDIR()); free = st.bavail * st.bsize } catch {}
  const rpo = s.log_minutes > 0 ? s.log_minutes : s.diff_hours > 0 ? s.diff_hours * 60 : ({ '1h': 1, '6h': 6, daily: 24, weekly: 168 }[s.frequency] || 24) * 60
  const mroot = mirrorRoot(); let mirror = null; if (mroot) { let ok = false, mfree = null; try { fs.accessSync(mroot, fs.constants.W_OK); ok = true; const st = fs.statfsSync(mroot); mfree = st.bavail * st.bsize } catch {} mirror = { path: mroot, ok, free: mfree, same_disk: path.parse(path.resolve(mroot)).root.toLowerCase() === path.parse(path.resolve(BDIR())).root.toLowerCase() } }
  const lastCheck = [...listBackups().map(b => b.last_check?.at), ...ch.items.map(i => i.last_check?.at)].filter(Boolean).sort().at(-1) || null
  const A = []
  if (!cur) A.push({ tone: 'danger', icon: 'alert', text: 'Aucune sauvegarde complète dans la chaîne actuelle : faites une <b>sauvegarde complète</b> maintenant. Elle est le point de départ des différentielles, du journal et de la restauration à un instant précis.' })
  if (!(s.log_minutes > 0)) A.push({ tone: 'warn', icon: 'clock', text: `Journal des transactions désactivé : en cas de panne, vous pouvez perdre jusqu'à <b>${rpo >= 60 ? Math.round(rpo / 60) + ' heure(s)' : rpo + ' minutes'}</b> de travail. Activez-le (toutes les 15 minutes conseillé).` })
  if (!mroot) A.push({ tone: 'warn', icon: 'package', text: 'Aucun <b>miroir</b> : toutes les sauvegardes sont sur le même disque que la base. Branchez une clé USB ou un disque externe et indiquez son dossier dans « Miroir » (règle 3-2-1 : 3 copies, 2 supports, 1 hors site).' })
  else if (!mirror.ok) A.push({ tone: 'danger', icon: 'alert', text: `Le miroir <b>${mroot}</b> est inaccessible (disque débranché ?) : rebranchez-le, les prochaines sauvegardes y seront recopiées.` })
  else if (mirror.same_disk) A.push({ tone: 'warn', icon: 'alert', text: 'Le miroir est sur le <b>même disque</b> que les sauvegardes : il ne protège pas d\'une panne du disque. Choisissez un disque externe ou un autre lecteur.' })
  if (free != null && free < 512 * 1024 ** 2) A.push({ tone: 'danger', icon: 'alert', text: `Espace disque presque plein (${Math.round(free / 1024 ** 2)} Mo libres) : les sauvegardes risquent d'échouer.` })
  else if (free != null && free < 2 * 1024 ** 3) A.push({ tone: 'warn', icon: 'alert', text: `Peu d'espace disque libre (${(free / 1024 ** 3).toFixed(1)} Go).` })
  if (!lastCheck || Date.now() - new Date(lastCheck) > 30 * 864e5) A.push({ tone: 'info', icon: 'check', text: 'Une sauvegarde non testée n\'est pas une sauvegarde : utilisez <b>« Vérifier »</b> sur la dernière complète au moins une fois par mois (rechargement réel dans une base temporaire).' })
  if (cur && Date.now() - new Date(cur.created_at) > 7 * 864e5) A.push({ tone: 'info', icon: 'clock', text: 'La dernière complète date de plus de 7 jours : les différentielles grossissent et la restauration est plus longue. Gardez au moins une complète par semaine.' })
  if (s.log_minutes > 0 && !(s.diff_hours > 0)) A.push({ tone: 'info', icon: 'activity', text: 'Ajoutez des <b>différentielles</b> (toutes les 6 heures par exemple) : moins de journaux à rejouer, restauration plus rapide.' })
  if (oldestPending && s.log_minutes > 0 && Date.now() - new Date(oldestPending) > (s.log_minutes * 3 + 5) * 6e4) A.push({ tone: 'warn', icon: 'alert', text: 'Des transactions attendent depuis longtemps d\'être sauvegardées dans le journal : vérifiez que la sauvegarde automatique est activée.' })
  if (!kitInfo()) A.push({ tone: 'danger', icon: 'key', text: 'Les données médicales sont <b>chiffrées</b> avec la clé de cette installation : sans elle, vos sauvegardes et la copie Supabase sont <b>illisibles sur un autre ordinateur</b>. Téléchargez le <b>kit de récupération</b> et gardez-le hors de cet ordinateur (clé USB, coffre).' })
  if (s.frequency === '1h' && s.log_minutes > 0) A.push({ tone: 'info', icon: 'layers', text: 'Complète <b>toutes les heures</b> alors que le journal des transactions tourne toutes les ' + s.log_minutes + ' min : une complète <b>par jour</b> suffit (même sécurité, beaucoup moins d\'espace).' })
  if (!A.length) A.push({ tone: 'ok', icon: 'check', text: 'Stratégie complète : complète + différentielles + journal + miroir. Perte maximale en cas de panne : <b>' + rpo + ' minutes</b>.' })
  return { kit: kitInfo(), epoch: ch.epoch, full: cur ? { id: cur.id, seq: cur.seq, created_at: cur.created_at } : null, last_log: lastLog || null, last_diff: lastDiff || null, logs: items.filter(i => i.type === 'journal').length, diffs: items.filter(i => i.type === 'differentielle').length, pending, rpo, free, mirror, last_check: lastCheck, advice: A, maintenance: maintenance.on,
    items: ch.items.slice(-300).reverse() } }

// ── automatisation : journal toutes les N minutes, différentielle toutes les N heures ──
export function startPlus() { let lastLogTry = 0
  const tick = async () => { try { const s = getSettings(); if (!s.auto || maintenance.on) return; const ch = chain()
      // nouvelle chaîne (première utilisation ou après restauration) : une complète d'abord
      if ((s.log_minutes > 0 || s.diff_hours > 0) && !listBackups().some(b => fullOf(b) && b.epoch === ch.epoch)) { await createBackup({ kind: 'auto', by: 'début de chaîne' }); return }
      if (s.log_minutes > 0 && Date.now() - lastLogTry >= s.log_minutes * 6e4 - 5e3) { lastLogTry = Date.now(); await createLog({ by: 'automatique' }) }
      const base = baseFull(); if (s.diff_hours > 0 && base) { const last = ch.items.filter(i => i.type === 'differentielle' && i.base === base.id).at(-1), since = new Date(last ? last.created_at : base.created_at)
        if (Date.now() - since >= s.diff_hours * 36e5 - 6e4) { const cur = await lsnOf((t, p) => q(t, p)); if (cur != null && cur > (last ? last.lsn : base.lsn)) await createDiff({ by: 'automatique' }) } } }
    catch (e) { console.error('Sauvegarde (journal/différentielle) :', e.message) } }
  setTimeout(tick, 90e3); return setInterval(tick, 60e3) }
