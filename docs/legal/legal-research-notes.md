# Legal research notes

**Status:** working notes, not advice. **Compiled:** 2026-11-25.

---

## What this file is, and what it is not

This records where the positions taken in the drafts in this directory came
from, so that counsel reviewing them can see the reasoning rather than
reverse-engineer it, and so that a position adopted from a source can be
re-checked when that source changes.

**It is not legal advice and was not written by a lawyer.** Nothing in this
directory was. Every item below is either (a) a primary source, (b) a
widely-used industry form, or (c) a reasoning step taken in the absence of
either, and each is labelled so the three are not confused.

Two kinds of entry appear, and the distinction matters more than anything
else in this file:

| Label | Meaning |
|---|---|
| **SOURCE** | A primary text, or a published regulator or vendor document, retrieved on the date given. |
| **REASONING** | A position taken because no source settles it. These are the ones counsel must actually review. |

A REASONING entry is a guess made carefully. It is not a finding.

---

## 1. Investment-adviser status

**REASONING, and the single most important open question in this directory.**

The drafts consistently say Tesseract is software, that it gives no investment
advice, places no orders, and is not an investment adviser or broker-dealer.
That is a description of what the product does, and it is accurate as to what
the code does today.

**It is not a legal conclusion that the Advisers Act does not apply**, and the
drafts deliberately never say that it is. The reason the distinction is drawn
so insistently: a disclaimer does not determine regulatory status. What
determines it is what the product actually does, for whom, and for what
consideration. A product that generates a recommendation, attributes it to a
named analyst and routes it for approval has features that are worth a
securities lawyer's time, regardless of what the terms say.

Specific facts counsel will need, all of which are in the product today:

- Conviction scores and weighted valuation distributions are computed and
  surfaced to the user.
- Recommendations are created, submitted and approved inside the product, with
  an approval path and an audit trail.
- Price targets are recorded, and outcomes measured against them.
- The AI features generate prose about specific named securities.

What the product does **not** do today: place orders, hold custody, touch
client money, or offer the output to anyone outside the subscribing firm.

**→ Item R in `counsel-review-checklist.md`. Marked 🔴 blocking.** No document
here should be published before a securities lawyer has looked at this, because
publishing a confident characterisation of regulatory status is exactly the
kind of statement that is later read back to you.

**Sources deliberately NOT relied on:** no SEC no-action letter, staff
guidance, or exemption is cited anywhere in these drafts, because finding one
that appears to fit is the specific failure mode here. Reading an exemption as
applying to your own facts is what counsel is for.

---

## 2. Market-data redistribution

**SOURCE (vendor terms) + REASONING (the gap).**

The product calls four market-data vendors. Two are called from the browser,
so the end user's IP address reaches them directly:

| Vendor | Called from | What the public terms say, in summary |
|---|---|---|
| EODHD | Edge Function | Per-seat licensing. Retrieved 2026-11-25 from the subscription page: the plan is single-user. |
| Alpha Vantage | Edge Function (`market-news`) | Free tier is for personal/evaluation use; commercial use requires a paid plan. |
| Yahoo Finance | **Browser**, `src/lib/financial-data/browser-client.ts` | No commercial API licence exists for the endpoint used. |
| Finnhub | **Browser**, same file | Free tier prohibits redistribution. |

**REASONING on what follows.** Caching a vendor's prices in
`price_history_cache` and serving them to a second user of the same
organization is, on a plain reading of per-seat terms, serving data to someone
who is not the licensed seat. The MSA draft's §10 allocates that risk to the
customer contractually. It says so explicitly in the clause note, in these
terms: *the clause allocates the risk; it does not create the right.*

A contract with a customer cannot grant rights the vendor has not granted.
If the vendor's terms prohibit it, the contract clause means the customer
bears the loss — it does not make the conduct licensed.

