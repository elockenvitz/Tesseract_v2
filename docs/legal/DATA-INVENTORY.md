# Data Inventory — Tesseract

**Status: factual working document. Not a legal document.**
Compiled from the codebase and from the production database on 2026-08-14.
Every claim below is traceable to a file path or a query; where something was
not verified, it says so.

This exists so counsel drafting the privacy policy, DPA and breach-response
plan does not have to reverse-engineer the application. It is also the source
the sibling drafts in this directory were written from — if this document
changes, they need re-checking.

---

## 1. Who the parties are

Tesseract is B2B software sold to investment firms. In data-protection terms
the customer firm is the **controller** of the research, holdings and client
data it puts into the platform; Tesseract is the **processor**. For account
data about the firm's own employees (name, email, login), Tesseract acts as
controller.

That split matters for two reasons: the customer's DPA governs the research
data, and the customer's own regulator reaches Tesseract through that contract
(see §7).

**Not verified:** the legal entity name, place of incorporation, and whether
any customer contracts are already signed with terms that conflict with the
drafts here.

---

## 2. Personal data held

### About users of the platform

| Data | Where | Source |
|---|---|---|
| Email, first/last name | `users` | account creation |
| Organization membership, admin flags | `organization_memberships` | admin action |
| Current organization | `users.current_organization_id` | set on org switch |
| Per-user preferences, saved views, layouts | `user_preferences`, `user_saved_views`, `user_asset_*` | in-product |
| Activity and audit trail | `activity_events`, `audit_events`, `organization_audit_log` | automatic |
| Notifications | `notifications` | automatic |
| AI prompt history | `user_quick_prompt_history` | in-product |
| AI usage and cost | `ai_usage_log` | automatic |

### Customer business data (controller data)

Investment research and decision records: theses, notes, price targets,
ratings, trade ideas, simulations, committed trades, portfolio holdings and
their history, coverage assignments, workflow and checklist state.

**This is commercially sensitive and, for the customer, likely regulated
recordkeeping.** Portfolio holdings and trade intentions are the material
non-public information of a registered adviser.

### Uploaded files

Stored in Supabase Storage. As of 2026-08-14 the `assets` bucket holds **9
objects, 703 kB** — 6 customer documents, 2 model templates, 1 note
attachment. All other buckets are empty except `template-branding` (1 org
logo).

Buckets: `assets`, `captures`, `thought-attachments`, `model-templates`,
`workflow-templates`, `org-exports`, `template-branding`. **All are private
as of 2026-08-14.** `assets`, `captures`, `thought-attachments` and
`model-templates` were public before that date — see §8.

---

## 3. Third parties that receive data

Everything here is disclosable in a privacy policy and belongs on a
subprocessor list.

### Infrastructure

| Party | What they hold | Notes |
|---|---|---|
| **Supabase** | The entire database and all uploaded files | us-east-1 |
| **Netlify** | Static hosting, build logs | serves the app |

### AI providers — `supabase/functions/ai-chat/index.ts`

The AI chat feature sends customer research content to a third-party model
provider. `buildContextPrompt` assembles and transmits: asset data,
**investment theses, `where_different`, `risks_to_thesis`, note bodies,
outcomes, portfolio names and holdings**.

Configurable per platform or per organization (BYOK):

| Provider | Default model |
|---|---|
| Anthropic (default) | `claude-haiku-4-5-20251001` |
| OpenAI | `gpt-4o-mini` |
| Google | — |
| **Perplexity** | `llama-3.1-sonar-*` — search-augmented; call out separately |

**Not verified:** whether zero-retention / no-training terms are in place with
any of these. This needs confirming in writing before the privacy policy
claims anything about it.

When an organization supplies its own key (BYOK), that organization — not
Tesseract — holds the provider relationship. The policy and DPA should say so.

### Market data providers

Alpha Vantage, Yahoo, Polygon, Finnhub. These receive **ticker symbols**, not
customer content. Lower sensitivity, but they are still recipients and belong
on the list.

### Error monitoring — `src/main.tsx`

**Sentry.** Errors, performance traces (10% sampled in production), and
**session replay recorded on every errored session** (`replaysOnErrorSampleRate: 1.0`;
happy sessions are never recorded).

Replay records the DOM of a user working inside the product. Masking
(`maskAllText`, `maskAllInputs`, `blockAllMedia`) is now passed explicitly
rather than inherited from SDK defaults, and `sendDefaultPii` is off. Session
replay is the single most commonly challenged item in a security review —
disclose it plainly.

---

## 4. Deletion — what is true today

Be careful here: promising more than this is a policy that is not implemented.

| Ask | Reality |
|---|---|
| Delete an uploaded model | Row soft-deleted **and file removed from storage** (as of this change) |
| Delete a note | Row soft-deleted **and its attachments and screenshots removed** |
| Delete an attachment in the composer | File removed |
| Erase a user's personal data | `erase_user_personal_data()` RPC + `scripts/erase-user.mjs` — preferences, saved views, notifications, **OAuth tokens**, AI history and identity erased; authored records retained as the firm's business records, attributed to "Former user". **Verified end-to-end against live fixtures 2026-08-14** |
| Delete an organization and its data | `scripts/sql/erase-organization-rows.sql` + `scripts/erase-organization.mjs` — all rows and all files. Operator-run, irreversible |
| Export my data | `org-exports` job infrastructure exists; **still not a user-facing DSAR flow** |

