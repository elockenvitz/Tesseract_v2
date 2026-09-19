# Data platform: provider-neutral foundation

Written 2026-09-08 on `feat/data-platform-v1`. Audit plus the first bounded
implementation. No migration is proposed here and none is applied.

**Read `docs/asset-universe.md` first.** It measured production on 2026-08-20
and already owns the volume question: 912 assets against a ~10,000 target,
135 symbols in `price_history_cache`, the bulk-EOD-provider decision, the
reference-tier rule, and the `price_history_cache` reshape that keys history on
the asset rather than the symbol. Nothing here supersedes it.

This document covers what that one does not: the **application-layer** blockers
between the current universe and a larger one, and the provider-neutral seams
that keep a real feed from spreading a vendor's vocabulary through the product.
The one number worth carrying across is that its target is ~10,000 names, which
is **ten times** the cap described in §2 below.

---

## 0. Where it actually stands

The instrument-identity work in `instrument-universe.md` is real and applied:
`assets` carries `asset_type`, `currency`, `isin`, `figi`, `mic`,
`identity_source`, `lifecycle_status`, `current_symbol`. The nightly ingestion
in `.github/workflows/ingest.yml` is written, credentialled and idempotent.

What is missing is not schema. It is that nothing provider-neutral reads any of
it, and three separate market-data paths exist that share no types.

| Path | Consumers | Identity | Provenance |
|---|---|---|---|
| `browser-client.ts` (Alpha Vantage → Yahoo → Finnhub) | 18 components | raw ticker | a `timestamp`, no currency, no venue, no adjustment |
| `price_history_cache` read directly | ~25 modules | raw ticker | `source`, `fetched_at` on the row, read by nothing |
| `ProviderManager` + `providers/*` | **zero** | `SearchResult` | `ProviderResponse` envelope |

The third is a well-built abstraction with no callers, which is the same
condition `instrument-universe.md` §6 documents for `search()` — and whose real
cost there was 26 orphaned positions worth $13.6m that nothing reported.

## 1. Canonical identity, and where it is not used

`price_history_cache` is keyed by `symbol TEXT`. Not `asset_id`, not a FIGI, no
`mic`, no `currency`, no adjustment basis. Every identity column added in August
lives on `assets` and is read by exactly one code path outside the classifier
scripts: `useTickerAliases`, which resolves `current_symbol` for mobile charts.

So the effective canonical identity of an instrument, product-wide, is still an
uppercased ticker string:

- **holdings** — `holdings-api` matches `.in('symbol', symbols)` and inserts
  `asset_id: null` on a miss
- **research, notes, targets, portfolio** — `assets.id`, resolved from a ticker
  at some earlier point
- **charting, Tile Engine inputs, dashboard** — the ticker, against
  `price_history_cache`
- **search** — `ilike` on `symbol` and `company_name`, no index

Two of these disagree by construction. A card says `SQ` and the cache holds
`XYZ`, and only the mobile path knows.

## 2. The scale blocker, with the number

PostgREST on this project is configured `max_rows: 1000`. `usePriceHistory` and
`backfill-price-history.mjs` both document it. **Seventeen call sites select
from `assets` with no `.limit()` and no filter**, loading the whole table to
filter it in the browser.

At 911 rows every one of them is correct. Past 1,000 none of them fails —
PostgREST returns the first 1,000 rows and HTTP 200. Concretely:

- `useScreenResults` screens a universe missing everything after the thousandth
  ticker and reports a clean result
- `InvestableUniverseSection` and `PortfolioTab` build their sector, industry,
  country and exchange filter menus from the truncated set, so whole sectors
  disappear from the menu rather than from the results
- `CoverageManager` (four sites) offers a coverage picker that cannot see part
  of the universe
- `backfill-links` builds a ticker-to-asset map that silently stops linking
  mentions late in the alphabet

This is the single largest blocker to the >1,000-name target, it produces wrong
answers rather than errors, and it arrives exactly at the size the target names.

Secondary, and slower rather than wrong:

