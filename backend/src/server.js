import os from 'os'
import { config } from './config/env.js'
import express from 'express'; import helmet from 'helmet'; import rateLimit from 'express-rate-limit'
import cookieParser from 'cookie-parser'; import jwt from 'jsonwebtoken'; import bcrypt from 'bcryptjs'; import crypto from 'crypto'
import { pool, q, actorCtx } from './db/pool.js'
import { payPlan } from './lib/billing-core.js'
import { migrate, ensureOwner, provisionClinic } from './db/migrate.js'
import dossier from './routes/dossier.js'; import tariffs from './routes/tariffs.js'; import backups from './routes/backups.js'; import { startScheduler } from './lib/backup.js'; import { startAlerts, runAlerts } from './lib/alerts.js'
import { ALL, SENSITIVE, ROLES, makePermissions, assignedSql } from './core/permissions.js'
import billing from './routes/billing.js'; import clinical from './routes/clinical.js'; import stock from './routes/stock.js'; import cash from './routes/cash.js'
import planning from './routes/planning.js'; import intel from './routes/intel.js'; import { startIntel } from './lib/intel.js'; import { startCloud } from './lib/cloud.js'; import { ensureLogTriggers, startPlus, maintenance } from './lib/backup-plus.js'; import reports from './routes/reports.js'; import queue from './routes/queue.js'; import documents from './routes/documents.js'
import security, { notify as notifyQ, verifySecondFactor, sendEmailCode, verifyCode, maskEmail } from './routes/security.js'; import clinical2 from './routes/clinical2.js'; import requests from './routes/requests.js'
import { checkLicense as checkLicenseToken } from './lib/license-core.js'   // vérification de la licence saisie au login propriétaire (instance partagée)
import { sealJson, protectExisting } from './lib/protect.js'
import recovery from './routes/recovery.js'
import * as license from './lib/license.js'   // porte de licence (ajout — ne modifie aucune gestion)
// lancé par le service (scripts/service-run.js) : s'arrête si le lanceur disparaît (arrêt du service sous Windows)
if (process.env.DL_SUPERVISOR_PID) setInterval(() => { try { process.kill(Number(process.env.DL_SUPERVISOR_PID), 0) } catch { process.exit(0) } }, 5000).unref()
const SECRET = config.secret
if (!SECRET || SECRET.length < 32) throw new Error('JWT_SECRET (32+ caractères) requis')
const prod = config.prod

// ── Permissions (voir core/permissions.js) ──
const { permsOf, canDelegate } = makePermissions(q)
const audit = (req, action, table, id, details) =>
  q('insert into audit_logs(clinic_id,user_id,action,table_name,record_id,details,ip) values($1,$2,$3,$4,$5,$6,$7)',
    [req.user?.clinic_id, req.user?.id, action, table, id, req.motif ? { ...(details && typeof details === 'object' ? details : {}), motif: req.motif } : details ?? null, req.ip])

// ── App ──
export const app = express()
app.set('trust proxy', 1)
// réseau local en HTTP : pas de redirection forcée vers HTTPS (sinon les autres postes n'affichent qu'une page blanche)
// en ligne (HTTPS) : navigateur obligé de rester en HTTPS ; en local : HTTP autorisé pour les autres postes du réseau
app.use(helmet({ contentSecurityPolicy: { directives: { upgradeInsecureRequests: config.hosted ? [] : null } }, hsts: config.hosted ? { maxAge: 15552000, includeSubDomains: true } : false, crossOriginOpenerPolicy: false, originAgentCluster: false })); app.use(express.json({ limit: '100kb' })); app.use(cookieParser())
// données privées : aucune réponse de l'API ne doit être gardée par un cache (CDN de l'hébergeur, proxy, navigateur)
app.use('/api', (req, res, next) => { res.setHeader('Cache-Control', 'no-store, private'); res.setHeader('CDN-Cache-Control', 'no-store'); next() })
// cache court des calculs lourds (tableaux de bord, statistiques, dettes, résumé du journal) :
// réutilisé tant qu'aucune donnée n'a changé (toute écriture le vide) et au plus 60 s ; propre à chaque session (droits respectés)
let dataVersion = 0; const RCACHE = new Map(), HEAVY = /^\/api\/(dashboard\/owner|finance\/stats|finance\/summary|audit\/summary|debts|me\/dashboard|me\/activity|intel(\/reception)?|queue)$/
app.use((req, res, next) => {
  if (req.method !== 'GET') { if (req.path.startsWith('/api/')) res.on('finish', () => { if (res.statusCode < 400) dataVersion++ }); return next() }
  if (!HEAVY.test(req.path) || !req.cookies?.dl) return next()
  const key = req.cookies.dl + ' ' + req.originalUrl, hit = RCACHE.get(key), ttl = req.path === '/api/queue' ? 5000 : 60000
  if (hit && hit.v === dataVersion && Date.now() - hit.at < ttl) { res.setHeader('X-Cache', 'hit'); return res.status(200).type('application/json').send(hit.body) }
  const v = dataVersion, json = res.json.bind(res)
  res.json = body => { if (res.statusCode === 200 && v === dataVersion) { RCACHE.set(key, { v, at: Date.now(), body: JSON.stringify(body) }); if (RCACHE.size > 400) RCACHE.delete(RCACHE.keys().next().value) } return json(body) }
  next() })
// mode mono-utilisateur pendant une restauration : toute autre requête est refusée proprement
app.use((req, res, next) => maintenance.on && req.path.startsWith('/api/') && req.path !== '/api/health' ? res.status(503).json({ error: (maintenance.why || 'Restauration en cours') + ' : réessayez dans un instant', code: 'MAINTENANCE' }) : next())
const wrap = fn => (req, res, next) => fn(req, res, next).catch(next)
const fail = (res, s, error, code) => res.status(s).json({ error, code })

// ═══ Porte de licence (ajout Phase 3) ═══════════════════════════════════════
// Routes toujours accessibles (même licence bloquée) pour pouvoir débloquer :
app.get('/api/license/status', (req, res) => res.json(license.status()))
app.post('/api/license/activate', wrap(async (req, res) => { try { res.json(await license.activate(req.body || {})) } catch (e) { fail(res, e.http || 400, e.message, e.code) } }))
app.post('/api/license/request-otp', wrap(async (req, res) => { try { res.json(await license.requestOtp(req.body || {})) } catch (e) { fail(res, e.http || 400, e.message, e.code) } }))
app.post('/api/license/verify-otp', wrap(async (req, res) => { try { res.json(await license.activateWithOtp(req.body || {})) } catch (e) { fail(res, e.http || 400, e.message, e.code) } }))
app.post('/api/license/key', wrap(async (req, res) => { try { res.json(license.installKey((req.body || {}).token)) } catch (e) { fail(res, 400, e.message, e.code) } }))
app.post('/api/license/check', wrap(async (req, res) => { const r = await license.checkRemote(); res.json({ ...r, ...license.status() }) }))
// Provisioning de service (instance partagée) : la plate-forme (BackendDental) crée
// une clinique + son propriétaire à l'activation d'une licence. Authentifié par secret
// partagé (comparaison à temps constant), hors porte de licence car indépendant de l'état
// de licence d'une clinique donnée. Désactivé si PROVISION_SECRET n'est pas configuré.
app.post('/api/provision', wrap(async (req, res) => {
  const secret = config.provisionSecret
  if (!secret) return fail(res, 503, 'Provisioning non configuré', 'PROVISION_OFF')
  const given = Buffer.from(String(req.get('x-provision-secret') || ''))
  const want = Buffer.from(secret)
  if (given.length !== want.length || !crypto.timingSafeEqual(given, want)) return fail(res, 401, 'Secret de provisioning invalide')
  const c = await pool.connect()
  try { res.json(await provisionClinic(c, req.body || {}, () => {})) }
  catch (e) { fail(res, 400, e.message) }
  finally { c.release() }
}))
// Puis la porte : tout le reste de /api/* est bloqué si la licence n'est pas valable.
app.use(license.licenseGate)

