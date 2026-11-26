# Support and Service Level Schedule — DRAFT, NOT LEGAL REVIEWED

**Document id:** `support-sla` · **Version:** 0.1.0-draft ·
**Effective:** not in effect · Intended as **Schedule 3** to the MSA.

> **Counsel-review draft. Not in effect, binds nobody, not approved.**

---

## The honest starting point

**No service level can be offered today, and this document does not offer
one.**

The reason is specific rather than cautious: an availability commitment is only
meaningful if availability is measured, and a data-recovery commitment is only
meaningful if there is a backup to recover from. Neither exists.

| Prerequisite | Status |
|---|---|
| Uptime monitoring that produces a monthly availability figure | 🔴 none |
| Database backups | 🔴 none (`backups: []`) |
| Point-in-time recovery | 🔴 none (`pitr_enabled: false`) |
| A tested restore | 🔴 impossible without the above |
| On-call rotation | 🔴 single developer |
| Incident process, rehearsed | 🟡 written, never exercised |

See [`security-schedule-draft.md`](./security-schedule-draft.md) §8.

So this schedule has two halves: **what can be committed now** (Option A), and
**what the options look like once the prerequisites are met** (Options B and
C), presented so the commercial choice can be made deliberately rather than
discovered in a negotiation.

**Do not quote Option B or C to a customer until its prerequisites are
closed.**

---

## 1. Support channels

| Channel | Status |
|---|---|
| Email to **[SUPPORT EMAIL]** | the primary and, today, only channel |
| Shared channel (Slack Connect / Teams) | **[optional, per Order Form]** — realistic for a small number of design partners |
| Phone | not offered |
| Named technical contact | **[optional]** |

The Customer nominates up to **[2]** people authorised to raise support
requests, so that triage is not driven by whoever shouts.

## 2. Support hours

| Option | Hours |
|---|---|
| **A — current** | Business hours, **[09:00–17:00 [TIMEZONE], Monday–Friday]**, excluding public holidays. Best effort. |
| B | Extended business hours |
| C | 24×7 for Severity 1 |

> **★ Founder decision.** Option C requires an on-call rotation, which requires
> more than one person. Do not agree to it. `../counsel-review-checklist.md`
> §S.

## 3. Severity definitions

These are worth agreeing even with no SLA attached, because they are how both
sides talk about an incident.

| Severity | Definition | Examples |
|---|---|---|
| **S1 — Critical** | The Service is unavailable, or data integrity is affected, for all or substantially all Authorised Users, with no workaround. | Application will not load; authentication is down; data appears lost or wrong across the organisation; suspected security incident. |
| **S2 — High** | A core workflow is unusable for multiple users, with no reasonable workaround. | Recommendations cannot be submitted; decisions cannot be recorded; a portfolio shows materially wrong exposure. |
| **S3 — Medium** | A feature is impaired, or a workaround exists. | A view fails to load for one user; a chart interval is wrong; an export is malformed. |
| **S4 — Low** | Cosmetic, or a question, or a request. | Layout defect; documentation query; feature request. |

A suspected **security incident** is always S1 and additionally follows the
notification process in the DPA — including the **72-hour** service-provider
notification that Regulation S-P leads customers to require.

## 4. Response targets

"Response" means a human acknowledgement with an initial assessment — **not**
resolution. No resolution time is committed at any tier, because defect
complexity is not knowable in advance and a resolution commitment would be a
commitment to guess.

| Severity | A — current (target, best effort) | B (committed) | C (committed) |
|---|---|---|---|
| S1 | 1 business day | 4 business hours | 1 hour, 24×7 |
| S2 | 2 business days | 1 business day | 4 business hours |
| S3 | 5 business days | 3 business days | 1 business day |
| S4 | best effort | 5 business days | 3 business days |

**Option A targets are targets, not warranties, and carry no remedy.** That is
the honest description of a single-developer operation, and labelling it
accurately is better than committing to Option B and missing it.

## 5. Availability

| Option | Commitment |
|---|---|
| **A — current** | **None.** No availability commitment is made or implied. |
| B | **[99.5%]** monthly, excluding §7 |
| C | **[99.9%]** monthly, excluding §7 |

