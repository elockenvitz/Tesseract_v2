# ACT AI 2.4 and the Asset Workspace — release record

Closed 2026-11-14. This records what shipped, what was deliberately held
back, and what is still true about the system afterwards. It is the handoff
into the frontend architecture and Memory Spine audit; the brief for that is
`frontend-architecture-and-memory-spine-audit-brief.md`.

---

## What shipped

**PR #291**, `discovery/asset-page-2` into `main`: 100+ commits, ~256 files.
The initiative covered ACT AI 2.0 through 2.4, the contextual Asset
Workspace, Dashboard attention, navigation, Slash Commands, and frontend
stabilisation. The frontend was visually reviewed and accepted for
demonstration before this release.

Final release corrections made during the release itself, each its own
commit:

| Commit | What |
|---|---|
| `aeec0df2` | Asset tab continuity: returning to a tab is not a reload |
| `cb12cc3f` | One definition of an expired price target |
| `637f1b7f` | ai-chat releases through the gated deploy workflow |

### Asset tab continuity (`aeec0df2`)

Leaving an asset surface and returning drew a skeleton over content already
fetched, and put the reader at the top of a page they had read down.

Causes: `gcTime: 0` on the section and field catalogues in
`useUserAssetPagePreferences`, which discards the entry on unmount — and
those feed the composite `isLoading` that `AssetTab` reads as `pageReady`
behind an unconditional full-page skeleton, so it fired on *every* switch.
Separately, no app-wide `gcTime` meant everything else was collected after
five minutes. And the Asset Page owns no scroller: it renders into the one
`overflow-auto` div in `Layout` that every non-full-width tab shares, so its
offset survives the tab change and is then clamped by the next tab's height.

Fix: a named 30-minute retention (`lib/ui/asset-surface-retention`) on the
queries that gate a visible skeleton, and a per-tab scroll memory in
`Layout` (`lib/ui/scroll-memory`, shared with `IdeasWorkPane`). `staleTime`
was not touched anywhere and `refetchOnMount: 'always'` stays, so every
mount still revalidates and every invalidation still refetches.

### One definition of expiry (`cb12cc3f`)

"Has this target expired?" had two answers. The Asset Page and Workspace
asked `targetFreshness`, which reads `price_target_outcomes`; the Dashboard
lens derived its own from `created_at` plus the `timeframe` text as
30.44-day months.

Measured against production over all 33 targets: 32 of 33 stored horizons
are `target_set_date + N calendar months`; `target_set_date` differs from
`created_at` on 5 rows by up to 502 days; 18 of 26 `pending` rows had a
stored horizon different from the derived one.

**The authoritative lifecycle**, read off the live `create_outcome_for_target`
rather than inferred:

- A **rolling** target gets no outcome row at all — the trigger deletes it —
  and never expires.
- A **fixed** target's horizon is anchored on `created_at` at INSERT and
  **restarts from `NOW()` on UPDATE**, with `status` reset to `pending` and
  the evaluation cleared. An analyst renewing a view genuinely gets a fresh
  horizon.
- The database writes the resulting horizon into `target_date` every time.
  **It is a stored fact, not something to recompute** — which makes the
  created_at-versus-updated_at question moot.

So: expiry is `targetFreshness` for all three surfaces; the `OVERDUE_MONTHS`
grace stays in the lens as editorial policy about when to interrupt someone.
"Expired" and "expiration requiring attention" are now two predicates.

A second defect inside the shared rule: `pending` was read as "still
standing". It means "nothing has evaluated this yet", and nothing moves the
column when the horizon passes — five production rows were `pending` with a
horizon already past, the earliest 2026-04-12. The horizon now decides, and
only `pending` is reconsidered: a terminal verdict is one somebody reached.

---

## Deployment state

| Component | State |
|---|---|
| Frontend | Deploys from `main` via Netlify on merge |
| `ai-chat` Edge Function | **Production on version 29, deployed 2026-11-11T03:01Z** |
| Other Edge Functions | Unchanged by this release |
| Database migrations | **None applied by this release** |

`ci.yml` contains no `db push`, no `supabase db` and no migration step, so
merging to main provably deploys no schema change.

### ai-chat must be deployed, and why it is a coupling

Production's `ai-chat` predates five commits in this release, including
`b8259b88` — the attached-portfolio lookup that selected a column which does
not exist. That is the exact defect behind "attach Large Cap Growth and ask
what are my active ideas for this portfolio". Until `ai-chat` is deployed
from the merged commit, that smoke test fails in production.

The client and the function are also coupled by the presentation contract
added in `12581f14`, which a `prompt-drift` test guards *within* a commit.
The new client against the old function is an untested pairing. The frontend
and `ai-chat` should therefore be released together.

`ai-chat` was not on the deploy allowlist, which meant the only way to ship
it was from a laptop — the ungated path the workflow exists to replace.
`637f1b7f` adds it to both the `choice` options and the runtime `ALLOWLIST`.
Nothing else moved: the `production` environment's required-reviewer rule
(confirmed armed), the merged-commit ancestry check against a freshly
fetched `origin/main`, the 40-hex SHA check and the prod-ref confirmation
are all untouched.

**To deploy:** run the `deploy-edge-function` workflow with
`function: ai-chat`, `sha:` the merge commit, `confirm_prod_ref:
wfcebeagznzgeuyysbnt`, and approve the `production` environment gate.
**Rollback:** re-run the same workflow with the previous merged SHA.

---

