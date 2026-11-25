# Application Terms of Service — DRAFT, NOT LEGAL REVIEWED

**Document id:** `application-terms` · **Version:** 0.2.0-draft ·
**Effective:** not in effect

> **Counsel-review draft. Not in effect, binds nobody, not approved.**
>
> Clauses marked **★** are the ones specific to Tesseract and are where
> counsel's attention is worth most. The rest is standard B2B SaaS scaffolding
> that your lawyer probably has a better version of.
>
> **History:** v0.1 was `TERMS-OF-SERVICE.draft.md`, written 2026-08-14 from
> `../DATA-INVENTORY.md`. v0.2 expands it to a full B2B structure, splits the
> website terms into their own document, and moves the investment and AI
> disclosures into theirs. The v0.1 ★ clauses survive, in §13, §14 and §15.

Between **[LEGAL ENTITY NAME]** ("Tesseract", "we") and the customer
organisation ("Customer", "you"). Entity details are configured in
`src/legal/entity.ts`.

---

## 0. How this fits with everything else

| Document | Governs |
|---|---|
| Signed Master Services Agreement + order form | a paying institutional customer — **takes precedence over this document** |
| Data Processing Agreement | processing of Customer Data |
| **This document** | use of the application where no signed agreement covers it |
| [Website Terms of Use](./terms-of-use-draft.md) | the marketing website only |
| [Investment and AI Disclosures](./financial-ai-disclosures-draft.md) | incorporated into this document by reference |

§30 states the precedence rule formally. In short: **a signed agreement wins**,
and these online terms are the floor rather than the ceiling.

---

## 1. The service

We provide software for investment teams to capture research, record
recommendations, record portfolio-manager decisions, track what was executed,
and review outcomes — as described in your order form or subscription, or as
made available to you if you have neither.

We may provide the service through third-party infrastructure, model and data
providers. Those are listed in [`../SUBPROCESSORS.md`](../SUBPROCESSORS.md).

## 2. Customer organisation and authorised users

The service is licensed to the **Customer organisation**, not to individuals.

An **Authorised User** is an individual the Customer permits to access the
service under the Customer's account — typically its employees and contractors.
The Customer is responsible for its Authorised Users' use of the service as if
it were the Customer's own.

Access is per-named-user and is not transferable. Credentials may not be shared.

## 3. ★ Authority, and what accepting these terms does not do

An individual who accepts these terms accepts them **for themselves as an
Authorised User**.

**Acceptance by an individual is not a representation that they can bind their
employer**, and we do not treat it as one. An ordinary user ticking a box does
not commit their organisation to a negotiated software agreement, a liability
cap, an indemnity or a dispute-resolution clause.

Where the Customer is to be bound at the organisation level — which is what we
require for any paying customer — that is done by a signed Master Services
Agreement and order form executed by someone with authority to sign.

> **★ Open for counsel.** This is drafted against our own commercial interest
> on purpose. Asserting that every user's checkbox binds their firm is common,
> cheap, and unlikely to survive a challenge by a regulated institution whose
> procurement process exists precisely to prevent it. Confirm the position, and
> confirm what we do want an individual's acceptance to establish — our
> recommendation is: the disclaimers, the acceptable-use rules, and the
> not-advice acknowledgement, and nothing more.

## 4. Accounts, credentials and access security

You are responsible for the confidentiality of credentials issued to your
Authorised Users, for the accuracy of account information, and for promptly
removing access for people who should no longer have it.

Notify us without undue delay if you believe credentials have been compromised.

We may suspend an account where we reasonably believe it is compromised or is
being used in breach of §7.

## 5. Customer responsibilities

You are responsible for:

- the content you put into the service and your right to put it there;
- the decisions you make using it (see §13);
- your own regulatory compliance, including suitability, best execution,
  supervision and recordkeeping (see §15);
- maintaining your own records independently of the service;
- the configuration choices your administrators make.

