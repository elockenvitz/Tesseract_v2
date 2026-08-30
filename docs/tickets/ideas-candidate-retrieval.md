# Ideas candidate retrieval: the feed ranks a set chosen by recency alone

**Status:** in progress — retrieval only
**Opened:** 2026-08-28, on `feat/desktop-ideas-redesign`
**Depends on:** the correction section of
`docs/tickets/ideas-ranking-divergence.md`, which establishes that mobile Ideas
consumes desktop's candidate set rather than building its own.

## The problem, stated as retrieval rather than ranking

`fetchFeedPage` asks each source for the newest 20 rows, scores them, spaces
them, and keeps 15. Both shells then rank inside those 15 — desktop with
`scoreFeedItem`, mobile with `priorityFor` after pooling them with seven other
kinds.

So the honest description of the coverage feature today is: *coverage can
reorder rows that recency already selected.* A reader covering names that were
quiet this week gets nothing from declaring them, because the rows that would
demonstrate the value were never in the result set. That is a retrieval defect
wearing a ranking defect's clothes, and no weight is reachable from it.

The objective of this pass is therefore **not** "make `scoreFeedItem` smarter".
It is "give the canonical ranker a sufficiently broad, bounded candidate set."

## The conceptual split

```
fetchIdeaCandidates(...)   →  normalized, bounded candidate set
rankIdeaCandidates(...)    →  relevance / priority / suppression / diversity
render(...)                →  desktop or mobile presentation
```

`useIdeasFeed` mixes all three. This pass extracts only the first, and only far
enough that retrieval can improve without touching the scorer.

## Strategies considered

**A. Larger bounded candidate window.** Raise `fetchSize` from 20 to, say, 60.

Rejected. It multiplies every source's cost by 3x for every reader on every
page, including the majority who have declared no coverage and would see an
identical feed for the extra rows. And it does not actually solve the problem it
is aimed at: it moves the ceiling from position 20 to position 60 without
changing its nature. A reader whose covered name last moved four months ago is
still outside it.

**B. Multi-window retrieval — recent + relevance + unresolved, merged.** Each
pool answers a different question and is separately bounded.

Preferred. The pools are cheap because each is small; the union is broad because
the pools are chosen by different criteria. Crucially the relevance pool costs
exactly nothing for a reader with no coverage, because the pool is empty and the
query is not issued.

**C. Source-balanced pools.** Guarantee each source a fixed share of the
candidate set.

Rejected for this pass. The feed already balances *output* through
`applyDiversity` and `PAIRS_PER_PAGE`; balancing input as well would be a second
policy in a second place, and there is no evidence a source is being starved at
the candidate stage. Worth revisiting if measurement shows one is.

**D. Hybrid.** B, with the observation that the "unresolved/actionable" pool
already exists.

**Chosen: D.** See below.

## Why the actionable pool is not new work

`OPEN_PROPOSAL_STATUSES` + `proposalWindowDays` already give the trade-idea and
pair sources a status-bounded, 365-day window that ignores the feed's rolling
recency window entirely — `PROPOSAL_DAYS_BACK` exists precisely because "a
February idea nobody has executed is a live question today". That is an
unresolved/actionable pool: already built, already argued for, already tested.

Adding a third pool with the same intent would be a second implementation of a
rule the codebase already states once. So the strategy is B's *relevance* pool
added to the *recency* and *actionable* pools that exist, not three new ones.

## The relevance pool

For each of the four `.range`-paginated sources, a second bounded query
restricted to the assets this reader is responsible for:

```
build()
  .in('asset_id', retrievalAssetIdsFor(coverageIndex))
  .gte('created_at', coverageStart)      // 365d, not the 90d rolling window
  .order('created_at', desc).order('id', asc)
  .range(page * 8, page * 8 + 7)
```

Four decisions worth defending:

- **`direct` + `assigned` only, never `held`.** Coverage is a claim about
  attention; a holding is a fact about a portfolio. Retrieval follows the
  distinction `coverage-relevance.ts` already draws, so the book cannot flood
  the candidate set, and `held` keeps being what it was — a weaker scoring band,
  not a retrieval key.
