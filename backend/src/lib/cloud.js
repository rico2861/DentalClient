// ═══ Synchronisation et sauvegarde en ligne : Supabase (PostgreSQL) ═══
// Configuré dans le code / .env (SUPABASE_DB_URL), jamais depuis l'interface.
// L'application reste 100 % locale ; dès qu'Internet est disponible, elle recopie automatiquement dans Supabase :
//   1. toutes les tables (schéma « dental_light »), en n'envoyant que les lignes nouvelles ou modifiées ;
//   2. les documents et radiographies (table dental_light.dl_files) ;
//   3. les sauvegardes complètes vérifiées (table dental_light.dl_backups), récupérables depuis l'application.
// Connexion : adresse directe (IPv6) puis, si elle échoue, pooler de session (IPv4, 5432) et de transaction (6543).
// Si les ports PostgreSQL sont bloqués par le réseau : voie web HTTPS (port 443) avec SUPABASE_SERVICE_KEY
//   → table public.dl_rows (préparée par db/supabase/setup.sql) + stockage privé « dental-light ».
import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import { config } from '../config/env.js'
import { BDIR, readJson, journal } from './backup-restore.js'
import { listBackups, createBackup } from './backup.js'
import { q, pool } from '../db/pool.js'
import { bumpEpoch } from './backup-plus.js'
import { clinicSchema, status as licenseStatus, fingerprint as hostFingerprint } from './license.js'
import { sealFile, openFile } from './protect.js'   // chiffrement AES-256-GCM des archives envoyées à Supabase

// Schéma Supabase propre à CETTE clinique (isolation) : clinic_<id>, sinon dental_light.
const S = () => clinicSchema()
const PART = 8 * 1024 * 1024

