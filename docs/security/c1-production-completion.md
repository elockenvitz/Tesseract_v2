# Security C1 — production completion record

**Status:** COMPLETE · **Executed:** 2026-08-29 · **Project:** `wfcebeagznzgeuyysbnt` (production)

Companion to `c1-design.md` (the design), `c1-staging-results.md` (the staging
evidence) and `c1-checkpoint.md` (the discovery record). This file records what
actually landed on production and what did not.

---

## 1. What was closed

Proprietary research prose and workflow state on **506 of 912** production assets
were readable — and full-text searchable — by every authenticated user across all
**27** organizations. `useExploreSearch` ran an `ILIKE` pass over `thesis`,
`where_different` and `risks_to_thesis` on a table whose SELECT policy was
`USING (true)`, so a user in any organization could find another firm's thesis by
typing a phrase from it.

Seven further tables carried unconditional policies over tenant-owned rows.

Both are closed. The fix retires duplicated state rather than adding tenancy to a
global table: every one of the nine class-C `assets` columns already had an
authoritative org-scoped home.

## 2. Release identity

| | |
|---|---|
| Application merge commit | **`df1637937ec5e6ee02caac27f57ba5553afa0077`** |
| Pull request | **#220** — merge commit, four required checks green |
| Release candidate | `286a101efc1706adcd6768f44460c3cae27c475c` on `fix/security-c1` |
| Previous production base | `daaa77301c433b7ea5f625cc297893f303d6b0e2` |
| Production URL | `https://tesseract2025.netlify.app` |

Deployed-bundle identity was verified by code marker, not by deploy status: the
live bundle contains `screen-asset-overlay` (introduced by this release) and
**zero** occurrences of any pre-C1 restricted-column select literal.

## 3. Execution order as run

Every SQL file was verified byte-identical to its reviewed artifact — byte count,
SHA256 and a byte-level diff — immediately before execution.

| Phase | Step | File |
|---|---|---|
| **A** | preflight | §0 sweep · `91-prod-endpoint-dryrun.sql` · MSG-07 preconditions |
| **B** | B0 | `release-b/07-messages-portfolio-context-tenant-derivation.sql` (**MSG-07**) |
| | B1–B3 | `01-tdf-holdings-snapshots` · `02-tdf-holdings` · `03-theme-assets` |
| | B4–B6 | `04-object-links` · `05-scenarios` · `06-asset-revisions-events` |
| | B7–B9 | `07-asset-contribution-history` · `08-asset-contributions` · `08b-asset-workflow-state` |
| | B10 | `09a-assets-workflow-state-migration` (additive) |
| **C** | deploy | PR #220 → `df16379` |
| **D** | D1–D3 | `09b-assets-column-privileges` · `10-asset-field-history` · `11-grants` |

The `09a` / `09b` split is what made a zero-break release possible: `09a` puts
the workflow data where the new client reads it while the old client keeps
working; the deploy switches the readers; `09b` closes the door behind them.

**MSG-07 is not C1-07.** It is the Release B portfolio-context message fix, run
first and isolated. Deployed body: 3,475 bytes, md5 `e280f8288e7a7a018bc7d4a72c7f0ac4`
— byte-identical to the staging-validated artifact.

## 4. Final production state

### Data

| Table | Rows | Note |
|---|---|---|
| `assets` | 912 | 32 columns, none dropped |
| `object_links` | 25 | **25/25 attributed**, 0 cross-org conflicts |
| `scenarios` | 112 | 111 global defaults · 1 quarantined custom |
| `asset_contributions` | 32 | **0 NULL-org** (1 deterministic backfill) |
| `asset_contribution_history` | 22 | EXISTS-bounded via parent |
| `asset_workflow_priorities` | 495 | 6 pre-existing + 489 migrated |
| `asset_workflow_progress` | 874 | 396 pre-existing + 478 migrated |
| `asset_revisions` / `_events` | 13 / 22 | all historical rows creator-only |
| `asset_field_history` | 1,066 | 1,052 system-readable · 14 creator-only |
| `tdf_holdings` / snapshots | 672 / 48 | 2-hop EXISTS |
| `theme_assets` | 18 | foreign-theme INSERT closed |

**16** assets hold workflow state with no workflow anchor and remain quarantined.
No row was deleted, and no row was assigned a fabricated organization anywhere in
this release.

### Privileges

| Check | Value |
|---|---|
| Restricted `assets` columns readable by `authenticated` | **0** (was 10) |
| Safe `assets` reference columns readable | **22** |
| `anon` grants across the 14 C1 tables | **0** (was 91) |
| `authenticated` TRUNCATE across the 14 | **0** (was 14) |
| `authenticated` REFERENCES / TRIGGER across the 14 | **0** |