- **Its own 365-day bound, not the 90-day rolling window.** The same argument
  `PROPOSAL_DAYS_BACK` already makes: the reason the item is a candidate is that
  the reader is responsible for the name, and that is not a fact about the
  calendar. Still bounded, just bounded by something other than scroll depth.
- **Page-aligned and non-overlapping** (`page * 8`), unlike the recency window,
  which is deliberately left as the overlapping `[offset, offset + 19]` it has
  always been. A pool that does not overlap itself cannot duplicate itself
  across pages.
- **Empty means absent.** No coverage, coverage not yet loaded, or an explicit
  single-asset filter, and the pool is empty and the query is never issued. A
  reader who has declared nothing gets a bit-for-bit unchanged candidate set,
  for zero extra requests. This is the retrieval-stage form of refusal 1 in
  `coverage-relevance.ts`.

`retrievalAssetIdsFor` lives in `lib/signals/coverage-relevance.ts` beside
`coverageWeightFor` and `desktopAssetRelevanceFor`, because it is a third
projection of the one `CoverageIndex` and not a new definition of "covered".
Putting it anywhere else is how a second definition starts.

## Pair trades are deliberately untouched

The pair source does not paginate like the others: it reads a growing leg window
(`pairLegWindow`) and slices *pairs* (`pairPageSlice`), because grouping has to
happen before slicing or a pair splits across a page boundary into two
half-pairs. It also spans two assets, so "is this pair covered?" is a question
with no settled answer yet — one leg, either leg, the long leg?

Giving it a relevance pool means answering that question and reworking the
grouping window at the same time. Both are real work and neither is required to
prove the ceiling is gone, so the pair source keeps its exact current strategy
in this pass. The only change it sees is the `id` tie-break below, which makes
its existing grouping deterministic rather than incidental.

## Deterministic order

Two orderings were previously incidental and are now explicit:

1. **Within a source query.** `.order('created_at', desc)` alone is not a total
   order — rows sharing a timestamp came back in whatever order Postgres chose,
   which also meant *which* rows fell inside `.range(...)` was undefined at a
   tie. Every source now adds `.order('id', asc)`.
2. **At the desktop ranking sort.** `scored.sort((a, b) => b.score - a.score)`
   had no tie-break, so equal-scoring cards could swap between renders — the
   exact failure `compareRanked` documents at length on the mobile side.
   Now: **score desc → created_at desc → id asc**.

Merging pools is order-deterministic by construction: pools concatenate in a
fixed order and the first occurrence of an id wins, mirroring the cross-page
dedupe already in `useIdeasFeed`'s `items` memo.

## Performance budget

Measured as request count and bounded row count per feed page, page 0,
`for_you`, no type filter.

| | Before | After (no coverage) | After (with coverage) |
|---|---|---|---|
| Source queries | 5 | 5 | 9 |
| Author/related lookups | 6 | 6 | 6 |
| **Total requests** | **11** | **11** | **15** |
| Source rows (max) | 98 | 98 | 130 |
| Serial round-trip depth | 2 | 2 | 2 |

Limits this pass commits to:

- **Zero** extra requests and **zero** extra rows for a reader with no declared
  or assigned coverage.
- **At most +4** requests and **+32** rows for a reader with coverage.
- **No increase in round-trip depth.** Each relevance query runs in the same
  `Promise.all` as its recency sibling, so the wall-clock cost is one query's
  latency, not four.
- **No growth in author lookups.** Pools merge *before* the author fetch, so the
  second query adds rows to an existing lookup rather than creating a new one.
- Candidate rows stay closed-form bounded:
  `4 * 20 + 4 * 8 + 18 * (page + 1)`.
- `.in()` is capped at `MAX_COVERAGE_ASSETS = 100` asset ids (~3.9 KB of URL),
  `direct` before `assigned`, id-sorted, so the request stays well inside
  PostgREST's URL limit and is deterministic when a reader covers more.

## Out of scope for this pass

Recorded so the next pass does not have to rediscover them:

