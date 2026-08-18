/**
 * What an asset actually IS.
 *
 * `assets` was equity-shaped: symbol, company_name, sector, industry, country,
 * exchange, market_cap, current_price. No way to say whether a row is a stock,
 * an index, an ETF, a currency pair or a crypto pair, and no stable identifier
 * — `symbol` was the de-facto key, and it is ambiguous across venues and asset
 * classes.
 *
 * Concretely, before this there was nowhere to put `^GSPC`, `EURUSD=X` or
 * `BTC-USD` that did not make them equities with tickers, and no way to tell
 * `TSLA` on Nasdaq from `TSLA` on a European venue.
 *
 * The provider layer already models all of it — `AssetType` is
 * stock/etf/mutual_fund/crypto/forex/commodity/index/bond/warrant/preferred/
 * unknown, and all three providers implement `search()` returning it. This is
 * the storage half.
 *
 * ── Everything here is additive and nullable ──────────────────────────────
 *
 * Nothing is dropped and no row is classified by this migration. The 911
 * existing rows keep a NULL `asset_type`, because guessing their class would
 * be the same fabrication the accompanying code change removes — every
 * provider used to default an unrecognised instrument to 'stock', which filed
 * bonds and warrants as common equity. A backfill is a separate, reviewable
 * step that writes `unknown` where no provider agrees.
 *
 * NULL here means "not known", never "none".
 *
 * See docs/tickets/instrument-universe.md §2.
 * Applied to production 2026-08-18 with explicit sign-off.
 */

BEGIN;

-- What the row IS. The CHECK mirrors the AssetType union in
-- src/lib/financial-data/types.ts, including 'unknown' — a class we cannot
-- determine must be storable, or the code will fall back to 'stock' again.
ALTER TABLE public.assets
  ADD COLUMN asset_type text
    CHECK (asset_type IN ('stock','etf','mutual_fund','crypto','forex',
                          'commodity','index','bond','warrant','preferred','unknown'));

-- The currency the instrument trades and is quoted in. Without it a "price"
-- is a number with no unit, and mixing them silently is a real risk the moment
-- non-US instruments land.
ALTER TABLE public.assets
  ADD COLUMN currency text;

-- Provider-independent identifiers. All nullable: no single provider returns
-- all of them.
ALTER TABLE public.assets ADD COLUMN isin text;
ALTER TABLE public.assets ADD COLUMN figi text;
ALTER TABLE public.assets ADD COLUMN mic  text;   -- ISO 10383 venue code

-- Which provider vocabulary the row was classified from, so a future
-- reclassification can find the rows it needs to revisit rather than guessing.
ALTER TABLE public.assets ADD COLUMN identity_source text;

CREATE INDEX IF NOT EXISTS assets_asset_type ON public.assets (asset_type);

-- Partial uniques: an identifier is unique WHERE PRESENT. A plain unique index
-- would collapse every unidentified row into one another, since NULLs are
-- distinct in Postgres but the intent here needs stating explicitly.
CREATE UNIQUE INDEX IF NOT EXISTS assets_figi_key
  ON public.assets (figi) WHERE figi IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS assets_isin_mic_key
  ON public.assets (isin, mic) WHERE isin IS NOT NULL AND mic IS NOT NULL;

COMMIT;

-- Verification (asserts negatives):
--   -- the CHECK actually rejects a bad class rather than merely existing
--   insert into public.assets (symbol, asset_type) values ('__probe__','equities');
--   -- expect ERROR 23514
--
--   -- no row silently classified by the migration itself
--   select count(*) from public.assets where asset_type is not null;
--   -- expect 0 immediately after applying
--
-- Restore path (discards classification captured after this point; touches
-- nothing that existed before it):
--   BEGIN;
--   DROP INDEX IF EXISTS public.assets_isin_mic_key;
--   DROP INDEX IF EXISTS public.assets_figi_key;
--   DROP INDEX IF EXISTS public.assets_asset_type;
--   ALTER TABLE public.assets
--     DROP COLUMN identity_source, DROP COLUMN mic, DROP COLUMN figi,
--     DROP COLUMN isin, DROP COLUMN currency, DROP COLUMN asset_type;
--   COMMIT;
