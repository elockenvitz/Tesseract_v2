/**
 * The expanded list row, state by state.
 *
 * Two rules carry most of the design and both are easy to regress, so both are
 * pinned here:
 *
 *   1. The orientation strip shows only what EXISTS. A thin case must not read
 *      as a broken one, so an absent price, position, rating or target renders
 *      nothing at all rather than a dash. Asserting the happy path alone would
 *      pass against a strip full of placeholders.
 *
 *   2. The five questions are the information ARCHITECTURE, not headings. A
 *      literal "What's changed?" title is a regression, so the absence of
 *      those strings is asserted directly.
 *
 * `MobileListRows` renders this same component without the `coverage` prop, so
 * the no-coverage case is a real shipping configuration rather than a defensive
 * test.
 */
import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'

const hooks = vi.hoisted(() => ({
  workspace: {
    sections: [] as any[],
    evidence: [] as any[],
    caseWrittenAt: null as string | null,
    coreSections: [] as string[],
    history: [] as any[],
    spot: null as number | null,
    ladder: null,
    target: null as number | null,
    positions: [] as any[],
    liveIdeas: [] as any[],
    decisions: [] as any[],
  },
  ratings: [] as any[],
  scales: [] as any[],
  updates: [] as any[],
}))

vi.mock('../../../hooks/useAssetWorkspace', () => ({
  useAssetWorkspace: () => ({ data: hooks.workspace, isLoading: false, error: null }),
}))
vi.mock('../../../hooks/useAnalystRatings', () => ({
  useAnalystRatings: () => ({ ratings: hooks.ratings }),
  useRatingScales: () => ({ scales: hooks.scales }),
}))
vi.mock('../../../hooks/lists/useUpdateListItem', () => ({
  useUpdateListItem: () => ({ mutate: (v: any) => hooks.updates.push(v) }),
}))
// The three list-scoped cells own their own data and popovers; this file is
// about the expansion's composition, not theirs.
vi.mock('../ListAssigneeCell', () => ({ ListAssigneeCell: () => <div data-testid="assignee" /> }))
vi.mock('../ListStatusCell', () => ({ ListStatusCell: () => <div data-testid="status" /> }))
vi.mock('../ListTagsCell', () => ({ ListTagsCell: () => <div data-testid="tags" /> }))

import { ListRowExpansion } from '../ListRowExpansion'

const asset = { id: 'a-aapl', symbol: 'AAPL', company_name: 'Apple Inc.' }

const section = (key: string, content: string, authorName = 'Eric L') => ({
  section: key, content, supportingDetail: null,
  updatedAt: '2026-09-01T00:00:00Z', authorName,
})

const evidence = (over: Partial<Record<string, unknown>> = {}) => ({
  id: Math.random().toString(36).slice(2),
  title: 'Q3 print beat',
  content: 'body',
  createdAt: '2026-10-01T00:00:00Z',
  authorName: 'Dana',
  isShared: true,
  isNewSinceReview: false,
  ...over,
})

function renderRow(props: Record<string, unknown> = {}) {
  return render(
    <ListRowExpansion
      listId="l-1"
      rowId="r-1"
      asset={asset}
      canEdit
      {...(props as any)}
    />,
  )
}

beforeEach(() => {
  hooks.workspace = {
    sections: [], evidence: [], caseWrittenAt: null, coreSections: [],
    history: [], spot: null, ladder: null, target: null,
    positions: [], liveIdeas: [], decisions: [],
  }
  hooks.ratings = []
  hooks.scales = []
  hooks.updates = []
})

