# Capturing every instrument: indexes, ETFs, crypto, currencies

Written 2026-08-18. The provider layer already did this; the database could not
store the answer and nothing called the code that produced it. The storage half
was applied the same day with explicit sign-off. Nothing calls `search()` yet —
that is step 4, still open.

---

## 0. Where it actually stands

| Layer | State |
|---|---|
| `AssetType` union | **Done** — `stock, etf, mutual_fund, crypto, forex, commodity, index, bond, warrant, preferred, unknown` |
| `search()` per provider | **Implemented** — Yahoo, Alpha Vantage, IEX all return `assetType`, `exchange`, `currency`, `matchScore` |
| `SearchRequest.assetTypes` | **Implemented** — callers can already ask for a subset |
| Call sites | **ZERO.** Nothing outside the library calls `search()` |
| `assets` table | **Fixed 2026-08-18** — `asset_type`, `currency`, `isin`, `figi`, `mic`, `identity_source` added; see §2 |

So the gap is not provider coverage. It is that a search result has nowhere to
land, and nothing asks for one.

## 1. Fixed here, no migration

Every provider defaulted an unrecognised instrument to `'stock'`:

```ts
assetType: typeMap[match.securityType] || 'stock'
```

IEX was worst — bonds (`bo`), preferred stock (`ps`), warrants (`wa`) and
rights (`rt`) were all mapped to `stock` explicitly, not merely by fallback. A
bond arriving labelled as common equity is indistinguishable from a real match
and would size, weight and chart as an equity forever.

Now: unmapped → `'unknown'`, and IEX maps `bond` / `preferred` / `warrant`
honestly. Yahoo gained `FUTURE` and `OPTION`; Alpha Vantage gained `Currency`
and `Index`, both of which it emits and neither of which was mapped.

`src/lib/financial-data/__tests__/asset-type-mapping.test.ts` holds the line.
Proven by breaking the subject: restoring `|| 'stock'` and `'bo': 'stock'`
fails two assertions naming the file; restored.

## 2. The blocker — MIGRATION APPLIED 2026-08-18

`assets` is equity-shaped and has no way to say what a row is:

```
id, symbol, company_name, sector, industry, country, exchange, market_cap,
current_price, priority, process_stage, thesis, where_different,
risks_to_thesis, workflow_id, completeness, quick_note, thesis_references, ...
```

No `asset_type`. No `currency`. No stable identifier — `symbol` alone is
ambiguous across venues and asset classes, and `exchange` is free text.

Concretely, before this you could not store: an index (`^GSPC`), a currency
pair (`EURUSD=X`), a crypto pair (`BTC-USD`), or tell `TSLA` on Nasdaq from
`TSLA` on a European venue. Everything captured became an equity row with a
ticker. Applied as
`supabase/migrations/20260818141000_asset_instrument_identity.sql`:

```sql
BEGIN;

-- What the row IS. Nullable, because 911 existing rows predate it and guessing
-- their class would be the same fabrication this ticket exists to remove; a
-- backfill is a separate, reviewable step.
ALTER TABLE public.assets
  ADD COLUMN asset_type text
    CHECK (asset_type IN ('stock','etf','mutual_fund','crypto','forex',
                          'commodity','index','bond','warrant','preferred','unknown'));

-- The currency the instrument trades and is quoted in. Without it a "price"
-- is a number with no unit, and mixing them silently is a real risk once
-- non-US instruments land.
ALTER TABLE public.assets
  ADD COLUMN currency text;

-- Provider-independent identifiers. All nullable: no provider returns all of
-- them, and a NULL here means "not known", never "none".
ALTER TABLE public.assets ADD COLUMN isin text;
ALTER TABLE public.assets ADD COLUMN figi text;
ALTER TABLE public.assets ADD COLUMN mic  text;   -- ISO 10383 venue code

-- Which provider vocabulary the row was classified from, so a future
-- reclassification can find the rows it needs to revisit.
ALTER TABLE public.assets ADD COLUMN identity_source text;

CREATE INDEX IF NOT EXISTS assets_asset_type ON public.assets (asset_type);
CREATE UNIQUE INDEX IF NOT EXISTS assets_figi_key ON public.assets (figi) WHERE figi IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS assets_isin_mic_key ON public.assets (isin, mic)
  WHERE isin IS NOT NULL AND mic IS NOT NULL;

COMMIT;
```

