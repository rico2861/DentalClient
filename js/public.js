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
const TK = 'dl_saas_token', TKT = 'dl_saas_token_at', TK_TTL = 8 * 3600 * 1000   // 8 h d'inactivité → reconnexion
const token = () => { try { const t = localStorage.getItem(TK) || ''; if (!t) return ''; const at = +(localStorage.getItem(TKT) || 0); if (at && Date.now() - at > TK_TTL) { clearToken(); return '' } return t } catch { return '' } }
const setToken = t => { try { localStorage.setItem(TK, t); localStorage.setItem(TKT, String(Date.now())) } catch {} }   // l'horodatage est rafraîchi à chaque réponse glissante
const clearToken = () => { try { localStorage.removeItem(TK); localStorage.removeItem(TKT) } catch {} }
const APP_URL = location.origin   // le logiciel est servi à la même origine
const infoIcon = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#0a564c" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 11v5"/><circle cx="12" cy="7.3" r=".7" fill="#0a564c" stroke="none"/></svg>'
const toothIcon = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#1d6fd8" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M6 4.5c1.6-1.3 3.4-1.2 5 .2.5.4 1.4.4 1.9 0 1.7-1.4 3.5-1.5 5.1-.2 1.6 1.4 1.7 3.6 1.1 6.3-.5 2.3-.6 3.2-1 5.1-.4 1.9-.8 3.6-1.9 3.6-1.3 0-1.4-2.6-2.4-4.3-.4-.7-1.6-.7-2 0-1 1.7-1.1 4.3-2.4 4.3-1.1 0-1.5-1.7-1.9-3.6-.4-1.9-.5-2.8-1-5.1-.6-2.7-.5-4.9 1.1-6.3Z"/></svg>'
const sv = p => `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${p}</svg>`
const benefitIcons = {
  shield: sv('<path d="M12 3l7 3v5c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6l7-3Z"/><path d="M9 12l2 2 4-4"/>'),
  bolt: sv('<path d="M13 2L4 14h6l-1 8 9-12h-6l1-8Z"/>'),
  users: sv('<circle cx="9" cy="8" r="3"/><path d="M3 20c0-3 3-5 6-5s6 2 6 5"/><path d="M17 7a3 3 0 010 6"/><path d="M21 20c0-2-1.2-3.6-3-4.4"/>'),
  card: sv('<rect x="3" y="5" width="18" height="14" rx="3"/><path d="M3 10h18"/><path d="M7 15h4"/>')
}
const phoneIcon = sv('<path d="M5 4h4l2 5-2.5 1.5a11 11 0 005 5L15 13l5 2v4a2 2 0 01-2 2A16 16 0 013 6a2 2 0 012-2Z"/>')
const mailIcon = sv('<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M4 7l8 6 8-6"/>')
const pinIcon = sv('<path d="M12 21s7-5.5 7-11a7 7 0 10-14 0c0 5.5 7 11 7 11Z"/><circle cx="12" cy="10" r="2.5"/>')
const lockIcon = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px"><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 018 0v4"/></svg>'

async function sapi(path, { body, auth, method } = {}) {
  const h = { 'Content-Type': 'application/json' }
  if (auth) { const t = token(); if (t) h.Authorization = 'Bearer ' + t }
  const r = await fetch('/saas' + path, { method: method || (body ? 'POST' : 'GET'), headers: h, body: body ? JSON.stringify(body) : undefined })
  const nt = r.headers.get('X-DL-Token'); if (nt) setToken(nt)              // session glissante
  const j = await r.json().catch(() => ({}))
  if (!r.ok) {
    if (r.status === 401 && auth) { clearToken(); if (j.code === 'AUTH') { location.hash = '#abonnement'; mountPublic('portal') } }
    throw Object.assign(new Error(j.error || 'Erreur'), { status: r.status, code: j.code })
  }
  return j
}
const planLabel = p => ({ trial: 'Essai gratuit 15 jours', '1m': 'Abonnement 1 mois', '1y': 'Abonnement 1 an' }[p] || p)
// Mode « embarqué » : l'espace abonnement peut s'afficher À L'INTÉRIEUR du logiciel
// (dans la zone principale #view, avec la barre latérale), au lieu du plein écran.
let MOUNT_ID = 'app', EMBED = false
const app = () => document.getElementById(EMBED ? MOUNT_ID : 'app') || document.getElementById('app')
const showErr = (id, m) => { const e = document.getElementById(id); if (e) { e.textContent = m; e.style.display = 'block' } }