## 6. Organisation administrator responsibilities

Administrators you designate can add, suspend and configure Authorised Users,
configure organisation settings, and configure AI provider settings including a
Customer-supplied provider key.

**Administrator actions are your actions.** An administrator can expose your
data more widely within your organisation, change who can see what, and change
where AI requests are sent. We act on administrator instructions without
independently verifying internal authority.

## 7. Acceptable use

You and your Authorised Users will not:

- attempt to access another organisation's data, or any data you are not
  authorised to access;
- probe, scan or test the security of the service, except under a written
  authorisation from us;
- reverse engineer, decompile or attempt to derive source code, except to the
  extent that right cannot lawfully be excluded;
- resell, sublicense or provide the service to a third party, or use it to
  build a competing product;
- upload malware, or use the service unlawfully;
- circumvent rate limits, usage limits or access controls;
- use the service to process data of a category it is not designed for — in
  particular, do not put consumer health data, payment card data or government
  identifiers into it.

## 8. Subscription and fees

Fees, term and scope are as set out in your order form. Where no order form
exists — including evaluation, pilot and early access — the service is provided
**without charge and without commitment**, and §11 applies.

Fees are non-refundable except as the order form states. Late payment may lead
to suspension after reasonable notice.

## 9. Taxes and renewal

Fees exclude taxes; you are responsible for applicable taxes other than taxes
on our income.

Renewal terms, notice periods and any price-change mechanism are as stated in
the order form.

> **★ Founder decision.** Auto-renewal with an uplift cap, or no auto-renewal,
> is a commercial decision rather than a legal one. See
> `../counsel-review-checklist.md` §H.

## 10. Changes, maintenance and deprecation

We may change the service, including adding, modifying and removing features.
We will not materially degrade the core functionality you are paying for during
a paid term without notice and, where the degradation is material, without
offering you a way out.

We perform maintenance, and will give reasonable notice where practical.

> **★ Open for counsel.** The qualified version above is deliberate. An
> unlimited right to change a service that a regulated firm has built a process
> around is the kind of clause that gets struck or renegotiated. Decide the
> commitment we can actually keep.

## 11. ★ Early access and pre-release software

Where the service, or a feature within it, is provided as early access, beta,
pilot or evaluation:

- it is provided **as is**, without any warranty and without any service-level
  or support commitment;
- it may change, break or be withdrawn without notice;
- it may contain defects, and data entered into it may be lost;
- **you should not enter real client holdings, material non-public information,
  or anything whose loss or disclosure would harm you or your clients** unless
  we have separately confirmed in writing that the relevant safeguards are in
  place.

> **★ This clause is load-bearing today.** Tesseract is pre-release: the
> relevant facts are in `../risk-register.md` §2 and §3 — notably that
> production currently has no backup and no point-in-time recovery. The last
> bullet is the single most important sentence in this document for the current
> stage, and it must not be softened while that remains true.

## 12. Customer data and intellectual property

### 12.1 You own your content

Research, notes, theses, ideas, recommendations, decisions, trade records,
holdings, reviews, uploaded files and everything else you put into the service
("**Customer Data**") remains yours. We acquire no ownership of it.

### 12.2 The licence you grant us, and its limits

You grant us a worldwide, non-exclusive, royalty-free licence to host, store,
copy, transmit, display and process Customer Data **solely to provide, secure
and support the service for you**, including transmitting it to the
subprocessors listed in [`../SUBPROCESSORS.md`](../SUBPROCESSORS.md).

**That licence is limited to providing the service.** We will not:

- use Customer Data to train, fine-tune or improve any machine-learning model,
  whether ours or a third party's;
- use Customer Data for our own research, product analytics or marketing;
- disclose Customer Data except as the Data Processing Agreement permits;
- sell or share Customer Data.