**What it replaces:** nothing. Every column is additive and nullable, and no
existing constraint is dropped.

**Restore path:**

```sql
BEGIN;
DROP INDEX IF EXISTS public.assets_isin_mic_key;
DROP INDEX IF EXISTS public.assets_figi_key;
DROP INDEX IF EXISTS public.assets_asset_type;
ALTER TABLE public.assets
  DROP COLUMN identity_source, DROP COLUMN mic, DROP COLUMN figi,
  DROP COLUMN isin, DROP COLUMN currency, DROP COLUMN asset_type;
COMMIT;
```

Reverting discards any classification captured after the migration. Nothing
that existed before it is touched.

**Verification, asserting negatives:**

```sql
-- the CHECK actually rejects a bad class, rather than merely existing
insert into public.assets (symbol, asset_type) values ('__probe__','equities');
-- expect: ERROR 23514 check constraint violated

-- no row silently classified by the migration itself
select count(*) from public.assets where asset_type is not null;
-- expect 0 immediately after applying
```

## 3. Why `symbol` is not enough, stated plainly

The unique key today is effectively the ticker. That breaks the moment the
universe widens:

- `BRK.B` / `BRK-B` / `BRK/B` — one instrument, three provider spellings
- `TSLA` — Nasdaq and several European venues, different currencies
- `BTC-USD` (Yahoo) vs `BTCUSD` (others) vs `BTC/USD`
- `^GSPC` — an index, with no shares and no market cap, which every
  equity-shaped calculation in the product will happily divide by

FIGI is the identifier that survives all of this and is openly licensed.
ISIN + MIC is the fallback where FIGI is unavailable.

## 4. Order of work

1. ~~Stop mislabelling unmapped instruments as equities.~~ **Done**, §1.
2. ~~Sign off and apply the migration in §2.~~ **Done.**
3. Backfill `asset_type` for the 911 existing rows from provider search, writing
   `unknown` where no provider agrees rather than guessing.
4. Wire `search()` to the asset-creation path so new instruments arrive typed —
   it has zero callers today.
5. Gate the equity-shaped maths on `asset_type`. A weight is meaningful for
   anything holdable; market cap, sector and P/E are not meaningful for an
   index or a currency pair, and `buildActiveRiskCard` should suppress rather
   than render them.

Steps 1 and 2 are done. `assets` went 22 → 28 columns; 911 rows untouched and
**0 classified by the migration**, because it stores nothing it would have had
to guess.

Verified by asserting both directions: `asset_type = 'equities'` is rejected
with `23514`, and `^GSPC` inserts cleanly as `index` / `USD` / `XNYS` (rolled
back). An index is now storable as an index rather than as an equity with a
ticker.

Steps 3 and 5 are done. Step 4 is addressed by §6 below, by a different route
than originally planned — `search()` still has zero callers, but the hole it
was meant to plug is closed.

## 5. Ticker changes and delistings — DONE 2026-08-18

Nothing handled these. `symbol` was the de-facto identity, so an issuer rename
silently ended the price series while the position stayed held. SQ (Square →
Block, now XYZ) and ZOOM had **zero** rows in `price_history_cache` and were
both held; `buildWeightSeries` correctly skipped every day for their books,
with the reason recorded nowhere.

`20260818150000_asset_lifecycle.sql` adds `lifecycle_status`,
`current_symbol`, `lifecycle_checked_at` and `lifecycle_note`. Additive and
nullable; classifies nothing.

**`asset_type = 'unknown'` was answering two questions at once** — WHAT is this
and DOES IT STILL TRADE. A bond and a delisted equity were indistinguishable to
it. `lifecycle_status` answers only the second, with four values:

| Value | Meaning |
|---|---|
| `active` | resolves under its own ticker |
| `renamed` | same instrument, new ticker; `current_symbol` holds it |
| `delisted` | no chart and no search result — acquired, merged, wound up |
| `unresolved` | asked, ambiguous. NOT a verdict; a person must decide |

