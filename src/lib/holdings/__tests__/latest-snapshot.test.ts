import { describe, it, expect } from 'vitest'
import { latestSnapshotRows } from '../latest-snapshot'

/**
 * The numbers here are the real inflation factors measured in production, so a
 * regression reproduces the actual defect rather than a toy version of it.
 */

describe('latestSnapshotRows', () => {
  it('keeps only the newest snapshot per portfolio', () => {
    const rows = [
      { portfolio_id: 'a', date: '2026-04-21', asset_id: 'x' },
      { portfolio_id: 'a', date: '2026-01-05', asset_id: 'x' },
      { portfolio_id: 'a', date: '2026-04-21', asset_id: 'y' },
    ]
    const out = latestSnapshotRows(rows)
    expect(out).toHaveLength(2)
    expect(out.every(r => r.date === '2026-04-21')).toBe(true)
  })

  it('groups per portfolio, not globally', () => {
    // Portfolios upload on different schedules. A single global max date would
    // silently empty every portfolio not updated that day.
    const rows = [
      { portfolio_id: 'fresh', date: '2026-08-01' },
      { portfolio_id: 'stale', date: '2026-02-05' },
      { portfolio_id: 'stale', date: '2026-01-01' },
    ]
    const out = latestSnapshotRows(rows)
    expect(out.map(r => r.portfolio_id).sort()).toEqual(['fresh', 'stale'])
    expect(out.find(r => r.portfolio_id === 'stale')!.date).toBe('2026-02-05')
  })

  it('removes the 36x denominator inflation that was live in production', () => {
    // Tech & Consumer Growth: 36 rows across 2 dates, 1 on the newest.
    const rows = [
      { portfolio_id: 'tcg', date: '2026-04-21', shares: 10, price: 100 },
      ...Array.from({ length: 35 }, (_, i) => ({
        portfolio_id: 'tcg', date: '2026-03-0' + (i % 9), shares: 10, price: 100,
      })),
    ]
    const value = (r: { shares: number; price: number }) => r.shares * r.price
    const naive = rows.reduce((n, r) => n + value(r), 0)
    const correct = latestSnapshotRows(rows).reduce((n, r) => n + value(r), 0)
    expect(naive / correct).toBe(36)
    expect(correct).toBe(1000)
  })

  it('keeps undated rows only when a portfolio has nothing dated', () => {
    // Dropping them would empty a portfolio whose snapshots predate the column;
    // preferring them would resurrect stale positions.
    expect(latestSnapshotRows([{ portfolio_id: 'p', date: null }])).toHaveLength(1)
    const mixed = [
      { portfolio_id: 'p', date: null, tag: 'undated' },
      { portfolio_id: 'p', date: '2026-04-21', tag: 'dated' },
    ]
    expect(latestSnapshotRows(mixed).map(r => r.tag)).toEqual(['dated'])
  })

  it('is a no-op on an empty set and on a single snapshot', () => {
    expect(latestSnapshotRows([])).toEqual([])
    const one = [{ portfolio_id: 'p', date: '2026-04-21' }]
    expect(latestSnapshotRows(one)).toEqual(one)
  })
})