## Migrations deliberately NOT applied

Both are authored, reviewed and left unapplied. Neither blocks the frontend.

### `20261113120000_ai_artifacts.sql`

Creates the artifact table the ACT AI save form writes to. **Unapplied, and
the feature is invisible rather than broken**: `useAiArtifacts` probes the
table and the menu row that opens the form is *absent* — not disabled —
until the probe succeeds. The finished form does not turn the feature on.

Held because its authorization suite
(`supabase/tests/ai-artifacts-authorization.sql`) has never been executed
against an environment containing the schema, and no such environment is
available — see the blocker below.

### `20261114120000_ai_conversation_folder_org_boundary.sql`

A tightening, not a breach. `ai_conversations_folder_own` (verified present
in production, `SECURITY DEFINER`, without the org check) ensures a
conversation's folder belongs to the conversation's owner, but not that the
owner is still a member of the organisation the folder is scoped to. Nobody
else's data is reachable either way: the folder and the conversation are both
the reader's, and `ai_conversations` has no organisation column by design.

Its own header requires validation in an authorized environment plus
separate approval before production.

### The blocker: there is no validation environment

The Supabase project has only its default branch — the plan provides no
preview branches — so there is nowhere to apply a migration and run the
authorization suite against real authenticated role contexts. Per the
release brief's own instruction, both migrations stay unapplied and this is
recorded as the blocker rather than worked around.

**Two cautions for whoever picks this up.** The Supabase MCP `execute_sql`
tool is a **read-write** connection to production with no confirmation
prompt for DDL — a bare `create table` succeeds. `read_only: true` exists
only on the raw Management API endpoint, and the MCP tool does not send it.
Second, the applied-migration ledger does not use the repo's filename
versions, and `ai_project_folders` is applied in production without
appearing under its filename version — so query the live schema, never the
ledger or the migration files.

---

## Gates

Run locally against the release head:

```
guard:ci              PASS
guard:gallery         PASS
guard:holdings        PASS
guard:unit            PASS   697 test files executed
guard:tdz             PASS
guard:types           PASS   4065 source files, 8579 = ceiling, card-surface 0
guard:social-preview  PASS
guard:favicon         PASS
guard:layout          PASS   485 phone tests
guard:copy            PASS   2441 files, 334 em dashes = ceiling
sec:edge-authz        PASS   13 functions, 0 errors, 1 warning
```

`guard:layout` deserves a note: it could not run at all in the previous
session because the shared `node_modules` was missing `.bin` and
`@alloc/quick-lru`. Repairing the dependency tree with `npm install` fixed
it, and it now passes rather than being reported as blocked. Running it
regenerates 24 tracked card baseline PNGs with sub-0.2% byte deltas
(rendering nondeterminism); those were discarded rather than committed,
since this release intends no visual change.

Required GitHub checks on main are Unit tests, Card layout, Type check
(cards), Invite entry and static — all five green. `db (live role-context
verification)` fails and is **not** a required check: staging runs on a free
plan with an account-wide Supabase PAT, a known and separately tracked
blocker.

---

## Known limitations, carried forward

**Legacy Asset Tab state keys.** `AssetTab` calls
`TabStateManager.loadTabState(asset.id)` and `saveTabState(asset.id, …)` with
no user or org — 13 reads and 3 writes — so both land on the unscoped
`tesseract_tab_states`, while `DashboardPage` uses
`tesseract_tabs_<user>_<org>`. Assessed rather than assumed:

- **No cross-organisation data exposure.** The blob holds UI position (active
  sub-page, consumed-intent flags) keyed by asset UUID.
- **Cross-user retention is possible** in a shared browser tab: the legacy
  blob carries no user id, and the guard that deletes a legacy blob
  belonging to a different user only runs on the *scoped* read path.
- **Cleanup is incomplete.** Tab close removes state from the scoped blob, so
  `AssetTab`'s entries accumulate in the legacy one for the session.
- **State is lost intermittently.** When `loadMainTabState(user, org)` runs
  while the scoped key is absent, it migrates the legacy blob and deletes the
  legacy key — taking `AssetTab`'s sub-page state with it. That is the same
  sub-page continuity this release was accepted for.

Deferred deliberately. The smallest correct fix threads user and org through
16 call sites in a 4,000-line component, and 6 source-text tests pin the
current call arity exactly (`asset-snapshot-landing`,
`work-selection-integrity` ×5, plus `theme-audience-wiring` for the same
pattern in `ThemeTab`). That is a change to make and review on its own, not
to bundle into a release commit.

**Timezone drift in a fallback.** `targetFreshness`'s `toIsoDate` formats
with local date parts, so the *derived fallback* horizon shifts a day by
timezone. The stored-outcome path, which is what live rows use, is
unaffected.

**Other items** tracked outside this release: duplicate portfolio-membership
tables (a UI-added collaborator is invisible to half the app); an
unrotated Alpha Vantage key in the browser bundle; `auto_create_workflow_branch()`
schema drift with an undeployed fix; checklist attachment orphans in storage.

---

## Repository state

See the final cleanup report for the worktree inventory. In summary: 66
worktrees registered, of which 32 sit on branches fully merged into
`origin/main`; 27 of those are clean with no commits ahead. 227 local
branches, 113 fully merged. The only dev server running is on port 5190 from
`C:\dev\tesseract-asset-page`.

The primary worktree `C:\dev\Tesseract_v2` is on
`reconcile/post-226-outstanding` rather than `main`, and is not to be
removed.
