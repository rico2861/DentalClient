// ═══════════════════════════════════════════════════════════════════════════
//  DENTAL — Porte de licence (côté app)
//
//  • Vérifie la licence LOCALEMENT à chaque démarrage (hors ligne) : expiration,
//    grâce 3 jours, verrou machine → bloque l'accès automatiquement.
//  • Quand Internet est là, interroge le serveur SaaS pour savoir si la licence
//    est RÉVOQUÉE ou renouvelée → coupure/prolongation à distance.
//  • N'altère AUCUNE fonction de gestion : ajoute seulement une porte devant
//    /api/* et quelques routes /api/license/*.
//
//  Fichiers (dans data/license/) :
//    licence.key          le jeton signé de CET hôte
//    license-remote.json  dernier verdict du serveur (révocation, prolongation)
//    brand.json           personnalisation de la clinique (couleur, nom, logo)
// ═══════════════════════════════════════════════════════════════════════════

import fs from 'fs'
import os from 'os'
import path from 'path'
import { config } from '../config/env.js'
import { checkLicense, machineFingerprint, planLabel } from './license-core.js'

const SAAS_URL = (process.env.SAAS_URL || '').replace(/\/+$/, '')   // ex. https://dental-saas.up.railway.app
const CHECK_MS = Math.max(1, parseInt(process.env.LICENSE_CHECK_HOURS) || 6) * 3600000
const NET_TIMEOUT = 8000

// Dossier des fichiers de licence (sur le volume en hébergé, sinon data/license)
const baseDir = config.dbDir.startsWith('memory://') ? path.join(os.tmpdir(), 'dl-license') : path.dirname(config.dbDir)
const LIC_DIR = path.join(baseDir, 'license')
const KEY_FILE = () => path.join(LIC_DIR, 'licence.key')
const REMOTE_FILE = () => path.join(LIC_DIR, 'license-remote.json')
const BRAND_FILE = () => path.join(LIC_DIR, 'brand.json')

const ensureDir = () => { try { fs.mkdirSync(LIC_DIR, { recursive: true }) } catch {} }
const readJson = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')) } catch { return d } }
const writeJson = (f, o) => { ensureDir(); try { fs.writeFileSync(f, JSON.stringify(o, null, 2)) } catch {} }
const readKey = () => { try { return fs.readFileSync(KEY_FILE(), 'utf8').trim() } catch { return '' } }
const writeKey = t => { ensureDir(); fs.writeFileSync(KEY_FILE(), String(t).trim()) }

export const fingerprint = () => machineFingerprint(LIC_DIR)

// ─── État effectif = licence locale + verdict du serveur ─────────────────────
export function status() {
  const token = readKey()
  const brand = readJson(BRAND_FILE(), {})
  if (!token) return { status: 'needs_activation', blocked: true, needsActivation: true, fingerprint: fingerprint(), brand }

  const local = checkLicense(token, { machineId: fingerprint() })
  const remote = readJson(REMOTE_FILE(), {})
  const p = local.payload || {}

  // La révocation à distance l'emporte : bloquée même si le jeton local est encore valide.
  let st = local.status
  if (remote.revoked) st = 'revoked'

  const blocked = !(st === 'active' || st === 'grace')
  return {
    status: st, blocked,
    plan: p.plan, planLabel: planLabel(p.plan), trial: !!p.trial,
    clinic: p.clinic, clinic_id: p.cid, seats: p.seats,
    exp: p.exp, days_left: local.days_left, grace_days_left: local.grace_days_left,
    reason: local.reason || remote.reason,
    remote_checked_at: remote.checkedAt || null,
    fingerprint: fingerprint(),
    brand: { color: brand.color || null, name: brand.name || p.clinic || 'DENTAL', logo: brand.logo || null, legal_name: brand.legal_name || null, email: brand.email || null, phone: brand.phone || null, city: brand.city || null, address: brand.address || null }
  }
}

// Nom du schéma Supabase isolé pour cette clinique (données de sauvegarde).
// Fallback historique 'dental_light' tant qu'aucune licence n'est installée.
export function clinicSchema() { const s = status(); return s.clinic_id ? 'clinic_' + String(s.clinic_id).replace(/[^a-z0-9]/gi, '').toLowerCase() : 'dental_light' }

// ─── Installer une clé reçue (fichier licence.key collé/importé) ─────────────
export function installKey(token) {
  const r = checkLicense(String(token || ''), { machineId: fingerprint() })
  if (r.status === 'invalid') throw Object.assign(new Error('Clé invalide (signature incorrecte ou fichier abîmé)'), { code: 'BAD_KEY' })
  if (r.status === 'wrong_machine') throw Object.assign(new Error('Cette clé est verrouillée sur un autre ordinateur'), { code: 'WRONG_MACHINE' })
  writeKey(token)
  // une clé fraîchement installée annule un ancien verdict de révocation
  writeJson(REMOTE_FILE(), { checkedAt: new Date().toISOString(), revoked: false })
  return status()
}

