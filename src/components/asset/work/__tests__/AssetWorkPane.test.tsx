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
  render(
    <AssetWorkPane
      attention={EMPTY}
      ideas={[]}
      process={null}
      researchLinks={[]}
      onOpenIdeas={onOpenIdeas}
      onOpenIdea={onOpenIdea}
      onOpenProcess={onOpenProcess}
      onNewIdea={onNewIdea}
      onStartProcess={onStartProcess}
      {...over}
    />
  )
  return { onOpenIdeas, onOpenProcess, onNewIdea, onStartProcess, onOpenIdea }
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
  it('shows assignee, deadline and priority as read-only context', () => {
    setup({ process: process() })
    const panel = screen.getByTestId('work-panel-process')
    expect(panel).toHaveTextContent('Assigned to E. Lockenvitz')
    expect(panel).toHaveTextContent('Due Nov 1')
    expect(panel).toHaveTextContent('Priority High')
  })

  it('says so plainly when none of them is set', () => {
    setup({ process: process({ assigneeName: null, deadline: null, priorityLabel: null }) })
    expect(screen.getByTestId('work-panel-process'))
      .toHaveTextContent('No assignee, deadline or priority set.')
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
