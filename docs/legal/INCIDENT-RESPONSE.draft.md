# Incident Response Plan — DRAFT, NOT LEGAL REVIEWED

> Drafted from `DATA-INVENTORY.md`. The 72-hour commitment below is not
> aspirational — under amended **SEC Regulation S-P** your customers are
> required to hold their service providers to it, so it will appear in their
> contracts whether or not this document exists. Compliance dates have already
> passed (Dec 2025 larger entities, June 2026 smaller).
>
> A plan nobody has rehearsed does not work. The single most valuable thing
> after adopting this is a one-hour tabletop against §7.

**Owner:** [NAME, ROLE] — **Deputy:** [NAME]
**Effective:** [DATE] · **Review:** annually and after any incident

---

## 1. What counts as an incident

Any of these starts this plan:

- Unauthorized access to, or disclosure of, customer content or personal data
- A tenant-isolation failure — one organization able to reach another's data
- Storage or database exposed without the intended access control
- Credential or API key compromise (Supabase service role, provider keys,
  GitHub, Netlify)
- Ransomware, destructive action, or unexplained data loss
- A vendor in §3 of the inventory reporting a breach affecting us

**When unsure, declare.** Standing an incident down is cheap; a late clock is
not.

## 2. Severity

| | Definition | Examples |
|---|---|---|
| **SEV-1** | Confirmed unauthorized access to customer content, or cross-tenant exposure | Another firm's holdings readable; database exfiltration |
| **SEV-2** | Exposure possible but unconfirmed; control failed with no evidence of access | A private resource found publicly readable with no access-log evidence of retrieval |
| **SEV-3** | Control weakness, no exposure | Over-broad policy found by review before reaching production |

The **Aug 2026 storage exposure** (inventory §8) is the worked example of a
SEV-2: a bucket was publicly readable, so retrieval was possible, and access
logs were never examined to establish whether it happened.

## 3. The clock

**Start it when a plausible report arrives, not when it is confirmed.**
Confirmation is part of the response, not a precondition for it.

| Time | What must have happened |
|---|---|
| **0h** | Incident declared, owner assigned, timeline log opened |
| **+4h** | Scope assessed: what data, which organizations, what window |
| **+24h** | Containment complete or a written reason it is not |
| **+72h** | **Notification to every affected customer organization** |

The 72-hour deadline is a **Reg S-P service-provider obligation** flowing to
Tesseract through customer contracts. It does not pause for weekends, and it
does not wait for a complete forensic picture — an incomplete notification on
time beats a complete one late.

## 4. Roles

- **Incident owner** — declares, runs the response, writes the notification.
  The only role that cannot be shared.
- **Technical lead** — containment and evidence preservation.
- **Communications** — customer contact; ensures every affected org is told.
- **Legal** — [EXTERNAL COUNSEL NAME AND OUT-OF-HOURS NUMBER]. Engage at
  declaration for anything SEV-2 or above, not after triage.

At current headcount one person may hold several. Write down who, per incident,
in the timeline log — an unassigned role is an unperformed one.

## 5. Containment

**Preserve evidence before you fix.** Capture access logs first: closing a hole
often destroys the record of whether it was used, and "we could not determine
whether data was accessed" is a much worse sentence to write to a customer than
it needs to be.

Order:
1. Snapshot relevant logs — Supabase storage/API logs, Netlify, GitHub audit
2. Revoke or rotate implicated credentials
3. Close the hole
4. Verify closure with an explicit negative test (attempt the access; record
   that it now fails)
5. Only then restore normal service

Useful commands live in `scripts/` — `backfill-assets-bucket-org-scope.mjs`
and `sweep-orphaned-assets.mjs` both enumerate storage and its owners.

## 6. Notification

To each affected customer organization, in writing, within 72 hours:

- What happened, in plain terms
- What data was involved, and for which of *their* users
- The window of exposure
- Whether access is confirmed, possible-but-unconfirmed, or ruled out — state
  which, and how you know
- What has been done
- What they should do
- A named contact

Say "we could not determine whether the data was accessed" when that is true.
Do not say "no data was accessed" unless logs support it.

Regulatory notification (SEC, state AGs, GDPR supervisory authorities) is
**counsel's call**, not engineering's. Escalate; do not decide.

## 7. Contacts

| | |
|---|---|
| Incident owner | [NAME, PHONE] |
| External counsel | [FIRM, NAME, 24h NUMBER] |
| Supabase support | [SUPPORT PLAN / ESCALATION PATH] |
| Cyber insurance | [CARRIER, POLICY NUMBER, CLAIMS LINE] |
| Customer security contacts | [MAINTAIN A LIST — you need it at 3am, not then] |

## 8. Afterwards

Within 10 business days: a written post-incident review — timeline, root cause,
what detection would have caught it sooner, and dated remediation owners.

Blameless as to people, specific as to systems. The Aug 2026 exposure is a fair
example: the control was correct in the migration and wrong in production
because it was changed outside version control and nothing compared the two.
The remediation is a drift check, not a reprimand.

## 9. Known gaps

Recorded deliberately — a plan claiming capabilities it lacks is worse than one
that admits them.

- **No alerting.** Every incident so far was found by a human looking. There is
  no monitor that would page anyone for a bucket turning public or a policy
  being dropped.
- **No schema-drift detection.** Production has diverged from
  `supabase/migrations/` in at least four documented ways.
- **Access logs not routinely reviewed**, and retention of them is unconfirmed
  — this directly limits what can be said in a notification.
- **Untested.** No tabletop has been run.
