# Audit every guard whose input can be faked or defaulted

**Status:** open, not started
**Opened:** 2026-08-16
**Priority:** high — this is a class, and one member of it was live in production until yesterday

## The instance that produced this ticket

`createPlaceholderQuote` returned, on total provider failure:

```ts
{ price: 0, change: 0, changePercent: 0, timestamp: new Date().toISOString(), ... }
```

The freshness guard downstream was:

```ts
export function isQuoteFresh(asOf) { return Date.now() - new Date(asOf).getTime() <= QUOTE_MAX_AGE_MS }
```

The guard did not fail. It **passed, correctly, on a lie**. The fabricated
quote stamped itself with the current time, which made it the freshest quote in
the system — no staleness check can catch a value that is fresh by
construction. The news builder then read `changePercent: 0` as a legitimate
flat tape, because on any real quote it would be one.

Two properties made this invisible:

1. The faked value was *well-formed*. It satisfied the type, the null checks
   and the range checks. Nothing downstream had a defect to detect.
2. The fake controlled **the very field the guard reads**. A guard is only as
   good as the independence of its input from the thing it is guarding
   against.

## The generalisation

Any guard can be defeated this way. Enumerate every check in the codebase that
reads a field which some upstream default, placeholder or fallback can set,
and ask: *if that upstream fabricated a value, would this check still fire?*

Three families to sweep, all of which exist here:

**Freshness checks** — anything comparing a timestamp to `Date.now()`.
Defeated by any upstream that stamps `new Date()` rather than the moment the
value was true. Known instances beyond the placeholder: Alpha Vantage's
`timestamp` fell back to `new Date()` when the provider gave no trading day
(fixed alongside the placeholder). Sweep `portfolio_holdings` carry-forward,
which re-dates snapshot rows nightly — see
`docs/tickets/holdings-freshness.md`.

**Quality checks** — `isQualityContent`, `looksLikeMash`, the placeholder
regex list. Defeated by any upstream that substitutes plausible prose for
missing content. `createMockNews` in `browser-client.ts:~375` is still live
and returns invented headlines ("Company Reports Strong Quarterly Earnings")
from `getNews` on failure. Those would pass every quality check in
`suppression.ts` because they are well-formed English. Not currently consumed
by the signal builders — the feed reads the `market-news` edge function — but
`FinancialNews.tsx` does consume it.

**Completeness checks** — `hasSufficientCoverage`, and any count-based
absence claim. Defeated by any upstream that emits rows for names it has no
data on. A coverage ratio computed over rows that were themselves defaulted
into existence measures nothing.

## Method

1. Grep every fallback: `|| new Date()`, `?? 0`, `catch { return ` a
   constructed object, and anything named `placeholder`, `mock`, `fallback`,
   `default`, `stub`.
2. For each, name the guard that reads the field it sets.
3. For each pair, write the one-line question: *does this guard still fire?*
4. Where the answer is no, the fix goes at the source, not in the guard. The
   placeholder fix belongs in `browser-client.ts` and not in a suppression
   rule, because a flat tape is real and must render — the only defence is a
   layer that does not invent one.

## Acceptance

A table of (fallback site → guard it defeats → verdict), and a deliberate
break-and-restore for each guard that survives, proving it fires on the faked
value rather than merely on absence.

## Do not

Do not fix these by tightening the guards. Rejecting `changePercent === 0`
would have hidden the placeholder *and* every genuinely flat day. The
correction is always to make unavailability expressible upstream.
