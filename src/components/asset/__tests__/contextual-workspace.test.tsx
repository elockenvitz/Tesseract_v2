/**
 * Opening the same name for three different reasons has to produce three
 * different workspaces.
 *
 * ── What this suite exists to prevent ────────────────────────────────────
 *
 * The first attempt at a contextual workspace was a constant describing what
 * each situation should lead with, which nothing read: six situations, one
 * page, a `data-` attribute as the only difference. The second attempt is
 * this one, so the assertions here are deliberately about RENDERED CONTENT
 * and REAL HANDLERS -- the recommendation's own words, the requirement's own
 * text, the sub-page a control actually asks for.
 *
 * `entry.test.ts` already covers which mode a descriptor resolves to. The
 * question here is whether the page obeys it, and whether each composition
 * shows the records a reader in that situation came for.
 *
 * ── What is deliberately NOT asserted ────────────────────────────────────
 *
 * Nothing about the briefing's prose (it costs a model call and has its own
 * suite) and nothing about class names. The briefing is checked for ONE
 * thing: that the entry mode reaches it, because the question it asks is
 * framed by that and a reader cannot see the difference until it runs.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import type { AssetWorkspaceData } from '../../../hooks/useAssetWorkspace'
import type { WorkspaceEntry } from '../../../lib/asset-workspace/entry'
import type { AssetRequirements } from '../../../hooks/useAssetOpenRequirements'

const BASE: AssetWorkspaceData = {
  sections: [], evidence: [], caseWrittenAt: null, coreSections: [],
  history: [], spot: null, ladder: null, target: null,
  positions: [], liveIdeas: [], decisions: [],
}

let data: AssetWorkspaceData = BASE
let books: { id: string; name: string; role: string | null }[] = []
/** What `useAssetWorkAttention` returns: the enrichment, not the spine. */
let attention = { needsYourAction: [] as any[], awaitingOthers: [] as any[] }
let requirements: AssetRequirements = { all: [], open: [], doneCount: 0, isLoading: false }
const asked: string[] = []

vi.mock('../../../hooks/useAssetWorkspace', async importOriginal => {
  const actual = await importOriginal<typeof import('../../../hooks/useAssetWorkspace')>()
  return { ...actual, useAssetWorkspace: () => ({ data, isLoading: false, error: null }) }
})
vi.mock('../../../hooks/useAssetDecisionTimeline', () => ({
  useAssetDecisionTimeline: () => ({
    events: [], allEvents: [],
    phaseCounts: { all: 0, exploratory: 0, formal: 0, execution: 0, review: 0 },
    isLoading: false, isError: false,
  }),
}))
vi.mock('../../../hooks/useAnalystRatings', () => ({
  useAnalystRatings: () => ({ ratings: [], consensus: [], myRating: undefined, isLoading: false }),
}))
vi.mock('../../../hooks/useDesktopPortfolio', () => ({
  usePortfolioList: () => ({ portfolios: books, isLoading: false }),
}))
vi.mock('../../../hooks/useAssetWorkAttention', () => ({
  useAssetWorkAttention: () => ({ attention, isLoading: false, pmPortfolioIds: [] }),
}))
vi.mock('../../../hooks/useAssetOpenRequirements', () => ({
  useAssetOpenRequirements: () => requirements,
}))
vi.mock('../../coverage/CoverageDisplay', () => ({
  CoverageDisplay: () => <div data-testid="coverage" />,
}))
vi.mock('../../portfolio-v2/PortfolioVisual', async importOriginal => {
  const actual = await importOriginal<typeof import('../../portfolio-v2/PortfolioVisual')>()
  return { ...actual, FrameworkScale: () => <div data-testid="ladder" /> }
})
/* The briefing costs a model call. Stubbed, but reporting the one prop this
   suite cares about: the entry mode the page handed it. */
vi.mock('../AssetBriefingSection', () => ({
  AssetBriefingSection: ({ entryMode }: { entryMode?: string }) => (
    <div data-testid="briefing" data-entry-mode={entryMode ?? 'none'} />
  ),
}))
/* The engagement seam. Asserted, not exercised: opening the pane is the
   pane's behaviour and has its own suite. */
