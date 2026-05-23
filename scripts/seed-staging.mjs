#!/usr/bin/env node
/**
 * seed-staging.mjs
 *
 * Populates an otherwise-empty Supabase project with the minimum data
 * needed to make the app feel "alive" when you sign up as a fresh test
 * user — a handful of well-known assets so symbol searches return
 * something, plus flips your test user into pilot mode so the
 * getting-started flow is visible.
 *
 * Safe to re-run: every statement is upsert-style or guarded with
 * `WHERE NOT EXISTS`, so running it twice doesn't duplicate data.
 *
 * Usage:
 *   SUPABASE_PROJECT_REF=pdajkwtrrjcqnjsyvyqt \
 *     node scripts/seed-staging.mjs
 *
 * For prod (don't do this casually):
 *   SUPABASE_PROJECT_REF=wfcebeagznzgeuyysbnt \
 *     node scripts/seed-staging.mjs
 *
 * Reads the Supabase access token from .mcp.json if SUPABASE_ACCESS_TOKEN
 * isn't set, same as apply-migrations-to-staging.mjs.
 */

import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(__dirname, '..')

async function getAccessToken() {
  if (process.env.SUPABASE_ACCESS_TOKEN) return process.env.SUPABASE_ACCESS_TOKEN
  try {
    const mcp = JSON.parse(
      await readFile(path.join(REPO_ROOT, '.mcp.json'), 'utf8'),
    )
    return mcp.mcpServers?.supabase?.env?.SUPABASE_ACCESS_TOKEN
  } catch {
    return undefined
  }
}

const PROJECT_REF = process.env.SUPABASE_PROJECT_REF
if (!PROJECT_REF) {
  console.error('ERROR: set SUPABASE_PROJECT_REF (the staging project ref).')
  process.exit(1)
}

const TOKEN = await getAccessToken()
if (!TOKEN) {
  console.error('ERROR: no SUPABASE_ACCESS_TOKEN in env or .mcp.json.')
  process.exit(1)
}

async function runSql(sql, label) {
  const res = await fetch(
    `https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query: sql }),
    },
  )
  const body = await res.text()
  if (!res.ok) {
    console.error(`  ✗ ${label}: HTTP ${res.status}`)
    console.error(`    ${body.slice(0, 400)}`)
    return false
  }
  console.log(`  ✓ ${label}`)
  return true
}

console.log(`Seeding project ${PROJECT_REF}…\n`)

// ───────────────────────────────────────────────────────────────────
// 1. Sample assets — so symbol searches return something
// ───────────────────────────────────────────────────────────────────
const SEED_ASSETS = [
  { symbol: 'AAPL', company_name: 'Apple Inc.',          sector: 'Technology'           },
  { symbol: 'MSFT', company_name: 'Microsoft Corporation', sector: 'Technology'         },
  { symbol: 'GOOG', company_name: 'Alphabet Inc.',       sector: 'Communication Services' },
  { symbol: 'NVDA', company_name: 'NVIDIA Corporation',  sector: 'Technology'           },
  { symbol: 'TSLA', company_name: 'Tesla Inc.',          sector: 'Consumer Cyclical'    },
  { symbol: 'AMZN', company_name: 'Amazon.com Inc.',     sector: 'Consumer Cyclical'    },
  { symbol: 'META', company_name: 'Meta Platforms Inc.', sector: 'Communication Services' },
  { symbol: 'JPM',  company_name: 'JPMorgan Chase & Co.',sector: 'Financial Services'   },
  { symbol: 'V',    company_name: 'Visa Inc.',           sector: 'Financial Services'   },
  { symbol: 'WMT',  company_name: 'Walmart Inc.',        sector: 'Consumer Defensive'   },
]

const valuesClause = SEED_ASSETS
  .map(a => `('${a.symbol}', '${a.company_name.replace(/'/g, "''")}', '${a.sector}')`)
  .join(', ')

console.log('Sample assets:')
await runSql(
  `INSERT INTO public.assets (symbol, company_name, sector)
   VALUES ${valuesClause}
   ON CONFLICT (symbol) DO NOTHING`,
  `inserted/skipped ${SEED_ASSETS.length} assets`,
)
console.log('')

// ───────────────────────────────────────────────────────────────────
// 2. Mark the dev's test user as a pilot so the pilot UX is visible.
//    Only updates a single, hardcoded email — won't affect other test
//    users that get created later.
// ───────────────────────────────────────────────────────────────────
console.log('Dev pilot flag:')
await runSql(
  `UPDATE public.users
   SET is_pilot_user = true
   WHERE email = 'elockenvitz@yahoo.com'`,
  `flipped is_pilot_user=true for elockenvitz@yahoo.com (if present)`,
)
console.log('')

console.log('Done. Refresh your browser to see the seeded data.')