const notify = (c, k, t, x, perm, uid) => notifyQ(q, c, k, t, x, perm, uid)
const adminish = u => u.role === 'OWNER' || u.role.startsWith('ADMIN')
const auth = wrap(async (req, res, next) => {
  let d; try { d = jwt.verify(req.cookies.dl || '', SECRET) } catch { return fail(res, 401, 'Non connecté') }
  if (d.p || !d.sid) return fail(res, 401, 'Non connecté')
  const u = (await q('select u.*,c.inactivity_logout_minutes idle,c.require_2fa req2fa from users u join clinics c on c.id=u.clinic_id where u.id=$1', [d.id])).rows[0]
  if (!u || u.status !== 'active' || u.token_version !== d.tv) return fail(res, 401, 'Session révoquée')
  if (u.is_emergency && !(u.emergency_until > new Date())) return fail(res, 401, 'Compte de secours expiré : réactivation en console uniquement')
  const s = (await q("select id,(now()-last_seen > ($2::int*interval '1 minute')) idle_out from user_sessions where id=$1 and user_id=$3 and revoked_at is null", [d.sid, u.idle, u.id])).rows[0]
  if (!s) return fail(res, 401, 'Session terminée')
  if (s.idle_out) { await q('update user_sessions set revoked_at=now() where id=$1', [s.id]); return fail(res, 401, 'Session expirée par inactivité', 'IDLE_TIMEOUT') }
  q("update user_sessions set last_seen=now() where id=$1 and last_seen<now()-interval '20 seconds'", [s.id]).catch(() => {})
  req.user = u; req.sid = s.id; req.perms = await permsOf(u); req.actor = { id: u.id, n: `${u.first_name} ${u.last_name}`.trim(), ip: req.ip, r: '' }
  actorCtx.run(req.actor, () => next())
})
const need = (...ps) => [auth, (req, res, next) => {
  if (req.user.must_change_password) return fail(res, 403, 'Changement de mot de passe obligatoire', 'PASSWORD_CHANGE_REQUIRED')
  if (adminish(req.user) && req.user.req2fa && !req.user.totp_enabled && !req.user.mfa_email) return fail(res, 403, "Activez l'authentification à deux facteurs", 'TWOFA_SETUP_REQUIRED')
  if (ps.length && !ps.some(p => req.perms.has(p))) return fail(res, 403, 'Permission refusée')
  guard(req, res, next).catch(next) }]
// ── Protections des modifications sensibles ──
// motif : texte obligatoire (5 caractères min.), conservé dans l'historique et le journal ;
// mot de passe : reconfirmé pour les actions critiques (valable 10 min sur la session, 5 essais puis blocage 15 min).
const hasRow = (sql) => async req => (await q(sql, [req.params.id])).rowCount > 0
const GUARD = {
  '/api/patients/:id/update': { motif: true },
  '/api/patients/:id/primary-doctor': { motif: true },
  '/api/patients/:id/history': { motif: hasRow("select 1 from medical_histories where patient_id=$1 and data is not null and data::text not in ('{}','null')") },
  '/api/patients/:id/exams': { motif: hasRow('select 1 from dental_examinations where patient_id=$1') },
  '/api/patients/:id/hygiene': { motif: hasRow('select 1 from patient_hygiene where patient_id=$1') },
  '/api/tariffs/:id': { motif: true },
  '/api/users': { reauth: true },
  '/api/recovery-codes': { reauth: true },
  '/api/users/:id/status': { reauth: true, motif: true },
  '/api/users/:id/profile': { reauth: true },
  '/api/users/:id/permissions': { reauth: true, motif: true },
  '/api/users/:id/reset-password': { reauth: true },
  '/api/users/:id/reset-2fa': { reauth: true, motif: true },
  '/api/doctors/:id/commission': { reauth: true, motif: true },
  '/api/employees': { reauth: true },
  '/api/payroll/:id/adjust': { reauth: true, motif: true },
  '/api/payments/:id/void': { reauth: true },
  '/api/invoices/:id/cancel': { reauth: true },
  '/api/invoices/:id/correct': { reauth: true },
  '/api/rates': { reauth: true },
  '/api/settings/security': { reauth: true },
  '/api/settings/mail': { reauth: true } }
const REAUTH = new Map(), REAUTH_FAIL = new Map()
const header = (req, k) => { try { return decodeURIComponent(String(req.headers[k] || '')) } catch { return '' } }
async function guard(req, res, next) {
  const g = req.method !== 'GET' && GUARD[req.route?.path]; if (!g) return next()
  if (g.reauth && !(REAUTH.get(req.sid) > Date.now())) {
    const f = REAUTH_FAIL.get(req.sid); if (f && f.n >= 5 && Date.now() - f.at < 15 * 60e3) return fail(res, 429, 'Trop d\'essais : réessayez dans 15 minutes', 'REAUTH_LOCKED')
    const pw = header(req, 'x-confirm-password'); if (!pw) return fail(res, 428, 'Pour votre sécurité, confirmez votre mot de passe.', 'REAUTH_REQUIRED')
    if (!(await bcrypt.compare(pw, req.user.password_hash))) { const n = (f && Date.now() - f.at < 15 * 60e3 ? f.n : 0) + 1; REAUTH_FAIL.set(req.sid, { n, at: Date.now() }); await audit(req, 'REAUTH_FAILED', 'users', req.user.id, { route: req.route.path }); return fail(res, 428, `Mot de passe incorrect (${5 - n} essai(s) restant(s))`, 'REAUTH_REQUIRED') }
    REAUTH_FAIL.delete(req.sid); REAUTH.set(req.sid, Date.now() + 10 * 60e3) }
  if (g.motif && (g.motif === true || await g.motif(req))) {
    const m = clean(header(req, 'x-motif'), 300); if (!m || m.length < 5) return fail(res, 428, 'Indiquez le motif de cette modification (il sera conservé dans l\'historique).', 'REASON_REQUIRED')
    req.motif = m; if (req.actor) req.actor.r = m }
  next() }
const newSession = async (req, res, u) => { const { rows: [s] } = await q('insert into user_sessions(user_id,ip,user_agent) values($1,$2,$3) returning id', [u.id, req.ip, (req.headers['user-agent'] || '').slice(0, 200)])
  res.cookie('dl', jwt.sign({ id: u.id, tv: u.token_version, sid: s.id }, SECRET, { expiresIn: '8h' }), { httpOnly: true, sameSite: 'strict', secure: req.secure, maxAge: 8 * 3600e3 }) }