// Remontée (non bloquante) de l'état d'une sauvegarde vers la console SaaS.
const SAAS_URL = (process.env.SAAS_URL || '').replace(/\/+$/, '')
async function reportBackup(meta, verified) {
  if (!SAAS_URL) return
  try {
    const cid = licenseStatus().clinic_id; if (!cid) return
    const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), 8000)
    await fetch(SAAS_URL + '/api/backups/report', { method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: ctrl.signal,
      body: JSON.stringify({ clinic_id: cid, fingerprint: hostFingerprint(), size_bytes: meta.size, sha256: meta.sha256, verified, location: 'supabase:' + S() + '.dl_backups' }) }).catch(() => {})
    clearTimeout(t)
  } catch { /* silencieux : la sauvegarde locale a réussi de toute façon */ }
}
const STATE = () => path.join(BDIR(), 'cloud-etat.json'), CACHE = () => path.join(BDIR(), 'cloud-sync.json')
const sha = b => crypto.createHash('sha256').update(b).digest('hex')
const writeJson = (f, o) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, JSON.stringify(o), { mode: 0o600 }) }
const qi = s => '"' + String(s).replace(/"/g, '""') + '"'
const env = () => ({ url: process.env.SUPABASE_DB_URL || '', enabled: (process.env.SUPABASE_SYNC || 'on') !== 'off', keep: Math.max(1, parseInt(process.env.SUPABASE_KEEP_BACKUPS) || 10), fresh_hours: Math.max(1, parseInt(process.env.SUPABASE_FRESH_HOURS) || 6), region: process.env.SUPABASE_REGION || '' })
export const cloudState = () => ({ online: null, last_check: null, last_sync: null, last_error: null, hint: null, uploading: null, via: null, tables: null, rows_sent: null, ...readJson(STATE(), {}) })
const setState = p => writeJson(STATE(), { ...cloudState(), ...p })
export const configured = () => !!env().url
export const publicCloud = () => { const e = env(); let host = ''; try { host = new URL(e.url).hostname } catch {} return { configured: !!e.url, enabled: e.enabled, host, keep: e.keep, fresh_hours: e.fresh_hours, schema: S(), web: httpsConfigured(), source: '.env (SUPABASE_DB_URL)' } }

// ── connexion : directe, puis poolers Supabase (IPv4) ; l'adresse qui fonctionne est retenue ──
const REGIONS = ['us-west-2', 'us-east-1', 'us-east-2', 'us-west-1', 'ca-central-1', 'sa-east-1', 'eu-west-1', 'eu-west-2', 'eu-west-3', 'eu-central-1', 'eu-central-2', 'eu-north-1', 'ap-south-1', 'ap-southeast-1', 'ap-southeast-2', 'ap-northeast-1', 'ap-northeast-2']
function candidates(e) { const u = new URL(e.url), pass = decodeURIComponent(u.password), db = u.pathname.slice(1) || 'postgres', user = decodeURIComponent(u.username) || 'postgres'
  const pooler = /\.pooler\.supabase\.com$/.test(u.hostname)
  const out = [{ label: pooler ? 'pooler de session (IPv4)' : 'connexion directe', host: u.hostname, port: Number(u.port) || 5432, user, password: pass, database: db }]
  if (pooler) out.push({ ...out[0], label: 'pooler de transaction (IPv4)', port: out[0].port === 5432 ? 6543 : 5432 })   // port bloqué : autre mode du même pooler
  const m = u.hostname.match(/^db\.([a-z0-9]+)\.supabase\.co$/)
  if (m) { const regs = e.region ? [e.region] : REGIONS, saved = readJson(CACHE(), {}).via
    for (const r of regs) for (const pfx of ['aws-0', 'aws-1']) for (const [port, mode] of [[5432, 'pooler de session'], [6543, 'pooler de transaction']]) out.push({ label: `${mode} ${r}`, host: `${pfx}-${r}.pooler.supabase.com`, port, user: `postgres.${m[1]}`, password: pass, database: db })
    if (saved) out.sort((a, b) => (b.host === saved.host && b.port === saved.port) - (a.host === saved.host && a.port === saved.port)) }
  return out }
let fake = null
async function connect() {
  if (process.env.CLOUD_FAKE_PG) { const { PGlite } = await import('@electric-sql/pglite'); fake ||= new PGlite(process.env.CLOUD_FAKE_PG); if (process.env.CLOUD_FAKE_OFFLINE && fs.existsSync(process.env.CLOUD_FAKE_OFFLINE)) throw Object.assign(new Error('Pas de connexion Internet'), { code: 'ENOTFOUND' }); return { query: (t, p) => fake.query(t, p), end: async () => {}, via: { label: 'base de test', host: 'local' } } }
  const pg = (await import('pg')).default, e = env(), errs = [], cands = candidates(e)
  const tryOne = c => new Promise((resolve, reject) => { const cl = new pg.Client({ ...c, ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 7000, statement_timeout: 120000, application_name: 'dental-light' })
    cl.connect().then(() => resolve({ cl, c }), err => { errs.push({ c, code: err.code, msg: err.message }); cl.end().catch(() => {}); reject(err) }) })
  const done = ({ cl, c }) => { const via = { label: c.label, host: c.host, port: c.port }; const cache = readJson(CACHE(), {}); cache.via = via; writeJson(CACHE(), cache); return { query: (t, p) => cl.query(t, p), end: () => cl.end(), via } }
  // 1) adresse retenue lors de la dernière connexion réussie, ou adresse directe
  try { return done(await tryOne(cands[0])) } catch (err) { if (/password authentication failed/i.test(err.message)) throw Object.assign(new Error('Mot de passe Supabase refusé : vérifiez SUPABASE_DB_URL dans backend/.env (caractères spéciaux encodés : @ → %40, # → %23)'), { auth: true }) }
  // 2) toutes les autres adresses (poolers IPv4) essayées en même temps : la première qui répond est gardée
  const rest = cands.slice(1); if (rest.length) { const tries = rest.map(tryOne)
    try { const win = await Promise.any(tries); Promise.allSettled(tries).then(rs => rs.forEach(x => x.status === 'fulfilled' && x.value.cl !== win.cl && x.value.cl.end().catch(() => {}))); return done(win) }
    catch { if (errs.some(x => /password authentication failed/i.test(x.msg))) throw Object.assign(new Error('Mot de passe Supabase refusé : vérifiez SUPABASE_DB_URL dans backend/.env'), { auth: true }) } }
  errs.sort((x, y) => (y.c === cands[0]) - (x.c === cands[0]))
  const direct = errs[0], allTimeout = errs.slice(1).every(x => /timeout|ETIMEDOUT/i.test(x.code || x.msg))
  const hint = direct && /ENOTFOUND|EAI_AGAIN|ENETUNREACH|EHOSTUNREACH/.test(direct.code || '') && allTimeout ? "Connexion directe impossible (réseau sans IPv6) et ports 5432/6543 fermés vers les poolers : ouvrez ces ports sur le pare-feu / le routeur, ou ajoutez SUPABASE_SERVICE_KEY dans backend/.env pour passer par HTTPS (port 443)."
    : direct && /ENOTFOUND|EAI_AGAIN/.test(direct.code || '') ? 'Pas de connexion Internet (ou adresse Supabase inconnue)' : 'Supabase injoignable : ' + (direct?.msg || 'erreur inconnue') + (httpsConfigured() ? '' : ' — réseau qui bloque PostgreSQL (5432/6543) : ajoutez SUPABASE_SERVICE_KEY dans backend/.env pour passer par HTTPS')
  throw Object.assign(new Error(hint), { offline: true, details: errs.slice(0, 4).map(x => `${x.c.label} : ${x.code || x.msg}`) }) }

// ── schéma distant : chaque table locale est recréée dans dental_light (colonnes et clé primaire), sans contraintes ──
const SKIP = new Set(['dl_changelog'])   // toutes les tables sont envoyées (sauf le journal des transactions, technique et purgé toutes les 15 min)
const NO_RESTORE = new Set(['schema_migrations'])   // la structure locale reste celle de cette version
// réglages et journaux de l'application (hors base) : envoyés aussi
const CONF_FILES = ['reglages.json', 'sequence.json', 'journal.json']
const confFiles = () => CONF_FILES.map(n => [n, path.join(BDIR(), n)]).filter(([, p]) => fs.existsSync(p))
async function localTables() {
  const t = (await q("select table_name from information_schema.tables where table_schema='public' and table_type='BASE TABLE' order by table_name")).rows.map(r => r.table_name).filter(n => !SKIP.has(n))
  const out = []; for (const name of t) {
    const cols = (await q("select a.attname col, format_type(a.atttypid, a.atttypmod) typ from pg_attribute a join pg_class c on c.oid=a.attrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname=$1 and a.attnum>0 and not a.attisdropped order by a.attnum", [name])).rows
    const pk = (await q("select a.attname col from pg_index i join pg_class c on c.oid=i.indrelid join pg_namespace n on n.oid=c.relnamespace join pg_attribute a on a.attrelid=c.oid and a.attnum=any(i.indkey) where n.nspname='public' and c.relname=$1 and i.indisprimary order by array_position(i.indkey, a.attnum)", [name])).rows.map(r => r.col)
    out.push({ name, cols, pk }) }
  return out }
async function ensureSchema(r, tables) {
  await r.query(`create schema if not exists ${S()}`)
  for (const t of tables) {
    await r.query(`create table if not exists ${S()}.${qi(t.name)} (${t.cols.map(c => `${qi(c.col)} ${c.typ}`).join(', ')}${t.pk.length ? `, primary key (${t.pk.map(qi).join(', ')})` : ''})`)
    for (const c of t.cols) await r.query(`alter table ${S()}.${qi(t.name)} add column if not exists ${qi(c.col)} ${c.typ}`) }
  await r.query(`create table if not exists ${S()}.dl_files (path text primary key, size bigint, sha256 text, data bytea, updated_at timestamptz default now())`)
  await r.query(`create table if not exists ${S()}.dl_backups (id text not null, part int not null, data bytea not null, meta jsonb, uploaded_at timestamptz default now(), primary key (id, part))`)
  await r.query(`create table if not exists ${S()}.dl_sync (clinic text primary key, last_sync timestamptz, tables int, rows bigint, app_version text)`) }

// ── données : seules les lignes nouvelles ou modifiées sont envoyées (empreinte par ligne, gardée localement) ──
const val = v => v === null || v === undefined ? null : Buffer.isBuffer(v) || v instanceof Uint8Array ? Buffer.from(v) : v instanceof Date ? v.toISOString() : Array.isArray(v) ? v : typeof v === 'object' ? JSON.stringify(v) : v
async function syncTable(r, t, cache) {
  const rows = (await q(`select * from ${qi(t.name)}`)).rows, key = row => t.pk.length ? t.pk.map(k => String(row[k])).join('\u0001') : sha(JSON.stringify(row))
  let prev = cache[t.name] || {}; const next = {}, changed = []
  if (Object.keys(prev).length && t.pk.length && !(await r.query(`select exists(select 1 from ${S()}.${qi(t.name)}) e`)).rows[0].e) prev = {}   // table vidée côté Supabase : tout renvoyer
  for (const row of rows) { const k = key(row), h = sha(JSON.stringify(row, (_, v) => typeof v === 'bigint' ? v.toString() : v)); next[k] = h; if (prev[k] !== h) changed.push(row) }
  const removed = Object.keys(prev).filter(k => !(k in next))
  const cols = t.cols.map(c => c.col), casts = t.cols.map(c => c.typ)
  for (let i = 0; i < changed.length; i += 200) { const chunk = changed.slice(i, i + 200), params = [], tuples = chunk.map(row => '(' + cols.map((c, j) => { params.push(/^jsonb?$/.test(casts[j]) ? (row[c] == null ? null : JSON.stringify(row[c])) : val(row[c])); return `$${params.length}::${casts[j]}` }).join(',') + ')')
    const upd = cols.filter(c => !t.pk.includes(c)).map(c => `${qi(c)}=excluded.${qi(c)}`).join(', ')
    await r.query(`insert into ${S()}.${qi(t.name)} (${cols.map(qi).join(',')}) values ${tuples.join(',')}${t.pk.length ? ` on conflict (${t.pk.map(qi).join(',')}) do ${upd ? 'update set ' + upd : 'nothing'}` : ''}`, params) }
  if (t.pk.length && removed.length) for (let i = 0; i < removed.length; i += 200) { const ks = removed.slice(i, i + 200).map(k => k.split('\u0001')), params = []
    await r.query(`delete from ${S()}.${qi(t.name)} where (${t.pk.map(qi).join(',')}) in (${ks.map(k => '(' + k.map((v, j) => { params.push(v); return `$${params.length}::${t.cols.find(c => c.col === t.pk[j]).typ}` }).join(',') + ')').join(',')})`, params) }
  cache[t.name] = next; return changed.length + removed.length }
async function syncFiles(r, cache) { const root = config.storageDir, prev = cache.__files || {}, next = {}; let n = 0
  const walk = d => fs.existsSync(d) ? fs.readdirSync(d, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]) : []
  for (const f of walk(root)) { const rel = path.relative(root, f).split(path.sep).join('/'), st = fs.statSync(f), tag = st.size + ':' + st.mtimeMs; next[rel] = tag; if (prev[rel] === tag) continue
    const buf = fs.readFileSync(f); await r.query(`insert into ${S()}.dl_files (path,size,sha256,data,updated_at) values ($1,$2,$3,$4,now()) on conflict (path) do update set size=excluded.size, sha256=excluded.sha256, data=excluded.data, updated_at=now()`, [rel, buf.length, sha(buf), buf]); n++ }
  for (const [name, p] of confFiles()) { const buf = fs.readFileSync(p), h = sha(buf), rel = '__config/' + name; next[rel] = h; if (prev[rel] === h) continue
    await r.query(`insert into ${S()}.dl_files (path,size,sha256,data,updated_at) values ($1,$2,$3,$4,now()) on conflict (path) do update set size=excluded.size, sha256=excluded.sha256, data=excluded.data, updated_at=now()`, [rel, buf.length, h, buf]); n++ }
  cache.__files = next; return n }

