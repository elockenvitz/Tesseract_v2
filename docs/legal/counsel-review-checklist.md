# Founder and counsel decision register

**Status: a list of decisions engineering must not make alone.**
Compiled 2026-11-25. Nothing in this directory is legal advice, and nothing in
it has been reviewed by a lawyer.

---

## How to use this

Every item below is a decision that is **commercial, legal or regulatory**
rather than technical. Each one carries:

1. **Recommended starting position** — what to open with, so counsel receives a
   draft to correct rather than a blank page.
2. **Why** — the reasoning, so the recommendation can be disagreed with on its
   merits.
3. **Risk / tradeoff** — what going the other way costs.
4. **Unknown** — what is genuinely not established.
5. **Specialist counsel?** — whether a generalist can sign it off.
6. **Blocks** — the earliest gate it holds up, using the gates from
   [`risk-register.md`](./risk-register.md): **PUBLIC**, **EXTERNAL**,
   **REAL DATA**, **PAID**, **SCALE**.

**The shortest useful path:** the five items marked 🔴 **BLOCKING** are the
only ones needed before anything external happens. Everything else can wait
for the deal that needs it.

| | Decision | Blocks |
|---|---|---|
| 🔴 | **A** — the contracting legal entity | everything |
| 🔴 | **C** — a legal and privacy contact that a person reads | PUBLIC |
| 🔴 | **L** — market-data licensing | EXTERNAL |
| 🔴 | **R** — regulatory status of AI output | PAID (and EXTERNAL for any Tesseract-provided recommendation) |
| 🔴 | **X** — which documents are approved, and from when | PUBLIC |

---

## A. 🔴 The contracting legal entity

**Recommended:** form a Delaware LLC or C-corp before any external access, and
put its exact legal name into `src/legal/entity.ts`, which is the single place
every document reads it from.

**Why:** without an entity there is no corporate veil, nothing to insure, and
no party to sign a contract. The counterparties are regulated investment firms
whose portfolio holdings would be the data at issue. It is also on the critical
path of A→W: no DPA, no MSA, no pilot agreement and no insurance can exist
first.

**Risk / tradeoff:** formation costs money and creates filing obligations.
Doing it late means either operating personally exposed or delaying the first
pilot. There is no third option.

**Unknown:** whether formation has already begun. Not an engineering fact and
not checked here.

**Specialist counsel?** No — a corporate lawyer or a formation service.

**Blocks:** everything. Every other 🔴 depends on it.

---

## B. Business address

**Recommended:** a registered agent's address or a real office. Not a home
address.

**Why:** the address goes into published policies and into every contract. A
home address on a public privacy policy is permanent and scrapeable.

**Risk / tradeoff:** a registered-agent service is a small recurring cost. A
mail-drop may be unacceptable to some institutional counterparties' diligence.

**Unknown:** nothing material.

**Specialist counsel?** No.

**Blocks:** PUBLIC (any published policy needs it).

---

## C. 🔴 Legal and privacy contact

**Recommended:** `legal@` and `privacy@` on the company domain, both monitored,
both answered. They may point to the same inbox initially — say so internally,
not in the policy.

**Why:** CalOPPA practice expects a contact route on a posted privacy policy.
More practically, a privacy or security question that goes unanswered for two
weeks is itself the incident.

**Risk / tradeoff:** publishing an address invites spam and invites
researchers. The second is a feature.

**Unknown:** whether a domain is owned yet.

**Specialist counsel?** No.

**Blocks:** PUBLIC.

---

## D. Governing law

**Recommended:** Delaware, if the entity is Delaware. Otherwise the state of
the entity's principal place of business.

**Why:** aligning governing law with the entity's jurisdiction is the simplest
defensible choice and avoids arguing two questions instead of one. Delaware has
well-developed commercial case law.

**Risk / tradeoff:** an institutional customer may insist on its own
jurisdiction, most often New York. That is a normal concession; decide in
advance whether it is acceptable and at what point in the negotiation to give
it.

**Unknown:** where the entity will be formed, and where the first customers
will be.

**Specialist counsel?** No, but it should be decided together with E and F
rather than separately.

**Blocks:** PUBLIC (the website terms name it).

---

## E. Venue

**Recommended:** exclusive jurisdiction of the state and federal courts in the
governing-law jurisdiction.

