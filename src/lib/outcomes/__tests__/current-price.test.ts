/**
 * Which price a decision is measured against today.
 *
 * `assets.current_price` carries no date and is written by whatever last
 * touched the asset row. Measuring against it reported Bogey Cap's MSFT trade
 * -- executed at 501.11 against a 497.12 close -- as -23.1%, because the
 * comparison price was a month old. The cached close is dated, canonical, and
 * what every other surface already measures against.
 */
import { describe, it, expect } from 'vitest'
import { currentPriceFor } from '../current-price'
import { DAILY_CLOSE_POLICY } from '../../market-data/freshness'

const DAY = 86_400_000
const at = (days: number) => new Date(Date.now() - days * DAY).toISOString().slice(0, 10)

describe('choosing the current price', () => {
  it('prefers a newer cached close over a stale asset price', () => {
    // The live shape: MSFT's close is today, `assets.current_price` a month old.
    const picked = currentPriceFor({ close: 497.12, date: at(0) }, 385.2)!
    expect(picked).toMatchObject({ price: 497.12, asOf: at(0), stale: false })
  })

  it('carries the close’s own date, so the surface can say how current it is', () => {
    expect(currentPriceFor({ close: '250.5', date: at(1) }, null)!.asOf).toBe(at(1))
  })

  it('flags a close older than the daily-close policy rather than hiding it', () => {
    const days = DAILY_CLOSE_POLICY.maxAgeMs / DAY + 3
    const picked = currentPriceFor({ close: 100, date: at(days) }, null)!
    // Still used -- it is dated, and a reader can see the age -- but not
    // presented as current.
    expect(picked).toMatchObject({ price: 100, stale: true })
    expect(picked.asOf).toBe(at(days))
  })

  it('falls back to the asset price when nothing is cached, undated and flagged', () => {
    const picked = currentPriceFor(null, 385.2)!
    expect(picked).toEqual({ price: 385.2, asOf: null, stale: true })
  })

  it('returns nothing when no trustworthy price exists, so nothing is fabricated', () => {
    expect(currentPriceFor(null, null)).toBeNull()
    expect(currentPriceFor(null, 0)).toBeNull()
    expect(currentPriceFor({ close: null, date: at(0) }, null)).toBeNull()
    expect(currentPriceFor({ close: -4, date: at(0) }, undefined)).toBeNull()
  })
})
