# Data platform stage 2: scale-safe asset access and canonical market reads

Written 2026-09-08 on `feat/data-platform-v1`, on top of `5d069c1`. Continues
`data-platform-foundation.md`; read that first. No migration applied, nothing
deployed, no provider connected.

---

## 1. The unsafe asset reads, exactly

Stage 1 said "seventeen". **The real figure was 16, and it is now 12.** The
overcount came from counting three test-file string fixtures as call sites and
mis-subtracting. Two further entries turned out to be false positives — the
scanner cut a statement at a blank line and missed a later `.limit(20)` on
`AddAssetToThemeModal` and a conditional `.eq('id', …)` on `AssetTab`. Both are
safe.

The twelve that remain, with the shape each actually needs:

| # | Site | Category | Correct shape |
|---|---|---|---|
| 1 | `hooks/lists/useScreenResults.ts:75` | A full universe | paged traversal — **migrated** |
| 2 | `components/modals/UniversePreviewModal.tsx:143` | A id-set complement | `allIds()` — **migrated** |
| 3 | `components/workflow/CreateWorkflowWizard.tsx:969` | A id-set complement | `allIds()` — **migrated** |
| 4 | `components/coverage/CoverageManager.tsx:538` | B picker | paged `search()` |
| 5 | `components/coverage/CoverageManager.tsx:842` | A full universe | paged traversal |
| 6 | `components/coverage/CoverageManager.tsx:1373` | A full universe | paged traversal |
| 7 | `components/coverage/CoverageManager.tsx:1430` | A full universe | paged traversal |
| 8 | `components/mobile/MobileCoverage.tsx:77` | B picker | paged `search()` |
| 9 | `components/portfolio/InvestableUniverseSection.tsx:64` | A full universe | paged traversal |
| 10 | `components/tabs/PortfolioTab.tsx:249` | A full universe | paged traversal |
| 11 | `components/projects/CreateProjectModal.tsx:234` | B picker | paged `search()` |
| 12 | `pages/AssetsListPage.tsx:31` | F admin list | paged traversal or a page-at-a-time table |

Categories C (asset-id resolution), D (symbol resolution) and E (small
contextual lookup) appear nowhere in this list, because those call sites are
already narrowed — they were never the problem. The problem is entirely A, B
and F: three shapes, twelve copies.

Two further reads are unpaged but currently self-limiting, and are latent
rather than broken:

- `hooks/mobile/useTickerAliases.ts:53` filters `current_symbol is not null`,
  which is 8 rows today. Renames scale with the universe, so at 10,000 names
  this can cross the cap and start losing aliases — which presents as charts
  disappearing for renamed instruments.
- `supabase/functions/holdings-api` resolves an upload with a single
  `.in('symbol', …)`, subject to the same cap plus a URL-length ceiling.
  Holdings-lane owned; see §7.

### Lane overlap

| Site | Lane | Touched here |
|---|---|---|
| `MobileCoverage.tsx` | Mobile Experience | no |
| `useTickerAliases.ts`, `useSymbolHistory.ts` | Mobile Experience | no |
| `CoverageManager.tsx` (×4) | Coverage | no |
| `InvestableUniverseSection`, `PortfolioTab` | Portfolio | no |
| `holdings-api` | Holdings | no |
| `useScreenResults`, `UniversePreviewModal`, `CreateWorkflowWizard` | Lists / Workflow — no active lane | **yes** |

## 2. Root cause

One cause, not twelve. There is no shared way to read `assets`, so each site
invented the simplest thing that worked at 911 rows: select everything, filter
in React. That is correct until the response is capped, and the cap is silent —
PostgREST returns 1,000 rows and HTTP 200.

The secondary cause is that the identity columns applied in August
(`current_symbol`, `mic`, `figi`, `isin`, `lifecycle_status`) have no reader, so
a call site that wants "the asset for this ticker" writes `eq('symbol', …)` and
gets a rename wrong, a cross-listing wrong, or a delisting wrong — silently in
all three cases.

## 3. Canonical asset access

`src/lib/market-data/asset-access.ts`, plus a thin Supabase binding in
`supabase-asset-source.ts`.