// Politique de mot de passe : 12 caractères, majuscule, minuscule, chiffre, caractère spécial, pas de répétition,
// ni nom / prénom / e-mail de la personne, ni mot de passe courant
const COMMON = ['password', 'motdepasse', 'azerty', 'qwerty', '123456', '12345678', 'abcdef', 'admin', 'welcome', 'bienvenue', 'dental', 'clinique', 'clinic', 'haiti', 'soleil', 'dentist', 'docteur', 'secret', 'letmein', 'iloveyou']
export const pwProblem = (p, u = {}) => { if (typeof p !== 'string' || p.length < 12) return 'Au moins 12 caractères'
  if (!/[a-z]/.test(p) || !/[A-Z]/.test(p)) return 'Au moins une majuscule et une minuscule'; if (!/\d/.test(p)) return 'Au moins un chiffre'; if (!/[^A-Za-z0-9]/.test(p)) return 'Au moins un caractère spécial (! ? # @ % & * …)'
  if (/(.)\1\1/.test(p)) return 'Pas trois fois le même caractère à la suite'; const low = p.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  for (const w of [u.first_name, u.last_name, String(u.email || '').split('@')[0]].filter(x => x && x.length >= 3)) if (low.includes(String(w).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, ''))) return 'Ne doit pas contenir votre nom, prénom ou e-mail'
  if (COMMON.some(w => low.includes(w))) return 'Mot trop courant (password, azerty, 123456, clinique…)'; return null }
const strong = p => !pwProblem(p)
const clean = (v, n = 200) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, n) : null)

// ── Auth ──
const hist = (req, u, email, ok, reason) => q('insert into login_history(clinic_id,user_id,email,success,reason,ip,user_agent) values($1,$2,$3,$4,$5,$6,$7)', [u?.clinic_id ?? null, u?.id ?? null, email, ok, reason, req.ip, (req.headers['user-agent'] || '').slice(0, 200)])
const failLogin = async u => { const { rows: [r] } = await q("update users set failed_attempts=failed_attempts+1, locked_until=case when failed_attempts>=4 then now()+interval '15 minutes' end where id=$1 returning locked_until", [u.id]); if (r.locked_until && r.locked_until > new Date()) await notify(u.clinic_id, 'account_locked', 'Compte verrouillé', `${u.email} verrouillé 15 min après 5 échecs`) }
const finishLogin = async (req, res, u) => {
  if (adminish(u) && (await q('select 1 from login_history where user_id=$1 and success limit 1', [u.id])).rowCount && !(await q("select 1 from login_history where user_id=$1 and success and ip=$2 and created_at>now()-interval '60 days' limit 1", [u.id, req.ip])).rowCount)
    await notify(u.clinic_id, 'new_ip', 'Connexion depuis une nouvelle adresse', `${u.email} depuis ${req.ip}`)
  await q('update users set failed_attempts=0, locked_until=null, last_login_at=now() where id=$1', [u.id]); await newSession(req, res, u); req.user = u
  await hist(req, u, u.email, true, 'ok'); await audit(req, 'LOGIN', 'users', u.id); res.json({ ok: true }) }
app.get('/api/health', wrap(async (req, res) => { await q('select 1'); res.json({ status: 'ok', uptime: Math.round(process.uptime()) }) }))
// nom d'utilisateur unique : initiales + 6 chiffres (ex. Jean Pierre → JP620012)
const initialsOf = (fn, ln) => [fn, ln].map(x => String(x || '').normalize('NFD').replace(/[^A-Za-z]/g, '').charAt(0).toUpperCase()).join('') || 'U'
async function makeUsername(fn, ln) { const ini = initialsOf(fn, ln)
  for (let i = 0; i < 50; i++) { const u = ini + String(crypto.randomInt(100000, 1000000)); if (!(await q('select 1 from users where upper(username)=$1', [u])).rowCount) return u }
  throw new Error('Impossible de générer un nom d\'utilisateur unique') }
const loginLimiter = rateLimit({ windowMs: 15 * 60e3, limit: 40, standardHeaders: true })
app.post('/api/login', loginLimiter, wrap(async (req, res) => {
  const email = clean(req.body.email)?.toLowerCase(), pw = req.body.password   // « email » = adresse e-mail ou nom d'utilisateur
  const u = email && typeof pw === 'string' ? (await q(email.includes('@') ? 'select * from users where email=$1' : 'select * from users where upper(username)=upper($1)', [email])).rows[0] : null
  if (u?.locked_until && u.locked_until > new Date()) { await hist(req, u, email, false, 'locked'); return fail(res, 429, 'Compte temporairement verrouillé') }
  if (!u || !(await bcrypt.compare(pw || '', u.password_hash))) { console.warn('Connexion refusée :', u ? 'mot de passe incorrect' : 'identifiant inconnu', '→', email); if (u) await failLogin(u); await hist(req, u, email, false, 'bad_password'); return fail(res, 401, 'Identifiants invalides') }
  if (u.status !== 'active') { await hist(req, u, email, false, 'account_' + u.status); return fail(res, 403, 'Compte bloqué ou désactivé') }
  if (u.is_emergency && !(u.emergency_until > new Date())) { await hist(req, u, email, false, 'emergency_inactive'); return fail(res, 403, 'Compte de secours non activé (activation en console : npm run recuperation)') }
  if (u.totp_enabled || u.mfa_email) { const mail = u.mfa_email ? await sendEmailCode(q, u) : null, rc = (await q('select count(*)::int n from recovery_codes where user_id=$1 and used_at is null', [u.id]).catch(() => ({ rows: [{ n: 0 }] }))).rows[0].n
    return res.json({ need_otp: true, challenge: jwt.sign({ id: u.id, tv: u.token_version, p: 'otp' }, SECRET, { expiresIn: '10m' }), methods: { app: !!u.totp_enabled, email: !!u.mfa_email, recovery: rc > 0 }, email: mail }) }
  await finishLogin(req, res, u) }))
app.post('/api/login/otp', loginLimiter, wrap(async (req, res) => {
  let d; try { d = jwt.verify(req.body.challenge || '', SECRET) } catch { return fail(res, 401, 'Défi expiré : reconnectez-vous') } if (d.p !== 'otp') return fail(res, 401, 'Défi invalide')
  const u = (await q('select * from users where id=$1', [d.id])).rows[0]; if (!u || u.status !== 'active' || u.token_version !== d.tv) return fail(res, 401, 'Session révoquée')
  if (u.locked_until && u.locked_until > new Date()) return fail(res, 429, 'Compte temporairement verrouillé')
  if (!(await verifySecondFactor(q, u, req.body.code))) { await failLogin(u); await hist(req, u, u.email, false, 'otp_failed'); return fail(res, 401, 'Code invalide') }
  await finishLogin(req, res, u) }))
app.post('/api/login/resend', loginLimiter, wrap(async (req, res) => { let d; try { d = jwt.verify(req.body.challenge || '', SECRET) } catch { return fail(res, 401, 'Défi expiré : reconnectez-vous') } if (d.p !== 'otp') return fail(res, 401, 'Défi invalide')
  const u = (await q('select * from users where id=$1', [d.id])).rows[0]; if (!u?.mfa_email || u.token_version !== d.tv) return fail(res, 400, 'Envoi par e-mail non disponible'); const r = await sendEmailCode(q, u); r.sent ? res.json(r) : fail(res, r.wait ? 429 : 503, r.reason) }))
