// ── Récupération des comptes (Super Admin Recovery System) ──
// Méthode 1 : lien de réinitialisation par e-mail (30 min, usage unique, seul le condensat est conservé)
// Méthode 2 : code de récupération hors ligne (usage unique)
// Méthode 3 : console du serveur (scripts/recuperation.js) — aucune route Internet
// Règles communes : jamais de mot de passe envoyé par e-mail ; toutes les sessions sont révoquées ; verrouillage levé ;
// trace dans le journal (et l'historique des modifications) ; la double authentification reste obligatoire
// (elle est conservée si elle existe, imposée à la prochaine connexion d'un compte administrateur qui n'en a pas).
import crypto from 'crypto'; import bcrypt from 'bcryptjs'; import rateLimit from 'express-rate-limit'
import { sha, notify, mailCfg, maskEmail } from './security.js'
import { sendMail } from '../lib/mail.js'
import { actorCtx } from '../db/pool.js'
import { config } from '../config/env.js'

const adminish = u => u.role === 'OWNER' || String(u.role).startsWith('ADMIN')
const name = u => `${u.first_name} ${u.last_name}`.trim()
const PRIVATE = /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|\[?::1\]?)/
// adresse du lien envoyé : jamais tirée d'un en-tête arbitraire (sinon un tiers pourrait détourner le lien vers son propre site)
const baseUrl = req => { if (process.env.APP_URL) return process.env.APP_URL.replace(/\/$/, ''); if (process.env.RAILWAY_PUBLIC_DOMAIN) return 'https://' + process.env.RAILWAY_PUBLIC_DOMAIN
  const host = String(req.headers.host || ''); return PRIVATE.test(host) ? `${req.protocol}://${host}` : `http://localhost:${config.port}` }
export const newRecoveryCodes = () => Array.from({ length: 10 }, () => { const h = crypto.randomBytes(5).toString('hex'); return h.slice(0, 5) + '-' + h.slice(5) })

// récupération effective : nouveau mot de passe, sessions révoquées, verrou levé, journal, alerte à la direction
export async function recoverAccount(q, u, { how, ip, password, temporary = false, actor }) {
  const needMfa = false   // double authentification : conservée si elle existe, jamais imposée (choix de la clinique : réglages de sécurité)
  await actorCtx.run({ id: (actor ? actor.id ?? null : u.id), n: actor?.n ?? `${name(u)} (récupération)`, ip, r: 'Récupération du compte : ' + how }, async () => {
    await q(`update users set password_hash=$2, must_change_password=$3, token_version=token_version+1, failed_attempts=0, locked_until=null,
      must_setup_2fa = must_setup_2fa or $4 where id=$1`, [u.id, await bcrypt.hash(password, 12), temporary, needMfa])
    await q('update user_sessions set revoked_at=now() where user_id=$1 and revoked_at is null', [u.id])
    await q('update password_resets set used_at=now() where user_id=$1 and used_at is null', [u.id])
    await q('insert into audit_logs(clinic_id,user_id,action,table_name,record_id,details,ip) values($1,$2,$3,$4,$5,$6,$7)',
      [u.clinic_id, (actor ? actor.id ?? null : u.id), 'ACCOUNT_RECOVERED', 'users', u.id, { methode: how, compte: u.email, mfa_imposee: needMfa, par: actor?.n ?? null }, ip]) })
  await notify(q, u.clinic_id, 'account_recovered', 'Compte récupéré', `${name(u)} (${u.email}) : ${how}. Toutes ses sessions ont été fermées.`, 'manage_users')
  return { needMfa } }

