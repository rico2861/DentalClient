// DENTAL — lanceur et gardien du service (démarrage automatique). Ne pas lancer à la main : voir scripts/service.js.
//  • démarre le serveur et le relance s'il s'arrête (plantage, restauration de sauvegarde…) ;
//  • vérifie toutes les 30 s qu'il RÉPOND vraiment (la vérification interroge la base) : s'il est figé
//    3 fois de suite (≈ 1 min 30), il est arrêté puis relancé ;
//  • prudence : jamais deux serveurs sur la même base (si un serveur répond déjà sur le port, il n'en lance pas
//    d'autre), attente progressive entre deux relances (3 s → 1 min), et pause de 5 min si le serveur plante
//    en boucle (5 arrêts en 10 min) pour ne pas user la base ; tout est noté dans backend/logs/serveur.log.
import { spawn, spawnSync } from 'child_process'; import fs from 'fs'; import path from 'path'; import { fileURLToPath } from 'url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'), LOGS = path.join(ROOT, 'logs'), LOG = path.join(LOGS, 'serveur.log')
fs.mkdirSync(LOGS, { recursive: true })
const PIDF = path.join(LOGS, 'service.pid')
// un seul lanceur à la fois : s'il en tourne déjà un, celui-ci s'arrête aussitôt
// (le fichier est rafraîchi toutes les 10 s : après un redémarrage de l'ordinateur, un ancien fichier est ignoré
//  même si son numéro a été réattribué à un autre programme)
try { const old = Number(fs.readFileSync(PIDF, 'utf8')), fresh = Date.now() - fs.statSync(PIDF).mtimeMs < 30e3; if (old && old !== process.pid && fresh) { process.kill(old, 0); process.exit(0) } } catch {}
fs.writeFileSync(PIDF, String(process.pid))   // permet « npm run service:arreter »
fs.rmSync(path.join(LOGS, 'arret-volontaire'), { force: true })   // démarré (allumage, démarrage demandé) : la surveillance reprend
setInterval(() => { try { const t = new Date(); fs.utimesSync(PIDF, t, t) } catch {} }, 10e3)
process.on('exit', () => { try { if (fs.readFileSync(PIDF, 'utf8') === String(process.pid)) fs.rmSync(PIDF) } catch {} })
const rotate = () => { try { if (fs.statSync(LOG).size > 5 * 1024 * 1024) { fs.rmSync(LOG + '.2', { force: true }); if (fs.existsSync(LOG + '.1')) fs.renameSync(LOG + '.1', LOG + '.2'); fs.renameSync(LOG, LOG + '.1') } } catch {} }
const note = m => { try { fs.mkdirSync(LOGS, { recursive: true }); rotate(); fs.appendFileSync(LOG, `[${new Date().toLocaleString('fr-FR')}] ${m}\n`) } catch {} }   // le journal ne doit jamais faire tomber le gardien
const PORT = (() => { if (process.env.PORT) return process.env.PORT; try { return fs.readFileSync(path.join(ROOT, '.env'), 'utf8').match(/^PORT=(\d+)/m)?.[1] || '3000' } catch { return '3000' } })()
const healthy = async (ms = 10e3) => { try { return (await fetch(`http://127.0.0.1:${PORT}/api/health`, { signal: AbortSignal.timeout(ms) })).ok } catch { return false } }

let child = null, stopping = false, wait = 3000, ready = false, misses = 0, startedAt = 0, killing = false
const crashes = []
const stop = () => { stopping = true; note('Arrêt du service demandé.'); try { child?.kill() } catch {} setTimeout(() => process.exit(0), 3000) }
process.on('SIGTERM', stop); process.on('SIGINT', stop)

// .env créé ou complété comme avec « npm start »
spawnSync(process.execPath, [path.join(ROOT, 'scripts/init-env.js')], { cwd: ROOT, stdio: 'ignore' })

async function launch() {
  if (stopping) return
  // un serveur répond déjà (lancé à la main, ou ancien serveur encore actif) : on n'en lance pas un second
  if (await healthy(3000)) { if (!child) note(`Un serveur répond déjà sur le port ${PORT} : surveillance sans relance.`); return setTimeout(launch, 60e3) }
  fs.mkdirSync(LOGS, { recursive: true }); rotate(); const out = fs.openSync(LOG, 'a'); startedAt = Date.now(); ready = false; misses = 0
  note('Démarrage du serveur…')
  // DL_SUPERVISOR_PID : le serveur s'arrête tout seul si ce lanceur disparaît (Windows ne ferme pas les processus enfants)
  child = spawn(process.execPath, [path.join(ROOT, 'src/server.js')], { cwd: ROOT, stdio: ['ignore', out, out], env: { ...process.env, DL_SUPERVISOR_PID: String(process.pid) }, windowsHide: true })
  child.on('exit', code => { try { fs.closeSync(out) } catch {} child = null; killing = false; if (stopping) return process.exit(0)
    const ran = Date.now() - startedAt; if (ran > 120e3) wait = 3000   // il tournait normalement : relance rapide
    crashes.push(Date.now()); while (crashes.length && Date.now() - crashes[0] > 10 * 60e3) crashes.shift()
    let delay = wait; if (crashes.length >= 5) { delay = 5 * 60e3; note(`⚠ Le serveur s'arrête en boucle (${crashes.length} fois en 10 min) : pause de 5 min avant la prochaine tentative. Voir les messages ci-dessus.`) }
    note(`Le serveur s'est arrêté (code ${code ?? 'forcé'}). Nouvelle tentative dans ${Math.round(delay / 1000)} s.`)
    setTimeout(launch, delay); wait = Math.min(60e3, wait * 2) }) }

// surveillance : le serveur doit répondre ; figé → arrêté puis relancé
setInterval(async () => {
  if (stopping || !child || killing) return
  if (await healthy()) { if (!ready) note(`Serveur prêt (en ${Math.round((Date.now() - startedAt) / 1000)} s).`); ready = true; misses = 0; return }
  if (!ready) { if (Date.now() - startedAt > 5 * 60e3) { note('⚠ Le serveur ne répond toujours pas 5 min après son démarrage : arrêt puis relance.'); killing = true; child.kill() } return }   // démarrage (migrations, chiffrement…) : patience
  misses++; note(`Le serveur ne répond pas (${misses}/3).`)
  if (misses >= 3) { note('⚠ Serveur figé : arrêt puis relance.'); killing = true; child.kill(); setTimeout(() => { try { if (child) child.kill('SIGKILL') } catch {} }, 15e3) }
}, 30e3)

launch()
