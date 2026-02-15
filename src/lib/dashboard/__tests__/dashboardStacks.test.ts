import { describe, it, expect, vi } from 'vitest'
import {
  getStackKind,
  determineBandForStack,
  computeAttentionScore,
  formatStackSubtitle,
  getStackCTA,
  buildCockpitViewModel,
} from '../dashboardStacks'
import type { DashboardItem } from '../../../types/dashboard-item'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeItem(overrides: Partial<DashboardItem> = {}): DashboardItem {
  return {
    id: 'a1-proposal-test',
    band: 'NOW',
    severity: 'HIGH',
    type: 'DECISION',
    title: 'Review proposal for AAPL',
    reason: 'Proposal waiting 5 days',
    ageDays: 5,
    createdAt: '2026-02-10T12:00:00Z',
    portfolio: { id: 'port-1', name: 'Growth' },
    asset: { id: 'asset-1', ticker: 'AAPL' },
    primaryAction: { label: 'Review', onClick: vi.fn() },
    ...overrides,
  }
}

const navigate = vi.fn()

// ---------------------------------------------------------------------------
// getStackKind
// ---------------------------------------------------------------------------

describe('getStackKind', () => {
  it('a1-proposal → proposal', () => {
    expect(getStackKind(makeItem({ id: 'a1-proposal-x' }))).toBe('proposal')
  })

  it('a2-execution → execution', () => {
    expect(getStackKind(makeItem({ id: 'a2-execution-x' }))).toBe('execution')
  })

  it('a3-unsimulated → simulation', () => {
    expect(getStackKind(makeItem({ id: 'a3-unsimulated-x', type: 'SIMULATION' }))).toBe('simulation')
  })

  it('a4-deliverable → deliverable', () => {
    expect(getStackKind(makeItem({ id: 'a4-deliverable-x', type: 'PROJECT' }))).toBe('deliverable')
  })

  it('thesis-stale → thesis', () => {
    expect(getStackKind(makeItem({ id: 'thesis-stale-x', type: 'THESIS' }))).toBe('thesis')
  })

  it('i1-rating → rating', () => {
    expect(getStackKind(makeItem({ id: 'i1-rating-x', type: 'RATING' }))).toBe('rating')
  })

  it('i3-ev → signal', () => {
    expect(getStackKind(makeItem({ id: 'i3-ev-x', type: 'SIGNAL' }))).toBe('signal')
  })

  it('attention DECISION → proposal (fallback)', () => {
    expect(getStackKind(makeItem({ id: 'attn-123', type: 'DECISION' }))).toBe('proposal')
  })

  it('unknown type → other', () => {
    expect(getStackKind(makeItem({ id: 'unknown-xyz', type: 'OTHER' }))).toBe('other')
  })
})

// ---------------------------------------------------------------------------
// determineBandForStack
// ---------------------------------------------------------------------------

describe('determineBandForStack', () => {
  it('proposal → DECIDE', () => {
    expect(determineBandForStack('proposal', [makeItem()])).toBe('DECIDE')
  })

  it('execution → DECIDE', () => {
    expect(determineBandForStack('execution', [makeItem()])).toBe('DECIDE')
  })

  it('simulation → ADVANCE', () => {
    expect(determineBandForStack('simulation', [makeItem()])).toBe('ADVANCE')
  })

  it('rating → AWARE', () => {
    expect(determineBandForStack('rating', [makeItem()])).toBe('AWARE')
  })

  it('deliverable all HIGH → promoted to DECIDE', () => {
    const items = [
      makeItem({ severity: 'HIGH' }),
      makeItem({ severity: 'HIGH' }),
    ]
    expect(determineBandForStack('deliverable', items)).toBe('DECIDE')
  })

  it('deliverable mixed severity → ADVANCE', () => {
    const items = [
      makeItem({ severity: 'HIGH' }),
      makeItem({ severity: 'MED' }),
    ]
    expect(determineBandForStack('deliverable', items)).toBe('ADVANCE')
  })
})

// ---------------------------------------------------------------------------
// computeAttentionScore
// ---------------------------------------------------------------------------

