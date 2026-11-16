/**
 * Defer is personal. Rescheduling the desk is a different action.
 *
 * ── The defect these tests pin ────────────────────────────────────────────
 *
 * `AttentionCard.handleDefer` branched on `source_type`:
 *
 *   source_type === 'trade_queue_item'  ->  onDefer(source_id, hours)
 *                                           UPDATE trade_queue_items.revisit_at
 *                                           ... which the whole desk reads
 *   anything else                       ->  onSnooze(attention_id, hours)
 *                                           snooze_attention(), per user
 *
 * Same button. Same label, "Defer". Same toast, "Deferred". So an analyst
 * clearing a trade idea off their own screen moved the revisit date every
 * member of the portfolio sees, and an analyst clearing anything else did
 * not, and nothing on screen distinguished the two.
 *
 * It had a third outcome nobody could see either. RLS on
 * `trade_queue_items` UPDATE is
 * `created_by OR assigned_to OR is_portfolio_pm(portfolio_id)`; for anyone
 * else the update matched no row, `.maybeSingle()` returned null with no
 * error, and the card still reported success.
 *
 * ── What is asserted ─────────────────────────────────────────────────────
 *
 * These are behavioural assertions about which handler receives the call and
 * with which identifier, which is exactly where the ownership distinction
 * lives. Per-user DB isolation is a database property and is proven in the
 * SQL suite, not here; this proves the UI can no longer route a personal
 * intent into a shared write.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AttentionCard } from '../AttentionCard'
import type { AttentionItem } from '../../../types/attention'

function tradeIdeaItem(overrides: Partial<AttentionItem> = {}): AttentionItem {
  return {
    attention_id: 'attn-hash-1',
    source_type: 'trade_queue_item',
    source_id: 'tqi-1',
    source_url: '/trade-queue',
    attention_type: 'action_required',
    reason_code: 'IDEA_NEEDS_WORK',
    reason_text: 'This idea has not moved in a week.',
    title: 'AAPL long',
    tags: [],
    icon_key: 'trade_queue_item',
    audience: 'shared',
    participant_user_ids: [],
    created_at: '2026-11-01T00:00:00Z',
    updated_at: '2026-11-01T00:00:00Z',
    last_activity_at: '2026-11-01T00:00:00Z',
    status: 'open',
    severity: 'medium',
    score: 50,
    context: {},
    ...overrides,
  } as AttentionItem
}

/** A non-trade item, to show the personal path is the SAME path. */
function noteItem(): AttentionItem {
  return tradeIdeaItem({
    attention_id: 'attn-hash-2',
    source_type: 'note',
    source_id: 'note-1',
    icon_key: 'note',
  })
}

const handlers = {
  onNavigate: vi.fn(),
  onSnooze: vi.fn(async () => {}),
  onRescheduleShared: vi.fn(async () => {}),
  onDismissWithReason: vi.fn(async () => {}),
}

beforeEach(() => {
  for (const fn of Object.values(handlers)) (fn as ReturnType<typeof vi.fn>).mockClear()
  handlers.onRescheduleShared.mockImplementation(async () => {})
})

async function clickDefer(user: ReturnType<typeof userEvent.setup>, label = 'Tomorrow') {
  await user.click(screen.getByRole('button', { name: /^Defer$/ }))
  await user.click(screen.getByRole('button', { name: label }))
}

