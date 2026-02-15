import { describe, it, expect, vi } from 'vitest'
import {
  mapDecisionItem,
  mapAttentionItem,
  splitByBand,
  computeTodaySummary,
  computeBandSummary,
  groupItems,
  filterUrgent,
  DECISION_HIGH_DAYS,
  DECISION_MED_DAYS,
  THESIS_HIGH_DAYS,
  THESIS_MED_DAYS,
  SIMULATION_MED_DAYS,
} from '../mapGdeToDashboardItems'
import type { DecisionItem } from '../../../engine/decisionEngine/types'
import type { AttentionItem } from '../../../types/attention'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const NOW = new Date('2026-02-15T12:00:00Z')

function makeEngineItem(overrides: Partial<DecisionItem> = {}): DecisionItem {
  return {
    id: 'a1-proposal-test',
    surface: 'action',
    severity: 'orange',
    category: 'process',
    title: 'Review proposal for AAPL',
    description: 'Proposal waiting 5 days',
    chips: [{ label: 'Portfolio', value: 'Growth' }, { label: 'Ticker', value: 'AAPL' }],
    context: {
      assetId: 'asset-1',
      assetTicker: 'AAPL',
      portfolioId: 'port-1',
      portfolioName: 'Growth',
      tradeIdeaId: 'idea-1',
    },
    ctas: [{ label: 'Review', actionKey: 'OPEN_TRADE_QUEUE_PROPOSAL', kind: 'primary' }],
    sortScore: 40000,
    createdAt: '2026-02-10T12:00:00Z',
    ...overrides,
  }
}

const navigate = vi.fn()
const onSnooze = vi.fn()

// ---------------------------------------------------------------------------
// Band assignment from engine items
// ---------------------------------------------------------------------------

describe('Band assignment from engine items', () => {
  it('proposal → NOW', () => {
    const item = mapDecisionItem(makeEngineItem({ id: 'a1-proposal-x' }), navigate, onSnooze, NOW)
    expect(item.band).toBe('NOW')
  })

  it('execution not confirmed → NOW', () => {
    const item = mapDecisionItem(
      makeEngineItem({ id: 'a2-execution-x', severity: 'red' }),
      navigate, onSnooze, NOW,
    )
    expect(item.band).toBe('NOW')
  })

  it('overdue deliverable (red severity) → NOW', () => {
    const item = mapDecisionItem(
      makeEngineItem({ id: 'a4-deliverable-x', severity: 'red', category: 'project' }),
      navigate, onSnooze, NOW,
    )
    expect(item.band).toBe('NOW')
  })

  it('idea not simulated → SOON', () => {
    const item = mapDecisionItem(
      makeEngineItem({ id: 'a3-unsimulated-x', severity: 'orange' }),
      navigate, onSnooze, NOW,
    )
    expect(item.band).toBe('SOON')
  })

  it('thesis stale → SOON', () => {
    const item = mapDecisionItem(
      makeEngineItem({ id: 'thesis-stale-x', severity: 'orange', category: 'risk' }),
      navigate, onSnooze, NOW,
    )
    expect(item.band).toBe('SOON')
  })

  it('rating change → SOON', () => {
    const item = mapDecisionItem(
      makeEngineItem({ id: 'i1-rating-x', severity: 'blue', surface: 'action', category: 'risk' }),
      navigate, onSnooze, NOW,
    )
    expect(item.band).toBe('SOON')
  })

  it('intel item → AWARE', () => {
    const item = mapDecisionItem(
      makeEngineItem({ id: 'i3-ev-x', surface: 'intel', severity: 'blue', category: 'alpha' }),
      navigate, onSnooze, NOW,
    )
    expect(item.band).toBe('AWARE')
  })
})

// ---------------------------------------------------------------------------
// Severity assignment
// ---------------------------------------------------------------------------