// ── sauvegardes complètes : archive (base + documents) découpée en parties de 8 Mo ──
function pack(dir) { const files = [], walk = (p, rel) => { for (const e of fs.readdirSync(p, { withFileTypes: true })) { const f = path.join(p, e.name), r = rel ? rel + '/' + e.name : e.name; if (e.isDirectory()) walk(f, r); else files.push([r, f]) } }; walk(dir, '')
  const chunks = []; for (const [r, f] of files) { const name = Buffer.from(r), data = fs.readFileSync(f), h = Buffer.alloc(12); h.writeUInt32BE(name.length, 0); h.writeUInt32BE(Math.floor(data.length / 2 ** 32), 4); h.writeUInt32BE(data.length >>> 0, 8); chunks.push(h, name, data) }
  return Buffer.concat(chunks) }
function unpack(buf, dir) { let o = 0; while (o < buf.length) { const nl = buf.readUInt32BE(o), size = buf.readUInt32BE(o + 4) * 2 ** 32 + buf.readUInt32BE(o + 8); o += 12; const name = buf.subarray(o, o + nl).toString(); o += nl
    const target = path.resolve(dir, name); if (!target.startsWith(path.resolve(dir) + path.sep)) throw new Error('Archive invalide'); fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, buf.subarray(o, o + size)); o += size } }
async function uploadBackup(r, b) { const blob = sealFile(pack(path.join(BDIR(), b.id))), parts = Math.max(1, Math.ceil(blob.length / PART)), meta = { id: b.id, seq: b.seq, kind: b.kind, created_at: b.created_at, counts: b.counts, files: b.files, parts, size: blob.length, sha256: sha(blob) }
  setState({ uploading: { id: b.id, part: 0, parts } })
  for (let i = 0; i < parts; i++) { await r.query(`insert into ${S()}.dl_backups (id,part,data,meta) values ($1,$2,$3,$4) on conflict (id,part) do update set data=excluded.data, meta=excluded.meta`, [b.id, i, blob.subarray(i * PART, (i + 1) * PART), i === parts - 1 ? JSON.stringify(meta) : null]); setState({ uploading: { id: b.id, part: i + 1, parts } }) }
  const chk = (await r.query(`select count(*)::int n from ${S()}.dl_backups where id=$1`, [b.id])).rows[0].n; if (chk !== parts) throw new Error('Vérification de la copie en ligne échouée')
  const mf = path.join(BDIR(), b.id, 'manifest.json'), man = readJson(mf, {}); man.cloud = { at: new Date().toISOString(), parts, size: blob.length, sha256: meta.sha256, target: 'supabase' }; fs.writeFileSync(mf, JSON.stringify(man, null, 1))
  journal({ op: 'cloud_upload', id: b.id, ok: true, size: blob.length, parts })
  reportBackup(meta, true).catch(() => {}) }   // remontée vers la console (si SAAS_URL)
