// ═══ Moteur d'intelligence opérationnelle (recherche opérationnelle) ═══
// Indépendant des fonctions essentielles : calculs en arrière-plan sur les données locales, résultats conservés,
// activable / désactivable, chaque analyse isolée (une erreur n'affecte ni les autres analyses ni la clinique).
// Il PROPOSE des recommandations administratives ; il ne décide rien et ne remplace jamais le jugement médical.
import { q } from '../db/pool.js'

export const TZ = 'America/Port-au-Prince'
const pause = () => new Promise(r => setImmediate(r))                 // rend la main entre deux analyses : aucune requête bloquée
const round = (v, d = 1) => v == null || !isFinite(v) ? null : Math.round(v * 10 ** d) / 10 ** d
const mean = a => a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0
const sd = a => { if (a.length < 2) return 0; const m = mean(a); return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1)) }
const quant = (a, p) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y), i = (s.length - 1) * p, lo = Math.floor(i); return s[lo] + (s[Math.min(s.length - 1, lo + 1)] - s[lo]) * (i - lo) }
// niveau de confiance d'une estimation selon la taille de l'échantillon (présenté à l'utilisateur, jamais une certitude)
export const confidence = n => n >= 60 ? { level: 'élevée', n } : n >= 20 ? { level: 'moyenne', n } : n >= 5 ? { level: 'faible', n } : { level: 'insuffisante', n }

// ── Heures locales (Haïti) ──
const parts = d => Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', weekday: 'short' }).formatToParts(d).map(p => [p.type, p.value]))
export const localDay = d => { const p = parts(d); return `${p.year}-${p.month}-${p.day}` }
export const localMin = d => { const p = parts(d); return Number(p.hour) * 60 + Number(p.minute) }
const WD = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }
export const localWeekday = d => WD[parts(d).weekday]
// instant correspondant à « jour local + minute locale »
export const zoned = (day, min) => { const g = new Date(`${day}T${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}:00Z`), p = parts(g)
  const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute); return new Date(g.getTime() + (g.getTime() - asUtc)) }
const hm = s => { const [h, m] = String(s || '08:00').split(':').map(Number); return h * 60 + (m || 0) }
export const clinicCfg = async cid => { const c = (await q("select open_time,close_time,work_days,chairs,intel_enabled,intel_since,hours,(select count(*) from users u where u.clinic_id=clinics.id and u.role='DENTIST' and u.status='active')::int docs from clinics where id=$1", [cid])).rows[0] || {}
  const base = String(c.work_days || '1,2,3,4,5,6').split(',').map(Number), H = {}
  for (let w = 0; w < 7; w++) { const h = c.hours && Object.prototype.hasOwnProperty.call(c.hours, String(w)) ? c.hours[String(w)] : base.includes(w) ? { open: c.open_time, close: c.close_time } : null; H[w] = h && h.open && h.close && hm(h.open) < hm(h.close) ? { open: hm(h.open), close: hm(h.close), open_time: h.open, close_time: h.close } : null }
  const sch = (await q('select doctor_id,weekday,start_time,end_time from doctor_schedules where clinic_id=$1 order by start_time', [cid])).rows, S = {}
  for (const r of sch) ((S[r.doctor_id] ||= {})[r.weekday] ||= []).push([hm(r.start_time), hm(r.end_time)])
  const days = Object.keys(H).map(Number).filter(w => H[w]), opens = days.map(w => H[w])
  return { hoursFor: w => H[w], hours: H, schedules: S, open: opens.length ? Math.min(...opens.map(h => h.open)) : hm(c.open_time), close: opens.length ? Math.max(...opens.map(h => h.close)) : hm(c.close_time), days, chairs: Math.max(1, Number(c.docs) || 1)   /* capacité = médecins actifs (pas de gestion des fauteuils) */, enabled: c.intel_enabled !== false, since: c.intel_since, open_time: c.open_time, close_time: c.close_time, work_days: c.work_days }
  }