```
byId(id)                    one asset, by the only stable identifier
byIds(ids)                  batch, chunked at 200 for URL length
resolveSymbol(sym, {mic})   server-narrowed, then the pure resolver
search(q, {limit, page})    server-side ilike, paged, delisted hidden by default
universePages(opts)         async iterable, keyset paged
allRows(opts)               the whole universe, completely or not at all
allIds(opts)                every id, for a set complement
symbolIndex(opts)           the whole universe as a resolution index
```

Three design points that are not obvious:

**The source is injected as a plain function.** The module never imports
`src/lib/supabase`. `scripts/gallery-purity.mjs` asserts the gallery entry has
no path to the client, so a market-data module that reached for the singleton
would put every consumer one hop from breaking that guard. It also means the
>1,000 tests run against an in-memory table that emulates the row cap exactly,
rather than against a mock of the PostgREST builder — a test of a mock proves
nothing about truncation.

**The contract never implies a ticker is unique.** `resolveSymbol` returns a
`SecurityResolution`, so a two-venue ticker comes back `ambiguous` with its
candidates. The narrowed read deliberately asks for up to 32 rows rather than
1: asking for one row would convert an ambiguity into a silent pick, which is
the failure the whole identity model exists to prevent.

**No provider identifier is required anywhere.** `assetId` is the key. FIGI and
ISIN are optional inputs to `securityKey` and never a required application key,
so replacing a provider cannot orphan a row.

## 4. Scale-safe search and paging

Two paging modes, deliberately different:

**Universe traversal uses keyset on the primary key.** Offset paging over a
table being written to can return a row twice and skip another, because the
window is positional and the positions move. A skipped asset is invisible — it
looks exactly like an asset that does not exist — so the universe read gets the
mode that cannot skip. A source that ignores the cursor throws rather than
looping, which turns a hung tab into an error.

**Search uses an offset window plus one extra row.** A search is already
narrowed and a user rarely walks past a few pages, so the ordering instability
that rules out offset for the universe does not bite. The extra row answers
"is there a next page" without the second scan an exact count costs on every
keystroke. Page size is capped at 200 so a caller cannot defeat paging by
asking for everything.

Search ordering is `symbol, id`. `symbol` alone is not unique — the same ticker
on two venues is two rows — and an unstable order between them lets a page
boundary drop one and repeat the other.

The Supabase binding escapes both filter grammars: `%` and `_` are stripped
because they are `ilike` wildcards and a user typing `%` would otherwise match
the whole universe, and values going into an `or=()` group are double-quoted
because a comma there ends a filter.

**No index is required for this to be correct.** It is required for it to stay
fast; see §12.

## 5. Canonical market-data read contract

`src/lib/market-data/reads.ts`. `MarketDataReader` has two methods,
`latestClose(ref)` and `closeSeries(ref)`, both taking a `SecurityRef` rather
than a string and both returning `Observed<…>` plus a `FreshnessVerdict`.

Taking a ref rather than a symbol is the point. The cache is keyed by the
traded ticker and a card shows the recorded one; passing the wrong one returns
an empty series, which renders as no chart and reads as missing data. With a
ref the caller cannot pass one where the other belongs.

What the seam preserves: canonical `assetId` via the ref, `displaySymbol` for
the reader, `effectiveAt` (the close date) and `observedAt` (the row's
`fetched_at`), `currency` from the asset, `source` split into provider and
feed, and the freshness verdict with its data class.

`adjustment` comes back `unknown` for every row, because
`price_history_cache` does not record it. That is a finding, not an omission:
two closes spanning a split are genuinely incomparable today, and
`areComparable` refuses rather than pretending. Inventing a value here would
hide the gap behind a plausible default.

The three existing paths are untouched and keep working.

## 6. ProviderManager disposition: partly reusable

Not worth adopting as a runtime; worth keeping as a set of types.

**Reuse:** `IFinancialDataProvider`, the declared `ProviderCapabilities`, and
the error taxonomy (`RateLimitError`, `InvalidSymbolError`,
`ProviderUnavailableError`). These are the parts Stage 1's `ProviderAdapter`
and `AdapterFailure` already converge on, and a real adapter should be written
against the newer contract with those as the reference.