> **★ Do not state a figure before it can be measured.** There is no uptime
> monitoring, so today there is no basis even to report availability, let alone
> warrant it. 99.9% is 43 minutes of downtime per month — on infrastructure
> whose own availability is a provider's representation and not ours.
>
> The sequence is: install monitoring → observe actual availability for a
> quarter → then commit to a figure below what was observed. Committing first
> and measuring later is how an SLA becomes a credit schedule.

## 6. Maintenance

Planned maintenance: **[48]** hours' notice by email to administrators, in a
**[weekend]** window where practical.

Emergency maintenance — for a security fix or to prevent imminent failure —
may be performed without notice, with notice given as soon as practical.

Under Options B and C, planned maintenance within the notified window is
excluded from availability.

## 7. Exclusions

Excluded from any availability commitment and from response targets:

- failure or degradation of a third-party provider, including Supabase,
  Netlify, the AI model providers and market-data vendors;
- the Customer's own network, device, browser or identity provider;
- anything caused by the Customer's misuse, misconfiguration, or use outside
  the Documentation;
- force majeure;
- suspension permitted by the MSA;
- early-access or beta features, which carry no commitment at any tier.

> **★ Note for counsel.** The third-party exclusion is doing a great deal of
> work, because essentially all infrastructure is third-party. A sophisticated
> customer will argue that excluding the provider you chose makes an uptime
> commitment close to meaningless — and they are substantially right. That is
> another reason not to offer one until it can be measured end-to-end.

## 8. Service credits

| Option | Credits |
|---|---|
| **A — current** | **None.** |
| B / C | **[Option: 5% of monthly fees per 1% below target, capped at 25% of one month's fees]** |

Where offered, credits are the Customer's **sole and exclusive remedy** for
failure to meet an availability commitment, must be claimed within **[30]**
days, and are applied against future fees rather than refunded.

> **★ Founder decision.** Credits are the normal shape and are usually
> accepted. The important part is the exclusive-remedy language: without it, a
> missed SLA can be argued as a breach giving rise to damages. See
> `../counsel-review-checklist.md` §S.

## 9. Data recovery

| Option | Commitment |
|---|---|
| **A — current** | **None. There is no backup.** No RPO, no RTO, and no undertaking to restore any data. |
| B / C | **[RPO [24 hours] / RTO [8 hours]]**, once backups and point-in-time recovery are enabled **and a restore has been tested**. |

> **★ This is the most important row in the document.** Writing an RPO or RTO
> into a contract before a restore has been performed successfully is
> committing to something nobody has ever done. Enable backups and PITR, test a
> restore, record how long it actually took, then commit to a number with
> headroom.
>
> Until then, the pilot agreement's data restriction (`§4` of
> [`design-partner-pilot-draft.md`](./design-partner-pilot-draft.md)) is the
> control that keeps this from mattering — nothing irreplaceable is in there.

## 10. Escalation

| Step | Contact |
|---|---|
| 1 | **[SUPPORT EMAIL]** |
| 2 | **[NAMED TECHNICAL CONTACT]** |
| 3 | **[FOUNDER / ACCOUNT OWNER]** |

For S1, the Customer may escalate immediately to step 3.

## 11. Changes to this schedule

This schedule may be updated for new customers at any time. **An existing
Customer's schedule does not change during a paid term except by written
agreement.**

---

## Open items before this can be issued

1. **Enable backups and PITR, then test a restore.** Blocking for §9, and
   blocking for Options B and C generally.
2. Install uptime monitoring and gather a quarter of data. Blocking for §5.
3. Decide support hours and whether the shared-channel option is offered.
4. Fix the support email address and timezone.
5. Decide the credit structure and confirm the exclusive-remedy drafting.
6. Rehearse the incident process once, so the S1 path is a capability rather
   than a paragraph (`../INCIDENT-RESPONSE.draft.md`).
7. Counsel review: service levels and credits are warranty-adjacent and
   interact with the MSA's liability cap.
