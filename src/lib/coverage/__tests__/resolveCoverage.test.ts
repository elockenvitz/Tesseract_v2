import { describe, it, expect } from 'vitest'
import {
  coverageRoleRank,
  sortCoverageDeterministically,
  resolveCoverageDefault,
  resolveCoverageForViewer,
  type CoverageRow,
} from '../resolveCoverage'

// ─── Factory ────────────────────────────────────────────────────────────

function makeRow(overrides: Partial<CoverageRow> = {}): CoverageRow {
  return {
    id: 'cov-1',
    asset_id: 'asset-1',
    user_id: 'user-1',
    analyst_name: 'Alice',
    role: null,
    is_lead: false,
    team_id: null,
    visibility: 'firm',
    portfolio_id: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...overrides,
  }
}

// ─── coverageRoleRank ───────────────────────────────────────────────────

describe('coverageRoleRank', () => {
  it('ranks primary < secondary < tertiary < custom < null', () => {
    expect(coverageRoleRank('primary')).toBe(0)
    expect(coverageRoleRank('secondary')).toBe(1)
    expect(coverageRoleRank('tertiary')).toBe(2)
    expect(coverageRoleRank('specialist')).toBe(3)
    expect(coverageRoleRank(null)).toBe(4)
    expect(coverageRoleRank(undefined)).toBe(4)
  })
})

// ─── sortCoverageDeterministically ──────────────────────────────────────

describe('sortCoverageDeterministically', () => {
  it('puts is_lead=true first', () => {
    const rows = [
      makeRow({ user_id: 'u-a', is_lead: false }),
      makeRow({ user_id: 'u-b', is_lead: true }),
    ]
    const sorted = sortCoverageDeterministically(rows)
    expect(sorted[0].user_id).toBe('u-b')
  })

  it('ranks primary before secondary before tertiary', () => {
    const rows = [
      makeRow({ user_id: 'u-c', role: 'tertiary' }),
      makeRow({ user_id: 'u-a', role: 'primary' }),
      makeRow({ user_id: 'u-b', role: 'secondary' }),
    ]
    const sorted = sortCoverageDeterministically(rows)
    expect(sorted.map(r => r.role)).toEqual(['primary', 'secondary', 'tertiary'])
  })

  it('breaks ties by updated_at DESC', () => {
    const rows = [
      makeRow({ user_id: 'u-a', role: 'primary', updated_at: '2026-01-01T00:00:00Z' }),
      makeRow({ user_id: 'u-b', role: 'primary', updated_at: '2026-02-01T00:00:00Z' }),
    ]
    const sorted = sortCoverageDeterministically(rows)
    expect(sorted[0].user_id).toBe('u-b') // more recent
  })

  it('breaks remaining ties by user_id ASC', () => {
    const rows = [
      makeRow({ user_id: 'u-z', role: 'primary', updated_at: '2026-01-01T00:00:00Z' }),
      makeRow({ user_id: 'u-a', role: 'primary', updated_at: '2026-01-01T00:00:00Z' }),
    ]
    const sorted = sortCoverageDeterministically(rows)
    expect(sorted[0].user_id).toBe('u-a') // alphabetically first
  })

  it('does not mutate original array', () => {
    const rows = [
      makeRow({ user_id: 'u-b' }),
      makeRow({ user_id: 'u-a' }),
    ]
    const original = [...rows]
    sortCoverageDeterministically(rows)
    expect(rows[0].user_id).toBe(original[0].user_id)
  })

  it('returns empty array for empty input', () => {
    expect(sortCoverageDeterministically([])).toEqual([])
  })

  it('handles mixed lead + role tiers correctly', () => {
    const rows = [
      makeRow({ user_id: 'u-a', is_lead: false, role: 'primary' }),
      makeRow({ user_id: 'u-b', is_lead: true, role: 'secondary' }),
    ]
    const sorted = sortCoverageDeterministically(rows)
    // is_lead wins over role
    expect(sorted[0].user_id).toBe('u-b')
  })
})

// ─── resolveCoverageDefault ─────────────────────────────────────────────

