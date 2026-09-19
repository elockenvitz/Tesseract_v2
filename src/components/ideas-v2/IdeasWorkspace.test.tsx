/**
 * Focused test for what the Ideas LENS decides, now that it decides one thing.
 *
 * ── Why this file was rewritten from scratch ──────────────────────────────
 *
 * The previous suite tested an authored-idea grid: `IdeaCard` tiles under
 * `data-testid="idea-tile"`, ranked by `scoreIdea`, expanded into `IdeaDetail`.
 * That grid was deliberately removed. The lens now renders exactly one field --
 * `OpportunityGrid` -- and the old cases queried a testid the DOM no longer
 * contains, so every one of them failed for the same uninteresting reason. A
 * handful of others read `IdeaCard.tsx` and `ideas-system.ts` as SOURCE TEXT to
 * pin a card no lens mounts any more; those passed while asserting nothing
 * about the product, which is worse than failing.
 *
 * ── What this suite is for ────────────────────────────────────────────────
 *
 * Only the decisions the surface owns, and specifically the one it got wrong:
 * the lens used to decide emptiness on the list of AUTHORED ideas -- a list the
 * field does not read -- so a reader who had written none was shown an empty
 * state while a full opportunity set sat underneath, unrendered. That is the
 * regression locked down here, along with the four other promises the field
 * makes: tiles appear, coverage prompts can become opportunities, a generated
 * candidate never wears an authored idea's vocabulary, and the verbs still work.
 *
 * Ranking, sizing, the coverage selection rule and the engagement seam all have
 * their own suites in `lib/desktop-ideas` and `lib/research`. Restating them
 * here would make this file a second source of truth for rules it does not own.
 *
 * ── Every assertion proves its own negative ───────────────────────────────
 *
 * A test that only asserts presence cannot tell a working field from one that
 * renders the same thing unconditionally. So each case below first renders the
 * state in which the thing must NOT appear, asserts its absence, and only then
 * renders the state in which it must.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import type { ExploreItem } from '../../lib/mobile/explore-item'
import type { CoverageResearchCandidate } from '../../lib/research/coverage-research-gaps'
import type { ResearchFraming } from '../../lib/research/case-state'

const DAY = 86_400_000
const daysAgo = (n: number) => new Date(Date.now() - n * DAY).toISOString()

/**
 * The mutable world these tests set up, hoisted so the `vi.mock` factories --
 * which are lifted above the imports -- can close over it. Reading it through
 * one object rather than a pile of `let`s is what keeps the factories honest:
 * they read the CURRENT value at render time rather than capturing whatever a
 * module-scope binding held when the factory first ran.
 */
const env = vi.hoisted(() => ({
  /** The authored idea scan. Empty in most cases here, deliberately. */
  scan: [] as unknown[],
  /** The coverage scan, as the lens receives it. */
  gaps: { status: 'ready', candidates: [] as unknown[], coveredCount: 0 },
  /** What the Explore producers found, before any supplement. */
  produced: [] as ExploreItem[],
  /** Each `realCount` the grid's `extra` supplier was asked for. */
  extraCalls: [] as number[],
  /** What the lens asked the Dashboard deck to expand. */
  opened: [] as Array<Record<string, unknown>>,
  /** Engagement opened from a tile: ['ai' | 'discuss', target]. */
  engaged: [] as Array<[string, unknown]>,
}))

/*
 * The idea scan. Still read by the lens -- it decides the loading gate, the
 * deck's rail and the asset ids a coverage prompt must not duplicate -- but it
 * no longer draws anything, which is the point several cases below make.
 */
vi.mock('../../hooks/useDesktopIdeas', () => ({
  useIdeaScan: () => ({ ideas: env.scan, isLoading: false, error: null }),
  useScanExposure: () => ({ exposure: {}, settled: true }),
  useScanFramework: () => ({}),
  useScanOpenPrice: () => ({}),
  useIdeaDetail: () => ({ detail: undefined, isLoading: false }),
}))

vi.mock('../../hooks/useCoverageResearchGaps', () => ({
  useCoverageResearchGaps: () => env.gaps,
}))

vi.mock('../../hooks/usePilotMode', () => ({
  usePilotMode: () => ({ hasGraduated: false, cachedHasGraduated: false }),
}))

