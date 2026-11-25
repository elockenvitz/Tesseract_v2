# Operational and legal readiness checklist

**Status: engineering and operational assessment, 2026-11-25.**
Not legal advice.

---

## Relationship to the other checklists in this directory

Three documents, three jobs. They are not copies of each other:

| Document | Job |
|---|---|
| [`LAUNCH-CHECKLIST.md`](./LAUNCH-CHECKLIST.md) | **The calibration argument.** Why most compliance obligations do not attach yet. Read it first; it is the reason this list is shorter than a generic one. |
| **this document** | The ordered operational work: entity, backups, insurance, incident response, vendor agreements. |
| [`legal-release-checklist.md`](./legal-release-checklist.md) | The exact sequence for approving and switching on the legal documents and the acceptance flow. |

Where this document and `LAUNCH-CHECKLIST.md` cover the same item, **this one
is current** — it was compiled three months later against a fresh read of the
database.

## A deliberate position on priorities

Each item says whether it is **legally required**, **contractually advisable**
or **operational best practice**, because conflating those is how a checklist
becomes 60 items long and gets abandoned.

The gates match [`risk-register.md`](./risk-register.md):

- **P0 — before the public website is live**
- **P1 — before any external person has application access**
- **P2 — before real client data, whoever it belongs to**
- **P3 — before a paying institutional customer**
- **P4 — later enterprise scaling**

Only **six** items are P0. That is the honest number, and padding it would
make the whole list easier to ignore.

---

## P0 — before the public website is live

| # | Item | Class | Notes |
|---|---|---|---|
| P0.1 | **Form the legal entity** | Required in practice | Needed before any policy can name an operator. A published policy naming a non-existent entity is a false statement, which is the principle this directory already follows. `counsel-review-checklist.md` §A. |
| P0.2 | **Domain, plus `legal@` and `privacy@` that a person reads** | Required (CalOPPA practice) | §B, §C. |
| P0.3 | **Counsel review of the public documents** | Required before publication | Terms of use, privacy policy, cookie notice, investment and AI disclosures. §X. |
| P0.4 | **Fill every placeholder, from one place** | Required | `src/legal/entity.ts` is the single source. A test fails the build while any placeholder remains unresolved **and** publication is enabled. |
| P0.5 | **Confirm whether the hosting edge sets cookies on the production domain** | Required for the cookie notice to be true | Only the local dev server was checked. If Netlify's edge sets anything, §1 of the cookie notice is wrong. |
| P0.6 | **Rotate the previously exposed Alpha Vantage key, or confirm it was rotated** | Operational — but a live credential | A working key was served in the client bundle until 2026-09-10. **Rotation is not confirmed.** Cheap, and it is a real credential. |

Everything below this line can wait, and should.

---

## P1 — before any external person has application access

| # | Item | Class | Notes |
|---|---|---|---|
| P1.1 | **Tell every user in writing that this is a test build**, and that they must not enter real client holdings or MNPI | Operational, and the highest-value item on this page | One paragraph. `risk-register.md` §2. It is worth more than every document in this directory put together, and it is still unchecked from the August list. |
| P1.2 | **Market-data licence review** | Required (vendor contract) | Yahoo and Finnhub are called **directly from the browser**; a per-seat vendor's data is written to a shared cache. Either licence it or remove it. `counsel-review-checklist.md` §L. |
| P1.3 | **Approve and switch on the terms acceptance flow** | Contractually advisable | Built in this change, switched off. Without it there is no contract with any user. §Y and `legal-release-checklist.md`. |
| P1.4 | **Signed design-partner agreement before each partner gets access** | Contractually advisable | `contracts/design-partner-pilot-draft.md`. Its §4 data restriction is the control that makes P2 non-urgent. |
| P1.5 | **Decide the MFA position** | Operational best practice | No MFA exists. The first institutional questionnaire will ask. Not a blocker for a pilot on synthetic data. |
| P1.6 | **Name a security contact and a response path** | Operational best practice | Who answers a report, and within what time. |

---

## P2 — before real client data enters

The pilot agreement's §4 forbids real data precisely so this section can wait.
**If that restriction is ever relaxed, every item here becomes immediate.**

