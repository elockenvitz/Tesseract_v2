# Security and Technical Measures Schedule — DRAFT, NOT LEGAL REVIEWED

**Document id:** `security-schedule` · **Version:** 0.1.0-draft ·
**Effective:** not in effect · Intended as **Schedule 2** to the MSA and an
annex to the DPA.

> **Counsel-review draft. Not in effect, binds nobody, not approved.**

---

## How to read this document, and why it is unusual

This is the document a customer's security team will read line by line, and
the one where a single overstatement destroys credibility for everything else
in the directory. So every control carries an explicit status:

| Status | Meaning |
|---|---|
| **✅ VERIFIED** | Implemented, and measured by this assessment or by a named test. The evidence is given. |
| **🟡 IMPLEMENTED, UNVERIFIED** | The mechanism exists in code or configuration, but no test or measurement in this pass proves it behaves as described. |
| **🔵 PLANNED** | Decided, not built. |
| **🔴 MISSING** | Not present. Named here rather than omitted. |

Measurements were taken on **2026-11-25** against the production database over
a read-only connection, and against the codebase at the commit this document
ships in.

**A customer-facing version of this document must not be issued until counsel
and the founder have reviewed it**, because a security schedule is a
contractual representation. The statuses above are what make it safe to send:
a schedule that claims uniform maturity is a schedule that will be disproved.

### What this document does NOT claim

Stated first, deliberately:

- **No SOC 2 report.** None exists. No Type I, no Type II, no observation
  window started.
- **No ISO 27001 certification.**
- **No third-party penetration test.** Never commissioned.
- **No external security audit or assessment.**
- **No bug bounty programme.**
- **No HIPAA, PCI-DSS or FedRAMP posture.** The product is not designed for
  those data categories and the terms prohibit putting them in.

"Not yet, and here is the plan" is survivable in an institutional sale. A false
attestation is not, and is a separate species of liability from a breach.

---

## 1. Hosting and infrastructure

| Control | Status | Detail and evidence |
|---|---|---|
| Application hosting | ✅ VERIFIED | Netlify. Static assets and build pipeline. |
| Database, authentication, file storage | ✅ VERIFIED | Supabase, PostgreSQL **17.4** (`version()`, 2026-11-25), us-east-1. |
| Serverless compute | ✅ VERIFIED | Supabase Edge Functions. |
| Data residency | 🟡 IMPLEMENTED, UNVERIFIED | Primary storage is United States (us-east-1). Whether every provider processes exclusively in the US — Netlify's edge, Sentry's ingest, the AI providers' inference — is **not established**. Do not represent US-only processing. |
| Single-tenant deployment | 🔴 MISSING | The architecture is multi-tenant by design. A dedicated instance is not offered. |

## 2. Authentication and access

| Control | Status | Detail and evidence |
|---|---|---|
| User authentication | ✅ VERIFIED | Supabase Auth; email and password, plus SSO. |
| SSO | 🟡 IMPLEMENTED, UNVERIFIED | An SSO flow exists with state, nonce and PKCE code-verifier handling (`sso_state`, `sso_nonce`, `sso_code_verifier`). Not exercised by this assessment. |
| Multi-factor authentication | 🔴 MISSING | No MFA enforcement is implemented or configurable for customers. Institutional buyers will ask for this, and for SSO-enforced sign-in. |
| Password policy | 🟡 IMPLEMENTED, UNVERIFIED | Provider defaults apply; no Tesseract-specific policy is configured or documented. |
| Session handling | ✅ VERIFIED | Token held in browser local storage; auto-refresh enabled; session persists across reloads (`src/lib/supabase.ts`). |
| Session timeout / idle lock | 🔴 MISSING | No idle timeout or forced re-authentication. |
| Role-based access | ✅ VERIFIED | Organisation membership with administrator flags (`organization_memberships`); platform staff separated via a `platform_admins` table and an `is_platform_admin()` check. |
| Access revocation | ✅ VERIFIED | Removing membership removes access; an organisation's removed member is denied by the tenant-isolation suites. |
| Granular permissions | 🟡 IMPLEMENTED, UNVERIFIED | Per-feature permission predicates exist on several tables; there is no customer-configurable permission model. |

## 3. Tenant isolation — the control that matters most