// plages de travail d'un médecin un jour donné : ses plages de service (si définies) limitées aux horaires de la clinique
export const doctorWindows = (cfg, doctorId, wd) => { const h = cfg.hoursFor(wd); if (!h) return []; const own = cfg.schedules[doctorId]
  if (!own) return [[h.open, h.close]]; return (own[wd] || []).map(([a, b]) => [Math.max(a, h.open), Math.min(b, h.close)]).filter(([a, b]) => a < b) }
export const fmtHm = m => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
const addDays = (day, n) => { const d = new Date(day + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10) }
const norm = r => String(r || 'Consultation').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z ]/g, ' ').trim().split(/\s+/).slice(0, 2).join(' ') || 'consultation'

// ── File d'attente M/M/c (Erlang C) : temps d'attente moyen théorique avec c fauteuils ──
export const erlangC = (lambda, mu, c) => { const a = lambda / mu, rho = a / c; if (!(rho < 1)) return { rho, wq: Infinity }
  let s = 0, f = 1; for (let k = 0; k < c; k++) { if (k) f *= k; s += a ** k / f } const fc = f * (c || 1), top = a ** c / fc / (1 - rho), pw = top / (s + top); return { rho, pw, wq: pw / (c * mu - lambda) } }

// ═══ Analyses ═══
// 1. Durées réelles des soins (fauteuil → fin) par motif et par médecin, comparées aux durées prévues
async function durations(cid) {
  const r = (await q("select a.doctor_id,u.first_name||' '||u.last_name doctor,a.reason,a.duration_min,extract(epoch from (a.finished_at-a.seated_at))/60 real from appointments a join users u on u.id=a.doctor_id where a.clinic_id=$1 and a.seated_at is not null and a.finished_at is not null and a.finished_at>a.seated_at+interval '1 minute' and a.starts_at>now()-interval '180 days'", [cid])).rows
  const g = {}; for (const x of r) { const k = norm(x.reason); (g[k] ||= { reason: x.reason || 'Consultation', real: [], planned: [] }); g[k].real.push(Number(x.real)); g[k].planned.push(x.duration_min) }
  const byReason = Object.entries(g).map(([key, v]) => ({ key, reason: v.reason, n: v.real.length, median: round(quant(v.real, .5)), p80: round(quant(v.real, .8)), planned: round(mean(v.planned)), overrun: round(mean(v.real) - mean(v.planned)), confidence: confidence(v.real.length) })).sort((a, b) => b.n - a.n)
  return { samples: r.length, byReason, overrun: round(mean(r.map(x => Number(x.real) - x.duration_min))), confidence: confidence(r.length) } }
// durée conseillée pour un nouveau rendez-vous (80e centile des durées réelles, arrondie au quart d'heure)
export const suggestDuration = (dur, reason) => { const x = dur?.byReason?.find(b => b.key === norm(reason)); if (!x || x.n < 3) return null; return { minutes: Math.max(15, Math.ceil(x.p80 / 15) * 15), n: x.n, median: x.median, confidence: x.confidence } }

