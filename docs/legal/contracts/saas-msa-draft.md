# Master Services Agreement — DRAFT TEMPLATE, NOT LEGAL REVIEWED

**Document id:** `saas-msa` · **Version:** 0.1.0-draft ·
**Effective:** not in effect

> **Counsel-review draft. Not in effect, binds nobody, not approved. This is a
> structured template for counsel to work from, not an agreement to send to a
> customer.**

---

## What this is for

This is the agreement a **paying institutional customer** signs. It exists
separately from the online application terms for two reasons:

1. An institutional investment firm will not accept click-through terms for
   software holding its portfolio holdings and trade intentions. Its
   procurement and compliance functions exist to prevent exactly that.
2. The commercial terms — fees, term, liability cap, security commitments,
   service levels — are negotiated per customer, and a negotiated agreement is
   the only honest place for them.

**Precedence:** this agreement and its order forms sit at the top. The DPA
governs processing of Customer Data. The online application terms are the
fallback where this agreement is silent. See §19.

### Structure

| Part | Document |
|---|---|
| Commercial terms | **Order Form** (per customer, per purchase) |
| General terms | **this MSA** |
| Schedule 1 | Data Processing Agreement — [`dpa-draft.md`](./dpa-draft.md) |
| Schedule 2 | Security and Technical Measures — [`security-schedule-draft.md`](./security-schedule-draft.md) |
| Schedule 3 | Support and Service Levels — [`support-sla-draft.md`](./support-sla-draft.md) |
| Incorporated | Investment and AI Disclosures — [`../policies/financial-ai-disclosures-draft.md`](../policies/financial-ai-disclosures-draft.md) |

---

## Order Form template

Everything negotiated lives here, so the MSA body can stay stable across
customers.