| Control | Status | Detail and evidence |
|---|---|---|
| Row-level security enabled | ✅ VERIFIED | **296 of 296** tables in `public` have RLS enabled; **0** disabled (2026-11-25). |
| Policy coverage | ✅ VERIFIED (count) | **957** policies across those tables. |
| Tables with RLS on and no policy | ✅ VERIFIED | **3**: `custom_notebook_notes`, `market_data_cache`, `trade_lab_view_members`. RLS with no policy **denies** access to non-privileged roles, so this fails closed, but it also means any feature depending on them is unreachable for ordinary users. |
| Isolation keyed on organisation | 🟡 IMPLEMENTED, UNVERIFIED **in aggregate** | Policies key on `current_org_id()` / `is_member_of_org()`. Individual paths are proven by SQL suites in `supabase/tests/` (cross-org and removed-member denial), but there is **no single assertion that all 957 policies are correct**, and there cannot be. |
| Client-side org filtering | 🟡 KNOWN EXCEPTION REGISTER | `src/lib/org-scope/known-unscoped-queries.json` lists **109 files** that query org-scoped tables with no explicit organisation filter and rely on RLS alone. This is a known-issues baseline, not a clean bill of health. Disclose it. |
| Automated boundary enforcement | ✅ VERIFIED | `scripts/tenant-boundary-lint.mjs`, `scripts/frontend-tenant-lint.mjs`, `src/lib/org-scope/__tests__/org-scope-guard.test.ts`. The scope and signal guards run **before** the production build in `netlify.toml`, so a violation blocks the deploy. |
| Storage isolation | ✅ VERIFIED (2026-08) | All **7** buckets are private (re-confirmed 2026-11-25: `assets`, `captures`, `thought-attachments`, `model-templates`, `workflow-templates`, `org-exports`, `template-branding`). A live cross-org test passed 15/15. |
| Prior isolation incidents | ✅ CLOSED, DISCLOSED | Three defects closed 2026-08-14, including a publicly readable `assets` bucket and a storage read policy with no tenant condition. Full facts in `../DATA-INVENTORY.md` §8. **Whether any of them requires customer notification is an open legal question**, not an engineering one. |

## 4. Encryption

| Control | Status | Detail and evidence |
|---|---|---|
| In transit | 🟡 IMPLEMENTED, UNVERIFIED | HTTPS/TLS throughout, terminated by Netlify and Supabase. A strict CSP is set in `index.html`; HSTS and TLS version/cipher configuration are provider-managed and **were not measured**. |
| At rest | 🟡 IMPLEMENTED, UNVERIFIED | Supabase encrypts storage volumes at rest as a platform feature. **We have not independently verified it and it is the provider's representation, not ours.** Cite the provider, do not adopt the claim. |
| Customer-managed keys | 🔴 MISSING | Not offered. |
| Field-level encryption | 🟡 PARTIAL, VERIFIED for the one case that matters | Customer AI provider keys (BYOK) are held in Supabase Vault and referenced by `byok_secret_id`; `organization_ai_config` has **no plaintext key column** (verified 2026-11-25). No other field-level encryption exists. |

## 5. Secret management

| Control | Status | Detail and evidence |
|---|---|---|
| Server-side secrets | ✅ VERIFIED | Supabase function secrets and Netlify environment variables. Not in the repository. |
| No provider credentials in the browser bundle | ✅ VERIFIED | Enforced by a test: `src/lib/security/__tests__/no-browser-provider-keys.test.ts` fails on a `VITE_*` provider key in source or in `.env.example`. |
| Prior credential exposure | ✅ CLOSED, DISCLOSED | A working Alpha Vantage key was previously inlined into the client bundle by Vite as a `VITE_*` variable and served as plain text. Removed 2026-09-10; the gate above exists to prevent recurrence. **The exposed key has not been confirmed as rotated** — see `../operational-readiness.md` P0. |
| Customer-supplied AI keys | ✅ VERIFIED | Vault custody; authorisation is the database `GRANT` rather than application logic. |
| Secret rotation policy | 🔴 MISSING | No documented rotation schedule or procedure. |

## 6. Application security