// ── Connexion PROPRIÉTAIRE par LICENCE + OTP e-mail (instance web partagée) ──
// Le super-admin est créé sur la vitrine (provisioning). Pour entrer dans le logiciel,
// il saisit la licence de sa clinique → code OTP envoyé à son e-mail → session liée au clinic_id.
// Le personnel continue d'utiliser e-mail/mot de passe + 2FA (/api/login).
const ownerFromLicense = async input => {
  const lic = String(input || '').trim()
  if (!lic) return { err: [400, 'Saisissez votre clé de licence', 'LICENSE_BAD'] }
  // La licence saisie est la clé que le client voit dans son espace (clé courte DNTL-…),
  // ou, à défaut, un jeton DL1 signé. On la reconnaît à la valeur stockée au provisioning.
  let cl = (await q('select id, license_cid from clinics where license_key=$1 or license_cid=$1', [lic])).rows[0]
  if (!cl) { // tolère un jeton DL1 complet : on vérifie la signature puis on cherche par cid
    const chk = checkLicenseToken(lic)
    if (chk.payload?.cid) cl = (await q('select id, license_cid from clinics where license_cid=$1', [String(chk.payload.cid)])).rows[0]
    if (chk.status && !['active', 'grace', 'blocked', 'invalid'].includes(chk.status)) { /* ignore */ }
  }
  if (!cl) return { err: [404, "Aucun compte n'est rattaché à cette licence. Créez d'abord votre compte super-admin depuis votre espace client.", 'NO_ACCOUNT'] }
  const owner = (await q("select * from users where clinic_id=$1 and role='OWNER' and status='active' order by created_at limit 1", [cl.id])).rows[0]
  if (!owner) return { err: [404, 'Propriétaire introuvable pour cette clinique', 'NO_OWNER'] }
  return { owner, cid: String(cl.license_cid || cl.id) }
}
app.post('/api/login/owner/request', loginLimiter, wrap(async (req, res) => {
  const r = await ownerFromLicense((req.body || {}).license); if (r.err) return fail(res, r.err[0], r.err[1], r.err[2])
  const sent = await sendEmailCode(q, r.owner, 'owner'); if (!sent.sent) return fail(res, sent.wait ? 429 : 503, sent.reason)
  res.json({ sent: true, email: sent.to || maskEmail(r.owner.email), recent: !!sent.recent,
    challenge: jwt.sign({ id: r.owner.id, tv: r.owner.token_version, cid: r.cid, p: 'ownerotp' }, SECRET, { expiresIn: '10m' }) }) }))
app.post('/api/login/owner/verify', loginLimiter, wrap(async (req, res) => {
  let d; try { d = jwt.verify((req.body || {}).challenge || '', SECRET) } catch { return fail(res, 401, 'Défi expiré : recommencez') }
  if (d.p !== 'ownerotp') return fail(res, 401, 'Défi invalide')
  const owner = (await q('select * from users where id=$1', [d.id])).rows[0]
  if (!owner || owner.token_version !== d.tv || owner.status !== 'active') return fail(res, 401, 'Session invalide : recommencez')
  if (!await verifyCode(q, owner, (req.body || {}).code, ['owner'])) return fail(res, 400, 'Code incorrect ou expiré')
  await newSession(req, res, owner); res.json({ ok: true }) }))
app.post('/api/login/owner/resend', loginLimiter, wrap(async (req, res) => {
  let d; try { d = jwt.verify((req.body || {}).challenge || '', SECRET) } catch { return fail(res, 401, 'Défi expiré : recommencez') }
  if (d.p !== 'ownerotp') return fail(res, 401, 'Défi invalide')
  const owner = (await q('select * from users where id=$1', [d.id])).rows[0]; if (!owner || owner.token_version !== d.tv) return fail(res, 400, 'Indisponible')
  const r = await sendEmailCode(q, owner, 'owner'); r.sent ? res.json(r) : fail(res, r.wait ? 429 : 503, r.reason) }))
app.post('/api/logout', wrap(async (req, res) => { try { const d = jwt.verify(req.cookies.dl || '', SECRET); if (d.sid) await q('update user_sessions set revoked_at=now() where id=$1', [d.sid]) } catch {} res.clearCookie('dl'); res.json({ ok: true }) }))
app.get('/api/me', auth, (req, res) => { const u = req.user
  res.json({ id: u.id, username: u.username, first_name: u.first_name, last_name: u.last_name, role: u.role, must_change_password: u.must_change_password, totp_enabled: u.totp_enabled, idle_minutes: u.idle,
    mfa_email: !!u.mfa_email, needs_2fa_setup: !u.must_change_password && adminish(u) && u.req2fa && !u.totp_enabled && !u.mfa_email, perms: [...req.perms] }) })
// Profil personnel : chacun peut consulter son compte et modifier son numéro de téléphone.
app.get('/api/profile', auth, (req, res) => { const u = req.user
  res.json({ username: u.username, first_name: u.first_name, last_name: u.last_name, email: u.email, phone: u.phone || '', role: u.role, job_title: u.job_title, created_at: u.created_at, last_login_at: u.last_login_at, totp_enabled: u.totp_enabled, admin: adminish(u) }) })
app.post('/api/profile', auth, wrap(async (req, res) => {
  const ph = clean(req.body.phone, 30); if (ph && !/^\+?[\d\s().-]{6,30}$/.test(ph)) return fail(res, 400, 'Numéro de téléphone invalide')
  await q('update users set phone=$2 where id=$1', [req.user.id, ph]); await audit(req, 'PROFILE_UPDATED', 'users', req.user.id); res.json({ ok: true }) }))
app.post('/api/change-password', auth, wrap(async (req, res) => {
  const { current, next: np } = req.body
  if (!(await bcrypt.compare(current || '', req.user.password_hash))) return fail(res, 400, 'Mot de passe actuel incorrect')
  { const pb = pwProblem(np, req.user); if (pb) return fail(res, 400, 'Mot de passe trop faible : ' + pb) }
  if (np === current) return fail(res, 400, 'Choisissez un mot de passe différent')
  const { rows: [u] } = await q('update users set password_hash=$1, must_change_password=false, token_version=token_version+1 where id=$2 returning *', [await bcrypt.hash(np, 12), req.user.id])
  await newSession(req, res, u); await audit(req, 'PASSWORD_CHANGED', 'users', u.id); res.json({ ok: true })
}))

// ── Utilisateurs ──
const tmpPw = () => { for (;;) { const p = crypto.randomBytes(10).toString('base64url').replace(/[-_]/g, '') + 'aA7#'; if (!pwProblem(p)) return p } }   // conforme à la politique (12+ caractères, spécial)
app.get('/api/users', need('manage_users'), wrap(async (req, res) => res.json((await q(
  'select u.id,u.username,u.email,u.first_name,u.last_name,u.role,u.status,u.job_title,u.phone,u.totp_enabled,u.mfa_email,u.last_login_at,u.created_at,(select concat(c.first_name,\' \',c.last_name) from users c where c.id=u.created_by) created_by,e.id employee_id,coalesce(e.base_salary,0)::text base_salary,coalesce(e.commission_pct,0)::text commission_pct from users u left join employees e on e.user_id=u.id where u.clinic_id=$1 order by u.created_at', [req.user.clinic_id])).rows)))
