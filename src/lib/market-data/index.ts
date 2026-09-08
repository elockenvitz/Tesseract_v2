/**
 * The provider-neutral data foundation.
 *
 * Four independent pieces, deliberately not a framework:
 *
 *   identity   which instrument is this, and when is the answer ambiguous
 *   freshness  where a value came from, when it was true, whether it still is
 *   contracts  the shapes a provider adapter may produce, and nothing past it
 *   paging     reading a table larger than one PostgREST response
 *
 * Nothing here talks to a network, a database or a provider. That is what makes
 * it testable against thousands of instruments in a unit test, and it is why
 * adopting it is a call-site change rather than a migration.
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
  FreshnessState,
  FreshnessPolicy,
  FreshnessVerdict,
} from './freshness'
export {
  DAILY_CLOSE_POLICY,
  INTRADAY_QUOTE_POLICY,
  REFERENCE_POLICY,
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

export type { PageResult, PageFetcher, PagingOptions } from './paging'
export {
  POSTGREST_MAX_ROWS,
  DEFAULT_PAGE_SIZE,
  DEFAULT_MAX_ROWS,
  TruncatedReadError,
  fetchAllRows,
  assertComplete,
} from './paging'
