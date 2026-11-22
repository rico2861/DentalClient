const B = 'http://localhost:3999/api'
const mk = () => { let ck = ''; return async (m, p, b) => { const r = await fetch(B + p, { method: m, headers: { 'Content-Type': 'application/json', cookie: ck }, body: b ? JSON.stringify(b) : undefined }); const sc = r.headers.get('set-cookie'); if (sc) ck = sc.split(';')[0]; return { s: r.status, j: await r.json().catch(() => ({})) } } }
let ok = 0, ko = 0; const T = (n, c, x) => { c ? ok++ : ko++; console.log(c ? 'PASS' : 'FAIL', n, c ? '' : JSON.stringify(x)) }
const o = mk(); await o('POST', '/login', { email: 'owner@test.com', password: 'NouveauMdp#2026a' })
const pat = (await o('POST', '/patients', { last_name: 'Pierre', first_name: 'Marie' })).j
const dr2 = (await o('POST', '/users', { first_name: 'Dr', last_name: 'Pierre', email: 'dr2@test.com', role: 'DENTIST' })).j
const docs = (await o('GET', '/doctors')).j, me = (await o('GET', '/me')).j.id; T('2 médecins disponibles', docs.length >= 2, docs)
const day = new Date(Date.now() + 86400e3).toISOString().slice(0, 10), at = h => `${day}T${h}:00Z`
let r = await o('POST', '/appointments', { patient_file: pat.file_number, doctor_id: me, starts_at: at('10:00'), duration_min: 30, chair: 'F1' }); T('rendez-vous créé', r.s === 200, r); const ap = r.j.id
r = await o('POST', '/appointments', { patient_file: pat.file_number, doctor_id: me, starts_at: at('10:15'), duration_min: 30 }); T('double réservation médecin refusée', r.s === 409, r)
r = await o('POST', '/appointments', { patient_file: pat.file_number, doctor_id: dr2.id, starts_at: at('10:15'), duration_min: 30, chair: 'F1' }); T('double réservation fauteuil refusée', r.s === 409, r)
r = await o('POST', '/appointments', { patient_file: pat.file_number, doctor_id: me, starts_at: at('10:30'), duration_min: 30 }); T('créneau adjacent accepté', r.s === 200, r)
r = await o('POST', `/appointments/${ap}/status`, { status: 'no_show' }); T('absence', r.s === 200, r)
const rem = (await o('GET', '/reminders')).j; T('absence → rappel de suivi créé', rem.some(x => x.kind === 'rdv_manque'), rem)
r = await o('POST', `/appointments/${ap}/status`, { status: 'confirmed' }); T('transition invalide refusée', r.s === 409, r)
r = await o('POST', '/appointments', { patient_file: pat.file_number, doctor_id: me, starts_at: at('10:00'), duration_min: 30, chair: 'F1' }); T('créneau libéré par l\'absence', r.s === 200, r)
r = await o('POST', `/reminders/${rem[0].id}/done`, {}); T('rappel marqué fait', r.s === 200, r)
// Plan de traitement
const plan = (await o('POST', '/plans', { patient_file: pat.file_number, diagnosis: 'Carie 26', teeth: '26', sessions: 3, items: [{ description: 'Extraction', tooth: 26, price: '3000', doctor_id: me }, { description: 'Couronne', tooth: 26, price: '6000', doctor_id: dr2.id }, { description: 'Contrôle', price: '1000', doctor_id: me }] })).j; T('plan créé', !!plan.id, plan)
let d = (await o('GET', `/plans/${plan.id}`)).j; T('coût total = 10000', d.total === '10000.00' && d.balance === 10000, d)
r = await o('POST', `/plans/${plan.id}/items/${d.items[0].id}/status`, { status: 'done' }); T('intervention impossible sur plan brouillon', r.s === 409, r)
for (const s of ['pending', 'approved']) await o('POST', `/plans/${plan.id}/status`, { status: s })
r = await o('POST', `/plans/${plan.id}/status`, { status: 'done' }); T('transition de plan invalide refusée', r.s === 409, r)
const it = (await o('GET', `/plans/${plan.id}`)).j.items; const ext = it.find(i => i.description === 'Extraction')
r = await o('POST', `/plans/${plan.id}/items/${ext.id}/status`, { status: 'done' }); d = (await o('GET', `/plans/${plan.id}`)).j; T('progression 33 % et plan en cours', d.progress === 33 && d.status === 'in_progress' && d.remaining === 2, d)
const inv = (await o('POST', '/invoices', { kind: 'invoice', currency: 'HTG', patient_file: pat.file_number, plan_id: plan.id, items: [{ description: 'Plan', qty: '1', unit_price: '10000' }] })).j
await o('POST', `/invoices/${inv.id}/payments`, { amount: '4000', currency: 'HTG', method: 'espèces', idempotency_key: 'plan-pay-0001' }); d = (await o('GET', `/plans/${plan.id}`)).j; T('paiements = 4000, solde = 6000', d.paid === '4000.00' && d.balance === 6000, d)
// Prothèses
const types = (await o('GET', '/prosthesis-types')).j; T('9 types de prothèses', types.length >= 9 && types.some(t => t.name === 'Onlay'), types)
const lab = (await o('POST', '/laboratories', { name: 'Labo Dental Plus' })).j
const pr = (await o('POST', '/prostheses', { patient_file: pat.file_number, type_id: types.find(t => t.name === 'Couronne').id, teeth: '26', lab_id: lab.id, material_cost: '500', lab_cost: '1500', price: '6000' })).j; T('prothèse créée', !!pr.ref, pr)
r = await o('POST', `/prostheses/${pr.id}/step`, { step: 'sent_lab' }); T('saut d\'étape refusé', r.s === 409, r)
for (const s of ['impression', 'preparation', 'sent_lab', 'manufacturing', 'returned', 'fitting', 'adjustment', 'ready', 'placed']) r = await o('POST', `/prostheses/${pr.id}/step`, { step: s }); T('cycle complet jusqu\'à la pose', r.j.step === 'placed', r)
r = await o('POST', `/prostheses/${pr.id}/step`, { step: 'placed' }); T('plus d\'étape après la pose', r.s === 409, r)
let pl = (await o('GET', '/prostheses')).j[0]; T('marge = 6000 - 500 - 1500 = 4000', pl.margin === '4000.00' && pl.grp === 'done', pl)
T('contrôle auto 14 j après la pose', (await o('GET', '/reminders')).j.some(x => x.kind === 'controle_prothese'))
r = await o('POST', `/prostheses/${pr.id}/pay-lab`, {}); T('paiement labo', r.s === 200, r); r = await o('POST', `/prostheses/${pr.id}/pay-lab`, {}); T('double paiement labo refusé', r.s === 409, r)
// Stats médecins, rôles, dashboard
const st = (await o('GET', '/doctors/stats')).j.find(x => x.id === me); T('stats médecin : interventions, prothèses, patients', st.interventions === 1 && st.generated_htg === '3000.00' && st.prostheses_placed === 1, st)
const dash = (await o('GET', '/dashboard')).j; T('dashboard : plans et prothèses', dash.plans_in_progress === 1 && 'appointments_today' in dash && dash.prostheses_in_progress === 0, dash)
const sec = (await o('POST', '/users', { first_name: 'S', last_name: 'T', email: 'sec2@test.com', role: 'SECRETARY' })).j, s = mk(); await s('POST', '/login', { email: 'sec2@test.com', password: sec.temporary_password }); await s('POST', '/change-password', { current: sec.temporary_password, next: 'SecretMdp#2026b' })
T('secrétaire : peut gérer les rendez-vous', (await s('GET', '/appointments')).s === 200); T('secrétaire : pas de prothèses', (await s('POST', '/prostheses', {})).s === 403); T('secrétaire : pas de plans', (await s('POST', '/plans', {})).s === 403)
const dd = mk(); await dd('POST', '/login', { email: 'dr2@test.com', password: dr2.temporary_password }); await dd('POST', '/change-password', { current: dr2.temporary_password, next: 'DocteurMdp#2026c' })
const ds = (await dd('GET', '/doctors/stats')).j; T('médecin : ne voit que ses propres statistiques', ds.length === 1 && ds[0].id === dr2.id, ds); T('médecin : pas de salaires', (await dd('GET', '/employees')).s === 403)
console.log(`\n${ok} réussis, ${ko} échoués`)
