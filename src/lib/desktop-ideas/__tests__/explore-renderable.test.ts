/**
 * The invariant: Explore never spends a grid cell on nothing.
 *
 * The first test is the reported defect, reproduced from the shape that caused
 * it — a scenario `CardResult` wrapper handed to an adapter that expects the
 * card. Every field the tile draws comes back undefined, and what renders is a
 * bordered rectangle containing the word DECISIONS.
 */

import { describe, it, expect } from 'vitest'
import { exploreRenderability, renderableExploreItems } from '../explore-renderable'
import { scenarioCardsToExplore } from '../../mobile/explore-adapters'
import type { ExploreItem } from '../../mobile/explore-item'

const item = (over: Partial<ExploreItem>): ExploreItem => ({
  id: 'x', dedupeKey: 'k', signalType: null, category: 'decisions', subtype: 'signal',
  title: '', destination: { kind: 'action', assetId: null } as never, ...over,
} as ExploreItem)

const card = {
  id: 'scenario_gap:a1', type: 'scenario_gap',
  headline: 'CEG is trading below every case you modelled',
  entity: { id: 'a1', ticker: 'CEG', name: 'Constellation' },
  metric: { value: '21%', label: 'Below your lowest case' },
  provenance: { occurredAt: '2026-03-01T00:00:00.000Z' },
}

describe('the blank tile, reproduced', () => {
  it('produces nothing drawable when the adapter is given the result wrapper', () => {
    // Exactly what `useScenarioCards` returns, and what desktop was passing on.
    const [i] = scenarioCardsToExplore([{ ok: true, card }] as never)
    expect(i.title).toBeUndefined()
    expect(i.symbol).toBeNull()
    expect(i.metric).toBeUndefined()
    // A cell with only its category word in it.
    expect(exploreRenderability(i).ok).toBe(false)
  })

  it('produces a full preview when given the card, as mobile passes it', () => {
    const [i] = scenarioCardsToExplore([card] as never)
    expect(i.title).toBe(card.headline)
    expect(i.symbol).toBe('CEG')
    expect(i.metric?.value).toBe('21%')
    expect(exploreRenderability(i).ok).toBe(true)
  })
})

describe('exploreRenderability', () => {
  it('accepts a claim', () => {
    expect(exploreRenderability(item({ title: 'AAPL passed its target' })).ok).toBe(true)
  })

  it('accepts a number when there is no claim', () => {
    expect(exploreRenderability(item({ metric: { value: '6.2%', label: 'of the book' } })).ok).toBe(true)
  })

  it('accepts a drawable object when there is neither', () => {
    expect(exploreRenderability(item({}), { hasVisual: true }).ok).toBe(true)
  })

  it('accepts a clause of context', () => {
    expect(exploreRenderability(item({ context: 'Target $118' })).ok).toBe(true)
  })

  /** The whole point: a category is not a payload. */
  it('rejects an item carrying only its category', () => {
    const r = exploreRenderability(item({ category: 'decisions' }))
    expect(r.ok).toBe(false)
    expect(r.why).toContain('no headline')
  })

  it('rejects whitespace as a claim', () => {
    expect(exploreRenderability(item({ title: '   ' })).ok).toBe(false)
  })

  /** An aggregate that cannot say what it contains is suppressed, not shelled. */
  it('rejects an aggregate with no proposition, and keeps one that has it', () => {
    expect(exploreRenderability(item({ subtype: 'aggregate', title: '' })).ok).toBe(false)
    expect(exploreRenderability(item({ subtype: 'aggregate', title: '4 new ideas this week' })).ok).toBe(true)
  })
})

describe('renderableExploreItems', () => {
  it('removes the unrenderable before anything is composed, and names them', () => {
    const { items, dropped } = renderableExploreItems(
      [
        item({ id: 'a', title: 'AAPL passed its target' }),
        item({ id: 'blank' }),
        item({ id: 'c', metric: { value: '3', label: 'portfolios' } }),
      ],
      () => false,
    )
    expect(items.map(i => i.id)).toEqual(['a', 'c'])
    expect(dropped).toHaveLength(1)
    expect(dropped[0]).toContain('blank')
  })

  it('asks for the visual once per item, and believes the answer', () => {
    const asked: string[] = []
    const { items } = renderableExploreItems(
      [item({ id: 'v' })],
      i => { asked.push(i.id); return true },
    )
    expect(asked).toEqual(['v'])
    expect(items).toHaveLength(1)
  })
})
