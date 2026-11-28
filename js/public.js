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
const app = () => document.getElementById('app')
const showErr = (id, m) => { const e = document.getElementById(id); if (e) { e.textContent = m; e.style.display = 'block' } }

const footer = () => `<footer class="pub-foot"><div class="pub-foot-base" style="text-align:center">© ${new Date().getFullYear()} Dental Assist · <a href="tel:+50934546896">+509 34 54 68 96</a> · <a href="mailto:dentalassist@gmail.com">dentalassist@gmail.com</a> · Port-au-Prince, Haïti</div></footer>`

// En-tête minimal (plus de vitrine marketing) : marque + accès connexion
const shell = (inner, active = '') => {
  const lg = !!token()
  return `<div class="pub"><header class="pub-top"><div class="pub-top-in">
    <button class="pub-brand" data-pub="signin"><span class="pub-logo">D</span> Dental Assist</button>
    <div class="pub-actions">${lg
      ? `<button class="pub-link" data-pub="portal">Mon abonnement</button><button class="pub-cta" data-pub="signin">Ouvrir le logiciel</button>`
      : `<button class="pub-cta" data-pub="signin">Se connecter</button>`}</div>
    </div></header>
  <main class="pub-main">${inner}</main>
  ${footer()}</div>`
}

const FEATURES = [
  ['Patients & dossiers', 'Dossiers complets, schéma dentaire, antécédents, documents et consentements.'],
  ['Rendez-vous & salle d\'attente', 'Agenda, file d\'attente temps réel, rappels et suivi des parcours.'],
  ['Facturation & caisse', 'Devis, factures, encaissements multi-devises, reçus thermiques, dépenses.'],
  ['Stock & achats', 'Inventaire, consommations, demandes et réceptions d\'achats, laboratoire.'],
  ['Personnel & paie', 'Employés, salaires, commissions par praticien, retenues et fiches de paie.'],
  ['Rapports & sécurité', 'Tableaux de bord, journal d\'activité, rôles, double authentification.']
]

function landing() {
  const appt = (t, who, what, pill, cls = '') => `<div class="pub-appt"><time>${t}</time><span class="tooth">${toothIcon}</span><div><div class="who">${who}</div><div class="what">${what}</div></div><span class="pill ${cls}">${pill}</span></div>`
  app().innerHTML = shell(`
    <section class="pub-hero">
      <div class="pub-hero-copy">
        <span class="pub-eyebrow">Logiciel de cabinet dentaire · 100 % en ligne</span>
        <h1>Gérez tout votre cabinet, <b>d'un seul endroit.</b></h1>
        <p class="pub-lead">Patients, rendez-vous, facturation, caisse, stock, paie et rapports — en ligne et sécurisé. Les données de chaque clinique restent isolées, visibles par elle seule.</p>
        <div class="pub-hero-btns"><button class="pub-cta lg" data-pub="create">Créer un compte</button><button class="pub-ghost lg" data-pub="signin">Se connecter</button></div>
        <div class="pub-trust"><span>Essai gratuit 15 jours</span><span>Sans carte bancaire</span><span>MonCash & virement</span></div>
      </div>
      <aside class="pub-glance" aria-hidden="true">
        <div class="pub-glance-top"><b><span class="pub-glance-dot"></span>Aujourd'hui</b><small>6 rendez-vous</small></div>
        ${appt('08:30', 'Marie L.', 'Détartrage', 'Terminé')}
        ${appt('09:15', 'Jean P.', 'Contrôle + radio', 'En salle', 'wait')}
        ${appt('10:00', 'Rose D.', 'Extraction', 'À venir')}
        ${appt('11:00', 'Carl B.', 'Pose couronne', 'À venir')}
      </aside>
    </section>
    <p class="pub-sec-label">Tout ce dont le cabinet a besoin</p>
    <section class="pub-feats">${FEATURES.map(([t, d]) => `<div class="pub-feat"><h3>${esc(t)}</h3><p>${esc(d)}</p></div>`).join('')}</section>
    <p class="pub-sec-label">Comment démarrer</p>
    <section class="pub-how"><ol class="pub-steps">
      <li class="pub-step"><b>Créez votre compte</b><p>Inscrivez votre cabinet et choisissez une formule. L'essai de 15 jours est gratuit, sans carte.</p></li>
      <li class="pub-step"><b>Activez votre licence</b><p>L'essai s'active aussitôt. Pour un abonnement payant, réglez par MonCash ou virement : la licence s'émet dès confirmation.</p></li>
      <li class="pub-step"><b>Ouvrez le logiciel</b><p>Créez votre super-admin, puis connectez-vous avec votre clé de licence et un code reçu par e-mail.</p></li>
    </ol></section>

    <section class="pub-why">
      <div class="pub-why-head"><h2>Pensé pour la réalité des cabinets</h2><p>Simple à prendre en main, fiable même avec une connexion capricieuse, et sérieux sur la sécurité de vos données.</p></div>
      <div class="pub-why-grid">
        <div class="pub-why-card"><div class="pub-why-ic">${benefitIcons.shield}</div><h3>Vos données vous appartiennent</h3><p>Chaque clinique est isolée : vos patients, vos chiffres et vos documents ne sont visibles que par votre équipe. Jamais partagés avec une autre clinique.</p></div>
        <div class="pub-why-card"><div class="pub-why-ic">${benefitIcons.bolt}</div><h3>Rapide, même hors ligne partielle</h3><p>Interface légère, recherche instantanée, impression des reçus sur imprimante thermique 58/80 mm. Rien à installer.</p></div>
        <div class="pub-why-card"><div class="pub-why-ic">${benefitIcons.users}</div><h3>Toute l'équipe, chacun son rôle</h3><p>Propriétaire, dentistes, secrétariat, comptable, stock : des permissions claires et un journal d'activité pour la traçabilité.</p></div>
        <div class="pub-why-card"><div class="pub-why-ic">${benefitIcons.card}</div><h3>Paiements adaptés à Haïti</h3><p>Facturation multi-devises (HTG / USD), encaissements, dettes patients, et abonnement réglé par MonCash ou virement bancaire.</p></div>
      </div>
    </section>

    <section class="pub-cta-band">
      <div><h2>Essayez gratuitement pendant 15 jours</h2><p>Toutes les fonctionnalités, sans carte bancaire. Vous ne payez que si le logiciel vous convient.</p></div>
      <div class="pub-cta-band-btns"><button class="pub-cta lg" data-pub="create">Créer mon compte</button><button class="pub-ghost lg oninv" data-pub="pricing">Voir les tarifs</button></div>
    </section>`, 'home')
}

