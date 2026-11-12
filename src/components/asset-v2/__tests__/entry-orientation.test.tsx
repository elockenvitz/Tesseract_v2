/**
 * The contextual entry, asserted on what the reader SEES.
 *
 * ── The acceptance case ──────────────────────────────────────────────────
 *
 * The reported defect: pressing "AAPL has reached the target you set for it"
 * on the Dashboard produced the standard AAPL workspace with a pending
 * recommendation panel on top. Nothing on the page said which target, what it
 * was measured against, or that a target event was the reason the reader was
 * there.
 *
 * So these cases render the real pane with the real payload -- the card and
 * the selection built by `buildTargetHitCard` and `selectionFor` from a
 * `TargetBreach` row -- and assert the rendered text, the order of the bands
 * and where each control actually points. A test that asserted the context
 * object, the intent string or a data attribute would pass against the
 * surface as it was reported broken.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { AssetWorkspaceData } from '../../../hooks/useAssetWorkspace'
import { buildTargetHitCard } from '../../../lib/signals/builders/legacy-kinds'
import { selectionFor } from '../../../lib/desktop-ideas/selection'
import { entryContextFor } from '../../../lib/asset-workspace/entry-context'
import type { AttentionEntry } from '../../../hooks/useDesktopAttentionFeed'

const DAY = 86_400_000
const daysAgo = (n: number) => new Date(Date.now() - n * DAY).toISOString()

const BASE: AssetWorkspaceData = {
  sections: [], evidence: [], caseWrittenAt: null, coreSections: [],
  history: [], spot: null, ladder: null, target: null,
  positions: [], liveIdeas: [], decisions: [],
}

let data: AssetWorkspaceData = BASE

vi.mock('../../../hooks/useAssetWorkspace', async importOriginal => {
  const actual = await importOriginal<typeof import('../../../hooks/useAssetWorkspace')>()
  return {
    ...actual,
    useAssetWorkspace: () => ({ data, isLoading: false, error: null }),
  }
})

/** The canonical thesis editor, stubbed to prove "Review the case" mounts it. */
vi.mock('../../contributions', () => ({
  ThesisContainer: ({ assetId }: { assetId: string }) => (
    <div data-testid="real-thesis-editor" data-asset={assetId} />
  ),
}))

vi.mock('../../../hooks/useThesisReview', () => ({
  useThesisReviews: () => new Map<string, string>(),
  useRecordThesisReview: () => ({ record: vi.fn(), isPending: false, pendingOutcome: null }),
  useCurrentThesisConclusion: () => ({ current: null }),
}))

/** Where the scenarios control actually goes. Captured, not stubbed blind. */
const opened: any[] = []
vi.mock('../../../lib/desktop-asset', async importOriginal => {
  const actual = await importOriginal<typeof import('../../../lib/desktop-asset')>()
  return { ...actual, openAsset: (req: any) => { opened.push(req); return true } }
})

const asked: any[] = []
vi.mock('../../../lib/engagement', async importOriginal => {
  const actual = await importOriginal<typeof import('../../../lib/engagement')>()
  return {
    ...actual,
    askAI: (t: any) => { asked.push(t); return true },
    discuss: () => true,
  }
})

import { AssetWorkspacePane } from '../AssetWorkspace'

const ORG = 'org-a'
const asset = { id: 'a-aapl', symbol: 'AAPL', company_name: 'Apple Inc.' }

/** AAPL through its Bull case, as the lens produces it. */
const BREACH = {
  assetId: 'a-aapl',
  symbol: 'AAPL',
  companyName: 'Apple Inc.',
  price: 272.95,
  target: 230,
  overshootPct: (272.95 - 230) / 230,
  caseName: 'Bull',
  cases: [
    { id: 'c-bear', name: 'Bear', price: 150 },
    { id: 'c-base', name: 'Base', price: 195 },
    { id: 'c-bull', name: 'Bull', price: 230 },
  ],
  conviction: 'high',
  heldIn: ['Vision Fund'],
  heldInIds: ['p-vision'],
  statedAt: '2026-03-04T00:00:00.000Z',
  asOf: daysAgo(5),
}

