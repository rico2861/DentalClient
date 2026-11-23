// ─────────────────────────────────────────────────────────────────────────────
// Espace PUBLIC du site clinique (SaaS intégré, plus de vitrine séparée) :
//   • Accueil / « à propos » — ce qu'est Dental Assist
//   • Créer un compte / se connecter (compte abonné)
//   • Choisir un plan, payer (MonCash / virement), créer le super-admin
// Appelle le cerveau SaaS sous /saas/api/* (jetons Bearer, indépendants du login clinique).
// ─────────────────────────────────────────────────────────────────────────────
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
const money = (n, c = 'HTG') => new Intl.NumberFormat('fr-FR').format(Number(n || 0)) + ' ' + c
const fdate = s => { try { return new Date(s).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' }) } catch { return s } }
const TK = 'dl_saas_token'
const token = () => { try { return localStorage.getItem(TK) || '' } catch { return '' } }
const setToken = t => { try { localStorage.setItem(TK, t) } catch {} }
const clearToken = () => { try { localStorage.removeItem(TK) } catch {} }
const APP_URL = location.origin   // le logiciel est servi à la même origine

async function sapi(path, { body, auth, method } = {}) {
  const h = { 'Content-Type': 'application/json' }
  if (auth) { const t = token(); if (t) h.Authorization = 'Bearer ' + t }
  const r = await fetch('/saas' + path, { method: method || (body ? 'POST' : 'GET'), headers: h, body: body ? JSON.stringify(body) : undefined })
  const j = await r.json().catch(() => ({}))
  if (!r.ok) throw Object.assign(new Error(j.error || 'Erreur'), { status: r.status, code: j.code })
  return j
}
const planLabel = p => ({ trial: 'Essai gratuit 15 jours', '1m': 'Abonnement 1 mois', '1y': 'Abonnement 1 an' }[p] || p)
const app = () => document.getElementById('app')
const showErr = (id, m) => { const e = document.getElementById(id); if (e) { e.textContent = m; e.style.display = 'block' } }

// Enveloppe large (pas la carte étroite de connexion)
const shell = inner => `<div class="pub"><header class="pub-top"><div class="pub-brand"><span class="pub-logo">D</span> Dental Assist</div>
  <div class="pub-actions"><button class="pub-link" data-pub="login">Mon abonnement</button><button class="pub-cta" data-pub="signin">Se connecter</button></div></header>
  <main class="pub-main">${inner}</main>
  <footer class="pub-foot">© ${new Date().getFullYear()} Dental Assist · Gestion de cabinet dentaire · +509 34 54 68 96 · dentalassist@gmail.com</footer></div>`

const FEATURES = [
  ['Patients & dossiers', 'Dossiers complets, schéma dentaire, antécédents, documents et consentements.'],
  ['Rendez-vous & salle d\'attente', 'Agenda, file d\'attente temps réel, rappels et suivi des parcours.'],
  ['Facturation & caisse', 'Devis, factures, encaissements multi-devises, reçus thermiques, dépenses.'],
  ['Stock & achats', 'Inventaire, consommations, demandes et réceptions d\'achats, laboratoire.'],
  ['Personnel & paie', 'Employés, salaires, commissions par praticien, retenues et fiches de paie.'],
  ['Rapports & sécurité', 'Tableaux de bord, journal d\'activité, rôles, double authentification.']
]

function landing() {
  app().innerHTML = shell(`
    <section class="pub-hero">
      <span class="pub-eyebrow">Logiciel de cabinet dentaire — 100 % en ligne</span>
      <h1>Tout votre cabinet,<br><b>dans un seul logiciel.</b></h1>
      <p class="pub-lead">Patients, rendez-vous, facturation, caisse, stock, paie et rapports. En ligne, sécurisé, et vos données isolées pour chaque clinique.</p>
      <div class="pub-hero-btns"><button class="pub-cta lg" data-pub="create">Créer un compte</button><button class="pub-ghost lg" data-pub="signin">Se connecter</button></div>
    </section>
    <section class="pub-feats">${FEATURES.map(([t, d]) => `<div class="pub-feat"><h3>${esc(t)}</h3><p>${esc(d)}</p></div>`).join('')}</section>
    <section class="pub-how"><h2>Comment ça marche</h2><ol class="pub-steps">
      <li><b>Créez votre compte</b> et choisissez une formule (essai 15 jours, 1 mois ou 1 an).</li>
      <li><b>Payez</b> par MonCash ou virement bancaire — votre licence est émise dès confirmation.</li>
      <li><b>Créez votre super-admin</b> depuis votre espace, puis connectez-vous au logiciel avec votre clé + un code reçu par e-mail.</li>
    </ol></section>`)
}

// ── Compte abonné : créer / se connecter ──
function auth(view = 'register') {
  app().innerHTML = shell(`<section class="pub-card"><div class="pub-tabs">
      <button class="${view === 'register' ? 'on' : ''}" data-pub="t-register">Créer un compte</button>
      <button class="${view === 'login' ? 'on' : ''}" data-pub="t-login">J'ai déjà un compte</button></div>
    <div class="err" id="a-err" style="display:none"></div>
    ${view === 'register' ? `
      <div class="fld"><label>Nom du cabinet</label><input id="a-name" placeholder="Cabinet Dentaire…"></div>
      <div class="fld2"><div class="fld"><label>Ville</label><input id="a-city"></div><div class="fld"><label>Téléphone</label><input id="a-phone"></div></div>` : ''}
    <div class="fld"><label>E-mail</label><input id="a-email" type="email" placeholder="vous@cabinet.com"></div>
    <div class="fld"><label>Mot de passe</label><input id="a-pass" type="password" placeholder="10 caractères minimum"></div>
    <button class="pub-cta wfull" id="a-go">${view === 'register' ? 'Créer mon compte' : 'Se connecter'}</button>
    </section>`)
  document.getElementById('a-go').onclick = async e => {
    e.target.disabled = true; const er = document.getElementById('a-err'); if (er) er.style.display = 'none'
    try {
      if (view === 'register') await (async () => { const r = await sapi('/api/account/register', { body: { name: val('a-name'), email: val('a-email'), password: pass('a-pass'), phone: val('a-phone'), city: val('a-city') } }); setToken(r.token) })()
      else { const r = await sapi('/api/account/login', { body: { email: val('a-email'), password: pass('a-pass') } }); setToken(r.token) }
      portal()
    } catch (ex) { showErr('a-err', ex.message); e.target.disabled = false }
  }
}
const val = id => (document.getElementById(id)?.value || '').trim()
const pass = id => document.getElementById(id)?.value || ''

// ── Espace abonné : abonnement, plans, paiements, super-admin ──
async function portal(preselect) {
  if (!token()) return auth('login')
  app().innerHTML = shell(`<section class="pub-card"><p class="muted">Chargement de votre espace…</p></section>`)
  let me
  try { me = await sapi('/api/account/me', { auth: true }) } catch (e) { if (e.status === 401) { clearToken(); return auth('login') } return app().innerHTML = shell(`<section class="pub-card"><div class="err" style="display:block">${esc(e.message)}</div></section>`) }
  const prices = await sapi('/api/prices').catch(() => ({}))
  const lic = (me.licenses || []).find(l => l.status === 'active')
  const licHtml = (me.licenses || []).length ? (me.licenses || []).map(l => `<div class="pub-lic"><div><span>${planLabel(l.plan)}</span><code>${esc(l.key)}</code></div><span class="badge ${l.status === 'active' ? 'ok' : 'bad'}">${l.status === 'active' ? 'Active' : 'Expirée'}</span><small>échéance ${fdate(l.ends_at)}</small></div>`).join('') : `<p class="muted">Aucune licence pour le moment. Choisissez une formule ci-dessous.</p>`
  const plans = [['trial', 'Essai gratuit', '15 jours'], ['1m', '1 mois', money(prices.PRICE_1M || 1500)], ['1y', '1 an', money(prices.PRICE_1Y || 15000)]]
    .filter(p => p[0] !== 'trial' || !me.trial_used)
  app().innerHTML = shell(`<section class="pub-card">
    <div class="pub-head"><div><h2>${esc(me.clinic?.name || 'Mon cabinet')}</h2><p class="muted">${esc(me.clinic?.email || '')}</p></div><button class="pub-link" data-pub="logout">Déconnexion</button></div>
    <div class="err" id="p-err" style="display:none"></div>
    <h3 class="pub-ttl">Mes licences</h3>${licHtml}
    <h3 class="pub-ttl">Choisir une formule</h3>
    <div class="pub-plans">${plans.map(p => `<button class="pub-plan" data-plan="${p[0]}"><strong>${p[1]}</strong><span>${p[2]}</span></button>`).join('')}</div>
    ${lic ? superAdminCard(me) : ''}
    </section>`)
  document.querySelectorAll('.pub-plan').forEach(b => b.onclick = () => choosePlan(b.dataset.plan))
  wireSuperAdmin(me)
  if (preselect) choosePlan(preselect)
}

function superAdminCard(me) {
  return `<h3 class="pub-ttl">Mon compte super-admin</h3>
    <div class="pub-sa"><p class="muted">Créez le compte <b>propriétaire</b> de votre clinique. Vous vous connecterez ensuite au logiciel avec votre <b>clé de licence</b> et un <b>code reçu par e-mail</b>.</p>
      <div class="err" id="sa-err" style="display:none"></div>
      <div class="fld"><label>E-mail du super-admin</label><input id="sa-email" type="email" value="${esc(me.clinic?.email || '')}"></div>
      <div class="fld2"><div class="fld"><label>Mot de passe</label><input id="sa-pw" type="password" placeholder="12 caractères min."></div><div class="fld"><label>Confirmer</label><input id="sa-pw2" type="password"></div></div>
      <button class="pub-cta wfull" id="sa-go">Créer mon super-admin</button></div>`
}
function wireSuperAdmin(me) {
  const g = document.getElementById('sa-go'); if (!g) return
  g.onclick = async () => {
    const email = val('sa-email'), pw = pass('sa-pw'), pw2 = pass('sa-pw2')
    const er = document.getElementById('sa-err'); if (er) er.style.display = 'none'
    if (pw.length < 12) return showErr('sa-err', 'Mot de passe : 12 caractères minimum.')
    if (pw !== pw2) return showErr('sa-err', 'Les mots de passe ne correspondent pas.')
    g.disabled = true
    try {
      const r = await sapi('/api/account/provision-admin', { auth: true, body: { email, password: pw } })
      app().innerHTML = shell(`<section class="pub-card"><h2>Super-admin ${r.created ? 'créé' : 'déjà actif'}</h2>
        <p class="muted">Connectez-vous au logiciel avec votre <b>clé de licence</b> et le <b>code reçu par e-mail</b> (${esc(email)}).</p>
        <div class="fld"><label>Votre clé de licence</label><code class="pub-key">${esc(r.license_key)}</code></div>
        <button class="pub-cta wfull" data-pub="signin">Ouvrir le logiciel</button></section>`)
    } catch (e) { g.disabled = false; showErr('sa-err', e.message) }
  }
}

async function choosePlan(plan) {
  try {
    const r = await sapi('/api/account/plan', { auth: true, body: { plan } })
    if (r.license_key) return portal()
    if (r.needs_payment) return pay(plan, r.amount, r.currency)
    portal()
  } catch (e) { if (e.status === 401) { clearToken(); auth('login') } else showErr('p-err', e.message) }
}

function pay(plan, amount, currency) {
  app().innerHTML = shell(`<section class="pub-card"><h2>Paiement — ${esc(planLabel(plan))}</h2>
    <p class="muted">Montant : <strong>${money(amount, currency)}</strong>. Votre clé est générée dès le paiement confirmé, jamais avant.</p>
    <div class="err" id="pay-err" style="display:none"></div>
    <button class="pub-cta wfull" id="pay-mc">Payer avec MonCash</button>
    <button class="pub-ghost wfull mt" id="pay-vir">Payer par virement bancaire</button>
    <p class="muted center mt"><button class="pub-link" data-pub="portal">← Retour à mon espace</button></p></section>`)
  document.getElementById('pay-mc').onclick = async e => {
    e.target.disabled = true; e.target.textContent = 'Redirection vers MonCash…'
    try { const p = await sapi('/api/account/pay/moncash', { auth: true, body: { plan } }); location.href = p.redirectUrl }
    catch (ex) { showErr('pay-err', ex.message); e.target.disabled = false; e.target.textContent = 'Payer avec MonCash' }
  }
  document.getElementById('pay-vir').onclick = async () => {
    try { const v = await sapi('/api/account/pay/virement', { auth: true, body: { plan } }); bank(v, plan) } catch (ex) { showErr('pay-err', ex.message) }
  }
}

async function bank(v, plan) {
  let accounts = []; try { accounts = await sapi('/api/bank-accounts') } catch {}
  app().innerHTML = shell(`<section class="pub-card"><h2>Virement bancaire</h2>
    <p class="muted">Montant : <strong>${money(v.amount, v.currency)}</strong> · Référence : <strong>${esc(v.reference || v.ref || '')}</strong>. Effectuez le virement puis téléversez la preuve ; votre licence s'active après vérification.</p>
    ${accounts.length ? accounts.map(b => `<div class="pub-bank"><span>${esc(b.bank_name)}</span><strong>${esc(b.number)}</strong>${b.holder ? `<small>${esc(b.holder)}</small>` : ''}</div>`).join('') : '<p class="muted">Les coordonnées bancaires vous seront communiquées par le support.</p>'}
    <div class="err" id="pay-err" style="display:none"></div>
    <div class="fld"><label>Preuve de virement (image ou PDF)</label><input id="vir-file" type="file" accept="image/*,application/pdf"></div>
    <button class="pub-cta wfull" id="vir-send">Envoyer la preuve</button>
    <p class="muted center mt"><button class="pub-link" data-pub="portal">← Retour à mon espace</button></p></section>`)
  document.getElementById('vir-send').onclick = async e => {
    const f = document.getElementById('vir-file').files[0]
    if (!f) return showErr('pay-err', 'Choisissez le fichier de preuve.')
    e.target.disabled = true
    try {
      const b64 = await new Promise((res, rej) => { const rd = new FileReader(); rd.onload = () => res(rd.result); rd.onerror = rej; rd.readAsDataURL(f) })
      await sapi('/api/account/pay/proof', { auth: true, body: { payment_id: v.payment_id, filename: f.name, contentType: f.type, dataBase64: b64 } })
      app().innerHTML = shell(`<section class="pub-card"><h2>Preuve envoyée</h2><p class="muted">Merci. Votre paiement sera vérifié par le support ; votre licence s'activera après confirmation.</p><button class="pub-cta wfull" data-pub="portal">Retour à mon espace</button></section>`)
    } catch (ex) { e.target.disabled = false; showErr('pay-err', ex.message) }
  }
}

// Navigation déléguée (data-pub) + routes publiques
function onClick(e) {
  const el = e.target.closest && e.target.closest('[data-pub]'); if (!el) return
  const a = el.getAttribute('data-pub'); e.preventDefault()
  if (a === 'create') return auth('register')
  if (a === 'login' || a === 'portal') return portal()
  if (a === 't-register') return auth('register')
  if (a === 't-login') return auth('login')
  if (a === 'logout') { clearToken(); return landing() }
  if (a === 'signin') { location.hash = '#connexion'; if (window.DL_showClinicLogin) window.DL_showClinicLogin() }
}

export function mountPublic(view = 'landing') {
  document.removeEventListener('click', onClick); document.addEventListener('click', onClick)
  if (view === 'account') return token() ? portal() : auth('register')
  landing()
}