export async function listCloud() { if (!configured()) throw Object.assign(new Error('Copie en ligne non configurée : ajoutez SUPABASE_DB_URL dans backend/.env puis redémarrez'), { status: 400 }); if (webFirst()) return listCloudWeb(); let r; try { r = await connect() } catch (e) { if (httpsConfigured()) { notePgFail(); return listCloudWeb() } throw e } try { return (await r.query(`select meta, uploaded_at from ${S()}.dl_backups where meta is not null order by meta->>'created_at' desc`)).rows.map(x => ({ ...(typeof x.meta === 'string' ? JSON.parse(x.meta) : x.meta), uploaded_at: x.uploaded_at })) } catch (e) { if (/does not exist/.test(e.message)) return []; throw e } finally { await r.end() } }
export async function importCloud(id) { if (!configured()) throw Object.assign(new Error('Copie en ligne non configurée : ajoutez SUPABASE_DB_URL dans backend/.env puis redémarrez'), { status: 400 });
  if (!/^[\w.:-]+$/.test(id)) throw new Error('Copie invalide'); if (listBackups().some(b => b.id === id)) throw new Error('Cette sauvegarde existe déjà sur cet ordinateur')
  let meta, blob, r = null; if (!webFirst()) { try { r = await connect() } catch (e) { if (!httpsConfigured()) throw e; notePgFail() } }
  if (r) { let rows; try { rows = (await r.query(`select part, data, meta from ${S()}.dl_backups where id=$1 order by part`, [id])).rows } finally { await r.end() }
    const metaRow = rows.find(x => x.meta); meta = metaRow && (typeof metaRow.meta === 'string' ? JSON.parse(metaRow.meta) : metaRow.meta); if (!meta || rows.length !== meta.parts) throw new Error('Copie en ligne incomplète')
    blob = Buffer.concat(rows.map(x => Buffer.from(x.data))) } else ({ meta, blob } = await fetchBackupWeb(id))
  if (blob.length !== meta.size && meta.size) throw new Error('Copie en ligne incomplète'); if (sha(blob) !== meta.sha256) throw new Error('Copie en ligne altérée (empreinte différente)')
  const dir = path.join(BDIR(), id), tmp = dir + '.import'; fs.rmSync(tmp, { recursive: true, force: true }); fs.mkdirSync(tmp, { recursive: true })
  try { unpack(openFile(blob), tmp); const man = readJson(path.join(tmp, 'manifest.json'), null); if (!man?.verified || sha(fs.readFileSync(path.join(tmp, 'db.tar.gz'))) !== man.db_sha256) throw new Error('Contenu de la copie invalide')
    man.cloud = { ...(man.cloud || {}), imported: new Date().toISOString() }; fs.writeFileSync(path.join(tmp, 'manifest.json'), JSON.stringify(man, null, 1)); fs.renameSync(tmp, dir) }
  catch (e) { fs.rmSync(tmp, { recursive: true, force: true }); throw e }
  journal({ op: 'cloud_import', id, ok: true }); return { id, counts: meta.counts } }

// ── voie web : HTTPS (port 443), quand le réseau bloque PostgreSQL ──
const BUCKET = 'dental-light', CACHE_W = () => path.join(BDIR(), 'cloud-sync-web.json')
const httpEnv = () => { const e = env(); let ref = ''; try { const u = new URL(e.url); ref = (u.hostname.match(/^db\.([a-z0-9]+)\.supabase\.co$/) || [])[1] || (decodeURIComponent(u.username).match(/^postgres\.([a-z0-9]+)$/) || [])[1] || '' } catch {}
  return { base: (process.env.SUPABASE_URL || (ref ? 'https://' + ref + '.supabase.co' : '')).replace(/\/+$/, ''), key: (process.env.SUPABASE_SERVICE_KEY || '').trim() } }
export const httpsConfigured = () => { const h = httpEnv(); return !!(h.base && h.key) }
// coupure passagère (ECONNRESET, délai, socket fermée) : jusqu'à 3 essais, avec une courte pause
async function rest(method, p, body, headers = {}) {
  for (let i = 0; ; i++) { try { return await rest1(method, p, body, headers) } catch (e) { if (!e.offline || i >= 2) throw e; await new Promise(r => setTimeout(r, 800 * (i + 1))) } } }
async function rest1(method, p, body, headers = {}) {
  const h = httpEnv(), raw = Buffer.isBuffer(body), auth = h.key.startsWith('eyJ') ? { Authorization: 'Bearer ' + h.key } : {}
  let res; try { res = await fetch(h.base + p, { method, headers: { apikey: h.key, ...auth, ...(body !== undefined && !raw ? { 'Content-Type': 'application/json' } : {}), ...headers }, body: body === undefined ? undefined : raw ? body : JSON.stringify(body), signal: AbortSignal.timeout(120000) }) }
  catch (e) { throw Object.assign(new Error('Supabase (HTTPS) injoignable : ' + (e.cause?.code || e.name === 'TimeoutError' && 'délai dépassé' || e.message)), { offline: true }) }
  const ct = res.headers.get('content-type') || ''
  if (!res.ok) { const t = await res.text(); let j = {}; try { j = JSON.parse(t) } catch {}
    const msg = String(j.message || j.msg || j.error || t || res.statusText)
    if (res.status === 401 || (res.status === 403 && /jwt|api ?key|signature|unauthori/i.test(msg))) throw Object.assign(new Error('Clé Supabase refusée : vérifiez SUPABASE_SERVICE_KEY (clé « service_role » ou « secret ») dans backend/.env'), { auth: true })
    if (j.code === 'PGRST205' || j.code === '42P01' || /could not find the table|relation .* does not exist/i.test(msg)) throw Object.assign(new Error('Tables absentes dans Supabase : exécutez une fois db/supabase/setup.sql dans Supabase → SQL Editor'), { setup: true })
    throw Object.assign(new Error('Supabase ' + res.status + ' : ' + msg), { status: res.status }) }
  if (ct.includes('json')) { const t = await res.text(); return t ? JSON.parse(t) : null }
  return Buffer.from(await res.arrayBuffer()) }