// 2. File d'attente : attente réelle (arrivée → fauteuil), goulots d'étranglement, modèle M/M/c aux heures de pointe
async function queue(cid, cfg) {
  const r = (await q("select a.doctor_id,u.first_name||' '||u.last_name doctor,a.arrived_at,a.seated_at,a.starts_at,a.duration_min,extract(epoch from (a.seated_at-a.arrived_at))/60 wait,extract(epoch from (a.seated_at-a.starts_at))/60 late from appointments a join users u on u.id=a.doctor_id where a.clinic_id=$1 and a.arrived_at is not null and a.seated_at is not null and a.seated_at>=a.arrived_at and a.starts_at>now()-interval '90 days'", [cid])).rows
  const w = r.map(x => Number(x.wait)), byDoc = {}, byHour = {}
  for (const x of r) { (byDoc[x.doctor] ||= []).push(Number(x.wait)); const h = Math.floor(localMin(new Date(x.arrived_at)) / 60); (byHour[h] ||= []).push(Number(x.wait)) }
  const docs = Object.entries(byDoc).map(([doctor, a]) => ({ doctor, n: a.length, avg: round(mean(a)), p90: round(quant(a, .9)) })).sort((a, b) => b.avg - a.avg)
  const hours = Object.entries(byHour).map(([h, a]) => ({ hour: +h, n: a.length, avg: round(mean(a)) })).sort((a, b) => a.hour - b.hour)
  // modèle théorique sur les 4 dernières semaines : arrivées par heure (λ), durée moyenne de soin (1/μ), c fauteuils
  const ap = (await q("select starts_at,duration_min from appointments where clinic_id=$1 and status in ('planned','confirmed','done') and starts_at between now()-interval '28 days' and now()", [cid])).rows
  const perHour = {}; for (const a of ap) { const d = new Date(a.starts_at), k = localDay(d) + ':' + Math.floor(localMin(d) / 60); perHour[k] = (perHour[k] || 0) + 1 }
  const peak = Math.max(0, ...Object.values(perHour)), avgSvc = mean(ap.map(a => a.duration_min)) || 30, model = peak ? erlangC(peak, 60 / avgSvc, cfg.chairs) : null
  return { samples: r.length, avg: round(mean(w)), median: round(quant(w, .5)), p90: round(quant(w, .9)), late: round(mean(r.map(x => Math.max(0, Number(x.late))))), docs, hours, bottleneck: docs[0]?.n >= 3 ? docs[0] : null,
    model: model && { peak_per_hour: peak, service_min: round(avgSvc), chairs: cfg.chairs, utilization: round(model.rho * 100), wait_min: isFinite(model.wq) ? round(model.wq * 60) : null, saturated: !isFinite(model.wq) }, confidence: confidence(r.length) } }

// 3. Risque d'absence : chaîne de Markov à 2 états (honoré / absent) estimée sur l'historique de la clinique,
//    affinée par l'historique du patient (estimation bayésienne Bêta) — une probabilité, jamais une certitude
async function noShow(cid) {
  const h = (await q("select patient_id,status,starts_at from appointments where clinic_id=$1 and status in ('done','no_show') and starts_at>now()-interval '730 days' order by patient_id,starts_at", [cid])).rows
  const t = { hh: 0, ha: 0, ah: 0, aa: 0 }, per = {}
  for (let i = 0; i < h.length; i++) { const x = h[i], s = x.status === 'no_show' ? 'a' : 'h'; const p = per[x.patient_id] ||= { n: 0, a: 0, last: null }
    if (p.last) t[p.last + s]++; p.n++; if (s === 'a') p.a++; p.last = s }
  const total = h.length, base = total ? h.filter(x => x.status === 'no_show').length / total : 0.1
  const pAfterH = (t.ha + 2 * base) / (t.hh + t.ha + 2), pAfterA = (t.aa + 2 * base) / (t.ah + t.aa + 2)   // transitions lissées vers le taux de base
  const up = (await q("select a.id,a.starts_at,a.reason,a.patient_id,p.last_name||' '||p.first_name patient,p.phone,u.first_name||' '||u.last_name doctor,a.status from appointments a join patients p on p.id=a.patient_id join users u on u.id=a.doctor_id where a.clinic_id=$1 and a.status in ('planned','confirmed') and a.starts_at between now() and now()+interval '14 days' order by a.starts_at", [cid])).rows
  const k = 4, risks = up.map(a => { const p = per[a.patient_id], prior = !p?.last ? base : p.last === 'a' ? pAfterA : pAfterH, alpha = prior * k + (p?.a || 0), beta = (1 - prior) * k + ((p?.n || 0) - (p?.a || 0))
    const prob = alpha / (alpha + beta), lead = (new Date(a.starts_at) - Date.now()) / 864e5
    return { id: a.id, starts_at: a.starts_at, patient_id: a.patient_id, patient: a.patient, phone: a.phone, doctor: a.doctor, reason: a.reason, confirmed: a.status === 'confirmed', risk: round(prob * (a.status === 'confirmed' ? .6 : 1) * 100), history: p ? { n: p.n, absences: p.a } : { n: 0, absences: 0 }, lead: round(lead) } }).sort((a, b) => b.risk - a.risk)
  return { base_rate: round(base * 100), markov: { after_honored: round(pAfterH * 100), after_absent: round(pAfterA * 100) }, samples: total, upcoming: risks.slice(0, 40), threshold: round(Math.min(50, Math.max(25, base * 130))), high: risks.filter(r => r.risk >= Math.min(50, Math.max(25, base * 130))).length, confidence: confidence(total) } }