/**
 * The composed candidate set, standing in for the real producers.
 *
 * ── Why this mock calls `extra` rather than ignoring it ───────────────────
 *
 * The real hook takes a SUPPLIER, not an array: how many coverage prompts the
 * field may add depends on how many real candidates the producers found, and
 * that count does not exist until composition has run. `OpportunityGrid` hands
 * in that supplier, and it is the only thing that makes a coverage prompt reach
 * the screen at all.
 *
 * A mock that returned a fixed `items` list would therefore pass the coverage
 * cases while proving nothing -- the prompt path would be bypassed entirely and
 * a regression that severed the supplier would go unnoticed. So this stands in
 * for the producers only, and then does what the real hook does with the
 * supplier: calls it with the producer count and admits the result to the set.
 *
 * What it does NOT do is re-implement `diversifyExplore`. Scoring, dedupe and
 * repulsion are that module's and have their own suite; emission order here is
 * simply the order the fixture was written in, so a case that cares about which
 * tile is first can say so by ordering its own fixture.
 */
vi.mock('../../hooks/useDesktopExplore', () => ({
  useDesktopExplore: (opts: { extra?: (realCount: number) => ExploreItem[] } = {}) => {
    const produced = env.produced
    let base = produced
    if (opts.extra) {
      env.extraCalls.push(produced.length)
      base = [...produced, ...opts.extra(produced.length)]
    }
    return {
      items: base.map((item, i) => ({ item, emphasis: 'standard' as const, score: 1 - i / 100 })),
      isLoading: false,
      missing: [],
    }
  },
}))

/* The tile's ambient price series, which reads through a QueryClient this
   suite does not stand up. Empty: no case here is about the chart, and an
   empty series is the state in which the tile simply does not draw one. */
vi.mock('../../hooks/useTileCloses', () => ({
  useTileCloses: () => ({ data: [], isLoading: false }),
}))

/*
 * `IdeaDetail`'s own dependencies.
 *
 * No case below expands an idea -- the lens only mounts the detail pane for an
 * authored row, and this suite is about the browse field. They are stubbed
 * anyway because the module is imported at the top of the lens either way, and
 * three of them reach for auth and organisation context that is not stood up
 * here. This is the same set the sibling Research suites carry.
 */
vi.mock('../../hooks/useDesktopResearch', () => ({ useHasResearch: () => false }))
vi.mock('./DecisionModule', () => ({ DecisionModule: () => null }))
vi.mock('../../hooks/useIdeaDecision', () => ({
  useIdeaDecision: () => ({ tracks: [], isLoading: false }),
}))
vi.mock('../../hooks/useObjectViewCursor', () => ({
  useRecordObjectView: () => ({ previous: null, ready: true }),
}))

/* The deck seam is real; only the window dispatch is captured, so a passing
   assertion describes the request the Dashboard shell would actually receive. */
vi.mock('../../lib/dashboard/focus', async importOriginal => {
  const actual = await importOriginal<typeof import('../../lib/dashboard/focus')>()
  return {
    ...actual,
    openDashboardFocus: (r: unknown) => { env.opened.push(r as Record<string, unknown>); return true },
  }
})

/* Same treatment for engagement: `canDiscuss` and `targetForOpportunity` stay
   real, so whether a tile OFFERS the verbs is still the product's decision. */
vi.mock('../../lib/engagement', async importOriginal => {
  const actual = await importOriginal<typeof import('../../lib/engagement')>()
  return {
    ...actual,
    askAI: (t: unknown) => { env.engaged.push(['ai', t]) },
    discuss: (t: unknown) => { env.engaged.push(['discuss', t]) },
  }
})

import { IdeasWorkspace } from './IdeasWorkspace'
import { OPPORTUNITY_LABEL } from '../../lib/desktop-ideas/opportunity'

/* ------------------------------------------------------------- fixtures */

/** A producer candidate, in Explore's shape. Defaults to a price move. */
const item = (over: Partial<ExploreItem> = {}): ExploreItem => ({
  id: 'e-1',
  dedupeKey: 'e-1',
  signalType: 'price_move',
  category: 'portfolio',
  subtype: 'signal',
  title: 'AAA has moved 12% since the case was written',
  context: 'Held at 3.1%',
  symbol: 'AAA',
  assetId: 'a-aaa',
  companyName: 'Alpha Inc',
  destination: { kind: 'action', action: 'open_asset', assetId: 'a-aaa', symbol: 'AAA' },
  ...over,
})