**Why:** consistency with D; predictable and cheap to draft.

**Risk / tradeoff:** a customer in another state will resist travelling.
Neutral venues are a common compromise.

**Unknown:** as D.

**Specialist counsel?** No.

**Blocks:** PUBLIC.

---

## F. Arbitration and class-action waiver

**Recommended:** **no arbitration clause** in the website terms of use;
decide per-contract for the MSA.

**Why:** the users here are institutions, not consumers, and the realistic
dispute is a commercial one between two businesses that will be negotiated or
litigated either way. A class-action waiver is aimed at consumer mass claims,
which is not this risk profile. Adding a consumer-style arbitration clause to a
browsewrap page adds enforceability argument without reducing real exposure.

**Risk / tradeoff:** arbitration can be cheaper and private, which has
attractions for a small company facing a large one. It can also be expensive
and unappealable.

**Unknown:** nothing that changes the recommendation at this stage.

**Specialist counsel?** Yes if arbitration is wanted — drafting an enforceable
clause is specialist work and a defective one is worse than none.

**Blocks:** PUBLIC (only in the sense that the website terms must say
something).

---

## G. 🟠 Liability cap and its exclusions

**Recommended:**
- paid customers: aggregate cap at fees paid in the preceding 12 months;
- unpaid pilots and evaluation: nominal cap of USD 100 (a fees-based cap would
  be zero);
- **confidentiality breach and security incidents: a super-cap at 2×–5× fees**,
  not uncapped, and not inside the general cap;
- uncapped only for fraud, wilful misconduct, and what law will not let you
  limit.

**Why:** this is the highest-value decision in the package. The product holds
portfolio holdings and trade intentions — the MNPI of regulated firms — so a
customer will treat a confidentiality leak as catastrophic and will open by
demanding unlimited liability for it. A super-cap is the usual landing zone and
is defensible on the merits. Accepting unlimited liability without cyber
insurance means the entity's entire value is the cap.

**Risk / tradeoff:** holding firm may lose a deal. Conceding may create an
uninsured exposure that exceeds the company's worth. Note the dependency: the
acceptable position depends on **W (insurance)**, which depends on **A
(entity)**.

**Unknown:** what the first customers will actually demand; what cyber cover
costs and what it covers.

**Specialist counsel?** Yes — a commercial technology lawyer, and ideally one
who has negotiated against buy-side procurement.

**Blocks:** PAID. Decide before the first negotiation rather than inside it.

---

## H. Renewal, pricing and uplift

**Recommended:** 12-month term, auto-renewal with 60 days' notice to cancel,
and a renewal uplift capped at CPI + 3%.

**Why:** predictable revenue, and an uplift cap is what makes auto-renewal
palatable to procurement.

**Risk / tradeoff:** auto-renewal without a cap is a frequent procurement
objection and occasionally a consumer-protection issue in other contexts. No
auto-renewal means re-selling annually.

**Unknown:** pricing. Nothing in this package assumes a number.

**Specialist counsel?** No.

**Blocks:** PAID.

---

## I. Indemnification scope

**Recommended:** give a standard IP indemnity for the Service as provided, with
the usual carve-outs; take an indemnity for Customer Data and misuse.
**Exclude AI output from the IP indemnity initially.**

**Why:** an IP indemnity is expected and refusing it signals inexperience.
Extending it to AI output means indemnifying a claim arising from a third-party
model's behaviour, which is outside our control and which our own providers do
not indemnify us for on standard terms.

**Risk / tradeoff:** a sophisticated customer may insist on AI-output coverage.
If so, the right answer is a narrow, capped carve-out rather than silence.

**Unknown:** whether the AI providers' terms offer any pass-through indemnity.
Not checked.

**Specialist counsel?** Yes.

**Blocks:** PAID.

---

## J. Warranty commitments

**Recommended:** warrant only reasonable skill and care, and no knowing
introduction of malicious code. Disclaim everything else to the extent
permitted.

**Why:** every warranty is a promise about software that is pre-release.
Warranting regulatory compliance or fitness for a customer's purpose is
undeliverable.

**Risk / tradeoff:** thin warranties invite negotiation. They are also the
truthful position.

**Unknown:** nothing.

**Specialist counsel?** No.

**Blocks:** PAID.