// 4. Prévision de fréquentation (14 jours) par jour de semaine, intervalle à 95 %, surcharges selon la capacité
async function attendance(cid, cfg) {
  const r = (await q("select starts_at,duration_min from appointments where clinic_id=$1 and status in ('planned','confirmed','done','no_show') and starts_at between now()-interval '84 days' and now()", [cid])).rows
  const today = localDay(new Date()), days = {}; for (let i = 1; i <= 84; i++) { const d = addDays(today, -i); days[d] = 0 }
  for (const a of r) { const d = localDay(new Date(a.starts_at)); if (d in days) days[d]++ }
  const byWd = {}; for (const [d, n] of Object.entries(days)) { const wd = new Date(d + 'T12:00:00Z').getUTCDay(); if (cfg.days.includes(wd)) (byWd[wd] ||= []).push(n) }
  const fut = (await q("select starts_at,duration_min from appointments where clinic_id=$1 and status in ('planned','confirmed') and starts_at between now() and now()+interval '15 days'", [cid])).rows
  const booked = {}; for (const a of fut) { const d = localDay(new Date(a.starts_at)); (booked[d] ||= { n: 0, min: 0 }); booked[d].n++; booked[d].min += a.duration_min }
  const capOf = wd => { const h = cfg.hoursFor(wd); return h ? (h.close - h.open) * cfg.chairs : 0 }, cap = Math.max(...cfg.days.map(capOf), 1), out = []
  for (let i = 0; i < 14; i++) { const d = addDays(today, i), wd = new Date(d + 'T12:00:00Z').getUTCDay(); if (!cfg.days.includes(wd)) continue
    const hist = byWd[wd] || [], m = mean(hist), s = sd(hist), b = booked[d] || { n: 0, min: 0 }
    out.push({ day: d, weekday: wd, expected: round(m), low: round(Math.max(0, m - 1.96 * s)), high: round(m + 1.96 * s), booked: b.n, booked_min: b.min, load: round(b.min / (capOf(wd) || 1) * 100), overload: b.min > capOf(wd) * .85, confidence: confidence(hist.length) }) }
  return { history_days: Object.values(days).filter(n => n > 0).length, capacity_min: cap, days: out, confidence: confidence(r.length) } }