> **★ Note for counsel, and a commercial warning.** The no-training commitment
> above is one we can make about *our own* conduct today, because we do no
> training. We **cannot currently make it on behalf of the AI providers**: as
> of 2026-11-25 no provider's retention or training position has been confirmed
> in writing (`../risk-register.md` §5). §18 says that plainly rather than
> implying otherwise, and it must not be upgraded until the confirmations
> exist. Customers in this market will ask for exactly this in writing.

### 12.3 Aggregated statistics

We may compile aggregated, de-identified statistics about use of the service —
for example, how often a feature is used — provided they do not identify you,
any Authorised User, any security you hold, any position, or any content.

> **★ Open for counsel.** Whether to retain this right at all is worth
> thinking about for this market. "De-identified" is a weak protection when the
> underlying data is a small number of institutional portfolios, and a
> compliance officer may read this clause as a licence to study their book. The
> narrower drafting is to limit it to counts of feature usage with no reference
> to any security or position, which is how it is drafted above.

## 13. ★ Not investment advice

**This section incorporates the
[Investment and AI Disclosures](./financial-ai-disclosures-draft.md) in full.**
The summary here does not replace that document.

The service is a tool. It does not provide investment, legal, tax or accounting
advice, and nothing it outputs — including AI-generated content, price targets,
simulations, rankings, scores or suggestions — is a recommendation by us to buy
or sell any security.

**You are solely responsible for every investment decision you make.** We do
not manage portfolios, exercise discretion, place orders, route orders, or act
as a fiduciary.

You acknowledge in particular that:

- a recommendation is not a decision, a decision is not an execution, an
  accepted trade is not a confirmed fill, and a mark is not a realised result;
- market data is delayed, may be incomplete or wrong, and some series are
  derived rather than observed;
- derived performance and attribution figures inherit every defect in their
  inputs.

## 14. ★ AI features

AI features are provided on an as-is basis and depend on third-party model
providers.

**Output can be inaccurate, incomplete, outdated or fabricated, and must be
independently verified by a qualified person before being relied on.** We do
not warrant that AI output is accurate, complete, current or suitable for any
purpose.

Using AI features transmits Customer Data to the applicable provider — see §18
and the privacy policy. Where you supply your own provider key, your agreement
with that provider governs that processing and that provider is your
subprocessor, not ours.

AI features do not make investment decisions and have no authority to act. No
part of the service authorises autonomous trading.

## 15. ★ Records and retention

The service is **not** a system of record for regulatory purposes unless
expressly agreed in writing.

**You remain responsible for your own recordkeeping obligations, including
under Investment Advisers Act Rule 204-2 and any equivalent rule, and for
retaining your records independently of the service.** We do not represent that
records held in the service are immutable, complete, retained for any required
period, or producible in any required format.

Current factual position, stated because a disclaimer should not contradict
what the product does: the service retains content indefinitely by default —
there is no scheduled deletion — and the only configurable retention control is
for the audit log. There is no self-service data export.

> **★ Note for counsel.** This disclaimer matters and may not hold. Advisers
> *will* keep required records here, because that is what the product invites
> them to do. Whether this clause survives that is worth a securities lawyer's
> view, and it interacts directly with §12, with the retention facts above, and
> with the absence of backups. `../DATA-INVENTORY.md` §9 question 2;
> `../risk-register.md` §6.

## 16. Feedback

If you give us feedback, suggestions or ideas about the service, we may use
them to improve it without obligation to you.

**This is limited to feedback about the service.** It does not give us any
right to your investment research, your methods, your models, or any Customer
Data, and it does not apply to anything covered by the Data Processing
Agreement or by a confidentiality obligation between us.

> **★ Note for counsel.** Deliberately narrow. The common "perpetual,
> irrevocable licence to anything you tell us" clause is, in this market, a
> clause that reads as a licence to the customer's investment process. It is
> not worth the goodwill it costs.

## 17. Confidentiality

Each party will protect the other's confidential information with at least
reasonable care, use it only to perform under these terms, and disclose it only
to people who need it and are bound to equivalent obligations.

