#!/usr/bin/env node
// ============================================================================
// Start de REST-API. Gebruik: node --env-file=.env server/index.js
// Env: DATABASE_URL (verplicht), PORT (optioneel, default 3000).
// ============================================================================

import pg from 'pg'
import { bouwApp } from './app.js'

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL ontbreekt. Zie .env.example en draai met --env-file=.env.')
  process.exit(1)
}

const gebruiktSSL = !/localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL) && process.env.PGSSLMODE !== 'disable'
const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: gebruiktSSL ? { rejectUnauthorized: false } : undefined
})

const app = bouwApp(pool)
const port = Number(process.env.PORT ?? 3000)

const server = app.listen(port, () => {
  console.log(`API luistert op http://localhost:${port}`)
})

for (const signaal of ['SIGINT', 'SIGTERM']) {
  process.on(signaal, () => {
    server.close(() => pool.end().then(() => process.exit(0)))
  })
}