const obj = p => '/storage/v1/object/' + BUCKET + '/' + p.split('/').map(encodeURIComponent).join('/')
const putObj = (p, buf) => rest('POST', obj(p), buf, { 'Content-Type': 'application/octet-stream', 'x-upsert': 'true' })
const pin = ks => 'in.(' + ks.map(k => '"' + String(k).replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"').join(',') + ')'
const jv = v => v === null || v === undefined ? null : v instanceof Uint8Array ? { $base64: Buffer.from(v).toString('base64') } : v instanceof Date ? v.toISOString() : typeof v === 'bigint' ? v.toString() : Array.isArray(v) ? v.map(jv) : v
async function ensureBucket() { try { await rest('POST', '/storage/v1/bucket', { id: BUCKET, name: BUCKET, public: false }) } catch (e) { if (!/exist|duplicate|409/i.test(e.message)) throw e } }
async function syncTableWeb(t, cache, counts) {
  const rows = (await q('select * from ' + qi(t.name))).rows, key = row => t.pk.length ? t.pk.map(k => String(row[k])).join('\u0001') : sha(JSON.stringify(row, (_, v) => typeof v === 'bigint' ? v.toString() : v))
  let prev = cache[t.name] || {}
  // copie en ligne différente de ce qu'on croit avoir envoyé (1re fois, table vidée…) : la table est renvoyée en entier
  if (Object.keys(prev).length !== (counts[t.name] || 0)) { if (counts[t.name]) await rest('DELETE', '/rest/v1/dl_rows?tbl=eq.' + encodeURIComponent(t.name), undefined, { Prefer: 'return=minimal' }); prev = {} }
  const next = {}, changed = [], now = new Date().toISOString()
  for (const row of rows) { const k = key(row), h = sha(JSON.stringify(row, (_, v) => typeof v === 'bigint' ? v.toString() : v)); next[k] = h
    if (prev[k] !== h) changed.push({ tbl: t.name, pk: k, data: Object.fromEntries(Object.entries(row).map(([c, v]) => [c, jv(v)])), hash: h, updated_at: now }) }
  const removed = Object.keys(prev).filter(k => !(k in next))
  for (let i = 0; i < changed.length; i += 300) await rest('POST', '/rest/v1/dl_rows?on_conflict=tbl,pk', changed.slice(i, i + 300), { Prefer: 'resolution=merge-duplicates,return=minimal' })
  for (let i = 0; i < removed.length; i += 80) await rest('DELETE', '/rest/v1/dl_rows?tbl=eq.' + encodeURIComponent(t.name) + '&pk=' + encodeURIComponent(pin(removed.slice(i, i + 80))), undefined, { Prefer: 'return=minimal' })
  cache[t.name] = next; return changed.length + removed.length }
async function syncFilesWeb(cache) { const root = config.storageDir, prev = cache.__files || {}, next = {}; let n = 0
  const walk = d => fs.existsSync(d) ? fs.readdirSync(d, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]) : []
  for (const f of walk(root)) { const rel = path.relative(root, f).split(path.sep).join('/'), st = fs.statSync(f), tag = st.size + ':' + st.mtimeMs; next[rel] = tag; if (prev[rel] === tag) continue
    await putObj('fichiers/' + rel, fs.readFileSync(f)); n++ }
  for (const [name, p] of confFiles()) { const buf = fs.readFileSync(p), h = sha(buf), rel = '__config/' + name; next[rel] = h; if (prev[rel] === h) continue; await putObj('config/' + name, buf); n++ }
  cache.__files = next; return n }
async function uploadBackupWeb(b) { const blob = sealFile(pack(path.join(BDIR(), b.id))), parts = Math.max(1, Math.ceil(blob.length / PART)), meta = { id: b.id, seq: b.seq, kind: b.kind, created_at: b.created_at, counts: b.counts, files: b.files, parts, size: blob.length, sha256: sha(blob) }
  setState({ uploading: { id: b.id, part: 0, parts } })
  for (let i = 0; i < parts; i++) { await putObj('sauvegardes/' + b.id + '/' + String(i).padStart(4, '0'), blob.subarray(i * PART, (i + 1) * PART)); setState({ uploading: { id: b.id, part: i + 1, parts } }) }
  // vérification : toutes les parties présentes en ligne, avec la bonne taille totale
  const listed = await rest('POST', '/storage/v1/object/list/' + BUCKET, { prefix: 'sauvegardes/' + b.id + '/', limit: 1000 }) || []
  const total = listed.reduce((a, x) => a + Number(x.metadata?.size || 0), 0); if (listed.length !== parts || total !== blob.length) throw new Error('Vérification de la copie en ligne échouée')
  await rest('POST', '/rest/v1/dl_rows?on_conflict=tbl,pk', [{ tbl: '__sauvegardes', pk: b.id, data: meta, hash: meta.sha256, updated_at: new Date().toISOString() }], { Prefer: 'resolution=merge-duplicates,return=minimal' })
  const mf = path.join(BDIR(), b.id, 'manifest.json'), man = readJson(mf, {}); man.cloud = { at: new Date().toISOString(), parts, size: blob.length, sha256: meta.sha256, target: 'supabase-storage' }; fs.writeFileSync(mf, JSON.stringify(man, null, 1))
  journal({ op: 'cloud_upload', id: b.id, ok: true, size: blob.length, parts, via: 'https' }) }
