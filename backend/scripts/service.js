// ─────────────────────────────────────────────────────────────────────────────
// DENTAL — DÉMARRAGE AUTOMATIQUE (Windows et Linux)
//   npm run service:installer     démarre DENTAL tout seul à l'allumage de l'ordinateur (et le relance s'il s'arrête)
//   npm run service:desinstaller  retire le démarrage automatique
//   npm run service:etat          indique s'il est installé et s'il répond
//   npm run service:demarrer / service:arreter
// Surveillance : toutes les 5 minutes, une vérification relance l'application si elle ne répond pas et qu'aucun
// gardien ne s'en occupe (sauf après « service:arreter », arrêt volontaire respecté jusqu'au prochain démarrage).
// Windows : Planificateur de tâches. En administrateur → au démarrage de l'ordinateur, avant toute connexion
//           (compte SYSTÈME) ; sinon → à l'ouverture de session de cet utilisateur, fenêtre cachée.
// Linux   : systemd. Avec sudo → service système (au démarrage) ; sinon → service utilisateur.
// Journal : backend/logs/serveur.log
// ─────────────────────────────────────────────────────────────────────────────
import { spawnSync } from 'child_process'; import fs from 'fs'; import os from 'os'; import path from 'path'; import { fileURLToPath } from 'url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'), RUN = path.join(ROOT, 'scripts', 'service-run.js'), NODE = process.execPath
const NAME = 'DENTAL', WATCH = 'DENTAL - surveillance', UNIT = 'dental-light', cmd = process.argv[2] || 'etat'
const LOGS = path.join(ROOT, 'logs'), STOPF = path.join(LOGS, 'arret-volontaire'), SVC = path.join(ROOT, 'scripts', 'service.js')
const note = m => { try { fs.mkdirSync(LOGS, { recursive: true }); fs.appendFileSync(path.join(LOGS, 'serveur.log'), `[${new Date().toLocaleString('fr-FR')}] ${m}\n`) } catch {} }
const runnerAlive = () => { try { const pf = path.join(LOGS, 'service.pid'), pid = Number(fs.readFileSync(pf, 'utf8')); if (Date.now() - fs.statSync(pf).mtimeMs > 30e3) return false; process.kill(pid, 0); return true } catch { return false } }
const stopOn = () => { fs.mkdirSync(LOGS, { recursive: true }); fs.writeFileSync(STOPF, new Date().toISOString()) }, stopOff = () => fs.rmSync(STOPF, { force: true })
const sh = (c, a, o = {}) => spawnSync(c, a, { encoding: 'utf8', ...o }), ok = r => r.status === 0
const port = (() => { try { const m = fs.readFileSync(path.join(ROOT, '.env'), 'utf8').match(/^PORT=(\d+)/m); return m ? m[1] : '3000' } catch { return '3000' } })()
const health = async () => { try { return (await fetch(`http://localhost:${port}/api/health`, { signal: AbortSignal.timeout(2500) })).ok } catch { return false } }
const waitUp = async (s = 40) => { for (let i = 0; i < s; i++) { if (await health()) return true; await new Promise(r => setTimeout(r, 1000)) } return false }
const out = m => console.log(m), die = m => { console.error('\n✖ ' + m + '\n'); process.exit(1) }