vi.mock('../../../lib/engagement', async importOriginal => {
  const actual = await importOriginal<typeof import('../../../lib/engagement')>()
  return {
    ...actual,
    askAI: (target: { seedPrompt?: string }) => { asked.push(target.seedPrompt ?? '') },
  }
})

import { InvestmentSnapshot } from '../InvestmentSnapshot'

const ASSET = { id: 'a-1', symbol: 'AAPL', company_name: 'Apple Inc.' }

const position = () => ({
  portfolioId: 'p-growth', portfolioName: 'Large Cap Growth',
  shares: 150, price: 170, marketValue: 25_500, weightPct: 25.3,
  avgCost: 165.2, unrealisedGain: 2_020, unrealisedPct: 6.23,
  asOf: '2025-08-01',
})

const entry = (over: Partial<WorkspaceEntry> = {}): WorkspaceEntry => ({
  mode: 'general', decisionId: null, work: null, portfolioId: null,
  origin: null, reason: null, ...over,
})

const opened: string[] = []

function renderWorkspace(e: WorkspaceEntry, activeWorkflowId: string | null = null) {
  return render(
    <InvestmentSnapshot
      asset={ASSET}
      coverage={[]}
      currentQuote={{ price: 336.64, timestamp: '2026-10-09T20:00:00Z' }}
      onOpenSubPage={page => opened.push(page)}
      entry={e}
      activeWorkflowId={activeWorkflowId}
    />,
  )
}

const modeOf = () =>
  screen.getByTestId('investment-snapshot').getAttribute('data-entry-mode')
const leadOf = () =>
  screen.queryByTestId('snapshot-lead-row')?.getAttribute('data-lead') ?? null

beforeEach(() => {
  cleanup()
  data = { ...BASE }
  books = []
  attention = { needsYourAction: [], awaitingOthers: [] }
  requirements = { all: [], open: [], doneCount: 0, isLoading: false }
  opened.length = 0
  asked.length = 0
})

/* ─────────────────────────────────────────────── 1. general review ─── */

describe('opened to review the name', () => {
  beforeEach(() => {
    data = {
      ...BASE,
      positions: [position()],
      caseWrittenAt: '2026-11-01T00:00:00Z',
      coreSections: ['thesis'],
      sections: [{
        section: 'thesis', content: 'Services margin is the whole case.',
        supportingDetail: null, updatedAt: '2026-11-01T00:00:00Z', authorName: 'An analyst',
      }],
    }
    books = [{ id: 'p-growth', name: 'Large Cap Growth', role: 'pm' }]
  })

  it('leads with the firm view, and says so in the mode', () => {
    renderWorkspace(entry())
    expect(modeOf()).toBe('general')
    expect(screen.getByTestId('snapshot-our-view')).toBeTruthy()
    expect(screen.queryByTestId('snapshot-decision-at-hand')).toBeNull()
    expect(screen.queryByTestId('snapshot-work-at-hand')).toBeNull()
  })

  it('offers the review actions, and no decision or process action', () => {
    renderWorkspace(entry())
    expect(screen.getByTestId('workspace-actions').getAttribute('data-mode')).toBe('general')
    expect(screen.getByTestId('workspace-action-case').textContent).toBe('Review the case')
    /* Held, so the exposure jump is real. */
    expect(screen.getByTestId('workspace-action-exposure')).toBeTruthy()
    expect(screen.queryByTestId('workspace-action-decision')).toBeNull()
    /* No run on record: an action that resolved to an empty process surface
       would cost a click to learn the page already knew. */
    expect(screen.queryByTestId('workspace-action-process')).toBeNull()
  })

  it('does not offer the exposure jump on a name nobody holds', () => {
    data = { ...data, positions: [] }
    books = []
    renderWorkspace(entry())
    expect(screen.queryByTestId('workspace-action-exposure')).toBeNull()
  })

  it('shows the running process, without it leading the page', () => {
    /*
     * "Active work and research requirements" is one of the questions this
     * surface answers, and it answered only the half that is an idea or a
     * decision request. A name with a live run showed no sign of it until
     * the reader changed mode.
     */
    requirements = {
      all: [{ id: 'ci-9', text: 'Interview two channel partners', stageId: 's-2', completed: false, dueDate: null, assigneeName: null }],
      open: [{ id: 'ci-9', text: 'Interview two channel partners', stageId: 's-2', completed: false, dueDate: null, assigneeName: null }],
      doneCount: 0,
      isLoading: false,
    }
    renderWorkspace(entry(), 'wf-1')
    const block = screen.getByTestId('snapshot-work-at-hand')
    expect(block.textContent).toMatch(/Interview two channel partners/)
    /* Supporting, not leading, and without the arrival framing. */
    expect(leadOf()).not.toBe('work-entry')
    expect(block.textContent).not.toMatch(/You were sent here/)
    expect(screen.getByTestId('workspace-action-process')).toBeTruthy()
  })

  it('says nothing about a process when the page has no run', () => {
    renderWorkspace(entry(), null)
    expect(screen.queryByTestId('snapshot-work-at-hand')).toBeNull()
  })

  it('opens the assistant without putting a question in the composer', () => {
    /*
     * This used to assert the opposite -- that pressing "Ask ACT AI" sent a
     * drafted question about the current view of AAPL, which the pane then
     * typed into the composer.
     *
     * The button says it will open ACT AI. A reader who presses it has asked
     * for a blank box, and arriving to find a three-clause question already
     * written there means clearing it before they can ask their own. The two
     * buttons in this row that DO name a question still send one; they are
     * asserted below, and they now also send the reason they are naming it.
     *
     * Context is not a question: the asset still travels as inherited
     * context, which `engagement.test.ts` covers through `toAITags`.
     */
    renderWorkspace(entry())
    fireEvent.click(screen.getByTestId('workspace-action-ask'))
    expect(asked).toHaveLength(1)
    expect(asked[0]).toBe('')
  })
})