describe('Severity assignment', () => {
  it(`proposal > ${DECISION_HIGH_DAYS}d → HIGH`, () => {
    const old = new Date(NOW.getTime() - (DECISION_HIGH_DAYS + 1) * 86400000).toISOString()
    const item = mapDecisionItem(
      makeEngineItem({ id: 'a1-proposal-x', createdAt: old }),
      navigate, onSnooze, NOW,
    )
    expect(item.severity).toBe('HIGH')
  })

  it(`proposal ${DECISION_MED_DAYS}–${DECISION_HIGH_DAYS}d → MED`, () => {
    const mid = new Date(NOW.getTime() - (DECISION_MED_DAYS + 1) * 86400000).toISOString()
    const item = mapDecisionItem(
      makeEngineItem({ id: 'a1-proposal-x', createdAt: mid }),
      navigate, onSnooze, NOW,
    )
    expect(item.severity).toBe('MED')
  })

  it('proposal < 3d → LOW', () => {
    const recent = new Date(NOW.getTime() - 1 * 86400000).toISOString()
    const item = mapDecisionItem(
      makeEngineItem({ id: 'a1-proposal-x', createdAt: recent }),
      navigate, onSnooze, NOW,
    )
    expect(item.severity).toBe('LOW')
  })

  it('overdue deliverable → HIGH', () => {
    const item = mapDecisionItem(
      makeEngineItem({ id: 'a4-deliverable-x', severity: 'red', category: 'project' }),
      navigate, onSnooze, NOW,
    )
    expect(item.severity).toBe('HIGH')
  })

  it(`thesis stale > ${THESIS_HIGH_DAYS}d → HIGH`, () => {
    const old = new Date(NOW.getTime() - (THESIS_HIGH_DAYS + 1) * 86400000).toISOString()
    const item = mapDecisionItem(
      makeEngineItem({ id: 'thesis-stale-x', category: 'risk', createdAt: old }),
      navigate, onSnooze, NOW,
    )
    expect(item.severity).toBe('HIGH')
  })

  it(`thesis stale ${THESIS_MED_DAYS}–${THESIS_HIGH_DAYS}d → MED`, () => {
    const mid = new Date(NOW.getTime() - (THESIS_MED_DAYS + 5) * 86400000).toISOString()
    const item = mapDecisionItem(
      makeEngineItem({ id: 'thesis-stale-x', category: 'risk', createdAt: mid }),
      navigate, onSnooze, NOW,
    )
    expect(item.severity).toBe('MED')
  })

  it(`idea not simulated > ${SIMULATION_MED_DAYS}d → MED`, () => {
    const old = new Date(NOW.getTime() - (SIMULATION_MED_DAYS + 1) * 86400000).toISOString()
    const item = mapDecisionItem(
      makeEngineItem({ id: 'a3-unsimulated-x', createdAt: old }),
      navigate, onSnooze, NOW,
    )
    expect(item.severity).toBe('MED')
  })
})

// ---------------------------------------------------------------------------
// Type inference
// ---------------------------------------------------------------------------

describe('Type inference', () => {
  it('a1-proposal → DECISION', () => {
    const item = mapDecisionItem(makeEngineItem({ id: 'a1-proposal-x' }), navigate, onSnooze, NOW)
    expect(item.type).toBe('DECISION')
  })

  it('a3-unsimulated → SIMULATION', () => {
    const item = mapDecisionItem(makeEngineItem({ id: 'a3-unsimulated-x' }), navigate, onSnooze, NOW)
    expect(item.type).toBe('SIMULATION')
  })

  it('thesis-stale → THESIS', () => {
    const item = mapDecisionItem(makeEngineItem({ id: 'thesis-stale-x' }), navigate, onSnooze, NOW)
    expect(item.type).toBe('THESIS')
  })

  it('i1-rating → RATING', () => {
    const item = mapDecisionItem(makeEngineItem({ id: 'i1-rating-x' }), navigate, onSnooze, NOW)
    expect(item.type).toBe('RATING')
  })

  it('i3-ev → SIGNAL', () => {
    const item = mapDecisionItem(makeEngineItem({ id: 'i3-ev-x' }), navigate, onSnooze, NOW)
    expect(item.type).toBe('SIGNAL')
  })

  it('a4-deliverable → PROJECT', () => {
    const item = mapDecisionItem(makeEngineItem({ id: 'a4-deliverable-x' }), navigate, onSnooze, NOW)
    expect(item.type).toBe('PROJECT')
  })
})

// ---------------------------------------------------------------------------
// Primary action labels
// ---------------------------------------------------------------------------

