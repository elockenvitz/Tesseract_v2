/**
 * The desktop attention feed's SEQUENCING, as distinct from its ranking.
 *
 * The reported defect was five case-versus-price findings in a row at the top
 * of the feed. Every one of them individually earned its place — ranking was
 * correct and is not what these pin. What was missing was a second pass asking
 * "what should come next", and `composeFeed` is that pass.
 *
 * These fixtures are built against `composeFeed` directly with the same
 * accessors `useDesktopAttentionFeed` passes it, so they exercise the rule the
 * feed actually runs rather than a paraphrase of it.
 */

import { describe, it, expect } from 'vitest'
import { composeFeed } from '../feed-compose'
import type { RankedItem } from '../feed-priority'

interface Fixture { id: string; family: string; subject: string | null; total: number; tier: number }

/** A ranked row shaped as `composeFeed` reads it. */
const row = (f: Fixture): RankedItem<Fixture> => ({
  item: f,
  input: { id: f.id, type: f.family as never, severity: 'attention' as never },
  priority: {
    tier: f.tier as never,
    total: f.total,
    suppressed: false,
    components: {} as never,
  } as never,
})

/*
 * `composeFeed` requires a pool already sorted by tier then score — line 1141
 * of feed-compose depends on the band being a prefix. `rankFeed` guarantees
 * that in the real pipeline, so the fixtures sort the same way rather than
 * handing the composer an input it does not accept.
 */
const compose = (fs: Fixture[]) =>
  composeFeed([...fs].sort((a, b) => a.tier - b.tier || b.total - a.total).map(row), {
    familyOf: r => r.family,
    subjectOf: r => r.subject,
    categoryOf: r => r.family,
  }).order.map(r => r.item.id)

const families = (fs: Fixture[], ids: string[]) =>
  ids.map(id => fs.find(f => f.id === id)!.family)