app.post('/api/users', need('manage_users'), wrap(async (req, res) => {
  const { role } = req.body, email = clean(req.body.email)?.toLowerCase(), fn = clean(req.body.first_name), ln = clean(req.body.last_name)
  if (!email || !fn || !ln || !ROLES[role]) return fail(res, 400, 'Champs invalides')
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return fail(res, 400, 'Adresse e-mail invalide')
  { const dup = (await q('select first_name,last_name from users where lower(trim(email))=$1', [email.trim()])).rows[0]; if (dup) return fail(res, 409, `Cette adresse e-mail est déjà utilisée par ${dup.first_name} ${dup.last_name}`) }
  if (role === 'OWNER' || (role.startsWith('ADMIN') && req.user.role !== 'OWNER')) return fail(res, 403, 'Rôle réservé au propriétaire')
  const pp = payPlan(req.body); if (pp.err) return fail(res, 400, pp.err)
  const pw = tmpPw(), username = await makeUsername(fn, ln)
  try {
    const { rows: [u] } = await q('insert into users(clinic_id,email,password_hash,first_name,last_name,role,job_title,created_by,username) values($1,$2,$3,$4,$5,$6,$7,$8,$9) returning id',
      [req.user.clinic_id, email, await bcrypt.hash(pw, 12), fn, ln, role, clean(req.body.job_title), req.user.id, username])
    await q('insert into employees(clinic_id,user_id,first_name,last_name,job_title,base_salary,commission_pct,hire_date) values($1,$2,$3,$4,$5,$6,$7,current_date)', [req.user.clinic_id, u.id, fn, ln, clean(req.body.job_title) || (role === 'DENTIST' ? 'Médecin dentiste' : null), pp.base, pp.pct])
    await audit(req, 'USER_CREATED', 'users', u.id, { role, base_salary: pp.base, commission_pct: pp.pct }); if (role.startsWith('ADMIN')) await notify(req.user.clinic_id, 'admin_created', 'Administrateur créé', `${email} (${role}) par ${req.user.email}`); res.json({ id: u.id, username, temporary_password: pw })
  } catch (e) { if (e.code === '23505') return fail(res, 409, 'Email déjà utilisé'); throw e }
}))
const target = wrap(async (req, res, next) => {
  const t = (await q('select * from users where id=$1 and clinic_id=$2', [req.params.id, req.user.clinic_id])).rows[0]
  if (!t) return fail(res, 404, 'Introuvable')
  if (t.role === 'OWNER') return fail(res, 403, 'Le compte propriétaire est protégé')
  if (t.id === req.user.id) return fail(res, 403, 'Action interdite sur son propre compte')
  if (t.role.startsWith('ADMIN') && req.user.role !== 'OWNER') return fail(res, 403, 'Réservé au propriétaire')
  req.target = t; next() })
app.post('/api/users/:id/status', need('manage_users'), target, wrap(async (req, res) => {
  const s = req.body.status; if (!['active', 'blocked', 'disabled'].includes(s)) return fail(res, 400, 'Statut invalide')
  await q('update users set status=$1, token_version=token_version+1 where id=$2', [s, req.target.id])  // révoque les sessions
  await audit(req, 'USER_STATUS', 'users', req.target.id, { status: s })
  await notify(req.user.clinic_id, 'user_status', 'Statut de compte modifié', `${req.target.email} → ${s} (par ${req.user.email})`); res.json({ ok: true }) }))
// modifier un compte : nom, fonction, téléphone et rôle (un changement de rôle ferme ses sessions ; rôles ADMIN réservés au propriétaire)
app.post('/api/users/:id/profile', need('manage_users'), target, wrap(async (req, res) => {
  const b = req.body, t = req.target, role = b.role || t.role, fn = clean(b.first_name) || t.first_name, ln = clean(b.last_name) || t.last_name, em = clean(b.email)?.toLowerCase().trim() || t.email
  if (em !== t.email) { if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(em)) return fail(res, 400, 'Adresse e-mail invalide'); const dup = (await q('select first_name,last_name from users where lower(trim(email))=$1 and id<>$2', [em, t.id])).rows[0]; if (dup) return fail(res, 409, `Cette adresse e-mail est déjà utilisée par ${dup.first_name} ${dup.last_name}`) }
  if (!ROLES[role] || role === 'OWNER') return fail(res, 400, 'Rôle invalide')
  if (role.startsWith('ADMIN') && req.user.role !== 'OWNER') return fail(res, 403, 'Seul le propriétaire peut nommer un administrateur')
  await q('update users set first_name=$2,last_name=$3,job_title=$4,phone=$5,role=$6,email=$7,token_version=token_version+case when role<>$6 or email<>$7 then 1 else 0 end where id=$1', [t.id, fn, ln, clean(b.job_title) ?? t.job_title, clean(b.phone, 30) ?? t.phone, role, em])
  await q('update employees set first_name=$2,last_name=$3,job_title=coalesce($4,job_title) where user_id=$1', [t.id, fn, ln, clean(b.job_title)])
  await audit(req, 'USER_UPDATED', 'users', t.id, { compte: `${fn} ${ln}`, role_from: t.role, role_to: role, job_title: clean(b.job_title), ...(em !== t.email ? { email_from: t.email, email_to: em } : {}) })
  if (role !== t.role) await notify(req.user.clinic_id, 'user_role', 'Rôle modifié', `${t.email} : ${t.role} → ${role} (par ${req.user.email})`)
  res.json({ ok: true, role_changed: role !== t.role }) }))
app.post('/api/users/:id/reset-password', need('manage_users'), target, wrap(async (req, res) => {
  const pw = tmpPw()
  await q('update users set password_hash=$1, must_change_password=true, token_version=token_version+1 where id=$2', [await bcrypt.hash(pw, 12), req.target.id])
  await audit(req, 'PASSWORD_RESET', 'users', req.target.id)
  await notify(req.user.clinic_id, 'password_reset', 'Mot de passe réinitialisé', `${req.target.email} (par ${req.user.email})`); res.json({ temporary_password: pw }) }))
app.post('/api/users/:id/permissions', need('manage_roles'), target, wrap(async (req, res) => {
  const { perm, granted = true, can_delegate = false } = req.body
  if (!ALL.includes(perm)) return fail(res, 400, 'Permission inconnue')
  if (!(await canDelegate(req.user, perm))) return fail(res, 403, 'Vous ne pouvez pas déléguer cette permission')
  if (can_delegate && req.user.role !== 'OWNER' && SENSITIVE.has(perm)) return fail(res, 403, 'Délégation réservée au propriétaire')
  await q(`insert into user_permissions(user_id,perm,granted,can_delegate,granted_by) values($1,$2,$3,$4,$5)
    on conflict(user_id,perm) do update set granted=$3, can_delegate=$4, granted_by=$5, granted_at=now()`, [req.target.id, perm, !!granted, !!can_delegate, req.user.id])
  await audit(req, 'PERMISSION_CHANGED', 'user_permissions', req.target.id, { perm, granted: !!granted })
  await notify(req.user.clinic_id, 'permission_changed', 'Permission modifiée', `${req.user.email} : ${perm} ${granted ? 'accordée à' : 'retirée à'} ${req.target.email}`); res.json({ ok: true }) }))

// ── Taux de change (append-only) ──
app.get('/api/rates', need('view_finances', 'manage_exchange_rates'), wrap(async (req, res) => res.json((await q(
  "select r.id,r.rate::text,r.effective_at,r.justification,concat(u.first_name,' ',u.last_name) by from exchange_rates r join users u on u.id=r.created_by where r.clinic_id=$1 order by effective_at desc, r.created_at desc limit 100", [req.user.clinic_id])).rows)))
const canRate = req => req.perms.has('manage_exchange_rates') || ['OWNER', 'ADMIN', 'ADMIN_FINANCIER'].includes(req.user.role)
app.post('/api/rates', need(), wrap(async (req, res) => {
  if (!canRate(req)) return fail(res, 403, 'Permission refusée')
  const r = String(req.body.rate ?? '').replace(',', '.').trim(); if (!/^\d{1,9}(\.\d{1,6})?$/.test(r) || Number(r) <= 0) return fail(res, 400, 'Taux invalide')
  const { rows: [x] } = await q('insert into exchange_rates(clinic_id,rate,justification,created_by) values($1,$2,$3,$4) returning id', [req.user.clinic_id, r, clean(req.body.justification, 300), req.user.id])
  await audit(req, 'RATE_SET', 'exchange_rates', x.id, { rate: r }); await notify(req.user.clinic_id, 'rate_changed', 'Taux du jour modifié', `1 USD = ${r} HTG (par ${req.user.first_name} ${req.user.last_name})`, 'view_finances'); res.json({ ok: true, rate: Number(r) }) }))

