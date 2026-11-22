// ─────────────────────────────────────────────────────────────────────────────
// DENTAL — CLINIQUE DE DÉMONSTRATION
//   npm run demo            → démarre la démo (la crée au premier lancement)
//   npm run demo -- --reset → efface la démo et la recrée
//   npm run demo -- --ici   → AJOUTE les données fictives dans la VRAIE plateforme (serveur arrêté ;
//                             copie complète de la base avant, sauvegarde complète après, patients marqués « fictif »)
//
// Base SÉPARÉE (backend/demo-data/) : la base réelle de la clinique n'est jamais ouverte ni modifiée,
// la synchronisation Supabase est coupée. Toutes les personnes et tous les actes sont FICTIFS.
// Les données passent par l'API de l'application (mêmes règles que l'utilisation réelle : factures,
// caisse, commissions, schéma dentaire, file d'attente…), puis l'historique est réparti sur 18 mois.
// Prix des actes : ceux du barème de base (Prophylaxie 3 000, Restauration 2 000, Extraction simple 2 000 HTG) ;
// les actes sans tarif configuré (endodontie, extraction chirurgicale, prothèses) sont enregistrés sans facture.
// ─────────────────────────────────────────────────────────────────────────────
import { spawn } from 'child_process'; import crypto from 'crypto'; import fs from 'fs'; import path from 'path'; import { fileURLToPath } from 'url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'), INTO = process.argv.includes('--ici'), DIR = process.env.DEMO_DIR ? path.resolve(process.env.DEMO_DIR) : path.join(ROOT, 'demo-data')
const PORT = Number(process.env.DEMO_PORT || (INTO ? 3101 : 3100)), PW = 'Sourire#Demo-4827', OWNER = 'direction@demo.dental'
if (!INTO && process.argv.includes('--reset')) { fs.rmSync(DIR, { recursive: true, force: true }); console.log('Démo effacée.') }
fs.mkdirSync(DIR, { recursive: true })
const SECRET_F = path.join(DIR, 'secret.txt'); if (!fs.existsSync(SECRET_F)) fs.writeFileSync(SECRET_F, crypto.randomBytes(48).toString('hex'))
const READY = path.join(DIR, 'pret.txt'), fresh = INTO || !fs.existsSync(READY), TMP = 'Temp#Demo-' + crypto.randomBytes(4).toString('hex')
const env = { ...process.env, DB_DIR: path.join(DIR, 'db'), STORAGE_DIR: path.join(DIR, 'storage'), BACKUP_DIR: path.join(DIR, 'backups'), PORT: String(PORT),
  OWNER_EMAIL: OWNER, OWNER_PASSWORD: TMP, REQUIRE_2FA: 'false', JWT_SECRET: fs.readFileSync(SECRET_F, 'utf8').trim(),
  SUPABASE_DB_URL: '', SUPABASE_URL: '', SUPABASE_SERVICE_KEY: '', SUPABASE_SYNC: 'off', SMTP_HOST: '', SMTP_USER: '', SMTP_PASS: '' }
// vraie plateforme : mêmes réglages que « npm start » (fichier .env), seul le port change pendant l'injection
let REAL = null, TEMP = null
if (INTO) { const { config } = await import('../src/config/env.js'); REAL = { db: config.dbDir, port: config.port }
  for (const k of Object.keys(env)) delete env[k]; Object.assign(env, process.env, { PORT: String(PORT) })
  try { if ((await fetch(`http://localhost:${REAL.port}/api/health`)).ok) { console.error(`Le serveur de la clinique tourne encore (port ${REAL.port}). Arrêtez-le (Ctrl+C) puis relancez : npm run demo -- --ici`); process.exit(1) } } catch {}
  if (!fs.existsSync(REAL.db)) { console.error('Base introuvable : ' + REAL.db); process.exit(1) }
  env.DB_DIR = REAL.db }
let srv; process.on('exit', () => { try { srv?.kill() } catch {} })
const start = async (quiet = true) => { srv = spawn(process.execPath, [path.join(ROOT, 'src/server.js')], { env, stdio: quiet ? 'ignore' : 'inherit' })
  for (let i = 0; i < 160; i++) { try { if ((await fetch(`http://localhost:${PORT}/api/health`)).ok) return } catch {} await new Promise(r => setTimeout(r, 250)) } throw new Error('Le serveur de démo ne démarre pas (port ' + PORT + ' occupé ?)') }
const stop = () => new Promise(r => { srv.on('exit', r); srv.kill('SIGTERM') })

