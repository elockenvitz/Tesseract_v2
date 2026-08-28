# Ideas ranking divergence: mobile and desktop rank by different arithmetic

**Status:** open, deliberately not fixed
**Found:** 2026-08-28, while wiring coverage into Ideas relevance
**Referenced from:** `src/lib/signals/coverage-relevance.ts`,
`src/hooks/useCoverageRelevance.ts`,
`src/lib/signals/__tests__/coverage-relevance.test.ts` ([11])

## What is actually true today

Tesseract has two Ideas ranking systems. Not two configurations of one system —
two implementations, written at different times, that share no code.

| | Mobile | Desktop |
|---|---|---|
| Entry point | `rankFeed` → `priorityFor` | `useIdeasFeed` → `scoreFeedItem` |
| File | `src/lib/signals/feed-priority.ts` | `src/hooks/ideas/useIdeasFeed.ts` |
| Shape | tier first, then weighted score | single weighted score |
| Ordering | `compareRanked`: tier, then total | score descending |
| Components | severity, recency, ownership, staleness, … | freshness, authorRelevance, assetRelevance, engagement, contentQuality |
| Suppression | judgment policy (`judgmentApplies`, dismiss/snooze) | none of that pipeline |
| Coverage span | `WEIGHTS.ownership` = 0.06 | `assetRelevance` × 0.2 |

The consequence is visible to a user who carries two devices: the same signals,
on the same account, come back in a different order depending on which screen
they are looking at. Mobile can suppress a card that desktop still shows,
because judgment suppression only exists on one side.

## What this work did, and did not, change

Coverage → Ideas relevance made the two systems agree about **the facts** and
left them disagreeing about **the arithmetic**.

Both shells now resolve coverage through one module —
`lib/signals/coverage-relevance.ts`, fed by one hook, `useCoverageRelevance` —
so "does this reader cover this name" has exactly one answer in the product.
Each shell then projects that single `CoverageRelevance` onto its own existing
scale: `coverageWeightFor` for mobile's 0.06 ownership span,
`desktopAssetRelevanceFor` for desktop's 0.2 asset-relevance term, with
desktop's two original numbers (0.9 held / 0.3 not-held) preserved exactly.

That was the whole intent: adding a *second* definition of "covered", one per
shell, is the failure this seam exists to prevent, and test [11] fails if a
shell grows its own `coverage` query or its own band vocabulary.

Unifying the two *algorithms* was explicitly out of scope. It is a ranking
redesign — new weights, a tier model on desktop or its removal from mobile, and
a suppression pipeline that either shell can run — and doing it as a side effect
of a coverage change would have shipped an unreviewed reordering of everybody's
feed under the heading of a smaller feature.

## What the staging measurement added

Wiring coverage in and measuring it on a real authenticated staging workspace
turned up two things that only a live feed shows.

**Desktop candidate selection is recency-bounded.** Every source query in
`fetchFeedPage` is `.order('created_at', desc).range(offset, offset + 19)`, and
the scoring — coverage included — is applied to that window afterwards. So
coverage can reorder a page but can never pull a covered idea from page 3 onto
page 1. For a reader whose covered names are quiet this week, the feature is
invisible no matter how the weights are set. Any real fix has to score a
candidate set that was not chosen by recency alone.

**The two scales needed different magnitudes for the same intent.** Desktop
spans `assetRelevance` 0.2 with held already at 0.9, so coverage was worth 0.02
against a freshness term weighted 0.25 — an eight-hour age gap beat it, and the
measured movement was zero positions. Mobile's ownership span is 0.06, worth
0.024 within a tier. Both now carry an additive `coverageBonusFor` lift (0.12
desktop, 0.10 mobile) that is exactly zero for a reader who has declared
nothing. Two constants for one intent is a direct cost of the divergence: one
ranking model would have one number.

**Coverage had to be excluded from the diversity comparison.** The bonus made
covered cards score far enough above uncovered ones that no alternative fell
inside `DIVERSITY_TOLERANCE`, so the run rule stopped binding and the feed
became a covered-names filter. `comparableTotal` strips the bonus before asking
"is there a credible alternative?" — coverage decides the order, not what counts
as a competitor. Desktop's `applyDiversity` has no equivalent guard, because
desktop has no equivalent rule.

## Why it should be fixed

1. **The orders disagree.** Two ranked lists from one account is a correctness
   problem, not a styling one, and it gets worse each time either side is tuned.
2. **Suppression is not portable.** A reader who settles a signal on their phone
   sees it again on their laptop. That directly undercuts the judgment model.
3. **Every future ranking input costs double.** Coverage cost two projections
   and one shared module. The next input pays the same tax, and the temptation
   each time is to do it in one shell only.

## What a fix looks like

One `rankFeed`, one component vocabulary, one suppression pass, with the shells
differing only in how many cards they show and how they present them. The
sequencing that keeps it safe:

1. Capture a before/after ranked feed for a set of real accounts on both shells;
   without that, "the order changed" is unfalsifiable.
2. Port judgment suppression to desktop first — it removes cards rather than
   reordering them, and it is the divergence users can most clearly name.
3. Fold desktop's `scoreFeedItem` components into `priorityFor`'s weights,
   retuning deliberately and reviewing the diff on captured feeds.
4. Delete the loser.

Not scheduled. Coverage relevance does not depend on it — the seam holds without
it — but each new ranking signal makes it more expensive.