function targetEntry(over: Partial<typeof BREACH> = {}): AttentionEntry {
  const row = { ...BREACH, ...over }
  const built = buildTargetHitCard(row as never)
  if (!built.ok || !built.card) throw new Error('fixture does not build a card')
  return {
    key: built.card.id, card: built.card, item: null, input: null,
    family: 'target_hit', source: row as never,
  }
}

/** Exactly what a card press hands the pane: the selection and the entry. */
function contextFromPress(entry: AttentionEntry, organizationId: string | null = ORG) {
  return entryContextFor({
    selection: selectionFor(entry), row: entry.source, organizationId,
  })
}

const RECOMMENDATION_SELECTION = {
  family: 'recommendation', key: 'rec:1', assetId: 'a-aapl', symbol: 'AAPL',
  portfolioId: 'p-vision', portfolioName: 'Vision Fund',
  why: { headline: 'A. Analyst proposes adding AAPL', reason: 'Raised 2 days ago, unanswered.' },
}
const RECOMMENDATION_ROW = {
  id: 'tq-1', action: 'add', proposedWeightPct: 4.5, currentWeightPct: 2.1,
  currentWeightAsOf: daysAgo(3), rationale: 'Services mix is carrying the multiple.',
  recommendedBy: 'A. Analyst', createdAt: daysAgo(2),
}

const pane = (over: Record<string, unknown> = {}) => (
  <AssetWorkspacePane asset={asset} organizationId={ORG} {...over} />
)

beforeEach(() => {
  data = {
    ...BASE,
    spot: 268.2,
    history: [{ date: '2026-11-10', close: 268.2 }],
    ladder: {
      assetId: 'a-aapl', symbol: 'AAPL', companyName: 'Apple Inc.',
      cases: [
        { id: 'c-bear', name: 'Bear', price: 150, scenarioId: null, probability: null, timeframe: null, reasoning: null, userId: null },
        { id: 'c-base', name: 'Base', price: 195, scenarioId: null, probability: null, timeframe: null, reasoning: null, userId: null },
        { id: 'c-bull', name: 'Bull', price: 230, scenarioId: null, probability: null, timeframe: null, reasoning: null, userId: null },
      ],
      updatedAt: daysAgo(30), valid: true, reason: '',
    } as never,
    target: 230,
    caseWrittenAt: daysAgo(253),
  }
  opened.length = 0
  asked.length = 0
})

/* ------------------------------------------------- 1. the target review */

