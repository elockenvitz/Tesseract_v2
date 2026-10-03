/**
 * The three mobile defects the acceptance audit found, pinned.
 *
 * All three were invisible: nothing threw, nothing rendered wrong, and the
 * suite was green. They are the kind of defect that only a reader tracing
 * the chain by hand finds — so each one gets an assertion that would have
 * caught it.
 *
 * These are structural assertions over source text. The alternative — a
 * full MobileDashboard render — needs a React tree, a Supabase client, a
 * query client and a feed's worth of fixtures to prove a one-line
 * adapter gap, and a test that heavy gets deleted the first time it flakes.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const SRC = resolve(__dirname, '../../..')
const read = (p: string) => readFileSync(resolve(SRC, p), 'utf8')

const DASHBOARD = read('components/mobile/MobileDashboard.tsx')
const PIPELINE = read('components/mobile/MobilePipeline.tsx')
const PIPELINE_ROWS = read('lib/mobile/pipeline-rows.ts')
const TILE_REQ = read('lib/mobile/tile-requirement.ts')
const PRIORITY = read('lib/signals/feed-priority.ts')
const REGISTRY = read('lib/signals/content-registry.ts')

/* ── BLOCKER 2: Resume work opens the idea on a phone ─────────────────── */

describe('mobile Resume work reaches the idea, not just the list', () => {
  it('MobilePipeline can open the detail on arrival', () => {
    // `openIdeaDetail`'s second event is heard ONLY by TradeQueuePage, which
    // a phone never mounts — DashboardPage renders MobilePipeline for that
    // tab. Without this the CTA scrolled to a highlighted row and stopped.
    expect(PIPELINE).toContain('openDetailOnFocus')
    expect(PIPELINE).toContain('if (openDetailOnFocus) setDetail(match)')
  })

  it('uses the SAME open an ordinary tap uses — no second modal', () => {
    // `setDetail` is what `onIdeaClick` calls, and it renders the shared
    // TradeIdeaDetailModal. A mobile-only detail pane is the mistake this
    // surface already made once.
    expect(PIPELINE).toContain('setDetail(row)')
    expect(PIPELINE).toContain('TradeIdeaDetailModal')
    expect(PIPELINE.match(/setDetail\(/g)!.length).toBeGreaterThanOrEqual(2)
  })

  it('the shell passes the flag only for the resume hand-off', () => {
    const shell = read('pages/DashboardPage.tsx')
    expect(shell).toContain('openDetailOnFocus')
  })

  it('introduces no query parameter for it', () => {
    // The first version of this CTA used `/trade-queue?idea=<id>`, which
    // TradeQueuePage does not read. Asserted against CODE, not comments —
    // both files mention the old route in prose explaining why it is gone.
    const codeOnly = (s: string) => s.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, '')
    expect(codeOnly(PIPELINE)).not.toMatch(/\?idea=/)
    expect(codeOnly(DASHBOARD)).not.toMatch(/\?idea=/)
  })

  it('opening still does not clear the obligation', () => {
    // The mobile CTA calls openIdeaDetail and nothing else.
    const branch = DASHBOARD.slice(
      DASHBOARD.indexOf("if (entry.kind === 'revisit')"),
      DASHBOARD.indexOf("if (entry.kind === 'signal')"),
    )
    expect(branch).toContain('openIdeaDetail')
    expect(branch).not.toContain('clearIdeaRevisitObligation')
    expect(branch).not.toContain('clear_memory_obligation')
  })
})

/* ── BLOCKER 3: ranking and category resolve ──────────────────────────── */

