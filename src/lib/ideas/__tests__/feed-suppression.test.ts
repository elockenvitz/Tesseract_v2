import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  dispositionSignature,
  eligibleFeedItems,
  judgmentRecordFor,
  judgmentRefFor,
  suppressionForFeedItem,
} from '../feed-suppression'
import {
  DISPOSITION_SCHEMA,
  dispositionKey,
  type Disposition,
  type DispositionMap,
} from '../../signals/dispositions'
import {
  CLASSIFIED_JUDGMENT_KEYS,
  acknowledgmentFor,
  judgmentApplies,
  policyForJudgment,
  suppressionFor,
  type JudgmentRecord,
} from '../../signals/judgment-policy'
import { ideaCardId, ideaCardType } from '../../signals/builders/ideas'
import { ideaSignalType } from '../../mobile/explore-adapters'
import { priorityFor, rankFeed, type PriorityInput } from '../../signals/feed-priority'
import { TRIAGE_JUDGMENT } from '../../signals/feed-triage'
import { DAY_MS } from '../../signals/thresholds'
import { compareScoredCandidates } from '../candidate-pools'
import { applyDiversityForTest, scoreFeedItemForTest } from '../../../hooks/ideas/useIdeasFeed'

const NOW = Date.UTC(2026, 7, 28)
const AAPL = '11111111-1111-4111-8111-111111111111'

interface Post { id: string; type: string; created_at: string; content: string; author: { id: string }; asset?: { id: string; symbol: string; company_name: string } }

const post = (over: Partial<Post> = {}): Post => ({
  id: 'post-1',
  type: 'quick_thought',
  created_at: new Date(NOW - DAY_MS).toISOString(),
  content: 'A view worth reading, long enough to clear the quality bar comfortably.',
  author: { id: 'author-1' },
  ...over,
})

/** A stored answer, filed exactly where the surface files one. */
const answered = (
  item: { id: string; type: string },
  key: string,
  over: Partial<Disposition> = {},
): DispositionMap => {
  const type = ideaCardType(item.type)
  const entityId = ideaCardId(item.type, item.id)
  const policy = policyForJudgment(key)
  return {
    [dispositionKey(type, entityId)]: {
      kind: 'settled',
      key,
      verdict: key,
      question: 'Feed triage',
      cardType: type,
      v: DISPOSITION_SCHEMA,
      at: NOW,
      until: NOW + policy.quietDays * DAY_MS,
      ...over,
    },
  }
}

// ── 1–3. the three things a reader can do to make a card go away ───────────

describe('a card the reader has dealt with', () => {
  it('[1] is visible before the disposition and absent after it', () => {
    const p = post()
    expect(eligibleFeedItems([p], {}, NOW).map(i => i.id)).toEqual(['post-1'])

    const dismissed = answered(p, TRIAGE_JUDGMENT.dismiss.key)
    expect(eligibleFeedItems([p], dismissed, NOW)).toEqual([])
  })

  it('[2] stays absent for as long as the snooze lasts', () => {
    const p = post()
    const snoozed = answered(p, TRIAGE_JUDGMENT.snooze.key)
    const quietDays = policyForJudgment(TRIAGE_JUDGMENT.snooze.key).quietDays

    expect(eligibleFeedItems([p], snoozed, NOW)).toEqual([])
    expect(eligibleFeedItems([p], snoozed, NOW + (quietDays - 1) * DAY_MS)).toEqual([])
  })

  it('[3] comes back on its own once the quiet has run out', () => {
    const p = post()
    const snoozed = answered(p, TRIAGE_JUDGMENT.snooze.key)
    const quietDays = policyForJudgment(TRIAGE_JUDGMENT.snooze.key).quietDays

    const after = eligibleFeedItems([p], snoozed, NOW + (quietDays + 1) * DAY_MS)
    expect(after.map(i => i.id)).toEqual(['post-1'])
  })

  /**
   * Nothing has to notice the expiry. `acknowledgmentFor` compares the stored
   * window against the clock it is handed, so the card returns by being asked
   * again — which is what lets the surface avoid a timer whose only job is to
   * watch a week go past.
   */
  it('[3b] needs no state change to become eligible again — only a later clock', () => {
    const p = post()
    const snoozed = answered(p, TRIAGE_JUDGMENT.snooze.key)
    const before = dispositionSignature(snoozed)
    const quietDays = policyForJudgment(TRIAGE_JUDGMENT.snooze.key).quietDays

    expect(eligibleFeedItems([p], snoozed, NOW + (quietDays + 1) * DAY_MS)).toHaveLength(1)
    // The store did not move; only `now` did.
    expect(dispositionSignature(snoozed)).toBe(before)
  })

  it('[4] follows the policy windows, not a window of its own', () => {
    for (const key of ['scenario_thesis_intact', 'target_revise', 'needs_review', 'not_now']) {
      const p = post({ id: `post-${key}` })
      const map = answered(p, key)
      const { quietDays } = policyForJudgment(key)

      expect(eligibleFeedItems([p], map, NOW + (quietDays - 0.5) * DAY_MS)).toHaveLength(0)
      expect(eligibleFeedItems([p], map, NOW + (quietDays + 0.5) * DAY_MS)).toHaveLength(1)
    }
  })

  /**
   * A resolving answer is not a long snooze. `resolves` closes the question the
   * card asked, and `suppressionFor` reports it separately so the two can never
   * be conflated by a caller reading only one field.
   */
  it('distinguishes a resolved question from bought quiet', () => {
    const p = post()
    const resolved = suppressionForFeedItem(p, answered(p, 'answered'), NOW)
    const quiet = suppressionForFeedItem(p, answered(p, TRIAGE_JUDGMENT.snooze.key), NOW)

    expect(resolved.suppressed).toBe(true)
    expect(resolved.reason).toBe('resolved')
    expect(quiet.suppressed).toBe(true)
    expect(quiet.reason).toBe('quiet')
  })

  /** `flagged` says the finding is real and needs work. It must stay visible. */
  it('does not hide a card the reader flagged as needing work', () => {
    const p = post()
    const flagged = answered(p, 'scenario_cases_outdated', { kind: 'flagged' })
    const { quietDays } = policyForJudgment('scenario_cases_outdated')
    // The policy key still buys its week of quiet — `kind` is not what decides
    // suppression here, the semantic key is — and then it returns.
    expect(eligibleFeedItems([p], flagged, NOW + (quietDays + 1) * DAY_MS)).toHaveLength(1)
  })
})

