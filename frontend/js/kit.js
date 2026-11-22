// Composants partagés des pages de gestion (facturation, caisse, stock, personnel).
import { ic } from './icons.js'
export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
export const num = v => Number(v ?? 0) || 0
export const money = (v, c = 'HTG') => num(v).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + (c ? ' ' + c : '')
export const qty = v => num(v).toLocaleString('fr-FR', { maximumFractionDigits: 3 })
export const fdate = d => d ? new Date(d).toLocaleDateString('fr-FR', { timeZone: 'America/Port-au-Prince' }) : '—'
export const fdt = d => d ? new Date(d).toLocaleString('fr-FR', { timeZone: 'America/Port-au-Prince', dateStyle: 'short', timeStyle: 'short' }) : '—'
export const monthLabel = p => new Date(p + '-01T12:00:00').toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' })
export const initials = (a, b) => esc(((a || '')[0] || '') + ((b || '')[0] || ''))

// En-tête de page : titre, sous-titre, boutons d'action
export const head = (title, sub, actions = '') => `<div class="ph"><div><h2>${title}</h2>${sub ? `<span class="muted">${sub}</span>` : ''}</div>${actions ? `<div class="row phact">${actions}</div>` : ''}</div>`
export const btn = (a, label, icon, cls = '', extra = '') => `<button type="button" class="${cls}" data-a="${a}" ${extra}>${icon ? ic(icon, 17) : ''}${label}</button>`
// Petit bouton d'action dans un tableau (icône + texte, pas d'infobulle)
export const bs = (a, id, label, icon, cls = '', extra = '') => `<button type="button" class="bs ${cls}" data-a="${a}" data-id="${id}" ${extra}>${icon ? ic(icon, 15) : ''}${label}</button>`
export const bsLink = (href, label, icon = 'file') => `<a class="bs" href="${href}" target="_blank" rel="noopener">${ic(icon, 15)}${label}</a>`

// Cartes indicateurs (même style que le tableau de bord)
const G = { blue: 'linear-gradient(135deg,#1d6fd8,#0a4fb0)', teal: 'linear-gradient(135deg,#16a394,#0b7a6f)', violet: 'linear-gradient(135deg,#7c5cf0,#5a3fd1)', green: 'linear-gradient(135deg,#12a36a,#0b7c4f)', red: 'linear-gradient(135deg,#e5484d,#b9303a)', orange: 'linear-gradient(135deg,#f5a524,#d9780a)', slate: 'linear-gradient(135deg,#4a5a78,#2c3a55)' }
export const kpi = (tone, label, value, sub, icon) => `<div class="kg" style="background:${G[tone] || G.blue}">${ic(icon, 48).replace('class="ic"', 'class="kico"')}<div class="kl">${label}</div><div class="kv">${value}</div><div class="ks">${sub || ''}</div></div>`
export const kpis = cards => `<div class="kpis">${cards.join('')}</div>`

export const badge = (t, cls = 'st-info') => `<span class="badge ${cls}">${t}</span>`
export const pbar = (ratio, color = 'var(--ok)') => `<div class="pbar"><i style="width:${Math.max(0, Math.min(100, ratio * 100)).toFixed(1)}%;background:${color}"></i></div>`
export const empty = (icon, title, text = '', action = '') => `<div class="empty"><div class="eico">${ic(icon, 38)}</div><b>${title}</b>${text ? `<span class="muted">${text}</span>` : ''}${action}</div>`
// Carte avec en-tête (titre + zone à droite)
export const card = (title, icon, body, right = '', cls = '') => `<div class="card ${cls}"><div class="chd"><h3>${icon ? ic(icon, 18) : ''}${title}</h3>${right ? `<div class="row chr">${right}</div>` : ''}</div>${body}</div>`
export const search = (target, ph) => `<label class="sbox sm">${ic('search', 16)}<input data-filter="${target}" placeholder="${ph}" autocomplete="off"></label>`
export const person = (a, b, sub = '') => `<div class="pn"><span class="dav xs">${initials(a, b)}</span><span class="hn"><b>${esc(a)} ${esc(b)}</b>${sub ? `<small>${sub}</small>` : ''}</span></div>`

