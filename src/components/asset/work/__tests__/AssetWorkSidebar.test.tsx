/**
 * The organizational sidebar, and what it had to keep.
 *
 * ── Why parity is the thing tested ──────────────────────────────────────
 *
 * Themes, portfolios and projects were full-width Cards 708px BELOW the
 * working surface; lists were a horizontal strip above it. Consolidating
 * them is only an improvement if every real control came too. The specific
 * failure to avoid is replacing a management dialog with a decorative chip
 * that cannot do what it replaced — so the Add controls are SLOTS here, and
 * these tests assert the sidebar renders what it is given rather than
 * inventing a substitute.
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AssetWorkSidebar, SECTION_PREVIEW, type AssetWorkSidebarProps } from '../AssetWorkSidebar'

const list = (n: number, over = {}) => ({
  itemId: `it${n}`, listId: `l${n}`, name: `List ${n}`,
  listType: 'mutual' as const, canRemove: true, ...over,
})

const setup = (over: Partial<AssetWorkSidebarProps> = {}) => {
  const onToggleSection = vi.fn()
  render(
    <AssetWorkSidebar
      workSlot={<div data-testid="work-slot">work</div>}
      collapsed={{}}
      onToggleSection={onToggleSection}
      {...over}
    />
  )
  return { onToggleSection }
}

describe('everything lives in one column', () => {
  it('renders the work navigator and all four relationship sections', () => {
    setup({ lists: [], themes: [], portfolios: [] })
    expect(screen.getByTestId('work-slot')).toBeInTheDocument()
    for (const s of ['lists', 'themes', 'portfolios', 'projects']) {
      expect(screen.getByTestId(`sidebar-${s}`)).toBeInTheDocument()
    }
  })

  it('keeps the ids the header context chips deep-link to', () => {
    // AssetWorkspaceHeader's chips scroll to `lists-section-*Content`.
    // The sections moved; the contract did not.
    setup({ lists: [], themes: [], portfolios: [] })
    for (const id of ['listsContent', 'themesContent', 'portfoliosContent', 'projectsContent']) {
      expect(document.getElementById(`lists-section-${id}`)).not.toBeNull()
    }
  })

  it('collapses through the shared state, not its own', () => {
    // Same `collapsedSections` map the old Cards used, so a deep-link that
    // expands a section still expands this one.
    const { onToggleSection } = setup({ lists: [list(1)] })
    expect(screen.getByTestId('sidebar-list-open-l1')).toBeInTheDocument()
    onToggleSection.mockClear()
    screen.getByTestId('sidebar-toggle-lists').click()
    expect(onToggleSection).toHaveBeenCalledWith('listsContent')
  })

  it('hides a section\'s rows when the shared state says collapsed', () => {
    setup({ lists: [list(1)], collapsed: { listsContent: true } })
    expect(screen.queryByTestId('sidebar-list-open-l1')).not.toBeInTheDocument()
  })
})

describe('the real controls came with it', () => {
  it('renders the Add slots it is given, and invents none', () => {
    setup({
      lists: [], themes: [], portfolios: [],
      addToListSlot: <button type="button">Add to List</button>,
      addToThemeSlot: <button type="button">Add to Theme</button>,
      addToProjectSlot: <button type="button">Add to Project</button>,
      projectsSlot: <div data-testid="related-projects">projects</div>,
    })
    expect(screen.getByText('Add to List')).toBeInTheDocument()
    expect(screen.getByText('Add to Theme')).toBeInTheDocument()
    expect(screen.getByText('Add to Project')).toBeInTheDocument()
    expect(screen.getByTestId('related-projects')).toBeInTheDocument()
  })

  it('offers no idea-creation control on Portfolios', () => {
    /*
     * The Portfolios card carried `AddToQueueButton`, labelled "New Trade
     * Idea". Creating an idea is not a portfolio relationship, and the
     * control already exists on In Progress.
     */
    setup({ portfolios: [{ id: 'p1', name: 'Growth' }] })
    expect(screen.getByTestId('sidebar-portfolios')).not.toHaveTextContent('New Trade Idea')
  })
})

