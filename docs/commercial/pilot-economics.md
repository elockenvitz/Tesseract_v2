# First external pilot: dependencies, licensing and AI economics

A go/no-go assessment of what a first limited external pilot actually
requires. No integration is proposed here and no money is spent.

**Measured on 2026-11-19** against production project
`wfcebeagznzgeuyysbnt`, read-only. Every figure below is labelled
**measured**, **derived** (arithmetic on measured inputs plus a stated
assumption), or **unknown**.

---

## The short version

**Technically, a pilot could run next week.** The decision workflow works
and does not depend on market data.

**Commercially, three things block it**, in descending order of difficulty:

1. **No market-data licence permitting redistribution to external users.**
   Not a technical gap. A contract we do not have.
2. **No legal entity**, which blocks a data processing agreement, insurance,
   and any signed document.
3. **No production backup or point-in-time recovery**, which fails a serious
   information-security review on its own.

**AI cost is not a blocker.** Measured spend is $0.48 total, lifetime. The
gap is not cost, it is that the controls are not concurrency-safe and not
per-organization, which matters before a platform-sponsored allowance is
switched on.

**Recommended sequence:** form the entity, enable backups, then resolve data
licensing, then build the AI reservation layer. The first two are cheap and
unblock the security review. The third has the longest lead time because it
involves a vendor.

---

# Part 1. Market data

## What is actually used

**Measured** by reading the code and the deployed functions.

| Provider | Used for | Where | Credential |
| --- | --- | --- | --- |
| **EODHD** | Quotes, historical series, instrument reference | `eodhd-market-data` edge function, `routed-quote` | `EODHD_API_KEY`, server-side |
| **Yahoo** | Chart series, news search, news RSS | `yahoo-chart-proxy`, `market-news` | None. Unauthenticated endpoints |
| **Finnhub** | News, corporate events | `market-news`, `market-events` | `FINNHUB_API_KEY`, server-side |
| **Alpha Vantage** | Nothing | Retired | Retired in PR #346 |

`MarketDataProviderId` is `'yahoo' | 'eodhd'`. Those two are the quote path.

**Where the data surfaces**

- **Asset header price.** Routed quote, with its provenance caption.
- **Charting.** EODHD intraday and daily, Yahoo as fallback. Note that only
  1m, 5m, 1h and 1d intervals genuinely exist upstream; the rest are
  resampled.
- **Portfolio valuation.** Holdings are marked, and seeded book marks are a
  known contamination source.
- **News.** Finnhub plus two Yahoo paths, three sources after #346.
- **Server-side proxies.** `eodhd-market-data`, `yahoo-chart-proxy`,
  `market-news`, `market-events`. No provider credential reaches the
  browser; this was verified when the Alpha Vantage key was retired.

## Freshness and provenance limits

- **`assets.current_price` has no timestamp column.** Anything derived from
  it is undated. This produced a false +35.8% return on a decision twenty
  minutes old. Fixes are in open PRs.
- **Delivery terms are provider-stated and often absent.** The header now
  says "Delivery unstated" rather than implying a live quote.
- **`price_history_cache` is shared across organizations.** It is the path
  by which one tenant's fetched data becomes readable by another, which is
  precisely the entitlement problem below.

## What works vs what is licensed

**This is the distinction that matters, and conflating it is the single
largest commercial risk in the product.**

| | Works technically | Licensed for the founder's own use | Permitted for external pilot users |
| --- | --- | --- | --- |
| EODHD quotes and history | Yes, measured | Believed yes, single-seat | **No. Single-seat does not cover third parties** |
| Yahoo chart and news endpoints | Yes, measured | **Unknown.** No agreement exists | **Almost certainly not.** These are undocumented endpoints, not a licensed feed |
| Finnhub news | Yes, measured | Free tier terms apply | **Unknown. Free tiers typically prohibit redistribution** |

**An API that answers is not a licence.** This is the same reasoning error
as treating a logo endpoint that returns an image as permission to use a
trademark. Yahoo's chart and news endpoints in particular are not a product
Yahoo sells us; they are endpoints that happen to respond.

**`price_history_cache` makes it concrete.** A single-seat entitlement
whose fetched data lands in a table every organization can read is, in
substance, redistribution. That is true even with one pilot user.

