import crypto from 'crypto'; import QRCode from 'qrcode'; import bcrypt from 'bcryptjs'
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567', adminish = u => u.role === 'OWNER' || u.role.startsWith('ADMIN')
export const sha = s => crypto.createHash('sha256').update(s).digest('hex')
const b32enc = b => { let bits = '', o = ''; for (const x of b) bits += x.toString(2).padStart(8, '0'); for (let i = 0; i < bits.length; i += 5) o += B32[parseInt(bits.slice(i, i + 5).padEnd(5, '0'), 2)]; return o }
const b32dec = s => { let bits = ''; for (const c of s) bits += B32.indexOf(c).toString(2).padStart(5, '0'); const o = []; for (let i = 0; i + 8 <= bits.length; i += 8) o.push(parseInt(bits.slice(i, i + 8), 2)); return Buffer.from(o) }
const hotp = (secret, step) => { const b = Buffer.alloc(8); b.writeBigUInt64BE(BigInt(step)); const h = crypto.createHmac('sha1', secret).update(b).digest(), o = h[19] & 15; return String((h.readUInt32BE(o) & 0x7fffffff) % 1e6).padStart(6, '0') }
const totpStep = (secret, code, last) => { const now = Math.floor(Date.now() / 30000); for (const d of [-1, 0, 1]) { const s = now + d, c = hotp(secret, s); if (s > last && crypto.timingSafeEqual(Buffer.from(c), Buffer.from(code))) return s } return null }
const key = () => crypto.createHash('sha256').update('dl-totp:' + process.env.JWT_SECRET).digest()
const enc = t => { const iv = crypto.randomBytes(12), c = crypto.createCipheriv('aes-256-gcm', key(), iv), ct = Buffer.concat([c.update(t, 'utf8'), c.final()]); return Buffer.concat([iv, c.getAuthTag(), ct]).toString('base64') }
const dec = s => { const b = Buffer.from(s, 'base64'), d = crypto.createDecipheriv('aes-256-gcm', key(), b.subarray(0, 12)); d.setAuthTag(b.subarray(12, 28)); return Buffer.concat([d.update(b.subarray(28)), d.final()]).toString('utf8') }
// notifications : seulement ce qui demande une attention (sécurité, échecs, décisions) ; le reste reste dans le journal d'activité
export const QUIET = ['user_role', '2fa_enabled', 'rate_changed']
export const notify = (q, clinic, kind, title, text, perm = 'view_audit_logs', userId = null) => QUIET.includes(kind) ? Promise.resolve() : q('insert into notifications(clinic_id,user_id,perm,kind,title,text) values($1,$2,$3,$4,$5,$6)', [clinic, userId, perm, kind, title, text]).catch(() => {})
// ── codes à usage unique : envoyés par e-mail, ou délivrés par la direction (fonctionnent sans Internet) ──
import { sendMail, deliver, resendReady } from '../lib/mail.js'
import { status as licenseStatus, fingerprint as hostFingerprint } from '../lib/license.js'
export const maskEmail = e => String(e || '').replace(/^(.{1,2})[^@]*(@.*)$/, (m, a, b) => a + '•••' + b)
export const mailCfg = async (q, clinicId) => { const s = (await q('select smtp from clinics where id=$1', [clinicId])).rows[0]?.smtp; return s?.host && s?.from ? { ...s, pass: s.pass_enc ? dec(s.pass_enc) : '' } : null }
const newCode = async (q, userId, kind, minutes, digits = 6, by = null) => { const code = String(crypto.randomInt(0, 10 ** digits)).padStart(digits, '0')
  await q("update login_codes set used_at=now() where user_id=$1 and kind=$2 and used_at is null", [userId, kind])
  await q('insert into login_codes(user_id,kind,code_hash,expires_at,created_by) values($1,$2,$3,now()+make_interval(mins=>$4),$5)', [userId, kind, sha(userId + ':' + code), minutes, by]); return code }
