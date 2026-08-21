# The asset universe, and how to get the rest of it in

Measured against production on 2026-08-20. Every number below is a query, not
an estimate, unless it says otherwise.

---

## 1. Where we actually are

`assets` holds **912 rows**, and they are all equities:

| asset_type | count |
|---|---|
| `stock` | 862 |
| `unknown` | 48 |
| `mutual_fund` | 1 |
| null | 1 |

So: **no ETFs, no crypto, no indices, no funds.** Not "few" — none. The
`asset_type` CHECK constraint already permits `etf`, `crypto`, `forex` and the
rest, so the schema has been ready for a while; nothing has ever written them.

Two other gaps worth naming, because they will bite during any bulk load:

- **506 of 912 rows have `exchange = 'Unknown'`** (210 NYSE, 194 NASDAQ, 1
  null, 1 `'N/A'`). Any dedupe or reconciliation keyed on exchange is
  currently keyed on a placeholder.
- **68 of 912 have a `current_price`.** The other 844 are names with no
  live quote at all.

Price history is thinner still. `price_history_cache`:

- **135 symbols**, 34,632 rows, **12 MB** including indexes
- ≈257 rows per symbol — about **16 months**, oldest bar 2025-04-25
- ≈**363 bytes per row**, all-in

The whole database is 423 MB.

And the number that decides the design: across all 27 organisations, only
**151 distinct assets are referenced by anything** — held in a portfolio,
attached to a trade, or carrying a price target. Out of 912 that we already
have, and out of the ~10,000 being asked for.

---

## 2. What the ask actually costs

"Russell 3000 plus crypto, ETFs etc" is roughly:

| | symbols |
|---|---|
| Russell 3000 constituents | ~3,000 |
| US-listed ETFs | ~4,000 |
| ADRs and other US listings not in the Russell | ~1,500 |
| Crypto worth having (top by market cap) | ~250 |
| **Total** | **~10,000** |

Ten years of daily bars is ~2,520 per symbol, so **~25 million rows**.

At today's row shape (363 B/row) that is **~9 GB** — against a 423 MB database.
At a leaner row shape (§5) it is **~2.5 GB**. Either way it is one to two
orders of magnitude more data than this project has ever held, and it is worth
being clear-eyed that this is the expensive part, not the symbol list.

---

## 3. The one decision that makes this easy or hard

Everything else in this document is detail. This is the decision.

**Today we fetch prices one symbol at a time.**
`scripts/backfill-price-history.mjs` calls Yahoo's chart endpoint per symbol.
That got us from 8 symbols to 132 and it works. Extended to the full ask it
becomes:

- **~10,000 requests** for the initial backfill, serialised behind whatever
  rate limit avoids a ban — hours, and fragile for the whole duration
- **~10,000 requests every night**, forever
- against an endpoint `docs/handoff.md` §5b already flags as undocumented,
  unlicensed, and a bot-interstitial risk in the same class as the iShares and
  Invesco pages that return HTTP 200 with HTML

That is not a scaling problem to be tuned. It is the wrong shape.

**A bulk end-of-day endpoint returns every US symbol for one date in a single
request.** Polygon's grouped daily aggregates
(`/v2/aggs/grouped/locale/us/market/stocks/{date}`) is the canonical one; there
are equivalents elsewhere. That turns the same job into:

- **~2,520 requests** for ten years of the *entire US market* — a few hours,
  once, and restartable per date
- **one request per night** thereafter
- from a licensed, documented, supported source with an SLA

Same data, three orders of magnitude fewer calls. It also removes the per-symbol
failure mode entirely: today one symbol returning an HTML interstitial is a
silent hole in one name's series; with grouped bars a date either lands or it
does not, and a missing date is trivially detectable and re-runnable.

**Recommendation: pay for a bulk EOD feed.** Last I knew, Polygon's entry paid
tier was around $29/month for unlimited end-of-day US equities with ten years of
history — please verify current pricing and limits before committing, as that
is from training data rather than from a page I read today. Crypto needs a
separate source either way; CoinGecko's free tier covers the top few hundred
coins with daily history and no key.

The rest of this plan works with Yahoo too. It just stays slow and legally
uncomfortable, and I would rather say that plainly than design around it.

---

## 4. Separate identity from history

The second decision, and the one that shrinks the problem by 20×.

`assets` currently conflates two things: **what instruments exist** and **what
we are working on**. That is why it has 912 rows — it grew by accretion from
what people happened to look at.

Split them:

**Every symbol gets an identity row.** Symbol, name, type, exchange, currency,
ISIN/FIGI where available, listing status. For 10,000 instruments that is a
couple of megabytes. This is what makes search, autocomplete, benchmark
membership and "is this a real ticker" work — and all of those are what the ask
is really about.

**Only referenced symbols get history.** A name earns a price series when
something points at it: held in a portfolio, on a watchlist, attached to a
trade or a case, or charted by a human. Today that is **151 names**. Give those
ten years each and it is ~380,000 rows — about 40 MB. The rest backfill on
first reference, which with a bulk provider is one request and a second or two.

So the steady state is not 25 million rows. It is a few hundred thousand,
growing only with actual use, plus a complete instrument directory that costs
almost nothing.

