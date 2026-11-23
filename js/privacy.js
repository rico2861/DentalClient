// ═══ Mode discrétion : masque les informations sensibles partout (montants, et en option téléphones / e-mails) ═══
// Ce n'est pas qu'un flou visuel : quand le mode est actif, les valeurs réelles sont RETIRÉES du DOM et remplacées par
// des chiffres factices floutés (« 88 888 HTG ») ; l'inspection du code de la page ne révèle rien. Les vraies valeurs
// sont gardées uniquement en mémoire JavaScript pour pouvoir les réafficher à la désactivation.
const KEY = 'dl_discretion'
// actif automatiquement à chaque ouverture de l'application : il faut un geste volontaire pour afficher les montants
let state = { on: true, contacts: false }
try { const saved = JSON.parse(localStorage.getItem(KEY) || '{}'); state.contacts = !!saved.contacts } catch {}
const save = () => { try { localStorage.setItem(KEY, JSON.stringify({ contacts: state.contacts })) } catch {} }
const orig = new WeakMap()        // <span class="pvm"> → texte réel
const origAttr = new WeakMap()    // élément → { attribut: valeur réelle }
const N = '[\\d]{1,3}(?:[\\s\\u202f\\u00a0.]\\d{3})*(?:,\\d{1,2})?'
const MONEY = new RegExp(`[−+-]?\\s?${N}\\s?(?:HTG|\\$\\s?US|USD|\\$|gdes?)|\\$\\s?\\d[\\d\\s\\u202f.,]*|\\d{1,3}(?:[\\s\\u202f\\u00a0]\\d{3})*,\\d{2}(?!\\d)`, 'g')
const CONTACT = /\+?\d[\d\s().-]{6,}\d|[\w.+-]+@[\w-]+\.[\w.-]+/g
const NUM_ONLY = /^\s*[−+-]?\s?\d[\d\s  .,]*\s*$/
const SENS_ATTR = ['title', 'data-tip', 'aria-label']
const SENS_DATA = ['p', 'r', 'rest', 'paid', 'base', 'v', 'auto', 'price', 'amount', 'usd', 'total']
const fake = s => s.replace(/\d/g, '8')
const skip = el => !el || el.closest('input,textarea,select,option,script,style,[data-nopv],.pvm,.pvbanner,.auth,.tmpw,.pwm,.otphelp')
const rx = () => state.contacts ? new RegExp(MONEY.source + '|' + CONTACT.source, 'g') : new RegExp(MONEY.source, 'g')
const curNear = el => /HTG|\$|USD|gdes?/.test(el?.textContent || '') && (el.textContent.length < 60)
function maskText(t) {
  const p = t.parentElement; if (skip(p)) return; const s = t.nodeValue; if (!s || !/\d|@/.test(s)) return
  // valeur numérique seule à côté d'une devise (ex. <b>12 500</b><small>HTG</small>) ou étiquette d'axe de graphique
  const svg = p.closest('svg.pvchart')
  if ((NUM_ONLY.test(s) && (curNear(p) || curNear(p.parentElement))) || (svg && /^\s*-?\d+(?:[.,]\d+)?[kM]?\s*$/.test(s))) { const sp = mk(s); t.replaceWith(sp); return }
  const re = rx(); if (!re.test(s)) return; re.lastIndex = 0
  const frag = document.createDocumentFragment(); let last = 0, m
  while ((m = re.exec(s))) { if (!m[0].trim()) { re.lastIndex++; continue } frag.append(s.slice(last, m.index), mk(m[0])); last = m.index + m[0].length }
  frag.append(s.slice(last)); t.replaceWith(frag) }
const EYE = '<svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M17.9 17.9A10.4 10.4 0 0 1 12 19c-7 0-11-7-11-7a19.6 19.6 0 0 1 5.1-5.9M9.9 5.2A10 10 0 0 1 12 5c7 0 11 7 11 7a19.4 19.4 0 0 1-2.2 3.2M1 1l22 22"/></svg>'
function mk(real) { const sp = document.createElement('span'); sp.className = 'pvm'; sp.title = 'Masqué (mode discrétion) · Alt+M pour afficher'; sp.setAttribute('aria-label', 'valeur masquée'); sp.innerHTML = EYE + '<span class="pvt"></span>'; sp.lastChild.textContent = fake(real); orig.set(sp, real); return sp }
function maskAttrs(el) { if (skip(el.parentElement) && !el.closest('svg')) return; const keep = origAttr.get(el) || {}; let ch = false
  for (const a of SENS_ATTR) { const v = el.getAttribute?.(a); if (v && !(a in keep) && (rx().test(v) || (el.closest('svg.pvchart') && /\d/.test(v)))) { keep[a] = v; el.setAttribute(a, v.replace(rx(), fake).replace(/\d/g, '8')); ch = true } }
  for (const k of SENS_DATA) { const a = 'data-' + k, v = el.getAttribute?.(a); if (v && !(a in keep) && /^[\d\s.,-]+$/.test(v)) { keep[a] = v; el.setAttribute(a, '•'); ch = true } }
  if (ch) origAttr.set(el, keep) }
