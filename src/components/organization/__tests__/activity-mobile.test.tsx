/**
 * Activity on a phone.
 *
 * The product line this guards: Activity explains an event, Audit exposes the
 * record. Opening a row used to reach event IDs, entity IDs and two raw JSON
 * blobs almost immediately, which turns a log an administrator reads into a
 * developer console. So the order — summary, then change, then readable
 * context, then the record behind a disclosure — is asserted, not assumed.
 *
 * The other half is that nothing was dropped to achieve that. Every audit
 * field still exists; it is one tap away. A test that only checked "JSON is
 * hidden" would pass just as well if the data had been deleted, so these
 * check both directions.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import { MOBILE_QUERY } from '../../../hooks/useMediaQuery'

// The tab fetches through react-query + supabase; neither is under test here.
const mockEntries = [
  {
    id: 'evt-0001-aaaa-bbbb-cccc-000000000001',
    organization_id: 'org-1',
    action: 'member.reactivated',
    // `action_type` is its own vocabulary, not the action name.
    action_type: 'reactivated',
    entity_type: 'org_member',
    target_id: 'tgt-1234',
    target_user_id: 'colin',
    actor_id: 'eric',
    initiator_user_id: 'eric',
    source_type: 'direct',
    source_id: null,
    created_at: '2026-09-22T19:55:00.000Z',
    details: { old_status: 'suspended', new_status: 'active' },
    metadata: {},
  },
]

vi.mock('@tanstack/react-query', () => ({
  useInfiniteQuery: () => ({
    data: { pages: [{ rows: mockEntries, totalCount: 191, nextOffset: 30 }] },
    isLoading: false,
    hasNextPage: false,
    fetchNextPage: vi.fn(),
    isFetchingNextPage: false,
  }),
}))
vi.mock('../../../lib/supabase', () => ({ supabase: { from: () => ({}) } }))

import { OrgActivityTab } from '../OrgActivityTab'

function setViewport(mobile: boolean) {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: mobile && query === MOBILE_QUERY,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })) as unknown as typeof window.matchMedia
}

const userNameMap = new Map([
  ['colin', 'Colin Knox'],
  ['eric', 'Eric Lockenvitz'],
])

function renderActivity() {
  return render(
    <OrgActivityTab organizationId="org-1" isOrgAdmin userNameMap={userNameMap} />,
  )
}

describe('Activity filters on a phone', () => {
  beforeEach(() => {
    setViewport(true)
    // jsdom has no layout; the rail calls this on selection.
    Element.prototype.scrollIntoView = vi.fn()
  })
  afterEach(() => vi.restoreAllMocks())

  it('uses the app date control, not a native mm/dd/yyyy field', () => {
    const { container } = renderActivity()
    // The raw input is what rendered as a browser-native field on a phone.
    expect(container.querySelector('input[type="date"]')).toBeNull()
    expect(screen.getByText('Start date')).toBeInTheDocument()
    expect(screen.getByText('End date')).toBeInTheDocument()
  })

  it('date controls carry the same control language as the other filters', () => {
    renderActivity()
    const startBtn = screen.getByText('Start date').closest('button') as HTMLElement
    // `no-touch-target` is how a control escapes the 44px coarse-pointer
    // floor; without it this sits a third taller than the selects beside it.
    expect(startBtn.className).toContain('no-touch-target')
    expect(startBtn.className).toContain('text-xs')
    expect(startBtn.className).toContain('rounded-lg')
  })

  it('a chosen date reads back in the app date format', () => {
    renderActivity()
    fireEvent.click(screen.getByText('Start date'))
    // The picker offers Today as a quick date; past dates must be selectable
    // at all, which they are not under the picker's default.
    fireEvent.click(screen.getByText('Today'))

    expect(screen.queryByText('Start date')).toBeNull()
    // Readable, not an ISO string or mm/dd/yyyy.
    expect(screen.getByText(/^[A-Z][a-z]{2} \d{1,2}, \d{4}$/)).toBeInTheDocument()
  })

  it('drops the category pills, which filtered the same field as the dropdown', () => {
    renderActivity()
    // Two controls for `entity_type` on one narrow screen, able to disagree
    // with each other. The Object dropdown is the one that stays.
    expect(document.querySelector('[data-slot="activity-category-rail"]')).toBeNull()
    expect(screen.queryByRole('button', { name: /Structure/ })).toBeNull()
    expect(screen.getByText('All objects')).toBeInTheDocument()
  })

  it('keeps the category rail on desktop, where there is room for both', () => {
    setViewport(false)
    renderActivity()
    const rail = document.querySelector('[data-slot="activity-category-rail"]') as HTMLElement
    expect(rail).not.toBeNull()
    expect(rail.className).toContain('scroll-px-3')

    const structure = within(rail).getByRole('button', { name: /Structure/ })
    fireEvent.click(structure)
    expect(structure.getAttribute('data-active')).toBe('true')
    expect(Element.prototype.scrollIntoView).toHaveBeenCalled()
  })

  it('puts export in the header, not in the filter stack', () => {
    renderActivity()
    const csv = screen.getByRole('button', { name: /CSV/ })
    // Same heading block as the title — one CSV control, never two.
    expect(csv.closest('div')?.parentElement?.textContent).toContain('Activity Log')
    expect(screen.getAllByRole('button', { name: /CSV/ })).toHaveLength(1)
  })

  it('keeps every existing filter control', () => {
    renderActivity()
    expect(screen.getByText('All people')).toBeInTheDocument()
    expect(screen.getByText('All objects')).toBeInTheDocument()
    expect(screen.getByText('How it happened')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /CSV/ })).toBeInTheDocument()
  })
})

describe('Activity event rows on a phone', () => {
  beforeEach(() => {
    setViewport(true)
    Element.prototype.scrollIntoView = vi.fn()
  })
  afterEach(() => vi.restoreAllMocks())

  it('lets an event title wrap instead of truncating it', () => {
    renderActivity()
    // "Colin Knox was reactivated" must not become "Colin Knox was reactiv…".
    const title = screen.getByText(/Colin Knox/)
    expect(title.className).toContain('line-clamp-2')
    expect(title.className).not.toMatch(/(^|\s)truncate(\s|$)/)
  })

  it('leads the expanded event with what happened, not with IDs', () => {
    renderActivity()
    fireEvent.click(screen.getByText(/Colin Knox/))

    expect(screen.getByText('What happened')).toBeInTheDocument()
    expect(screen.getByText('Context')).toBeInTheDocument()
    // A readable timestamp, not an ISO string.
    expect(screen.getByText(/Sep 22, 2026 ·/)).toBeInTheDocument()
  })

  it('never shows the raw audit payload by default', () => {
    renderActivity()
    fireEvent.click(screen.getByText(/Colin Knox/))

    expect(document.querySelector('[data-slot="activity-technical-body"]')).toBeNull()
    expect(screen.queryByText('Event ID:')).toBeNull()
    expect(document.querySelector('pre')).toBeNull()
  })

  it('names the disclosure for the product, not the payload', () => {
    renderActivity()
    fireEvent.click(screen.getByText(/Colin Knox/))

    expect(screen.getByText('Technical details')).toBeInTheDocument()
    expect(screen.queryByText(/audit payload/i)).toBeNull()
  })

  it('still exposes the full audit record one tap away', () => {
    renderActivity()
    fireEvent.click(screen.getByText(/Colin Knox/))
    fireEvent.click(screen.getByRole('button', { name: /Technical details/ }))

    const body = document.querySelector('[data-slot="activity-technical-body"]') as HTMLElement
    // Nothing was dropped to make the summary readable.
    expect(within(body).getByText('Event ID:')).toBeInTheDocument()
    expect(within(body).getByText('Entity Type:')).toBeInTheDocument()
    expect(within(body).getByText('Action Type:')).toBeInTheDocument()
    expect(within(body).getByText('Details (JSON):')).toBeInTheDocument()
  })

  it('contains long identifiers and JSON rather than widening the page', () => {
    renderActivity()
    fireEvent.click(screen.getByText(/Colin Knox/))
    fireEvent.click(screen.getByRole('button', { name: /Technical details/ }))

    const pre = document.querySelector('pre') as HTMLElement
    expect(pre.className).toContain('overflow-x-auto')
    expect(pre.className).toContain('whitespace-pre-wrap')
    expect(pre.className).toContain('[overflow-wrap:anywhere]')

    // The event id is a long unbroken token — it must be allowed to break.
    const eventId = screen.getByText('evt-0001-aaaa-bbbb-cccc-000000000001')
    expect(eventId.className).toContain('[overflow-wrap:anywhere]')
  })

  it('collapses the technical section again', () => {
    renderActivity()
    fireEvent.click(screen.getByText(/Colin Knox/))
    const toggle = screen.getByRole('button', { name: /Technical details/ })

    fireEvent.click(toggle)
    expect(document.querySelector('[data-slot="activity-technical-body"]')).not.toBeNull()

    fireEvent.click(screen.getByRole('button', { name: /Technical details/ }))
    expect(document.querySelector('[data-slot="activity-technical-body"]')).toBeNull()
  })

  it('collapsing the event returns the feed to its unexpanded state', () => {
    renderActivity()
    // Once open, the summary repeats the title by design, so the row's own
    // title is the first match — not an ambiguity to widen the query past.
    const rowTitle = () => screen.getAllByText(/Colin Knox/)[0]
    fireEvent.click(rowTitle())
    expect(screen.getByText('What happened')).toBeInTheDocument()

    fireEvent.click(rowTitle())
    expect(screen.queryByText('What happened')).toBeNull()
    expect(screen.getAllByText(/Colin Knox/)).toHaveLength(1)
  })
})
