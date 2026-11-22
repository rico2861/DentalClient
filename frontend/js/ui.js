// Fenêtres modales modernes : remplacent confirm(), prompt() et alert() du navigateur.
import { ic } from './icons.js'
import { buttonLoading } from './loaders.js'
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
const collect = md => { const o = {}; md.querySelectorAll('[name]').forEach(e => {
  if (e.type === 'radio') { if (e.checked) o[e.name] = e.value }
  else if (e.type === 'checkbox') { if (e.value && e.value !== 'on') { if (e.checked) o[e.name] = o[e.name] ? o[e.name] + ', ' + e.value : e.value } else o[e.name] = e.checked }
  else o[e.name] = e.value }); return o }
const top = () => [...document.querySelectorAll('.mo:not(.out)')].pop()
// buttons : [{ label, cls, value } | { label, cls, collect: true, submit?: async values => … }]
// Fermeture : croix, Échap ou clic à l'extérieur. Si l'utilisateur a commencé à remplir, on lui demande confirmation.
function dialog({ title, sub = '', icon = 'info', tone = 'info', html = '', buttons = [], wide = false, size = '', onOpen }) {
  return new Promise(resolve => {
    const ov = document.createElement('div'); ov.className = 'mo'
    ov.innerHTML = `<div class="md${wide ? ' wide' : ''}${size ? ' ' + size : ''}" role="dialog" aria-modal="true" aria-label="${esc(title)}"><div class="mh">${icon ? `<span class="mi ${tone}">${ic(icon, 22)}</span>` : ''}<div class="mt"><h3>${esc(title)}</h3>${sub ? `<p>${sub}</p>` : ''}</div><button type="button" class="mx" aria-label="Fermer">${ic('x', 18)}</button></div><div class="mbd">${html}</div><div class="merr" role="alert" hidden></div><div class="mf"></div></div>`
    document.body.appendChild(ov); document.body.classList.add('mopen')
    const md = ov.firstChild, foot = md.querySelector('.mf'), err = md.querySelector('.merr')
    let dirty = false, done = false, asking = false
    md.addEventListener('input', e => { if (e.target.matches('[name], [data-k]')) dirty = true })
    md.addEventListener('change', e => { if (e.target.matches('[name], [data-k]')) dirty = true })
    const close = v => { if (done) return; done = true; document.removeEventListener('keydown', key); ov.classList.add('out'); setTimeout(() => { ov.remove(); if (!document.querySelector('.mo')) document.body.classList.remove('mopen') }, 140); resolve(v) }
    const tryClose = async () => {
      if (asking) return
      if (!dirty) return close(null)
      asking = true
      const leave = await window.ui.confirm('Les informations saisies seront perdues.', { title: 'Quitter sans enregistrer ?', ok: 'Quitter', cancel: 'Continuer la saisie', danger: true })
      asking = false; if (leave) close(null)
    }
    const key = e => { if (top() !== ov) return
      if (e.key === 'Escape') { e.preventDefault(); tryClose() }
      else if (e.key === 'Enter' && e.target.tagName === 'INPUT' && !['checkbox', 'radio'].includes(e.target.type)) { e.preventDefault(); foot.querySelector('.pri')?.click() } }
    document.addEventListener('keydown', key)
    md.querySelector('.mx').onclick = tryClose
    // clic dans le vide : seulement si le clic commence ET se termine à l'extérieur (pas en sélectionnant du texte)
    let downOut = false
    ov.addEventListener('mousedown', e => { downOut = e.target === ov })
    ov.addEventListener('click', e => { if (downOut && e.target === ov) tryClose(); downOut = false })
    buttons.forEach(b => { const el = document.createElement('button'); el.type = 'button'; el.className = b.cls || ''; el.innerHTML = b.label
      el.onclick = async () => { if (!b.collect) return b.value === null && dirty ? tryClose() : close(b.value)
        const bad = md.querySelector('input:invalid, select:invalid, textarea:invalid'); if (bad) { bad.reportValidity(); bad.focus(); return }
        const v = collect(md); if (b.submit) { err.hidden = true; const restore = buttonLoading(el); try { await b.submit(v) } catch (x) { restore(); err.textContent = x.message || 'Erreur'; err.hidden = false; return } } close(v) }
      foot.appendChild(el) })
    setTimeout(() => (md.querySelector('.mbd input:not([type=radio]):not([type=checkbox]),.mbd textarea,.mbd select') || foot.querySelector('.pri'))?.focus(), 30); onOpen?.(md) }) }
const DANGER = /annul|bloqu|archiv|supprim|désactiv|refus|réinitialis/i
window.ui = { dialog,
  confirm: (msg, o = {}) => { const danger = o.danger ?? DANGER.test(msg); return dialog({ title: o.title || 'Confirmation', icon: danger ? 'alert' : 'help', tone: danger ? 'danger' : 'info', size: 'sm', html: `<p>${esc(msg)}</p>`, buttons: [{ label: o.cancel || 'Annuler', cls: 'sec', value: false }, { label: o.ok || 'Confirmer', cls: 'pri' + (danger ? ' danger' : ''), value: true }] }).then(v => !!v) },
  alert: (msg, o = {}) => dialog({ title: o.title || 'Information', icon: 'info', html: `<p class="pre">${esc(msg)}</p>`, buttons: [{ label: 'Fermer', cls: 'pri', value: true }] }),
  prompt: (msg, def = '', o = {}) => dialog({ title: o.title || 'Saisie requise', icon: 'edit', size: 'sm', html: `<label class="ml">${esc(msg)}<input name="v" value="${esc(def)}" autocomplete="off"></label>`, buttons: [{ label: 'Annuler', cls: 'sec', value: null }, { label: 'Valider', cls: 'pri', collect: true }] }).then(v => v ? v.v : null) }