describe('arriving from the target-reached card', () => {
  it('leads with the target event and not with the standard overview', () => {
    render(pane({ focus: 'research', entryContext: contextFromPress(targetEntry()) }))

    const band = screen.getByTestId('entry-target-review')
    expect(band).toBeInTheDocument()
    expect(within(band).getByText('Why you are here')).toBeInTheDocument()
    expect(within(band).getByText(/passed the Bull case you set for AAPL/)).toBeInTheDocument()
  })

  it('shows the recorded target, the mark it was compared against, and the difference', () => {
    render(pane({ entryContext: contextFromPress(targetEntry()) }))

    const comparison = screen.getByTestId('target-comparison')
    expect(within(comparison).getByText('$230.00')).toBeInTheDocument()
    expect(within(comparison).getByText('Bull case')).toBeInTheDocument()
    /* The date the target was written down, in the reader's own locale
       format, which is why this matches the parts rather than one spelling. */
    const stated = within(comparison).getByText(/^stated\b/)
    expect(stated.textContent).toMatch(/4/)
    expect(stated.textContent).toMatch(/2026/)
    expect(within(comparison).getByText('$272.95')).toBeInTheDocument()
    /* The source of the number, on the number. The page's own chart draws a
       different measurement and both are on screen. */
    expect(within(comparison).getByText('Book mark')).toBeInTheDocument()
    expect(within(comparison).getByText(/holdings snapshot/)).toBeInTheDocument()
    expect(within(comparison).getByText('+18.7%')).toBeInTheDocument()
  })

  it('dates the reading rather than claiming the price crossed today', () => {
    render(pane({ entryContext: contextFromPress(targetEntry()) }))
    const age = screen.getByTestId('target-reading-age')
    expect(age).toHaveTextContent(/5 days ago/)
    expect(age).toHaveTextContent(/When the price first passed it is not recorded/)
    expect(age.textContent).not.toMatch(/today/i)
  })

  it('names the price-history close separately from the book mark', () => {
    render(pane({ entryContext: contextFromPress(targetEntry()) }))
    const note = screen.getByTestId('target-spot-note')
    expect(note).toHaveTextContent('$268.20')
    expect(note).toHaveTextContent(/different\s+measurement/)
  })

  it('shows the scenarios on record and which the mark has passed', () => {
    render(pane({ entryContext: contextFromPress(targetEntry()) }))
    const rungs = screen.getByTestId('target-scenarios').querySelectorAll('[data-slot="scenario-rung"]')
    expect(Array.from(rungs).map(r => r.textContent)).toEqual([
      expect.stringContaining('Bear'),
      expect.stringContaining('Base'),
      expect.stringContaining('Bull'),
    ])
    expect(Array.from(rungs).every(r => r.getAttribute('data-reached') === 'true')).toBe(true)
    const alertCase = screen.getByTestId('target-scenarios').querySelector('[data-alert-case="true"]')
    expect(alertCase).toHaveTextContent('Bull')
    expect(alertCase).toHaveTextContent('$230.00')
  })

  it('marks a case the mark has not reached as still above it', () => {
    /* The same event with a lower mark. Nothing about the rendering may
       quietly promote a rung the price has not passed. */
    render(pane({ entryContext: contextFromPress(targetEntry({ price: 200, target: 195, caseName: 'Base', overshootPct: (200 - 195) / 195 })) }))
    const bull = Array.from(
      screen.getByTestId('target-scenarios').querySelectorAll('[data-slot="scenario-rung"]'),
    ).find(r => r.textContent?.includes('Bull'))!
    expect(bull).toHaveTextContent('above the mark')
    expect(bull.getAttribute('data-reached')).toBeNull()
  })

  it('says so when the ladder no longer holds the target the alert was about', () => {
    /* The reader raised the Bull case after the alert was raised. Every
       figure above describes a target that no longer exists, and saying
       nothing would be the surface asserting a stale record as current. */
    data = {
      ...data,
      ladder: {
        ...(data.ladder as any),
        cases: [
          { id: 'c-bear', name: 'Bear', price: 150 },
          { id: 'c-bull', name: 'Bull', price: 310 },
        ],
      } as never,
    }
    render(pane({ entryContext: contextFromPress(targetEntry()) }))
    expect(screen.getByTestId('target-record-changed'))
      .toHaveTextContent(/no longer hold a case at \$230\.00/)
  })

  it('states the age of the case and the exposure behind it', () => {
    data = { ...data, positions: [{
      portfolioId: 'p-vision', portfolioName: 'Vision Fund', shares: 1000, price: 272.95,
      marketValue: 272_950, weightPct: 4.21, avgCost: 120, unrealisedGain: null,
      unrealisedPct: null, asOf: daysAgo(5),
    }] }
    render(pane({ portfolioId: 'p-vision', entryContext: contextFromPress(targetEntry()) }))
    expect(screen.getByTestId('target-case-age')).toHaveTextContent(/253 days ago/)
    const exposure = screen.getByTestId('target-exposure')
    expect(exposure).toHaveTextContent('Vision Fund carries 4.21%')
  })

  it('leaves the canonical workspace below it intact', () => {
    data = { ...data, sections: [{
      section: 'thesis', content: 'Services mix is under-modelled.',
      supportingDetail: null, updatedAt: daysAgo(30), authorName: 'John Park',
    } as never] }
    render(pane({ entryContext: contextFromPress(targetEntry()) }))
    expect(screen.getByTestId('entry-target-review')).toBeInTheDocument()
    /* The canonical sections, the written thesis and the header identity are
       all still on the page: the band is added above the workspace, never
       instead of it. */
    expect(screen.getByRole('heading', { name: 'The case' })).toBeInTheDocument()
    expect(screen.getByText('Services mix is under-modelled.')).toBeInTheDocument()
    expect(screen.getByText('AAPL')).toBeInTheDocument()
    expect(screen.getAllByTestId('desktop-section').length).toBeGreaterThan(1)
  })
})