// ── 5–6. suppression must not reach past the thing it was about ────────────

describe('an answer only silences what it was about', () => {
  it('[6] does not hide another post on the same asset', () => {
    const priya = post({ id: 'priya-thought', asset: { id: AAPL, symbol: 'AAPL', company_name: 'Apple' } })
    const marcus = post({ id: 'marcus-thought', asset: { id: AAPL, symbol: 'AAPL', company_name: 'Apple' } })

    const eligible = eligibleFeedItems([priya, marcus], answered(priya, TRIAGE_JUDGMENT.dismiss.key), NOW)
    expect(eligible.map(i => i.id)).toEqual(['marcus-thought'])
  })

  it('[6b] does not hide a different post TYPE that shares an id', () => {
    const thought = post({ id: 'shared-id', type: 'quick_thought' })
    const note = post({ id: 'shared-id', type: 'note' })

    const eligible = eligibleFeedItems([thought, note], answered(thought, TRIAGE_JUDGMENT.dismiss.key), NOW)
    expect(eligible.map(i => i.type)).toEqual(['note'])
  })

  it('[5] ignores an answer filed against a different entity entirely', () => {
    const p = post()
    const elsewhere: DispositionMap = {
      [dispositionKey('no_target', AAPL)]: {
        kind: 'settled', key: 'not_price_driven', verdict: 'not_price_driven',
        at: NOW, until: NOW + 180 * DAY_MS,
      },
    }
    expect(eligibleFeedItems([p], elsewhere, NOW).map(i => i.id)).toEqual(['post-1'])
  })

  /**
   * The scope gate, reached through the desktop path. `not_price_driven`
   * answers the no-target card's question and buys 180 days; applying that to
   * anything else would let one answer about valuation method silence an
   * unrelated card for half a year.
   */
  it('[5b] discards a scoped answer that does not cover this card type', () => {
    const p = post()
    const misfiled = answered(p, 'not_price_driven')
    expect(judgmentApplies('not_price_driven', ideaCardType(p.type))).toBe(false)
    expect(eligibleFeedItems([p], misfiled, NOW).map(i => i.id)).toEqual(['post-1'])
  })
})

// ── identity ───────────────────────────────────────────────────────────────