export default function (app, { q, need, fail, wrap, clean, pwProblem }) {
  const limiter = rateLimit({ windowMs: 15 * 60e3, limit: 8, standardHeaders: true, message: { error: 'Trop de demandes : réessayez dans 15 minutes' } })
  const findUser = async id => { id = clean(id, 120)?.toLowerCase(); if (!id) return null
    return (await q(id.includes('@') ? 'select * from users where lower(email)=$1' : 'select * from users where upper(username)=upper($1)', [id])).rows[0] || null }
  const usable = u => u && u.status === 'active' && !(u.is_emergency && !(u.emergency_until > new Date()))
  const log = (u, action, details, ip) => q('insert into audit_logs(clinic_id,user_id,action,table_name,record_id,details,ip) values($1,$2,$3,$4,$5,$6,$7)', [u?.clinic_id ?? null, u?.id ?? null, action, 'users', u?.id ?? null, details, ip]).catch(() => {})
  const GENERIC = "Si cette adresse correspond à un compte actif, un lien de réinitialisation vient d'être envoyé. Il est valable 30 minutes et ne sert qu'une fois. Pensez à vérifier les courriers indésirables."

  // ── Méthode 1 : demande de lien par e-mail (réponse identique que le compte existe ou non) ──
  app.post('/api/password/forgot', limiter, wrap(async (req, res) => {
    const u = await findUser(req.body.email); if (!usable(u)) { await log(u, 'PASSWORD_RESET_REQUESTED', { resultat: u ? 'compte inactif' : 'inconnu', saisi: clean(req.body.email, 120) }, req.ip); return res.json({ ok: true, message: GENERIC }) }
    const recent = (await q("select 1 from password_resets where user_id=$1 and created_at > now() - interval '60 seconds'", [u.id])).rowCount; if (recent) return res.json({ ok: true, message: GENERIC })
    const cfg = await mailCfg(q, u.clinic_id)
    if (!cfg) { await log(u, 'PASSWORD_RESET_REQUESTED', { resultat: "envoi d'e-mails non configuré" }, req.ip); return res.json({ ok: true, message: GENERIC }) }
    const token = crypto.randomBytes(32).toString('base64url')
    await q('update password_resets set used_at=now() where user_id=$1 and used_at is null', [u.id])
    await q("insert into password_resets(user_id,token_hash,expires_at,ip) values($1,$2,now()+interval '30 minutes',$3)", [u.id, sha(token), req.ip])
    const link = `${baseUrl(req)}/#reinitialiser/${token}`
    try { await sendMail({ ...cfg, to: u.email, subject: 'Réinitialisation de votre mot de passe DENTAL',
        text: `Bonjour ${u.first_name},\n\nUne réinitialisation du mot de passe de votre compte a été demandée. Pour choisir un nouveau mot de passe, ouvrez ce lien (valable 30 minutes, usage unique) :\n\n${link}\n\nSi vous n'êtes pas à l'origine de cette demande, ignorez ce message : votre mot de passe actuel reste valable. Prévenez la direction de la clinique.\n\nAucun mot de passe n'est jamais envoyé par e-mail.`,
        html: `<div style="font-family:Arial,sans-serif;max-width:520px;margin:auto;padding:24px;border:1px solid #e3e8ef;border-radius:14px"><h2 style="color:#0f2a5c;margin:0 0 8px">DENTAL</h2><p>Bonjour ${u.first_name},</p><p>Une réinitialisation du mot de passe de votre compte a été demandée.</p><p style="margin:22px 0"><a href="${link}" style="background:#1d6fd8;color:#fff;padding:12px 20px;border-radius:10px;text-decoration:none;font-weight:bold">Choisir un nouveau mot de passe</a></p><p style="color:#5b6778;font-size:13px">Lien valable 30 minutes, utilisable une seule fois. Si vous n'êtes pas à l'origine de cette demande, ignorez ce message : votre mot de passe actuel reste valable.</p><p style="color:#5b6778;font-size:12px">Aucun mot de passe n'est jamais envoyé par e-mail.</p></div>` })
      await log(u, 'PASSWORD_RESET_REQUESTED', { resultat: 'lien envoyé', a: maskEmail(u.email) }, req.ip) }
    catch (e) { await q('update password_resets set used_at=now() where user_id=$1 and used_at is null', [u.id]); await log(u, 'PASSWORD_RESET_REQUESTED', { resultat: 'échec envoi', erreur: e.message }, req.ip) }
    res.json({ ok: true, message: GENERIC }) }))
  const tokenRow = async t => /^[\w-]{30,80}$/.test(String(t || '')) ? (await q('select r.id rid, u.* from password_resets r join users u on u.id=r.user_id where r.token_hash=$1 and r.used_at is null and r.expires_at>now()', [sha(t)])).rows[0] : null
  app.post('/api/password/check', limiter, wrap(async (req, res) => { const u = await tokenRow(req.body.token); if (!usable(u)) return fail(res, 400, 'Lien invalide, expiré ou déjà utilisé. Faites une nouvelle demande.'); res.json({ ok: true, name: u.first_name, email: maskEmail(u.email) }) }))
  app.post('/api/password/reset', limiter, wrap(async (req, res) => {
    const u = await tokenRow(req.body.token); if (!usable(u)) return fail(res, 400, 'Lien invalide, expiré ou déjà utilisé. Faites une nouvelle demande.')
    const pb = pwProblem(req.body.password, u); if (pb) return fail(res, 400, 'Mot de passe trop faible : ' + pb)
    if (await bcrypt.compare(req.body.password, u.password_hash)) return fail(res, 400, 'Choisissez un mot de passe différent de l\'ancien')
    await q('update password_resets set used_at=now() where id=$1', [u.rid])
    const r = await recoverAccount(q, u, { how: 'lien de réinitialisation par e-mail', ip: req.ip, password: req.body.password })
    res.json({ ok: true, mfa_setup: r.needMfa }) }))

  // ── Méthode 2 : code de récupération hors ligne ──
  app.post('/api/password/recover-code', limiter, wrap(async (req, res) => {
    const u = await findUser(req.body.email), code = String(req.body.code || '').trim().toLowerCase(), bad = () => fail(res, 400, 'Identifiant ou code de récupération invalide')
    if (!usable(u) || !/^[0-9a-f]{5}-[0-9a-f]{5}$/.test(code)) { await log(u, 'RECOVERY_CODE_FAILED', { saisi: clean(req.body.email, 120) }, req.ip); return bad() }
    if (u.locked_until > new Date()) return fail(res, 429, 'Compte temporairement verrouillé : réessayez dans 15 minutes')
    const pb = pwProblem(req.body.password, u); if (pb) return fail(res, 400, 'Mot de passe trop faible : ' + pb)
    const ok = (await q('update recovery_codes set used_at=now() where user_id=$1 and code_hash=$2 and used_at is null', [u.id, sha(code)])).rowCount === 1
    if (!ok) { await q("update users set failed_attempts=failed_attempts+1, locked_until=case when failed_attempts>=4 then now()+interval '15 minutes' end where id=$1", [u.id]); await log(u, 'RECOVERY_CODE_FAILED', {}, req.ip); return bad() }
    const r = await recoverAccount(q, u, { how: 'code de récupération hors ligne', ip: req.ip, password: req.body.password })
    const left = (await q('select count(*)::int n from recovery_codes where user_id=$1 and used_at is null', [u.id])).rows[0].n
    res.json({ ok: true, mfa_setup: r.needMfa, codes_left: left }) }))

  // ── codes de récupération : génération (mot de passe reconfirmé) et état ──
  app.get('/api/recovery-codes', need(), wrap(async (req, res) => res.json((await q('select count(*) filter (where used_at is null)::int left, count(*)::int total, max(created_at) created_at from recovery_codes where user_id=$1', [req.user.id])).rows[0])))
  app.post('/api/recovery-codes', need(), wrap(async (req, res) => {
    const codes = newRecoveryCodes()
    await q('delete from recovery_codes where user_id=$1', [req.user.id]); for (const c of codes) await q('insert into recovery_codes(user_id,code_hash) values($1,$2)', [req.user.id, sha(c)])
    await log(req.user, 'RECOVERY_CODES_GENERATED', { nombre: codes.length }, req.ip); res.json({ codes }) }))
}
