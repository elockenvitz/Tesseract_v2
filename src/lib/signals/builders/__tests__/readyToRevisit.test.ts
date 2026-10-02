/**
 * The card for parked work.
 *
 * Two properties carry most of the weight:
 *
 *   1. The empty case is useful. A parked idea where nothing happened is
 *      still the answer to "what did I miss", and the card must say so
 *      without padding itself with invented activity.
 *   2. It never reads as a price alert. The biggest number available is the
 *      price move, and putting it in the metric slot would make the one card
 *      about memory look like the twenty cards about markets.
 */
import { describe, it, expect } from 'vitest'
import {
  buildReadyToRevisitCard,
  parkedPhrase,
  whereYouLeftItLine,
  type ReadyToRevisitInput,
} from '../readyToRevisit'
import type { ChangeFact } from '../../../memory/what-changed'

const fact = (over: Partial<ChangeFact> = {}): ChangeFact => ({
  kind: 'price_change',
  label: '+8.4% price',
  from: '2026-09-19',
  to: '2026-09-30',
  confidence: 'SAFE_WITH_ATTRIBUTION',
  sourceType: 'price_history_cache',
  sourceIds: ['NVDA'],
  magnitude: 8.4,
  ...over,
})

const input = (over: Partial<ReadyToRevisitInput> = {}): ReadyToRevisitInput => ({
  obligationId: 'ob-1',
  tradeQueueItemId: 'idea-1',
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

const card = (over: Partial<ReadyToRevisitInput> = {}) => {
  const r = buildReadyToRevisitCard(input(over))
  if (!r.ok) throw new Error(`suppressed: ${r.reason}`)
  return r.card
}

/**
 * The reason, reported and never evaluated.
 *
 * This is the distinction the whole slice turns on. "You parked this
 * waiting for Q3 earnings" is a true statement about what somebody said.
 * "The thing you were waiting for happened" is a claim about the world that
 * the product cannot check — `asset_earnings_dates` holds zero rows and
 * there is no price watcher — and the due date arriving is evidence about
 * the calendar, nothing else.
 */
describe('what they were waiting for', () => {
  const WAITING = 'Q3 earnings and updated margin guidance'

  it('becomes the headline, in their words, verbatim', () => {
    expect(card({ waitingFor: WAITING }).headline)
      .toBe('You parked NVDA waiting for Q3 earnings and updated margin guidance')
  })

  it('NEVER claims the thing happened', () => {
    const c = card({ waitingFor: WAITING, daysOverdue: 40 })
    const all = `${c.headline} ${c.body} ${c.prompt} ${c.provenance.reason}`
    expect(all).not.toMatch(/has happened\b|have happened\b|occurred|has now|took place|is done|reported|released/i)
  })

  it('an overdue date is not treated as evidence the condition was met', () => {
    // The one inference a reader might expect us to make, and the one we
    // must not: the date passing says the date passed.
    const fresh = card({ waitingFor: WAITING, daysOverdue: 0 })
    const stale = card({ waitingFor: WAITING, daysOverdue: 90 })
    expect(stale.headline).toBe(fresh.headline)
    expect(stale.prompt).toBe(fresh.prompt)
  })

  it('asks whether it happened rather than asserting it', () => {
    expect(card({ waitingFor: WAITING }).prompt)
      .toBe('Has Q3 earnings and updated margin guidance happened?')
  })

  it('keeps the timing in the body once the headline carries the reason', () => {
    // Nothing is said twice: reason in the headline, timing and changes in
    // the body, where-you-left-it in the chips, sources in the detail.
    const c = card({ waitingFor: WAITING })
    expect(c.body).toContain('Parked 11 days ago.')
    expect(c.headline).not.toMatch(/11 days/)
  })

  it('falls back honestly when no reason was given', () => {
    expect(card({ waitingFor: null }).headline).toBe('You parked NVDA 11 days ago')
    expect(card({ waitingFor: null }).prompt).toBe('Is this still worth doing?')
  })

  it('treats whitespace as no reason at all', () => {
    expect(card({ waitingFor: '   ' as unknown as string }).headline).not.toMatch(/waiting for\s*$/)
  })
})

describe('the headline is the reader\'s own decision', () => {
  it('leads with what they did, not with what we noticed', () => {
    expect(card().headline).toBe('You parked NVDA 11 days ago')
  })

  it('says today and yesterday rather than 0 and 1 days', () => {
    expect(card({ daysOverdue: 0 }).headline).toBe('You parked NVDA today')
    expect(card({ daysOverdue: 1 }).headline).toBe('You parked NVDA yesterday')
    expect(parkedPhrase(0)).toBe('today')
    expect(parkedPhrase(-3)).toBe('today')
  })

  it('never implies we know WHY it was parked', () => {
    // The obligation records THAT work was parked. Nothing records why.
    const c = card()
    expect(`${c.headline} ${c.body} ${c.prompt}`).not.toMatch(/because|you thought|you believed/i)
  })
})

/**
 * One region, one job.
 *
 * The first draft put the fact labels in the chips AND in the detail. At
 * 390px that overflowed the chip row — clipping "Core Equity" mid-word —
 * left the body unrendered, and printed the same three facts twice on one
 * screen. These tests pin the split that fixed it.
 */
describe('where you left it lives in the chips', () => {
  it('carries the stage and conviction', () => {
    const labels = card().context.map(x => x.label)
    expect(labels).toContain('Researching')
    expect(labels).toContain('Medium conviction')
  })

  it('renders only what exists', () => {
    expect(card({ conviction: null }).context.map(x => x.label)).not.toContain('Medium conviction')
    expect(card({ stage: null }).context.map(x => x.label)).not.toContain('Researching')
  })

  it('says something true when neither is known', () => {
    // Not "Unknown · Unknown", and not an empty row.
    expect(card({ stage: null, conviction: null }).context.map(x => x.label))
      .toContain('Still undecided')
  })

  it('carries the portfolio', () => {
    expect(card().context.map(x => x.label)).toContain('Core Growth')
  })

  it('never puts a change fact in the chips', () => {
    // That row is for picking the work back up. The facts are the body and
    // the detail; repeating them here is what clipped the row.
    const c = card({ facts: [fact()], totalFactCount: 1 })
    expect(c.context.map(x => x.label)).not.toContain('+8.4% price')
  })

  it('stays short enough not to overflow a 390px row', () => {
    const c = card()
    expect(c.context.length).toBeLessThanOrEqual(3)
    for (const chip of c.context) expect(chip.label.length).toBeLessThan(26)
  })

  it('whereYouLeftItLine still composes the line for other surfaces', () => {
    expect(whereYouLeftItLine('researching', 'medium')).toBe('Researching · Medium conviction')
    expect(whereYouLeftItLine(null, null)).toBeNull()
  })
})

describe('what moved is the body', () => {
  it('lists the facts in one line', () => {
    const c = card({
      facts: [fact(), fact({ kind: 'research_added', label: '3 new research items' })],
      totalFactCount: 2,
    })
    expect(c.body).toBe('While it was parked: +8.4% price, 3 new research items.')
  })

  it('counts the overflow rather than dropping it silently', () => {
    const c = card({ facts: [fact()], totalFactCount: 4 })
    expect(c.body).toContain('and 3 more.')
  })

  it('does not claim an overflow when everything is shown', () => {
    expect(card({ facts: [fact()], totalFactCount: 1 }).body).not.toMatch(/more/)
  })

  it('joins with commas and never with a causal word', () => {
    // "+8.4% and 3 new research items" is two facts; "+8.4% on the back of
    // new research" is a claim nobody verified. The join must stay inert.
    const c = card({
      facts: [fact(), fact({ kind: 'research_added', label: '3 new research items' })],
      totalFactCount: 2,
    })
    expect(c.body).not.toMatch(/because|after|on the back of|driven by|following/i)
  })
})

describe('the empty case is still a useful card', () => {
  const c = card({ facts: [], totalFactCount: 0 })

  it('renders, rather than suppressing', () => {
    expect(c.headline).toBeTruthy()
  })

  it('still says where they left it', () => {
    expect(c.context.map(x => x.label)).toContain('Researching')
  })

  it('states the absence plainly rather than inventing activity', () => {
    expect(c.body).toBe('Nothing has been recorded against it since.')
    // "Nothing happened" would be a claim about the world. This is a claim
    // about our records, which is the only one we can make.
    expect(c.body).not.toMatch(/nothing happened|no news|quiet/i)
  })

  it('asks a different question when nothing moved', () => {
    expect(c.prompt).toBe('Is this still worth doing?')
    expect(card({ facts: [fact()], totalFactCount: 1 }).prompt)
      .toBe('Does any of this change the call?')
  })
})

describe('it must not read as a price alert', () => {
  it('the metric is the wait, not the price', () => {
    const c = card({ facts: [fact()], totalFactCount: 1 })
    expect(c.metric?.value).toBe('11')
    expect(c.metric?.label).toBe('Days since you asked')
    expect(c.metric?.value).not.toContain('%')
  })

  it('singularises one day', () => {
    expect(card({ daysOverdue: 1 }).metric?.label).toBe('Day since you asked')
  })

  it('the price move stays one item among the other facts', () => {
    const c = card({ facts: [fact()], totalFactCount: 1 })
    expect(c.body).toContain('+8.4% price')
  })

  it('sits on the workflow surface, not market', () => {
    expect(card().surface).toBe('workflow')
    expect(card().type).toBe('ready_to_revisit')
  })
})

describe('severity comes from the reader\'s own schedule', () => {
  it('is informational on the day and for the first fortnight', () => {
    expect(card({ daysOverdue: 0 }).severity).toBe('informational')
    expect(card({ daysOverdue: 13 }).severity).toBe('informational')
  })

  it('escalates once properly overdue', () => {
    expect(card({ daysOverdue: 14 }).severity).toBe('attention')
  })

  it('never reaches critical — a reminder is not a risk event', () => {
    expect(card({ daysOverdue: 400 }).severity).not.toBe('critical')
  })
})

describe('identity and provenance', () => {
  it('has a stable id with nothing time-varying in it', () => {
    expect(card({ daysOverdue: 11 }).id).toBe(card({ daysOverdue: 99 }).id)
  })

  it('dedupes on the obligation, not the idea', () => {
    // Parking the same idea again later is a NEW promise and deserves a new
    // card rather than being deduped against the fulfilled one.
    expect(card().dedupeKey).toBe('ready_to_revisit:ob-1')
  })

  it('answers "why am I seeing this" with the reader\'s own action', () => {
    expect(card().provenance.reason).toContain('You asked to revisit this')
  })

  it('dates itself from when the work was parked, not from now', () => {
    expect(card().provenance.occurredAt).toBe('2026-09-20T00:00:00Z')
  })

  it('offers one action, back to the work', () => {
    expect(card().actions.primary).toMatchObject({ id: 'open_idea', label: 'Resume work' })
  })
})

describe('suppression', () => {
  it('refuses to render without a resolvable asset', () => {
    // RLS hid the subject, or the row is gone. A card that cannot name what
    // it is about must not speak.
    const r = buildReadyToRevisitCard(input({ symbol: null }))
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('insufficient_coverage')
  })

  it('refuses without an asset id even when a symbol is present', () => {
    expect(buildReadyToRevisitCard(input({ assetId: null })).ok).toBe(false)
  })
})