describe('the orientation strip shows only what exists', () => {
  it('renders price, position, rating, conviction, target and upside when all are present', () => {
    hooks.workspace.spot = 170.5
    hooks.workspace.target = 200
    hooks.workspace.positions = [
      { portfolioId: 'p1', portfolioName: 'Tech Growth', shares: 10490, price: 170.5,
        marketValue: 1788545, weightPct: 5.14, avgCost: null, unrealisedGain: null,
        unrealisedPct: null, asOf: null },
    ]
    hooks.ratings = [{ id: 'r1', rating_value: 'Buy', rating_scale_id: 's1', conviction: 'high', is_official: true, updated_at: '2026-10-01' }]
    hooks.scales = [{ id: 's1', values: [{ value: 'Buy', label: 'Buy', color: '#10b981', sort: 1 }] }]

    renderRow()
    expect(screen.getByText('$170.50')).toBeInTheDocument()
    expect(screen.getByText('5.14%')).toBeInTheDocument()
    expect(screen.getByText('Buy')).toBeInTheDocument()
    expect(screen.getByText('$200.00')).toBeInTheDocument()
    // (200 - 170.5) / 170.5 = +17.3%
    expect(screen.getByText('+17.3%')).toBeInTheDocument()
  })

  it('omits cells entirely when the data is absent — no dashes, no placeholders', () => {
    renderRow()
    for (const label of ['Price', 'Position', 'Rating', 'Target', 'Upside']) {
      expect(screen.queryByText(label)).not.toBeInTheDocument()
    }
    // And specifically not the em-dash filler the old sidebar used.
    expect(screen.queryByText('—')).not.toBeInTheDocument()
  })

  it('shows shares when a position exists but its weight is unknowable', () => {
    // `weightPct` is deliberately null when the book's value cannot be derived.
    hooks.workspace.positions = [
      { portfolioId: 'p1', portfolioName: 'Tech Growth', shares: 1200, price: 10,
        marketValue: 12000, weightPct: null, avgCost: null, unrealisedGain: null,
        unrealisedPct: null, asOf: null },
    ]
    renderRow()
    expect(screen.getByText('1,200 sh')).toBeInTheDocument()
  })

  it('marks negative upside as negative', () => {
    hooks.workspace.spot = 200
    hooks.workspace.target = 180
    renderRow()
    expect(screen.getByText('-10.0%')).toBeInTheDocument()
  })

  it('prefers the official rating over a more recent unofficial one', () => {
    hooks.ratings = [
      { id: 'r-new', rating_value: 'Hold', rating_scale_id: 's1', conviction: 'low', is_official: false, updated_at: '2026-10-05' },
      { id: 'r-off', rating_value: 'Buy', rating_scale_id: 's1', conviction: 'high', is_official: true, updated_at: '2026-01-01' },
    ]
    hooks.scales = [{ id: 's1', values: [{ value: 'Buy', color: '#10b981' }, { value: 'Hold', color: '#f59e0b' }] }]
    renderRow()
    expect(screen.getByText('Buy')).toBeInTheDocument()
    expect(screen.queryByText('Hold')).not.toBeInTheDocument()
  })
})

describe('the case is the dominant content', () => {
  it('shows thesis and where we differ, with their authors', () => {
    hooks.workspace.sections = [
      section('thesis', 'Services mix is underappreciated.'),
      section('where_different', 'Street models hardware cyclicality only.', 'Dana R'),
      section('risks_to_thesis', 'China exposure.'),
    ]
    renderRow()
    expect(screen.getByText('Thesis')).toBeInTheDocument()
    expect(screen.getByText(/Services mix is underappreciated/)).toBeInTheDocument()
    expect(screen.getByText('Where we differ')).toBeInTheDocument()
    expect(screen.getByText('Dana R')).toBeInTheDocument()
  })

  it('leaves risks to the Asset page rather than carrying the whole case', () => {
    hooks.workspace.sections = [section('risks_to_thesis', 'China exposure.')]
    renderRow()
    expect(screen.queryByText('Risks to thesis')).not.toBeInTheDocument()
    expect(screen.getByText('No case written yet.')).toBeInTheDocument()
  })

  it('says so plainly when no case is written', () => {
    renderRow()
    expect(screen.getByText('No case written yet.')).toBeInTheDocument()
  })

  it('ignores a section that exists but is blank', () => {
    hooks.workspace.sections = [section('thesis', '   ')]
    renderRow()
    expect(screen.getByText('No case written yet.')).toBeInTheDocument()
  })
})

describe('what changed since the case was written', () => {
  it('leads with evidence that arrived after the review', () => {
    hooks.workspace.caseWrittenAt = '2026-09-01T00:00:00Z'
    hooks.workspace.evidence = [
      evidence({ title: 'Older note', createdAt: '2026-09-20T00:00:00Z', isNewSinceReview: false }),
      evidence({ title: 'New since review', createdAt: '2026-09-10T00:00:00Z', isNewSinceReview: true }),
    ]
    renderRow()
    expect(screen.getByText('Since review')).toBeInTheDocument()
    const titles = screen.getAllByText(/Older note|New since review/).map(n => n.textContent)
    // Unreviewed first, even though it is the older of the two.
    expect(titles[0]).toBe('New since review')
  })

  it('states how long ago the case was written', () => {
    hooks.workspace.caseWrittenAt = '2026-09-01T00:00:00Z'
    hooks.workspace.evidence = [evidence()]
    renderRow()
    // `getAllBy`: the phrase appears in the caption and again inside the
    // nested relative-time span.
    expect(screen.getAllByText(/case written/).length).toBeGreaterThan(0)
  })

  it('hides the whole block when there is no evidence', () => {
    renderRow()
    expect(screen.queryByText('Since review')).not.toBeInTheDocument()
  })
})

