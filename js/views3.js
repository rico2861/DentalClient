import { ic } from './icons.js'
import { num, money, qty, fdate, fdt, monthLabel, head, btn, bs, kpi, kpis, badge, pbar, empty, card, search, fld, sel, modal, noRes, tips } from './kit.js'
export default function install({ $, esc, api, can, toast, render }) {
  const F = e => Object.fromEntries(new FormData(e.target)), pid = () => location.hash.split('/')[1]
  let tab = 'general', tooth = null, month = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Port-au-Prince' }).slice(0, 7)
  const COL = { saine: '#d7f0e0', carie: '#f6c6c6', extraite: '#d9d9d9', a_extraire: '#ffd9a8', restauree: '#cfe3fb', couronne: '#e6d5fa', implant: '#c8efef', bridge: '#f3eec0', anomalie: '#ffb3d1' }
  const UP = [18, 17, 16, 15, 14, 13, 12, 11, 21, 22, 23, 24, 25, 26, 27, 28], LOW = [48, 47, 46, 45, 44, 43, 42, 41, 31, 32, 33, 34, 35, 36, 37, 38]
  const HB = ['diabetes', 'hemophilia', 'hiv', 'smoking', 'alcohol', 'pregnancy', 'cardiovascular', 'pulmonary', 'epilepsy', 'stomach', 'cancer', 'migraines']
  const HL = { diabetes: 'Diabète', hemophilia: 'Hémophilie', hiv: 'VIH/SIDA', smoking: 'Tabagisme', alcohol: 'Alcool', pregnancy: 'Grossesse', cardiovascular: 'Cardiovasculaire', pulmonary: 'Pulmonaire', epilepsy: 'Épilepsie', stomach: 'Estomac', cancer: 'Cancer', migraines: 'Migraines' }
  const fd = d => d ? new Date(d).toLocaleString('fr-FR', { timeZone: 'America/Port-au-Prince' }) : '—'
  const opts = (a, v = 'id', l = 'name') => a.map(x => `<option value="${esc(x[v])}">${esc(x[l])}</option>`).join('')
  const views = {
    async record() {
      const id = pid(); if (!id) { $('#view').innerHTML = '<h2>Dossiers</h2><p>Ouvrez un dossier depuis la liste des patients (cliquez sur le numéro de dossier).</p>'; return }
      const r = await api(`/patients/${id}/record`), p = r.patient, H = r.history, tm = new Map(r.teeth.map(t => [t.tooth_fdi, t.state]))
      const T = (n) => `<button type="button" data-a="tooth" data-id="${n}" style="min-width:38px;padding:8px 4px;background:${COL[tm.get(n)] || '#fff'};color:#000;border:${tooth === n ? '3px solid var(--b)' : '1px solid #bbb'}">${n}</button>`
      const tabs = [['general', 'Vue générale'], ['hist', 'Histoire médicale'], ['cons', 'Consultations'], ['odo', 'Odontogramme'], ['time', 'Timeline'], ['docs', 'Documents & consentements'], ['care', 'Hygiène & examen']]
      const body = { general: `<div class="card"><b>${esc(p.last_name)} ${esc(p.first_name)}</b> — ${esc(p.file_number)}<br>Tél : ${esc(p.phone)} · Naissance : ${esc(p.birth_date?.slice(0, 10))}<br><br><b>Historique des médecins traitants</b><table>${r.doctors.map(d => `<tr><td>${esc(d.doctor)}</td><td>${fd(d.started_at)}</td><td>${d.ended_at ? ic('right', 13) + ' ' + fd(d.ended_at) : 'actuel'}</td></tr>`).join('') || '<tr><td>Aucun médecin traitant défini.</td></tr>'}</table>
        ${can('edit_patients') ? `<form class="row" data-f="pdoc"><select name="doctor_id" id="docsel"></select><button class="sec">Changer le médecin traitant</button></form>` : ''}</div>`,
        hist: `<form class="card col" data-f="hist"><div class="row">${HB.map(k => `<label><input type="checkbox" name="${k}" ${H[k] ? 'checked' : ''}> ${HL[k]}</label>`).join('')}</div>
          <div class="row"><input name="blood_pressure" placeholder="Tension" value="${esc(H.blood_pressure)}"><input name="blood_group" placeholder="Groupe sanguin" value="${esc(H.blood_group)}"></div>
          <input name="allergies" placeholder="Allergies" value="${esc(H.allergies)}"><input name="medications" placeholder="Médicaments" value="${esc(H.medications)}"><input name="other" placeholder="Autres antécédents" value="${esc(H.other)}"><input name="observations" placeholder="Observations" value="${esc(H.observations)}">
          <span class="muted">Dernière mise à jour : ${fd(r.history_at)}</span>${can('edit_medical_records') ? '<button>Enregistrer</button>' : ''}</form>`,
        cons: `${can('edit_medical_records') ? `<form class="card col" data-f="cons"><div class="row"><select name="doctor_id" id="docsel2"></select><input name="reason" placeholder="Motif" required><input name="teeth" placeholder="Dents (ex : 26, 27)"><input name="cost" placeholder="Coût (HTG)" inputmode="decimal"></div><input name="diagnosis" placeholder="Diagnostic"><input name="treatment" placeholder="Traitement réalisé"><input name="notes" placeholder="Observations"><button>Enregistrer la consultation</button></form>` : ''}
          <div class="card"><table><tr><th>Date</th><th>Médecin intervenant</th><th>Médecin traitant</th><th>Motif</th><th>Diagnostic</th><th>Traitement</th><th>Dents</th><th>Coût</th></tr>${r.consultations.map(c => `<tr><td>${fd(c.consulted_at)}</td><td>${esc(c.doctor)}</td><td>${esc(c.primary_doctor)}</td><td>${esc(c.reason)}</td><td>${esc(c.diagnosis)}</td><td>${esc(c.treatment)}</td><td>${(c.teeth || []).join(', ')}</td><td>${esc(c.cost)}</td></tr>`).join('') || '<tr><td>Aucune consultation.</td></tr>'}</table></div>`,
        odo: `<div class="card"><div class="row">${UP.map(T).join('')}</div><div class="row">${LOW.map(T).join('')}</div>
          ${can('edit_medical_records') ? `<form class="row" data-f="tooth"><b>Dent ${tooth ?? '—'}</b><select name="state">${Object.keys(COL).map(s => `<option>${s}</option>`).join('')}</select><input name="note" placeholder="Note"><button ${tooth ? '' : 'disabled'}>Enregistrer l'état</button></form>` : ''}
          <div class="row">${Object.entries(COL).map(([s, c]) => `<span class="badge" style="background:${c};color:#000">${s}</span>`).join('')}</div></div>
          <div class="card"><b>Historique des modifications</b><table>${r.tooth_log.map(t => `<tr><td>${fd(t.recorded_at)}</td><td>Dent ${t.tooth_fdi}</td><td>${esc(t.state)}</td><td>${esc(t.doctor)}</td><td>${esc(t.note)}</td></tr>`).join('') || '<tr><td>Aucune modification.</td></tr>'}</table></div>`,
        time: `<div class="card">${r.timeline.map(t => `<div style="border-left:3px solid var(--b);padding:4px 12px;margin:8px 0"><b>${fd(t.at)}</b> — ${esc(t.doctor)}<br>${esc(t.text)}</div>`).join('') || 'Aucun événement.'}</div>` }[tab]
      $('#view').innerHTML = `<h2>${esc(p.last_name)} ${esc(p.first_name)}</h2><div class="row">${tabs.map(([k, l]) => `<button class="${tab === k ? '' : 'sec'}" data-a="tab" data-id="${k}">${l}</button>`).join('')}</div>${body}`
      if ($('#docsel') || $('#docsel2')) { const d = await api('/doctors'); for (const s of ['#docsel', '#docsel2']) if ($(s)) $(s).innerHTML = (s === '#docsel2' ? '<option value="">Médecin intervenant (moi)</option>' : '') + opts(d) }
    },
    async stock() {
      const fin = can('manage_finances'), [prods, sups, purs, al] = await Promise.all([api('/products'), api('/suppliers'), api('/purchases'), api('/stock/alerts')]); cache = { prods, sups }
      const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Port-au-Prince' }), soon = new Date(Date.now() + 60 * 864e5).toISOString().slice(0, 10), value = prods.reduce((s, p) => s + num(p.value), 0)
      const lvl = p => { const s = num(p.stock), m = num(p.min_stock); return s <= 0 ? ['Rupture', 'st-off', 'var(--err)'] : s <= m ? ['Stock faible', 'st-warn', 'var(--warn)'] : ['Disponible', 'st-ok', 'var(--ok)'] }
      const exp = d => { if (!d) return '<span class="muted">—</span>'; const x = String(d).slice(0, 10); return x < today ? badge('Expiré · ' + fdate(d), 'st-off') : x <= soon ? badge(fdate(d), 'st-warn') : fdate(d) }
      const prow = p => { const [l, c, col] = lvl(p), m = num(p.min_stock), s = num(p.stock)
        return `<tr data-s="${esc(`${p.name} ${p.ref || ''} ${p.category || ''}`.toLowerCase())}"><td><b>${esc(p.name)}</b>${p.ref ? `<br><small class="muted">Réf. ${esc(p.ref)}</small>` : ''}</td><td>${p.category ? badge(esc(p.category), 'st-done') : '<span class="muted">—</span>'}</td>
          <td><div class="lvl">${pbar(m > 0 ? s / (m * 2) : s > 0 ? 1 : 0, col)}<span><b>${qty(s)}</b> ${esc(p.unit)}</span></div></td><td class="r">${qty(m)}</td><td class="r">${money(p.value, 'HTG')}</td><td>${exp(p.next_expiry)}</td><td>${badge(l, c)}</td></tr>` }
      const urow = p => `<tr data-s="${esc(`${p.supplier || ''} ${p.items || ''}`.toLowerCase())}"><td>${fdate(p.created_at)}</td><td><b>${esc(p.supplier) || '<span class="muted">Sans fournisseur</span>'}</b></td><td class="wrap">${esc(p.items)}</td><td class="r"><b>${money(p.total, p.currency)}</b></td>
        <td>${p.status === 'received' ? badge('Reçu', 'st-ok') : badge('Commandé', 'st-info')} ${p.paid ? badge('Payé', 'st-ok') : badge('Non payé', 'st-warn')}</td><td class="act"><div class="acts">${p.status === 'ordered' ? bs('sk-recv', p.id, 'Réceptionner', 'check', 'pri') : ''}${!p.paid && fin ? bs('sk-ppay', p.id, 'Payer', 'wallet') : ''}</div></td></tr>`
      $('#view').innerHTML = head('Stock', 'Produits, achats, consommations et inventaire',
        btn('sk-prod', 'Nouveau produit', 'plus') + btn('sk-buy', 'Commande', 'cart', 'sec') + btn('sk-use', 'Consommation', 'activity', 'sec') + btn('sk-count', 'Inventaire', 'clipboard', 'sec'))
        + kpis([kpi('blue', 'Valeur du stock', money(value, 'HTG'), `${prods.length} produit(s)`, 'package'), kpi(al.low.length ? 'orange' : 'teal', 'Stock faible', al.low.length, 'au niveau minimum ou en dessous', 'alert'),
          kpi(al.expired.length ? 'red' : 'green', 'Lots expirés', al.expired.length, 'à retirer du stock', 'x'), kpi('violet', 'Expirent sous 60 j', al.near_expiry.length, 'à utiliser en priorité', 'clock')])
        + tips([prods.filter(p => num(p.stock) <= 0).length && { icon: 'alert', tone: 'danger', text: `Rupture : <b>${prods.filter(p => num(p.stock) <= 0).slice(0, 4).map(p => esc(p.name)).join(', ')}</b>${prods.filter(p => num(p.stock) <= 0).length > 4 ? '…' : ''}. Passez commande.` },
          al.low.length && { icon: 'cart', tone: 'warn', text: `<b>${al.low.length}</b> produit(s) au niveau minimum : prévoyez une commande.`, href: '#demandes-achat' },
          al.expired.length && { icon: 'x', tone: 'danger', text: `<b>${al.expired.length}</b> lot(s) expiré(s) à retirer du stock (inventaire physique).` },
          purs.filter(p => p.status === 'ordered').length && { icon: 'package', text: `<b>${purs.filter(p => p.status === 'ordered').length}</b> commande(s) en attente de réception.` },
          fin && purs.filter(p => !p.paid).length && { icon: 'wallet', text: `<b>${purs.filter(p => !p.paid).length}</b> achat(s) fournisseur non payé(s).` }])
        + card('Produits', 'package', prods.length ? `<div class="tw"><table class="ptable" id="stab" data-page="10"><tr><th>Produit</th><th>Catégorie</th><th>Disponible</th><th class="r">Min.</th><th class="r">Valeur</th><th>Prochaine expiration</th><th>État</th></tr>${prods.map(prow).join('')}${noRes(7)}</table></div>`
          : empty('package', 'Aucun produit', 'Créez vos produits pour suivre le stock.', btn('sk-prod', 'Créer un produit', 'plus', 'btn')), prods.length ? search('#stab', 'Rechercher un produit…') : '')
        + card('Achats fournisseurs', 'cart', purs.length ? `<div class="tw"><table class="ptable" id="utab" data-page="8"><tr><th>Date</th><th>Fournisseur</th><th>Articles</th><th class="r">Total</th><th>Statut</th><th></th></tr>${purs.map(urow).join('')}${noRes(6)}</table></div>`
          : empty('cart', 'Aucun achat', 'Le stock augmente à la réception des commandes.'), purs.length ? search('#utab', 'Rechercher un achat…') : '')
        + card('Fournisseurs', 'briefcase', sups.length ? `<div>${sups.map(s => `<span class="sup">${ic('briefcase', 15)}<b>${esc(s.name)}</b>${s.phone ? `<small>${ic('phone', 13)} ${esc(s.phone)}</small>` : ''}</span>`).join('')}</div>` : '<p class="muted" style="margin:0">Aucun fournisseur enregistré.</p>', btn('sk-sup', 'Fournisseur', 'plus', 'sec'))
    },
    async cash() {
      const fin = can('manage_finances'), [acc, mv, ex, sm] = await Promise.all([api('/cash/accounts'), api('/cash/movements'), api('/expenses'), api('/finance/summary?month=' + month)]); cache = { acc }
      const res = num(sm.collected_htg) - num(sm.expenses_paid_htg)
      const tile = (a, k) => `<div class="acc ${a.kind}" style="animation-delay:${k * .05}s"><div class="row" style="margin:0;justify-content:space-between"><span class="ai">${ic(a.kind === 'bank' ? 'bank' : 'wallet', 20)}</span>${badge(a.currency, a.currency === 'USD' ? 'st-ok' : 'st-info')}</div><span class="an">${esc(a.name)}</span><span class="abal ${num(a.balance) < 0 ? 'neg' : ''}">${money(a.balance, a.currency)}</span><small>${a.kind === 'bank' ? 'Compte bancaire' : 'Caisse'}</small></div>`
      const erow = e => `<tr data-s="${esc(`${e.category} ${e.description || ''}`.toLowerCase())}"><td>${fdate(e.created_at)}</td><td>${badge(esc(e.category), 'st-done')}</td><td class="wrap">${esc(e.description) || '<span class="muted">—</span>'}</td><td class="r"><b>${money(e.amount, e.currency)}</b></td><td>${e.status === 'paid' ? badge('Payée', 'st-ok') : badge('À payer', 'st-warn')}</td><td class="act">${e.status === 'committed' && fin ? bs('cs-xpay', e.id, 'Payer', 'wallet', 'pri') : ''}</td></tr>`
      const mrow = m => { const inn = m.kind === 'in' || m.kind === 'transfer_in'; return `<div class="mv" data-pi="1"><span class="mvi ${inn ? 'in' : 'out'}">${ic(m.kind.startsWith('transfer') ? 'swap' : inn ? 'download' : 'upload', 17)}</span><span class="hn"><b>${esc(m.reason) || esc(m.ref)}</b><small>${esc(m.account)} · ${fdt(m.created_at)}</small></span><span class="amt ${inn ? 'pos' : 'neg'}">${inn ? '+' : '−'} ${money(m.amount, m.currency)}</span></div>` }
      $('#view').innerHTML = head('Caisse & dépenses', 'Comptes, mouvements de caisse et dépenses de la clinique',
        fin ? btn('cs-exp', 'Nouvelle dépense', 'plus') + btn('cs-mv', 'Entrée / sortie', 'swap', 'sec') + btn('cs-tr', 'Transfert', 'right', 'sec') + btn('cs-close', 'Clôturer la journée', 'lockday', 'sec') : '')
        + `<div class="mbar"><h3>Comptes</h3>${fin ? btn('cs-acc', 'Nouveau compte', 'plus', 'sec') : ''}</div>`
        + (acc.length ? `<div class="accs">${acc.map(tile).join('')}</div>` : `<div class="card">${empty('wallet', 'Aucune caisse ni compte', 'Créez une caisse pour enregistrer les entrées et sorties d\'argent.', fin ? btn('cs-acc', 'Créer une caisse', 'plus', 'btn') : '')}</div>`)
        + `<div class="mbar"><h3>Synthèse de ${monthLabel(month)}</h3><form class="row" data-f="month"><input type="month" name="month" value="${month}"><button class="sec">Afficher</button></form></div>`
        + kpis([kpi('blue', 'Facturé', money(sm.invoiced_htg, 'HTG'), 'factures émises', 'file'), kpi('green', 'Encaissé', money(sm.collected_htg, 'HTG'), 'paiements reçus', 'dollar'),
          kpi('red', 'Dépenses payées', money(sm.expenses_paid_htg, 'HTG'), `${money(sm.expenses_unpaid_htg, 'HTG')} encore à payer`, 'down'), kpi(res < 0 ? 'orange' : 'teal', 'Résultat de trésorerie', money(res, 'HTG'), 'encaissé − dépenses payées', res < 0 ? 'down' : 'up')])
        + tips([res < 0 && { icon: 'down', tone: 'danger', text: `Résultat de trésorerie négatif ce mois : les dépenses payées dépassent les encaissements de <b>${money(-res, 'HTG')}</b>.` },
          num(sm.expenses_unpaid_htg) > 0 && { icon: 'receipt', tone: 'warn', text: `<b>${money(sm.expenses_unpaid_htg, 'HTG')}</b> de dépenses engagées restent à payer.` },
          num(sm.invoiced_htg) > num(sm.collected_htg) && { icon: 'wallet', text: `${money(num(sm.invoiced_htg) - num(sm.collected_htg), 'HTG')} facturés ce mois ne sont pas encore encaissés.`, href: '#facturation' },
          fin && acc.length && { icon: 'lockday', text: 'Clôturez la caisse chaque soir : l\'écart avec le solde théorique est enregistré.' }])
        + `<p class="muted fnote">Montants en HTG. Coût des matériaux consommés ce mois : <b>${money(sm.materials_cost_htg, 'HTG')}</b> — c'est une attribution de coût, jamais une sortie de caisse.</p>`
        + `<div class="g2 wide">${card('Dépenses', 'receipt', ex.length ? `<div class="tw"><table class="ptable" id="xtab" data-page="8"><tr><th>Date</th><th>Catégorie</th><th>Description</th><th class="r">Montant</th><th>Statut</th><th></th></tr>${ex.map(erow).join('')}${noRes(6)}</table></div>`
            : empty('receipt', 'Aucune dépense', 'Les dépenses enregistrées apparaîtront ici.'), ex.length ? search('#xtab', 'Rechercher…') : '')
          + card('Derniers mouvements', 'activity', mv.length ? `<div class="mvs" data-page="8">${mv.slice(0, 30).map(mrow).join('')}</div>` : empty('activity', 'Aucun mouvement', 'Les paiements, dépenses et transferts apparaîtront ici.'))}</div>`
    }
  }
  let cache = {}
  const CATS = ['Salaires', 'Loyer', 'Électricité', 'Eau', 'Internet', 'Matériaux dentaires', 'Fournitures', 'Laboratoire', 'Maintenance', 'Transport', 'Marketing', 'Autres']
  const D = s => (s || '').trim().replace(',', '.')
  const ok = (msg, v) => { if (v) { toast(msg); render() } }
  const pick = (arr, label = a => a.name) => arr.map(a => [a.id, label(a)])
  const accLabel = a => `${a.name} — ${money(a.balance, a.currency)}`
  const needs = (arr, msg) => { if (arr?.length) return true; toast(msg); return false }
  const dialogs = {
    'sk-prod': async () => ok('Produit créé', await modal({ title: 'Nouveau produit', icon: 'package', wide: true, ok: 'Créer le produit',
      html: `<div class="fg">${fld('Nom du produit *', 'name', 'required placeholder="Ex : Anesthésique Lidocaïne 2 %"', 's2')}${fld('Référence', 'ref')}${fld('Catégorie', 'category', 'placeholder="Ex : Anesthésie"')}${fld('Unité', 'unit', 'placeholder="Ex : boîte, carpule, unité"')}${fld('Stock minimum (alerte)', 'min_stock', 'inputmode="decimal" placeholder="0"')}</div>`,
      submit: f => api('/products', { ...f, min_stock: D(f.min_stock) || undefined }) })),
    'sk-sup': async () => ok('Fournisseur ajouté', await modal({ title: 'Nouveau fournisseur', icon: 'briefcase', ok: 'Ajouter',
      html: `<div class="fg">${fld('Nom *', 'name', 'required', 's2')}${fld('Téléphone', 'phone', 'inputmode="tel"', 's2')}</div>`, submit: f => api('/suppliers', f) })),
    'sk-buy': async () => { if (!needs(cache.prods, "Créez d'abord un produit")) return
      ok("Commande enregistrée — le stock augmentera à la réception", await modal({ title: 'Nouvelle commande fournisseur', icon: 'cart', wide: true, ok: 'Commander',
        html: `<div class="fg">${sel('Produit *', 'product_id', pick(cache.prods), '', 's2')}${sel('Fournisseur', 'supplier_id', [['', 'Sans fournisseur'], ...pick(cache.sups)])}${sel('Devise', 'currency', ['HTG', 'USD'])}${fld('Quantité *', 'qty', 'required inputmode="decimal"')}${fld('Prix unitaire *', 'unit_price', 'required inputmode="decimal"')}${fld('N° de lot', 'lot_number')}${fld("Date d'expiration", 'expiry', 'type="date"')}</div>`,
        submit: f => api('/purchases', { supplier_id: f.supplier_id || null, currency: f.currency, items: [{ product_id: f.product_id, qty: D(f.qty), unit_price: D(f.unit_price), lot_number: f.lot_number, expiry: f.expiry }] }) })) },
    'sk-use': async () => { if (!needs(cache.prods, "Aucun produit en stock")) return; let r
      const v = await modal({ title: 'Enregistrer une consommation', icon: 'activity', ok: 'Utiliser',
        html: `<p class="note">Les lots qui expirent le plus tôt sont utilisés en premier (FEFO).</p><div class="fg">${sel('Produit *', 'product_id', pick(cache.prods, p => `${p.name} — ${qty(p.stock)} ${p.unit}`), '', 's2')}${fld('Quantité *', 'qty', 'required inputmode="decimal"')}${fld('Patient (facultatif)', 'patient_file', 'placeholder="Nom ou n° de dossier"')}</div>`,
        submit: async f => { r = await api('/consumptions', { ...f, qty: D(f.qty) }) } })
      if (v && r) { toast('Consommation enregistrée · coût attribué : ' + money(r.cost_htg, 'HTG')); render() } },
    'sk-count': async () => { if (!needs(cache.prods, "Aucun produit en stock")) return; let r
      const v = await modal({ title: 'Inventaire physique', icon: 'clipboard', ok: 'Corriger le stock',
        html: `<p class="note">Saisissez la quantité réellement comptée : l'écart avec le stock théorique est appliqué et tracé.</p><div class="fg">${sel('Produit *', 'product_id', pick(cache.prods, p => `${p.name} — théorique : ${qty(p.stock)} ${p.unit}`), '', 's2')}${fld('Quantité comptée *', 'counted', 'required inputmode="decimal"')}${fld("Motif de l'écart *", 'reason', 'required placeholder="Ex : casse, erreur de saisie"')}</div>`,
        submit: async f => { r = await api('/stock-counts', { ...f, counted: D(f.counted) }) } })
      if (v && r) { toast('Écart appliqué : ' + r.diff); render() } },
    'cs-acc': async () => ok('Compte créé', await modal({ title: 'Nouvelle caisse ou compte', icon: 'wallet', ok: 'Créer',
      html: `<div class="fg">${fld('Nom *', 'name', 'required placeholder="Ex : Caisse HTG"', 's2')}${sel('Type', 'kind', [['cash', 'Caisse'], ['bank', 'Compte bancaire']])}${sel('Devise', 'currency', ['HTG', 'USD'])}${fld('Solde initial', 'opening_balance', 'inputmode="decimal" placeholder="0"', 's2')}</div>`,
      submit: f => api('/cash/accounts', { ...f, opening_balance: D(f.opening_balance) || undefined }) })),
    'cs-mv': async () => { if (!needs(cache.acc, "Créez d'abord une caisse")) return
      ok('Mouvement enregistré', await modal({ title: 'Entrée ou sortie de caisse', icon: 'swap', ok: 'Enregistrer',
        html: `<p class="note">Pour les recettes et dépenses hors facture. Le motif est obligatoire et conservé dans le journal.</p><div class="fg">${sel('Caisse *', 'account_id', pick(cache.acc, accLabel), '', 's2')}${sel('Sens', 'kind', [['in', 'Entrée d\'argent'], ['out', 'Sortie d\'argent']])}${fld('Montant *', 'amount', 'required inputmode="decimal"')}${fld('Motif *', 'reason', 'required', 's2')}</div>`,
        submit: f => api('/cash/movements', { ...f, amount: D(f.amount) }) })) },
    'cs-tr': async () => { if (!needs(cache.acc?.length > 1 && cache.acc, 'Il faut au moins deux caisses pour un transfert')) return
      ok('Transfert effectué', await modal({ title: 'Transfert entre caisses', icon: 'swap', ok: 'Transférer',
        html: `<div class="fg">${sel('Depuis *', 'from', pick(cache.acc, accLabel), cache.acc[0].id, 's2')}${sel('Vers *', 'to', pick(cache.acc, accLabel), cache.acc[1].id, 's2')}${fld('Montant *', 'amount', 'required inputmode="decimal"', 's2')}</div>`,
        submit: f => { if (f.from === f.to) throw new Error('Choisissez deux caisses différentes'); return api('/cash/transfer', { ...f, amount: D(f.amount) }) } })) },
    'cs-close': async () => { if (!needs(cache.acc, "Créez d'abord une caisse")) return; let r
      const v = await modal({ title: 'Clôturer la journée', icon: 'lockday', ok: 'Clôturer',
        html: `<p class="note">Comptez l'argent présent dans la caisse : l'écart avec le solde théorique est enregistré.</p><div class="fg">${sel('Caisse *', 'account_id', pick(cache.acc, accLabel), '', 's2')}${fld('Journée *', 'day', `type="date" required value="${new Date().toLocaleDateString('en-CA', { timeZone: 'America/Port-au-Prince' })}"`)}${fld('Solde physique compté *', 'physical', 'required inputmode="decimal"')}</div>`,
        submit: async f => { r = await api('/cash/close', { ...f, physical: D(f.physical) }) } })
      if (v && r) { toast('Journée clôturée · écart : ' + r.diff); render() } },
    'cs-exp': async () => ok('Dépense enregistrée', await modal({ title: 'Nouvelle dépense', icon: 'receipt', wide: true, ok: 'Enregistrer la dépense',
      html: `<div class="fg">${sel('Catégorie *', 'category', CATS)}${fld('Description', 'description', 'placeholder="Ex : Facture EDH de novembre"')}${fld('Montant *', 'amount', 'required inputmode="decimal"')}${sel('Devise', 'currency', ['HTG', 'USD'])}</div><label class="ck"><input type="checkbox" name="pay_now"> Déjà payée (sortie de caisse immédiate)</label>`,
      submit: f => api('/expenses', { ...f, amount: D(f.amount) }) }))
  }
  const post = (path, msg) => async e => { await api(path, F(e)); toast(msg); render() }
  const submit = {
    async hist(e) { const d = F(e); for (const k of HB) d[k] = k in d; await api(`/patients/${pid()}/history`, d); toast('Histoire médicale enregistrée'); render() },
    async cons(e) { const d = F(e); if (!d.doctor_id) delete d.doctor_id; await api(`/patients/${pid()}/consultations`, d); toast('Consultation enregistrée'); tab = 'cons'; render() },
    async tooth(e) { await api(`/patients/${pid()}/teeth`, { tooth_fdi: tooth, ...F(e) }); toast('État enregistré'); render() },
    async pdoc(e) { await api(`/patients/${pid()}/primary-doctor`, F(e)); toast('Médecin traitant mis à jour'); render() },
    async month(e) { month = F(e).month || month; render() }
  }
  const click = async (b, a, id) => {
    if (a === 'tab') { if (id === 'docs' || id === 'care') { location.hash = '#' + id + '/' + pid(); return true } tab = id; render() } else if (a === 'tooth') { tooth = Number(id); render() }
    else if (dialogs[a]) await dialogs[a]()
    else if (a === 'sk-recv') { if (!await ui.confirm('Confirmer la réception de cette commande ? Le stock augmentera.', { title: 'Réceptionner la commande', ok: 'Réceptionner' })) return true; await api(`/purchases/${id}/receive`, {}); toast('Réception enregistrée'); render() }
    else if (a === 'sk-ppay') { if (!await ui.confirm('Payer cet achat ? Une dépense payée sera enregistrée.', { title: 'Payer l\'achat', ok: 'Payer' })) return true; await api(`/purchases/${id}/pay`, {}); toast('Achat payé'); render() }
    else if (a === 'cs-xpay') { if (!await ui.confirm('Marquer cette dépense comme payée ? Une sortie de caisse sera enregistrée.', { title: 'Payer la dépense', ok: 'Payer' })) return true; await api(`/expenses/${id}/pay`, {}); toast('Dépense payée'); render() }
    else return false
    return true
  }
  return { views, submit, click }
}
