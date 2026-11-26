# Founding Design Partner Agreement — DRAFT, NOT LEGAL REVIEWED

**Document id:** `design-partner-pilot` · **Version:** 0.1.0-draft ·
**Effective:** not in effect

> **Counsel-review draft. Not in effect, binds nobody, not approved.**

Between **[LEGAL ENTITY NAME]** ("Tesseract", "we") and **[PARTNER LEGAL
NAME]** ("you", "Partner").

---

## What this document is, and why it is short

This is the agreement for the design partners the public site invites. It is
the **first** document any external organisation will sign, so it is also the
first place the gap between what the product promises and what it can deliver
becomes contractual.

It is deliberately short, deliberately unpaid, and deliberately restricted to
data whose loss would not hurt anyone. That combination is what makes it
signable today, while the Master Services Agreement is not: there is no legal
entity, no backup, no insurance and no market-data licence
(`../risk-register.md`).

**Read this as a safety mechanism rather than a sales document.** Its job is to
let a real investment team use the product and tell us the truth, without
either side taking a risk neither is positioned to carry.

---

## 1. Purpose and scope of the evaluation

You are evaluating Tesseract and helping shape it for institutional use. We
provide access; you provide candid feedback. Neither of us is buying or selling
anything.

In scope: **[WHICH WORKFLOWS — e.g. research capture, recommendation and
decision flow, outcome review]**.
Out of scope: **[...]**.

## 2. Named users

Access is for the individuals listed below and no others. Credentials are not
shared, and access is per named person.

| Name | Role | Email |
|---|---|---|
| **[...]** | **[...]** | **[...]** |

You will tell us promptly when one of them should lose access.

## 3. Term

**[90]** days from the Effective Date, extendable in writing.

Either party may end it at any time, for any reason, with **[7]** days' written
notice — or immediately if §4 is breached. No cause needs to be given and no
liability follows from ending it.

## 4. ★ THE DATA RULE — the most important clause here

**You will not enter into Tesseract:**

- real client holdings or real position data;
- material non-public information;
- personal data of any individual who is not a named user under §2;
- anything whose loss, corruption or disclosure would harm you, your clients
  or any third party;
- anything you are required by law or regulation to retain, unless you also
  retain it independently.

**Use synthetic, historical, public or otherwise non-sensitive data.**

> **★ Why this clause is not negotiable at this stage, stated plainly rather
> than buried.** As of 2026-11-25: production has **no database backup and no
> point-in-time recovery**; there is **no cyber liability or E&O insurance**;
> there is **no legal entity**; and no third-party security assessment has ever
> been performed. The honest consequence is that data entered into Tesseract
> today could be lost and could not be restored, and that no insurance stands
> behind an incident.
>
> Asking a regulated firm to accept that for its real book would be
> indefensible. Asking it to accept that for synthetic data costs it nothing.
> This clause is the difference between a pilot that is responsible and one
> that is not, and it is the reason the rest of this agreement can be
> light-touch.
>
> It may be relaxed **only** in a written amendment, and only after the
> backup, insurance and entity items in `../operational-readiness.md` are
> closed.

If you need to evaluate against real data before those items are closed, say
so — the answer is a staged plan, not a quiet exception.

## 5. ★ Market data

Market data shown during the evaluation comes from third-party vendors, is
delayed, and may be incomplete or wrong.

**We do not grant you any right to use, extract, store or redistribute vendor
market data beyond viewing it inside the product during the evaluation.** We
may remove or change any data source at any time, including where a vendor's
terms require it.

> **★ Note.** No commercial market-data redistribution licence is in place
> (`../risk-register.md` §4). Keep this clause narrow, do not build a pilot
> around market-data features, and do not represent entitlements that do not
> exist.

## 6. ★ AI features

**[Enabled / disabled]** for this evaluation.

If enabled:

- Using AI features transmits your content to a third-party model provider.
  The content can include theses, note bodies, outcomes, portfolio names and
  holdings — which is why §4 matters.
- **We do not represent that any provider refrains from retaining or training
  on submitted content.** That has not been confirmed in writing with any
  provider.
- One provider option is search-augmented, meaning a query may be used to
  retrieve from the public web.
- Output can be inaccurate, incomplete or fabricated and must be reviewed by a
  qualified person. It is not a recommendation, and it has no authority to act.
- Where you supply your own provider key, your agreement with that provider
  governs that processing.

If you would rather not transmit anything to a model provider during the
evaluation, say so and we will disable AI features for your organisation.

## 7. Feedback

You will take part in **[a 45-minute session every two weeks]** and may send
feedback at any time.

We may use feedback about the product freely and without obligation. **This
covers feedback about Tesseract only** — not your research, your investment
process, your methods, your models, or any content you put into the product.

Feedback is not a commitment by us to build anything.

## 8. Support and expectations

Support is **[email, best effort, business hours [TIMEZONE]]**.

