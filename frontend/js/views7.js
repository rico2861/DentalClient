// Dossier patient complet (onglets avec URL nommées), hub des dossiers et calendrier.
import { ic } from './icons.js'
import { skeleton, spinner, progressBar, setProgress, uploadWithProgress } from './loaders.js'
import { odontoSvg, toothName, STATES, ARCH } from './odonto.js'
import { payBlock, wirePay, payFields, billMsg, kpi, kpis, tips, loadTariffs, tLabel, tHTG, money as moneyK, docField, isDentist, teethPicker, wireTeeth, teethOk, payCalc, flowBar, flowNext, flowInfo, FLOW_BTN, slotBlock, wireSlots } from './kit.js'
export default function install({ $, esc, api, can, toast, render, me, isAdmin }) {
  const F = e => Object.fromEntries(new FormData(e.target)), TZ = 'America/Port-au-Prince'
  const fdt = d => d ? new Date(d).toLocaleString('fr-FR', { timeZone: TZ, dateStyle: 'short', timeStyle: 'short' }) : '—'
  const fd = d => d ? new Date(d).toLocaleDateString('fr-FR', { timeZone: TZ }) : '—'
  const fday = d => d ? String(d).slice(0, 10).split('-').reverse().join('/') : '—'
  const tm = d => new Date(d).toLocaleTimeString('fr-FR', { timeZone: TZ, hour: '2-digit', minute: '2-digit' })
  const dayKey = d => new Date(d).toLocaleDateString('en-CA', { timeZone: TZ })
  const age = d => d ? Math.floor((Date.now() - new Date(d)) / 31557600000) : null
  const ago = d => { const m = Math.floor((Date.now() - new Date(d)) / 864e5); return m < 1 ? "aujourd'hui" : m < 31 ? `il y a ${m} j` : m < 365 ? `il y a ${Math.floor(m / 30.4)} mois` : `il y a ${Math.floor(m / 365)} an(s)` }
  const money = (n, c) => Number(n || 0).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' ' + c
  const so = (a, cur) => a.map(x => `<option ${x === cur ? 'selected' : ''}>${x}</option>`).join('')
  const opts = (a, cur) => a.map(x => `<option value="${esc(x.id)}" ${x.id === cur ? 'selected' : ''}>${esc(x.name)}</option>`).join('')
  const AS = { planned: ['Planifié', 'st-info'], confirmed: ['Confirmé', 'st-ok'], cancelled: ['Annulé', 'st-off'], no_show: ['Absent', 'st-warn'], done: ['Terminé', 'st-done'] }
  const PLS = { draft: 'Brouillon', pending: 'En attente', approved: 'Approuvé', in_progress: 'En cours', suspended: 'Suspendu', done: 'Terminé', cancelled: 'Annulé' }
  const bdg = ([l, c]) => `<span class="badge ${c}">${l}</span>`
  const TABS = [['resume', 'Résumé', 'user'], ['fiche', 'Fiche médicale', 'clipboard'], ['dents', 'Dents', 'tooth'], ['interventions', 'Interventions', 'activity'], ['rendez-vous', 'Rendez-vous', 'calendar'], ['photos', 'Photos & radios', 'image'], ['paiements', 'Paiements', 'dollar']]
  const BOOLS = [['diabetes', 'Diabète'], ['hemophilia', 'Hémophilie'], ['hiv', 'VIH / Sida'], ['smoking', 'Fumeur'], ['alcohol', 'Alcool'], ['pregnancy', 'Enceinte'], ['migraines', 'Migraines'], ['cardiovascular', 'Maladie cardiaque'], ['pulmonary', 'Maladie pulmonaire'], ['epilepsy', 'Épilepsie'], ['stomach', "Problème d'estomac"], ['cancer', 'Cancer']]
  const TEXTS = ['blood_pressure', 'blood_group', 'brushing', 'allergies', 'medications', 'other', 'observations', 'motif', 'scaling_grade', 'bridge_from', 'bridge_to', 'remark']
  const TPL = [['Examen / contrôle', 'Examen clinique bucco-dentaire', 'Examen complet, conseils d\'hygiène'], ['Détartrage', 'Tartre', 'Détartrage et polissage'], ['Carie / obturation', 'Carie', 'Obturation composite'], ['Extraction', 'Dent non conservable', 'Extraction dentaire sous anesthésie locale'],
    ['Traitement de canal', 'Pulpite / nécrose pulpaire', 'Traitement endodontique'], ['Couronne', 'Délabrement coronaire', 'Préparation et empreinte pour couronne'], ['Urgence douleur', 'Douleur aiguë', 'Soins d\'urgence, soulagement de la douleur'], ['Blanchiment', 'Dyschromie', 'Blanchiment dentaire']]
  let sel = new Set(), multi = false, gapMode = false, dent = 'perm', cm = dayKey(new Date()).slice(0, 7), csel = dayKey(new Date()), flat = false
  try { flat = localStorage.getItem('dl_odo_flat') === '1' } catch {}
  const pid = () => location.hash.split('/')[1]
  const link = (id, t = '') => `#dossiers/${id}${t ? '/' + t : ''}`
  const ini = p => esc(((p.last_name || '')[0] || '') + ((p.first_name || '')[0] || ''))
  const hue = s => [...String(s)].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 7)
  const avs = p => `style="background:linear-gradient(135deg,hsl(${hue(p.file_number || p.id)} 62% 52%),hsl(${(hue(p.file_number || p.id) + 40) % 360} 64% 44%))"`
  const kv = (k, v) => v ? `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>` : ''
  // menu « plus d'actions » du dossier : se ferme au clic ailleurs
  document.addEventListener('click', e => document.querySelectorAll('details.pmenu[open]').forEach(d => { if (!d.contains(e.target) || e.target.closest('.pmenu-l a, .pmenu-l button')) d.open = false }))
  const row = (i, t) => t ? `<div class="kvr">${ic(i, 16)}<span>${esc(t)}</span></div>` : ''
  const fin = f => !f ? '' : f.status === 'none' ? '<span class="badge st-info">Aucun acte facturé</span>' : f.status === 'paid' ? '<span class="badge st-ok">Tout payé</span>' : `<span class="badge ${f.status === 'partial' ? 'st-warn' : 'st-off'}">${f.status === 'partial' ? 'Solde partiel' : 'Impayé'} · ${f.totals.filter(t => t.balance > 0).map(t => money(t.balance, t.currency)).join(' + ')}</span>`
  // facturation d'une intervention (facture créée automatiquement)
  const bal = c => Math.max(0, Math.round(((c.inv_total || 0) - (c.inv_paid || 0)) * 100) / 100)
  const payChip = c => !c.invoice_id ? (c.cost ? `<span class="badge st-done">${money(c.cost, 'HTG')}</span>` : '') : bal(c) <= 0 ? '<span class="badge st-ok">Payé</span>' : c.inv_paid > 0 ? `<span class="badge st-warn">Reste ${money(bal(c), 'HTG')}</span>` : `<span class="badge st-off">Impayé · ${money(bal(c), 'HTG')}</span>`
  const payLine = c => !c.invoice_id || !(can('view_finances') || can('edit_medical_records')) ? '' : `<div class="cpay"><span>Montant <b>${money(c.inv_amount, 'HTG')}</b></span>${c.inv_discount ? `<span>Réduction <b>- ${money(c.inv_discount, 'HTG')}</b></span>` : ''}<span>Total <b>${money(c.inv_total, 'HTG')}</b></span><span>Payé <b>${money(c.inv_paid, 'HTG')}</b>${c.inv_methods ? ' · ' + esc(c.inv_methods) : ''}</span><span class="${bal(c) > 0 ? 'due' : 'ok'}">Balance <b>${money(bal(c), 'HTG')}</b></span><span class="muted">${esc(c.invoice_number)}</span></div>`
  // médecins qui ont suivi le patient (chaque intervention est attribuée au médecin qui l'a réalisée)
  const doctorsOf = list => { const m = new Map(); for (const c of list) { const d = m.get(c.doctor_id) || { id: c.doctor_id, name: c.doctor, n: 0, first: c.consulted_at, last: c.consulted_at, lastReason: c.reason, total: 0, acts: [] }
    d.n++; if (new Date(c.consulted_at) < new Date(d.first)) d.first = c.consulted_at; if (new Date(c.consulted_at) >= new Date(d.last)) { d.last = c.consulted_at; d.lastReason = c.reason } d.total += Number(c.inv_total ?? c.cost ?? 0); d.acts.push(c.reason || 'Consultation'); m.set(c.doctor_id, d) }
    return [...m.values()].sort((a, b) => new Date(b.last) - new Date(a.last)) }
  const recent = { get: () => { try { return JSON.parse(localStorage.getItem('dl_recent') || '[]') } catch { return [] } }, add: p => { try { const l = recent.get().filter(x => x.id !== p.id); l.unshift({ id: p.id, n: `${p.last_name} ${p.first_name}`, f: p.file_number }); localStorage.setItem('dl_recent', JSON.stringify(l.slice(0, 6))) } catch {} } }

  // ── Liste des dossiers ──
  async function hub() {
    const rc = recent.get()
    $('#view').innerHTML = `<div class="ph"><div><h2>Dossiers patients</h2><span class="muted" id="hcount">Chargement…</span></div>${can('create_patients') ? `<div class="row phact"><button data-pnew="1">${ic('plus', 17)} Nouveau patient</button></div>` : ''}</div>
      <div class="hsearch">${ic('search', 20)}<input id="hsearch" placeholder="Rechercher par nom, prénom, téléphone ou n° de dossier…" autocomplete="off" autofocus></div>
      ${rc.length ? `<div class="recent"><span>${ic('clock', 15)} Récemment ouverts</span>${rc.map(x => `<a href="${link(x.id)}">${esc(x.n)} <small>${esc(x.f)}</small></a>`).join('')}</div>` : ''}
      <div id="hlist" class="hgrid2">${skeleton({ variant: 'list', rows: 6 })}</div>`
    await hubList('') }
  async function hubList(s) { let r; try { r = await api(`/patients?q=${encodeURIComponent(s)}`) } catch (x) { $('#hlist').innerHTML = `<div class="card empty"><b>${esc(x.message)}</b></div>`; return }
    if (!$('#hlist')) return
    $('#hcount').textContent = r.total ? `${r.total} dossier(s)${s ? ' trouvé(s)' : ''}${r.total > r.rows.length ? ` · ${r.rows.length} affichés, affinez la recherche` : ''}` : 'Aucun dossier'
    $('#hlist').innerHTML = r.rows.map(p => `<a class="pcd" href="${link(p.id)}"><span class="dav sm" ${avs(p)}>${ini(p)}</span><span class="hn"><b>${esc(p.last_name)} ${esc(p.first_name)}</b><small>${[p.age != null ? p.age + ' ans' : '', p.sex === 'M' ? 'Homme' : p.sex === 'F' ? 'Femme' : '', esc(p.phone)].filter(Boolean).join(' · ') || '—'}</small></span><span class="pcr"><span class="fn sm">${esc(p.file_number)}</span>${ic('right', 16)}</span></a>`).join('')
      || `<div class="card empty" style="grid-column:1/-1"><div class="eico">${ic('search', 38)}</div><b>Aucun dossier trouvé</b><span class="muted">${s ? 'Vérifiez l\'orthographe ou cherchez par n° de dossier.' : 'Aucun patient ne vous est encore attribué.'}</span></div>` }

  // ── Fiche médicale : formulaires simples (cases à toucher, choix rapides) ──
  const pills = (name, list, cur) => { const l = cur && !list.includes(cur) ? [...list, cur] : list; return `<div class="pills">${l.map(v => `<label class="pill"><input type="radio" name="${name}" value="${esc(v)}" ${v === cur ? 'checked' : ''}><span>${esc(v)}</span></label>`).join('')}${cur ? `<label class="pill"><input type="radio" name="${name}" value=""><span class="muted">Effacer</span></label>` : ''}</div>` }
  const tog = (k, l, on) => `<label class="tog"><input type="checkbox" name="${k}" ${on ? 'checked' : ''}><span>${ic('check', 14)}${l}</span></label>`
  const blk = (icon, t, body, sub = '') => `<div class="fblk"><div class="fbh">${ic(icon, 17)}<b>${t}</b>${sub ? `<small>${sub}</small>` : ''}</div>${body}</div>`
  function ficheHtml(H, ex, edit) {
    const ro = edit ? '' : 'disabled'
    return `<div class="g2 fiche">
      <form class="card dform" data-f="fhist"><fieldset ${ro}><div class="chd"><h3>${ic('heart', 18)}Histoire médicale</h3><span class="muted" style="font-size:12.5px">Touchez simplement ce qui s'applique</span></div>
        ${blk('alert', 'Antécédents', `<div class="togs">${BOOLS.map(([k, l]) => tog(k, l, H[k])).join('')}</div>`)}
        ${blk('alert', 'Allergies', `<div class="qchips">${['Aucune', 'Pénicilline', 'Anesthésiques locaux', 'Latex', 'Aspirine / AINS', 'Iode'].map(a => `<button type="button" class="qc" data-alg="${a}">${a}</button>`).join('')}</div><input name="allergies" value="${esc(H.allergies)}" placeholder="Ou écrivez : réaction connue, autre produit…">`)}
        ${blk('activity', 'Constantes', `<div class="fg"><label>Tension artérielle<input name="blood_pressure" value="${esc(H.blood_pressure)}" placeholder="Ex : 12/8" inputmode="numeric"></label><label>Médicaments en cours<input name="medications" value="${esc(H.medications)}" placeholder="Ex : Metformine, aspirine…"></label></div><span class="fl2">Groupe sanguin</span>${pills('blood_group', ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'], H.blood_group)}`)}
        ${blk('heart', 'Hygiène', `<span class="fl2">Brossage</span>${pills('brushing', ['Rarement', '1 fois par jour', '2 fois par jour', '3 fois par jour'], H.brushing)}<span class="fl2">Tartre (grade de détartrage)</span>${pills('scaling_grade', ['I', 'II', 'III'], H.scaling_grade)}`)}
        ${blk('clipboard', 'Motif de consultation', `<div class="qchips">${['Douleur', 'Contrôle', 'Détartrage', 'Carie', 'Saignement des gencives', 'Dent cassée', 'Esthétique', 'Prothèse', 'Urgence'].map(m => `<button type="button" class="qc" data-motif="${m}">${m}</button>`).join('')}</div><textarea name="motif" rows="2" placeholder="Décrivez la plainte du patient…">${esc(H.motif)}</textarea>`)}
        ${blk('tool', 'Autres informations', `<div class="fg"><label>Autres antécédents<input name="other" value="${esc(H.other)}"></label><label>Bridge de la dent<input name="bridge_from" value="${esc(H.bridge_from)}" placeholder="Ex : 24"></label><label>à la dent<input name="bridge_to" value="${esc(H.bridge_to)}" placeholder="Ex : 26"></label></div><label class="ml">Remarque<textarea name="remark" rows="2">${esc(H.remark)}</textarea></label><input type="hidden" name="observations" value="${esc(H.observations)}">`, 'facultatif')}
        </fieldset>${edit ? `<div class="savebar"><span class="muted">Les modifications ne sont enregistrées qu'au clic.</span><button>${ic('check', 16)} Enregistrer la fiche</button></div>` : ''}</form>
      <form class="card dform" data-f="fexam"><fieldset ${ro}><div class="chd"><h3>${ic('search', 18)}Examen stomatologique</h3>${edit ? `<button type="button" class="sec bs" data-allnormal>${ic('check', 15)}Tout est normal</button>` : ''}</div>
        <p class="muted" style="margin:-6px 0 14px;font-size:13px">${ex.examined_at ? 'Dernier examen : ' + fdt(ex.examined_at) + '. ' : 'Aucun examen enregistré. '}Chaque enregistrement crée un nouvel examen daté.</p>
        ${[['head', 'Tête et cou'], ['face', 'Visage'], ['atm', 'ATM (articulation)'], ['tongue', 'Langue'], ['periodontium', 'Gencives / parodonte'], ['tooth_morphology', 'Morphologie dentaire']].map(([k, l]) => `<div class="exr"><label class="ml">${l}<span class="exi"><input name="${k}" value="${esc(ex[k])}" placeholder="Décrire si anormal"><button type="button" class="qc" data-normal="${k}">Normal</button></span></label></div>`).join('')}
        <label class="ml">Observations<textarea name="observations" rows="3">${esc(ex.observations)}</textarea></label>
        </fieldset>${edit ? `<div class="savebar"><span></span><button>${ic('plus', 16)} Enregistrer l'examen</button></div>` : ''}</form></div>` }

  // ── Onglet Dents : odontogramme 3D + panneau ──
  function dentsHtml(r, tmap, edit) {
    const log = r.tooth_log, counts = {}; for (const v of tmap.values()) counts[v] = (counts[v] || 0) + 1
    const list = [...sel].sort((a, b) => a - b), one = list.length === 1 ? list[0] : null, cur = one ? tmap.get(one) : null
    const PROB = [['Faces', ['Occlusale', 'Mésiale', 'Distale', 'Vestibulaire', 'Linguale']], ['Constat', ['Douleur', 'Sensibilité au froid', 'Mobilité', 'Fracture', 'Abcès', 'Saignement', 'Carie profonde', 'Plombage défectueux']]]
    const stateBtns = edit ? `<span class="fl2">1. Ce que la dent présente <small class="muted">(facultatif)</small></span>
      ${PROB.map(([g, l]) => `<div class="qchips tprob"><span>${g}</span>${l.map(x => `<button type="button" class="qc" data-tprob="${x}">${x}</button>`).join('')}</div>`).join('')}
      <textarea id="tnote" class="tnote" rows="2" placeholder="Ex : carie profonde face occlusale, douleur au froid…"></textarea>
      <span class="fl2">2. Touchez l'état pour enregistrer</span>
      <div class="sgrid">${Object.entries(STATES).map(([k, s]) => `<button type="button" class="sbtn ${cur === k ? 'on' : ''}" data-d7="setst" data-id="${k}" style="--c:${s.c};--b:${s.bg}"><i></i>${s.l}</button>`).join('')}</div>` : ''
    const all = [...ARCH[dent].up, ...ARCH[dent].low], gone = all.filter(n => ['extraite', 'absente'].includes(tmap.get(n))).length
    const panel = !list.length ? `<div class="oph"><div class="oico">${ic('tooth', 26)}</div><b>Touchez une dent</b><span class="muted">pour voir son historique${edit ? ' et changer son état en un clic' : ''}.</span></div>
        <div class="omouth"><div><b>${all.length - gone}</b><span>dents en bouche</span></div><div class="${gone ? 'g' : ''}"><b>${gone}</b><span>absente(s)</span></div></div>
        ${edit ? (gapMode ? `<div class="gapon">${ic('x', 16)}<span><b>Mode retrait activé</b>Touchez une dent pour la retirer du schéma, touchez l'emplacement vide pour la remettre.</span></div>`
          : `<button class="sec wfull" data-d7="gapmode">${ic('x', 16)} Le patient n'a pas toutes ses dents ? Retirer des dents</button>`) : ''}
        <div class="ocount">${Object.entries(STATES).map(([k, s]) => `<span class="${counts[k] ? '' : 'z'}"><i style="background:${s.c}"></i>${s.l}<b>${counts[k] || 0}</b></span>`).join('')}</div>`
      : `<div class="osel"><span class="onum">${one ?? list.length}</span><div><b>${one ? toothName(one) : list.length + ' dents sélectionnées'}</b><small>${one ? (cur ? `<span class="badge" style="background:${STATES[cur].bg};color:${STATES[cur].c}">${STATES[cur].l}</span>` : 'Non renseignée') : list.join(', ')}</small></div><button class="ibtn" data-d7="clrsel" aria-label="Effacer la sélection">${ic('x', 18)}</button></div>
        ${edit ? (list.every(n => ['absente', 'extraite'].includes(tmap.get(n)))
          ? `<button class="wfull" data-d7="gapset" data-id="saine">${ic('plus', 16)} Remettre ${one ? 'la dent' : 'les dents'} dans le schéma</button>`
          : `<button class="sec dng wfull" data-d7="gapset" data-id="absente">${ic('x', 16)} ${one ? 'Dent non présente' : 'Dents non présentes'} : retirer du schéma</button>`) : ''}
        ${edit ? `${one ? '' : '<div class="note" style="margin:0">Le choix sera appliqué à toutes les dents sélectionnées.</div>'}${stateBtns}` : ''}
        ${edit ? `<button class="sec wfull" data-d7="consult" data-id="${list.join(',')}">${ic('activity', 16)} Nouvelle intervention sur ${one ? 'cette dent' : 'ces dents'}</button>` : ''}
        ${one ? `<span class="fl2">Historique</span><div class="thist">${log.filter(t => t.tooth_fdi === one).map(t => `<div class="th"><i style="background:${STATES[t.state]?.c || '#8a94a6'}"></i><div><b>${STATES[t.state]?.l || esc(t.state)}</b>${t.note ? ` · ${esc(t.note)}` : ''}<small>${fdt(t.recorded_at)} · ${esc(t.doctor)}</small></div></div>`).join('') || '<span class="muted">Aucune modification enregistrée.</span>'}</div>` : ''}`
    return `<div class="card odcard"><div class="chd"><h3>${ic('tooth', 18)}Schéma dentaire</h3><div class="row chr">
        <div class="sw"><button type="button" class="${dent === 'perm' ? 'on' : ''}" data-d7="dent" data-id="perm">Adulte</button><button type="button" class="${dent === 'prim' ? 'on' : ''}" data-d7="dent" data-id="prim">Enfant</button></div>
        <div class="sw"><button type="button" class="${flat ? '' : 'on'}" data-d7="view3d" data-id="0">Vue 3D</button><button type="button" class="${flat ? 'on' : ''}" data-d7="view3d" data-id="1">Vue plane</button></div>
        ${edit ? `<button type="button" class="${multi ? '' : 'sec'} bs" data-d7="multi">${ic('copy', 15)}Sélection multiple${multi ? ' : activée' : ''}</button><button type="button" class="${gapMode ? 'danger-on' : 'sec'} bs" data-d7="gapmode">${ic('x', 15)}${gapMode ? 'Terminer le retrait' : 'Retirer des dents'}</button>` : ''}</div></div>
      <div class="odwrap"><div class="o3d ${flat ? 'flat' : ''}" id="o3d"><div class="o3d-in">${odontoSvg({ states: tmap, sel, dent, flash })}</div></div><aside class="opanel">${panel}</aside></div>
      <div class="olegend">${Object.entries(STATES).map(([, s]) => `<span><i style="background:${s.bg};border-color:${s.c}"></i>${s.l}</span>`).join('')}</div></div>` }

  // ── Fenêtres : intervention et rendez-vous ──
  async function consultModal(teeth = '', tmap = new Map()) {
    const docs = await api('/doctors').catch(() => []), tf = await loadTariffs(api), tfr = tf.rows || [], P = ctx.p || {}, H = ctx.H || {}, F = ctx.F || {}; let box, res
    const todo = new Set([...tmap].filter(([, v]) => ['carie', 'a_extraire', 'anomalie'].includes(v)).map(([n]) => n))
    const marks = new Map([...tmap].filter(([n]) => n < 50).map(([n, s]) => [n, { c: STATES[s]?.c, l: STATES[s]?.l, off: s === 'absente' || s === 'extraite' }]))
    const ticon = t => /extract/i.test(t.name) ? 'trash' : /prophyl|détartr/i.test(t.name) ? 'zap' : /restaur|obtur|carie/i.test(t.name) ? 'tooth' : /proth|couronne|bridge/i.test(t.name) ? 'package' : /ortho/i.test(t.name) ? 'activity' : /endo|canal/i.test(t.name) ? 'activity' : 'receipt'
    const sec = (n, t, body, sub = '') => `<section class="fsec"><div class="fsh"><span class="fsi num">${n}</span><div><b>${t}</b>${sub ? `<small>${sub}</small>` : ''}</div></div>${body}</section>`
    const allergic = H.allergies && !/^aucune?$/i.test(H.allergies), owe = (F.totals || []).filter(t => t.balance > 0), ag = age(P.birth_date)
    const banner = `<div class="cpat"><span class="dav">${esc(((P.last_name || '')[0] || '') + ((P.first_name || '')[0] || ''))}</span><div class="cpn"><b>${esc(P.last_name || '')} ${esc(P.first_name || '')}</b><small>${esc(P.file_number || '')}${ag != null ? ` · ${ag} ans` : ''}${P.phone ? ' · ' + esc(P.phone) : ''}</small></div>
      <div class="cpb">${allergic ? `<span class="cpt dng">${ic('alert', 13)} Allergie : ${esc(H.allergies)}</span>` : `<span class="cpt ok">${ic('check', 13)} Aucune allergie connue</span>`}${owe.length ? `<span class="cpt warn">${ic('wallet', 13)} Doit déjà ${owe.map(t => moneyK(t.balance, t.currency)).join(' + ')}</span>` : F.totals ? `<span class="cpt ok">${ic('check', 13)} À jour des paiements</span>` : ''}${todo.size ? `<span class="cpt">${ic('tooth', 13)} ${todo.size} dent(s) à traiter</span>` : ''}</div></div>`
    const v = await ui.dialog({ title: 'Nouvelle intervention', sub: 'Le soin est enregistré, facturé au médecin et ajouté au dossier en une seule fois.', icon: 'activity', size: 'xl',
      html: `${banner}${docField(docs, me(), { cls: 'cdocf' })}
        ${sec(1, 'Soin réalisé', `<div class="tplc">${tfr.map((t, i) => `<button type="button" class="tcard" data-tpl="${i}">${ic(ticon(t), 18)}<span>${esc(t.name)}</span><em class="${t.price == null ? 'tbd' : ''}">${esc(tLabel(t, tf.rate))}</em></button>`).join('')}<button type="button" class="tcard other" data-tpl="other">${ic('edit', 18)}<span>Autre soin</span><em>prix libre</em></button></div><div class="tfhint" hidden></div>
          <label class="ml">Soin réalisé <i class="req">*</i><input name="reason" required placeholder="Choisissez un soin ci-dessus ou écrivez-le"></label>`)}
        ${sec(2, 'Dents traitées', teethPicker(String(teeth).split(/[ ,;]+/).filter(Boolean).map(Number), { required: true, title: todo.size ? 'Les dents en couleur sont à traiter selon le schéma' : 'Touchez les dents traitées', marks }), 'le schéma dentaire est mis à jour automatiquement')}
        ${sec(3, 'Compte rendu', `<div class="fg"><label>Diagnostic<input name="diagnosis" placeholder="Ex : carie profonde"></label><label>Traitement réalisé<input name="treatment" placeholder="Ex : obturation composite"></label></div>
          <label class="ml">Observations et recommandations<textarea name="notes" rows="2" placeholder="Ex : revoir dans 6 mois, éviter le froid…"></textarea></label>`)}
        ${sec(4, 'Facturation et paiement', payBlock().replace('<div class="paybh">', '<div class="paybh" hidden>'), "Laissez le montant à 0 si l'acte n'est pas facturé.")}
        <div class="cbar"><div><b data-cb="s">Aucun soin choisi</b><small data-cb="t">Aucune dent</small></div><div class="cbm"><span>Total<b data-cb="tot">${moneyK(0)}</b></span><span>Payé<b data-cb="p">${moneyK(0)}</b></span><span class="cbb">Balance<b data-cb="b">${moneyK(0)}</b></span></div></div>`,
      onOpen: md => { box = md; wirePay(md); wireTeeth(md); wireConsult(md, tfr, tf.rate) },
      buttons: [{ label: 'Annuler', cls: 'sec', value: null }, { label: `${ic('check', 16)} Enregistrer l'intervention`, cls: 'pri', collect: true, submit: async f => { teethOk(box); const pf = payFields(box); res = await api(`/patients/${pid()}/consultations`, { reason: f.reason, doctor_id: f.doctor_id, teeth: f.teeth, diagnosis: f.diagnosis, treatment: f.treatment, notes: f.notes, cost: (f.cost || '').replace(/\s/g, '').replace(',', '.'), ...pf }) } }] })
    if (v) { toast(res?.bill ? 'Intervention enregistrée · ' + billMsg(res.bill) : 'Intervention enregistrée'); if (res?.teeth_updated?.length) setTimeout(() => toast(`Schéma dentaire mis à jour : dent(s) ${res.teeth_updated.join(', ')}`), 900); location.hash = link(pid(), 'interventions'); render() } }
  function wireConsult(md, tfr = [], rate = null) {
    let tplOn = null
    const sum = () => { const r = payCalc(md), R = md.querySelector('[name=reason]').value.trim(), T = md.querySelector('[name=teeth]').value, g = md.querySelector('[data-tpkg]')?.checked, S = (k, v) => { md.querySelector(`[data-cb="${k}"]`).textContent = v }
      S('s', R || 'Aucun soin choisi'); S('t', T ? (T.includes(',') ? 'Dents ' : 'Dent ') + T : g ? 'Soin global' : 'Aucune dent'); S('tot', moneyK(r.t)); S('p', moneyK(r.p)); S('b', moneyK(r.b))
      const bb = md.querySelector('.cbb'); bb.classList.toggle('due', r.b > 0.004); bb.classList.toggle('ok', r.t > 0 && Math.abs(r.b) < 0.005) }
    md.addEventListener('input', sum); md.addEventListener('change', sum)
    md.addEventListener('click', e => {
      const t = e.target.closest('[data-tpl]')
      if (t) { const R = md.querySelector('[name=reason]'), Tr = md.querySelector('[name=treatment]'), C = md.querySelector('[name=cost]'), Hh = md.querySelector('.tfhint')
        if (t.dataset.tpl === 'other') { tplOn = null; md.querySelectorAll('[data-tpl]').forEach(b => b.classList.toggle('on', b === t)); Hh.hidden = false; Hh.innerHTML = 'Écrivez le soin réalisé et saisissez son montant ci-dessous.'; R.value = ''; R.focus(); sum(); return }
        const i = +t.dataset.tpl, tt = tfr[i], prev = tplOn !== null ? tfr[tplOn] : null
        if (tplOn === i) { if (R.value === tt.name) R.value = ''; if (Tr.value === tt.name) Tr.value = ''; C.value = ''; tplOn = null; Hh.hidden = true }   // second clic : désélection
        else { R.value = tt.name; if (!Tr.value || (prev && Tr.value === prev.name)) Tr.value = tt.name; const h = tHTG(tt, rate); C.value = h ?? ''; tplOn = i
          Hh.hidden = false; Hh.innerHTML = tt.price == null ? '<b>Prix à déterminer</b> : saisissez le montant de l\'acte dans « Facturation et paiement ».' : tt.currency === 'USD' ? (rate ? `${tt.price.toLocaleString('fr-FR')} $ × ${rate.toLocaleString('fr-FR')} (taux du jour) = <b>${moneyK(h)}</b>` : '<b>Taux de change non défini</b> : saisissez le montant en gourdes.') : `Tarif appliqué : <b>${moneyK(h)}</b>. Vous pouvez l'ajuster ou ajouter une réduction.`
          if (/prophyl|détartr|blanch|contrôle|consult/i.test(tt.name) && !md.querySelector('.tpkt.on')) { const g = md.querySelector('[data-tpkg]'); if (g && !g.checked) { g.checked = true; g.dispatchEvent(new Event('change', { bubbles: true })) } }
          if (h == null) setTimeout(() => C.focus(), 50) }
        md.querySelectorAll('[data-tpl]').forEach(b => b.classList.toggle('on', +b.dataset.tpl === tplOn && b.dataset.tpl !== 'other')); C.dispatchEvent(new Event('input', { bubbles: true })) }
      if (e.target.closest('[data-tn],[data-payall],[data-paynone]')) setTimeout(sum) })
    sum() }
  async function apptModal(p, day) {
    const docs = await api('/doctors').catch(() => []), d0 = day || new Date(Date.now() + 864e5).toLocaleDateString('en-CA', { timeZone: TZ })
    const v = await ui.dialog({ title: 'Nouveau rendez-vous', sub: p ? `${esc(p.last_name)} ${esc(p.first_name)} · ${esc(p.file_number)}` : 'Recherchez le patient par son nom', icon: 'calendar', size: 'xl',
      html: `<div class="fg">${p ? '' : '<label class="s2">Patient <i class="req">*</i><input name="patient_file" required placeholder="Tapez le nom du patient…"></label>'}<label>Date <i class="req">*</i><input type="date" name="d" required value="${d0}"></label><label>Heure <i class="req">*</i><input type="time" name="t" required value="09:00" step="900"></label>
        <label>Durée<select name="duration_min"><option value="15">15 min</option><option value="30" selected>30 min</option><option value="45">45 min</option><option value="60">1 h</option><option value="90">1 h 30</option></select></label>${isDentist(me()) ? docField(docs, me(), { label: 'Médecin' }) : `<label>Médecin <i class="req">*</i><select name="doctor_id" required>${opts(docs, p?.primary_doctor_id || me()?.id)}</select></label>`}</div>
        <div class="qchips" style="margin-bottom:10px">${['Contrôle', 'Détartrage', 'Soin de carie', 'Extraction', 'Suite de traitement', 'Urgence'].map(m => `<button type="button" class="qc" data-rsn="${m}">${m}</button>`).join('')}</div>
        <div class="fg"><label>Motif<input name="reason" placeholder="Ex : Contrôle"></label></div>${slotBlock()}`,
      onOpen: md => { wireSlots(md, api); md.addEventListener('click', e => { const b = e.target.closest('[data-rsn]'); if (b) { md.querySelector('[name=reason]').value = b.dataset.rsn; md.querySelectorAll('[data-rsn]').forEach(x => x.classList.toggle('on', x === b)) } }) },
      buttons: [{ label: 'Annuler', cls: 'sec', value: null }, { label: `${ic('calendar', 16)} Planifier`, cls: 'pri', collect: true, submit: f => api('/appointments', { patient_file: p ? p.file_number : f.patient_file, doctor_id: f.doctor_id, duration_min: f.duration_min, reason: f.reason, starts_at: new Date(`${f.d}T${f.t}`).toISOString() }) }] })
    if (v) { toast('Rendez-vous enregistré'); if (p) location.hash = link(pid(), 'rendez-vous'); render() } }

  let ctx = {}, flash = new Set(), calMap = new Map(), cview = 'month'
  try { cview = localStorage.getItem('dl_cal_view') || 'month' } catch {}
  // grille horaire (7 h → 20 h) : une colonne par jour ou par médecin, rendez-vous placés selon l'heure et la durée
  const H0 = 7, H1 = 20, PX = 46
  const timeGrid = cols => { const hrs = Array.from({ length: H1 - H0 }, (_, i) => H0 + i), nowM = (() => { const d = new Date(new Date().toLocaleString('en-US', { timeZone: TZ })); return (d.getHours() - H0) * 60 + d.getMinutes() })()
    return `<div class="tgw"><div class="tg" style="grid-template-columns:52px repeat(${cols.length},minmax(120px,1fr))"><div class="tgh"></div>${cols.map(c => `<div class="tgh ${c.today ? 'td' : ''}" ${c.day ? `data-d7="day" data-id="${c.day}"` : ''}><b>${c.label}</b><small>${c.sub || ''}</small></div>`).join('')}
      <div class="tgt">${hrs.map(h => `<span style="height:${PX}px">${String(h).padStart(2, '0')}:00</span>`).join('')}</div>
      ${cols.map(c => `<div class="tgc ${c.today ? 'td' : ''}" style="height:${hrs.length * PX}px">${hrs.map(() => `<i style="height:${PX}px"></i>`).join('')}${c.today && nowM > 0 && nowM < hrs.length * 60 ? `<b class="tgnow" style="top:${nowM / 60 * PX}px"></b>` : ''}
        ${c.items.map(a => { const d = new Date(new Date(a.starts_at).toLocaleString('en-US', { timeZone: TZ })), m = (d.getHours() - H0) * 60 + d.getMinutes(), top = Math.max(0, m / 60 * PX), h = Math.max(22, a.duration_min / 60 * PX - 2)
          return `<button type="button" class="tga ${AS[a.status]?.[1]}" style="top:${top}px;height:${h}px" data-d7="aopen" data-id="${a.id}"><b>${tm(a.starts_at)} ${esc(a.patient)}</b><small>${esc(a.reason || 'Consultation')}${c.showDoc ? ' · ' + esc(a.doctor) : ''}</small></button>` }).join('')}</div>`).join('')}</div></div>` }
  async function apptView(a) {
    const ma = can('manage_appointments'), live = ['planned', 'confirmed'].includes(a.status), d = new Date(a.starts_at)
    let sum = null; try { sum = await api(`/patients/${a.patient_id}/summary`) } catch {}
    const pp = sum?.patient, other = (sum?.appointments || []).filter(x => x.id !== a.id && new Date(x.starts_at) > Date.now() && ['planned', 'confirmed'].includes(x.status)).sort((x, y) => new Date(x.starts_at) - new Date(y.starts_at))
    const end = new Date(d.getTime() + a.duration_min * 60000)
    await ui.dialog({ title: 'Rendez-vous', sub: d.toLocaleDateString('fr-FR', { timeZone: TZ, weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }), icon: 'calendar', size: 'xl',
      html: `<div class="avh"><span class="dav sm" ${avs({ file_number: a.file_number })}>${esc(a.patient.split(' ').map(x => x[0]).join('').slice(0, 2))}</span><div class="hn"><b>${esc(a.patient)}</b><small><span class="fn sm">${esc(a.file_number)}</span>${pp?.phone ? ` · ${ic('phone', 12)} ${esc(pp.phone)}` : ''}</small></div>${bdg(AS[a.status])}</div>
        <div class="avg"><div><span>${ic('clock', 14)} Heure</span><b>${tm(a.starts_at)} – ${tm(end)}</b><small>${a.duration_min} min</small></div><div><span>${ic('user', 14)} Médecin</span><b>${esc(a.doctor)}</b></div><div><span>${ic('clipboard', 14)} Motif</span><b>${esc(a.reason) || 'Consultation'}</b></div></div>
        ${pp?.primary_doctor ? `<p class="muted" style="margin:10px 0 0;font-size:13px">Médecin traitant : <b>${esc(pp.primary_doctor)}</b></p>` : ''}
        ${other.length ? `<h4>Autres rendez-vous à venir</h4>${other.slice(0, 3).map(x => `<div class="kvr">${ic('calendar', 15)}<span>${fdt(x.starts_at)} · ${esc(x.reason) || 'Consultation'} · ${esc(x.doctor)}</span></div>`).join('')}` : ''}
        ${ma && !['cancelled', 'no_show'].includes(a.status) && dayKey(d) === dayKey(new Date()) ? `<h4>Parcours du patient aujourd'hui</h4>${flowBar(a)}<div class="flwi"><span class="muted">${flowInfo(a)}</span>${flowNext(a) ? `<button data-act="flow">${FLOW_BTN[flowNext(a)]}</button>` : ''}</div>` : ''}
        ${ma && live ? `<h4>Actions</h4><div class="ava">${a.status === 'planned' ? `<button class="sec" data-act="confirmed">${ic('check', 15)} Confirmer</button>` : ''}<button class="sec" data-act="done">${ic('check', 15)} Terminé</button><button class="sec" data-act="no_show">${ic('alert', 15)} Absent</button><button class="sec" data-act="move">${ic('clock', 15)} Reporter</button><button class="sec dng" data-act="cancelled">${ic('x', 15)} Annuler</button></div>
          <div class="avm" hidden><div class="fg"><label>Nouvelle date<input type="date" data-mv="d" value="${dayKey(d)}"></label><label>Heure<input type="time" data-mv="t" step="900" value="${tm(a.starts_at)}"></label></div><button data-act="moveok">${ic('check', 15)} Confirmer le report</button></div>` : ''}`,
      onOpen: md => md.addEventListener('click', async e => { const b = e.target.closest('[data-act]'); if (!b) return; const k = b.dataset.act
        if (k === 'move') { md.querySelector('.avm').hidden = !md.querySelector('.avm').hidden; return }
        try { if (k === 'flow') { await api(`/appointments/${a.id}/flow`, { step: flowNext(a) }); toast({ arrived: 'Arrivée enregistrée', seated: 'Patient appelé en consultation', finished: 'Soin terminé' }[flowNext(a)]) }
          else if (k === 'moveok') { const dd = md.querySelector('[data-mv=d]').value, tt = md.querySelector('[data-mv=t]').value; await api(`/appointments/${a.id}/reschedule`, { starts_at: new Date(`${dd}T${tt}`).toISOString() }); toast('Rendez-vous reporté'); csel = dd; cm = dd.slice(0, 7) }
          else { if (k === 'cancelled' && !await ui.confirm('Annuler ce rendez-vous ? Le créneau sera libéré.', { title: 'Annuler le rendez-vous', ok: 'Annuler le rendez-vous', cancel: 'Garder' })) return
            await api(`/appointments/${a.id}/status`, { status: k }); toast({ confirmed: 'Rendez-vous confirmé', done: 'Rendez-vous terminé', no_show: 'Absence enregistrée : rappel de suivi créé', cancelled: 'Rendez-vous annulé' }[k]) }
          md.querySelector('.mx').click(); render() } catch (x) { toast(x.message) } }),
      buttons: [{ label: 'Fermer', cls: 'sec', value: true }, { label: `${ic('folder', 16)} Ouvrir le dossier`, cls: 'pri', value: 'open' }] }).then(v => { if (v === 'open') location.hash = link(a.patient_id) }) }
  // Mise à jour instantanée de l'onglet Dents, sans recharger la page ni le serveur
  function paintDents() {
    const card = document.querySelector('.odcard'); if (!card || !ctx.r) return render()
    const keep = document.getElementById('tnote')?.value || '', tmp = document.createElement('div'); tmp.innerHTML = dentsHtml(ctx.r, ctx.tmap, ctx.edit)
    const n = tmp.firstElementChild; n.querySelector('.o3d-in').classList.add('still'); card.replaceWith(n)
    const t = document.getElementById('tnote'); if (t && keep) t.value = keep
    flash = new Set() }
  // Enregistre un état sur une ou plusieurs dents : affichage immédiat, enregistrement en arrière-plan, retour arrière si échec
  async function applyState(list, state, note) {
    if (!list.length) return; const who = `${me()?.first_name || ''} ${me()?.last_name || ''}`.trim(), before = list.map(n => [n, ctx.tmap.get(n)]), now = new Date().toISOString()
    for (const n of list) { ctx.tmap.set(n, state); ctx.r.tooth_log.unshift({ tooth_fdi: n, state, note, recorded_at: now, doctor: who }) }
    const t = document.getElementById('tnote'); if (t) t.value = ''
    flash = new Set(list); paintDents()
    try { await Promise.all(list.map(n => api(`/patients/${pid()}/teeth`, { tooth_fdi: n, state, note })))
      toast(state === 'absente' ? (list.length > 1 ? `${list.length} dents retirées du schéma` : `Dent ${list[0]} retirée du schéma`) : list.length > 1 ? `${list.length} dents : ${STATES[state].l}` : `Dent ${list[0]} : ${STATES[state].l}`) }
    catch (x) { for (const [n, s] of before) s ? ctx.tmap.set(n, s) : ctx.tmap.delete(n); ctx.r.tooth_log = ctx.r.tooth_log.filter(l => l.recorded_at !== now); paintDents(); toast('Non enregistré : ' + x.message) } }
  // Visionneuse plein écran : zoom, déplacement, rotation, luminosité, contraste, négatif (lecture des radios)
  async function viewer(docs, start) {
    let i = start, z = 1, x = 0, y = 0, rot = 0, br = 100, ct = 100, inv = false, drag = null, url = ''
    const ov = document.createElement('div'); ov.className = 'lbx'; document.body.appendChild(ov); document.body.classList.add('mopen')
    const close = () => { removeEventListener('keydown', key, true); ov.remove(); if (!document.querySelector('.mo,.lbx')) document.body.classList.remove('mopen') }
    const apply = () => { const im = ov.querySelector('.lbimg'); if (im) { im.style.transform = `translate(${x}px,${y}px) scale(${z}) rotate(${rot}deg)`; im.style.filter = `brightness(${br}%) contrast(${ct}%)${inv ? ' invert(1)' : ''}` } const zl = ov.querySelector('.lbz'); if (zl) zl.textContent = Math.round(z * 100) + ' %' }
    const reset = () => { z = 1; x = 0; y = 0; rot = 0; br = 100; ct = 100; inv = false }
    const zoomAt = (f, cx, cy) => { const r = ov.querySelector('.lbst').getBoundingClientRect(), nz = Math.min(12, Math.max(.2, z * f)), k = nz / z, px = cx - r.left - r.width / 2, py = cy - r.top - r.height / 2; x = px - (px - x) * k; y = py - (py - y) * k; z = nz; apply() }
    const show = async () => { const d = docs[i]; reset(); const img = d.mime.startsWith('image/')
      ov.innerHTML = `<div class="lbtop"><div class="lbt"><b>${esc(d.original_name)}</b><small>${fd(d.created_at)}${d.by ? ' · ' + esc(d.by) : ''}${docs.length > 1 ? ` · ${i + 1} / ${docs.length}` : ''}</small></div>
        ${img ? `<div class="lbtools"><button data-lb="zo" aria-label="Zoom arrière">−</button><span class="lbz">100 %</span><button data-lb="zi" aria-label="Zoom avant">+</button><button data-lb="fit">Ajuster</button><button data-lb="rot" aria-label="Pivoter">${ic('undo', 16)}</button><button data-lb="inv">Négatif</button>
          <label>Luminosité<input type="range" min="40" max="220" value="100" data-lb="br"></label><label>Contraste<input type="range" min="40" max="260" value="100" data-lb="ct"></label></div>` : ''}
        <div class="lbact"><a class="lbopen" target="_blank" rel="noopener">${ic('download', 16)} Ouvrir</a><button data-lb="x" aria-label="Fermer">${ic('x', 20)}</button></div></div>
        <div class="lbst">${img ? '<img class="lbimg" alt="" draggable="false">' : '<iframe class="lbpdf" title="Document"></iframe>'}<div class="lbload">${spinner({ size: 'lg', light: true, label: 'Chargement du document…' })}</div>
        ${docs.length > 1 ? `<button class="lbnav p" data-lb="prev" aria-label="Précédent">${ic('left', 26)}</button><button class="lbnav n" data-lb="next" aria-label="Suivant">${ic('right', 26)}</button>` : ''}</div>
        ${img ? '<div class="lbhint">Molette ou pincement : zoom · glisser : déplacer · double-clic : zoom ×2,5</div>' : ''}`
      try { const l = await api(`/documents/${d.id}/link`); url = l.url; ov.querySelector('.lbopen').href = url
        const el = ov.querySelector('.lbimg, .lbpdf'); if (img) { el.onload = () => ov.querySelector('.lbload')?.remove(); el.onerror = () => { ov.querySelector('.lbload').textContent = "Impossible d'afficher cette image." } } else el.onload = () => ov.querySelector('.lbload')?.remove()
        el.src = url; apply() } catch (x2) { ov.querySelector('.lbload').textContent = x2.message } }
    const key = e => { if (e.key === 'Escape') { e.stopPropagation(); close() } else if (e.key === 'ArrowRight' && docs.length > 1) { i = (i + 1) % docs.length; show() } else if (e.key === 'ArrowLeft' && docs.length > 1) { i = (i - 1 + docs.length) % docs.length; show() }
      else if (e.key === '+' || e.key === '=') { z = Math.min(12, z * 1.25); apply() } else if (e.key === '-') { z = Math.max(.2, z / 1.25); apply() } else if (e.key === '0') { reset(); apply() } }
    addEventListener('keydown', key, true)
    ov.addEventListener('click', e => { const b = e.target.closest('[data-lb]'); if (!b) { if (e.target.classList.contains('lbst') && z <= 1) close(); return } const k = b.dataset.lb
      if (k === 'x') close(); else if (k === 'zi') { z = Math.min(12, z * 1.25); apply() } else if (k === 'zo') { z = Math.max(.2, z / 1.25); apply() } else if (k === 'fit') { z = 1; x = 0; y = 0; apply() }
      else if (k === 'rot') { rot = (rot + 90) % 360; apply() } else if (k === 'inv') { inv = !inv; b.classList.toggle('on', inv); apply() }
      else if (k === 'next') { i = (i + 1) % docs.length; show() } else if (k === 'prev') { i = (i - 1 + docs.length) % docs.length; show() } })
    ov.addEventListener('input', e => { const k = e.target.dataset.lb; if (k === 'br') br = +e.target.value; if (k === 'ct') ct = +e.target.value; apply() })
    ov.addEventListener('wheel', e => { if (!e.target.closest('.lbst') || !ov.querySelector('.lbimg')) return; e.preventDefault(); zoomAt(e.deltaY < 0 ? 1.15 : 1 / 1.15, e.clientX, e.clientY) }, { passive: false })
    ov.addEventListener('dblclick', e => { if (!e.target.closest('.lbimg')) return; if (z > 1.05) { z = 1; x = 0; y = 0; apply() } else zoomAt(2.5, e.clientX, e.clientY) })
    const pts = new Map(); let pinch = null
    ov.addEventListener('pointerdown', e => { if (!e.target.closest('.lbimg')) return; e.target.setPointerCapture(e.pointerId); pts.set(e.pointerId, [e.clientX, e.clientY]); if (pts.size === 1) drag = [e.clientX - x, e.clientY - y]; else if (pts.size === 2) { const [a, b2] = [...pts.values()]; pinch = Math.hypot(a[0] - b2[0], a[1] - b2[1]); drag = null } })
    ov.addEventListener('pointermove', e => { if (!pts.has(e.pointerId)) return; pts.set(e.pointerId, [e.clientX, e.clientY])
      if (pts.size === 2 && pinch) { const [a, b2] = [...pts.values()], dd = Math.hypot(a[0] - b2[0], a[1] - b2[1]); zoomAt(dd / pinch, (a[0] + b2[0]) / 2, (a[1] + b2[1]) / 2); pinch = dd } else if (drag) { x = e.clientX - drag[0]; y = e.clientY - drag[1]; apply() } })
    const up = e => { pts.delete(e.pointerId); if (pts.size < 2) pinch = null; if (!pts.size) drag = null }
    ov.addEventListener('pointerup', up); ov.addEventListener('pointercancel', up)
    show() }

  const views = {
    async record() {
      const id = pid(); if (!id) return hub()
      if (!/^[0-9a-f-]{36}$/.test(id)) { history.replaceState(null, '', '#dossiers'); return hub() }   // lien invalide : retour à la liste
      const parts = location.hash.slice(1).split('/'), tab = TABS.some(t => t[0] === parts[2]) && (parts[2] !== 'paiements' || can('view_finances')) ? parts[2] : 'resume'
      if (ctx.id !== id) { sel = new Set(); multi = false; dent = 'perm' }
      const [r, s] = await Promise.all([api(`/patients/${id}/record`), api(`/patients/${id}/summary`)])
      const p = s.patient, H = r.history || {}, F0 = s.finance, off = p.status === 'archived', edit = can('edit_medical_records') && !off, adv = r.advice || { alerts: [], todo: [] }
      const tmap = new Map(r.teeth.map(t => [t.tooth_fdi, t.state])), up = s.appointments.filter(a => ['planned', 'confirmed'].includes(a.status) && new Date(a.starts_at) > Date.now()).sort((a, b) => new Date(a.starts_at) - new Date(b.starts_at))
      if (!r.teeth.some(t => t.tooth_fdi < 50) && r.teeth.some(t => t.tooth_fdi > 50) && ctx.id !== id) dent = 'prim'
      ctx = { id, p, tmap, r, edit, F: F0, H }; recent.add(p)
      const allergic = H.allergies && !/^aucune?$/i.test(H.allergies), danger = adv.alerts.filter(a => a.level === 'danger'), totreat = [...tmap.values()].filter(v => v === 'carie' || v === 'a_extraire').length
      const a = age(p.birth_date), cnt = { interventions: r.consultations.length, 'rendez-vous': up.length }
      const head = `<a class="back" href="#dossiers">${ic('left', 16)} Tous les dossiers</a>
        <section class="phd">
          <div class="phd-top"><div class="dav" ${avs(p)}>${ini(p)}</div>
            <div class="phd-id"><div class="phd-nm"><h2>${esc(p.last_name)} <span>${esc(p.first_name)}</span></h2><span class="fn" data-copy="${esc(p.file_number)}" data-tip="Copier le n° de dossier">${esc(p.file_number)}</span><span class="pst ${off ? 'off' : 'ok'}">${off ? 'Inactif' : 'Actif'}</span></div>
              <div class="phd-sub">${[p.sex === 'M' ? 'Homme' : p.sex === 'F' ? 'Femme' : '', a != null ? a + ' ans' : '', p.birth_date ? 'né(e) le ' + fday(p.birth_date) : '', p.profession, H.blood_group ? 'groupe ' + H.blood_group : ''].filter(Boolean).map(esc).join('<i></i>')}</div></div>
            <div class="phd-act">${edit ? `<button data-d7="consult">${ic('plus', 15)} Intervention</button>` : ''}${can('manage_appointments') && !off ? `<button class="sec" data-d7="appt">${ic('calendar', 15)} Rendez-vous</button>` : ''}${can('edit_patients') ? `<button class="sec" data-d7="edit">${ic('edit', 15)} Modifier</button>` : ''}
              <details class="pmenu"><summary class="btn sec" aria-label="Plus d'actions" title="Plus d'actions">${ic('more', 17)}</summary><div class="pmenu-l"><a href="/api/patients/${id}/diagnostic" target="_blank" rel="noopener">${ic('clipboard', 15)} Fiche diagnostique</a><a href="/api/patients/${id}/pdf" target="_blank" rel="noopener">${ic('file', 15)} Dossier complet (PDF)</a>${can('view_audit_logs') ? `<a href="#modifications/${id}">${ic('clock', 15)} Historique des modifications</a>` : ''}${isAdmin() ? (off ? `<button type="button" data-d7="rest">${ic('undo', 15)} Réactiver le dossier</button>` : `<button type="button" class="dng" data-d7="arch">${ic('trash', 15)} Désactiver le dossier</button>`) : ''}</div></details></div></div>
          <dl class="phd-facts">
            <div><dt>Téléphone</dt><dd>${esc(p.phone) || '—'}</dd><small>${esc(p.phone2) || '&nbsp;'}</small></div>
            <div><dt>Médecin traitant</dt><dd>${esc(p.primary_doctor) || '<span class="muted">Non défini</span>'}</dd><small>${r.consultations[0] && r.consultations[0].doctor !== p.primary_doctor ? 'dernier : ' + esc(r.consultations[0].doctor) : '&nbsp;'}</small></div>
            <div><dt>Dernière visite</dt><dd>${r.consultations[0] ? fd(r.consultations[0].consulted_at) : '—'}</dd><small>${r.consultations[0] ? ago(r.consultations[0].consulted_at) : 'jamais venu'}</small></div>
            <div><dt>Prochain RDV</dt><dd>${up[0] ? fd(up[0].starts_at) : '—'}</dd><small>${up[0] ? tm(up[0].starts_at) + ' · ' + esc(up[0].doctor) : 'aucun prévu'}</small></div>
            <div class="${totreat ? 'warn' : ''}"><dt>Soins</dt><dd>${r.consultations.length} <span>intervention${r.consultations.length > 1 ? 's' : ''}</span></dd><small>${totreat ? totreat + ' dent(s) à traiter' : tmap.size ? 'aucune dent à traiter' : 'schéma dentaire vide'}</small></div>
            ${F0 ? `<div class="${F0.totals.some(t => t.balance > 0) ? 'warn' : ''}"><dt>Reste à payer</dt><dd>${F0.totals.filter(t => t.balance > 0).map(t => money(t.balance, t.currency)).join(' + ') || '0'}</dd><small>${F0.status === 'paid' ? 'tout est payé' : F0.status === 'none' ? 'aucune facture' : F0.status === 'partial' ? 'paiement partiel' : 'impayé'}</small></div>` : ''}
          </dl>
          ${danger.map(d => `<div class="phd-al">${ic('alert', 16)}<span><b>${esc(d.title)}</b> — ${esc(d.text)}</span></div>`).join('')}
        </section>
        ${off ? `<div class="banner dangr">${ic('alert', 18)}<span>Dossier désactivé le <b>${fd(p.deleted_at)}</b> par <b>${esc(p.deleted_by_name) || '—'}</b>. Motif : ${esc(p.delete_reason) || '—'}. Les informations restent conservées.</span></div>` : ''}
        <div class="tabs">${TABS.filter(t => t[0] !== 'paiements' || can('view_finances')).map(t => `<a class="tab ${tab === t[0] ? 'on' : ''}" href="${link(id, t[0])}">${ic(t[2], 16)}<span>${t[1]}</span>${cnt[t[0]] ? `<em>${cnt[t[0]]}</em>` : ''}</a>`).join('')}</div>`
      const B = {}
      if (tab === 'resume') {
        const last = r.consultations[0], dl = doctorsOf(r.consultations)
        B.resume = `
          <div class="g2 rs" data-pack="2">
            <div><div class="card"><div class="chd"><h3>${ic('alert', 18)}Points d'attention médicaux</h3></div>${adv.alerts.length ? adv.alerts.map(x => `<div class="adv ${x.level}"><b>${esc(x.title)}</b><span>${esc(x.text)}</span></div>`).join('') : `<div class="okline">${ic('check', 16)} Aucun point d'attention médical signalé.</div>`}</div>
              <div class="card"><div class="chd"><h3>${ic('zap', 18)}Recommandations</h3><span class="muted" style="font-size:12.5px">${adv.todo.length} à faire</span></div>${adv.todo.map(x => `<a class="todo" href="${link(id, x.tab)}">${ic(x.icon, 16)}<span>${esc(x.text)}</span>${ic('right', 15)}</a>`).join('') || `<div class="okline">${ic('check', 16)} Dossier complet et suivi à jour.</div>`}</div></div>
            <div><div class="card"><div class="chd"><h3>${ic('user', 18)}Identité et coordonnées</h3></div><dl class="kvl">${kv('Téléphone', [p.phone, p.phone2].filter(Boolean).join(' · '))}${kv('Adresse', [p.address, p.zone, p.department].filter(Boolean).join(', '))}${kv('E-mail', p.email)}${kv('Profession', p.profession)}${kv('Naissance', [p.birth_date ? fday(p.birth_date) : '', p.birth_place].filter(Boolean).join(' · '))}${kv('Situation', [p.marital_status, p.children_count != null ? p.children_count + ' enfant(s)' : ''].filter(Boolean).join(' · '))}${kv('Pièce d\'identité', p.id_number)}${kv('Assurance', p.insurance ? p.insurance + (p.insurance_number ? ' · n° ' + p.insurance_number : '') : '')}${kv('Référé par', p.referred_by)}${kv('Remise', p.discount_percent > 0 ? p.discount_percent + ' % sur tous les actes' : '')}${kv('Inscrit le', p.registered_at ? fd(p.registered_at) : '')}</dl>${p.notes ? `<div class="note" style="margin:10px 0 0">${esc(p.notes)}</div>` : ''}<h4>Contact d'urgence</h4><dl class="kvl">${kv('Nom', p.emergency_contact) || kv('Nom', 'Non renseigné')}${kv('Téléphone', p.emergency_phone)}</dl></div>
              <div class="card"><div class="chd"><h3>${ic('users', 18)}Médecins ayant suivi le patient</h3><span class="muted" style="font-size:12.5px">${dl.length} médecin(s)</span></div>
                ${dl.map((d, i) => `<div class="mdoc${i ? '' : ' last'}"><span class="dav xs">${esc(d.name.split(' ').map(x => x[0]).join('').slice(0, 2))}</span><div class="hn"><b>${esc(d.name)} ${i ? '' : '<span class="badge st-info">Dernier intervenant</span>'}${p.primary_doctor_id === d.id ? '<span class="badge st-ok">Médecin traitant</span>' : ''}</b>
                  <small>${d.n} intervention(s) · ${d.n > 1 ? `du ${fd(d.first)} au ${fd(d.last)}` : fd(d.last)}${d.total ? ' · ' + money(d.total, 'HTG') : ''}</small><small class="acts2">${[...new Set(d.acts)].slice(0, 4).map(esc).join(' · ')}</small></div></div>`).join('') || '<span class="muted">Aucune intervention enregistrée.</span>'}</div>
              <div class="card"><div class="chd"><h3>${ic('activity', 18)}Dernières interventions</h3><a class="bs" href="${link(id, 'interventions')}">Tout voir</a></div>${r.consultations.slice(0, 4).map(c => `<div class="dtl"><b>${fd(c.consulted_at)}</b> · ${esc(c.reason) || 'Consultation'}<br><span class="muted">${esc(c.doctor)}${c.teeth?.length ? ' · dents ' + c.teeth.join(', ') : ''}</span></div>`).join('') || '<span class="muted">Aucune intervention enregistrée.</span>'}</div></div></div>` }
      if (tab === 'fiche') B.fiche = ficheHtml(H, (await api(`/patients/${id}/exams`).catch(() => []))[0] || {}, edit)
      if (tab === 'dents') B.dents = dentsHtml(r, tmap, edit) + `<div class="card"><div class="chd"><h3>${ic('clipboard', 18)}Plans de traitement</h3>${can('manage_treatment_plans') ? `<a class="bs" href="#plans-de-traitement">Gérer les plans</a>` : ''}</div>${s.plans.map(pl => `<div class="plan"><div class="row" style="justify-content:space-between;margin:0 0 8px"><b>${esc(pl.diagnosis) || 'Plan de traitement'}</b><span class="badge st-info">${PLS[pl.status] || esc(pl.status)}</span></div><div class="tw"><table class="ptable"><tr><th>Intervention</th><th>Dents</th><th class="r">Prix</th><th>Statut</th><th>Médecin</th></tr>${pl.items.map(i => { const tt = i.teeth?.length ? i.teeth : i.tooth ? [i.tooth] : [], st = { todo: ['Prévue', 'st-done'], in_progress: ['En cours', 'st-info'], postponed: ['Reportée', 'st-warn'], done: ['Terminée', 'st-ok'], cancelled: ['Annulée', 'st-off'] }[i.status] || [i.status, 'st-done']; return `<tr><td>${esc(i.description)}${i.sessions_planned > 1 ? ` <small class="muted">· séances ${i.sessions_done}/${i.sessions_planned}</small>` : ''}</td><td>${tt.length ? tt.map(n => `<span class="tchip">${n}</span>`).join(' ') : '<span class="muted">Soin global</span>'}</td><td class="r">${money(i.price, 'HTG')}</td><td><span class="badge ${st[1]}">${st[0]}</span>${i.done_at ? ` <small class="muted">${fd(i.done_at)}</small>` : ''}</td><td>${esc(i.doctor || '—')}</td></tr>` }).join('') || '<tr><td colspan="5">Aucune ligne.</td></tr>'}</table></div></div>`).join('') || '<span class="muted">Aucun plan de traitement.</span>'}</div>`
      if (tab === 'interventions') { const dl = await api(`/patients/${id}/documents`).catch(() => []); ctx.docs = dl; ctx.byCons = dl.reduce((m, d) => { if (d.consultation_id) (m[d.consultation_id] ||= []).push(d); return m }, {}) }
      if (tab === 'interventions') B.interventions = `<div class="card"><div class="chd"><h3>${ic('activity', 18)}Interventions effectuées</h3>${edit ? `<button data-d7="consult">${ic('plus', 16)} Nouvelle intervention</button>` : ''}</div>
        ${r.consultations.length ? `<div class="ctl" data-page="6">${r.consultations.map(c => `<div class="ci" data-pi="1"><div class="cid"><b>${new Date(c.consulted_at).toLocaleDateString('fr-FR', { timeZone: TZ, day: '2-digit' })}</b><span>${new Date(c.consulted_at).toLocaleDateString('fr-FR', { timeZone: TZ, month: 'short', year: '2-digit' })}</span></div>
          <div class="cib"><div class="row" style="margin:0;justify-content:space-between"><b>${esc(c.reason) || 'Consultation'}</b><span class="acts">${payChip(c)}<a class="bs" href="/api/consultations/${c.id}/pdf" target="_blank" rel="noopener">${ic('file', 14)}PDF</a></span></div>
          ${c.diagnosis ? `<div><span class="muted">Diagnostic :</span> ${esc(c.diagnosis)}</div>` : ''}${c.treatment ? `<div><span class="muted">Traitement :</span> ${esc(c.treatment)}</div>` : ''}${c.notes ? `<div class="muted">${esc(c.notes)}</div>` : ''}${payLine(c)}
          ${(ctx.byCons?.[c.id] || []).length ? `<div class="cdocs">${ctx.byCons[c.id].map(d => `<button type="button" class="bs" data-d7="dview" data-id="${d.id}">${ic(d.mime.startsWith('image/') ? 'image' : 'file', 13)}${esc(d.original_name.slice(0, 24))}</button>`).join('')}</div>` : ''}<div class="cim">${ic('user', 13)} ${esc(c.doctor)} · ${tm(c.consulted_at)}${(c.teeth || []).map(n => `<span class="tchip">${n}</span>`).join('')}</div></div></div>`).join('')}</div>`
          : `<div class="empty"><div class="eico">${ic('activity', 38)}</div><b>Aucune intervention</b>${edit ? `<button class="btn" data-d7="consult">${ic('plus', 16)} Enregistrer la première</button>` : ''}</div>`}</div>`
      if (tab === 'rendez-vous') { const past = s.appointments.filter(x => !up.includes(x)), line = x => `<div class="ap" data-pi="1"><div class="at">${fd(x.starts_at)}<small>${tm(x.starts_at)} · ${x.duration_min} min</small></div><div class="ab"><b>${esc(x.reason) || 'Consultation'}</b><br><span class="muted">${esc(x.doctor)}</span></div><div class="acts">${bdg(AS[x.status])}${can('manage_appointments') && ['planned', 'confirmed'].includes(x.status) ? `${x.status === 'planned' ? `<button class="bs" data-d7="astat" data-id="${x.id}" data-s="confirmed">${ic('check', 14)}Confirmer</button>` : ''}<button class="bs dng" data-d7="astat" data-id="${x.id}" data-s="cancelled">${ic('x', 14)}Annuler</button>` : ''}</div></div>`
        B['rendez-vous'] = `<div class="g2"><div class="card"><div class="chd"><h3>${ic('calendar', 18)}À venir</h3>${can('manage_appointments') && !off ? `<button data-d7="appt">${ic('plus', 16)} Nouveau rendez-vous</button>` : ''}</div><div data-page="6">${up.map(line).join('') || '<span class="muted">Aucun rendez-vous à venir.</span>'}</div></div><div class="card"><div class="chd"><h3>${ic('clock', 18)}Historique</h3></div><div data-page="6">${past.map(line).join('') || '<span class="muted">Aucun historique.</span>'}</div></div></div>` }
      if (tab === 'photos') { const dl = await api(`/patients/${id}/documents`).catch(() => []); ctx.docs = dl; const G = k => dl.filter(d => k.includes(d.kind)), card = d => `<div class="gi"><div class="gt" data-d7="dview" data-id="${d.id}">${d.mime.startsWith('image/') ? `<img data-thumb="${d.id}" alt="">` : ic('file', 34)}</div><div class="gc"><b>${esc(d.original_name)}</b><small>${fd(d.created_at)} · ${esc(d.by) || ''}</small>${d.consultation_id ? `<small class="dlink">${ic('activity', 11)} ${esc(d.consultation_reason || 'Intervention')} du ${fd(d.consulted_at)}</small>` : ''}${edit ? `<button class="ibtn dng" data-d7="darch" data-id="${d.id}" aria-label="Archiver">${ic('trash', 16)}</button>` : ''}</div></div>`
        B.photos = `${edit ? `<form class="card upl" data-f="fupload"><div class="chd"><h3>${ic('upload', 18)}Ajouter un document</h3></div><div class="row" style="margin:0"><select name="kind"><option value="radiographie">Radiographie</option><option value="photo">Photo</option><option value="ordonnance">Ordonnance</option><option value="devis">Devis</option><option value="pdf">Autre document PDF</option></select><select name="consultation_id" aria-label="Intervention liée"><option value="">Aucune intervention liée</option>${r.consultations.slice(0, 40).map(c => `<option value="${c.id}">${fd(c.consulted_at)} · ${esc(c.reason || 'Consultation')}</option>`).join('')}</select><input type="file" name="file" accept="image/jpeg,image/png,image/webp,application/pdf" required><button>${ic('upload', 16)} Téléverser</button></div><span class="muted" style="font-size:12.5px">JPEG, PNG, WebP ou PDF · 10 Mo max</span></form>` : ''}
          <div class="card"><div class="chd"><h3>${ic('zap', 18)}Radiographies</h3></div><div class="gal">${G(['radiographie']).map(card).join('') || '<span class="muted">Aucune radiographie.</span>'}</div></div><div class="card"><div class="chd"><h3>${ic('camera', 18)}Photos</h3></div><div class="gal">${G(['photo']).map(card).join('') || '<span class="muted">Aucune photo.</span>'}</div></div><div class="card"><div class="chd"><h3>${ic('file', 18)}Autres documents</h3></div><div class="gal">${G(['pdf', 'ordonnance', 'devis', 'consentement', 'plan_signe']).map(card).join('') || '<span class="muted">Aucun document.</span>'}</div></div>` }
      if (tab === 'paiements' && F0) B.paiements = `<div class="card"><div class="chd"><h3>${ic('dollar', 18)}État des paiements ${fin(F0)}</h3>${can('view_finances') ? '<a class="bs" href="#facturation">Facturation</a>' : ''}</div><div class="g3">${F0.totals.map(t => `<div class="stat2"><span>Total facturé (${t.currency})</span><b>${money(t.total, t.currency)}</b></div><div class="stat2"><span>Versé</span><b class="pos">${money(t.paid, t.currency)}</b></div><div class="stat2"><span>Balance</span><b class="${t.balance > 0 ? 'neg' : 'pos'}">${money(t.balance, t.currency)}</b></div>`).join('') || '<span class="muted">Aucune facture émise pour ce patient.</span>'}</div></div>
          <div class="card tw"><div class="chd"><h3>${ic('file', 18)}Factures</h3></div><table class="ptable"><tr><th>Date</th><th>N°</th><th class="r">Total</th><th class="r">Versé</th><th class="r">Balance</th><th>Statut</th><th></th></tr>${F0.invoices.map(i => `<tr><td>${fd(i.created_at)}</td><td><span class="fn sm">${esc(i.number)}</span></td><td class="r">${money(i.total, i.currency)}</td><td class="r">${money(i.paid, i.currency)}</td><td class="r"><b>${money(i.balance, i.currency)}</b></td><td>${i.balance <= 0 ? '<span class="badge st-ok">Payée</span>' : i.paid > 0 ? '<span class="badge st-warn">Partielle</span>' : '<span class="badge st-off">Impayée</span>'}</td><td><a class="bs" href="/api/invoices/${i.id}/pdf" target="_blank" rel="noopener">${ic('file', 14)}PDF</a></td></tr>`).join('') || '<tr><td colspan="7">Aucune facture.</td></tr>'}</table></div>`
      $('#view').innerHTML = head + (B[tab] || '')
      document.querySelectorAll('img[data-thumb]').forEach(async im => { try { const l = await api(`/documents/${im.dataset.thumb}/link`); im.src = l.url } catch {} }) },

    async cal() {
      const [y, m] = cm.split('-').map(Number), first = new Date(Date.UTC(y, m - 1, 1)), lastD = new Date(Date.UTC(y, m, 0)).getUTCDate(), off = (first.getUTCDay() + 6) % 7, n = Math.ceil((off + lastD) / 7) * 7
      const from = new Date(Date.UTC(y, m - 1, 1 - off)), to = new Date(Date.UTC(y, m - 1, 1 - off + n - 1)), iso = d => d.toISOString().slice(0, 10), today = dayKey(new Date()), tomorrow = dayKey(new Date(Date.now() + 864e5))
      const list = await api(`/appointments?from=${iso(from)}&to=${iso(to)}`), by = {}; calMap = new Map(list.map(a => [a.id, a])); for (const a of list) (by[dayKey(a.starts_at)] ||= []).push(a)
      const live = a => ['planned', 'confirmed'].includes(a.status), inMonth = a => dayKey(a.starts_at).slice(0, 7) === cm, now = Date.now(), ma = can('manage_appointments')
      const wk0 = new Date(); wk0.setDate(wk0.getDate() - ((wk0.getDay() + 6) % 7)); const wkS = dayKey(wk0), wkE = dayKey(new Date(wk0.getTime() + 6 * 864e5))
      const tdy = (by[today] || []).filter(live), week = list.filter(a => live(a) && dayKey(a.starts_at) >= wkS && dayKey(a.starts_at) <= wkE), unconf = list.filter(a => a.status === 'planned' && new Date(a.starts_at) > now && inMonth(a)), noshow = list.filter(a => a.status === 'no_show' && inMonth(a))
      const busiest = Object.entries(by).filter(([k]) => k.slice(0, 7) === cm).map(([k, v]) => [k, v.filter(live).length]).sort((a, b) => b[1] - a[1])[0]
      const tomU = (by[tomorrow] || []).filter(a => a.status === 'planned')
      const cells = Array.from({ length: n }, (_, i) => { const d = new Date(Date.UTC(y, m - 1, 1 - off + i)), k = iso(d), A = (by[k] || []).sort((a, b) => new Date(a.starts_at) - new Date(b.starts_at)), wd = (d.getUTCDay() + 6) % 7
        return `<div class="cd ${d.getUTCMonth() !== m - 1 ? 'dim' : ''} ${k === today ? 'today' : ''} ${k === csel ? 'sel' : ''} ${wd > 4 ? 'we' : ''}" data-d7="day" data-id="${k}"><div class="cdt"><span class="dn">${d.getUTCDate()}</span>${A.length ? `<span class="cdn">${A.length}</span>` : ''}</div>${A.slice(0, 3).map(a => `<span class="ch ${AS[a.status]?.[1]}" data-d7="aopen" data-id="${a.id}" role="button" tabindex="0">${tm(a.starts_at)} ${esc(a.patient.split(' ')[0])}</span>`).join('')}${A.length > 3 ? `<span class="more">+${A.length - 3} autre(s)</span>` : ''}</div>` }).join('')
      const day = (by[csel] || []).sort((a, b) => new Date(a.starts_at) - new Date(b.starts_at))
      const altView = () => { const sd = new Date(csel + 'T12:00:00Z'), mon = new Date(sd); mon.setUTCDate(sd.getUTCDate() - ((sd.getUTCDay() + 6) % 7))
        const nav = (lbl, step) => `<div class="tgnav"><button class="ibtn" data-d7="cstep" data-id="${-step}" aria-label="Précédent">${ic('left', 18)}</button><b>${lbl}</b><button class="ibtn" data-d7="cstep" data-id="${step}" aria-label="Suivant">${ic('right', 18)}</button></div>`
        if (cview === 'week') { const days = Array.from({ length: 7 }, (_, i) => { const d = new Date(mon); d.setUTCDate(mon.getUTCDate() + i); return iso(d) })
          return nav(`Semaine du ${new Date(days[0] + 'T12:00:00Z').toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', timeZone: 'UTC' })} au ${new Date(days[6] + 'T12:00:00Z').toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', timeZone: 'UTC' })}`, 7)
            + timeGrid(days.map(k => ({ day: k, today: k === today, label: new Date(k + 'T12:00:00Z').toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', timeZone: 'UTC' }), sub: `${(by[k] || []).filter(live).length} RDV`, items: (by[k] || []).filter(a => a.status !== 'cancelled'), showDoc: true }))) }
        const docs = [...new Set(day.map(a => a.doctor))].sort()
        return nav(new Date(csel + 'T12:00:00Z').toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' }), 1)
          + (docs.length ? timeGrid(docs.map(dn => ({ label: esc(dn), sub: `${day.filter(a => a.doctor === dn && live(a)).length} RDV`, today: csel === today, items: day.filter(a => a.doctor === dn && a.status !== 'cancelled') }))) : `<div class="empty" style="padding:40px">${ic('calendar', 30)}<span class="muted">Aucun rendez-vous ce jour.</span></div>`) }
      const soon = list.filter(a => live(a) && new Date(a.starts_at) > now && new Date(a.starts_at) < now + 36 * 36e5).sort((a, b) => new Date(a.starts_at) - new Date(b.starts_at))
      const label = new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric', timeZone: 'UTC' })
      const acard = a => `<div class="apc ${a.status}" data-pi="1"><div class="apt" data-d7="aopen" data-id="${a.id}" role="button" title="Voir le rendez-vous"><b>${tm(a.starts_at)}</b><small>${a.duration_min} min</small></div><div class="apb"><a href="${link(a.patient_id)}"><b>${esc(a.patient)}</b></a> <span class="fn sm">${esc(a.file_number)}</span><small>${esc(a.reason) || 'Consultation'} · ${esc(a.doctor)}</small>
        <div class="apa">${bdg(AS[a.status])}${ma && live(a) ? `${a.status === 'planned' ? `<button class="bs" data-d7="astat" data-id="${a.id}" data-s="confirmed">${ic('check', 13)}Confirmer</button>` : ''}<button class="bs" data-d7="astat" data-id="${a.id}" data-s="done">Terminé</button><button class="bs" data-d7="astat" data-id="${a.id}" data-s="no_show">Absent</button><button class="bs dng" data-d7="astat" data-id="${a.id}" data-s="cancelled">${ic('x', 13)}</button>` : ''}</div></div></div>`
      $('#view').innerHTML = `<div class="ph"><div><h2>Calendrier des rendez-vous</h2><span class="muted">Rendez-vous du mois · cliquez sur un jour pour voir le détail</span></div>${ma ? `<div class="row phact"><button data-d7="anew" data-id="${csel}">${ic('plus', 17)} Nouveau rendez-vous</button></div>` : ''}</div>
        ${kpis([kpi('blue', "Aujourd'hui", tdy.length, tdy.length ? `prochain à ${tdy.find(a => new Date(a.starts_at) > now) ? tm(tdy.find(a => new Date(a.starts_at) > now).starts_at) : '—'}` : 'aucun rendez-vous', 'clock'), kpi('teal', 'Cette semaine', week.length, 'rendez-vous prévus', 'calendar'), kpi(unconf.length ? 'orange' : 'green', 'À confirmer', unconf.length, 'rendez-vous à venir ce mois', 'phone'), kpi(noshow.length ? 'red' : 'violet', 'Absences', noshow.length, 'patients absents ce mois', 'alert')])}
        ${tips([tomU.length && { icon: 'phone', tone: 'warn', text: `<b>${tomU.length}</b> rendez-vous de demain ne sont pas encore confirmés : appelez les patients.` },
          unconf.length > tomU.length && { icon: 'check', text: `<b>${unconf.length}</b> rendez-vous à venir restent à confirmer ce mois-ci.` },
          noshow.length && { icon: 'alert', tone: 'danger', text: `<b>${noshow.length}</b> absence(s) ce mois : un rappel de suivi est créé automatiquement pour chaque patient absent.`, href: '#rendez-vous' },
          busiest && busiest[1] >= 6 && { icon: 'activity', text: `Journée la plus chargée : <b>${new Date(busiest[0] + 'T12:00:00Z').toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' })}</b> avec ${busiest[1]} rendez-vous.` },
          !week.length && { icon: 'calendar', text: 'Aucun rendez-vous cette semaine : relancez les patients à revoir (contrôles, suites de traitement).', href: '#rendez-vous' }])}
        <div class="calw"><div class="card calc"><div class="calh"><button class="ibtn" data-d7="cm" data-id="-1" aria-label="Mois précédent">${ic('left', 20)}</button><b class="mlabel">${label}</b><button class="ibtn" data-d7="cm" data-id="1" aria-label="Mois suivant">${ic('right', 20)}</button><button class="sec bs" data-d7="cm" data-id="0">Aujourd'hui</button><div class="sw cvw">${[['month', 'Mois'], ['week', 'Semaine'], ['doc', 'Médecins']].map(([k, l]) => `<button type="button" class="${cview === k ? 'on' : ''}" data-d7="cview" data-id="${k}">${l}</button>`).join('')}</div>
          <span class="clg">${['planned', 'confirmed', 'done', 'no_show', 'cancelled'].map(s => `<span><i class="ch ${AS[s][1]}"></i>${AS[s][0]}</span>`).join('')}</span></div>
          ${cview === 'month' ? `<div class="cdh">${['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'].map(d => `<span>${d}</span>`).join('')}</div><div class="cgrid">${cells}</div>` : altView()}</div>
        <div class="side2"><div class="card"><div class="chd"><h3>${ic('calendar', 18)}<span style="text-transform:capitalize">${new Date(csel + 'T12:00:00Z').toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' })}</span></h3>${ma ? `<button class="bs" data-d7="anew" data-id="${csel}">${ic('plus', 14)}Ajouter</button>` : ''}</div>
            <div class="apl" data-page="5">${day.map(acard).join('') || `<div class="empty" style="padding:22px 6px"><div class="eico">${ic('calendar', 30)}</div><span class="muted">Aucun rendez-vous ce jour.</span></div>`}</div></div>
          <div class="card"><div class="chd"><h3>${ic('bell', 18)}Dans les 36 heures</h3><span class="muted" style="font-size:12.5px">${soon.length}</span></div><div data-page="5">${soon.map(a => `<a class="al" data-pi="1" href="${link(a.patient_id)}"><b>${esc(a.patient)}</b><span>${fdt(a.starts_at)} · ${esc(a.doctor)} · ${AS[a.status][0]}</span></a>`).join('') || '<span class="muted">Aucun rendez-vous dans les prochaines 36 heures.</span>'}</div></div></div></div>` }
  }
  const submit = {
    async fhist(e) { const f = F(e), d = {}; for (const [k] of BOOLS) d[k] = k in f; for (const k of TEXTS) d[k] = f[k] || ''; await api(`/patients/${pid()}/history`, d); toast('Fiche médicale enregistrée'); render() },
    async fexam(e) { await api(`/patients/${pid()}/exams`, F(e)); toast('Examen enregistré'); render() },
    async fupload(e) { const f = e.target.file.files[0], kind = e.target.kind.value; if (!f) return
      // progression réelle de l'envoi (radiographies parfois lourdes)
      let pb = e.target.querySelector('.ld-pb'); if (!pb) { e.target.insertAdjacentHTML('beforeend', progressBar({ value: 0, label: `Téléversement de « ${f.name} »…` })); pb = e.target.querySelector('.ld-pb') }
      try { await uploadWithProgress(`/api/patients/${pid()}/documents`, f, { 'Content-Type': 'application/octet-stream', 'x-file-name': encodeURIComponent(f.name), 'x-doc-kind': kind, 'x-consultation-id': e.target.consultation_id?.value || '' }, v => setProgress(pb, v, v >= 100 ? 'Enregistrement et vérification…' : undefined)) } catch (x) { pb.remove(); throw x }
      setProgress(pb, 100, 'Document enregistré'); toast('Document enregistré'); setTimeout(render, 350) } }
  const fld = (l, n, v = '', o = '') => `<label>${l}<input name="${n}" value="${esc(v)}" ${o}></label>`
  document.addEventListener('input', e => { if (e.target.id !== 'hsearch') return; clearTimeout(views._t); views._t = setTimeout(() => hubList(e.target.value.trim()), 250) })
  // Aide à la saisie de la fiche : allergies, motif, « Normal »
  document.addEventListener('click', e => {
    const al = e.target.closest('[data-alg]'), mo = e.target.closest('[data-motif]'), no = e.target.closest('[data-normal]'), all = e.target.closest('[data-allnormal]')
    if (al) { const i = al.closest('form').querySelector('[name=allergies]'), v = al.dataset.alg; let l = i.value.split(',').map(x => x.trim()).filter(x => x && !/^aucune?$/i.test(x))
      if (v === 'Aucune') l = ['Aucune']; else l = l.includes(v) ? l.filter(x => x !== v) : [...l, v]; i.value = l.join(', ') }
    if (mo) { const t = mo.closest('form').querySelector('[name=motif]'); t.value = t.value.trim() ? (t.value.includes(mo.dataset.motif) ? t.value : t.value.trim() + ', ' + mo.dataset.motif.toLowerCase()) : mo.dataset.motif; t.focus() }
    if (no) { const i = no.closest('form').querySelector(`[name=${no.dataset.normal}]`); i.value = 'Normal' }
    if (all) all.closest('form').querySelectorAll('.exi input').forEach(i => { if (!i.value.trim()) i.value = 'Normal' })
    const tp = e.target.closest('[data-tprob]'); if (tp) { const t = document.getElementById('tnote'); if (!t) return; const v = tp.dataset.tprob.toLowerCase(), l = t.value.split(',').map(x => x.trim()).filter(Boolean)
      t.value = (l.includes(v) ? l.filter(x => x !== v) : [...l, v]).join(', '); tp.classList.toggle('on', !l.includes(v)) } })
  // Survol d'une dent : nom affiché au centre de l'arcade
  document.addEventListener('mouseover', e => { const t = e.target.closest && e.target.closest('.otooth'), h = document.getElementById('ohud'); if (!h) return
    if (!t) { h.textContent = ''; return } const n = Number(t.dataset.id), s = ctx.tmap?.get(n); h.textContent = `${n} · ${toothName(n)}${s ? ' · ' + STATES[s].l : ''}` })
  document.addEventListener('click', async e => { const t = e.target.closest('[data-d7]'); if (!t) return; const a = t.dataset.d7, id = t.dataset.id
    try {
      if (a === 'tooth') { const n = Number(id)
        if (gapMode) { const gone = ['absente', 'extraite'].includes(ctx.tmap.get(n)); await applyState([n], gone ? 'saine' : 'absente', ''); return }
        if (multi) sel.has(n) ? sel.delete(n) : sel.add(n); else sel = sel.has(n) && sel.size === 1 ? new Set() : new Set([n]); paintDents() }
      else if (a === 'clrsel') { sel = new Set(); paintDents() }
      else if (a === 'multi') { multi = !multi; gapMode = false; if (!multi && sel.size > 1) sel = new Set(); paintDents() }
      else if (a === 'gapmode') { gapMode = !gapMode; multi = false; sel = new Set(); paintDents() }
      else if (a === 'gapset') await applyState([...sel], id, document.getElementById('tnote')?.value.trim() || '')
      else if (a === 'dent') { dent = id; sel = new Set(); paintDents() }
      else if (a === 'view3d') { flat = id === '1'; try { localStorage.setItem('dl_odo_flat', flat ? '1' : '0') } catch {} document.getElementById('o3d')?.classList.toggle('flat', flat); document.querySelectorAll('[data-d7="view3d"]').forEach(b => b.classList.toggle('on', b.dataset.id === (flat ? '1' : '0'))) }
      else if (a === 'setst') await applyState([...sel], id, document.getElementById('tnote')?.value.trim() || '')
      else if (a === 'consult') await consultModal(id || '', ctx.tmap)
      else if (a === 'appt') await apptModal(ctx.p)
      else if (a === 'anew') await apptModal(null, id)
      else if (a === 'cview') { cview = id; try { localStorage.setItem('dl_cal_view', id) } catch {} render() }
      else if (a === 'cstep') { const d = new Date(csel + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + Number(id)); csel = d.toISOString().slice(0, 10); cm = csel.slice(0, 7); render() }
      else if (a === 'aopen') { const x = calMap.get(id); if (x) { csel = dayKey(x.starts_at); document.querySelectorAll('.cd.sel').forEach(c => c.classList.remove('sel')); await apptView(x) } }
      else if (a === 'cm') { const [y, m] = cm.split('-').map(Number); cm = id === '0' ? dayKey(new Date()).slice(0, 7) : new Date(Date.UTC(y, m - 1 + Number(id), 1)).toISOString().slice(0, 7); if (id === '0') csel = dayKey(new Date()); render() }
      else if (a === 'day') { csel = id; render() }
      else if (a === 'astat') { if (t.dataset.s === 'cancelled' && !await ui.confirm('Annuler ce rendez-vous ?', { title: 'Annuler le rendez-vous', ok: 'Annuler le rendez-vous', cancel: 'Garder' })) return; await api(`/appointments/${id}/status`, { status: t.dataset.s }); toast('Rendez-vous mis à jour'); render() }
      else if (a === 'darch') { if (await ui.confirm('Archiver ce document ? Il ne sera plus affiché (aucune suppression physique).', { title: 'Archiver le document', ok: 'Archiver' })) { await api(`/documents/${id}/archive`, {}); toast('Document archivé'); render() } }
      else if (a === 'dview') { const docs = ctx.docs || [], d = docs.find(x => x.id === id); if (!d) return; const list = d.mime.startsWith('image/') ? docs.filter(x => x.mime.startsWith('image/')) : [d]; viewer(list, Math.max(0, list.findIndex(x => x.id === id))) }
      else if (a === 'arch') { const v = await ui.dialog({ title: 'Désactiver le dossier', icon: 'alert', tone: 'danger', html: `<p>Le dossier ne sera pas supprimé : il reste conservé, marqué comme inactif avec votre nom et la date, et pourra être réactivé à tout moment.</p><label class="ml">Motif (obligatoire)<input name="reason" required></label>`, buttons: [{ label: 'Annuler', cls: 'sec', value: null }, { label: 'Désactiver', cls: 'pri danger', collect: true, submit: v => api(`/patients/${pid()}/archive`, { reason: v.reason }) }] }); if (v) { toast('Dossier désactivé'); render() } }
      else if (a === 'rest') { if (await ui.confirm('Réactiver ce dossier patient ?', { title: 'Réactiver le dossier', ok: 'Réactiver' })) { await api(`/patients/${pid()}/restore`, {}); toast('Dossier réactivé'); render() } }
      else if (a === 'edit') { const p = (await api(`/patients/${pid()}/summary`)).patient
        const v = await ui.dialog({ title: 'Modifier le patient', icon: 'edit', size: 'xl', html: `<div class="fg">${fld('Nom *', 'last_name', p.last_name, 'required')}${fld('Prénom *', 'first_name', p.first_name, 'required')}${fld('Téléphone', 'phone', p.phone)}${fld('Téléphone 2', 'phone2', p.phone2)}${fld('Date de naissance', 'birth_date', p.birth_date?.slice(0, 10), 'type="date"')}<label>Sexe<select name="sex"><option value="">—</option><option value="M" ${p.sex === 'M' ? 'selected' : ''}>Masculin</option><option value="F" ${p.sex === 'F' ? 'selected' : ''}>Féminin</option></select></label><div class="s2">${fld('Adresse', 'address', p.address)}</div>${fld('Département', 'department', p.department)}${fld('Zone', 'zone', p.zone)}<label>Statut matrimonial<select name="marital_status"><option value="">—</option>${so(['Célibataire', 'Marié(e)', 'Union libre', 'Divorcé(e)', 'Veuf / veuve'], p.marital_status)}</select></label>${fld("Nombre d'enfants", 'children_count', p.children_count, 'type="number" min="0" max="30"')}${fld('Profession', 'profession', p.profession)}${fld('E-mail', 'email', p.email, 'type="email"')}${fld("Pièce d'identité", 'id_number', p.id_number)}${fld('Lieu de naissance', 'birth_place', p.birth_place)}${fld('Assurance', 'insurance', p.insurance)}${fld("N° d'assuré", 'insurance_number', p.insurance_number)}${fld('Référé par', 'referred_by', p.referred_by)}${fld('Remise sur tous les actes (%)', 'discount_percent', p.discount_percent, 'type="number" min="0" max="100" step="0.5"')}<div class="s2">${fld('Notes', 'notes', p.notes)}</div>${fld("Contact d'urgence", 'emergency_contact', p.emergency_contact)}${fld('N° du contact', 'emergency_phone', p.emergency_phone)}</div>`,
          buttons: [{ label: 'Annuler', cls: 'sec', value: null }, { label: 'Enregistrer', cls: 'pri', collect: true, submit: v => api(`/patients/${pid()}/update`, v) }] }); if (v) { toast('Patient mis à jour'); render() } }
    } catch (x) { toast(x.message) } })
  return { views, submit, click: async () => false }
}