## What a pilot actually needs

**Target:** Tesseract-provided, automatically updated, compliant end-of-day
or delayed US equity prices, licensed for display to our customers' users.

**Explicitly not acceptable** as the standard pilot experience: asking a
client to upload a daily CSV. It is not a product, it tells a prospect we
have not solved a solved problem, and it would be abandoned in week two.

**A real fourth option, worth putting to a prospect directly:** run the
pilot with **no market data at all**. The decision record does not depend on
prices. The firm keeps its terminal for prices and uses Tesseract for
reasoning. This removes the hardest blocker entirely and is worth asking
about in stage 2, not treated as a failure mode.

## Licensing questions to send a vendor

Ready to send to EODHD and alternatives. **Do not send without
authorization.**

1. Does our subscription permit **display to our customers' end users**
   inside a hosted application, or only to our own named users?
2. What is the licence unit: per seat, per end user, per application, or
   per enterprise?
3. May we **cache** prices and historical series server-side, and for how
   long? Is a shared cache across our customers permitted, or must the cache
   be partitioned per customer?
4. What **attribution** is required, and where must it appear?
5. Are **delayed and end-of-day** US equity prices licensed differently from
   real-time? What delay qualifies as non-real-time?
6. Do we need **exchange agreements** directly with any US venue, or does
   your licence cover the underlying exchange rights?
7. What **redistribution** rights apply to derived values, for example a
   position valuation computed from your prices?
8. Is there a **non-professional vs professional** distinction, and how is a
   buy-side analyst classified?
9. What are the **rate limits and overage terms** at the tier that permits
   end-user display?
10. What **reporting** of end-user counts is required, and at what cadence?
11. What happens to our customers' stored historical data **if we terminate**?
12. Is **instrument reference data** (ISIN, FIGI, MIC, exchange, currency)
    licensed on the same terms as prices?

**Alternatives worth the same questionnaire:** Polygon.io, Twelve Data,
Financial Modeling Prep, Nasdaq Data Link, ICE Consolidated Feed, Refinitiv.
Expect end-user display rights to cost materially more than a single seat.
The number is **unknown** and must come from a quote, not an estimate.

---

# Part 2. ACT AI

## Current implementation

**Measured** from `supabase/functions/ai-chat/index.ts` (4,183 lines) and
from `platform_ai_config` in production.

**Routing.** BYOK only. `platform_ai_enabled` is **`false`**. The
organization's provider key is fetched from `vault.secrets` through a
definer function; the GRANT on that function is the authorization boundary.

**Providers supported.** Anthropic, OpenAI, Google, Perplexity. Default
model per provider is a constant; for Anthropic it is `claude-sonnet-5-5`.

**Purpose-based routing.** `'chat' | 'column' | 'snippet' | 'analysis'`.
Cheap tasks route to Haiku, which is roughly a twentieth of Sonnet's cost
per token.

**Limits that exist**, from `platform_ai_config`, **measured**:

| Setting | Value |
| --- | --- |
| `platform_ai_enabled` | `false` |
| `platform_model` | `claude-3-5-sonnet-20241022` |
| `allow_byok` | `true` |
| `daily_request_limit` | 100 |
| `monthly_request_limit` | 2000 |
| `daily_token_limit_per_user` | 500,000 |
| `monthly_budget_usd_per_user` | $20.00 |
| `max_tokens_per_request` | 4,096 |

**Context is bounded.** The function caps context block sizes defensively so
one user with a large thesis or a hundred notes cannot inflate the prompt.

**Usage is logged.** `ai_usage_log` captures input, output and cache token
counts plus `estimated_cost`, and the table **has an `organization_id`
column**.

**Pricing table is current.** Sonnet 5.5 at $2/$10 per million tokens,
Haiku 5.5 at $0.10/$0.50, Opus 5.5 at $4/$20. A previous audit found the
table over-reporting Opus by 3x, which mattered because the monthly budget
is enforced against `estimated_cost`: a wrong price cuts users off early.

## Measured usage, lifetime

| | Value |
| --- | --- |
| Requests, all time | **29** |
| Requests, last 30 days | **20** |
| Distinct users | **1** |
| Total estimated cost | **$0.4826** |
| Mean cost per request | **$0.016642** |
| Mean input tokens | **2,404** |
| Mean output tokens | **373** |
| Last request | 2026-11-14 |