function scan(root) { if (!state.on || !root) return
  if (root.nodeType === 3) return maskText(root)
  if (root.nodeType !== 1) return
  if (!skip(root)) maskAttrs(root)
  const els = root.querySelectorAll('[title],[data-tip],[aria-label],' + SENS_DATA.map(k => `[data-${k}]`).join(',')); els.forEach(maskAttrs)
  // champs pré-remplis (montants à saisir) : la valeur reste utilisable mais disparaît du code HTML, et le champ est flouté jusqu'au clic
  root.querySelectorAll?.('input[value]').forEach(i => { const v = i.getAttribute('value'); if (!v || ['hidden', 'date', 'time', 'month', 'checkbox', 'radio'].includes(i.type) || !/^[\d\s\u202f.,-]+$/.test(v) || !/\d{3}/.test(v.replace(/\D/g, ''))) return; const cur = i.value; i.removeAttribute('value'); i.value = cur; i.classList.add('pv-in') })
  const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT), list = []; while (w.nextNode()) list.push(w.currentNode); list.forEach(maskText) }
function restoreAttrs(el) { const k = origAttr.get(el); if (!k) return; for (const [a, v] of Object.entries(k)) el.setAttribute(a, v); origAttr.delete(el) }
function restore() { document.querySelectorAll('.pvm').forEach(sp => { const r = orig.get(sp); sp.replaceWith(document.createTextNode(r ?? sp.textContent)) })
  document.querySelectorAll('*').forEach(restoreAttrs); document.body.normalize() }
// les gestionnaires de clic lisent des montants dans data-* : on les remet le temps de l'action, puis on remasque
const unmaskPath = e => { if (!state.on) return; let n = e.target; const back = []; while (n && n.nodeType === 1) { if (origAttr.has(n)) { back.push(n); restoreAttrs(n) } n = n.parentElement } if (back.length) setTimeout(() => back.forEach(el => el.isConnected && maskAttrs(el)), 1500) }
addEventListener('pointerdown', unmaskPath, true); addEventListener('click', unmaskPath, true); addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') unmaskPath(e) }, true)
let busy = false
new MutationObserver(ms => { if (!state.on || busy) return; busy = true; try { for (const m of ms) { if (m.type === 'characterData') maskText(m.target); else m.addedNodes.forEach(scan) } } finally { busy = false } })
  .observe(document.documentElement, { childList: true, subtree: true, characterData: true })
let banner = null
const showBanner = () => {}   // bandeau retiré : le bouton de la barre du haut indique l'état
const showBannerOld = on => { if (on && !banner) { banner = document.createElement('div'); banner.className = 'pvbanner'; banner.setAttribute('role', 'status'); banner.innerHTML = EYE.replace(/width="11" height="11"/, 'width="16" height="16"') + '<span><b>Mode discrétion actif</b> · montants masqués à l\'écran</span><button type="button">Afficher</button>'; banner.querySelector('button').onclick = () => { privacy.set(false); document.dispatchEvent(new CustomEvent('privacy-ui')) }; document.body.appendChild(banner) }
  else if (!on && banner) { banner.remove(); banner = null } }
export const privacy = {
  get on() { return state.on }, get contacts() { return state.contacts },
  set(on) { state.on = !!on; save(); document.documentElement.classList.toggle('pv-on', state.on); showBanner(state.on); if (state.on) scan(document.body); else restore(); document.dispatchEvent(new CustomEvent('privacy', { detail: state })) },
  toggle() { this.set(!state.on) },
  setContacts(v) { const was = state.on; if (was) restore(); state.contacts = !!v; save(); if (was) scan(document.body) },
  init() { document.documentElement.classList.toggle('pv-on', state.on); showBanner(state.on); if (state.on) scan(document.body) } }
window.__privacy = privacy
