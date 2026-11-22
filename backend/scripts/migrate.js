// Applique uniquement les migrations en attente (mises à jour).
import '../src/config/env.js'
import { pool } from '../src/db/pool.js'
import { migrate } from '../src/db/migrate.js'

const c = await pool.connect()
try { await migrate(c) } finally { c.release(); await pool.end() }
