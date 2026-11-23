// Test : BLOCAGE PAR ABONNEMENT (instance partagée). Une clinique à jour passe ;
// une clinique expirée/suspendue est bloquée (402 SUBSCRIPTION), même connectée.
// Nécessite DATABASE_URL (Postgres) — lancé par un harnais qui démarre un PG local.
import crypto from 'crypto'
const PORT = 3955, SECRET = 'Z'.repeat(48)
const { publicKey } = crypto.generateKeyPairSync('ed25519')
Object.assign(process.env, {
  NODE_ENV: 'test', PORT: String(PORT), HOST: '127.0.0.1', JWT_SECRET: SECRET,
  DATABASE_URL: 'postgres://dental@localhost:55434/dc', DB_SCHEMA: 'app',
  LICENSE_PUBLIC_KEY: publicKey.export({ type: 'spki', format: 'pem' }),
  DL_SKIP_PORT_CHECK: '1', KEEP_SESSIONS: 'true', PROVISION_SECRET: 'prov-123456', CLINIC_TZ: 'America/Port-au-Prince'
})
await import('../src/server.js')
const { q } = await import('../src/db/pool.js')
import jwt from 'jsonwebtoken'
const base = `http://127.0.0.1:${PORT}`
for (let i = 0; i < 100; i++) { try { if ((await fetch(base + '/api/health')).ok) break } catch {} await new Promise(r => setTimeout(r, 100)) }

// Schéma SaaS minimal (dans la même base) + 2 licences : une active, une expirée
await q('create schema if not exists saas')
await q("create table if not exists saas.license_keys(key text primary key, clinic_id text, plan text, starts_at timestamptz default now(), ends_at timestamptz, status text default 'active')")

const prov = (body) => fetch(base + '/api/provision', { method: 'POST', headers: { 'content-type': 'application/json', 'x-provision-secret': 'prov-123456' }, body: JSON.stringify(body) }).then(r => r.json())
let pass = 0, fail = 0
const check = (ok, l) => { ok ? pass++ : fail++; console.log(ok ? '  ✔' : '  ✖', l) }

async function setup (name, key, active) {
  const p = await prov({ clinic: { name, license_cid: 'cid-' + key, license_key: key }, owner: { email: `owner-${key}@t.local`, password: 'motdepasse12' } })
  await q('update clinics set require_2fa=false where id=$1', [p.clinic_id])
  await q('update users set must_change_password=false where id=$1', [p.owner_id])
  const ends = active ? "now()+interval '30 days'" : "now()-interval '1 day'"
  const st = active ? 'active' : 'expired'
  await q(`insert into saas.license_keys(key,clinic_id,plan,ends_at,status) values($1,$2,'1y',${ends},'${st}')`, [key, 'cid-' + key])
  const { rows: [s] } = await q("insert into user_sessions(user_id,ip,user_agent) values($1,'127.0.0.1','t') returning id", [p.owner_id])
  const cookie = 'dl=' + jwt.sign({ id: p.owner_id, sid: s.id, tv: 0 }, SECRET)
  return { ...p, cookie }
}
const A = await setup('Clinique A jour', 'KEY_A', true)
const B = await setup('Clinique expirée', 'KEY_B', false)

// La clinique à jour accède ; l'expirée est bloquée (402 SUBSCRIPTION)
{ const r = await fetch(base + '/api/patients', { headers: { cookie: A.cookie } })
  check(r.status === 200, 'Clinique à jour : accès autorisé (200)') }
{ const r = await fetch(base + '/api/patients', { headers: { cookie: B.cookie } }); const j = await r.json().catch(() => ({}))
  check(r.status === 402 && j.code === 'SUBSCRIPTION', 'Clinique expirée : bloquée (402 SUBSCRIPTION)') }

console.log(`\nAbonnement : ${pass} réussis, ${fail} échec(s).`)
process.exit(fail ? 1 : 0)