**Customer Data is your confidential information.** Our confidential
information includes non-public aspects of the service.

Neither party's obligations apply to information that is public through no
fault of theirs, independently developed, or lawfully received from a third
party without restriction. Disclosure compelled by law is permitted with notice
where lawfully possible.

## 18. Third-party market data and AI providers

The service incorporates data and services from third parties.

**Market data** is provided by third-party vendors, is delayed, and is subject
to their terms. We do not warrant it. Your right to use it through the service
may be limited by the vendor's terms, and some vendor data may not be
redistributable to you at all.

> **★ Open for counsel — and this one is a live problem, not a theoretical
> one.** As of 2026-11-25 the market-data position is not licensed for
> commercial multi-tenant redistribution: the browser calls Yahoo Finance and
> Finnhub directly, and a per-seat vendor's data is written to a cache that
> other tenants read. See `../risk-register.md` §4. **A liability disclaimer is
> not a licence.** This clause must not be read, or relied on, as curing that.

**AI providers** receive Customer Data when AI features are used. **We do not
currently represent that any provider refrains from retaining or training on
submitted content**, because that has not been confirmed in writing with any
provider. One provider option is search-augmented, meaning a query may be used
to retrieve from the public web.

## 19. Data accuracy and your verification

You will not rely on any figure, price, identifier, holding, calculation or
analysis in the service without independent verification appropriate to the
decision you are making.

## 20. No execution, no fiduciary duty

We are a software provider. We are not your investment adviser, broker, dealer,
custodian, administrator or fiduciary, and we do not owe you fiduciary duties.
Nothing in these terms creates a partnership, agency or joint venture.

## 21. Warranties and disclaimers

We warrant that we will provide the service with reasonable skill and care, and
that we will not knowingly introduce malicious code.

**Except as expressly stated, the service is provided "as is" and we disclaim
all other warranties, express, implied or statutory, including merchantability,
fitness for a particular purpose, non-infringement, accuracy, and uninterrupted
or error-free operation, to the maximum extent permitted by law.**

We do not warrant that the service will meet your regulatory requirements.

## 22. Limitation of liability

Neither party is liable for indirect, incidental, special, consequential or
punitive damages, or for lost profits, lost revenue or lost business
opportunity.

**Each party's aggregate liability is limited to [LIABILITY CAP — see note].**

Where the service is provided without charge (including evaluation, pilot and
early access), **our aggregate liability is limited to [NO-FEE CAP — recommend
USD 100]**, since a fees-based cap would otherwise be zero.

> **★ The most important commercial decision in this document.** A
> 12-months-fees cap is the market default. This product holds portfolio
> holdings and trade intentions — the material non-public information of
> regulated firms — and institutional customers will push for a super-cap or an
> uncapped carve-out for breach of confidentiality and for data security
> incidents. Decide this deliberately, with advice, before the first
> negotiation rather than inside it. `../counsel-review-checklist.md` §G.

## 23. Exclusions from the cap

The limits in §22 do not apply to: a party's indemnification obligations; your
obligation to pay fees; either party's fraud, wilful misconduct or gross
negligence; or any liability that cannot be limited by law.

> **★ To be negotiated.** Whether breach of confidentiality and data security
> incidents sit inside the cap, at a multiple of it, or outside it is the
> single most contested point in enterprise SaaS negotiation in this sector.
> `../counsel-review-checklist.md` §G.

## 24. Your indemnity

You will indemnify us against third-party claims arising from Customer Data
(including that it infringes a third party's rights or was uploaded without
sufficient rights), from your use of the service in breach of §7, or from your
unlawful use of the service.

## 25. Our indemnity

We will defend you against a third-party claim that the service as provided by
us infringes that third party's intellectual property rights, and will pay
damages finally awarded or agreed in settlement.

