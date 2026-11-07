#!/usr/bin/env node
/**
 * Is the market data current enough for the product to be trusted.
 *
 * ── Why this is not part of ingest.yml ────────────────────────────────────
 *
 * Because the failure mode was ingest.yml dying. Both ingestion jobs failed
 * every weekday from 2026-10-06 to 2026-11-07, 35 days, and the product kept
 * serving prices the whole time. A check that lives inside the job that
 * breaks cannot report that the job broke.
 *
 * So this runs on its own schedule, reads only Tesseract's own tables, and
 * asks the question the application asks: for every name a book holds, is
 * there a dated close recent enough to price it. If the answer is no, it says
 * which names and how old the newest data is, and exits non-zero.
 *
 * ── Why it is provider-independent ───────────────────────────────────────
 *
 * It calls no market-data provider. No Yahoo, no SSGA, no key beyond the one
 * the ingestion already holds. It measures the STATE of our own tables, which
 * is the thing that matters and the thing that stays meaningful when the
 * provider changes: a new feed will write the same `price_history_cache` and
 * the same `portfolio_benchmark_weights`, and this check will keep working
 * without an edit.
 *
 * That also means a green result here is not a claim that the provider is
 * healthy. It is the stronger and more useful claim: the data the product
 * reads is current.
 *
 * ── The thresholds, and where they come from ─────────────────────────────
 *
 * Not picked round. Each one mirrors a constant the application already acts
 * on, so this check fails at the moment the product starts behaving
 * differently rather than at an arbitrary age:
 *
 *   closes        LATEST_CLOSE_WINDOW_DAYS = 10, from
 *                 src/lib/market-data/latest-closes.ts. A symbol with nothing
 *                 inside 10 days is ABSENT from the map the app builds, and
 *                 every price for it falls through to the undated
 *                 `assets.current_price`. That is the exact line between
 *                 stale and wrong.
 *   newest close  DAILY_CLOSE_POLICY.maxAgeMs = 5 days, from
 *                 src/lib/market-data/freshness.ts, which is the window a
 *                 close is flagged stale at. Five days clears a long weekend
 *                 plus a holiday.
 *   weights       10 days. The SSGA file is published daily but
 *                 `buildWeightSeries` only needs the newest one to render
 *                 current active weight, and the issuer occasionally skips a
 *                 day, so this is deliberately looser than the close window.
 *
 * ── Proof of work ────────────────────────────────────────────────────────
 *
 * An exit code is not evidence a check ran. Every assertion prints what it
 * measured, with the numbers, and the summary names each failure. `--explain`
 * lists the offending symbols rather than counting them.
 *
 * `--self-test` proves the check is not vacuous: it re-runs every assertion
 * against thresholds tightened to zero, where current data MUST fail, and
 * reports whether each one noticed. A check that cannot observe its own
 * failure mode is decoration (CLAUDE.md Standing Rule 3).
 *
 * RLS posture: unchanged, and this writes nothing. `price_history_cache` and
 * `portfolio_benchmark_weights` carry no `organization_id` by design -- a
 * close is a fact about a security, not about a tenant. `portfolio_holdings`
 * is org-scoped and is read here through the service-role credential the
 * ingestion already uses, for a count of distinct symbols only. No row of
 * tenant data is printed.
 */

import { fileURLToPath } from 'node:url'
import { UNPRICEABLE_SYMBOLS, unpriceableSet } from './market-data-exceptions.mjs'

const SUPABASE_URL = process.env.VITE_SUPABASE_URL ?? process.env.SUPABASE_URL
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

const args = process.argv.slice(2)
const has = (f) => args.includes(f)
const num = (f, d) => {
  const a = args.find((x) => x.startsWith(`${f}=`))
  if (!a) return d
  const n = Number(a.split('=')[1])
  return Number.isFinite(n) ? n : d
}

const EXPLAIN = has('--explain')
const SELF_TEST = has('--self-test')