// 5. Stock : consommation réelle, jours avant rupture, point de commande (stock de sécurité à 95 %, délai 7 jours)
async function stock(cid) {
  const prods = (await q("select p.id,p.name,p.unit,p.min_stock::float8 min_stock,coalesce(sum(l.qty_remaining) filter (where l.expiry is null or l.expiry>=current_date),0)::float8 stock from products p left join product_lots l on l.product_id=p.id where p.clinic_id=$1 group by p.id order by p.name", [cid])).rows
  const cons = (await q("select product_id,(created_at at time zone 'America/Port-au-Prince')::date d,sum(-qty)::float8 q from stock_movements where clinic_id=$1 and type='consume' and created_at>now()-interval '90 days' group by 1,2", [cid])).rows
  const by = {}; for (const c of cons) (by[c.product_id] ||= {})[String(c.d).slice(0, 10)] = c.q
  const L = 7, z = 1.65, items = prods.map(p => { const series = Array.from({ length: 90 }, (_, i) => by[p.id]?.[addDays(localDay(new Date()), -i)] || 0), used = series.filter(x => x > 0).length
    const m = mean(series), s = sd(series), rop = m * L + z * s * Math.sqrt(L), daysLeft = m > 0 ? p.stock / m : null
    return { id: p.id, name: p.name, unit: p.unit, stock: p.stock, min_stock: p.min_stock, daily: round(m, 2), days_left: round(daysLeft), reorder_point: round(rop, 1), order_qty: m > 0 && p.stock <= rop ? Math.ceil(m * 30 + rop - p.stock) : 0, urgent: m > 0 && p.stock <= rop, confidence: confidence(used) } })
  return { items: items.sort((a, b) => (b.urgent - a.urgent) || ((a.days_left ?? 1e9) - (b.days_left ?? 1e9))), urgent: items.filter(i => i.urgent).length, lead_days: L } }

// 6. Ressources : occupation des médecins et des fauteuils, temps morts entre rendez-vous ; conflits de fauteuils
//    (graphe d'intervalles colorié par Welsh-Powell : nombre minimal de fauteuils nécessaires chaque jour)
async function resources(cid, cfg) {
  const r = (await q("select a.id,a.doctor_id,u.first_name||' '||u.last_name doctor,a.starts_at,a.duration_min,a.chair,a.patient_id from appointments a join users u on u.id=a.doctor_id where a.clinic_id=$1 and a.status in ('planned','confirmed','done') and a.starts_at between now()-interval '28 days' and now()+interval '14 days' order by a.starts_at", [cid])).rows
  const openOf = wd => { const h = cfg.hoursFor(wd); return h ? h.close - h.open : 0 }, now = Date.now(), byDoc = {}, byDay = {}
  for (const a of r) { const d = localDay(new Date(a.starts_at)), s = new Date(a.starts_at).getTime(); (byDay[d] ||= []).push({ ...a, s, e: s + a.duration_min * 6e4 })
    const k = byDoc[a.doctor] ||= { doctor: a.doctor, past: 0, next: 0, days: new Set() }; if (s < now) k.past += a.duration_min; else k.next += a.duration_min; k.days.add(d) }
  const minPast = Array.from({ length: 28 }, (_, i) => openOf(new Date(addDays(localDay(new Date()), -i - 1) + 'T12:00:00Z').getUTCDay())).reduce((a, b) => a + b, 0)
  const minNext = Array.from({ length: 14 }, (_, i) => openOf(new Date(addDays(localDay(new Date()), i) + 'T12:00:00Z').getUTCDay())).reduce((a, b) => a + b, 0)
  const doctors = Object.values(byDoc).map(k => ({ doctor: k.doctor, past_util: round(k.past / (minPast || 1) * 100), next_util: round(k.next / (minNext || 1) * 100) })).sort((a, b) => b.next_util - a.next_util)
  let idle = 0; const conflicts = [], chairPlan = []
  for (const [day, list] of Object.entries(byDay)) {
    for (const g of Object.values(list.reduce((m, a) => ((m[a.doctor_id] ||= []).push(a), m), {}))) { g.sort((a, b) => a.s - b.s); for (let i = 1; i < g.length; i++) { const gap = (g[i].s - g[i - 1].e) / 6e4; if (gap > 0 && gap <= 90) idle += gap; if (gap < 0) conflicts.push({ day, type: 'médecin', doctor: g[i].doctor, a: g[i - 1].id, b: g[i].id }) } }
    // Welsh-Powell : sommets = rendez-vous, arêtes = chevauchements ; on colorie par degré décroissant
    const deg = list.map(a => ({ a, d: list.filter(b => b !== a && b.s < a.e && a.s < b.e).length })).sort((x, y) => y.d - x.d), color = new Map()
    for (const { a } of deg) { const used = new Set(list.filter(b => color.has(b) && b.s < a.e && a.s < b.e).map(b => color.get(b))); let c = 0; while (used.has(c)) c++; color.set(a, c) }
    const need = color.size ? Math.max(...color.values()) + 1 : 0; if (day >= localDay(new Date())) chairPlan.push({ day, appointments: list.length, chairs_needed: need, over: need > cfg.chairs }) }
  return { doctors, idle_min_week: round(idle / 6, 0), conflicts, chairs: cfg.chairs, chair_days: chairPlan.sort((a, b) => a.day.localeCompare(b.day)), over_days: chairPlan.filter(c => c.over).length } }

