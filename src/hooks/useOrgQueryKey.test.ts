import { describe, it, expect } from 'vitest'
import { buildOrgQueryKey } from './useOrgQueryKey'

describe('buildOrgQueryKey', () => {
  it('appends org:<id> to base key', () => {
    const result = buildOrgQueryKey(['projects', 'user-1'], 'org-abc')
    expect(result).toEqual(['projects', 'user-1', 'org:org-abc'])
  })

  it('uses org:none when orgId is null', () => {
    const result = buildOrgQueryKey(['projects'], null)
    expect(result).toEqual(['projects', 'org:none'])
  })

  it('preserves all base key elements', () => {
    const result = buildOrgQueryKey(['calendar-events', 'org-x', '2024-01', '2024-02'], 'org-x')
    expect(result).toEqual(['calendar-events', 'org-x', '2024-01', '2024-02', 'org:org-x'])
  })

  it('handles empty base key', () => {
    const result = buildOrgQueryKey([], 'org-1')
    expect(result).toEqual(['org:org-1'])
  })

  it('returns a new array (not mutating input)', () => {
    const base = ['templates'] as const
    const result = buildOrgQueryKey(base, 'org-1')
    expect(result).not.toBe(base)
    expect(base).toHaveLength(1) // original unchanged
  })
})