describe('active work and ownership', () => {
  it('shows the active idea and its portfolio', () => {
    hooks.workspace.liveIdeas = [
      { id: 'i1', action: 'buy', stage: 'deciding', rationale: null, portfolioName: 'Tech Growth' },
    ]
    renderRow()
    expect(screen.getByText('Active work')).toBeInTheDocument()
    expect(screen.getByText('buy')).toBeInTheDocument()
    expect(screen.getByText(/deciding/)).toBeInTheDocument()
    expect(screen.getByText('Tech Growth')).toBeInTheDocument()
  })

  it('hides the block when there is no idea and no decision', () => {
    renderRow()
    expect(screen.queryByText('Active work')).not.toBeInTheDocument()
  })

  it('shows coverage when the table passed it', () => {
    renderRow({ coverage: [{ analyst: 'Dana R', team: 'Tech', isLead: true }] })
    expect(screen.getByText('Dana R')).toBeInTheDocument()
    expect(screen.getByText('lead')).toBeInTheDocument()
  })

  it('renders without coverage — the mobile configuration', () => {
    renderRow()
    expect(screen.queryByText('Covered')).not.toBeInTheDocument()
    expect(screen.getByTestId('list-row-expansion')).toBeInTheDocument()
  })

  it('keeps the list-scoped controls', () => {
    renderRow()
    expect(screen.getByTestId('assignee')).toBeInTheDocument()
    expect(screen.getByTestId('status')).toBeInTheDocument()
    expect(screen.getByTestId('tags')).toBeInTheDocument()
    expect(screen.getByText('List note')).toBeInTheDocument()
  })
})

describe('one primary action, chosen from state', () => {
  const onOpenAsset = vi.fn()

  it('offers review when evidence is unread', () => {
    hooks.workspace.evidence = [evidence({ isNewSinceReview: true }), evidence({ isNewSinceReview: true })]
    renderRow({ onOpenAsset })
    expect(screen.getByText('Review 2 new')).toBeInTheDocument()
  })

  it('offers the idea when there is one and nothing unread', () => {
    hooks.workspace.sections = [section('thesis', 'A view.')]
    hooks.workspace.liveIdeas = [{ id: 'i1', action: 'buy', stage: null, rationale: null, portfolioName: null }]
    renderRow({ onOpenAsset })
    expect(screen.getByText('Open active idea')).toBeInTheDocument()
  })

  it('offers to write the case when there is none', () => {
    renderRow({ onOpenAsset })
    expect(screen.getByText('Write the case')).toBeInTheDocument()
  })

  it('offers no primary action when the case is written and nothing is pending', () => {
    hooks.workspace.sections = [section('thesis', 'A view.')]
    renderRow({ onOpenAsset })
    expect(screen.queryByText(/Review|Open active idea|Write the case/)).not.toBeInTheDocument()
    // The way into the full case is always there.
    expect(screen.getByText('Open full case')).toBeInTheDocument()
  })
})

describe('the five questions are architecture, not headings', () => {
  it('renders no question-shaped section titles', () => {
    hooks.workspace.sections = [section('thesis', 'A view.')]
    hooks.workspace.evidence = [evidence({ isNewSinceReview: true })]
    hooks.workspace.liveIdeas = [{ id: 'i1', action: 'buy', stage: null, rationale: null, portfolioName: null }]
    const { container } = renderRow({ coverage: [{ analyst: 'Dana R', team: 'Tech', isLead: false }] })
    const text = container.textContent ?? ''
    for (const q of [
      'What do we believe', "What's changed", 'What are we doing',
      'Who is involved', 'What can I do next',
    ]) {
      expect(text).not.toContain(q)
    }
  })
})

describe('the height contract', () => {
  it('animates contents, never height', () => {
    const { container } = renderRow()
    const root = container.querySelector('[data-testid="list-row-expansion"]')!
    const cls = root.className
    // Opacity + translate entrance, matching the chevron's 150ms.
    expect(cls).toContain('fade-in')
    expect(cls).toContain('duration-150')
    // A height/size transition here would fight the virtualiser, which sizes
    // expanded rows up front.
    expect(cls).not.toMatch(/transition-\[height\]|animate-height|transition-all/)
  })
})