export async function sendEmailCode(q, u, kind = 'email') {
  const cfg = await mailCfg(q, u.clinic_id); if (!cfg && !resendReady() && !process.env.SAAS_URL) return { sent: false, reason: "Aucun serveur d'e-mail n'est configuré par la clinique" }
  const last = (await q("select created_at from login_codes where user_id=$1 and kind=$2 order by created_at desc limit 1", [u.id, kind])).rows[0]; if (last && Date.now() - new Date(last.created_at) < 30e3) return { sent: true, recent: true, to: maskEmail(u.email), wait: true }
  const code = await newCode(q, u.id, kind, 10)
  let relay = null; try { const ls = licenseStatus(); relay = { clinic_id: ls.clinic_id, fingerprint: hostFingerprint() } } catch {}
  try { await deliver({ cfg, relay, to: u.email, subject: `${code} — votre code de connexion DENTAL`, text: `Bonjour ${u.first_name},\n\nVotre code de connexion à usage unique : ${code}\nIl est valable 10 minutes et ne peut servir qu'une fois.\n\nSi vous n'êtes pas à l'origine de cette demande, ignorez ce message et prévenez la direction de la clinique.`,
      html: `<div style="font-family:Arial,sans-serif;max-width:480px;margin:auto;padding:24px;border:1px solid #e3e8ef;border-radius:14px"><h2 style="color:#0f2a5c;margin:0 0 8px">DENTAL</h2><p>Bonjour ${u.first_name},</p><p>Votre code de connexion à usage unique :</p><p style="font-size:32px;letter-spacing:8px;font-weight:bold;color:#1d6fd8;margin:12px 0">${code}</p><p style="color:#5b6778">Valable 10 minutes, utilisable une seule fois. Si vous n'êtes pas à l'origine de cette demande, ignorez ce message et prévenez la direction.</p></div>` })
    return { sent: true, to: maskEmail(u.email) } }
  catch (e) { await q("update login_codes set used_at=now() where user_id=$1 and kind=$2 and used_at is null", [u.id, kind]); return { sent: false, reason: e.message } } }
export async function verifyCode(q, u, code, kinds = ['email', 'owner']) { code = String(code || '').replace(/\s/g, ''); if (!/^\d{6,8}$/.test(code)) return false
  const r = (await q("select id,code_hash,attempts from login_codes where user_id=$1 and kind=any($2) and used_at is null and expires_at>now() order by created_at desc limit 3", [u.id, kinds])).rows
  for (const x of r) { if (x.attempts >= 5) continue; if (x.code_hash === sha(u.id + ':' + code)) { await q('update login_codes set used_at=now() where id=$1', [x.id]); return true } }
  if (r.length) await q('update login_codes set attempts=attempts+1 where id=any($1)', [r.map(x => x.id)]); return false }
export async function verifySecondFactor(q, u, code) {   // TOTP (usage unique par pas de 30 s) ou code de secours (usage unique)
  code = String(code || '').replace(/\s/g, ''); if (await verifyCode(q, u, code)) return true; if (!u.totp_secret_enc) return false
  if (/^\d{6}$/.test(code)) { const step = totpStep(b32dec(dec(u.totp_secret_enc)), code, Number(u.totp_last_step || 0)); return step !== null && (await q('update users set totp_last_step=$2 where id=$1 and coalesce(totp_last_step,0)<$2', [u.id, step])).rowCount === 1 }
  return (await q('update recovery_codes set used_at=now() where user_id=$1 and code_hash=$2 and used_at is null', [u.id, sha(code.toLowerCase())])).rowCount === 1 }
