import { ic } from './icons.js'
import { spinnerBlock, blocking } from './loaders.js'
const ROLE_FR = { ADMIN: 'Administrateur', ADMIN_MEDICAL: 'Administrateur médical', ADMIN_FINANCIER: 'Administrateur financier', DENTIST: 'Médecin dentiste', DENTAL_ASSISTANT: 'Assistant(e) dentaire', SECRETARY: 'Secrétaire', ACCOUNTANT: 'Comptable', STOCK_MANAGER: 'Gestionnaire de stock', DENTAL_TECH: 'Prothésiste', STAFF: 'Personnel' }
import { num, money, fdate, monthLabel, head, btn, bs, bsLink, bsPrint, printDoc, kpi, kpis, badge, pbar, empty, card, search, person, fld, sel, modal, noRes, tips, loadTariffs, resetTariffs, tLabel, tHTG, payLabel, payTypeFields, wirePayType, payTypeValues } from './kit.js'
export default function install({ $, esc, api, can, toast, render }) {
  let kind = 'invoice', bpage = 0, period = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Port-au-Prince' }).slice(0, 7)
  const F = e => Object.fromEntries(new FormData(e.target))
  const METHODS = ['espèces', 'MonCash', 'NatCash', 'virement', 'carte', 'chèque', 'Autre']
  let df = { from: '', to: '', doctor: '', min: '', q: '' }
  const invState = i => i.status === 'cancelled' ? ['Annulée', 'st-done'] : i.status === 'converted' ? ['Convertie', 'st-done'] : i.kind === 'proforma' ? ['Valide', 'st-info']
    : num(i.paid) >= num(i.total) ? ['Payée', 'st-ok'] : num(i.paid) > 0 ? ['Partielle', 'st-warn'] : ['Impayée', 'st-off']
  const PAY = { to_pay: ['À payer', 'st-warn'], partial: ['Partiel', 'st-info'], paid: ['Payé', 'st-ok'] }

  const views = {
    async billing() {
      const fin = can('manage_finances'), month = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Port-au-Prince' }).slice(0, 7)
      const [rows, sm, nod] = await Promise.all([api(`/invoices?kind=${kind}&page=${bpage}`), api('/finance/summary?month=' + month).catch(() => null), api('/invoices/no-doctor').catch(() => ({ count: 0, rows: [] }))])
      const unpaid = rows.filter(i => i.kind === 'invoice' && i.status === 'issued' && num(i.paid) < num(i.total))
      const actions = fin ? btn('bl-new', kind === 'proforma' ? 'Nouvelle proforma' : 'Nouvelle facture', 'plus') : ''
      const line = i => {
        const [sl, sc] = invState(i), rest = num(i.total) - num(i.paid), issued = i.status === 'issued', inv = i.kind === 'invoice'
        const acts = [bsLink(`/api/invoices/${i.id}/pdf`, 'PDF'), bsPrint(`/api/invoices/${i.id}/pdf`, 'Imprimer'),
          inv && fin && issued && rest > 0 ? bs('bl-pay', i.id, 'Encaisser', 'wallet', 'pri', `data-cur="${i.currency}" data-rest="${rest.toFixed(2)}" data-num="${esc(i.number)}"`) : '',
          inv ? bs('bl-rec', i.id, 'Reçus', 'receipt', '', `data-num="${esc(i.number)}"`) : '',
          fin && issued ? bs('bl-fix', i.id, 'Corriger', 'edit') : '', bs('bl-hist', i.id, 'Historique', 'clock'),
          inv && fin && issued ? bs('bl-cancel', i.id, 'Annuler', 'x', 'dng') : '',
          !inv && fin && issued ? bs('bl-conv', i.id, 'Convertir en facture', 'check', 'pri') : ''].join('')
        return `<tr data-s="${esc((i.number + ' ' + i.patient).toLowerCase())}" class="${issued ? '' : 'inact'}"><td><span class="fn">${esc(i.number)}</span></td><td><b>${esc(i.patient)}</b></td><td>${fdate(i.created_at)}</td><td class="r"><b>${money(i.total, i.currency)}</b></td>
          <td>${inv ? `${pbar(num(i.total) ? num(i.paid) / num(i.total) : 0)}<small class="muted">${money(i.paid, i.currency)} payé</small>` : '<span class="muted">—</span>'}</td><td>${badge(sl, sc)}${issued && inv ? ` <span class="lockb" title="Facture verrouillée : toute correction est tracée">${ic('lock', 12)}</span>` : ''}</td><td class="act"><div class="acts">${acts}</div></td></tr>` }
      const pager = bpage > 0 || rows.length === 20 ? `<div class="row pager"><button class="sec" data-a="bl-prev" ${bpage ? '' : 'disabled'}>${ic('left', 16)} Précédent</button><span>Page ${bpage + 1}</span><button class="sec" data-a="bl-next" ${rows.length < 20 ? 'disabled' : ''}>Suivant ${ic('right', 16)}</button></div>` : ''
      $('#view').innerHTML = head('Facturation', 'Factures, proformas et encaissements des patients', actions)
        + (sm ? kpis([kpi('blue', 'Facturé ce mois', money(sm.invoiced_htg, 'HTG'), monthLabel(month), 'file'), kpi('green', 'Encaissé ce mois', money(sm.collected_htg, 'HTG'), 'paiements reçus', 'dollar'),
          kpi(unpaid.length ? 'orange' : 'teal', 'Factures à encaisser', unpaid.length, kind === 'invoice' ? 'parmi les factures affichées' : 'voir l\'onglet Factures', 'clock')]) : '')
        + tips([nod.count && { icon: 'alert', tone: 'danger', text: `<b>${nod.count}</b> facture(s) sans médecin responsable : leur commission n'est attribuée à personne. Ouvrez-les et choisissez le médecin (« Corriger ») : ${nod.rows.slice(0, 6).map(x => `<b>${esc(x.number)}</b> (${esc(x.patient)})`).join(', ')}${nod.count > 6 ? '…' : ''}` }, unpaid.length && { icon: 'wallet', tone: 'warn', text: `<b>${unpaid.length}</b> facture(s) affichée(s) restent à encaisser : <b>${money(unpaid.reduce((s, i) => s + num(i.total) - num(i.paid), 0))}</b>. Relancez les patients à leur prochaine visite.` },
          kind === 'proforma' && rows.filter(i => i.status === 'issued').length && { icon: 'check', text: `<b>${rows.filter(i => i.status === 'issued').length}</b> proforma(s) en attente : convertissez-les en facture dès que le patient accepte le devis.` },
          sm && num(sm.invoiced_htg) > num(sm.collected_htg) && { icon: 'activity', text: `Ce mois, ${money(num(sm.invoiced_htg) - num(sm.collected_htg))} facturés n'ont pas encore été encaissés.` }])
        + card(`<div class="sw">${[['invoice', 'Factures'], ['proforma', 'Proformas']].map(([k, l]) => `<button type="button" class="${kind === k ? 'on' : ''}" data-a="bl-kind" data-id="${k}">${l}</button>`).join('')}</div>`, '',
          rows.length ? `<div class="tw"><table class="ptable" id="btab" data-page="10"><tr><th>N°</th><th>Patient</th><th>Date</th><th class="r">Total</th><th>Paiement</th><th>Statut</th><th></th></tr>${rows.map(line).join('')}${noRes(7)}</table></div>${pager}`
            : empty('file', kind === 'proforma' ? 'Aucune proforma' : 'Aucune facture', 'Les documents créés apparaîtront ici.', fin ? btn('bl-new', 'Créer un document', 'plus', 'btn') : ''),
          rows.length ? search('#btab', 'Rechercher un n° ou un patient…') : '')
    },

    async debts() {
      const fin = can('manage_finances'), qs = new URLSearchParams(Object.entries({ from: df.from, to: df.to, doctor: df.doctor }).filter(([, v]) => v)).toString()
      const [rows, docs] = await Promise.all([api('/debts' + (qs ? '?' + qs : '')), api('/doctors').catch(() => [])])
      const min = num(String(df.min).replace(',', '.')), qq = df.q.trim().toLowerCase()
      const by = new Map(); for (const r of rows) { const g = by.get(r.patient_id) || { id: r.patient_id, name: r.patient, file: r.file_number, phone: r.phone, inv: [], due: {}, age: 0, last: null }
        g.inv.push(r); g.due[r.currency] = Math.round(((g.due[r.currency] || 0) + r.balance) * 100) / 100; g.age = Math.max(g.age, r.age_days); if (r.last_payment && (!g.last || r.last_payment > g.last)) g.last = r.last_payment; by.set(r.patient_id, g) }
      const groups = [...by.values()].filter(g => (!qq || `${g.name} ${g.file} ${g.phone || ''}`.toLowerCase().includes(qq)) && (!min || Object.values(g.due).some(v => v >= min))).sort((a, b) => b.age - a.age)
      const tot = c => groups.reduce((s, g) => s + (g.due[c] || 0), 0), old = groups.filter(g => g.age > 90), part = rows.filter(r => r.paid > 0).length
      const ageB = d => d > 90 ? badge(`${d} j`, 'st-off') : d > 30 ? badge(`${d} j`, 'st-warn') : badge(`${d} j`, 'st-info')
      const dcard = g => `<details class="dbt" data-pi="1"><summary><span class="dav sm">${esc(g.name.split(' ').map(x => x[0]).join('').slice(0, 2))}</span><span class="hn"><a href="#dossiers/${g.id}"><b>${esc(g.name)}</b></a><small><span class="fn sm">${esc(g.file)}</span>${g.phone ? ' · ' + ic('phone', 12) + ' ' + esc(g.phone) : ''} · ${g.inv.length} facture(s)${g.last ? ' · dernier paiement ' + fdate(g.last) : ' · aucun paiement'}</small></span>
          <span class="dbr">${Object.entries(g.due).map(([c, v]) => `<b>${money(v, c)}</b>`).join('<br>')}${ageB(g.age)}</span>${ic('down', 16).replace('class="ic"', 'class="ic dchev"')}</summary>
        <div class="tw"><table class="ptable"><tr><th>Facture</th><th>Date</th><th>Médecin</th><th class="r">Total</th><th class="r">Remise</th><th class="r">Payé</th><th class="r">Solde</th><th></th></tr>${g.inv.map(r => `<tr><td><span class="fn sm">${esc(r.number)}</span></td><td>${fdate(r.created_at)} ${ageB(r.age_days)}</td><td>${esc(r.doctor) || '—'}</td><td class="r">${money(r.total, r.currency)}</td><td class="r">${r.discount ? '- ' + money(r.discount, r.currency) : '—'}</td><td class="r">${money(r.paid, r.currency)}</td><td class="r"><b class="neg">${money(r.balance, r.currency)}</b></td>
          <td class="act"><div class="acts">${bsLink(`/api/invoices/${r.id}/pdf`, 'PDF')}${bsPrint(`/api/invoices/${r.id}/pdf`, 'Imprimer')}${bs('bl-rec', r.id, 'Paiements', 'receipt', '', `data-num="${esc(r.number)}"`)}${fin ? bs('bl-pay', r.id, 'Encaisser', 'wallet', 'pri', `data-cur="${r.currency}" data-rest="${r.balance.toFixed(2)}" data-num="${esc(r.number)}"`) : ''}</div></td></tr>`).join('')}</table></div></details>`
      $('#view').innerHTML = head('Dettes patients', 'Patients ayant un solde impayé · mis à jour automatiquement à chaque paiement', btn('db-pdf', 'PDF', 'file', 'sec') + btn('db-csv', 'Excel (CSV)', 'download', 'sec'))
        + kpis([kpi('red', 'Total dû (HTG)', money(tot('HTG')), `${groups.length} patient(s)`, 'wallet'), kpi('orange', 'Total dû (USD)', money(tot('USD'), 'USD'), 'jamais additionné aux gourdes', 'dollar'), kpi('violet', 'Factures impayées', groups.reduce((s, g) => s + g.inv.length, 0), `${part} partiellement payée(s)`, 'file'), kpi(old.length ? 'red' : 'green', 'Dettes de plus de 90 j', old.length, 'patients à relancer en priorité', 'clock')])
        + tips([old.length && { icon: 'alert', tone: 'danger', text: `<b>${old.length}</b> patient(s) doivent depuis plus de 90 jours : ${old.slice(0, 3).map(g => esc(g.name)).join(', ')}${old.length > 3 ? '…' : ''}. Appelez-les en priorité.` },
          part && { icon: 'wallet', text: `<b>${part}</b> facture(s) déjà partiellement payée(s) : proposez le solde lors du prochain rendez-vous.` },
          !groups.length && { icon: 'check', text: 'Aucune dette pour ces critères : tous les patients sont à jour.' }])
        + `<div class="card dbf"><label>Du<input type="date" data-df="from" value="${df.from}"></label><label>Au<input type="date" data-df="to" value="${df.to}"></label><label>Médecin<select data-df="doctor"><option value="">Tous</option>${docs.map(d => `<option value="${d.id}" ${df.doctor === d.id ? 'selected' : ''}>${esc(d.name)}</option>`).join('')}</select></label><label>Solde minimum<input data-df="min" inputmode="decimal" value="${esc(df.min)}" placeholder="0"></label><label class="dbq">Patient<input data-df="q" value="${esc(df.q)}" placeholder="Nom, n° de dossier, téléphone"></label>${Object.values(df).some(Boolean) ? `<button class="sec bs" data-a="db-reset">${ic('x', 14)}Effacer</button>` : ''}</div>`
        + card('Patients en dette', 'wallet', groups.length ? `<div class="dbl" data-page="8">${groups.map(dcard).join('')}</div>` : empty('check', 'Aucune dette', 'Aucun solde impayé pour ces critères.'))
      views._debts = groups
    },
    async tariffs() {
      const tf = await loadTariffs(api, true), all = tf.can_edit ? (await api('/tariffs?all=1')).rows : tf.rows, rate = tf.rate, ed = tf.can_edit
      const N = v => num(v).toLocaleString('fr-FR', { maximumFractionDigits: 2 })
      const CI = { Prévention: 'zap', 'Soins conservateurs': 'tooth', Chirurgie: 'trash', Orthodontie: 'activity', Prothèses: 'package', Imagerie: 'image' }
      const usd = all.filter(t => t.active && t.currency === 'USD' && t.price != null), tbd = all.filter(t => t.active && t.price == null), off = all.filter(t => !t.active)
      const cats = [...new Set(all.map(t => t.category || 'Autres'))]
      const conv = t => t.price == null ? `<span class="tfc tbd">${ic('edit', 13)} Prix fixé par le médecin selon le cas</span>` : t.currency === 'USD' ? `<span class="tfc ${rate ? '' : 'err'}" data-usd="${t.price}">${rate ? `≈ <b>${money(t.price * rate)}</b> au taux du jour` : `${ic('alert', 13)} Taux du jour non défini`}</span>` : `<span class="tfc">Prix fixe en gourdes</span>`
      const tcard = t => `<div class="tfk ${t.active ? '' : 'off'}" data-s="${esc((t.name + ' ' + (t.category || '') + ' ' + (t.code || '')).toLowerCase())}">
        <div class="tfh"><span class="tfi">${ic(CI[t.category] || 'receipt', 18)}</span><div class="tfn"><b>${esc(t.name)}</b><span class="tft">${esc(t.category || 'Autres')}${t.code ? ` · <span class="fn sm">${esc(t.code)}</span>` : ''}</span></div>
          ${ed ? `<button type="button" class="tsw ${t.active ? 'on' : ''}" data-a="tf-act" data-id="${t.id}" data-on="${t.active ? 0 : 1}" role="switch" aria-checked="${t.active}" aria-label="${t.active ? 'Désactiver' : 'Activer'} ${esc(t.name)}"><i></i></button>` : t.active ? badge('Actif', 'st-ok') : badge('Inactif', 'st-done')}</div>
        <div class="tfp">${t.price == null ? `<span class="tbdp">À déterminer</span>` : t.currency === 'USD' ? `${N(t.price)} <small>$ US</small>` : `${N(t.price)} <small>HTG</small>`}</div>${conv(t)}
        ${t.note ? `<p class="tfnote">${esc(t.note)}</p>` : ''}${!t.active ? `<p class="tfnote lock">${ic('lock', 12)} Non opérationnelle : ni programmable, ni facturable.</p>` : ''}
        ${ed ? `<div class="tff"><button class="bs" data-a="tf-edit" data-id="${t.id}">${ic('edit', 14)}Modifier</button></div>` : ''}</div>`
      $('#view').innerHTML = head('Tarifs des soins', 'Prix appliqués automatiquement aux interventions, aux plans de traitement et aux factures', ed ? btn('tf-new', 'Nouveau tarif', 'plus') : '')
        + `<div class="ratebar ${rate ? '' : 'none'}"><div class="rbl"><span class="rbi">${ic('dollar', 22)}</span><div><small>Taux du jour</small><b data-rate>${rate ? `1 $ US = ${N(rate)} HTG` : 'Non défini'}</b><span>${rate && tf.rate_at ? `mis à jour le ${new Date(tf.rate_at).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })}${tf.rate_by ? ' par ' + esc(tf.rate_by) : ''}` : 'Indispensable pour convertir les prix en dollars'}</span></div></div>
          ${tf.can_rate ? `<form class="rbf" data-f="rate-now"><label>1 $ US =<input name="rate" inputmode="decimal" required value="${rate ?? ''}" placeholder="Ex : 132,50" aria-label="Nouveau taux"> HTG</label><button>${ic('check', 16)} Appliquer maintenant</button></form>` : `<span class="muted" style="font-size:12.5px">Modifiable par la direction</span>`}</div>`
        + kpis([kpi('blue', 'Soins au tarif', all.filter(t => t.active).length, `${cats.length} catégorie(s)`, 'receipt'), kpi('teal', 'En dollars', usd.length, rate ? 'convertis au taux du jour' : 'taux à définir', 'dollar'), kpi(off.length ? 'violet' : 'green', 'Inactifs', off.length, off.length ? 'non opérationnels' : 'aucun', 'lock')])
        + `<div class="card"><div class="chd"><h3>${ic('receipt', 18)}Grille des tarifs</h3>${search('#tfgrid', 'Rechercher un soin, une catégorie, un code…')}</div><div id="tfgrid">`
        + (all.length ? `<div class="tfg">${[...all].sort((x, y) => (x.active === y.active ? 0 : x.active ? -1 : 1) || x.sort - y.sort).map(tcard).join('')}</div><div class="nores" hidden><span class="muted">Aucun soin ne correspond à la recherche.</span></div>`
          : empty('receipt', 'Aucun tarif', 'Ajoutez les prix de vos soins.', ed ? btn('tf-new', 'Ajouter un tarif', 'plus', 'btn') : '')) + '</div></div>'
    },
    async hr() {
      const mp = can('manage_payroll'), [emps, pay, unpaid] = await Promise.all([api('/employees'), api('/payroll?period=' + period), api('/staff/unpaid').catch(() => [])]); views._emps = emps; views._unpaid = unpaid
      const nopayE = emps.filter(e => e.status === 'active' && !e.user_id && !payLabel(e))
      const active = emps.filter(e => e.status === 'active'), base = active.reduce((s, e) => s + num(e.base_salary), 0)
      const net = pay.reduce((s, r) => s + num(r.net), 0), paid = pay.reduce((s, r) => s + num(r.paid), 0)
      const row = r => {
        const rest = num(r.net) - num(r.paid), [sl, sc] = PAY[r.status] || [r.status, 'st-info'], [fn, ...ln] = String(r.employee).split(' ')
        const vars = [['Comm.', r.commissions, 1], ['Primes', r.bonuses, 1], ...(r.deduction_details || []).map(x => [x.label, x.amount, -1]), ['Autres déd.', r.other_deductions, -1], ['Avances', r.advances, -1]].filter(v => num(v[1]))
        return `<tr data-s="${esc(String(r.employee).toLowerCase())}"><td>${person(fn, ln.join(' '))}</td><td class="r">${money(r.base, '')}</td>
          <td>${vars.length ? vars.map(([l, v, s]) => `<span class="vchip ${s > 0 ? 'pos' : 'neg'}">${l} ${s > 0 ? '+' : '−'}${money(v, '')}</span>`).join('') : '<span class="muted">—</span>'}</td>
          <td class="r"><b>${money(r.net, 'HTG')}</b></td><td>${pbar(num(r.net) ? num(r.paid) / num(r.net) : 0)}<small class="muted">${money(r.paid, '')} versé</small></td><td>${badge(sl, sc)}</td>
          <td class="act"><div class="acts">${bsLink(`/api/payroll/${r.id}/payslip`, 'Bulletin')}${mp ? bs('hr-adj', r.id, 'Ajuster', 'edit', '', `data-v="${r.commissions},${r.bonuses},${r.other_deductions ?? r.deductions},${r.advances}" data-auto="${num(r.deductions) - num(r.other_deductions)}" data-base="${r.base}" data-paid="${r.paid}" data-name="${esc(r.employee)}"`) : ''}${mp && rest > 0 ? bs('hr-pay', r.id, 'Payer', 'wallet', 'pri', `data-rest="${rest.toFixed(2)}" data-name="${esc(r.employee)}"`) : ''}</div></td></tr>` }
      const emp = e => `<div data-pi="1" class="emp ${e.status === 'active' ? '' : 'inact'}"><span class="dav sm">${esc((e.first_name[0] || '') + (e.last_name[0] || ''))}</span><span class="hn"><b>${esc(e.first_name)} ${esc(e.last_name)}</b><small>${esc(e.job_title) || 'Fonction non précisée'}${e.matricule ? ' · ' + esc(e.matricule) : ''}</small></span><span class="er">${payLabel(e) ? `<b>${payLabel(e)}</b>` : badge(ic('alert', 12) + ' Rémunération à définir', 'st-off')}${e.status === 'active' ? badge('Actif', 'st-ok') : badge('Inactif', 'st-done')}${mp ? bs('hr-payset', e.id, 'Rémunération', 'wallet') + bs('hr-ded', e.id, e.deductions?.length ? `Retenues (${e.deductions.length})` : 'Retenues', 'minus') : ''}</span>${e.deductions?.length ? `<span class="edd">${e.deductions.map(x => `<span class="vchip neg">${esc(x.label)} ${x.kind === 'pct' ? x.value + ' %' : money(x.value, '')}</span>`).join('')}</span>` : ''}</div>`
      $('#view').innerHTML = head('Personnel & paie', 'Équipe, salaires et bulletins de paie', mp ? btn('hr-new', 'Nouvel employé', 'plus') : '')
        + kpis([kpi('blue', 'Employés actifs', active.length, `${emps.length} au total`, 'users'), kpi('violet', 'Masse salariale de base', money(base, 'HTG'), 'par mois, employés actifs', 'briefcase'),
          kpi('teal', 'Net à payer', money(net, 'HTG'), `${pay.length} fiche(s) · ${monthLabel(period)}`, 'wallet'), kpi(net - paid > 0 ? 'orange' : 'green', 'Reste à verser', money(net - paid, 'HTG'), `${money(paid, 'HTG')} déjà versé`, 'clock'), kpi('red', 'Retenues du mois', money(pay.reduce((s, r) => s + num(r.deductions), 0), 'HTG'), 'impôts, cotisations et autres', 'minus')])
        + tips([(() => { const by = {}; pay.forEach(r => (r.deduction_details || []).forEach(x => { by[x.label] = (by[x.label] || 0) + num(x.amount) })); const e = Object.entries(by); return e.length && { icon: 'minus', text: `Retenues de ${monthLabel(period)} à reverser : ${e.map(([l, v]) => `<b>${esc(l)}</b> ${money(v, 'HTG')}`).join(' · ')}.` } })(), (unpaid.length || nopayE.length) && { icon: 'alert', tone: 'danger', text: `<b>${[...unpaid.map(u => esc(u.first_name + ' ' + u.last_name)), ...nopayE.map(e => esc(e.first_name + ' ' + e.last_name))].join(', ')}</b> : aucune rémunération définie. Chaque membre du personnel doit avoir un salaire fixe, un pourcentage, ou les deux.` },
          mp && active.length > pay.length && { icon: 'zap', tone: 'warn', text: `<b>${active.length - pay.length}</b> employé(s) actif(s) sans fiche de paie pour ${monthLabel(period)} : générez la paie du mois.` },
          pay.filter(r => r.status !== 'paid').length && { icon: 'wallet', text: `<b>${pay.filter(r => r.status !== 'paid').length}</b> fiche(s) restent à payer (${money(net - paid, 'HTG')}).` },
          { icon: 'activity', text: 'Les commissions des médecins sont reportées automatiquement à la génération de la paie (onglet « Médecins & commissions »).', href: '#medecins' }])
        + card('Paie de ' + monthLabel(period), 'receipt',
          pay.length ? `<div class="tw"><table class="ptable" id="ptab" data-page="10"><tr><th>Employé</th><th class="r">Base</th><th>Variables</th><th class="r">Net</th><th>Versé</th><th>Statut</th><th></th></tr>${pay.map(row).join('')}${noRes(7)}</table></div>`
            : empty('receipt', 'Aucune fiche de paie pour ce mois', mp ? 'Générez la paie pour créer une fiche par employé actif.' : '', mp && active.length ? btn('hr-gen', 'Générer la paie du mois', 'zap', 'btn') : ''),
          `<form class="row" data-f="period" style="margin:0"><input type="month" name="period" value="${period}"><button class="sec">Afficher</button></form>${mp && pay.length ? btn('hr-gen', 'Compléter la paie', 'zap', 'sec') : ''}`)
        + (unpaid.length ? card('Comptes sans rémunération', 'alert', `<div class="emps">${unpaid.map(u => `<div class="emp"><span class="dav sm">${esc((u.first_name[0] || '') + (u.last_name[0] || ''))}</span><span class="hn"><b>${esc(u.first_name)} ${esc(u.last_name)}</b><small>${esc(u.job_title || ROLE_FR[u.role] || u.role)}</small></span><span class="er">${badge(ic('alert', 12) + ' À définir', 'st-off')}${mp ? `<button class="bs pri" data-a="hr-payset" data-u="${u.id}">${ic('wallet', 14)}Définir</button>` : ''}</span></div>`).join('')}</div>`) : '')
        + card('Équipe', 'users', emps.length ? `<div class="emps" data-page="9">${emps.map(emp).join('')}</div>` : empty('users', 'Aucun employé', 'Ajoutez les membres de l\'équipe pour préparer la paie.', mp ? btn('hr-new', 'Ajouter un employé', 'plus', 'btn') : ''))
    }
  }

  // ── Fenêtres de saisie ──
  const newInvoice = async () => {
    const tf = await loadTariffs(api), tfr = tf.rows || [], docs = await api('/doctors').catch(() => [])
    let md; const lineHtml = () => `<div class="ln"><input data-k="d" placeholder="Prestation (ex : Détartrage)" required><input data-k="q" value="1" inputmode="decimal" required aria-label="Quantité"><input data-k="p" placeholder="Prix unitaire" inputmode="decimal" required><button type="button" class="ibtn dng" data-rml aria-label="Retirer la ligne">${ic('trash', 16)}</button></div>`
    const calc = () => { let s = 0; md.querySelectorAll('.ln').forEach(l => { s += num(l.querySelector('[data-k=q]').value.replace(',', '.')) * num(l.querySelector('[data-k=p]').value.replace(',', '.')) }); s = Math.round(s * 100) / 100
      const dv = num(md.querySelector('[name=discount]').value.replace(',', '.')), pct = md.querySelector('[name=disc_mode]').value === 'pct', d = Math.min(s, Math.round((pct ? s * dv / 100 : dv) * 100) / 100); return { s, d, n: Math.round((s - d) * 100) / 100, pct, dv } }
    const total = () => { const cur = md.querySelector('[name=currency]').value, r = calc(); md.querySelector('[data-it=s]').textContent = money(r.s, cur); md.querySelector('[data-it=d]').textContent = (r.d ? '- ' : '') + money(r.d, cur) + (r.pct && r.dv ? ` (${r.dv} %)` : ''); md.querySelector('.itot b').textContent = money(r.n, cur) }
    const v = await modal({ title: kind === 'proforma' ? 'Nouvelle proforma' : 'Nouvelle facture', icon: 'file', wide: true, ok: 'Créer le document',
      html: `<div class="fg">${sel('Type de document', 'kind', [['invoice', 'Facture'], ['proforma', 'Proforma (devis)']], kind)}${sel('Devise', 'currency', ['HTG', 'USD'])}${fld('Patient *', 'patient_file', 'required placeholder="Tapez le nom du patient…"')}<label>Médecin responsable <i class="req">*</i><select name="doctor_id" required><option value="">— Choisir le médecin —</option>${docs.map(d => `<option value="${d.id}">${esc(d.name)}</option>`).join('')}</select><small class="muted">Sa commission est calculée sur cette facture</small></label><label>Remise<span class="disc"><input name="discount" inputmode="decimal" placeholder="0"><select name="disc_mode" aria-label="Type de remise"><option value="htg">Montant</option><option value="pct">%</option></select></span></label></div>
        <h4>Prestations</h4>${tfr.length ? `<div class="qchips">${tfr.map((t, i) => `<button type="button" class="qc" data-tfi="${i}">+ ${esc(t.name)} · ${esc(tLabel(t, tf.rate))}</button>`).join('')}</div>` : ''}<div class="lnh"><span>Description</span><span>Qté</span><span>Prix unitaire</span><span></span></div><div class="lns">${lineHtml()}</div><button type="button" class="sec bs" data-addl>${ic('plus', 15)}Ajouter une ligne</button><div class="isum"><span>Total brut <b data-it="s">0</b></span><span>Remise <b data-it="d">0</b></span></div><div class="itot">Total net <b>0,00 HTG</b></div>`,
      onOpen: m => { md = m; setTimeout(total, 0); m.addEventListener('input', total); m.addEventListener('change', total)
        m.addEventListener('click', e => { const tb = e.target.closest('[data-tfi]'); if (tb) { const t = tfr[+tb.dataset.tfi], cur = m.querySelector('[name=currency]').value
            let p = t.price == null ? '' : t.currency === cur ? t.price : cur === 'HTG' ? (tf.rate ? Math.round(t.price * tf.rate * 100) / 100 : '') : (tf.rate ? Math.round(t.price / tf.rate * 100) / 100 : '')
            let l = [...m.querySelectorAll('.ln')].find(x => !x.querySelector('[data-k=d]').value); if (!l) { m.querySelector('.lns').insertAdjacentHTML('beforeend', lineHtml()); l = m.querySelector('.ln:last-child') }
            l.querySelector('[data-k=d]').value = t.name; l.querySelector('[data-k=p]').value = p; total(); if (p === '') l.querySelector('[data-k=p]').focus() }
          if (e.target.closest('[data-addl]')) { m.querySelector('.lns').insertAdjacentHTML('beforeend', lineHtml()); m.querySelector('.ln:last-child input').focus() }
          const rm = e.target.closest('[data-rml]'); if (rm && m.querySelectorAll('.ln').length > 1) { rm.closest('.ln').remove(); total() } }) },
      submit: async f => { const items = [...md.querySelectorAll('.ln')].map(l => ({ description: l.querySelector('[data-k=d]').value.trim(), qty: l.querySelector('[data-k=q]').value.trim().replace(',', '.'), unit_price: l.querySelector('[data-k=p]').value.trim().replace(',', '.') })).filter(i => i.description)
        if (items.some(i => !i.unit_price)) throw new Error('Une prestation sans prix ne peut pas être facturée : saisissez son montant.')
        const r = calc(); await api('/invoices', { kind: f.kind, currency: f.currency, patient_file: f.patient_file.trim(), doctor_id: f.doctor_id || undefined, ...(r.pct ? { discount_pct: String(r.dv) } : { discount: r.d ? String(r.d) : undefined }), items }) } })
    if (v) { kind = v.kind; bpage = 0; toast(v.kind === 'proforma' ? 'Proforma créée' : 'Facture créée'); render() }
  }
  // ── correction d'une facture verrouillée (motif obligatoire, ancienne version conservée) ──
  const fixInvoice = async id => {
    const [d, docs] = await Promise.all([api('/invoices/' + id), api('/doctors').catch(() => [])]); let md
    const lineHtml = (x = {}) => `<div class="ln"><input data-k="d" required value="${esc(x.description || '')}" placeholder="Prestation"><input data-k="q" required inputmode="decimal" value="${x.qty ?? 1}" aria-label="Quantité"><input data-k="p" required inputmode="decimal" value="${x.unit_price ?? ''}" placeholder="Prix unitaire"><button type="button" class="ibtn dng" data-rml aria-label="Retirer">${ic('trash', 16)}</button></div>`
    const calc = () => { let s = 0; md.querySelectorAll('.ln').forEach(l => { s += num(l.querySelector('[data-k=q]').value.replace(',', '.')) * num(l.querySelector('[data-k=p]').value.replace(',', '.')) }); const dv = num(md.querySelector('[name=discount]').value.replace(',', '.')); const n = Math.max(0, s - dv)
      md.querySelector('.itot b').textContent = money(n, d.currency); md.querySelector('.fixw').hidden = n >= d.paid - 0.001 }
    const v = await modal({ title: 'Corriger la facture ' + d.number, icon: 'edit', wide: true, ok: 'Enregistrer la correction',
      html: `<p class="note"><b>Facture verrouillée.</b> La version actuelle (${money(d.total, d.currency)}) sera conservée dans l'historique avec votre nom, la date et le motif. Déjà payé : <b>${money(d.paid, d.currency)}</b>.</p>
        <div class="fg"><label>Médecin responsable <i class="req">*</i><select name="doctor_id" required><option value="">— Choisir le médecin —</option>${docs.map(x => `<option value="${x.id}" ${d.doctor_id === x.id ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select></label>${fld('Remise (montant)', 'discount', `inputmode="decimal" value="${d.discount || ''}"`)}</div>
        <div class="lnh"><span>Description</span><span>Qté</span><span>Prix unitaire</span><span></span></div><div class="lns">${d.items.map(lineHtml).join('')}</div><button type="button" class="sec bs" data-addl>${ic('plus', 15)}Ajouter une ligne</button>
        <div class="itot">Nouveau total <b></b></div><div class="note fixw" style="background:#fdecec;color:#a52828" hidden>Le nouveau total est inférieur aux paiements déjà reçus : annulez d'abord un paiement.</div>
        <label class="ml">Motif de la correction *<input name="reason" required placeholder="Ex : prestation oubliée, erreur de prix"></label>`,
      onOpen: m => { md = m; calc(); m.addEventListener('input', calc); m.addEventListener('click', e => { if (e.target.closest('[data-addl]')) { m.querySelector('.lns').insertAdjacentHTML('beforeend', lineHtml()); calc() } const rm = e.target.closest('[data-rml]'); if (rm && m.querySelectorAll('.ln').length > 1) { rm.closest('.ln').remove(); calc() } }) },
      submit: f => api(`/invoices/${id}/correct`, { reason: f.reason, doctor_id: f.doctor_id, discount: f.discount, items: [...md.querySelectorAll('.ln')].map(l => ({ description: l.querySelector('[data-k=d]').value.trim(), qty: l.querySelector('[data-k=q]').value.trim(), unit_price: l.querySelector('[data-k=p]').value.trim() })).filter(i => i.description) }) })
    if (v) { toast('Facture corrigée : la version précédente est conservée dans l\'historique'); render() } }
  const invHistory = async id => {
    const h = await api(`/invoices/${id}/history`), i = h.invoice, dt = x => new Date(x).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })
    const ev = [{ at: i.created_at, html: `<b>Facture créée</b>${i.created_by_name ? ' par ' + esc(i.created_by_name) : ''}` },
      ...h.revisions.map(r => ({ at: r.changed_at, html: `<b>Correction</b> par ${esc(r.who)} · motif : « ${esc(r.reason)} »<div class="revd"><span>Avant : ${r.before.items.map(x => esc(x.description) + ' ×' + x.qty + ' = ' + money(x.line_total, r.before.currency)).join(', ')}${r.before.discount ? ' · remise ' + money(r.before.discount, r.before.currency) : ''} → <b>${money(r.before.total, r.before.currency)}</b></span><span>Après : ${r.after.items.map(x => esc(x.description) + ' ×' + x.qty + ' = ' + money(x.line_total, r.after.currency)).join(', ')}${r.after.discount ? ' · remise ' + money(r.after.discount, r.after.currency) : ''} → <b>${money(r.after.total, r.after.currency)}</b></span></div>` })),
      ...h.payments.map(p => ({ at: p.created_at, html: `<b>Paiement ${esc(p.receipt_number)}</b> : ${money(p.amount, p.currency)} · ${esc(p.method)}${p.reference ? ' · réf. ' + esc(p.reference) : ''}${p.who ? ' · ' + esc(p.who) : ''}${p.voided_at ? ` <span class="badge st-off">annulé le ${dt(p.voided_at)} : ${esc(p.void_reason || '')}</span>` : ''}` })),
      ...(i.cancelled_at ? [{ at: i.cancelled_at, html: `<b>Facture annulée</b> par ${esc(i.cancelled_by_name || '—')} · motif : « ${esc(i.cancel_reason || '')} »` }] : [])].sort((a, b) => new Date(a.at) - new Date(b.at))
    await window.ui.dialog({ title: 'Historique · ' + i.number, icon: 'clock', wide: true, html: `<div class="hist">${ev.map(e => `<div class="he"><i></i><div><small>${dt(e.at)}</small><div>${e.html}</div></div></div>`).join('')}</div>`, buttons: [{ label: 'Fermer', cls: 'pri', value: true }] }) }
  const payInvoice = async b => {
    let r; const key = crypto.randomUUID(), cur = b.dataset.cur
    const v = await modal({ title: 'Encaisser un paiement', icon: 'wallet', ok: 'Enregistrer le paiement',
      html: `<p class="note">Facture <b>${esc(b.dataset.num)}</b> · reste à payer <b>${money(b.dataset.rest, cur)}</b></p><div class="fg">${fld('Montant reçu *', 'amount', `required inputmode="decimal" value="${b.dataset.rest}"`, 's2')}${sel('Devise', 'currency', ['HTG', 'USD'], cur)}${sel('Mode de paiement', 'method', METHODS)}${fld('Référence de la transaction', 'reference', 'placeholder="N° MonCash, virement… (facultatif)"')}</div>`,
      submit: async f => { r = await api(`/invoices/${b.dataset.id}/payments`, { amount: f.amount.replace(',', '.').replace(/\s/g, ''), currency: f.currency, method: f.method, reference: f.reference, idempotency_key: key }) } })
    if (v && r) { toast('Paiement enregistré : ' + r.receipt_number); printDoc(`/api/payments/${r.id}/receipt`); render() }
  }
  const receipts = async b => {
    const fin = can('manage_finances'); let changed = false
    const load = async md => { const p = await api(`/invoices/${b.dataset.id}/payments`)
      md.querySelector('.plist').innerHTML = p.length ? p.map(x => `<div class="mv ${x.voided_at ? 'inact' : ''}"><span class="mvi ${x.voided_at ? 'out' : 'in'}">${ic(x.voided_at ? 'x' : 'check', 17)}</span><span class="hn"><b>${esc(x.receipt_number)} · ${money(x.amount, x.currency)}</b><small>${new Date(x.created_at).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })} · ${esc(x.method)}${x.reference ? ' · réf. ' + esc(x.reference) : ''}${x.voided_at ? ' · annulé' : ''}</small></span><span class="acts">${x.voided_at ? badge('Annulé', 'st-off') : `${bsLink(`/api/payments/${x.id}/receipt`, 'Reçu')}${bsPrint(`/api/payments/${x.id}/receipt`, 'Imprimer')}${fin ? `<button type="button" class="bs dng" data-void="${x.id}">${ic('x', 15)}Annuler</button>` : ''}`}</span></div>`).join('')
        : empty('receipt', 'Aucun paiement', 'Aucun encaissement enregistré pour cette facture.') }
    await window.ui.dialog({ title: 'Paiements — ' + b.dataset.num, icon: 'receipt', wide: true, html: '<div class="plist">' + spinnerBlock('Chargement des paiements…') + '</div>', buttons: [{ label: 'Fermer', cls: 'pri', value: true }],
      onOpen: md => { load(md).catch(x => toast(x.message))
        md.addEventListener('click', async e => { const t = e.target.closest('[data-void]'); if (!t) return
          const reason = await window.ui.prompt("Motif de l'annulation du paiement :", '', { title: 'Annuler le paiement' }); if (!reason) return
          try { await api(`/payments/${t.dataset.void}/void`, { reason }); changed = true; toast('Paiement annulé'); await load(md) } catch (x) { toast(x.message) } }) } })
    if (changed) render()
  }
  const tariffModal = async t => {
    const cats = [...new Set(((await loadTariffs(api)).rows || []).map(x => x.category).filter(Boolean))]
    const v = await modal({ title: t ? 'Modifier le tarif' : 'Nouveau tarif', icon: 'receipt', ok: t ? 'Enregistrer' : 'Ajouter',
      html: `<div class="fg">${fld('Code', 'code', `value="${esc(t?.code || '')}" placeholder="Ex : PROPH"`)}${fld('Nom du soin *', 'name', `required value="${esc(t?.name || '')}" placeholder="Ex : Détartrage"`, 's2')}<label>Catégorie<input name="category" list="tfcats" value="${esc(t?.category || '')}" placeholder="Ex : Chirurgie"><datalist id="tfcats">${cats.map(c => `<option value="${esc(c)}">`).join('')}</datalist></label>
        ${sel('Devise', 'currency', [['HTG', 'Gourdes (HTG)'], ['USD', 'Dollars ($)']], t?.currency || 'HTG')}${fld('Prix', 'price', `inputmode="decimal" value="${t?.price ?? ''}" placeholder="Vide = à déterminer"`)}${fld('Ordre d\'affichage', 'sort', `type="number" value="${t?.sort ?? 100}"`)}${fld('Note', 'note', `value="${esc(t?.note || '')}" placeholder="Facultatif"`, 's2')}</div>
        <label class="ck"><input type="checkbox" name="tbd" ${t && t.price == null ? 'checked' : ''}> Prix à déterminer selon le cas</label>`,
      onOpen: md => { const c = md.querySelector('[name=tbd]'), p = md.querySelector('[name=price]'), sync = () => { p.disabled = c.checked; if (c.checked) p.value = '' }; c.addEventListener('change', sync); sync() },
      submit: f => api(t ? `/tariffs/${t.id}` : '/tariffs', { ...f, price: f.tbd ? '' : f.price }) })
    if (v) { resetTariffs(); toast(t ? 'Tarif mis à jour' : 'Tarif ajouté'); render() } }
  const newEmployee = async () => {
    const v = await modal({ title: 'Nouvel employé', icon: 'users', wide: true, ok: 'Ajouter',
      html: `<div class="fg">${fld('Prénom *', 'first_name', 'required')}${fld('Nom *', 'last_name', 'required')}${fld('Fonction', 'job_title', 'placeholder="Ex : Assistante dentaire"')}${fld('Matricule', 'matricule')}${fld("Date d'embauche", 'hire_date', 'type="date"')}${payTypeFields()}</div>`, onOpen: m => wirePayType(m),
      submit: f => api('/employees', { ...f, ...payTypeValues(f) }) })
    if (v) { toast('Employé ajouté'); render() }
  }
  const adjust = async b => {
    const [c, p, d, a] = b.dataset.v.split(','), base = num(b.dataset.base), auto = num(b.dataset.auto); let md
    const calc = () => { const g = n => num(md.querySelector(`[name=${n}]`).value.replace(',', '.')); md.querySelector('.itot b').textContent = money(base + g('commissions') + g('bonuses') - auto - g('deductions') - g('advances'), 'HTG') }
    const v = await modal({ title: 'Ajuster la paie — ' + b.dataset.name, icon: 'edit', ok: 'Enregistrer',
      html: `<p class="note">Salaire de base : <b>${money(base, 'HTG')}</b> · déjà versé : <b>${money(b.dataset.paid, 'HTG')}</b></p><div class="fg">${fld('Commissions', 'commissions', `inputmode="decimal" value="${c}"`)}${fld('Primes', 'bonuses', `inputmode="decimal" value="${p}"`)}${fld('Autres déductions (ponctuelles)', 'deductions', `inputmode="decimal" value="${d}"`)}${fld('Avances', 'advances', `inputmode="decimal" value="${a}"`)}</div>${auto ? `<p class="muted fnote">Retenues automatiques de l'employé : <b>${money(auto, 'HTG')}</b> (recalculées à l'enregistrement si elles sont en pourcentage). Elles se gèrent avec le bouton « Retenues » de l'employé.</p>` : ''}<div class="itot">Net à payer <b></b></div>`,
      onOpen: m => { md = m; calc(); m.addEventListener('input', calc) },
      submit: f => api(`/payroll/${b.dataset.id}/adjust`, Object.fromEntries(Object.entries(f).map(([k, x]) => [k, (x || '0').replace(',', '.')]))) })
    if (v) { toast('Paie ajustée'); render() }
  }
  const paySalary = async b => {
    const v = await modal({ title: 'Verser un salaire', icon: 'wallet', ok: 'Enregistrer le versement',
      html: `<p class="note">${esc(b.dataset.name)} · reste à verser <b>${money(b.dataset.rest, 'HTG')}</b></p><div class="fg">${fld('Montant versé (HTG) *', 'amount', `required inputmode="decimal" value="${b.dataset.rest}"`)}${sel('Mode de paiement', 'method', METHODS)}</div>`,
      submit: f => api(`/payroll/${b.dataset.id}/pay`, { amount: f.amount.replace(',', '.'), method: f.method }) })
    if (v) { toast('Versement enregistré'); render() }
  }

  let dfT; document.addEventListener('input', e => { const k = e.target.dataset?.df; if (!k) return; df[k] = e.target.value; clearTimeout(dfT); dfT = setTimeout(() => { const pos = e.target.selectionStart; render(); setTimeout(() => { const el = document.querySelector(`[data-df="${k}"]`); if (el && el.tagName === 'INPUT' && el.type !== 'date') { el.focus(); try { el.setSelectionRange(pos, pos) } catch {} } }, 400) }, ['q', 'min'].includes(k) ? 450 : 50) })
  document.addEventListener('input', e => { if (!e.target.closest?.('[data-f="rate-now"]')) return; const r = num(e.target.value.replace(',', '.')); document.querySelectorAll('[data-usd]').forEach(x => { if (r > 0) { x.classList.remove('err'); x.innerHTML = `≈ <b>${money(Number(x.dataset.usd) * r)}</b> avec ce taux` } }) })
  const submit = { async 'rate-now'(e) { const v = new FormData(e.target).get('rate'); const r = await api('/rates', { rate: v, justification: 'Taux du jour (page Tarifs)' }); resetTariffs(); toast(`Taux du jour appliqué : 1 $ US = ${r.rate.toLocaleString('fr-FR')} HTG`); render() },
    async period(e) { period = F(e).period || period; render() } }
  const click = async (b, a, id) => {
    if (a === 'bl-kind') { kind = id; bpage = 0; render() }
    else if (a === 'bl-prev') { bpage = Math.max(0, bpage - 1); render() } else if (a === 'bl-next') { bpage++; render() }
    else if (a === 'bl-new') await newInvoice()
    else if (a === 'bl-pay') await payInvoice(b)
    else if (a === 'bl-fix') await fixInvoice(id)
    else if (a === 'bl-hist') await invHistory(id)
    else if (a === 'bl-rec') await receipts(b)
    else if (a === 'bl-conv') { if (!await window.ui.confirm('Convertir cette proforma en facture ? Une nouvelle facture sera créée avec les mêmes prestations.', { title: 'Convertir en facture', ok: 'Convertir' })) return true; const r = await api(`/invoices/${id}/convert`, {}); kind = 'invoice'; bpage = 0; toast('Facture créée : ' + r.number); render() }
    else if (a === 'bl-cancel') { const v = await modal({ title: 'Annuler la facture', icon: 'alert', tone: 'danger', danger: true, ok: 'Annuler la facture', html: '<p class="note">La facture reste conservée et visible (jamais supprimée). L\'annulation est tracée avec votre nom, la date et le motif.</p><label class="ml">Motif de l\'annulation *<input name="reason" required placeholder="Ex : erreur de prestation"></label>', submit: f => api(`/invoices/${id}/cancel`, { reason: f.reason }) }); if (v) { toast('Facture annulée'); render() } }
    else if (a === 'db-pdf') { const qs = new URLSearchParams(Object.entries({ from: df.from, to: df.to, doctor: df.doctor }).filter(([, v]) => v)).toString(); window.open('/api/debts/pdf' + (qs ? '?' + qs : ''), '_blank') }
    else if (a === 'db-reset') { df = { from: '', to: '', doctor: '', min: '', q: '' }; render() }
    else if (a === 'db-csv') { const g = views._debts || [], L = [['Patient', 'N° dossier', 'Téléphone', 'Facture', 'Date', 'Médecin', 'Devise', 'Total', 'Remise', 'Payé', 'Solde', 'Ancienneté (jours)', 'Dernier paiement']]
      for (const p of g) for (const r of p.inv) L.push([p.name, p.file, p.phone || '', r.number, fdate(r.created_at), r.doctor || '', r.currency, r.total, r.discount, r.paid, r.balance, r.age_days, r.last_payment ? fdate(r.last_payment) : ''])
      const csv = '\ufeff' + L.map(l => l.map(x => `"${String(x ?? '').replace(/"/g, '""')}"`).join(';')).join('\r\n'), a2 = document.createElement('a')
      a2.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' })); a2.download = `dettes-patients-${new Date().toLocaleDateString('en-CA', { timeZone: 'America/Port-au-Prince' })}.csv`; a2.click(); setTimeout(() => URL.revokeObjectURL(a2.href), 2000); toast('Export prêt : ouvrez le fichier avec Excel') }
    else if (a === 'tf-new') await tariffModal()
    else if (a === 'tf-edit') { const all = (await api('/tariffs?all=1')).rows; await tariffModal(all.find(t => t.id === id)) }
    else if (a === 'tf-act') { await api(`/tariffs/${id}`, { active: b.dataset.on === '1' }); resetTariffs(); toast(b.dataset.on === '1' ? 'Tarif réactivé' : 'Tarif désactivé'); render() }
    else if (a === 'hr-new') await newEmployee()
    else if (a === 'hr-ded') { const e = views._emps.find(x => x.id === id); if (!e) return; let md
      const SUG = ['Impôt sur le revenu (IRI)', 'ONA (assurance vieillesse)', 'CFGDCT', 'Assurance santé', 'Remboursement de prêt', 'Retenue disciplinaire']
      const list = async () => { const rows = await api(`/employees/${e.id}/deductions`); md.querySelector('[data-dl]').innerHTML = rows.length ? rows.map(x => `<div class="kvr">${ic('minus', 15)}<span><b>${esc(x.label)}</b> · ${x.kind === 'pct' ? x.value + ' % du salaire brut' : money(x.value, 'HTG') + ' par mois'}</span><button type="button" class="bs dng" data-rmd="${x.id}">${ic('trash', 14)}Retirer</button></div>`).join('') : '<p class="muted" style="margin:0">Aucune retenue : le net = brut − avances − déductions ponctuelles.</p>' }
      await modal({ title: 'Retenues sur salaire · ' + e.first_name + ' ' + e.last_name, icon: 'minus', ok: 'Fermer', wide: true,
        html: `<p class="note">Rémunération : <b>${payLabel(e) || 'à définir'}</b>. Les retenues sont déduites automatiquement de chaque fiche de paie non encore payée, et détaillées sur le bulletin.</p><div data-dl></div>
          <h4>Ajouter une retenue</h4><div class="qchips">${SUG.map(x => `<button type="button" class="qc" data-sug="${esc(x)}">${esc(x)}</button>`).join('')}</div>
          <div class="fg"><label class="s2">Libellé<input data-k="label" placeholder="Ex : Impôt sur le revenu"></label><label>Type<select data-k="kind"><option value="pct">Pourcentage du brut</option><option value="fixed">Montant fixe (HTG / mois)</option></select></label><label>Valeur<input data-k="value" inputmode="decimal" placeholder="Ex : 10"></label></div><button type="button" class="sec bs" data-addd>${ic('plus', 15)}Ajouter</button><div class="merr" data-de hidden></div>`,
        onOpen: m => { md = m; list(); m.addEventListener('click', async ev => { const s = ev.target.closest('[data-sug]'); if (s) { m.querySelector('[data-k=label]').value = s.dataset.sug; m.querySelector('[data-k=value]').focus() }
          const rm = ev.target.closest('[data-rmd]'); if (rm) { await api(`/deductions/${rm.dataset.rmd}/remove`, {}); list() }
          if (ev.target.closest('[data-addd]')) { const er = m.querySelector('[data-de]'); er.hidden = true; try { await api(`/employees/${e.id}/deductions`, { label: m.querySelector('[data-k=label]').value, kind: m.querySelector('[data-k=kind]').value, value: m.querySelector('[data-k=value]').value }); m.querySelectorAll('[data-k=label],[data-k=value]').forEach(i => i.value = ''); list() } catch (x) { er.textContent = x.message; er.hidden = false } } }) },
        submit: async () => {} })
      render() }
    else if (a === 'hr-payset') { const e = id ? views._emps.find(x => x.id === id) : views._emps.find(x => x.user_id === b.dataset.u), u = !e && views._unpaid.find(x => x.id === b.dataset.u), who = e ? e.first_name + ' ' + e.last_name : u ? u.first_name + ' ' + u.last_name : ''
      const v = await modal({ title: 'Rémunération', icon: 'wallet', ok: 'Enregistrer', html: `<p class="note"><b>${esc(who)}</b> · le changement s'applique aux prochaines fiches de paie (les fiches déjà générées ne sont pas modifiées).</p><div class="fg">${payTypeFields(e || {}, { doctor: (e?.role || u?.role) === 'DENTIST' })}</div>`, onOpen: m => wirePayType(m),
        submit: f => api('/staff/pay', { employee_id: e?.id, user_id: e ? undefined : b.dataset.u, ...payTypeValues(f) }) })
      if (v) { toast('Rémunération enregistrée : ' + (payLabel({ base_salary: v.pay_type === 'pourcentage' ? 0 : v.base_salary, commission_pct: v.pay_type === 'fixe' ? 0 : v.commission_pct }) || '')); render() } }
    else if (a === 'hr-gen') { const r = await blocking('Génération de la paie : salaires, commissions et retenues…', () => api('/payroll/generate', { period })); toast(r.created ? r.created + ' fiche(s) créée(s)' : 'Toutes les fiches existent déjà pour ce mois'); render() }
    else if (a === 'hr-adj') await adjust(b)
    else if (a === 'hr-pay') await paySalary(b)
    else return false
    return true
  }
  return { views, submit, click }
}