// ═══════════════ WINDOWS ═══════════════
const xmlEsc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const isAdmin = () => ok(sh('net', ['session'], { windowsHide: true }))
function winTask(admin) {
  const user = process.env.USERDOMAIN ? `${process.env.USERDOMAIN}\\${os.userInfo().username}` : os.userInfo().username
  let exe = NODE, args = `"${RUN}"`
  if (!admin) {   // ouverture de session : lancé par un petit script VBS pour qu'aucune fenêtre ne s'affiche
    const vbs = path.join(ROOT, 'scripts', 'service-cache.vbs')
    fs.writeFileSync(vbs, `' DENTAL : lance le service sans fenêtre (créé par npm run service:installer)\r\nCreateObject("WScript.Shell").Run """${NODE}"" ""${RUN}""", 0, False\r\n`)
    exe = 'wscript.exe'; args = `"${vbs}"` }
  return `<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo><Description>DENTAL : démarre le serveur de la clinique automatiquement et le relance en cas d'arrêt.</Description></RegistrationInfo>
  <Triggers>${admin ? '<BootTrigger><Enabled>true</Enabled><Delay>PT20S</Delay></BootTrigger>' : `<LogonTrigger><Enabled>true</Enabled><UserId>${xmlEsc(user)}</UserId></LogonTrigger>`}</Triggers>
  <Principals><Principal id="Author">${admin ? '<UserId>S-1-5-18</UserId><RunLevel>HighestAvailable</RunLevel>' : `<UserId>${xmlEsc(user)}</UserId><LogonType>InteractiveToken</LogonType><RunLevel>LeastPrivilege</RunLevel>`}</Principal></Principals>
  <Settings>
    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>
    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries><StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
    <AllowHardTerminate>true</AllowHardTerminate><StartWhenAvailable>true</StartWhenAvailable><RunOnlyIfNetworkAvailable>false</RunOnlyIfNetworkAvailable>
    <IdleSettings><StopOnIdleEnd>false</StopOnIdleEnd><RestartOnIdle>false</RestartOnIdle></IdleSettings>
    <AllowStartOnDemand>true</AllowStartOnDemand><Enabled>true</Enabled><Hidden>false</Hidden><RunOnlyIfIdle>false</RunOnlyIfIdle><WakeToRun>false</WakeToRun>
    <ExecutionTimeLimit>PT0S</ExecutionTimeLimit><Priority>5</Priority>
    <RestartOnFailure><Interval>PT1M</Interval><Count>999</Count></RestartOnFailure>
  </Settings>
  <Actions Context="Author"><Exec><Command>${xmlEsc(exe)}</Command><Arguments>${xmlEsc(args)}</Arguments><WorkingDirectory>${xmlEsc(ROOT)}</WorkingDirectory></Exec></Actions>
</Task>` }
function winWatch(admin) {
  const user = process.env.USERDOMAIN ? `${process.env.USERDOMAIN}\\${os.userInfo().username}` : os.userInfo().username
  let exe = NODE, args = `"${SVC}" verifier`
  if (!admin) { const vbs = path.join(ROOT, 'scripts', 'service-surveillance.vbs'); fs.writeFileSync(vbs, `' DENTAL : vérification sans fenêtre (créé par npm run service:installer)\r\nCreateObject("WScript.Shell").Run """${NODE}"" ""${SVC}"" verifier", 0, False\r\n`); exe = 'wscript.exe'; args = `"${vbs}"` }
  const start = new Date(Date.now() + 60e3).toISOString().slice(0, 19)
  return `<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo><Description>DENTAL : vérifie toutes les 5 minutes que l'application tourne et la relance sinon.</Description></RegistrationInfo>
  <Triggers><TimeTrigger><Repetition><Interval>PT5M</Interval><StopAtDurationEnd>false</StopAtDurationEnd></Repetition><StartBoundary>${start}</StartBoundary><Enabled>true</Enabled></TimeTrigger></Triggers>
  <Principals><Principal id="Author">${admin ? '<UserId>S-1-5-18</UserId><RunLevel>HighestAvailable</RunLevel>' : `<UserId>${xmlEsc(user)}</UserId><LogonType>InteractiveToken</LogonType><RunLevel>LeastPrivilege</RunLevel>`}</Principal></Principals>
  <Settings><MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy><DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries><StopIfGoingOnBatteries>false</StopIfGoingOnBatteries><StartWhenAvailable>true</StartWhenAvailable><ExecutionTimeLimit>PT5M</ExecutionTimeLimit><Enabled>true</Enabled><AllowStartOnDemand>true</AllowStartOnDemand></Settings>
  <Actions Context="Author"><Exec><Command>${xmlEsc(exe)}</Command><Arguments>${xmlEsc(args)}</Arguments><WorkingDirectory>${xmlEsc(ROOT)}</WorkingDirectory></Exec></Actions>
</Task>` }
const winCreate = (name, xmlText) => { const xml = path.join(os.tmpdir(), 'dental-light-tache-' + process.pid + '.xml'); fs.writeFileSync(xml, '\ufeff' + xmlText, 'utf16le'); const r = sh('schtasks', ['/Create', '/TN', name, '/XML', xml, '/F'], { windowsHide: true }); fs.rmSync(xml, { force: true }); return r }
const winKill = () => { const pf = path.join(ROOT, 'logs', 'service.pid'); try { const pid = fs.readFileSync(pf, 'utf8').trim(); if (/^\d+$/.test(pid)) sh('taskkill', ['/PID', pid, '/T', '/F'], { windowsHide: true }); fs.rmSync(pf, { force: true }) } catch {} }
const winExists = () => ok(sh('schtasks', ['/Query', '/TN', NAME], { windowsHide: true }))
async function windows() {
  if (cmd === 'installer') {
    const admin = isAdmin(), r = winCreate(NAME, winTask(admin)); stopOff()
    if (!ok(r)) die('Création de la tâche refusée : ' + (r.stderr || r.stdout).trim())
    const w = winCreate(WATCH, winWatch(admin)); if (!ok(w)) out('  ⚠ Surveillance non installée : ' + (w.stderr || w.stdout).trim())
    else out('\n✔ Surveillance installée : toutes les 5 minutes, l\'application est relancée si elle ne répond pas.')
    out(`\n✔ Démarrage automatique installé (${admin ? 'au DÉMARRAGE de l\'ordinateur, avant toute connexion' : 'à l\'OUVERTURE DE SESSION de ' + os.userInfo().username + ', sans fenêtre'}).`)
    if (!admin) out('  Pour qu\'il démarre même sans ouvrir de session : relancez cette commande dans un terminal « Exécuter en tant qu\'administrateur ».')
    if (await health()) out(`  Un serveur tourne déjà sur le port ${port} : le service prendra le relais au prochain démarrage\n  (ou fermez la fenêtre actuelle du serveur puis : npm run service:demarrer).`)
    else { sh('schtasks', ['/Run', '/TN', NAME], { windowsHide: true }); out(await waitUp() ? `  Serveur démarré : http://localhost:${port}` : '  Le serveur n\'a pas encore répondu : voyez backend/logs/serveur.log') }
    out('  Journal : backend\\logs\\serveur.log\n') }
  else if (cmd === 'desinstaller') { if (!winExists()) return out('\nAucun démarrage automatique installé.\n'); sh('schtasks', ['/Delete', '/TN', WATCH, '/F'], { windowsHide: true }); sh('schtasks', ['/End', '/TN', NAME], { windowsHide: true }); winKill(); const r = sh('schtasks', ['/Delete', '/TN', NAME, '/F'], { windowsHide: true }); for (const v of ['service-cache.vbs', 'service-surveillance.vbs']) fs.rmSync(path.join(ROOT, 'scripts', v), { force: true }); stopOff(); if (!ok(r)) die((r.stderr || r.stdout).trim() + ' (essayez en administrateur)'); out('\n✔ Démarrage automatique retiré. Le serveur s\'arrête dans quelques secondes.\n') }
  else if (cmd === 'demarrer') { if (!winExists()) die('Démarrage automatique non installé : npm run service:installer'); if (await health()) return out(`
Le serveur tourne déjà : http://localhost:${port}
`); stopOff(); sh('schtasks', ['/Run', '/TN', NAME], { windowsHide: true }); out(await waitUp() ? `\n✔ Serveur démarré : http://localhost:${port}\n` : '\n… Pas encore de réponse : voyez backend/logs/serveur.log\n') }
  else if (cmd === 'arreter') { stopOn(); sh('schtasks', ['/End', '/TN', NAME], { windowsHide: true }); winKill(); note('Arrêt volontaire (npm run service:arreter) : la surveillance ne relancera pas l\'application avant « service:demarrer » ou le prochain allumage.'); out('\n✔ Arrêt demandé : le serveur s\'arrête dans quelques secondes.\n  La surveillance ne le relancera pas : npm run service:demarrer pour le relancer (ou au prochain allumage).\n') }
  else if (cmd === 'verifier') { if (fs.existsSync(STOPF) || await health() || runnerAlive() || !winExists()) return; note('Surveillance : l\'application ne répond pas et aucun gardien n\'est actif → démarrage automatique.'); sh('schtasks', ['/Run', '/TN', NAME], { windowsHide: true }) }
  else { const q = sh('schtasks', ['/Query', '/TN', NAME, '/V', '/FO', 'LIST'], { windowsHide: true }), st = (q.stdout.match(/^(Statut|Status)\s*:\s*(.+)$/m) || [])[2], last = (q.stdout.match(/^(Heure de la dernière exécution|Last Run Time)\s*:\s*(.+)$/m) || [])[2]
    const wq = ok(sh('schtasks', ['/Query', '/TN', WATCH], { windowsHide: true }))
    out(`\nSurveillance (toutes les 5 min) : ${wq ? 'INSTALLÉE' : 'non installée'}${fs.existsSync(STOPF) ? ' · en pause (arrêt volontaire)' : ''}`)
    out(`Démarrage automatique : ${ok(q) ? 'INSTALLÉ' + (st ? ' (' + st.trim() + ')' : '') + (last ? ' · dernière exécution : ' + last.trim() : '') : 'non installé (npm run service:installer)'}\nServeur : ${await health() ? 'répond sur http://localhost:' + port : 'ne répond pas'}\nJournal : backend\\logs\\serveur.log\n`) } }