/** Mirrors LATEST_CLOSE_WINDOW_DAYS in src/lib/market-data/latest-closes.ts. */
const CLOSE_WINDOW_DAYS = num('--close-window-days', 10)
/** Mirrors DAILY_CLOSE_POLICY.maxAgeMs in src/lib/market-data/freshness.ts. */
const NEWEST_CLOSE_MAX_AGE_DAYS = num('--newest-close-max-age-days', 5)
const WEIGHTS_MAX_AGE_DAYS = num('--weights-max-age-days', 10)

/** True only when run as a script, so `assess` can be imported by a test. */
const IS_MAIN = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]

if (IS_MAIN && (!SUPABASE_URL || !SERVICE_KEY)) {
  console.error('FAIL: missing credentials.')
  console.error('Set SUPABASE_SERVICE_ROLE_KEY + VITE_SUPABASE_URL.')
  process.exit(2)
}

/*
 * `apikey` AND `Authorization`, both.
 *
 * An `sb_secret_` key is not a JWT. Tested against live PostgREST:
 * `apikey` alone returns 200, `Authorization: Bearer` alone returns 401 with
 * "No API key found in request", and both return 200. Sending only the Bearer
 * header is how a script silently stops working the day the legacy keys are
 * disabled -- which is what took the nightly ingestion down for 35 days.
 */
const rest = async (path) => {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      Accept: 'application/json',
    },
  })
  const text = await r.text()
  if (!r.ok) throw new Error(`HTTP ${r.status} on ${path}: ${text.slice(0, 200)}`)
  // A provider blocked us returns HTTP 200 with HTML; so can a proxy in front
  // of PostgREST. Check the shape, never the status code alone.
  if (!text.trim().startsWith('[') && !text.trim().startsWith('{')) {
    throw new Error(`non-JSON response on ${path}: ${text.slice(0, 120).replace(/\s+/g, ' ')}`)
  }
  return JSON.parse(text)
}

const today = () => new Date()
const daysBetween = (a, b) => Math.floor((a.getTime() - b.getTime()) / 86_400_000)
const isoDate = (d) => d.toISOString().slice(0, 10)
const parseDate = (s) => new Date(`${s}T00:00:00Z`)

/** Every page of a table, since PostgREST caps a response at 1,000 rows. */
async function all(path) {
  const out = []
  const PAGE = 1000
  for (let offset = 0; ; offset += PAGE) {
    const rows = await rest(`${path}${path.includes('?') ? '&' : '?'}limit=${PAGE}&offset=${offset}`)
    out.push(...rows)
    if (rows.length < PAGE) return out
  }
}

/**
 * Held symbols, resolved the way `price_history_cache` is keyed.
 *
 * `coalesce(current_symbol, symbol)`, excluding CASH_USD (a book line, not an
 * instrument) and anything marked delisted (no provider will ever price it
 * again, and counting it as missing data would make this check permanently
 * red). Identical to `heldSymbols()` in backfill-price-history.mjs -- if the
 * two ever disagree, this check would be measuring a different universe from
 * the one being ingested.
 */
async function heldSymbols() {
  const holdings = await all('portfolio_holdings?select=asset_id')
  const ids = Array.from(new Set(holdings.map((h) => h.asset_id).filter(Boolean)))
  const symbols = new Map() // pricing symbol -> book symbol
  const CHUNK = 200
  for (let i = 0; i < ids.length; i += CHUNK) {
    const slice = ids.slice(i, i + CHUNK)
    const rows = await rest(
      `assets?select=id,symbol,current_symbol,lifecycle_status&id=in.(${slice.join(',')})`,
    )
    for (const a of rows) {
      if (a.symbol === 'CASH_USD') continue
      if ((a.lifecycle_status ?? 'active') === 'delisted') continue
      const pricing = (a.current_symbol || a.symbol || '').toUpperCase()
      if (pricing) symbols.set(pricing, a.symbol)
    }
  }
  return symbols
}

