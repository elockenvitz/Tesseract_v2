/**
 * The EODHD validation surface, inside the ops portal.
 *
 * ── Why here ──────────────────────────────────────────────────────────────
 *
 * The brief asked for an owner-only diagnostic that is isolated from other
 * users and removable without architectural changes. `/ops` already is that:
 * it sits behind `OpsGuard`, has its own layout, and nothing in the product
 * links into it. So this is two lines in `OpsLayout` plus two files, and
 * removing it is deleting them.
 *
 * It is deliberately NOT a market-data administration dashboard. There is
 * nothing to administer here: no provider toggles, no key management, no
 * cache controls, no per-user entitlement editing. The allowlist lives in a
 * function secret and is changed there, by a person, on purpose.
 */
import { EodhdDiagnostic } from '../../components/market-data/EodhdDiagnostic'

export function OpsMarketDataPage() {
  return (
    <div className="p-4 space-y-4 md:p-6">
      <div>
        <h1 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
          Market data probes
        </h1>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
          Exercises the authenticated EODHD function with the signed-in session. Read-only.
        </p>
      </div>

      <EodhdDiagnostic />

      <div className="space-y-2 text-xs text-gray-500 dark:text-gray-400">
        <p>
          <strong className="text-gray-700 dark:text-gray-300">Reading the results.</strong>{' '}
          A <code>no_data</code> result means the symbol resolved and the window is empty,
          which is what an unpublished daily bar looks like during an open session. It is not
          the same as <code>unknown_symbol</code>, which means the provider has no such
          instrument.
        </p>
        <p>
          <strong className="text-gray-700 dark:text-gray-300">Freshness.</strong>{' '}
          A quote timestamp is the last trade instant, not the moment the snapshot was built.
          On a thinly traded name the gap can exceed the feed delay, so an age of half an hour
          is not by itself a fault. No fixed delay is claimed anywhere in the product.
        </p>
        <p>
          <strong className="text-gray-700 dark:text-gray-300">Currency units.</strong>{' '}
          London prices arrive in pence. Reference data reports <code>currency GBP</code> with
          <code> unit GBX</code>; a figure carrying that unit is divided by 100 only by an
          explicit conversion, never silently.
        </p>
      </div>
    </div>
  )
}
