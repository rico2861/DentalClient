// Installation initiale : migrations + clinique + compte propriétaire.
import '../src/config/env.js'
import { pool } from '../src/db/pool.js'
import { migrate, ensureOwner } from '../src/db/migrate.js'

const c = await pool.connect()
try {
  console.log('Migrations…'); await migrate(c)
  await ensureOwner(c, process.env.OWNER_EMAIL, process.env.OWNER_PASSWORD)
} finally { c.release(); await pool.end() }