// Champs de formulaire pour les fenêtres modales
export const fld = (label, name, attrs = '', cls = '') => `<label class="${cls}">${label}<input name="${name}" ${attrs}></label>`
export const sel = (label, name, opts, value = '', cls = '') => `<label class="${cls}">${label}<select name="${name}">${opts.map(o => { const [v, l] = Array.isArray(o) ? o : [o, o]; return `<option value="${esc(v)}" ${String(v) === String(value) ? 'selected' : ''}>${esc(l)}</option>` }).join('')}</select></label>`
// Fenêtre modale de saisie : renvoie les valeurs saisies, ou null si annulée
export const modal = ({ title, icon = 'edit', html, ok = 'Enregistrer', submit, wide = false, onOpen, tone = 'info', danger = false }) =>
  window.ui.dialog({ title, icon, tone, wide, lock: true, onOpen, html, buttons: [{ label: 'Annuler', cls: 'sec', value: null }, { label: ok, cls: 'pri' + (danger ? ' danger' : ''), collect: true, submit }] })

const topS = box => { const all = [...box.querySelectorAll('[data-s]')], set = new Set(all); return all.filter(x => { for (let p = x.parentElement; p && p !== box; p = p.parentElement) if (set.has(p)) return false; return true }) }
// Filtre instantané des lignes d'un tableau (attribut data-s sur chaque ligne)
document.addEventListener('input', e => {
  const t = e.target.closest && e.target.closest('[data-filter]'); if (!t) return
  const v = t.value.trim().toLowerCase(), box = document.querySelector(t.dataset.filter); if (!box) return
  let n = 0; topS(box).forEach(r => { const ok = !v || r.dataset.s.includes(v); r.hidden = !ok; if (ok) n++ })
  const none = box.querySelector('.nores'); if (none) none.hidden = n > 0 || !v
  if (box.dataset.page) { topS(box).forEach(r => { r.dataset.m = !v || r.dataset.s.includes(v) ? '1' : '0' }); box.dataset.p = '0'; paginate(box) }
})
// ── Pagination automatique : tout conteneur avec data-page="N" n'affiche que N éléments (boutons Précédent / Suivant) ──
// éléments de premier niveau seulement (les boutons à l'intérieur d'une ligne, qui portent aussi data-s, ne comptent pas)
const pItems = box => { const all = [...box.querySelectorAll('[data-s],[data-pi]')].filter(x => x.closest('[data-page]') === box), set = new Set(all)
  return all.filter(x => { for (let p = x.parentElement; p && p !== box; p = p.parentElement) if (set.has(p)) return false; return true }) }
export function paginate(box) {
  if (!box.id) box.id = 'pg' + Math.random().toString(36).slice(2, 8)
  const size = Math.max(1, +box.dataset.page || 10), all = pItems(box), match = all.filter(x => x.dataset.m !== '0'), pages = Math.max(1, Math.ceil(match.length / size))
  const p = Math.min(pages - 1, Math.max(0, +box.dataset.p || 0)); box.dataset.p = p
  all.forEach(x => { x.hidden = true }); match.slice(p * size, p * size + size).forEach(x => { x.hidden = false })
  const anchor = box.closest('.tw') || box; let bar = anchor.nextElementSibling?.classList?.contains('kpager') ? anchor.nextElementSibling : null
  if (pages <= 1) { bar?.remove(); return }
  if (!bar) { bar = document.createElement('div'); bar.className = 'kpager'; anchor.after(bar) }
  bar.innerHTML = `<button type="button" class="sec bs" data-kp="${box.id}" data-d="-1" ${p ? '' : 'disabled'}>${ic('left', 15)}Précédent</button><span>Page <b>${p + 1}</b> / ${pages} · ${match.length} élément(s)</span><button type="button" class="sec bs" data-kp="${box.id}" data-d="1" ${p < pages - 1 ? '' : 'disabled'}>Suivant${ic('right', 15)}</button>`
}
document.addEventListener('click', e => { const b = e.target.closest('[data-kp]'); if (!b) return; const box = document.getElementById(b.dataset.kp); if (!box) return
  box.dataset.p = (+box.dataset.p || 0) + (+b.dataset.d); paginate(box); (box.closest('.card') || box).scrollIntoView({ block: 'nearest', behavior: 'smooth' }) })