/**
 * A candidate somebody WROTE, as the ideas adapter emits one.
 *
 * `subtype: 'idea'` is the fact `opportunityKind` reads to return `authored`;
 * the signal type deliberately carries none of the substrings the kind rules
 * match on, so the subtype is genuinely what decides it.
 */
const authoredItem = (over: Partial<ExploreItem> = {}): ExploreItem => item({
  id: 'e-authored', dedupeKey: 'e-authored',
  signalType: 'trade_idea', category: 'ideas', subtype: 'idea',
  title: 'Long BBB into the renewal cohort', context: 'Eric Lockenvitz',
  symbol: 'BBB', assetId: 'a-bbb', companyName: 'Beta Corp',
  ...over,
})

const PRIORITY: Record<ResearchFraming, number> = {
  new_evidence: 1, price_move: 2, no_case: 3, incomplete_case: 4, long_silence: 5,
}

/**
 * One coverage-scan candidate.
 *
 * `price_move` by default because `structuralKeyOf` gives it no structural key,
 * so `selectCoverageWork`'s per-gap caps cannot silently drop it and a case
 * about the PROMPT PATH is not accidentally a case about the caps. The caps
 * have their own suite.
 */
function candidate(
  symbol: string,
  framing: ResearchFraming = 'price_move',
  over: Partial<CoverageResearchCandidate> = {},
): CoverageResearchCandidate {
  const assetId = `a-${symbol.toLowerCase()}`
  return {
    id: `coverage-research:${assetId}`, assetId, symbol, companyName: `${symbol} Inc`,
    coverage: 'own', framing, priority: PRIORITY[framing], score: 0.6,
    headline: 'x', body: 'x', prompt: `What has changed at ${symbol}?`,
    facts: {
      missingSections: [], presentSections: ['thesis'],
      movePct: framing === 'price_move' ? -16.4 : null,
      evidenceSince: [], evidenceCount: 0,
      daysSinceReview: 120, daysSinceWritten: 120, anchoredOn: 'written',
      caseWrittenAt: daysAgo(120), reviewAnchor: daysAgo(120),
    },
    exposure: { held: false, weightPct: null, portfolioId: null, portfolioName: null, portfolioCount: 0 },
    liveIdeas: [],
    open: { assetId, symbol, companyName: null, focus: 'research', origin: 'coverage-research', issue: 'x' },
    insight: {} as never,
    ...over,
  }
}

const tiles = () => screen.queryAllByTestId('opportunity-tile')
const tilesOfKind = (kind: string) =>
  tiles().filter(t => t.getAttribute('data-kind') === kind)

beforeEach(() => {
  env.scan = []
  env.gaps = { status: 'ready', candidates: [], coveredCount: 0 }
  env.produced = []
  env.extraCalls.length = 0
  env.opened.length = 0
  env.engaged.length = 0
})

/* ---------------------------------------------------------------- cases */

describe('the opportunity set is the field', () => {
  it('draws a tile per candidate, and nothing when there are none', () => {
    // The negative first: with no candidates the field must not be producing
    // tiles from somewhere else, or the positive below proves nothing.
    render(<IdeasWorkspace />)
    expect(tiles()).toHaveLength(0)
    cleanup()

    env.produced = [
      item({ id: 'e-1', dedupeKey: 'e-1', symbol: 'AAA', assetId: 'a-aaa' }),
      item({ id: 'e-2', dedupeKey: 'e-2', symbol: 'BBB', assetId: 'a-bbb' }),
      item({ id: 'e-3', dedupeKey: 'e-3', symbol: 'CCC', assetId: 'a-ccc' }),
    ]
    render(<IdeasWorkspace />)
    expect(tiles()).toHaveLength(3)
  })
})

