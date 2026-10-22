/**
 * The Work pane prototype.
 *
 * Covers the four emptiness cases, the PM/analyst split as it reaches the
 * screen, summary-to-detail, and that the compact surface never becomes a
 * replacement for the full Process controls.
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AssetWorkPane, type AssetWorkPaneProps } from '../AssetWorkPane'
import { splitAttention, type WorkDecisionRequest } from '../../../../lib/asset-work/attention'

const idea = (over = {}) => ({
  id: 'i1', action: 'buy', stage: 'ready_to_recommend',
  rationale: 'Add on weakness', portfolioName: 'Growth', ...over,
})

const process = (over = {}) => ({
  workflowName: 'Earnings Season - Q2',
  stages: [
    { id: 's1', label: 'Expectations', done: 2, total: 5, active: true },
    { id: 's2', label: 'Earnings Print', done: 0, total: 5, active: false },
  ],
  openStageLabel: 'Expectations', openStageDone: 2, openStageTotal: 5,
  assigneeName: 'E. Lockenvitz', deadline: 'Nov 1', priorityLabel: 'High',
  ...over,
})

const EMPTY = { needsYourAction: [], awaitingOthers: [] }

const setup = (over: Partial<AssetWorkPaneProps> = {}) => {
  const onOpenIdeas = vi.fn()
  const onOpenProcess = vi.fn()
  const onNewIdea = vi.fn()
  const onStartProcess = vi.fn()
  const onOpenIdea = vi.fn()
  const onRemoveFromList = vi.fn()
  render(
    <AssetWorkPane
      attention={EMPTY}
      ideas={[]}
      process={null}
      researchLinks={[]}
      onRemoveFromList={onRemoveFromList}
      onOpenIdeas={onOpenIdeas}
      onOpenIdea={onOpenIdea}
      onOpenProcess={onOpenProcess}
      onNewIdea={onNewIdea}
      onStartProcess={onStartProcess}
      {...over}
    />
  )
  return { onOpenIdeas, onOpenProcess, onNewIdea, onStartProcess, onOpenIdea, onRemoveFromList }
}

describe('the four emptiness cases', () => {
  it('neither: one line and two entry points, not three empty cards', () => {
    setup()
    expect(screen.getByTestId('work-empty')).toBeInTheDocument()
    expect(screen.queryByTestId('work-area-ideas')).not.toBeInTheDocument()
    expect(screen.queryByTestId('work-area-process')).not.toBeInTheDocument()
    expect(screen.getByTestId('work-new-idea')).toBeInTheDocument()
    expect(screen.getByTestId('work-start-process')).toBeInTheDocument()
  })

  it('ideas only: ideas open, process offers a way to start one', async () => {
    const user = userEvent.setup()
    setup({ ideas: [idea()] })
    expect(screen.getByTestId('work-panel-ideas')).toBeInTheDocument()   // open by default
    await user.click(screen.getByTestId('work-toggle-process'))
    expect(screen.getByTestId('work-start-process')).toBeInTheDocument()
  })

  it('process only: process opens, ideas offers a way to add one', async () => {
    const user = userEvent.setup()
    setup({ process: process() })
    expect(screen.getByTestId('work-panel-process')).toBeInTheDocument()
    await user.click(screen.getByTestId('work-toggle-ideas'))
    expect(screen.getByTestId('work-new-idea')).toBeInTheDocument()
  })

  it('both: each area summarises itself without being expanded', () => {
    setup({ ideas: [idea()], process: process() })
    expect(screen.getByTestId('work-toggle-ideas')).toHaveTextContent('1')
    expect(screen.getByTestId('work-toggle-process')).toHaveTextContent('Earnings Season - Q2')
    expect(screen.getByTestId('work-toggle-process')).toHaveTextContent('Expectations 2/5')
  })
})

describe('attention reaches the screen the way the permission split decided', () => {
  const requests: WorkDecisionRequest[] = [
    { id: 'mine', portfolioId: 'pf-a', requestedBy: 'analyst', status: 'pending' },
    { id: 'theirs', portfolioId: 'pf-b', requestedBy: 'me', status: 'pending' },
  ]

  it('a PM sees the request they must resolve under Needs your action', () => {
    const attention = splitAttention(requests, { userId: 'me', pmPortfolioIds: ['pf-a'] })
    setup({ attention: attention as never })
    expect(screen.getByTestId('work-needs-you')).toBeInTheDocument()
    expect(screen.getByTestId('work-attention-you-mine')).toBeInTheDocument()
  })

  it('an analyst sees only their submitted request, under Awaiting others', () => {
    const attention = splitAttention(requests, { userId: 'me', pmPortfolioIds: [] })
    setup({ attention: attention as never })
    expect(screen.queryByTestId('work-needs-you')).not.toBeInTheDocument()
    expect(screen.getByTestId('work-attention-other-theirs')).toBeInTheDocument()
  })

  it('is absent entirely when nothing waits, rather than showing a zero', () => {
    setup({ ideas: [idea()] })
    expect(screen.queryByTestId('work-area-attention')).not.toBeInTheDocument()
  })

  it('opens by default, because being seen is its whole purpose', () => {
    const attention = splitAttention(requests, { userId: 'me', pmPortfolioIds: ['pf-a'] })
    setup({ attention: attention as never, ideas: [idea()] })
    expect(screen.getByTestId('work-panel-attention')).toBeInTheDocument()
  })
})

describe('ideas use the canonical pipeline and the existing navigation', () => {
  it('labels the stage, never the raw enum', () => {
    setup({ ideas: [idea({ stage: 'ready_for_decision' })] })     // legacy value
    expect(screen.getByTestId('work-idea-i1')).toHaveTextContent('Ready to Recommend')
    expect(screen.getByTestId('work-idea-i1')).not.toHaveTextContent('ready_for_decision')
  })

  it('counts each canonical stage, normalizing legacy rows into it', () => {
    setup({ ideas: [idea({ id: 'a', stage: 'thesis_forming' }), idea({ id: 'b', stage: 'developing' })] })
    expect(screen.getByTestId('work-stage-developing')).toHaveTextContent('Developing 2')
    expect(screen.getByTestId('work-stage-exploring')).toHaveTextContent('Exploring 0')
  })

  it('opens the existing idea experience rather than owning navigation', async () => {
    const user = userEvent.setup()
    const { onOpenIdea, onOpenIdeas } = setup({ ideas: [idea()] })
    await user.click(screen.getByTestId('work-idea-i1'))
    expect(onOpenIdea).toHaveBeenCalledWith('i1')
    await user.click(screen.getByTestId('work-open-pipeline'))
    expect(onOpenIdeas).toHaveBeenCalled()
  })

  it('falls back to the pipeline when no per-idea handler is supplied', async () => {
    const user = userEvent.setup()
    const onOpenIdeas = vi.fn()
    render(
      <AssetWorkPane attention={EMPTY} ideas={[idea()]} process={null} researchLinks={[]}
        onOpenIdeas={onOpenIdeas} />
    )
    await user.click(screen.getByTestId('work-idea-i1'))
    expect(onOpenIdeas).toHaveBeenCalled()
  })
})

describe('the process summary never replaces the full surface', () => {
  it('shows assignee and priority as read-only context', () => {
    setup({ process: process() })
    const panel = screen.getByTestId('work-panel-process')
    expect(panel).toHaveTextContent('Assigned to E. Lockenvitz')
    expect(panel).toHaveTextContent('Priority High')
  })

  it('states the deadline once, in the summary, not twice', () => {
    // It was in both the area's summary line and the detail line, under the
    // same condition — the same fact in two places two lines apart.
    setup({ process: process() })
    expect(screen.getByTestId('work-toggle-process')).toHaveTextContent('due Nov 1')
    expect(screen.getByTestId('work-panel-process')).not.toHaveTextContent('Due Nov 1')
  })

  it('says so plainly when none of them is set', () => {
    setup({ process: process({ assigneeName: null, deadline: null, priorityLabel: null }) })
    expect(screen.getByTestId('work-panel-process'))
      .toHaveTextContent('No assignee, deadline or priority set.')
  })

  it('never claims nothing is set while a deadline is on screen', () => {
    // The deadline moved out of the detail line, so the sentence that denies
    // it had to stop firing when only the deadline is known.
    setup({ process: process({ assigneeName: null, priorityLabel: null }) })
    const panel = screen.getByTestId('work-panel-process')
    expect(panel).not.toHaveTextContent('No assignee, deadline or priority set.')
    expect(screen.getByTestId('work-toggle-process')).toHaveTextContent('due Nov 1')
  })

  it('hands off to the full process, which keeps the real controls', async () => {
    const user = userEvent.setup()
    const { onOpenProcess } = setup({ process: process() })
    await user.click(screen.getByTestId('work-open-process'))
    expect(onOpenProcess).toHaveBeenCalled()
  })
})

describe('research links are shown only when they exist', () => {
  it('renders no area when the caller could prove no relationship', () => {
    setup({ ideas: [idea()] })
    expect(screen.queryByTestId('work-area-research')).not.toBeInTheDocument()
  })

  it('opens the link the caller supplied', async () => {
    const user = userEvent.setup()
    const onOpen = vi.fn()
    setup({ ideas: [idea()], researchLinks: [{ key: 'thesis', label: 'Investment Thesis', detail: '2 sources', onOpen }] })
    await user.click(screen.getByTestId('work-toggle-research'))
    await user.click(screen.getByTestId('work-research-thesis'))
    expect(onOpen).toHaveBeenCalled()
  })
})

describe('summary to detail', () => {
  it('each area toggles without losing the others', async () => {
    const user = userEvent.setup()
    setup({ ideas: [idea()], process: process() })
    await user.click(screen.getByTestId('work-toggle-ideas'))      // collapse
    expect(screen.queryByTestId('work-panel-ideas')).not.toBeInTheDocument()
    expect(screen.getByTestId('work-toggle-process')).toBeInTheDocument()
    await user.click(screen.getByTestId('work-toggle-ideas'))      // re-open
    expect(screen.getByTestId('work-panel-ideas')).toBeInTheDocument()
  })

  it('announces expansion state for assistive tech', async () => {
    const user = userEvent.setup()
    setup({ ideas: [idea()] })
    const toggle = screen.getByTestId('work-toggle-process')
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    await user.click(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    expect(toggle).toHaveAttribute('aria-controls', 'work-panel-process')
  })

  it('is reachable and operable by keyboard alone', async () => {
    const user = userEvent.setup()
    setup({ ideas: [idea()] })
    const processToggle = screen.getByTestId('work-toggle-process')
    expect(processToggle).toHaveAttribute('aria-expanded', 'false')

    // Tab until the process toggle has focus, then open it with the keyboard.
    for (let i = 0; i < 12 && document.activeElement !== processToggle; i++) await user.tab()
    expect(processToggle).toHaveFocus()

    await user.keyboard('{Enter}')
    expect(processToggle).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByTestId('work-panel-process')).toBeInTheDocument()
  })

  it('shows a skeleton while loading rather than an empty state', () => {
    setup({ isLoading: true })
    expect(screen.getByTestId('work-loading')).toBeInTheDocument()
    expect(screen.queryByTestId('work-empty')).not.toBeInTheDocument()
  })
})

// ──────────────────────────────────────────────── list membership

/**
 * Membership is the one thing Work could previously only READ.
 *
 * The old Lists card sat at the foot of the surface, below the process and
 * every open idea, and did nothing but print names — and because it grouped
 * on `list_type || 'list'` while every stored row is 'mutual' or
 * 'collaborative', it printed "Not in any lists." at an asset filed in four.
 */