| # | Item | Class | Notes |
|---|---|---|---|
| P2.1 | **Enable database backups and point-in-time recovery, then test a restore** | Operational — and the most serious gap | `backups: []`, `pitr_enabled: false`. A product selling institutional memory currently holds one copy of it. A paid-plan decision. `risk-register.md` §3. |
| P2.2 | **Record the measured restore time** | Operational | Then, and only then, an RPO/RTO can go into an SLA. |
| P2.3 | **Confirm AI providers' retention and training terms in writing** | Required before the policy can claim anything | Per provider. Until then every document says no representation is made. §U. |
| P2.4 | **Choose a retention position and implement it** | Contractually advisable | Today nothing is deleted on a timer; the de facto position is "everything, forever", including MNPI. §N. |
| P2.5 | **Execute DPAs with Supabase, Netlify and Sentry** | Required (for our own DPA to be honest) | All three publish one. **Whether any has been executed is unknown.** |
| P2.6 | **Adopt the incident-response plan and rehearse it once** | Contractually advisable | `INCIDENT-RESPONSE.draft.md` commits to the Reg S-P 72-hour service-provider notification. An unrehearsed plan is a document, not a capability. |
| P2.7 | **Decide the August 2026 bucket-exposure notification question** | Legal judgement | 9 objects, one organisation, publicly readable until 2026-08-14; **access logs never examined**. `counsel-review-checklist.md` §Z. |
| P2.8 | **Securities counsel on Rule 204-2 and recordkeeping** | Required before relying on the disclaimer | May change what gets built, so ask early. §R.3. |

---

## P3 — before a paying institutional customer

| # | Item | Class | Notes |
|---|---|---|---|
| P3.1 | **Cyber liability and technology E&O insurance** | Contractually advisable; effectively required | Cannot start before P0.1. Sized against the liability cap chosen in §G — the two are one decision. |
| P3.2 | **Liability cap and super-cap position decided** | Required for negotiation | The highest-value decision in the package. §G. |
| P3.3 | **Securities counsel on the AI-output questions** | Required | §R.1, §R.2, §R.4. |
| P3.4 | **Build data export, or redraft the clauses that promise it** | Required — the drafts currently over-promise | MSA §17 and application terms §27. ⚠ flagged in both. §O. |
| P3.5 | **MSA, DPA, security schedule and SLA finalised by counsel** | Required | The drafts are starting points, not execution-ready. |
| P3.6 | **Uptime monitoring installed, a quarter of data gathered** | Operational | Prerequisite to any availability commitment. §M. |
| P3.7 | **Decide the data-processing roles against any existing contract** | Required | `DATA-INVENTORY.md` §1 flags that whether conflicting terms are already signed is unverified. |
| P3.8 | **Corporate banking and contracting authority** | Operational | Who can sign, and what the limits are. |
| P3.9 | **IP assignment for all contributed code** | Operational | Matters at a financing or acquisition. |
| P3.10 | **Work down the 109-file unscoped-query register** | Operational best practice | A customer questionnaire will ask. It is a known-issues baseline, not a clean state. |

---

## P4 — later enterprise scaling

| # | Item | Class |
|---|---|---|
| P4.1 | SOC 2 Type II (expect to be asked long before this; "not yet, planned" is survivable) | Operational |
| P4.2 | Third-party penetration test | Operational |
| P4.3 | Dependency vulnerability scanning in CI | Operational |
| P4.4 | Open-source licence review and an SBOM | Operational |
| P4.5 | Written security policies, awareness training, background checks | Operational |
| P4.6 | Customer-accessible audit-log export | Contractually advisable |
| P4.7 | Business continuity plan | Operational |
| P4.8 | DMCA agent registration — **only if a public sharing surface is ever built** | Conditional |

---

## What is already done, and does not need revisiting

Verified in this pass unless noted:

- **All 7 storage buckets are private** (re-confirmed 2026-11-25). Storage is
  tenant-scoped; proven by a live cross-org test, 15/15.
- **RLS is enabled on all 296 public tables**, with 957 policies, and the
  tenant-scope guards run before the production build in `netlify.toml`, so a
  violation blocks the deploy.
- **User and organisation erasure exist and are verified end-to-end** (11/11),
  including that a refused erasure changes nothing, and that erasure refuses
  when the subject is an organisation's only active admin.
- **Deleting a note, model or attachment removes the underlying file.**
- **No provider credential can reach the browser bundle** — enforced by
  `src/lib/security/__tests__/no-browser-provider-keys.test.ts`.
- **Customer AI keys are in Supabase Vault**, referenced by `byok_secret_id`;
  there is no plaintext key column.
- **Sentry session-replay masking is pinned** rather than inherited, and normal
  sessions are never recorded.
- **No third-party analytics, advertising or tracking technology exists**, so
  no consent mechanism is required. Verified by code search and in a live
  browser session.

## One correction to carry forward

`DATA-INVENTORY.md` §3 records the platform AI default as
`claude-haiku-4-5-20251001`. The live value is **`claude-3-5-sonnet-20241022`**
(verified 2026-11-25), which is a **retired model**. That is a product defect
rather than a legal one, but the inventory is the source the legal documents
derive from, so the drift is recorded here and in the inventory's own
verification note.