| Control | Status | Detail and evidence |
|---|---|---|
| Content Security Policy | ✅ VERIFIED | `default-src 'self'`, `script-src 'self'`, `frame-ancestors 'none'`, and an explicit `connect-src` allow-list (own origin, Supabase, the AI providers, Alpha Vantage, Sentry). Verified in `index.html`. |
| Clickjacking / MIME | ✅ VERIFIED | `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `referrer: strict-origin-when-cross-origin`. |
| Privileged-function authorisation | ✅ VERIFIED (as a gate) | Every `service_role` Edge Function must be registered in `supabase/functions/authz-registry.json` with its auth class and a runtime authorisation test; `npm run sec:edge-authz` fails if one is unregistered or a user-reachable privileged class lacks a test. |
| SQL injection | 🟡 IMPLEMENTED, UNVERIFIED | Access is through the PostgREST client and parameterised RPCs rather than string-built SQL. Not systematically audited. |
| Dependency vulnerability scanning | 🔴 MISSING | No automated scanning (`npm audit` is not gated, no Dependabot/Snyk). |
| Static analysis | 🟡 PARTIAL | ESLint, a TypeScript error ratchet, and bespoke guards (tenant scope, TDZ, copy, MCP read-only). No dedicated SAST tool. |
| Penetration testing | 🔴 MISSING | Never commissioned. |

## 7. Logging and monitoring

| Control | Status | Detail and evidence |
|---|---|---|
| Application audit trail | ✅ VERIFIED | `activity_events`, `audit_events`, `organization_audit_log`. |
| Audit log integrity | 🟡 IMPLEMENTED, UNVERIFIED | A `supabase/tests/audit-events-integrity.sql` suite exists; not executed in this pass. |
| Audit log retention control | ✅ VERIFIED | `organization_governance.retention_days_audit_log` — **the only retention control in the schema**. |
| Error monitoring | ✅ VERIFIED | Sentry. `tracesSampleRate` 0.1 in production; `sendDefaultPii: false`. |
| Session replay | ✅ VERIFIED, and must be disclosed | `replaysSessionSampleRate: 0`, `replaysOnErrorSampleRate: 1.0` — normal sessions are never recorded; **an errored session is recorded in full**. Masking is pinned explicitly (`maskAllText`, `maskAllInputs`, `blockAllMedia`) rather than inherited from SDK defaults. Masking reduces exposure; layout, navigation and timing still reveal a firm at work. |
| Security event alerting | 🔴 MISSING | No alerting on authentication anomalies, authorisation failures or data-access patterns. |
| Customer-accessible audit export | 🔴 MISSING | Administrators cannot export their own audit trail. |

## 8. Backup and recovery — the most serious gap

| Control | Status | Detail and evidence |
|---|---|---|
| Database backups | 🔴 **MISSING** | Recorded as `backups: []`. **Re-confirm via the Management API before issuing this document.** |
| Point-in-time recovery | 🔴 **MISSING** | Recorded as `pitr_enabled: false`. |
| Tested restore | 🔴 MISSING | Cannot exist without a backup. |
| Recovery objectives | 🔴 MISSING | No RPO or RTO can be stated, and none must be stated in any SLA, until the above exist. |
| File storage redundancy | 🟡 UNVERIFIED | Provider-managed; not independently established. |

**This single row is the reason `../contracts/support-sla-draft.md` contains no
recovery commitment and the reason `../risk-register.md` ranks this third.** A
product whose value proposition is institutional memory has, today, one copy of
that memory.

## 9. Data deletion and portability

| Control | Status | Detail and evidence |
|---|---|---|
| Individual erasure | ✅ VERIFIED end-to-end | `erase_user_personal_data()` (confirmed present 2026-11-25) plus `scripts/erase-user.mjs`. Erases preferences, saved views, notifications, OAuth tokens, AI history and identity; authored records are **retained** as the customer's business records, attributed to "Former user". Verified against live fixtures 11/11, including that a refused erasure changes nothing. |
| Erasure safety interlock | ✅ VERIFIED | Refuses, changing nothing, if the subject is an organisation's only active administrator. |
| Organisation deletion | ✅ VERIFIED | `scripts/sql/erase-organization-rows.sql` + `scripts/erase-organization.mjs` — all rows and files. Operator-run and irreversible. |
| File deletion follows row deletion | ✅ VERIFIED | Deleting a note, model or attachment removes the underlying stored file. `scripts/sweep-orphaned-assets.mjs` reports orphans (report-only by default). |
| Scheduled retention / purge | 🔴 MISSING | Nothing is deleted on a timer except via the audit-log control. Content is kept indefinitely. |
| Self-service data export | 🔴 MISSING | `org-exports` job infrastructure exists; there is **no** user- or admin-facing export. A DSAR or a termination export is a manual engineering task. |

## 10. Vendor and subprocessor management

| Control | Status | Detail and evidence |
|---|---|---|
| Subprocessor register | ✅ VERIFIED | `../SUBPROCESSORS.md`, maintained from the codebase. |
| Signed DPAs with subprocessors | 🔴 MISSING / UNKNOWN | Not confirmed for any subprocessor. Supabase, Netlify and Sentry publish DPAs; **whether any has been executed is unknown**. |
| AI provider data terms | 🔴 UNCONFIRMED | No provider's retention or training position confirmed in writing. See `../risk-register.md` §5. |
| Market-data licences | 🔴 **MISSING** | No commercial redistribution licence is in place. See `../risk-register.md` §4. |
| Vendor security review | 🔴 MISSING | No formal process. |

## 11. AI data handling

| Control | Status | Detail and evidence |
|---|---|---|
| What is transmitted | ✅ VERIFIED | `supabase/functions/ai-chat` transmits asset data, investment theses, `where_different`, `risks_to_thesis`, note bodies, outcomes, portfolio names and holdings. |
| Server-side only | ✅ VERIFIED | AI calls originate from an Edge Function, not the browser. No provider key reaches the client (§5). |
| Platform default provider | ✅ VERIFIED | Anthropic, model `claude-3-5-sonnet-20241022` (`platform_ai_config`, 2026-11-25). **Note: this model is retired; it is a defect, recorded in the founder's operational list.** |
| BYOK | ✅ VERIFIED | Per-organisation provider and model, key in Vault. Where BYOK is used the provider is the **customer's** subprocessor. |
| Provider retention / no-training | 🔴 UNCONFIRMED | Stated as unconfirmed in every document here. Must not be claimed. |
| Per-organisation AI spend controls | 🟡 IMPLEMENTED, UNVERIFIED | Usage is logged (`ai_usage_log`) and caps exist, but they are per-user and non-atomic. Do not represent them as a hard spend limit. |

## 12. Organisational and personnel controls

Honesty requires naming the structural position rather than describing a
programme that does not exist.

| Control | Status |
|---|---|
| Security policies (written, adopted) | 🔴 MISSING |
| Security awareness training | 🔴 MISSING |
| Background checks | 🔴 MISSING |
| Personnel offboarding procedure | 🔴 MISSING |
| Named security contact | 🔵 PLANNED — see `../operational-readiness.md` |
| Incident response plan | 🟡 WRITTEN, NEVER REHEARSED — `../INCIDENT-RESPONSE.draft.md` |
| Business continuity plan | 🔴 MISSING |
| Cyber liability / E&O insurance | 🔴 MISSING |

**Tesseract is, at the date of this document, a single-developer pre-release
project with no legal entity.** Several controls in this section are not
meaningfully available at that size, and the right disclosure is the
size — not a policy document nobody has read.

---

## Summary for a customer security questionnaire

If asked for one line per area, these are the defensible answers today:

| Area | Answer |
|---|---|
| Tenant isolation | Strong mechanism (RLS on all 296 tables, 957 policies, deploy-blocking lints, proven cross-org suites) with a disclosed 109-file exception register |
| Encryption | TLS in transit; provider-managed at rest, cited rather than warranted |
| Secrets | Server-side only, with a test preventing client-side provider keys |
| Authentication | Email/password and SSO; **no MFA** |
| Backups | **None. The most serious gap.** |
| Deletion | Individual and organisation erasure verified end-to-end; **no scheduled retention and no self-service export** |
| Certifications | None, and none claimed |
| Pen test | None |
| Insurance | None |
| Incident response | Plan written, never rehearsed; Reg S-P 72-hour service-provider notification committed in the DPA |

## Open items before this can be issued to a customer

1. Re-confirm the backup and PITR status via the Management API (§8).
2. Enable backups and PITR — then rewrite §8 and give the SLA a real RPO/RTO.
3. Confirm whether exposed credentials were rotated (§5).
4. Execute DPAs with Supabase, Netlify and Sentry, and record the dates (§10).
5. Decide the MFA position (§2) — the first institutional questionnaire will
   ask.
6. Counsel review: a security schedule is a contractual representation, and
   each ✅ becomes a warranty.
