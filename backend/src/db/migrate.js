// Applique les migrations SQL de /db/migrations, dans l'ordre, une seule fois chacune.
import fs from 'fs'
import path from 'path'
import bcrypt from 'bcryptjs'
import { config } from '../config/env.js'

export async function migrate(client, log = console.log) {
  await client.query('create table if not exists schema_migrations(name text primary key, applied_at timestamptz not null default now())')
  const files = fs.readdirSync(config.migrationsDir).filter(f => /^\d+_.+\.sql$/.test(f)).sort()
  const done = new Set((await client.query('select name from schema_migrations')).rows.map(r => r.name))
  let n = 0
  for (const f of files) {
    if (done.has(f)) continue
    await client.query('begin')
    try {
      await client.query(fs.readFileSync(path.join(config.migrationsDir, f), 'utf8'))
      await client.query('insert into schema_migrations(name) values($1)', [f])
      await client.query('commit')
    } catch (e) { await client.query('rollback'); throw new Error(`Migration ${f} échouée : ${e.message}`) }
    log('  ✔ migration appliquée :', f); n++
  }
  if (!n) log('  Base déjà à jour.')
  return n
}

export async function ensureOwner(client, email, password, log = console.log) {
  const ex = (await client.query("select id,last_login_at from users where role='OWNER' and not coalesce((to_jsonb(users)->>'is_emergency')::boolean, false) order by created_at limit 1")).rows[0]
  if (ex) {
    // Tant que le propriétaire ne s'est jamais connecté, .env fait foi (permet de corriger e-mail / mot de passe).
    if (!ex.last_login_at && email && password && password.length >= 10) {
      await client.query('update users set email=$1, password_hash=$2, must_change_password=true, failed_attempts=0, locked_until=null where id=$3', [email.toLowerCase(), await bcrypt.hash(password, 12), ex.id])
      log('Propriétaire synchronisé avec .env (jamais connecté).'); return false }
    log('Propriétaire déjà créé.'); return false }
  if (!email || !password || password.length < 10) throw new Error('OWNER_EMAIL / OWNER_PASSWORD (10+ car.) requis')
  const { rows: [cl] } = await client.query("insert into clinics(name,address,phone) values('DENTAL','Communauté de Saint-Marie, Canapé-Vert','+509 4418-9475') returning id")
  await client.query("insert into users(clinic_id,email,password_hash,first_name,last_name,role,must_change_password) values($1,$2,$3,'Propriétaire','DENTAL','OWNER',true)",
    [cl.id, email.toLowerCase(), await bcrypt.hash(password, 12)])
  log('Clinique et propriétaire créés. Changement de mot de passe exigé à la 1re connexion.')
  return true
}

// Provisioning MULTI-CLINIQUE (instance web partagée) : crée une clinique + son
// propriétaire dans la base partagée. Appelé de service à service par la plate-
// forme (BackendDental) à l'activation d'une licence. Idempotent par e-mail du
// propriétaire, transactionnel : jamais de clinique à moitié créée.
export async function provisionClinic(client, { clinic = {}, owner = {} } = {}, log = console.log) {
  const email = String(owner.email || '').toLowerCase().trim()
  const pwd = String(owner.password || '')
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error('owner.email valide requis')
  if (pwd.length < 10) throw new Error('owner.password (10 caractères minimum) requis')
  const licenseCid = clinic.license_cid ? String(clinic.license_cid).slice(0, 120) : null
  const licenseKey = clinic.license_key ? String(clinic.license_key).slice(0, 120) : null
  // idempotent : même e-mail OU même licence (cid/clé) déjà provisionné → on renvoie sa clinique, sans rien recréer
  const ex = (await client.query(
    'select u.id, u.clinic_id from users u join clinics c on c.id=u.clinic_id where u.email=$1 or ($2::text is not null and c.license_cid=$2) or ($3::text is not null and c.license_key=$3) limit 1',
    [email, licenseCid, licenseKey])).rows[0]
  if (ex) { log('Clinique déjà provisionnée pour', email); return { clinic_id: ex.clinic_id, owner_id: ex.id, created: false } }
  await client.query('begin')
  try {
    const { rows: [cl] } = await client.query('insert into clinics(name,address,phone,license_cid,license_key) values($1,$2,$3,$4,$5) returning id',
      [String(clinic.name || 'Clinique').slice(0, 120), clinic.address ? String(clinic.address).slice(0, 200) : null, clinic.phone ? String(clinic.phone).slice(0, 40) : null, licenseCid, licenseKey])
    // le propriétaire choisit son mot de passe sur la vitrine → must_change_password=false (sauf demande explicite)
    const mustChange = owner.must_change_password === true
    const { rows: [u] } = await client.query(
      "insert into users(clinic_id,email,password_hash,first_name,last_name,role,must_change_password) values($1,$2,$3,$4,$5,'OWNER',$6) returning id",
      [cl.id, email, await bcrypt.hash(pwd, 12), String(owner.first_name || 'Propriétaire').slice(0, 80), String(owner.last_name || '').slice(0, 80), mustChange])
    await client.query('commit')
    log('Clinique provisionnée :', cl.id, '— propriétaire', email, licenseCid ? '— licence ' + licenseCid : '')
    return { clinic_id: cl.id, owner_id: u.id, created: true }
  } catch (e) { await client.query('rollback'); throw e }
}