describe('emptiness is decided by the field, not by the authored ideas', () => {
  /**
   * The regression this suite exists for.
   *
   * The lens used to return a whole-page `<Empty/>` when the AUTHORED idea scan
   * came back empty -- a list the field does not read. A reader who had written
   * no ideas was told the lens had nothing while the opportunity set sat
   * underneath it, fully composed and never rendered. Zero authored ideas is
   * the DEFAULT state of a new desk, so this was not an edge case.
   */
  it('renders a full opportunity set even when nobody has written an idea', () => {
    env.scan = []
    env.produced = [
      item({ id: 'e-1', dedupeKey: 'e-1', symbol: 'AAA', assetId: 'a-aaa' }),
      item({ id: 'e-2', dedupeKey: 'e-2', symbol: 'BBB', assetId: 'a-bbb' }),
    ]
    render(<IdeasWorkspace />)
    expect(tiles()).toHaveLength(2)
    // And the empty-state sentence is nowhere on the page: an empty state that
    // renders ALONGSIDE a full field is the same bug wearing a smaller hat.
    expect(screen.queryByText(/Nothing to explore yet/)).not.toBeInTheDocument()
  })

  it('shows the field\'s own empty state -- a page, not a blank -- when there is genuinely nothing', () => {
    env.scan = []
    env.produced = []
    render(<IdeasWorkspace />)

    expect(tiles()).toHaveLength(0)
    // The lens is still a lens: heading, gallery, and a sentence that says what
    // would make tiles appear. The failure mode being excluded is a lens that
    // renders its scroll container and nothing inside it.
    expect(screen.getByTestId('ideas-lens')).toBeInTheDocument()
    expect(screen.getByTestId('desktop-gallery')).toBeInTheDocument()
    expect(screen.getByText(/Nothing to explore yet/)).toBeInTheDocument()
  })
})

describe('coverage prompts reach the field as opportunities', () => {
  /*
   * Fed through the mocked coverage scan and composed by the REAL
   * `coverageExplorePrompts` -- the lens hands the candidates to the grid, the
   * grid builds the supplier, and the mocked Explore hook calls it. Nothing
   * about the projection is stubbed, so a break anywhere along that chain fails
   * here rather than passing on a fixture.
   */
  it('turns a covered name into a tile of its own kind, and none when the scan is empty', () => {
    env.gaps = { status: 'ready', candidates: [], coveredCount: 0 }
    render(<IdeasWorkspace />)
    expect(tilesOfKind('coverage_gap')).toHaveLength(0)
    cleanup()

    env.gaps = { status: 'ready', candidates: [candidate('ZZZ')], coveredCount: 1 }
    render(<IdeasWorkspace />)

    const prompts = tilesOfKind('coverage_gap')
    expect(prompts).toHaveLength(1)
    expect(prompts[0]).toHaveTextContent('ZZZ')
  })

  it('asks the supplier for prompts with the count the producers actually found', () => {
    // The supplier's argument is the thin-field rule's whole input: a full page
    // of real findings admits no prompts. Asserting the count is what proves
    // the grid is composing prompts WITH the producers rather than after them.
    env.produced = [
      item({ id: 'e-1', dedupeKey: 'e-1', symbol: 'AAA', assetId: 'a-aaa' }),
      item({ id: 'e-2', dedupeKey: 'e-2', symbol: 'BBB', assetId: 'a-bbb' }),
    ]
    env.gaps = { status: 'ready', candidates: [candidate('ZZZ')], coveredCount: 1 }
    render(<IdeasWorkspace />)

    expect(env.extraCalls.length).toBeGreaterThan(0)
    expect(env.extraCalls[0]).toBe(2)
    expect(tiles()).toHaveLength(3)
  })

  it('never suggests a name an idea is already open on', () => {
    // The exclusion set is built by the lens from the idea scan and travels to
    // the grid. With ZZZ already carrying an idea, the prompt for it must not
    // be composed at all -- proved against the identical run without that idea.
    env.gaps = { status: 'ready', candidates: [candidate('ZZZ')], coveredCount: 1 }
    render(<IdeasWorkspace />)
    expect(tilesOfKind('coverage_gap')).toHaveLength(1)
    cleanup()

    env.scan = [{ id: 'i-1', assetId: 'a-zzz', symbol: 'ZZZ', maturity: 'researching', createdAt: daysAgo(3) }]
    render(<IdeasWorkspace />)
    expect(tilesOfKind('coverage_gap')).toHaveLength(0)
  })
})

