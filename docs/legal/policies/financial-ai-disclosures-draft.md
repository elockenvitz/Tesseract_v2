# Investment and AI Disclosures — DRAFT, NOT LEGAL REVIEWED

**Document id:** `financial-ai-disclosures` · **Version:** 0.1.0-draft ·
**Effective:** not in effect

> **This is a counsel-review draft. It is not in effect, it binds nobody, and
> it must not be published as approved terms.** It was written by an engineer
> from the actual behaviour of the software so that counsel starts from what
> the product does rather than from a template.

Operated by **[LEGAL ENTITY NAME]** ("Tesseract", "we"). See
`src/legal/entity.ts` — the one place the entity details are configured.

---

## Why this is a separate document

The not-advice disclaimer is usually buried in clause 14 of a terms page that
nobody opens. For this product that is the wrong place for it, because the
misunderstanding it prevents is not a legal technicality — it is a reader
looking at a screen that shows a recommendation, a conviction level and a price
target, and concluding that the software is telling them what to do.

So these disclosures are a first-class document, linked from the public site,
from the application, and contextually at the two screens where the
misunderstanding is most likely: AI output and market-data display.

The second reason is honesty about scope. A disclaimer cannot change what the
software is. Where that question is genuinely open — most importantly whether
AI-generated, portfolio-specific analysis has investment-adviser implications —
this document says so and points at the open question instead of asserting a
favourable answer. See `../risk-register.md` §7.

---

## Part A — Investment information

### A1. Tesseract is software, not an adviser

Tesseract is a workflow and record-keeping tool for investment professionals.
It organises the research, recommendations, decisions and reviews that **its
users** produce.

We do not provide investment advice. We do not recommend the purchase or sale
of any security. We do not manage portfolios, exercise discretion over any
account, or act as a fiduciary to any user or organisation.

**Every view expressed inside Tesseract is the view of the person or
organisation that entered it**, not ours. A thesis, a rating, a conviction
level, a price target and a recommendation are all user-authored content. That
the software stores them in typed fields, displays them in a structured layout,
or arranges them in a queue does not make them ours and does not make them
advice.

> **★ Open for counsel.** The sentence above is true of the human-authored
> record and is the heart of the product. It is **not** a complete answer for
> AI-generated output, which Tesseract itself produces — see B4 and
> `../risk-register.md` §7. This document deliberately does not assert that
> Tesseract is exempt from investment-adviser regulation. That is a securities
> lawyer's conclusion, not a drafting choice.

### A2. No guarantee of results, and the possibility of loss

Nothing in Tesseract is a prediction or a guarantee of investment performance.
Investing involves risk, including the risk of total loss of principal. Past
performance does not indicate future results.

We make no representation that using Tesseract will improve returns, reduce
risk, or improve the quality of any decision. The product's claim is that a
firm retains the reasoning behind its decisions — that is a claim about
records, not about outcomes.

### A3. You verify before you rely

Users remain responsible for independently verifying any figure, price,
holding, identifier, calculation or analysis before relying on it for an
investment decision.

This is not a formality. Several categories of number in Tesseract are
*derived* rather than observed, and the derivation is visible in the product
but easy to skim past. See A5.

### A4. Market data is delayed, incomplete and sometimes wrong

Market data reaches Tesseract from third-party providers. We do not originate
it, cannot guarantee it, and do not control its availability.

Specifically, and each of these has been observed in this product rather than
listed theoretically:

| What | What can go wrong |
|---|---|
| **Quotes and prices** | Delayed, not real-time. A displayed price may be stale by an unknown interval. |
| **Price history** | Some intervals are *resampled* from other intervals rather than sourced natively, so a bar may not correspond to a bar any exchange published. |
| **Corporate actions** | Splits, dividends and other adjustments may not be reflected, or may be reflected inconsistently between series. |
| **Security identifiers** | An instrument may be mismatched, ambiguous across venues, or carry placeholder reference data. Exchange and currency metadata may be absent or literally unknown. |
| **Currency** | Some venues quote in minor units (GBp is pence, not pounds). A number without a stated currency is a bare number. |
| **Missing data** | Coverage gaps are normal. An absent value is not a zero. |
| **Provider outages** | A provider failure can leave a screen blank, stale, or partially populated. |
| **Derived metrics** | Performance, exposure and attribution figures are computed from the above and inherit every defect in it. |

