import { describe, it, expect } from 'vitest'
import { latestBenchmarkRows } from '../latest-benchmark'

/**
 * These assert the behaviour AFTER the history migration, on a table that
 * cannot yet hold a second date. That is the point: the collapse this
 * prevents has already happened twice in this codebase, and both times the
 * guard was written after the damage.
 */
describe('latestBenchmarkRows', () => {
  it('keeps only the newest file per portfolio', () => {
    const rows = [
      { portfolio_id: 'p1', asset_id: 'a', as_of_date: '2026-08-14', weight: 6.7 },
      { portfolio_id: 'p1', asset_id: 'a', as_of_date: '2026-07-14', weight: 6.1 },
      { portfolio_id: 'p1', asset_id: 'b', as_of_date: '2026-08-14', weight: 3.2 },
      { portfolio_id: 'p1', asset_id: 'b', as_of_date: '2026-07-14', weight: 3.0 },
    ]
    const kept = latestBenchmarkRows(rows)
    expect(kept).toHaveLength(2)
    expect(kept.every(r => r.as_of_date === '2026-08-14')).toBe(true)
  })

  it('does not let one portfolio newest date drop another portfolio', () => {
    // The failure a global max date would cause: a book whose file was not
    // refreshed this morning loses its whole benchmark and every name in it
    // reads as off-benchmark.
    const rows = [
      { portfolio_id: 'fresh', asset_id: 'a', as_of_date: '2026-08-14' },
      { portfolio_id: 'stale', asset_id: 'a', as_of_date: '2026-05-01' },
    ]
    expect(latestBenchmarkRows(rows).map(r => r.portfolio_id).sort()).toEqual(['fresh', 'stale'])
  })

  it('is a no-op while the table holds a single date', () => {
    // Today's production state. The helper must change nothing now, or it
    // cannot be landed ahead of the migration.
    const rows = Array.from({ length: 5 }, (_, i) => ({
      portfolio_id: 'p1', asset_id: `a${i}`, as_of_date: '2026-08-14',
    }))
    expect(latestBenchmarkRows(rows)).toHaveLength(5)
  })

  it('keeps undated rows only when a portfolio has nothing dated', () => {
    const rows = [
      { portfolio_id: 'legacy', asset_id: 'a', as_of_date: null },
      { portfolio_id: 'mixed', asset_id: 'a', as_of_date: null },
      { portfolio_id: 'mixed', asset_id: 'b', as_of_date: '2026-08-14' },
    ]
    const kept = latestBenchmarkRows(rows)
    expect(kept.filter(r => r.portfolio_id === 'legacy')).toHaveLength(1)
    // The dated row wins; the undated one is not resurrected beside it.
    expect(kept.filter(r => r.portfolio_id === 'mixed')).toEqual([
      { portfolio_id: 'mixed', asset_id: 'b', as_of_date: '2026-08-14' },
    ])
  })

  it('returns an empty array unchanged', () => {
    expect(latestBenchmarkRows([])).toEqual([])
  })
})