// En-tête de page de contenu (vitrine)
const pageHead = (eyebrow, title, lead) => `<section class="pub-phead"><span class="pub-eyebrow">${esc(eyebrow)}</span><h1>${esc(title)}</h1>${lead ? `<p class="pub-lead center">${esc(lead)}</p>` : ''}</section>`

// Détail des fonctionnalités
const FEAT_DETAIL = [
  ['Patients & dossiers', 'Le dossier clinique complet, toujours à portée.', ['Fiche patient, antécédents et allergies', 'Schéma dentaire interactif', 'Documents, radios et consentements', 'Historique des soins et des paiements']],
  ['Rendez-vous & salle d\'attente', 'L\'agenda et le flux de la journée, en temps réel.', ['Agenda par praticien', 'File d\'attente et suivi des parcours', 'Statuts : planifié, confirmé, en salle, terminé', 'Rappels aux patients']],
  ['Facturation & caisse', 'De le devis au reçu, sans fuite.', ['Devis et factures multi-devises (HTG / USD)', 'Encaissements et dettes patients', 'Reçus thermiques 58 / 80 mm', 'Caisse, dépenses et taux de change']],
  ['Stock & achats', 'Ne tombez plus jamais en rupture.', ['Inventaire et consommations', 'Demandes et réceptions d\'achats', 'Suivi laboratoire / prothèses', 'Alertes de seuil']],
  ['Personnel & paie', 'Votre équipe, payée juste.', ['Employés et rôles', 'Salaires et fiches de paie', 'Commissions par praticien', 'Retenues et avances']],
  ['Rapports & sécurité', 'Pilotez, et dormez tranquille.', ['Tableaux de bord et rapports', 'Journal d\'activité (traçabilité)', 'Rôles et permissions fines', 'Double authentification']]
]
function features() {
  app().innerHTML = shell(pageHead('Fonctionnalités', 'Tout votre cabinet, dans un seul outil', 'Six modules qui couvrent le quotidien d\'un cabinet dentaire, du premier rendez-vous au bilan de fin de mois.')
    + `<section class="pub-featx">${FEAT_DETAIL.map(([t, s, items]) => `<article class="pub-featx-card">
        <h3>${esc(t)}</h3><p class="pub-featx-sub">${esc(s)}</p>
        <ul>${items.map(i => `<li>${esc(i)}</li>`).join('')}</ul></article>`).join('')}</section>
    <section class="pub-cta-band"><div><h2>Voyez-le sur vos propres données</h2><p>Créez un compte et testez gratuitement pendant 15 jours.</p></div>
      <div class="pub-cta-band-btns"><button class="pub-cta lg" data-pub="create">Créer mon compte</button></div></section>`, 'features')
}