describe('identity matches what the surface writes', () => {
  it('keys on the post, never on the asset', () => {
    const ref = judgmentRefFor({ id: 'post-1', type: 'quick_thought' })
    expect(ref.entityId).toBe('idea:quick_thought:post-1')
    expect(ref.entityId).not.toContain(AAPL)
    expect(ref.storeKey).toBe('thought:idea:quick_thought:post-1')
  })

  /**
   * The exact expression `MobileDashboard`'s `case 'idea'` branch composes. If
   * a shell ever resolves a different key it will look up a record nothing
   * wrote and suppress nothing, silently — which is the failure mode that made
   * dismissing a post a no-op on mobile before it was wired.
   */
  it('resolves the same store key mobile does, for every post type', () => {
    for (const type of ['quick_thought', 'trade_idea', 'pair_trade', 'note', 'thesis_update', 'insight', 'message']) {
      const mobile = `${ideaCardType(type)}:${ideaCardId(type, 'x')}`
      expect(judgmentRefFor({ id: 'x', type }).storeKey).toBe(mobile)
    }
  })

  /**
   * Mobile hands `priorityFor` its RANKING type (`ideaSignalType`) while the
   * store is keyed by the CARD type. Both reach `judgmentApplies`, so the two
   * must agree for every key the surface can write, or the shells would gate
   * the same record differently. Nothing in RESOLUTION_SCOPE covers a post type
   * today; this fails the moment that stops being true.
   */
  it('gates identically whichever of the two type functions is used', () => {
    for (const type of ['quick_thought', 'trade_idea', 'pair_trade', 'note', 'thesis_update', 'message']) {
      for (const key of CLASSIFIED_JUDGMENT_KEYS) {
        expect(judgmentApplies(key, ideaCardType(type)))
          .toBe(judgmentApplies(key, ideaSignalType(type)))
      }
    }
  })

  it('reads a pre-Phase-3 record through `verdict`', () => {
    const p = post()
    const legacy: DispositionMap = {
      [judgmentRefFor(p).storeKey]: {
        kind: 'settled', key: undefined as any, verdict: 'not_now',
        at: NOW, until: NOW + 14 * DAY_MS,
      },
    }
    expect(judgmentRecordFor(p, legacy)?.key).toBe('not_now')
    expect(eligibleFeedItems([p], legacy, NOW)).toEqual([])
  })

  /**
   * A source guard, not a behaviour test — the same shape as [11] in
   * coverage-relevance. It fails if a shell grows its own idea of where a
   * post's answer lives.
   */
  it('both shells compose identity from builders/ideas', () => {
    const files = {
      mobile: 'src/components/mobile/MobileDashboard.tsx',
      desktop: 'src/lib/ideas/feed-suppression.ts',
    }
    for (const file of Object.values(files)) {
      const src = readFileSync(resolve(process.cwd(), file), 'utf8')
      expect(src).toContain('ideaCardId')
      expect(src).toContain('ideaCardType')
    }
    // And the desktop feed reaches suppression only through the shared module.
    const feed = readFileSync(resolve(process.cwd(), 'src/hooks/ideas/useIdeasFeed.ts'), 'utf8')
    expect(feed).toContain('eligibleFeedItems')
    expect(feed).not.toMatch(/acknowledgmentFor|policyForJudgment|quietDays/)
  })
})

// ── 12. failing open ───────────────────────────────────────────────────────

describe('missing or unreadable answers hide nothing', () => {
  it('[12] returns everything for an empty store', () => {
    const items = [post({ id: 'a' }), post({ id: 'b' })]
    expect(eligibleFeedItems(items, {}, NOW)).toHaveLength(2)
    expect(eligibleFeedItems(items, undefined as any, NOW)).toHaveLength(2)
  })

  it('[12b] treats a record with no key or kind as never answered', () => {
    const p = post()
    const empty: DispositionMap = {
      [judgmentRefFor(p).storeKey]: {
        kind: null as any, key: '', verdict: '', at: NOW, until: NOW + 30 * DAY_MS,
      },
    }
    expect(eligibleFeedItems([p], empty, NOW)).toHaveLength(1)
  })

  /**
   * Neutral means neutral: a key this build has never been taught buys nothing
   * on its own. Guessing a category from the shape of a key name would produce
   * a confident wrong answer indistinguishable from a real one.
   */
  it('[12c] treats a key nobody has classified as never answered', () => {
    const p = post()
    const unknown: DispositionMap = {
      [judgmentRefFor(p).storeKey]: {
        kind: null as any, key: 'a_key_from_the_future', verdict: 'a_key_from_the_future',
        at: NOW, until: NOW + 999 * DAY_MS,
      },
    }
    expect(eligibleFeedItems([p], unknown, NOW)).toHaveLength(1)
  })

  /**
   * …but an unclassified key on a record that still carries a LEGACY kind is a
   * pre-Phase-3 record, and those are read through `kind` on purpose. Pinned
   * because it is the one case where "unclassified" does suppress, and losing
   * it would silently un-hide every card answered before the rename.
   */
  it('[12d] still honours a legacy record whose key is unclassified', () => {
    const p = post()
    const legacy = answered(p, 'a_key_from_the_future', { kind: 'settled', until: NOW + 999 * DAY_MS })
    expect(eligibleFeedItems([p], legacy, NOW)).toHaveLength(0)
    // 30 days, from the legacy branch — not the record's own `until`.
    expect(eligibleFeedItems([p], legacy, NOW + 31 * DAY_MS)).toHaveLength(1)
  })
})

