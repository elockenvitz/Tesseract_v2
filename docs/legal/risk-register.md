# Legal and commercial risk register — Tesseract

**Status: engineering assessment for counsel and founder. Not legal advice.**
Compiled 2026-11-25 from the codebase and a read-only query of the production
database. Severity is *practical* severity given what Tesseract actually is
today, not the severity the same item would carry at a company with customers.

Read [`LAUNCH-CHECKLIST.md`](./LAUNCH-CHECKLIST.md) first. Its calibration
argument governs this document too, and it is worth restating because it is the
single most important sentence in this directory:

> Most compliance obligations attach to a *commercial service handling real
> customer data*. Tesseract is not that yet, and the correct amount of work to
> do today is much smaller than it will be the week before the first customer
> signs.

Nothing here contradicts that. What this register adds is an ordered list of
what goes wrong, who it hurts, and which gate it blocks — so that work happens
in the order that actually reduces exposure.

## How to read the columns

**Blocks** is the earliest gate the item must clear:

| Gate | Meaning |
|---|---|
| **PUBLIC** | before the marketing site is publicly reachable |
| **EXTERNAL** | before any person outside the founder's circle gets application access |
| **REAL DATA** | before any real client holdings, real MNPI or real research enters |
| **PAID** | before a paying institutional customer signs |
| **SCALE** | later enterprise scaling |

**Confidence** distinguishes what was measured from what was inferred:

- **Verified** — measured in this pass, with the query or file path given.
- **Reported** — recorded by earlier work in this repo and not re-measured here.
- **Unknown** — genuinely not established; the register says so rather than guessing.

---

## The ten that matter

### 1. No legal entity exists, so there is no liability shield and nothing can be signed

**Blocks: REAL DATA (and every contract).** Confidence: reported — stated in
`LAUNCH-CHECKLIST.md`; formation status is not an engineering fact and was not
independently checked.

Without an entity, a breach reaches the founder personally: no corporate veil,
no entity to insure, no counterparty to a DPA. It also makes every document in
this directory unexecutable, because a contract needs two parties. The
counterparties are regulated investment firms whose portfolio holdings and
trade intentions would be the data at issue.

This is first not because it is urgent today but because it is on the critical
path of everything else. Every other item that says "before real data" is
gated behind this one.

**Control:** entity formation, then the entity's name replaces the central
placeholder (see `src/legal/entity.ts`, which is the one place it is
configured).

---

### 2. Nothing tells current users this is a test build, and nothing stops them entering real data

**Blocks: EXTERNAL.** Confidence: verified — 28 users and 29 organizations
exist in production; no terms, consent or acceptance table exists at all
(`pg_class` query, 2026-11-25); the "tell testers in writing" item in
`LAUNCH-CHECKLIST.md` is still unchecked.

This is the highest-probability route from "no real exposure" to "a real
incident", and it costs one paragraph to close. The application currently
presents itself as working investment software. A tester who loads a real book
into it converts every speculative item on this list into a live one, and
nothing in the product or in writing currently asks them not to.

The database's 29 organizations look like a customer base and are not one
(see [`project_prerelease_status`] in the founder's notes and the calibration
paragraph above). That gap between appearance and reality is itself the risk:
it is equally invisible to a tester.

**Control:** a written test-build notice in the invite path, plus the
acceptance infrastructure in this change (gated off, see §8).

---

### 3. Production has no backup and no point-in-time recovery

**Blocks: REAL DATA.** Confidence: reported — recorded as `backups: []` and
`pitr_enabled: false`. Not re-measured in this pass, because it reads from the
Management API rather than SQL. **Re-confirm before relying on this line.**

A decision operating system whose pitch is institutional memory cannot lose
the memory. There is one database, it is production, and there is no second
copy. A bad migration, an accidental `delete`, or a provider-side failure is
currently unrecoverable.

This is a legal risk and not only an operational one: a DPA commits a processor
to restoring availability, and an SLA with any data-recovery language is
unmeetable without this. It is also the cheapest severe item on the list to
fix.

**Control:** enable backups and PITR (a paid-plan decision), then state the
actual recovery objective in `contracts/support-sla-draft.md` instead of the
placeholder.

