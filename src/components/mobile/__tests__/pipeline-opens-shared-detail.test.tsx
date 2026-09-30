/**
 * Tapping a phone Pipeline card opens the shared idea detail, on the idea
 * tapped, and closing it returns to the board.
 *
 * The surface this replaces was read-only apart from a stage change, so a
 * phone could walk an idea to Ready to Recommend and then had no way to write
 * a thesis, satisfy a blocked gate, or submit the recommendation the stage is
 * named after. The fix is not a mobile editor — it is pointing at
 * `TradeIdeaDetailModal`, which every desktop surface already opens and which
 * already adapts itself to a phone.
 *
 * `TradeIdeaDetailModal` is stubbed here deliberately. What changed is the
 * seam: which component the pipeline mounts, with which id, and what it holds
 * while that component is open. The modal's own editing and recommendation
 * behaviour is unchanged by this work and is exercised where it lives.
 *
 * The companion source test, `pipeline-move-layering`, pins the other half:
 * that no second detail pane or mutation path was left behind.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, fireEvent, within } from '@testing-library/react'

const modalProps: Record<string, unknown>[] = []

vi.mock('../../trading/TradeIdeaDetailModal', () => ({
  TradeIdeaDetailModal: (props: Record<string, unknown>) => {
    modalProps.push(props)
    return (
      <div data-testid="shared-detail" data-trade-id={String(props.tradeId)}>
        <button onClick={props.onClose as () => void}>close</button>
        <button onClick={() => (props.onNavigateToIdea as (id: string) => void)('tq-2')}>
          go to other
        </button>
      </div>
    )
  },
}))

vi.mock('../../trading/DecisionInboxPanel', () => ({
  DecisionInboxPanel: () => null,
}))

vi.mock('../../pilot/PilotStepsBanner', () => ({
  PilotStepsBanner: () => null,
}))

const item = (id: string, symbol: string) => ({
  id,
  stage: 'exploring',
  status: 'idea',
  action: 'buy',
  assets: { symbol, company_name: symbol },
  portfolio_id: null,
  portfolios: null,
  users: { first_name: 'Dana', last_name: 'Analyst' },
})

const items = [item('tq-1', 'NVDA'), item('tq-2', 'AAPL')]

vi.mock('../../../hooks/usePipelineItems', () => ({
  usePipelineItems: () => ({ data: items, isLoading: false }),
}))

vi.mock('../../../hooks/usePilotPipelineBanner', () => ({
  usePilotPipelineBanner: () => ({ show: false, steps: [], label: '' }),
}))

vi.mock('../../../hooks/usePilotMode', () => ({
  usePilotMode: () => ({ effectiveIsPilot: false }),
}))

vi.mock('../../../hooks/usePilotProgress', () => ({
  usePilotProgress: () => ({
    hasCompletedPipelineStepInbox: true,
    hasCompletedPipelineStepTradeLab: true,
    mark: vi.fn(),
  }),
}))

import { MobilePipeline } from '../MobilePipeline'

beforeEach(() => {
  modalProps.length = 0
})

/** The whole card is the tap target; the symbol appears more than once on it. */
const card = (container: HTMLElement, id: string) =>
  container.querySelector(`[data-pipeline-row-id="${id}"]`) as HTMLElement

describe('a card tap opens the shared detail', () => {
  it('mounts nothing until a card is tapped', () => {
    const { queryByTestId, container } = render(<MobilePipeline />)
    expect(card(container, 'tq-1')).toBeTruthy()
    expect(queryByTestId('shared-detail')).toBeNull()
  })

  it('opens it on the idea that was tapped', () => {
    const { container, getByTestId } = render(<MobilePipeline />)
    fireEvent.click(card(container, 'tq-1'))
    const detail = getByTestId('shared-detail')
    expect(detail.getAttribute('data-trade-id')).toBe('tq-1')
    expect(modalProps.at(-1)!.isOpen).toBe(true)
  })

  it('closes back to the board, leaving the list behind it intact', () => {
    const { container, getByTestId, queryByTestId } = render(<MobilePipeline />)
    fireEvent.click(card(container, 'tq-1'))
    fireEvent.click(within(getByTestId('shared-detail')).getByText('close'))
    expect(queryByTestId('shared-detail')).toBeNull()
    expect(card(container, 'tq-1')).toBeTruthy()
    expect(card(container, 'tq-2')).toBeTruthy()
  })

  /**
   * Reopening must show what was saved, not what the card was rendered from.
   * That holds because the pipeline hands over an id and keeps no copy of the
   * idea's fields — the modal reads the row itself. If this ever started
   * passing a snapshot of the row, a save inside the modal would be invisible
   * on the next open.
   */
  it('hands over an id, not a snapshot of the row', () => {
    const { container } = render(<MobilePipeline />)
    fireEvent.click(card(container, 'tq-1'))
    const passed = modalProps.at(-1)!
    expect(passed.tradeId).toBe('tq-1')
    expect(Object.keys(passed).sort()).toEqual(
      ['isOpen', 'onClose', 'onNavigateToIdea', 'tradeId'],
    )
  })

  it('reopens on the same id after a close', () => {
    const { container, getByTestId } = render(<MobilePipeline />)
    fireEvent.click(card(container, 'tq-1'))
    fireEvent.click(within(getByTestId('shared-detail')).getByText('close'))
    fireEvent.click(card(container, 'tq-1'))
    expect(getByTestId('shared-detail').getAttribute('data-trade-id')).toBe('tq-1')
  })

  /** Following a link inside the modal swaps the id, not the surface. */
  it('follows a link inside the detail without closing it', () => {
    const { container, getByTestId } = render(<MobilePipeline />)
    fireEvent.click(card(container, 'tq-1'))
    fireEvent.click(within(getByTestId('shared-detail')).getByText('go to other'))
    expect(getByTestId('shared-detail').getAttribute('data-trade-id')).toBe('tq-2')
  })
})