// ── Patients ──
// Recherche : chaque mot saisi doit se retrouver dans le nom, le prénom, le téléphone ou le n° de dossier (« jean dupont », « DL-K7M2 »…).
const patWhere = (txt, args) => { let w = 'clinic_id=$1'
  for (const t of (txt || '').split(/\s+/).filter(Boolean).slice(0, 5)) { args.push(`%${t.replace(/[%_\\]/g, '\\$&')}%`); const n = args.length
    w += ` and (last_name ilike $${n} or first_name ilike $${n} or phone ilike $${n} or file_number ilike $${n})` }
  return w }
app.get('/api/patients', need('view_all_patients', 'view_assigned_patients'), wrap(async (req, res) => {
  const page = Math.max(0, parseInt(req.query.page) || 0), args = [req.user.clinic_id], st = ['archived', 'all'].includes(req.query.status) ? req.query.status : 'active'
  let w = patWhere(clean(req.query.q, 60), args) + (st === 'all' ? '' : ` and status='${st}'`)
  if (!req.perms.has('view_all_patients')) { args.push(req.user.id); w += ' and ' + assignedSql('patients', '$' + args.length) }   // médecin : uniquement ses patients
  const { rows } = await q(`select id,file_number,last_name,first_name,phone,sex,status,deleted_at,delete_reason,(select u.first_name||' '||u.last_name from users u where u.id=patients.deleted_by) deleted_by_name,date_part('year',age(birth_date))::int age,registered_at,
    (select u.first_name||' '||u.last_name from users u where u.id=patients.primary_doctor_id) primary_doctor,
    (select max(c.consulted_at) from consultations c where c.patient_id=patients.id) last_visit,
    (select min(a.starts_at) from appointments a where a.patient_id=patients.id and a.status in ('planned','confirmed') and a.starts_at>now()) next_appt,
    count(*) over() total from patients where ${w} order by last_name,first_name limit 20 offset ${page * 20}`, args)
  res.json({ rows, total: Number(rows[0]?.total ?? 0) }) }))
// Aide à la saisie : retrouve le n° de dossier à partir d'un nom (et inversement) dans les formulaires.
app.get('/api/patients/lookup', need('view_all_patients', 'view_assigned_patients', 'manage_appointments', 'manage_treatment_plans', 'manage_prostheses', 'manage_finances', 'view_finances', 'manage_inventory', 'create_patients', 'edit_patients', 'manage_queue'), wrap(async (req, res) => {
  const args = [req.user.clinic_id], w = patWhere(clean(req.query.q, 60), args)
  res.json((await q(`select id,file_number,last_name,first_name,phone from patients where ${w} and status='active' order by last_name,first_name limit 10`, args)).rows) }))
app.post('/api/patients', need('create_patients'), wrap(async (req, res) => {
  const b = req.body, ln = clean(b.last_name), fn = clean(b.first_name), ph = clean(b.phone, 30), ad = clean(b.address), ec = clean(b.emergency_contact), ep = clean(b.emergency_phone, 30)
  if (!ln || !fn) return fail(res, 400, 'Nom et prénom requis')
  if (!ph || !ad || !ec || !ep) return fail(res, 400, "Téléphone, adresse et contact d'urgence (nom et numéro) sont obligatoires")
  const al = clean(b.allergies, 500); if (b.has_allergy === 'yes' && !al) return fail(res, 400, 'Précisez les allergies du patient')
  const kids = b.children_count === '' || b.children_count == null ? null : Math.min(30, Math.max(0, parseInt(b.children_count) || 0))
  const { rows: [p] } = await q('insert into patients(clinic_id,last_name,first_name,birth_date,sex,phone,phone2,address,department,zone,marital_status,children_count,profession,emergency_contact,emergency_phone,created_by) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) returning id,file_number',
    [req.user.clinic_id, ln, fn, /^\d{4}-\d{2}-\d{2}$/.test(b.birth_date || '') ? b.birth_date : null, ['M', 'F'].includes(b.sex) ? b.sex : null, ph, clean(b.phone2, 30) || null, ad, clean(b.department, 80) || null, clean(b.zone, 80) || null, clean(b.marital_status, 40) || null, kids, clean(b.profession, 80) || null, ec, ep, req.user.id])
  // fiche complète : identité, assurance, provenance
  const em = clean(b.email, 120); if (em && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(em)) return fail(res, 400, 'Adresse e-mail invalide')
  await q('update patients set email=$2,id_number=$3,birth_place=$4,insurance=$5,insurance_number=$6,referred_by=$7,notes=$8 where id=$1', [p.id, em, clean(b.id_number, 40), clean(b.birth_place, 80), clean(b.insurance, 80), clean(b.insurance_number, 40), clean(b.referred_by, 80), clean(b.notes, 1000)])
  // médecin traitant choisi dès l'inscription
  if (/^[0-9a-f-]{36}$/.test(b.primary_doctor_id || '') && (await q("select 1 from users where id=$1 and clinic_id=$2 and status='active'", [b.primary_doctor_id, req.user.clinic_id])).rowCount) {
    await q('update patients set primary_doctor_id=$2 where id=$1', [p.id, b.primary_doctor_id]); await q('insert into patient_doctor_history(patient_id,doctor_id,changed_by) values($1,$2,$3)', [p.id, b.primary_doctor_id, req.user.id]) }
  // premières informations médicales
  const COND = ['diabetes', 'hemophilia', 'hiv', 'smoking', 'alcohol', 'pregnancy', 'cardiovascular', 'pulmonary', 'epilepsy', 'stomach', 'cancer', 'migraines'], med = {}
  if (b.has_allergy === 'no') med.allergies = 'Aucune'; else if (al) med.allergies = al
  for (const k of COND) if (b[k] === true || b[k] === 'on' || b[k] === 'true') med[k] = true
  for (const [k, n] of [['blood_group', 5], ['blood_pressure', 20], ['medications', 500], ['other', 500], ['motif', 500]]) { const v = clean(b[k], n); if (v) med[k] = v }
  if (Object.keys(med).length) await q('insert into medical_histories(patient_id,clinic_id,data,updated_by) values($1,$2,$3,$4)', [p.id, req.user.clinic_id, sealJson(med), req.user.id])
  await audit(req, 'PATIENT_CREATED', 'patients', p.id); res.json(p) }))