---

### 4. Market data is used without a commercial redistribution licence

**Blocks: PUBLIC for marketing claims, REAL DATA for the feature itself.**
Confidence: verified — `src/lib/financial-data/browser-client.ts` (14
importers) calls `query1.finance.yahoo.com` and `finnhub.io` **directly from
the browser**; `src/lib/financial-data/providers/alpha-vantage.ts` retains
`alphavantage.co` endpoints; EODHD is reached through an Edge Function.

Three distinct problems, and they are often conflated:

1. **Availability is not permission.** That an endpoint answers does not mean
   its terms permit use inside a commercial multi-tenant SaaS product. Yahoo
   Finance has no public commercial API terms that cover this; Finnhub's
   published `demo` token is not a commercial licence.
2. **Per-seat licences do not cover a shared cache.** EODHD is single-seat.
   Writing its data into `price_history_cache`, which other tenants then read,
   is redistribution to parties outside the licence.
3. **A disclaimer is not a licence.** No amount of "data may be inaccurate"
   language in the terms of use creates a right to redistribute someone else's
   data.

**Control:** vendor-by-vendor licence review before any external access
(`counsel-review-checklist.md` §L), and a decision on whether the browser
should be calling these providers at all.

---

### 5. The AI feature transmits customer research to model providers under unconfirmed terms

**Blocks: REAL DATA.** Confidence: verified — `supabase/functions/ai-chat`
assembles and transmits asset data, investment theses, `where_different`,
`risks_to_thesis`, note bodies, outcomes, portfolio names and holdings
(`DATA-INVENTORY.md` §3). Platform default is Anthropic, model
`claude-3-5-sonnet-20241022` (verified in `platform_ai_config`, 2026-11-25).
**Unknown:** whether zero-retention or no-training terms are in place with any
provider.

Portfolio holdings and trade intentions are the material non-public
information of a regulated adviser. Transmitting them to a third party is a
disclosure that a customer's compliance officer will ask about in the first
diligence call, and the honest current answer is that the provider's retention
and training position has not been confirmed in writing.

Perplexity deserves separate mention: it is search-augmented, so a query may be
used to retrieve from the public web. That is a different disclosure from a
model that answers from weights.

Note the BYOK split: where an organization supplies its own key, that
organization holds the provider relationship and the provider is **its**
subprocessor, not Tesseract's. BYOK is configured via `byok_secret_id`
(verified: `organization_ai_config` has no plaintext key column).

**Control:** confirm each provider's terms in writing before the privacy policy
or DPA asserts anything about retention or training. Until then, neither
document may claim it — and neither currently does.

---

### 6. Whether Tesseract is a regulatory recordkeeping system is unresolved, and it shapes the product

**Blocks: PAID.** Confidence: verified as unresolved — raised as question 2 in
`DATA-INVENTORY.md` §9 in August 2026 and still open.

Advisers Act Rule 204-2 requires SEC-registered advisers to make and keep
specified records, and to be able to produce them. Tesseract's entire pitch is
that advisers keep their research and decision reasoning in it, so in practice
they will. If that makes Tesseract a system where required records live, then
retention, immutability and production duties attach — and those are product
requirements, not paperwork.

The current terms draft disclaims it (`policies/application-terms-draft.md`
§6). Whether that disclaimer survives contact with the facts is a securities
lawyer's judgement, and the interaction with §9 below (nothing is ever deleted)
and with §3 (nothing is backed up) is direct.

**Control:** specialist securities counsel, asked early, because the answer may
change what gets built.

---

### 7. AI-generated, portfolio-specific output may carry investment-adviser implications

**Blocks: PAID (and EXTERNAL for any company-provided recommendation).**
Confidence: verified as to behaviour — the assistant answers questions about a
specific security in the context of a specific portfolio; `INTELLIGENCE` on the
public page describes exactly this. **Unknown:** the regulatory
characterisation.

There is a meaningful difference, legally, between:

- a tool that stores a human's recommendation, and
- a tool that generates portfolio-specific analysis and presents it to a
  decision-maker.

Tesseract does the first by design and the second through ACT AI. Software that
produces personalised securities analysis for compensation is the fact pattern
that investment-adviser regulation addresses, and the answer does not turn on
whether a disclaimer says otherwise.