**Obsolete:** the manager's runtime. It holds an in-memory `Map` cache with a
five-minute TTL and a one-minute `setInterval` health poll. In the browser this
duplicates React Query, which the whole app already uses for exactly this and
does it better (dedup across components, invalidation, devtools); the interval
is a background timer per instance with no owner. On the server the nightly
ingestion already owns pacing, retries and idempotency, and does so with a
concurrency group and a failure issue. There is no third context that wants a
long-lived stateful manager.

**The deeper reason it has no callers is not neglect.** Its `Quote` has no
currency, no venue and no adjustment basis, so nothing it returns can be safely
compared to anything else — which is the same defect `browser-client` has. A
consumer that adopted it would gain a fallback ladder and still not know what
unit its number was in.

Recommendation: leave it in place, write the first real adapter against
`ProviderAdapter`, and delete the manager when the last provider file moves
across. Deleting it now would be churn with no consumer either way.

## 7. Symbol change and alias behaviour

Proven in `__tests__/reads.test.ts`, using the real case:

```
recorded symbol   SQ           what the holdings file said; never overwritten
current symbol    XYZ          what it trades as now
asset id          one          both tickers resolve to it
cache key         XYZ          what the series is stored under
display symbol    SQ           what the card says
```

`resolveSymbol('SQ')` and `resolveSymbol('XYZ')` return the same `assetId` and
the same `pricingSymbol`, so two consumers holding different strings cannot end
up treating one instrument as two investments. The reader asks the cache under
`XYZ` and reports `SQ`.

Alias resolution now happens in the source query — matching `symbol` OR
`current_symbol` — rather than by loading a client-side alias map. The mobile
`useTickerAliases` map remains valid and is untouched; it is a second copy of
the same fact, and consolidating it is a Mobile-lane change.

### Holdings seam, reported not taken

Unchanged from Stage 1 and now concrete. `holdings-api` matches an uploaded
symbol with `.in('symbol', symbols)` and inserts `asset_id: null` on a miss.
Three defects follow, and `assetAccess` addresses all three without any change
to holdings semantics:

1. a renamed instrument does not match, because only `symbol` is compared
2. a symbol on two venues matches arbitrarily
3. an upload with more than 1,000 distinct symbols silently truncates

The drop-in is `byIds`/`resolveSymbol`, or `symbolIndex()` for a whole file at
once. Adopting it is a Holdings-lane decision because the visible change is
that some uploads would begin reporting ambiguity where they previously
reported success.

## 8. Freshness refinement

The five-day constant is kept and is now explicitly scoped. `FreshnessPolicy`
gained two required fields:

- `dataClass` — `intraday_quote`, `daily_close`, `reference`, `fundamental`,
  `estimate`. Five distinct windows, so no class's number can become the
  product's definition of "fresh".
- `basis` — `calendar` or `session`. Only `calendar` exists. It is carried on
  the policy AND echoed on every verdict now rather than added later, so a
  surface can already distinguish "older than our conservative window" from
  "the exchange has published something newer". Those are different claims and
  only the first is provable without a market calendar.

Making both required is deliberate: it broke the one place that built a policy
inline, which is the point of a required field.

No exchange calendar is built. Adding `session` is a new policy and a new
implementation of the age computation, not a change to any call site.

Windows: 15 minutes, 5 days, 90 days, 130 days, 14 days respectively. Only the
market-data three form an ordered scale, and the test asserts only that
ordering — `reference` and `fundamental` are bounded by different things (a
corporate action, a reporting cycle) and asserting an order between them would
be inventing a relationship to make a test tidy.

## 9. Consumers migrated

Three, chosen for zero overlap with Mobile, Tile Engine, AI or Holdings:

- `useScreenResults.ts` — the highest-correctness one. A saved screen was
  evaluating the first 1,000 tickers by symbol and reporting a clean result.
  Now pages completely; still exactly one request at 911 rows.
- `UniversePreviewModal.tsx` and `CreateWorkflowWizard.tsx` — both used
  `select('id')` with no limit to compute a set complement for an `exclude`
  rule, which past the cap turns "everything except these" into "the first
  thousand except these".

