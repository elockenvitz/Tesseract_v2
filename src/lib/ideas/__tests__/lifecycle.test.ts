/**
 * One vocabulary for "is this open" and "did anyone act on it".
 *
 * ── The production state that forced this ─────────────────────────────────
 *
 * A graduated org held seven `trade_queue_items` rows. The Idea Pipeline
 * showed one of them, Trade Lab's badge showed five, and the capture form
 * called a trade executed the day before a live duplicate. Same table, three
 * answers.
 *
 * The rows, and why each is here:
 *
 *   AAPL  executed, pilot seed, has an accepted_trades row
 *         -> the regression case. Genuine work that began as a seed. It was
 *            being suppressed as an untouched seed.
 *   AMZN  deciding, pilot seed, no artifacts
 *         -> the opposite trap. Looks advanced, nobody touched it, must stay
 *            suppressible. Status is not evidence.
 *   MU    executed, not a seed, has an accepted_trades row
 *   LLY   deciding, not a seed
 *   META/MSFT/NVDA  idea, pilot seeds
 *
 * `decided_at`, `decision_outcome` and `outcome` are NULL on all 179 active
 * rows in production, including AAPL. That is why the old rule — which read
 * only those three — answered "nobody has ever acted on anything" for the
 * entire book.
 */
import { describe, it, expect } from 'vitest'

import {
  hasGenuineUserWork,
  isCommittedIdea,
  hasEvidenceEmbedded,
  isLiveIdea,
  isTerminalIdea,
  IDEA_EVIDENCE_SELECT,
} from '../lifecycle'
import { judgeIdeaRow, isOperationalAfterPilot } from '../../pilot/seed-visibility'

const seed = { origin_metadata: { pilot_seed: true } }
const liveTrade = [{ is_active: true, reverted_at: null }]

/** The production rows, with the columns the rules actually read. */
const AAPL = { ...seed, status: 'executed', outcome: null, decided_at: null, accepted_trades: liveTrade, decision_requests: [] }
const AMZN = { ...seed, status: 'deciding', outcome: null, decided_at: null, accepted_trades: [], decision_requests: [] }
const MSFT = { ...seed, status: 'idea', outcome: null, decided_at: null, accepted_trades: [], decision_requests: [] }
const MU = { status: 'executed', outcome: null, decided_at: null, accepted_trades: liveTrade, decision_requests: [] }
const LLY = { status: 'deciding', outcome: null, decided_at: null, accepted_trades: [], decision_requests: [] }

describe('live vs terminal', () => {
  it('counts open work as live', () => {
    for (const status of ['idea', 'discussing', 'simulating', 'deciding']) {
      expect(isLiveIdea({ status })).toBe(true)
    }
  })

  it('counts committed and discarded work as terminal', () => {
    for (const status of ['executed', 'approved', 'rejected', 'cancelled', 'archived', 'deleted']) {
      expect(isTerminalIdea({ status })).toBe(true)
      expect(isLiveIdea({ status })).toBe(false)
    }
  })

  /** Stage records how far the work GOT TO; nothing moves it back at the end. */
  it('never lets stage decide liveness', () => {
    expect(isLiveIdea({ status: 'executed', stage: 'developing' } as never)).toBe(false)
    expect(isLiveIdea({ status: 'idea', stage: 'ready_to_recommend' } as never)).toBe(true)
  })

  /** An outcome outranks the status mirror, which can drift. */
  it('treats any outcome as terminal even when the status looks open', () => {
    expect(isTerminalIdea({ status: 'deciding', outcome: 'executed' })).toBe(true)
    expect(isTerminalIdea({ status: 'idea', outcome: 'rejected' })).toBe(true)
  })

  it('reads the production rows the way the reader does', () => {
    expect(isLiveIdea(AAPL)).toBe(false)
    expect(isLiveIdea(MU)).toBe(false)
    expect(isLiveIdea(LLY)).toBe(true)
    expect(isLiveIdea(AMZN)).toBe(true)
  })
})