**There is no service level, no uptime commitment, no response-time
commitment, and no data-recovery commitment.** The product may be unavailable,
may change without notice, and may contain defects. Features may be withdrawn.

Nothing in this agreement implies that an enterprise service level exists or
will be offered later on these terms.

## 9. Early-access limitations

The product is pre-release. Specifically: parts of it are incomplete; data may
be lost; and a feature demonstrated at one session may be different or absent
at the next.

We will tell you about a change that affects your evaluation where we can.

## 10. Your data and what happens to it

Everything you enter remains yours. We process it only to provide the product
to you and to support your evaluation.

At the end of the evaluation, at your written request, we will **[provide an
export of your data in a machine-readable format within [10] business days]**
and delete your organisation's data.

> **⚠ Capability note, for us rather than the partner.** There is no
> self-service export; this is a manual engineering task
> (`../risk-register.md` §9). The bracketed timescale must be one we can
> actually meet by hand, or the clause must describe the manual process. Do
> not promise an export button.

If you make no request, we will delete your organisation's data within
**[60]** days of the end of the evaluation. Organisation deletion is
irreversible.

The subprocessors that may receive your data are listed in
[`../SUBPROCESSORS.md`](../SUBPROCESSORS.md).

## 11. Confidentiality

Mutual, for **[2]** years.

Our confidential information includes unreleased features, the product's
non-public behaviour, roadmap discussions and pricing conversations. Yours
includes everything you put into the product and everything you tell us about
your process.

**We will not use your name, logo or any description identifying you in any
marketing, case study, pitch material or investor material without your prior
written consent**, which you may withhold or revoke.

## 12. No fees, and what that means

The evaluation is free. Neither party owes the other anything, and no payment
obligation arises unless a separate signed agreement creates one.

## 13. Liability

Because no fees are paid, a fees-based cap would be zero, so:

**Each party's total liability under this agreement is limited to
[USD 100]**, except for breach of confidentiality (§11), fraud, wilful
misconduct, and anything that cannot be limited by law.

Neither party is liable for indirect, incidental, special or consequential
loss, or for lost profits.

**We provide the product "as is", with no warranties of any kind, to the
maximum extent permitted by law.**

> **★ Open for counsel.** A nominal mutual cap is the right shape for an unpaid
> pilot restricted to synthetic data. The carve-out for confidentiality is
> deliberate: §4 limits the data, but a leak of a partner's *process* is still
> a real harm. Confirm the figure and the carve-outs.

## 14. Not investment advice

The product is a tool. It gives no investment, legal, tax or accounting advice,
and nothing it displays or generates is a recommendation by us.

You are solely responsible for every investment decision you make, and for your
own regulatory compliance. We are not an investment adviser, broker-dealer,
custodian or fiduciary, and we place no orders.

The full disclosures are in
[`../policies/financial-ai-disclosures-draft.md`](../policies/financial-ai-disclosures-draft.md).

## 15. Recordkeeping

The product is **not** a system of record for regulatory purposes. You remain
responsible for your own recordkeeping, and you should retain independently
anything you are required to keep. §4 says not to put such records here at all.

## 16. What happens afterwards

Neither party is obliged to enter a commercial agreement.

If you want to continue, commercial terms will be a separate signed Master
Services Agreement and order form. **[OPTIONAL: founding-partner pricing of
[...] if signed within [90] days of the evaluation ending.]**

> **★ Founder decision.** Whether to offer founding-partner pricing, and
> whether to offer it in this agreement or later, is commercial. Offering it
> here is a stronger incentive; it also prices the product before you know what
> it is worth.

## 17. General

Governing law **[GOVERNING LAW]**; venue **[VENUE]**. Not assignable without
consent. Entire agreement on its subject matter. Amendment in writing only.

Surviving termination: §10 (data), §11 (confidentiality), §13 (liability),
§14 (no advice).

## 18. Signatures

| | Tesseract | Partner |
|---|---|---|
| Entity | **[LEGAL ENTITY NAME]** | **[PARTNER LEGAL NAME]** |
| Name | | |
| Title | | |
| Date | | |

**The Partner signatory must have authority to bind the Partner.** A user
ticking a box in the application does not create this agreement, and this
agreement is not created by use of the product.

---

## Open items before this can be sent to a partner

1. **Entity formation. Blocking** — there is no party to sign as Tesseract.
2. Governing law and venue (§17).
3. The liability figure (§13).
4. Confirm the manual export timescale in §10 is one that can actually be met,
   or redraft the clause.
5. Decide the AI position in §6 — on by default, or off by default, for a
   pilot.
6. Decide whether to include founding-partner pricing (§16).
7. Counsel review. In particular: whether §4's data restriction is drafted
   strongly enough to be relied on if a partner ignores it, and whether we need
   an acknowledgement signed by the partner's compliance function rather than
   by a portfolio manager.