// Tarifs
async function pricing() {
  const prices = await sapi('/api/prices').catch(() => ({}))
  const m = money(prices.PRICE_1M || 1500), y = money(prices.PRICE_1Y || 15000)
  const feats = FEATURES.map(f => f[0])
  const card = (tag, name, price, per, cls, note) => `<div class="pub-price ${cls}">${tag ? `<span class="pp-tag">${tag}</span>` : ''}
    <h3>${name}</h3><div class="pp-amount">${price}<small>${per}</small></div>
    <p class="pp-note">${note}</p>
    <ul class="pp-list">${feats.map(f => `<li>${esc(f)}</li>`).join('')}</ul>
    <button class="pub-cta wfull ${cls === 'feat' ? '' : 'alt'}" data-pub="create">Commencer</button></div>`
  app().innerHTML = shell(pageHead('Tarifs', 'Un prix simple, sans surprise', 'Toutes les fonctionnalités dans chaque formule. Vous payez seulement l\'abonnement — aucun frais caché, aucune commission sur vos encaissements.')
    + `<section class="pub-prices">
      ${card('Gratuit', 'Essai', '15 jours', '', 'feat', 'Toutes les fonctionnalités, sans carte bancaire.')}
      ${card('', 'Mensuel', m, ' / mois', '', 'Idéal pour démarrer ou pour une activité saisonnière.')}
      ${card('Meilleure offre', 'Annuel', y, ' / an', '', 'Le tarif le plus avantageux pour une clinique installée.')}
    </section>
    <p class="muted center">Paiement par MonCash ou virement bancaire. La licence est émise dès confirmation du paiement.</p>`, 'pricing')
}

// FAQ — comment utiliser la plateforme
const FAQ = [
  ['Quelle est la différence entre « Mon abonnement » et « Se connecter » ?', 'Votre <b>compte abonné</b> (Mon abonnement) sert à gérer votre formule, vos paiements et votre licence. Le <b>logiciel</b> de la clinique est un accès séparé : on y entre avec sa clé de licence (propriétaire) ou avec ses identifiants fournis par l\'administrateur (personnel).'],
  ['Comment démarrer concrètement ?', 'Créez un compte, cliquez sur « Démarrer l\'essai gratuit » pour activer votre licence, puis « Créer mon super-admin ». Vous vous connectez ensuite au logiciel via l\'onglet <b>Propriétaire</b> avec votre clé de licence et un code reçu par e-mail.'],
  ['Comment se connecter en tant que propriétaire ?', 'Sur l\'écran de connexion, choisissez l\'onglet <b>Propriétaire</b>, saisissez votre clé de licence (format DNTL-…) et validez : un code à 6 chiffres est envoyé à l\'e-mail du super-admin. Ce double contrôle protège l\'accès total au cabinet.'],
  ['Comment ajouter mes employés ?', 'Une fois connecté en propriétaire, ouvrez la page <b>Utilisateurs</b> : créez chaque membre (dentiste, secrétaire, comptable…), attribuez son rôle et ses permissions. Chacun se connecte ensuite via l\'onglet <b>Personnel</b> avec e-mail et mot de passe.'],
  ['Mes données sont-elles en sécurité ?', 'Oui. Chaque clinique est strictement isolée : vos données ne sont visibles que par votre équipe, jamais par une autre clinique. Les mots de passe sont chiffrés, et vous pouvez activer la double authentification.'],
  ['Comment payer mon abonnement ?', 'Depuis « Mon abonnement », choisissez une formule et réglez par <b>MonCash</b> ou par <b>virement bancaire</b> (en téléversant la preuve). Votre licence s\'active dès que le paiement est confirmé.'],
  ['Puis-je l\'utiliser sur téléphone ?', 'Oui, l\'application est responsive et fonctionne dans le navigateur de votre téléphone, tablette ou ordinateur — rien à installer.'],
  ['Que se passe-t-il à la fin de l\'essai ?', 'Vos données sont conservées. Il vous suffit de choisir une formule payante depuis « Mon abonnement » pour continuer sans interruption.']
]
function faq() {
  app().innerHTML = shell(pageHead('FAQ', 'Questions fréquentes', 'Tout ce qu\'il faut savoir pour bien démarrer et utiliser la plateforme au quotidien.')
    + `<section class="pub-faq">${FAQ.map(([q, a], i) => `<details class="pub-faq-item"${i === 0 ? ' open' : ''}><summary>${esc(q)}</summary><div class="pub-faq-a">${a}</div></details>`).join('')}</section>
    <section class="pub-cta-band"><div><h2>Une autre question ?</h2><p>Notre équipe vous répond.</p></div>
      <div class="pub-cta-band-btns"><button class="pub-cta lg" data-pub="contact">Nous contacter</button></div></section>`, 'faq')
}