NULL still means nobody looked.

`scripts/resolve-instrument-lifecycle.mjs` classified all 48: **8 renamed**
(SQ→XYZ, BK→BNY, FI→FISV, MMC→MRSH, PEAK→DOC, SIX→FUN, ZI→GTM, ZOOM→ZM),
**34 delisted**, **6 unresolved**.

### Why the match is verified, not taken

Searching "Zoom Video Communications" returns `5ZM.DU`, `5ZM.HM` and `5ZM.SG` —
Düsseldorf, Hamburg, Stuttgart — *before* any US listing. Taking the first
result would move a US position onto a German venue in euros and report
success. A candidate is accepted only when it is a primary US listing AND its
issuer name matches ours after normalisation.

That strictness refused ZOOM→ZM, because ZM now reports "Zoom Communications,
Inc." — the company dropped "Video" in 2025. The fix is a **reviewed override
with its evidence recorded**, not a looser matcher: loosening the name match is
how "Block" becomes "H&R Block". Overrides are re-verified against the provider
on every run, so a stale one surfaces instead of being trusted forever.

### `symbol` is never overwritten

`current_symbol` holds the live ticker; `symbol` stays as the holdings file
said it. Rewriting history to match the present would make old uploads
unreconcilable. Price lookups use `coalesce(current_symbol, symbol)`;
provenance keeps `symbol`, so a card still says SQ while its chart comes from
XYZ.

Result: the backfill went from **132 of 134 symbols with 2 failures** to
**134 of 134 with none**, and both held renamed positions now carry 251 closes
each. Delisted names are skipped rather than re-requested nightly to be told
404 forever.


## 6. Orphaned positions — the real cost of "search() has zero callers"

Done 2026-08-18.

There is no path in this product from "an instrument exists in the market" to
"an instrument exists in our database". `search()` is implemented on all three
providers and called by nothing; the only `searchAssets` in the app runs
`ilike` against the local table and can therefore only find what is already
there. All 911 assets arrived in two bulk seeds.

The consequence is at the ingest boundary, and it is worse than untyped
metadata. `holdings-api` does this with a symbol it cannot match:

```js
warnings.push(`Unresolved symbols: ...`)      // read by NOTHING
asset_id: assetMap.get(p.symbol) || null      // inserted anyway
```

The position is **not** rejected. It lands with a null foreign key and a raw
ticker, so it can never join to a price, a benchmark weight, an `asset_type`,
or a card. It looks like a successful upload and is invisible to the entire
product.

**Measured: 26 positions, $13.6m, all DUOL** — Duolingo, an entirely ordinary
live listing that simply was not in `assets`. Nothing reported it for as long
as it had been there, because nothing reads `warnings`.

### The fix, and why it is a reconciler rather than an edge-function change

`scripts/reconcile-orphan-positions.mjs`, wired into the nightly workflow after
the price job so a newly created asset is priced the same night.

The edge function is the right long-term home and should do this at ingest too.
But changing it means deploying a live production function, and it would only
help FUTURE uploads — the 26 already orphaned would have stayed invisible. The
reconciler closes the existing hole and every future one within a day, with no
deploy, on a schedule that already exists and is already guarded.

### What it will not do

It creates an asset **only** when the provider resolves the ticker, and then
creates it already classified — `asset_type`, `currency`, `lifecycle_status`,
`identity_source` — so a new name never needs the retroactive pass the first
911 rows needed.

It does **not** invent a row for a ticker the provider does not recognise. A
typo in an upload would otherwise mint permanent junk that every screen then
has to ignore. Those are reported by symbol and by position count and dollar
value, so a person can see exactly what is invisible and how much of it there
is — which is what `warnings` was for and never achieved.

An exact ticker lookup is used rather than name search: at ingest a symbol is
all there is, so the venue-ambiguity guard that makes name matching safe in
`resolve-instrument-lifecycle.mjs` is not available here. A ticker either is
that instrument or it is not.

### Still worth doing

Fixing `holdings-api` itself, so an unmatched symbol is resolved at upload
rather than up to a day later, and so `warnings` either gets a reader or stops
pretending to be one.
