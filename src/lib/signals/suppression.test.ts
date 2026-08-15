import { describe, it, expect, beforeEach } from 'vitest'
import {
  isQualityContent, isDisplayableNumber, isQuoteFresh,
  gate, readSuppressionLog, suppressionSummary, QUOTE_MAX_AGE_MS,
} from './suppression'
import { suppress, emit, type SignalCard } from './contract'

describe('content quality gate', () => {
  it('rejects the placeholders that reached the live feed', () => {
    // All observed in production screenshots.
    for (const bad of ['Test', 'test', 'general project', 'asdf', 'TBD', 'n/a', '..']) {
      expect(isQualityContent(bad)).toBe(false)
    }
  })

  it('rejects keyboard mash', () => {
    expect(isQualityContent('NDDFKJSDNFKJ')).toBe(false)
    expect(isQualityContent('ksadjfnskdjn')).toBe(false)
  })

  it('does not reject real content that happens to look odd', () => {
    // Guards against a mash rule tuned so aggressively it eats tickers,
    // acronyms and short real sentences.
    for (const good of [
      'MSFT',
      'NVDA is 29.6% of the book',
      'Q3 GAAP EPS missed by 4c',
      'AI capex',
      'BRK.B',
      'Thesis broke on the Q2 print.',
    ]) {
      expect(isQualityContent(good)).toBe(true)
    }
  })

  it('treats a consonant-heavy real word as content', () => {
    // "strengths" is 9 letters with one vowel cluster — close to the mash
    // boundary, and rejecting it would be worse than letting mash through.
    expect(isQualityContent('strengths')).toBe(true)
  })
})

describe('displayable numbers', () => {
  it('rejects zero by default', () => {
    // createPlaceholderQuote returned price: 0, changePercent: 0 as a
    // "won't break the UI" fallback, so a zero here has historically meant
    // "unknown" more often than it has meant zero.
    expect(isDisplayableNumber(0)).toBe(false)
    expect(isDisplayableNumber(0, { allowZero: true })).toBe(true)
  })

  it('rejects null, undefined and NaN', () => {
    expect(isDisplayableNumber(null)).toBe(false)
    expect(isDisplayableNumber(undefined)).toBe(false)
    expect(isDisplayableNumber(Number.NaN)).toBe(false)
  })

  it('accepts negatives — a drawdown is a real number', () => {
    expect(isDisplayableNumber(-12.4)).toBe(true)
  })
})

describe('quote freshness', () => {
  it('accepts a quote from a moment ago', () => {
    expect(isQuoteFresh(new Date().toISOString())).toBe(true)
  })

  it('rejects one past the threshold', () => {
    const old = new Date(Date.now() - QUOTE_MAX_AGE_MS - 1000).toISOString()
    expect(isQuoteFresh(old)).toBe(false)
  })

  it('rejects a missing or unparseable timestamp', () => {
    expect(isQuoteFresh(null)).toBe(false)
    expect(isQuoteFresh('not a date')).toBe(false)
  })
})

describe('gate', () => {
  beforeEach(() => localStorage.clear())

  it('logs a suppression with its reason and entity', () => {
    gate('target_hit', () => suppress('snapshot_vs_live', 'AMZN', 'holdings 31 Jul vs live'))
    const log = readSuppressionLog()
    expect(log).toHaveLength(1)
    expect(log[0]).toMatchObject({
      reason: 'snapshot_vs_live', entity: 'AMZN', type: 'target_hit',
    })
  })

  it('logs nothing when a card is emitted', () => {
    gate('active_risk', () => emit({ id: 'x' } as unknown as SignalCard))
    expect(readSuppressionLog()).toHaveLength(0)
  })

  it('summarises by reason for the ops view', () => {
    gate('a', () => suppress('content_quality', 'E1'))
    gate('b', () => suppress('content_quality', 'E2'))
    gate('c', () => suppress('missing_number', 'E3'))
    expect(suppressionSummary()).toEqual({ content_quality: 2, missing_number: 1 })
  })

  it('passes the card through unchanged', () => {
    const card = { id: 'abc' } as unknown as SignalCard
    const out = gate('news', () => emit(card))
    expect(out.ok && out.card).toBe(card)
  })
})