describe('computeAttentionScore', () => {
  it('DECIDE band gets +50 bonus', () => {
    const items = [makeItem({ ageDays: 0, severity: 'LOW', portfolio: undefined })]
    const score = computeAttentionScore(items, 'DECIDE')
    // 50 (band) + 0 (age) + 0 (portfolios) + 3 (1 item) + 0 (LOW) = 53
    expect(score).toBe(53)
  })

  it('age contributes 2 per day of oldest', () => {
    const items = [makeItem({ ageDays: 10, severity: 'LOW', portfolio: undefined })]
    const scoreDecide = computeAttentionScore(items, 'DECIDE')
    // 50 + 20 (age) + 0 + 3 + 0 = 73
    expect(scoreDecide).toBe(73)
  })

  it('portfolio spread contributes 10 per portfolio', () => {
    const items = [
      makeItem({ portfolio: { id: 'p1', name: 'A' }, ageDays: 0, severity: 'LOW' }),
      makeItem({ portfolio: { id: 'p2', name: 'B' }, ageDays: 0, severity: 'LOW' }),
    ]
    const score = computeAttentionScore(items, 'ADVANCE')
    // 0 (band) + 0 (age) + 20 (2 portfolios) + 6 (2 items) + 0 = 26
    expect(score).toBe(26)
  })

  it('HIGH severity adds 20 per item', () => {
    const items = [makeItem({ ageDays: 0, severity: 'HIGH', portfolio: undefined })]
    const score = computeAttentionScore(items, 'ADVANCE')
    // 0 + 0 + 0 + 3 + 20 = 23
    expect(score).toBe(23)
  })

  it('MED severity adds 5 per item', () => {
    const items = [makeItem({ ageDays: 0, severity: 'MED', portfolio: undefined })]
    const score = computeAttentionScore(items, 'AWARE')
    // 0 + 0 + 0 + 3 + 5 = 8
    expect(score).toBe(8)
  })
})

// ---------------------------------------------------------------------------
// formatStackSubtitle
// ---------------------------------------------------------------------------

describe('formatStackSubtitle', () => {
  it('full subtitle with age, portfolios, and band context', () => {
    const result = formatStackSubtitle(13, 3, 'DECIDE', 5)
    expect(result).toBe('Oldest 13d \u00B7 3 portfolios \u00B7 blocking decision')
  })

  it('no age omits age part', () => {
    const result = formatStackSubtitle(0, 1, 'ADVANCE', 2)
    expect(result).toBe('1 portfolio \u00B7 2 items pending')
  })

  it('singular portfolio', () => {
    const result = formatStackSubtitle(5, 1, 'AWARE', 3)
    expect(result).toBe('Oldest 5d \u00B7 1 portfolio \u00B7 3 signals')
  })
})

// ---------------------------------------------------------------------------
// getStackCTA
// ---------------------------------------------------------------------------

describe('getStackCTA', () => {
  it('single item delegates to item primaryAction', () => {
    const onClick = vi.fn()
    const items = [makeItem({ primaryAction: { label: 'Review', onClick } })]
    const cta = getStackCTA('proposal', items, navigate)
    expect(cta.label).toBe('Review')
    cta.onClick()
    expect(onClick).toHaveBeenCalled()
  })

  it('multi proposal → "Review All" → Trade Queue', () => {
    const items = [makeItem(), makeItem({ id: 'a1-proposal-y' })]
    const cta = getStackCTA('proposal', items, navigate)
    expect(cta.label).toBe('Review All')
    cta.onClick()
    expect(navigate).toHaveBeenCalledWith(expect.objectContaining({
      type: 'trade-queue',
    }))
  })

  it('multi simulation → "Open Trade Lab"', () => {
    const items = [
      makeItem({ id: 'a3-unsimulated-a' }),
      makeItem({ id: 'a3-unsimulated-b' }),
    ]
    const cta = getStackCTA('simulation', items, navigate)
    expect(cta.label).toBe('Open Trade Lab')
    cta.onClick()
    expect(navigate).toHaveBeenCalledWith(expect.objectContaining({
      type: 'trade-lab',
    }))
  })

  it('multi deliverable → "Open Projects"', () => {
    const items = [
      makeItem({ id: 'a4-deliverable-a' }),
      makeItem({ id: 'a4-deliverable-b' }),
    ]
    const cta = getStackCTA('deliverable', items, navigate)
    expect(cta.label).toBe('Open Projects')
    cta.onClick()
    expect(navigate).toHaveBeenCalledWith(expect.objectContaining({
      type: 'projects-list',
    }))
  })
})

// ---------------------------------------------------------------------------
// buildCockpitViewModel
// ---------------------------------------------------------------------------

