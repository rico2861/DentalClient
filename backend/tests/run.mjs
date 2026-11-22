// Lanceur des tests d'intégration.
// Usage : npm test   (base temporaire embarquée, rien à installer)
import '../src/config/env.js'
import { spawn } from 'child_process'
import crypto from 'crypto'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { fileURLToPath } from 'url'

// Base de test embarquée : dossier temporaire, supprimé à la fin.
const here = path.dirname(fileURLToPath(import.meta.url)), PORT = 3999
const dbdir = fs.mkdtempSync(path.join(os.tmpdir(), 'dldb-'))
process.env.DB_DIR = dbdir
const { pool } = await import('../src/db/pool.js')
const { migrate, ensureOwner } = await import('../src/db/migrate.js')
const c = await pool.connect()
await migrate(c, () => {})
await ensureOwner(c, 'owner@test.com', 'Temp#Passw0rd2026', () => {})
await c.query('update clinics set require_2fa=false'); c.release(); await pool.end()

const storage = fs.mkdtempSync(path.join(os.tmpdir(), 'dlstore-'))
const server = spawn(process.execPath, [path.join(here, '../src/server.js')], {
  env: { ...process.env, DB_DIR: dbdir, OWNER_EMAIL: '', OWNER_PASSWORD: '', PORT: String(PORT), STORAGE_DIR: storage, NODE_ENV: 'test', JWT_SECRET: crypto.randomBytes(48).toString('hex') }, stdio: ['ignore', 'inherit', 'inherit'] })
const stop = () => { server.kill('SIGTERM'); fs.rmSync(storage, { recursive: true, force: true }); setTimeout(() => fs.rmSync(dbdir, { recursive: true, force: true }), 500) }

let up = false
for (let i = 0; i < 50 && !up; i++) { try { up = (await fetch(`http://localhost:${PORT}/api/health`)).ok } catch {} if (!up) await new Promise(r => setTimeout(r, 200)) }
if (!up) { console.error('Le serveur de test ne démarre pas.'); stop(); process.exit(1) }

let failed = 0
for (const f of ['test.mjs', 'test2.mjs', 'test3.mjs', 'test4.mjs']) {
  console.log(`\n══ ${f} ══`)
  // Les scripts n'utilisent pas de code de sortie : on compte les lignes « FAIL ».
  const code = await new Promise(r => {
    const ch = spawn(process.execPath, [path.join(here, f)], { stdio: ['ignore', 'pipe', 'inherit'] }); let out = '', bad = 0
    ch.stdout.on('data', d => { process.stdout.write(d); out += d; const ls = out.split('\n'); out = ls.pop(); bad += ls.filter(l => l.startsWith('FAIL')).length })
    ch.on('exit', c => r(c || bad ? 1 : 0)) })
  if (code) failed++
}
stop(); console.log(failed ? `\n${failed} fichier(s) de test en échec` : '\nTous les tests sont passés'); process.exit(failed ? 1 : 0)