async function newestClosePerSymbol() {
  const since = isoDate(new Date(Date.now() - 400 * 86_400_000))
  const rows = await all(`price_history_cache?select=symbol,date&date=gte.${since}`)
  const newest = new Map()
  for (const r of rows) {
    const prev = newest.get(r.symbol)
    if (!prev || r.date > prev) newest.set(r.symbol, r.date)
  }
  return newest
}

async function newestWeightDate() {
  const rows = await rest('portfolio_benchmark_weights?select=as_of_date&order=as_of_date.desc&limit=1')
  return rows[0]?.as_of_date ?? null
}

/**
 * Run every assertion against a set of thresholds and return the failures.
 *
 * Separated from the printing so `--self-test` can run it a second time with
 * impossible thresholds and compare.
 */
export function assess({ held, newest, newestOverall, weightDate }, thresholds, now) {
  const failures = []

  if (newestOverall == null) {
    failures.push('price_history_cache is empty')
  } else {
    const age = daysBetween(now, parseDate(newestOverall))
    if (age > thresholds.newestCloseMaxAgeDays) {
      failures.push(
        `the newest close in price_history_cache is ${age} days old (${newestOverall}); ` +
        `the daily-close policy allows ${thresholds.newestCloseMaxAgeDays}`,
      )
    }
  }

  /*
   * Known-unpriceable names are set aside rather than widening the window.
   * `appliedExceptions` is returned so the caller can print every one that
   * was used, and `spentExceptions` so an entry that has started passing is
   * reported as finished work instead of being carried forever.
   */
  const excepted = unpriceableSet()
  const unpriced = []
  const appliedExceptions = []
  const spentExceptions = []
  for (const [pricing, book] of held) {
    const d = newest.get(pricing)
    const age = d ? daysBetween(now, parseDate(d)) : null
    const stale = age == null || age > thresholds.closeWindowDays
    if (excepted.has(pricing)) {
      if (stale) appliedExceptions.push({ pricing, book, age })
      else spentExceptions.push({ pricing, book, age })
      continue
    }
    if (stale) unpriced.push({ pricing, book, age })
  }
  if (unpriced.length > 0) {
    failures.push(
      `${unpriced.length} of ${held.size} held symbols have no close within ` +
      `${thresholds.closeWindowDays} days, so the app falls through to the undated ` +
      'assets.current_price for them',
    )
  }

  for (const s of spentExceptions) {
    failures.push(
      `${s.pricing} is listed in market-data-exceptions.mjs but now prices fine ` +
      `(newest close ${s.age} days old). Remove the entry.`,
    )
  }

  if (weightDate == null) {
    failures.push('portfolio_benchmark_weights is empty')
  } else {
    const age = daysBetween(now, parseDate(weightDate))
    if (age > thresholds.weightsMaxAgeDays) {
      failures.push(
        `the newest benchmark weight file is ${age} days old (${weightDate}); ` +
        `allowed ${thresholds.weightsMaxAgeDays}`,
      )
    }
  }

  return { failures, unpriced, appliedExceptions, spentExceptions }
}

