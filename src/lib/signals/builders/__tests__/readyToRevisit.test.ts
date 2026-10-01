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

describe('where you left it', () => {
  it('states the stage and conviction as the body', () => {
    expect(card().body).toBe('You left it at Researching · Medium conviction.')
  })

  it('renders only what exists', () => {
    expect(card({ conviction: null }).body).toBe('You left it at Researching.')
    expect(card({ stage: null }).body).toBe('You left it at Medium conviction.')
  })

  it('falls back to a true sentence when neither is known', () => {
    // Not "Unknown · Unknown", and not silence.
    expect(card({ stage: null, conviction: null }).body)
      .toBe('It is still undecided, exactly as you left it.')
  })

  it('whereYouLeftItLine returns null rather than an empty join', () => {
    expect(whereYouLeftItLine(null, null)).toBeNull()
  })
})

describe('since then', () => {
  it('renders each fact as its own chip, never joined into a narrative', () => {
    // "+8.4% and 3 new research items" is two facts. "+8.4% on the back of
    // new research" is a claim nobody verified. Chips make the join
    // impossible to express.
    const c = card({
      facts: [fact(), fact({ kind: 'research_added', label: '3 new research items' })],
      totalFactCount: 2,
    })
    const labels = c.context.map(x => x.label)
    expect(labels).toContain('+8.4% price')
    expect(labels).toContain('3 new research items')
  })

  it('counts the overflow rather than dropping it silently', () => {
    const c = card({ facts: [fact()], totalFactCount: 4 })
    expect(c.context.map(x => x.label)).toContain('+3 more')
  })

  it('shows no overflow chip when everything is shown', () => {
    const c = card({ facts: [fact()], totalFactCount: 1 })
    expect(c.context.map(x => x.label)).not.toContain('+0 more')
  })

  it('carries the portfolio as context', () => {
    expect(card().context.map(x => x.label)).toContain('Core Growth')
  })
})

describe('the empty case is still a useful card', () => {
  const c = card({ facts: [], totalFactCount: 0 })

  it('renders, rather than suppressing', () => {
    expect(c.headline).toBeTruthy()
  })

  it('still says where they left it', () => {
    expect(c.body).toContain('Researching')
  })

  it('invents no activity to fill the space', () => {
    const factLabels = c.context.map(x => x.label).filter(l => l !== 'Core Growth')
    expect(factLabels).toEqual([])
    expect(`${c.headline} ${c.body}`).not.toMatch(/no changes|nothing happened|no activity/i)
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

  it('the price move stays a chip among the other facts', () => {
    const c = card({ facts: [fact()], totalFactCount: 1 })
    expect(c.context.map(x => x.label)).toContain('+8.4% price')
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

  it('recurs on the obligation, not the idea', () => {
    // Parking the same idea again later is a NEW promise and deserves a new
    // card rather than being deduped against the old one.
    expect(card().recurrenceKey).toBe('ready_to_revisit:ob-1')
  })

  it('attributes itself to the obligation, not to a derivation', () => {
    expect(card().provenance.source).toBe('memory_obligations')
    expect(card().provenance.detail).toContain('You set this revisit date')
  })

  it('dates itself from when the work was parked', () => {
    expect(card().occurredAt).toBe('2026-09-20T00:00:00Z')
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
