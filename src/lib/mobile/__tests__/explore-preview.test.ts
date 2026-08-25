import { describe, expect, it } from 'vitest'

import {
  compactHeadlineNumbers, exploreAge, explorePreview, normalizeSourceLabel,
  restatesMetric, stripRestatedMetric,
} from '../explore-preview'
import type { ExploreItem } from '../explore-item'
import { EXPLORE_FIXTURE, NOW } from './explore-fixture'

/**
 * What a card SAYS, as distinct from how big it is.
 *
 * Every case here is a thing that shipped and that no layout assertion could
 * see: a card is perfectly well-formed while printing the same number twice, or
 * while spending its headline on a spelled-out figure, or while implying a
 * publisher it has room to name.
 */

const item = (over: Partial<ExploreItem> = {}): ExploreItem => ({
  id: 'x', dedupeKey: 'k', signalType: 'conviction_oversized',
  category: 'decisions', subtype: 'signal',
  title: 'AMZN is larger than its conviction',
  destination: { kind: 'action', action: 'open_asset', assetId: 'a', symbol: 'AMZN' },
  ...over,
})

describe('a card does not say the same number twice', () => {
  it('drops the metric from the front of the supporting line', () => {
    // The reported card: "14.2% POSITION" over "14.2% in Large Cap Growth".
    // Both true, both from the same adapter, and one fact.
    const p = explorePreview(item({
      metric: { value: '14.2%', label: 'position' },
      context: '14.2% in Large Cap Growth',
    }))
    expect(p.metric?.value).toBe('14.2%')
    expect(p.secondary).toBe('Large Cap Growth')
  })

  it('handles the other connector the adapters use', () => {
    const p = explorePreview(item({
      metric: { value: '4.8%', label: 'of the portfolio' },
      context: '4.8% of Core Equity',
    }))
    expect(p.secondary).toBe('Core Equity')
  })

  it('starts the remaining clause as a sentence when the figure was its subject', () => {
    /**
     * "22% under the worst outcome modelled" has no connector to consume, so
     * removing the figure leaves a clause beginning mid-sentence — printed as a
     * card's supporting line it reads as something somebody truncated. The
     * number moved to the line above; the sentence starts here now.
     */
    const p = explorePreview(item({
      metric: { value: '22%', label: 'below bear' },
      context: '22% under the worst outcome modelled',
    }))
    expect(p.secondary).toBe('Under the worst outcome modelled')
  })

  it('does not re-case a proper noun it reached through a connector', () => {
    const p = explorePreview(item({
      metric: { value: '4.8%', label: 'position' },
      context: '4.8% of iShares Core',
    }))
    expect(p.secondary).toBe('iShares Core')
  })

  it('leaves a supporting line that is about something else alone', () => {
    // "Second revision this quarter" beside "8.1%" is two facts, not one
    // repeated, and stripping it would lose the more interesting one.
    const p = explorePreview(item({
      metric: { value: '8.1%', label: 'position' },
      context: 'Second revision this quarter',
    }))
    expect(p.secondary).toBe('Second revision this quarter')
  })

  it('drops a supporting line that was only the restatement', () => {
    const p = explorePreview(item({
      metric: { value: '22%', label: 'below bear' },
      context: '22%',
      companyName: undefined,
    }))
    expect(p.secondary).toBeUndefined()
  })

  it('never eats a digit off a different figure', () => {
    /**
     * The dangerous case, and the reason a bare prefix match is not enough.
     * The crowding card's metric is an unadorned `3`; a context of "32% of Core
     * Equity" starts with it, and a prefix strip would have rendered a card
     * reading "2% of Core Equity" — a wrong number, printed confidently.
     */
    expect(restatesMetric('32% of Core Equity', '3')).toBe(false)
    expect(stripRestatedMetric('32% of Core Equity', '3')).toBeNull()
    // `14.2%` and `14.25%` are different figures, and stay that way.
    expect(stripRestatedMetric('14.25% in Growth', '14.2%')).toBeNull()
    // A genuine restatement of the same bare figure still resolves.
    expect(stripRestatedMetric('3 portfolios hold it', '3')).toBe('Portfolios hold it')
    expect(restatesMetric('Second revision', '8.1%')).toBe(false)
  })

  it('falls back to the company name only when nothing else is left', () => {
    const named = explorePreview(item({ companyName: 'Amazon.com', context: 'A real finding' }))
    expect(named.secondary).toBe('A real finding')
    const bare = explorePreview(item({ companyName: 'Amazon.com' }))
    expect(bare.secondary).toBe('Amazon.com')
    const nothing = explorePreview(item({}))
    expect(nothing.secondary).toBeUndefined()
  })
})

