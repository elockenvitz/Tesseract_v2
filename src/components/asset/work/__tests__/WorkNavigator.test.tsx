/**
 * The navigator's behaviour as the work grows.
 *
 * ── What this protects ──────────────────────────────────────────────────
 *
 * With three items the navigator is obviously fine. The failure mode is an
 * asset with fifteen open ideas, where a sidebar that lists them all becomes
 * the uncontrolled vertical stack the whole redesign removed — and where a
 * naive cap hides the one row the surface is currently showing, so the
 * navigator highlights nothing.
 *
 * "Needs your action" is never capped. Every row in it is work this reader is
 * empowered to resolve, and choosing which of their obligations to hide would
 * be the invented priority this model refuses.
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { WorkNavigator, GROUP_PREVIEW } from '../WorkNavigator'
import type { WorkItem } from '../../../../lib/asset-work/work-items'

const idea = (n: number, group: WorkItem['group'] = 'in-progress'): WorkItem => ({
  key: `idea:i${n}`, kind: 'idea', id: `i${n}`, group,
  label: `BUY · book ${n}`, detail: 'Researching',
})

const many = (n: number, group: WorkItem['group'] = 'in-progress') =>
  Array.from({ length: n }, (_, i) => idea(i + 1, group))

const setup = (items: WorkItem[], selectedKey: string | null = null) => {
  const onSelect = vi.fn()
  render(<WorkNavigator items={items} selectedKey={selectedKey} onSelect={onSelect} />)
  return { onSelect }
}

const rowCount = () =>
  document.querySelectorAll('button[data-testid^="work-nav-idea:"]').length

describe('a group stays finite', () => {
  it('shows every row while the group is small', () => {
    setup(many(GROUP_PREVIEW))
    expect(rowCount()).toBe(GROUP_PREVIEW)
    expect(screen.queryByTestId('work-nav-more-in-progress')).not.toBeInTheDocument()
  })

  it('caps a long group and offers the rest', () => {
    setup(many(12))
    expect(rowCount()).toBe(GROUP_PREVIEW)
    expect(screen.getByTestId('work-nav-more-in-progress')).toHaveTextContent('Show all 12')
  })

  it('expands and collapses again', async () => {
    const user = userEvent.setup()
    setup(many(12))
    await user.click(screen.getByTestId('work-nav-more-in-progress'))
    expect(rowCount()).toBe(12)
    await user.click(screen.getByTestId('work-nav-more-in-progress'))
    expect(rowCount()).toBe(GROUP_PREVIEW)
  })
})

describe('the selected item is always visible', () => {
  it('keeps a selection that falls past the preview', () => {
    /*
     * Otherwise the navigator highlights nothing while the surface shows
     * something — the reader cannot see what they are working on.
     */
    setup(many(12), 'idea:i11')
    expect(screen.getByTestId('work-nav-idea:i11')).toBeInTheDocument()
    expect(rowCount()).toBe(GROUP_PREVIEW)
    expect(screen.getByTestId('work-nav-idea:i11')).toHaveAttribute('aria-current', 'true')
  })

  it('does not drop a selected row that was already in the preview', () => {
    setup(many(12), 'idea:i2')
    expect(screen.getByTestId('work-nav-idea:i2')).toBeInTheDocument()
    expect(rowCount()).toBe(GROUP_PREVIEW)
  })
})

describe('obligations are never hidden', () => {
  it('shows every row that needs the reader, however many', () => {
    setup(many(9, 'needs-you'))
    expect(rowCount()).toBe(9)
    expect(screen.queryByTestId('work-nav-more-needs-you')).not.toBeInTheDocument()
  })
})

describe('the Open Items capabilities it absorbed', () => {
  it('offers idea creation on the group that holds ideas', async () => {
    const user = userEvent.setup()
    const onNewIdea = vi.fn()
    render(
      <WorkNavigator items={many(2)} selectedKey={null} onSelect={vi.fn()} onNewIdea={onNewIdea} />
    )
    await user.click(screen.getByTestId('work-nav-new-idea'))
    expect(onNewIdea).toHaveBeenCalledTimes(1)
  })

  it('offers the canonical stage filter, and reports "all" as null', async () => {
    const user = userEvent.setup()
    const onStageFilter = vi.fn()
    render(
      <WorkNavigator
        items={many(2)} selectedKey={null} onSelect={vi.fn()}
        stageFilter="researching"
        stageFilterOptions={[
          { key: 'all', label: 'All' },
          { key: 'researching', label: 'Researching' },
        ]}
        onStageFilter={onStageFilter}
      />
    )
    expect(screen.getByTestId('work-nav-filter-researching')).toHaveAttribute('aria-pressed', 'true')
    await user.click(screen.getByTestId('work-nav-filter-all'))
    expect(onStageFilter).toHaveBeenCalledWith(null)
  })

  it('renders no filter when the caller supplies none', () => {
    setup(many(2))
    expect(screen.queryByTestId('work-nav-stage-filter')).not.toBeInTheDocument()
  })
})