app.get('/api/audit/summary', need('view_audit_logs'), wrap(async (req, res) => { const c = req.user.clinic_id, one = async (sql, p = [c]) => (await q(sql, p)).rows[0]
  const SENS = "'USER_CREATED','USER_UPDATED','USER_STATUS','PASSWORD_RESET','PERMISSION_CHANGED','SESSIONS_REVOKED','SECURITY_SETTINGS','INVOICE_CANCELLED','INVOICE_CORRECTED','PAYMENT_VOIDED','PATIENT_ARCHIVED','RESTORE_REQUESTED','BACKUP_DOWNLOADED','CLOUD_CONFIGURED','CLOUD_IMPORTED','REATTRIBUTED','EMPLOYEE_PAY','COMMISSION_RATE','RATE_SET','DOCUMENT_ARCHIVED','MFA_EMAIL_ENABLED','MFA_EMAIL_DISABLED','ACCESS_CODE_ISSUED','MAIL_SETTINGS','DOCTOR_SCHEDULE'"
  const k = await one(`select count(*) filter (where created_at >= current_date)::int today, count(*) filter (where created_at >= now()-interval '7 days')::int week, count(distinct user_id) filter (where created_at >= current_date)::int users_today, count(*) filter (where action in (${SENS}) and created_at >= now()-interval '7 days')::int sensitive from audit_logs where clinic_id=$1`)
  const fails = (await q("select coalesce(nullif(email,''),'inconnu') email, count(*)::int n, max(created_at) last, string_agg(distinct host(ip), ', ') ips from login_history where (clinic_id=$1 or clinic_id is null) and not success and created_at >= now()-interval '7 days' group by 1 order by n desc limit 8", [c])).rows
  const okLogins = (await one("select count(*)::int n from login_history where (clinic_id=$1 or clinic_id is null) and success and created_at >= now()-interval '7 days'")).n
  const cl = await one('select open_time,close_time from clinics where id=$1')
  const after = (await q(`select concat(u.first_name,' ',u.last_name) who, count(*)::int n, max(a.created_at) last from audit_logs a join users u on u.id=a.user_id where a.clinic_id=$1 and a.created_at >= now()-interval '7 days' and ((a.created_at at time zone 'America/Port-au-Prince')::time < $2::time - interval '1 hour' or (a.created_at at time zone 'America/Port-au-Prince')::time > $3::time + interval '2 hours') and a.action not in ('BACKUP_CREATED','CLOUD_SYNC') group by 1 order by n desc limit 5`, [c, cl?.open_time || '08:00', cl?.close_time || '17:00'])).rows
  const top = (await q("select concat(u.first_name,' ',u.last_name) who, u.role, count(*)::int n from audit_logs a join users u on u.id=a.user_id where a.clinic_id=$1 and a.created_at >= now()-interval '7 days' group by 1,2 order by n desc limit 6", [c])).rows
  const cats = (await q("select split_part(action,'_',1) cat, count(*)::int n from audit_logs where clinic_id=$1 and created_at >= now()-interval '7 days' group by 1 order by n desc", [c])).rows
  const sensitive = (await q(`select a.id,a.action,a.details,a.created_at,concat(u.first_name,' ',u.last_name) who from audit_logs a left join users u on u.id=a.user_id where a.clinic_id=$1 and a.action in (${SENS}) order by a.id desc limit 8`, [c])).rows
  const views = (await one("select count(*)::int n, count(distinct user_id)::int u from audit_logs where clinic_id=$1 and action in ('RECORD_VIEWED','DOCUMENT_VIEWED','PATIENT_PDF') and created_at >= current_date")).n
  const bk = await one("select max(created_at) last, count(*) filter (where action='BACKUP_FAILED' and created_at >= now()-interval '7 days')::int failed from audit_logs where clinic_id=$1 and action in ('BACKUP_CREATED','BACKUP_FAILED')")
  res.json({ kpi: { ...k, failed_logins: fails.reduce((a, f) => a + f.n, 0), ok_logins: okLogins, record_views_today: views }, fails, after_hours: after, top, cats, sensitive, backup: bk, hours: cl }) }))
app.get('/api/history', need('view_audit_logs'), wrap(async (req, res) => {
  const args = [req.user.clinic_id], w = ['(h.clinic_id=$1 or h.clinic_id is null)'], add = (sql, v) => { args.push(v); w.push(sql.replace('?', '$' + args.length)) }
  if (/^[0-9a-f-]{36}$/.test(req.query.patient || '')) add('h.patient_id=?', req.query.patient)
  if (/^[a-z_]{2,40}$/.test(req.query.tbl || '')) add('h.tbl=?', req.query.tbl)
  if (/^[\w-]{1,60}$/.test(req.query.row || '')) add('h.row_id=?', req.query.row)
  if (/^\d+$/.test(req.query.before || '')) add('h.id<?', req.query.before)
  if (/^\d{4}-\d{2}-\d{2}$/.test(req.query.from || '')) add("h.at>=?::date", req.query.from)
  if (req.query.op === 'DELETE' || req.query.op === 'UPDATE') add('h.op=?', req.query.op)
  if (req.query.motif === '1') w.push('h.reason is not null')
  const rows = (await q(`select h.*, p.last_name||' '||p.first_name patient, p.file_number from data_history h left join patients p on p.id=h.patient_id where ${w.join(' and ')} order by h.id desc limit ${Math.min(100, parseInt(req.query.limit) || 40)}`, args)).rows
  // champs chiffrés : rendus lisibles uniquement ici, pour les personnes qui ont accès au journal
  const { openJson: oj, openText: ot, EXAM_FIELDS: EF } = await import('./lib/protect.js')
  for (const r of rows) { const c = r.changes || {}
    try { if (c.data && Array.isArray(c.data)) { const [a, b] = c.data.map(v => { try { return oj(v) || {} } catch { return {} } }); delete c.data
        for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) if (JSON.stringify(a[k]) !== JSON.stringify(b[k])) c['data.' + k] = [a[k] ?? null, b[k] ?? null] }
      for (const k of EF) if (Array.isArray(c[k])) c[k] = c[k].map(v => { try { return ot(v) } catch { return '(chiffré)' } })
      if (c._supprime?.data) { try { c._supprime.data = oj(c._supprime.data) } catch {} } } catch {}
    r.changes = c }
  res.json(rows) }))
app.get('/api/audit', need('view_audit_logs'), wrap(async (req, res) => res.json((await q(
  `select a.id,a.action,a.table_name,a.record_id,a.details,host(a.ip) ip,a.created_at,a.user_id,concat(u.first_name,' ',u.last_name) who,u.role from audit_logs a left join users u on u.id=a.user_id where a.clinic_id=$1 and ($2::bigint is null or a.id < $2::bigint)
    and ($4::uuid is null or a.user_id=$4) and ($5::text is null or a.action like any(string_to_array($5, ','))) and ($6::date is null or a.created_at >= $6::date) and ($7::date is null or a.created_at < $7::date + 1)
    and ($8::text is null or a.action ilike '%'||$8||'%' or a.details::text ilike '%'||$8||'%' or concat(u.first_name,' ',u.last_name) ilike '%'||$8||'%') order by a.id desc limit $3`, [req.user.clinic_id, /^\d+$/.test(req.query.before || '') ? req.query.before : null, Math.min(200, Math.max(1, parseInt(req.query.limit) || 100)),
    /^[0-9a-f-]{36}$/.test(req.query.user || '') ? req.query.user : null, /^[A-Z_%,]+$/.test(req.query.actions || '') ? req.query.actions : null, /^\d{4}-\d{2}-\d{2}$/.test(req.query.from || '') ? req.query.from : null, /^\d{4}-\d{2}-\d{2}$/.test(req.query.to || '') ? req.query.to : null, clean(req.query.q, 60) || null])).rows)))

const D = { pool, q, need, auth, audit, fail, wrap, clean }; recovery(app, { ...D, pwProblem }); billing(app, D); tariffs(app, D); backups(app, D); clinical(app, D); stock(app, D); cash(app, D); planning(app, D); queue(app, D); intel(app, D); reports(app, D); documents(app, D); security(app, D); clinical2(app, D); requests(app, D); dossier(app, D)
app.post('/api/alerts/run', need('view_audit_logs'), wrap(async (req, res) => { await runAlerts(); res.json({ ok: true }) }))   // recalcul immédiat des notifications
// adresses du réseau local : les autres ordinateurs, tablettes et téléphones connectés au même Wi-Fi / réseau ouvrent l'une d'elles
// adresses utiles seulement : cartes virtuelles (VirtualBox, VMware, Hyper-V, WSL, Docker, Bluetooth) écartées, Wi-Fi en premier
const lanUrls = () => { const VIRT = /virtual|vbox|vmware|vethernet|hyper-v|wsl|docker|bluetooth|loopback|tailscale|zerotier/i
  return Object.entries(os.networkInterfaces()).flatMap(([name, l]) => (l || []).map(i => ({ ...i, name }))).filter(i => i.family === 'IPv4' && !i.internal && !/^169.254./.test(i.address) && !/^192.168.56./.test(i.address) && !VIRT.test(i.name))
    .sort((x, y) => /wi-?fi|wireless|wlan/i.test(y.name) - /wi-?fi|wireless|wlan/i.test(x.name)).map(i => 'http://' + i.address + ':' + config.port) }
