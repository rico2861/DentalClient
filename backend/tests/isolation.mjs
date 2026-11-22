// ─────────────────────────────────────────────────────────────────────────────
// Test de non-régression : ISOLATION INTER-CLINIQUES (instance web partagée)
//
// Vérifie qu'une clinique ne peut JAMAIS lire ni atteindre les données d'une
// autre clinique sur l'instance partagée. Les données ne sont affichées et
// renvoyées qu'à la personne concernée (exigence produit).
//
// Autonome : génère sa propre paire de clés de licence (aucun fichier externe),
// base en mémoire (memory://), aucune contention sur la connexion embarquée
// (tout le montage passe par la file de requêtes `q`, jamais par billService).
//
//   node tests/isolation.mjs        →  exit 0 si tout est isolé, 1 sinon
// ─────────────────────────────────────────────────────────────────────────────
import crypto from 'crypto'

// ── 1) Environnement AVANT tout import de l'app ──────────────────────────────
const PORT = 3977
const SECRET = 'Z'.repeat(48)
const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519')
const pubPem = publicKey.export({ type: 'spki', format: 'pem' })

Object.assign(process.env, {
  NODE_ENV: 'test',
  PORT: String(PORT),
  HOST: '127.0.0.1',
  JWT_SECRET: SECRET,
  DB_DIR: 'memory://isolation',
  LICENSE_PUBLIC_KEY: pubPem,
  DL_SKIP_PORT_CHECK: '1',
  KEEP_SESSIONS: 'true',
  CLINIC_TZ: 'America/Port-au-Prince'
})
// pas d'OWNER_EMAIL : on crée nous-mêmes les cliniques (multi-tenant)

// ── 2) Fabrique un jeton de licence DL1 valide (signé Ed25519) ───────────────
const b64u = b => Buffer.from(b).toString('base64url')
function makeLicense (data) {
  const now = new Date()
  const exp = new Date(now.getTime() + 365 * 86400000)
  const payload = { v: 1, lid: crypto.randomUUID(), cid: data.clinic_id, clinic: 'Instance partagée',
    plan: '1y', seats: 999, mid: null, iss: now.toISOString(), exp: exp.toISOString(), grace: 7 }
  const body = b64u(JSON.stringify(payload))
  const sig = b64u(crypto.sign(null, Buffer.from(body), privateKey))
  return 'DL1.' + body + '.' + sig
}

// ── 3) Démarre l'app (migre + écoute au chargement du module) ────────────────
await import('../src/server.js')
const { q } = await import('../src/db/pool.js')
const base = `http://127.0.0.1:${PORT}`

async function waitReady () {
  for (let i = 0; i < 100; i++) {
    try { const r = await fetch(base + '/api/health'); if (r.ok) return } catch {}
    await new Promise(r => setTimeout(r, 100))
  }
  throw new Error("Le serveur n'a pas démarré")
}
await waitReady()

// ── 4) Ouvre la porte de licence ─────────────────────────────────────────────
{
  const r = await fetch(base + '/api/license/key', { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ token: makeLicense({ clinic_id: crypto.randomUUID() }) }) })
  if (!r.ok) throw new Error('Licence refusée : ' + r.status + ' ' + (await r.text()))
}

// ── 5) Monte deux cliniques, chacune avec un propriétaire et des patients ────
import jwt from 'jsonwebtoken'

async function makeClinic (name) {
  const { rows: [c] } = await q(
    'insert into clinics(name,require_2fa) values($1,false) returning id', [name])
  const { rows: [u] } = await q(
    `insert into users(clinic_id,email,password_hash,first_name,last_name,role,status,must_change_password,token_version)
     values($1,$2,'x','Proprio',$3,'OWNER','active',false,0) returning id`,
    [c.id, `owner-${name}@test.local`, name])
  // session + cookie forgé (exactement ce que l'app attend : {id, sid, tv})
  const { rows: [s] } = await q(
    "insert into user_sessions(user_id,ip,user_agent) values($1,'127.0.0.1','test') returning id", [u.id])
  const cookie = 'dl=' + jwt.sign({ id: u.id, sid: s.id, tv: 0 }, SECRET)
  return { clinic: c.id, owner: u.id, cookie, name }
}

async function addPatient (cl, last, first, phone) {
  const { rows: [p] } = await q(
    `insert into patients(clinic_id,last_name,first_name,phone,address,emergency_contact,created_by)
     values($1,$2,$3,$4,'Addr','EC',$5) returning id`, [cl.clinic, last, first, phone, cl.owner])
  return p.id
}

const A = await makeClinic('CliniqueA')
const B = await makeClinic('CliniqueB')
const pA = await addPatient(A, 'Alpha', 'Anne', '0001')
const pB = await addPatient(B, 'Bravo', 'Bob', '0002')

// ── 6) Assertions d'isolation ────────────────────────────────────────────────
const get = (path, who) => fetch(base + path, { headers: { cookie: who.cookie } })
let pass = 0, fail = 0
const check = (ok, label) => { if (ok) { pass++; console.log('  ✔', label) } else { fail++; console.log('  ✖', label) } }

// (a) la liste de A ne contient que les patients de A
{
  const rows = (await (await get('/api/patients', A)).json()).rows || []
  const ids = rows.map(r => r.id)
  check(ids.includes(pA) && !ids.includes(pB), "La liste patients de A ne montre que ses patients")
}
// (b) la liste de B ne contient que les patients de B
{
  const rows = (await (await get('/api/patients', B)).json()).rows || []
  const ids = rows.map(r => r.id)
  check(ids.includes(pB) && !ids.includes(pA), "La liste patients de B ne montre que ses patients")
}
// (c) A ne peut PAS ouvrir le dossier d'un patient de B → 404
{
  const r = await get(`/api/patients/${pB}/summary`, A)
  check(r.status === 404, "A → dossier d'un patient de B : refusé (404)")
}
// (d) B ne peut PAS ouvrir le dossier d'un patient de A → 404
{
  const r = await get(`/api/patients/${pA}/summary`, B)
  check(r.status === 404, "B → dossier d'un patient de A : refusé (404)")
}
// (e) la recherche de A ne fait PAS fuiter un patient de B
{
  const rows = await (await get('/api/patients/lookup?q=Bravo', A)).json()
  check(Array.isArray(rows) && !rows.some(r => r.id === pB), "La recherche de A ne fait pas fuiter le patient de B")
}
// (f) sans session (sans cookie) tout /api est fermé → 401
{
  const r = await fetch(base + '/api/patients')
  check(r.status === 401, "Sans connexion : /api/patients refusé (401)")
}
// (g) vérification au niveau requête : la requête exacte de l'endpoint
//     (id du patient de B, clinic_id de A) ne renvoie AUCUNE ligne
{
  const n = (await q('select 1 from patients where id=$1 and clinic_id=$2', [pB, A.clinic])).rowCount
  check(n === 0, "Requête directe (patient de B filtré par clinic_id de A) : 0 ligne")
}

console.log(`\nIsolation : ${pass} réussis, ${fail} échec(s).`)
process.exit(fail ? 1 : 0)