describe('genuine user work', () => {
  /** The regression. AAPL was decided and executed; it is not an untouched seed. */
  it('recognises an executed idea by its accepted trade', () => {
    expect(hasGenuineUserWork(AAPL)).toBe(true)
  })

  it('recognises a decided idea by its governing decision request', () => {
    expect(hasGenuineUserWork({
      status: 'deciding',
      accepted_trades: [],
      decision_requests: [{ status: 'accepted', created_at: '2026-09-28T00:00:00Z' }],
    })).toBe(true)
  })

  /**
   * The trap in the other direction: an advanced-looking seed nobody touched.
   * The seeder plants ideas at several stages, so status must never imply work.
   */
  it('does NOT treat an advanced status as evidence', () => {
    expect(hasGenuineUserWork(AMZN)).toBe(false)
    expect(hasGenuineUserWork({ status: 'deciding', accepted_trades: [], decision_requests: [] })).toBe(false)
    expect(hasGenuineUserWork({ status: 'executed', accepted_trades: [], decision_requests: [] })).toBe(false)
  })

  /** A withdrawn request is a retraction, not a decision. */
  it('does not count a withdrawn request', () => {
    expect(hasGenuineUserWork({
      accepted_trades: [],
      decision_requests: [{ status: 'withdrawn', created_at: '2026-09-28T00:00:00Z' }],
    })).toBe(false)
  })

  /** Revert reopens the question, so the trade stops being evidence. */
  it('does not count a reverted trade', () => {
    expect(hasGenuineUserWork({
      accepted_trades: [{ is_active: false, reverted_at: '2026-09-29T00:00:00Z' }],
      decision_requests: [],
    })).toBe(false)
  })

  /** Still honoured when present, just not relied upon. */
  it('still honours the legacy mirror columns', () => {
    expect(hasGenuineUserWork({ decided_at: '2026-09-28T00:00:00Z' })).toBe(true)
    expect(hasGenuineUserWork({ outcome: 'executed' })).toBe(true)
  })

  it('answers no when nothing was fetched, and says so separately', () => {
    expect(hasGenuineUserWork({ status: 'executed' })).toBe(false)
    expect(hasEvidenceEmbedded({ status: 'executed' })).toBe(false)
    expect(hasEvidenceEmbedded(AAPL)).toBe(true)
  })

  it('names the evidence one way, so no caller invents its own select', () => {
    expect(IDEA_EVIDENCE_SELECT).toContain('accepted_trades')
    expect(IDEA_EVIDENCE_SELECT).toContain('decision_requests')
    expect(IDEA_EVIDENCE_SELECT).toContain('reverted_at')
  })
})

describe('pilot seed visibility, after graduation', () => {
  const graduated = { hasGraduated: true }
  const during = { hasGraduated: false }

  /** The bug: real work filed as an untouched seed and hidden. */
  it('keeps an executed seed, because it became genuine work', () => {
    const judged = judgeIdeaRow(AAPL)
    expect(judged).toEqual({ pilotSeed: true, actedOn: true })
    expect(isOperationalAfterPilot(judged, graduated)).toBe(true)
  })

  it('suppresses an untouched seed however advanced it looks', () => {
    expect(isOperationalAfterPilot(judgeIdeaRow(AMZN), graduated)).toBe(false)
    expect(isOperationalAfterPilot(judgeIdeaRow(MSFT), graduated)).toBe(false)
  })

  it('leaves non-seed rows alone in both directions', () => {
    expect(isOperationalAfterPilot(judgeIdeaRow(MU), graduated)).toBe(true)
    expect(isOperationalAfterPilot(judgeIdeaRow(LLY), graduated)).toBe(true)
  })

  it('changes nothing before graduation', () => {
    for (const row of [AAPL, AMZN, MSFT, MU, LLY]) {
      expect(isOperationalAfterPilot(judgeIdeaRow(row), during)).toBe(true)
    }
  })

  /**
   * The whole production org at once. Four untouched seeds go; AAPL survives
   * as history; the two non-seeds are untouched. Of the survivors exactly one
   * is live — which is the number the Pipeline was already showing and the
   * number the Trade Lab badge now shows.
   */
  it('resolves the production org to one live idea and one kept seed', () => {
    const org = [AAPL, AMZN, MSFT, MU, LLY]
    const operational = org.filter(r => isOperationalAfterPilot(judgeIdeaRow(r), graduated))
    expect(operational).toEqual([AAPL, MU, LLY])
    expect(operational.filter(isLiveIdea)).toEqual([LLY])
  })
})

describe('committed vs merely closed, for describing history', () => {
  it('calls an executed idea committed', () => {
    expect(isCommittedIdea(AAPL)).toBe(true)
    expect(isCommittedIdea(MU)).toBe(true)
  })

  it('does not call a rejected idea committed', () => {
    expect(isCommittedIdea({ status: 'rejected', accepted_trades: [] })).toBe(false)
    expect(isCommittedIdea({ status: 'cancelled', accepted_trades: [] })).toBe(false)
  })
})