**→ Item L in `counsel-review-checklist.md`. Marked 🔴 blocking.** The
actionable step is not legal at all: send each vendor the licensing
questionnaire and get a written answer about multi-user access and caching.
That is a founder task with no lawyer in the loop, and it is the cheapest
🔴 on the list to close.

**Retrieval caveat.** Vendor terms pages change without notice and without
versioning. The summaries above were read on 2026-11-25 and should be treated
as stale on sight. The vendor's written answer to a direct question is worth
more than any reading of their public page, which is the whole point of the
questionnaire.

---

## 3. Privacy law applicability

**REASONING, from the facts in `DATA-INVENTORY.md`.**

The privacy policy is drafted to a US-state baseline rather than to GDPR,
because every user today is in the United States and there is no EU
establishment and no EU-directed offering. That is a decision about scope, and
it is a decision that expires the moment a non-US user signs up.

What the draft relies on, all verified against the live database on
2026-11-25:

- **Zero cookies.** Confirmed by inspection of the running application:
  `document.cookie.length === 0` on the public pages, and the Supabase client
  is configured for `localStorage` session persistence rather than cookies.
  This is why there is no cookie banner, and the reason is stated in the
  cookie notice itself. A banner with no cookies behind it is a fake control,
  which the mandate prohibits and which is worse than nothing because it
  trains users to dismiss consent UI.
- **Named recipients.** Sentry (error monitoring), Anthropic (AI), Perplexity
  (retrieval), Supabase (hosting and database), Netlify (hosting), plus the
  market-data vendors above. These are listed by name in `SUBPROCESSORS.md`
  rather than described as "service providers", because a category is not a
  disclosure.
- **No data-retention period is stated anywhere**, because none has been
  decided. The drafts say what happens to data, not for how long it is kept.
  Inventing a period would be inventing a commitment nobody has made.

**→ Items C and Z in `counsel-review-checklist.md`.** Both need a founder
decision before counsel can usefully review: a privacy contact address that
exists, and a retention decision.

**Open and unhoused:** the August 2026 storage-bucket exposure. Whether that
required notification under any state breach-notification statute has never
been assessed. It is recorded in `counsel-review-checklist.md` §Z because it
had no other home, and it is the kind of question that does not improve with
age.

---

## 4. Liability caps and super-cap carve-outs

**SOURCE (industry form) + REASONING (the numbers).**

The structure in `contracts/saas-msa-draft.md` §13–§14 follows the shape
common to institutional SaaS agreements: a fee-multiple cap on direct
damages, exclusion of consequential damages both ways, and a short list of
obligations that sit outside the cap.

**The recommended cap is 2×–5× fees paid in the prior twelve months.** That
is a REASONING position, not a source: it is the range an early-stage vendor
can plausibly hold, and the draft says plainly that a buy-side customer's
counsel will push for more. What a vendor can actually agree to is bounded by
what it can survive, and with no E&O or cyber insurance in place the honest
answer is "not much" — which is itself the argument for buying insurance
before negotiating, not after.

The three candidate super-cap carve-outs, and the drafting position on each:

1. **Confidentiality breach** — conventional, and recommended to accept.
2. **Indemnified IP claims** — conventional, and recommended to accept.
3. **Data-security breach** — the expensive one. A buy-side customer will ask
   for it. Agreeing to uncapped liability for a security incident, with no
   cyber insurance, no production backup and no tested restore, is agreeing to
   an unbounded exposure against an unmitigated risk. The draft recommends
   resisting it and says why, rather than quietly accepting it to close a
   deal.

**REASONING on the MNPI clause (§6.5).** The draft flags this as a genuine
choice rather than resolving it. Acknowledging that customers may enter
material non-public information is honest and matches what the product is for.
It also tends to undercut a liability cap, because it is evidence the vendor
knew the data was sensitive. The draft states both sides and leaves it open,
because picking the favourable side quietly is what the mandate prohibits.

---

## 5. Clickwrap acceptance and authority to bind