describe('a generated opportunity never wears an authored idea\'s vocabulary', () => {
  /**
   * The distinction the lens promised to keep visible when the authored grid
   * was removed. Both kinds of object now live in one field, so the chip is the
   * only thing telling the reader whether a person raised this or Tesseract
   * did -- and the two labels are asserted as DIFFERENT text, not merely as
   * text, because a chip that says the same thing about both keeps no promise.
   */
  it('labels a written idea and a coverage prompt with different words', () => {
    expect(OPPORTUNITY_LABEL.authored).toBe('Written by someone')
    expect(OPPORTUNITY_LABEL.coverage_gap).toBe('From your coverage')
    expect(OPPORTUNITY_LABEL.authored).not.toBe(OPPORTUNITY_LABEL.coverage_gap)

    env.produced = [authoredItem()]
    env.gaps = { status: 'ready', candidates: [candidate('ZZZ')], coveredCount: 1 }
    render(<IdeasWorkspace />)

    const authored = tilesOfKind('authored')
    const prompt = tilesOfKind('coverage_gap')
    expect(authored).toHaveLength(1)
    expect(prompt).toHaveLength(1)

    expect(authored[0]).toHaveTextContent(OPPORTUNITY_LABEL.authored)
    expect(prompt[0]).toHaveTextContent(OPPORTUNITY_LABEL.coverage_gap)
    // The load-bearing half: the generated tile must not carry the authored
    // words anywhere, not just fail to carry them in the chip slot.
    expect(prompt[0]).not.toHaveTextContent(OPPORTUNITY_LABEL.authored)
    expect(authored[0]).not.toHaveTextContent(OPPORTUNITY_LABEL.coverage_gap)
  })
})

describe('the verbs on a tile', () => {
  it('hands the chosen candidate to the deck, as an asset', () => {
    env.produced = [item({ id: 'e-1', dedupeKey: 'e-1', symbol: 'AAA', assetId: 'a-aaa' })]
    render(<IdeasWorkspace />)

    expect(env.opened).toHaveLength(0)
    fireEvent.click(screen.getByTestId('opportunity-open'))

    expect(env.opened).toHaveLength(1)
    const req = env.opened[0] as { target: Record<string, unknown>; rail: unknown[] }
    // `asset`, not `idea`: nobody has staged this candidate, and naming a row
    // the deck cannot load is how a tile opens onto nothing.
    expect(req.target.objectType).toBe('asset')
    expect(req.target.objectId).toBe('a-aaa')
    expect(req.target.workspaceLens).toBe('research')
    expect(req.target.originLens).toBe('ideas')
    // The peer population travels with it, or the deck's rail comes up empty.
    expect(req.rail.length).toBeGreaterThan(0)
  })

  it('offers Ask AI and Discuss only where there is an asset to talk about', () => {
    // The negative first, and it is a real product rule rather than a
    // convenience: a candidate the adapter could not resolve to an asset gets
    // Open alone, because both verbs bind to the asset and would open nothing.
    env.produced = [item({
      id: 'e-none', dedupeKey: 'e-none', symbol: 'QQQ', assetId: null, companyName: 'Quad Ltd',
    })]
    render(<IdeasWorkspace />)
    expect(tiles()).toHaveLength(1)
    expect(screen.getByTestId('opportunity-open')).toBeInTheDocument()
    expect(screen.queryByTestId('opportunity-ai')).not.toBeInTheDocument()
    expect(screen.queryByTestId('opportunity-discuss')).not.toBeInTheDocument()
    cleanup()

    env.produced = [item({ id: 'e-1', dedupeKey: 'e-1', symbol: 'AAA', assetId: 'a-aaa' })]
    render(<IdeasWorkspace />)
    fireEvent.click(screen.getByTestId('opportunity-ai'))
    fireEvent.click(screen.getByTestId('opportunity-discuss'))

    expect(env.engaged.map(([verb]) => verb)).toEqual(['ai', 'discuss'])
    // Bound to the ASSET, so a thread raised from a candidate lands where a
    // thread raised from the idea it becomes lands.
    for (const [, target] of env.engaged) {
      expect(target).toMatchObject({ objectType: 'asset', objectId: 'a-aaa' })
    }
    // And opening is not a side effect of pressing a verb.
    expect(env.opened).toHaveLength(0)
  })
})