/* ──────────────────────────────────────── 2. a decision to rule on ─── */

describe('opened to rule on a recommendation', () => {
  beforeEach(() => {
    data = {
      ...BASE,
      positions: [position()],
      decisions: [
        {
          id: 'dr-7', status: 'pending', action: 'buy', decidedAt: null,
          portfolioId: 'p-growth', portfolioName: 'Large Cap Growth',
          decisionNote: 'Services mix supports a larger weight.', ideaId: 'idea-3',
        },
        {
          id: 'dr-8', status: 'pending', action: 'trim', decidedAt: null,
          portfolioId: 'p-income', portfolioName: 'Equity Income',
          decisionNote: null, ideaId: null,
        },
      ],
    }
    books = [{ id: 'p-growth', name: 'Large Cap Growth', role: 'pm' }]
    attention = {
      needsYourAction: [{
        id: 'dr-7', requesterName: 'Dana Reyes', createdAt: '2026-11-09T00:00:00Z',
      }],
      awaitingOthers: [],
    }
  })

  it('leads with the request itself, not with the thesis', () => {
    renderWorkspace(entry({ mode: 'decision', decisionId: 'dr-7' }))
    expect(modeOf()).toBe('decision')
    expect(leadOf()).toBe('decision-entry')
    const block = screen.getByTestId('snapshot-decision-at-hand')
    expect(block.textContent).toMatch(/buy in Large Cap Growth/)
    expect(block.textContent).toMatch(/Services mix supports a larger weight/)
  })

  it('names who proposed it and how long it has waited', () => {
    /* The facts a PM needs and the general queue never carried: the row
       there was a verb, a book, and a note that is usually blank. */
    renderWorkspace(entry({ mode: 'decision', decisionId: 'dr-7' }))
    const block = screen.getByTestId('snapshot-decision-at-hand')
    expect(block.textContent).toMatch(/Proposed by Dana Reyes/)
    expect(block.textContent).toMatch(/waiting \d+ days/)
    expect(block.textContent).toMatch(/Yours to answer/)
  })

  it('puts the request the reader clicked first, and keeps the others', () => {
    renderWorkspace(entry({ mode: 'decision', decisionId: 'dr-8' }))
    const rows = screen.getAllByTestId('decision-at-hand-row')
    expect(rows.map(r => r.getAttribute('data-decision'))).toEqual(['dr-8', 'dr-7'])
    expect(rows[0].getAttribute('data-arrived')).toBe('yes')
  })

  it('says plainly when a request carries no rationale', () => {
    /* Honest absence rather than a blank row or invented summary. */
    renderWorkspace(entry({ mode: 'decision', decisionId: 'dr-8' }))
    expect(screen.getByTestId('snapshot-decision-at-hand').textContent)
      .toMatch(/No rationale was recorded/)
  })

  it('stands the idea rationale in for a request with no note of its own', () => {
    data = {
      ...data,
      decisions: [data.decisions[0]],
      liveIdeas: [{
        id: 'idea-3', action: 'buy', stage: 'deciding',
        rationale: 'The idea said why.', portfolioName: 'Large Cap Growth',
      }],
    }
    data.decisions = [{ ...data.decisions[0], decisionNote: null }]
    renderWorkspace(entry({ mode: 'decision', decisionId: 'dr-7' }))
    expect(screen.getByTestId('snapshot-decision-at-hand').textContent)
      .toMatch(/The idea said why/)
  })

  it('carries the sender reason, attributed to the sender', () => {
    renderWorkspace(entry({ mode: 'decision', decisionId: 'dr-7', reason: 'Buy waiting since Monday' }))
    expect(screen.getByTestId('snapshot-decision-at-hand').textContent)
      .toMatch(/You were sent here: Buy waiting since Monday/)
  })

  it('reaches the real decision surface', () => {
    renderWorkspace(entry({ mode: 'decision', decisionId: 'dr-7' }))
    fireEvent.click(screen.getByTestId('decision-at-hand-open'))
    fireEvent.click(screen.getByTestId('workspace-action-decision'))
    expect(opened).toEqual(['decisions', 'decisions'])
  })

  it('keeps the case on the page, below what is being decided', () => {
    /* Emphasis reorders; it never hides. A PM ruling on a buy still needs
       the written case, just not before they know what the buy is. */
    data = {
      ...data,
      caseWrittenAt: '2026-11-01T00:00:00Z',
      coreSections: ['thesis'],
      sections: [{
        section: 'thesis', content: 'Services margin is the whole case.',
        supportingDetail: null, updatedAt: '2026-11-01T00:00:00Z', authorName: 'An analyst',
      }],
    }
    renderWorkspace(entry({ mode: 'decision', decisionId: 'dr-7' }))
    const page = screen.getByTestId('investment-snapshot')
    const view = screen.getByTestId('snapshot-our-view')
    const block = screen.getByTestId('snapshot-decision-at-hand')
    expect(page.contains(view)).toBe(true)
    /* The decision block comes first in document order. */
    expect(block.compareDocumentPosition(view) & Node.DOCUMENT_POSITION_FOLLOWING)
      .toBeTruthy()
  })

  it('renders the exposure once, beside the decision', () => {
    renderWorkspace(entry({ mode: 'decision', decisionId: 'dr-7' }))
    expect(screen.getAllByTestId('snapshot-exposure')).toHaveLength(1)
    expect(screen.getAllByText(/25\.3/)).toHaveLength(1)
  })

  it('does not draw the generic queue as well', () => {
    /* `DecisionAtHand` supersedes it. Both would be the same records twice,
       which is the defect the consolidated evidence section fixed in chat. */
    renderWorkspace(entry({ mode: 'decision', decisionId: 'dr-7' }))
    expect(screen.queryByTestId('snapshot-needs-decision')).toBeNull()
  })

  it('falls back to the general page when the request has been ruled on', () => {
    /* A day-old link. Leading with a block about a request nobody is waiting
       on is worse than the page the reader would otherwise have had. */
    data = { ...data, decisions: [] }
    renderWorkspace(entry({ mode: 'decision', decisionId: 'dr-7' }))
    expect(modeOf()).toBe('general')
    expect(screen.queryByTestId('snapshot-decision-at-hand')).toBeNull()
    expect(screen.getByTestId('snapshot-our-view')).toBeTruthy()
  })

  it('frames the assistant around the decision', () => {
    renderWorkspace(entry({ mode: 'decision', decisionId: 'dr-7' }))
    expect(screen.getByTestId('briefing').getAttribute('data-entry-mode')).toBe('decision')
    fireEvent.click(screen.getByTestId('workspace-action-ask'))
    expect(asked[0]).toMatch(/what is missing that a ruling would normally rest on/)
  })
})

