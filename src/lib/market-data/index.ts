/**
 * The provider-neutral data foundation.
 *
 * Six independent pieces, deliberately not a framework:
 *
 *   identity      which instrument is this, and when is the answer ambiguous
 *   freshness     where a value came from, when it was true, whether it still is
 *   contracts     the shapes a provider adapter may produce, and nothing past it
 *   paging        reading a table larger than one PostgREST response
 *   asset-access  the one correct way to read `assets`, at any universe size
 *   reads         one normalized way to read a price, with its provenance
 *
 * Nothing exported HERE talks to a network, a database or a provider. That is
 * what makes it testable against thousands of instruments in a unit test, and
 * it is why adopting it is a call-site change rather than a migration.
 *
 * The two Supabase bindings — `supabase-asset-source.ts` and
 * `supabase-price-source.ts` — are deliberately NOT re-exported here.
 * `scripts/gallery-purity.mjs` asserts the gallery entry has no import path to
 * `src/lib/supabase.ts`, and re-exporting them would put every consumer of a
 * pure type one hop from the client. Import those two files directly.
 */

export type {
  SecurityClass,
  LifecycleStatus,
  SecurityRow,
  SecurityRef,
  SecurityKey,
  IdentityBasis,
  SecurityLookup,
  SecurityResolution,
  SymbolIndex,
} from './identity'
export {
  pricingSymbolOf,
  toSecurityRef,
  securityKey,
  isTradable,
  foldSymbol,
  resolveSecurity,
  buildSymbolIndex,
} from './identity'

export type {
  Adjustment,
  ValueSource,
  Observed,
  DataClass,
  FreshnessBasis,
  FreshnessState,
  FreshnessPolicy,
  FreshnessVerdict,
} from './freshness'
export {
  DAILY_CLOSE_POLICY,
  INTRADAY_QUOTE_POLICY,
  REFERENCE_POLICY,
  FUNDAMENTAL_POLICY,
  ESTIMATE_POLICY,
  policyFor,
  isCalendarFallback,
  assessFreshness,
  freshValue,
  areComparable,
  describeSource,
} from './freshness'

export type {
  ReferenceRecord,
  PriceBar,
  PriceSeries,
  PriceQuote,
  AdapterCapabilities,
  AdapterFailure,
  AdapterResult,
  BarsRequest,
  ProviderAdapter,
} from './contracts'
export { isRetryable } from './contracts'

export type {
  AssetQuerySpec,
  AssetRowSource,
  AssetAccess,
  AssetSearchPage,
  SearchOptions,
  UniverseOptions,
} from './asset-access'
export {
  createAssetAccess,
  IDENTITY_COLUMNS,
  ID_CHUNK_SIZE,
  UNIVERSE_PAGE_SIZE,
  MAX_SEARCH_PAGE_SIZE,
} from './asset-access'

export type {
  PriceCacheRow,
  PriceQuerySpec,
  PriceRowSource,
  PriceReadResult,
  SeriesReadResult,
  MarketDataReader,
} from './reads'
export { createMarketDataReader, splitSource, DEFAULT_SERIES_POINTS } from './reads'

export type { PageResult, PageFetcher, PagingOptions } from './paging'
export {
  POSTGREST_MAX_ROWS,
  DEFAULT_PAGE_SIZE,
  DEFAULT_MAX_ROWS,
  TruncatedReadError,
  fetchAllRows,
  assertComplete,
} from './paging'