### RLS floor — two intentional entries remain

| Measure | Value |
|---|---|
| RAW unconditional policies on C1 tables | **2** |
| USER-RELEVANT (excluding the `postgres` service role) | **1** |

1. `asset_workflow_progress` — `Service role can manage workflow progress`, `TO postgres`.
   `postgres` carries BYPASSRLS, so this is not a boundary. The guard skips owner
   roles by design (`OWNER_ROLES`), and `08b`'s own assertion excludes it.
2. `assets` — `Users can read all assets`, `USING (true)`, `TO authenticated`.
   Retained deliberately: the row genuinely is global, and the proprietary
   boundary now lives in **column privileges**, not the policy. Allowlisted in
   `GLOBAL_READ_ALLOWLIST` with a reason rewritten to say exactly that.

Neither should be driven to zero.

## 5. Guard result

```
PASS: 106 known finding(s), 0 new.
```

Run against a freshly regenerated post-C1 production inventory
(`captured_at 2026-08-29T17:01:19Z`, 288 tables, 926 policies).

**On the numbers, because two different units get confused:**

- The **ratchet list** (`KNOWN_UNRESOLVED`, table names) shrank **64 → 55** —
  exactly the nine C1 tables: `object_links`, `theme_assets`, `scenarios`,
  `tdf_holdings`, `tdf_holdings_snapshots`, `asset_contribution_history`,
  `asset_field_history`, `asset_revisions`, `asset_revision_events`.
- The **known-findings count** is **106**, which is the post-fix figure recorded
  in `c1-staging-results.md` §1, §19 and §25. It did not move, because 106 was
  already measured after those nine tables were closed.

There is no "97". That figure came from subtracting nine table names from a
count of findings — different units. Production matching 106 exactly, with 0 new,
**is** the reviewed expectation.

## 6. Verification

**Code gates**, from `main` at `df16379`: `guard:unit` 1260/1260 (89 files) ·
`guard:types` 0 card-surface errors · `guard:tdz` clean · `build` passing ·
C1 static suites 276/276 (13 files).

**Production application smoke**, authenticated, after every restrictive step:
entity search · lists with priority overlay · portfolio holdings (29 positions) ·
asset research prose · workflow state · change-intelligence history · scenario
ladder. **Zero `42501`, zero `permission denied`, zero PGRST errors** throughout.

The sharpest single proof: after `09b` revoked `assets.priority`, the list view
still renders AAPL's priority as *Critical* — it can only be coming from
`asset_workflow_priorities` through the overlay.

**Staging evidence** (accepted at review, not re-run against production):
synthetic matrix **77/77**, product smoke **23/23**, staging guard 0 new.

## 7. Not exercised

Non-blocking, and recorded so they are not mistaken for having been done:

- Cross-org negative smoke through a **second production browser identity**.
  Cross-tenant denial is proven by the staging matrix (77/77, including multi-org
  and unaffiliated identities) and by the production privilege state, but not by a
  second live login.
- Custom-scenario **write** in production.
- Existing object-link **read** surface in production.

## 8. Explicitly out of scope

**258 tables outside C1 still carry `anon` grants**, and the schema-wide
`TRUNCATE` over-granting persists on roughly the same set. This is a
least-privilege defect with **no demonstrated exploit path** — PostgREST does not
emit `TRUNCATE`, and `anon`/`authenticated` are not reachable over a direct
Postgres connection without the database password.

It is tracked separately in `least-privilege-truncate.md` and was deliberately
**not** touched here: widening a tenant-boundary release into hundreds of
unrelated tables would have made it unreviewable.

The ratchet also still holds **106 known findings**. C1 closed the tables it
scoped; it did not close the schema.

## 9. Feature freeze

**LIFTED.**

The freeze was set because proprietary research and workflow state on 506 of 912
assets were readable and searchable by every authenticated user in all 27
organizations. That condition no longer holds: the nine `assets` columns and the
original seven C1 tables all have an enforced tenant boundary, verified
behaviourally against production rather than by reading policy text.

## 10. Rollback position

Nothing in this package is destructive — no column dropped, no row deleted, no
value overwritten. The two quarantined prose values (an AAPL `thesis`, a V
`quick_note`) remain in place in columns no ordinary role can read, recoverable
if an organization is ever established for them.

`09b` is the one-way door. Past it, an application-only rollback is no longer
sufficient. The only sanctioned reversal is the reviewed re-grant
(`GRANT SELECT, INSERT, UPDATE ON public.assets TO authenticated`, which
supersedes the column grants) — and it reopens the leak, so it is a decision, not
a reflex.