**No new paid calls were made to produce these figures.** They are reads of
the existing log.

## Representative cost

**Derived** from the measured token means above and the code's pricing table.

| Model | Input 2,404 tok | Output 373 tok | Per request |
| --- | --- | --- | --- |
| Sonnet 5.5 | $0.0048 | $0.0037 | **~$0.0085** |
| Haiku 5.5 | $0.0002 | $0.0002 | **~$0.0004** |
| Opus 5.5 | $0.0096 | $0.0075 | **~$0.0171** |

The measured mean of $0.0166 is roughly double the Sonnet figure because the
historical rows include previous-generation models at higher rates. The
current generation is cheaper at every tier.

**Per user, per month.** Assuming 20 requests per working day and 21
working days, so 420 requests: **~$3.60 on Sonnet**, **~$0.17 on Haiku**,
**~$7.00 at the measured historical blend**. The 20-per-day assumption is
not measured; actual use is 20 requests in 30 days by one user.

**A five-user pilot** is therefore **$18 to $35 per month** on Sonnet.
Immaterial.

**Worst case under current caps, per user per day.** 100 requests at 4,096
output tokens is 409,600 output tokens, which on Sonnet is $4.10, plus up to
$1.00 of input inside the 500,000-token daily cap. So **~$5 per user per
day**, or ~$105 per month, which **exceeds the $20 monthly budget**. The
monthly cap would stop it, if the accounting is timely. Which brings us to
the actual gap.

## The actual gaps

Cost is not the problem. These four are.

**1. The limit check is not atomic.** `checkLimits` compares a usage
snapshot read before the provider call. There is no reservation, no lock and
no atomic increment. N concurrent requests all read the same snapshot and
all pass. Under concurrency the daily and monthly caps are advisory.

**2. Usage accounting is fire-and-forget, after the fact.**

```
logUsage(...).catch(console.error);
```

Not awaited, and a failure is swallowed to the console. So a request that
fails to log is never counted against any limit. Combined with gap 1, a
burst can overshoot a budget by an amount nobody can bound in advance.

**3. Limits are per user, not per organization.** Every setting above is
per-user. `ai_usage_log` already carries `organization_id`, so the data to
aggregate exists; the enforcement does not. A ten-user organization has ten
times the ceiling, and nothing caps the firm.

**4. There is no provider-side spend cap.** Whether a hard budget limit is
configured at the Anthropic account level is **unknown** and should be
checked. Without one, the application's caps are the only ceiling, and gaps
1 and 2 make them soft.

**And one live trap.** `platform_model` in production is
`claude-3-5-sonnet-20241022`, **a retired model**. The code comments record
that this was removed from the function's fallback and from the model
picker, but the database row still holds it. **Switching
`platform_ai_enabled` to `true` today would send every platform request to a
model that no longer exists.** That row must be corrected before the flag is
flipped. It is a one-row production update and needs explicit approval.

## Minimum viable AI cost control

The smallest thing that must exist before platform-sponsored ACT AI is
switched on. This is a recommendation, not an implementation, and it is
deliberately much less than a billing system.

1. **An organization-level allowance**, alongside the per-user one.
   Suggested starting point: $50 per organization per month for a pilot,
   which is roughly 7x the measured blended cost of five users.
2. **A reservation, not a check.** Before the provider call, atomically
   increment a counter and reserve an estimated maximum cost. Reconcile to
   actual afterwards. One row per organization per period, updated in a
   single statement, so concurrent requests serialize on it.
3. **Await the accounting.** A usage write that fails must fail the request,
   not log to console. An unmetered request is worse than a refused one.
4. **Fail closed.** No config row, no allowance row, or an accounting error
   means refuse, with a clear message. Today an unset limit means unlimited.
5. **Model allow-list per organization**, so a pilot cannot be routed to
   Opus by configuration. Pin Sonnet, and let purpose routing use Haiku.
6. **Keep `max_tokens_per_request` at 4,096 and keep the context caps.**
   These are the reason a single request cannot be large. Note that Haiku's
   pricing is tiered above 100,000-token prompts, at 5x; the current caps
   keep every request in the lower tier, and the cost table silently
   under-reports by 5x if that ever stops being true.