const APP_YEAR = new Date().getFullYear()
const TOOTHW = '<svg viewBox="0 0 24 24" width="30" height="30" fill="#fff"><path d="M12 2.5c-1.6 0-2.6.6-4 .6-2.2 0-4 1.8-4 4.6 0 2.2.8 3.6 1.4 5.6.6 2 .7 4.6 1.6 6.4.5 1 1.5 1.3 2.2.3.7-1 .8-3.3 1.4-4.4.3-.6.9-.9 1.4-.9s1.1.3 1.4.9c.6 1.1.7 3.4 1.4 4.4.7 1 1.7.7 2.2-.3.9-1.8 1-4.4 1.6-6.4.6-2 1.4-3.4 1.4-5.6 0-2.8-1.8-4.6-4-4.6-1.4 0-2.4-.6-4-.6z"/></svg>'
const LGFEAT = [
  ['shield', 'Patients & dossiers', 'Fiches médicales, schéma dentaire et documents centralisés.'],
  ['bolt', 'Rendez-vous & caisse', 'Agenda, file d’attente, facturation et encaissements.'],
  ['users', 'Équipe & commissions', 'Personnel, salaires et commissions par praticien.'],
  ['card', 'Abonnement intégré', 'Licence, paiement MonCash ou virement — tout au même endroit.']
]
// Même habillage que le logiciel (authShell) : plus de shell « vitrine » séparé.
// `wide` élargit la carte pour l'espace abonnement (licences, étapes, paiement).
const shell = (inner, wide = false) => {
  if (EMBED) return `<div class="subembed${wide ? ' wide' : ''}">${inner}</div>`   // dans le logiciel : pas de shell plein écran
  const lg = !!token()
  return `<div class="auth lg${wide ? ' wide' : ''}">
    <aside class="lgb"><div class="lgglow"></div>
      <div class="lgtop"><span class="lglogo">${TOOTHW}</span><div><b>Dental Assist</b><small>Logiciel de gestion de cabinet dentaire</small></div></div>
      <div class="lgmid"><h1>Toute votre clinique,<br><em>dans un seul logiciel</em></h1><p>Créez votre compte, activez votre licence et ouvrez le logiciel — abonnement et paiement inclus.</p>
        <div class="lgfeat">${LGFEAT.map(([i, t, d]) => `<div><span>${benefitIcons[i]}</span><div><b>${t}</b><small>${d}</small></div></div>`).join('')}</div></div>
      <div class="lgfoot"><span>${lockIcon} Données isolées par cabinet</span></div>
    </aside>
    <main class="lgp"><div class="lgbar"><span class="lgclock">Espace abonnement</span>
      <div class="pub-actions">${lg
        ? `<button class="pub-link" data-pub="portal">Mon abonnement</button><button class="pub-cta" data-pub="signin">Ouvrir le logiciel</button>`
        : `<button class="pub-cta" data-pub="signin">Se connecter</button>`}</div></div>
      <div class="lgc${wide ? ' wide' : ''}"><div class="lgmob"><span class="lglogo sm">${TOOTHW}</span><b>Dental Assist</b></div>${inner}</div>
      <p class="lgcopy">© ${APP_YEAR} Dental Assist · Port-au-Prince, Haïti · +509 34 54 68 96</p></main></div>`
}
function auth(view = 'register') {
  app().innerHTML = shell(`<section class="pub-card"><div class="pub-tabs">
      <button class="${view === 'register' ? 'on' : ''}" data-pub="t-register">Créer un compte</button>
      <button class="${view === 'login' ? 'on' : ''}" data-pub="t-login">J'ai déjà un compte</button></div>
    <div class="pub-note"><span class="ic">${infoIcon}</span><div>Ce compte gère votre <b>abonnement</b> (formules, paiements, licence). L'accès au logiciel de la clinique vient ensuite, avec votre clé de licence.</div></div>
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
  app().innerHTML = shell(`<section class="pub-card"><p class="muted">Chargement de votre espace…</p></section>`, true)
  let me
  try { me = await sapi('/api/account/me', { auth: true }) } catch (e) { if (e.status === 401) { clearToken(); return auth('login') } return app().innerHTML = shell(`<section class="pub-card"><div class="err" style="display:block">${esc(e.message)}</div></section>`, true) }
  const prices = await sapi('/api/prices').catch(() => ({}))
  const lic = (me.licenses || []).find(l => l.status === 'active')
  const licHtml = (me.licenses || []).length ? (me.licenses || []).map(l => `<div class="pp-lic">
      <div class="pp-lic-head"><span class="badge ${l.status === 'active' ? 'ok' : 'bad'}">${l.status === 'active' ? 'Active' : 'Expirée'}</span><b>${planLabel(l.plan)}</b><small>échéance ${fdate(l.ends_at)}</small></div>
      <div class="pp-lic-key"><code>${esc(l.key)}</code><button class="pp-copy" data-copy="${esc(l.key)}">Copier</button><button class="pp-copy alt" data-dl="${esc(l.key)}">Télécharger</button></div>
      <p class="pp-secret">${lockIcon} <b>Gardez cette clé secrète</b> — elle donne accès à votre clinique. Ne la partagez pas.</p></div>`).join('') : ''
  const paid = [['1m', '1 mois', money(prices.PRICE_1M || 1500)], ['1y', '1 an', money(prices.PRICE_1Y || 15000)]]
  const trialBanner = (!lic && !me.trial_used) ? `<div class="pub-trial">
      <span class="tg">Recommandé pour commencer</span>
      <h4>Essai gratuit — 15 jours</h4>
      <p>Toutes les fonctionnalités, sans carte bancaire. Votre licence est émise immédiatement.</p>
      <button class="pub-cta" data-plan="trial">Démarrer l'essai gratuit</button></div>` : ''
  const step = (n, label, sub, state) => `<li class="pp-step ${state}"><span class="pp-num">${state === 'done' ? '✓' : n}</span><div><b>${label}</b><small>${sub}</small></div></li>`
  const prov = !!me.admin_provisioned   // super-admin déjà créé : on ne redemande plus de le créer
  app().innerHTML = shell(`<section class="pub-portal">
    <div class="pp-head">
      <div class="pp-id"><div class="pp-avatar">${esc((me.clinic?.name || 'C').trim()[0] || 'C').toUpperCase()}</div><div><h2>${esc(me.clinic?.name || 'Mon cabinet')}</h2><p class="muted">${esc(me.clinic?.email || '')}</p></div></div>
      ${EMBED ? '' : '<button class="pub-ghost sm" data-pub="logout">Déconnexion</button>'}
    </div>
    ${EMBED ? '' : `<ol class="pp-steps">
      ${step(1, 'Activer une licence', 'Essai ou abonnement', lic ? 'done' : 'on')}
      ${step(2, 'Créer le super-admin', 'Compte propriétaire', prov ? 'done' : (lic ? 'on' : ''))}
      ${step(3, 'Ouvrir le logiciel', 'Onglet Propriétaire', prov ? 'on' : '')}
    </ol>`}
    <div class="err" id="p-err" style="display:none"></div>
    <div class="pub-card pp-sec">
      <h3 class="pub-ttl" style="margin-top:0">Mes licences</h3>
      ${licHtml || '<p class="muted">Aucune licence active. Démarrez votre essai ou choisissez une formule ci-dessous.</p>'}
      ${trialBanner}
      ${!lic ? `<h3 class="pub-ttl">${me.trial_used ? 'Choisir une formule' : 'Ou passez directement à un abonnement'}</h3>
        <div class="pub-plans">${paid.map(p => `<button class="pub-plan" data-plan="${p[0]}"><strong>${p[1]}</strong><span class="pp-price">${p[2]}</span><small>licence émise au paiement</small></button>`).join('')}</div>` : ''}
    </div>
    ${(lic && EMBED) ? `<div class="pub-card pp-sec"><h3 class="pub-ttl" style="margin-top:0">Renouveler ou changer de formule</h3>
      <p class="muted" style="margin:0 0 12px">Payez par MonCash ou virement. La nouvelle licence prend effet dès le paiement confirmé.</p>
      <div class="pub-plans">${paid.map(p => `<button class="pub-plan" data-plan="${p[0]}"><strong>${p[1]}</strong><span class="pp-price">${p[2]}</span><small>licence émise au paiement</small></button>`).join('')}</div></div>` : ''}
    ${(lic && !EMBED && !prov) ? `<div class="pub-card pp-sec">${superAdminCard(me)}</div>` : ''}
    ${(lic && !EMBED && prov) ? `<div class="pub-card pp-sec"><div class="pub-ok"><div class="mark">✓</div><h2>Tout est prêt</h2></div>
      <p class="muted center">Votre super-admin est déjà créé. Ouvrez le logiciel et connectez-vous (onglet Personnel avec e-mail + mot de passe, ou onglet Propriétaire avec votre clé).</p>
      <button class="pub-cta wfull lg" data-pub="signin">Ouvrir le logiciel</button></div>` : ''}
    </section>`, true)
  document.querySelectorAll('[data-plan]').forEach(b => b.onclick = () => choosePlan(b.dataset.plan))
  document.querySelectorAll('[data-copy]').forEach(b => b.onclick = () => { navigator.clipboard?.writeText(b.dataset.copy).then(() => { b.textContent = 'Copié ✓'; setTimeout(() => b.textContent = 'Copier', 1500) }).catch(() => {}) })
  document.querySelectorAll('[data-dl]').forEach(b => b.onclick = () => {
    const content = `DENTAL ASSIST — Clé de licence\r\n\r\nClinique : ${me.clinic?.name || ''}\r\nClé de licence : ${b.dataset.dl}\r\n\r\n⚠ GARDEZ CETTE CLÉ SECRÈTE — elle donne accès à votre clinique.\r\n\r\nPour ouvrir le logiciel :\r\n 1. Créez votre super-admin depuis « Mon abonnement ».\r\n 2. Connectez-vous à l'onglet « Propriétaire » avec cette clé (code par e-mail),\r\n    ou à l'onglet « Personnel » avec l'e-mail + mot de passe du super-admin.`
    const url = URL.createObjectURL(new Blob([content], { type: 'text/plain;charset=utf-8' }))
    const a = document.createElement('a'); a.href = url; a.download = `licence-dental-assist.txt`; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url)
  })
  wireSuperAdmin(me)
  if (preselect) choosePlan(preselect)
}