// ── 7–8. suppression wins over ranking, and precedes diversity ─────────────

describe('suppression sits ahead of scoring and diversity', () => {
  const ctx = {
    userId: 'reader',
    organizationId: 'org',
    followedIds: [] as string[],
    heldAssetIds: new Set<string>(),
    coverageIndex: {
      ready: true,
      direct: new Set([AAPL]),
      assigned: new Set<string>(),
      held: new Set<string>(),
    },
  }

  /** The pipeline order `fetchFeedPage` runs, with nothing else in the way. */
  const pipeline = (items: Post[], dispositions: DispositionMap) => {
    const eligible = eligibleFeedItems(items, dispositions, NOW)
    const scored = eligible.map(i => scoreFeedItemForTest(i as any, ctx as any, 'for_you'))
    scored.sort(compareScoredCandidates)
    return applyDiversityForTest(scored).map(i => i.id)
  }

  it('[7] the coverage bonus cannot bring a dismissed card back', () => {
    const covered = post({ id: 'covered', asset: { id: AAPL, symbol: 'AAPL', company_name: 'Apple' } })
    const plain = post({ id: 'plain' })

    // Covered and un-dismissed, it leads on score — which is the point of the bonus.
    expect(pipeline([covered, plain], {})[0]).toBe('covered')
    // Dismissed, no amount of relevance puts it back on the page.
    expect(pipeline([covered, plain], answered(covered, TRIAGE_JUDGMENT.dismiss.key)))
      .toEqual(['plain'])
  })

  /**
   * A hidden card must not consume a diversity slot. `applyDiversity` defers a
   * third post from one author within five; if a suppressed post still counted
   * toward that run the visible one behind it would be pushed back for spacing
   * nobody can perceive.
   */
  it('[8] a suppressed card does not occupy a diversity slot', () => {
    const sameAuthor = { id: 'prolific' }
    const items = [
      post({ id: 'a', author: sameAuthor }),
      post({ id: 'b', author: sameAuthor }),
      post({ id: 'c', author: sameAuthor }),
      post({ id: 'd', author: sameAuthor }),
    ]
    const withDismissal = pipeline(items, answered(items[0], TRIAGE_JUDGMENT.dismiss.key))

    expect(withDismissal).not.toContain('a')
    // Three remain, and none of them was deferred to make room for the hidden one.
    expect(withDismissal.slice(0, 3)).toEqual(['b', 'c', 'd'])
  })
})

// ── 9–10. mobile is unchanged by the extraction ────────────────────────────