- no trigram index on `assets`, so `ilike '%q%'` search is a sequential scan
- no generated database types anywhere in the repo, so every `.select('...')` is
  an unchecked string — which is why `assets-restricted-columns.test.ts` has to
  be a grep
- `holdings-api` resolves symbols with a single `.in()`, which has both the
  1,000-row cap and a URL-length ceiling on a large upload

## 3. What was built

`src/lib/market-data/`, four independent pieces, none of which touch a network,
a database or a provider.

**`identity.ts`** — `SecurityRef`, `securityKey`, `resolveSecurity`,
`buildSymbolIndex`. The canonical key precedence is FIGI, then ISIN+MIC, then
MIC+symbol, then symbol marked `ambiguousByConstruction`. ISIN alone is
deliberately never a key: it spans venues, so keying on it merges a Nasdaq line
and a Frankfurt line into one instrument with two currencies.

A lookup that is genuinely ambiguous returns `ambiguous` with its candidates,
never a first match. Two live venues sharing a ticker is an error the caller
must resolve with a `mic`; one live and one delisted is a tie the live line
wins.

**`freshness.ts`** — `Observed<T>`, `assessFreshness`, `areComparable`. The one
decision that matters: **freshness is measured from `effectiveAt`, not
`observedAt`**. A fetch performed seconds ago that returned a March close is a
fresh request carrying a stale fact, and the fact is what a reader prices a
trade against. `observedAt` is kept because it answers the other question — is
the pipeline running — and only it can tell a quiet market from a dead feed.

`DAILY_CLOSE_POLICY` is five calendar days, derived rather than picked: a close
carries a date, so `effectiveAt` parses as midnight while the close happened
around 20:00 UTC; Friday's close is the latest available until the nightly job
runs at 22:00 UTC, and with Monday a holiday that is Tuesday, giving a
legitimate age of 4 days 22 hours.

**`contracts.ts`** — `ReferenceRecord`, `PriceBar`, `PriceSeries`,
`PriceQuote`, `AdapterCapabilities`, `AdapterFailure`, `ProviderAdapter`.
Capabilities are declared, not probed, so "this provider never supported
international venues" does not trigger the retry ladder meant for "this provider
is down". Failures are discriminated because `unknown_symbol` and `rate_limited`
need opposite responses and arrive identically today — Yahoo returns HTTP 200
with an HTML body when it blocks us.

**`paging.ts`** — `fetchAllRows`, `assertComplete`, `POSTGREST_MAX_ROWS`. Pages
past the server cap and **throws rather than returning a prefix**, converting the
silent wrong answer into a loud one.

Wired into `backfill-links.ts`, the one pure data-layer site among the
seventeen. The remaining sixteen are UI components owned by other lanes and are
listed above for those lanes to take.

## 4. Tests

`src/lib/market-data/__tests__/`, 60 assertions, registered in `guard:unit`.

The identity cases are the ones the schema already proves are real: the eight
renames and thirty-four delistings `resolve-instrument-lifecycle.mjs`
classified, the Zoom search that returns three German venues before any US
listing, and the `BRK.B` spelling `backfill-price-history.mjs` rewrites by hand.
A 5,004-instrument universe asserts the index gives the same answers as the
linear resolver, refusals included.

`vendor-leak.test.ts` is a ratchet. Two vendor field names reach application
code today — `usePriceHistory` reads `meta.regularMarketPrice` off an untyped
response and `ChartView` renders `quoteData.regularMarketPrice` into JSX — and
both are named with what they cost. The count may only go down. It caught its
own author: `AdapterCapabilities.latestPrice` was IEX's word for a number the
contract already had, renamed to `spotQuote`.

## 5. Database changes required later, if any

**None from this lane, and none applied.** Everything above works against the
current schema.

`asset-universe.md` §5 already owns the `price_history_cache` reshape —
asset-keyed rather than symbol-keyed, `double precision` OHLC, per-symbol
watermark instead of per-row `fetched_at`, partitioned by year — and its
argument that this is a correctness fix rather than a size one is right. Two
things to add to that list when it is picked up, both cheap while the table is
34k rows:

