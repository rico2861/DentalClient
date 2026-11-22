// ═══ Composants de chargement — « chaque situation a son propre type de chargement » ═══
// Bibliothèque sans dépendance (modules ES + CSS) : animations en CSS, prefers-reduced-motion respecté,
// rôles et attributs ARIA (status, aria-live, aria-busy, progressbar).
//  1. spinner()          chargement court et générique (zone d'une fenêtre, petite liste)
//  2. skeleton()         contenu dont on connaît la forme (pages, listes, cartes)
//  3. progressBar()      progression mesurable (téléversement de documents et radiographies)
//  4. buttonLoading()    action ponctuelle : bouton désactivé, même largeur, spinner + texte
//  5. fullScreen()       action bloquante : voile plein écran, focus piégé, interactions bloquées
//  6. pullToRefresh()    tirer vers le bas en haut d'une page tactile pour actualiser
//  7. infiniteScroll()   chargement de la page suivante quand on arrive en bas (IntersectionObserver)
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))

// ── 1. Spinner : arc bleu qui tourne sur une piste ──
/** @param {{ size?: 'xs'|'sm'|'md'|'lg', label?: string, light?: boolean, center?: boolean }} o */
export const spinner = ({ size = 'md', label = 'Chargement…', light = false, center = false } = {}) =>
  `<span class="ld-sp ld-${size} ${light ? 'ld-light' : ''} ${center ? 'ld-center' : ''}" role="status" aria-live="polite"><i aria-hidden="true"></i><span class="ld-sr">${esc(label)}</span></span>`
/** Spinner centré avec texte, pour remplir une zone */
export const spinnerBlock = (text = 'Chargement…') => `<div class="ld-block" role="status" aria-live="polite" aria-busy="true">${spinner({ size: 'md', label: text })}<span>${esc(text)}</span></div>`

// ── 2. Skeleton : formes grises avec reflet qui défile ──
const bone = (w = '100%', h = 12, r = 6, extra = '') => `<i class="ld-bone" style="width:${w};height:${typeof h === 'number' ? h + 'px' : h};border-radius:${typeof r === 'number' ? r + 'px' : r}${extra}"></i>`
const WIDTHS = ['92%', '76%', '84%', '61%', '70%', '88%']
/** @param {{ variant?: 'text'|'avatar'|'list'|'card'|'table'|'kpis'|'page', lines?: number, rows?: number }} o */
export function skeleton({ variant = 'text', lines = 3, rows = 5 } = {}) {
  const wrap = inner => `<div class="ld-sk" role="status" aria-live="polite" aria-busy="true"><span class="ld-sr">Chargement du contenu…</span>${inner}</div>`
  const text = n => `<div class="ld-sk-text">${Array.from({ length: n }, (_, i) => bone(WIDTHS[i % WIDTHS.length], 11)).join('')}</div>`
  const item = () => `<div class="ld-sk-item">${bone('40px', 40, '50%')}<div class="ld-sk-text">${bone('46%', 12)}${bone('72%', 10)}</div>${bone('64px', 26, 8)}</div>`
  const card = () => `<div class="ld-sk-card"><div class="ld-sk-row">${bone('34px', 34, 10)}${bone('40%', 14)}</div>${text(lines)}</div>`
  const kpis = () => `<div class="ld-sk-kpis">${Array.from({ length: 4 }, () => `<div class="ld-sk-kpi">${bone('46%', 10)}${bone('58%', 26, 8)}${bone('70%', 10)}</div>`).join('')}</div>`
  const table = () => `<div class="ld-sk-card">${bone('30%', 16)}<div class="ld-sk-table">${Array.from({ length: rows }, () => `<div class="ld-sk-tr">${bone('28px', 28, '50%')}${bone('26%', 12)}${bone('18%', 12)}${bone('14%', 12)}${bone('12%', 22, 99)}</div>`).join('')}</div></div>`
  const V = { text: () => text(lines), avatar: () => bone('44px', 44, '50%'), list: () => `<div class="ld-sk-list">${Array.from({ length: rows }, item).join('')}</div>`, card, kpis, table,
    page: () => `<div class="ld-sk-head">${bone('260px', 26, 8)}${bone('380px', 12)}</div>${kpis()}<div class="ld-sk-grid">${table()}${card()}</div>` }
  return wrap((V[variant] || V.text)()) }
