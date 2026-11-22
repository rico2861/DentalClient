// Sauvegardes et restauration : réservées au propriétaire et aux administrateurs ; la restauration exige le mot de passe.
import fs from 'fs'
import path from 'path'
import bcrypt from 'bcryptjs'
import { createBackup, listBackups, getSettings, saveSettings, journalEntries, pendingRestore, requestRestore, cancelRestore, backupPath } from '../lib/backup.js'
import { kitDownloaded, strategyInfo, createDiff, createLog, verifyBackup, inspectBackup, planRestore, restorePoint, integrityCheck, checkMirrorDir } from '../lib/backup-plus.js'
import { publicCloud, cloudState, syncNow, listCloud, importCloud, checkOnline, previewCloud, pullCloud } from '../lib/cloud.js'
export default function (app, { need, audit, fail, wrap }) {
  const admin = req => req.user.role === 'OWNER' || String(req.user.role).startsWith('ADMIN'), who = req => `${req.user.first_name} ${req.user.last_name}`.trim()
  app.get('/api/backups', need(), wrap(async (req, res) => { if (!admin(req)) return fail(res, 403, "Réservé à l'administration")
    res.json({ backups: listBackups(), settings: getSettings(), journal: journalEntries().slice(0, 60), pending: pendingRestore(), owner: req.user.role === 'OWNER', cloud: { ...publicCloud(), state: cloudState() }, strategy: await strategyInfo() }) }))
  app.post('/api/backups', need(), wrap(async (req, res) => { if (!admin(req)) return fail(res, 403, "Réservé à l'administration")
    const type = ['complete', 'partielle', 'differentielle', 'journal'].includes(req.body.type) ? req.body.type : 'complete'
    try {
      if (type === 'differentielle' || type === 'journal') { const r = type === 'journal' ? await createLog({ by: who(req) }) : await createDiff({ by: who(req) })
        if (!r.skipped) await audit(req, type === 'journal' ? 'BACKUP_LOG' : 'BACKUP_DIFF', 'backups', null, { id: r.id, rows: r.rows ?? r.count }); return res.json({ type, ...r }) }
      const b = await createBackup({ kind: 'manuelle', by: who(req), partial: type === 'partielle' }); await audit(req, 'BACKUP_CREATED', 'backups', null, { id: b.id, type, size: b.db_size + b.files_size }); res.json({ type, ...b }); syncNow().catch(() => {}) }   // envoi en ligne aussitôt si Internet est disponible
    catch (e) { await audit(req, 'BACKUP_FAILED', 'backups', null, { error: e.message }); fail(res, 500, 'Sauvegarde échouée : ' + e.message) } }))
  app.post('/api/backups/settings', need(), wrap(async (req, res) => { if (!admin(req)) return fail(res, 403, "Réservé à l'administration")
    if (req.body.mirror_dir !== undefined) { try { req.body.mirror_dir = checkMirrorDir(req.body.mirror_dir) } catch (e) { return fail(res, 400, e.message) } }
    const s = saveSettings(req.body); await audit(req, 'BACKUP_SETTINGS', 'backups', null, s); res.json(s) }))
  app.get('/api/backups/:id/download', need(), wrap(async (req, res) => { if (req.user.role !== 'OWNER') return fail(res, 403, 'Réservé au propriétaire')
    const d = backupPath(req.params.id); if (!d) return fail(res, 404, 'Introuvable'); await audit(req, 'BACKUP_DOWNLOADED', 'backups', null, { id: req.params.id })
    res.download(path.join(d, 'db.tar.gz'), `dental-light-base-${req.params.id}.tar.gz`) }))
  app.post('/api/backups/:id/restore', need(), wrap(async (req, res) => { if (req.user.role !== 'OWNER') return fail(res, 403, 'Restauration réservée au propriétaire')
    if (req.body.confirm !== 'RESTAURER') return fail(res, 400, 'Tapez RESTAURER pour confirmer')
    if (!(await bcrypt.compare(req.body.password || '', req.user.password_hash))) return fail(res, 400, 'Mot de passe incorrect')
    try { const r = await requestRestore(req.params.id, who(req)); await audit(req, 'RESTORE_REQUESTED', 'backups', null, r); res.json({ ok: true, ...r }) }
    catch (e) { fail(res, 400, e.message) } }))
  app.post('/api/backups/restore/cancel', need(), wrap(async (req, res) => { if (req.user.role !== 'OWNER') return fail(res, 403, 'Réservé au propriétaire')
    const ok = cancelRestore(who(req)); if (ok) await audit(req, 'RESTORE_CANCELLED', 'backups', null, {}); res.json({ ok }) }))
  // ── kit de récupération : la clé qui déchiffre les données + la configuration nécessaire sur un nouvel ordinateur ──
  app.post('/api/backups/recovery-kit', need(), wrap(async (req, res) => { if (req.user.role !== 'OWNER') return fail(res, 403, 'Réservé au propriétaire')
    if (!(await bcrypt.compare(req.body.password || '', req.user.password_hash))) return fail(res, 400, 'Mot de passe incorrect')
    const E = k => process.env[k] ? k + '=' + process.env[k] : '# ' + k + '= (non défini)'
    const txt = ['# ═══ DENTAL — KIT DE RÉCUPÉRATION ═══', '# Généré le ' + new Date().toLocaleString('fr-FR', { timeZone: 'America/Port-au-Prince' }) + ' par ' + who(req),
      '# CONFIDENTIEL : ce fichier déchiffre les dossiers médicaux. Gardez-le hors de cet ordinateur (clé USB rangée, coffre), jamais par e-mail ni sur un téléphone partagé.',
      '#', '# En cas de perte de l\'ordinateur : installez DENTAL, copiez ces lignes dans backend/.env, démarrez,', '# puis « Sauvegardes → Récupérer depuis Supabase » (ou restaurez une sauvegarde copiée depuis le miroir).', '',
      E('JWT_SECRET'), E('SUPABASE_DB_URL'), E('SUPABASE_SERVICE_KEY'), E('SUPABASE_REGION'), E('OWNER_EMAIL'), ''].join('\r\n')
    kitDownloaded(who(req)); await audit(req, 'RECOVERY_KIT', 'backups', null, {})
    res.setHeader('Content-Type', 'text/plain; charset=utf-8'); res.setHeader('Content-Disposition', 'attachment; filename="dental-light-kit-recuperation.txt"'); res.setHeader('Cache-Control', 'no-store'); res.send(txt) }))
  // ── vérification (VERIFYONLY), en-tête et contenu (HEADERONLY / FILELISTONLY), intégrité (CHECKDB) ──
  app.post('/api/backups/:id/verify', need(), wrap(async (req, res) => { if (!admin(req)) return fail(res, 403, "Réservé à l'administration")
    try { const r = await verifyBackup(req.params.id); await audit(req, 'BACKUP_VERIFIED', 'backups', null, { id: req.params.id, ok: r.ok }); res.json(r) } catch (e) { fail(res, 400, e.message) } }))
  app.get('/api/backups/:id/inspect', need(), wrap(async (req, res) => { if (!admin(req)) return fail(res, 403, "Réservé à l'administration"); try { res.json(inspectBackup(req.params.id)) } catch (e) { fail(res, 404, e.message) } }))
  app.post('/api/backups/integrity', need(), wrap(async (req, res) => { if (!admin(req)) return fail(res, 403, "Réservé à l'administration"); const r = await integrityCheck(); await audit(req, 'DB_INTEGRITY', 'backups', null, { ok: r.ok, orphans: r.orphans.length }); res.json(r) }))
  // ── restauration à un instant précis (STOPAT), complète ou partielle ──
  app.get('/api/backups/plan', need(), wrap(async (req, res) => { if (req.user.role !== 'OWNER') return fail(res, 403, 'Réservé au propriétaire'); try { res.json(await planRestore(req.query.at)) } catch (e) { fail(res, 400, e.message) } }))
  app.post('/api/backups/pitr', need(), wrap(async (req, res) => { if (req.user.role !== 'OWNER') return fail(res, 403, 'Restauration réservée au propriétaire')
    if (req.body.confirm !== 'RESTAURER') return fail(res, 400, 'Tapez RESTAURER pour confirmer')
    if (!(await bcrypt.compare(req.body.password || '', req.user.password_hash))) return fail(res, 400, 'Mot de passe incorrect')
    const tables = Array.isArray(req.body.tables) ? req.body.tables.map(String) : []
    try { const r = await restorePoint({ at: req.body.at, tables, by: who(req) }); await audit(req, 'RESTORE_PITR', 'backups', null, r).catch(() => {}); res.json(r) } catch (e) { fail(res, 400, e.message) } }))
  // ── sauvegarde en ligne (Supabase) ──
  app.post('/api/cloud/sync', need(), wrap(async (req, res) => { if (!admin(req)) return fail(res, 403, "Réservé à l'administration")
    const r = await syncNow({ by: who(req) }); if (r.sent?.length || r.rows || r.files) await audit(req, 'CLOUD_SYNC', 'backups', null, { backups: r.sent, rows: r.rows, files: r.files }); res.json({ ...r, state: cloudState() }) }))
  app.get('/api/cloud/check', need(), wrap(async (req, res) => { if (!admin(req)) return fail(res, 403, "Réservé à l'administration"); res.json({ ...(await checkOnline()), state: cloudState() }) }))
  app.get('/api/cloud/list', need(), wrap(async (req, res) => { if (!admin(req)) return fail(res, 403, "Réservé à l'administration")
    try { res.json({ copies: await listCloud() }) } catch (e) { fail(res, e.status === 400 ? 400 : 503, e.status ? e.message : 'Pas de connexion Internet : la liste en ligne est indisponible') } }))
  app.post('/api/cloud/import', need(), wrap(async (req, res) => { if (req.user.role !== 'OWNER') return fail(res, 403, 'Réservé au propriétaire')
    if (!(await bcrypt.compare(req.body.password || '', req.user.password_hash))) return fail(res, 400, 'Mot de passe incorrect')
    try { const r = await importCloud(String(req.body.id || ''), req.body.passphrase || ''); await audit(req, 'CLOUD_IMPORTED', 'backups', null, { id: r.id }); res.json(r) } catch (e) { fail(res, 400, e.message) } }))
  // comparaison local / en ligne (lecture seule)
  app.get('/api/cloud/preview', need(), wrap(async (req, res) => { if (!admin(req)) return fail(res, 403, "Réservé à l'administration")
    try { res.json(await previewCloud()) } catch (e) { fail(res, e.status === 400 ? 400 : 503, e.message) } }))
  // récupération : les données locales sont remplacées par la copie Supabase (sauvegarde de sécurité faite avant)
  app.post('/api/cloud/pull', need(), wrap(async (req, res) => { if (req.user.role !== 'OWNER') return fail(res, 403, 'Réservé au propriétaire')
    if (!(await bcrypt.compare(req.body.password || '', req.user.password_hash))) return fail(res, 400, 'Mot de passe incorrect')
    if (req.body.confirm !== 'RECUPERER') return fail(res, 400, 'Tapez RECUPERER pour confirmer')
    try { const r = await pullCloud({ by: who(req) }); await audit(req, 'CLOUD_PULLED', 'backups', null, { rows: r.rows, files: r.files, tables: r.tables }).catch(() => {}); res.json(r) } catch (e) { fail(res, 400, e.message) } }))
  void fs
}
