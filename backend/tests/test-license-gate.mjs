// Test d'intégration de la porte de licence côté app (sans base de données).
import fs from 'fs'
import os from 'os'
import path from 'path'
import { fileURLToPath } from 'url'

const here = path.dirname(fileURLToPath(import.meta.url))
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dl-lic-'))

// Pointer la licence vers un dossier temporaire + clé publique de test (= l'embarquée)
process.env.DB_DIR = path.join(tmp, 'db')
process.env.LICENSE_PUBLIC_KEY = fs.readFileSync(path.join(here, '..', '..', 'saas', 'keys', 'license-public.pem'), 'utf8')
delete process.env.SAAS_URL   // hors ligne

const license = await import('../src/lib/license.js')
const { issueLicense } = await import('../../saas/shared/license.js')
const priv = fs.readFileSync(path.join(here, '..', '..', 'saas', 'keys', 'license-private.pem'), 'utf8')

const fp = license.fingerprint()
let pass = 0, fail = 0
const ok = (n, c) => { c ? (pass++, console.log('  ✓', n)) : (fail++, console.log('  ✗ ÉCHEC:', n)) }

// Faux middleware : capture si next() est appelé ou si 403 renvoyé
function runGate(pathname) {
  let nexted = false, code = null, status = 200
  const req = { path: pathname }
  const res = { setHeader() {}, status(s) { status = s; return this }, json(b) { code = b.code; return this } }
  license.licenseGate(req, res, () => { nexted = true })
  return { nexted, code, status }
}

console.log('\n1) Aucune clé → activation requise, accès bloqué')
ok('status = needs_activation', license.status().status === 'needs_activation')
ok('porte bloque /api/patients (403 LICENSE)', (g => g.status === 403 && g.code === 'LICENSE')(runGate('/api/patients')))
ok('porte laisse passer /api/license/status', runGate('/api/license/status').nexted)
ok('porte laisse passer /api/health', runGate('/api/health').nexted)

console.log('\n2) Clé valide (1 mois, ce poste) → accès ouvert')
const good = issueLicense(priv, { clinic_id: 'c7f3a9', clinic: 'Cabinet Soleil', plan: '1m', machine_id: fp, seats: 2 })
license.installKey(good.token)
ok('status = active', license.status().status === 'active')
ok('non bloqué', license.status().blocked === false)
ok('nom de clinique exposé', license.status().clinic === 'Cabinet Soleil')
ok('porte laisse passer /api/patients', runGate('/api/patients').nexted)

console.log('\n3) Clé d\'un AUTRE poste → refusée à l\'installation')
const other = issueLicense(priv, { clinic_id: 'c7f3a9', plan: '1m', machine_id: 'autre-poste', seats: 2 })
let threw = false; try { license.installKey(other.token) } catch (e) { threw = e.code === 'WRONG_MACHINE' }
ok('installKey rejette (WRONG_MACHINE)', threw)
ok('la clé valide précédente tient toujours', license.status().status === 'active')

console.log('\n4) Abonnement expiré au-delà de la grâce → bloqué')
const past = new Date(Date.now() - 10 * 86400000).toISOString()
const dead = issueLicense(priv, { clinic_id: 'c7f3a9', plan: '1m', machine_id: fp, issued_at: new Date(Date.now() - 40 * 86400000).toISOString(), expires_at: past })
license.installKey(dead.token)
ok('status = blocked', license.status().status === 'blocked')
ok('porte bloque /api/patients', runGate('/api/patients').status === 403)

console.log('\n5) Révocation à distance → bloqué même si le jeton local est valide')
license.installKey(good.token)   // jeton encore valide
fs.writeFileSync(path.join(tmp, 'license', 'license-remote.json'), JSON.stringify({ checkedAt: new Date().toISOString(), revoked: true, reason: 'impayé' }))
ok('status = revoked', license.status().status === 'revoked')
ok('porte bloque /api/patients', runGate('/api/patients').status === 403)

console.log(`\nRÉSULTAT : ${pass} réussis, ${fail} échoués\n`)
fs.rmSync(tmp, { recursive: true, force: true })
process.exit(fail ? 1 : 0)