// forme du squelette selon la page qui se charge (même silhouette que la page réelle : pas de saut visuel)
export const pageSkeleton = key => ({ dashboard: 'page', intel: 'page', myact: 'page' })[key] ? skeleton({ variant: 'page' })
  : ['patients', 'record', 'audit', 'users', 'debts', 'billing', 'appts'].includes(key) ? `<div class="ld-sk-head">${bone('220px', 26, 8)}${bone('320px', 12)}</div>` + skeleton({ variant: 'table', rows: 7 })
  : `<div class="ld-sk-head">${bone('240px', 26, 8)}${bone('340px', 12)}</div>` + skeleton({ variant: 'kpis' }) + skeleton({ variant: 'table', rows: 5 })

// ── 3. Barre de progression : libellé, pourcentage, remplissage animé ──
export const progressBar = ({ value = 0, label = 'Téléversement…', showPercentage = true, id = '' } = {}) => { const v = Math.max(0, Math.min(100, Math.round(value)))
  return `<div class="ld-pb" ${id ? `id="${id}"` : ''} role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${v}" aria-label="${esc(label)}"><div class="ld-pbh"><span data-pbl>${esc(label)}</span>${showPercentage ? `<b data-pbv>${v} %</b>` : ''}</div><div class="ld-pbt"><i data-pbf style="width:${v}%"></i></div></div>` }
export const setProgress = (el, value, label) => { if (!el) return; const v = Math.max(0, Math.min(100, Math.round(value))); el.setAttribute('aria-valuenow', v); el.querySelector('[data-pbf]').style.width = v + '%'; const b = el.querySelector('[data-pbv]'); if (b) b.textContent = v + ' %'; if (label) el.querySelector('[data-pbl]').textContent = label }
/** Téléversement avec progression réelle (XMLHttpRequest expose la progression de l'envoi, fetch non) */
export const uploadWithProgress = (url, body, headers = {}, onProgress = () => {}) => new Promise((resolve, reject) => {
  const x = new XMLHttpRequest(); x.open('POST', url); x.withCredentials = true; for (const [k, v] of Object.entries(headers)) x.setRequestHeader(k, v)
  x.upload.onprogress = e => { if (e.lengthComputable) onProgress(e.loaded / e.total * 100) }
  x.onload = () => { let j = {}; try { j = JSON.parse(x.responseText) } catch {} x.status >= 200 && x.status < 300 ? resolve(j) : reject(new Error(j.error || 'Échec du téléversement')) }
  x.onerror = () => reject(new Error('Connexion au serveur interrompue')); x.send(body) })

// ── 4. Bouton en chargement : désactivé, largeur figée, spinner blanc + texte ──
/** Passe un bouton en état de chargement ; renvoie une fonction qui le restaure. */
export function buttonLoading(btn, loadingText) {
  if (!btn || btn.dataset.ldOn) return () => {}
  const w = btn.getBoundingClientRect().width, html = btn.innerHTML, txt = loadingText || (/supprim|annul/i.test(btn.textContent) ? 'Traitement…' : /envoi|téléver/i.test(btn.textContent) ? 'Envoi…' : 'Enregistrement…')
  btn.dataset.ldOn = '1'; btn.style.minWidth = w + 'px'; btn.disabled = true; btn.setAttribute('aria-busy', 'true'); btn.classList.add('ld-btn')
  btn.innerHTML = `${spinner({ size: 'xs', light: !btn.classList.contains('sec') && !btn.classList.contains('bs') || btn.classList.contains('pri'), label: txt })}<span>${esc(txt)}</span>`
  return () => { if (!btn.isConnected) return; btn.innerHTML = html; btn.disabled = false; btn.style.minWidth = ''; btn.removeAttribute('aria-busy'); btn.classList.remove('ld-btn'); delete btn.dataset.ldOn } }
/** Exécute une action en affichant le bouton en chargement si elle dure plus de 150 ms (évite le clignotement). */
export async function withButton(btn, fn, loadingText) { let restore = () => {}; const t = setTimeout(() => { restore = buttonLoading(btn, loadingText) }, 150)
  try { return await fn() } finally { clearTimeout(t); restore() } }

// ── 5. Plein écran : voile sombre, spinner centré, focus piégé, interactions bloquées ──
let fsEl = null, fsPrev = null
export function fullScreen(isVisible, message = 'Veuillez patienter…') {
  if (isVisible) { if (!fsEl) { fsEl = document.createElement('div'); fsEl.className = 'ld-fs'; fsEl.setAttribute('role', 'status'); fsEl.setAttribute('aria-live', 'assertive'); fsEl.setAttribute('aria-busy', 'true'); fsEl.tabIndex = -1
      fsEl.addEventListener('keydown', e => { if (e.key === 'Tab' || e.key === 'Escape') e.preventDefault() }); document.body.appendChild(fsEl) }
    fsPrev = fsPrev || document.activeElement; fsEl.innerHTML = `<div class="ld-fsb">${spinner({ size: 'lg', light: true, label: message })}<b>${esc(message)}</b><small>Ne fermez pas la page.</small></div>`
    document.body.setAttribute('aria-busy', 'true'); document.getElementById('app')?.setAttribute('inert', ''); requestAnimationFrame(() => { fsEl?.classList.add('on'); fsEl?.focus() }) }
  else if (fsEl) { const el = fsEl; fsEl = null; el.classList.remove('on'); document.body.removeAttribute('aria-busy'); document.getElementById('app')?.removeAttribute('inert'); setTimeout(() => el.remove(), 200); fsPrev?.focus?.(); fsPrev = null } }