---

## K. Security obligations

**Recommended:** commit to the measures in
[`contracts/security-schedule-draft.md`](./contracts/security-schedule-draft.md)
**as that document states them, statuses included** — and to notifying a
security incident within 72 hours.

**Why:** the schedule's value is that each control carries VERIFIED /
UNVERIFIED / PLANNED / MISSING. Committing to it as written commits to the
truth. Committing to a tidied version commits to fiction, and a security
schedule is a contractual representation: every ✅ becomes a warranty.

**Risk / tradeoff:** the schedule discloses no MFA, no backups, no pen test and
no SOC 2. Some buyers will decline on that basis. They would decline later and
more expensively on discovering it.

**Unknown:** whether the 72-hour clock can actually be met — the incident plan
has never been rehearsed.

**Specialist counsel?** Yes for the contractual language; the facts are
engineering's and are given.

**Blocks:** PAID. The MFA and backup gaps block **REAL DATA** independently.

---

## L. 🔴 Market-data licensing

**Recommended:** before any external user, review every market-data source and
either obtain a commercial licence that permits multi-tenant SaaS use, or
remove the source. Treat per-seat licences as incompatible with a shared cache
until a vendor says otherwise in writing.

**Why:** three distinct problems, all verified (`risk-register.md` §4): the
browser calls Yahoo Finance and Finnhub directly; a per-seat vendor's data is
written to a cache other tenants read; and Alpha Vantage endpoints remain in
the code. **A liability disclaimer is not a licence.** Market-data vendors
enforce, and their claims are contractual rather than speculative.

**Risk / tradeoff:** commercial market-data licences are expensive and are
often the largest fixed cost of a product like this. Removing data sources
weakens the product. Doing neither is the only option that is not available.

**Unknown:** every vendor's actual terms as applied to this architecture. None
has been read against it.

**Specialist counsel?** Not usually a lawyer first — start with the vendors'
commercial teams, then have counsel read the licence that comes back.

**Blocks:** EXTERNAL.

---

## M. Service availability commitments

**Recommended:** commit to nothing until availability is measured. Then commit
below what was observed for a full quarter.

**Why:** there is no uptime monitoring, so there is not currently a basis to
report availability, never mind warrant it. See
[`contracts/support-sla-draft.md`](./contracts/support-sla-draft.md) §5.

**Risk / tradeoff:** "no SLA" is a procurement objection. It is survivable for
a design partner and generally not for an enterprise purchase.

**Unknown:** actual availability. Never measured.

**Specialist counsel?** No.

**Blocks:** PAID.

---

## N. Data ownership and retention

**Recommended:** customer owns its data (already drafted that way). **Choose a
retention position**: our recommendation is to keep customer content for the
subscription term plus 30 days, then delete, with a configurable longer period
for customers with recordkeeping obligations.

**Why:** today nothing is deleted on a timer, so the de facto position is
"everything, forever", including MNPI. That is a position worth choosing rather
than inheriting, and it is the opposite of what a data-minimisation question in
a diligence questionnaire expects.

**Risk / tradeoff:** a short retention period collides with customers' own
recordkeeping duties (see R). A long one accumulates sensitive data and
enlarges every breach.

**Unknown:** what customers will require, which depends on R.

**Specialist counsel?** Yes — jointly with R, because the answers interact.

**Blocks:** REAL DATA for the decision; PAID for the implementation.

---

## O. Termination and export rights

**Recommended:** commit to making data available for export for 30 days after
termination, **described as a manual process with a stated timescale**, until a
self-service export exists.

**Why:** there is no export capability. Both the MSA (§17) and the application
terms (§27) currently contain export language that the software cannot honour.
This is the clearest instance in the package of a draft promising more than the
code does, and it is flagged ⚠ in both places.

**Risk / tradeoff:** a manual commitment is a real operational burden at scale.
Building export first costs engineering time before any revenue.

**Unknown:** nothing. The gap is known.

**Specialist counsel?** No. This is a build-or-redraft decision.

**Blocks:** PAID. 🟠 The clauses must not be published as written.

---

## P. Data processing roles

**Recommended:** adopt the split already drafted — the customer is controller
of its research, holdings and client data; Tesseract is processor for that; and
Tesseract is controller for account data about the customer's employees (name,
email, login).