export default function (app, { q, pool, need, auth, audit, fail, wrap, clean }) {
  app.post('/api/2fa/setup', auth, wrap(async (req, res) => {
    if (req.user.must_change_password) return fail(res, 403, "Changez d'abord votre mot de passe"); if (req.user.totp_enabled) return fail(res, 409, 'Déjà activée')
    const secret = b32enc(crypto.randomBytes(20)); await q('update users set totp_pending_enc=$2 where id=$1', [req.user.id, enc(secret)])
    const uri = `otpauth://totp/DENTAL%20LIGHT:${encodeURIComponent(req.user.email)}?secret=${secret}&issuer=DENTAL%20LIGHT&digits=6&period=30`; res.json({ secret, uri, qr: await QRCode.toDataURL(uri) }) }))
  app.post('/api/2fa/enable', auth, wrap(async (req, res) => {
    const u = req.user; if (!u.totp_pending_enc) return fail(res, 400, "Démarrez d'abord la configuration"); const code = String(req.body.code || '').replace(/\s/g, '')
    const step = /^\d{6}$/.test(code) ? totpStep(b32dec(dec(u.totp_pending_enc)), code, 0) : null; if (step === null) return fail(res, 400, 'Code invalide')
    const codes = Array.from({ length: 8 }, () => { const h = crypto.randomBytes(5).toString('hex'); return h.slice(0, 5) + '-' + h.slice(5) })
    await q('update users set totp_secret_enc=totp_pending_enc, totp_pending_enc=null, totp_enabled=true, totp_last_step=$2 where id=$1', [u.id, step]); await q('delete from recovery_codes where user_id=$1', [u.id])
    for (const c of codes) await q('insert into recovery_codes(user_id,code_hash) values($1,$2)', [u.id, sha(c)])
    await audit(req, '2FA_ENABLED', 'users', u.id); await notify(q, u.clinic_id, '2fa_enabled', 'Double authentification activée', u.email); res.json({ recovery_codes: codes }) }))
  app.post('/api/2fa/disable', auth, wrap(async (req, res) => {
    const u = req.user; if (!u.totp_enabled) return fail(res, 409, 'Non activée'); if (adminish(u) && u.req2fa && !u.mfa_email) return fail(res, 409, 'La double authentification est imposée par la clinique pour votre rôle')
    if (!(await bcrypt.compare(req.body.password || '', u.password_hash)) || !(await verifySecondFactor(q, u, req.body.code))) return fail(res, 401, 'Mot de passe ou code invalide')
    await q('update users set totp_enabled=false, totp_secret_enc=null, totp_pending_enc=null where id=$1', [u.id]); await q('delete from recovery_codes where user_id=$1', [u.id])
    await audit(req, '2FA_DISABLED', 'users', u.id); await notify(q, u.clinic_id, '2fa_disabled', 'Double authentification désactivée', u.email); res.json({ ok: true }) }))
  app.post('/api/users/:id/reset-2fa', need('manage_users'), wrap(async (req, res) => {   // appareil perdu : réservé au propriétaire
    if (req.user.role !== 'OWNER') return fail(res, 403, 'Réservé au propriétaire')
    const t = /^[0-9a-f-]{36}$/.test(req.params.id) ? (await q('select * from users where id=$1 and clinic_id=$2', [req.params.id, req.user.clinic_id])).rows[0] : null; if (!t || t.role === 'OWNER') return fail(res, 403, 'Compte non concerné')
    await q('update users set totp_enabled=false, totp_secret_enc=null, totp_pending_enc=null, token_version=token_version+1 where id=$1', [t.id]); await q('delete from recovery_codes where user_id=$1', [t.id])
    await audit(req, '2FA_RESET', 'users', t.id); await notify(q, t.clinic_id, '2fa_reset', 'Double authentification réinitialisée', t.email); res.json({ ok: true }) }))
  // ── serveur d'e-mail de la clinique (propriétaire) ──
  app.get('/api/settings/mail', need(), wrap(async (req, res) => { if (req.user.role !== 'OWNER') return fail(res, 403, 'Réservé au propriétaire'); const s = (await q('select smtp from clinics where id=$1', [req.user.clinic_id])).rows[0]?.smtp || {}
    res.json({ host: s.host || '', port: s.port || 587, user: s.user || '', from: s.from || '', has_pass: !!s.pass_enc, configured: !!(s.host && s.from) }) }))
  app.put('/api/settings/mail', need(), wrap(async (req, res) => { if (req.user.role !== 'OWNER') return fail(res, 403, 'Réservé au propriétaire'); const b = req.body, cur = (await q('select smtp from clinics where id=$1', [req.user.clinic_id])).rows[0]?.smtp || {}
    const host = clean(b.host, 120), port = parseInt(b.port) || 587, from = clean(b.from, 120)?.toLowerCase(); if (!host || !/^[a-z0-9.-]+$/i.test(host)) return fail(res, 400, 'Serveur SMTP invalide (ex : smtp.gmail.com)'); if (![25, 465, 587, 2525].includes(port)) return fail(res, 400, 'Port SMTP : 465 (SSL) ou 587 (STARTTLS)'); if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(from || '')) return fail(res, 400, "Adresse d'expédition invalide")
    const s = { host, port, user: clean(b.user, 120) || '', from, pass_enc: b.pass ? enc(String(b.pass)) : cur.pass_enc }; await q('update clinics set smtp=$2 where id=$1', [req.user.clinic_id, s]); await audit(req, 'MAIL_SETTINGS', 'clinics', req.user.clinic_id, { host, port, from }); res.json({ ok: true }) }))
  app.post('/api/settings/mail/test', need(), wrap(async (req, res) => { if (req.user.role !== 'OWNER') return fail(res, 403, 'Réservé au propriétaire'); const cfg = await mailCfg(q, req.user.clinic_id); if (!cfg) return fail(res, 400, "Configurez d'abord le serveur d'e-mail")
    try { await sendMail({ ...cfg, to: req.user.email, subject: 'Test DENTAL : envoi des e-mails opérationnel', text: "Ce message confirme que DENTAL peut envoyer les codes de connexion par e-mail." }); res.json({ ok: true, to: req.user.email }) } catch (e) { fail(res, 502, e.message) } }))
  // ── double authentification par e-mail ──
  app.post('/api/2fa/email/start', auth, wrap(async (req, res) => { const r = await sendEmailCode(q, req.user, 'setup'); if (!r.sent) return fail(res, 400, r.reason); res.json(r) }))
  app.post('/api/2fa/email/confirm', auth, wrap(async (req, res) => { if (!(await verifyCode(q, req.user, req.body.code, ['setup']))) return fail(res, 400, 'Code invalide ou expiré')
    await q('update users set mfa_email=true where id=$1', [req.user.id]); await audit(req, 'MFA_EMAIL_ENABLED', 'users', req.user.id); res.json({ ok: true }) }))
  app.post('/api/2fa/email/disable', auth, wrap(async (req, res) => { if (!(await bcrypt.compare(req.body.password || '', req.user.password_hash))) return fail(res, 400, 'Mot de passe incorrect')
    if (adminish(req.user) && req.user.req2fa && !req.user.totp_enabled) return fail(res, 409, "La double authentification est obligatoire pour votre rôle : activez d'abord l'application d'authentification")
    await q('update users set mfa_email=false where id=$1', [req.user.id]); await audit(req, 'MFA_EMAIL_DISABLED', 'users', req.user.id); res.json({ ok: true }) }))
  // ── code d'accès à usage unique délivré par la direction (sans Internet : téléphone perdu, e-mail impossible) ──
  app.post('/api/users/:id/access-code', need('manage_users'), wrap(async (req, res) => {
    const t = /^[0-9a-f-]{36}$/.test(req.params.id) ? (await q('select * from users where id=$1 and clinic_id=$2', [req.params.id, req.user.clinic_id])).rows[0] : null; if (!t || t.role === 'OWNER' || t.id === req.user.id) return fail(res, 403, 'Compte non concerné')
    if (t.role.startsWith('ADMIN') && req.user.role !== 'OWNER') return fail(res, 403, 'Réservé au propriétaire'); if (!t.totp_enabled && !t.mfa_email) return fail(res, 409, "Ce compte n'utilise pas la double authentification : le mot de passe suffit")
    const code = await newCode(q, t.id, 'owner', 30, 8, req.user.id); await audit(req, 'ACCESS_CODE_ISSUED', 'users', t.id, { compte: `${t.first_name} ${t.last_name}`, validite: '30 min' })
    await notify(q, req.user.clinic_id, 'access_code', "Code d'accès délivré", `${t.email} (par ${req.user.email}) : code à usage unique valable 30 minutes`); res.json({ code, minutes: 30 }) }))
  app.get('/api/settings/security', need('manage_settings'), wrap(async (req, res) => res.json((await q('select inactivity_logout_minutes inactivity_minutes, require_2fa from clinics where id=$1', [req.user.clinic_id])).rows[0])))
  app.put('/api/settings/security', need('manage_settings'), wrap(async (req, res) => {
    if (req.user.role !== 'OWNER') return fail(res, 403, 'Réservé au propriétaire'); const m = parseInt(req.body.inactivity_minutes); if (!(m >= 1 && m <= 480) || typeof req.body.require_2fa !== 'boolean') return fail(res, 400, 'Paramètres invalides (1 à 480 minutes)')
    const old = (await q('select inactivity_logout_minutes m, require_2fa r from clinics where id=$1', [req.user.clinic_id])).rows[0]; await q('update clinics set inactivity_logout_minutes=$2, require_2fa=$3 where id=$1', [req.user.clinic_id, m, req.body.require_2fa])
    await audit(req, 'SECURITY_SETTINGS', 'clinics', req.user.clinic_id, { old, new: { m, r: req.body.require_2fa } }); await notify(q, req.user.clinic_id, 'security_settings', 'Paramètres de sécurité modifiés', `Inactivité : ${m} min · 2FA imposée : ${req.body.require_2fa ? 'oui' : 'non'}`); res.json({ ok: true }) }))
  app.get('/api/sessions', auth, wrap(async (req, res) => res.json((await q("select id,ip::text ip,user_agent,created_at,last_seen,(id=$2) current from user_sessions where user_id=$1 and revoked_at is null and last_seen>now()-($3::int*interval '1 minute') order by last_seen desc", [req.user.id, req.sid, req.user.idle])).rows)))
  app.post('/api/sessions/revoke-others', auth, wrap(async (req, res) => { const r = await q('update user_sessions set revoked_at=now() where user_id=$1 and id<>$2 and revoked_at is null', [req.user.id, req.sid]); await audit(req, 'SESSIONS_REVOKED', 'users', req.user.id); res.json({ revoked: r.rowCount }) }))
  app.post('/api/sessions/:id/revoke', auth, wrap(async (req, res) => { const r = /^[0-9a-f-]{36}$/.test(req.params.id) ? await q('update user_sessions set revoked_at=now() where id=$1 and user_id=$2 and revoked_at is null', [req.params.id, req.user.id]) : { rowCount: 0 }; r.rowCount ? res.json({ ok: true }) : fail(res, 404, 'Session introuvable') }))
  app.get('/api/login-history', need(), wrap(async (req, res) => {   // réservé à la direction (propriétaire, administrateurs, gestion des comptes, journal)
    if (!(adminish(req.user) || req.perms.has('view_audit_logs') || req.perms.has('manage_users'))) return fail(res, 403, 'Permission refusée')
    const all = req.query.all === '1' && (req.perms.has('view_audit_logs') || req.perms.has('manage_users'))
    res.json((await q(`select h.created_at,h.email,h.success,h.reason,h.ip::text ip,h.user_agent from login_history h where ${all ? 'h.clinic_id=$1' : 'h.user_id=$1'} order by h.id desc limit 200`, [all ? req.user.clinic_id : req.user.id])).rows) }))
  const VIS = "n.clinic_id=$1 and (n.user_id=$3 or (n.user_id is null and (n.perm is null or n.perm=any($2))))"
  app.get('/api/notifications', auth, wrap(async (req, res) => res.json((await q(`select n.id,n.kind,n.title,n.text,n.created_at,(r.user_id is null) unread from notifications n left join notification_reads r on r.notification_id=n.id and r.user_id=$3 where ${VIS} and n.kind <> all($4) order by n.created_at desc limit 50`, [req.user.clinic_id, [...req.perms], req.user.id, QUIET])).rows)))
  app.post('/api/notifications/read', auth, wrap(async (req, res) => { await q(`insert into notification_reads(notification_id,user_id) select n.id,$3 from notifications n where ${VIS}${/^[0-9a-f-]{36}$/i.test(req.body?.id || '') ? ' and n.id=$4' : ''} on conflict do nothing`, [req.user.clinic_id, [...req.perms], req.user.id, ...(/^[0-9a-f-]{36}$/i.test(req.body?.id || '') ? [req.body.id] : [])]); res.json({ ok: true }) }))   // une seule (id) ou toutes
}