async function listCloudWeb() { return ((await rest('GET', '/rest/v1/dl_rows?tbl=eq.__sauvegardes&select=data,updated_at')) || []).map(x => ({ ...x.data, uploaded_at: x.updated_at })).sort((a, b) => String(b.created_at).localeCompare(String(a.created_at))) }
async function fetchBackupWeb(id) { const meta = (await listCloudWeb()).find(x => x.id === id); if (!meta) throw new Error('Copie en ligne introuvable')
  const parts = []; for (let i = 0; i < meta.parts; i++) parts.push(await rest('GET', obj('sauvegardes/' + id + '/' + String(i).padStart(4, '0'))))
  return { meta, blob: Buffer.concat(parts) } }
async function doSyncWeb(e, wasOnline, pgErr) {
  const h = httpEnv(), via = { mode: 'https', label: 'HTTPS (port 443)', host: new URL(h.base).hostname, port: 443 }, at = () => new Date().toISOString()
  try { await rest('GET', '/rest/v1/dl_sync?select=clinic&limit=1') }
  catch (err) { setState({ online: err.offline ? false : true, last_check: at(), last_error: err.message, hint: pgErr ? ['PostgreSQL : ' + pgErr.message.split(' — ')[0]] : null }); return { offline: !!err.offline, error: err.message } }
  const c0 = readJson(CACHE(), {}); c0.via = via; writeJson(CACHE(), c0)
  try {
    setState({ online: true, last_check: at(), via, last_error: null, hint: null })
    await freshBackup(e, wasOnline)
    const tables = await localTables(), cache = readJson(CACHE_W(), {})
    const counts = Object.fromEntries(((await rest('GET', '/rest/v1/dl_resume?select=table_origine,lignes')) || []).map(x => [x.table_origine, Number(x.lignes)]))
    let rows = 0; for (const t of tables) { rows += await syncTableWeb(t, cache, counts); writeJson(CACHE_W(), cache) }
    if (!cache.__bucket) { await ensureBucket(); cache.__bucket = true }
    const files = await syncFilesWeb(cache); writeJson(CACHE_W(), cache)
    const sent = []; for (const b of listBackups().filter(b => b.verified && !b.cloud).slice(0, 3)) { await uploadBackupWeb(b); sent.push(b.id) }
    const old = (await listCloudWeb()).slice(e.keep)
    for (const m of old) { await rest('DELETE', '/storage/v1/object/' + BUCKET, { prefixes: Array.from({ length: m.parts }, (_, i) => 'sauvegardes/' + m.id + '/' + String(i).padStart(4, '0')) }); await rest('DELETE', '/rest/v1/dl_rows?tbl=eq.__sauvegardes&pk=eq.' + encodeURIComponent(m.id), undefined, { Prefer: 'return=minimal' }) }
    const total = tables.reduce((a, t) => a + Object.keys(cache[t.name] || {}).length, 0)
    await rest('POST', '/rest/v1/dl_sync?on_conflict=clinic', [{ clinic: 'principal', last_sync: at(), tables: tables.length, rows: total, via: 'https' }], { Prefer: 'resolution=merge-duplicates,return=minimal' })
    setState({ last_sync: at(), last_error: null, tables: tables.length, rows_sent: rows, files_sent: files })
    if (rows || files || sent.length) journal({ op: 'cloud_sync', ok: true, rows, files, backups: sent.length, via: 'https' })
    return { sent, rows, files, tables: tables.length, via }
  } catch (err) { setState({ last_error: err.message, ...(err.offline ? { online: false } : {}) }); journal({ op: 'cloud_sync', ok: false, error: err.message, via: 'https' }); return { error: err.message } } }
// voie retenue : web si elle a fonctionné en dernier (PostgreSQL n'est réessayé que toutes les 30 min)
const notePgTryReset = () => { const c = readJson(CACHE(), {}); c.pg_try = 0; if (c.via?.mode === 'https') delete c.via; writeJson(CACHE(), c) }
const webFirst = () => { if (!httpsConfigured()) return false; const c = readJson(CACHE(), {}); return c.via?.mode === 'https' && Date.now() - (c.pg_try || 0) < 30 * 6e4 }
const notePgFail = () => { const c = readJson(CACHE(), {}); c.pg_try = Date.now(); writeJson(CACHE(), c) }
async function freshBackup(e, wasOnline) {
  const newest = listBackups().filter(b => b.verified)[0]
  if (!newest || Date.now() - new Date(newest.created_at) > Math.max(24, e.fresh_hours) * 36e5) { try { await createBackup({ kind: 'auto', by: 'avant envoi en ligne' }) } catch (x) { journal({ op: 'backup', ok: false, error: x.message }) } } }

// ── synchronisation complète ──
export async function checkOnline() { if (!configured()) return { online: false, reason: 'not_configured' }
  try { if (webFirst()) throw Object.assign(new Error('web'), { skip: true }); const r = await connect(); await r.query('select 1'); await r.end(); setState({ online: true, last_check: new Date().toISOString(), last_error: null, hint: null, via: r.via }); return { online: true, via: r.via } }
  catch (e) { if (httpsConfigured()) { if (!e.skip) notePgFail(); try { await rest('GET', '/rest/v1/dl_sync?select=clinic&limit=1'); const via = { mode: 'https', label: 'HTTPS (port 443)', host: new URL(httpEnv().base).hostname, port: 443 }; setState({ online: true, last_check: new Date().toISOString(), last_error: null, hint: null, via }); return { online: true, via } } catch (w) { e = w } } setState({ online: false, last_check: new Date().toISOString(), last_error: e.message, hint: e.details || null }); return { online: false, error: e.message } } }
