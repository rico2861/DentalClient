// Récupération après incident : programme la restauration de la DERNIÈRE sauvegarde vérifiée.
// Rien n'est supprimé : au prochain démarrage, la base actuelle (même corrompue) est mise de côté
// dans « data/db.avant-restauration-<date> » et les documents dans « storage.avant-restauration-<date> ».
// Usage : npm run restaurer            (dernière sauvegarde vérifiée)
//         npm run restaurer -- <id>    (une sauvegarde précise, voir le dossier backups/)
import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import { config } from '../src/config/env.js'

const dir = config.backupDir, want = process.argv[2]
const list = fs.existsSync(dir) ? fs.readdirSync(dir, { withFileTypes: true }).filter(d => d.isDirectory()).map(d => { try { return JSON.parse(fs.readFileSync(path.join(dir, d.name, 'manifest.json'), 'utf8')) } catch { return null } }).filter(m => m?.verified) : []
list.sort((a, b) => b.created_at.localeCompare(a.created_at))
const b = want ? list.find(m => m.id === want) : list[0]
if (!b) { console.error(want ? `Sauvegarde « ${want} » introuvable ou non vérifiée.` : 'Aucune sauvegarde vérifiée dans ' + dir); process.exit(1) }
const buf = fs.readFileSync(path.join(dir, b.id, 'db.tar.gz'))
if (crypto.createHash('sha256').update(buf).digest('hex') !== b.db_sha256) { console.error('Le fichier de cette sauvegarde est altéré : restauration refusée. Choisissez-en une autre : npm run restaurer -- <id>'); process.exit(1) }
fs.writeFileSync(path.join(dir, 'RESTORE.json'), JSON.stringify({ id: b.id, by: 'récupération (npm run restaurer)', requested_at: new Date().toISOString() }, null, 1))
const loc = new Date(b.created_at).toLocaleString('fr-FR', { timeZone: 'America/Port-au-Prince' })
console.log(`\n✔ Restauration programmée : sauvegarde du ${loc} (${b.counts?.patients ?? '?'} patients, ${b.counts?.invoices ?? '?'} factures).`)
console.log('  Lancez maintenant : npm start')
console.log('  La base actuelle sera conservée à côté (data/db.avant-restauration-…), rien n\'est supprimé.')
console.log(`  Sauvegardes disponibles : ${list.slice(0, 5).map(m => m.id).join(', ')}\n`)
