/**
 * Pressing the target-reached card opens a target review, end to end.
 *
 * ── Why this test mounts the shell ───────────────────────────────────────
 *
 * The reported defect was not in any one function. The lens computed the
 * event, the builder put it on a card, the shell selected it, and the pane
 * beside it rendered a workspace that never mentioned a target, because the
 * row was dropped at two boundaries on the way. Every piece passed its own
 * test.
 *
 * So this presses the row a reader presses and asserts what appears in the
 * pane: the real `DashboardNext`, the real `StartHereBand`, the real
 * `selectionFor`, the real `IdeasWorkPane` and the real `AssetWorkspacePane`.
 * Only the data reads are stubbed. If the row stops reaching the context, or
 * the context stops reaching the composition, this fails.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { buildTargetHitCard } from '../../../lib/signals/builders/legacy-kinds'
import type { AttentionEntry } from '../../../hooks/useDesktopAttentionFeed'
import type { AssetWorkspaceData } from '../../../hooks/useAssetWorkspace'

const DAY = 86_400_000
const daysAgo = (n: number) => new Date(Date.now() - n * DAY).toISOString()

/** The AAPL row, as `usePortfolioLenses` produces it. */
const BREACH = {
  assetId: 'a-aapl', symbol: 'AAPL', companyName: 'Apple Inc.',
  price: 272.95, target: 230, overshootPct: (272.95 - 230) / 230,
  caseName: 'Bull',
  cases: [
    { id: 'c-bear', name: 'Bear', price: 150 },
    { id: 'c-base', name: 'Base', price: 195 },
    { id: 'c-bull', name: 'Bull', price: 230 },
  ],
  conviction: 'high',
  heldIn: ['Vision Fund'], heldInIds: ['p-vision'],
  statedAt: '2026-03-04T00:00:00.000Z', asOf: daysAgo(5),
}

const built = buildTargetHitCard(BREACH as never)
if (!built.ok || !built.card) throw new Error('the fixture does not build a card')

/** The entry exactly as the feed assembles it, row and all. */
const ENTRY: AttentionEntry = {
  key: built.card.id, card: built.card, item: null, input: null,
  family: 'target_hit', source: BREACH as never,
}

const WORKSPACE: AssetWorkspaceData = {
  sections: [], evidence: [], caseWrittenAt: daysAgo(253), coreSections: [],
  history: [{ date: '2026-11-10', close: 268.2 }], spot: 268.2,
  ladder: {
    assetId: 'a-aapl', symbol: 'AAPL', companyName: 'Apple Inc.',
    cases: [
      { id: 'c-bear', name: 'Bear', price: 150 },
      { id: 'c-base', name: 'Base', price: 195 },
      { id: 'c-bull', name: 'Bull', price: 230 },
    ],
    updatedAt: daysAgo(30), valid: true, reason: '',
  } as never,
  target: 230, positions: [], liveIdeas: [], decisions: [],
}

/* ---------------------------------------------------- the shell's lenses */

vi.mock('../../portfolio-v2/PortfolioWorkspace', () => ({
  PortfolioWorkspace: () => <div data-testid="portfolio" />,
}))
/*
 * The card field.
 *
 * Stubbed, but not inert: it renders the shell's own `lead` node -- the real
 * `StartHereBand`, built from the entries the feed is drawing -- and exposes
 * the shell's own `onSelect`, which is the handler a card press calls. So
 * both ways into the pane are the real ones; what is stubbed is the drawing
 * of 83 tiles, which this test is not about.
 *
 * `vi.hoisted` because a `vi.mock` factory runs during the import of the
 * module under test, before a plain const at this file's scope exists.
 */
const feed = vi.hoisted(() => ({ entries: [] as any[] }))
vi.mock('../../ideas-app/IdeasExplore', () => ({
  IdeasExplore: ({ lead, onSelect }: any) => (
    <div data-testid="feed">
      {lead?.(feed.entries)}
      <button data-testid="press-card" onClick={() => onSelect?.(feed.entries[0])}>
        the card itself
      </button>
    </div>
  ),
}))
vi.mock('../../ideas-app/IdeasExploreBrowse', () => ({
  IdeasExploreBrowse: () => <div data-testid="explore" />,
}))
vi.mock('../../mobile/ArticleReader', () => ({ ArticleReader: () => null }))