- Porting judgment suppression to desktop.
- Folding `scoreFeedItem` into `priorityFor`, or retuning any weight.
- Removing `scoreFeedItem` from the candidate stage. It is a destructive
  pre-ranker for mobile (see below), but removing it means giving mobile its own
  consumer of `fetchIdeaCandidates`, which is the ranking-unification pass.
- The two coverage constants (0.12 desktop, 0.10 mobile) and the fact that one
  declaration is currently applied at both stages.
- The pair-trade relevance pool.
- Any desktop visual change.

## Should `scoreFeedItem` still run at the candidate stage?

Asked explicitly, because mobile discards the score it produces.

**It should stay, this pass.** The score is not wasted — desktop is its consumer
and orders directly on it. What is harmful is the `slice(0, PAGE_SIZE)` that
follows it, and that slice is harmful because the candidate set feeding it was
too narrow, not because scoring happened.

Widening the candidate set therefore fixes the membership defect without
restructuring the pipeline. The restructure — mobile calling
`fetchIdeaCandidates` directly and ranking the full pool with `priorityFor` — is
strictly better and strictly larger, and it belongs with ranking unification
where its reordering can be reviewed on captured feeds. The extraction in this
pass leaves that seam named and visible rather than performing it.

## Third ranker

`useUnifiedFeed` → `useRelevanceScoring`, consumed by `LegacyIdeaGeneratorPage`
(`src/pages/IdeaGeneratorPage.tsx:151`).

- **Reachable in production?** No. `LegacyIdeaGeneratorPage` is exported and
  imported by nothing; the only route renders `IdeaGeneratorPage`, which returns
  `<IdeasFeedPage />`. It is compiled into the bundle, and dead.
- **Shares candidate queries?** No. `useContentAggregation` runs its own reads,
  over a wider table set (`portfolio_notes`, `theme_notes`,
  `custom_notebook_notes` in addition to the feed's five).
- **Should this change affect it?** No, and it deliberately does not.
- **Worth recording for the unification pass:** `useRelevanceScoring` computes
  asset relevance from `watchlist_items` + `portfolio_holdings` — a *fourth*
  definition of "relevant to this reader", which never received the coverage
  seam. That is the strongest argument for deleting it rather than porting it.

## Measurement status

**Deterministic measurement: done.** `src/lib/ideas/__tests__/candidate-pools.test.ts`
runs the real `fetchSourceCandidates` against an in-memory table built to the
shape in the ticket — 25 recent items on undeclared names, one item on a
directly covered name 60 days old, one urgent item from today — and asserts both
halves of the claim:

| | Covered item (day 60) | Urgent recent item | Rows | Queries |
|---|---|---|---|---|
| Before (no coverage) | **not a candidate** | candidate | 20 | 1 |
| After (declares the name) | **candidate** | candidate | 27 | 2 |

Plus: it does not outrank the urgent recent item; another analyst's name is not
pulled in; a name that is both covered and recent appears once; consecutive
pages take disjoint slices of the relevance pool; a failing relevance query
degrades to the old behaviour rather than emptying the feed.

**Live staging measurement: not done, and deliberately not attempted.** It needs
an authenticated staging workspace, and this worktree has no `.env.local` and no
`.mcp.json` — both live only in the main checkout, and copying credentials into a
worktree was ruled out. The measurement is still worth taking before this ships;
the procedure, for whoever has the credentials:

1. Run the app against the root environment **without copying it**:
   `npm run dev -- --envDir C:/dev/Tesseract_v2`. Vite reads `.env.local` from
   that directory in place; nothing is written into this worktree.
2. Sign in to the staging workspace as a reader who covers at least one name
   whose most recent activity is older than the newest 20 rows of any source.
3. On the Ideas page, record the first 15 ids and the network panel's request
   count for the first page. That is BEFORE, if taken on `main`, and AFTER on
   this branch.
4. Repeat with a reader who has declared nothing. The two runs must be
   identical, including the request count — that is the property this change
   most needs witnessed on real data, because it is the one that protects
   everybody who is not using the feature.
5. Name the specific idea that was outside the old recency slice and is now a
   candidate. Without that one row, "the ceiling is gone" is a claim about code
   rather than about the product.