**A disclaimer asserting exemption is not an exemption.** The disclosures
drafted here say what the software does and does not do; they deliberately do
**not** assert that Tesseract is outside the Advisers Act.

**Control:** securities counsel on the classification of (a) AI-generated
portfolio-specific analysis, (b) any ranking or score the product surfaces, and
(c) AI output that becomes part of a decision audit record. Flagged in
`counsel-review-checklist.md` §R.

---

### 8. There is no terms acceptance of any kind, so there is no contract with any current user

**Blocks: EXTERNAL.** Confidence: verified — no table matching `term`,
`accept` or `consent` exists in `public` (2026-11-25); no acceptance control
exists in the signup or invite flow.

28 people have accounts under no terms at all. There is no limitation of
liability, no acceptable-use obligation, no disclaimer of warranties, and no
"not investment advice" acknowledgement binding on anyone using the product
today.

The fix has two halves and only one is engineering. This change builds the
acceptance infrastructure — a versioned document registry, an affirmative
unchecked control, a server-verified acceptance record and its migration — and
ships it **switched off**, because activating a clickwrap for unapproved terms
would be worse than having none: it would create a record of users accepting a
document counsel has not read.

**Control:** counsel approves the documents, then the gate is turned on. The
sequence is in `legal-release-checklist.md`.

---

### 9. Nothing is ever deleted, and there is no self-service export

**Blocks: REAL DATA for retention; PAID for export.** Confidence: verified —
the only retention control in the schema is
`organization_governance.retention_days_audit_log` (2026-11-25, unchanged since
August). `erase_user_personal_data` exists and is verified end-to-end; the
`org-exports` infrastructure exists but there is no user-facing DSAR flow.

Two different exposures:

- **Unbounded retention.** Notes, research, holdings history, activity events
  and uploaded files are kept indefinitely. For data that includes a regulated
  firm's MNPI, "we keep everything forever by default" is a position that needs
  to be chosen rather than inherited.
- **No export.** A customer asking for its data back on termination, or an
  individual making a subject-access request, is a manual engineering job
  today. A DPA that promises return of data on termination is promising a
  manual process.

Note that erasure is deliberately a *split*: the person is erased, the work
they authored is retained as the firm's business record. That is defensible —
deleting an adviser's records on an individual's request would destroy the
firm's compliance record — but it has to be disclosed, and the privacy policy
does disclose it.

**Control:** choose a retention position; build export before promising it.
The privacy policy must not describe a deletion or export capability that does
not exist, and currently does not.

---

### 10. Tenant isolation rests on RLS policy correctness, with a known register of exceptions

**Blocks: EXTERNAL.** Confidence: verified — **296 of 296** public tables have
RLS enabled and there are **957 policies** (2026-11-25). Three tables have RLS
enabled and **no policy at all** (`custom_notebook_notes`,
`market_data_cache`, `trade_lab_view_members`), which denies access rather than
granting it. `src/lib/org-scope/known-unscoped-queries.json` lists **109
files** that query org-scoped tables without an explicit organization filter
and rely on RLS alone.

The posture is genuinely better than most products at this stage: RLS is on
everywhere, two lint scripts and a test guard the boundary, and a live
cross-org storage test passed 15/15. The residual risk is concentrated and
nameable rather than diffuse:

- a single incorrect policy expression is a cross-tenant read, and there are
  957 of them;
- the 109-file register is a list of places where the only thing between two
  customers is a policy being right;
- three closed incidents in August 2026 were exactly this failure mode
  (`DATA-INVENTORY.md` §8), including a storage read policy with no tenant
  condition.

A customer's security questionnaire will ask about the 109-file register, and
the answer should be prepared rather than improvised.

**Control:** the existing lints stay required; the 109-file register is a
work-down list, not a permanent baseline; the security schedule states this
honestly rather than claiming isolation is proven everywhere.

---

## Also real, lower in the order