describe('list permissions survived the move', () => {
  it('offers remove only where the existing rule permits this row', () => {
    const onRemoveFromList = vi.fn()
    setup({
      lists: [list(1, { canRemove: true }), list(2, { canRemove: false })],
      onRemoveFromList,
    })
    expect(screen.getByTestId('sidebar-list-remove-l1')).toBeInTheDocument()
    expect(screen.queryByTestId('sidebar-list-remove-l2')).not.toBeInTheDocument()
  })

  it('removes by the membership row id, not the list id', async () => {
    const user = userEvent.setup()
    const onRemoveFromList = vi.fn()
    setup({ lists: [list(1)], onRemoveFromList })
    await user.click(screen.getByTestId('sidebar-list-remove-l1'))
    expect(onRemoveFromList).toHaveBeenCalledWith('it1')
  })

  it('marks a collaborative list', () => {
    setup({ lists: [list(1, { listType: 'collaborative' })] })
    expect(screen.getByTestId('sidebar-list-l1').querySelector('svg')).not.toBeNull()
  })
})

describe('"not loaded" is not "none"', () => {
  it('renders no rows and no empty state while unknown', () => {
    setup({ lists: null, themes: null, portfolios: null })
    expect(screen.queryByText('Not in any lists.')).not.toBeInTheDocument()
    expect(screen.queryByText('Not in any themes.')).not.toBeInTheDocument()
    expect(screen.queryByText('Not held in any portfolios.')).not.toBeInTheDocument()
  })

  it('states the fact once it is known', () => {
    setup({ lists: [], themes: [], portfolios: [] })
    expect(screen.getByText('Not in any lists.')).toBeInTheDocument()
    expect(screen.getByText('Not in any themes.')).toBeInTheDocument()
    expect(screen.getByText('Not held in any portfolios.')).toBeInTheDocument()
  })
})

describe('the sidebar stays finite', () => {
  it('caps a long membership list and offers the rest', async () => {
    const user = userEvent.setup()
    const many = Array.from({ length: 9 }, (_, i) => list(i + 1))
    setup({ lists: many })
    expect(document.querySelectorAll('[data-testid^="sidebar-list-open-"]')).toHaveLength(SECTION_PREVIEW)
    await user.click(screen.getByTestId('sidebar-more-lists'))
    expect(document.querySelectorAll('[data-testid^="sidebar-list-open-"]')).toHaveLength(9)
  })

  it('does not cap a short one', () => {
    setup({ lists: [list(1), list(2)] })
    expect(screen.queryByTestId('sidebar-more-lists')).not.toBeInTheDocument()
  })
})

describe('relationships navigate where they did', () => {
  it('opens a theme, a portfolio and a list', async () => {
    const user = userEvent.setup()
    const onOpenTheme = vi.fn(); const onOpenPortfolio = vi.fn(); const onOpenList = vi.fn()
    setup({
      lists: [list(1)], themes: [{ id: 't1', name: 'Nuclear', themeType: 'macro' }],
      portfolios: [{ id: 'p1', name: 'Growth', weight: '25.32' }],
      onOpenTheme, onOpenPortfolio, onOpenList,
    })
    await user.click(screen.getByTestId('sidebar-theme-t1'))
    await user.click(screen.getByTestId('sidebar-portfolio-p1'))
    await user.click(screen.getByTestId('sidebar-list-open-l1'))
    expect(onOpenTheme).toHaveBeenCalledWith(expect.objectContaining({ id: 't1' }))
    expect(onOpenPortfolio).toHaveBeenCalledWith('p1')
    expect(onOpenList).toHaveBeenCalledWith('l1')
  })

  it('shows portfolio weight as exposure, beside the name', () => {
    // Exposure, not membership and not a recommendation — a number, and
    // nothing that could be read as an instruction.
    setup({ portfolios: [{ id: 'p1', name: 'Growth', weight: '25.32' }] })
    const row = screen.getByTestId('sidebar-portfolio-p1')
    expect(row).toHaveTextContent('25.32%')
    expect(row).toHaveAttribute('title', expect.stringContaining('Port Wgt: 25.32%'))
  })

  it('omits the weight when the holdings maths could not produce one', () => {
    setup({ portfolios: [{ id: 'p1', name: 'Growth', weight: null }] })
    expect(screen.getByTestId('sidebar-portfolio-p1')).not.toHaveTextContent('%')
  })
})