// ═══════════════ LINUX (systemd) ═══════════════
async function linux() {
  if (!ok(sh('systemctl', ['--version']))) die('systemd est introuvable : lancez « npm start » depuis le gestionnaire de démarrage de votre système, ou un outil comme pm2.')
  const root = process.getuid?.() === 0, owner = root ? (process.env.SUDO_USER || 'root') : os.userInfo().username
  const userUnitDir = path.join(os.homedir(), '.config', 'systemd', 'user'), sysUnit = `/etc/systemd/system/${UNIT}.service`, userUnit = path.join(userUnitDir, `${UNIT}.service`)
  const scope = fs.existsSync(sysUnit) ? 'system' : fs.existsSync(userUnit) ? 'user' : null
  const dirOf = system => system ? '/etc/systemd/system' : userUnitDir
  // surveillance : minuterie systemd toutes les 5 minutes → « service.js verifier »
  const watchUnits = system => ({ [`${UNIT}-surveillance.service`]: `[Unit]\nDescription=DENTAL - vérification de l'application\n\n[Service]\nType=oneshot\nWorkingDirectory=${ROOT}\nExecStart=${NODE} ${SVC} verifier\n`,
    [`${UNIT}-surveillance.timer`]: `[Unit]\nDescription=DENTAL - vérification toutes les 5 minutes\n\n[Timer]\nOnBootSec=3min\nOnUnitActiveSec=5min\nUnit=${UNIT}-surveillance.service\n\n[Install]\nWantedBy=timers.target\n` })
  const ctl = (s, ...a) => sh('systemctl', s === 'user' ? ['--user', ...a] : a)
  const unit = (system) => `[Unit]
Description=DENTAL - serveur de la clinique
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
${system ? `User=${owner}\n` : ''}WorkingDirectory=${ROOT}
ExecStart=${NODE} ${RUN}
Restart=always
RestartSec=5
KillMode=control-group
TimeoutStopSec=20

[Install]
WantedBy=${system ? 'multi-user.target' : 'default.target'}
`
  if (cmd === 'installer') {
    if (root) { fs.writeFileSync(sysUnit, unit(true)); if (owner !== 'root') sh('chown', ['-R', `${owner}:`, path.join(ROOT, 'logs')]); ctl('system', 'daemon-reload'); const r = ctl('system', 'enable', '--now', UNIT); if (!ok(r)) die(r.stderr.trim())
      out(`\n✔ Service système installé : DENTAL démarre avec l'ordinateur (utilisateur ${owner}).`) }
    else { fs.mkdirSync(userUnitDir, { recursive: true }); fs.writeFileSync(userUnit, unit(false)); ctl('user', 'daemon-reload'); const r = ctl('user', 'enable', '--now', UNIT); if (!ok(r)) die(r.stderr.trim())
      const linger = ok(sh('loginctl', ['enable-linger', owner]))
      out(`\n✔ Service utilisateur installé.${linger ? ' Il démarre avec l\'ordinateur, même sans ouvrir de session.' : `\n  Pour qu'il démarre sans ouvrir de session : sudo loginctl enable-linger ${owner}\n  (ou réinstallez en service système : sudo npm run service:installer)`}`) }
    { const sys = root, sc = sys ? 'system' : 'user'; for (const [n, c] of Object.entries(watchUnits(sys))) fs.writeFileSync(path.join(dirOf(sys), n), c); ctl(sc, 'daemon-reload'); stopOff()
      out(ok(ctl(sc, 'enable', '--now', `${UNIT}-surveillance.timer`)) ? '✔ Surveillance installée : toutes les 5 minutes, l\'application est relancée si elle ne répond pas.' : '⚠ Surveillance non installée (minuterie systemd refusée).') }
    out(await waitUp() ? `  Serveur démarré : http://localhost:${port}\n  Journal : backend/logs/serveur.log (ou journalctl ${root ? '' : '--user '}-u ${UNIT})\n` : '  Pas encore de réponse : voyez backend/logs/serveur.log\n') }
  else if (cmd === 'desinstaller') { if (!scope) return out('\nAucun service installé.\n'); if (scope === 'system' && !root) die('Service système : relancez avec sudo'); ctl(scope, 'disable', '--now', `${UNIT}-surveillance.timer`); for (const n of Object.keys(watchUnits(scope === 'system'))) fs.rmSync(path.join(dirOf(scope === 'system'), n), { force: true }); ctl(scope, 'disable', '--now', UNIT); fs.rmSync(scope === 'system' ? sysUnit : userUnit, { force: true }); stopOff(); ctl(scope, 'daemon-reload'); out('\n✔ Démarrage automatique retiré.\n') }
  else if (cmd === 'demarrer' || cmd === 'arreter') { if (!scope) die('Service non installé : npm run service:installer'); if (scope === 'system' && !root) die('Service système : relancez avec sudo'); if (cmd === 'demarrer') stopOff(); else { stopOn(); note('Arrêt volontaire (npm run service:arreter) : la surveillance ne relancera pas l\'application avant « service:demarrer » ou le prochain allumage.') } const r = ctl(scope, cmd === 'demarrer' ? 'start' : 'stop', UNIT); if (!ok(r)) die(r.stderr.trim()); out(cmd === 'demarrer' ? (await waitUp() ? `\n✔ Serveur démarré : http://localhost:${port}\n` : '\n… Pas encore de réponse : voyez backend/logs/serveur.log\n') : '\n✔ Serveur arrêté.\n') }
  else if (cmd === 'verifier') { if (!scope || fs.existsSync(STOPF) || await health() || runnerAlive()) return; note('Surveillance : l\'application ne répond pas et aucun gardien n\'est actif → démarrage automatique.'); ctl(scope, 'start', UNIT) }
  else { const a = scope ? ctl(scope, 'is-active', UNIT).stdout.trim() : null, w = scope ? ctl(scope, 'is-active', `${UNIT}-surveillance.timer`).stdout.trim() : null; out(`\nSurveillance (toutes les 5 min) : ${w === 'active' ? 'INSTALLÉE' : 'non installée'}${fs.existsSync(STOPF) ? ' · en pause (arrêt volontaire)' : ''}`); out(`Démarrage automatique : ${scope ? `INSTALLÉ (service ${scope === 'system' ? 'système' : 'utilisateur'}, ${a === 'active' ? 'actif' : a})` : 'non installé (npm run service:installer)'}\nServeur : ${await health() ? 'répond sur http://localhost:' + port : 'ne répond pas'}\nJournal : backend/logs/serveur.log\n`) } }

if (!['installer', 'desinstaller', 'etat', 'demarrer', 'arreter', 'verifier'].includes(cmd)) die('Commande inconnue. Utilisez : npm run service:installer | service:desinstaller | service:etat | service:demarrer | service:arreter')
if (process.platform === 'win32') await windows(); else if (process.platform === 'linux') await linux(); else die('Système non pris en charge pour le démarrage automatique (Windows ou Linux).')
