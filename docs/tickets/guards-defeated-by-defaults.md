# Defect class: a check that cannot observe its own failure mode

**Status:** scoped, not started
**Opened:** 2026-08-16
**Priority:** high — three confirmed instances, one of which was live in production

## The class

A check is worthless if the thing it is checking for would leave the check's
inputs unchanged. Three instances, found separately, before anyone noticed they
were the same defect:

| | The check | What it read | What it could not see |
|---|---|---|---|
| 1 | `netlify.toml` build gate | nothing — no build command was set | that no test had ever gated a deploy. Main's CI was red across three merges and every one published |
| 2 | `isQuoteFresh(asOf)` | `quote.timestamp` | that the quote was fabricated. `createPlaceholderQuote` stamped `new Date()`, making the fake the *freshest* value in the system. The guard passed, correctly, on a lie |
| 3 | asset_notes migration verification | "do the new policies exist?" | that the old permissive policy was still there. Policies OR together; the DROP had no-opped on a wrong name. Two correct new policies would have appeared, the check would have passed, and the cross-org read would have stayed open |

The common shape: **each check asserted the presence of the good state.** In all
three, the bad state is compatible with the good state being present. Presence
is not exclusion.

Instance 2 has a second property worth naming separately: the faked value
controlled *the very field the guard reads*. A guard is only as good as the
independence of its input from the failure it guards against.

## The test to apply to every check

> If this silently did not run — or if the thing it guards against were fully
> present — what exactly would be true? Would this check still pass?

Anything that would still pass gets rewritten to assert the **absence of the bad
state**, not the presence of the good one.

## What I would audit

Roughly in descending order of what a false pass would cost.

**A. Database and RLS verification.** Every migration whose verification reads
`pg_policies`, `information_schema`, or a row count. All of them are currently
presence-shaped. The rewrite is mechanical: assert the count of *unscoped*
policies is zero rather than that a scoped one exists. Includes the tenant
enumeration work not yet started.

**B. The org-scope ratchet** (`src/lib/org-scope`). Already proven by
deliberate breakage (allowlist 110 → exit 1, `dist/` absent), so it is in the
good column — but the audit should confirm it asserts a ceiling on unscoped
queries rather than a floor on scoped ones.

**C. Freshness checks.** Anything comparing a timestamp to `Date.now()`.
Defeated by any upstream that stamps `new Date()` rather than the moment the
value was true. Known: the Alpha Vantage `timestamp` fallback (fixed alongside
the placeholder); the `portfolio_holdings` nightly carry-forward, which re-dates
snapshot rows and makes a stale book look live — see
`docs/tickets/holdings-freshness.md`.

**D. Quality checks.** `isQualityContent`, `looksLikeMash`, the placeholder
regex list. Defeated by any upstream substituting *plausible* content for
missing content. `createMockNews` in `browser-client.ts` is still live and
returns invented headlines ("Company Reports Strong Quarterly Earnings") from
`getNews` on failure. Those pass every quality check in `suppression.ts`
because they are well-formed English. Not reached by the signal builders — the
feed reads the `market-news` edge function — but `FinancialNews.tsx` consumes
it.

**E. Completeness checks.** `hasSufficientCoverage` and any absence-based
claim. A coverage ratio computed over rows that were themselves defaulted into
existence measures nothing.

**F. CI and deploy gates.** For each job: what would be true if it silently did
not run, and would anything notice? `Card layout` was reported as blocking
merges for a day while not being in the required-checks list — it ran, it
reported, it gated nothing. Same class.

**G. The test suite itself.** Tests that pass because their subject never
executed. Two found so far: `notifications` fixtures that failed to insert
(missing `type` and `context_type`), so "notifications deleted" passed
vacuously; and a Playwright test whose assertions sat inside `if (fetched)`
whose stub never applied. The sweep is for guarded assertion blocks and any
fixture whose creation is unchecked.

## Acceptance

A table of (check → what it reads → what it cannot see → verdict), and for
every check that survives, a **deliberate break-and-restore** proving it fires
on the bad state rather than merely on absence. A verdict of "looks correct" is
not acceptable for anything in group A or F.

## Do not

Do not fix these by tightening the checks. Rejecting `changePercent === 0`
would have hidden the placeholder *and* every genuinely flat day. The
correction is either to make the bad state expressible upstream, or to invert
the assertion — never to narrow what counts as good.