app.get('/api/network', need(), (req, res) => { const host = os.hostname().replace(/\.local$/i, ''); const stable = `http://${host}:${config.port}`; res.json({ port: config.port, hosted: config.hosted, hostname: host, url_stable: config.hosted ? null : stable, urls: config.hosted ? (process.env.RAILWAY_PUBLIC_DOMAIN ? ['https://' + process.env.RAILWAY_PUBLIC_DOMAIN] : []) : [stable, ...lanUrls()], tip: config.hosted ? null : `Adresse qui ne change jamais : ${stable} (par nom d'ordinateur). Pour fixer l'IP, réservez celle de « ${host} » dans votre box/routeur (DHCP).`, firewall: `New-NetFirewallRule -DisplayName "DENTAL" -Direction Inbound -Protocol TCP -LocalPort ${config.port} -Action Allow -Profile Private,Domain` }) })
// matrice des rôles (qui voit quoi) : pour l'écran Utilisateurs
app.get('/api/roles', need('manage_users'), (req, res) => res.json({ roles: Object.fromEntries(Object.entries(ROLES).map(([k, v]) => [k, k === 'OWNER' ? ALL : v])) }))
app.use('/api', (req, res) => fail(res, 404, 'Route inconnue'))
app.use(express.static(config.frontendDir, { etag: true, setHeaders: (res, f) => { if (/.(js|css|html)$/.test(f)) res.setHeader('Cache-Control', 'no-cache') } }))   // l'interface est toujours revérifiée : jamais d'ancienne version affichée
app.use((err, req, res, next) => { console.error(err); err.status === 413 ? fail(res, 413, 'Fichier trop volumineux (10 Mo maximum)') : fail(res, 500, 'Erreur serveur') })
{ const c = await pool.connect()   // base embarquée : migrations + propriétaire appliqués automatiquement au démarrage
  try { await migrate(c, () => {}); if (process.env.OWNER_EMAIL && process.env.OWNER_PASSWORD) await ensureOwner(c, process.env.OWNER_EMAIL, process.env.OWNER_PASSWORD, () => {})
    // après la création de la clinique (premier démarrage) : sinon le réglage ne s'appliquerait qu'au démarrage suivant
    if (['true', 'false'].includes(process.env.REQUIRE_2FA)) await c.query('update clinics set require_2fa=$1', [process.env.REQUIRE_2FA === 'true']) } finally { c.release() } }
// redémarrage du serveur : toutes les sessions sont fermées, chacun doit se reconnecter (KEEP_SESSIONS=true pour garder les connexions)
if (process.env.KEEP_SESSIONS !== 'true') try { const r = await q('update user_sessions set revoked_at=now() where revoked_at is null'); if (r.rowCount) console.log('Sessions fermées au démarrage :', r.rowCount) } catch (e) { console.error('Sessions :', e.message) }
try { for (const u of (await q('select id,first_name,last_name from users where username is null')).rows) await q('update users set username=$2 where id=$1', [u.id, await makeUsername(u.first_name, u.last_name)]) } catch (e) { console.error('Noms d\'utilisateur :', e.message) }
try { const r = await protectExisting(q, config.storageDir); if (r.rows || r.files) console.log(`Données médicales chiffrées : ${r.rows} enregistrement(s), ${r.files} document(s)`) } catch (e) { console.error('Chiffrement des données :', e.message) }
try { const n = await ensureLogTriggers(); if (n) console.log('Journal des transactions activé sur', n, 'table(s)') } catch (e) { console.error('Journal des transactions :', e.message) }
if (!process.env.MOUNTED) {   // en service unique (MOUNTED=1), c'est src/index.js de BackendDental qui écoute
const server = app.listen(config.port, process.env.HOST || '0.0.0.0', () => { server.keepAliveTimeout = 65000; server.headersTimeout = 66000; console.log('DENTAL prêt sur le port', config.port); if (config.hosted) { const d = process.env.RAILWAY_PUBLIC_DOMAIN; console.log(d ? 'Adresse publique : https://' + d : 'Aucune adresse publique : Railway → service → Settings → Networking → Generate Domain (port ' + config.port + ')'); console.log(config.volume ? 'Données sur le volume : ' + config.volume : 'ATTENTION : aucun volume, les données seront effacées au prochain redéploiement'); return }
  const host = os.hostname().replace(/\.local$/i, ''); const stable = `http://${host}:${config.port}`
  console.log('Sur les autres postes du même réseau, ouvrez :')
  console.log('   ' + stable + '   ← adresse STABLE (ne change pas)')
  lanUrls().forEach(x => console.log('   ' + x + '   (adresse IP, selon le réseau)'))
  console.log("Astuce : pour une IP fixe, réservez celle de « " + host + " » dans votre box/routeur (DHCP).")
  console.log("(Si la page ne s'ouvre pas : autorisez le port " + config.port + " dans le pare-feu Windows — voir Utilisateurs → Accès réseau)") })
// port déjà occupé : message clair (souvent DENTAL tourne déjà dans une autre fenêtre)
server.on('error', e => { if (e.code === 'EADDRINUSE') { console.error(`\n✖ Le port ${config.port} est déjà utilisé.\n  DENTAL tourne probablement déjà dans une autre fenêtre : ouvrez http://localhost:${config.port}\n  Pour le relancer ici, fermez d'abord l'autre fenêtre (ou Ctrl+C dedans), puis refaites : npm start\n`); process.exit(1) } throw e })
}
// Sauvegardes « fichier embarqué » : uniquement en mode PGlite (bureau). En Postgres/Supabase
// (instance partagée), les sauvegardes sont gérées par l'hébergeur de la base.
if (process.env.NODE_ENV !== 'test' && !process.env.DATABASE_URL) { startScheduler(); startPlus() }   // sauvegarde automatique quotidienne
if ((process.env.NODE_ENV !== 'test' || process.env.CLOUD_TEST) && !process.env.DATABASE_URL) startCloud()   // sauvegarde en ligne vers Supabase (mode bureau)
if (process.env.NODE_ENV !== 'test') license.startLicense()   // contrôle en ligne de révocation / prolongation (si SAAS_URL)
if (process.env.NODE_ENV !== 'test') startIntel()   // moteur d'intelligence opérationnelle (arrière-plan, toutes les 30 minutes)
if (process.env.NODE_ENV !== 'test') startAlerts()   // notifications automatiques (toutes les 30 minutes)
let stopping = false
const shutdown = async sig => { if (stopping) return; stopping = true; console.log(`${sig} reçu : arrêt propre, fermeture de la base…`)
  const force = setTimeout(() => { console.error('Arrêt forcé après 8 s'); process.exit(1) }, 8000); force.unref()
  try { server.close(); server.closeIdleConnections?.(); server.closeAllConnections?.() } catch {}   // les onglets ouverts ne bloquent plus l'arrêt
  try { await pool.end() } catch (e) { console.error('Fermeture de la base :', e.message) }      // attend la requête en cours puis ferme proprement
  console.log('Base fermée proprement. À bientôt.'); process.exit(0) }
for (const sig of ['SIGTERM', 'SIGINT', 'SIGHUP', 'SIGBREAK']) process.on(sig, () => shutdown(sig))   // SIGHUP : fermeture de la fenêtre du terminal (Windows)
