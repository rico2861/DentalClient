import { ic } from './icons.js'
import { money, fdate, monthLabel, head, btn, kpi, kpis, pbar, empty, card, search, person, payBlock, wirePay, payFields, billMsg, tips, loadTariffs, tHTG, tLabel, badge, bs, docField, teethPicker, wireTeeth, teethOk, teethList, payLabel, payTypeFields, wirePayType, payTypeValues, slotBlock, wireSlots } from './kit.js'
export default function install({ $, esc, api, can, toast, render, me }) {
  const F = e => Object.fromEntries(new FormData(e.target)), today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Port-au-Prince' })
  let day = today, planId = null, month = today.slice(0, 7), pf = 'active', docSel = null, perfRows = []
  const fday = d => d ? String(d).slice(0, 10).split('-').reverse().join('/') : '—'
  const PSC = { draft: 'st-done', pending: 'st-warn', approved: 'st-info', in_progress: 'st-info', suspended: 'st-warn', done: 'st-ok', cancelled: 'st-off' }
  const pbadge = s => `<span class="badge ${PSC[s]}">${PS[s]}</span>`
  const NXT = { draft: ['pending'], pending: ['approved', 'draft'], approved: ['in_progress', 'suspended'], in_progress: ['suspended', 'done'], suspended: ['in_progress'] }
  const ACTL = { pending: 'Soumettre pour validation', approved: 'Approuver le plan', in_progress: 'Démarrer les soins', suspended: 'Suspendre', done: 'Clôturer le plan', draft: 'Repasser en brouillon' }
  const fd = d => d ? new Date(d).toLocaleString('fr-FR', { timeZone: 'America/Port-au-Prince', dateStyle: 'short', timeStyle: 'short' }) : '—'
  const opts = (a, l = 'name') => a.map(x => `<option value="${esc(x.id)}">${esc(x[l])}</option>`).join('')
  const AS = { planned: 'Planifié', confirmed: 'Confirmé', cancelled: 'Annulé', no_show: 'Absent', done: 'Terminé' }
  const ASC = { planned: 'st-info', confirmed: 'st-ok', cancelled: 'st-off', no_show: 'st-warn', done: 'st-done' }, TZ = 'America/Port-au-Prince'
  let af = { doc: '', st: '' }, pg = ''
  const PS = { draft: 'Brouillon', pending: 'En attente', approved: 'Approuvé', in_progress: 'En cours', suspended: 'Suspendu', done: 'Terminé', cancelled: 'Annulé' }
  const IS = { todo: 'Prévue', in_progress: 'En cours', postponed: 'Reportée', done: 'Terminée', cancelled: 'Annulée' }
  const STEPS = ['prescription', 'impression', 'preparation', 'sent_lab', 'manufacturing', 'returned', 'fitting', 'adjustment', 'ready', 'placed']
  const SL = { prescription: 'Prescription', impression: 'Empreinte', preparation: 'Préparation', sent_lab: 'Envoi au labo', manufacturing: 'Fabrication', returned: 'Retour', fitting: 'Essayage', adjustment: 'Ajustement', ready: 'Prête à poser', placed: 'Posée / livrée' }
  const GL = { waiting: 'En attente', at_lab: 'Au laboratoire', in_progress: 'En cours', done: 'Terminées' }
  const views = {
    async appts() {
      const dk = d => d.toLocaleDateString('en-CA', { timeZone: TZ }), at = new Date(day + 'T12:00:00'), w0 = new Date(at); w0.setDate(at.getDate() - ((at.getDay() + 6) % 7))
      const wdays = Array.from({ length: 7 }, (_, i) => { const d = new Date(w0); d.setDate(w0.getDate() + i); return dk(d) }), todayK = dk(new Date())
      const [wk, rem] = await Promise.all([api(`/appointments?from=${wdays[0]}&to=${wdays[6]}`), api('/reminders').catch(() => [])])
      const byDay = {}; for (const a of wk) (byDay[dk(new Date(a.starts_at))] ||= []).push(a)
      const docsIn = [...new Map(wk.map(a => [a.doctor, a.doctor])).keys()].sort()
      const all = (byDay[day] || []).sort((a, b) => new Date(a.starts_at) - new Date(b.starts_at)), list = all.filter(a => (!af.doc || a.doctor === af.doc) && (!af.st || a.status === af.st))
      const live = a => ['planned', 'confirmed'].includes(a.status), n = s => all.filter(a => a.status === s).length, over = rem.filter(r => r.overdue), now = Date.now()
      const next = all.find(a => live(a) && new Date(a.starts_at) > now)
      const tm = d => new Date(d).toLocaleTimeString('fr-FR', { timeZone: TZ, hour: '2-digit', minute: '2-digit' })
      const KL = { controle: 'Contrôle périodique', controle_extraction: 'Contrôle après extraction', controle_prothese: 'Contrôle après prothèse', rdv_manque: 'Rendez-vous manqué' }
      const acard = a => `<div class="apc ${a.status}" data-pi="1"><div class="apt"><b>${tm(a.starts_at)}</b><small>${a.duration_min} min</small></div>
        <div class="apb"><span><a href="#dossiers/${a.patient_id}"><b>${esc(a.patient)}</b></a> <span class="fn sm">${esc(a.file_number)}</span></span><small>${esc(a.reason) || 'Consultation'} · ${esc(a.doctor)}</small>
        <div class="apa"><span class="badge ${ASC[a.status]}">${AS[a.status]}</span>${live(a) ? `${a.status === 'planned' ? `<button class="bs" data-a="as" data-id="${a.id}" data-s="confirmed">${ic('check', 13)}Confirmer</button>` : ''}<button class="bs" data-a="as" data-id="${a.id}" data-s="done">Terminé</button><button class="bs" data-a="as" data-id="${a.id}" data-s="no_show">Absent</button><button class="bs" data-a="rs" data-id="${a.id}" data-t="${a.starts_at}">${ic('clock', 13)}Reporter</button><button class="bs dng" data-a="as" data-id="${a.id}" data-s="cancelled" aria-label="Annuler">${ic('x', 13)}</button>` : ''}</div></div></div>`
      const strip = wdays.map(k => { const d = new Date(k + 'T12:00:00'), c = (byDay[k] || []).filter(live).length
        return `<button type="button" class="wd${k === day ? ' on' : ''}${k === todayK ? ' td' : ''}" data-a="aday" data-id="${k}"><small>${d.toLocaleDateString('fr-FR', { weekday: 'short' })}</small><b>${d.getDate()}</b><em>${c ? c + ' RDV' : '—'}</em></button>` }).join('')
      $('#view').innerHTML = head('Rendez-vous', `Agenda du ${new Date(day + 'T12:00:00').toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}`,
          btn('ap-new', 'Nouveau rendez-vous', 'plus') + btn('rm-new', 'Programmer un rappel', 'bell', 'sec'))
        + `<div class="card wkbar"><button class="ibtn" data-a="aweek" data-id="-7" aria-label="Semaine précédente">${ic('left', 20)}</button><div class="wds">${strip}</div><button class="ibtn" data-a="aweek" data-id="7" aria-label="Semaine suivante">${ic('right', 20)}</button>
          <div class="wkr"><input type="date" value="${day}" data-a="adate" aria-label="Choisir une date"><button class="sec bs" data-a="aday" data-id="${todayK}">Aujourd'hui</button></div></div>`
        + kpis([kpi('blue', 'Rendez-vous du jour', all.length, next ? `prochain à ${tm(next.starts_at)} · ${esc(next.patient)}` : 'aucun à venir ce jour', 'calendar'), kpi('green', 'Confirmés', n('confirmed'), `${n('done')} terminé(s)`, 'check'), kpi(n('planned') ? 'orange' : 'teal', 'À confirmer', n('planned'), 'à appeler', 'phone'), kpi(over.length ? 'red' : 'violet', 'Patients à revoir', rem.length, over.length ? `${over.length} en retard` : 'aucun retard', 'bell')])
        + tips([n('planned') && { icon: 'phone', tone: 'warn', text: `<b>${n('planned')}</b> rendez-vous de ce jour ne sont pas encore confirmés : appelez les patients.` },
          over.length && { icon: 'alert', tone: 'danger', text: `<b>${over.length}</b> patient(s) à revoir sont en retard : ${over.slice(0, 3).map(r => esc(r.patient)).join(', ')}${over.length > 3 ? '…' : ''}. Proposez-leur un rendez-vous.` },
          n('no_show') && { icon: 'clock', text: `<b>${n('no_show')}</b> absence(s) ce jour : un rappel « rendez-vous manqué » a été créé pour chacune.` },
          !all.length && { icon: 'calendar', text: 'Aucun rendez-vous ce jour : c\'est le moment de relancer les patients à revoir.' }])
        + `<div class="g2 apw"><div class="card"><div class="chd"><h3>${ic('clock', 18)}Agenda du jour</h3><div class="row chr">${docsIn.length > 1 ? `<select data-a="afdoc" aria-label="Filtrer par médecin"><option value="">Tous les médecins</option>${docsIn.map(d => `<option ${af.doc === d ? 'selected' : ''}>${esc(d)}</option>`).join('')}</select>` : ''}
            <div class="sw">${[['', 'Tous'], ['planned', 'À confirmer'], ['confirmed', 'Confirmés'], ['done', 'Terminés']].map(([k, l]) => `<button type="button" class="${af.st === k ? 'on' : ''}" data-a="afst" data-id="${k}">${l}</button>`).join('')}</div></div></div>
            <div class="apl" data-page="6">${list.map(acard).join('') || empty('calendar', all.length ? 'Aucun rendez-vous pour ce filtre' : 'Aucun rendez-vous ce jour', '', btn('ap-new', 'Planifier un rendez-vous', 'plus', 'btn'))}</div></div>
          <div class="card"><div class="chd"><h3>${ic('bell', 18)}Patients à revoir</h3><button class="bs" data-a="rm-new">${ic('plus', 14)}Rappel</button></div>
            <div class="rml" data-page="6">${rem.map(r => `<div class="rmi${r.overdue ? ' late' : ''}" data-pi="1"><div class="rmd"><b>${new Date(r.due_date + (String(r.due_date).length === 10 ? 'T12:00:00' : '')).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' })}</b>${r.overdue ? '<small>en retard</small>' : ''}</div>
              <div class="hn"><a href="#dossiers/${r.patient_id}"><b>${esc(r.patient)}</b></a><small>${KL[r.kind] || esc(r.kind)}${r.reason ? ' · ' + esc(r.reason) : ''}${r.phone ? ' · ' + esc(r.phone) : ''}</small></div>
              <span class="acts"><button class="bs" data-a="rm-plan" data-f="${esc(r.file_number)}" data-n="${esc(r.patient)}">${ic('calendar', 13)}RDV</button><button class="bs" data-a="rd" data-id="${r.id}">${ic('check', 13)}Fait</button></span></div>`).join('') || `<div class="okline">${ic('check', 16)} Aucun patient à revoir pour le moment.</div>`}</div></div></div>`
    },
    async plans() {
      const mp = can('manage_treatment_plans'), pl = await api('/plans'), d = planId ? await api('/plans/' + planId).catch(() => null) : null
      const act = p => ['approved', 'in_progress'].includes(p.status), wait = p => ['draft', 'pending'].includes(p.status)
      const shown = pl.filter(p => pf === 'all' || (pf === 'active' ? act(p) || wait(p) || p.status === 'suspended' : p.status === pf))
      const due = pl.filter(p => p.status !== 'cancelled').reduce((s, p) => s + Math.max(0, p.balance), 0)
      const pcard = p => `<button type="button" class="plc${d?.id === p.id ? ' on' : ''}" data-a="po" data-id="${p.id}" data-s="${esc((p.patient + ' ' + (p.diagnosis || '') + ' ' + p.file_number).toLowerCase())}">
        <div class="plt"><b>${esc(p.patient)}</b>${pbadge(p.status)}</div><small class="muted">${esc(p.diagnosis) || 'Plan de traitement'} · ${esc(p.responsible) || '—'}</small>
        <div class="plp">${pbar(p.progress / 100, p.status === 'done' ? 'var(--ok)' : 'var(--b)')}<span>${p.done_n}/${p.active_n}</span></div>
        <div class="plm"><span>Total <b>${money(p.total)}</b></span><span>Payé <b>${money(p.paid)}</b></span><span class="${p.balance > 0 ? 'due' : ''}">Solde <b>${money(Math.max(0, p.balance))}</b></span></div></button>`
      const FLOW = ['draft', 'pending', 'approved', 'in_progress', 'done']
      const detail = !d ? `<div class="card pld0">${empty('clipboard', 'Sélectionnez un plan', 'Ses interventions, son avancement et ses paiements s\'afficheront ici.', mp ? btn('pl-new', 'Nouveau plan', 'plus', 'btn') : '')}</div>`
        : `<div class="card pld"><div class="pldh"><div><a class="back" href="#dossiers/${d.patient_id}">${ic('folder', 14)} Ouvrir le dossier</a><h3>${esc(d.patient)} <span class="fn sm">${esc(d.file_number)}</span></h3><div class="muted">${esc(d.diagnosis) || 'Plan de traitement'}${d.objective ? ' · ' + esc(d.objective) : ''}</div></div>${pbadge(d.status)}</div>
          <div class="flow">${FLOW.map((s, i) => `<span class="${FLOW.indexOf(d.status) >= i ? 'on' : ''}${d.status === s ? ' cur' : ''}"><i>${FLOW.indexOf(d.status) > i ? ic('check', 12) : i + 1}</i>${PS[s]}</span>`).join('')}</div>
          ${['suspended', 'cancelled'].includes(d.status) ? `<div class="banner ${d.status === 'cancelled' ? 'dangr' : 'warnb'}">${ic('alert', 16)}<span>Plan ${PS[d.status].toLowerCase()}.</span></div>` : ''}
          <div class="plk"><div><span>Responsable</span><b>${esc(d.responsible) || '—'}</b></div><div><span>Période</span><b>${d.start_date ? fday(d.start_date) : '—'}${d.end_date ? ' → ' + fday(d.end_date) : ''}</b></div><div><span>Avancement</span><b>${d.progress} %</b></div><div><span>Solde</span><b class="${d.balance > 0 ? 'neg' : 'pos'}">${money(Math.max(0, d.balance))}</b></div></div>
          ${mp ? `<div class="row plact">${(NXT[d.status] || []).map(s => `<button class="${s === 'approved' || s === 'in_progress' || s === 'done' ? '' : 'sec'}" data-a="ps" data-id="${d.id}" data-s="${s}">${ic(s === 'suspended' ? 'clock' : s === 'draft' ? 'undo' : 'check', 15)} ${ACTL[s] || PS[s]}</button>`).join('')}${['draft', 'pending', 'approved', 'in_progress', 'suspended'].includes(d.status) ? `<button class="sec dng" data-a="ps" data-id="${d.id}" data-s="cancelled">${ic('x', 15)} Annuler le plan</button>` : ''}</div>` : ''}
          <h4>Interventions prévues</h4><div class="pli" data-page="6">${d.items.map(i => `<div class="plr ${i.status}" data-pi="1"><span class="pls">${i.status === 'done' ? ic('check', 14) : i.status === 'in_progress' ? ic('clock', 14) : i.status === 'cancelled' ? ic('x', 14) : i.status === 'postponed' ? ic('undo', 14) : ''}</span>
            <div class="hn"><b>${esc(i.description)}${(i.teeth?.length ? i.teeth : i.tooth ? [i.tooth] : []).map(n => ` <span class="tchip">${n}</span>`).join('')}</b><small>${IS[i.status]}${i.doctor ? ' · ' + esc(i.doctor) : ''}${i.done_at ? ' · ' + fd(i.done_at) : ''}${i.postponed_reason ? ' · motif : ' + esc(i.postponed_reason) : ''}</small>${i.sessions_planned > 1 ? `<div class="sess">${Array.from({ length: i.sessions_planned }, (_, k) => `<i class="${k < i.sessions_done ? 'ok' : ''}"></i>`).join('')}<span>Séances ${i.sessions_done}/${i.sessions_planned}</span></div>` : ''}</div><b class="plpr">${money(i.price)}</b>
            ${mp && ['approved', 'in_progress'].includes(d.status) && i.status === 'postponed' ? `<span class="acts"><button class="bs" data-a="is" data-id="${d.id}" data-i="${i.id}" data-s="todo">${ic('undo', 14)}Reprendre</button></span>` : ''}${mp && ['approved', 'in_progress'].includes(d.status) && ['todo', 'in_progress'].includes(i.status) ? `<span class="acts">${i.sessions_planned > 1 && i.sessions_done < i.sessions_planned ? `<button class="bs" data-a="isess" data-id="${d.id}" data-i="${i.id}" data-t="${(i.teeth?.length ? i.teeth : i.tooth ? [i.tooth] : []).join(',')}" data-n="${esc(i.description)}" data-k="${i.sessions_done + 1}/${i.sessions_planned}">${ic('plus', 14)}Séance ${i.sessions_done + 1}/${i.sessions_planned}</button>` : i.status === 'todo' ? `<button class="bs" data-a="is" data-id="${d.id}" data-i="${i.id}" data-s="in_progress">${ic('clock', 14)}Démarrer</button>` : ''}<button class="bs" data-a="ipost" data-id="${d.id}" data-i="${i.id}">${ic('undo', 14)}Reporter</button><button class="bs pri" data-a="idone" data-id="${d.id}" data-i="${i.id}" data-t="${(i.teeth?.length ? i.teeth : i.tooth ? [i.tooth] : []).join(',')}" data-p="${i.price}" data-n="${esc(i.description)}">${ic('check', 14)}Terminer</button></span>` : ''}</div>`).join('')}</div>
          <div class="pltot"><span>Total du plan <b>${money(d.total)}</b></span><span>Déjà payé <b class="pos">${money(d.paid)}</b></span><span>Reste <b class="${d.balance > 0 ? 'neg' : ''}">${money(Math.max(0, d.balance))}</b></span></div>
          ${mp && wait(d) ? '<p class="muted" style="font-size:12.5px;margin:10px 0 0">Approuvez le plan pour pouvoir réaliser ses interventions. Chaque intervention terminée est facturée automatiquement au médecin qui l\'a réalisée.</p>' : ''}</div>`
      $('#view').innerHTML = head('Plans de traitement', 'Planifiez les soins, suivez leur avancement et leur paiement', mp ? btn('pl-new', 'Nouveau plan', 'plus') : '')
        + kpis([kpi('blue', 'Plans en cours', pl.filter(act).length, 'approuvés ou en cours', 'activity'), kpi('orange', 'À valider', pl.filter(wait).length, 'brouillons et en attente', 'clipboard'), kpi('green', 'Terminés', pl.filter(p => p.status === 'done').length, 'plans achevés', 'check'), kpi('violet', 'Reste à encaisser', money(due), 'sur les plans affichés', 'wallet')]) + planTips(pl)
        + `<div class="plw"><div class="card pll"><div class="chd"><div class="sw">${[['active', 'Actifs'], ['done', 'Terminés'], ['cancelled', 'Annulés'], ['all', 'Tous']].map(([k, l]) => `<button type="button" class="${pf === k ? 'on' : ''}" data-a="pl-f" data-id="${k}">${l}</button>`).join('')}</div>${search('#pllist', 'Patient ou diagnostic…')}</div>
          <div id="pllist" class="pllist" data-page="6">${shown.map(pcard).join('') || empty('clipboard', 'Aucun plan', pf === 'active' ? 'Aucun plan actif pour le moment.' : 'Aucun plan dans cette catégorie.', mp ? btn('pl-new', 'Créer un plan', 'plus', 'btn') : '')}<div class="nores" hidden><span class="muted">Aucun résultat.</span></div></div></div>${detail}</div>`
    },
    async pros() {
      const mp = can('manage_prostheses'), fin = can('manage_finances'), [list, labs] = await Promise.all([api('/prostheses'), api('/laboratories')])
      const cnt = g => list.filter(x => x.grp === g).length, shown = list.filter(x => !pg || x.grp === pg), N = n => Number(n) || 0
      const unpaid = list.filter(x => N(x.lab_cost) > 0 && !x.lab_paid), neg = list.filter(x => N(x.margin) < 0), late = list.filter(x => x.grp === 'at_lab')
      const pcard = x => { const i = STEPS.indexOf(x.step), nx = STEPS[i + 1], cost = N(x.material_cost) + N(x.lab_cost), mg = N(x.margin), pct = N(x.price) ? Math.round(mg / N(x.price) * 100) : 0
        return `<div class="prc" data-s="${esc(`${x.ref} ${x.patient} ${x.type} ${x.lab || ''} ${x.doctor}`.toLowerCase())}"><div class="prh"><span class="fn sm">${esc(x.ref)}</span><a href="#dossiers/${x.patient_id}"><b>${esc(x.patient)}</b></a><span class="badge ${x.grp === 'done' ? 'st-ok' : x.grp === 'at_lab' ? 'st-warn' : 'st-info'}">${GL[x.grp]}</span></div>
          <div class="prm">${ic('package', 14)} ${esc(x.type)}${x.teeth?.length ? ' · dents ' + x.teeth.join(', ') : ''} · ${esc(x.doctor)}${x.lab ? ' · ' + ic('briefcase', 13) + ' ' + esc(x.lab) : ''}</div>
          <div class="prs">${STEPS.map((s, k) => `<i class="${k < i ? 'ok' : k === i ? 'cur' : ''}" title="${SL[s]}"></i>`).join('')}</div><div class="prsl">Étape ${i + 1}/${STEPS.length} : <b>${SL[x.step]}</b></div>
          <div class="prf"><span>Prix <b>${money(x.price)}</b></span><span>Coût <b>${money(cost)}</b><small>matériaux ${money(x.material_cost)} + labo ${money(x.lab_cost)}</small></span><span class="${mg < 0 ? 'neg' : 'pos'}">Marge <b>${money(mg)}</b><small>${pct} % du prix</small></span></div>
          <div class="acts">${mp && nx ? `<button class="bs pri" data-a="st" data-id="${x.id}" data-s="${nx}">${ic('right', 13)}${SL[nx]}</button>` : ''}${N(x.lab_cost) > 0 && !x.lab_paid && fin ? `<button class="bs" data-a="pl" data-id="${x.id}">${ic('wallet', 13)}Payer le labo (${money(x.lab_cost)})</button>` : N(x.lab_cost) > 0 ? badge('Labo payé', 'st-ok') : ''}</div></div>` }
      $('#view').innerHTML = head('Prothèses', 'Suivi de fabrication, coûts du laboratoire et facturation au patient', mp ? btn('pr-new', 'Nouvelle prothèse', 'plus') + btn('pr-lab', 'Laboratoire', 'briefcase', 'sec') : '')
        + kpis([kpi('blue', 'En préparation', cnt('waiting'), 'prescription, empreinte', 'clipboard'), kpi('orange', 'Au laboratoire', cnt('at_lab'), 'envoyées ou en fabrication', 'package'), kpi('violet', 'Essayage / ajustement', cnt('in_progress'), 'retour du labo', 'tool'), kpi('green', 'Posées', cnt('done'), 'livrées au patient', 'check')])
        + tips([unpaid.length && fin && { icon: 'wallet', tone: 'warn', text: `<b>${unpaid.length}</b> laboratoire(s) à payer pour un total de <b>${money(unpaid.reduce((s, x) => s + N(x.lab_cost), 0))}</b>.` },
          neg.length && { icon: 'alert', tone: 'danger', text: `<b>${neg.length}</b> prothèse(s) vendue(s) à perte (coût supérieur au prix) : ${neg.slice(0, 3).map(x => esc(x.ref)).join(', ')}. Vérifiez les montants.` },
          late.length && { icon: 'clock', text: `<b>${late.length}</b> prothèse(s) au laboratoire : relancez le technicien si le délai est dépassé.` }])
        + card('Prothèses', 'package', `<div class="row" style="margin:0 0 12px"><div class="sw">${[['', 'Toutes'], ...Object.entries(GL)].map(([k, l]) => `<button type="button" class="${pg === k ? 'on' : ''}" data-a="pr-f" data-id="${k}">${l}</button>`).join('')}</div></div>
          ${shown.length ? `<div class="prl" id="prl" data-page="8">${shown.map(pcard).join('')}<div class="nores" hidden><span class="muted">Aucun résultat.</span></div></div>` : empty('package', 'Aucune prothèse', pg ? 'Aucune prothèse à cette étape.' : 'Enregistrez la première prothèse.', mp ? btn('pr-new', 'Nouvelle prothèse', 'plus', 'btn') : '')}`, shown.length ? search('#prl', 'Réf., patient, type, labo…') : '')
        + card('Laboratoires', 'briefcase', labs.length ? labs.map(l => `<span class="sup">${ic('briefcase', 15)}<b>${esc(l.name)}</b>${l.technician ? `<small>${esc(l.technician)}</small>` : ''}${l.phone ? `<small>${ic('phone', 13)} ${esc(l.phone)}</small>` : ''}</span>`).join('') : '<p class="muted" style="margin:0">Aucun laboratoire enregistré.</p>', mp ? btn('pr-lab', 'Ajouter', 'plus', 'sec') : '')
    },
    async perf() {
      const [st, cm] = await Promise.all([api('/doctors/stats?month=' + month), api('/commissions?month=' + month)])
      const rows = cm.rows, sum = k => rows.reduce((s, r) => s + (r[k] || 0), 0), setR = can('manage_payroll') || can('manage_users'); perfRows = rows
      const PST = { to_pay: ['À payer', 'st-warn'], partial: ['Partiellement payée', 'st-warn'], paid: ['Payée', 'st-ok'] }
      const dcard = r => { const pay = payLabel({ base_salary: r.base_salary, commission_pct: r.pct }), [fn, ...ln] = r.doctor.split(' ')
        return `<div class="dck ${r.remaining > 0 ? 'due' : ''}"><div class="dckh"><span class="dav">${esc((fn[0] || '') + (ln.join(' ')[0] || ''))}</span><div class="dckn"><b>${esc(r.doctor)}</b><span>${pay ? esc(pay) : r.role === 'OWNER' ? 'Propriétaire' : `<span class="neg">${ic('alert', 12)} Rémunération à définir</span>`}</span></div>${setR ? `<button class="bs" data-a="cm-payset" data-id="${r.id}">${ic('wallet', 14)}Rémunération</button>` : ''}</div>
          <div class="dcks"><span><small>Actes</small><b>${r.services}</b></span><span><small>Patients</small><b>${r.patients}</b></span><span><small>Facturé</small><b>${money(r.billed, '')}</b></span><span><small>Encaissé</small><b>${money(r.collected, '')}</b></span></div>
          <div class="dckc"><div><small>Commission (${r.pct} %)</small><b class="pos">${money(r.commission)}</b></div><div><small>Déjà versé</small><b>${money(r.paid_direct + r.in_payroll)}</b>${r.in_payroll ? `<em>dont ${money(r.in_payroll)} en paie</em>` : ''}</div><div><small>Reste dû</small><b class="${r.remaining > 0 ? 'neg' : ''}">${money(r.remaining)}</b></div></div>
          ${r.base_salary || r.payroll ? `<div class="dckp">${ic('receipt', 14)}<span>Paie de ${monthLabel(month)} : ${r.payroll ? `net <b>${money(r.payroll.net)}</b> · versé ${money(r.payroll.paid)}${r.payroll.deductions ? ` · retenues ${money(r.payroll.deductions)}` : ''} ${badge(...(PST[r.payroll.status] || [r.payroll.status, 'st-done']))}` : `fixe ${money(r.base_salary)} · <i>fiche non générée</i>`}</span></div>` : ''}
          <div class="dckf">${setR && r.remaining > 0 ? `<button class="bs pri" data-a="cm-pay" data-id="${r.id}" data-n="${esc(r.doctor)}" data-r="${r.remaining}">${ic('wallet', 14)}Payer la commission</button>` : ''}<button class="bs" data-a="cm-doc" data-id="${r.id}">${ic('eye', 14)}Détail des actes</button></div></div>` }
      $('#view').innerHTML = head('Médecins', `Activité, rémunérations et commissions · ${monthLabel(month)}`, `<form class="row" data-f="pm" style="margin:0"><input type="month" name="month" value="${month}"><button class="sec">Afficher</button></form>${setR ? `<button class="sec" data-a="hr-new">${ic('plus', 15)} Ajouter un employé</button><a href="#utilisateurs"><button type="button">${ic('users', 15)} Nouveau compte médecin</button></a>` : ''}`)
        + kpis([kpi('blue', 'Actes facturés', sum('services'), `${sum('patients')} patient(s)`, 'activity'), kpi('teal', 'Encaissé', money(sum('collected')), `facturé : ${money(sum('billed'))}`, 'dollar'), kpi('violet', 'Commissions', money(sum('commission')), `reste dû : ${money(sum('remaining'))}`, 'wallet'), kpi('orange', 'Salaires fixes', money(sum('base_salary')), 'par mois, médecins', 'briefcase')])
        + tips([rows.filter(r => !r.pct && !r.base_salary && r.role !== 'OWNER').length && { icon: 'alert', tone: 'danger', text: `<b>${rows.filter(r => !r.pct && !r.base_salary && r.role !== 'OWNER').map(r => esc(r.doctor)).join(', ')}</b> : aucune rémunération (ni fixe ni pourcentage). Cliquez sur « Rémunération ».` },
          sum('billed') - sum('collected') > 0 && { icon: 'wallet', text: `<b>${money(sum('billed') - sum('collected'))}</b> facturés ce mois ne sont pas encore encaissés : les commissions correspondantes seront dues à l'encaissement.`, href: '#facturation' },
          sum('remaining') > 0 && { icon: 'briefcase', text: `<b>${money(sum('remaining'))}</b> de commissions restent dus : payez-les ici ou générez la paie pour les reporter sur les fiches.`, href: '#personnel-paie' }])
        + card('Rémunération des médecins', 'wallet', (setR ? `<div class="cbas"><span>Commission calculée sur :</span><div class="sw"><button type="button" class="${cm.basis === 'collected' ? 'on' : ''}" data-a="cm-basis" data-id="collected">Montants encaissés</button><button type="button" class="${cm.basis === 'billed' ? 'on' : ''}" data-a="cm-basis" data-id="billed">Montants facturés</button></div></div>` : '')
          + (rows.length ? `<div class="dcg">${rows.map(dcard).join('')}</div>` : empty('users', 'Aucun médecin actif'))
          + `<p class="muted fnote" style="margin:12px 0 0">Chaque acte est attribué au médecin qui l'a réalisé. Commission = taux × montants <b>${cm.basis === 'billed' ? 'facturés' : 'encaissés'}</b> du mois sur ses actes. Un médecin peut avoir un salaire fixe, un pourcentage, ou les deux ; ses retenues (impôts, cotisations…) se gèrent dans Personnel & paie et apparaissent sur son bulletin. Une commission déjà versée n'est jamais payée deux fois.</p>${cm.payments?.length ? `<h4>Commissions versées ce mois</h4>${cm.payments.map(p => `<div class="kvr">${ic('wallet', 15)}<span>${esc(rows.find(r => r.id === p.doctor_id)?.doctor || '')} · ${money(p.amount)} · ${esc(p.method)}${p.note ? ' · ' + esc(p.note) : ''} · par ${esc(p.who)}</span><b>${fdate(p.created_at)}</b></div>`).join('')}` : ''}`)
        + (() => { const M = [['consultations', 'Consultations', 'activity', 'blue'], ['interventions', 'Interventions de plans', 'clipboard', 'teal'], ['patients_followed', 'Patients suivis', 'users', 'violet'], ['plans_in_progress', 'Plans en cours', 'clock', 'orange'], ['plans_done', 'Plans terminés', 'check', 'green'], ['prostheses_placed', 'Prothèses posées', 'package', 'violet'], ['upcoming_appointments', 'RDV à venir', 'calendar', 'blue']]
          const tot = k => st.reduce((t, x) => t + (+x[k] || 0), 0), mx = k => Math.max(1, ...st.map(x => +x[k] || 0)), score = x => (+x.consultations || 0) + (+x.interventions || 0)
          const sorted = [...st].sort((x, y) => score(y) - score(x)), lead = sorted[0] && score(sorted[0]) ? sorted[0] : null
          return card('Activité clinique', 'activity', st.length ? `<div class="cat">${M.map(([k, l, i, t]) => `<div class="cati t-${t}"><span class="dmi">${ic(i, 16)}</span><div><b>${tot(k)}</b><small>${l}</small></div></div>`).join('')}</div>
            <div class="cadg">${sorted.map((x, n) => `<div class="cad"><div class="cadh"><span class="dav">${esc(x.doctor.split(' ').map(w => w[0] || '').join('').slice(0, 2))}</span><div><b>${esc(x.doctor)}</b><small>${score(x) ? `${score(x)} acte(s) ce mois` : 'aucun acte ce mois'}</small></div>${lead && x === lead ? `<span class="badge st-ok">${ic('zap', 11)} Le plus actif</span>` : ''}</div>
              <div class="cadm">${M.map(([k, l, i, t]) => `<div class="cadr"><span>${ic(i, 13)} ${l}</span><i class="c-${t}"><b style="width:${(+x[k] || 0) / mx(k) * 100}%"></b></i><em>${+x[k] || 0}</em></div>`).join('')}</div></div>`).join('')}</div>
            <p class="muted fnote" style="margin:12px 0 0">Activité de ${monthLabel(month)} : consultations et interventions réalisées par chaque médecin, patients dont il est le médecin traitant, plans dont il est responsable, prothèses posées et rendez-vous à venir. Les barres comparent les médecins entre eux.</p>` : empty('activity', 'Aucune activité', 'Aucun médecin actif.')) })()
    }
  }
  // ── Fenêtres des rendez-vous ──
  const RSN = ['Contrôle', 'Détartrage', 'Soin de carie', 'Extraction', 'Suite de traitement', 'Urgence']
  async function newAppt(file = '', name = '') {
    const docs = await api('/doctors').catch(() => []), mine = docs.find(d => d.id === me?.()?.id)
    const v = await ui.dialog({ title: 'Nouveau rendez-vous', sub: name ? esc(name) : 'Recherchez le patient par son nom', icon: 'calendar', size: 'xl',
      html: `<div class="fg">${file ? `<input type="hidden" name="patient_file" value="${esc(file)}">` : '<label class="s2">Patient <i class="req">*</i><input name="patient_file" required placeholder="Tapez le nom du patient…"></label>'}
        <label>Date <i class="req">*</i><input type="date" name="d" required value="${day < today ? today : day}"></label><label>Heure <i class="req">*</i><input type="time" name="t" required value="09:00" step="900"></label>
        <label>Durée<select name="duration_min"><option value="15">15 min</option><option value="30" selected>30 min</option><option value="45">45 min</option><option value="60">1 h</option><option value="90">1 h 30</option></select></label>
        ${docField(docs, me?.(), { label: 'Médecin' })}</div>
        <div class="qchips">${RSN.map(m => `<button type="button" class="qc" data-rsn="${m}">${m}</button>`).join('')}</div>
        <div class="fg"><label>Motif<input name="reason" placeholder="Ex : Contrôle"></label></div>${slotBlock()}`,
      onOpen: md => { wireSlots(md, api); md.addEventListener('click', e => { const b = e.target.closest('[data-rsn]'); if (!b) return; const r = md.querySelector('[name=reason]'), on = b.classList.contains('on'); r.value = on ? '' : b.dataset.rsn; md.querySelectorAll('[data-rsn]').forEach(x => x.classList.toggle('on', !on && x === b)) }) },
      buttons: [{ label: 'Annuler', cls: 'sec', value: null }, { label: `${ic('calendar', 16)} Planifier`, cls: 'pri', collect: true, submit: f => api('/appointments', { patient_file: f.patient_file, doctor_id: f.doctor_id, duration_min: f.duration_min, reason: f.reason, starts_at: new Date(`${f.d}T${f.t}`).toISOString() }) }] })
    if (v) { day = v.d; toast('Rendez-vous planifié'); render() } }
  async function newReminder() {
    const v = await ui.dialog({ title: 'Programmer un rappel', sub: 'Le patient apparaîtra dans « Patients à revoir » à la date choisie.', icon: 'bell',
      html: `<div class="fg"><label class="s2">Patient <i class="req">*</i><input name="patient_file" required placeholder="Tapez le nom du patient…"></label>
        <label class="s2">Type<select name="kind"><option value="controle">Contrôle périodique</option><option value="controle_extraction">Contrôle après extraction</option><option value="controle_prothese">Contrôle après prothèse</option></select></label>
        <label>À revoir le <i class="req">*</i><input name="due_date" type="date" required value="${new Date(Date.now() + 180 * 864e5).toISOString().slice(0, 10)}"></label><label>Motif<input name="reason" placeholder="Facultatif"></label></div>
        <div class="qchips">${[['1 semaine', 7], ['1 mois', 30], ['3 mois', 90], ['6 mois', 182], ['1 an', 365]].map(([l, d]) => `<button type="button" class="qc" data-dd="${d}">Dans ${l}</button>`).join('')}</div>`,
      onOpen: md => md.addEventListener('click', e => { const b = e.target.closest('[data-dd]'); if (b) { md.querySelector('[name=due_date]').value = new Date(Date.now() + b.dataset.dd * 864e5).toISOString().slice(0, 10); md.querySelectorAll('[data-dd]').forEach(x => x.classList.toggle('on', x === b)) } }),
      buttons: [{ label: 'Annuler', cls: 'sec', value: null }, { label: `${ic('check', 16)} Programmer`, cls: 'pri', collect: true, submit: f => api('/reminders', f) }] })
    if (v) { toast('Rappel programmé'); render() } }
  async function reschedule(b) {
    const d0 = new Date(b.dataset.t), dd = d0.toLocaleDateString('en-CA', { timeZone: TZ }), tt = d0.toLocaleTimeString('fr-FR', { timeZone: TZ, hour: '2-digit', minute: '2-digit' })
    const v = await ui.dialog({ title: 'Reporter le rendez-vous', icon: 'clock', html: `<div class="fg"><label>Nouvelle date<input type="date" name="d" required value="${dd}"></label><label>Heure<input type="time" name="t" required value="${tt}" step="900"></label></div>`,
      buttons: [{ label: 'Annuler', cls: 'sec', value: null }, { label: `${ic('check', 16)} Reporter`, cls: 'pri', collect: true, submit: f => api(`/appointments/${b.dataset.id}/reschedule`, { starts_at: new Date(`${f.d}T${f.t}`).toISOString() }) }] })
    if (v) { day = v.d; toast('Rendez-vous reporté'); render() } }
  document.addEventListener('change', e => { const t = e.target.closest('[data-a="adate"],[data-a="afdoc"]'); if (!t) return; if (t.dataset.a === 'adate' && t.value) { day = t.value; render() } else if (t.dataset.a === 'afdoc') { af.doc = t.value; render() } })

  // ── Fenêtres des prothèses ──
  async function proModal() {
    const [types, labs, docs, tf] = await Promise.all([api('/prosthesis-types'), api('/laboratories'), api('/doctors').catch(() => []), loadTariffs(api)])
    const mine = docs.find(d => d.id === me?.()?.id), base = (tf.rows || []).find(t => /proth/i.test(t.name)), def = base ? tHTG(base, tf.rate) : null; let md, res
    const N = s => Number(String(s || '').replace(/[\s\u00a0\u202f]/g, '').replace(',', '.')) || 0
    const calc = () => { const m = N(md.querySelector('[name=material_cost]').value), l = N(md.querySelector('[name=lab_cost]').value), p = N(md.querySelector('[name=cost]').value), mg = p - m - l
      md.querySelector('[data-pm=c]').textContent = money(m + l); const e = md.querySelector('[data-pm=m]'); e.textContent = money(mg) + (p ? ` (${Math.round(mg / p * 100)} %)` : ''); e.className = mg < 0 ? 'neg' : 'pos'
      md.querySelector('.prwarn').hidden = !(p && mg < 0) }
    const v = await ui.dialog({ title: 'Nouvelle prothèse', sub: 'La fabrication est suivie étape par étape ; le prix peut être facturé au patient tout de suite.', icon: 'package', size: 'xl',
      html: `<section class="fsec"><div class="fsh"><span class="fsi num">1</span><div><b>Patient et prothèse</b></div></div><div class="fg"><label class="s2">Patient <i class="req">*</i><input name="patient_file" required placeholder="Tapez le nom du patient…"></label>
          <label>Type <i class="req">*</i><select name="type_id" required>${types.map(t => `<option value="${t.id}">${esc(t.name)}</option>`).join('')}</select></label>${docField(docs, me?.(), { label: 'Médecin' })}
          <label>Dents<input name="teeth" placeholder="Ex : 11, 21" inputmode="numeric"></label><label>Matériau<input name="material" placeholder="Ex : céramique"></label><label>Teinte<input name="color" placeholder="Ex : A2"></label>
          <label>Laboratoire<select name="lab_id"><option value="">Aucun / interne</option>${labs.map(l => `<option value="${l.id}">${esc(l.name)}</option>`).join('')}</select></label><label class="s2">Instructions au laboratoire<input name="instructions" placeholder="Facultatif"></label></div></section>
        <section class="fsec"><div class="fsh"><span class="fsi num">2</span><div><b>Coûts et marge</b><small>Montants en HTG ; « 1 500,50 » est accepté.</small></div></div><div class="fg"><label>Coût des matériaux<input name="material_cost" inputmode="decimal" placeholder="0"></label><label>Coût du laboratoire<input name="lab_cost" inputmode="decimal" placeholder="0"></label></div>
          <div class="paysum" style="grid-template-columns:1fr 1fr"><span>Coût total<b data-pm="c">0</b></span><span>Marge<b data-pm="m">0</b></span></div><div class="note prwarn" style="margin:8px 0 0;background:#fdecec;color:#a52828" hidden>Attention : le prix est inférieur au coût, la prothèse serait vendue à perte.</div></section>
        <section class="fsec"><div class="fsh"><span class="fsi num">3</span><div><b>Prix et facturation</b><small>${base ? 'Tarif « ' + esc(base.name) + ' » : ' + esc(tLabel(base, tf.rate)) : ''}</small></div></div>${payBlock(def ?? '', true).replace("Montant de l'acte (HTG)", 'Prix facturé au patient (HTG)').replace('<div class="paybh">', '<div class="paybh" hidden>')}
          <label class="ck" style="margin-top:10px"><input type="checkbox" name="bill" checked> Créer la facture du patient maintenant</label></section>`,
      onOpen: m => { md = m; wirePay(m); m.addEventListener('input', calc); calc() },
      buttons: [{ label: 'Annuler', cls: 'sec', value: null }, { label: `${ic('check', 16)} Enregistrer la prothèse`, cls: 'pri', collect: true, submit: async f => { const pf = f.bill ? payFields(md) : {}
        res = await api('/prostheses', { patient_file: f.patient_file, type_id: f.type_id, doctor_id: f.doctor_id, teeth: f.teeth, material: f.material, color: f.color, lab_id: f.lab_id, instructions: f.instructions, material_cost: f.material_cost, lab_cost: f.lab_cost, price: f.cost, bill: !!f.bill, ...pf }) } }] })
    if (v) { toast(res?.bill ? `Prothèse ${res.ref} enregistrée · ${billMsg(res.bill)}` : `Prothèse ${res?.ref || ''} enregistrée`); render() } }
  async function labModal() {
    const v = await ui.dialog({ title: 'Nouveau laboratoire', icon: 'briefcase', html: `<div class="fg"><label class="s2">Nom <i class="req">*</i><input name="name" required></label><label>Téléphone<input name="phone" inputmode="tel"></label><label>Technicien<input name="technician"></label></div>`,
      buttons: [{ label: 'Annuler', cls: 'sec', value: null }, { label: 'Ajouter', cls: 'pri', collect: true, submit: f => api('/laboratories', f) }] })
    if (v) { toast('Laboratoire ajouté'); render() } }

  // ── Fenêtres des plans de traitement ──
  const planTips = pl => { const now = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Port-au-Prince' }), waitP = pl.filter(p => ['draft', 'pending'].includes(p.status)), idle = pl.filter(p => p.status === 'approved' && !p.done_n), late = pl.filter(p => ['approved', 'in_progress'].includes(p.status) && p.end_date && String(p.end_date).slice(0, 10) < now), owe = pl.filter(p => p.status !== 'cancelled' && p.balance > 0)
    return tips([waitP.length && { icon: 'clipboard', tone: 'warn', text: `<b>${waitP.length}</b> plan(s) attendent une validation : présentez-les au patient puis approuvez-les.` }, idle.length && { icon: 'clock', text: `<b>${idle.length}</b> plan(s) approuvé(s) sans aucune intervention réalisée : planifiez un rendez-vous.`, href: '#calendrier' },
      late.length && { icon: 'alert', tone: 'danger', text: `<b>${late.length}</b> plan(s) ont dépassé leur date de fin prévue : ${late.slice(0, 3).map(p => esc(p.patient)).join(', ')}${late.length > 3 ? '…' : ''}.` }, owe.length && { icon: 'wallet', text: `<b>${owe.length}</b> plan(s) avec un solde à encaisser (${money(owe.reduce((s, p) => s + p.balance, 0))}).`, href: '#facturation' }]) }
  const PTPL = ['Détartrage', 'Obturation composite', 'Traitement de canal', 'Extraction', 'Couronne céramique', 'Inlay / onlay', 'Implant', 'Bridge', 'Blanchiment', 'Contrôle']
  async function planModal() {
    const docs = await api('/doctors').catch(() => []), tf = await loadTariffs(api), tfr = tf.rows || [], mine = docs.find(d => d.id === me?.()?.id); let md
    const n2 = v => Number(String(v || '').replace(/\s/g, '').replace(',', '.')) || 0
    const line = (d = '', p = '') => `<div class="ln pln"><input data-k="d" placeholder="Intervention" value="${esc(d)}" required><input data-k="t" placeholder="Ex : 26 27" inputmode="numeric" title="Numéros des dents (FDI), séparés par un espace ou une virgule ; vide pour un soin global"><input data-k="n" placeholder="1" inputmode="numeric" value="1" title="Nombre de séances prévues"><input data-k="p" placeholder="${p === '' && d ? 'À chiffrer' : 'Prix'}" inputmode="decimal" required value="${p}"><button type="button" class="ibtn dng" data-rml aria-label="Retirer">${ic('trash', 16)}</button></div>`
    const tot = () => { let s = 0, n = 0, se = 0, miss = 0; md.querySelectorAll('.lns .pln').forEach(l => { if (!l.querySelector('[data-k=d]').value.trim()) return; n++; se += Math.max(1, parseInt(l.querySelector('[data-k=n]').value) || 1); const pv = l.querySelector('[data-k=p]').value.trim(); if (pv === '') miss++; s += n2(pv) })
      md.querySelector('[data-tot]').textContent = money(s); md.querySelector('[data-cnt]').innerHTML = `${n} intervention${n > 1 ? 's' : ''} · ${se} séance${se > 1 ? 's' : ''}${miss ? ` · <em>${miss} prix à saisir</em>` : ''}`
      const sx = md.querySelector('[name=sessions]'); sx.placeholder = se ? `${se} (auto)` : 'Auto'
      md.querySelectorAll('[data-ptf]').forEach(c => c.classList.toggle('on', [...md.querySelectorAll('.lns [data-k=d]')].some(i => i.value === tfr[+c.dataset.ptf].name))) }
    const pchip = () => { const inp = md.querySelector('[name=patient_file]'), h = md.querySelector('.pnwpat .pkh'), box = md.querySelector('.pnwpat')
      if (!h || !inp.value) { box.classList.remove('picked'); return } const name = h.querySelector('b')?.textContent || inp.value
      box.querySelector('.pnwsel').innerHTML = `<span class="dav">${esc(name.split(' ').map(w => w[0] || '').join('').slice(0, 2))}</span><span class="hn"><b>${esc(name)}</b><small>Dossier ${esc(inp.value)}</small></span><button type="button" class="sec bs" data-chg>${ic('edit', 14)}Changer</button>`; box.classList.add('picked') }
    const v = await ui.dialog({ title: 'Nouveau plan de traitement', sub: 'Créé en brouillon, puis validé et approuvé avec le patient.', icon: 'clipboard', size: 'xl',
      html: `<div class="pnw">
        <section class="pnws"><h5><span>1</span>Patient et médecin</h5><div class="pnw2">
          <div class="pnwpat"><label class="pkf">Patient <i class="req">*</i><span class="pkw">${ic('search', 16)}<input name="patient_file" required placeholder="Nom, téléphone ou n° de dossier"></span></label><div class="pnwsel"></div></div>
          ${docField(docs, me?.(), { name: 'responsible_doctor_id', label: 'Médecin responsable' })}</div>
          <div class="pnw3"><label>Début<input name="start_date" type="date" value="${today}"></label><label>Fin prévue<input name="end_date" type="date"></label><label>Séances au total<input name="sessions" type="number" min="1" max="60" placeholder="Auto"></label></div>
          <div class="pnw2"><label>Diagnostic<input name="diagnosis" placeholder="Ex : polycaries, parodontite légère"></label><label>Objectif<input name="objective" placeholder="Ex : assainissement et réhabilitation"></label></div></section>
        <section class="pnws"><h5><span>2</span>Interventions prévues</h5>
          <p class="pnwhint">Cliquez sur un soin pour l'ajouter au tarif en vigueur. Les prix « à déterminer » sont saisis par le médecin.</p>
          <div class="qchips pnwc">${tfr.map((t, i) => `<button type="button" class="qc" data-ptf="${i}">${esc(t.name)} <em>${esc(tLabel(t, tf.rate))}</em></button>`).join('')}</div>
          <details class="pnwo"><summary>Autres soins (sans tarif)</summary><div class="qchips">${PTPL.filter(x => !tfr.some(t => t.name.toLowerCase() === x.toLowerCase())).map(t => `<button type="button" class="qc" data-ptpl="${t}">+ ${t}</button>`).join('')}</div></details>
          <div class="lnh pln"><span>Intervention</span><span>Dents</span><span>Séances</span><span>Prix (HTG)</span><span></span></div><div class="lns">${line()}</div><button type="button" class="sec bs" data-addl>${ic('plus', 15)}Ajouter une ligne</button></section>
        <div class="pnwsum"><span data-cnt>0 intervention</span><span class="pnwt">Total du plan <b data-tot>${money(0)}</b></span></div></div>`,
      onOpen: m => { md = m; m.addEventListener('input', tot); m.addEventListener('change', e => { if (e.target.name === 'patient_file') pchip() }); tot()
        m.addEventListener('click', e => { const tb = e.target.closest('[data-ptf]'); if (tb) { const t = tfr[+tb.dataset.ptf], p = tHTG(t, tf.rate) ?? '', ln = [...m.querySelectorAll('.lns .pln [data-k=d]')].find(i => !i.value)?.closest('.pln')
            if (ln) { ln.querySelector('[data-k=d]').value = t.name; const pi = ln.querySelector('[data-k=p]'); pi.value = p; if (p === '') pi.placeholder = 'À chiffrer' } else m.querySelector('.lns').insertAdjacentHTML('beforeend', line(t.name, p)); tot(); if (p === '') m.querySelector('.lns .pln:last-child [data-k=p]')?.focus() }
          const t = e.target.closest('[data-ptpl]'); if (t) { const empty1 = [...m.querySelectorAll('.lns .pln [data-k=d]')].find(i => !i.value); if (empty1) empty1.value = t.dataset.ptpl; else m.querySelector('.lns').insertAdjacentHTML('beforeend', line(t.dataset.ptpl)); tot(); m.querySelector('.lns .pln:last-child [data-k=p]')?.focus() }
          if (e.target.closest('[data-addl]')) { m.querySelector('.lns').insertAdjacentHTML('beforeend', line()); m.querySelector('.lns .pln:last-child [data-k=d]').focus() }
          if (e.target.closest('[data-chg]')) { const inp = m.querySelector('[name=patient_file]'); inp.value = ''; m.querySelector('.pnwpat .pkh')?.remove(); m.querySelector('.pnwpat').classList.remove('picked'); inp.focus() }
          const rm = e.target.closest('[data-rml]'); if (rm) { if (m.querySelectorAll('.lns .pln').length > 1) rm.closest('.pln').remove(); else rm.closest('.pln').querySelectorAll('input').forEach(i => i.value = i.dataset.k === 'n' ? '1' : ''); tot() } }) },
      buttons: [{ label: 'Annuler', cls: 'sec', value: null }, { label: `${ic('check', 16)} Créer le plan`, cls: 'pri', collect: true, submit: async f => {
        const items = [...md.querySelectorAll('.lns .pln')].map(l => ({ description: l.querySelector('[data-k=d]').value.trim(), teeth: teethList(l.querySelector('[data-k=t]').value).join(','), sessions: l.querySelector('[data-k=n]').value.trim() || '1', price: l.querySelector('[data-k=p]').value.trim().replace(/\s/g, '').replace(',', '.'), doctor_id: f.responsible_doctor_id })).filter(i => i.description)
        const teeth = [...new Set(items.flatMap(i => teethList(i.teeth)))].join(', '), sessions = f.sessions || String(items.reduce((s, i) => s + Math.max(1, parseInt(i.sessions) || 1), 0) || '')
        const r = await api('/plans', { patient_file: f.patient_file, responsible_doctor_id: f.responsible_doctor_id, sessions: sessions || undefined, start_date: f.start_date || undefined, end_date: f.end_date || undefined, diagnosis: f.diagnosis, objective: f.objective, teeth, items }); planId = r.id } }] })
    if (v) { pf = 'active'; toast('Plan créé en brouillon'); render() } }
  async function itemDone(b) {
    const docs = await api('/doctors').catch(() => []), price = Number(b.dataset.p) || 0; let md, res
    const v = await ui.dialog({ title: 'Terminer l\'intervention', sub: esc(b.dataset.n) + ' · ' + money(price), icon: 'check', size: 'xl',
      html: `<div class="fg">${docField(docs, me?.(), { cls: 's2' })}</div>${teethPicker(teethList(b.dataset.t), { required: true })}${payBlock('', false)}`,
      onOpen: m => { md = m; wirePay(m, price); wireTeeth(m) },
      buttons: [{ label: 'Annuler', cls: 'sec', value: null }, { label: `${ic('check', 16)} Terminer et facturer`, cls: 'pri', collect: true, submit: async f => { teethOk(md); res = await api(`/plans/${b.dataset.id}/items/${b.dataset.i}/status`, { status: 'done', doctor_id: f.doctor_id, teeth: f.teeth || '', ...payFields(md, price) }) } }] })
    if (v) { toast(res?.bill ? 'Intervention terminée · ' + billMsg(res.bill) : 'Intervention terminée'); render() } }
  const lines = (s, k) => s.split('\n').map(l => l.split('|').map(x => x.trim())).filter(p => p[0]).map(p => k(p))
  const submit = {
    async day(e) { day = F(e).day; render() },
    async pm(e) { month = F(e).month; render() },
    async appt(e) { const f = F(e); f.starts_at = new Date(f.starts_at).toISOString(); await api('/appointments', f); toast('Rendez-vous enregistré'); render() },
    async rem(e) { await api('/reminders', F(e)); toast('Rappel programmé'); render() },
    async plan(e) { const f = F(e); f.items = lines(f.lines, p => ({ description: p[0], tooth: p[1] || undefined, price: p[2], doctor_id: f.responsible_doctor_id })); delete f.lines; const r = await api('/plans', f); planId = r.id; toast('Plan créé'); render() },
    async pro(e) { await api('/prostheses', F(e)); toast('Prothèse enregistrée'); render() },
    async lab(e) { await api('/laboratories', F(e)); toast('Laboratoire ajouté'); render() }
  }
  const click = async (b, a, id) => {
    const s = b.dataset.s
    if (a === 'as') { if (s === 'cancelled' && !await ui.confirm('Annuler ce rendez-vous ? Le créneau sera libéré.', { title: 'Annuler le rendez-vous', ok: 'Annuler le rendez-vous', cancel: 'Garder' })) return true
      await api(`/appointments/${id}/status`, { status: s }); toast({ no_show: 'Absence enregistrée : un rappel de suivi a été créé', confirmed: 'Rendez-vous confirmé', done: 'Rendez-vous terminé', cancelled: 'Rendez-vous annulé' }[s] || 'Mis à jour'); render() }
    else if (a === 'aday') { day = id; render() }
    else if (a === 'aweek') { const d = new Date(day + 'T12:00:00'); d.setDate(d.getDate() + Number(id)); day = d.toLocaleDateString('en-CA'); render() }
    else if (a === 'afst') { af.st = id; render() }
    else if (a === 'ap-new') await newAppt()
    else if (a === 'rm-new') await newReminder()
    else if (a === 'rm-plan') await newAppt(b.dataset.f, b.dataset.n)
    else if (a === 'rs') { await reschedule(b); return true }
    else if (a === 'rs-old') { const v = await ui.prompt('Nouvelle date et heure (AAAA-MM-JJ HH:MM) :'); if (!v) return true; await api(`/appointments/${id}/reschedule`, { starts_at: new Date(v.replace(' ', 'T')).toISOString() }); render() }
    else if (a === 'rd') { await api(`/reminders/${id}/done`, {}); toast('Rappel traité'); render() }
    else if (a === 'po') { planId = planId === id ? null : id; render() }
    else if (a === 'pl-new') await planModal()
    else if (a === 'pl-f') { pf = id; render() }
    else if (a === 'idone') await itemDone(b)
    else if (a === 'isess') { const docs = await api('/doctors').catch(() => []), mine = docs.find(x => x.id === me?.()?.id)
      const v = await ui.dialog({ title: 'Séance ' + b.dataset.k, sub: esc(b.dataset.n), icon: 'activity', html: `<div class="fg">${docField(docs, me?.(), { cls: 's2' })}</div>${teethPicker(teethList(b.dataset.t), { title: 'Dents travaillées pendant la séance' })}<div class="fg"><label class="s2">Soin réalisé pendant la séance<input name="treatment" placeholder="Ex : mise en forme canalaire"></label><label class="s2">Observations<input name="notes" placeholder="Facultatif"></label></div><p class="muted" style="font-size:12.5px;margin:0">La séance est ajoutée à l'historique du patient. La facturation se fait en terminant l'intervention.</p>`, onOpen: m => wireTeeth(m),
        buttons: [{ label: 'Annuler', cls: 'sec', value: null }, { label: `${ic('check', 16)} Enregistrer la séance`, cls: 'pri', collect: true, submit: async f => { b._r = await api(`/plans/${id}/items/${b.dataset.i}/session`, f) } }] })
      if (v) { toast(b._r?.last ? 'Dernière séance enregistrée : vous pouvez terminer l\'intervention' : `Séance ${b._r?.sessions_done}/${b._r?.sessions_planned} enregistrée`); render() } }
    else if (a === 'ipost') { const v = await ui.dialog({ title: 'Reporter l\'intervention', icon: 'undo', html: '<label class="ml">Motif du report *<input name="reason" required placeholder="Ex : patient malade, attente du laboratoire"></label>', buttons: [{ label: 'Annuler', cls: 'sec', value: null }, { label: 'Reporter', cls: 'pri', collect: true, submit: f => api(`/plans/${id}/items/${b.dataset.i}/status`, { status: 'postponed', reason: f.reason }) }] }); if (v) { toast('Intervention reportée'); render() } }
    else if (a === 'cm-doc') { const r = perfRows.find(x => x.id === id); if (!r) return; const cm = await api('/commissions?month=' + month + '&doctor=' + id), dt = cm.detail || []
      await ui.dialog({ title: 'Détail des actes · ' + r.doctor, sub: monthLabel(month) + ' · commission ' + r.pct + ' % sur les montants ' + (cm.basis === 'billed' ? 'facturés' : 'encaissés'), icon: 'eye', size: 'xl',
        html: `<div class="dckc big"><div><small>Actes</small><b>${r.services}</b></div><div><small>Facturé</small><b>${money(r.billed)}</b></div><div><small>Encaissé</small><b>${money(r.collected)}</b></div><div><small>Commission</small><b class="pos">${money(r.commission)}</b></div><div><small>Reste dû</small><b class="${r.remaining > 0 ? 'neg' : ''}">${money(r.remaining)}</b></div></div>
          ${dt.length ? `<div class="tw"><table class="ptable" data-page="10"><tr><th>Date</th><th>Facture</th><th>Patient</th><th>Acte</th><th class="r">Total</th><th class="r">Réduction</th><th class="r">Encaissé ce mois</th><th class="r">Part (${r.pct} %)</th></tr>${dt.map(x => `<tr data-pi="1"><td>${fdate(x.created_at)}</td><td><span class="fn sm">${esc(x.number)}</span></td><td><a href="#dossiers/${x.patient_id}"><b>${esc(x.patient)}</b></a></td><td class="wrap">${esc(x.service) || '—'}</td><td class="r">${money(x.total)}</td><td class="r">${x.discount ? '− ' + money(x.discount) : '—'}</td><td class="r">${money(x.collected)}</td><td class="r"><b class="pos">${money(Math.round((cm.basis === 'billed' ? x.total : x.collected) * r.pct) / 100)}</b></td></tr>`).join('')}</table></div>` : '<p class="muted">Aucun acte ni paiement pour ce médecin sur ce mois.</p>'}`,
        buttons: [{ label: 'Fermer', cls: 'sec', value: null }] }) }
    else if (a === 'cm-payset') { const r = perfRows.find(x => x.id === id); if (!r) return
      const v = await ui.dialog({ title: 'Rémunération · ' + r.doctor, icon: 'wallet', size: 'xl', html: `<p class="note">Salaire fixe, pourcentage sur les actes, ou les deux. Les retenues (impôts, ONA…) se gèrent dans <a href="#personnel-paie">Personnel & paie</a>.</p><div class="fg">${payTypeFields({ base_salary: r.base_salary, commission_pct: r.pct }, { doctor: true })}</div>`, onOpen: m => wirePayType(m),
        buttons: [{ label: 'Annuler', cls: 'sec', value: null }, { label: `${ic('check', 16)} Enregistrer`, cls: 'pri', collect: true, submit: f => api('/staff/pay', { user_id: r.id, ...payTypeValues(f) }) }] })
      if (v) { toast('Rémunération enregistrée'); render() } }
    else if (a === 'cm-rate') { const v = document.getElementById('rate-' + id)?.value.replace(',', '.'); await api(`/doctors/${id}/commission`, { pct: v }); toast('Taux de commission enregistré : ' + v + ' %'); render() }
    else if (a === 'ps') { if (s === 'cancelled' && !await ui.confirm('Annuler ce plan ? Les interventions non réalisées ne seront pas facturées.', { title: 'Annuler le plan', ok: 'Annuler le plan', cancel: 'Garder' })) return true; await api(`/plans/${id}/status`, { status: s }); toast('Plan : ' + PS[s]); render() }
    else if (a === 'is') { await api(`/plans/${id}/items/${b.dataset.i}/status`, { status: s }); render() }
    else if (a === 'pr-new') await proModal()
    else if (a === 'pr-lab') await labModal()
    else if (a === 'pr-f') { pg = id; render() }
    else if (a === 'cm-pay') { const v = await ui.dialog({ title: 'Payer une commission', sub: `${esc(b.dataset.n)} · ${monthLabel(month)}`, icon: 'wallet',
        html: `<p class="note">Commission restante : <b>${money(b.dataset.r)}</b>. Le paiement est enregistré en dépense (« Salaires ») et sort de la caisse ; il est déduit de la paie du mois.</p><div class="fg"><label>Montant (HTG) <i class="req">*</i><input name="amount" required inputmode="decimal" value="${b.dataset.r}"></label><label>Mode<select name="method">${['espèces', 'MonCash', 'NatCash', 'virement', 'chèque', 'Autre'].map(x => `<option>${x}</option>`).join('')}</select></label><label class="s2">Note<input name="note" placeholder="Facultatif"></label></div>`,
        buttons: [{ label: 'Annuler', cls: 'sec', value: null }, { label: `${ic('check', 16)} Enregistrer le paiement`, cls: 'pri', collect: true, submit: f => api('/commissions/pay', { doctor_id: id, period: month, ...f }) }] }); if (v) { toast('Commission payée'); render() } }
    else if (a === 'cm-basis') { await api('/commissions/basis', { basis: id }); toast(id === 'billed' ? 'Commissions calculées sur les montants facturés' : 'Commissions calculées sur les montants encaissés'); render() }
    else if (a === 'st') { await api(`/prostheses/${id}/step`, { step: s }); toast('Étape : ' + SL[s]); render() }
    else if (a === 'pl') { if (!await ui.confirm('Payer le laboratoire ? Une dépense sera enregistrée.')) return true; await api(`/prostheses/${id}/pay-lab`, {}); toast('Laboratoire payé'); render() }
    else return false
    return true
  }
  return { views, submit, click }
}
