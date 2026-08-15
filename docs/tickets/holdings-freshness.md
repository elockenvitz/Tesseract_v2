# Ticket — portfolio freshness is invisible, and carry-forward hides it

**Status:** scoped, not started
**Raised:** 2026-08-15, out of the signal card audit
**Size:** larger than the feed. Touches holdings ingest, every portfolio
surface, and the signal card contract.

## The problem

`carry_forward_holdings()` runs nightly via pg_cron and copies the previous
day's positions forward for any portfolio with no upload. It carries positions
and market value. **It does not re-mark prices.**

Measured on production, 2026-08-15:

```
holdings max date                          2026-07-31   (15 days stale)
distinct prices, most-held asset           7            across 1,086 rows
pg_cron installed                          yes
```

Nothing on any screen says so. A portfolio last uploaded in January renders
identically to one uploaded this morning — same layout, same confident
numbers, no marker. The carry-forward is doing exactly what it was built to
do; the defect is that its output is indistinguishable from fresh data.

## Why it matters beyond cosmetics

A pilot shows a prospect a portfolio screen. The weights are internally
consistent, so nothing looks wrong. The prices are seven months old. Nobody
in the room can tell, and the product has just asserted something false about
a real book.

It also silently corrupts anything comparing a holdings price to a live one —
which is how the target-hit card came to show a $155.30 price against a $90
target. Weight math is unaffected: every position in a snapshot is marked at
the same moment, so ratios stay valid.

## Scope

**1. Portfolio-level freshness state.** A computed field per portfolio:
`last_upload_at`, `days_since_upload`, and a derived state —
`current` / `ageing` / `stale`. Thresholds configurable per org; a daily-fed
institutional book and a manually-maintained model portfolio have different
tolerances and one global constant will be wrong for both.

**2. Surface it in the portfolio header.** Not a warning banner — a
persistent, quiet "as of 31 Jul" that becomes prominent past the threshold.
The rule is that the date is *always* visible, so its absence is never the
thing the reader has to notice.

**3. Mark carried-forward rows as such.** `portfolio_holdings` should record
whether a row came from an upload or from carry-forward. Today they are
indistinguishable after the fact, which is why this needed measuring rather
than querying.

**4. Feed consequences.** Any signal card reading holdings price renders
`source: 'holdings'` with the snapshot date. Cards whose claim compares a
holdings price to a live quote or a target are suppressed outright — see the
card contract's rule-2 split.

**5. A stale-book signal card.** "Vision Fund 10K has not been updated in 15
days" is exactly the kind of thing this feed exists to say, and it is the
cheapest possible fix for the invisibility.

## Open questions

- Should carry-forward re-mark prices from the quote provider rather than
  copying them? That turns a stale book into a *partially* live one —
  positions old, prices current — which may be more misleading, not less.
  Probably not, but it is the obvious suggestion and deserves an explicit no.
- What is the threshold? It is a business answer, not an engineering one.
- Does a stale book suppress its cards entirely, or render them marked? The
  contract currently says marked; a genuinely abandoned book may deserve
  silence.

## Not in scope here

Fixing ingest reliability. This ticket makes staleness *visible*; whether
uploads are arriving is a separate question.
