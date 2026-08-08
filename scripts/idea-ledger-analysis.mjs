#!/usr/bin/env node
/**
 * idea-ledger-analysis.mjs
 *
 * READ-ONLY. Writes nothing to the database. Ever.
 *
 * Answers the question the product doesn't currently ask: what happened to
 * the ideas nobody acted on?
 *
 * The Decision Outcomes page follows approved ideas into execution and drops
 * rejected/deferred/cancelled ones on the floor (`showRejected` defaults to
 * false, and every impact metric filters `stage === 'approved'`). But the
 * ideas that were passed on are the larger and more interesting half: nobody
 * anywhere can tell you whether the calls they *didn't* make were right.
 *
 * This script reconstructs that retroactively from data that already exists,
 * so the thesis can be tested before any feature is built.
 *
 * ── How a price anchor is resolved ──────────────────────────────────────────
 * For each idea, in order:
 *   1. decision_price_snapshots for the matching snapshot_type (exact, cheap)
 *   2. the daily close on the decision date, from Yahoo (backfill)
 *   3. unscoreable — counted and reported, never silently dropped
 *
 * Step 3 matters as much as the others. If most ideas can't be anchored, that
 * is the finding, and it says build the recorder before the report.
 *
 * ── How "right" is defined ─────────────────────────────────────────────────
 * Direction-adjusted against the idea's action:
 *   buy / add   → the idea wanted MORE exposure; the asset going up means the
 *                 idea was right, so passing on it was a MISS.
 *   sell / trim → the idea wanted LESS exposure; the asset going down means
 *                 the idea was right, so passing on it was a MISS.
 * A pass is a DODGE when the idea would have been wrong.
 *
 * Daily closes only — no intraday. Noisier data would not change any
 * conclusion at these horizons and would make the numbers harder to defend.
 *
 * The headline output is not the pass hit-rate on its own — that number is
 * meaningless in isolation. It is the comparison between ideas that were
 * acted on and ideas that were passed on, by the same people. If the passes
 * beat the acts, that is worth knowing and nothing today would surface it.
 *
 * ── Usage ──────────────────────────────────────────────────────────────────
 *   SUPABASE_URL=... SUPABASE_SERVICE_KEY=... node scripts/idea-ledger-analysis.mjs
 *
 *   --org <uuid>            restrict to one organization
 *   --user <uuid>           restrict to one creator
 *   --since <ISO date>      ignore ideas created before this (default: all time)
 *   --min-days <n>          skip ideas anchored fewer than n days ago (default 30)
 *   --silent-pass-days <n>  idle days before an open idea counts as a pass (default 60)
 *   --limit <n>             cap ideas fetched (default 5000)
 *   --csv <path>            also write the per-idea rows to CSV
 *   --no-backfill           snapshots only; skip all Yahoo calls
 *   --input <path>          read ideas from a JSON dump instead of Supabase.
 *                           Skips the DB entirely, so no service key is needed
 *                           and the same run can be repeated offline. The file
 *                           is an array of trade_queue_items rows with an
 *                           `assets` object attached, plus an optional
 *                           `snapshots` object keyed by trade_queue_item_id.
 */

import { createClient } from '@supabase/supabase-js'
import { writeFile, readFile } from 'node:fs/promises'

// ============================================================
// Config
// ============================================================

function arg(name, fallback = undefined) {
  const i = process.argv.indexOf(`--${name}`)
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback
}
function flag(name) {
  return process.argv.includes(`--${name}`)
}

const OPTS = {
  org: arg('org'),
  user: arg('user'),
  since: arg('since'),
  minDays: Number(arg('min-days', '30')),
  silentPassDays: Number(arg('silent-pass-days', '60')),
  limit: Number(arg('limit', '5000')),
  csv: arg('csv'),
  input: arg('input'),
  backfill: !flag('no-backfill'),
}

// Credentials are only needed when reading from the database. With --input the
// rows are already on disk, so the script runs with no Supabase access at all.
const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.VITE_SUPABASE_ANON_KEY

if (!OPTS.input && (!SUPABASE_URL || !SUPABASE_KEY)) {
  console.error('ERROR: Set SUPABASE_URL and SUPABASE_SERVICE_KEY (or VITE_ variants),')
  console.error('       or pass --input <path> to analyse a JSON dump instead.')
  process.exit(1)
}

const supabase = OPTS.input
  ? null
  : createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } })

/** Ideas that were acted on. */
const ACTED = new Set(['approved', 'executed'])
/** Ideas that were consciously not acted on. */
const PASSED = new Set(['rejected', 'cancelled'])
/** Not yet dispositioned. Split into open vs silent_pass by idle time. */
const OPEN = new Set(['idea', 'discussing', 'deciding', 'simulating'])

/** status → snapshot_type recorded by decision-snapshot-service. */
const STATUS_SNAPSHOT_TYPE = {
  approved: 'approval',
  executed: 'approval',
  rejected: 'rejection',
  cancelled: 'cancellation',
}

/** Actions wanting MORE exposure; the rest want less. */
const LONG_ACTIONS = new Set(['buy', 'add'])

const DAY_MS = 86_400_000

// ============================================================
// Fetch
// ============================================================

/** Ideas from a JSON dump, with the same client-side filters as the DB path. */
async function loadIdeasFromFile(path) {
  const parsed = JSON.parse(await readFile(path, 'utf8'))
  const all = Array.isArray(parsed) ? parsed : parsed.ideas || []
  return all
    .filter(i => !i.deleted_at)
    .filter(i => !OPTS.org || i.organization_id === OPTS.org)
    .filter(i => !OPTS.user || i.created_by === OPTS.user)
    .filter(i => !OPTS.since || i.created_at >= OPTS.since)
    .slice(0, OPTS.limit)
}

async function fetchIdeas() {
  if (OPTS.input) return loadIdeasFromFile(OPTS.input)

  let q = supabase
    .from('trade_queue_items')
    .select(
      'id, asset_id, portfolio_id, organization_id, action, status, stage, outcome, ' +
      'outcome_at, decision_outcome, decided_at, deferred_until, created_at, created_by, ' +
      'updated_at, stage_changed_at, archived_at, target_price, conviction, rationale, ' +
      'assets:asset_id(id, symbol, company_name, current_price)',
    )
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .limit(OPTS.limit)

  if (OPTS.org) q = q.eq('organization_id', OPTS.org)
  if (OPTS.user) q = q.eq('created_by', OPTS.user)
  if (OPTS.since) q = q.gte('created_at', OPTS.since)

  const { data, error } = await q
  if (error) throw new Error(`Fetch ideas failed: ${error.message}`)
  return data || []
}

async function fetchSnapshots(ideaIds, ideas) {
  const byIdea = new Map()

  // --input dumps may carry snapshots inline on each row.
  if (OPTS.input) {
    for (const i of ideas) {
      if (i.snapshots && Object.keys(i.snapshots).length > 0) byIdea.set(i.id, i.snapshots)
    }
    return byIdea
  }

  const CHUNK = 200
  for (let i = 0; i < ideaIds.length; i += CHUNK) {
    const { data, error } = await supabase
      .from('decision_price_snapshots')
      .select('trade_queue_item_id, snapshot_type, snapshot_price, snapshot_at')
      .in('trade_queue_item_id', ideaIds.slice(i, i + CHUNK))
    if (error) throw new Error(`Fetch snapshots failed: ${error.message}`)
    for (const row of data || []) {
      if (!byIdea.has(row.trade_queue_item_id)) byIdea.set(row.trade_queue_item_id, {})
      byIdea.get(row.trade_queue_item_id)[row.snapshot_type] = {
        price: Number(row.snapshot_price),
        at: row.snapshot_at,
      }
    }
  }
  return byIdea
}

// ============================================================
// Yahoo daily closes
// ============================================================

/**
 * One request per symbol covering the full window any idea on it needs,
 * then closes are looked up by date. Keeps this to ~N requests for N
 * distinct tickers rather than one per idea.
 */