| # | Risk | Blocks | Confidence | Note |
|---|---|---|---|---|
| 11 | **Whether the August 2026 bucket exposure requires customer or regulator notification is undecided.** The `assets` bucket was publicly readable until 2026-08-14 and its read policy had no tenant condition. 9 objects, one organization. | REAL DATA | Verified closed; notification question open | A legal judgement, not an engineering one. Access logs were never examined, so whether anything was retrieved is **unknown**. `DATA-INVENTORY.md` §8 has the facts; §9 q1 has the question. |
| 12 | **Sentry session replay records the DOM of an errored session.** `replaysOnErrorSampleRate: 1.0`, happy sessions never recorded, masking pinned explicitly (`maskAllText`, `maskAllInputs`, `blockAllMedia`), `sendDefaultPii: false`. | EXTERNAL | Verified in `src/main.tsx` | The single most commonly challenged item in a security review. Disclosed plainly in the privacy policy. Masking reduces but does not eliminate the exposure: layout, navigation and timing still reveal a firm at work. |
| 13 | **No insurance.** No cyber liability, no errors-and-omissions. | PAID | Reported | Cannot be bought before the entity exists, so it sits behind §1. An E&O assessment is specifically relevant given §7. |
| 14 | **No incident-response rehearsal.** The plan exists (`INCIDENT-RESPONSE.draft.md`) and commits to the Reg S-P 72-hour service-provider notification; it has never been exercised. | PAID | Reported | The obligation arrives with the first customer contract. An unrehearsed plan is a document, not a capability. |
| 15 | **Customer-uploaded content carries third-party material.** 9 objects, 703 kB as of August. Sell-side research, news excerpts and company logos arrive inside customer uploads. | PAID | Verified count (Aug); content types reported | Tesseract processes rather than publishes it, which is the better posture. The terms need customer warranties about upload rights; see §10 of this register's companion in `counsel-review-checklist.md` §T. |
| 16 | **No DMCA agent, and no determination of whether safe harbour applies.** | SCALE | Verified as undetermined | Likely low: there is no public user-generated content surface, so the classic 512(c) fact pattern is thin. Do not claim safe harbour without completing the statutory steps — registration and designation — and do not claim it as a marketing point. |
| 17 | **Open-source dependency licences unreviewed.** | PAID | Unknown | Standard for the stage. A customer questionnaire may ask; an SBOM is cheap to produce later. |
| 18 | **Code ownership and IP assignment.** Whether all contributed code is owned by the entity-to-be. | PAID | Unknown — not an engineering fact | Matters at a financing or acquisition, not before. |

---

## What is genuinely *not* a risk worth work today

Being accurate about this is part of the job. Overstating the list is how a
register gets ignored.

- **GDPR / UK GDPR.** Applies if there are EU or UK users. Whether there are is
  **unknown** and was not established here, but the product is sold to US
  institutional investment firms and nothing targets Europe. Determine it;
  don't pre-build for it.
- **CCPA / CPRA.** Threshold-dependent (~$25M revenue or 100k consumers).
  Nowhere near. Note it has covered B2B contacts since 2023, so it arrives with
  scale rather than never.
- **A cookie consent banner.** Verified: there is **no** third-party
  analytics, no advertising pixel and no marketing tag anywhere in the
  codebase or `index.html`. The only client-side storage is the Supabase auth
  session plus product preferences — strictly necessary. A consent banner here
  would be theatre, and a banner with toggles that control nothing is worse
  than no banner. See `policies/cookie-notice-draft.md`.
- **SOC 2 / ISO 27001.** Will be asked for by institutional buyers. "Not yet,
  planned" is survivable; a false attestation is not. Nothing in this directory
  claims either.

---

## The five questions this register cannot answer

Carried forward from `DATA-INVENTORY.md` §9, still open, now with the register
item each one gates:

1. Does the August 2026 bucket exposure trigger notification? → §11
2. Does Rule 204-2 make Tesseract a recordkeeping system? → §6, §9
3. Are EU/UK users in scope? → not a risk until answered
4. Do the AI providers' standard terms suffice, or is a zero-retention
   agreement needed per provider? → §5
5. Is the investment-adviser characterisation of AI output a problem? → §7
   *(new; the August list predates ACT AI's current behaviour)*

Every one of them is in `counsel-review-checklist.md` with a recommended
starting position, so counsel receives a decision to approve or correct rather
than an open question.
