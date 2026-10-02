/**
 * Resume work lands on the idea.
 *
 * ── Why this test exists ─────────────────────────────────────────────────
 *
 * The first version of this CTA linked to `/trade-queue?idea=<id>`. That
 * parameter is read by nothing — `TradeQueuePage` has no `useSearchParams`
 * and no handler for it — so the link looked like a deep link, navigated to
 * the right page, and silently failed to open anything. Nothing threw and
 * no test caught it, because no test asserted where it landed.
 *
 * This one does. It also pins the id a card carries, so a renamed event or
 * a dropped `route.idea` breaks here rather than in someone's hands.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { openIdeaDetail, OPEN_IDEA_EVENTS } from '../open-idea'
import { buildReadyToRevisitCard, type ReadyToRevisitInput } from '../../signals/builders/readyToRevisit'
import { ideaClearReason } from '../../memory/obligations'

const IDEA_ID = 'idea-42'

function captureEvents() {
  const seen: Array<{ type: string; detail: unknown }> = []
  const record = (e: Event) => seen.push({ type: e.type, detail: (e as CustomEvent).detail })
  window.addEventListener(OPEN_IDEA_EVENTS.tab, record)
  window.addEventListener(OPEN_IDEA_EVENTS.modal, record)
  return {
    seen,
    stop: () => {
      window.removeEventListener(OPEN_IDEA_EVENTS.tab, record)
      window.removeEventListener(OPEN_IDEA_EVENTS.modal, record)
    },
  }
}

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

describe('openIdeaDetail', () => {
  it('asks for the pipeline tab, then the idea, with that id', () => {
    const cap = captureEvents()
    openIdeaDetail(IDEA_ID)
    vi.runAllTimers()
    cap.stop()

    expect(cap.seen.map(e => e.type)).toEqual([OPEN_IDEA_EVENTS.tab, OPEN_IDEA_EVENTS.modal])
    // The tab event carries the intent as well as the id. The modal event
    // is heard only by TradeQueuePage, which a phone never mounts, so the
    // flag is what lets MobilePipeline honour the same promise.
    expect(cap.seen[0].detail).toEqual({ selectedTradeId: IDEA_ID, openIdeaDetail: true })
    expect(cap.seen[1].detail).toEqual({ tradeId: IDEA_ID })
  })

  it('carries the open-detail intent on the event BOTH shells hear', () => {
    const cap = captureEvents()
    openIdeaDetail(IDEA_ID)
    vi.runAllTimers()
    cap.stop()
    expect((cap.seen[0].detail as { openIdeaDetail?: boolean }).openIdeaDetail).toBe(true)
  })

  it('defers the modal past the tab, so the listener exists to hear it', () => {
    // Both in the same tick means the modal event fires before
    // TradeQueuePage has mounted its listener, and nothing opens.
    const cap = captureEvents()
    openIdeaDetail(IDEA_ID)
    expect(cap.seen.map(e => e.type)).toEqual([OPEN_IDEA_EVENTS.tab])
    vi.runAllTimers()
    expect(cap.seen.map(e => e.type)).toEqual([OPEN_IDEA_EVENTS.tab, OPEN_IDEA_EVENTS.modal])
    cap.stop()
  })

  it('does nothing for an empty id rather than opening something arbitrary', () => {
    const cap = captureEvents()
    openIdeaDetail('')
    vi.runAllTimers()
    cap.stop()
    expect(cap.seen).toEqual([])
  })
})

describe('the card carries the id the CTA needs', () => {
  const input = (over: Partial<ReadyToRevisitInput> = {}): ReadyToRevisitInput => ({
    obligationId: 'ob-1',
    tradeQueueItemId: IDEA_ID,
    assetId: 'asset-1',
    symbol: 'NVDA',
    companyName: 'NVIDIA Corp',
    portfolioId: 'pf-1',
    portfolioName: 'Core Growth',
    parkedAt: '2026-09-20T00:00:00Z',
    dueAt: '2026-09-20T00:00:00Z',
    daysOverdue: 11,
    waitingFor: null,
    stage: 'researching',
    conviction: 'medium',
    facts: [],
    totalFactCount: 0,
    ...over,
  })

  it('puts the idea id on the action, not only on the entity', () => {
    // The entity is the ASSET, and one asset carries several ideas — so a
    // surface that routed from the entity would open an arbitrary one.
    const r = buildReadyToRevisitCard(input())
    if (!r.ok) throw new Error('suppressed')
    expect(r.card.actions.primary.route?.idea?.tradeQueueItemId).toBe(IDEA_ID)
    expect(r.card.entity.id).toBe('asset-1')
  })

  it('end to end: the id on the card is the id the events carry', () => {
    const r = buildReadyToRevisitCard(input())
    if (!r.ok) throw new Error('suppressed')
    const target = r.card.actions.primary.route?.idea?.tradeQueueItemId

    const cap = captureEvents()
    openIdeaDetail(target!)
    vi.runAllTimers()
    cap.stop()

    expect(cap.seen[1].detail).toEqual({ tradeId: IDEA_ID })
  })

  it('names the action the surfaces route on', () => {
    const r = buildReadyToRevisitCard(input())
    if (!r.ok) throw new Error('suppressed')
    // Both shells switch on this id. A rename would make both CTAs inert.
    expect(r.card.actions.primary.id).toBe('open_idea')
    expect(r.card.actions.primary.label).toBe('Resume work')
  })
})

describe('what Resume work does NOT do', () => {
  it('creates nothing — it only dispatches navigation', () => {
    // No mutation, no fetch, no write. The whole module is two events, so
    // "opening does not duplicate the idea or create a recommendation" is a
    // property of its surface area rather than of its behaviour.
    const cap = captureEvents()
    openIdeaDetail(IDEA_ID)
    vi.runAllTimers()
    cap.stop()
    expect(cap.seen).toHaveLength(2)
    expect(cap.seen.every(e => e.type.startsWith('open'))).toBe(true)
  })

  it('clears no obligation — looking at work is not doing it', () => {
    // Against the clear rule itself, not against a comment. An obligation
    // clears on a stage advance, a recommendation, a terminal outcome, an
    // archive or an explicit cancel. Opening a detail is none of those, and
    // the rule has no input that could express it.
    expect(ideaClearReason({})).toBeNull()
    expect(ideaClearReason({ stageAdvanced: false, recommendationSubmitted: false })).toBeNull()
    // A reminder that cancels itself the moment it is noticed is one nobody
    // can rely on, which is why this stays true.
    expect(ideaClearReason({ stageAdvanced: true })).not.toBeNull()
  })
})