vi.mock('../../../hooks/useDesktopAttentionFeed', () => ({
  useDesktopAttentionFeed: () => ({ entries: [ENTRY], isLoading: false }),
}))
vi.mock('../../../hooks/usePromptResolve', () => ({
  usePromptResolve: () => ({ mutate: vi.fn() }),
}))
vi.mock('../../../hooks/usePilotOnboarding', () => ({
  usePilotOnboarding: () => ({ markSignalWorked: vi.fn() }),
}))
vi.mock('../../../hooks/useAuth', () => ({
  useAuth: () => ({ user: { id: 'reader-1' } }),
}))

/* ------------------------------------------- what the work pane reads */

vi.mock('../../../hooks/useAssetWorkspace', async importOriginal => {
  const actual = await importOriginal<typeof import('../../../hooks/useAssetWorkspace')>()
  return { ...actual, useAssetWorkspace: () => ({ data: WORKSPACE, isLoading: false, error: null }) }
})
vi.mock('../../contributions', () => ({
  ThesisContainer: () => <div data-testid="real-thesis-editor" />,
}))
vi.mock('../../../hooks/useThesisReview', () => ({
  useThesisReviews: () => new Map<string, string>(),
  useRecordThesisReview: () => ({ record: vi.fn(), isPending: false, pendingOutcome: null }),
  useCurrentThesisConclusion: () => ({ current: null }),
}))
vi.mock('../../../contexts/OrganizationContext', () => ({
  useOrganization: () => ({ currentOrgId: 'org-a' }),
  /* What the pane actually calls: the accessor that returns null outside a
     provider rather than throwing. */
  useOrganizationOptional: () => ({ currentOrgId: 'org-a' }),
}))

import { DashboardNext } from '../DashboardNext'
import { forgetPlace } from '../place'

beforeEach(() => {
  forgetPlace()
  feed.entries = [ENTRY]
})

describe('the target-reached card', () => {
  it('opens the asset workspace oriented around the target event', async () => {
    render(<DashboardNext />)

    await userEvent.click(screen.getByTestId('press-card'))

    /* The pane beside the feed, oriented around what was pressed. */
    const band = await screen.findByTestId('entry-target-review')
    expect(within(band).getByText('AAPL · Valuation review')).toBeInTheDocument()
    expect(within(band).getByText(/passed the Bull case you set/)).toBeInTheDocument()

    const comparison = within(band).getByTestId('target-comparison')
    expect(comparison).toHaveTextContent('$230.00')
    expect(comparison).toHaveTextContent('$272.95')
    expect(comparison).toHaveTextContent('Book mark')

    /* And the canonical workspace is underneath it, not replaced by it. */
    expect(screen.getByTestId('asset-workspace')).toHaveAttribute('data-asset', 'a-aapl')
    expect(screen.getByRole('heading', { name: 'The case' })).toBeInTheDocument()
  })

  it('does not claim the price crossed the target today', async () => {
    render(<DashboardNext />)
    await userEvent.click(screen.getByTestId('press-card'))
    const age = await screen.findByTestId('target-reading-age')
    expect(age).toHaveTextContent(/5 days ago/)
    expect(age.textContent).not.toMatch(/today/i)
  })

  it('lands in the same place from the Start here row as from the card', async () => {
    /* Two entry points, one destination. The band is the real
       `StartHereBand`, drawn from the entries the feed is drawing, and its
       row is built from this card's own primary action. */
    render(<DashboardNext />)
    const row = screen.getAllByRole('listitem')[0]
    expect(row.textContent).toContain('AAPL')
    await userEvent.click(within(row).getByRole('button', { name: 'Open' }))

    const band = await screen.findByTestId('entry-target-review')
    expect(within(band).getByTestId('target-comparison')).toHaveTextContent('$230.00')
  })
})