// ─── Appel réseau au serveur SaaS (défensif : hors ligne = on garde le local) ─
async function post(pathname, body) {
  if (!SAAS_URL) throw Object.assign(new Error('SAAS_URL non configuré'), { code: 'NO_SAAS' })
  const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), NET_TIMEOUT)
  try {
    const r = await fetch(SAAS_URL + pathname, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: ctrl.signal })
    const j = await r.json().catch(() => ({}))
    if (!r.ok) throw Object.assign(new Error(j.error || 'Serveur de licences : erreur'), { code: j.code || 'SAAS_ERROR', http: r.status })
    return j
  } finally { clearTimeout(t) }
}

// ─── Activation en ligne d'un hôte (consomme un siège côté serveur) ──────────
// Le serveur renvoie { token, brand? }. Nécessite Internet (une seule fois).
export async function activate({ key, code, email } = {}) {
  const j = await post('/api/activate', { key, code, email, fingerprint: fingerprint(), hostname: os.hostname(), app_version: process.env.npm_package_version || '' })
  if (!j.token) throw Object.assign(new Error('Réponse du serveur sans clé'), { code: 'SAAS_ERROR' })
  installKey(j.token)
  if (j.brand) writeJson(BRAND_FILE(), j.brand)
  return status()
}

// ─── Connexion par OTP : étape 1 — envoyer un code à l'e-mail d'inscription ──
export async function requestOtp({ key } = {}) {
  const j = await post('/api/activate/request-otp', { key: String(key || '').trim(), fingerprint: fingerprint(), hostname: os.hostname() })
  return j   // { otp_sent, email (masqué), expires_in }
}

// ─── Connexion par OTP : étape 2 — vérifier le code puis activer ─────────────
export async function activateWithOtp({ key, otp } = {}) {
  const j = await post('/api/activate/verify-otp', { key: String(key || '').trim(), otp: String(otp || '').trim(), fingerprint: fingerprint(), hostname: os.hostname(), app_version: process.env.npm_package_version || '' })
  if (!j.token) throw Object.assign(new Error('Réponse du serveur sans clé'), { code: 'SAAS_ERROR' })
  installKey(j.token)
  if (j.brand) writeJson(BRAND_FILE(), j.brand)
  return status()
}

// Profil complet de la clinique (nom, email, adresse, logo, couleur) pour l'app.
export function brandProfile() { return readJson(BRAND_FILE(), {}) }

// ─── Contrôle en ligne : révocation + prolongation + personnalisation ────────
export async function checkRemote() {
  const token = readKey(); if (!token) return { skipped: 'no_key' }
  const local = checkLicense(token, { machineId: fingerprint() }); const lid = local.payload?.lid
  if (!lid) return { skipped: 'no_lid' }
  try {
    const j = await post('/api/check', { lid, clinic_id: local.payload.cid, fingerprint: fingerprint() })
    if (j.token && j.token !== token) { try { installKey(j.token) } catch {} }   // prolongation après paiement
    if (j.brand) writeJson(BRAND_FILE(), j.brand)
    writeJson(REMOTE_FILE(), { checkedAt: new Date().toISOString(), revoked: !!j.revoked, reason: j.reason || null, exp: j.exp || null })
    return { ok: true, revoked: !!j.revoked }
  } catch (e) {
    if (e.code === 'NO_SAAS') return { skipped: 'no_saas' }
    return { offline: true, error: e.message }   // hors ligne : on garde le dernier verdict connu
  }
}

// ─── Démarrage : un contrôle immédiat (si en ligne) puis périodique ──────────
export function startLicense() {
  if (!SAAS_URL) return
  setTimeout(() => { checkRemote().catch(() => {}) }, 8000)
  const timer = setInterval(() => { checkRemote().catch(() => {}) }, CHECK_MS)
  timer.unref?.()
}

// ─── Porte : bloque /api/* quand la licence n'est pas valable ────────────────
// Laisse toujours passer : /api/health et /api/license/*  (sinon on ne pourrait
// jamais débloquer). Le reste renvoie 403 code LICENSE → écran de licence côté app.
export function licenseGate(req, res, next) {
  const pth = req.path
  if (!pth.startsWith('/api/')) return next()
  if (pth === '/api/health' || pth.startsWith('/api/license')) return next()
  // Mode hébergé partagé (Supabase) : pas de licence « par machine ». L'accès est contrôlé
  // PAR CLINIQUE à la connexion (propriétaire = licence + OTP, personnel = mot de passe) ;
  // seules les cliniques provisionnées (abonnement actif) ont des comptes.
  if (process.env.DATABASE_URL) return next()
  const s = status()
  if (s.blocked) return res.status(403).json({ error: messageFor(s), code: 'LICENSE', license: { status: s.status, needsActivation: !!s.needsActivation, clinic: s.clinic, exp: s.exp } })
  if (s.status === 'grace') res.setHeader('X-License', 'grace:' + (s.grace_days_left || 0))
  next()
}

function messageFor(s) {
  if (s.needsActivation) return "Activation requise : entrez le code de votre clinique ou votre clé de licence."
  if (s.status === 'revoked') return "Licence suspendue. Vos données restent sur cet ordinateur et sont conservées : rien n'est perdu. Contactez votre fournisseur DENTAL."
  if (s.status === 'wrong_machine') return "Cette licence appartient à un autre ordinateur."
  if (s.status === 'invalid') return "Licence illisible. Importez une clé valide."
  return "Abonnement expiré. Vos données restent intactes sur cet ordinateur (conservées 90 jours). Renouvelez pour débloquer l'accès."
}
