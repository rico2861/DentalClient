// ═══ Tableau de bord adapté à chaque rôle ═══
// Direction · Finances · Direction médicale · Médecin · Accueil (secrétaire / assistant·e) · Stock · Autres.
// Chaque bloc n'apparaît qu'avec les droits correspondants ; les montants suivent le mode discrétion.
import { ic } from './icons.js'
import { privacy } from './privacy.js'
import { money } from './kit.js'
export default function install({ $, esc, api, can, toast, render, me }) {
  const TZ = 'America/Port-au-Prince'
  const num = v => Number(v) || 0, H = v => money(num(v), 'HTG')
  const short = v => { v = num(v); const a = Math.abs(v); return a >= 1e6 ? (v / 1e6).toFixed(1).replace('.', ',') + ' M' : a >= 1e4 ? Math.round(v / 1e3) + ' k' : Math.round(v).toLocaleString('fr-FR') }
  const MON = m => { const [y, mo] = String(m).split('-').map(Number); return new Date(y, mo - 1, 1).toLocaleDateString('fr-FR', { month: 'short' }).replace('.', '') }
  const tm = d => new Date(d).toLocaleTimeString('fr-FR', { timeZone: TZ, hour: '2-digit', minute: '2-digit' })
  const fdt = d => new Date(d).toLocaleString('fr-FR', { timeZone: TZ, day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
  const today = () => new Date().toLocaleDateString('en-CA', { timeZone: TZ })
  const ROLE = { OWNER: 'Direction', ADMIN: 'Administration', ADMIN_MEDICAL: 'Direction médicale', ADMIN_FINANCIER: 'Direction financière', ACCOUNTANT: 'Comptabilité', DENTIST: 'Médecin dentiste', DENTAL_ASSISTANT: 'Assistant(e) dentaire', SECRETARY: 'Accueil · secrétariat', STOCK_MANAGER: 'Gestion du stock', DENTAL_TECH: 'Prothésiste', STAFF: 'Personnel' }
  const profile = r => ['OWNER', 'ADMIN'].includes(r) ? 'direction' : ['ADMIN_FINANCIER', 'ACCOUNTANT'].includes(r) ? 'finance' : r === 'ADMIN_MEDICAL' ? 'medical' : r === 'DENTIST' ? 'doctor' : ['SECRETARY', 'DENTAL_ASSISTANT'].includes(r) ? 'reception' : r === 'STOCK_MANAGER' ? 'stock' : 'other'
  let per = 'month', chartRange = 12, liveTimer = null, packT = null
  const pack = () => document.querySelectorAll('.zdcols[data-pack]').forEach(g => {
    const w = g.clientWidth, k = w >= 900 ? 3 : w >= 560 ? 2 : 1, cards = [...g.querySelectorAll(':scope > .zdcard, :scope > .zdcol > .zdcard')]
    cards.forEach((c, i) => { if (c.dataset.o == null) c.dataset.o = i }); cards.sort((a, b) => (+a.dataset.o || 0) - (+b.dataset.o || 0))
    if (+g.dataset.k === k && +g.dataset.n === cards.length) return
    const cols = Array.from({ length: k }, () => Object.assign(document.createElement('div'), { className: 'zdcol' })), h = Array(k).fill(0)
    g.style.gridTemplateColumns = `repeat(${k}, minmax(0, 1fr))`; g.replaceChildren(...cols)
    for (const c of cards) { const i = h.indexOf(Math.min(...h)); cols[i].append(c); h[i] += c.offsetHeight + 16 }
    g.dataset.k = k; g.dataset.n = cards.length })
  addEventListener('resize', () => { clearTimeout(packT); packT = setTimeout(() => { document.querySelectorAll('.zdcols[data-pack]').forEach(g => delete g.dataset.k); pack() }, 150) })
  // mise en page : pleine largeur, ligne « grand graphique + carte », puis groupes de cartes répartis en colonnes
  const layout = blocks => { const out = []; let grp = []
    const flush = () => { if (grp.length) out.push(`<div class="zdcols" data-pack>${grp.join('')}</div>`); grp = [] }
    for (let i = 0; i < blocks.length; i++) { const b = blocks[i], wide = /^<section class="zdcard [^"]*zspan3/.test(b), half = /^<section class="zdcard [^"]*zspan2/.test(b)
      if (wide) { flush(); out.push(b) }
      else if (half) { flush(); const nx = blocks[i + 1]; if (nx && !/^<section class="zdcard [^"]*zspan[23]/.test(nx)) { out.push(`<div class="zdrow2">${b}${nx}</div>`); i++ } else out.push(b) }
      else grp.push(b) }
    flush(); return out.join('') }
  const hidden = () => privacy.on   // montants masqués : pas de valeurs sur les axes ni dans les infobulles

  // ── petits graphiques SVG (responsive, infobulles au survol) ──
  const spark = (vals, color = 'currentColor') => { if (!vals?.length || vals.every(v => !v)) return ''; const mx = Math.max(...vals, 1), w = 100, h = 28, st = vals.length > 1 ? w / (vals.length - 1) : w
    const pts = vals.map((v, i) => `${(i * st).toFixed(1)},${(h - 2 - v / mx * (h - 4)).toFixed(1)}`).join(' ')
    return `<svg class="zdkspark" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-hidden="true"><polyline points="${pts}" fill="none" stroke="${color}" stroke-width="2" vector-effect="non-scaling-stroke" stroke-linecap="round" stroke-linejoin="round"/></svg>` }
  const area = (labels, series, { money: isMoney = true } = {}) => {
    const W = 640, Hh = 230, L = 46, B = 26, T = 12, R = 10, n = labels.length, all = series.flatMap(s => s.v), mx = Math.max(...all, 1) * 1.1
    const x = i => L + (n > 1 ? i * (W - L - R) / (n - 1) : (W - L - R) / 2), y = v => T + (Hh - T - B) * (1 - num(v) / mx)
    const grid = [0, .25, .5, .75, 1].map(f => `<line x1="${L}" x2="${W - R}" y1="${y(mx * f)}" y2="${y(mx * f)}" class="zdgl"/>${hidden() && isMoney ? '' : `<text x="${L - 6}" y="${y(mx * f) + 4}" class="zdgy">${short(mx * f / 1.1 * 1.1)}</text>`}`).join('')
    const xl = labels.map((l, i) => (n <= 12 || i % Math.ceil(n / 12) === 0) ? `<text x="${x(i)}" y="${Hh - 6}" class="zdgx">${esc(l)}</text>` : '').join('')
    const paths = series.map((s, si) => { const d = s.v.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ')
      return `${si === 0 ? `<path d="${d} L${x(n - 1)},${y(0)} L${x(0)},${y(0)} Z" fill="url(#dga${si})" opacity=".9"/>` : ''}<path d="${d}" fill="none" stroke="${s.c}" stroke-width="2.4" stroke-linejoin="round" stroke-linecap="round"/>` }).join('')
    const hit = labels.map((l, i) => `<g class="zdgh"><rect x="${x(i) - (W - L - R) / Math.max(1, n - 1) / 2}" y="${T}" width="${(W - L - R) / Math.max(1, n - 1)}" height="${Hh - T - B}" fill="transparent"/><line x1="${x(i)}" x2="${x(i)}" y1="${T}" y2="${Hh - B}" class="zdgv"/>${series.map(s => `<circle cx="${x(i)}" cy="${y(s.v[i])}" r="4" fill="#fff" stroke="${s.c}" stroke-width="2"/>`).join('')}<title>${esc(l)} — ${series.map(s => `${s.n} : ${hidden() && isMoney ? '•••' : isMoney ? H(s.v[i]) : s.v[i]}`).join(' · ')}</title></g>`).join('')
    return `<svg class="zdgc" viewBox="0 0 ${W} ${Hh}" role="img" aria-label="Graphique"><defs>${series.map((s, si) => `<linearGradient id="dga${si}" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="${s.c}" stop-opacity=".28"/><stop offset="1" stop-color="${s.c}" stop-opacity="0"/></linearGradient>`).join('')}</defs>${grid}${paths}${xl}${hit}</svg>
      <div class="zdgleg">${series.map(s => `<span><i style="background:${s.c}"></i>${esc(s.n)}</span>`).join('')}</div>` }
  const bars = (items, { money: isMoney = false, color = '#1d6fd8' } = {}) => { if (!items?.length) return '<p class="muted zdnone">Aucune donnée pour la période.</p>'; const mx = Math.max(...items.map(i => num(i.v)), 1)
    return `<div class="zdbars">${items.map(i => `<div class="zdbar" title="${esc(i.label)} : ${hidden() && isMoney ? '•••' : isMoney ? H(i.v) : i.v}"><span class="zdbl">${esc(i.label)}</span><span class="zdbt"><i style="width:${Math.max(3, num(i.v) / mx * 100)}%;background:${color}"></i></span><b>${isMoney ? (hidden() ? '•••' : short(i.v)) : i.v}</b></div>`).join('')}</div>` }
  const donut = items => { const tot = items.reduce((s, i) => s + num(i.v), 0); if (!tot) return '<p class="muted zdnone">Aucun encaissement sur la période.</p>'
    const C = ['#1d6fd8', '#16a394', '#e08a00', '#7c5cf0', '#e5484d', '#0ea5e9', '#64748b']; let a = 0
    const seg = items.map((i, k) => { const f = num(i.v) / tot, s = `<circle r="15.9" cx="20" cy="20" fill="none" stroke="${C[k % C.length]}" stroke-width="6" stroke-dasharray="${(f * 100).toFixed(2)} ${(100 - f * 100).toFixed(2)}" stroke-dashoffset="${(25 - a).toFixed(2)}"><title>${esc(i.label)} : ${Math.round(f * 100)} %</title></circle>`; a += f * 100; return s }).join('')
    return `<div class="zddn"><svg viewBox="0 0 40 40" class="zddsvg">${seg}<text x="20" y="21.5" class="zddt">${items.length}</text><text x="20" y="26" class="zdds">modes</text></svg><div class="zddl">${items.map((i, k) => `<div><i style="background:${C[k % C.length]}"></i><span>${esc(i.label)}</span><b>${Math.round(num(i.v) / tot * 100)} %</b></div>`).join('')}</div></div>` }

  // ── éléments d'interface ──
  const kpi = (o) => `<a class="zdk t-${o.t}" href="${o.href || '#tableau-de-bord'}"><div class="zdkh"><span class="zdki">${ic(o.i, 18)}</span><span class="zdkl">${esc(o.l)}</span>${o.d != null && isFinite(o.d) ? `<span class="zdkd ${o.d >= 0 ? (o.inv ? 'bad' : 'good') : (o.inv ? 'good' : 'bad')}">${ic(o.d >= 0 ? 'up' : 'down', 11)}${Math.abs(Math.round(o.d))} %</span>` : ''}</div><b class="zdkv">${o.v}</b><small class="zdks">${o.s || ''}</small>${o.sp || ''}</a>`
  const sec = (title, icon, body, { action = '', cls = '', id = '' } = {}) => `<section class="zdcard ${cls}" ${id ? `id="${id}"` : ''}><div class="zdch"><h3>${ic(icon, 17)}${title}</h3>${action}</div>${body}</section>`
  const delta = (c, p) => num(p) ? (num(c) - num(p)) / Math.abs(num(p)) * 100 : null
  const dismissKey = () => 'dl_recs_' + today()
  const dismissed = () => { try { return new Set(JSON.parse(localStorage.getItem(dismissKey()) || '[]')) } catch { return new Set() } }
  const recsHtml = list => { const off = dismissed(), vis = list.filter(r => !off.has(r.k)), ORD = { danger: 0, warn: 1, info: 2, ok: 3 }
    vis.sort((a, b) => ORD[a.tone || 'info'] - ORD[b.tone || 'info'])
    return sec('Recommandations', 'zap', vis.length ? `<div class="zdrl">${vis.slice(0, 7).map(r => `<div class="zdr ${r.tone || 'info'}" data-rk="${esc(r.k)}"><span class="zdri">${ic(r.i || 'info', 16)}</span><div class="zdrt">${r.text}</div>${r.href ? `<a class="bs" href="${r.href}">${esc(r.cta || 'Voir')}${ic('right', 13)}</a>` : ''}<button class="zdrx" data-rdis="${esc(r.k)}" title="Masquer pour aujourd'hui" aria-label="Masquer">${ic('x', 14)}</button></div>`).join('')}</div>`
      : `<div class="zdok">${ic('check', 18)}<span>Tout est en ordre : aucune action en attente.</span></div>`, { action: off.size ? `<button class="bs" data-rreset="1">Réafficher (${off.size})</button>` : '' }) }
  const timeline = (list, empty) => list?.length ? `<div class="zdtl">${list.map(a => { const t = new Date(a.starts_at), now = Date.now(), end = t.getTime() + (a.duration_min || 30) * 6e4, st = end < now ? 'past' : t <= now ? 'cur' : ''
      return `<a class="zdti ${st}" href="#dossiers/${a.patient_id}"><span class="zdth">${tm(a.starts_at)}</span><span class="zdtd"></span><span class="zdtb"><b>${esc(a.patient)}</b><small>${esc(a.reason || 'Consultation')}${a.doctor ? ' · ' + esc(a.doctor) : ''}</small></span>${st === 'cur' ? '<span class="badge st-ok">en cours</span>' : ''}</a>` }).join('')}</div>` : `<div class="zdempty">${ic('calendar', 22)}<span>${empty}</span></div>`
  const queueWidget = q => { if (!q) return ''; const next = q.waiting.find(t => t.status === 'waiting'), called = q.waiting.filter(t => t.status === 'called')
    return sec('Salle d\'attente · en direct', 'users', `<div class="zdqg"><div class="zdqs w"><b>${q.stats.waiting}</b><span>en attente</span></div><div class="zdqs c"><b>${q.stats.in_consult}</b><span>en consultation</span></div><div class="zdqs d"><b>${q.stats.done}</b><span>reçus</span></div><div class="zdqs n"><b>${q.capacity ? `${q.used}/${q.capacity}` : q.used}</b><span>${q.capacity ? 'capacité' : 'arrivées'}</span></div></div>
      ${called.length ? `<div class="zdqcall">${ic('bell', 15)} Appelé : <b>n° ${String(called[0].number).padStart(3, '0')} · ${esc(called[0].name)}</b></div>` : ''}
      ${next ? `<div class="zdqnext"><span class="zdqn">${String(next.number).padStart(3, '0')}</span><div><small>Prochain</small><b>${esc(next.name)}</b><span class="muted">attend depuis ${Math.round((Date.now() - new Date(next.arrived_at)) / 6e4)} min</span></div><button class="bs pri" data-dq="next">${ic('bell', 13)}Appeler</button></div>` : `<div class="zdempty sm">${ic('check', 18)}<span>Personne n'attend.</span></div>`}`,
      { action: `<a class="bs" href="#salle-attente">Ouvrir${ic('right', 13)}</a>`, id: 'dqw' }) }
  const feed = rows => rows?.length ? `<div class="zdfeed">${rows.slice(0, 8).map(a => `<div class="zdfi"><span class="zdfd"></span><div><b>${esc(a.who?.trim() || 'Système')}</b> <span>${esc(String(a.action).toLowerCase().replace(/_/g, ' '))}</span><small>${fdt(a.created_at)}</small></div></div>`).join('')}</div>` : '<p class="muted zdnone">Aucune activité récente.</p>'

  // ── chargement des données selon les droits ──
  async function load(role) {
    const P = profile(role), get = (p, cond = true) => cond ? api(p).catch(() => null) : Promise.resolve(null)
    const wantOwner = can('view_finances') || can('view_all_patients') || can('manage_inventory') || can('view_salaries')
    const [O, F, S, Q, B, A] = await Promise.all([
      get(`/dashboard/owner?period=${per}&date=${today()}`, wantOwner && P !== 'reception' && P !== 'doctor'),
      get(`/finance/stats?period=${per}&date=${today()}`, can('view_finances') && ['direction', 'finance'].includes(P)),
      get('/me/dashboard'), get('/queue', can('manage_queue')),
      get('/backups', P === 'direction'), get('/audit?limit=8', can('view_audit_logs') && P === 'direction')])
    const I = can('manage_appointments') && ['direction', 'medical', 'doctor', 'reception'].includes(P) ? await get('/intel/reception') : null
    return { P, O, F, S, Q, B, A, I } }

  // ── construction de la page ──
  async function dashboard() {
    const u = me(), role = u.role, d = await load(role), { P, O, F, S, Q, B, A, I } = d, m = O?.medical, f = O?.finance, st = O?.staff, sk = O?.stock, ch = O?.charts || {}
    const hr = new Date().getHours(), greet = hr < 5 || hr >= 18 ? 'Bonsoir' : hr < 12 ? 'Bonjour' : 'Bon après-midi'
    const showPer = ['direction', 'finance', 'medical'].includes(P), PL = { month: 'ce mois', quarter: 'ce trimestre', year: 'cette année' }[per]
    // actions rapides selon le rôle
    const QA = [[P === 'doctor' && can('manage_queue') && Q?.stats.waiting, '', 'users', 'Prendre un patient', 'pnew'], [can('create_patients') && !(P === 'doctor' && Q?.stats.waiting), '#patients', 'plus', 'Nouveau patient', 'pnew'], [can('manage_queue'), '#salle-attente', 'users', 'Salle d\'attente'], [can('manage_appointments'), '#rendez-vous', 'calendar', 'Rendez-vous'],
      [P === 'doctor', '#mon-activite', 'activity', 'Mon activité'], [can('manage_treatment_plans') && P === 'doctor', '#plans-de-traitement', 'clipboard', 'Plans de traitement'],
      [can('view_finances'), '#facturation', 'file', 'Facturation'], [can('view_finances'), '#caisse-depenses', 'wallet', 'Caisse'], [can('manage_inventory'), '#stock', 'package', 'Stock'], [P === 'direction', '#rapports', 'chart', 'Rapports']].filter(x => x[0]).slice(0, 5)
    const hero = `<div class="zdhero2"><div class="zdhl"><span class="zdhrole">${esc(ROLE[role] || role)}</span><h1>${greet}, ${esc(u.first_name)}</h1><p><span data-dclock>${new Date().toLocaleString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })}</span>${S?.today ? ` · <b>${S.today.length}</b> rendez-vous aujourd'hui` : ''}${Q ? ` · <b>${Q.stats.waiting}</b> en attente` : ''}</p></div>
      <div class="zdhr2">${showPer ? `<div class="zdseg2" role="tablist">${[['month', 'Mois'], ['quarter', 'Trimestre'], ['year', 'Année']].map(([k, l]) => `<button type="button" class="${per === k ? 'on' : ''}" data-dper="${k}">${l}</button>`).join('')}</div>` : ''}
        <div class="zdqa">${QA.map(x => x[4] ? `<button type="button" class="zdqab" data-pnew="1">${ic(x[2], 16)}<span>${x[3]}</span></button>` : `<a class="zdqab" href="${x[1]}">${ic(x[2], 16)}<span>${x[3]}</span></a>`).join('')}</div></div></div>`

    // indicateurs clés
    const K = [], recs = []
    if (P === 'direction' || P === 'finance') {
      if (F) K.push({ t: 'green', i: 'dollar', l: 'Encaissé ' + PL, v: H(F.cur.revenue), s: `${F.cur.payments} paiement(s) · ${F.cur.patients} patient(s)`, d: delta(F.cur.revenue, F.prev.revenue), href: '#finances', sp: spark(F.daily.map(x => num(x.v)), '#16a394') })
      if (f) K.push({ t: num(f.profit_period) < 0 ? 'red' : 'blue', i: num(f.profit_period) < 0 ? 'down' : 'up', l: 'Résultat ' + PL, v: H(f.profit_period), s: `dépenses : ${H(f.expenses_period)}`, d: F ? delta(F.cur.revenue - F.cur.expenses, F.prev.revenue - F.prev.expenses) : null, href: '#finances', sp: spark((ch.profit_6m || []).map(x => num(x.v)), '#1d6fd8') })
      if (f) K.push({ t: num(f.receivables_htg) ? 'orange' : 'teal', i: 'receipt', l: 'À recouvrer', v: H(f.receivables_htg), s: F ? `${F.status.unpaid + F.status.partial} facture(s) non soldée(s)` : 'créances patients', href: '#dettes' })
      if (P === 'direction' && m) K.push({ t: 'violet', i: 'users', l: 'Patients actifs', v: m.patients_active, s: `${m.patients_new} nouveau(x) ${PL}`, href: '#patients', sp: spark((ch.patients_6m || []).map(x => num(x.v)), '#7c5cf0') })
      if (P === 'finance' && st) K.push({ t: num(st.pending) ? 'orange' : 'violet', i: 'briefcase', l: 'Salaires à verser', v: H(st.pending), s: `${st.employees} employé(s)`, href: '#personnel-paie' })
      if (P === 'direction' && S?.today) K.push({ t: 'sky', i: 'calendar', l: 'Rendez-vous aujourd\'hui', v: S.today.length, s: S.tomorrow ? `${S.tomorrow.total} demain · ${S.tomorrow.to_confirm} à confirmer` : '', href: '#rendez-vous' })
    } else if (P === 'medical') {
      if (m) K.push({ t: 'blue', i: 'activity', l: 'Consultations aujourd\'hui', v: m.consultations_today, s: `${m.appointments_upcoming} rendez-vous à venir`, href: '#rendez-vous' }, { t: 'violet', i: 'clipboard', l: 'Plans en cours', v: m.plans_in_progress, s: `${m.plans_done} terminé(s)`, href: '#plans-de-traitement' }, { t: 'teal', i: 'users', l: 'Patients actifs', v: m.patients_active, s: `${m.patients_new} nouveau(x) ${PL}`, href: '#patients', sp: spark((ch.patients_6m || []).map(x => num(x.v)), '#16a394') }, { t: m.to_recall ? 'orange' : 'green', i: 'bell', l: 'À rappeler', v: m.to_recall, s: 'suivis en attente', href: '#rendez-vous' })
    } else if (P === 'doctor') {
      const mo = S?.month, ow = S?.owed
      K.push({ t: 'blue', i: 'calendar', l: 'Mes rendez-vous aujourd\'hui', v: S?.today?.length || 0, s: `${S?.week || 0} sur 7 jours`, href: '#rendez-vous' }, { t: 'teal', i: 'activity', l: 'Actes ce mois', v: mo?.services || 0, s: `${mo?.patients || 0} patient(s) soigné(s)`, href: '#mon-activite' },
        { t: 'violet', i: 'wallet', l: 'Ma commission du mois', v: H(mo?.commission || 0), s: mo ? `${mo.pct} % · ${H(mo.collected)} encaissés` : 'taux à définir', href: '#mon-activite', sp: spark((ow?.months || []).slice().reverse().map(x => num(x.commission)), '#7c5cf0') },
        { t: num(ow?.total_due) > 0 ? 'orange' : 'green', i: 'briefcase', l: 'La clinique me doit', v: H(ow?.total_due || 0), s: num(ow?.total_due) > 0 ? 'commissions et paie non versées' : 'tout est versé', href: '#ma-paie' })
    } else if (P === 'reception') {
      K.push({ t: 'blue', i: 'calendar', l: 'Rendez-vous aujourd\'hui', v: S?.today?.length || 0, s: `${(S?.today || []).filter(a => ['done', 'arrived'].includes(a.status)).length} déjà vus`, href: '#rendez-vous' })
      if (Q) K.push({ t: Q.stats.waiting ? 'orange' : 'green', i: 'users', l: 'En salle d\'attente', v: Q.stats.waiting, s: `${Q.stats.in_consult} en consultation · ${Q.stats.done} reçus`, href: '#salle-attente' })
      if (S?.tomorrow) K.push({ t: S.tomorrow.to_confirm ? 'red' : 'teal', i: 'phone', l: 'Demain à confirmer', v: S.tomorrow.to_confirm, s: `${S.tomorrow.total} rendez-vous demain`, href: '#rendez-vous' })
      if (S?.new_patients != null) K.push({ t: 'violet', i: 'users', l: 'Nouveaux patients', v: S.new_patients, s: '7 derniers jours', href: '#patients' })
    } else if (P === 'stock') {
      if (sk) K.push({ t: 'blue', i: 'package', l: 'Valeur du stock', v: H(sk.value), s: `achats ${PL} : ${H(sk.purchases_period)}`, href: '#stock' }, { t: sk.out ? 'red' : 'green', i: 'alert', l: 'Ruptures', v: sk.out, s: `${sk.low} produit(s) au minimum`, href: '#stock' }, { t: sk.expired ? 'red' : 'teal', i: 'clock', l: 'Lots expirés', v: sk.expired, s: `${sk.near} bientôt périmé(s)`, href: '#stock' }, { t: 'violet', i: 'activity', l: 'Consommation ' + PL, v: H(sk.consumption_period), s: 'matériaux utilisés', href: '#stock' })
    } else {
      if (S?.today) K.push({ t: 'blue', i: 'calendar', l: 'Rendez-vous aujourd\'hui', v: S.today.length, s: '', href: '#rendez-vous' })
      if (S?.prostheses) K.push({ t: 'violet', i: 'package', l: 'Prothèses en cours', v: S.prostheses.length, s: 'au laboratoire ou en pose', href: '#protheses' })
    }

    if (P !== 'doctor' && P !== 'direction' && S?.owed?.employee) K.push({ t: num(S.owed.total_due) > 0 ? 'orange' : 'green', i: 'briefcase', l: 'La clinique me doit', v: H(S.owed.total_due), s: num(S.owed.total_due) > 0 ? 'salaire et commissions non versés' : 'tout est versé', href: '#ma-paie' })
    // recommandations (actions concrètes, masquables pour la journée)
    if (f && num(f.profit_period) < 0) recs.push({ k: 'profit', tone: 'danger', i: 'down', text: `Résultat négatif ${PL} : les dépenses dépassent les encaissements de <b>${H(Math.abs(num(f.profit_period)))}</b>.`, href: '#finances', cta: 'Analyser' })
    if (F?.debtors?.length && (P === 'finance' || P === 'direction')) recs.push({ k: 'debt', tone: 'warn', i: 'receipt', text: `<b>${esc(F.debtors[0].label)}</b> doit <b>${H(F.debtors[0].v)}</b>${F.debtors.length > 1 ? ` · ${F.debtors.length - 1} autre(s) patient(s) débiteur(s)` : ''} : relancez le paiement.`, href: '#dettes', cta: 'Relancer' })
    if (st && num(st.pending) > 0 && can('view_salaries')) recs.push({ k: 'pay', tone: 'warn', i: 'briefcase', text: `<b>${H(st.pending)}</b> de salaires et commissions restent à verser.`, href: '#personnel-paie', cta: 'Payer' })
    if (sk && (sk.out || sk.expired)) recs.push({ k: 'stock', tone: 'danger', i: 'package', text: `Stock : <b>${sk.out}</b> rupture(s) et <b>${sk.expired}</b> lot(s) expiré(s).`, href: '#stock', cta: 'Commander' })
    else if (sk?.low) recs.push({ k: 'stocklow', tone: 'warn', i: 'package', text: `<b>${sk.low}</b> produit(s) au stock minimum.`, href: '#stock', cta: 'Voir' })
    if (S?.tomorrow?.to_confirm) recs.push({ k: 'confirm', tone: 'warn', i: 'phone', text: `<b>${S.tomorrow.to_confirm}</b> rendez-vous de demain ne sont pas confirmés : appelez les patients.`, href: '#rendez-vous', cta: 'Confirmer' })
    if (m?.to_recall && P !== 'finance') recs.push({ k: 'recall', i: 'bell', text: `<b>${m.to_recall}</b> patient(s) à rappeler pour un suivi.`, href: '#rendez-vous', cta: 'Rappeler' })
    if (S?.reminders?.length) recs.push({ k: 'rem', i: 'bell', text: `<b>${S.reminders.length}</b> rappel(s) de suivi à traiter dans les 3 jours.`, href: '#rendez-vous' })
    if (Q && Q.stats.waiting && Q.waiting.some(t => t.status === 'waiting' && Date.now() - new Date(t.arrived_at) > 45 * 6e4)) recs.push({ k: 'wait', tone: 'warn', i: 'clock', text: 'Des patients attendent depuis plus de 45 minutes : prévenez-les du délai.', href: '#salle-attente' })
    if (Q?.full) recs.push({ k: 'cap', tone: 'warn', i: 'users', text: `Capacité du jour atteinte (${Q.used}/${Q.capacity}) : proposez un rendez-vous un autre jour aux nouvelles personnes.`, href: '#salle-attente' })
    if (P === 'doctor' && S?.items?.some(i => i.status === 'postponed')) recs.push({ k: 'postp', tone: 'warn', i: 'undo', text: 'Des interventions reportées attendent d\'être reprogrammées.', href: '#plans-de-traitement' })
    if (P === 'doctor' && S?.owed?.employee && !num(S.owed.employee.commission_pct) && !num(S.owed.employee.base_salary)) recs.push({ k: 'nopay', tone: 'danger', i: 'alert', text: 'Votre rémunération n\'est pas encore définie : contactez l\'administration.' })
    if (B) { const last = B.backups?.[0]; if (!last || Date.now() - new Date(last.created_at) > 26 * 36e5) recs.push({ k: 'bk', tone: 'danger', i: 'download', text: last ? `Dernière sauvegarde il y a ${Math.round((Date.now() - new Date(last.created_at)) / 36e5)} h.` : 'Aucune sauvegarde n\'existe encore.', href: '#sauvegardes', cta: 'Sauvegarder' })
      if (B.cloud?.configured && B.cloud.state?.last_error) recs.push({ k: 'cloud', tone: 'warn', i: 'shield', text: 'La copie en ligne (Supabase) signale une erreur.', href: '#sauvegardes' }) }
    // moteur d'intelligence : conseils du jour (rendez-vous, salle d'attente, fréquentation)
    for (const r of (I?.recommendations || []).filter(x => x.level !== 'info').slice(0, 3)) recs.push({ k: 'intel-' + r.title, tone: r.level === 'danger' ? 'danger' : 'warn', i: 'zap', text: `<b>${esc(r.title)}</b> : ${esc(r.text)}`, href: r.href || undefined })
    if (I?.risks?.length) recs.push({ k: 'noshow', tone: 'warn', i: 'phone', text: `<b>${I.risks.length}</b> rendez-vous à risque d'absence : appelez ces patients pour confirmer.`, href: '#rendez-vous', cta: 'Voir' })
    for (const a of (O?.alerts || []).slice(0, 3)) recs.push({ k: 'al-' + a.title, tone: a.level === 'err' ? 'danger' : 'warn', i: 'bell', text: `<b>${esc(a.title)}</b> : ${esc(a.text)}` })

    // blocs principaux selon le profil
    const blocks = []
    if ((P === 'direction' || P === 'finance') && F) {
      const mm = F.months12.slice(-chartRange)
      blocks.push(sec('Encaissements et dépenses', 'chart', area(mm.map(x => MON(x.m)), [{ n: 'Encaissé', c: '#16a394', v: mm.map(x => num(x.rev)) }, { n: 'Dépenses', c: '#e5484d', v: mm.map(x => num(x.exp)) }]),
        { action: `<div class="zdseg2 sm">${[[6, '6 mois'], [12, '12 mois']].map(([k, l]) => `<button type="button" class="${chartRange === k ? 'on' : ''}" data-drange="${k}">${l}</button>`).join('')}</div>`, cls: 'zspan2' }))
      blocks.push(sec('Modes de paiement', 'wallet', donut(F.methods), { action: `<a class="bs" href="#finances">Détail${ic('right', 13)}</a>` }))
    }
    if (P === 'direction' || P === 'medical' || P === 'reception' || P === 'doctor') {
      if (S?.today) blocks.push(sec(P === 'doctor' ? 'Ma journée' : 'Rendez-vous du jour', 'calendar', timeline(S.today, P === 'doctor' ? 'Aucun rendez-vous aujourd\'hui : votre journée est libre.' : 'Aucun patient attendu aujourd\'hui.'), { action: `<a class="bs" href="#rendez-vous">Agenda${ic('right', 13)}</a>` }))
      if (Q) blocks.push(queueWidget(Q))
    }
    if (P === 'medical' || P === 'direction') { if (ch.consult_by_doctor?.length) blocks.push(sec('Consultations par médecin', 'activity', bars(ch.consult_by_doctor, { color: '#7c5cf0' }), { action: `<span class="muted zdsm">${PL}</span>` })) }
    if (P === 'finance' && F) { blocks.push(sec('Patients qui doivent le plus', 'receipt', F.debtors?.length ? bars(F.debtors.slice(0, 6).map(x => ({ label: x.label, v: num(x.v) })), { money: true, color: '#e08a00' }) : '<p class="muted zdnone">Aucune dette patient.</p>', { action: `<a class="bs" href="#dettes">Toutes${ic('right', 13)}</a>` }))
      blocks.push(sec('Revenus par médecin', 'activity', bars((F.doctors || []).map(x => ({ label: x.label, v: num(x.v) })), { money: true, color: '#1d6fd8' }))) }
    if (P === 'doctor') {
      blocks.push(sec('Traitements à poursuivre', 'clipboard', S?.items?.length ? `<div class="zdlist">${S.items.slice(0, 6).map(i => `<a href="#plans-de-traitement"><b>${esc(i.patient)}</b><span>${esc(i.description)}${i.teeth?.length ? ' · dents ' + i.teeth.join(', ') : ''}</span>${i.status === 'postponed' ? '<span class="badge st-warn">reporté</span>' : ''}</a>`).join('')}</div>` : `<div class="zdempty sm">${ic('check', 18)}<span>Aucun traitement en attente.</span></div>`))
      blocks.push(sec('Mes derniers actes', 'activity', S?.recent?.length ? `<div class="zdlist">${S.recent.slice(0, 6).map(c => `<a href="#dossiers/${c.patient_id}"><b>${esc(c.patient)}</b><span>${esc(c.reason || 'Consultation')}${c.teeth ? ' · dents ' + esc(c.teeth) : ''} · ${fdt(c.consulted_at)}</span></a>`).join('')}</div>` : '<p class="muted zdnone">Aucun acte récent.</p>', { action: `<a class="bs" href="#mon-activite">Tout voir${ic('right', 13)}</a>` }))
      const months = (S?.owed?.months || []).slice().reverse(); if (months.length) blocks.push(sec('Mes commissions', 'wallet', area(months.map(x => MON(x.period)), [{ n: 'Commission', c: '#7c5cf0', v: months.map(x => num(x.commission)) }]), { cls: 'zspan2' }))
    }
    if (I?.risks?.length) blocks.push(sec('Risque d\'absence · à appeler', 'phone', `<div class="zdlist">${I.risks.slice(0, 6).map(x => `<a href="${x.phone ? 'tel:' + esc(x.phone) : '#rendez-vous'}"><b>${esc(x.patient)}</b><span>${fdt(x.starts_at)} · ${esc(x.doctor)}${x.phone ? ' · ' + esc(x.phone) : ''}</span><span class="badge ${x.risk >= 40 ? 'st-off' : 'st-warn'}">${x.risk} %</span></a>`).join('')}</div><p class="muted zdsm" style="margin:8px 0 0">Estimation d'après l'historique des absences (taux habituel ${I.base_rate ?? '?'} %), pas une certitude.</p>`))
    if (P === 'reception' && S?.reminders) blocks.push(sec('Patients à rappeler', 'bell', S.reminders.length ? `<div class="zdlist">${S.reminders.slice(0, 6).map(r => `<a href="#dossiers/${r.patient_id}"><b>${esc(r.patient)}</b><span>${esc(r.reason || 'Suivi')}${r.phone ? ' · ' + esc(r.phone) : ''}</span></a>`).join('')}</div>` : `<div class="zdempty sm">${ic('check', 18)}<span>Aucun rappel à faire.</span></div>`))
    if ((P === 'stock' || P === 'direction') && sk) blocks.push(sec('Produits à commander', 'package', sk.low_items?.length ? `<div class="zdlist">${sk.low_items.slice(0, 6).map(x => `<a href="#stock"><b>${esc(x.name || x.label)}</b><span>${x.stock ?? x.qty ?? ''} en stock · minimum ${x.min_stock ?? x.min ?? '—'}</span></a>`).join('')}</div>` : `<div class="zdempty sm">${ic('check', 18)}<span>Stock suffisant.</span></div>`, { action: `<a class="bs" href="#stock">Stock${ic('right', 13)}</a>` }))
    if (P === 'stock' && ch.consumption_top?.length) blocks.push(sec('Plus consommés', 'activity', bars(ch.consumption_top, { money: true, color: '#e08a00' })))
    if (P === 'direction') {
      const dom = (icon, tone, title, stats, href) => `<a class="zddom t-${tone}" href="${href}"><div class="zddh"><span>${ic(icon, 17)}</span><b>${title}</b>${ic('right', 14)}</div>${stats.map(([l, v, c]) => `<div class="zdds2"><small>${l}</small><b class="${c || ''}">${v}</b></div>`).join('')}</a>`
      const doms = [m && dom('activity', 'blue', 'Activité médicale', [['Consultations aujourd\'hui', m.consultations_today], ['Plans en cours', m.plans_in_progress], ['Prothèses en cours', m.prostheses_in_progress]], '#plans-de-traitement'),
        st && dom('briefcase', 'violet', 'Personnel & paie', [['Employés', st.employees], ['Masse salariale', H(st.payroll)], ['Reste à verser', H(st.pending), num(st.pending) ? 'warnc' : '']], '#personnel-paie'),
        sk && dom('package', 'orange', 'Stock', [['Valeur', H(sk.value)], ['Ruptures / faibles', `${sk.out} / ${sk.low}`, sk.out ? 'neg' : ''], ['Expirés', sk.expired, sk.expired ? 'neg' : '']], '#stock'),
        f && dom('wallet', 'green', 'Trésorerie', (f.cash || []).slice(0, 3).map(c => [c.name, money(num(c.balance), c.currency)]), '#caisse-depenses')].filter(Boolean)
      if (doms.length) blocks.splice(F ? 2 : 0, 0, sec('Vue d\'ensemble', 'grid', `<div class="zddomg">${doms.join('')}</div>`, { cls: 'zspan3' }))
      if (A) blocks.push(sec('Activité récente', 'list', feed(A), { action: `<a class="bs" href="#journal">Journal${ic('right', 13)}</a>` }))
      if (B) { const last = B.backups?.[0], cl = B.cloud?.state; blocks.push(sec('État du système', 'shield', `<div class="zdsys">
          <div class="${last && Date.now() - new Date(last.created_at) < 26 * 36e5 ? 'ok' : 'ko'}">${ic('download', 15)}<span>Dernière sauvegarde</span><b>${last ? fdt(last.created_at) : 'aucune'}</b></div>
          <div class="${B.cloud?.configured ? (cl?.last_error ? 'ko' : 'ok') : 'off'}">${ic('shield', 15)}<span>Copie en ligne</span><b>${B.cloud?.configured ? (cl?.last_sync ? fdt(cl.last_sync) : 'en attente') : 'non configurée'}</b></div>
          <div class="${B.strategy?.mirror?.ok ? 'ok' : 'off'}">${ic('package', 15)}<span>Miroir (2e disque)</span><b>${B.strategy?.mirror ? (B.strategy.mirror.ok ? 'actif' : 'inaccessible') : 'non configuré'}</b></div>
          <div class="ok">${ic('clock', 15)}<span>Perte maximale</span><b>${B.strategy?.rpo ? B.strategy.rpo + ' min' : '—'}</b></div></div>`, { action: `<a class="bs" href="#sauvegardes">Sauvegardes${ic('right', 13)}</a>` })) } }

    $('#view').innerHTML = `<div class="zdash2 p-${P}">${hero}${K.length ? `<div class="zdkg">${K.map(kpi).join('')}</div>` : ''}<div class="zdgrid2">${recsHtml(recs).replace('class="zdcard ', 'class="zdcard zdrecs ')}${layout(blocks)}</div></div>`; pack()
    // actualisation en direct de la salle d'attente (toutes les 30 s, seulement sur cette page)
    clearInterval(liveTimer); if (Q) liveTimer = setInterval(async () => { if (!location.hash.startsWith('#tableau-de-bord') && location.hash) return clearInterval(liveTimer); const box = $('#dqw'); if (!box) return; try { const q = await api('/queue'); const tmp = document.createElement('div'); tmp.innerHTML = queueWidget(q); tmp.firstElementChild.dataset.o = box.dataset.o ?? ''; box.replaceWith(tmp.firstElementChild) } catch {} }, 30000)
  }

  // ── Ma paie : ce que la clinique me doit, mes fiches de paie, mes commissions ──
  const PST = { to_pay: ['À payer', 'st-warn'], partial: ['Partiellement payé', 'st-warn'], paid: ['Payé', 'st-ok'] }
  async function mypay() {
    const d = await api('/me/dashboard'), o = d.owed, e = o?.employee, PAYL = e ? (num(e.base_salary) && num(e.commission_pct) ? 'Salaire fixe + commission' : num(e.commission_pct) ? 'Commission' : num(e.base_salary) ? 'Salaire fixe' : 'Non définie') : '—'
    const last = (o?.payroll || []).find(p => num(p.paid) > 0)
    const K = [{ t: num(o?.total_due) > 0 ? 'orange' : 'green', i: 'briefcase', l: 'La clinique me doit', v: H(o?.total_due || 0), s: num(o?.total_due) > 0 ? `salaire : ${H(o.payroll_due)} · commissions : ${H(o.commissions_due)}` : 'tout est versé' },
      { t: 'blue', i: 'wallet', l: 'Salaire de base', v: H(e?.base_salary || 0), s: 'par mois' }, { t: 'violet', i: 'activity', l: 'Taux de commission', v: (num(e?.commission_pct) || 0) + ' %', s: PAYL },
      { t: 'teal', i: 'check', l: 'Dernier versement', v: last ? H(last.paid) : '—', s: last ? 'fiche de ' + MON(last.period) + ' ' + last.period.slice(0, 4) : 'aucun versement' }]
    const rows = (o?.payroll || []).map(p => { const rest = Math.max(0, num(p.net) - num(p.paid)), det = (p.deduction_details || []).map(x => `${x.label} : ${hidden() ? '•••' : H(x.amount)}`).join(' · ')
      return `<tr><td><b>${MON(p.period)} ${p.period.slice(0, 4)}</b></td><td class="r">${H(p.base)}</td><td class="r">${H(p.commissions)}</td><td class="r">${H(p.bonuses)}</td><td class="r" title="${esc(det)}">${H(num(p.deductions) + num(p.other_deductions))}</td><td class="r"><b>${H(p.net)}</b></td><td class="r">${H(p.paid)}</td><td class="r ${rest ? 'neg' : ''}">${H(rest)}</td><td><span class="badge ${(PST[p.status] || PST.to_pay)[1]}">${(PST[p.status] || PST.to_pay)[0]}</span></td><td class="act"><a class="bs" href="/api/payroll/${p.id}/payslip" target="_blank" rel="noopener">${ic('file', 13)}PDF</a></td></tr>` }).join('')
    const comm = (o?.months || []).map(m => `<tr><td><b>${MON(m.period)} ${m.period.slice(0, 4)}</b></td><td class="r">${H(m.billed)}</td><td class="r">${H(m.collected)}</td><td class="r"><b>${H(m.commission)}</b></td><td class="r">${H(num(m.paid_direct) + num(m.in_payroll))}</td><td class="r ${m.remaining ? 'neg' : ''}">${H(m.remaining)}</td></tr>`).join('')
    $('#view').innerHTML = `<div class="zdash2"><div class="zdhero2"><div class="zdhl"><span class="zdhrole">${esc(ROLE[d.role] || d.role)}</span><h1>Ma paie</h1><p>Rémunération : <b>${PAYL}</b>${e?.job_title ? ' · ' + esc(e.job_title) : ''}</p></div></div>
      ${!e ? `<div class="zdcard"><div class="zdempty">${ic('alert', 22)}<span>Votre fiche employé n'existe pas encore : demandez à l'administration de définir votre rémunération (salaire fixe, pourcentage ou les deux).</span></div></div>` : `<div class="zdkg">${K.map(kpi).join('')}</div>
      ${sec('Mes fiches de paie', 'file', rows ? `<div class="tw"><table class="ptable"><tr><th>Mois</th><th class="r">Base</th><th class="r">Commissions</th><th class="r">Primes</th><th class="r">Retenues</th><th class="r">Net</th><th class="r">Versé</th><th class="r">Reste</th><th>Statut</th><th></th></tr>${rows}</table></div><p class="muted zdsm" style="margin:10px 0 0">Survolez les retenues pour voir le détail (impôts, cotisations…). Le bouton PDF ouvre votre bulletin de paie.</p>` : `<div class="zdempty">${ic('file', 22)}<span>Aucune fiche de paie pour le moment : elle apparaît dès que la paie du mois est générée.</span></div>`, { cls: 'zspan3' })}
      ${comm ? sec('Mes commissions', 'activity', `<div class="tw"><table class="ptable"><tr><th>Mois</th><th class="r">Facturé</th><th class="r">Encaissé</th><th class="r">Commission</th><th class="r">Déjà versé</th><th class="r">Reste</th></tr>${comm}</table></div>`, { cls: 'zspan3' }) : ''}`}</div>`
  }
  // ── interactions ──
  document.addEventListener('click', async e => { if (!location.hash.startsWith('#tableau-de-bord') && location.hash !== '') return
    const p = e.target.closest('[data-dper]'); if (p) { per = p.dataset.dper; return render() }
    const r = e.target.closest('[data-drange]'); if (r) { chartRange = +r.dataset.drange; return render() }
    const x = e.target.closest('[data-rdis]'); if (x) { const s = dismissed(); s.add(x.dataset.rdis); try { localStorage.setItem(dismissKey(), JSON.stringify([...s])) } catch {} const row = x.closest('.zdr'); row.classList.add('gone'); setTimeout(() => render(), 220); return }
    if (e.target.closest('[data-rreset]')) { try { localStorage.removeItem(dismissKey()) } catch {} return render() }
    const q = e.target.closest('[data-dq="next"]'); if (q) { try { const t = await api('/queue/next', {}); toast(`Appel du n° ${String(t.number).padStart(3, '0')} : ${t.name}`) } catch (er) { toast(er.message) } return render() } })
  setInterval(() => { const c = document.querySelector('[data-dclock]'); if (c) c.textContent = new Date().toLocaleString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' }) }, 20000)
  document.addEventListener('privacy', () => { if (location.hash.startsWith('#tableau-de-bord')) render() })   // axes et infobulles masqués / affichés
  return { views: { dashboard, mypay } }
}