// À propos
function about() {
  app().innerHTML = shell(pageHead('À propos', 'Un logiciel dentaire, fait pour Haïti', '')
    + `<section class="pub-about">
      <p class="pub-about-lead">Dental Assist est né d\'un constat simple : les cabinets dentaires méritent un outil moderne, fiable et abordable, adapté à la réalité locale — connexion variable, paiements MonCash, facturation en gourdes comme en dollars.</p>
      <div class="pub-about-grid">
        <div><h3>Notre mission</h3><p>Rendre la gestion d\'un cabinet aussi simple que possible, pour que les praticiens se concentrent sur leurs patients et non sur la paperasse.</p></div>
        <div><h3>Pour qui ?</h3><p>Des cabinets d\'un seul praticien aux cliniques avec plusieurs dentistes, secrétaires, comptables et gestionnaires de stock.</p></div>
        <div><h3>Notre engagement</h3><p>La sécurité et la confidentialité d\'abord : vos données restent les vôtres, isolées et protégées. Nous ne les partageons avec personne.</p></div>
        <div><h3>Sur place</h3><p>Une équipe joignable à Port-au-Prince, par téléphone et par e-mail, qui connaît votre contexte.</p></div>
      </div></section>
    <section class="pub-cta-band"><div><h2>Rejoignez les cabinets qui se simplifient la vie</h2><p>Essai gratuit de 15 jours, sans engagement.</p></div>
      <div class="pub-cta-band-btns"><button class="pub-cta lg" data-pub="create">Commencer</button></div></section>`, 'about')
}

// Contact
function contact() {
  app().innerHTML = shell(pageHead('Contact', 'Parlons de votre cabinet', 'Une question, une démo, un besoin particulier ? Écrivez-nous — nous répondons vite.')
    + `<section class="pub-contact">
      <div class="pub-contact-info">
        <a class="pub-contact-row" href="tel:+50934546896"><span class="ci-ic">${phoneIcon}</span><div><h4>Téléphone</h4><p>+509 34 54 68 96</p></div></a>
        <a class="pub-contact-row" href="mailto:dentalassist@gmail.com"><span class="ci-ic">${mailIcon}</span><div><h4>E-mail</h4><p>dentalassist@gmail.com</p></div></a>
        <div class="pub-contact-row"><span class="ci-ic">${pinIcon}</span><div><h4>Adresse</h4><p>Port-au-Prince, Haïti</p></div></div>
      </div>
      <form class="pub-contact-form" id="cform">
        <div class="fld"><label>Votre nom</label><input id="cf-name" placeholder="Dr…"></div>
        <div class="fld"><label>E-mail</label><input id="cf-email" type="email" placeholder="vous@cabinet.com"></div>
        <div class="fld"><label>Message</label><textarea id="cf-msg" rows="5" placeholder="Comment pouvons-nous vous aider ?"></textarea></div>
        <button class="pub-cta wfull" type="submit">Envoyer le message</button>
      </form></section>`, 'contact')
  const f = document.getElementById('cform')
  if (f) f.onsubmit = e => { e.preventDefault()
    const subj = encodeURIComponent('Demande — ' + (val('cf-name') || 'Cabinet'))
    const body = encodeURIComponent((document.getElementById('cf-msg')?.value || '') + '\n\n— ' + (val('cf-name') || '') + ' (' + (val('cf-email') || '') + ')')
    location.href = `mailto:dentalassist@gmail.com?subject=${subj}&body=${body}` }
}

