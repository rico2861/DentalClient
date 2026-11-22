// ─────────────────────────────────────────────────────────────────────────────
// Test : connexion PROPRIÉTAIRE par LICENCE + OTP (instance partagée)
//   node tests/owner-login.mjs   →  exit 0 si OK
// Autonome (clé de licence générée, base memory://). N'envoie pas d'e-mail :
// on insère un code OTP connu pour exercer la vérification + la liaison de session.
// ─────────────────────────────────────────────────────────────────────────────
import crypto from 'crypto'

const PORT = 3966, SECRET = 'Z'.repeat(48)
const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519')
Object.assign(process.env, {
  NODE_ENV: 'test', PORT: String(PORT), HOST: '127.0.0.1', JWT_SECRET: SECRET,
  DB_DIR: 'memory://ownerlogin', LICENSE_PUBLIC_KEY: publicKey.export({ type: 'spki', format: 'pem' }),
  DL_SKIP_PORT_CHECK: '1', KEEP_SESSIONS: 'true', PROVISION_SECRET: 'prov-secret-123456', CLINIC_TZ: 'America/Port-au-Prince'
})
const b64u = b => Buffer.from(b).toString('base64url')
const makeLicense = cid => { const now = new Date()
  const p = { v: 1, lid: crypto.randomUUID(), cid, clinic: 'X', plan: '1y', seats: 9, mid: null, iss: now.toISOString(), exp: new Date(now.getTime() + 3e10).toISOString(), grace: 7 }
  const body = b64u(JSON.stringify(p)); return 'DL1.' + body + '.' + b64u(crypto.sign(null, Buffer.from(body), privateKey)) }

await import('../src/server.js')
const { q } = await import('../src/db/pool.js')
import jwt from 'jsonwebtoken'
const base = `http://127.0.0.1:${PORT}`
for (let i = 0; i < 100; i++) { try { if ((await fetch(base + '/api/health')).ok) break } catch {} await new Promise(r => setTimeout(r, 100)) }
await fetch(base + '/api/license/key', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token: makeLicense(crypto.randomUUID()) }) })

const post = (path, body, headers = {}) => fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) })
const sha = s => crypto.createHash('sha256').update(s).digest('hex')
let pass = 0, fail = 0
const check = (ok, label) => { if (ok) { pass++; console.log('  ✔', label) } else { fail++; console.log('  ✖', label) } }

// Provisionne la clinique du propriétaire, liée à la licence « LIC-CID-1 »
const prov = await (await post('/api/provision', { clinic: { name: 'Clinique Z', license_cid: 'LIC-CID-1' }, owner: { email: 'owner-z@test.local', password: 'motdepasse12', last_name: 'Z' } }, { 'x-provision-secret': 'prov-secret-123456' })).json()
check(prov.created === true && prov.owner_id, 'Provisioning de la clinique du propriétaire')
await q('update clinics set require_2fa=false where id=$1', [prov.clinic_id])
// une 2e clinique, pour vérifier la liaison au bon clinic_id
const prov2 = await (await post('/api/provision', { clinic: { name: 'Autre', license_cid: 'LIC-CID-2' }, owner: { email: 'owner-y@test.local', password: 'motdepasse12' } }, { 'x-provision-secret': 'prov-secret-123456' })).json()
const pZ = (await q("insert into patients(clinic_id,last_name,first_name,phone,address,emergency_contact,created_by) values($1,'PatZ','x','1','a','e',$2) returning id", [prov.clinic_id, prov.owner_id])).rows[0].id
await q("insert into patients(clinic_id,last_name,first_name,phone,address,emergency_contact,created_by) values($1,'PatY','x','2','a','e',$2)", [prov2.clinic_id, prov2.owner_id])

// (a) licence malformée → 400 LICENSE_BAD
{ const r = await post('/api/login/owner/request', { license: 'DL1.bad.sig' }); const j = await r.json()
  check(r.status === 400 && j.code === 'LICENSE_BAD', 'Licence invalide → refus (LICENSE_BAD)') }
// (b) licence valide mais aucune clinique rattachée → 404 NO_ACCOUNT
{ const r = await post('/api/login/owner/request', { license: makeLicense('CID-INCONNU') }); const j = await r.json()
  check(r.status === 404 && j.code === 'NO_ACCOUNT', 'Licence sans compte → NO_ACCOUNT (invite à créer le compte)') }

// (c) chemin critique : OTP correct → session liée au bon clinic_id
// on insère un code OTP connu (kind 'owner') et on forge le défi comme le fait /request
const code = '246813'
await q("insert into login_codes(user_id,kind,code_hash,expires_at) values($1,'owner',$2, now()+make_interval(mins=>10))", [prov.owner_id, sha(prov.owner_id + ':' + code)])
const challenge = jwt.sign({ id: prov.owner_id, tv: 0, cid: 'LIC-CID-1', p: 'ownerotp' }, SECRET, { expiresIn: '10m' })
// mauvais code d'abord
{ const r = await post('/api/login/owner/verify', { challenge, code: '000000' }); check(r.status === 400, 'OTP incorrect → refus (400)') }
// bon code
let cookie = null
{ const r = await post('/api/login/owner/verify', { challenge, code })
  const sc = r.headers.get('set-cookie') || ''; const m = sc.match(/dl=[^;]+/); cookie = m ? m[0] : null
  const j = await r.json(); check(r.ok && j.ok && cookie, 'OTP correct → connecté (cookie de session émis)') }
// (d) la session du propriétaire ne voit QUE sa clinique
if (cookie) {
  const rows = (await (await fetch(base + '/api/patients', { headers: { cookie } })).json()).rows || []
  check(rows.length === 1 && rows[0].id === pZ, 'Session propriétaire liée au bon clinic_id (ne voit que sa clinique)')
}
// (e) défi falsifié avec un mauvais type → rejeté
{ const bad = jwt.sign({ id: prov.owner_id, tv: 0, p: 'otp' }, SECRET); const r = await post('/api/login/owner/verify', { challenge: bad, code })
  check(r.status === 401, 'Défi d\'un autre type → rejeté (401)') }

console.log(`\nConnexion propriétaire : ${pass} réussis, ${fail} échec(s).`)
process.exit(fail ? 1 : 0)