let pgT; new MutationObserver(() => { clearTimeout(pgT); pgT = setTimeout(() => document.querySelectorAll('[data-page]:not([data-pinit])').forEach(b => { b.dataset.pinit = '1'; paginate(b) }), 0) }).observe(document.documentElement, { childList: true, subtree: true })
// ── Bloc « À retenir » : recommandations calculées pour la page ──
export const tips = (items, title = 'À retenir') => { items = items.filter(Boolean); if (!items.length) return ''
  return `<div class="card ktips"><div class="chd"><h3>${ic('zap', 18)}${title}</h3><span class="muted" style="font-size:12.5px">${items.length} point(s)</span></div><div class="ktl">${items.map(t => t.href ? `<a href="${t.href}" class="ktip ${t.tone || ''}">${ic(t.icon || 'info', 16)}<span>${t.text}</span>${ic('right', 15)}</a>` : `<div class="ktip ${t.tone || ''}">${ic(t.icon || 'info', 16)}<span>${t.text}</span></div>`).join('')}</div></div>` }
export const noRes = cols => `<tr class="nores" hidden><td colspan="${cols}" class="muted" style="text-align:center;padding:22px">Aucun résultat pour cette recherche.</td></tr>`

// ── Bloc « Facturation et paiement » d'un acte : réduction (HTG ou %), paiement immédiat, balance en direct ──
export const METHODS = ['espèces', 'MonCash', 'NatCash', 'virement', 'carte', 'chèque', 'Autre']
const n0 = s => Number(String(s ?? '').replace(',', '.')) || 0
export const payBlock = (amount = '', withAmount = true) => `<div class="payb"><div class="paybh">${ic('dollar', 16)}<b>Facturation et paiement</b><small>La facture est créée automatiquement au nom du médecin qui réalise l'acte.</small></div>
  <div class="fg">${withAmount ? `<label>Montant de l'acte (HTG)<input name="cost" inputmode="decimal" value="${amount}" placeholder="0"></label>` : ''}
  <label>Réduction<span class="disc"><input name="discount" inputmode="decimal" placeholder="0"><select name="disc_mode" aria-label="Type de réduction"><option value="htg">HTG</option><option value="pct">%</option></select></span></label>
  <label>Payé maintenant (HTG)<input name="paid" inputmode="decimal" placeholder="0"></label>
  <label>Mode de paiement<select name="method">${METHODS.map(m => `<option>${m}</option>`).join('')}</select></label><label data-refw hidden>Référence du paiement <i class="req">*</i><input name="reference" placeholder="N° de transaction, de virement ou de chèque"></label></div>
  <div class="qchips"><button type="button" class="qc" data-payall>${ic('check', 13)} Tout payé</button><button type="button" class="qc" data-paynone>Rien payé (à crédit)</button></div>
  <div class="paysum"><span>Montant<b data-ps="a">0</b></span><span>Réduction<b data-ps="d">0</b></span><span>Total à payer<b data-ps="t">0</b></span><span>Payé<b data-ps="p">0</b></span><span class="bal">Balance<b data-ps="b">0</b></span></div></div>`
export const payCalc = (md, fixed) => { const a = fixed ?? n0(md.querySelector('[name=cost]')?.value), dv = n0(md.querySelector('[name=discount]')?.value), pct = md.querySelector('[name=disc_mode]')?.value === 'pct'
  const d = Math.min(a, Math.round((pct ? a * dv / 100 : dv) * 100) / 100), t = Math.round((a - d) * 100) / 100, p = n0(md.querySelector('[name=paid]')?.value); return { a, d, t, p, b: Math.round((t - p) * 100) / 100 } }
export const wirePay = (md, fixed) => {
  const upd = () => { const r = payCalc(md, fixed), set = (k, v) => { const e = md.querySelector(`[data-ps="${k}"]`); if (e) e.textContent = money(v) }
    set('a', r.a); set('d', r.d); set('t', r.t); set('p', r.p); set('b', r.b); const rw = md.querySelector('[data-refw]'); if (rw) rw.hidden = !(r.p > 0 && NEED_REF.includes(md.querySelector('[name=method]')?.value)); const b = md.querySelector('.paysum .bal'); b.classList.toggle('neg', r.b < 0); b.classList.toggle('ok', r.b === 0 && r.t > 0); b.classList.toggle('due', r.b > 0) }
  md.addEventListener('input', upd); md.addEventListener('change', upd)
  md.addEventListener('click', e => { if (e.target.closest('[data-payall]')) { md.querySelector('[name=paid]').value = payCalc(md, fixed).t.toFixed(2); upd() } if (e.target.closest('[data-paynone]')) { md.querySelector('[name=paid]').value = ''; upd() } }); upd() }
export const NEED_REF = ['MonCash', 'NatCash', 'virement', 'chèque']
export const payFields = (md, fixed) => { const r = payCalc(md, fixed), method = md.querySelector('[name=method]')?.value, reference = md.querySelector('[name=reference]')?.value.trim() || ''; if (r.b < -0.001) throw new Error('Le montant payé dépasse le total à payer')
  if (r.p > 0 && NEED_REF.includes(method) && !reference) { md.querySelector('[name=reference]')?.focus(); throw new Error(`Indiquez la référence du paiement par ${method} (n° de transaction, de virement ou de chèque).`) }
  return { discount: r.d ? r.d.toFixed(2) : '', paid: r.p ? r.p.toFixed(2) : '', method, reference } }
export const billMsg = b => !b ? '' : `Facture ${b.number} · total ${money(b.total)}${b.discount ? ' (réduction ' + money(b.discount) + ')' : ''} · payé ${money(b.paid)} · balance ${money(b.balance)}`

// ── Grille des tarifs : chargée une fois, rafraîchie après modification ──
let tfCache = null
export const loadTariffs = async (api, force) => { if (!tfCache || force) tfCache = api('/tariffs').catch(() => ({ rows: [], rate: null })); return tfCache }
export const resetTariffs = () => { tfCache = null }
// montant en HTG d'un tarif (dollars convertis au taux du jour) ; null si « à déterminer » ou taux manquant
export const tHTG = (t, rate) => t.price == null ? null : t.currency === 'USD' ? (rate ? Math.round(t.price * rate * 100) / 100 : null) : t.price
export const tLabel = (t, rate) => t.price == null ? 'Prix à déterminer' : t.currency === 'USD' ? `${num(t.price).toLocaleString('fr-FR')} $${rate ? ' ≈ ' + money(t.price * rate) : ''}` : money(t.price)

// ── Médecin qui réalise l'acte : un médecin simple (DENTIST) est toujours l'auteur de ses actes, sans possibilité de changer ──
export const isDentist = u => u?.role === 'DENTIST'
export const docField = (docs, u, { name = 'doctor_id', label = 'Réalisée par', cls = '' } = {}) => {
  const mine = docs.find(d => d.id === u?.id) || (isDentist(u) ? { id: u.id, name: `${u.first_name || ''} ${u.last_name || ''}`.trim() } : null), cur = mine || docs[0]
  if (isDentist(u)) return `<div class="dlock ${cls}"><span class="dav xs">${esc(mine.name.split(' ').map(w => w[0] || '').join('').slice(0, 2))}</span><div><small>${label}</small><b>${esc(mine.name)} (vous)</b></div><span class="dlk">${ic('lock', 12)} Automatique</span><input type="hidden" name="${name}" value="${mine.id}"></div>`
  return `<label class="${cls}">${label}<select name="${name}">${docs.map(d => `<option value="${d.id}" ${cur?.id === d.id ? 'selected' : ''}>${esc(d.name)}${mine?.id === d.id ? ' (vous)' : ''}</option>`).join('')}</select></label>` }
// ── Dents traitées (numérotation FDI, vue du praticien) : plusieurs dents, ou « soin global » ──
const QUADS = [[[18, 17, 16, 15, 14, 13, 12, 11], [21, 22, 23, 24, 25, 26, 27, 28]], [[48, 47, 46, 45, 44, 43, 42, 41], [31, 32, 33, 34, 35, 36, 37, 38]]]
export const teethList = s => [...new Set(String(s ?? '').split(/[^0-9]+/).filter(Boolean).map(Number))].sort((a, b) => a - b)
export const teethPicker = (sel = [], { required = false, title = 'Dents traitées', marks = null } = {}) => { const S = new Set(sel.map(Number)), M = n => marks?.get(n)
  return `<div class="tpk" data-tpk ${required ? 'data-req' : ''}><input type="hidden" name="teeth" value="${[...S].join(', ')}"><div class="tpkh"><span>${title}${required ? ' <i class="req">*</i>' : ''}</span><b data-tpkn></b></div>
    <div class="tpka">${QUADS.map((row, r) => `<div class="tpkr ${r ? 'low' : 'up'}">${row.map(q => `<div class="tpkq">${q.map(n => `<button type="button" class="tpkt ${S.has(n) ? 'on' : ''} ${M(n)?.c ? 'mk' : ''}" data-tn="${n}" aria-pressed="${S.has(n)}" ${M(n)?.c ? `style="--mk:${M(n).c}" title="${n} · ${esc(M(n).l)}"` : ''} ${M(n)?.off ? 'disabled' : ''}>${n}</button>`).join('')}</div>`).join('')}</div>`).join('')}</div>
    <label class="ck tpkg"><input type="checkbox" data-tpkg> Soin global, sans dent précise (prophylaxie, blanchiment…)</label><small class="tpke">Touchez les dents traitées, ou cochez « Soin global ».</small></div>` }
export const wireTeeth = root => root.querySelectorAll('[data-tpk]').forEach(w => { const inp = w.querySelector('[name=teeth]'), g = w.querySelector('[data-tpkg]')
  const upd = () => { const v = [...w.querySelectorAll('.tpkt.on')].map(b => +b.dataset.tn).sort((a, b) => a - b); if (v.length) g.checked = false; inp.value = v.join(', ')
    w.querySelector('[data-tpkn]').textContent = v.length ? (v.length > 1 ? 'Dents ' : 'Dent ') + v.join(', ') : g.checked ? 'Soin global' : 'Aucune dent choisie'; if ((v.length || g.checked) && w.classList.contains('err')) { w.classList.remove('err'); const er = w.closest('.mo')?.querySelector('.merr'); if (er) er.hidden = true } }
  w.addEventListener('click', e => { const b = e.target.closest('[data-tn]'); if (b) { b.classList.toggle('on'); b.setAttribute('aria-pressed', b.classList.contains('on')); upd() } })
  g.addEventListener('change', () => { if (g.checked) w.querySelectorAll('.tpkt.on').forEach(b => b.classList.remove('on')); upd() }); upd() })
export const teethOk = root => { const w = root.querySelector('[data-tpk][data-req]'); if (!w) return; if (w.querySelector('[name=teeth]').value || w.querySelector('[data-tpkg]').checked) return
  w.classList.add('err'); w.scrollIntoView({ block: 'center', behavior: 'smooth' }); throw new Error('Indiquez la ou les dents traitées, ou cochez « Soin global ».') }

// ── Rémunération : salaire fixe, pourcentage sur les actes, ou les deux (obligatoire pour tout le personnel) ──
export const payLabel = e => { const b = num(e?.base_salary), p = num(e?.commission_pct); return b > 0 && p > 0 ? `${money(b)} + ${p} %` : b > 0 ? `Fixe · ${money(b)}` : p > 0 ? `${p} % des actes` : '' }
export const payTypeFields = (e = {}, { doctor = false } = {}) => { const b = num(e.base_salary), p = num(e.commission_pct), t = b > 0 && p > 0 ? 'mixte' : p > 0 ? 'pourcentage' : b > 0 ? 'fixe' : doctor ? 'pourcentage' : 'fixe'
  return `<div class="ptf s2" data-ptf><span class="ptfl">Rémunération <i class="req">*</i></span><div class="seg">${[['fixe', 'Salaire fixe'], ['pourcentage', 'Pourcentage'], ['mixte', 'Fixe + pourcentage']].map(([k, l]) => `<label class="ck ${k === t ? 'on' : ''}"><input type="radio" name="pay_type" value="${k}" ${k === t ? 'checked' : ''}>${l}</label>`).join('')}</div>
    <div class="fg"><label data-pt="fixe">Salaire fixe mensuel (HTG) <i class="req">*</i><input name="base_salary" inputmode="decimal" value="${b || ''}" placeholder="Ex : 25000"></label><label data-pt="pct">Pourcentage sur les actes (%) <i class="req">*</i><input name="commission_pct" inputmode="decimal" value="${p || ''}" placeholder="Ex : 30"></label></div>
    <small class="muted ptfh" data-pth></small></div>` }
export const wirePayType = root => root.querySelectorAll('[data-ptf]').forEach(w => { const upd = () => { const t = w.querySelector('[name=pay_type]:checked')?.value
    w.querySelectorAll('.seg label').forEach(l => l.classList.toggle('on', l.querySelector('input').checked)); w.querySelector('[data-pt=fixe]').hidden = t === 'pourcentage'; w.querySelector('[data-pt=pct]').hidden = t === 'fixe'
    w.querySelector('[data-pth]').textContent = t === 'fixe' ? 'Montant versé chaque mois, quelle que soit l\'activité.' : t === 'pourcentage' ? 'Pourcentage des actes réalisés (encaissés ou facturés selon le réglage de la page Médecins), versé avec la paie.' : 'Salaire fixe chaque mois, plus le pourcentage sur les actes réalisés.' }
  w.addEventListener('change', upd); upd() })
export const payTypeValues = f => ({ pay_type: f.pay_type, base_salary: f.pay_type === 'pourcentage' ? '0' : String(f.base_salary || '').replace(/\s/g, '').replace(',', '.'), commission_pct: f.pay_type === 'fixe' ? '0' : String(f.commission_pct || '').replace(',', '.') })

// ── Parcours du patient le jour du rendez-vous : arrivé → en consultation → terminé ──
export const FLOW = [['arrived', 'Arrivé', 'user'], ['seated', 'En consultation', 'activity'], ['finished', 'Terminé', 'check']]
export const FLOW_BTN = { arrived: 'Patient arrivé', seated: 'Appeler en consultation', finished: 'Soin terminé' }
export const flowNext = a => a.finished_at ? null : a.seated_at ? 'finished' : a.arrived_at ? 'seated' : 'arrived'
export const tmL = d => d ? new Date(d).toLocaleTimeString('fr-FR', { timeZone: 'America/Port-au-Prince', hour: '2-digit', minute: '2-digit' }) : ''
export const minsSince = (a, b) => Math.max(0, Math.round((new Date(b || Date.now()) - new Date(a)) / 6e4))
export const flowBar = a => `<div class="flw">${FLOW.map(([k, l, i]) => { const t = a[k + '_at']; return `<div class="fls ${t ? 'ok' : ''} ${flowNext(a) === k ? 'nx' : ''}"><span>${ic(t ? 'check' : i, 14)}</span><b>${l}</b><small>${t ? tmL(t) : '—'}</small></div>` }).join('<i></i>')}</div>`
export const flowInfo = a => a.finished_at ? `Attente ${a.seated_at && a.arrived_at ? minsSince(a.arrived_at, a.seated_at) : '?'} min · soin ${minsSince(a.seated_at, a.finished_at)} min (prévu ${a.duration_min} min)` : a.seated_at ? `En consultation depuis ${minsSince(a.seated_at)} min · attente ${a.arrived_at ? minsSince(a.arrived_at, a.seated_at) : '?'} min` : a.arrived_at ? `Attend depuis ${minsSince(a.arrived_at)} min` : ''
// ── Niveau de confiance d'une estimation ──
export const conf = c => c ? `<span class="cf cf-${String(c.level).replace(/[^a-z]/g, '')}" title="Estimation calculée sur ${c.n} observation(s)">confiance ${c.level}${c.n != null ? ' · ' + c.n + ' obs.' : ''}</span>` : ''
// ── Créneaux conseillés dans une fenêtre de rendez-vous (moteur d'intelligence ; facultatif, ne bloque jamais la saisie) ──
export const slotBlock = () => `<div class="slp"><button type="button" class="sec bs" data-slots>${ic('zap', 15)}Proposer les meilleurs créneaux</button><div data-slr></div></div>`
export const wireSlots = (md, api) => md.addEventListener('click', async e => {
  const box = md.querySelector('[data-slr]')
  if (e.target.closest('[data-slots]')) { const doc = md.querySelector('[name=doctor_id]')?.value, dur = md.querySelector('[name=duration_min]')?.value, rs = md.querySelector('[name=reason]')?.value || '', d = md.querySelector('[name=d]')?.value
    box.innerHTML = `<div class="ld-inline" role="status" aria-live="polite"><span class="ld-sp ld-sm"><i aria-hidden="true"></i></span> Recherche des meilleurs créneaux…</div>`
    try { const r = await api(`/intel/slots?doctor_id=${encodeURIComponent(doc || '')}&minutes=${encodeURIComponent(dur || '')}&reason=${encodeURIComponent(rs)}&from=${encodeURIComponent(d || '')}`)
      if (!r.enabled) { box.innerHTML = `<span class="muted">Le moteur d'intelligence est désactivé : choisissez l'heure manuellement.</span>`; return }
      const sd = r.suggested_duration && Number(r.suggested_duration.minutes) !== Number(dur) ? `<button type="button" class="qc sdur" data-sdur="${r.suggested_duration.minutes}">${ic('clock', 13)} Durée réelle de ce soin : ${r.suggested_duration.minutes} min (médiane ${r.suggested_duration.median} min, ${r.suggested_duration.n} soins) — appliquer</button>` : ''
      box.innerHTML = (r.service?.length ? `<div class="slsv">${ic('clock', 13)} ${r.has_schedule ? 'En service' : 'Horaires de la clinique'} : ${esc(r.service.join(' · '))}</div>` : '<div class="slsv neg">Ce médecin n\'a aucune heure de service définie.</div>') + sd + (r.slots.length ? `<div class="slc">${r.slots.map(s => `<button type="button" class="sl" data-sl="${s.day}|${s.time}" title="${esc(s.why)}"><b>${new Date(s.day + 'T12:00:00Z').toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' })}</b><span>${s.time}</span><small>${esc(s.why)}</small></button>`).join('')}</div><small class="muted">Classés pour éviter les temps morts et équilibrer les journées · médecin libre. Vous restez libre de choisir.</small>` : '<span class="muted">Aucun créneau libre sur 14 jours pour ces critères.</span>')
    } catch (x) { box.innerHTML = `<span class="muted">${esc(x.message)}</span>` } }
  const s = e.target.closest('[data-sl]'); if (s) { const [d, t] = s.dataset.sl.split('|'); md.querySelector('[name=d]').value = d; md.querySelector('[name=t]').value = t; md.querySelectorAll('[data-sl]').forEach(x => x.classList.toggle('on', x === s)) }
  const sd = e.target.closest('[data-sdur]'); if (sd) { const sel = md.querySelector('[name=duration_min]'), v = sd.dataset.sdur; if (![...sel.options].some(o => o.value === v)) sel.insertAdjacentHTML('beforeend', `<option value="${v}">${v} min</option>`); sel.value = v; sd.remove() } })

// ── Mot de passe fort : mêmes règles que le serveur, affichées en direct sous le champ ──
export const PW_RULES = [['12 caractères minimum', p => p.length >= 12], ['Majuscule et minuscule', p => /[a-z]/.test(p) && /[A-Z]/.test(p)], ['Un chiffre', p => /\d/.test(p)], ['Un caractère spécial (! ? # @ % & *)', p => /[^A-Za-z0-9]/.test(p)], ['Pas 3 fois le même caractère à la suite', p => p && !/(.)\1\1/.test(p)], ['Pas de mot courant (password, azerty, 123456…)', p => p && !/password|motdepasse|azerty|qwerty|123456|abcdef|admin|welcome|bienvenue|dental|clinique|clinic|haiti|soleil|secret/i.test(p)]]
document.addEventListener('input', e => { const i = e.target; if (!(i instanceof HTMLInputElement) || !(i.name === 'next' || i.dataset.pwStrength !== undefined)) return
  let box = i.parentElement.querySelector(':scope > .pwm'); if (!box) { box = document.createElement('div'); box.className = 'pwm'; box.setAttribute('aria-live', 'polite'); i.after(box) }
  const p = i.value, ok = PW_RULES.map(([l, t]) => [l, !!t(p)]), n = ok.filter(x => x[1]).length, lvl = !p ? 0 : n <= 2 ? 1 : n <= 4 ? 2 : n === 5 ? 3 : 4
  box.innerHTML = `<div class="pwb l${lvl}"><i></i><i></i><i></i><i></i></div><span class="pwl">${['', 'Très faible', 'Faible', 'Presque', 'Fort'][lvl]}</span><ul>${ok.map(([l, v]) => `<li class="${v ? 'ok' : ''}">${ic(v ? 'check' : 'x', 12)} ${l}</li>`).join('')}</ul>` })