describe('Primary action labels', () => {
  it('proposal → Review', () => {
    const item = mapDecisionItem(makeEngineItem({ id: 'a1-proposal-x' }), navigate, onSnooze, NOW)
    expect(item.primaryAction.label).toBe('Review')
  })

  it('execution → Confirm', () => {
    const item = mapDecisionItem(makeEngineItem({ id: 'a2-execution-x' }), navigate, onSnooze, NOW)
    expect(item.primaryAction.label).toBe('Confirm')
  })

  it('simulation → Simulate', () => {
    const item = mapDecisionItem(makeEngineItem({ id: 'a3-unsimulated-x' }), navigate, onSnooze, NOW)
    expect(item.primaryAction.label).toBe('Simulate')
  })

  it('thesis → Update', () => {
    const item = mapDecisionItem(makeEngineItem({ id: 'thesis-stale-x' }), navigate, onSnooze, NOW)
    expect(item.primaryAction.label).toBe('Update')
  })

  it('rating → Create Idea', () => {
    const item = mapDecisionItem(makeEngineItem({ id: 'i1-rating-x' }), navigate, onSnooze, NOW)
    expect(item.primaryAction.label).toBe('Create Idea')
  })

  it('signal → View', () => {
    const item = mapDecisionItem(makeEngineItem({ id: 'i3-ev-x', surface: 'intel' }), navigate, onSnooze, NOW)
    expect(item.primaryAction.label).toBe('View')
  })
})

// ---------------------------------------------------------------------------
// splitByBand
// ---------------------------------------------------------------------------

describe('splitByBand', () => {
  it('splits items into correct bands', () => {
    const items = [
      mapDecisionItem(makeEngineItem({ id: 'a1-proposal-a' }), navigate, onSnooze, NOW),
      mapDecisionItem(makeEngineItem({ id: 'a3-unsimulated-b' }), navigate, onSnooze, NOW),
      mapDecisionItem(makeEngineItem({ id: 'i3-ev-c', surface: 'intel' }), navigate, onSnooze, NOW),
    ]
    const { now, soon, aware } = splitByBand(items)
    expect(now).toHaveLength(1)
    expect(soon).toHaveLength(1)
    expect(aware).toHaveLength(1)
  })

  it('sorts NOW by severity desc then age desc', () => {
    // Use a4-deliverable with red severity for HIGH, and a1-proposal with recent date for LOW
    const high = mapDecisionItem(
      makeEngineItem({ id: 'a4-deliverable-h', severity: 'red', category: 'project', createdAt: '2026-02-14T00:00:00Z' }),
      navigate, onSnooze, NOW,
    )
    const low = mapDecisionItem(
      makeEngineItem({ id: 'a1-proposal-l', severity: 'red', createdAt: '2026-02-14T00:00:00Z' }),
      navigate, onSnooze, NOW,
    )
    // deliverable-h → HIGH (red deliverable), proposal-l → LOW (1d old)
    expect(high.severity).toBe('HIGH')
    expect(low.severity).toBe('LOW')
    const { now } = splitByBand([low, high])
    expect(now[0].id).toBe('a4-deliverable-h')
  })
})

// ---------------------------------------------------------------------------
// computeTodaySummary
// ---------------------------------------------------------------------------

describe('computeTodaySummary', () => {
  it('counts per band', () => {
    const summary = computeTodaySummary({
      now: [
        mapDecisionItem(makeEngineItem({ id: 'a1-proposal-1' }), navigate, onSnooze, NOW),
        mapDecisionItem(makeEngineItem({ id: 'a1-proposal-2' }), navigate, onSnooze, NOW),
      ],
      soon: [
        mapDecisionItem(makeEngineItem({ id: 'a3-unsimulated-1' }), navigate, onSnooze, NOW),
      ],
      aware: [],
    })
    expect(summary).toEqual({ decisions: 2, workItems: 1, riskSignals: 0 })
  })
})

// ---------------------------------------------------------------------------
// computeBandSummary
// ---------------------------------------------------------------------------