describe('buildCockpitViewModel', () => {
  it('groups items into correct stacks', () => {
    const items = [
      makeItem({ id: 'a1-proposal-1' }),
      makeItem({ id: 'a1-proposal-2' }),
      makeItem({ id: 'a3-unsimulated-1', type: 'SIMULATION', band: 'SOON' }),
    ]
    const vm = buildCockpitViewModel(items, navigate)
    expect(vm.decide.stacks).toHaveLength(1)
    expect(vm.decide.stacks[0].kind).toBe('proposal')
    expect(vm.decide.stacks[0].count).toBe(2)
    expect(vm.advance.stacks).toHaveLength(1)
    expect(vm.advance.stacks[0].kind).toBe('simulation')
  })

  it('sorts stacks by attentionScore descending', () => {
    const items = [
      makeItem({ id: 'a1-proposal-1', ageDays: 1, severity: 'LOW' }),
      makeItem({ id: 'a2-execution-1', ageDays: 20, severity: 'HIGH' }),
    ]
    const vm = buildCockpitViewModel(items, navigate)
    // execution has higher age → higher score
    expect(vm.decide.stacks[0].kind).toBe('execution')
    expect(vm.decide.stacks[1].kind).toBe('proposal')
  })

  it('preview limited to 3 items', () => {
    const items = Array.from({ length: 5 }, (_, i) =>
      makeItem({ id: `a1-proposal-${i}` }),
    )
    const vm = buildCockpitViewModel(items, navigate)
    expect(vm.decide.stacks[0].itemsPreview).toHaveLength(3)
    expect(vm.decide.stacks[0].itemsAll).toHaveLength(5)
  })

  it('portfolio breakdown is correct', () => {
    const items = [
      makeItem({ id: 'a1-proposal-1', portfolio: { id: 'p1', name: 'Growth' } }),
      makeItem({ id: 'a1-proposal-2', portfolio: { id: 'p1', name: 'Growth' } }),
      makeItem({ id: 'a1-proposal-3', portfolio: { id: 'p2', name: 'Value' } }),
    ]
    const vm = buildCockpitViewModel(items, navigate)
    const bd = vm.decide.stacks[0].portfolioBreakdown
    expect(bd).toHaveLength(2)
    expect(bd[0]).toEqual({ id: 'p1', name: 'Growth', count: 2 })
    expect(bd[1]).toEqual({ id: 'p2', name: 'Value', count: 1 })
  })

  it('ticker breakdown is correct', () => {
    const items = [
      makeItem({ id: 'a1-proposal-1', asset: { id: 'a1', ticker: 'AAPL' } }),
      makeItem({ id: 'a1-proposal-2', asset: { id: 'a2', ticker: 'AAPL' } }),
      makeItem({ id: 'a1-proposal-3', asset: { id: 'a3', ticker: 'MSFT' } }),
    ]
    const vm = buildCockpitViewModel(items, navigate)
    const td = vm.decide.stacks[0].tickerBreakdown
    expect(td).toHaveLength(2)
    expect(td[0]).toEqual({ ticker: 'AAPL', count: 2 })
    expect(td[1]).toEqual({ ticker: 'MSFT', count: 1 })
  })

  it('summary counts are correct', () => {
    const items = [
      makeItem({ id: 'a1-proposal-1', ageDays: 13 }),
      makeItem({ id: 'a3-unsimulated-1', type: 'SIMULATION', band: 'SOON', ageDays: 5 }),
      makeItem({ id: 'i3-ev-1', type: 'SIGNAL', band: 'AWARE', ageDays: 2 }),
    ]
    const vm = buildCockpitViewModel(items, navigate)
    expect(vm.summary.decisions).toBe(1)
    expect(vm.summary.work).toBe(1)
    expect(vm.summary.signals).toBe(1)
    expect(vm.summary.oldestDays).toBe(13)
  })

  it('empty items produce empty bands', () => {
    const vm = buildCockpitViewModel([], navigate)
    expect(vm.decide.stacks).toHaveLength(0)
    expect(vm.advance.stacks).toHaveLength(0)
    expect(vm.aware.stacks).toHaveLength(0)
    expect(vm.summary.decisions).toBe(0)
    expect(vm.summary.oldestDays).toBe(0)
  })

  it('HIGH deliverables promote to DECIDE band', () => {
    const items = [
      makeItem({ id: 'a4-deliverable-1', type: 'PROJECT', severity: 'HIGH' }),
      makeItem({ id: 'a4-deliverable-2', type: 'PROJECT', severity: 'HIGH' }),
    ]
    const vm = buildCockpitViewModel(items, navigate)
    expect(vm.decide.stacks).toHaveLength(1)
    expect(vm.decide.stacks[0].kind).toBe('deliverable')
    expect(vm.advance.stacks).toHaveLength(0)
  })

  it('totalItems sums stack counts in each band', () => {
    const items = [
      makeItem({ id: 'a1-proposal-1' }),
      makeItem({ id: 'a1-proposal-2' }),
      makeItem({ id: 'a2-execution-1' }),
    ]
    const vm = buildCockpitViewModel(items, navigate)
    expect(vm.decide.totalItems).toBe(3)
  })
})