/* ──────────────────────────────────────── 3. work to be advanced ─── */

describe('opened to advance a process', () => {
  const workEntry = entry({
    mode: 'work',
    work: { workflowId: 'wf-1', stageId: 's-2', requirementId: 'ci-9' },
  })

  beforeEach(() => {
    requirements = {
      all: [
        { id: 'ci-8', text: 'Build the revenue model', stageId: 's-1', completed: true, dueDate: null, assigneeName: 'Dana Reyes' },
        { id: 'ci-9', text: 'Interview two channel partners', stageId: 's-2', completed: false, dueDate: '2026-11-20', assigneeName: 'You Analyst' },
        { id: 'ci-10', text: null, stageId: 's-2', completed: false, dueDate: null, assigneeName: null },
      ],
      open: [
        { id: 'ci-9', text: 'Interview two channel partners', stageId: 's-2', completed: false, dueDate: '2026-11-20', assigneeName: 'You Analyst' },
        { id: 'ci-10', text: null, stageId: 's-2', completed: false, dueDate: null, assigneeName: null },
      ],
      doneCount: 1,
      isLoading: false,
    }
  })

  it('leads with the process and what it still owes', () => {
    renderWorkspace(workEntry, 'wf-1')
    expect(modeOf()).toBe('work')
    expect(leadOf()).toBe('work-entry')
    const block = screen.getByTestId('snapshot-work-at-hand')
    expect(block.textContent).toMatch(/1 of 3 requirements complete/)
    expect(block.textContent).toMatch(/2 still owed/)
  })

  it('puts the requirement the reader followed first, with its owner', () => {
    renderWorkspace(workEntry, 'wf-1')
    const rows = screen.getAllByTestId('work-at-hand-requirement')
    expect(rows[0].getAttribute('data-requirement')).toBe('ci-9')
    expect(rows[0].getAttribute('data-arrived')).toBe('yes')
    expect(rows[0].textContent).toMatch(/Interview two channel partners/)
    expect(rows[0].textContent).toMatch(/assigned to You Analyst/)
  })

  it('says an untitled requirement is untitled', () => {
    /* Real state of this data: a row created by a template edit carries no
       text. A blank row would read as a rendering fault. */
    renderWorkspace(workEntry, 'wf-1')
    const rows = screen.getAllByTestId('work-at-hand-requirement')
    expect(rows[1].textContent).toMatch(/Untitled requirement/)
    expect(rows[1].textContent).toMatch(/unassigned/)
  })

  it('says so when the requirement that was followed is already done', () => {
    requirements = {
      ...requirements,
      all: requirements.all.map(r => r.id === 'ci-9' ? { ...r, completed: true } : r),
      open: requirements.open.filter(r => r.id !== 'ci-9'),
      doneCount: 2,
    }
    renderWorkspace(workEntry, 'wf-1')
    expect(screen.getByTestId('snapshot-work-at-hand').textContent)
      .toMatch(/Already complete/)
  })

  it('is honest about a run with nothing on record', () => {
    requirements = { all: [], open: [], doneCount: 0, isLoading: false }
    renderWorkspace(workEntry, 'wf-1')
    expect(screen.getByTestId('snapshot-work-at-hand').textContent)
      .toMatch(/no requirements on record/)
  })

  it('reaches the real process surface', () => {
    renderWorkspace(workEntry, 'wf-1')
    fireEvent.click(screen.getByTestId('work-at-hand-open'))
    expect(opened).toEqual(['workflow'])
    fireEvent.click(screen.getByTestId('workspace-action-process'))
    expect(opened).toEqual(['workflow', 'workflow'])
  })

  it('offers the process action even when the page has no run selected', () => {
    /* The entry named the run, which is enough: the reader followed a link
       into it. `activeWorkflowId` is the page's own selection and may not
       have caught up. */
    renderWorkspace(workEntry, null)
    expect(screen.getByTestId('workspace-action-process')).toBeTruthy()
  })

  it('draws the process once, as the lead, never also in the column', () => {
    renderWorkspace(workEntry, 'wf-1')
    expect(screen.getAllByTestId('snapshot-work-at-hand')).toHaveLength(1)
  })

  it('frames the assistant around the work', () => {
    renderWorkspace(workEntry, 'wf-1')
    expect(screen.getByTestId('briefing').getAttribute('data-entry-mode')).toBe('work')
    fireEvent.click(screen.getByTestId('workspace-action-ask'))
    expect(asked[0]).toMatch(/bears on the open requirements/)
  })

  it('falls back to the general page when the sender named no run', () => {
    renderWorkspace(entry({ mode: 'work', work: null }))
    expect(modeOf()).toBe('general')
    expect(screen.queryByTestId('snapshot-work-at-hand')).toBeNull()
  })
})

