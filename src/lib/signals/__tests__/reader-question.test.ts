import { describe, it, expect } from 'vitest'
import { composeFeed } from '../feed-compose'
import { rankFeed, type PriorityInput } from '../feed-priority'
import { readerQuestionFor } from '../reader-question'
import { categoryForType } from '../content-registry'
import type { SignalType, Severity } from '../contract'

/**
 * The reported repetition, and the rule that breaks it.
 *
 * Target Reached, Target Expired and No Price Target are three cards, two
 * categories and one question. Every earlier diversity rule read the third as
 * variety and let the run through.
 */

const NOW = Date.UTC(2026, 8, 1)

interface Card { id: string; type: SignalType; symbol: string; severity: Severity }

const card = (id: string, type: SignalType, symbol = 'AAA', severity: Severity = 'attention'): Card =>
  ({ id, type, symbol, severity })

const toInput = (c: Card): PriorityInput => ({
  id: c.id, type: c.type, severity: c.severity,
  occurredAt: NOW - 3600_000, weightPct: 5, held: true,
})

const compose = (pool: Card[]) => {
  const ranked = rankFeed<Card>(pool, toInput, NOW)
  return composeFeed(ranked, {
    familyOf: (c: Card) => c.type,
    subjectOf: (c: Card) => c.symbol,
    categoryOf: (c: Card) => categoryForType(c.type),
    questionOf: (c: Card) => readerQuestionFor(c.type),
    scope: 'mixed',
  }).order.map(r => r.item as Card)
}

const questions = (cards: Card[]) => cards.map(c => readerQuestionFor(c.type))

const longestRun = <T,>(xs: T[]): number => {
  let run = 1, worst = 1
  for (let i = 1; i < xs.length; i++) {
    if (xs[i] === xs[i - 1]) { run++; worst = Math.max(worst, run) } else run = 1
  }
  return xs.length ? worst : 0
}

describe('the question is not the category', () => {
  it('groups the three target cards the reader complained about', () => {
    /**
     * Two categories, one question. This is the whole reason the axis exists
     * and the reason a category-keyed rule could not do the job.
     */
    expect(readerQuestionFor('target_hit')).toBe('target')
    expect(readerQuestionFor('target_expired')).toBe('target')
    expect(readerQuestionFor('no_target')).toBe('target')

    expect(categoryForType('target_hit')).toBe('decisions')
    expect(categoryForType('no_target')).toBe('portfolio')
  })

  it('separates a filing category from an ask', () => {
    // A recommendation files under decisions and asks a workflow question.
    expect(categoryForType('recommendation')).toBe('decisions')
    expect(readerQuestionFor('recommendation')).toBe('workflow')
  })

  it('collapses the five research framings into what they ask', () => {
    // `familyOf` splits these; the reader does not.
    expect(readerQuestionFor('research_stale')).toBe('research')
    expect(readerQuestionFor('thesis_conflict')).toBe('research')
    // A missing thesis is a different ask from a stale one.
    expect(readerQuestionFor('no_research')).toBe('thesis')
  })
})

describe('a comparable alternative breaks the run', () => {
  it('breaks a target cluster with a non-target card', () => {
    const out = compose([
      card('t1', 'target_hit', 'AAA'),
      card('t2', 'target_expired', 'BBB'),
      card('t3', 'no_target', 'CCC'),
      card('x1', 'crowding', 'DDD'),
    ])
    expect(longestRun(questions(out)), questions(out).join(' > ')).toBeLessThanOrEqual(2)
  })

  it('breaks a research-chore cluster the same way', () => {
    const out = compose([
      card('r1', 'research_stale', 'AAA'),
      card('r2', 'thesis_conflict', 'BBB'),
      card('r3', 'team_focus', 'CCC'),
      card('x1', 'active_risk', 'DDD'),
    ])
    expect(longestRun(questions(out)), questions(out).join(' > ')).toBeLessThanOrEqual(2)
  })

  it('keeps the run when nothing comparable exists', () => {
    /**
     * The conditional half, and the one that protects relevance. Diversity is
     * a preference among comparably important cards, never a reason to hold a
     * finding back — nothing is dropped and nothing is demoted past the
     * substitution tolerance.
     */
    const pool = [
      card('t1', 'target_hit', 'AAA'),
      card('t2', 'target_expired', 'BBB'),
      card('t3', 'no_target', 'CCC'),
    ]
    const out = compose(pool)
    expect(out).toHaveLength(3)
    expect(questions(out)).toEqual(['target', 'target', 'target'])
  })
})

describe('the composition contract still holds', () => {
  const pool = [
    card('a', 'scenario_gap', 'AAA', 'critical'),
    card('b', 'target_hit', 'BBB'),
    card('c', 'target_expired', 'CCC'),
    card('d', 'no_target', 'DDD'),
    card('e', 'research_stale', 'EEE'),
    card('f', 'news', 'FFF', 'informational'),
    card('g', 'crowding', 'GGG'),
  ]

  it('drops nothing', () => {
    expect(compose(pool)).toHaveLength(pool.length)
  })

  it('leaves the most important card first', () => {
    const ranked = rankFeed<Card>(pool, toInput, NOW)
    expect(compose(pool)[0].id).toBe((ranked[0].item as Card).id)
  })

  it('is deterministic — same inputs, same order', () => {
    // No jitter, no personalisation, no clock read beyond the fixed `NOW`.
    expect(compose(pool).map(c => c.id)).toEqual(compose(pool).map(c => c.id))
  })
})