async function main() {
  const now = today()
  const thresholds = {
    closeWindowDays: CLOSE_WINDOW_DAYS,
    newestCloseMaxAgeDays: NEWEST_CLOSE_MAX_AGE_DAYS,
    weightsMaxAgeDays: WEIGHTS_MAX_AGE_DAYS,
  }

  const held = await heldSymbols()
  const newest = await newestClosePerSymbol()
  const weightDate = await newestWeightDate()
  let newestOverall = null
  for (const d of newest.values()) if (!newestOverall || d > newestOverall) newestOverall = d

  const state = { held, newest, newestOverall, weightDate }
  const { failures, unpriced, appliedExceptions } = assess(state, thresholds, now)

  console.log(`checked at                    : ${now.toISOString()}`)
  console.log(`held symbols (tradable)       : ${held.size}`)
  console.log(`symbols with any stored close : ${newest.size}`)
  console.log(`newest close in the table     : ${newestOverall ?? 'NONE'}` +
    (newestOverall ? ` (${daysBetween(now, parseDate(newestOverall))} days old)` : ''))
  console.log(`newest benchmark weight file  : ${weightDate ?? 'NONE'}` +
    (weightDate ? ` (${daysBetween(now, parseDate(weightDate))} days old)` : ''))
  console.log(`held symbols priced within ${String(thresholds.closeWindowDays).padStart(2)}d : ` +
    `${held.size - unpriced.length - appliedExceptions.length} of ${held.size}` +
    (appliedExceptions.length ? ` (+${appliedExceptions.length} excepted)` : ''))
  console.log(`thresholds                    : close window ${thresholds.closeWindowDays}d, ` +
    `newest close ${thresholds.newestCloseMaxAgeDays}d, weights ${thresholds.weightsMaxAgeDays}d`)

  // Printed every run, never silent. A suppression nobody sees is how a real
  // gap hides behind a green check.
  if (appliedExceptions.length > 0) {
    console.log('')
    console.log(`known-unpriceable symbols set aside (${appliedExceptions.length} of ` +
      `${UNPRICEABLE_SYMBOLS.length} listed):`)
    for (const e of appliedExceptions) {
      const entry = UNPRICEABLE_SYMBOLS.find((x) => x.symbol.toUpperCase() === e.pricing)
      console.log(`  ${String(e.pricing).padEnd(10)} ${entry?.reason ?? 'no reason recorded'}`)
      console.log(`  ${''.padEnd(10)} recorded ${entry?.recordedOn ?? '?'}, fix: ${entry?.fixBy ?? '?'}`)
    }
  }

  if (unpriced.length > 0) {
    const show = EXPLAIN ? unpriced : unpriced.slice(0, 12)
    console.log('')
    console.log('symbols without a usable close:')
    for (const u of show) {
      console.log(`  ${String(u.book).padEnd(10)} -> ${String(u.pricing).padEnd(10)} ` +
        (u.age == null ? 'no stored close at all' : `newest is ${u.age} days old`))
    }
    if (!EXPLAIN && unpriced.length > show.length) {
      console.log(`  ... and ${unpriced.length - show.length} more (--explain lists all)`)
    }
  }

  if (SELF_TEST) {
    console.log('')
    console.log('── self-test: the same assertions at thresholds nothing can meet ──')
    const impossible = { closeWindowDays: -1, newestCloseMaxAgeDays: -1, weightsMaxAgeDays: -1 }
    const inverted = assess(state, impossible, now)
    const caught = inverted.failures.length
    console.log(`failures reported at impossible thresholds: ${caught}`)
    for (const f of inverted.failures) console.log(`  would report: ${f}`)
    if (caught < 3) {
      console.log('')
      console.log('FAIL: the self-test expected all three assertions to fire and ' +
        `only ${caught} did. This check cannot observe its own failure mode.`)
      process.exit(1)
    }
    console.log('self-test PASS: every assertion fires when it should.')
  }

  console.log('')
  if (failures.length === 0) {
    console.log('PASS: market data is current.')
    process.exit(0)
  }
  for (const f of failures) console.log(`FAIL: ${f}`)
  console.log('')
  console.log(`FAIL: ${failures.length} freshness assertion(s) failed.`)
  process.exit(1)
}

if (IS_MAIN) main().catch((e) => {
  // A check that cannot complete has not passed. Exit 2 so a caller can tell
  // "the data is stale" from "the check itself broke" -- the ingestion outage
  // was a credential failure, and a check that reports those identically
  // would have been just as quiet.
  console.log(`FAIL: the freshness check could not complete: ${e.message}`)
  process.exit(2)
})
