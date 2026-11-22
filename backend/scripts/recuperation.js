// ─────────────────────────────────────────────────────────────────────────────
// DENTAL — RÉCUPÉRATION D'URGENCE EN CONSOLE (méthode 3, dernier recours)
// À lancer SUR L'ORDINATEUR DU SERVEUR (ou en SSH protégé), serveur ARRÊTÉ. Aucune route Internet.
//
//   npm run recuperation                               liste les comptes administrateurs et leur état
//   npm run recuperation -- debloquer   <e-mail|identifiant>   lève le verrouillage (et un blocage manuel)
//   npm run recuperation -- reinitialiser <e-mail|identifiant> mot de passe temporaire affiché UNE fois
//   npm run recuperation -- codes       <e-mail|identifiant>   nouveaux codes de récupération hors ligne
//   npm run recuperation -- secours-creer <e-mail> [Prénom Nom] crée le compte propriétaire de secours (désactivé)
//   npm run recuperation -- secours-activer                    l'active 24 h avec un mot de passe temporaire
//   npm run recuperation -- secours-desactiver                 le désactive et ferme ses sessions
//
// Chaque action ferme les sessions concernées, est inscrite au journal d'activité et dans l'historique des
// modifications (auteur : « Console du serveur »), et la double authentification reste obligatoire.
// ─────────────────────────────────────────────────────────────────────────────
import crypto from 'crypto'; import os from 'os'; import bcrypt from 'bcryptjs'
import { config } from '../src/config/env.js'

const [cmd = 'lister', who, ...rest] = process.argv.slice(2)
try { if ((await fetch(`http://localhost:${config.port}/api/health`, { signal: AbortSignal.timeout(1500) })).ok) { console.error(`\n✖ Le serveur tourne encore (port ${config.port}). Arrêtez-le (Ctrl+C dans sa fenêtre), puis relancez cette commande.\n`); process.exit(1) } } catch {}

const { pool, q, actorCtx } = await import('../src/db/pool.js'), { migrate } = await import('../src/db/migrate.js'), { recoverAccount, newRecoveryCodes } = await import('../src/routes/recovery.js'), { sha, notify } = await import('../src/routes/security.js')
{ const c = await pool.connect(); try { await migrate(c, () => {}) } finally { c.release() } }
const ACTOR = { n: `Console du serveur (${os.userInfo().username}@${os.hostname()})`, ip: 'console' }
const tmpPw = () => { for (;;) { const p = 'Rc-' + crypto.randomBytes(9).toString('base64url') + '#' + crypto.randomInt(10, 99) + 'aZ'; if (/[a-z]/.test(p) && /[A-Z]/.test(p) && /\d/.test(p)) return p } }
const find = async id => { id = String(id || '').trim().toLowerCase(); if (!id) return null; return (await q(id.includes('@') ? 'select * from users where lower(email)=$1' : 'select * from users where upper(username)=upper($1)', [id])).rows[0] || null }
const log = (u, action, details) => actorCtx.run({ ...ACTOR, r: 'Récupération en console : ' + action }, () => q('insert into audit_logs(clinic_id,user_id,action,table_name,record_id,details,ip) values($1,null,$2,$3,$4,$5,null)', [u.clinic_id, action, 'users', u.id, { via: 'console', poste: ACTOR.n, compte: u.email, ...details }]))
const run = (r, f) => actorCtx.run({ ...ACTOR, r }, f)
const need = async () => { const u = await find(who); if (!u) { console.error(`\n✖ Aucun compte « ${who || ''} ». Lancez « npm run recuperation » pour voir la liste.\n`); process.exit(1) } return u }
const fdt = d => d ? new Date(d).toLocaleString('fr-FR', { timeZone: 'America/Port-au-Prince' }) : '—'
const ROLE = { OWNER: 'Propriétaire', ADMIN: 'Administrateur', ADMIN_MEDICAL: 'Admin. médical', ADMIN_FINANCIER: 'Admin. financier' }

if (cmd === 'lister' || cmd === 'aide') {
  const rows = (await q(`select u.*, (select count(*) from recovery_codes r where r.user_id=u.id and r.used_at is null)::int codes from users u where u.role in ('OWNER','ADMIN','ADMIN_MEDICAL','ADMIN_FINANCIER') or u.is_emergency order by u.is_emergency, u.role, u.created_at`)).rows
  console.log('\nComptes administrateurs :\n')
  for (const u of rows) { const locked = u.locked_until > new Date()
    console.log(`  ${u.is_emergency ? '[SECOURS] ' : ''}${u.first_name} ${u.last_name} — ${u.email}${u.username ? ' / ' + u.username : ''}`)
    console.log(`     ${ROLE[u.role] || u.role} · état : ${u.status === 'active' ? (locked ? 'VERROUILLÉ jusqu\'à ' + fdt(u.locked_until) : 'actif') : u.status === 'blocked' ? 'BLOQUÉ' : 'désactivé'}${u.is_emergency ? ' · activé jusqu\'au ' + fdt(u.emergency_until) : ''}`)
    console.log(`     double authentification : ${u.totp_enabled ? 'application' : u.mfa_email ? 'e-mail' : 'AUCUNE'} · codes de récupération : ${u.codes} · essais échoués : ${u.failed_attempts} · dernière connexion : ${fdt(u.last_login_at)}\n`) }
  console.log('Commandes : debloquer · reinitialiser · codes · secours-creer · secours-activer · secours-desactiver  (voir l\'en-tête de scripts/recuperation.js)\n')
}
else if (cmd === 'debloquer') { const u = await need()
  await run('Déblocage du compte', () => q("update users set failed_attempts=0, locked_until=null, status=case when status='blocked' then 'active' else status end where id=$1", [u.id]))
  await log(u, 'ACCOUNT_UNLOCKED', { avant: { statut: u.status, verrou: u.locked_until } }); await notify(q, u.clinic_id, 'account_recovered', 'Compte débloqué en console', `${u.first_name} ${u.last_name} (${u.email}) a été débloqué depuis la console du serveur.`, 'manage_users')
  console.log(`\n✔ Compte débloqué : ${u.email}${u.status === 'disabled' ? '\n  (attention : il est DÉSACTIVÉ — réactivez-le dans Utilisateurs)' : ''}\n  Le mot de passe n'a pas changé. Mot de passe oublié ? → npm run recuperation -- reinitialiser ${u.email}\n`) }