> **★ Open for counsel, and for the founder.** A disclosure is not a substitute
> for correct product behaviour. Where a number's provenance is uncertain the
> right answer is to show the provenance, which this product does in places and
> not in others. The disclosure covers the residual, not the design.

### A5. Decisions, approvals, trades and fills are four different things

This is the most important disclosure in Part A, because conflating these is
the error with real money attached to it. Tesseract distinguishes them, and
this document states the distinction so that nobody relies on a looser reading:

1. **A recommendation** is an analyst's proposal. It is not a decision.
2. **A decision** is a portfolio manager's approval, rejection or deferral. An
   approval authorises action; it is not itself action.
3. **An accepted trade** is the firm's committed record of what it decided to
   do. It is **not** evidence that an order reached a broker or an exchange.
   Tesseract does not place orders, does not route anything, and has no
   connection to any execution venue.
4. **A fill** is what actually happened in the market. Where Tesseract records a
   trade, that record carries whether the fill was **assumed from the approval**
   or **confirmed against the book**. An assumed fill is an assumption. It is
   not a confirmation, and it must not be read as one.

Equally:

- **A simulated trade is not an executed trade.** Simulation and scenario
  features model hypothetical outcomes. Hypothetical results have inherent
  limitations: they are constructed with hindsight, they do not reflect
  liquidity, market impact, or the cost of trading, and they do not represent
  actual results of any account.
- **A market reference price is not realised profit or loss.** A position
  valued against a reference price is a mark, not a result. Realised P&L
  requires reconciliation against actual fills and actual costs, which
  Tesseract does not perform unless a customer has separately agreed a
  reconciliation process in writing.

### A6. No broker reconciliation, no custody, no books of record for accounting

Tesseract is not a trading system, an order-management system, an execution
management system, an accounting system or a custodian. It does not reconcile
to a broker, a prime, a fund administrator or a custodian, and it does not
produce figures suitable for client reporting, NAV calculation or financial
statements.

### A7. Regulatory recordkeeping is not satisfied automatically

Storing a decision in Tesseract does not, by itself, satisfy any recordkeeping
obligation under the Investment Advisers Act, the Securities Exchange Act, or
any other law or rule.

In particular, we do not represent that records held in Tesseract are
immutable, complete, retained for any required period, produced in any required
format, or acceptable to any regulator.

Users subject to recordkeeping rules remain responsible for their own
compliance, including retaining records independently of Tesseract.

> **★ Open for counsel — and this one may change the product.** Advisers will
> in practice keep required records here, because that is what the product
> invites. Whether that makes Tesseract a system where required records live,
> and what retention, immutability and production duties follow, needs a
> securities lawyer's view. It interacts directly with the facts that nothing
> is deleted on a timer and that production currently has no backup. See
> `../risk-register.md` §6 and §9.

### A8. No suitability assessment

Tesseract performs no suitability, appropriateness, best-execution or
concentration analysis, and makes no assessment of whether anything a user does
with it is appropriate for any account, client, mandate or jurisdiction.

### A9. Not an offer

Nothing in Tesseract or on its website is an offer or solicitation to buy or
sell any security, or to participate in any investment strategy.

---

## Part B — AI features (ACT AI)

### B1. What ACT AI actually is

ACT AI is an assistant inside the application. It answers questions using
retrieval over the organisation's **own** records — research, ideas,
recommendations, decisions and reviews — with the security and portfolio the
user is viewing as context, and it cites the records it used.