/* ------------------------- 2. a pending request does not take the lead */

describe('a pending recommendation on the same name', () => {
  beforeEach(() => {
    data = { ...data, decisions: [{
      id: 'dr-1', status: 'pending', action: 'Add to 4.5%', decidedAt: null,
      portfolioId: 'p-vision', portfolioName: 'Vision Fund',
      decisionNote: 'Services mix is carrying the multiple.',
    }] }
  })

  it('does not displace the target event the reader pressed', () => {
    render(pane({ entryContext: contextFromPress(targetEntry()) }))
    const target = screen.getByTestId('entry-target-review')
    const request = screen.getByTestId('decision-band')
    /* Document order: the thing the reader selected is above the thing that
       happens to also be open. This is the reported defect. */
    expect(target.compareDocumentPosition(request) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('is still surfaced inside the orientation, as supporting context', () => {
    render(pane({ entryContext: contextFromPress(targetEntry()) }))
    const also = screen.getByTestId('target-pending-decision')
    expect(also).toHaveTextContent('Add to 4.5%')
    expect(also).toHaveTextContent('Vision Fund')
  })

  it('takes the lead when the recommendation IS what the reader opened', () => {
    render(pane({
      focus: 'decisions',
      entryContext: entryContextFor({
        selection: RECOMMENDATION_SELECTION, row: RECOMMENDATION_ROW, organizationId: ORG,
      }),
    }))
    const prep = screen.getByTestId('entry-decision-prep')
    expect(prep).toHaveTextContent('A. Analyst is asking you to answer a add on AAPL in Vision Fund')
    expect(screen.getByTestId('recommendation-sizing')).toHaveTextContent('4.50%')
    expect(screen.getByTestId('recommendation-sizing')).toHaveTextContent('2.10%')
    expect(screen.getByTestId('recommendation-rationale'))
      .toHaveTextContent('Services mix is carrying the multiple.')
    expect(screen.queryByTestId('entry-target-review')).not.toBeInTheDocument()
  })
})

/* --------------------------------------------- 3. general stays general */

describe('a cold open', () => {
  it('renders the workspace exactly as it did, with no orientation band', () => {
    render(pane())
    expect(screen.queryByTestId('entry-target-review')).not.toBeInTheDocument()
    expect(screen.queryByTestId('entry-decision-prep')).not.toBeInTheDocument()
    expect(screen.getByTestId('asset-workspace')).toBeInTheDocument()
    expect(screen.getByText('The case')).toBeInTheDocument()
  })

  it('stays general for a family that carries no event', () => {
    /* A crowded name is an argument about the position, and the position
       module already answers it. Promoting it to an orientation would be a
       band for the sake of having one. */
    render(pane({
      entryContext: entryContextFor({
        selection: { family: 'crowding', key: 'c-1', assetId: 'a-aapl', symbol: 'AAPL' },
        organizationId: ORG,
      }),
    }))
    expect(screen.queryByTestId('entry-target-review')).not.toBeInTheDocument()
  })
})

/* ------------------------------------------------- 4. stale context */

describe('context that no longer describes the screen', () => {
  it('is discarded when the reader opens a different name', () => {
    const context = contextFromPress(targetEntry())
    render(
      <AssetWorkspacePane
        asset={{ id: 'a-msft', symbol: 'MSFT', company_name: 'Microsoft' }}
        organizationId={ORG}
        entryContext={context}
      />,
    )
    expect(screen.queryByTestId('entry-target-review')).not.toBeInTheDocument()
  })

  it('is discarded after an organisation switch', () => {
    render(pane({ organizationId: 'org-b', entryContext: contextFromPress(targetEntry()) }))
    expect(screen.queryByTestId('entry-target-review')).not.toBeInTheDocument()
  })

  it('is discarded while the organisation is still unknown', () => {
    render(pane({ organizationId: null, entryContext: contextFromPress(targetEntry(), null) }))
    expect(screen.queryByTestId('entry-target-review')).not.toBeInTheDocument()
  })
})

/* ------------------------------------- 5. every control is a real hop */

describe('the orientation actions', () => {
  it('opens the canonical thesis editor in place', async () => {
    render(pane({ entryContext: contextFromPress(targetEntry()) }))
    await userEvent.click(screen.getByTestId('target-review-case'))
    expect(screen.getByTestId('real-thesis-editor')).toHaveAttribute('data-asset', 'a-aapl')
  })

  it('sends the scenarios control to the asset page at its framework', async () => {
    render(pane({ entryContext: contextFromPress(targetEntry()) }))
    await userEvent.click(screen.getByTestId('target-open-scenarios'))
    expect(opened).toHaveLength(1)
    expect(opened[0]).toMatchObject({
      assetId: 'a-aapl', symbol: 'AAPL', focus: 'framework', origin: 'target_hit',
    })
    /* The reason travels, so the reader does not have to restate it. */
    expect(opened[0].issue).toMatch(/reached the target/)
  })

  it('offers no request control when no request is waiting', () => {
    render(pane({ entryContext: contextFromPress(targetEntry()) }))
    expect(screen.queryByTestId('target-open-pending')).not.toBeInTheDocument()
  })

  it('carries the target event into ACT AI, and asks nothing about buying or selling', async () => {
    render(pane({ entryContext: contextFromPress(targetEntry()) }))
    const questions = screen.getByTestId('target-ai-questions')
      .querySelectorAll('[data-slot="entry-ai-question"]')
    expect(questions.length).toBeGreaterThanOrEqual(2)
    for (const q of Array.from(questions)) {
      expect(q.textContent ?? '').not.toMatch(/\b(should I|sell|buy|trim)\b/i)
    }

    await userEvent.click(questions[0] as HTMLElement)
    expect(asked).toHaveLength(1)
    expect(asked[0].seedPrompt).toMatch(/\$272\.95/)
    expect(asked[0].seedPrompt).toMatch(/Bull case at \$230\.00/)
    expect(asked[0].assetId).toBe('a-aapl')
    expect(asked[0].origin).toMatchObject({ surface: 'asset-entry-orientation' })
  })

  it('hands the waiting request off to the object that answers it', async () => {
    data = {
      ...data,
      decisions: [{
        id: 'dr-1', status: 'pending', action: 'Add to 4.5%', decidedAt: null,
        portfolioId: 'p-vision', portfolioName: 'Vision Fund', decisionNote: null,
      }],
      liveIdeas: [{ id: 'idea-1', action: 'add', stage: 'review', rationale: null } as never],
    }
    const dispatched: any[] = []
    const listener = (e: Event) => dispatched.push((e as CustomEvent).detail)
    window.addEventListener('decision-engine-action', listener)
    try {
      render(pane({ entryContext: contextFromPress(targetEntry()) }))
      await userEvent.click(screen.getByTestId('target-open-pending'))
      expect(dispatched).toHaveLength(1)
      expect(JSON.stringify(dispatched[0])).toContain('idea-1')
    } finally {
      window.removeEventListener('decision-engine-action', listener)
    }
  })
})