async function fetchDailyCloses(symbol, fromMs, toMs) {
  const period1 = Math.floor((fromMs - 7 * DAY_MS) / 1000)
  const period2 = Math.floor((toMs + DAY_MS) / 1000)
  const url =
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}` +
    `?interval=1d&period1=${period1}&period2=${period2}`

  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; TesseractLedger/1.0)' },
  })
  if (!res.ok) return null

  const json = await res.json()
  const result = json?.chart?.result?.[0]
  const stamps = result?.timestamp
  const closes = result?.indicators?.quote?.[0]?.close
  if (!Array.isArray(stamps) || !Array.isArray(closes)) return null

  // date (YYYY-MM-DD, UTC) → close
  const series = new Map()
  for (let i = 0; i < stamps.length; i++) {
    const c = closes[i]
    if (c == null || !isFinite(c)) continue
    series.set(new Date(stamps[i] * 1000).toISOString().slice(0, 10), Number(c))
  }
  return series
}

/** Close on `date`, walking back up to 5 days over weekends/holidays. */
function closeOnOrBefore(series, date) {
  if (!series) return null
  const d = new Date(date)
  for (let i = 0; i < 6; i++) {
    const key = d.toISOString().slice(0, 10)
    if (series.has(key)) return series.get(key)
    d.setUTCDate(d.getUTCDate() - 1)
  }
  return null
}

async function mapWithConcurrency(items, limit, fn) {
  const out = new Array(items.length)
  let cursor = 0
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (cursor < items.length) {
        const i = cursor++
        try {
          out[i] = await fn(items[i], i)
        } catch {
          out[i] = null
        }
      }
    }),
  )
  return out
}

// ============================================================
// Classification
// ============================================================

/**
 * An idea sitting untouched in an open stage for months is a pass. Nobody
 * clicked reject, but nobody acted either, and not deciding is deciding.
 *
 * This is not a hypothetical: as of Aug 2026, production held 114 open ideas
 * against 2 explicitly rejected ones, and 86% of the open ones had been idle
 * 30+ days. Scoring only the explicit rejections would measure almost nothing.
 * Silent passes are the real inventory.
 */
function idleDays(idea) {
  const touched = idea.stage_changed_at || idea.updated_at || idea.created_at
  return (Date.now() - new Date(touched).getTime()) / DAY_MS
}

function classify(idea) {
  const status = idea.status
  if (ACTED.has(status)) return 'acted'
  if (PASSED.has(status)) return 'passed'
  if (idea.outcome === 'deferred' || idea.decision_outcome === 'deferred') return 'passed'
  if (status === 'archived') return idea.outcome ? 'passed' : 'abandoned'
  if (OPEN.has(status)) {
    return idleDays(idea) >= OPTS.silentPassDays ? 'silent_pass' : 'open'
  }
  return 'other'
}

/**
 * The date the price anchor is taken from.
 *
 * Explicit dispositions anchor at the decision. Silent passes and abandoned
 * ideas anchor at CREATION — the honest question for an idea nobody ever
 * dispositioned is "I thought of this and never acted; what would it have
 * done", and creation is the only moment that was ever real.
 */
function decisionDate(idea) {
  const d = classify(idea)
  if (d === 'silent_pass' || d === 'abandoned') return idea.created_at
  return idea.outcome_at || idea.decided_at || idea.archived_at || idea.created_at
}

/** Return the idea implied, sign-adjusted for direction. */
function directionalReturn(anchorPrice, currentPrice, action) {
  const raw = (currentPrice - anchorPrice) / anchorPrice
  return LONG_ACTIONS.has(action) ? raw : -raw
}

// ============================================================
// Main
// ============================================================

async function main() {
  console.log('Idea Ledger — retroactive analysis (read-only)\n')

  const ideas = await fetchIdeas()
  console.log(`Fetched ${ideas.length} ideas.`)
  if (ideas.length === 0) {
    console.log('\nNothing to analyse. Widen --since / --limit, or check org filter.')
    return
  }

  const snapshots = await fetchSnapshots(ideas.map(i => i.id), ideas)
  console.log(`Found snapshots for ${snapshots.size} of them.\n`)

  // ── Bucket ──
  const buckets = { acted: [], passed: [], silent_pass: [], open: [], abandoned: [], other: [] }
  for (const idea of ideas) buckets[classify(idea)].push(idea)

  const cutoff = Date.now() - OPTS.minDays * DAY_MS
  const scorable = [
    ...buckets.acted, ...buckets.passed, ...buckets.silent_pass, ...buckets.abandoned,
  ].filter(i => {
    const d = decisionDate(i)
    return d && new Date(d).getTime() <= cutoff && i.assets?.symbol
  })

  console.log('DISPOSITION')
  console.log(`  acted on          ${String(buckets.acted.length).padStart(5)}`)
  console.log(`  passed (explicit) ${String(buckets.passed.length).padStart(5)}  (rejected / cancelled / deferred)`)
  console.log(`  passed (silent)   ${String(buckets.silent_pass.length).padStart(5)}  (open, untouched ${OPTS.silentPassDays}d+)`)
  console.log(`  abandoned         ${String(buckets.abandoned.length).padStart(5)}  (archived, no outcome set)`)
  console.log(`  still active      ${String(buckets.open.length).padStart(5)}`)
  console.log(`  other             ${String(buckets.other.length).padStart(5)}`)
  console.log(`  → eligible        ${String(scorable.length).padStart(5)}  (anchor >${OPTS.minDays}d ago, has ticker)\n`)

  // ── Price series: one fetch per symbol, anchor date → today ──
  // Fetched for every scorable symbol rather than only the ones missing a
  // snapshot, because the tail of the same series is also the fallback for
  // assets.current_price. In production 80 of 179 assets had no cached
  // current price, so without this fallback nearly half the sample is
  // silently unscoreable.
  const windows = new Map() // symbol → earliest anchor ms
  for (const idea of scorable) {
    const sym = idea.assets.symbol
    const t = new Date(decisionDate(idea)).getTime()
    windows.set(sym, Math.min(windows.get(sym) ?? t, t))
  }

  const seriesBySymbol = new Map()
  if (OPTS.backfill && windows.size > 0) {
    console.log(`Fetching daily closes for ${windows.size} tickers...`)
    const entries = [...windows.entries()]
    const results = await mapWithConcurrency(entries, 4, async ([sym, lo]) =>
      [sym, await fetchDailyCloses(sym, lo, Date.now())],
    )
    for (const r of results) if (r && r[1]) seriesBySymbol.set(r[0], r[1])
    console.log(`  resolved ${seriesBySymbol.size}/${windows.size}\n`)
  }

  /** Most recent close in a series, used when assets.current_price is unset. */
  const latestClose = sym => {
    const s = seriesBySymbol.get(sym)
    if (!s || s.size === 0) return null
    return s.get([...s.keys()].sort().pop())
  }

  // ── Score ──
  const rows = []
  const unscoreable = { noAnchor: 0, noCurrent: 0 }

  for (const idea of scorable) {
    const symbol = idea.assets.symbol
    const dDate = decisionDate(idea)
    const type = STATUS_SNAPSHOT_TYPE[idea.status]

    let anchor = null
    let anchorSource = null
    const snap = type ? snapshots.get(idea.id)?.[type] : null
    if (snap?.price > 0) {
      anchor = snap.price
      anchorSource = 'snapshot'
    } else {
      const c = closeOnOrBefore(seriesBySymbol.get(symbol), dDate)
      if (c > 0) {
        anchor = c
        anchorSource = 'backfill'
      }
    }
    if (!anchor) { unscoreable.noAnchor++; continue }

    let current = Number(idea.assets.current_price)
    let currentSource = 'assets.current_price'
    if (!(current > 0)) {
      current = Number(latestClose(symbol))
      currentSource = 'latest_close'
    }
    if (!(current > 0)) { unscoreable.noCurrent++; continue }

    const disposition = classify(idea)
    const ret = directionalReturn(anchor, current, idea.action)

    rows.push({
      id: idea.id,
      symbol,
      company: idea.assets.company_name || '',
      action: idea.action,
      disposition,
      status: idea.status,
      decided_at: dDate,
      days_since: Math.round((Date.now() - new Date(dDate).getTime()) / DAY_MS),
      anchor_price: anchor,
      anchor_source: anchorSource,
      current_price: current,
      current_source: currentSource,
      idea_return_pct: ret * 100,
      // For any flavour of pass: the idea being right means passing was a miss.
      verdict: disposition === 'acted'
        ? (ret > 0.001 ? 'right' : ret < -0.001 ? 'wrong' : 'flat')
        : (ret > 0.001 ? 'miss' : ret < -0.001 ? 'dodge' : 'flat'),
      created_by: idea.created_by,
      organization_id: idea.organization_id,
      conviction: idea.conviction || '',
    })
  }

  console.log('COVERAGE')
  console.log(`  scored            ${String(rows.length).padStart(5)}`)
  console.log(`    from snapshot   ${String(rows.filter(r => r.anchor_source === 'snapshot').length).padStart(5)}`)
  console.log(`    from backfill   ${String(rows.filter(r => r.anchor_source === 'backfill').length).padStart(5)}`)
  console.log(`  no anchor price   ${String(unscoreable.noAnchor).padStart(5)}`)
  console.log(`  no current price  ${String(unscoreable.noCurrent).padStart(5)}\n`)

  if (rows.length === 0) {
    console.log('Nothing scoreable. That is itself the finding: the data to answer')
    console.log('this question is not being recorded yet.')
    return
  }

  // ── The headline comparison ──
  const acted = rows.filter(r => r.disposition === 'acted')
  const passedExplicit = rows.filter(r => r.disposition === 'passed')
  const passedSilent = rows.filter(r => r.disposition === 'silent_pass' || r.disposition === 'abandoned')
  const passed = [...passedExplicit, ...passedSilent]

  const median = xs => {
    if (xs.length === 0) return null
    const s = [...xs].sort((a, b) => a - b)
    const m = s.length >> 1
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
  }
  const pct = (n, d) => (d === 0 ? '—' : `${((n / d) * 100).toFixed(0)}%`)
  const fmt = v => (v == null ? '—' : `${v >= 0 ? '+' : ''}${v.toFixed(1)}%`)

  console.log('THE COMPARISON  (the number that matters)')
  console.log('                        n      right   median idea return')
  const line = (label, list, rightVerdict) => console.log(
    `  ${label.padEnd(18)}${String(list.length).padStart(5)}` +
    `      ${pct(list.filter(r => r.verdict === rightVerdict).length, list.length).padStart(4)}` +
    `      ${fmt(median(list.map(r => r.idea_return_pct))).padStart(7)}`,
  )
  line('acted on', acted, 'right')
  line('passed (explicit)', passedExplicit, 'dodge')
  line('passed (silent)', passedSilent, 'dodge')
  line('all passes', passed, 'dodge')
  console.log('\n  "right" = the idea worked. For a pass, that means the pass was a MISS,')
  console.log('  so the passed-on row shows the share correctly DODGED. If passes and')
  console.log('  acts score alike, selection is adding nothing — that is the finding.\n')

  const misses = passed.filter(r => r.verdict === 'miss').sort((a, b) => b.idea_return_pct - a.idea_return_pct)
  const dodges = passed.filter(r => r.verdict === 'dodge').sort((a, b) => a.idea_return_pct - b.idea_return_pct)

  const table = (title, list) => {
    if (list.length === 0) return
    console.log(title)
    for (const r of list.slice(0, 10)) {
      console.log(
        `  ${r.symbol.padEnd(8)} ${r.action.padEnd(5)} ` +
        `${String(r.days_since).padStart(4)}d  ` +
        `${fmt(r.idea_return_pct).padStart(8)}  ${r.disposition}`,
      )
    }
    console.log()
  }
  table('BIGGEST MISSES  (passed on, idea would have worked)', misses)
  table('BEST DODGES  (passed on, idea would have failed)', dodges)

  // ── Per-person, only where n is large enough to mean anything ──
  const byUser = new Map()
  for (const r of rows) {
    if (!r.created_by) continue
    if (!byUser.has(r.created_by)) byUser.set(r.created_by, [])
    byUser.get(r.created_by).push(r)
  }
  const meaningful = [...byUser.entries()].filter(([, rs]) => rs.length >= 10)
  if (meaningful.length > 0) {
    console.log('BY PERSON  (n >= 10 only; smaller samples are noise)')
    for (const [uid, rs] of meaningful) {
      const a = rs.filter(r => r.disposition === 'acted')
      const p = rs.filter(r => r.disposition !== 'acted')
      console.log(
        `  ${uid.slice(0, 8)}  acted ${String(a.length).padStart(3)} ` +
        `(${pct(a.filter(r => r.verdict === 'right').length, a.length)})   ` +
        `passed ${String(p.length).padStart(3)} ` +
        `(${pct(p.filter(r => r.verdict === 'dodge').length, p.length)} dodged)`,
      )
    }
    console.log()
  } else {
    console.log('BY PERSON  skipped — nobody has 10+ scoreable ideas yet.\n')
  }

  if (OPTS.csv) {
    const cols = Object.keys(rows[0])
    const esc = v => {
      const s = v == null ? '' : String(v)
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
    }
    const csv = [cols.join(','), ...rows.map(r => cols.map(c => esc(r[c])).join(','))].join('\n')
    await writeFile(OPTS.csv, csv, 'utf8')
    console.log(`Wrote ${rows.length} rows → ${OPTS.csv}`)
  }
}

main().catch(err => {
  console.error('\nFAILED:', err.message)
  process.exit(1)
})