It runs on third-party large language models. Where the organisation supplies
its own provider key, the organisation holds that provider relationship.

It is described here as it behaves today. Nothing in this document describes a
capability that is planned rather than built.

### B2. Output can be wrong, and must be reviewed

AI output may be inaccurate, incomplete, outdated, internally inconsistent, or
confidently fabricated. Language models can produce text that is fluent,
specific and false, including invented figures and invented citations.

**Every AI output must be reviewed by a qualified person before it is relied on
for any investment decision.** Tesseract provides no assurance that output is
correct, current, complete, or suitable for any purpose.

Because retrieval runs over the organisation's own corpus, an answer is also
only as good as that corpus: it will faithfully repeat a stale thesis, an
erroneous note or a superseded price target.

### B3. Citations are a verification aid, not a guarantee

ACT AI points at the records it used. That makes a claim checkable; it does not
make it correct. A citation can be to a real record that does not support the
sentence attached to it. The citation exists so that a reviewer can check,
which presupposes that they do.

### B4. AI output in a decision record

Where AI output is saved, quoted, or otherwise becomes part of a decision
record, it is thereafter part of the organisation's record and subject to the
same review and recordkeeping considerations as any other content in it.

> **★ Open for counsel.** Three specific questions, each flagged in
> `../counsel-review-checklist.md` §R:
> 1. Does portfolio-specific AI analysis delivered for compensation carry
>    investment-adviser implications?
> 2. Does AI-generated content inside a record that an adviser relies on raise
>    supervision or recordkeeping questions for that adviser?
> 3. Does any ranking, score or ordering the product surfaces constitute a
>    recommendation?

### B5. Third-party processing, stated only as far as it is known

Using AI features transmits content to the applicable model provider. The
content can include asset data, investment theses, differentiated views, risks
to thesis, note bodies, outcomes, portfolio names and holdings.

**We do not currently represent that any provider refrains from retaining or
training on submitted content.** That position has not been confirmed in
writing with any provider, and this document will not claim it until it has.
One provider option is search-augmented, meaning a query may be used to
retrieve from the public web.

Where an organisation uses its own provider key, that provider is the
organisation's own subprocessor and the organisation's agreement with it
governs the processing.

The current providers and what they receive are listed in
`../SUBPROCESSORS.md`, which is kept factual.

### B6. Human authority only

ACT AI assists people who make decisions. It does not make investment
decisions, place orders, move money, exercise discretion, or act with any
authority of its own, and it has no connection to any execution venue.

No feature of Tesseract authorises autonomous trading. If that ever changes it
will be a separate, expressly agreed capability with its own disclosures, and
this paragraph will be the first thing to change.

### B7. Availability

AI features depend on third-party providers and can be unavailable, degraded or
rate-limited for reasons outside our control.

---

## Where these disclosures appear

Implemented in this change:

| Location | Form |
|---|---|
| Public site footer | link to the full document |
| Application account menu | link to the full document |
| Login and signup | link alongside the terms and privacy links |
| AI surfaces | short contextual line linking here |
| Market-data surfaces | short contextual line where freshness or derivation is material |

Deliberately **not** implemented: a full-page disclaimer, a modal on entry, or
a banner on every screen. A disclosure a user dismisses reflexively is a
disclosure that has stopped working, and obstructing the investment workflow to
display legal text is its own risk.

---

## Open items before this can be published

1. Entity name, and the jurisdiction whose law governs it.
2. Securities counsel on A1, A7 and B4 — the three starred items.
3. A decision on whether any Tesseract-provided (as opposed to user-authored)
   recommendation, score or ranking exists or is planned. If it does, this
   document is not sufficient.
4. Written confirmation of each AI provider's retention and training position,
   before B5 can say anything stronger than it does.
5. Market-data licence review, because A4 discloses defects in data we may not
   be licensed to redistribute at all (`../risk-register.md` §4).