**Why:** it reflects what actually happens and is the conventional allocation
for B2B SaaS.

**Risk / tradeoff:** being controller for account data brings direct
obligations rather than contractual ones. The alternative — claiming processor
status for everything — is not credible.

**Unknown:** whether any already-signed customer contract says something
different. `DATA-INVENTORY.md` §1 flags this as unverified.

**Specialist counsel?** A privacy lawyer should confirm.

**Blocks:** PAID.

---

## Q. Privacy law applicability

**Recommended:** proceed on the basis that **CalOPPA** applies (a posted policy
is required for any commercial online service collecting personal information
from Californians) and that **CCPA/CPRA** does not yet (thresholds are ~$25M
revenue or 100k consumers). Establish whether any EU or UK users exist before
assuming GDPR is out of scope. Do not claim compliance with any state law not
specifically assessed.

**Why:** a posted policy is the cheap baseline obligation. Claiming
comprehensive compliance with every US state regime is both unverifiable and
unnecessary.

**Risk / tradeoff:** under-scoping misses an obligation; over-scoping produces
a policy making promises nothing implements, which is the worse failure here.

**Unknown:** whether there are EU/UK users. **Open since August 2026 and still
not established.** New Jersey's law was raised in the brief for this work and
has not been assessed — note that its applicability also turns on thresholds
and on processing New Jersey residents' data.

**Specialist counsel?** Yes — a US privacy lawyer, briefly.

**Blocks:** PUBLIC for the policy; REAL DATA for the substance.

---

## R. 🔴 Regulatory status, and investment advice

**Recommended:** obtain a securities lawyer's written view on four questions
before any paid deployment, and before any external user if a
Tesseract-provided recommendation, score or ranking exists:

1. Does AI-generated, **portfolio-specific** analysis delivered for
   compensation carry investment-adviser implications?
2. Does any ranking, score or ordering the product surfaces amount to a
   recommendation?
3. Does Advisers Act Rule 204-2 make Tesseract a system where required records
   live, and what retention, immutability and production duties follow?
4. Does AI-generated content inside a record an adviser relies on raise
   supervision questions for that adviser?

**Why:** the drafted disclosures say what the software does and does not do.
They deliberately do **not** assert that Tesseract is exempt from
investment-adviser regulation, because a disclaimer cannot create an exemption.
Question 3 may change what gets built, which is why it should be asked early
rather than when a contract is on the table.

**Risk / tradeoff:** specialist securities advice is expensive. Discovering the
answer from a regulator or a customer's compliance officer is more expensive.

**Unknown:** all four.

**Specialist counsel?** **Yes — securities counsel specifically.** A generalist
commercial lawyer should not sign this off.

**Blocks:** PAID, and EXTERNAL for question 2 if any such feature exists.

---

## S. Support and service levels

**Recommended:** Option A in
[`contracts/support-sla-draft.md`](./contracts/support-sla-draft.md) — business
hours, best-effort targets, no credits, no availability commitment, no recovery
commitment. Adopt the severity definitions anyway.

**Why:** a single developer cannot staff 24×7, and severity definitions are
useful even with no SLA attached because they are how both sides describe an
incident.

**Risk / tradeoff:** no SLA is a known procurement objection.

**Unknown:** nothing.

**Specialist counsel?** No, except the exclusive-remedy drafting if credits are
ever offered.

**Blocks:** PAID.

---

## T. Copyright, customer content and DMCA

**Recommended:** take customer warranties about upload rights (drafted);
publish a copyright notice and an infringement-reporting address; **do not
register a DMCA agent yet** and do not claim safe harbour.

**Why:** there is no public user-generated-content surface — uploads are
private to an organisation — so the classic §512(c) fact pattern is thin.
Registration and designation are statutory steps with a fee and an annual
upkeep, and claiming safe harbour without completing them is a
misrepresentation.

**Risk / tradeoff:** if a public sharing feature is ever built, this reverses
and registration becomes worth doing in advance.

**Unknown:** whether any public sharing is planned.

**Specialist counsel?** No, unless a public surface is planned.

**Blocks:** SCALE.

---

## U. AI provider processing rights

**Recommended:** obtain written confirmation, per provider, of retention period
and whether submitted content is used for training, before any real customer
data is processed. Until then, keep the documents' current position: **no
representation is made**.

