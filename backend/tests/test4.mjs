import crypto from 'crypto'
const B = 'http://localhost:3999/api', B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
const dec = s => { let bits = ''; for (const c of s) bits += B32.indexOf(c).toString(2).padStart(5, '0'); const o = []; for (let i = 0; i + 8 <= bits.length; i += 8) o.push(parseInt(bits.slice(i, i + 8), 2)); return Buffer.from(o) }
const hotp = (sec, step) => { const b = Buffer.alloc(8); b.writeBigUInt64BE(BigInt(step)); const h = crypto.createHmac('sha1', sec).update(b).digest(), o = h[19] & 15; return String((h.readUInt32BE(o) & 0x7fffffff) % 1e6).padStart(6, '0') }
const step = () => Math.floor(Date.now() / 30000)
const mk = () => { let ck = ''; return async (m, p, b) => { const r = await fetch(B + p, { method: m, headers: { 'Content-Type': 'application/json', cookie: ck }, body: b ? JSON.stringify(b) : undefined }); const sc = r.headers.get('set-cookie'); if (sc) ck = sc.split(';')[0]; return { s: r.status, j: await r.json().catch(() => ({})) } } }
let ok = 0, ko = 0; const T = (n, c, x) => { c ? ok++ : ko++; console.log(c ? 'PASS' : 'FAIL', n, c ? '' : JSON.stringify(x)?.slice(0, 300)) }
const sleep = ms => new Promise(r => setTimeout(r, ms)), PW = 'NouveauMdp#2026a'
const o = mk(); await o('POST', '/login', { email: 'owner@test.com', password: PW })
let r = await o('PUT', '/settings/security', { inactivity_minutes: 0, require_2fa: true }); T('paramètre invalide refusé', r.s === 400, r)
r = await o('PUT', '/settings/security', { inactivity_minutes: 30, require_2fa: true }); T('2FA imposée aux administrateurs', r.s === 200, r)
r = await o('GET', '/patients'); T('propriétaire sans 2FA : accès bloqué', r.s === 403 && r.j.code === 'TWOFA_SETUP_REQUIRED', r)
T('/me indique la configuration à faire', (await o('GET', '/me')).j.needs_2fa_setup === true)
const setup = (await o('POST', '/2fa/setup', {})).j; T('QR code et clé générés', setup.qr?.startsWith('data:image/png') && setup.secret?.length >= 32 && setup.uri.startsWith('otpauth://totp/'), setup.uri)
r = await o('POST', '/2fa/enable', { code: '000000' }); T('mauvais code refusé à l\'activation', r.s === 400, r)
r = await o('POST', '/2fa/enable', { code: hotp(dec(setup.secret), step()) }); const rc = r.j.recovery_codes; T('2FA activée + 8 codes de secours', r.s === 200 && rc?.length === 8, r)
T('accès rétabli après activation', (await o('GET', '/patients')).s === 200)
r = await o('POST', '/2fa/disable', { password: PW, code: rc[7] }); T('désactivation refusée tant qu\'elle est imposée', r.s === 409, r)
// Connexion à deux étapes
let j = mk(); r = await j('POST', '/login', { email: 'owner@test.com', password: PW }); T('mot de passe correct → code demandé, pas de session', r.j.need_otp === true && !!r.j.challenge && (await j('GET', '/patients')).s === 401, r)
const ch = r.j.challenge; r = await j('POST', '/login/otp', { challenge: ch, code: '123456' }); T('mauvais code refusé', r.s === 401, r)
const good = hotp(dec(setup.secret), step() + 1); r = await j('POST', '/login/otp', { challenge: ch, code: good }); T('bon code → session', r.s === 200 && (await j('GET', '/patients')).s === 200, r)
let j2 = mk(); r = await j2('POST', '/login', { email: 'owner@test.com', password: PW }); r = await j2('POST', '/login/otp', { challenge: r.j.challenge, code: good }); T('code déjà utilisé refusé (anti-rejeu)', r.s === 401, r)
j2 = mk(); r = await j2('POST', '/login', { email: 'owner@test.com', password: PW }); const ch2 = r.j.challenge; r = await j2('POST', '/login/otp', { challenge: ch2, code: rc[0] }); T('code de secours accepté', r.s === 200, r)
j2 = mk(); r = await j2('POST', '/login', { email: 'owner@test.com', password: PW }); r = await j2('POST', '/login/otp', { challenge: r.j.challenge, code: rc[0] }); T('code de secours à usage unique', r.s === 401, r)
r = await mk()('POST', '/login/otp', { challenge: 'x.y.z', code: good }); T('défi falsifié refusé', r.s === 401)
// Verrouillage, alertes, historique
const lk = (await o('POST', '/users', { first_name: 'L', last_name: 'K', email: 'lock@test.com', role: 'SECRETARY' })).j
for (let i = 0; i < 5; i++) await mk()('POST', '/login', { email: 'lock@test.com', password: 'mauvais-Mdp-1' })
r = await mk()('POST', '/login', { email: 'lock@test.com', password: lk.temporary_password }); T('compte verrouillé après 5 échecs (même avec le bon mot de passe)', r.s === 429, r)
let nt = (await o('GET', '/notifications')).j; T('alerte : compte verrouillé', nt.some(n => n.kind === 'account_locked'), nt.map(n => n.kind))
const sec = (await o('GET', '/users')).j.find(u => u.email === 'sec2@test.com')
await o('POST', `/users/${sec.id}/permissions`, { perm: 'export_reports' }); nt = (await o('GET', '/notifications')).j; T('alerte : permission modifiée', nt.some(n => n.kind === 'permission_changed' && n.text.includes('sec2@test.com')), nt.map(n => n.kind))
T('alerte : double authentification activée', nt.some(n => n.kind === '2fa_enabled'))
const h = (await o('GET', '/login-history?all=1')).j; T('historique : échecs, OTP refusé, succès', ['bad_password', 'otp_failed', 'ok', 'locked'].every(x => h.some(e => e.reason === x)) && h[0].ip, [...new Set(h.map(e => e.reason))])
const s1 = mk(), s2 = mk(); await s1('POST', '/login', { email: 'sec2@test.com', password: 'SecretMdp#2026b' }); await s2('POST', '/login', { email: 'sec2@test.com', password: 'SecretMdp#2026b' })
const own = (await s1('GET', '/login-history?all=1')).j; T('historique : un utilisateur ne voit que ses connexions', own.length > 0 && own.every(e => e.email === 'sec2@test.com'), own.length)
let ss = (await s1('GET', '/sessions')).j; T('sessions actives listées (2, dont la courante)', ss.length >= 2 && ss.filter(x => x.current).length === 1, ss.length)
r = await s1('POST', '/sessions/revoke-others', {}); T('révocation des autres sessions', r.j.revoked >= 1 && (await s2('GET', '/me')).s === 401 && (await s1('GET', '/me')).s === 200, r)
T('seul le propriétaire réinitialise une 2FA', (await s1('POST', `/users/${sec.id}/reset-2fa`, {})).s === 403 && (await o('POST', `/users/${(await o('GET', '/me')).j.id}/reset-2fa`, {})).s === 403)
await o('POST', '/notifications/read', {}); T('notifications marquées lues', (await o('GET', '/notifications')).j.every(n => !n.unread))
// Hygiène & examen
const pid = (await o('GET', '/patients?q=Pierre')).j.rows[0].id
r = await o('POST', `/patients/${pid}/hygiene`, { toothpaste_brand: 'Colgate', fluoride: true, flosses: 'oui', brushing_frequency: '2 fois/jour', hack: 'x' }); T('hygiène enregistrée', r.s === 200, r)
let hy = (await o('GET', `/patients/${pid}/hygiene`)).j.data; T('hygiène : booléens stricts, champs inconnus ignorés', hy.fluoride === true && hy.flosses === false && hy.toothpaste_brand === 'Colgate' && !('hack' in hy), hy)
T('examen vide refusé', (await o('POST', `/patients/${pid}/exams`, {})).s === 400)
await o('POST', `/patients/${pid}/exams`, { head: 'RAS', tongue: 'saburrale', periodontium: 'gingivite légère' }); await o('POST', `/patients/${pid}/exams`, { observations: 'Contrôle' })
const ex = (await o('GET', `/patients/${pid}/exams`)).j; T('examens conservés avec historique (2) et médecin', ex.length === 2 && ex[1].doctor && ex[1].tongue === 'saburrale', ex)
const dr = mk(); await dr('POST', '/login', { email: 'dr2@test.com', password: 'DocteurMdp#2026c' }); const sc = mk(); await sc('POST', '/login', { email: 'sec2@test.com', password: 'SecretMdp#2026b' })
T('secrétaire : pas d\'accès aux examens', (await sc('GET', `/patients/${pid}/exams`)).s === 403); T('médecin non assigné : accès refusé', (await dr('GET', `/patients/${pid}/hygiene`)).s === 404)
// Demandes d'achat
const sm = (await o('POST', '/users', { first_name: 'Stock', last_name: 'Mgr', email: 'stock@test.com', role: 'STOCK_MANAGER' })).j, st = mk(); await st('POST', '/login', { email: 'stock@test.com', password: sm.temporary_password }); await st('POST', '/change-password', { current: sm.temporary_password, next: 'StockMdp#2026d' })
const stock0 = (await o('GET', '/products')).j.find(p => p.ref === 'RES-1').stock
T('demande avec produit inconnu refusée', (await st('POST', '/purchase-requests', { items: [{ product: 'INCONNU', qty: '1' }] })).s === 400); T('quantité nulle refusée', (await st('POST', '/purchase-requests', { items: [{ product: 'RES-1', qty: '0' }] })).s === 400)
r = await st('POST', '/purchase-requests', { note: 'Rupture imminente', items: [{ product: 'RES-1', qty: '20', est_unit_price: '110' }] }); const rq = r.j.id; T('demande créée par le responsable stock', r.s === 200 && rq, r)
T('responsable stock : ne peut pas approuver', (await st('POST', `/purchase-requests/${rq}/approve`, {})).s === 403)
T('alerte propriétaire : demande en attente', (await o('GET', '/dashboard/owner')).j.alerts.some(a => a.title.includes("Demandes d'achat")) && (await o('GET', '/notifications')).j.some(n => n.kind === 'purchase_request'))
T('modification par l\'approbateur', (await o('POST', `/purchase-requests/${rq}/modify`, { items: [{ product: 'RES-1', qty: '25', est_unit_price: '110' }] })).s === 200 && (await o('GET', '/purchase-requests')).j.find(x => x.id === rq).items.includes('×25'))
T('commande impossible avant approbation', (await o('POST', `/purchase-requests/${rq}/order`, { currency: 'HTG' })).s === 409)
T('approbation', (await o('POST', `/purchase-requests/${rq}/approve`, {})).s === 200); T('modification impossible après décision', (await o('POST', `/purchase-requests/${rq}/modify`, { items: [{ product: 'RES-1', qty: '1' }] })).s === 409)
T('responsable stock : ne peut pas commander', (await st('POST', `/purchase-requests/${rq}/order`, { currency: 'HTG' })).s === 403)
r = await o('POST', `/purchase-requests/${rq}/order`, { currency: 'HTG' }); T('commande créée', r.s === 200 && r.j.purchase_id, r)
T('commande unique', (await o('POST', `/purchase-requests/${rq}/order`, { currency: 'HTG' })).s === 409)
T('la commande n\'augmente pas le stock', (await o('GET', '/products')).j.find(p => p.ref === 'RES-1').stock === stock0)
await o('POST', `/purchases/${r.j.purchase_id}/receive`, {}); T('la réception augmente le stock (+25)', Number((await o('GET', '/products')).j.find(p => p.ref === 'RES-1').stock) === Number(stock0) + 25)
const r2 = (await st('POST', '/purchase-requests', { items: [{ product: 'RES-1', qty: '5' }] })).j.id
T('refus sans motif impossible', (await o('POST', `/purchase-requests/${r2}/reject`, {})).s === 400); T('refus avec motif', (await o('POST', `/purchase-requests/${r2}/reject`, { note: 'Stock suffisant' })).s === 200)
T('commande impossible après refus', (await o('POST', `/purchase-requests/${r2}/order`, { currency: 'HTG' })).s === 409); T('le demandeur est notifié du refus', (await st('GET', '/notifications')).j.some(n => n.kind === 'purchase_request_decision' && n.text === 'Stock suffisant'))
// Séparation des tâches (administrateur)
await o('PUT', '/settings/security', { inactivity_minutes: 30, require_2fa: false }); const ad = (await o('POST', '/users', { first_name: 'Ad', last_name: 'Min', email: 'adm@test.com', role: 'ADMIN' })).j, am = mk()
await am('POST', '/login', { email: 'adm@test.com', password: ad.temporary_password }); await am('POST', '/change-password', { current: ad.temporary_password, next: 'AdminMdp#2026e' })
const r3 = (await am('POST', '/purchase-requests', { items: [{ product: 'RES-1', qty: '2' }] })).j.id; T('administrateur : ne peut pas approuver sa propre demande', (await am('POST', `/purchase-requests/${r3}/approve`, {})).s === 403)
T('le propriétaire peut l\'approuver', (await o('POST', `/purchase-requests/${r3}/approve`, {})).s === 200); T('paramètres de sécurité : réservés au propriétaire', (await am('PUT', '/settings/security', { inactivity_minutes: 30, require_2fa: false })).s === 403)
T('alerte : administrateur créé', (await o('GET', '/notifications')).j.some(n => n.kind === 'admin_created'))
// Déconnexion automatique (inactivité)
await o('PUT', '/settings/security', { inactivity_minutes: 1, require_2fa: false }); const idle = mk(); await idle('POST', '/login', { email: 'sec2@test.com', password: 'SecretMdp#2026b' }); T('session active juste après connexion', (await idle('GET', '/me')).s === 200)
for (let i = 0; i < 4; i++) { await sleep(16000); await o('GET', '/me') }
r = await idle('GET', '/me'); T('déconnexion automatique après 1 min d\'inactivité', r.s === 401 && r.j.code === 'IDLE_TIMEOUT', r)
T('la session active du propriétaire n\'est pas coupée', (await o('GET', '/me')).s === 200); await o('PUT', '/settings/security', { inactivity_minutes: 30, require_2fa: true })
console.log(`\n${ok} réussis, ${ko} échoués`)
