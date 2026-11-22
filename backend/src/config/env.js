// Charge .env (quel que soit le dossier de lancement) et normalise la configuration.
import dotenv from 'dotenv'
import path from 'path'
import { fileURLToPath } from 'url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')   // …/backend
// .env : dans DATA_ROOT s'il est défini (installeur Windows → dossier inscriptible), sinon dans backend/
const ENV_PATH = process.env.DATA_ROOT ? path.join(process.env.DATA_ROOT, '.env') : path.join(ROOT, '.env')
dotenv.config({ path: ENV_PATH })

// clé collée avec des espaces, des guillemets ou « JWT_SECRET= » devant : corrigée automatiquement
if (process.env.JWT_SECRET) { let k = process.env.JWT_SECRET.trim(); for (let i = 0; i < 2; i++) k = k.replace(/^['"]|['"]$/g, '').trim().replace(/^JWT_SECRET\s*=\s*/, '').trim(); process.env.JWT_SECRET = k }
// hébergement (Railway, Render, Fly…) : les données vont sur le disque permanent (volume) s'il existe
export const HOSTED = !!(process.env.RAILWAY_ENVIRONMENT || process.env.RAILWAY_PROJECT_ID || process.env.RENDER || process.env.FLY_APP_NAME)
export const VOLUME = process.env.RAILWAY_VOLUME_MOUNT_PATH || process.env.DATA_ROOT || ''
if (VOLUME) { process.env.DB_DIR ||= path.join(VOLUME, 'db'); process.env.STORAGE_DIR ||= path.join(VOLUME, 'storage'); process.env.BACKUP_DIR ||= path.join(VOLUME, 'backups') }
if (!process.env.STORAGE_DIR) process.env.STORAGE_DIR = path.join(ROOT, 'storage')
else process.env.STORAGE_DIR = path.resolve(ROOT, process.env.STORAGE_DIR)

const PROJECT = path.resolve(ROOT, '..')
export const config = {
  root: ROOT,
  secret: process.env.JWT_SECRET,
  prod: process.env.NODE_ENV === 'production',
  hosted: HOSTED, volume: VOLUME,
  port: Number(process.env.PORT) || 3000,
  get dbDir() { const d = process.env.DB_DIR; return d ? (d.startsWith('memory://') ? d : path.resolve(ROOT, d)) : path.join(ROOT, 'data', 'db') },
  storageDir: process.env.STORAGE_DIR,
  backupDir: process.env.BACKUP_DIR ? path.resolve(ROOT, process.env.BACKUP_DIR) : path.join(ROOT, 'backups'),
  frontendDir: process.env.FRONTEND_DIR ? path.resolve(ROOT, process.env.FRONTEND_DIR) : path.join(PROJECT, 'frontend'),
  migrationsDir: process.env.MIGRATIONS_DIR ? path.resolve(ROOT, process.env.MIGRATIONS_DIR) : path.join(PROJECT, 'db', 'migrations')
}