const membership = (over = {}) => ({
  itemId: 'it1', listId: 'l1', name: 'Core Watchlist',
  listType: 'mutual' as const, canRemove: true, ...over,
})

describe('list membership', () => {
  it('names each list the asset is in', () => {
    setup({ lists: [membership(), membership({ itemId: 'it2', listId: 'l2', name: 'Q3 Earnings' })] })
    expect(screen.getByTestId('work-lists')).toHaveTextContent('Core Watchlist')
    expect(screen.getByTestId('work-lists')).toHaveTextContent('Q3 Earnings')
  })

  it('says so when the asset is in none', () => {
    setup({ lists: [] })
    expect(screen.getByTestId('work-lists-none')).toBeInTheDocument()
  })

  it('renders nothing at all while membership is unknown', () => {
    /*
     * null is "not loaded", [] is "none". Collapsing the two is how a
     * surface asserts "Not in any lists." at an asset that is in four — the
     * exact defect the old card shipped with.
     */
    setup({ lists: null })
    expect(screen.queryByTestId('work-lists')).not.toBeInTheDocument()
    expect(screen.queryByTestId('work-lists-none')).not.toBeInTheDocument()
  })

  it('shows membership even when there is no active work', () => {
    // The empty state used to be the whole render, so an asset with no ideas
    // and no process showed no lists either.
    setup({ lists: [membership()], process: null, ideas: [] })
    expect(screen.getByTestId('work-empty')).toBeInTheDocument()
    expect(screen.getByTestId('work-lists')).toHaveTextContent('Core Watchlist')
  })

  it('carries the id the header list chip scrolls to', () => {
    // AssetWorkspaceHeader's chip sets a focus of 'listsContent', and the
    // Asset page scrolls to `lists-section-listsContent`. The chip now lands
    // on the surface that can change the membership.
    setup({ lists: [membership()] })
    expect(screen.getByTestId('work-lists')).toHaveAttribute('id', 'lists-section-listsContent')
  })

  it('removes a membership by the membership row id, not the list id', async () => {
    const user = userEvent.setup()
    const onRemoveFromList = vi.fn()
    render(
      <AssetWorkPane
        attention={EMPTY} ideas={[]} process={null} researchLinks={[]}
        lists={[membership()]} onRemoveFromList={onRemoveFromList}
        onOpenIdeas={vi.fn()}
      />
    )
    await user.click(screen.getByTestId('work-list-remove-l1'))
    // 'it1', not 'l1' — deleting by list_id would empty the list.
    expect(onRemoveFromList).toHaveBeenCalledWith('it1')
  })

  it('offers no remove control where the existing rule says no', () => {
    // On a collaborative list, write access is not permission to remove a
    // row somebody else added. A disabled button would still advertise a
    // capability the owner has not granted.
    setup({ lists: [membership({ canRemove: false })] })
    expect(screen.getByTestId('work-list-l1')).toBeInTheDocument()
    expect(screen.queryByTestId('work-list-remove-l1')).not.toBeInTheDocument()
  })

  it('offers no remove control when the caller supplies no handler', () => {
    setup({ lists: [membership({ canRemove: true })], onRemoveFromList: undefined })
    expect(screen.queryByTestId('work-list-remove-l1')).not.toBeInTheDocument()
  })

  it('does not re-derive the permission from the list type', () => {
    // canRemove is the answer, already given. A collaborative list whose row
    // this reader added is removable, and the component must not second-guess
    // that from the type alone.
    setup({ lists: [membership({ listType: 'collaborative', canRemove: true })] })
    expect(screen.getByTestId('work-list-remove-l1')).toBeInTheDocument()
  })

  it('marks the row being removed and blocks a second click', () => {
    setup({ lists: [membership()], removingListItemId: 'it1' })
    expect(screen.getByTestId('work-list-remove-l1')).toBeDisabled()
  })

  it('opens a list when the caller supplies a destination', async () => {
    const user = userEvent.setup()
    const onOpenList = vi.fn()
    render(
      <AssetWorkPane
        attention={EMPTY} ideas={[]} process={null} researchLinks={[]}
        lists={[membership()]} onOpenList={onOpenList} onOpenIdeas={vi.fn()}
      />
    )
    await user.click(screen.getByTestId('work-list-open-l1'))
    expect(onOpenList).toHaveBeenCalledWith('l1')
  })

  it('hosts the existing Add control rather than rebuilding one', () => {
    setup({ lists: [], addToListSlot: <button type="button">Add to List</button> })
    expect(screen.getByTestId('work-lists-add')).toHaveTextContent('Add to List')
  })
})