**SOURCE (settled US contract doctrine) + REASONING (the architecture).**

Clickwrap acceptance — an unticked box, text available before acceptance, a
record of who accepted what and when — is the well-established pattern, and
the implementation follows it:

- No prechecked box. Asserted in `legal-ui.test.tsx`.
- The documents are linked and readable before the box can be ticked, and the
  acceptance gate is *closed* while publication is off, so it is structurally
  impossible to be asked to accept terms you cannot read.
- The record is a database row with the document id, the exact version string
  and a server-generated timestamp. Not `localStorage`, which the mandate
  prohibits as a sole record and which is per-browser, per-device and
  user-clearable.

**REASONING on authority to bind.** An individual analyst ticking a box on a
signup form is not evidence that their employer is bound. The acceptance text
says "on my own behalf as an authorised user" for exactly this reason, and the
institutional relationship is carried by a signed MSA and Order Form instead.
Treating a clickwrap as binding a buy-side firm is a theory that gets tested
at the worst possible moment.

**REASONING on existing users.** The 28 existing accounts are never
back-dated. Acceptance is for new accounts first (stage 3 of
`legal-release-checklist.md`), existing users are prompted separately at stage
4, and no row is ever written retroactively. A fabricated consent record is
worse than no record, because it looks like consent and will be relied on.

---

## 6. Security representations

**SOURCE: the measured state of the system. REASONING: what may be said.**

Every security statement in these drafts is written against what was verified,
and `contracts/security-schedule-draft.md` marks each line 🟢 / 🟡 / 🔴
accordingly. What is deliberately absent:

- **No SOC 2, no ISO 27001, no penetration test, no audited compliance
  claim.** None has been done. Claiming any of them is a misrepresentation and
  the kind that survives into litigation.
- **No uptime figure.** There is no uptime monitoring, so any number would be
  invented. `contracts/support-sla-draft.md` opens with the prerequisite table
  for this reason, and its Option A is "no commitment".
- **No RPO or RTO.** There is no production backup and no point-in-time
  recovery (verified: `backups: []`, `pitr_enabled: false`), and no restore
  has ever been performed. The draft says: writing a recovery objective into a
  contract before a restore has succeeded is committing to something nobody
  has ever done.

What may be said, and is: RLS is enabled on all 296 tables with 957 policies;
all 7 storage buckets are private; the database is PostgreSQL 17.4 on managed
infrastructure. Those are measurements, taken on 2026-11-25, with the queries
recorded in `DATA-INVENTORY.md` §10.

---

## 7. Sources consulted

**Primary and vendor sources,** all retrieved 2026-11-25:

- Vendor pricing and terms pages for EODHD, Alpha Vantage, Yahoo Finance and
  Finnhub, as summarised in §2. Treat as stale; get written answers.
- The live Supabase project catalogue, for the RLS, policy, bucket and version
  figures. Queries in `DATA-INVENTORY.md` §10. Read-only
  (`transaction_read_only = on` confirmed before each).
- The application's own source, for the data-flow and recipient list.

**Industry forms** referenced for structure, not copied: the common shape of
institutional SaaS master agreements, order forms, DPAs and security
schedules. No specific firm's precedent is reproduced.

**Not consulted, and this is a limitation worth stating plainly:** no
securities counsel, no privacy counsel, no insurance broker, and no vendor
licensing representative. Every 🔴 item in
`counsel-review-checklist.md` is 🔴 precisely because one of those four
conversations has not happened. This directory is the preparation for those
conversations, not a substitute for them.

---

## 8. How to use this file in review

Read it alongside `counsel-review-checklist.md`, which is the register of what
needs deciding. This file explains *why* each position was taken; that file
tracks *who* has to decide it and *what* is blocked until they do.

If a REASONING entry above turns out to be wrong, the document it supports is
wrong too. The cross-references are deliberate: each section names the
checklist item it feeds, so a correction has a path to the text that depends
on it.