describe('the extraction preserves mobile exactly', () => {
  /**
   * The three lines `priorityFor` used to run inline, kept here as an oracle.
   * `suppressionFor` must agree with them for every classified key, at every
   * interesting age, or the extraction moved behaviour rather than code.
   */
  const inlineOracle = (judgment: JudgmentRecord | null, type: any, now: number) => {
    const j = judgment && judgmentApplies(judgment.key, type)
      ? judgment
      : judgment && !judgment.key ? judgment : null
    const ack = acknowledgmentFor(j, now)
    return { suppressed: ack.resolved || ack.suppressed, ack }
  }

  it('[9] suppresses exactly the set the inline logic did', () => {
    const types = ['thought', 'trade_idea', 'no_target', 'scenario_gap', 'research_note'] as any[]
    const keys = [...CLASSIFIED_JUDGMENT_KEYS, 'unclassified_key', null]
    const ages = [0, 2, 6.9, 7.1, 29.9, 30.1, 179.9, 180.1]

    for (const type of types) {
      for (const key of keys) {
        for (const age of ages) {
          const record: JudgmentRecord = { key, at: NOW, kind: 'settled' }
          const now = NOW + age * DAY_MS
          const expected = inlineOracle(record, type, now)
          const actual = suppressionFor(record, type, now)
          expect(actual.suppressed).toBe(expected.suppressed)
          expect(actual.acknowledgment).toEqual(expected.ack)
        }
      }
    }
  })

  it('[9b] preserves the legacy no-key path', () => {
    for (const kind of ['settled', 'flagged', 'rejected'] as const) {
      for (const age of [0, 29.9, 30.1]) {
        const record: JudgmentRecord = { kind, at: NOW }
        const now = NOW + age * DAY_MS
        expect(suppressionFor(record, 'thought' as any, now).suppressed)
          .toBe(inlineOracle(record, 'thought', now).suppressed)
      }
    }
  })

  /** [10] The penalty, the tier and the total are all untouched by the move. */
  it('[10] leaves priority totals and penalties unchanged', () => {
    const base: PriorityInput = {
      id: 'p', type: 'scenario_gap' as any, severity: 'attention' as any,
      occurredAt: new Date(NOW - DAY_MS).toISOString(), weightPct: 4, held: true,
    }
    const unanswered = priorityFor(base, NOW)
    expect(unanswered.suppressed).toBe(false)
    expect(unanswered.components.acknowledgment).toBe(0)

    // Answered and past its quiet: still visible, still penalised, same tier.
    const answeredLongAgo = priorityFor(
      { ...base, judgment: { key: 'scenario_needs_review', at: NOW - 10 * DAY_MS, kind: 'flagged' } },
      NOW,
    )
    expect(answeredLongAgo.suppressed).toBe(false)
    expect(answeredLongAgo.tier).toBe(unanswered.tier)
    expect(answeredLongAgo.components.acknowledgment)
      .toBeCloseTo(-policyForJudgment('scenario_needs_review').penalty * 0.5, 10)
    // Every non-acknowledgment component is bit-for-bit what it was.
    for (const k of Object.keys(unanswered.components) as (keyof typeof unanswered.components)[]) {
      if (k === 'acknowledgment') continue
      expect(answeredLongAgo.components[k]).toBe(unanswered.components[k])
    }
  })

  it('[9c] rankFeed still drops exactly what the desktop filter drops', () => {
    const posts = [
      post({ id: 'kept' }),
      post({ id: 'dismissed' }),
      post({ id: 'snoozed' }),
    ]
    const map: DispositionMap = {
      ...answered(posts[1], TRIAGE_JUDGMENT.dismiss.key),
      ...answered(posts[2], TRIAGE_JUDGMENT.snooze.key),
    }

    // Mobile: rankFeed over PriorityInputs built the way MobileDashboard builds them.
    const mobileVisible = rankFeed(
      posts,
      p => ({
        id: p.id,
        type: ideaSignalType(p.type) as any,
        severity: 'informational' as any,
        occurredAt: p.created_at,
        weightPct: null,
        held: false,
        judgment: judgmentRecordFor(p, map),
      }),
      NOW,
    ).map(r => r.item.id)

    const desktopVisible = eligibleFeedItems(posts, map, NOW).map(p => p.id)

    expect(new Set(desktopVisible)).toEqual(new Set(mobileVisible))
    expect(desktopVisible).toEqual(['kept'])
  })
})

// ── 11. recomputation ──────────────────────────────────────────────────────

describe('[11] the feed re-keys when an answer is recorded', () => {
  const p = post()

  it('changes signature when a card is answered', () => {
    const before = dispositionSignature({})
    const after = dispositionSignature(answered(p, TRIAGE_JUDGMENT.dismiss.key))
    expect(after).not.toBe(before)
  })

  it('changes when a snooze is replaced by a dismissal on the same card', () => {
    const snoozed = dispositionSignature(answered(p, TRIAGE_JUDGMENT.snooze.key))
    const dismissed = dispositionSignature(answered(p, TRIAGE_JUDGMENT.dismiss.key))
    expect(dismissed).not.toBe(snoozed)
  })

  it('is stable for the same store regardless of insertion order', () => {
    const a = { ...answered(post({ id: 'a' }), 'not_now'), ...answered(post({ id: 'b' }), 'defer') }
    const b = { ...answered(post({ id: 'b' }), 'defer'), ...answered(post({ id: 'a' }), 'not_now') }
    expect(dispositionSignature(a)).toBe(dispositionSignature(b))
  })

  /** It must not move on its own, or the feed refetches on a timer. */
  it('does not depend on the clock', () => {
    const map = answered(p, TRIAGE_JUDGMENT.snooze.key)
    const first = dispositionSignature(map)
    expect(dispositionSignature(map)).toBe(first)
  })
})