describe('desktop attention sequencing', () => {
  /** The reported shape: one family, five strong candidates, nothing else close. */
  it('breaks up a run when comparable alternatives exist', () => {
    const fs: Fixture[] = [
      { id: 'g1', family: 'scenario_gap', subject: 'AAA', total: 0.90, tier: 1 },
      { id: 'g2', family: 'scenario_gap', subject: 'BBB', total: 0.89, tier: 1 },
      { id: 'g3', family: 'scenario_gap', subject: 'CCC', total: 0.88, tier: 1 },
      { id: 'g4', family: 'scenario_gap', subject: 'DDD', total: 0.87, tier: 1 },
      { id: 'g5', family: 'scenario_gap', subject: 'EEE', total: 0.86, tier: 1 },
      { id: 't1', family: 'target_expired', subject: 'FFF', total: 0.885, tier: 1 },
      { id: 't2', family: 'target_hit', subject: 'GGG', total: 0.875, tier: 1 },
      { id: 'i1', family: 'trade_idea', subject: 'HHH', total: 0.865, tier: 1 },
    ]
    const order = compose(fs)
    const fam = families(fs, order)

    // The longest run of one family must be shorter than the five it would
    // have been without a sequencing pass.
    let longest = 1, run = 1
    for (let i = 1; i < fam.length; i++) {
      run = fam[i] === fam[i - 1] ? run + 1 : 1
      if (run > longest) longest = run
    }
    expect(longest).toBeLessThan(5)
  })

  /**
   * The counterweight. A dominant candidate must not be postponed for variety
   * — burying urgent information is worse than repeating a family.
   */
  it('does not bury a materially more urgent candidate', () => {
    const fs: Fixture[] = [
      { id: 'urgent', family: 'scenario_gap', subject: 'AAA', total: 0.99, tier: 0 },
      { id: 'also', family: 'scenario_gap', subject: 'BBB', total: 0.40, tier: 2 },
      { id: 'other', family: 'thought', subject: 'CCC', total: 0.39, tier: 2 },
    ]
    expect(compose(fs)[0]).toBe('urgent')
  })

  /**
   * The bound is the SCORE, not the tier — and that is deliberate.
   *
   * `feed-compose` says so in its own words: a news card at 0.30 loses to a
   * framework break at 1.00 "because it is WORSE, not because a partition
   * forbade it", and a hard tier partition "forbade every harmless swap across
   * the line, which is most of the variety a mixed feed has available".
   *
   * So a low-tier card with a comparable score may break a run, and a card far
   * below the head may not — whatever its tier. This pins the second half,
   * which is the half that protects the reader.
   */
  it('will not promote a materially weaker candidate to break a run', () => {
    const fs: Fixture[] = [
      { id: 'a', family: 'scenario_gap', subject: 'AAA', total: 0.95, tier: 0 },
      { id: 'b', family: 'scenario_gap', subject: 'BBB', total: 0.94, tier: 0 },
      { id: 'weak', family: 'thought', subject: 'CCC', total: 0.10, tier: 3 },
    ]
    const order = compose(fs)
    // The run of two survives, because the only alternative is far worse.
    expect(order).toEqual(['a', 'b', 'weak'])
  })

  /** Several findings about one name should gain spacing where priority allows. */
  it('spaces repeated subjects when alternatives exist', () => {
    const fs: Fixture[] = [
      { id: 's1', family: 'scenario_gap', subject: 'AAA', total: 0.90, tier: 1 },
      { id: 's2', family: 'target_hit', subject: 'AAA', total: 0.89, tier: 1 },
      { id: 's3', family: 'conviction_oversized', subject: 'AAA', total: 0.88, tier: 1 },
      { id: 'o1', family: 'trade_idea', subject: 'ZZZ', total: 0.885, tier: 1 },
      { id: 'o2', family: 'thought', subject: 'YYY', total: 0.875, tier: 1 },
    ]
    const order = compose(fs)
    const subjects = order.map(id => fs.find(f => f.id === id)!.subject)
    let longest = 1, run = 1
    for (let i = 1; i < subjects.length; i++) {
      run = subjects[i] === subjects[i - 1] ? run + 1 : 1
      if (run > longest) longest = run
    }
    expect(longest).toBeLessThan(3)
  })

  /** Same input, same output. No cosmetic randomness on re-render. */
  it('is deterministic', () => {
    const fs: Fixture[] = [
      { id: 'a', family: 'scenario_gap', subject: 'AAA', total: 0.9, tier: 1 },
      { id: 'b', family: 'target_hit', subject: 'BBB', total: 0.89, tier: 1 },
      { id: 'c', family: 'scenario_gap', subject: 'CCC', total: 0.88, tier: 1 },
      { id: 'd', family: 'thought', subject: 'DDD', total: 0.87, tier: 1 },
    ]
    const first = compose(fs)
    for (let i = 0; i < 5; i++) expect(compose(fs)).toEqual(first)
  })

  /** A lens or Curate filter can leave one family. It must still render. */
  it('returns every candidate when only one family remains', () => {
    const fs: Fixture[] = [
      { id: 'a', family: 'scenario_gap', subject: 'AAA', total: 0.9, tier: 1 },
      { id: 'b', family: 'scenario_gap', subject: 'BBB', total: 0.8, tier: 1 },
      { id: 'c', family: 'scenario_gap', subject: 'CCC', total: 0.7, tier: 1 },
    ]
    expect(compose(fs).sort()).toEqual(['a', 'b', 'c'])
  })

  it('drops nothing', () => {
    const fs: Fixture[] = Array.from({ length: 12 }, (_, i) => ({
      id: `x${i}`,
      family: i % 3 === 0 ? 'scenario_gap' : i % 3 === 1 ? 'target_hit' : 'thought',
      subject: `S${i % 4}`,
      total: 0.9 - i * 0.01,
      tier: 1,
    }))
    expect(compose(fs).length).toBe(12)
  })
})