describe('mobile ranks parked work as ready_to_revisit, not as news', () => {
  it('the entry declares its contract type', () => {
    // Without this the entry fell through rankInputFor's default to
    // `'news'` — the lowest tier — while feed-priority already defined a
    // tier 3 entry that only desktop reached.
    expect(DASHBOARD).toContain("const READY_TO_REVISIT_TYPE = 'ready_to_revisit'")
    expect(DASHBOARD).toContain('signalType: READY_TO_REVISIT_TYPE')
  })

  it('rankInputFor honours a declared signalType before defaulting to news', () => {
    expect(DASHBOARD).toContain("e.signal?.type ?? e.signalType ?? 'news'")
  })

  it('there is exactly one priority table, and it already has this type', () => {
    // Requirement: do not add a second ranking constant.
    expect(PRIORITY).toMatch(/ready_to_revisit:\s*\{\s*tier:\s*3,\s*base:\s*0\.62\s*\}/)
    expect(DASHBOARD).not.toMatch(/tier:\s*3[^\n]*ready_to_revisit/)
  })

  it('the dead score that influenced nothing is gone', () => {
    const entries = DASHBOARD.slice(
      DASHBOARD.indexOf('const revisitEntries'),
      DASHBOARD.indexOf('const revisitEntries') + 1200,
    )
    expect(entries).not.toContain('score: 100 - idx')
  })

  it('each entry gets a distinct id', () => {
    // Every revisit entry previously collapsed to the literal id 'revisit',
    // so nothing keyed on id could tell two parked ideas apart.
    expect(DASHBOARD).toContain('entryId: `ready-to-revisit:${c.obligationId}`')
    expect(DASHBOARD).toContain('e.signal?.id ?? e.entryId ?? e.kind')
  })

  it('news ranking is untouched', () => {
    // The default still ends at 'news' for an entry that declares nothing.
    expect(DASHBOARD).toContain("?? 'news'")
    expect(PRIORITY).toMatch(/news:\s*\{/)
  })
})

describe('category filtering no longer silently removes it', () => {
  it('the registry already declares the category — no new pill invented', () => {
    expect(REGISTRY).toMatch(/ready_to_revisit:\s*\{[^}]*canonicalCategory:\s*'workflow'/s)
  })

  it('categoryOf resolves through the declared type the entry now carries', () => {
    const cats = read('lib/mobile/feed-categories.ts')
    expect(cats).toContain('entry.card?.type ?? entry.signalType')
    // Which is exactly the field the entry sets.
    expect(DASHBOARD).toContain('signalType: READY_TO_REVISIT_TYPE')
  })
})

/* ── D: the production-entry guard can see this family ────────────────── */

describe('the tile-requirement guard covers parked work', () => {
  it('revisit is a production entry kind', () => {
    // Omitting it disarmed the guard: the test holds PRODUCTION_ENTRY_KINDS
    // against the switch, and a kind missing from BOTH passes while the
    // tile silently takes a full screen through the defensive fallback.
    expect(TILE_REQ).toMatch(/PRODUCTION_ENTRY_KINDS = \[[^\]]*'revisit'/s)
  })

  it('and has a real adapter rather than the fallback', () => {
    expect(TILE_REQ).toContain("case 'revisit': {")
    expect(TILE_REQ).toMatch(/case 'revisit': \{[\s\S]{0,600}?hasMetric: true/)
  })
})

/* ── A: suppression parity across shells ──────────────────────────────── */

describe('snoozed work is hidden on BOTH pipelines', () => {
  it('mobile applies the same predicate desktop does', () => {
    expect(PIPELINE).toContain('isRowParked(row)')
    expect(read('pages/TradeQueuePage.tsx')).toContain('isParked(item.revisit_at)')
  })

  it('one definition of parked, shared, not a second copy', () => {
    expect(PIPELINE_ROWS).toContain("import { isParked } from '../memory/obligations'")
    expect(PIPELINE_ROWS).toContain('export function isRowParked')
  })

  it('a pair counts as parked only when EVERY leg is', () => {
    // Snoozing one side of a pair must not remove the other from the board.
    expect(PIPELINE_ROWS).toMatch(/legs\.length > 0 && legs\.every\(l => isParked/)
  })

  it('is NOT applied in the shared hook, which also feeds the Snoozed tab', () => {
    // Suppressing at the shared read would make parked work unrecoverable.
    expect(read('hooks/usePipelineItems.ts')).not.toContain('isParked')
  })

  it('search still finds parked work — a snooze is not a delete', () => {
    expect(PIPELINE).toContain('if (!searching && isRowParked(row)) continue')
  })
})

/* ── C: dismissal is honest about what it supports ────────────────────── */

describe('dismissal', () => {
  it('the producer no longer pretends to handle it', () => {
    const producer = read('lib/memory/ready-to-revisit.ts')
    // The signature is the claim. The identifier still appears in the
    // comment explaining why it was removed, which is the opposite of a
    // pretence and should stay.
    expect(producer).toContain('export function isEligible(c: RevisitCandidate): boolean')
    expect(producer).not.toMatch(/dismissedIds[?:]/)
  })

  it('and the surface mechanism that does exist is named', () => {
    const producer = read('lib/memory/ready-to-revisit.ts')
    expect(producer).toMatch(/recordTriage|dispositions/)
  })
})