1. **`currency` and `adjustment` on the series.** A close is currently a number
   with no unit and no adjustment basis, so a non-US instrument or a stock
   split makes two rows silently incomparable. `areComparable` in
   `freshness.ts` is the predicate that wants them.
2. **`assets.mic` populated, `exchange` demoted to a display label.** The `mic`
   column exists and is empty; 506 of 912 rows carry `exchange = 'Unknown'`
   and the rest mix "NASDAQ", "NasdaqGS" and "XNAS" for one venue. Any dedupe
   keyed on `exchange` is keyed on a placeholder. `asset-universe.md` §7 step 2
   fixes this as a side effect of loading the instrument directory.

One further item, only when measured: a `pg_trgm` index on
`assets (symbol, company_name)`. Search is `ilike '%q%'` today, which is a
sequential scan at any size; at 912 rows nobody notices and at 10,000 it wants
checking before it wants fixing.

## 6. Holdings seam, reported not taken

The Holdings lane owns `portfolio_holdings`, the event ledger and
reconciliation. Nothing here touches them. The seam the security master will
eventually need:

`holdings-api` currently matches an uploaded symbol with
`.in('symbol', symbols)` and inserts `asset_id: null` on a miss, pushing the
ticker into a `warnings` array nothing reads. `buildSymbolIndex` is the
drop-in replacement — it resolves renames under both tickers, keeps delisted
instruments reachable so a 2023 file still reconciles, and returns `ambiguous`
rather than picking a venue. Adopting it is a Holdings-lane decision, because
the behaviour change is that some uploads would start reporting ambiguity where
they previously reported success.

## 7. Provider evaluation criteria

`asset-universe.md` §3 already frames the load-bearing commercial decision —
bulk EOD versus per-symbol, which is one nightly request against ~10,000 — and
that question is still open. These are the capability criteria that sit under
it, ordered by what would break Tesseract rather than by price.

**Disqualifying if absent**

- US equity reference data with an exchange identifier that is a MIC, not a
  free-text venue name
- adjusted daily history with the adjustment basis stated per series
- corporate actions sufficient to detect a ticker change, or the delisting of a
  held name — the SQ→XYZ class of failure is silent without it
- commercial redistribution terms that permit showing prices to a client's users
  inside a paid product; several free tiers explicitly do not
- a stable identifier that is not the ticker: FIGI preferred, ISIN acceptable
  when it comes with a venue

**Weighted**

- coverage of ETFs, indexes and ADRs, which `asset_type` can already store and
  the product will meet immediately at a thousand names
- documented rate limits and a published status history
- bulk or point-in-time security-master delivery, so the initial load is not
  N single-symbol requests
- delayed quotes are sufficient; real-time is not currently a product need

**Explicitly not a criterion**

- price alone. The current stack is free and its cost is the three parallel
  paths and the silent failures above.

Nothing here selects a vendor and no signup or purchase was made.

## 8. Remaining stages

1. **Adopt the paging seam** across the sixteen remaining unbounded `assets`
   reads. Mechanical, and each one is a lane-owned UI file.
2. **First real adapter** implementing `ProviderAdapter` over the existing
   Yahoo path, so `usePriceHistory` and `ChartView` stop naming vendor fields
   and the ratchet goes to zero.
3. **`price_history_cache` gains identity** — `asset_id`, `currency`,
   `adjustment` — once an adapter exists to populate them.
4. **Backfill `mic`** and demote `exchange` to a label.
5. **Freshness surfaced**, so Tile Engine and the AI layer can read a
   `FreshnessVerdict` instead of inferring one from a timestamp. Contract only
   in this lane; the consumers are other lanes.
6. **Ingestion hardened for a metered provider** — the current nightly job
   paces a free endpoint at 250ms and retries on failure. A provider with a
   published budget wants that budget declared in `AdapterCapabilities` and a
   scheduler that reads it.