/* ─────────────────────────────────── 4. the three actually differ ─── */

describe('the three compositions are not the same page', () => {
  /*
   * The test the first attempt would have failed. It asserted a property of
   * a constant; this renders all three and compares what a reader sees.
   */
  const withEverything = () => {
    data = {
      ...BASE,
      positions: [position()],
      caseWrittenAt: '2026-11-01T00:00:00Z',
      coreSections: ['thesis'],
      sections: [{
        section: 'thesis', content: 'Services margin is the whole case.',
        supportingDetail: null, updatedAt: '2026-11-01T00:00:00Z', authorName: 'An analyst',
      }],
      decisions: [{
        id: 'dr-7', status: 'pending', action: 'buy', decidedAt: null,
        portfolioId: 'p-growth', portfolioName: 'Large Cap Growth',
        decisionNote: 'Services mix supports a larger weight.', ideaId: null,
      }],
    }
    books = [{ id: 'p-growth', name: 'Large Cap Growth', role: 'pm' }]
    requirements = {
      all: [{ id: 'ci-9', text: 'Interview two channel partners', stageId: 's-2', completed: false, dueDate: null, assigneeName: null }],
      open: [{ id: 'ci-9', text: 'Interview two channel partners', stageId: 's-2', completed: false, dueDate: null, assigneeName: null }],
      doneCount: 0,
      isLoading: false,
    }
  }

  /** What leads the page, and which actions are offered. */
  function snapshotOf(e: WorkspaceEntry) {
    withEverything()
    renderWorkspace(e, 'wf-1')
    const lead = screen.getByTestId('snapshot-lead-row')
    const firstBlock = lead.querySelector('[data-testid^="snapshot-"]')
    const actions = [...screen.getByTestId('workspace-actions').querySelectorAll('button')]
      .map(b => b.textContent)
    cleanup()
    return { lead: firstBlock?.getAttribute('data-testid') ?? null, actions }
  }

  it('leads with a different block and offers different actions in each', () => {
    const general = snapshotOf(entry())
    const decision = snapshotOf(entry({ mode: 'decision', decisionId: 'dr-7' }))
    const work = snapshotOf(entry({ mode: 'work', work: { workflowId: 'wf-1', requirementId: 'ci-9' } }))

    expect(general.lead).toBe('snapshot-our-view')
    expect(decision.lead).toBe('snapshot-decision-at-hand')
    expect(work.lead).toBe('snapshot-work-at-hand')

    /* Three distinct action rows, each naming its own first move. */
    expect(decision.actions[0]).toBe('Open the recommendation')
    expect(work.actions[0]).toBe('Continue the process')
    expect(general.actions[0]).toBe('Review the case')
    expect(new Set([general.actions.join('|'), decision.actions.join('|'), work.actions.join('|')]).size)
      .toBe(3)
  })
})
