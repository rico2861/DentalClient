// ═══════════════════════════════════════════════════════════════════════════
//  DENTAL — Vérification de licence (côté app, 100 % hors ligne)
//
//  Ce fichier ne contient QUE la vérification : la clé PUBLIQUE est embarquée,
//  aucune clé privée. Il ne peut pas créer de licence, seulement en lire une.
//  Jumeau de saas/shared/license.js (émission), gardé identique côté lecture.
// ═══════════════════════════════════════════════════════════════════════════

import crypto from 'crypto'
import os from 'os'
import fs from 'fs'
import path from 'path'

// Clé publique de vérification. Embarquée ici pour voyager dans l'.exe.
// Surchargeable par LICENSE_PUBLIC_KEY (tests, rotation) — jamais la privée.
const EMBEDDED_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEA6XT3uPVXraTotnC994tBOvJAMux7cxKS4M2OCxwULCM=
-----END PUBLIC KEY-----`
export const PUBLIC_KEY = () => (process.env.LICENSE_PUBLIC_KEY || EMBEDDED_PUBLIC_KEY).replace(/\\n/g, '\n')

const MAGIC = 'DL1'
const GRACE_DEFAULT = 3
const b64u = buf => Buffer.from(buf).toString('base64url')
const unb64u = str => Buffer.from(str, 'base64url')

// ─── Lecture + vérification de signature ─────────────────────────────────────
export function readLicense(token, publicKeyPem = PUBLIC_KEY()) {
  if (typeof token !== 'string') return { ok: false, reason: 'format' }
  const parts = token.trim().split('.')
  if (parts.length !== 3 || parts[0] !== MAGIC) return { ok: false, reason: 'format' }
  const [, body, sig] = parts
  let valid = false
  try { valid = crypto.verify(null, Buffer.from(body), publicKeyPem, unb64u(sig)) } catch { valid = false }
  if (!valid) return { ok: false, reason: 'signature' }
  let payload
  try { payload = JSON.parse(unb64u(body).toString('utf8')) } catch { return { ok: false, reason: 'corrompue' } }
  return { ok: true, payload }
}

// ─── État complet : 'active' | 'grace' | 'blocked' | 'wrong_machine' | 'invalid'
export function checkLicense(token, { machineId = null, now = new Date(), publicKeyPem = PUBLIC_KEY() } = {}) {
  const r = readLicense(token, publicKeyPem)
  if (!r.ok) return { status: 'invalid', reason: r.reason }
  const p = r.payload
  if (p.mid && machineId && p.mid !== machineId) return { status: 'wrong_machine', payload: p }
  const exp = new Date(p.exp)
  const graceDays = Number.isFinite(p.grace) ? p.grace : GRACE_DEFAULT
  const graceEnd = new Date(exp.getTime() + graceDays * 86400000)
  const day = 86400000
  if (now <= exp) return { status: 'active', payload: p, days_left: Math.ceil((exp - now) / day) }
  if (now <= graceEnd) return { status: 'grace', payload: p, grace_days_left: Math.ceil((graceEnd - now) / day) }
  return { status: 'blocked', payload: p }
}

// ─── Empreinte de la machine (verrou anti-copie) ─────────────────────────────
export function machineFingerprint(dataDir) {
  const nets = os.networkInterfaces()
  const mac = Object.values(nets).flat()
    .filter(n => n && !n.internal && n.mac && n.mac !== '00:00:00:00:00:00')
    .map(n => n.mac).sort()[0] || ''
  const hw = [os.hostname(), mac, os.platform(), os.arch()].join('|')
  let installId = ''
  if (dataDir) {
    try {
      const f = path.join(dataDir, 'machine.id')
      if (fs.existsSync(f)) installId = fs.readFileSync(f, 'utf8').trim()
      else { installId = crypto.randomUUID(); fs.mkdirSync(dataDir, { recursive: true }); fs.writeFileSync(f, installId) }
    } catch { /* lecture seule : partie matérielle seule */ }
  }
  return crypto.createHash('sha256').update(hw + '|' + installId).digest('hex').slice(0, 24)
}

export function planLabel(plan) { return plan === '1y' ? '1 an' : plan === '1m' ? '1 mois' : plan === 'trial' ? 'essai 15 jours' : plan }
