/**
 * The primitive the resolver chose is the primitive that renders.
 *
 * ── Why this is a render and not a source assertion ───────────────────────
 *
 * The whole defect this seam closes was a plan that was right and unread. A
 * test that only checks `plan.visuals[0].primitive` would have passed
 * throughout that period — the plan was always correct. The claim worth pinning
 * is the one that was false: that what the resolver decided is what the reader
 * sees.
 *
 * `ExploreVisualBlock` stamps `data-explore-visual` with the kind it drew, so
 * the assertion is a direct comparison between the two ends of the pipeline
 * rather than a proxy for it.
 */

import { describe, expect, it } from 'vitest'
import { render } from '@testing-library/react'

import { ExploreVisualBlock } from '../ExploreVisual'
import {
  adoptCoverageGap, adoptResearchInsight, adoptScenarioGap, adoptTargetHit,
  adoptWorkOverdue, type MobileAdoptionResult,
} from '../../../lib/tile-engine/adopt/mobile'
import { buildAttentionCard } from '../../../lib/signals/builders/legacy-kinds'
import {
  COVERAGE_ASSET, COVERAGE_NOW, PHONE, coverageCard, coverageRow, dislocationCard,
  staleCard, staleInsight, targetBreachRow, targetHitCard,
} from '../../../lib/tile-engine/adopt/__tests__/fixtures'

const READER = { readerId: 'u-analyst', coverage: 'direct' as const }
const NOW = Date.parse('2026-09-08T00:00:00.000Z')

const overdueRow = {
  attention_id: 'att-overdue-1',
  attention_type: 'action_required' as const,
  reason_code: 'task_overdue',
  reason_text: 'Model refresh is past its date',
  title: 'Q3 model refresh',
  tags: ['overdue'],
  created_at: '2026-08-01T00:00:00.000Z',
  last_activity_at: '2026-08-20T00:00:00.000Z',
  due_at: '2026-08-25T00:00:00.000Z',
  severity: 'high',
  context: { asset_id: 'a-amzn' },
}

function overdueCard() {
  const r = buildAttentionCard(overdueRow as never, COVERAGE_ASSET)
  if (!r.ok) throw new Error('fixture suppressed')
  return r.card
}

const adopted = (r: MobileAdoptionResult) => {
  if (!r.ok) throw new Error(`declined: ${r.reason} — ${r.detail}`)
  return r.adoption
}

/** Every situation adopted so far, with the picture its plan resolved. */
const CASES: { name: string; adoption: () => ReturnType<typeof adopted> }[] = [
  {
    name: 'Case vs Price',
    adoption: () => adopted(adoptScenarioGap(dislocationCard(), null, READER, PHONE)),
  },
  {
    name: 'Coverage Gap',
    adoption: () => adopted(
      adoptCoverageGap(coverageRow() as never, coverageCard(), READER, PHONE, COVERAGE_NOW)),
  },
  {
    name: 'Overdue',
    adoption: () => adopted(
      adoptWorkOverdue(overdueRow as never, overdueCard(), READER, PHONE, NOW)),
  },
  {
    name: 'Unreviewed Move',
    adoption: () => adopted(
      adoptResearchInsight(staleInsight('price_move'), staleCard('price_move'), READER, PHONE)),
  },
  {
    name: 'Target Hit',
    adoption: () => adopted(adoptTargetHit(targetBreachRow(), targetHitCard(), READER, PHONE)),
  },
]

describe('what the resolver chose is what the card draws', () => {
  it.each(CASES)('$name', ({ adoption }) => {
    const { plan, visual } = adoption()
    const lead = plan.visuals.find(v => v.role === 'lead')
    expect(lead, 'the plan resolved no lead visual').toBeTruthy()
    expect(visual, 'the plan resolved a lead visual and the mapper produced none').toBeTruthy()

    const { container } = render(<ExploreVisualBlock visual={visual!} now={NOW} />)
    const drawn = container.querySelector('[data-explore-visual]')
    expect(drawn, 'nothing rendered').toBeTruthy()
    expect(drawn!.getAttribute('data-explore-visual')).toBe(lead!.primitive)
  })

  /**
   * Five situations, four primitives, no per-situation component.
   *
   * The one that repeats is the temporal strip, which serves coverage neglect
   * and overdue work — different producers, different questions, different
   * subjects, one picture that decides its own shape from whether a deadline
   * exists.
   */
  it('reuses the vocabulary rather than growing it', () => {
    const kinds = CASES.map(c => c.adoption().visual!.kind)
    expect(new Set(kinds).size).toBeLessThan(kinds.length)
    expect([...new Set(kinds)].sort())
      .toEqual(['last_look', 'scenario_range', 'target_compare', 'timeline'])
  })
})

describe('the two shapes of the temporal strip', () => {
  /**
   * A deadline that was missed draws two segments; an elapsed silence draws
   * one. The difference is in the data, and this is the assertion that it
   * reaches the DOM rather than only the type.
   */
  it('draws the overrun for work that missed its date', () => {
    const { visual } = adopted(
      adoptWorkOverdue(overdueRow as never, overdueCard(), READER, PHONE, NOW))
    const { container } = render(<ExploreVisualBlock visual={visual!} now={NOW} />)
    expect(container.querySelector('[data-timeline-overdue]')).toBeTruthy()
    expect(container.querySelector('[data-timeline-elapsed]')).toBeNull()
  })

  it('draws one stretch for a silence nobody set a date for', () => {
    const { visual } = adopted(
      adoptCoverageGap(coverageRow() as never, coverageCard(), READER, PHONE, COVERAGE_NOW))
    const { container } = render(<ExploreVisualBlock visual={visual!} now={COVERAGE_NOW} />)
    expect(container.querySelector('[data-timeline-elapsed]')).toBeTruthy()
    expect(container.querySelector('[data-timeline-overdue]')).toBeNull()
  })
})

describe('the tile stays within its width', () => {
  /**
   * Nothing in this vocabulary may lay out wider than the phone.
   *
   * Every one of these renders inside a 390px card that already carries a
   * headline, a metric, a body and an action tray. A visual that declares a
   * fixed width would push the card into horizontal overflow — the failure the
   * geometry module exists to prevent — so none of them may.
   */
  it.each(CASES)('$name declares no fixed width', ({ adoption }) => {
    const { visual } = adoption()
    const { container } = render(<ExploreVisualBlock visual={visual!} now={NOW} />)
    const html = container.innerHTML
    expect(html).not.toMatch(/width:\s*\d+px/)
    expect(html).not.toMatch(/min-width:\s*\d+px/)
  })
})