let running = null
let pulling = false
export function syncNow(opts = {}) { if (pulling) return Promise.resolve({ skipped: 'récupération depuis Supabase en cours' }); if (running) return running; running = doSync(opts).finally(() => { running = null; setState({ uploading: null }) }); return running }
async function doSync() {
  const e = env(); if (!e.url || !e.enabled) return { skipped: 'non configuré (SUPABASE_DB_URL absent de .env) ou désactivé (SUPABASE_SYNC=off)' }
  let r = null; const wasOnline = cloudState().online
  if (webFirst()) { const w = await doSyncWeb(e, wasOnline, null); if (!w.offline && !w.error?.includes('injoignable')) return w
    notePgTryReset() }   // la voie web ne répond pas : retour immédiat à PostgreSQL ci-dessous
  try { r = await connect() } catch (err) { if (httpsConfigured()) { notePgFail(); return doSyncWeb(e, wasOnline, err) } setState({ online: false, last_check: new Date().toISOString(), last_error: err.message, hint: err.details || null }); return { offline: true, error: err.message } }
  try {
    setState({ online: true, last_check: new Date().toISOString(), via: r.via, last_error: null, hint: null })
    // retour de connexion après une longue coupure : sauvegarde fraîche d'abord
    await freshBackup(e, wasOnline)
    const tables = await localTables(); await ensureSchema(r, tables)
    const cache = readJson(CACHE(), {}); let rows = 0
    for (const t of tables) rows += await syncTable(r, t, cache)
    const files = await syncFiles(r, cache); writeJson(CACHE(), cache)
    const sent = []; for (const b of listBackups().filter(b => b.verified && !b.cloud).slice(0, 3)) { await uploadBackup(r, b); sent.push(b.id) }
    // conservation en ligne : les N sauvegardes les plus récentes
    const ids = (await r.query(`select id from ${S()}.dl_backups where meta is not null order by meta->>'created_at' desc`)).rows.map(x => x.id); for (const id of ids.slice(e.keep)) await r.query(`delete from ${S()}.dl_backups where id=$1`, [id])
    await r.query(`insert into ${S()}.dl_sync (clinic,last_sync,tables,rows) values ('principal',now(),$1,$2) on conflict (clinic) do update set last_sync=now(), tables=$1, rows=$2`, [tables.length, Object.values(cache).reduce((a, m) => a + Object.keys(m || {}).length, 0)])
    setState({ last_sync: new Date().toISOString(), last_error: null, tables: tables.length, rows_sent: rows, files_sent: files })
    if (rows || files || sent.length) journal({ op: 'cloud_sync', ok: true, rows, files, backups: sent.length })
    return { sent, rows, files, tables: tables.length, via: r.via }
  } catch (err) { setState({ last_error: err.message }); journal({ op: 'cloud_sync', ok: false, error: err.message }); return { error: err.message } }
  finally { try { await r.end() } catch {} } }

// ── récupération : reconstruire les données locales à partir de la copie Supabase (en cas de perte locale) ──
async function openRemote() { let r = null; if (!webFirst()) { try { r = await connect() } catch (e) { if (!httpsConfigured()) throw e; notePgFail() } } return r }
async function webList(prefix) { const out = []; const items = await rest('POST', '/storage/v1/object/list/' + BUCKET, { prefix, limit: 1000, offset: 0 }) || []
  for (const it of items) { if (it.id === null || !it.metadata) out.push(...await webList(prefix + it.name + '/')); else out.push(prefix + it.name) } return out }
async function remoteCounts(r) {
  if (!r) return Object.fromEntries(((await rest('GET', '/rest/v1/dl_resume?select=table_origine,lignes')) || []).map(x => [x.table_origine, Number(x.lignes)]))
  const ex = new Set((await r.query("select table_name from information_schema.tables where table_schema=$1", [S()])).rows.map(x => x.table_name)), out = {}
  for (const t of await localTables()) if (ex.has(t.name)) out[t.name] = Number((await r.query('select count(*)::int n from ' + S() + '.' + qi(t.name))).rows[0].n)
  return out }
// comparaison local / en ligne, table par table (rien n'est modifié)
export async function previewCloud() { if (!configured()) throw Object.assign(new Error('Copie en ligne non configurée : ajoutez SUPABASE_DB_URL dans backend/.env puis redémarrez'), { status: 400 });
  const r = await openRemote(); try {
    const remote = await remoteCounts(r), tables = await localTables(), last = r ? (await r.query('select last_sync from ' + S() + '.dl_sync limit 1').catch(() => ({ rows: [] }))).rows[0]?.last_sync : ((await rest('GET', '/rest/v1/dl_sync?select=last_sync&limit=1')) || [])[0]?.last_sync
    const rows = []; for (const t of tables) { if (NO_RESTORE.has(t.name)) continue; rows.push({ table: t.name, local: Number((await q('select count(*)::int n from ' + qi(t.name))).rows[0].n), cloud: remote[t.name] || 0 }) }
    return { via: r ? r.via : { mode: 'https', label: 'HTTPS (port 443)' }, last_sync: last || null, tables: rows, total_local: rows.reduce((a, x) => a + x.local, 0), total_cloud: rows.reduce((a, x) => a + x.cloud, 0) }
  } finally { if (r) await r.end().catch(() => {}) } }