describe('resolveCoverageDefault', () => {
  it('returns null for empty array', () => {
    expect(resolveCoverageDefault([])).toBeNull()
  })

  it('returns the deterministic winner', () => {
    const rows = [
      makeRow({ user_id: 'u-c', role: 'tertiary' }),
      makeRow({ user_id: 'u-a', role: 'primary', is_lead: true }),
      makeRow({ user_id: 'u-b', role: 'secondary' }),
    ]
    const winner = resolveCoverageDefault(rows)
    expect(winner?.user_id).toBe('u-a')
  })

  it('returns is_lead even without primary role', () => {
    const rows = [
      makeRow({ user_id: 'u-a', role: null, is_lead: false }),
      makeRow({ user_id: 'u-b', role: null, is_lead: true }),
    ]
    expect(resolveCoverageDefault(rows)?.user_id).toBe('u-b')
  })
})

// ─── resolveCoverageForViewer ───────────────────────────────────────────

describe('resolveCoverageForViewer', () => {
  it('without viewerNodeIds, all rows go to firmWide', () => {
    const rows = [
      makeRow({ user_id: 'u-a', team_id: 'node-1', visibility: 'team' }),
      makeRow({ user_id: 'u-b', visibility: 'firm' }),
    ]
    const result = resolveCoverageForViewer(rows)
    expect(result.inScope).toHaveLength(0)
    expect(result.firmWide).toHaveLength(2)
    expect(result.chosenDefault).toBeDefined()
  })

  it('with viewerNodeIds, scopes rows correctly', () => {
    const rows = [
      makeRow({ user_id: 'u-a', team_id: 'node-1', visibility: 'team', role: 'secondary' }),
      makeRow({ user_id: 'u-b', team_id: 'node-2', visibility: 'team', role: 'primary' }),
      makeRow({ user_id: 'u-c', visibility: 'firm', role: 'tertiary' }),
    ]
    const result = resolveCoverageForViewer(rows, ['node-1'])
    expect(result.inScope).toHaveLength(1)
    expect(result.inScope[0].user_id).toBe('u-a')
    expect(result.firmWide).toHaveLength(1)
    expect(result.firmWide[0].user_id).toBe('u-c')
    expect(result.outOfScope).toHaveLength(1)
    expect(result.outOfScope[0].user_id).toBe('u-b')
  })

  it('prefers inScope default over firmWide', () => {
    const rows = [
      makeRow({ user_id: 'u-a', team_id: 'node-1', visibility: 'team', role: 'secondary' }),
      makeRow({ user_id: 'u-b', visibility: 'firm', role: 'primary' }),
    ]
    const result = resolveCoverageForViewer(rows, ['node-1'])
    expect(result.chosenDefault?.user_id).toBe('u-a') // in-scope wins
  })

  it('falls back to firmWide when no inScope', () => {
    const rows = [
      makeRow({ user_id: 'u-a', team_id: 'node-2', visibility: 'team' }),
      makeRow({ user_id: 'u-b', visibility: 'firm', role: 'primary' }),
    ]
    const result = resolveCoverageForViewer(rows, ['node-1'])
    expect(result.chosenDefault?.user_id).toBe('u-b')
  })

  it('falls back to any when no inScope or firmWide', () => {
    const rows = [
      makeRow({ user_id: 'u-a', team_id: 'node-2', visibility: 'team' }),
    ]
    const result = resolveCoverageForViewer(rows, ['node-1'])
    expect(result.chosenDefault?.user_id).toBe('u-a')
  })

  it('null team_id rows go to firmWide (legacy unscoped)', () => {
    const rows = [
      makeRow({ user_id: 'u-a', team_id: null, visibility: 'team' }),
    ]
    const result = resolveCoverageForViewer(rows, ['node-1'])
    expect(result.firmWide).toHaveLength(1)
  })

  it('returns null chosenDefault for empty input', () => {
    const result = resolveCoverageForViewer([], ['node-1'])
    expect(result.chosenDefault).toBeNull()
    expect(result.all).toHaveLength(0)
  })
})