if (fresh) {
  if (INTO) {   // copie intégrale de la base AVANT toute écriture, puis compte technique temporaire pour l'import
    const ts = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-'); REAL.copy = REAL.db + '.avant-demo-' + ts
    console.log('Copie de sécurité de la base →', REAL.copy); fs.cpSync(REAL.db, REAL.copy, { recursive: true })
    const { PGlite } = await import('@electric-sql/pglite'), bcrypt = (await import('bcryptjs')).default, db0 = new PGlite(REAL.db)
    const cid = (await db0.query('select id from clinics order by created_at limit 1')).rows[0]?.id; if (!cid) { console.error('Aucune clinique dans la base.'); process.exit(1) }
    TEMP = { email: 'import-demo-' + crypto.randomBytes(3).toString('hex') + '@dental.local', pw: 'Imp#' + crypto.randomBytes(12).toString('base64url') }
    TEMP.id = (await db0.query("insert into users(clinic_id,email,password_hash,first_name,last_name,role,must_change_password) values($1,$2,$3,'Import','données de démonstration','ADMIN',false) returning id", [cid, TEMP.email, await bcrypt.hash(TEMP.pw, 12)])).rows[0].id
    await db0.close(); console.log('Ajout des données fictives dans la plateforme… (1 à 3 minutes)') }
  else { console.log('Création de la clinique de démonstration… (1 à 3 minutes)'); fs.rmSync(path.join(DIR, 'db'), { recursive: true, force: true }) }
  await start()
  // ── outils ──
  let seed = 20261120; const rnd = () => { seed = (seed + 0x6D2B79F5) | 0; let t = seed; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296 }
  const pick = a => a[Math.floor(rnd() * a.length)], chance = p => rnd() < p, int = (a, b) => a + Math.floor(rnd() * (b - a + 1))
  const B = `http://localhost:${PORT}/api`, mk = () => { let ck = ''; return async (m, p, b, ok = false) => { const r = await fetch(B + p, { method: m, headers: { 'Content-Type': 'application/json', cookie: ck, ...(GPW ? { 'x-confirm-password': encodeURIComponent(GPW), 'x-motif': encodeURIComponent('Données de démonstration (fictives)') } : {}) }, body: b ? JSON.stringify(b) : undefined }); const sc = r.headers.get('set-cookie'); if (sc) ck = sc.split(';')[0]; const j = await r.json().catch(() => ({})); if (r.status >= 400 && !ok) throw new Error(`${m} ${p} → ${r.status} ${j.error || ''}`); return r.status >= 400 ? null : j } }
  const api = mk(), stats = { erreurs: 0 }, cnt = k => { stats[k] = (stats[k] || 0) + 1 }, soft = async f => { try { return await f() } catch (e) { stats.erreurs++; const k = e.message.replace(/[0-9a-f-]{36}/g, ':id'); (stats.why ||= {})[k] = (stats.why[k] || 0) + 1; return null } }
  const TZ = 'America/Port-au-Prince', DAY = 864e5, now = Date.now()
  const ymd = t => new Date(t).toLocaleDateString('en-CA', { timeZone: TZ })
  const at = (day, h, m = 0) => { let t = Date.UTC(+day.slice(0, 4), +day.slice(5, 7) - 1, +day.slice(8, 10), h + 5, m); const lh = +new Date(t).toLocaleString('en-GB', { timeZone: TZ, hour: '2-digit', hour12: false }); if (lh !== h) t -= (lh - h) * 36e5; return t }
  const wd = t => new Date(at(ymd(t), 12)).getUTCDay(), workday = t => { const d = wd(t); return d >= 1 && d <= 6 }
  let GPW = ''   // mot de passe reconfirmé pour les actions protégées (comptes, paie…)
  const BACK = []   // dates à appliquer après coup : { kind, id, t }

  // ── direction et équipe ──
  if (INTO) { await api('POST', '/login', { email: TEMP.email, password: TEMP.pw }); GPW = TEMP.pw }
  else { await api('POST', '/login', { email: OWNER, password: TMP }); await api('POST', '/change-password', { current: TMP, next: PW }); GPW = PW; await api('POST', '/profile', { phone: '37000000' }, true) }
  const STAFF = [
    { first_name: 'Nadège', last_name: 'Pierre-Louis', email: 'n.pierrelouis@demo.dental', role: 'DENTIST', pay_type: 'pourcentage', commission_pct: '40', job_title: 'Chirurgienne-dentiste' },
    { first_name: 'Wilner', last_name: 'Saint-Fleur', email: 'w.saintfleur@demo.dental', role: 'DENTIST', pay_type: 'mixte', base_salary: '20000', commission_pct: '25', job_title: 'Chirurgien-dentiste' },
    { first_name: 'Carline', last_name: 'Augustin', email: 'c.augustin@demo.dental', role: 'DENTIST', pay_type: 'pourcentage', commission_pct: '35', job_title: 'Orthodontiste' },
    { first_name: 'Mirlande', last_name: 'Joseph', email: 'm.joseph@demo.dental', role: 'DENTAL_ASSISTANT', pay_type: 'fixe', base_salary: '18000', job_title: 'Assistante dentaire' },
    { first_name: 'Rose-Marie', last_name: 'Étienne', email: 'r.etienne@demo.dental', role: 'SECRETARY', pay_type: 'fixe', base_salary: '16000', job_title: 'Secrétaire-réceptionniste' },
    { first_name: 'Jacques', last_name: 'Délva', email: 'j.delva@demo.dental', role: 'ACCOUNTANT', pay_type: 'fixe', base_salary: '22000', job_title: 'Comptable' }]
  const accounts = []
  for (const s of STAFF) { const r = await api('POST', '/users', s, true); s.id = r?.id || (await api('GET', '/users')).find(u => u.email === s.email)?.id; s.username = r?.username
    if (!INTO && r) { const u = mk(); await u('POST', '/login', { email: s.email, password: r.temporary_password }); await u('POST', '/change-password', { current: r.temporary_password, next: PW }) } accounts.push(s) }
  const DOCS = (await api('GET', '/doctors')).filter(d => STAFF.some(s => s.id === d.id && s.role === 'DENTIST'))
  const docOf = () => pick(DOCS).id
  stats.comptes = accounts.length + (INTO ? 0 : 1)

  // ── patients (fictifs) ──
  const LN = ['Jean-Baptiste', 'Pierre', 'Joseph', 'Louis', 'Charles', 'Augustin', 'Saint-Louis', 'Désir', 'Michel', 'François', 'Étienne', 'Jean-Louis', 'Alexis', 'Baptiste', 'Célestin', 'Dorsainvil', 'Exantus', 'Fils-Aimé', 'Germain', 'Hyppolite', 'Innocent', 'Jacques', 'Laguerre', 'Moïse', 'Noël', 'Octave', 'Paul', 'Raymond', 'Simon', 'Thélusma', 'Valcourt', 'Zéphir', 'Bien-Aimé', 'Cadet', 'Destin', 'Estimé', 'Fleurant', 'Guerrier', 'Jeune', 'Lafortune', 'Mérisier', 'Narcisse', 'Pierre-Paul', 'Romain', 'Sanon', 'Toussaint', 'Vilmé', 'Desrosiers', 'Bélizaire', 'Clervil']
  const FF = ['Marie-Ange', 'Nathalie', 'Fabienne', 'Guerline', 'Mirlande', 'Roseline', 'Darline', 'Esther', 'Judith', 'Sandra', 'Widline', 'Kettly', 'Lovely', 'Marjorie', 'Rachelle', 'Stéphanie', 'Ruth', 'Myriam', 'Sophonie', 'Taïna', 'Christelle', 'Edwige', 'Farah', 'Islande']
  const FM = ['Jean-Robert', 'Wilson', 'Ricardo', 'Stanley', 'Frantz', 'Jocelyn', 'Kervens', 'Mackenson', 'Peterson', 'Emmanuel', 'Junior', 'Daniel', 'Marc-Arthur', 'Fritz', 'Gérald', 'Jameson', 'Lesly', 'Nixon', 'Réginald', 'Samuel', 'Tony', 'Woodly', 'Yvens', 'Clifford']
  const ZONES = [['Delmas 33', 'Delmas'], ['Rue Capois', 'Port-au-Prince'], ['Route de Frères', 'Pétion-Ville'], ['Thomassin 32', 'Kenscoff'], ['Rue Lamarre', 'Pétion-Ville'], ['Tabarre 27', 'Tabarre'], ['Carrefour Feuilles', 'Port-au-Prince'], ['Croix-des-Missions', 'Tabarre'], ['Route de Kenscoff', 'Pétion-Ville'], ['Bon Repos', 'Croix-des-Bouquets'], ['Delmas 75', 'Delmas'], ['Juvénat', 'Pétion-Ville'], ['Turgeau', 'Port-au-Prince'], ['Bourdon', 'Port-au-Prince'], ['Santo 17', 'Croix-des-Bouquets']]
  const JOBS = ['Enseignante', 'Commerçant', 'Infirmière', 'Chauffeur', 'Comptable', 'Ingénieur', 'Couturière', 'Agent de sécurité', 'Avocate', 'Mécanicien', 'Pasteur', 'Agronome', 'Banquière', 'Infographiste', 'Policier', 'Électricien', 'Secrétaire', 'Coiffeuse']
  const ALLERG = ['Pénicilline', 'Latex', 'Ibuprofène', 'Aspirine', 'Pénicilline, sulfamides', 'Codéine', 'Iode']
  const INS = ['ASSURANCE DÉMO SANTÉ', 'MUTUELLE DÉMO', 'CARTE SANTÉ DÉMO']
  const REF = ['Bouche-à-oreille', 'Réseaux sociaux', 'Ancien patient', 'Médecin généraliste', 'École (dépistage)', 'Radio']
  const phone = () => pick(['31', '32', '33', '34', '36', '37', '38', '39', '40', '41', '42', '43', '44', '46', '47', '48']) + String(int(100000, 999999))
  // profils : âge (min, max) et poids
  const PROF = [['enfant', 4, 11, 12], ['ado', 12, 17, 10], ['adulte', 18, 44, 45], ['mûr', 45, 64, 22], ['âgé', 65, 88, 11]]
  const prof = () => { let r = rnd() * 100; for (const p of PROF) { if ((r -= p[3]) <= 0) return p } return PROF[2] }
  const N = 112, pats = []
  for (let i = 0; i < N; i++) {
    const [kind, a0, a1] = prof(), sex = chance(.54) ? 'F' : 'M', ageY = int(a0, a1), ln = pick(LN), fn = pick(sex === 'F' ? FF : FM), [street, zone] = pick(ZONES)
    const birth = ymd(now - (ageY * 365.25 + int(0, 360)) * DAY), allergy = chance(.16) ? pick(ALLERG) : null, minor = ageY < 18
    const parent = (chance(.5) ? pick(FF) : pick(FM)) + ' ' + ln
    const b = { last_name: ln, first_name: fn, sex, birth_date: birth, phone: phone(), phone2: chance(.35) ? phone() : '', address: street, zone, department: 'Ouest',
      marital_status: minor ? '' : ageY < 25 ? 'Célibataire' : pick(['Célibataire', 'Marié(e)', 'Marié(e)', 'Union libre', ...(ageY > 55 ? ['Veuf(ve)', 'Veuf(ve)'] : [])]), children_count: minor ? '' : ageY < 25 ? String(pick([0, 0, 0, 1])) : String(pick([0, 1, 2, 2, 3, 4])),
      profession: minor ? (ageY >= 6 ? 'Élève' : '') : ageY <= 24 && chance(.7) ? 'Étudiant(e)' : kind === 'âgé' ? pick(['Retraité(e)', 'Retraité(e)', 'Commerçant', 'Pasteur', 'Couturière']) : pick(JOBS),
      emergency_contact: minor ? `${parent} (${pick(['mère', 'père'])})` : `${pick([...FF, ...FM])} ${pick(LN)} (${pick(['conjoint(e)', 'frère', 'sœur', 'fils', 'fille', 'ami(e)'])})`, emergency_phone: phone(),
      email: !minor && chance(.4) ? `${fn.split('-')[0].normalize('NFD').replace(/[^a-zA-Z]/g, '').toLowerCase()}.${ln.normalize('NFD').replace(/[^a-zA-Z]/g, '').toLowerCase()}@exemple.ht` : '',
      insurance: chance(.22) ? pick(INS) : '', insurance_number: '', referred_by: pick(REF), primary_doctor_id: docOf(),
      has_allergy: allergy ? 'yes' : 'no', allergies: allergy || '', blood_group: chance(.6) ? pick(['O+', 'O+', 'A+', 'B+', 'AB+', 'O-', 'A-']) : '',
      diabetes: !minor && ageY > 40 && chance(.18), cardiovascular: ageY > 50 && chance(.15), smoking: !minor && chance(.12), pregnancy: sex === 'F' && ageY >= 20 && ageY <= 40 && chance(.07),
      blood_pressure: ageY > 45 && chance(.3) ? pick(['14/9', '15/9', '13/8', '16/10']) : '', medications: ageY > 50 && chance(.3) ? pick(['Metformine', 'Amlodipine', 'Aspirine 81 mg', 'Losartan', 'Insuline']) : '',
      motif: pick(['Douleur dentaire', 'Contrôle de routine', 'Saignement des gencives', 'Esthétique', 'Dent cassée', 'Mauvaise haleine', 'Sensibilité au froid']) }
    if (b.insurance) b.insurance_number = 'D-' + int(100000, 999999)
    if (chance(.06)) b.notes = pick(['Patient anxieux : prévoir plus de temps et expliquer chaque étape.', 'Préfère les rendez-vous le matin.', 'Accompagné par un proche pour les soins.', 'Paiement échelonné accepté par la direction.'])
    if (INTO) b.notes = 'Patient fictif (données de démonstration).' + (b.notes ? ' ' + b.notes : '')
    const r = await soft(() => api('POST', '/patients', b)); if (!r) continue
    // ancienneté : inscrit entre 18 mois et aujourd'hui (les « nouveaux » ce mois-ci)
    const newbie = i % 9 === 0, reg = newbie ? now - int(0, 20) * DAY : now - int(150, 545) * DAY
    const p = { ...b, id: r.id, file: r.file_number, age: ageY, kind, allergy, reg, newbie }; pats.push(p); BACK.push({ kind: 'patient', id: p.id, t: reg }); cnt('patients')
  }

  // ── créneaux : un médecin ne peut pas avoir deux rendez-vous en même temps ──
  const busy = new Set(), slot = (doc, t) => { const k = doc + '|' + t; if (busy.has(k)) return false; busy.add(k); return true }
  const findSlot = (doc, dayT, h0 = 8, h1 = 16) => { for (let k = 0; k < 40; k++) { const h = int(h0, h1 - 1), m = pick([0, 30]), t = at(ymd(dayT), h, m); if (slot(doc, t)) return t } return null }
  const appt = async (p, doc, t, reason, dur = 30) => { const r = await soft(() => api('POST', '/appointments', { patient_file: p.file, doctor_id: doc, starts_at: new Date(t).toISOString(), duration_min: dur, reason })); if (r) { cnt('rendez-vous'); BACK.push({ kind: 'appt', id: r.id, t: Math.min(t - int(2, 15) * DAY, now - DAY) }) } return r }
  const setSt = (id, status) => soft(() => api('POST', `/appointments/${id}/status`, { status }))
  const pay = paid => { const m = pick(['espèces', 'espèces', 'espèces', 'MonCash', 'MonCash', 'NatCash', 'carte', 'virement']); return { method: m, reference: ['MonCash', 'NatCash', 'virement', 'chèque'].includes(m) ? 'TX' + int(10000000, 99999999) : '', paid } }
  const T = { pro: ['Prophylaxie', 3000], rest: ['Restauration', 2000], ext: ['Extraction simple', 2000] }
  const PERM = [11, 12, 13, 14, 15, 16, 17, 21, 22, 23, 24, 25, 26, 27, 31, 32, 33, 34, 35, 36, 37, 41, 42, 43, 44, 45, 46, 47], BACKT = [16, 17, 26, 27, 36, 37, 46, 47, 15, 25, 35, 45], PRIM = [54, 55, 64, 65, 74, 75, 84, 85, 51, 61]
  const teethFor = p => p.age < 12 ? PRIM : BACKT
  // une intervention (avec facture et paiement selon le scénario)
  const consult = async (p, t, doc, act, { teeth = [], payMode = 'full', diagnosis = '', treatment = '', notes = '', noBill = false } = {}) => {
    const [reason, price] = typeof act === 'string' ? [act, 0] : act, cost = noBill ? 0 : price
    const paid = payMode === 'full' ? cost : payMode === 'partial' ? Math.round(cost * pick([.25, .5, .5, .6]) / 50) * 50 : 0
    const r = await soft(() => api('POST', `/patients/${p.id}/consultations`, { doctor_id: doc, reason, teeth: teeth.join(' '), cost: cost ? String(cost) : '', diagnosis, treatment, notes, ...pay(paid) }))
    if (r) { cnt('interventions'); BACK.push({ kind: 'consult', id: r.id, t }); if (r.bill) { cnt('factures'); if (paid) cnt('paiements') } } return r }

  const pastDay = (from, to) => { for (let k = 0; k < 20; k++) { const t = now - int(from, to) * DAY; if (workday(t)) return t } return now - from * DAY }
  const futDay = (from, to) => { for (let k = 0; k < 20; k++) { const t = now + int(from, to) * DAY; if (workday(t)) return t } return now + to * DAY }
  const DIAG = { 'Restauration': ['Carie dentinaire', 'Carie profonde sans atteinte pulpaire', 'Obturation ancienne défectueuse'], 'Extraction simple': ['Dent délabrée non conservable', 'Mobilité stade 3', 'Reste radiculaire'], 'Prophylaxie': ['Tartre et plaque généralisés', 'Gingivite légère', 'Contrôle annuel'] }
  const TRT = { 'Restauration': ['Obturation composite', 'Obturation au verre ionomère', 'Amalgame'], 'Extraction simple': ['Avulsion sous anesthésie locale', 'Avulsion, hémostase, conseils post-opératoires'], 'Prophylaxie': ['Détartrage et polissage', 'Détartrage, polissage, conseils d\'hygiène', 'Application de fluor'] }
  const visit = (p, t, doc, k, opt = {}) => { const act = T[k], tt = k === 'pro' ? [] : [pick(teethFor(p))]; return consult(p, t, doc, act, { teeth: tt, diagnosis: pick(DIAG[act[0]]), treatment: pick(TRT[act[0]]), ...opt }) }

  // ── scénarios ──
  const sc = { régulier: 0, plan: 0, impayé: 0, absent: 0, nouveau: 0, enfant: 0, urgence: 0, archivé: 0, prothèse: 0, 'sans tarif': 0, allergique: 0 }
  for (const [i, p] of pats.entries()) {
    const doc = p.primary_doctor_id, regAge = Math.floor((now - p.reg) / DAY)
    if (p.allergy) sc.allergique++
    if (p.newbie) {   // nouveau patient : première visite à venir (ou aujourd'hui)
      sc.nouveau++; const t = findSlot(doc, futDay(0, 12)); if (t) { const a = await appt(p, doc, t, 'Première consultation'); if (a && chance(.5)) await setSt(a.id, 'confirmed') } continue }
    if (p.kind === 'enfant') {   // enfant : dépistage, détartrage, soins sur dents de lait
      sc.enfant++; for (let k = 0, n = int(1, 3); k < n; k++) { const t = pastDay(5, Math.max(10, regAge)); const at0 = findSlot(doc, t, 8, 12); if (at0) { const a = await appt(p, doc, at0, k ? 'Soin dent de lait' : 'Dépistage scolaire'); if (a) await setSt(a.id, 'done') }
        await visit(p, at0 || t, doc, k ? pick(['rest', 'pro']) : 'pro', { notes: 'Accompagné de ' + p.emergency_contact.replace(/ \(.*/, '') + '.' }) }
      if (chance(.5)) { const t = findSlot(doc, futDay(3, 40), 8, 12); if (t) await appt(p, doc, t, 'Contrôle semestriel') } continue }
    const r = i % 10
    if (r === 0 || r === 5) {   // plan de traitement en cours : caries relevées, actes faits / prévus / reportés
      sc.plan++; const teeth = [...new Set([pick(teethFor(p)), pick(teethFor(p)), pick(teethFor(p))])]
      for (const n of teeth) await soft(() => api('POST', `/patients/${p.id}/teeth`, { tooth_fdi: n, state: chance(.8) ? 'carie' : 'a_extraire', note: 'Relevé à l\'examen' }))
      const t0 = pastDay(30, Math.max(40, regAge)); await visit(p, t0, doc, 'pro', { diagnosis: 'Examen complet, caries multiples' })
      const items = [{ description: 'Détartrage complet', price: '3000', teeth: '' }, ...teeth.map(n => ({ description: chance(.8) ? 'Restauration composite' : 'Extraction simple', price: '2000', teeth: String(n) }))]
      const pl = await soft(() => api('POST', '/plans', { patient_file: p.file, responsible_doctor_id: doc, diagnosis: pick(['Polycaries', 'Caries multiples et parodontite débutante', 'Remise en état bucco-dentaire']), objective: 'Rétablir la fonction et supprimer les foyers infectieux', teeth: teeth.join(' '), sessions: String(items.length), start_date: ymd(t0), items }))
      if (pl) { cnt('plans de traitement'); BACK.push({ kind: 'plan', id: pl.id, t: t0 })
        await soft(() => api('POST', `/plans/${pl.id}/status`, { status: 'pending' })); await soft(() => api('POST', `/plans/${pl.id}/status`, { status: 'approved' }))
        const full = await soft(() => api('GET', `/plans/${pl.id}`))
        const its = full?.items || []
        for (const [k, it] of its.entries()) { const tk = t0 + (k + 1) * int(7, 21) * DAY
          if (tk > now - DAY) break
          const st = k < its.length - 1 ? 'done' : pick(['done', 'postponed', 'in_progress'])
          const pm = pick(['full', 'full', 'partial', 'none'])
          const res = await soft(() => api('POST', `/plans/${pl.id}/items/${it.id}/status`, st === 'postponed' ? { status: st, reason: pick(['Patient en voyage', 'Raisons financières', 'Attente de cicatrisation']) } : { status: st, doctor_id: doc, ...(st === 'done' ? pay(pm === 'full' ? Number(it.price) : pm === 'partial' ? Number(it.price) / 2 : 0) : {}) }))
          if (res && st === 'done') { cnt('actes de plan'); BACK.push({ kind: 'planitem', id: it.id, t: tk }) } }
        if (r === 5 && chance(.4)) await api('POST', `/plans/${pl.id}/status`, { status: 'suspended' }, true) }
      const t = findSlot(doc, futDay(1, 21)); if (t) { const a = await appt(p, doc, t, 'Suite du plan de traitement', 45); if (a && chance(.6)) await setSt(a.id, 'confirmed') }
      continue }
    if (r === 1) {   // impayé / paiement partiel puis versement ultérieur
      sc.impayé++; const t = pastDay(15, Math.max(20, regAge)), c = await visit(p, t, doc, pick(['rest', 'ext']), { payMode: pick(['partial', 'none']) })
      if (c?.bill && chance(.5)) { const left = c.bill.balance, part = Math.max(250, Math.round(left / 2 / 50) * 50), pm = pay(part)
        const pr = await soft(() => api('POST', `/invoices/${c.bill.invoice_id}/payments`, { amount: String(part), currency: 'HTG', method: pm.method, reference: pm.reference, idempotency_key: crypto.randomUUID() }))
        if (pr) { cnt('paiements'); BACK.push({ kind: 'payment', id: pr.id, t: Math.min(now - DAY, t + int(5, 30) * DAY) }) } }
      if (chance(.5)) { const tt = findSlot(doc, futDay(2, 30)); if (tt) await appt(p, doc, tt, 'Contrôle') }
      continue }
    if (r === 2) {   // rendez-vous manqués / annulés (relance automatique créée par l'application)
      sc.absent++; for (const [st, why] of [['no_show', 'Contrôle'], ['cancelled', pick(['Détartrage', 'Restauration'])]]) { const t = findSlot(doc, pastDay(3, Math.max(10, regAge))); if (t) { const a = await appt(p, doc, t, why); if (a) await setSt(a.id, st) } }
      if (chance(.6)) await visit(p, pastDay(40, Math.max(50, regAge)), doc, 'pro')
      continue }
    if (r === 3 && chance(.7)) {   // prothèse : du laboratoire à la pose
      sc.prothèse++; await visit(p, pastDay(20, Math.max(30, regAge)), doc, 'ext'); continue }   // (créée après les laboratoires)
    if (r === 7 && chance(.8)) {   // actes sans tarif configuré : enregistrés, non facturés
      sc['sans tarif']++; const t = pastDay(10, Math.max(20, regAge)), n = pick(teethFor(p))
      await consult(p, t, doc, pick(['Endodontie', 'Extraction chirurgicale']), { teeth: [n], noBill: true, diagnosis: pick(['Pulpite irréversible', 'Dent incluse', 'Nécrose pulpaire']), treatment: pick(['Traitement canalaire en 2 séances', 'Extraction chirurgicale avec suture']), notes: 'Tarif à confirmer par la clinique : non facturé.' })
      continue }
    // patient régulier : visites espacées, payées
    sc.régulier++; const n = Math.min(8, int(2, 3 + Math.floor(regAge / 90)))
    const days = [...new Set(Array.from({ length: n }, () => int(3, Math.max(10, regAge))))].sort((a, b) => b - a)
    for (const d of days) { const t0 = pastDay(d, d + 3), a0 = findSlot(doc, t0); if (a0) { const a = await appt(p, doc, a0, pick(['Contrôle', 'Soin', 'Détartrage'])); if (a) await setSt(a.id, 'done') }
      await visit(p, a0 || t0, doc, pick(['pro', 'pro', 'rest', 'rest', 'ext']), { payMode: chance(.9) ? 'full' : 'partial' }) }
    if (chance(.45)) { const t = findSlot(doc, futDay(1, 35)); if (t) { const a = await appt(p, doc, t, pick(['Contrôle', 'Détartrage', 'Restauration'])); if (a && chance(.5)) await setSt(a.id, 'confirmed') } }
  }

  // ── mois en cours : visites récentes (contrôles, soins) ──
  { const dom = Number(new Date(now).toLocaleDateString('en-CA', { timeZone: TZ }).slice(8, 10))
    for (const p of pats.filter(x => !x.newbie && x.kind !== 'enfant').filter((_, i) => i % 3 === 0).slice(0, 26)) { const back = int(1, Math.max(1, dom - 1)), t0 = now - back * DAY; if (!workday(t0)) continue
      const a0 = findSlot(p.primary_doctor_id, t0); if (a0) { const a = await appt(p, p.primary_doctor_id, a0, pick(['Contrôle', 'Soin', 'Détartrage'])); if (a) await setSt(a.id, 'done') }
      await visit(p, a0 || t0, p.primary_doctor_id, pick(['pro', 'rest', 'rest', 'ext']), { payMode: chance(.85) ? 'full' : 'partial' }) } }

  // ── prothèses (laboratoire) : types et étapes ; prix à confirmer (non facturées) ──
  const labA = await soft(() => api('POST', '/laboratories', { name: 'Laboratoire Démo Dentaire', phone: '28100000', technician: 'Technicien démo' }))
  for (const n of ['Couronne céramo-métallique', 'Bridge 3 éléments', 'Prothèse partielle amovible', 'Prothèse complète']) await soft(() => api('POST', '/prosthesis-types', { name: n }))
  const types = (await soft(() => api('GET', '/prosthesis-types'))) || []
  for (const p of pats.filter((x, i) => i % 10 === 3 && !x.newbie && x.kind !== 'enfant').slice(0, 9)) { const ty = pick(types); if (!ty) break
    const x = await soft(() => api('POST', '/prostheses', { patient_file: p.file, doctor_id: p.primary_doctor_id, type_id: ty.id, teeth: String(pick(BACKT)), material: pick(['Céramique', 'Zircone', 'Résine', 'Métal-céramique']), color: pick(['A2', 'A3', 'B2']), lab_id: labA?.id, price: '0', bill: false, instructions: 'Teinte validée avec le patient.' }))
    if (!x) continue; cnt('prothèses'); BACK.push({ kind: 'prosthesis', id: x.id, t: now - int(10, 90) * DAY })
    const steps = ['impression', 'preparation', 'sent_lab', 'manufacturing', 'returned', 'fitting', 'adjustment', 'ready', 'placed'], upto = int(0, steps.length)
    for (const s of steps.slice(0, upto)) await soft(() => api('POST', `/prostheses/${x.id}/step`, { step: s })) }

  // ── archivés : dossiers désactivés avec motif ──
  for (const p of pats.filter(x => !x.newbie).slice(-3)) { const ok = await soft(() => api('POST', `/patients/${p.id}/archive`, { reason: pick(['Patient parti à l\'étranger', 'Doublon de dossier fusionné', 'Suivi transféré dans une autre clinique']) })); if (ok) sc.archivé++ }

  // ── aujourd'hui : rendez-vous du jour, salle d'attente, urgence, visiteur ──
  const todayT = now, active = pats.filter(p => !p.newbie && p.kind !== 'enfant').slice(0, 60)
  const todays = []
  for (const p of active.filter((_, i) => i % 6 === 1).slice(0, 8)) { const t = findSlot(p.primary_doctor_id, todayT, 8, 17); if (!t) continue; const a = await appt(p, p.primary_doctor_id, t, pick(['Contrôle', 'Restauration', 'Détartrage', 'Suite de soin'])); if (a) { todays.push({ a, p, t }); if (chance(.6)) await setSt(a.id, 'confirmed') } }
  const q = (await soft(() => api('GET', '/queue'))) || {}
  for (const [k, x] of todays.entries()) { if (x.t > now + 2 * 36e5) continue
    const tk = (q.waiting || []).find(w => w.appointment_id === x.a.id) || await soft(() => api('POST', '/queue', { appointment_id: x.a.id }))
    if (tk && k === 0) await soft(() => api('POST', `/queue/${tk.id}/take`, {})) }
  const urg = active[active.length - 1]; if (urg) { await soft(() => api('POST', '/queue', { patient_file: urg.file, reason: 'Douleur aiguë — urgence', priority: true, doctor_id: urg.primary_doctor_id })); sc.urgence++ }
  for (const p of active.filter((_, i) => i % 11 === 4).slice(0, 3)) await soft(() => api('POST', '/queue', { patient_file: p.file, reason: pick(['Sans rendez-vous', 'Douleur', 'Renouvellement d\'ordonnance']) }))
  await soft(() => api('POST', '/queue', { visitor_name: 'Visiteur (renseignements)', reason: 'Demande de devis' }))
  stats['tickets salle d\'attente'] = ((await soft(() => api('GET', '/queue'))) || {}).waiting?.length ?? '—'

  // ── dépenses mensuelles et stock ──
  for (let m = 17; m >= 0; m--) { const t = now - m * 30.4 * DAY
    for (const [cat, desc, amt] of [['Loyer', 'Loyer du local', 12000], ['Électricité', 'Facture EDH et carburant génératrice', int(2500, 4500)], ['Internet', 'Abonnement Internet', 2000], ['Matériaux dentaires', 'Composites, anesthésiques, gants', int(2500, 6000)], ['Fournitures', 'Fournitures de bureau', int(400, 1200)], ...(chance(.2) ? [['Maintenance', 'Entretien du fauteuil et compresseur', int(1500, 4000)]] : [])]) {
      if (m === 0 && cat === 'Loyer' && new Date().getDate() < 5) continue
      const e = await soft(() => api('POST', '/expenses', { category: cat, description: desc + ' (démo)', amount: String(amt), currency: 'HTG', pay_now: m > 0 || chance(.7) })); if (e) { cnt('dépenses'); BACK.push({ kind: 'expense', id: e.id, t: Math.min(now - DAY / 2, t + int(0, 6) * DAY) }) } } }
  for (const [ref, name, cat, unit, min] of [['ANE-01', 'Lidocaïne 2 % adrénalinée', 'Anesthésie', 'carpule', 50], ['COM-A2', 'Composite A2', 'Restauration', 'seringue', 6], ['COM-A3', 'Composite A3', 'Restauration', 'seringue', 6], ['GNT-M', 'Gants nitrile M', 'Protection', 'boîte', 10], ['MSQ-01', 'Masques chirurgicaux', 'Protection', 'boîte', 8], ['FIL-01', 'Fil de suture 3/0', 'Chirurgie', 'sachet', 12], ['ALG-01', 'Alginate', 'Empreinte', 'sachet', 4], ['FLU-01', 'Vernis fluoré', 'Prévention', 'tube', 5], ['CVI-01', 'Verre ionomère', 'Restauration', 'kit', 2], ['DIG-01', 'Digue (feuilles)', 'Isolation', 'boîte', 3]])
    if (await soft(() => api('POST', '/products', { ref, name, category: cat, unit, min_stock: String(min) }))) cnt('produits')
  await stop()

  // ── répartition de l'historique dans le temps (dates réelles des actes, factures, paiements, caisse) ──
  console.log('Répartition de l\'historique sur 18 mois…')
  const { PGlite } = await import('@electric-sql/pglite'); const db = new PGlite(env.DB_DIR)
  await db.exec('set session_replication_role = replica')
  const iso = t => new Date(t).toISOString(), yr = t => new Date(t).toLocaleDateString('en-CA', { timeZone: TZ }).slice(0, 4)
  const payDates = async (where, args, t) => { const ps = (await db.query(`select id, receipt_number from payments where ${where}`, args)).rows
    for (const y of ps) { const rn = y.receipt_number.replace(/^REC-\d{4}-/, 'REC-' + yr(t) + '-')
      await db.query('update payments set created_at=$2::timestamptz, receipt_number=$3 where id=$1', [y.id, iso(t), rn]); await db.query("update cash_movements set created_at=$2::timestamptz, ref=$3 where related_type='payment' and related_id=$1", [String(y.id), iso(t), rn]) } }
  const invDates = async (col, id, t) => { for (const inv of (await db.query(`select id, number from invoices where ${col}=$1`, [id])).rows) {
      await db.query('update invoices set created_at=$2::timestamptz, number=$3 where id=$1', [inv.id, iso(t), inv.number.replace(/^FAC-\d{4}-/, 'FAC-' + yr(t) + '-')])
      await payDates('invoice_id=$1', [inv.id], t + int(0, 2) * 36e5) } }
  for (const x of BACK) {
    try {
      if (x.kind === 'patient') await db.query('update patients set registered_at=$2::timestamptz, created_at=$2::timestamptz where id=$1', [x.id, iso(x.t)])
      if (x.kind === 'consult') { await db.query('update consultations set consulted_at=$2::timestamptz where id=$1', [x.id, iso(x.t)]); await invDates('consultation_id', x.id, x.t) }
      if (x.kind === 'planitem') { await db.query('update treatment_plan_items set done_at=$2::timestamptz where id=$1', [x.id, iso(x.t)]); await invDates('plan_item_id', x.id, x.t) }
      if (x.kind === 'plan') await db.query('update treatment_plans set created_at=$2::timestamptz where id=$1', [x.id, iso(x.t)])
      if (x.kind === 'payment') await payDates('id=$1', [x.id], x.t)
      if (x.kind === 'appt') await db.query('update appointments set created_at=$2::timestamptz where id=$1', [x.id, iso(x.t)])
      if (x.kind === 'prosthesis') { await db.query('update prostheses set created_at=$2::timestamptz where id=$1', [x.id, iso(x.t)]); await db.query('update prosthesis_steps set created_at=$2::timestamptz where prosthesis_id=$1', [x.id, iso(x.t)]).catch(() => {}) }
      if (x.kind === 'expense') { await db.query('update expenses set created_at=$2::timestamptz, paid_at=case when paid_at is not null then $2::timestamptz end where id=$1', [x.id, iso(x.t)]); await db.query("update cash_movements set created_at=$2::timestamptz where related_type='expense' and related_id=$1", [String(x.id), iso(x.t)]) }
    } catch (e) { stats.erreurs++; const k = 'date ' + x.kind + ' : ' + e.message; (stats.why ||= {})[k] = (stats.why[k] || 0) + 1 } }
  // schéma dentaire et relances : alignés sur les dates des soins / rendez-vous
  if (!INTO) await db.query("update users set first_name='Direction', last_name='Démo' where role='OWNER'")
  const PIDS = pats.map(p => p.id)
  await db.query('update tooth_states t set recorded_at = coalesce((select max(c.consulted_at) from consultations c where c.patient_id=t.patient_id), t.recorded_at) where t.patient_id = any($1::uuid[])', [PIDS]).catch(() => {})
  await db.query("update follow_up_reminders r set due_date = coalesce((select (max(a.starts_at) at time zone 'America/Port-au-Prince')::date + 1 from appointments a where a.patient_id=r.patient_id and a.status='no_show'), r.due_date) where kind='rdv_manque' and r.patient_id = any($1::uuid[])", [PIDS]).catch(() => {})
  await db.exec('analyze'); await db.close()

  if (INTO) {
    await start(); const ad = mk(); await ad('POST', '/login', { email: TEMP.email, password: TEMP.pw })
    const bk = await ad('POST', '/backups', { type: 'complete' }, true), ver = bk?.id ? await ad('POST', `/backups/${bk.id}/verify`, {}, true) : null
    stats['sauvegarde après import'] = bk?.id ? bk.id + (ver?.ok ? ' (vérifiée)' : ' (vérification à refaire)') : 'ÉCHEC — faites une sauvegarde complète'
    await stop()
    const { PGlite: PG } = await import('@electric-sql/pglite'), db2 = new PG(REAL.db)
    await db2.query("update users set status='disabled' where id=$1", [TEMP.id]); await db2.query('update user_sessions set revoked_at=now() where user_id=$1 and revoked_at is null', [TEMP.id]); await db2.close()
    const rep0 = path.join(path.dirname(REAL.db), 'demo-injection-' + path.basename(REAL.copy).split('.avant-demo-')[1] + '.json')
    fs.writeFileSync(rep0, JSON.stringify({ date: new Date().toISOString(), copie_avant: REAL.copy, compte_technique: TEMP.email, equipe_fictive: accounts.map(a => ({ id: a.id, nom: a.first_name + ' ' + a.last_name, email: a.email })), patients_fictifs: pats.map(p => ({ id: p.id, dossier: p.file, nom: p.last_name + ' ' + p.first_name })) }, null, 1))
    REAL.report = rep0 }
  else fs.writeFileSync(READY, new Date().toISOString())
  console.log('\nClinique de démonstration créée :')
  for (const [k, v] of Object.entries(stats)) if (k !== 'erreurs' && k !== 'why') console.log('  ' + k.padEnd(26) + v)
  console.log('  scénarios patients :', Object.entries(sc).map(([k, v]) => `${k} ${v}`).join(' · '))
  if (stats.why) for (const [k, v] of Object.entries(stats.why)) console.log('    ' + v + ' × ' + k)
  if (stats.erreurs) console.log('  (' + stats.erreurs + ' opération(s) refusée(s) par les règles de l\'application, ignorées)')
  if (INTO) { console.log('\nDonnées fictives ajoutées à la plateforme.\n  Copie de la base AVANT l\'import : ' + REAL.copy + '\n  Liste des éléments ajoutés      : ' + REAL.report + '\n  Équipe fictive : comptes sans mot de passe connu (réinitialisables dans Utilisateurs).\nRelancez la clinique : npm start'); process.exit(0) }
  fs.writeFileSync(path.join(DIR, 'comptes.txt'), ['Comptes de la démo (mot de passe commun : ' + PW + ')', 'Propriétaire : ' + OWNER, ...accounts.map(a => `${a.job_title} — ${a.first_name} ${a.last_name} : ${a.email}${a.username ? ' ou ' + a.username : ''}`)].join('\n') + '\n')
}

if (process.argv.includes('--seed-only')) process.exit(0)
await start(false)
console.log(`\n══ DÉMO DENTAL ══  http://localhost:${PORT}   (données fictives, base séparée)`)
console.log(fs.existsSync(path.join(DIR, 'comptes.txt')) ? fs.readFileSync(path.join(DIR, 'comptes.txt'), 'utf8') : '')
console.log('Ctrl+C pour arrêter.')
process.on('SIGINT', async () => { await stop(); process.exit(0) })