This does not apply to claims arising from Customer Data, from your
modifications, from combination with anything we did not supply, or from use in
breach of these terms. We may modify the service, procure a licence, or
terminate and refund prepaid unused fees.

> **★ Open for counsel.** An IP indemnity is standard and expected, and the
> carve-outs above are standard. One Tesseract-specific question: whether the
> indemnity should extend to a claim that **AI output** infringes a third
> party's rights. That is a live question across the industry and the answer is
> a risk-allocation decision, not a drafting one.

## 26. Suspension and termination

Either party may terminate for material breach not cured within **[30]** days
of written notice.

We may suspend access immediately where necessary to protect the service, other
customers, or data security, or where required by law — and will restore it as
soon as the cause is resolved.

Where the service is provided without charge, either party may terminate at any
time on notice.

## 27. Data after termination

On termination, your access ends.

We will, on your written request made within **[30]** days of termination, make
Customer Data available for export, and will then delete it in accordance with
the Data Processing Agreement.

> **⚠ This clause currently over-promises, and must not be published as-is.**
> There is no self-service export today, and export is a manual engineering job
> (`../risk-register.md` §9). Either build the capability first or redraft this
> as a described manual process with a realistic timescale. Do not publish a
> promise the software cannot keep — that is the one rule this whole directory
> follows.

## 28. Retention and preservation

You are responsible for retaining anything you are required to retain.

Where you notify us in writing of a litigation hold or a regulatory
preservation obligation covering data in the service, we will cooperate
reasonably at your expense; we do not undertake to preserve data indefinitely,
and we cannot preserve what the service does not retain.

## 29. Governing law and disputes

Governed by the laws of **[GOVERNING LAW]**. Disputes are subject to the
exclusive jurisdiction of the courts in **[VENUE]**.

> **★ Founder decision, with advice.** Not chosen here on purpose. See
> `../counsel-review-checklist.md` §D–§F.
>
> Whether to add an arbitration clause and a class-action waiver is a THIRD
> decision (§F) and is deliberately not folded into the venue placeholder.
> An earlier draft of this clause used a single combined venue-or-arbitration
> placeholder, which bundled two independent choices into one token and
> therefore could not be filled from the entity configuration at all. The
> register's recommendation is no arbitration clause for an institutional
> audience.

## 30. Precedence

Where a signed Master Services Agreement or order form covers a subject, it
takes precedence over these terms for that subject. The Data Processing
Agreement takes precedence on processing of Customer Data. Otherwise these
terms govern.

## 31. Changes to these terms

We may update these terms. Each version carries a version number and a date.

For a **material** change we will give at least **[30]** days' notice to
account administrators before it takes effect, and will ask for renewed
acceptance where renewed acceptance is appropriate.

**We will not apply a new version retroactively**, and acceptance of an earlier
version is not acceptance of a later one. Where you have a signed agreement, we
do not purport to amend it by updating this page.

> **★ Open for counsel.** An unlimited unilateral right to change terms is both
> commercially aggressive and, in several jurisdictions, questionable. The
> re-acceptance mechanism that implements this clause is built in this change
> and is switched off — see `../legal-release-checklist.md`.

## 32. Notices and contact

Notices to us: **[LEGAL CONTACT EMAIL]**, **[BUSINESS ADDRESS]**.
Notices to you: the email address of your account administrator.

---

## Open items before this can be published

1. Entity name, type, jurisdiction, business address, legal contact email.
2. Governing law, venue, arbitration decision (§29).
3. The liability cap, the no-fee cap, and the carve-outs (§22, §23) — the
   highest-value decision in the document.
4. §27 must be redrafted or the export capability built. **Blocking.**
5. Securities counsel on §13, §14 and §15.
6. Confirmation of AI provider retention and training terms before §12.2 or §18
   can be strengthened.
7. Market-data licensing resolved before §18 is relied on.
8. Decide whether to keep §12.3 (aggregated statistics) at all.
