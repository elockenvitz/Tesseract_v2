# Legal and compliance documents

**Nothing here has been reviewed by a lawyer. Do not publish or sign any of it
as-is.**

These were written by an engineer from the actual codebase and a live read of
the production database — the first pass on **2026-08-14**, the second on
**2026-11-25** — so that counsel can start from what the software genuinely
does rather than reverse-engineering it.

---

## Where to start, by what you are doing

| If you are… | Read |
|---|---|
| deciding what to do next | [`operational-readiness.md`](./operational-readiness.md) — six P0 items, and the rest deferred on purpose |
| wondering how bad things are | [`risk-register.md`](./risk-register.md) — ten risks, ranked, each with what it blocks |
| briefing a lawyer | [`counsel-review-checklist.md`](./counsel-review-checklist.md) — the decisions engineering must not make alone |
| asking "where did this position come from?" | [`legal-research-notes.md`](./legal-research-notes.md) — sources, retrieval dates, and which positions are reasoning rather than sources |
| about to switch something on | [`legal-release-checklist.md`](./legal-release-checklist.md) — the exact activation sequence |
| asking "why so little?" | [`LAUNCH-CHECKLIST.md`](./LAUNCH-CHECKLIST.md) — the calibration argument |
| answering a diligence question | [`DATA-INVENTORY.md`](./DATA-INVENTORY.md) and [`contracts/security-schedule-draft.md`](./contracts/security-schedule-draft.md) |

## The documents

### Factual — these describe what is, not what should be

| File | What it is |
|---|---|
| [`DATA-INVENTORY.md`](./DATA-INVENTORY.md) | What is collected, where it goes, who receives it, what deletion really does. **Everything else derives from this.** §10 is the 2026-11-25 re-verification: four corrections, three additions. |
| [`SUBPROCESSORS.md`](./SUBPROCESSORS.md) | The third parties that receive data. Publishable. Re-verified 2026-11-25: Polygon removed (it receives nothing), EODHD added. |
| [`legal-research-notes.md`](./legal-research-notes.md) | Where each position came from, with retrieval dates. Labels every entry **SOURCE** or **REASONING**, so a careful guess is never mistaken for a finding. Read it before relying on any position in the contracts. |

### Registers — what is wrong, what is owed, in what order

| File | What it is |
|---|---|
| [`risk-register.md`](./risk-register.md) | Ten risks ranked by practical severity, each with what it blocks and whether the facts are Verified, Reported or Unknown. Plus a section on what is genuinely **not** a risk yet. |
| [`counsel-review-checklist.md`](./counsel-review-checklist.md) | The decisions for the founder and counsel, each with a recommended starting position, the reasoning, the tradeoff, what is unknown, and whether specialist counsel is required. **Five are blocking.** |
| [`operational-readiness.md`](./operational-readiness.md) | The ordered operational work, P0 to P4, each item marked legally required / contractually advisable / best practice. |
| [`legal-release-checklist.md`](./legal-release-checklist.md) | How the documents and the acceptance flow get switched on, and in what order. |
| [`LAUNCH-CHECKLIST.md`](./LAUNCH-CHECKLIST.md) | The original calibration argument: why most compliance obligations do not attach yet. Its task lists are superseded by `operational-readiness.md`; its reasoning is not. |

### Public-facing policies — `policies/`

| File | What it is |
|---|---|
| [`terms-of-use-draft.md`](./policies/terms-of-use-draft.md) | Website only. Says expressly that a footer link is not acceptance of a contract. |
| [`privacy-policy-draft.md`](./policies/privacy-policy-draft.md) | Required in practice: CalOPPA obliges a posted policy for a commercial site collecting personal information from Californians. |
| [`cookie-notice-draft.md`](./policies/cookie-notice-draft.md) | Factual: **zero cookies**, no analytics, therefore no consent banner. Includes how that was verified. |
| [`financial-ai-disclosures-draft.md`](./policies/financial-ai-disclosures-draft.md) | The investment and AI disclosures. The one document here specific to this product rather than to software generally. |
| [`application-terms-draft.md`](./policies/application-terms-draft.md) | The terms governing use of the application, as distinct from the website. 32 sections. |

### Institutional contracts — `contracts/`

| File | What it is |
|---|---|
| [`saas-msa-draft.md`](./contracts/saas-msa-draft.md) | What a paying institutional customer signs. A clause map with drafting positions, not finished language. |
| [`design-partner-pilot-draft.md`](./contracts/design-partner-pilot-draft.md) | The first document any external organisation will sign. Short, unpaid, and **restricted to synthetic data** — §4 is the clause that makes the rest safe. |
| [`dpa-draft.md`](./contracts/dpa-draft.md) | What enterprise customers require. ⚠ clauses commit to things not yet built. |
| [`security-schedule-draft.md`](./contracts/security-schedule-draft.md) | 12 control areas, each ✅ VERIFIED / 🟡 UNVERIFIED / 🔵 PLANNED / 🔴 MISSING, with an explicit list of what it does **not** claim. |
| [`support-sla-draft.md`](./contracts/support-sla-draft.md) | Severity definitions and response targets. **No uptime or recovery commitment**, and the document says why. |
| [`INCIDENT-RESPONSE.draft.md`](./INCIDENT-RESPONSE.draft.md) | The 72-hour Reg S-P commitment and how to actually meet it. |

## The one rule these follow

**They do not promise anything the code does not do.**

Deletion is the worked example. When these were first drafted there was no
erasure path at all, so the privacy policy described suspension. Erasure now
exists — `erase_user_personal_data()` for a person, and the two
erase-organization scripts for a whole customer — so the policy was rewritten
to describe erasure. It still stops short of promising a self-service data
export, because that genuinely does not exist.

That is the intended cycle: build the capability, then widen the promise. Doing
it the other way round creates exactly the liability this exercise avoids.

Where a draft breaks the rule it is marked **⚠** in place rather than quietly
fixed, because the fix is a build decision. There are two, and they are the
same one: the MSA's §17 and the application terms' §27 both promise a data
export that does not exist. `counsel-review-checklist.md` §O owns it.

## One source per document

Each document exists **once**, as markdown in this directory.
`src/legal/documents.ts` points at it, and `scripts/publish-legal.mjs` copies
approved documents into `public/legal/` at release time.

There used to be a second copy: hand-written HTML in `site/`, which overlapped
these drafts with no rule about which governed. That pair is retired, and
`src/lib/storage/legal-pages.test.ts` asserts it has not come back. If you need
a published page, run the script; do not write a second copy.

## Nothing is served

Two gates, both off, documented in `legal-release-checklist.md`. Publication is
blocked while any document is a draft or any field in `src/legal/entity.ts` is
null, and `npm run legal:publish` **refuses** rather than warns.

**Publishing a policy that names a legal entity which does not exist is a false
statement, which is worse than publishing nothing.** That is the rule
everything here follows.

## Keeping them true

They are only useful while accurate. Re-check when you:

- add a third-party service that receives data → `SUBPROCESSORS.md`
- add or change a data-deleting path → inventory §4 and the privacy policy
- change what the AI features transmit → inventory §3 and the privacy policy
- change retention → inventory §5
- set a cookie, or add any analytics → `policies/cookie-notice-draft.md`, which
  currently says there are none
- change a security control → `contracts/security-schedule-draft.md`, where
  every ✅ becomes a contractual warranty once signed

An out-of-date privacy policy is a misrepresentation, not just stale docs.

`npm run guard:legal` checks the machine-checkable part: that every registry
source exists, that no draft carries an effective date, that no entity detail
has been invented, and that the publication gate refuses.
