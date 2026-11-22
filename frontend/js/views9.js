// ═══ Salle d'attente numérotée : secrétaire, assistant(e), médecins ═══
// Arrivée → numéro du jour dans l'ordre d'arrivée (urgences en tête) → appelé → en consultation → terminé.
import { ic } from './icons.js'
import * as L from './loaders.js'
import { head, btn, kpi, kpis, card, empty, badge, modal, tips } from './kit.js'
export default function install({ $, esc, api, toast, render, me }) {
  const TZ = 'America/Port-au-Prince', tm = d => d ? new Date(d).toLocaleTimeString('fr-FR', { timeZone: TZ, hour: '2-digit', minute: '2-digit' }) : '—'
  const mins = (a, b = Date.now()) => Math.max(0, Math.round((new Date(b) - new Date(a)) / 6e4)), dur = m => m == null ? '—' : m >= 60 ? `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')}` : `${m} min`
  const num = n => String(n).padStart(3, '0'), rank = i => i === 0 ? 'Premier' : i === 1 ? 'Suivant' : `${i + 1}e`
  const WD = ['', 'Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi']
  const ST = { done: ['Terminé', 'st-done'], absent: ['Absent', 'st-warn'], cancelled: ['Annulé', 'st-off'] }
  let last = null

  const who = t => `<b>${esc(t.name)}</b>${t.file_number ? ` <span class="fn sm">${esc(t.file_number)}</span>` : ' <span class="badge st-info">non inscrit</span>'}`
  const meta = t => [t.reason && esc(t.reason), t.doctor && `${ic('user', 12)} ${esc(t.doctor)}`, t.appt_at && `${ic('calendar', 12)} RDV ${tm(t.appt_at)}`].filter(Boolean).join(' · ')
  const print = t => { const w = window.open('', '_blank', 'width=360,height=480'); if (!w) return toast('Autorisez les fenêtres pour imprimer le ticket')
    w.document.write(`<!doctype html><meta charset="utf-8"><title>Ticket ${num(t.number)}</title><style>body{font-family:system-ui,sans-serif;text-align:center;padding:24px;color:#0f1b33}h1{font-size:15px;letter-spacing:.08em;margin:0}p{margin:6px 0;color:#555}.n{font-size:84px;font-weight:800;margin:16px 0 4px;letter-spacing:.04em}.l{font-size:12px;text-transform:uppercase;letter-spacing:.1em;color:#888}hr{border:0;border-top:1px dashed #bbb;margin:16px 0}</style>
      <h1>DENTAL</h1><p>${new Date().toLocaleString('fr-FR', { timeZone: TZ, dateStyle: 'full', timeStyle: 'short' })}</p><hr><div class="l">Votre numéro</div><div class="n">${num(t.number)}</div><p>${esc(t.name || '')}</p>${t.position ? `<p>${t.position - 1 ? `${t.position - 1} personne(s) avant vous` : 'Vous êtes le prochain'}</p>` : ''}<hr><p style="font-size:12px">Merci de patienter, nous vous appellerons par votre numéro.</p><script>print();setTimeout(()=>close(),400)<\/script>`); w.document.close() }

  const views = {
    async queue() {
      const d = await api('/queue'); last = d
      const called = d.waiting.filter(t => t.status === 'called'), line = d.waiting.filter(t => t.status === 'waiting'), s = d.stats
      const pct = d.capacity ? Math.min(100, Math.round(d.used / d.capacity * 100)) : 0
      const row = (t, i) => `<div class="qrow ${t.priority ? 'urg' : ''}" data-pi="1"><span class="qnum">${num(t.number)}</span>
        <div class="qmain"><div class="qwho">${who(t)}${t.priority ? ` <span class="badge st-off">${ic('alert', 11)} Urgence</span>` : ''}${t.appt_due ? ` <span class="badge st-ok">${ic('calendar', 11)} Rendez-vous ${tm(t.appt_at)} · prioritaire</span>` : t.appt_at ? ` <span class="badge st-info">${ic('calendar', 11)} RDV ${tm(t.appt_at)}</span>` : ''}</div><small class="muted">${meta(t) || 'Consultation'}</small>
          <div class="qtime"><span>${ic('clock', 12)} arrivé à ${tm(t.arrived_at)}</span><span class="${mins(t.arrived_at) > 45 ? 'neg' : ''}">attend depuis ${dur(mins(t.arrived_at))}</span>${i > 0 ? `<span>≈ ${dur(Math.round(i * (s.avg_consult || 20) / s.doctors))} avant son tour</span>` : ''}</div></div>
        <span class="qrank ${i === 0 ? 'first' : i === 1 ? 'next' : ''}">${rank(i)}</span>
        <div class="qact"><button class="bs pri" data-q="call" data-id="${t.id}">${ic('bell', 13)}Appeler</button>${t.patient_id ? `<button class="bs" data-q="take" data-id="${t.id}" data-pid="${t.patient_id}">${ic('folder', 13)}Consulter</button>` : `<button class="bs" data-q="fill" data-id="${t.id}">${ic('edit', 13)}Créer sa fiche</button>`}<button class="bs" data-q="start" data-id="${t.id}">${ic('right', 13)}Faire entrer</button><button class="bs" data-q="absent" data-id="${t.id}">Absent</button><button class="bs" data-q="print" data-id="${t.id}" aria-label="Imprimer le ticket">${ic('file', 13)}</button><button class="bs dng" data-q="cancel" data-id="${t.id}" aria-label="Annuler">${ic('x', 13)}</button></div></div>`
      $('#view').innerHTML = head('Salle d\'attente', `File du ${new Date().toLocaleDateString('fr-FR', { timeZone: TZ, weekday: 'long', day: 'numeric', month: 'long' })} · numéros attribués dans l'ordre d'arrivée`,
          btn('q-next', 'Appeler le suivant', 'bell') + btn('q-new', 'Enregistrer une arrivée', 'plus', 'sec'))
        + `<div class="card qcap"><div class="qcapi"><div><small>Personnes reçues aujourd'hui</small><b>${d.used}${d.capacity ? ` <span>/ ${d.capacity}</span>` : ''}</b></div>
            <div class="qbar"><i style="width:${d.capacity ? pct : 0}%" class="${pct >= 100 ? 'full' : pct >= 80 ? 'hi' : ''}"></i></div>
            <span class="${d.full ? 'neg' : ''}">${d.capacity ? (d.full ? `${ic('alert', 13)} Capacité atteinte : seules les urgences sont acceptées` : `${d.remaining} place(s) restante(s)`) : 'Pas de limite aujourd\'hui'}</span></div>
          <div class="qcapn"><small>Prochain numéro</small><b>${num(d.next_number)}</b></div><div class="qcapn"><small>Rendez-vous attendus</small><b>${d.booked}</b></div></div>`
        + kpis([kpi('orange', 'En attente', s.waiting, line.length ? `prochain : n° ${num(line[0].number)}` : 'personne n\'attend', 'users'), kpi('blue', 'En consultation', s.in_consult, `${s.doctors} médecin(s) actif(s)`, 'activity'),
          kpi('green', 'Reçus et terminés', s.done, s.absent ? `${s.absent} absent(s)` : 'aucun absent', 'check'), kpi('violet', 'Attente moyenne', dur(s.avg_wait), s.avg_consult ? `consultation moyenne : ${dur(s.avg_consult)}` : 'mesurée sur la journée', 'clock')])
        + tips([d.full && { icon: 'alert', tone: 'danger', text: `La capacité du jour est atteinte (${d.used}/${d.capacity}). Proposez un rendez-vous un autre jour aux nouvelles personnes ; les urgences restent acceptées.` },
          d.capacity && !d.full && d.used + d.booked > d.capacity && { icon: 'calendar', tone: 'warn', text: `Avec les ${d.booked} rendez-vous encore attendus, la capacité (${d.capacity}) sera dépassée : limitez les arrivées sans rendez-vous.` },
          line.some(t => mins(t.arrived_at) > 45) && { icon: 'clock', tone: 'warn', text: 'Certaines personnes attendent depuis plus de 45 minutes : prévenez-les du délai.' }], 'À surveiller')
        + (called.length ? `<div class="qcall">${called.map(t => `<div class="qcalli"><span class="qbig">${num(t.number)}</span><div><small>${ic('bell', 13)} Appelé à ${tm(t.called_at)}</small><b>${esc(t.name)}</b><span class="muted">${meta(t) || 'à faire entrer en consultation'}</span></div>
            <div class="qact"><button class="bs pri" data-q="start" data-id="${t.id}">${ic('right', 14)}Faire entrer en consultation</button><button class="bs" data-q="requeue" data-id="${t.id}">Remettre dans la file</button><button class="bs" data-q="absent" data-id="${t.id}">Absent</button></div></div>`).join('')}</div>` : '')
        + `<div class="g2 qgrid"><div class="card"><div class="chd"><h3>${ic('users', 18)}File d'attente <span class="badge st-info">${line.length}</span></h3><span class="muted" style="font-size:12.5px">urgences, puis rendez-vous à l'heure, puis ordre d'arrivée</span></div>
            <div class="qlist" data-page="8">${line.map(row).join('') || empty('users', 'Personne n\'attend', 'Enregistrez une arrivée : un numéro est attribué automatiquement.', btn('q-new', 'Enregistrer une arrivée', 'plus', 'btn'))}</div></div>
          <div class="qside"><div class="card"><div class="chd"><h3>${ic('activity', 18)}En consultation <span class="badge st-info">${d.in_consult.length}</span></h3></div>
              ${d.in_consult.map(t => `<div class="qmini"><span class="qnum sm">${num(t.number)}</span><div>${who(t)}<small class="muted">depuis ${dur(mins(t.started_at))}${t.doctor ? ' · ' + esc(t.doctor) : ''}</small></div><button class="bs pri" data-q="done" data-id="${t.id}">${ic('check', 13)}Terminé</button></div>`).join('') || '<p class="muted" style="margin:0">Aucune consultation en cours.</p>'}</div>
            <div class="card"><div class="chd"><h3>${ic('calendar', 18)}Rendez-vous attendus <span class="badge st-info">${d.appointments.length}</span></h3></div><p class="muted zdsm" style="margin:-4px 0 8px">Déjà inscrits pour aujourd'hui : un clic sur « Arrivé » leur donne un numéro, et ils passent à l'heure de leur rendez-vous sans faire la queue.</p>
              ${d.appointments.map(a => `<div class="qmini"><span class="qhr">${tm(a.starts_at)}</span><div><b>${esc(a.name)}</b> <span class="fn sm">${esc(a.file_number)}</span><small class="muted">${esc(a.reason || 'Consultation')} · ${esc(a.doctor)}</small></div><button class="bs" data-q="appt" data-id="${a.id}">${ic('check', 13)}Arrivé</button></div>`).join('') || '<p class="muted" style="margin:0">Aucun autre rendez-vous attendu aujourd\'hui.</p>'}</div>
            ${d.finished.length ? `<div class="card"><details><summary class="qsum">${ic('list', 16)} Terminés, absents et annulés (${d.finished.length})</summary>${d.finished.map(t => `<div class="qmini"><span class="qnum sm off">${num(t.number)}</span><div><b>${esc(t.name)}</b><small class="muted">${t.finished_at ? `fin ${tm(t.finished_at)}` : `arrivé ${tm(t.arrived_at)}`}</small></div>${badge(...ST[t.status])}${t.status === 'absent' ? `<button class="bs" data-q="requeue" data-id="${t.id}">Revenu</button>` : ''}</div>`).join('')}</details></div>` : ''}</div></div>`
        + card('Capacité d\'accueil · lundi à vendredi', 'sliders', `<form class="qcf" data-f="qcap"><div class="qcfg">${[1, 2, 3, 4, 5].map(w => `<label>${WD[w]}<input name="d${w}" type="number" min="0" max="500" value="${parseInt(d.weekly?.[w]) || 0}" inputmode="numeric"></label>`).join('')}</div>
          <div class="qcff"><span class="muted">${ic('info', 14)} Nombre maximal de personnes reçues par jour (rendez-vous et sans rendez-vous). 0 = pas de limite. Les urgences sont toujours acceptées.</span><button class="sec">${ic('check', 15)} Enregistrer</button></div></form>`)
    }
  }
  const submit = { async qcap(e) { const f = Object.fromEntries(new FormData(e.target)); await api('/queue/capacity', f); toast('Capacité enregistrée'); render() } }

  const arrival = async () => { const docs = await api('/doctors').catch(() => [])
    const v = await modal({ title: 'Enregistrer une arrivée', icon: 'plus', wide: true, ok: 'Attribuer un numéro',
      html: `${last?.full ? `<p class="note err">${ic('alert', 14)} Capacité du jour atteinte : seules les urgences peuvent être ajoutées.</p>` : `<p class="note">La personne reçoit le numéro <b>${num(last?.next_number || 1)}</b>${last ? ` · ${last.stats.waiting} personne(s) avant elle` : ''}.</p>`}
        <div class="qtab"><label><input type="radio" name="who" value="p" checked><span>${ic('user', 15)} Patient inscrit</span></label><label><input type="radio" name="who" value="v"><span>${ic('plus', 15)} Personne non inscrite</span></label></div>
        <div class="fg" data-who="p"><label class="s2">Patient <i class="req">*</i><input name="patient_file" placeholder="Tapez le nom ou le numéro de dossier…" autocomplete="off"></label></div>
        <div class="fg" data-who="v" hidden><label>Nom et prénom <i class="req">*</i><input name="visitor_name" placeholder="Ex : Jean Pierre"></label><label>Téléphone<input name="phone" inputmode="tel" placeholder="Facultatif"></label></div>
        <div class="fg"><label>Médecin souhaité<select name="doctor_id"><option value="">Premier médecin disponible</option>${docs.map(x => `<option value="${x.id}">${esc(x.name)}</option>`).join('')}</select></label><label>Motif<input name="reason" placeholder="Ex : douleur, contrôle…"></label></div>
        <label class="ck pitrck"><input type="checkbox" name="priority"><span><b>Urgence</b> : passe en tête de file (acceptée même si la capacité est atteinte)</span></label>
        <label class="ck pitrck"><input type="checkbox" name="print" checked><span>Imprimer le ticket</span></label>`,
      onOpen: m => m.addEventListener('change', e => { if (e.target.name !== 'who') return; const v2 = e.target.value; m.querySelectorAll('[data-who]').forEach(x => { x.hidden = x.dataset.who !== v2 }) }),
      submit: f => { const p = f.who === 'p'; if (p && !f.patient_file) throw new Error('Choisissez le patient dans la liste'); if (!p && !String(f.visitor_name || '').trim()) throw new Error('Indiquez le nom de la personne')
        return api('/queue', { patient_file: p ? f.patient_file : '', visitor_name: p ? '' : f.visitor_name, phone: p ? '' : f.phone, doctor_id: f.doctor_id, reason: f.reason, priority: !!f.priority }).then(r => ({ ...r, print: !!f.print })) } })
    if (v) { toast(`Numéro ${num(v.number)} attribué`); await render(); if (v.print) { const t = [...(last?.waiting || [])].find(x => x.id === v.id); if (t) print(t) } } }

  document.addEventListener('click', async e => { const b = e.target.closest('[data-q], [data-a="q-new"], [data-a="q-next"]'); if (!b || !location.hash.startsWith('#salle-attente')) return
    e.preventDefault(); const a = b.dataset.q || b.dataset.a, id = b.dataset.id
    try {
      if (a === 'q-new') return await arrival()
      if (a === 'q-next') { const t = await api('/queue/next', {}); toast(`Appel du n° ${num(t.number)} : ${t.name}`); return render() }
      if (a === 'take') return await window.__takeTicket(id, b.dataset.pid)
      if (a === 'fill') return await window.__patientModal({ ticketId: id })
      if (a === 'print') { const t = last?.waiting.find(x => x.id === id); if (t) print(t); return }
      if (a === 'appt') { const r = await api('/queue', { appointment_id: id }); toast(`Arrivée enregistrée : numéro ${num(r.number)}`); return render() }
      if (a === 'cancel' && !confirm('Retirer cette personne de la file ?')) return
      const MSG = { call: 'Personne appelée', start: 'En consultation', done: 'Consultation terminée', absent: 'Marqué absent', cancel: 'Retiré de la file', requeue: 'Remis dans la file' }
      const restore = L.buttonLoading?.(b) || (() => {}); try { await api(`/queue/${id}/step`, { step: a }) } finally { restore() } toast(MSG[a] || 'Fait'); render()
    } catch (x) { toast(x.message) } })
  // actualisation automatique toutes les 20 secondes (sans gêner une saisie en cours)
  setInterval(() => { if (location.hash.startsWith('#salle-attente') && !document.querySelector('.mo') && !document.activeElement?.closest('#view form')) render() }, 20000)
  return { views, submit }
}