describe('computeBandSummary', () => {
  it('returns count and oldest age', () => {
    const items = [
      mapDecisionItem(makeEngineItem({ id: 'a1-proposal-1', createdAt: '2026-02-10T00:00:00Z' }), navigate, onSnooze, NOW),
      mapDecisionItem(makeEngineItem({ id: 'a1-proposal-2', createdAt: '2026-02-01T00:00:00Z' }), navigate, onSnooze, NOW),
    ]
    const summary = computeBandSummary('NOW', items)
    expect(summary.count).toBe(2)
    expect(summary.oldestAgeDays).toBe(14)
  })

  it('generates breakdown chips', () => {
    const items = [
      mapDecisionItem(makeEngineItem({ id: 'a1-proposal-1' }), navigate, onSnooze, NOW),
      mapDecisionItem(makeEngineItem({ id: 'a3-unsimulated-1' }), navigate, onSnooze, NOW),
    ]
    const summary = computeBandSummary('NOW', items)
    expect(summary.breakdownChips.length).toBeGreaterThan(0)
  })

  it('returns empty for no items', () => {
    const summary = computeBandSummary('NOW', [])
    expect(summary.count).toBe(0)
    expect(summary.oldestAgeDays).toBe(0)
    expect(summary.breakdownChips).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// groupItems
// ---------------------------------------------------------------------------

describe('groupItems', () => {
  it('none → single group', () => {
    const items = [
      mapDecisionItem(makeEngineItem({ id: 'a1-proposal-1' }), navigate, onSnooze, NOW),
    ]
    const groups = groupItems(items, 'none')
    expect(groups).toHaveLength(1)
    expect(groups[0].items).toHaveLength(1)
  })

  it('portfolio → groups by portfolio', () => {
    const items = [
      mapDecisionItem(makeEngineItem({
        id: 'a1-proposal-1',
        context: { portfolioId: 'p1', portfolioName: 'Growth', assetId: 'a1', assetTicker: 'AAPL' },
      }), navigate, onSnooze, NOW),
      mapDecisionItem(makeEngineItem({
        id: 'a1-proposal-2',
        context: { portfolioId: 'p2', portfolioName: 'Value', assetId: 'a2', assetTicker: 'MSFT' },
      }), navigate, onSnooze, NOW),
    ]
    const groups = groupItems(items, 'portfolio')
    expect(groups).toHaveLength(2)
  })

  it('type → groups by item type', () => {
    const items = [
      mapDecisionItem(makeEngineItem({ id: 'a1-proposal-1' }), navigate, onSnooze, NOW),
      mapDecisionItem(makeEngineItem({ id: 'a3-unsimulated-1' }), navigate, onSnooze, NOW),
    ]
    const groups = groupItems(items, 'type')
    expect(groups).toHaveLength(2)
  })
})

// ---------------------------------------------------------------------------
// filterUrgent
// ---------------------------------------------------------------------------

describe('filterUrgent', () => {
  it('keeps NOW items', () => {
    const items = [
      mapDecisionItem(makeEngineItem({ id: 'a1-proposal-1' }), navigate, onSnooze, NOW),
    ]
    expect(filterUrgent(items)).toHaveLength(1)
  })

  it('keeps HIGH-severity SOON items', () => {
    // A deliverable with orange severity → SOON band, but need HIGH severity
    // Force HIGH by making it old enough
    const old = new Date(NOW.getTime() - 200 * 86400000).toISOString()
    const item = mapDecisionItem(
      makeEngineItem({ id: 'thesis-stale-x', category: 'risk', createdAt: old }),
      navigate, onSnooze, NOW,
    )
    // thesis-stale goes to SOON, and > 180d → HIGH
    expect(item.band).toBe('SOON')
    expect(item.severity).toBe('HIGH')
    expect(filterUrgent([item])).toHaveLength(1)
  })

  it('drops AWARE items', () => {
    const item = mapDecisionItem(
      makeEngineItem({ id: 'i3-ev-x', surface: 'intel' }),
      navigate, onSnooze, NOW,
    )
    expect(filterUrgent([item])).toHaveLength(0)
  })

  it('drops LOW/MED SOON items', () => {
    const item = mapDecisionItem(
      makeEngineItem({ id: 'a3-unsimulated-x', createdAt: NOW.toISOString() }),
      navigate, onSnooze, NOW,
    )
    expect(item.band).toBe('SOON')
    expect(item.severity).toBe('LOW')
    expect(filterUrgent([item])).toHaveLength(0)
  })
})
