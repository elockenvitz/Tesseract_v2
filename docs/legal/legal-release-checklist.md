# Legal release and activation sequence

**The order in which the legal documents and the acceptance flow get switched
on.** Nothing in this directory is active today, and this page is how that
changes.

Compiled 2026-11-25. Not legal advice.

---

## Why there is a sequence at all

Two gates, not one, and they are turned on at different times for different
reasons:

| Gate | Variable | What it controls | Failure if turned on early |
|---|---|---|---|
| **Publication** | `VITE_LEGAL_PUBLISHED` | whether the document pages serve their text | publishes text naming an entity that does not exist, which is a false statement |
| **Acceptance** | `VITE_LEGAL_ACCEPTANCE_ENABLED` | whether a user must tick a box, and whether that writes a record | manufactures a record of users accepting a draft, which is worse than no record because it looks like consent |

A single flag would force both at once. The correct order is publication
first, acceptance second, with counsel's approval between them.

Both default to **off**, including in development. A default of on "for
convenience" is how a gate ends up on in production.

## What is built and switched off

| Thing | Where | State |
|---|---|---|
| Entity registry | `src/legal/entity.ts` | all nine fields `null` |
| Document registry | `src/legal/documents.ts` | five documents, all `status: 'draft'` |
| Both gates | `src/legal/publication.ts` | off, with a truth table in `src/legal/__tests__/gates.test.ts` |
| Public pages | `src/pages/legal/` | render an "in preparation" notice |
| Routes | `src/App.tsx` | `/legal` and `/legal/:documentId`, above the protected catch-all |
| Footer links | `src/components/legal/LegalFooter.tsx` | live on every auth page |
| Contextual disclosures | `src/components/legal/ContextualDisclosure.tsx` | built, not yet placed at every call site |
| Acceptance control | `src/components/legal/TermsAcceptance.tsx` | renders `null` |
| Acceptance table | `supabase/migrations/20261125120000_terms_acceptances.sql` | **NOT applied** |
| Isolation suite | `supabase/tests/terms-acceptances-tenant-isolation.sql` | 16/16 on an isolated local cluster |
| Publish script | `scripts/publish-legal.mjs` | refuses while any document is a draft |

---

## Stage 0 — before anything is switched on

| | Step |
|---|---|
| 0.1 | **Form the legal entity.** Nothing below can proceed first. `operational-readiness.md` P0.1. |
| 0.2 | Register the domain and create `legal@` and `privacy@`, both monitored. |
| 0.3 | **Send every document in `docs/legal/` to counsel.** The handoff list is `counsel-review-checklist.md`. |
| 0.4 | Decide the items marked 🔴 in that register. Five of them, not twenty-six. |

## Stage 1 — publish the public documents

In this order. Each step is checkable, and step 1.5 is the one that proves the
rest worked.

| | Step | How to verify |
|---|---|---|
| 1.1 | Fill every field in `src/legal/entity.ts` with counsel's values | `npm run legal:publish` stops naming them |
| 1.2 | For each approved document, set `status: 'approved'` and `effectiveDate`, and drop `-draft` from its `version` | `npm run guard:legal` |
| 1.3 | Delete the counsel-only blockquotes from the approved documents | read them |
| 1.4 | `npm run legal:publish` | exits 0 and lists each document |
| 1.5 | **Set `VITE_LEGAL_PUBLISHED=true` in Netlify and deploy** | open `/legal`, then each document, and confirm no bracketed placeholder is visible and no draft banner appears |
| 1.6 | Confirm the footer links resolve on a signed-OUT browser | the pages must load without a login redirect |

> **1.2 is the approval act.** A document does not become approved by being
> committed; it becomes approved when counsel has read it and the date is
> recorded in the registry, which is a separate commit a reviewer can see.

> **On 1.4**: `public/legal/` is gitignored, so the published copies are
> produced by the release step and are never committed. The build must run
> `legal:publish` before `vite build`, or the pages will serve nothing. Add it
> to the Netlify build command in the same change as 1.5.

## Stage 2 — apply the acceptance table

| | Step | How to verify |
|---|---|---|
| 2.1 | Re-read `docs/production-database-access.md` | |
| 2.2 | Re-run the isolation suite on a fresh local cluster | 16/16, and red before the migration |
| 2.3 | **Get explicit human approval for this specific DDL** | migrations are never applied through MCP, and never by `supabase db push` |
| 2.4 | Apply the migration by the approved route | `terms_acceptances` exists, RLS enabled, 2 SELECT policies, no UPDATE or DELETE policy |
| 2.5 | Confirm the anon role has no access | `has_table_privilege('anon','public.terms_acceptances','SELECT')` is false |

Applying the migration is harmless on its own: nothing writes to the table
while the acceptance gate is off.

## Stage 3 — turn on acceptance for NEW accounts only

| | Step | How to verify |
|---|---|---|
| 3.1 | Confirm both acceptance-required documents are `approved` | `isTermsAcceptanceEnabled()` still returns false only because of the flag |
| 3.2 | Wire `TermsAcceptance` into the signup flow, with the parent's submit gated on its callback | a new account cannot be created without a recorded acceptance |
| 3.3 | Set `VITE_LEGAL_ACCEPTANCE_ENABLED=true` | create a test account; confirm the row exists with the right version |
| 3.4 | Confirm a write failure blocks completion | temporarily revoke EXECUTE on the RPC in a test environment and confirm the user cannot proceed |

> **3.4 is the step most likely to be skipped, and it is the one that matters.**
> The failure mode is a user who believes they accepted and no record that they
> did. The component is written to fail closed; confirm it, do not assume it.

## Stage 4 — the existing 28 users

| | Step |
|---|---|
| 4.1 | **Do not back-date anything.** Nobody has accepted anything. Manufacturing a consent record is worse than having none. |
| 4.2 | Email every existing user: the terms now exist, here they are, acceptance will be required at next sign-in. |
| 4.3 | Require acceptance at next sign-in, with the documents linked and the version recorded. |
| 4.4 | Give administrators 30 days' notice before any later material change. |

Stage 4.2 is also the moment to send the test-build notice, which is
`operational-readiness.md` P1.1 and is the single highest-value item in the
whole package. One email can carry both.

## Stage 5 — institutional contracts

Not a flag. The MSA, DPA, security schedule and SLA are issued per customer
once counsel has drafted real clause language, and they are blocked on the
decisions in `counsel-review-checklist.md` §G, §L, §R and §W.

---

## Rolling back

| Situation | Action |
|---|---|
| A published document is wrong | set `VITE_LEGAL_PUBLISHED=false` and deploy. The pages revert to "in preparation" and no text is served. Then fix and re-publish. |
| The acceptance flow is misbehaving | set `VITE_LEGAL_ACCEPTANCE_ENABLED=false` and deploy. Existing records are untouched, which is correct: they record something that happened. |
| The migration must come out | the rollback statements are at the foot of the migration, in dependency order. |

Neither flag's rollback deletes an acceptance record, and that is deliberate.

## What must never be done

- Publish while any entity field is `null`. The script refuses; do not bypass it.
- Set `status: 'approved'` without counsel having read the document.
- Turn on acceptance while publication is off. The gate refuses, because a box ticked over an unreadable document is unenforceable as well as unfair.
- Treat an existing user as having accepted anything.
- Commit anything into `public/legal/`.
- Apply the migration without explicit approval for that statement.
- Use `--preview` in a production build. The script refuses when `NODE_ENV=production`.
