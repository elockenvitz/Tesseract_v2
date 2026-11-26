# Subprocessors

**Status: factual. Publish this one.**
Last verified against the codebase and the live database **2026-11-25**
(previously 2026-08-14).

> **What changed in the 2026-11-25 re-verification:**
>
> | | |
> |---|---|
> | **Removed** | **Polygon.** Not a subprocessor; it receives nothing. See the note under Market data. |
> | **Added** | **EODHD.** Prices and intraday series via its own Edge Function. |
> | Corrected | Alpha Vantage's purpose: news sentiment, not prices and fundamentals. |
> | Corrected | The platform AI model. `platform_ai_config` holds `claude-3-5-sonnet-20241022`, a **retired** model, not the value `DATA-INVENTORY.md` §3 records. |
> | Confirmed | Supabase, Netlify, Sentry, and all four AI providers, unchanged. |
> | Noted | Yahoo Finance and Finnhub are called from the **browser**, so the user's IP reaches them directly. |

Customers ask for this list during diligence and their own privacy policies
have to name it. Keep it current: adding a provider in code without adding it
here breaks the DPA commitment to notify before new subprocessors.

## Infrastructure

| Subprocessor | Purpose | Data | Location |
|---|---|---|---|
| Supabase | Database, authentication, file storage | All customer content and account data | United States (us-east-1) |
| Netlify | Application hosting and build | Static assets; request logs | United States |

## AI providers

Engaged only when a customer uses AI features. Content sent can include asset
data, investment theses, note bodies, outcomes, and portfolio holdings —
see `DATA-INVENTORY.md` §3.

| Subprocessor | Purpose | Notes |
|---|---|---|
| Anthropic | AI chat and generation | Platform default |
| OpenAI | AI chat and generation | Selectable |
| Google | AI chat and generation | Selectable |
| Perplexity | AI chat and generation | **Search-augmented** — queries may be used to retrieve from the public web |

Where a customer configures its own provider key (BYOK), that provider is the
**customer's** subprocessor, not ours.

> **Open item:** zero-retention / no-training terms have not been confirmed in
> writing with any of these. Until they are, neither the privacy policy nor
> the DPA should assert them.

## Operations

| Subprocessor | Purpose | Data |
|---|---|---|
| Sentry | Error monitoring, performance tracing, session replay on errored sessions | Diagnostics; masked DOM replay |

## Market data

These receive **ticker symbols only** — no customer content or personal data.

| Subprocessor | Purpose | Called from | Verified |
|---|---|---|---|
| Yahoo Finance | Prices, charts | **the browser, directly** | 2026-11-25 |
| Finnhub | Quotes, news | **the browser, directly** | 2026-11-25 |
| Alpha Vantage | News sentiment | `market-news` Edge Function | 2026-11-25 |
| EODHD | Prices, intraday series | `eodhd-market-data` Edge Function | 2026-11-25 |

> **Correction, 2026-11-25. Polygon was listed here and is not a
> subprocessor.** It receives nothing. Every occurrence of "polygon" in the
> codebase is the CSS `polygon()` clip-path function, and there is no Polygon
> API client, key or endpoint. Naming a vendor that receives no data is a
> factual error in a document customers rely on for diligence, so it is removed
> rather than quietly corrected.

> **Two of these are called from the BROWSER, not from a server.** Yahoo
> Finance and Finnhub are fetched directly by `src/lib/financial-data/
> browser-client.ts`, which 14 modules import. Two consequences a customer's
> security review will care about, and which a subprocessor list alone does not
> convey:
>
> 1. The user's own IP address and browser reach those vendors directly. That
>    is a disclosure the privacy policy must make, and it is not something
>    Tesseract can prevent on the vendor's side.
> 2. There is no commercial redistribution licence with either, and
>    consumer-grade endpoints are not licensed for a multi-tenant commercial
>    product. See `risk-register.md` §4 and `counsel-review-checklist.md` §L.
>    **This blocks external access, not just paid deployment.**

> **Open item.** EODHD is single-seat, and `price_history_cache` is read across
> organizations, so one seat's data can reach another tenant. Resolving that is
> part of §L.
