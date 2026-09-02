# Pipeline ordering inventory: every path that decides what a reader meets first

**Status:** map only — one seam extracted, two disposition bugs fixed, no ranking
arithmetic changed
**Taken:** 2026-09-02, against `0706007`
**Related:** `ideas-ranking-divergence.md`, which covers rows 1 and 3 in depth

The distinction this map is drawn along:

| | question |
|---|---|
| **Ranking** | how important is this object? |
| **Composition** | how should this ranked set be sequenced for this surface? |
| **Actions** | what can the reader do with this object? |
| **User state** | what has this reader already done with this object? |

Composition is *allowed* to differ per surface — mobile briefs, Explore
discovers, the desktop dashboard is a workbench. Importance is not, and today it
means seven different things.

## 1. The paths

| # | surface | entry point | pool | score | order | suppression |
|---|---|---|---|---|---|---|
| 1 | Mobile Curate | `rankFeed` → `composeFeed` | all builders, deduped | `priorityFor`: tier 0–4, then 0–1 within tier | `compareRanked` (tier, total, occurredAt, id) then cost-tuple composition | judgment policy, before ranking |
| 2 | Explore | `composeExplore` | Explore adapters | `scoreExplore` 0–1, flat category interest | greedy repulsion over five axes | none |
| 3 | Desktop Ideas | `useIdeasFeed` → `scoreFeedItem` | recency-bounded page query | single weighted score, 18h half-life | score desc | none |
| 4 | Desktop Dashboard / TODAY | `useDashboardFeed` | decision engine + attention | `assignBand` NOW/SOON/AWARE | `sortByBand` comparators | local snooze list |
| 5 | Attention / Prioritize | `useAttention` | 13 collectors | `calculateScore`, unbounded additive | score desc | `attention_user_state` |
| 6 | Decision list | `rankDecisionItems` | DECIDE stacks | `compositeItemScore`, unbounded additive | score desc | none |
| 7 | Research pane | `researchScopedOrder` | ranked Research subset | inherits `priority.total` | band, total, id, run cap 2 | inherits |

`useMyPriorities` is a re-export of `useAttention`, so Prioritize is row 5 and
not an eighth model.

## 2. Classification

**A — shared importance semantic, should converge**

- Position size. Banded in three places on the SAME thresholds (<1, <3, <5,
  <10) and three different outputs: `materialityBand` (0.15…1), Explore's
  `materiality` (0.25…1), and `compositeItemScore`'s `min(weight × 3, 20)`.
- Severity → urgency. `SEVERITY_URGENCY` on mobile, `SEV_SCORE` on desktop,
  `SEVERITY_RANK` in the bands, and a fourth inline ternary in the Explore
  scenario adapter.
- Recency. Bounded and capped on mobile (`recencyBoost`), bounded on Explore
  (`freshness`), an 18-hour exponential on desktop Ideas, and unbounded and
  ACCELERATING on the two desktop additive scorers.
- Personal suppression. **Converged this stage** — see §4.

**B — legitimate surface composition, stays surface-specific**

- `composeFeed`'s cost tuple and lookahead window (row 1).
- Explore's five-axis repulsion (row 2). Its own header argues the case and the
  argument holds: discovery is not a total order.
- Band assignment and the three band comparators (row 4).
- `researchScopedOrder`'s framing bands and run cap of two (row 7).

**C — duplicate or contradictory importance logic**

- Rows 5 and 6 are both unbounded additive models with no tier partition, which
  is precisely the failure `feed-priority`'s header was written to prevent: at
  5 points per day past a week, a 30-day-old low-severity item scores ~136 and
  outranks anything severity can produce. Arithmetic overrides meaning.
- The twelve inline `importance:` literals in `explore-adapters.ts`, each its
  own scale — `pct / 40`, `overdueMonths / 12`, `weightPct / 15`, a severity
  ternary, and six fixed constants. They feed one bounded term, which limits the
  damage, but "how important is this" is being answered twelve times.
- Row 3 versus row 1, in full, as `ideas-ranking-divergence.md` sets out.

**D — legacy / dead / downstream reordering**

- `lib/mobile/feed-interleave.ts`. `interleaveByKind` is the only seeded-random
  orderer left and has **no production caller** — every reference is a comment
  explaining what replaced it. Its tests still pass and should keep it honest
  until it is deleted. A guard now fails if anything imports it again.
- `diversify` in `feed-priority.ts`, superseded by `composeFeed` for the mobile
  feed and still exercised by its own tests.

## 3. What was NOT changed, deliberately

No weight, threshold, tier or comparator moved. Rows 1–7 order exactly as they
did at `0706007`. Converging row 2 or row 6 onto `priorityFor` is a reordering
of somebody's feed and belongs in a stage that can capture before/after on real
accounts, which `ideas-ranking-divergence.md` §"What a fix looks like" already
sequences.

## 4. The one seam extracted

`lib/signals/personal-suppression.ts` — `isPersonallySuppressed` and
`deferUntil`. It answers "has this reader already dealt with this object, and
until when", and nothing else.