// ── Compte abonné : créer / se connecter ──
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
  app().innerHTML = shell(`<section class="pub-card"><p class="muted">Chargement de votre espace…</p></section>`)
  let me
  try { me = await sapi('/api/account/me', { auth: true }) } catch (e) { if (e.status === 401) { clearToken(); return auth('login') } return app().innerHTML = shell(`<section class="pub-card"><div class="err" style="display:block">${esc(e.message)}</div></section>`) }
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
  app().innerHTML = shell(`<section class="pub-portal">
    <div class="pp-head">
      <div class="pp-id"><div class="pp-avatar">${esc((me.clinic?.name || 'C').trim()[0] || 'C').toUpperCase()}</div><div><h2>${esc(me.clinic?.name || 'Mon cabinet')}</h2><p class="muted">${esc(me.clinic?.email || '')}</p></div></div>
      <button class="pub-ghost sm" data-pub="logout">Déconnexion</button>
    </div>
    <ol class="pp-steps">
      ${step(1, 'Activer une licence', 'Essai ou abonnement', lic ? 'done' : 'on')}
      ${step(2, 'Créer le super-admin', 'Compte propriétaire', lic ? 'on' : '')}
      ${step(3, 'Ouvrir le logiciel', 'Onglet Propriétaire', '')}
    </ol>
    <div class="err" id="p-err" style="display:none"></div>
    <div class="pub-card pp-sec">
      <h3 class="pub-ttl" style="margin-top:0">Mes licences</h3>
      ${licHtml || '<p class="muted">Aucune licence active. Démarrez votre essai ou choisissez une formule ci-dessous.</p>'}
      ${trialBanner}
      ${!lic ? `<h3 class="pub-ttl">${me.trial_used ? 'Choisir une formule' : 'Ou passez directement à un abonnement'}</h3>
        <div class="pub-plans">${paid.map(p => `<button class="pub-plan" data-plan="${p[0]}"><strong>${p[1]}</strong><span class="pp-price">${p[2]}</span><small>licence émise au paiement</small></button>`).join('')}</div>` : ''}
    </div>
    ${lic ? `<div class="pub-card pp-sec">${superAdminCard(me)}</div>` : ''}
    </section>`)
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
  return `<h3 class="pub-ttl">Ouvrir le logiciel</h3>
    <div class="pub-sa"><p class="muted">Créez le compte <b>propriétaire</b> (super-admin) de votre clinique. Vous vous connecterez ensuite au logiciel avec cet <b>e-mail + mot de passe</b> (onglet <b>Personnel</b>) — ou via l'onglet <b>Propriétaire</b> avec votre clé de licence et un code e-mail.</p>
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
      app().innerHTML = shell(`<section class="pub-card">
        <div class="pub-ok"><div class="mark">✓</div><h2>Super-admin ${r.created ? 'créé' : 'déjà actif'}</h2></div>
        <p class="muted center">Dernière étape pour entrer dans le logiciel.</p>
        <div class="pub-note"><span class="ic">${infoIcon}</span><div>Cliquez sur <b>Ouvrir le logiciel</b>, onglet <b>Personnel</b>, puis connectez-vous avec :<br><b>${esc(email)}</b> + le mot de passe que vous venez de choisir.<br><span class="muted">(Autre possibilité : onglet Propriétaire avec la clé ci-dessous + un code e-mail.)</span></div></div>
        <div class="fld"><label>Votre clé de licence (à garder secrète)</label><code class="pub-key">${esc(r.license_key)}</code></div>
        <button class="pub-cta wfull lg" data-pub="signin">Ouvrir le logiciel</button></section>`)
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
const VPAGES = { home: landing, features, pricing, faq, about, contact }
function onClick(e) {
  const el = e.target.closest && e.target.closest('[data-pub]'); if (!el) return
  const a = el.getAttribute('data-pub'); e.preventDefault()
  const root = document.querySelector('.pub')
  if (a === 'menu') { root?.classList.toggle('menu-open'); return }
  root?.classList.remove('menu-open')   // referme le menu mobile à chaque navigation
  if (VPAGES[a]) { VPAGES[a](); window.scrollTo({ top: 0, behavior: 'smooth' }); return }
  if (a === 'create') return auth('register')
  if (a === 'login' || a === 'portal') return portal()
  if (a === 't-register') return auth('register')
  if (a === 't-login') return auth('login')
  if (a === 'logout') { clearToken(); return landing() }
  if (a === 'signin') { location.hash = '#connexion'; if (window.DL_showClinicLogin) window.DL_showClinicLogin() }
}

export function mountPublic(view = 'account') {
  document.removeEventListener('click', onClick); document.addEventListener('click', onClick)
  if (view === 'portal') return token() ? portal() : auth('login')
  if (view === 'account') return token() ? portal() : auth('register')
  landing()
}