else if (cmd === 'reinitialiser') { const u = await need(), pw = tmpPw()
  if (u.status === 'blocked') await run('Déblocage du compte', () => q("update users set status='active' where id=$1", [u.id]))
  const r = await recoverAccount(q, u, { how: 'console du serveur (mot de passe temporaire)', ip: null, password: pw, temporary: true, actor: ACTOR })
  console.log(`\n✔ Mot de passe réinitialisé pour ${u.email}\n\n     Mot de passe temporaire :  ${pw}\n\n  Il n'est affiché qu'ici : notez-le, il devra être changé à la première connexion.\n  Toutes les sessions de ce compte sont fermées.\n`) }
else if (cmd === 'codes') { const u = await need(), codes = newRecoveryCodes()
  await run('Nouveaux codes de récupération', async () => { await q('delete from recovery_codes where user_id=$1', [u.id]); for (const c of codes) await q('insert into recovery_codes(user_id,code_hash) values($1,$2)', [u.id, sha(c)]) })
  await log(u, 'RECOVERY_CODES_GENERATED', { nombre: codes.length })
  console.log(`\n✔ Nouveaux codes de récupération pour ${u.email} (les anciens ne marchent plus) :\n\n${codes.map(c => '     ' + c).join('\n')}\n\n  Chaque code ne sert qu'une fois. Gardez-les HORS de cet ordinateur (papier dans un coffre, clé USB rangée).\n`) }
else if (cmd === 'secours-creer') {
  const email = String(who || '').trim().toLowerCase(); if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) { console.error('\n✖ Indiquez une adresse e-mail valide, distincte du compte principal.\n'); process.exit(1) }
  if ((await q('select 1 from users where is_emergency')).rowCount) { console.error('\n✖ Un compte de secours existe déjà (npm run recuperation pour le voir).\n'); process.exit(1) }
  if ((await q('select 1 from users where lower(email)=$1', [email])).rowCount) { console.error('\n✖ Cette adresse est déjà utilisée par un autre compte.\n'); process.exit(1) }
  const cl = (await q('select id from clinics order by created_at limit 1')).rows[0], [fn = 'Secours', ...ln] = rest
  const hash = await bcrypt.hash(crypto.randomBytes(32).toString('hex'), 12)
  await run('Création du compte de secours', () => q("insert into users(clinic_id,email,password_hash,first_name,last_name,role,status,must_change_password,is_emergency,must_setup_2fa,job_title) values($1,$2,$3,$4,$5,'OWNER','disabled',true,true,false,'Compte de secours')",
    [cl.id, email, hash, fn, ln.join(' ') || 'Direction']))
  const u = await find(email); await log(u, 'EMERGENCY_ACCOUNT_CREATED', {})
  console.log(`\n✔ Compte propriétaire de secours créé : ${email} (DÉSACTIVÉ)\n  Il ne peut servir qu'après « npm run recuperation -- secours-activer », pour 24 heures au plus,\n  avec un mot de passe temporaire.\n`) }
else if (cmd === 'secours-activer') { const u = (await q('select * from users where is_emergency')).rows[0]; if (!u) { console.error('\n✖ Aucun compte de secours : npm run recuperation -- secours-creer <e-mail>\n'); process.exit(1) }
  const pw = tmpPw()
  await run('Activation du compte de secours', () => q("update users set status='active', emergency_until=now()+interval '24 hours' where id=$1", [u.id]))
  await recoverAccount(q, { ...u, status: 'active' }, { how: 'activation du compte de secours en console', ip: null, password: pw, temporary: true, actor: ACTOR })
    await log(u, 'EMERGENCY_ACCOUNT_ACTIVATED', { duree: '24 h' }); await notify(q, u.clinic_id, 'account_recovered', 'Compte de secours ACTIVÉ', `Le compte de secours ${u.email} a été activé depuis la console du serveur pour 24 heures.`, 'manage_users')
  console.log(`\n✔ Compte de secours ACTIVÉ pour 24 heures : ${u.email}\n\n     Mot de passe temporaire :  ${pw}\n\n  À changer à la première connexion.\n  Après usage : npm run recuperation -- secours-desactiver\n`) }
else if (cmd === 'secours-desactiver') { const u = (await q('select * from users where is_emergency')).rows[0]; if (!u) { console.error('\n✖ Aucun compte de secours.\n'); process.exit(1) }
  await run('Désactivation du compte de secours', async () => { await q("update users set status='disabled', emergency_until=null, token_version=token_version+1 where id=$1", [u.id]); await q('update user_sessions set revoked_at=now() where user_id=$1 and revoked_at is null', [u.id]) })
  await log(u, 'EMERGENCY_ACCOUNT_DISABLED', {}); console.log(`\n✔ Compte de secours désactivé et sessions fermées : ${u.email}\n`) }
else { console.error(`\n✖ Commande inconnue « ${cmd} ». Commandes : lister · debloquer · reinitialiser · codes · secours-creer · secours-activer · secours-desactiver\n`); process.exit(1) }
await pool.end(); process.exit(0)