It is safe to share where the scores are not, because **suppression removes an
object and never moves one**. Three stores were answering it with three
arithmetics: one used `>`, one `>=`, one compared `Date` objects and one epoch
numbers, and only two survived a malformed timestamp.

Now read by `useAttention`'s filter and by the dashboard band store. Not read by
`composeFeed`, and a test asserts that: suppression is not ordering.

## 5. Disposition ownership, as found

| action | scope as written | correct? |
|---|---|---|
| judge / settle / flag / reject (mobile) | `dispositions.ts`, keyed `user`, device-local | personal ✓ (not durable — later stage) |
| acknowledge / snooze / dismiss / mark read | `attention_user_state`, user × attention id | personal ✓ |
| snooze (dashboard bands) | localStorage, **one key for the whole browser** | **was broken — fixed** |
| defer (trade decision) | `trade_queue_items.revisit_at`, shared org row | **was broken — fixed** |
| approve / reject a trade idea | `trade_queue_items.status` | shared ✓, and explicitly named |

## 6. Unresolved identity caveat — do not generalise

`dispositionEntityFor` returns `card.entity.id`, the ASSET. But a capital card
already carries `capital.issueKey = portfolioId:assetId:issueType`.

So settling "AAPL framework break" in the Growth Fund also settles it in the
Defensive Fund — two different findings, one key, and the pipeline is holding
the field that distinguishes them and discarding it.

Deliberately not fixed here. Changing a suppression key changes what is hidden
for readers who have already answered, and the right place to decide whether a
finding is `asset` or `asset × portfolio` is the durable-persistence stage,
per finding family, with the schema in front of it. Documented and stopped at
the seam.

## 7. The desktop port already exists, unported

`feat/adaptive-tile-foundations` (`14b41ef`) and `feat/engagement-seam-4c`
(`90d30c4`) both carry `src/lib/today/`, and `today/tiers.ts` is the desktop
ranking port this stage was going to have to design:

```
import { materialityBand, recencyBoost } from '../signals/feed-priority'
```

It keeps the tier partition and imports mobile's component functions unchanged,
while keying its own TIER map on desktop evaluator `titleKey` rather than on
`SignalType`. Its header states the reasoning: **the map is desktop's and the
scoring is mobile's.**

That is the right shape, and it means the canonical seam for the desktop port
already exists on current ancestry and needs no new code — `materialityBand`,
`deviationBand` and `recencyBoost` are already exported pure functions over
plain numbers, with no React, no card vocabulary and no composition in them.

Nothing was cherry-picked. Recorded so the port is not designed a third time.

**The exact later desktop ranking integration**

1. Land `src/lib/today/` on current ancestry from whichever of those two lanes
   merges first. It already consumes the seam.
2. Map the remaining evaluators — `calculateScore`'s 13 collectors (row 5) and
   `compositeItemScore` (row 6) — into `today/tiers.ts`'s TIER record.
3. Delete `calculateScore` and `compositeItemScore`. Both are unbounded additive
   models with no partition; nothing should be tuned in them first.
4. Only then consider row 3, per `ideas-ranking-divergence.md`.

## 8. Engagement compatibility

`90d30c4`'s `EngagementTarget` needs `objectType`, `objectId`, `label`, and
optionally `assetId`, `portfolioId`, `portfolioName`, `symbol` — see
`engagement/target.ts`, where `toAITags` falls back to the asset and portfolio
when the object itself is not taggable.

The pipeline preserves all of it and loses none of it through ranking or
composition: `rankFeed` and `composeFeed` are generic over `T` and carry the
item by reference, so a card arrives at presentation with its `entity`
(`{ kind, id, name, ticker }`) and, for capital cards, `capital.portfolioId`
and `capital.portfolioName` intact. `RankedItem` adds `priority` and `input`
alongside the item rather than replacing it.

So the intended flow already holds:

```
ranked/composed object -> presentation -> engagementAffordances(target) -> Ask AI / Discuss
```

Nothing here needs to change for it. The one gap is §6's: `portfolioId` reaches
presentation but is discarded by the disposition key, so engagement identity is
finer than suppression identity today.

## 9. Adaptive tile compatibility

The tile lane can already read, from a composed item and without touching
ranking code:

- **object identity** — `entity.kind`, `entity.id`, `entity.ticker`
- **stable finding identity** — `card.id`, and `capital.issueKey` where present
- **importance and rank** — `priority.tier`, `priority.total`,
  `priority.components`, plus position in `ComposeResult.order`
- **category / family / semantic framing** — `categoryOf`, `familyOf` and
  `subjectOf` are already the compose inputs, and `content-registry` is the one
  place a type's category is decided
- **why it landed there** — `ComposeTraceRow`, when `trace` is on

No presentation role, card height or component name appears anywhere in
`feed-priority.ts` or `feed-compose.ts`, and none was added. `diversifyExplore`
carries the matching note in its own body: it used to end by calling
`assignEmphasis` from an item's index in the arrangement it had just produced,
and that was removed for exactly this reason. Size is decided by
`explore-layout` from the item, not from where composition put it.
