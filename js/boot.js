// ═══════════════════════════════════════════════════════════════════════════
//  DENTAL — Pré-démarrage (porte de licence + connexion OTP + personnalisation)
//
//  S'exécute AVANT l'app de gestion. Il :
//   1. applique la personnalisation de la clinique (couleur, nom) ;
//   2. vérifie la licence ;
//   3. charge l'app (app.js) seulement si la licence est valable ;
//      sinon il affiche l'écran d'activation : clé de licence → code reçu par
//      e-mail (OTP, 10 min) → accès. app.js n'est pas modifié.
// ═══════════════════════════════════════════════════════════════════════════

const $app = document.getElementById('app')
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))

function applyBrand(brand = {}) {
  if (brand.color && /^#[0-9a-fA-F]{6}$/.test(brand.color)) document.documentElement.style.setProperty('--b', brand.color)
  document.title = brand.name ? brand.name + ' — Dental Assist' : 'Dental Assist'
}

async function licenseStatus() {
  const r = await fetch('/api/license/status', { headers: { 'Cache-Control': 'no-cache' } })
  if (!r.ok) throw new Error('Statut de licence indisponible')
  return r.json()
}

async function loadApp(grace) {
  if (grace && grace.grace_days_left != null) banner(`Abonnement expiré — il vous reste ${grace.grace_days_left} jour(s) pour renouveler avant blocage.`)
  await import('./app.js')
}

function banner(text) {
  const b = document.createElement('div')
  b.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:9998;background:var(--warn,#e98a15);color:#fff;padding:9px 16px;font:600 13.5px system-ui;text-align:center'
  b.textContent = text
  const x = document.createElement('button'); x.textContent = '✕'; x.style.cssText = 'margin-left:14px;background:transparent;border:0;color:#fff;cursor:pointer;font-size:14px'
  x.onclick = () => b.remove(); b.appendChild(x)
  document.body.appendChild(b)
}

const shell = (title, msg, inner, fp) => `
  <div style="min-height:100vh;display:grid;place-items:center;background:var(--bg,#f5f7fa);padding:20px;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif">
    <div style="width:100%;max-width:440px;background:#fff;border:1px solid var(--bd,#e3e8ef);border-radius:16px;padding:30px 28px;box-shadow:0 10px 40px rgba(16,40,80,.08)">
      <div style="width:46px;height:46px;border-radius:12px;background:var(--b,#12408f);display:grid;place-items:center;color:#fff;font-weight:800;font-size:19px;margin-bottom:16px">D</div>
      <h1 style="font-size:20px;margin:0 0 6px;color:var(--tx,#1b2430)">${esc(title)}</h1>
      <p style="margin:0 0 20px;color:#5b6675;font-size:14px;line-height:1.5">${msg}</p>
      <div id="lic-err" style="display:none;background:#fdecec;color:#b42318;border-radius:9px;padding:10px 12px;font-size:13px;margin-bottom:14px"></div>
      ${inner}
      ${fp ? `<p style="margin:18px 0 0;color:#99a3b2;font-size:11.5px;text-align:center">Poste n° <code>${esc(fp)}</code></p>` : ''}
    </div>
  </div>`

const inputCss = 'width:100%;box-sizing:border-box;padding:11px 12px;border:1px solid var(--bd,#e3e8ef);border-radius:9px;font-size:14px;margin-bottom:12px'
const btnPri = 'width:100%;padding:12px;background:var(--b,#12408f);color:#fff;border:0;border-radius:9px;font-weight:700;font-size:14.5px;cursor:pointer'
const btnSec = 'width:100%;padding:12px;background:#fff;color:var(--b,#12408f);border:1.5px solid var(--b,#12408f);border-radius:9px;font-weight:700;font-size:14.5px;cursor:pointer'

function setErr(m) { const e = document.getElementById('lic-err'); if (e) { e.innerHTML = m; e.style.display = m ? 'block' : 'none' } }
const busy = (btn, on) => { if (btn) { btn.disabled = on; btn.style.opacity = on ? '.6' : '1' } }
async function post(url, body) {
  const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  const j = await r.json().catch(() => ({})); if (!r.ok) throw Object.assign(new Error(j.error || 'Opération refusée'), { code: j.code }); return j
}

// ─── Écran d'activation (licence → OTP) ──────────────────────────────────────
function activationScreen(s) {
  const fp = (s.fingerprint || '').slice(0, 12)
  $app.innerHTML = shell('Activer DENTAL',
    'Entrez votre <b>clé de licence</b>. Nous enverrons un code de connexion à l’e-mail de votre inscription.',
    `<label style="display:block;font-size:12.5px;font-weight:600;color:#44505f;margin-bottom:6px">Clé de licence</label>
     <input id="lic-key" placeholder="DNTL-XXXXX-XXXXX-XXXXX-XXXXX" autocomplete="off" style="${inputCss};font-family:ui-monospace,monospace;letter-spacing:1px">
     <button id="lic-send" style="${btnPri}">Recevoir mon code</button>
     <div style="text-align:center;color:#99a3b2;font-size:12px;margin:16px 0">— ou activer avec un fichier —</div>
     <textarea id="lic-file-key" rows="2" placeholder="Collez le contenu de licence.key (DL1.…)" style="${inputCss};font-size:12px;font-family:ui-monospace,monospace;resize:vertical"></textarea>
     <input type="file" id="lic-file" accept=".key,.txt,text/plain" style="font-size:12.5px;margin-bottom:12px">
     <button id="lic-install" style="${btnSec}">Installer la clé (hors ligne)</button>`, fp)

  document.getElementById('lic-send').addEventListener('click', async e => {
    const key = document.getElementById('lic-key').value.trim()
    if (!key) return setErr('Entrez votre clé de licence.')
    setErr(''); busy(e.target, true)
    try { const j = await post('/api/license/request-otp', { key }); otpScreen(key, j.email) }
    catch (ex) { setErr(ex.message); busy(e.target, false) }
  })
  document.getElementById('lic-file').addEventListener('change', async e => { const f = e.target.files[0]; if (f) document.getElementById('lic-file-key').value = (await f.text()).trim() })
  document.getElementById('lic-install').addEventListener('click', async e => {
    const token = document.getElementById('lic-file-key').value.trim()
    if (!token) return setErr('Collez ou importez votre fichier licence.key.')
    setErr(''); busy(e.target, true)
    try { await post('/api/license/key', { token }); location.reload() }
    catch (ex) { setErr(ex.message); busy(e.target, false) }
  })
}

// ─── Écran OTP (code reçu par e-mail) ────────────────────────────────────────
function otpScreen(key, emailMasked) {
  $app.innerHTML = shell('Entrez votre code',
    `Un code à 6 chiffres vient d’être envoyé à <b>${esc(emailMasked || 'votre e-mail')}</b>. Il expire dans 10 minutes.`,
    `<label style="display:block;font-size:12.5px;font-weight:600;color:#44505f;margin-bottom:6px">Code de connexion</label>
     <input id="otp-code" inputmode="numeric" maxlength="6" placeholder="••••••" style="${inputCss};text-align:center;letter-spacing:8px;font-size:22px;font-weight:700">
     <button id="otp-go" style="${btnPri}">Valider et activer</button>
     <button id="otp-resend" style="${btnSec};margin-top:10px">Renvoyer un code</button>
     <button id="otp-back" style="width:100%;padding:10px;margin-top:10px;background:transparent;color:#5b6675;border:0;font-size:13px;cursor:pointer;text-decoration:underline">← Changer de clé</button>`)
  const go = document.getElementById('otp-go')
  const submit = async () => {
    const otp = document.getElementById('otp-code').value.trim()
    if (otp.length < 6) return setErr('Entrez le code à 6 chiffres.')
    setErr(''); busy(go, true)
    try { await post('/api/license/verify-otp', { key, otp }); location.reload() }
    catch (ex) { setErr(ex.message); busy(go, false) }
  }
  go.addEventListener('click', submit)
  document.getElementById('otp-code').addEventListener('keydown', e => { if (e.key === 'Enter') submit() })
  document.getElementById('otp-resend').addEventListener('click', async e => {
    setErr(''); busy(e.target, true)
    try { await post('/api/license/request-otp', { key }); setErr('Nouveau code envoyé.'); document.getElementById('lic-err').style.background = '#e9f7ef'; document.getElementById('lic-err').style.color = '#176a3a' }
    catch (ex) { setErr(ex.message) } finally { busy(e.target, false) }
  })
  document.getElementById('otp-back').addEventListener('click', () => activationScreen({ fingerprint: '' }))
  document.getElementById('otp-code').focus()
}

// ─── Écran « bloqué » (expiré / révoqué / autre machine) ─────────────────────
function blockedScreen(s) {
  const titles = { blocked: 'Abonnement expiré', revoked: 'Licence suspendue', wrong_machine: 'Licence sur un autre ordinateur', invalid: 'Licence illisible' }
  const msgs = {
    blocked: 'Votre abonnement est arrivé à échéance. <b>Vos données restent intactes sur cet ordinateur (conservées 90 jours).</b> Renouvelez, puis reconnectez-vous.',
    revoked: 'Cette licence a été suspendue. Contactez votre fournisseur DENTAL (+509 3454 6896).',
    wrong_machine: 'Cette clé est verrouillée sur un autre ordinateur.',
    invalid: 'Le fichier de licence est abîmé. Reconnectez-vous avec votre clé.'
  }
  $app.innerHTML = shell(titles[s.status] || 'Licence requise', msgs[s.status] || '',
    `<button id="lic-reconnect" style="${btnPri}">Se reconnecter avec ma clé</button>
     <button id="lic-recheck" style="width:100%;padding:10px;margin-top:10px;background:transparent;color:#5b6675;border:0;font-size:13px;cursor:pointer;text-decoration:underline">Vérifier en ligne</button>`,
    (s.fingerprint || '').slice(0, 12))
  document.getElementById('lic-reconnect').addEventListener('click', () => activationScreen(s))
  document.getElementById('lic-recheck').addEventListener('click', async e => { busy(e.target, true); try { await post('/api/license/check', {}); location.reload() } catch { busy(e.target, false) } })
}

// ─── Démarrage ───────────────────────────────────────────────────────────────
;(async () => {
  // Écran de chargement neutre dès la première peinture (plus de page blanche ni de login qui clignote)
  if ($app && !$app.innerHTML.trim()) $app.innerHTML = `<div class="bootsplash"><div class="bslogo">D</div><b>Dental Assist</b><span class="lgspin" aria-hidden="true"></span></div>`
  try {
    const s = await licenseStatus()
    applyBrand(s.brand)
    window.DL_HOSTED = !!s.hosted   // instance partagée (hébergé) : masque les fonctions "bureau" (sauvegardes locales…)
    if (s.status === 'active') return loadApp()
    if (s.status === 'grace') return loadApp(s)
    if (s.needsActivation) return activationScreen(s)
    return blockedScreen(s)
  } catch {
    try { await import('./app.js') } catch {}
  }
})()
