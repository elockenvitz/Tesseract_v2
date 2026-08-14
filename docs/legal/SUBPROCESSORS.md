# Subprocessors

**Status: factual. Publish this one.**
Last verified against the codebase 2026-08-14.

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

| Subprocessor | Purpose |
|---|---|
| Alpha Vantage | Prices, fundamentals |
| Yahoo Finance | Prices, charts |
| Polygon | Market data |
| Finnhub | Market data, news |