**Why:** the AI feature transmits theses, note bodies, outcomes and portfolio
holdings. This is the first question a compliance officer will ask, and the
honest answer today is that nobody has checked. Every document in this
directory says so rather than implying otherwise, and that consistency is worth
preserving.

**Risk / tradeoff:** zero-retention terms may require a paid tier or an
enterprise agreement with each provider. BYOK shifts this to the customer,
which is a genuine architectural answer and is already built.

**Unknown:** every provider's actual applicable terms. Open since August 2026.

**Specialist counsel?** No — read the terms, then have counsel confirm the
representation we can safely make.

**Blocks:** REAL DATA.

---

## V. International customers

**Recommended:** restrict to US customers initially, and say so, rather than
accepting an EU customer and inheriting GDPR, transfer mechanisms and a DPA
annex nobody has prepared.

**Why:** the DPA draft cannot be completed without knowing whether transfers
are in scope, and `contracts/dpa-draft.md` should not be presented as complete
while that is open.

**Risk / tradeoff:** turning away a willing European customer. At this stage
that is a good trade.

**Unknown:** whether any current user is in the EU or UK.

**Specialist counsel?** Yes if the answer is to accept EU customers.

**Blocks:** PAID.

---

## W. Insurance

**Recommended:** obtain cyber liability and technology errors-and-omissions
cover before the first paying customer, sized against the liability position
chosen in G.

**Why:** G and W are one decision in two parts. A liability cap you cannot
fund is a cap in name only, and E&O is specifically relevant because the
product sits next to investment decisions (see R).

**Risk / tradeoff:** premiums are a real cost with no revenue behind them. The
alternative is personal exposure until A is done, then an unfunded corporate
exposure.

**Unknown:** cost and available limits; whether an insurer will write cover for
a pre-revenue single-developer company holding MNPI.

**Specialist counsel?** No — an insurance broker who knows technology E&O.

**Blocks:** PAID. Cannot start before A.

---

## X. 🔴 Terms approval and effective dates

**Recommended:** nothing in this directory is published or activated until
counsel has reviewed it and the founder has recorded an approval date. The
mechanism is already built: each document has a status and a version in
`src/legal/documents.ts`, and publication is gated by a single flag that is
**off**.

**Why:** a document is not approved because it has been committed. The gate
exists so that approval is an explicit act with a date, rather than a side
effect of a merge.

**Risk / tradeoff:** none. This item costs a decision and a commit.

**Unknown:** nothing.

**Specialist counsel?** The review itself, yes.

**Blocks:** PUBLIC. See
[`legal-release-checklist.md`](./legal-release-checklist.md) for the exact
sequence.

---

## Y. Existing users and re-acceptance

**Recommended:** **do not** treat any of the 28 existing users as having
accepted anything. When terms are approved, require acceptance at next sign-in,
with the document linked and the version recorded. Give administrators 30 days'
notice for a later material change.

**Why:** nobody has accepted anything — verified: no acceptance table exists.
Back-dating acceptance would manufacture a consent record, which is worse than
having none. The re-acceptance machinery is built in this change and is
switched off.

**Risk / tradeoff:** an acceptance prompt is friction for current testers. It
is also the moment to tell them in writing that this is a test build, which is
the single highest-value item in `risk-register.md` §2.

**Unknown:** nothing.

**Specialist counsel?** No, beyond approving the documents themselves.

**Blocks:** EXTERNAL.

---

## Z. The five questions carried forward

From `DATA-INVENTORY.md` §9, each now mapped to the item that owns it:

| | Question | Owner |
|---|---|---|
| 1 | Does the August 2026 bucket exposure require notification? | **not otherwise listed — needs counsel** |
| 2 | Does Rule 204-2 make Tesseract a recordkeeping system? | R.3 |
| 3 | Can the privacy policy promise deletion as implemented? | N |
| 4 | Are EU/UK users in scope? | Q, V |
| 5 | Do the AI providers' standard terms suffice? | U |

Question 1 has no other home and is the one most likely to be forgotten: a
storage bucket was publicly readable until 2026-08-14, holding 9 objects
belonging to one organisation, and **access logs were never examined**, so
whether anything was retrieved is unknown. It is closed as a defect and open as
a notification question.
