// Crée (ou complète) backend/.env automatiquement : clé secrète aléatoire, mot de passe propriétaire temporaire.
import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import { fileURLToPath } from 'url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
// .env dans DATA_ROOT s'il est défini (installeur Windows : dossier inscriptible), sinon dans backend/
const dataRoot = process.env.DATA_ROOT; if (dataRoot) fs.mkdirSync(dataRoot, { recursive: true })
const envp = path.join(dataRoot || root, '.env')
const secret = () => crypto.randomBytes(48).toString('hex')
// clé collée avec des espaces, des guillemets ou « JWT_SECRET= » devant : corrigée automatiquement
if (process.env.JWT_SECRET) { let k = process.env.JWT_SECRET.trim(); for (let i = 0; i < 2; i++) k = k.replace(/^['"]|['"]$/g, '').trim().replace(/^JWT_SECRET\s*=\s*/, '').trim(); process.env.JWT_SECRET = k }
// hébergé (Railway…) : la configuration vient des variables du service, jamais d'un .env éphémère
const hosted = !!(process.env.RAILWAY_ENVIRONMENT || process.env.RAILWAY_PROJECT_ID || process.env.RENDER || process.env.FLY_APP_NAME)
if (hosted) {
  if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) {
    console.error([
      '',
      '✖ Variable manquante : JWT_SECRET (au moins 32 caractères).',
      '  Elle chiffre les données médicales et les sessions : elle doit rester TOUJOURS la même.',
      '  Railway → votre service → Variables → New Variable → JWT_SECRET',
      "  (valeur : celle de JWT_SECRET dans votre backend/.env local, ou une nouvelle valeur longue si la base est vide), puis redéployez.",
      ''].join('\n'))
    process.exit(1)
  }
  if (!process.env.RAILWAY_VOLUME_MOUNT_PATH && !process.env.DATA_ROOT) console.warn([
    '',
    '⚠ AUCUN VOLUME : la base, les documents et les sauvegardes seront EFFACÉS à chaque redéploiement.',
    '  Railway → votre service → clic droit → Attach Volume → chemin de montage : /data',
    ''].join('\n'))
} else if (!fs.existsSync(envp)) {
  const pw = crypto.randomBytes(9).toString('base64url') + '!1a'
  let t = fs.readFileSync(path.join(root, '.env.example'), 'utf8')
  t = t.replace(/^JWT_SECRET=.*$/m, 'JWT_SECRET=' + secret()).replace(/^OWNER_PASSWORD=.*$/m, 'OWNER_PASSWORD=' + pw)
  fs.writeFileSync(envp, t)
  const ownerEmail = (t.match(/^OWNER_EMAIL=(.*)$/m) || [])[1]
  console.log('.env créé. Compte propriétaire :', ownerEmail, '/ mot de passe temporaire :', pw)
  // Fiche lisible pour la première connexion (surtout en installation Windows où la console est masquée)
  try { fs.writeFileSync(path.join(dataRoot || root, 'PREMIER-DEMARRAGE.txt'),
    ['DENTAL — première connexion', '', 'Ouvrez http://localhost:3000 dans votre navigateur.', '',
     'Identifiant propriétaire : ' + ownerEmail, 'Mot de passe temporaire : ' + pw, '',
     'Vous devrez changer ce mot de passe à la première connexion.',
     'Si l\'accès est bloqué, entrez d\'abord le code d\'activation de votre clinique.', ''].join('\r\n')) } catch {}
} else {
  let t = fs.readFileSync(envp, 'utf8')
  if (/^JWT_SECRET=(remplacez|\s*$)/m.test(t)) { fs.writeFileSync(envp, t.replace(/^JWT_SECRET=.*$/m, 'JWT_SECRET=' + secret())); console.log('JWT_SECRET généré dans .env') }
  if (!/^REQUIRE_2FA=/m.test(t)) { fs.appendFileSync(envp, '\n# Double authentification obligatoire (propriétaire/admins) : false = désactivée, true = imposée\nREQUIRE_2FA=false\n'); console.log('REQUIRE_2FA=false ajouté à .env (2FA désactivée)') }
}

// Garantit l'URL du backend SaaS (activation OTP en ligne) — jamais à saisir à la main.
if (!hosted && fs.existsSync(envp)) {
  const DEFAULT_SAAS_URL = (process.env.SAAS_URL || 'https://backenddental.onrender.com').trim()
  let t = fs.readFileSync(envp, 'utf8')
  const m = t.match(/^SAAS_URL=([^\n]*)$/m)
  const val = m ? m[1].split('#')[0].trim() : null       // valeur réelle (avant un éventuel commentaire)
  if (m && !val) { fs.writeFileSync(envp, t.replace(/^SAAS_URL=[^\n]*$/m, 'SAAS_URL=' + DEFAULT_SAAS_URL)); console.log('SAAS_URL réglé dans .env') }
  else if (!m) { fs.appendFileSync(envp, '\nSAAS_URL=' + DEFAULT_SAAS_URL + '\n'); console.log('SAAS_URL ajouté au .env') }
}