const fromJv = v => v && typeof v === 'object' && !Array.isArray(v) && typeof v.$base64 === 'string' && Object.keys(v).length === 1 ? '\\x' + Buffer.from(v.$base64, 'base64').toString('hex') : v
const localDay = v => { if (typeof v !== 'string' || !v.includes('T')) return v; const d = new Date(v); return isNaN(d) ? v : d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0') }
export async function pullCloud({ by } = {}) { if (!configured()) throw Object.assign(new Error('Copie en ligne non configurée : ajoutez SUPABASE_DB_URL dans backend/.env puis redémarrez'), { status: 400 });
  if (pulling) throw new Error('Une récupération est déjà en cours'); pulling = true
  try {
    if (running) await running.catch(() => {})
    const tables = (await localTables()).filter(t => !NO_RESTORE.has(t.name)), data = {}, files = []
    // 1. lecture complète de la copie en ligne (rien n'est encore modifié ici)
    const r = await openRemote()
    try {
      if (r) { const ex = new Set((await r.query("select table_name from information_schema.tables where table_schema=$1", [S()])).rows.map(x => x.table_name)); if (!ex.size) throw new Error('Aucune donnée en ligne à récupérer')
        for (const t of tables) if (ex.has(t.name)) data[t.name] = (await r.query('select row_to_json(x) j from ' + S() + '.' + qi(t.name) + ' x')).rows.map(row => typeof row.j === 'string' ? JSON.parse(row.j) : row.j)   // dates, montants et binaires gardés au format texte exact
        for (const x of (await r.query('select path, data from ' + S() + '.dl_files')).rows) files.push([x.path, Buffer.from(x.data)]) }
      else { for (const t of tables) { const all = []; for (let o = 0; ; o += 1000) { const page = await rest('GET', '/rest/v1/dl_rows?tbl=eq.' + encodeURIComponent(t.name) + '&select=data&order=pk&limit=1000&offset=' + o) || []; all.push(...page.map(x => x.data)); if (page.length < 1000) break } if (all.length) data[t.name] = all }
        for (const p of await webList('fichiers/')) files.push([p.slice('fichiers/'.length), await rest('GET', obj(p))])
        for (const p of await webList('config/')) files.push(['__config/' + p.slice('config/'.length), await rest('GET', obj(p))]) }
    } finally { if (r) await r.end().catch(() => {}) }
    if (!data.users?.length) throw new Error('Copie en ligne incomplète (aucun compte utilisateur) : récupération annulée, rien n\'a été modifié')
    // 2. sauvegarde de sécurité de l'état local actuel
    let safety = null; try { safety = (await createBackup({ kind: 'avant-restauration', by: (by || 'propriétaire') + ' · avant récupération Supabase' }))?.id || true } catch (x) { journal({ op: 'backup', ok: false, error: x.message }) }
    // 3. remplacement de toutes les données, en une seule transaction (tout ou rien)
    const c = await pool.connect(); let n = 0
    try { await c.query('begin'); await c.query('set local session_replication_role = replica')
      await c.query('truncate ' + tables.map(t => qi(t.name)).join(', '))
      for (const t of tables) { const rows = data[t.name]; if (!rows?.length) continue
        const typ = Object.fromEntries(t.cols.map(x => [x.col, x.typ])), gen = new Set((await c.query("select attname from pg_attribute a join pg_class k on k.oid=a.attrelid join pg_namespace s on s.oid=k.relnamespace where s.nspname='public' and k.relname=$1 and a.attgenerated <> ''", [t.name])).rows.map(x => x.attname))
        const cols = t.cols.map(x => x.col).filter(col => !gen.has(col) && rows.some(row => col in row)), list = cols.map(qi).join(',')
        for (let i = 0; i < rows.length; i += 500) { const chunk = rows.slice(i, i + 500).map(row => Object.fromEntries(cols.filter(col => col in row).map(col => { const v = fromJv(row[col]); return [col, typ[col] === 'date' ? localDay(v) : v] })))
          await c.query('insert into ' + qi(t.name) + ' (' + list + ') overriding system value select ' + list + ' from json_populate_recordset(null::' + qi(t.name) + ', $1::json)', [JSON.stringify(chunk)]); n += chunk.length } }
      // compteurs automatiques remis après les plus grands numéros récupérés
      for (const x of (await c.query("select table_name t, column_name col, pg_get_serial_sequence(quote_ident(table_name), column_name) seq from information_schema.columns where table_schema='public' and pg_get_serial_sequence(quote_ident(table_name), column_name) is not null")).rows)
        await c.query('select setval($1, coalesce((select max(' + qi(x.col) + ') from ' + qi(x.t) + '), 0) + 1, false)', [x.seq])
      await c.query('commit') }
    catch (e) { await c.query('rollback').catch(() => {}); throw new Error('Récupération annulée, aucune donnée locale modifiée : ' + e.message) }
    finally { c.release() }
    // 4. documents, radiographies et réglages
    let nf = 0; const root = path.resolve(config.storageDir)
    for (const [rel, buf] of files) {
      if (rel.startsWith('__config/')) { const name = rel.slice(9); if (!CONF_FILES.includes(name)) continue; const dest = path.join(BDIR(), name); let out = buf
        // journal : fusion (rien de local n'est perdu) ; numérotation : la plus grande des deux
        try { const remote = JSON.parse(buf.toString()), local = readJson(dest, null)
          if (name === 'journal.json' && Array.isArray(remote) && Array.isArray(local)) { const seen = new Set(), all = []; for (const x of [...local, ...remote]) { const k = JSON.stringify(x); if (!seen.has(k)) { seen.add(k); all.push(x) } } out = JSON.stringify(all.sort((x, y) => String(y.at).localeCompare(String(x.at))).slice(0, 500), null, 1) }
          if (name === 'sequence.json' && local) out = JSON.stringify({ ...remote, n: Math.max(Number(remote.n) || 0, Number(local.n) || 0) }) } catch {}
        fs.writeFileSync(dest, out); nf++; continue }
      const target = path.resolve(root, rel); if (!target.startsWith(root + path.sep)) continue
      if (fs.existsSync(target) && sha(fs.readFileSync(target)) === sha(buf)) continue
      fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, buf); nf++ }
    // la copie locale est maintenant identique à la copie en ligne : on repart d'un suivi neuf (tout sera revérifié)
    for (const p of [CACHE_W()]) fs.rmSync(p, { force: true }); const cc = readJson(CACHE(), {}); for (const k of Object.keys(cc)) if (k !== 'via' && k !== 'pg_try') delete cc[k]; writeJson(CACHE(), cc)
    try { bumpEpoch() } catch {}
    journal({ op: 'cloud_pull', ok: true, rows: n, files: nf, tables: Object.keys(data).length })
    return { rows: n, files: nf, tables: Object.keys(data).length, safety }
  } finally { pulling = false } }

// ── automatisation : vérification de la connexion et envoi toutes les 2 minutes ──
export function startCloud() { const every = Number(process.env.CLOUD_INTERVAL_MS) || 2 * 60e3, tick = () => syncNow().catch(e => console.error('Synchronisation Supabase :', e.message)); setTimeout(tick, Math.min(30e3, every)); return setInterval(tick, every) }