/** Bloque l'écran pendant une action longue, puis le libère (même en cas d'erreur). */
export async function blocking(message, fn) { fullScreen(true, message); try { return await fn() } finally { fullScreen(false) } }

// ── 6. Tirer pour actualiser (écrans tactiles) ──
/** @param {HTMLElement} scroller zone qui défile  @param {() => Promise<any>} onRefresh  @param {number} threshold distance (px) */
export function pullToRefresh(scroller, onRefresh, threshold = 70) {
  if (!scroller || scroller.dataset.ptr || !('ontouchstart' in window)) return; scroller.dataset.ptr = '1'
  const ind = document.createElement('div'); ind.className = 'ld-ptr'; ind.setAttribute('aria-hidden', 'true'); ind.innerHTML = `<span class="ld-ptra">↓</span>${spinner({ size: 'sm', label: 'Actualisation…' })}`; scroller.before(ind)
  let y0 = null, d = 0, busy = false
  scroller.addEventListener('touchstart', e => { if (busy || scroller.scrollTop > 0 || (document.scrollingElement?.scrollTop || 0) > 0 || e.target.closest('.mo,.ov,input,textarea,select')) { y0 = null; return } y0 = e.touches[0].clientY; d = 0 }, { passive: true })
  scroller.addEventListener('touchmove', e => { if (y0 == null) return; d = Math.max(0, e.touches[0].clientY - y0); if (!d) return; const p = Math.min(d / 2, threshold * 1.4)
    ind.style.height = p + 'px'; ind.classList.toggle('ready', d / 2 >= threshold); ind.querySelector('.ld-ptra').style.transform = `rotate(${Math.min(180, d / 2 / threshold * 180)}deg)` }, { passive: true })
  scroller.addEventListener('touchend', async () => { if (y0 == null) return; y0 = null; const go = d / 2 >= threshold; d = 0
    if (!go) { ind.style.height = '0px'; return } busy = true; ind.classList.add('busy'); ind.style.height = '52px'; ind.setAttribute('aria-hidden', 'false')
    try { await onRefresh() } catch {} finally { busy = false; ind.classList.remove('busy', 'ready'); ind.classList.add('bounce'); ind.style.height = '0px'; ind.setAttribute('aria-hidden', 'true'); setTimeout(() => ind.classList.remove('bounce'), 400) } }) }

// ── 7. Défilement infini : sentinelle en bas de liste ──
/** @param {HTMLElement} list conteneur des éléments  @param {{ loadMore: () => Promise<{ html: string, hasMore: boolean }>, hasMore: boolean, skeletonRows?: number, endText?: string }} o */
export function infiniteScroll(list, { loadMore, hasMore = true, skeletonRows = 3, endText = 'Vous avez tout vu.' }) {
  const foot = document.createElement('div'); foot.className = 'ld-inf'; foot.setAttribute('aria-live', 'polite'); list.after(foot)
  let more = hasMore, loading = false
  const end = () => { foot.innerHTML = `<span class="ld-end">${esc(endText)}</span>`; io.disconnect() }
  const io = new IntersectionObserver(async ([e]) => { if (!e.isIntersecting || loading || !more) return; loading = true; list.setAttribute('aria-busy', 'true')
    foot.innerHTML = skeleton({ variant: 'list', rows: skeletonRows })
    try { const r = await loadMore(); list.insertAdjacentHTML('beforeend', r.html); more = r.hasMore; foot.innerHTML = ''; if (!more) end() }
    catch (x) { foot.innerHTML = `<button type="button" class="sec bs ld-retry">Réessayer</button><span class="muted">${esc(x.message)}</span>`; foot.querySelector('.ld-retry').onclick = () => { foot.innerHTML = ''; io.unobserve(foot); io.observe(foot) } }
    finally { loading = false; list.removeAttribute('aria-busy') } }, { rootMargin: '200px' })
  if (more) io.observe(foot); else end(); return { destroy: () => { io.disconnect(); foot.remove() } } }
