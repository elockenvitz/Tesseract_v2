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

---

# Correction, 2026-08-28: the two systems are stacked, not parallel

Everything above describes mobile and desktop as two independent rankers that
"share no code". A baseline audit on `feat/desktop-ideas-redesign` found that
this is wrong in a way that changes what the fix has to be, so the table at the
top should be read with this section, not without it.

## What is actually true

`MobileDashboard.tsx:160` calls `useIdeasFeed({ mode: 'for_you' })` and feeds
its `items` into `ideaEntries` (`:1653`) as one of eight pooled kinds. Mobile
does not have its own idea retrieval. It consumes desktop's.

```
IDEA CANDIDATES  (shared by both shells)
  quick_thoughts        .order(created_at desc).range(offset, offset+19)
  trade_queue_items     .order(created_at desc).range(offset, offset+19)   singles
  trade_queue_items     .range(0, pairLegWindow(offset,15)-1)              pair legs
  asset_notes           .order(created_at desc).range(offset, offset+19)
  asset_contributions   .order(created_at desc).range(offset, offset+19)
        │
        ▼
  useIdeasFeed / fetchFeedPage — candidate pool (~98 rows max, page 0)
        │
        ▼
  scoreFeedItem            desktop arithmetic, flat score
        │
        ▼
  scored.sort(b.score - a.score)
        │
        ▼
  applyDiversity           run-length spacing, defer-and-retry
        │
        ▼
  .slice(0, PAGE_SIZE = 15)   ◄── DESTRUCTIVE. Everything below rank 15 is gone.
        │
        ├──────────────────────────────► DESKTOP visible list
        │                                 IdeasFeedPage → FeedCard
        │
        ▼
MOBILE IDEA PATH  (same 15 rows)
  items → ideaEntries          score := (visibleItems.length - idx) + interest
        │                      i.e. POSITION, not desktop's score
        ▼
  pooled with attention, signals, insights, news, templates, lenses, scenarios
        │
        ▼
  rankInputFor → priorityFor   tier + weighted score + judgment suppression
        │
        ▼
  rankFeed                     drops priority.suppressed, compareRanked total order
        │
        ▼
  diversify → LEAD_TIER split → interleaveByKind
        │
        ▼
                                  MOBILE visible feed
```

**Therefore desktop's recency/truncation ceiling is also an upstream mobile
Ideas ceiling.** A covered idea sitting at recency position 40 is not merely
ranked low on mobile — it was never fetched, never scored, and never handed to
`priorityFor` at all. No amount of mobile weight tuning can reach it.

## Recorded facts

- **Desktop score does not survive into mobile priority as a ranking score.**
  `ideaEntries.score` is positional (`visibleItems.length - idx`), and
  `rankInputFor` then computes a fresh `PriorityInput`. Desktop's arithmetic is
  discarded on arrival.
- **Its principal mobile effect is candidate membership and truncation.** The
  half of `scoreFeedItem` that reaches mobile is the half that decides which 15
  rows exist — the least useful half to inherit and the only one mobile cannot
  override.
- **Coverage currently gets two bites.** It influences the desktop
  candidate stage (`desktopAssetRelevanceFor` + a 0.12 additive bonus, deciding
  which rows survive the slice) and then again at mobile priority
  (`coverageWeightFor` + a 0.10 additive bonus). One declaration, two
  compounding applications, on two constants tuned independently.
- **A third ranker exists.** `useUnifiedFeed` → `useRelevanceScoring`, consumed
  by `LegacyIdeaGeneratorPage` in `src/pages/IdeaGeneratorPage.tsx:151`. See
  `docs/tickets/ideas-candidate-retrieval.md` §Third ranker for its disposition.
- **Pair trades use a special growing-window pagination strategy.** Not
  `.range(offset, …)` like every other source: `.range(0, pairLegWindow(offset,
  PAGE_SIZE) - 1)` with a `pairPageSlice`, because grouping legs into pairs has
  to happen before slicing or a pair splits across a page boundary into two
  half-pairs. Any change to candidate retrieval has to treat this source
  separately.
- **Desktop score ties lack a deterministic total order.**
  `scored.sort((a, b) => b.score - a.score)` has no tie-break, so equal-scoring
  cards can swap between renders. `compareRanked` documents at length why mobile
  needs tier → total → occurredAt → id; desktop has none of it.

## What this changes about the fix sequence

The sequence at the top of this ticket starts with "port judgment suppression to
desktop". That is still right as the first *ranking* step, but it is no longer
step 1, because both shells are reading from a candidate set that is chosen by
recency alone. Ranking unification on top of an insufficient candidate set would
unify two views of the same truncated 15 rows.