function superAdminCard(me) {
  return `<h3 class="pub-ttl" style="margin-top:0">Créez votre compte propriétaire</h3>
    <p class="muted" style="margin:0 0 16px">C'est le compte qui ouvre et gère votre clinique.</p>
    <div class="pub-sa">
      <div class="err" id="sa-err" style="display:none"></div>
      <div class="fld"><label>E-mail</label><input id="sa-email" type="email" value="${esc(me.clinic?.email || '')}" autocomplete="email"></div>
      <div class="fld2"><div class="fld"><label>Mot de passe</label><input id="sa-pw" type="password" placeholder="12 caractères min." autocomplete="new-password"></div><div class="fld"><label>Confirmer</label><input id="sa-pw2" type="password" autocomplete="new-password"></div></div>
      <button class="pub-cta wfull" id="sa-go">Créer mon compte propriétaire</button>
      <details class="pub-help"><summary>Comment me connecter ensuite ?</summary>Dans le logiciel, onglet <b>Personnel</b> : votre e-mail + mot de passe.</details>
    </div>`
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
      app().innerHTML = shell(`<section class="pub-card">
        <div class="pub-ok"><div class="mark">✓</div><h2>Super-admin ${r.created ? 'créé' : 'déjà actif'}</h2></div>
        <p class="muted center">Dernière étape pour entrer dans le logiciel.</p>
        <div class="pub-note"><span class="ic">${infoIcon}</span><div>Cliquez sur <b>Ouvrir le logiciel</b>, onglet <b>Personnel</b>, puis connectez-vous avec :<br><b>${esc(email)}</b> + le mot de passe que vous venez de choisir.<br><span class="muted">(Autre possibilité : onglet Propriétaire avec la clé ci-dessous + un code e-mail.)</span></div></div>
        <div class="fld"><label>Votre clé de licence (à garder secrète)</label><code class="pub-key">${esc(r.license_key)}</code></div>
        <button class="pub-cta wfull lg" data-pub="signin">Ouvrir le logiciel</button></section>`, true)
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

// Navigation déléguée (data-pub) — plus aucune page marketing, tout vit dans le logiciel.
const toClinicLogin = () => { location.hash = '#connexion'; if (window.DL_showClinicLogin) window.DL_showClinicLogin() }
function onClick(e) {
  const el = e.target.closest && e.target.closest('[data-pub]'); if (!el) return
  const a = el.getAttribute('data-pub'); e.preventDefault()
  if (a === 'create' || a === 't-register') return auth('register')
  if (a === 'login' || a === 'portal') return portal()
  if (a === 't-login') return auth('login')
  if (a === 'logout') { clearToken(); return toClinicLogin() }
  if (a === 'signin') return toClinicLogin()
}

export function mountPublic(view = 'account') {
  EMBED = false; MOUNT_ID = 'app'
  document.removeEventListener('click', onClick); document.addEventListener('click', onClick)
  if (view === 'portal') return token() ? portal() : auth('login')
  return token() ? portal() : auth('register')
}

// Monte l'espace abonnement À L'INTÉRIEUR du logiciel (zone #view), avec la barre latérale.
export function mountInApp(elId = 'view') {
  EMBED = true; MOUNT_ID = elId
  document.removeEventListener('click', onClick); document.addEventListener('click', onClick)
  return token() ? portal() : auth('login')
}