| Field | Value |
|---|---|
| Customer legal name | **[CUSTOMER LEGAL NAME]** |
| Customer jurisdiction of incorporation | **[...]** |
| Customer notice address and contact | **[...]** |
| Provider legal name | **[LEGAL ENTITY NAME]** |
| Subscription description | **[...]** |
| Authorised User count | **[...]** |
| Named Authorised Users (if per-named-user) | **[...]** |
| Permitted affiliates | **[none / listed]** |
| Subscription term | **[12 months]** from the Effective Date |
| Renewal | **[auto-renew for successive 12-month terms unless either party gives 60 days' notice / no auto-renewal]** |
| Renewal uplift cap | **[CPI + 3% / fixed / none]** |
| Fees | **[...]** |
| Payment terms | **[net 30]** |
| Liability cap | **[see MSA §13 — fees paid in the preceding 12 months]** |
| Security-incident / confidentiality super-cap | **[see MSA §14]** |
| Service level | **[Schedule 3 option A / B / none]** |
| Support tier | **[Schedule 3]** |
| Permitted data categories | **[see MSA §6.4]** |
| Market-data entitlements | **[which vendor data the Customer is licensed to receive — see §10]** |
| AI features | **[enabled / disabled]**; **[platform key / Customer BYOK]** |
| Professional services | **[none / described]** |
| Governing law and venue | **[see MSA §18]** |

---

## MSA body — clause map with drafting positions

Counsel will redraft the language; what follows is the **position** for each
clause plus the Tesseract-specific content that a generic template will not
contain. Clauses marked **★** are where this product differs from ordinary
B2B SaaS and are where review time is worth most.

### 1. Parties and definitions

Provider: **[LEGAL ENTITY NAME]**, a **[ENTITY TYPE]** of
**[JURISDICTION]**. Customer: as the Order Form states.

Defined terms to include: Affiliate, Authorised User, Confidential
Information, Customer Data, Documentation, Order Form, Service, Subprocessor,
Security Incident, **Market Data**, **AI Output**.

The last two are Tesseract-specific and must be defined, because several
clauses allocate risk differently for them than for the Service generally.

### 2. Order forms and structure

Each Order Form incorporates this MSA. Conflict: the Order Form prevails on
commercial terms; the MSA prevails on legal terms, unless the Order Form says
otherwise and is signed by both parties with specific reference to the clause
being varied.

### 3. Grant of rights and authorised users

Non-exclusive, non-transferable right for the Customer and its Authorised Users
to access and use the Service during the term for the Customer's internal
business purposes.

Per-named-user. No sharing of credentials. Affiliates only if the Order Form
lists them. No service-bureau or outsourced-provider use without consent.

### 4. Customer obligations

Mirrors the application terms §4–§7: credential security, prompt deprovisioning
of leavers, accuracy of account data, administrator responsibility, acceptable
use, and the Customer's own regulatory compliance.

### 5. ★ Provider obligations, and what is deliberately absent

Provide the Service with reasonable skill and care, in accordance with
Schedule 2 (Security) and Schedule 3 (Support).

**Do not accept, at this stage:** an uptime warranty, a recovery-time
commitment, a regulatory-compliance warranty, or an obligation to maintain any
certification. Schedule 2 states why in each case, with evidence. Agreeing to
any of them today would be agreeing to something unmeasurable or impossible —
there are currently no database backups at all.

### 6. ★ Customer data

**6.1 Ownership.** Customer Data is and remains the Customer's.

**6.2 Licence.** Limited to hosting, processing and transmitting Customer Data
to provide, secure and support the Service for the Customer, including
transmission to the Subprocessors in Schedule 1's annex.

**6.3 Restrictions on Provider.** No training or fine-tuning of any model on
Customer Data. No use for Provider's own research, analytics or marketing. No
sale or sharing. Aggregated statistics only as narrowly permitted, and the
Customer may require that right be struck.

**6.4 ★ Permitted data categories, and an express exclusion.** The Customer
agrees not to submit consumer health data, payment card data, government
identifiers, or data of natural persons who are not Authorised Users beyond
what the Service is designed to hold.

> This cuts both ways and is worth keeping. It protects the Customer from
> assuming the Service is built for data categories it is not, and it protects
> the Provider from inheriting PCI or HIPAA obligations by accident.

**6.5 ★ MNPI acknowledgement.** The parties acknowledge that Customer Data may
include the Customer's material non-public information, including portfolio
holdings and trade intentions, and that the confidentiality obligations in §12
and the security measures in Schedule 2 apply to it.

> **★ Open for counsel.** Whether to name MNPI expressly is a real choice.
> Naming it is honest, is what the Customer's compliance officer wants to see,
> and strengthens the case that both parties understood the sensitivity. It
> also makes it harder to argue later that a confidentiality breach was an
> ordinary commercial loss — which is precisely the argument the liability cap
> in §13 depends on. Decide deliberately.

### 7. Provider intellectual property

The Service, its software, documentation and all improvements remain the
Provider's. No source code licence. No rights by implication.

### 8. ★ Feedback

Narrow: feedback **about the Service** may be used freely, with no obligation.
Expressly excludes Customer Data, the Customer's investment research, methods
and models, and anything subject to §12.

> The broad version of this clause reads, to an investment firm, as a licence
> to its investment process. It is not worth the deal friction.

### 9. ★ AI features and AI output

Enabled or disabled per the Order Form.

- AI Output is provided as-is; no warranty of accuracy, completeness,
  currency or suitability.
- AI Output is not a recommendation by the Provider and the Provider is not
  an investment adviser or fiduciary (§11).
- Using AI features transmits Customer Data to the applicable model provider.
  **The Provider makes no representation about any provider's retention or
  training practices** unless a specific written confirmation is annexed to the
  Order Form.
- Where the Customer supplies its own provider key, that provider is the
  **Customer's** subprocessor and the Customer's agreement with it governs.
- The Customer is responsible for reviewing AI Output before relying on it, and
  for its own supervisory obligations in respect of it.

> **★ Open for securities counsel.** Whether AI Output that is
> portfolio-specific creates investment-adviser implications for the Provider
> is unresolved. `../risk-register.md` §7. Resolve before the first paid
> contract, not after.

### 10. ★ Market data

- Market Data originates from third-party vendors, is delayed, and may be
  incomplete or inaccurate. Provided as-is.
- The Customer's right to receive Market Data through the Service is **limited
  to the entitlements stated in the Order Form**, and may require the Customer
  to hold its own licence with the vendor.
- The Provider does not warrant Market Data and is not liable for vendor
  outages or vendor-side errors.
- Either party may be required to cease providing or receiving particular
  vendor data if the vendor's terms require it.

> **★ Blocking commercial issue.** As of 2026-11-25 there is **no commercial
> redistribution licence in place with any market-data vendor**, and the
> product calls two consumer-grade endpoints directly from the browser
> (`../risk-register.md` §4). This clause allocates the risk; it does not
> create the right. **Do not sign an MSA whose Order Form promises market-data
> entitlements that are not licensed.**

### 11. ★ No advice, no execution, no fiduciary duty

Incorporate the Investment and AI Disclosures in full. Express acknowledgements
that the Provider: is not an investment adviser, broker-dealer, custodian or
fiduciary; exercises no discretion; places and routes no orders; and that the
Customer is solely responsible for its investment decisions.

Plus the four-way distinction that matters operationally: a recommendation is
not a decision, a decision is not an execution, an accepted trade is not a
confirmed fill, and a mark is not a realised result.

### 12. Confidentiality

Mutual. Customer Data is the Customer's Confidential Information. Standard
exclusions (public, independently developed, lawfully received) and a
compelled-disclosure carve-out with notice where lawful.

Survival: **[3 years / indefinitely for trade secrets]**. For MNPI, consider
indefinite.

### 13. ★ Limitation of liability

Position: mutual exclusion of indirect, incidental, special, consequential and
punitive damages and lost profits; aggregate cap at **fees paid in the 12
months preceding the claim**.

For a no-fee or pilot arrangement a fees-based cap is zero, so a nominal
figure is required instead — see the pilot agreement.

### 14. ★ Exclusions from the cap — the clause the deal turns on

Outside the cap: indemnification obligations, fees owed, fraud, wilful
misconduct, gross negligence, and anything that cannot be limited by law.

**The contested question** is where breach of confidentiality and Security
Incidents sit. Three positions, in ascending order of what a customer will ask
for:

| Position | Effect |
|---|---|
| Inside the general cap | Provider-favourable. An institutional customer will likely reject it. |
| **Super-cap** at a multiple of fees (2×–5×) | The usual landing zone. **Recommended starting position.** |
| Uncapped | What a large customer opens with. Uninsurable without cyber cover, and there is no insurance today. |

> **★ Decide this before the first negotiation.** It is the highest-value
> decision in the whole package, it is not a drafting detail, and it is
> directly constrained by the fact that there is no cyber liability insurance
> and no entity to insure. `../counsel-review-checklist.md` §G.

### 15. Indemnification

**Provider → Customer:** third-party IP infringement claims arising from the
Service as provided, with standard carve-outs (Customer Data, modifications,
unauthorised combination, use in breach). Remedies: modify, procure a licence,
or terminate and refund prepaid unused fees.

**Customer → Provider:** claims arising from Customer Data, from the
Customer's lack of rights in it, from breach of acceptable use, or from
unlawful use.

> **★ Open for counsel.** Whether the Provider's IP indemnity extends to a
> claim that **AI Output** infringes is an open industry question and a
> deliberate risk-allocation choice.

### 16. Term, suspension and termination

Term per the Order Form. Termination for material breach uncured after
**[30]** days. Provider suspension rights limited to protecting the Service,
other customers or data security, or where legally required, with restoration
once resolved. Termination for insolvency.

### 17. ★ Effect of termination — data return and deletion

On termination: access ends; Customer Data is made available for export for
**[30]** days; thereafter deleted per Schedule 1; the Provider cooperates with
a notified litigation hold at the Customer's expense.

> **⚠ Capability gap. There is no self-service export today** — a termination
> export is a manual engineering task (`../risk-register.md` §9). Either build
> export before signing an agreement containing this clause, or draft it as a
> described manual process with a realistic timescale and a stated cost. **Do
> not sign a promise the software cannot keep.**

### 18. Governing law, venue and disputes

**[GOVERNING LAW]**, **[VENUE]**, and whether to include arbitration.
Deliberately unchosen — `../counsel-review-checklist.md` §D–§F.

For an institutional customer, expect pressure toward the customer's own
jurisdiction or a neutral one. Decide the opening position and the acceptable
range in advance.

### 19. Precedence

Order Form → this MSA → Schedule 1 (DPA, prevailing on processing) →
Schedules 2 and 3 → online application terms.

### 20. Assignment

Neither party may assign without consent, except to a successor in a merger,
acquisition or sale of substantially all assets, with notice.

> Note for the Customer side: an investment firm may require a change-of-control
> termination right. That is reasonable and cheap to give.

### 21. Notices

Written notice to the addresses in the Order Form; email permitted for
operational notices, not for termination or breach notices.

### 22. General

Force majeure (expressly covering third-party provider failure); no
partnership or agency; severability; no third-party beneficiaries; entire
agreement; amendment only in writing signed by both parties; survival of §6,
§7, §12, §13, §14, §15 and §17.

**Publicity: no use of the Customer's name or logo without prior written
consent.** Expect every investment firm to require this, and do not plan a
launch around named customers before it is agreed.

---

## Open items before this can be issued

1. Entity formation, name, type and jurisdiction — without them there is no
   Provider party. **Blocking.**
2. Governing law and venue (§18).
3. Liability cap and the §14 super-cap position. **The decision that matters
   most.**
4. Whether to name MNPI expressly (§6.5).
5. AI Output indemnity scope (§15) and the securities-law question (§9).
6. **Market-data entitlements must be licensed before any Order Form promises
   them (§10).** Blocking for any customer who needs market data.
7. Export capability built, or §17 redrafted. Blocking.
8. Counsel to draft actual clause language. Nothing here is execution-ready.
