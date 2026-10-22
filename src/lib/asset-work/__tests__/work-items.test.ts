/**
 * What the Work navigator lists, and what the surface opens.
 *
 * ── The duplicate this exists to prevent ────────────────────────────────
 *
 * A decision request points at a `trade_queue_items` row — the idea. The same
 * BUY is therefore in two datasets, and listing both produced two rows that
 * were the same work in different words. The idea is the identity here; the
 * request is a fact about it. These tests pin that, because the failure is
 * not a crash: it is a reader doing the same thing twice.
 *
 * ── And the priority this must never invent ─────────────────────────────
 *
 * Grouping comes from rules that already exist — `splitAttention`'s
 * pm/admin check, and `is_started`/`is_completed` on the progress row.
 * Nothing here scores, weights or ranks.
 */
import { describe, it, expect } from 'vitest'
import {
  buildWorkItems, resolveSelection, itemsInGroup, GROUP_ORDER,
} from '../work-items'

const EMPTY = {
  needsYourAction: [], awaitingOthers: [], ideas: [], processes: [], conversations: [],
}

const idea = (over = {}) => ({
  id: 'idea-1', action: 'buy', stageLabel: 'Ready to Recommend',
  rationale: 'Add on weakness', portfolioName: 'Large Cap Growth', ...over,
})
const request = (over = {}) => ({
  id: 'req-1', tradeQueueItemId: 'idea-1', action: 'buy',
  portfolioName: 'Large Cap Growth', requesterName: 'E. Lockenvitz', ...over,
})
const process = (over = {}) => ({
  workflowId: 'wf-1', name: 'Earnings Season - Q2 2026',
  stageLabel: 'Expectations', isStarted: true, isCompleted: false, ...over,
})

describe('one row per underlying idea', () => {
  it('does not list an idea twice when a request points at it', () => {
    const items = buildWorkItems({
      ...EMPTY, ideas: [idea()], needsYourAction: [request()],
    })
    expect(items.filter(i => i.kind === 'idea')).toHaveLength(1)
  })

  it('puts it under "needs your action" when the decision is this reader\'s', () => {
    const [row] = buildWorkItems({ ...EMPTY, ideas: [idea()], needsYourAction: [request()] })
    expect(row.group).toBe('needs-you')
    expect(row.detail).toBe('Decision requested by E. Lockenvitz')
  })

  it('leaves it in progress when somebody else owes the decision', () => {
    const [row] = buildWorkItems({ ...EMPTY, ideas: [idea()], awaitingOthers: [request()] })
    expect(row.group).toBe('in-progress')
    expect(row.detail).toBe('Awaiting a decision')
  })

  it('prefers "yours" when a request appears in both splits', () => {
    // Defensive: the split should be exclusive. If it is not, the reader
    // must be told it is their move rather than that they are waiting.
    const [row] = buildWorkItems({
      ...EMPTY, ideas: [idea()],
      needsYourAction: [request()], awaitingOthers: [request({ id: 'req-2' })],
    })
    expect(row.group).toBe('needs-you')
  })

  it('shows the idea\'s stage when no decision is pending', () => {
    const [row] = buildWorkItems({ ...EMPTY, ideas: [idea()] })
    expect(row.group).toBe('in-progress')
    expect(row.detail).toBe('Ready to Recommend')
  })

  it('still lists a request whose idea the open-items query did not return', () => {
    /*
     * `useAssetTradeIdeas` filters to open items, so a request against an
     * idea that has since closed has no matching row. It is still the
     * reader's move; dropping it because two reads disagreed loses work.
     */
    const items = buildWorkItems({
      ...EMPTY, needsYourAction: [request({ tradeQueueItemId: 'closed-idea' })],
    })
    expect(items).toHaveLength(1)
    expect(items[0].id).toBe('closed-idea')
    expect(items[0].group).toBe('needs-you')
  })

  it('ignores a request that names no idea', () => {
    const items = buildWorkItems({
      ...EMPTY, needsYourAction: [request({ tradeQueueItemId: null })],
    })
    expect(items).toHaveLength(0)
  })

  it('does not list the same idea twice if the source repeats it', () => {
    const items = buildWorkItems({ ...EMPTY, ideas: [idea(), idea()] })
    expect(items).toHaveLength(1)
  })
})

describe('processes', () => {
  it('lists a running process in progress', () => {
    const [row] = buildWorkItems({ ...EMPTY, processes: [process()] })
    expect(row.kind).toBe('process')
    expect(row.group).toBe('in-progress')
    expect(row.label).toBe('Earnings Season - Q2 2026')
    expect(row.detail).toBe('Expectations')
  })

  it('omits one that has not been started, and one already complete', () => {
    // Both flags are columns on `asset_workflow_progress`; neither is a guess.
    expect(buildWorkItems({ ...EMPTY, processes: [process({ isStarted: false })] })).toHaveLength(0)
    expect(buildWorkItems({ ...EMPTY, processes: [process({ isCompleted: true })] })).toHaveLength(0)
  })

  it('says nothing about the stage rather than guessing one', () => {
    const [row] = buildWorkItems({ ...EMPTY, processes: [process({ stageLabel: null })] })
    expect(row.detail).toBeNull()
  })
})

