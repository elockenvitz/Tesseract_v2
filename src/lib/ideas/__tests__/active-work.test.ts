/**
 * The canonical active-work predicate, and the surfaces that must share it.
 *
 * ── What went wrong ──────────────────────────────────────────────────────
 *
 * Four surfaces answered "is this idea active work?" and each wrote its own
 * filter. The Ideas Pipeline board composed four rules; the Quick Capture
 * picker composed one (`isLiveIdea`) over a three-column select. So the
 * picker badged four untouched pilot seeds as "In pipeline" that graduation
 * had already retired from the board the badge was named after.
 *
 * These tests encode the production rows that exposed it — Raven Capital,
 * graduated 2026-09-29 — because a fixture invented from the predicate's own
 * shape would have passed against the broken code too.
 *
 * ── The guard at the bottom matters as much as the matrix ────────────────
 *
 * A fifth surface asking the same question with a weaker filter would
 * reintroduce this silently. `describe('no surface reinvents...')` reads the
 * actual source of each named call site and fails if it goes back to testing
 * liveness alone, or selects fewer columns than the predicate reads.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  isActiveIdeaWork,
  activeIdeaWork,
  isDeferredResurfaced,
  ACTIVE_WORK_SELECT,
  type ActiveWorkRow,
} from '../active-work'

const SRC = resolve(__dirname, '../../..')
/** Strip comments, so prose about a rule can never satisfy an assertion. */
const codeOf = (s: string) =>
  s.split('\n').map(l => l.replace(/\/\/.*$/, '')).join('\n').replace(/\/\*[\s\S]*?\*\//g, '')
const read = (p: string) => codeOf(readFileSync(resolve(SRC, p), 'utf8'))

const GRADUATED = { hasGraduated: true }
const IN_PILOT = { hasGraduated: false }

/** A plain, live, nobody-touched-it idea. The baseline every case varies. */
const liveIdea = (over: Partial<ActiveWorkRow> = {}): ActiveWorkRow => ({
  status: 'idea',
  outcome: null,
  visibility_tier: 'active',
  revisit_at: null,
  deferred_until: null,
  origin_metadata: null,
  accepted_trades: [],
  decision_requests: [],
  ...over,
})

/** A pilot seed: the marker, and nothing done to it since. */
const untouchedSeed = (over: Partial<ActiveWorkRow> = {}): ActiveWorkRow =>
  liveIdea({ origin_metadata: { pilot_seed: true }, ...over })

/** A pilot seed a person has since decided and executed. */
const workedSeed = (over: Partial<ActiveWorkRow> = {}): ActiveWorkRow =>
  untouchedSeed({
    accepted_trades: [{ is_active: true, reverted_at: null }],
    ...over,
  })

// ───────────────────────────────────────────────────────────────────────────
// The production rows that exposed the defect
// ───────────────────────────────────────────────────────────────────────────

describe('the four seeds the picker badged and the board did not', () => {
  /*
   * META, AMZN, MSFT, NVDA. Every one is `visibility_tier = 'active'` with a
   * null `outcome`, so `isLiveIdea` says live and the old badge fired. Every
   * one carries `pilot_seed` with zero artifacts, so the board dropped it at
   * graduation. AMZN is the interesting one: its status is `deciding`, which
   * is why it also raised a false "stalled decision" Action Loop card.
   */
  const SEEDS = [
    { name: 'META', status: 'idea' },
    { name: 'AMZN', status: 'deciding' },
    { name: 'MSFT', status: 'idea' },
    { name: 'NVDA', status: 'idea' },
  ]

  for (const { name, status } of SEEDS) {
    it(`${name} (${status}, untouched seed) is not active work after graduation`, () => {
      expect(isActiveIdeaWork(untouchedSeed({ status }), GRADUATED)).toBe(false)
    })

    it(`${name} IS active work before graduation, so the pilot still works`, () => {
      // The seeds are the product during the tour. Suppressing them early
      // would empty the thing the reader is being shown.
      expect(isActiveIdeaWork(untouchedSeed({ status }), IN_PILOT)).toBe(true)
    })
  }

  it('drops exactly those four and keeps the real ideas, in one pass', () => {
    const rows = [
      untouchedSeed({ status: 'idea' }),       // META
      untouchedSeed({ status: 'deciding' }),   // AMZN
      untouchedSeed({ status: 'idea' }),       // MSFT
      untouchedSeed({ status: 'idea' }),       // NVDA
      liveIdea({ status: 'idea' }),            // AAPL  1c92e5bb — not a seed
      liveIdea({ status: 'deciding' }),        // LLY   d95b6ecf
      liveIdea({ status: 'idea' }),            // SHOP  7db68a06
    ]
    expect(activeIdeaWork(rows, GRADUATED)).toHaveLength(3)
    expect(activeIdeaWork(rows, IN_PILOT)).toHaveLength(7)
  })
})

describe('a seed somebody actually worked stays active', () => {
  it('counts a live accepted trade as genuine work', () => {
    // The pilot's one real outcome must not be deleted from the record by
    // the rule that retires the tour.
    expect(isActiveIdeaWork(workedSeed(), GRADUATED)).toBe(true)
  })

  it('counts a decided decision request as genuine work', () => {
    const row = untouchedSeed({
      decision_requests: [{ status: 'accepted', created_at: '2026-09-28T00:00:00Z' }],
    })
    expect(isActiveIdeaWork(row, GRADUATED)).toBe(true)
  })

  it('AAPL 1e764137 — a worked seed that then executed — is still not active', () => {
    /*
     * Worked AND terminal. The seed rule readmits it, and liveness then
     * rejects it on `status = 'executed'`. Both clauses have to run: a
     * predicate that short-circuited on "worked seed" would call an executed
     * trade open work.
     */
    const row = workedSeed({ status: 'executed' })
    expect(isActiveIdeaWork(row, GRADUATED)).toBe(false)
    expect(isActiveIdeaWork(row, IN_PILOT)).toBe(false)
  })

  it('a reverted trade does not count as work, so the seed retires again', () => {
    const row = untouchedSeed({
      accepted_trades: [{ is_active: false, reverted_at: '2026-09-30T00:00:00Z' }],
    })
    expect(isActiveIdeaWork(row, GRADUATED)).toBe(false)
  })
})

// ───────────────────────────────────────────────────────────────────────────
// Liveness
// ───────────────────────────────────────────────────────────────────────────

describe('liveness, including the case the picker got wrong', () => {
  it.each(['approved', 'executed', 'rejected', 'cancelled', 'archived', 'deleted'])(
    '%s is not active work even with outcome NULL',
    (status) => {
      /*
       * This is the leak the picker and `useAssetTradeIdeas` both had: they
       * tested `outcome IS NULL` or `isLiveIdea` over a select that omitted
       * `outcome`, so a terminal STATUS with no recorded outcome read as
       * open. In production that is most terminal rows — `outcome` is null on
       * nearly all of them.
       */
      expect(isActiveIdeaWork(liveIdea({ status, outcome: null }), GRADUATED)).toBe(false)
    },
  )

  it('MU 5904a82a (executed) is not active work', () => {
    expect(isActiveIdeaWork(liveIdea({ status: 'executed' }), GRADUATED)).toBe(false)
  })

  it('an outcome outranks a non-terminal status', () => {
    expect(isActiveIdeaWork(liveIdea({ status: 'idea', outcome: 'closed' }), GRADUATED)).toBe(false)
  })

  it('an empty-string outcome is not an outcome', () => {
    // Whitespace is absence, not a conclusion.
    expect(isActiveIdeaWork(liveIdea({ outcome: '  ' }), GRADUATED)).toBe(true)
  })

  it.each(['idea', 'deciding', 'research', 'monitoring'])(
    '%s is active work',
    (status) => {
      expect(isActiveIdeaWork(liveIdea({ status }), GRADUATED)).toBe(true)
    },
  )
})

// ───────────────────────────────────────────────────────────────────────────
// Parked
// ───────────────────────────────────────────────────────────────────────────

describe('parked work', () => {
  const now = new Date('2026-10-05T12:00:00Z')

  it('a snoozed idea is not active work', () => {
    // The snooze dialog promises it hides the idea "from your pipeline, feed
    // and attention list". Every surface has to honour that, not just the
    // desktop board that happened to read the column.
    const row = liveIdea({ revisit_at: '2026-10-20T00:00:00Z' })
    expect(isActiveIdeaWork(row, { hasGraduated: true, now })).toBe(false)
  })

  it('comes back on its own once the date passes', () => {
    const row = liveIdea({ revisit_at: '2026-10-01T00:00:00Z' })
    expect(isActiveIdeaWork(row, { hasGraduated: true, now })).toBe(true)
  })

  it('a null revisit_at is not parked', () => {
    expect(isActiveIdeaWork(liveIdea({ revisit_at: null }), { hasGraduated: true, now })).toBe(true)
  })

  it('an unparseable revisit_at is not parked', () => {
    // A bad date must not silently delete the idea from every surface.
    expect(isActiveIdeaWork(liveIdea({ revisit_at: 'not-a-date' }), { hasGraduated: true, now })).toBe(true)
  })
})

// ───────────────────────────────────────────────────────────────────────────
// Deferred resurfacing — the clause that keeps parity with the board
// ───────────────────────────────────────────────────────────────────────────

describe('deferred resurfacing', () => {
  const now = new Date('2026-10-05T12:00:00Z')

  it('a cancelled idea whose date has passed IS active work again', () => {
    /*
     * Without this the predicate would be STRICTER than the Ideas Pipeline
     * and hide work the board shows — the same disagreement the fix exists to
     * remove, pointing the other way.
     */
    const row = liveIdea({ status: 'cancelled', deferred_until: '2026-10-01T00:00:00Z' })
    expect(isActiveIdeaWork(row, { hasGraduated: true, now })).toBe(true)
  })

  it('a cancelled idea with a future date is not', () => {
    const row = liveIdea({ status: 'cancelled', deferred_until: '2026-11-01T00:00:00Z' })
    expect(isActiveIdeaWork(row, { hasGraduated: true, now })).toBe(false)
  })

  it('a cancelled idea with no date stays deferred forever', () => {
    const row = liveIdea({ status: 'cancelled', deferred_until: null })
    expect(isActiveIdeaWork(row, { hasGraduated: true, now })).toBe(false)
  })

  it('resurfaces on the day itself, read as a local calendar date', () => {
    // `deferred_until` is stored as UTC midnight but means a date the user
    // picked. Comparing raw timestamps would fire a day early or late
    // depending on the reader's offset.
    const row = { status: 'cancelled', outcome: null, deferred_until: '2026-10-05T00:00:00Z' }
    expect(isDeferredResurfaced(row, new Date('2026-10-05T00:30:00'))).toBe(true)
    expect(isDeferredResurfaced(row, new Date('2026-10-04T23:30:00'))).toBe(false)
  })

  it('a recorded outcome outranks the deferral', () => {
    // Deliberately stricter than the board, which predates `outcome`.
    // Resurfacing an idea that reached a conclusion contradicts the record.
    const row = liveIdea({ status: 'cancelled', outcome: 'closed', deferred_until: '2026-10-01T00:00:00Z' })
    expect(isActiveIdeaWork(row, { hasGraduated: true, now })).toBe(false)
  })

  it('only `cancelled` defers — a rejected idea does not resurface', () => {
    const row = liveIdea({ status: 'rejected', deferred_until: '2026-10-01T00:00:00Z' })
    expect(isActiveIdeaWork(row, { hasGraduated: true, now })).toBe(false)
  })

  it('a resurfaced seed nobody worked is still not active work', () => {
    // Clause order: deferral readmits the status, the seed rule still vetoes.
    const row = untouchedSeed({ status: 'cancelled', deferred_until: '2026-10-01T00:00:00Z' })
    expect(isActiveIdeaWork(row, { hasGraduated: true, now })).toBe(false)
  })
})

// ───────────────────────────────────────────────────────────────────────────
// Drawer, and absence
// ───────────────────────────────────────────────────────────────────────────

describe('visibility tier', () => {
  it('an archived-tier row is not active work however live it looks', () => {
    expect(isActiveIdeaWork(liveIdea({ visibility_tier: 'archive' }), GRADUATED)).toBe(false)
  })

  it('tolerates the column being absent', () => {
    /*
     * Every production caller filters `.eq('visibility_tier', 'active')` in
     * SQL, so the column is often not selected. Rejecting on absence would
     * empty those surfaces; this is the one clause that treats missing as
     * "already handled" rather than as a veto.
     */
    const { visibility_tier: _omitted, ...withoutTier } = liveIdea()
    expect(isActiveIdeaWork(withoutTier as ActiveWorkRow, GRADUATED)).toBe(true)
  })

  it('a null row is not active work', () => {
    expect(isActiveIdeaWork(null, GRADUATED)).toBe(false)
    expect(isActiveIdeaWork(undefined, GRADUATED)).toBe(false)
  })

  it('activeIdeaWork survives a null list', () => {
    expect(activeIdeaWork(null, GRADUATED)).toEqual([])
    expect(activeIdeaWork(undefined, GRADUATED)).toEqual([])
  })
})

// ───────────────────────────────────────────────────────────────────────────
// The picker and the Pipeline must agree, row for row
// ───────────────────────────────────────────────────────────────────────────

describe('the picker and the Ideas Pipeline agree on every fixture', () => {
  /**
   * The Ideas Pipeline board's own membership rule, transcribed from
   * `TradeQueuePage.filteredItems` — NOT by calling the shared predicate,
   * which would make this test tautological. If the predicate and this
   * transcription ever disagree, one of them is wrong and the test says so.
   *
   * The board's status core is `archivedStatuses ∪ deferredStatuses ∪
   * {'deleted'}` — which is exactly `TERMINAL_STATUSES` — minus the deferred
   * rows whose date has arrived.
   */
  const boardShows = (row: ActiveWorkRow, hasGraduated: boolean, now: Date): boolean => {
    const status = String(row.status ?? '').toLowerCase()
    const archived = ['executed', 'rejected', 'approved', 'archived']
    const deferred = ['cancelled']
    if (archived.includes(status)) return false
    if (deferred.includes(status) && !isDeferredResurfaced(row, now)) return false
    if (status === 'deleted') return false
    if (row.revisit_at && Date.parse(row.revisit_at) > now.getTime()) return false
    // The seed rule, applied upstream in `usePipelineItems`.
    const isSeed = (row.origin_metadata as { pilot_seed?: boolean } | null)?.pilot_seed === true
    const worked = (row.accepted_trades ?? []).some(t => t.is_active && !t.reverted_at)
      || (row.decision_requests ?? []).some(d =>
        ['accepted', 'accepted_with_modification', 'rejected', 'deferred'].includes(String(d.status)))
    if (hasGraduated && isSeed && !worked) return false
    return true
  }

  const now = new Date('2026-10-05T12:00:00Z')
  const STATUSES = ['idea', 'deciding', 'research', 'monitoring',
    'approved', 'executed', 'rejected', 'cancelled', 'archived', 'deleted']

  /*
   * status × seed × worked × parked × deferred-ready × graduated.
   * 10 × 2 × 2 × 2 × 2 × 2 = 320 rows, each checked both ways.
   */
  const matrix: Array<{ label: string; row: ActiveWorkRow; hasGraduated: boolean }> = []
  for (const status of STATUSES) {
    for (const seed of [false, true]) {
      for (const worked of [false, true]) {
        for (const parked of [false, true]) {
          for (const deferReady of [false, true]) {
            for (const hasGraduated of [false, true]) {
              matrix.push({
                label: `${status}/${seed ? 'seed' : 'own'}/${worked ? 'worked' : 'untouched'}`
                  + `/${parked ? 'parked' : 'live'}/${deferReady ? 'due' : 'nodate'}`
                  + `/${hasGraduated ? 'graduated' : 'pilot'}`,
                hasGraduated,
                row: liveIdea({
                  status,
                  origin_metadata: seed ? { pilot_seed: true } : null,
                  accepted_trades: worked ? [{ is_active: true, reverted_at: null }] : [],
                  revisit_at: parked ? '2026-12-01T00:00:00Z' : null,
                  deferred_until: deferReady ? '2026-10-01T00:00:00Z' : null,
                }),
              })
            }
          }
        }
      }
    }
  }

  it('covers the whole matrix', () => {
    expect(matrix).toHaveLength(320)
  })

  it('never disagrees with the board, on any of the 320 rows', () => {
    const disagreements = matrix.filter(({ row, hasGraduated }) =>
      isActiveIdeaWork(row, { hasGraduated, now }) !== boardShows(row, hasGraduated, now),
    )
    expect(disagreements.map(d => d.label)).toEqual([])
  })

  it('the matrix is not trivially one-sided', () => {
    // A matrix where everything is inactive would satisfy the agreement test
    // without proving anything.
    const active = matrix.filter(({ row, hasGraduated }) =>
      isActiveIdeaWork(row, { hasGraduated, now })).length
    expect(active).toBeGreaterThan(20)
    expect(active).toBeLessThan(matrix.length - 20)
  })
})

// ───────────────────────────────────────────────────────────────────────────
// The guard: no surface may reinvent a weaker predicate
// ───────────────────────────────────────────────────────────────────────────

describe('no surface reinvents the active-work question', () => {
  /**
   * Every call site that asks "is this active work". Each must reach the
   * shared predicate, and must not go back to deciding it alone.
   */
  const CALL_SITES = [
    'components/thoughts/QuickTradeIdeaCapture.tsx',
    'hooks/useAssetTradeIdeas.ts',
    'hooks/useActionLoopCards.ts',
  ]

  it.each(CALL_SITES)('%s uses the shared predicate', (path) => {
    const src = read(path)
    expect(src).toMatch(/isActiveIdeaWork|activeIdeaWork/)
  })

  it.each(CALL_SITES)('%s does not decide liveness on its own', (path) => {
    const src = read(path)
    /*
     * `isLiveIdea` alone is the exact defect: one clause of a four-clause
     * question, which reads as a correct answer. A surface needing it must
     * compose it through `active-work`, not import it directly.
     */
    expect(src).not.toMatch(/\bisLiveIdea\b/)
  })

  it.each(CALL_SITES)('%s selects outcome wherever it reads status', (path) => {
    const src = read(path)
    /*
     * `isLiveIdea` reads `outcome` FIRST and falls back to `status`. A select
     * that omits `outcome` skips the authoritative signal silently — the
     * detail panel shipped this way for months. If a file reads idea status
     * at all, every one of its trade_queue_items selects must carry `outcome`.
     */
    if (!/trade_queue_items/.test(src)) return
    expect(src).toMatch(/outcome/)
    expect(src).toMatch(/origin_metadata/)
  })

  it('the picker asks the organization-level question, not a portfolio one', () => {
    const src = read('components/thoughts/QuickTradeIdeaCapture.tsx')
    // Pre-selection there is no portfolio to name: the selector renders later
    // and starts empty. "In pipeline" invited a question the badge cannot
    // answer.
    expect(src).toContain('Active idea')
    expect(src).not.toContain('In pipeline')
  })

  it('the picker names the actual book once one is known', () => {
    const src = read('components/thoughts/QuickTradeIdeaCapture.tsx')
    expect(src).toContain('activeContextLabel')
    // Which requires the portfolio to be fetched, not guessed.
    expect(src).toMatch(/portfolios:portfolio_id\(id, name\)/)
  })

  it('the Ideas feed applies the seed clause it was missing', () => {
    const src = read('hooks/ideas/useIdeasFeed.ts')
    expect(src).toMatch(/isOperationalAfterPilot/)
    expect(src).toMatch(/origin_metadata/)
  })

  it('the shared pipeline read still returns what the other tabs list', () => {
    /*
     * The one place the predicate must NOT be applied. `usePipelineItems`
     * feeds the Snoozed, Archived and Committed tabs, which exist to list the
     * rows the predicate rejects. Filtering there would make snoozed work
     * unrecoverable.
     */
    const src = read('hooks/usePipelineItems.ts')
    expect(src).not.toMatch(/isActiveIdeaWork|activeIdeaWork/)
    // It must still apply the seed clause, which is what it always did.
    expect(src).toMatch(/operationalAfterPilot/)
  })

  it('the board delegates its deferred rule instead of inlining it', () => {
    const src = read('pages/TradeQueuePage.tsx')
    expect(src).toMatch(/isDeferredResurfaced/)
    // The inline UTC/local date arithmetic is gone, so it cannot drift from
    // the copy the predicate uses.
    expect(src).not.toMatch(/getUTCFullYear/)
  })

  it('the select fragment carries every column the predicate reads', () => {
    for (const col of [
      'status', 'outcome', 'visibility_tier',
      'revisit_at', 'deferred_until', 'origin_metadata',
      'accepted_trades', 'decision_requests',
    ]) {
      expect(ACTIVE_WORK_SELECT).toContain(col)
    }
  })
})