`scripts/sweep-orphaned-assets.mjs` reports (and optionally deletes) files no
row points at. Report-only by default.

Erasure is deliberately a *split*, not a wipe: the person is erased, the work
they authored is retained. That is not evasion — the authored records belong to
the customer firm, which is their controller, and for an SEC-registered adviser
they are records it is required to retain under Advisers Act Rule 204-2.
Deleting them on an individual's request would destroy the firm's compliance
record.

Erasure refuses, without changing anything, if the subject is the only active
admin of an organization — that would leave the org unadministerable. The
operator must promote another admin or erase the organization instead.

**Remaining gap: there is no self-service export.** A DSAR asking for a copy of
personal data is currently a manual job.

---

## 5. Retention

Only one retention control exists: `organization_governance.retention_days_audit_log`
(`20260224000000_phase16_governance_jobs.sql`).

Everything else is kept indefinitely. There is no scheduled purge of notes,
research, holdings history, activity events or uploaded files.

---

## 6. Tenant isolation

Relevant because a policy that promises "your data is separated from other
customers" should be true.

Isolation is enforced by Postgres row-level security keyed on
`current_org_id()`, plus a client-side filter on tables whose RLS is not
org-aware. Two lint scripts and a test guard it:
`scripts/tenant-boundary-lint.mjs`, `scripts/frontend-tenant-lint.mjs`,
`src/lib/org-scope/__tests__/org-scope-guard.test.ts`.

**Known accepted gaps:** `src/lib/org-scope/known-unscoped-queries.json`
currently lists **109 files** that query org-scoped tables without an explicit
org filter and rely on RLS. That baseline is a known-issues register, and a
diligence questionnaire may ask about it.

---

## 7. Regulatory obligations that reach Tesseract

Tesseract is not itself SEC-registered, but its customers are, and their
obligations arrive by contract.

- **SEC Regulation S-P (amended).** Compliance dates have passed (Dec 2025
  larger entities / June 2026 smaller). Covered advisers must have written
  contracts requiring **service providers** to notify them of unauthorized
  access to customer information **within 72 hours**. Expect this in every
  customer contract. See `INCIDENT-RESPONSE.md`.
- **GLBA Safeguards Rule.** Reaches Tesseract through the same contracts.
- **Advisers Act Rule 204-2 (books and records).** If advisers keep required
  records in Tesseract, retention and production obligations may attach.
  **Needs a securities lawyer's view** — it interacts directly with §4 and §5.
- **CalOPPA.** Requires a posted privacy policy for any commercial online
  service collecting personal information from California residents. Applies
  regardless of size. This is the baseline obligation.
- **CCPA/CPRA.** Threshold-dependent (~$25M revenue / 100k consumers). Note
  it has covered B2B contacts since 2023.
- **GDPR / UK GDPR.** Applies if there are any EU/UK users. **Not verified.**

---

## 8. Incidents and material changes to record

Facts a regulator or customer might ask about, documented rather than lost:

- **Until 2026-08-14 the `assets` storage bucket was publicly readable.** Its
  creating migration set `public = false`; it was `true` in production, changed
  outside version control at an unknown date. Any object path that had ever
  been disclosed was fetchable **without authentication**. The bucket held 9
  objects belonging to one organization. `captures`, `thought-attachments` and
  `model-templates` were also public and were **empty**.
- **Until 2026-08-14 the `assets` bucket's read policy was `bucket_id = 'assets'`**
  — any authenticated user of any organization could read any file.
- **Until 2026-08-14 mobile explore search queried `asset_lists` with no
  organization filter.** `asset_lists` RLS is `created_by = auth.uid() OR
  user_has_list_collaboration(id)` — ownership, not organization — so results
  crossed the org boundary for lists the user already had access to: a user
  belonging to two organizations saw org A's lists while working in org B.
  Narrower than a stranger reading another firm's data, but still a
  tenant-boundary violation. `trade_queue_items` was also unfiltered in the
  client, though its RLS *is* org-scoped, so that one did not leak.

All three are closed. Whether any of them requires customer notification is a
legal judgement, not an engineering one — but the facts are here to make it.
Access logs would be needed to establish whether anything was actually
retrieved; **that has not been investigated.**

---

## 9. Open questions for counsel

1. Does the Aug 2026 bucket exposure trigger notification to the affected
   customer, or to any regulator?
2. Does Rule 204-2 make Tesseract a recordkeeping system, and what retention
   and production guarantees follow?
3. Is account/organization erasure required before the privacy policy can
   promise deletion — or can the policy be written around suspension?
4. Are EU/UK users in scope?
5. Do the AI providers' standard terms suffice, or is a zero-retention
   agreement needed per provider?
