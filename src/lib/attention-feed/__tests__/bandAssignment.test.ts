import { describe, it, expect } from 'vitest'
import {
  assignBand,
  filterUrgentOnly,
  sortNow,
  sortSoon,
  sortAware,
  computeBandSummary,
} from '../bandAssignment'
import type { AttentionFeedItem } from '../../../types/attention-feed'

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function makeItem(overrides: Partial<AttentionFeedItem> = {}): AttentionFeedItem {
  return {
    id: 'test-1',
    type: 'deliverable',
    title: 'Test Item',
    severity: 'low',
    band: 'soon',
    source: 'projects',
    related: {},
    ageDays: 0,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    owner: {},
    actions: [],
    chips: [],
    overdue: false,
    dueSoon: false,
    requiresDecision: false,
    blocking: false,
    _sortScore: 0,
    _sourceSystem: 'decision_engine',
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// assignBand
// ---------------------------------------------------------------------------

describe('assignBand', () => {
  it('assigns NOW for high severity', () => {
    const item = makeItem({ severity: 'high' })
    expect(assignBand(item)).toBe('now')
  })

  it('assigns NOW for requiresDecision', () => {
    const item = makeItem({ requiresDecision: true })
    expect(assignBand(item)).toBe('now')
  })

  it('assigns NOW for overdue items', () => {
    const item = makeItem({ overdue: true })
    expect(assignBand(item)).toBe('now')
  })

  it('assigns NOW for blocking items', () => {
    const item = makeItem({ blocking: true })
    expect(assignBand(item)).toBe('now')
  })

  it('assigns SOON for medium severity', () => {
    const item = makeItem({ severity: 'medium' })
    expect(assignBand(item)).toBe('soon')
  })

  it('assigns SOON for dueSoon items', () => {
    const item = makeItem({ dueSoon: true })
    expect(assignBand(item)).toBe('soon')
  })

  it('assigns AWARE for signal type', () => {
    const item = makeItem({ type: 'signal' })
    expect(assignBand(item)).toBe('aware')
  })

  it('assigns AWARE for notification type', () => {
    const item = makeItem({ type: 'notification' })
    expect(assignBand(item)).toBe('aware')
  })

  it('assigns AWARE for alignment type', () => {
    const item = makeItem({ type: 'alignment' })
    expect(assignBand(item)).toBe('aware')
  })

  it('awareness types are NOT promoted by severity', () => {
    const item = makeItem({ type: 'signal', severity: 'high' })
    expect(assignBand(item)).toBe('aware')
  })

  it('assigns SOON as default for actionable non-urgent items', () => {
    const item = makeItem({ type: 'thesis', severity: 'low' })
    expect(assignBand(item)).toBe('soon')
  })

  it('proposal type with requiresDecision goes to NOW', () => {
    const item = makeItem({ type: 'proposal', requiresDecision: true })
    expect(assignBand(item)).toBe('now')
  })
})

// ---------------------------------------------------------------------------
// filterUrgentOnly
// ---------------------------------------------------------------------------

describe('filterUrgentOnly', () => {
  it('includes all NOW items', () => {
    const items = [
      makeItem({ id: '1', band: 'now' }),
      makeItem({ id: '2', band: 'soon' }),
      makeItem({ id: '3', band: 'aware' }),
    ]
    const filtered = filterUrgentOnly(items)
    expect(filtered.map(i => i.id)).toContain('1')
  })

  it('includes SOON items that are dueSoon', () => {
    const items = [
      makeItem({ id: '1', band: 'soon', dueSoon: true }),
      makeItem({ id: '2', band: 'soon', dueSoon: false }),
    ]
    const filtered = filterUrgentOnly(items)
    expect(filtered.map(i => i.id)).toEqual(['1'])
  })

  it('includes SOON items that are overdue', () => {
    const items = [
      makeItem({ id: '1', band: 'soon', overdue: true }),
    ]
    const filtered = filterUrgentOnly(items)
    expect(filtered).toHaveLength(1)
  })

  it('excludes all AWARE items', () => {
    const items = [
      makeItem({ id: '1', band: 'aware' }),
      makeItem({ id: '2', band: 'aware', dueSoon: true }),
    ]
    const filtered = filterUrgentOnly(items)
    expect(filtered).toHaveLength(0)
  })

  it('excludes SOON items that are neither dueSoon nor overdue', () => {
    const items = [
      makeItem({ id: '1', band: 'soon' }),
    ]
    const filtered = filterUrgentOnly(items)
    expect(filtered).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// sortNow
// ---------------------------------------------------------------------------

describe('sortNow', () => {
  it('sorts by severity desc', () => {
    const items = [
      makeItem({ id: 'low', severity: 'low', band: 'now' }),
      makeItem({ id: 'high', severity: 'high', band: 'now' }),
      makeItem({ id: 'med', severity: 'medium', band: 'now' }),
    ]
    const sorted = sortNow(items)
    expect(sorted.map(i => i.id)).toEqual(['high', 'med', 'low'])
  })

  it('overdue items first within same severity', () => {
    const items = [
      makeItem({ id: 'not-overdue', severity: 'high', overdue: false, band: 'now' }),
      makeItem({ id: 'overdue', severity: 'high', overdue: true, band: 'now' }),
    ]
    const sorted = sortNow(items)
    expect(sorted[0].id).toBe('overdue')
  })

  it('older items first within same severity and overdue', () => {
    const items = [
      makeItem({ id: 'young', severity: 'high', ageDays: 1, band: 'now' }),
      makeItem({ id: 'old', severity: 'high', ageDays: 10, band: 'now' }),
    ]
    const sorted = sortNow(items)
    expect(sorted[0].id).toBe('old')
  })
})

// ---------------------------------------------------------------------------
// sortSoon
// ---------------------------------------------------------------------------

describe('sortSoon', () => {
  it('due date asc — items with earlier due dates first', () => {
    const items = [
      makeItem({ id: 'later', dueAt: '2026-03-15', band: 'soon' }),
      makeItem({ id: 'sooner', dueAt: '2026-03-01', band: 'soon' }),
    ]
    const sorted = sortSoon(items)
    expect(sorted[0].id).toBe('sooner')
  })

  it('items with due dates before those without', () => {
    const items = [
      makeItem({ id: 'no-due', band: 'soon' }),
      makeItem({ id: 'has-due', dueAt: '2026-03-01', band: 'soon' }),
    ]
    const sorted = sortSoon(items)
    expect(sorted[0].id).toBe('has-due')
  })
})

// ---------------------------------------------------------------------------
// sortAware
// ---------------------------------------------------------------------------

describe('sortAware', () => {
  it('newest first by updatedAt', () => {
    const items = [
      makeItem({ id: 'old', updatedAt: '2026-01-01', band: 'aware' }),
      makeItem({ id: 'new', updatedAt: '2026-02-15', band: 'aware' }),
    ]
    const sorted = sortAware(items)
    expect(sorted[0].id).toBe('new')
  })
})

// ---------------------------------------------------------------------------
// computeBandSummary
// ---------------------------------------------------------------------------

describe('computeBandSummary', () => {
  it('computes count and oldest age', () => {
    const items = [
      makeItem({ ageDays: 5, type: 'proposal' }),
      makeItem({ ageDays: 12, type: 'deliverable' }),
    ]
    const summary = computeBandSummary('now', items)
    expect(summary.count).toBe(2)
    expect(summary.oldestAgeDays).toBe(12)
  })

  it('generates breakdown string', () => {
    const items = [
      makeItem({ type: 'proposal' }),
      makeItem({ type: 'proposal' }),
      makeItem({ type: 'deliverable' }),
    ]
    const summary = computeBandSummary('now', items)
    expect(summary.breakdown).toContain('decisions')
    expect(summary.breakdown).toContain('overdue')
  })

  it('finds next due date for SOON band', () => {
    const items = [
      makeItem({ dueAt: '2026-03-15' }),
      makeItem({ dueAt: '2026-03-01' }),
    ]
    const summary = computeBandSummary('soon', items)
    expect(summary.nextDueAt).toBe('2026-03-01')
  })

  it('returns zero for empty list', () => {
    const summary = computeBandSummary('now', [])
    expect(summary.count).toBe(0)
    expect(summary.oldestAgeDays).toBe(0)
    expect(summary.breakdown).toBe('')
  })
})