// ═══ Recommandations (jamais imposées) ═══
function recommend(R, cfg) {
  const out = [], add = (level, area, title, text, href, conf) => out.push({ level, area, title, text, href, confidence: conf })
  const nd = R.noshow, at = R.attendance, st = R.stock, qu = R.queue, du = R.durations, rs = R.resources
  if (nd?.high) add('warn', 'Rendez-vous', `${nd.high} rendez-vous à risque d'absence`, `Appelez ces patients la veille : le risque estimé dépasse ${nd.threshold} % (taux habituel de la clinique : ${nd.base_rate} %).`, '#intelligence', nd.confidence)
  for (const d of (at?.days || []).filter(x => x.overload).slice(0, 3)) add('warn', 'Fréquentation', `Journée chargée le ${d.day.split('-').reverse().join('/')}`, `${d.booked} rendez-vous déjà prévus, ${d.load} % de la capacité des fauteuils : évitez d'en ajouter ou prévoyez un renfort.`, '#calendrier', d.confidence)
  if (st?.urgent) add('danger', 'Stock', `${st.urgent} produit(s) à commander maintenant`, st.items.filter(i => i.urgent).slice(0, 4).map(i => `${i.name} (${i.days_left ?? '?'} j restants)`).join(', ') + ' : le stock est sous le point de commande (délai de livraison 7 jours, sécurité 95 %).', '#stock', null)
  if (qu?.samples >= 5 && qu.avg > 15) add('warn', 'Salle d\'attente', `Attente moyenne de ${qu.avg} min`, `${qu.bottleneck ? `Goulot d'étranglement : ${qu.bottleneck.doctor} (${qu.bottleneck.avg} min en moyenne). ` : ''}Espacez davantage les rendez-vous aux heures de pointe.`, '#intelligence', qu.confidence)
  if (qu?.model?.saturated) add('danger', 'Ressources', 'Heure de pointe saturée', `${qu.model.peak_per_hour} patients par heure pour ${qu.model.chairs} médecin(s) et des soins de ${qu.model.service_min} min : la file d'attente ne peut que s'allonger à ce moment-là.`, '#intelligence', null)
  for (const b of (du?.byReason || []).filter(x => x.n >= 5 && x.overrun >= 10).slice(0, 2)) add('info', 'Durées', `« ${b.reason} » dure plus que prévu`, `Durée réelle médiane ${b.median} min contre ${b.planned} min prévues : réservez ${Math.ceil(b.p80 / 15) * 15} min pour éviter les retards en cascade.`, '#intelligence', b.confidence)
  if (rs?.over_days) add('danger', 'Ressources', `${rs.over_days} jour(s) avec plus de rendez-vous simultanés que de médecins`, `Le planning demande plus de ${cfg.chairs} médecin(s) en même temps : décalez certains rendez-vous.`, '#calendrier', null)
  if (rs?.conflicts?.length) add('danger', 'Rendez-vous', `${rs.conflicts.length} conflit(s) de planning`, 'Un médecin a deux rendez-vous qui se chevauchent : à corriger dans le calendrier.', '#calendrier', null)
  for (const d of (rs?.doctors || []).filter(x => x.next_util > 90).slice(0, 2)) add('info', 'Ressources', `${d.doctor} est complet à ${d.next_util} %`, 'Orientez les nouveaux patients vers un autre médecin si possible.', '#calendrier', null)
  if (!qu?.samples) add('info', 'Mesure', 'Commencez à enregistrer le parcours des patients', 'Cliquez « Arrivé », « Au fauteuil » puis « Terminé » sur les rendez-vous du jour : le moteur pourra mesurer l\'attente réelle et la durée réelle des soins.', '#tableau-de-bord', null)
  return out }

// ═══ Calcul complet (arrière-plan) ═══
const ANALYSES = { durations, queue, noshow: noShow, attendance, stock, resources }
let running = null
export function computeAll(cid) { if (running) return running; running = doCompute(cid).finally(() => { running = null }); return running }
async function doCompute(cid) {
  const cfg = await clinicCfg(cid), R = {}, timing = {}
  for (const [k, fn] of Object.entries(ANALYSES)) { const t0 = Date.now()
    try { R[k] = await fn(cid, cfg); timing[k] = Date.now() - t0; await q('insert into intel_results(clinic_id,kind,data,computed_at,ms) values($1,$2,$3,now(),$4) on conflict (clinic_id,kind) do update set data=$3,computed_at=now(),ms=$4', [cid, k, JSON.stringify(R[k]), timing[k]]) }
    catch (e) { timing[k] = -1; console.error(`Moteur d'intelligence (${k}) :`, e.message) }
    await pause() }
  const recs = recommend(R, cfg); await q('insert into intel_results(clinic_id,kind,data,computed_at,ms) values($1,$2,$3,now(),0) on conflict (clinic_id,kind) do update set data=$3,computed_at=now()', [cid, 'recommendations', JSON.stringify(recs)])
  // mesure du jour (comparaison avant / après) : attente, absences, occupation, temps morts, dépassements
  const day = localDay(new Date()), m = (await q(`select avg(extract(epoch from (seated_at-arrived_at))/60) avg_wait, percentile_cont(.9) within group (order by extract(epoch from (seated_at-arrived_at))/60) p90, count(*) filter (where seated_at is not null and arrived_at is not null) waits,
      avg(case when status='no_show' then 1.0 when status='done' then 0.0 end) ns, avg(extract(epoch from (finished_at-seated_at))/60 - duration_min) filter (where finished_at is not null and seated_at is not null) overrun
      from appointments where clinic_id=$1 and (starts_at at time zone '${TZ}')::date = $2::date`, [cid, day])).rows[0]
  const util = R.resources?.doctors?.length ? mean(R.resources.doctors.map(d => d.past_util || 0)) : null
  await q('insert into intel_metrics(clinic_id,day,avg_wait,p90_wait,waits,no_show_rate,utilization,idle_min,overrun) values($1,$2,$3,$4,$5,$6,$7,$8,$9) on conflict (clinic_id,day) do update set avg_wait=$3,p90_wait=$4,waits=$5,no_show_rate=$6,utilization=$7,idle_min=$8,overrun=$9',
    [cid, day, m.avg_wait, m.p90, m.waits, m.ns, util, R.resources?.idle_min_week ?? null, m.overrun])
  return { timing, recommendations: recs.length } }

// ═══ Créneaux conseillés (à la demande, calcul léger) ═══
// Contraintes : horaires et jours ouvrés, médecin libre, fauteuils disponibles. Score : remplit les trous du planning,
// équilibre la charge des journées, privilégie les dates proches ; durée conseillée d'après les durées réelles.
export async function suggestSlots(cid, { doctorId, minutes = 30, from, days = 14, reason } = {}) {
  const cfg = await clinicCfg(cid), dur = (await q("select data from intel_results where clinic_id=$1 and kind='durations'", [cid])).rows[0]?.data, sd_ = suggestDuration(dur, reason)
  const len = Math.max(5, Math.min(480, Number(minutes) || sd_?.minutes || 30)), start = from && /^\d{4}-\d{2}-\d{2}$/.test(from) ? from : localDay(new Date())
  const ap = (await q("select doctor_id,starts_at,duration_min from appointments where clinic_id=$1 and status in ('planned','confirmed') and starts_at between $2::date - interval '1 day' and $2::date + ($3 || ' days')::interval", [cid, start, String(days + 1)])).rows.map(a => ({ doc: a.doctor_id, s: new Date(a.starts_at).getTime(), e: new Date(a.starts_at).getTime() + a.duration_min * 6e4 }))
  const out = [], now = Date.now() + 30 * 6e4
  for (let i = 0; i < days && out.length < 400; i++) { const day = addDays(start, i), wd = new Date(day + 'T12:00:00Z').getUTCDay(), win = doctorWindows(cfg, doctorId, wd); if (!win.length) continue
    const h = cfg.hoursFor(wd), dayS = zoned(day, h.open).getTime(), dayE = zoned(day, h.close).getTime(), mine = ap.filter(a => a.doc === doctorId && a.s < dayE && a.e > dayS), load = mine.reduce((s, a) => s + (a.e - a.s), 0) / (dayE - dayS)
    for (const [w0, w1] of win) for (let m = Math.ceil(w0 / 15) * 15; m + len <= w1; m += 15) { const s = zoned(day, m).getTime(), e = s + len * 6e4; if (s < now) continue
      if (mine.some(a => a.s < e && s < a.e)) continue
      if (ap.filter(a => a.s < e && s < a.e).length >= cfg.chairs) continue                 // tous les médecins occupés
      const touch = mine.some(a => Math.abs(a.e - s) < 6e4 || Math.abs(e - a.s) < 6e4), gapBefore = Math.min(...mine.filter(a => a.e <= s).map(a => (s - a.e) / 6e4), 999)
      const score = (touch ? 30 : 0) + (gapBefore > 0 && gapBefore < 30 ? -10 : 0) + (1 - load) * 25 - i * 2 + (m >= h.open + 60 && m <= h.close - 120 ? 4 : 0)
      out.push({ starts_at: new Date(s).toISOString(), day, time: `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`, score: round(score), why: touch ? 'colle à un autre rendez-vous : aucun temps mort' : load < .3 ? 'journée peu chargée' : 'créneau libre' }) } }
  const best = []; for (const s of out.sort((a, b) => b.score - a.score)) { if (best.some(b => b.day === s.day && Math.abs(new Date(b.starts_at) - new Date(s.starts_at)) < 60 * 6e4)) continue; best.push(s); if (best.length >= 6) break }
  const DN = ['dim.', 'lun.', 'mar.', 'mer.', 'jeu.', 'ven.', 'sam.'], service = [1, 2, 3, 4, 5, 6, 0].map(w => { const ws = doctorWindows(cfg, doctorId, w); return ws.length ? `${DN[w]} ${ws.map(([a, b]) => fmtHm(a) + '–' + fmtHm(b)).join(', ')}` : null }).filter(Boolean)
  return { minutes: len, suggested_duration: sd_, slots: best.sort((a, b) => a.starts_at.localeCompare(b.starts_at)), service, has_schedule: !!cfg.schedules[doctorId] } }

// ═══ Exécution périodique en arrière-plan ═══
export function startIntel() {
  const tick = async () => { try { for (const c of (await q('select id from clinics where intel_enabled')).rows) await computeAll(c.id) } catch (e) { console.error('Moteur d\'intelligence :', e.message) } }
  setTimeout(tick, 90e3); return setInterval(tick, 30 * 60e3) }