describe('a story reads like a story', () => {
  it('says a verbose figure the way a card has room for', () => {
    expect(compactHeadlineNumbers('Louisiana US$10 Million Talc Verdict'))
      .toBe('Louisiana $10M Talc Verdict')
    expect(compactHeadlineNumbers('A US$1.25 Billion writedown')).toBe('A $1.25B writedown')
    expect(compactHeadlineNumbers('$500 thousand fine')).toBe('$500K fine')
  })

  it('changes no magnitude and no word', () => {
    // The transformation must be incapable of misquoting. Everything that is
    // not a currency-and-scale pair comes through untouched.
    const untouched = 'Apple wins partial reversal in App Store appeal after 10 years'
    expect(compactHeadlineNumbers(untouched)).toBe(untouched)
    expect(compactHeadlineNumbers('Revenue rose 10 million units')).toBe('Revenue rose 10 million units')
  })

  it('applies only to somebody else\'s headline', () => {
    // Tesseract copy is written to fit and needs no help; running a rewrite
    // over it would be a second copy layer with nothing to gain.
    const p = explorePreview(item({ title: 'AAPL has US$10 Million of something' }))
    expect(p.headline).toBe('AAPL has US$10 Million of something')
  })

  it('keeps the publisher visible however long the headline runs', () => {
    const jnj = EXPLORE_FIXTURE.find(i => i.id === 'n-jnj-talc')!
    const p = explorePreview(jnj)
    expect(p.source).toBe('Simply Wall St.')
    expect(p.headline).toContain('$10M')
    expect(p.headline).toContain('Johnson & Johnson')
    // Clamped deliberately rather than left to run: three lines reaches the
    // verb, and the fourth was pushing the source down the card.
    expect(p.headlineClamp).toBe(3)
  })

  it('spells a source one way', () => {
    expect(normalizeSourceLabel('  Simply  Wall St.  ')).toBe('Simply Wall St.')
    // And does not re-case, which would turn CNBC into Cnbc.
    expect(normalizeSourceLabel('CNBC')).toBe('CNBC')
  })

  it('gives a featured card width instead of lines', () => {
    expect(explorePreview(item({}), 'feature').headlineClamp).toBe(2)
  })
})

describe('an idea says where it has got to', () => {
  it('renders the state when the row carries one', () => {
    const p = explorePreview(item({
      category: 'ideas', subtype: 'idea', title: 'Trade idea',
      state: 'Buy · Discussing', companyName: 'Target Corporation',
    }))
    expect(p.state).toBe('Buy · Discussing')
    expect(p.secondary).toBe('Target Corporation')
  })

  it('omits it entirely when the row does not', () => {
    // Never invented. Most cards are not proposals and have no status.
    expect(explorePreview(item({ category: 'ideas', subtype: 'idea' })).state).toBeUndefined()
  })
})

describe('age is spelled one way', () => {
  it('uses one vocabulary across every unit', () => {
    const at = (ms: number) => exploreAge(new Date(NOW - ms).toISOString(), NOW)
    expect(at(45 * 60_000)).toBe('45m')
    expect(at(6 * 3_600_000)).toBe('6h')
    expect(at(12 * 86_400_000)).toBe('12d')
    expect(at(150 * 86_400_000)).toBe('5mo')
    expect(at(120 * 86_400_000)).toBe('4mo')
  })

  it('never spaces or spells out a unit', () => {
    for (const days of [0, 0.5, 3, 20, 45, 120, 400]) {
      const s = exploreAge(new Date(NOW - days * 86_400_000).toISOString(), NOW)!
      expect(s, `${days}d rendered as "${s}"`).toMatch(/^\d+(m|h|d|mo)$/)
    }
  })

  it('says nothing rather than "just now" for an absent timestamp', () => {
    expect(exploreAge(null, NOW)).toBeNull()
    expect(exploreAge('not a date', NOW)).toBeNull()
  })
})