describe('conversations launch the pane, they do not become the surface', () => {
  it('groups them under investigations and marks them', () => {
    const [row] = buildWorkItems({
      ...EMPTY, conversations: [{ id: 'c1', title: 'Apple AI', lastActivity: '6 months ago' }],
    })
    expect(row.group).toBe('investigations')
    expect(row.launchesPane).toBe(true)
  })

  it('is never auto-selected', () => {
    // Opening a pane because the reader opened a tab is not something they
    // asked for.
    const items = buildWorkItems({
      ...EMPTY, conversations: [{ id: 'c1', title: 'Apple AI' }],
    })
    expect(resolveSelection(items, null).selected).toBeNull()
  })
})

describe('first entry prefers genuinely actionable work', () => {
  const items = () => buildWorkItems({
    ...EMPTY,
    ideas: [idea(), idea({ id: 'idea-2', action: 'sell' })],
    needsYourAction: [request({ tradeQueueItemId: 'idea-2' })],
    processes: [process()],
    conversations: [{ id: 'c1', title: 'Apple AI' }],
  })

  it('opens on the item that needs the reader', () => {
    const { selected } = resolveSelection(items(), null)
    expect(selected?.id).toBe('idea-2')
    expect(selected?.group).toBe('needs-you')
  })

  it('falls back to work in progress when nothing needs them', () => {
    const list = buildWorkItems({ ...EMPTY, ideas: [idea()], processes: [process()] })
    expect(resolveSelection(list, null).selected?.group).toBe('in-progress')
  })

  it('opens on nothing at all when there is nothing to open', () => {
    const { selected, recovered } = resolveSelection([], null)
    expect(selected).toBeNull()
    expect(recovered).toBe(false)
  })

  it('renders groups in the order it selects them', () => {
    // "What opens first" and "what is listed first" cannot disagree.
    expect(GROUP_ORDER).toEqual(['needs-you', 'in-progress', 'investigations'])
    const list = items()
    expect(itemsInGroup(list, 'needs-you')).toHaveLength(1)
    expect(itemsInGroup(list, 'investigations')).toHaveLength(1)
  })
})

describe('a saved selection, and losing it', () => {
  const list = () => buildWorkItems({ ...EMPTY, ideas: [idea()], processes: [process()] })

  it('honours a saved key that still exists', () => {
    const { selected, recovered } = resolveSelection(list(), 'process:wf-1')
    expect(selected?.kind).toBe('process')
    expect(recovered).toBe(false)
  })

  it('reports recovery when the saved item is gone', () => {
    /*
     * The caller must SAY so. Swapping in different work while implying it
     * is the piece the reader left is worse than showing nothing.
     */
    const { selected, recovered } = resolveSelection(list(), 'process:deleted')
    expect(recovered).toBe(true)
    expect(selected?.key).not.toBe('process:deleted')
  })

  it('never resolves a key to the wrong kind of thing', () => {
    // Process ids and idea ids are both uuids; the key carries the kind so a
    // stale selection cannot land on an unrelated row that happens to match.
    const { selected, recovered } = resolveSelection(list(), 'idea:wf-1')
    /*
     * The stale key must not match. The fallback may legitimately land on
     * the process whose id happens to be 'wf-1' — what matters is that it
     * got there by falling back, which `recovered` reports, and not by the
     * key resolving to the wrong kind of row.
     */
    expect(selected?.key).not.toBe('idea:wf-1')
    expect(recovered).toBe(true)
  })

  it('does not report recovery when nothing was saved', () => {
    expect(resolveSelection(list(), null).recovered).toBe(false)
  })
})

describe('within "in progress", the process leads', () => {
  /*
   * Not a priority score. An idea in this group is by definition not the
   * reader's to decide — anything that were would be in "needs your action" —
   * so opening Work on it would land them on the one thing they cannot move.
   * A running process always has a stage with requirements they can act on.
   */
  it('lists the process before an idea awaiting someone else', () => {
    const list = buildWorkItems({
      ...EMPTY, ideas: [idea()], awaitingOthers: [request()], processes: [process()],
    })
    const inProgress = itemsInGroup(list, 'in-progress')
    expect(inProgress.map(i => i.kind)).toEqual(['process', 'idea'])
  })

  it('opens on the process, not on the blocked idea', () => {
    const list = buildWorkItems({
      ...EMPTY, ideas: [idea()], awaitingOthers: [request()], processes: [process()],
    })
    expect(resolveSelection(list, null).selected?.kind).toBe('process')
  })

  it('still opens on the reader\'s own decision before either', () => {
    const list = buildWorkItems({
      ...EMPTY, ideas: [idea()], needsYourAction: [request()], processes: [process()],
    })
    const { selected } = resolveSelection(list, null)
    expect(selected?.kind).toBe('idea')
    expect(selected?.group).toBe('needs-you')
  })
})