**Where this rule has an exception:** benchmark weights. Computing a historical
active weight against the Russell 3000 needs a close for every constituent on
every date, not just the ones we hold — that is a genuine full-universe series
and it should be scoped and budgeted as its own thing rather than smuggled in
under "add some symbols". The current SPY/benchmark work already does the
narrower version of this.

---

## 5. The table shape, if history does grow

Only worth doing if §4's tiering is rejected or the benchmark case lands.
`price_history_cache` at 363 B/row is roughly 3× heavier than it needs to be:

| current | cost | change |
|---|---|---|
| `id uuid` primary key | 16 B + index | drop it; `(asset, date)` is already UNIQUE and is the natural key |
| `symbol text`, repeated 25M times | ~10 B | a compact integer asset key: 4 B, and it survives ticker changes, which `symbol` does not |
| 4 × `numeric` OHLC | ~40 B | `double precision`: 32 B, fixed width, and enough precision for both equity prices and satoshi-level crypto |
| `source text` per row | ~10 B | per-symbol ingestion log instead — the source is a property of a load, not of a bar |
| `fetched_at`, `created_at` | 16 B | a per-symbol watermark table |

That lands near **100 B/row**: ~2.5 GB for the full 25M, versus ~9 GB.

Partition by year while doing it. Ten years in one table means every index is
ten years deep for a query that virtually always wants the last twelve months.

Note the ticker-change point above is not just about bytes. `price_history_cache`
is keyed on `symbol`, and `assets` already carries `current_symbol`,
`lifecycle_status` and `lifecycle_checked_at` precisely because tickers move.
A symbol-keyed history silently splits a company's series in two when that
happens. Keying on the asset fixes a correctness bug, not only a size one.

---

## 6. Where the symbols come from

**US-listed equities and ETFs — NASDAQ Trader.**
`nasdaqtraded.txt` is a public, stable, key-free pipe-delimited file listing
every US-listed security with an ETF flag, test-issue flag and financial status.
~11,000 rows, one HTTP request, refreshed nightly by the exchange itself. This
is the single best source for the "Russell 3000 + ETFs" shape of the ask, and it
needs no vendor relationship.

**One caveat, and it matters:** this gives the *listed universe*, not *index
membership*. If the requirement is genuinely "the Russell 3000" — as a
benchmark, for active weights — that is membership data, and it comes from
iShares IWV holdings (the scrape-risk path already documented) or a licensed
index feed. Worth deciding which is actually wanted, because "every US-listed
stock" and "the Russell 3000" are different products and only one of them is
free.

**Crypto — CoinGecko.** `/coins/markets` for the top N by market cap,
`/coins/{id}/market_chart` for daily history. Free tier, no key, generous
enough for a few hundred coins. The trap is symbol collision: crypto tickers
overlap equity tickers freely, so crypto rows need their own namespace from day
one — `asset_type` plus a source-qualified identifier, never bare `symbol`.

**Identity — FIGI.** OpenFIGI's free mapping API resolves ticker+exchange to a
stable instrument id. The `figi`, `isin`, `mic` and `identity_source` columns
already exist for this; nothing populates them yet. Doing it during the bulk
load is cheap; retrofitting it across 10,000 rows later is not.

---

## 7. Sequence

Each step is independently useful and independently revertible. Nothing here
requires the step after it.

1. **Decide the provider question** (§3) and the Russell question (§6). Both
   are yours, both change what gets built, and neither is reversible cheaply.
   Everything below assumes bulk EOD; say the word and I will re-cost it for
   per-symbol.

2. **Load the instrument directory.** NASDAQ Trader + CoinGecko top 250 into
   `assets` with real `asset_type`, `exchange`, `currency`. Idempotent, keyed
   on symbol+exchange. Fixes the 506 `'Unknown'` exchanges as a side effect.
   No history, no price. This alone gives working search and autocomplete
   across the whole universe.

3. **Add the reference-tier rule.** A view or table naming which assets have
   earned a history — currently 151. Make it explicit rather than implicit in
   whatever the backfill script happens to select.

4. **Re-shape `price_history_cache`** (§5) and key it on the asset rather than
   the symbol. Do this *before* the volume arrives, not after; it is a
   half-hour migration at 34k rows and a maintenance window at 25M.

5. **Swap the fetcher for bulk EOD.** `backfill-price-history.mjs` was written
   with this in mind — "the provider can be swapped by replacing
   `fetchDailyCloses` alone" — so this is genuinely a contained change.
   Backfill ten years for the reference tier.

6. **On-demand backfill.** First reference to an unpriced name triggers its
   history. One bulk request, sub-second, invisible to the user.

7. **Then, separately, benchmark membership** if the Russell answer in §6 is
   "the actual index". Own project, own budget.

---

## 8. What I need from you

- **Bulk EOD provider: yes or no.** Roughly $30/month, versus 10,000 nightly
  scrapes of an endpoint we are not licensed to use. This is the whole
  difference between "easily" and "not really".
- **Russell 3000 as a universe, or as an index?** Free versus licensed, and
  they solve different problems.
- **How much history?** Ten years is assumed above. Two years costs a fifth as
  much and covers every chart the app currently draws.