Candidate retrieval comes first. See
`docs/tickets/ideas-candidate-retrieval.md`.

---

# Phase 2, 2026-08-28: desktop suppression parity

Step 2 of the fix sequence above — "port judgment suppression to desktop" — is
done for feed posts. Desktop no longer shows a card the reader has settled,
snoozed or dismissed, and it decides that with the same policy mobile uses
rather than a copy of it.

## The seam

`priorityFor` owned the composition: scope-gate the record with
`judgmentApplies`, read it with `acknowledgmentFor`, and treat
`resolved || suppressed` as hidden. That made suppression available only to a
caller willing to compute a full mobile priority — tier, weights, coverage,
recency — which desktop is not, and is why suppression existed on one shell.

Those three lines moved to `suppressionFor(judgment, type, now)` in
`judgment-policy.ts`, beside the two functions they compose. `priorityFor` now
calls it, so mobile is mechanically unchanged; `lib/ideas/feed-suppression.ts`
calls it too, for a feed row rather than a `PriorityInput`.

```
                       judgment-policy.suppressionFor      ← the one answer
                        ╱                          ╲
        priorityFor  ◄─╱                            ╲─►  eligibleFeedItems
        (mobile)                                          (desktop)
```

## Pipeline order

```
fetchIdeaCandidates       retrieval
  → eligibleFeedItems     canonical suppression   ← new
  → scoreFeedItem         desktop scoring
  → compareScoredCandidates
  → applyDiversity
  → slice(0, PAGE_SIZE)   presentation
```

Suppression precedes scoring, which is load-bearing twice. A hidden card must
not consume a diversity slot — `applyDiversity` spaces runs of one author, and a
suppressed row that still counted would push a visible one off the page to space
something nobody can see. And the coverage bonus is additive and deliberately
large enough to move a card up a page, so suppression running *after* it would
put the two features in an argument that "I dismissed this" has to win every
time. Evaluating eligibility first means they never meet.

## Identity

A post's answer is keyed on the POST, never on the ticker:
`ideaCardType(type)` + `ideaCardId(type, id)` = `thought:idea:quick_thought:abc`
— the same two functions from `builders/ideas` that `MobileDashboard`'s
`case 'idea'` branch calls. Keyed on the asset, one reader answering Priya's
thought about AAPL would silence Marcus's thought about AAPL.

There is no fuzzy matching anywhere in this path. A row is suppressed when the
store holds a record under exactly its composed key, and not otherwise.

## What is deliberately NOT suppressed

- **Inserted signal cards.** `useSignalCards` → `insertSignalsIntoFeed` puts
  `attention_cluster`, `stale_coverage`, `conflict`, `catalyst_proximity` and
  `prompt` cards into the desktop list after the feed page is built. They are a
  different shape with a different type vocabulary, and nothing in the product
  writes a disposition against one, so there is no key to look up. Suppressing
  them would mean inventing an identity for them first. Left visible, on
  purpose.
- **Anything mobile cannot suppress either.** The desktop filter is a strict
  mirror; it introduces no suppression that mobile does not already apply.

## The one asymmetry that remains

Desktop can now READ every answer. It cannot WRITE one: the desktop card's
overflow menu offers Add thought / Create trade idea / Send prompt / Recommend,
and no Snooze or Dismiss. So today the only writer is mobile, and desktop parity
means "a decision made on the phone is honoured on the laptop" — which is the
direction the complaint was actually made in.

Adding the controls is now small and deliberately out of scope for this phase:
`recordTriage` already exists, it needs a `SignalCard`, and desktop rows are not
cards yet. `recordDisposition` fires `DISPOSITIONS_CHANGED_EVENT` and
`useDispositions` listens for it, so the invalidation path is already built and
tested for whoever adds them.

## Invalidation

No polling, and no timer. Three paths, each triggered by something that
actually happened:

| Event | Mechanism |
|---|---|
| answer recorded in this tab | `DISPOSITIONS_CHANGED_EVENT` from `recordDisposition` |
| answer recorded in another tab | the browser's `storage` event, filtered to this user's key |
| snooze expires | nothing — `acknowledgmentFor` is asked again with a later clock at the next evaluation |

`dispositionSignature` is in the feed's React Query key, the same way
`coverageSignature` is, so a recorded answer recomputes the page instead of
waiting for a reload. It is deliberately clock-independent: a signature that
moved on its own would refetch the feed on a timer and move the page under the
reader.

## Still open after this phase

Ranking unification itself. The two scorers, the two component vocabularies, the
two coverage constants, and mobile consuming a desktop-ranked 15-row slice rather
than the candidate pool. Suppression is now shared; the arithmetic is not.