7. **A provider-side hard spend cap**, as the backstop that does not depend
   on our code being correct.
8. **No browser-side secret exposure.** Already true, and the Alpha Vantage
   episode is the reason to keep verifying it in the build output rather
   than assuming it.

**Rough effort:** items 1 to 4 are the substance. One migration for the
allowance table and the reservation function, and a change to the
pre-flight path in `ai-chat`. Items 5 to 8 are configuration.

---

# Part 3. Dependencies, costs and approvals

## First-pilot technical dependencies

| Dependency | State |
| --- | --- |
| Decision workflow end to end | **Works.** All four decision outcomes exist in the QA corpus |
| Multi-tenant isolation | Extensive RLS, partially audited, with open items tracked |
| Second human account for role testing | **Missing.** One human in the QA organization, so role separation is untested with real sessions |
| Global search for assets | **Broken.** Returns no results although the backend RPC is correct |
| Outcome attribution | **Four fixes unmerged:** PRs #341, #342, #343, #345 |
| Pilot seed integrity | **Fix unmerged:** PR #340, and its migration is unapplied |
| Production backup and PITR | **Not enabled** as of the last check. Re-verify before any pilot |
| Market data for pilot users | **Blocked on licensing** |
| AI provisioning | **BYOK only.** Platform AI off, and its configured model is retired |

## Licensing dependencies

| Item | Blocker |
| --- | --- |
| EODHD end-user display rights | Needs a vendor quote. Cost **unknown** |
| Yahoo endpoints | No agreement exists. Should be assumed unusable commercially |
| Finnhub free tier | Redistribution terms **unknown** |
| Company logos | No licensed source. Addressed by using monograms we own |
| Data processing agreement | Needs a legal entity |

## Verified vs unknown costs

**Verified by measurement**

- AI spend to date: $0.4826 lifetime, across 29 requests.
- Mean cost per request: $0.0166 historical, ~$0.0085 at current Sonnet
  pricing.
- Model pricing, from the function's own table, audited recently.

**Derived, with stated assumptions**

- $18 to $35 per month of AI for a five-user pilot at 20 requests per user
  per working day.
- A ~$5 per user per day worst case under current caps.

**Unknown, and requiring an external quote or a check**

- Market-data licensing at end-user display tier. **The single largest
  unknown in this document.**
- Supabase plan cost at pilot scale. Pro is needed before roughly five
  concurrent users, and the usage-polling behaviour needs the known billing
  multiplier accounted for.
- Legal entity formation, insurance, and counsel.
- Any third-party security review a prospect requires.
- Whether a provider-side AI spend cap is configured.

**No vendor has been contacted and no quote has been obtained. Any number
presented as a vendor price in this document would be invented.**

## Required approvals

Needing an explicit founder decision:

1. Contact market-data vendors with the licensing questionnaire.
2. Form a legal entity.
3. Enable production backups and point-in-time recovery.
4. Correct `platform_ai_config.platform_model`, a production DML statement.
5. Merge the unmerged decision-integrity PRs and apply PR #340's migration.
6. Set `VITE_ACCESS_REQUEST_EMAIL` in Netlify, which activates the landing
   page's contact path.
7. Upgrade the Supabase plan, when pilot users are imminent.

## Suggested sequence of expenditure

Cheapest and most unblocking first.

1. **Legal entity and basic insurance.** Low cost, blocks the most.
2. **Production backups and PITR.** A plan setting, and it is the first
   thing a security review asks about.
3. **Market-data licensing conversations.** Free to start, longest lead
   time, so start them in parallel with 1 and 2.
4. **Supabase Pro.** Only when a pilot user is imminent.
5. **The AI reservation layer.** Engineering time, no external cost, and
   only needed if platform-sponsored AI is in scope. A BYOK pilot does not
   need it.
6. **Market-data subscription at end-user tier.** The largest and last
   commitment, made only once a pilot is actually scheduled.

**The go/no-go.** A pilot can start without items 4, 5 and 6 if the firm
either brings its own data entitlement or accepts a pilot with no market
data. Items 1, 2 and 3 are not optional, and item 3 has to begin now because
it is the only one with a lead time measured in weeks.