describe('Defer is personal for every source type', () => {
  it('routes a trade idea to the per-user handler, with the attention id', async () => {
    const user = userEvent.setup()
    const item = tradeIdeaItem()
    render(<AttentionCard item={item} {...handlers} />)

    await clickDefer(user)

    // The whole defect, in one assertion: a trade idea's Defer no longer
    // reaches the shared handler.
    expect(handlers.onRescheduleShared).not.toHaveBeenCalled()
    expect(handlers.onSnooze).toHaveBeenCalledTimes(1)
    // And it carries `attention_id`, not `source_id`. The shared path keyed
    // on the canonical row; the personal path keys on the finding.
    expect(handlers.onSnooze).toHaveBeenCalledWith('attn-hash-1', 24)
  })

  it('routes a non-trade item to the same handler in the same way', async () => {
    const user = userEvent.setup()
    render(<AttentionCard item={noteItem()} {...handlers} />)

    await clickDefer(user)

    expect(handlers.onRescheduleShared).not.toHaveBeenCalled()
    expect(handlers.onSnooze).toHaveBeenCalledWith('attn-hash-2', 24)
  })

  it('says the deferral was for the user, not for everyone', async () => {
    const user = userEvent.setup()
    render(<AttentionCard item={tradeIdeaItem()} {...handlers} />)

    await clickDefer(user)

    // The old copy was "Deferred" for both paths, which is what made them
    // indistinguishable. The word that matters is "you".
    expect(await screen.findByText(/for you/i)).toBeInTheDocument()
  })

  it('still offers Defer when no shared handler is wired at all', async () => {
    const user = userEvent.setup()
    const { onNavigate, onSnooze, onDismissWithReason } = handlers
    render(
      <AttentionCard
        item={tradeIdeaItem()}
        onNavigate={onNavigate}
        onSnooze={onSnooze}
        onDismissWithReason={onDismissWithReason}
      />,
    )

    await clickDefer(user)

    // Previously the control was gated on `isTradeItem ? onDefer : onSnooze`,
    // so a surface that wired only the personal handler showed no Defer at
    // all on trade ideas.
    expect(handlers.onSnooze).toHaveBeenCalledWith('attn-hash-1', 24)
  })
})

describe('Rescheduling the desk is a separate, named action', () => {
  it('is not reachable from the Defer control', async () => {
    const user = userEvent.setup()
    render(<AttentionCard item={tradeIdeaItem()} {...handlers} />)

    await user.click(screen.getByRole('button', { name: /^Defer$/ }))
    // The Defer menu offers times only. No desk-wide option hides in it.
    expect(screen.queryByRole('button', { name: /everyone/i })).not.toBeInTheDocument()
  })

  it('names who it affects, and passes the canonical row id', async () => {
    const user = userEvent.setup()
    render(<AttentionCard item={tradeIdeaItem()} {...handlers} />)

    await user.click(screen.getByRole('button', { name: /More actions/i }))
    await user.click(screen.getByRole('button', { name: /Reschedule for everyone/i }))
    expect(screen.getByText(/whole desk, not just\s+for you/i)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Next week' }))

    expect(handlers.onSnooze).not.toHaveBeenCalled()
    // `source_id` here, because this one writes the canonical row.
    expect(handlers.onRescheduleShared).toHaveBeenCalledWith('tqi-1', 168)
  })

  it('is absent for a source type that has no shared revisit date', async () => {
    const user = userEvent.setup()
    render(<AttentionCard item={noteItem()} {...handlers} />)

    await user.click(screen.getByRole('button', { name: /More actions/i }))
    // `attentionSourceSupportsSharedDefer` is the single definition of which
    // objects genuinely have one. A note does not, and the product must not
    // invent shared semantics for it.
    expect(screen.queryByRole('button', { name: /Reschedule for everyone/i })).not.toBeInTheDocument()
  })

  it('shows the refusal instead of reporting success', async () => {
    const user = userEvent.setup()
    handlers.onRescheduleShared.mockImplementation(async () => {
      throw new Error('You can only reschedule this for everyone if you raised it')
    })
    render(<AttentionCard item={tradeIdeaItem()} {...handlers} />)

    await user.click(screen.getByRole('button', { name: /More actions/i }))
    await user.click(screen.getByRole('button', { name: /Reschedule for everyone/i }))
    await user.click(screen.getByRole('button', { name: 'Tomorrow' }))

    // This is the case the old code called "Deferred".
    await waitFor(() => {
      expect(screen.getByText(/only reschedule this for everyone/i)).toBeInTheDocument()
    })
    expect(screen.queryByText(/Rescheduled for everyone/i)).not.toBeInTheDocument()
  })
})