Plus `backfill-links.ts` from Stage 1. Four of sixteen.

## 10. Remaining migration plan

Ordered by risk, lowest first. None is urgent below ~1,000 assets; all are
required before the universe grows past it.

1. **`AssetsListPage.tsx`** — no lane. Swap to `allRows` or, better, a
   page-at-a-time table.
2. **`InvestableUniverseSection.tsx`, `PortfolioTab.tsx`** — Portfolio lane.
   Identical query in both; they should share one hook. Filter menus are
   derived from the result, so truncation removes whole sectors from the menu
   rather than from the results, which is the harder failure to notice.
3. **`CreateProjectModal.tsx`** — no lane. Picker; move to `search()`.
4. **`CoverageManager.tsx` (×4)** — Coverage lane. Two are pickers and two are
   filter-evaluation universes; they should not share a shape.
5. **`MobileCoverage.tsx`** — Mobile lane. Picker; move to `search()`.
6. **`useTickerAliases.ts`** — Mobile lane. Latent; consider folding into
   `assetAccess` rather than paging a second copy of the mapping.
7. **`holdings-api`** — Holdings lane. See §7.

A guard that fails a NEW unbounded `assets` read is worth adding once the count
is low enough to gate at zero. Adding it now would need a twelve-entry
allowlist, which is a ratchet nobody reads.

## 11. Proof at scale

`__tests__/asset-access.test.ts`, against an in-memory table that caps every
response at 1,000 rows exactly as the server does:

- 1,001 assets returned in full, not the first 1,000
- 5,000 assets returned in full, all ids distinct
- an asset at index 4,321 is reachable, and index 1,000 is the row a single
  request can never see
- traversal is keyset, cursors advance, three pages for 2,500 rows
- a source that ignores the cursor throws instead of looping
- a search match beyond the thousandth row is found
- a search result on page 2 is reachable and the last page is detected without
  a counting request
- the same ticker on two MICs stays two rows and resolves `ambiguous`
- `SQ` and `XYZ` resolve to one `assetId` and one cache key
- a delisted instrument is hidden from a picker by default, returned on
  request, and still resolvable by ticker

## 12. Database changes now justified

Still **nothing applied and nothing required to make the code above correct.**

| # | Change | Why | Current failure | Risk | Before pilot? | Before >1,000? |
|---|---|---|---|---|---|---|
| 1 | `pg_trgm` GIN index on `assets(symbol, company_name)` | `search()` is `ilike '%q%'`, a sequential scan | none — correct, and unmeasured | low; additive, `CREATE INDEX CONCURRENTLY` | no | **yes** |
| 2 | `price_history_cache.currency` | a close has no unit | none while every instrument is USD | low; additive nullable | no | **yes**, the moment a non-US listing lands |
| 3 | `price_history_cache.adjustment` | a close has no basis | two closes spanning a split compare as one series | low; additive nullable | no | **yes** |
| 4 | populate `assets.mic`, demote `exchange` to a label | `exchange` is free text; 506 of 912 say `Unknown` | venue dedupe keys on a placeholder | medium; a backfill with a review step, not DDL | no | **yes** |
| 5 | `price_history_cache.asset_id` | history keyed by ticker splits on a rename | masked today by `current_symbol` resolution | medium; needs a backfill and a cutover | no | yes — and cheap now at 34k rows, expensive at 25M |
| 6 | server-side search RPC | — | **not justified.** PostgREST `or` + `ilike` + `range` covers every shape needed | — | no | no |

Items 2, 3 and 5 are one migration, and `docs/asset-universe.md` §5 already
owns the reshape. Item 6 is listed to record that it was considered and
rejected: nothing in §4 needs SQL that PostgREST cannot express.

## 13. Guard registration

`src/lib/market-data` is registered in the `guard:unit` path list in
`package.json`, which is this branch's mechanism. When this lane merges into
QA, that scope must be carried over as a gated directory under the newer
`unit-guard.mjs` / `GATED_DIRS` architecture — the path list here is not to be
resurrected. Nothing in the module depends on which mechanism runs it.
