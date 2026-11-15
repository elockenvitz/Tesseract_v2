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

Released 2026-11-15. `main` is **`35bb8ae9`**, the merge commit for PR #291.
Its tree is byte-identical to the reviewed head `f4659eb2`, and the previous
`main` was already an ancestor of the branch, so no main-side work could have
been displaced.

| Component | State |
|---|---|
| `main` | **`35bb8ae9`**, tree byte-identical to `f4659eb2` |
| Frontend | **Deployed and verified**: bundle `index-BuByH0wO.js` |
| `ai-chat` Edge Function | **Production on version 30**, deployed 2026-11-15T02:19Z |
| Other Edge Functions | Unchanged by this release |
| Database migrations | **None applied by this release** |

**How the frontend was verified.** Netlify posts no commit status for
production, so the bundle itself is the evidence. `index-BuByH0wO.js` contains
two strings that exist nowhere but this release's commits:
`data-slot="tab-scrollport"` (`Layout.tsx`, added by `aeec0df2`) and
`price_target_id, status, target_date` (`usePortfolioLenses.ts`, added by
`cb12cc3f`). Comparing against the previous bundle is *not* available as a
method: once superseded, the old `/assets/index-*.js` URL returns Netlify's
SPA fallback rather than the old JavaScript, so a count of 0 against it proves
nothing. Positive presence of commit-specific strings needs no baseline.

**How the function was verified.** All eight deployed files — `ai-chat/index.ts`
and the seven `_shared` modules — hash byte-identical to `35bb8ae9`. The
recorded `entrypoint_path` is `/home/runner/work/Tesseract_v2/...`, a GitHub
Actions runner path, which is itself proof the build came through the gated
workflow rather than a laptop. Run `43666330245` succeeded with every control
step green, including "Fail closed unless the production environment has
required reviewers" and the ancestry check against a freshly fetched
`origin/main`.

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

A tightening, not a breach. The live guard is the trigger
`ai_conversations_folder_own`, whose function is
`public.ai_conversation_folder_must_be_own()` — `SECURITY DEFINER`, and read
from production rather than inferred. It tests
`f.user_id = NEW.user_id` and nothing else, so it ensures a conversation's
folder belongs to the conversation's owner but not that the owner is still a
member of the organisation the folder is scoped to. Nobody else's data is
reachable either way: the folder and the conversation are both the reader's,
and `ai_conversations` has no organisation column by design. The migration adds
`AND public.is_member_of_org(f.organization_id)` — a definer helper, because a
plain subquery against the membership table would run under the caller's RLS.

**Confirmed still unapplied at release, against the live schema:**
`to_regclass('public.ai_artifacts')` is NULL, and the deployed trigger function
body carries no organisation clause.

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
(cards), Invite entry and static — **all five green in CI on `f4659eb2`**,
confirmed before merge, not merely locally. `Tenant policy guard` also passed.
`db (live role-context verification)` fails and is **not** a required check:
staging runs on a free plan with an account-wide Supabase PAT, a known and
separately tracked blocker.

That blocker is also what keeps the two migrations unapplied and the runtime
authorization tests unexecuted. It is now the single largest gap in this
release's evidence, and it is one purchase decision rather than an engineering
problem.

---

## Smoke tests: what was actually verified, and what was not

Split honestly by method. Everything below marked *server-side* was executed
against production; everything marked *not executed* was not, and nothing here
should be read as a browser verification.

| Check | Method | Outcome |
|---|---|---|
| Deployed function matches the release | server-side | **PASS** — 8/8 files byte-identical to `35bb8ae9` |
| Deploy came through the gate | server-side | **PASS** — runner entrypoint path, all control steps green |
| Frontend serves the release | server-side | **PASS** — two commit-specific markers in the live bundle |
| Holdings query works on live schema | server-side | **PASS** — 5 rows, $103,964.50; `weight` confirmed absent |
| Portfolio-scoped idea pipeline | server-side | **PASS** — 7 items, exactly 1 active (AAPL buy) |
| Unauthorized request rejected | server-side | **PASS** — 401 on no header, publishable key, forged JWT |
| Authorization ordering | static, on deployed bytes | **PASS** — gate returns before any `service_role` client |
| Registered authorization test | unit, on release head | **PASS** — 15/15 |
| Migrations still unapplied | server-side | **PASS** — `ai_artifacts` absent, trigger lacks org clause |
| Authenticated conversation + streaming | **not executed** | needs a signed-in session |
| Existing conversation continuity | **not executed** | 11 conversations exist to test against |
| Source / reference navigation | **not executed** | client-side |
| Slash Commands | **not executed** | client-side |
| AI usage metering | **not executed** | `ai_usage_log` last wrote 2026-11-14 01:51, nothing since deploy |
| Organisation / object permissions, end to end | **not executed** | needs two signed-in users |

**Why the authenticated half was not executed.** Every one of those requires a
real user session. Obtaining one means entering a password, which is not
something to do on the user's behalf, and `ai-chat` runs `verify_jwt: true`
behind a verified `getUser(token)`, so there is no service-role shortcut that
would exercise the same path a reader does. These are browser checks for the
founder, listed in the handoff.

**One result that is weaker than it looks.** The rejection test with the
publishable key returns `{"error":"Unauthorized"}` with no `code` field, and
`Unauthorized` appears zero times in the deployed `index.ts`. That 401 is the
Supabase gateway refusing a non-JWT publishable key — it does **not** prove the
function's own `authorizeVerifiedUser` gate ran. The gate's presence and its
ordering ahead of the `service_role` client are verified statically on the
deployed bytes and by the registered unit test; they are not verified at
runtime in production, and the free-plan blocker below is why.

**Metering is unproven for a different reason.** `ai_usage_log` has 29 rows and
its most recent write is from before this deploy. Metering cannot be confirmed
until someone holds a real conversation; a zero-row interval is not evidence
either way.

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

Inventoried and acted on 2026-11-15, in three passes. The ACT AI pass retired
one worktree; a repository-wide pass followed; a final pass reduced the tree to
the two environments that have an active purpose. Full record:
`C:\Users\elock\tesseract-repo-baseline-20261115\` — `BASELINE.md`,
`inventory.json`, `cleanup-ledger.json`, `branch-cleanup-applied.json`,
`reparse-scan.json`, `unmerged-work.json`, then `phase2-20261115\` and
`final-20261115\` for the later passes.

| | Before | Pass 1 | Pass 2 | Final |
|---|---|---|---|---|
| Worktrees | 64 | 38 | 9 | **2** |
| Local branches | 226 | 120 | 120 | **117** |
| Remote branches | 189 | 189 | 189 | 189, untouched |
| Stashes | 1 | 1 | 1 | 1, untouched |

The two survivors are the only two that have a job: `C:\dev\Tesseract_v2`
(primary, host of the shared `node_modules`) and `C:\dev\tesseract-asset-page`
(active development, owner of the port-5190 dev server). `C:\dev` holds
nothing else.

Phase 2 (same day) retired a further 29 worktrees on a different principle:
**a branch carrying unique commits does not need a working directory to
preserve its history.** The 29 retired branches still exist at their original
SHAs and carry 109 unique commits between them, additionally captured in a
prerequisite-free 144 MB bundle verified by cloning from it. Branch count was
deliberately left alone — branches are cheap, working directories are what
cost.

The final pass retired the last 7. Those were held back earlier only because
`git worktree remove` refuses a dirty worktree and `--force` was prohibited —
tested, not assumed. The way past that is not force but **reconciliation**:
every changed and untracked path was classified, archived, and hash-verified
against its original, and only then removed by its own exact path. 82 files,
7.68 MB, every copy byte-identical to the original. Nothing was reset, no
`git clean` ran, and no directory was deleted recursively; tracked generated
files went back with a path-scoped `git restore`, untracked files were deleted
one named file at a time, and a directory was removed only after it was
observed empty.

What those 82 files actually were: **71 Playwright screenshots** written by
`e2e/signal-cards.spec.ts`, `responsive.spec.ts` and `case-vs-price.spec.ts`,
which no test ever reads back — grep finds only `screenshot({ path: ... })`
writes, never a snapshot comparison — so they are test output, not baselines;
**8 `layout-debug/geometry-*.json`** measurement files, which are real
evidence and are archived as data; **3 machine caches**
(`tsconfig.app.tsbuildinfo`, two `supabase/.temp/cli-latest` holding nothing
but a CLI version string). The screenshots were archived anyway, into a
`regenerated-output/` folder labelled disposable, because they proved **not**
byte-reproducible: the same scenario renders differently in two worktrees and
differs from its committed version, so "just re-run the suite" would not give
the same bytes back.

The 4 files that were genuine work were already preserved in pass 2 and were
re-verified here: `dev-pricing.cmd` (a port-allocation registry — local
tooling, untracked on purpose, present in no branch), `scratch-pull.json` (a
401/`42501` permission probe against `assets`; it records an env key *name*
and no value), `scratchpad/commit-msg.txt` (8,150 bytes of commit prose for
the shared price chart), and an older `CLAUDE.md`. That last one turned out to
be a **strict subset** of the current instructions — it is missing the Claude
for Chrome section and Standing Rules 5 and 6, and adds nothing — so it was
archived as a historical record and deliberately not merged into the live
`CLAUDE.md`.

No `.env.local` and no `.mcp.json` was copied anywhere; `.mcp.json` carries a
Supabase Management API token. Their presence was recorded by filename and
size only, and their contents were never read.

**Removed: 26 worktrees and 107 local branches**, none forced. The first was
`feat/ai-system-v2`; the other 25 were the repository-wide Category A set.
Every removal was revalidated at the moment of removal rather than trusted
from the inventory: clean working tree, 0 commits ahead of `origin/main`,
ancestor of `origin/main`, no open PR, no owning process, unlocked, and
junction-safe.

**No unique work was lost, and that is proven rather than asserted.** All 106
deleted branch HEADs and all 25 removed worktree tips are still reachable from
`origin/main` and still present as objects. All 113 branches carrying unique
commits survive; all 7 worktrees with uncommitted changes survive.

`git branch -d` refused exactly one branch, `ci/prove-deploy-gate`
(`a6acb674`), and that refusal was accepted rather than escalated to `-D`. Its
tree is byte-identical to its merge base — a deliberate-guard-break commit and
its revert, from proving a deploy gate — so it holds no unique content, but it
is not an ancestor of main and git was right to refuse.

**The junction hazard, and the order that avoids it.** Every worktree's
`node_modules` is a Windows **junction** to the shared
`C:\dev\Tesseract_v2\node_modules`. A recursive delete that follows the
junction would destroy the dependency tree all 60+ worktrees depend on. So the
junction link was deleted first, by itself, via `DirectoryInfo.Delete()` — not
`Remove-Item -Recurse` — and the shared tree was counted before and after:
**576 entries both times**. Only then was the worktree removed. Anyone
retiring further worktrees must do it in that order.

**Two that pass the mechanical test and must never be removed on it.**

- `reconcile/post-226-outstanding` at **`C:\dev\Tesseract_v2`** is the
  **primary worktree** and the host of the shared `node_modules`. It reads as
  "merged, clean, 0 ahead", which is exactly why a script that trusts those
  three fields would delete it and break every other worktree.
- `discovery/asset-page-2` at `C:\dev\tesseract-asset-page` is the release
  worktree and the active session's own checkout.

**The branch inventory is the history, and it is classified rather than
pruned.** Of the 117 that remain: 1 protected (`main`), 2 active, 2 on open
PRs (#247 `fix/pilot-progress-atomic-merge`, and #292 carrying this document),
1 fully merged into main but refused deletion (`qa/mobile-integration`), 1
content-equivalent to main (`ci/prove-deploy-gate`), 10 fully contained inside
another live branch, and
**100 carrying unique work** — the largest `fix/lists-canonical-connections`
(37 commits, +14,502 lines), then `perf/perceived-performance-pass` (16, the
KeepAlive and real-browser bench prior art), `fix/holdings-dates-attention`
(15), `reconcile/desktop-ideas-on-main` and `explore/card-system` (13 each).
Per-branch detail: `final-20261115\branch-inventory.json`.

The final pass deleted 4 more branches, each a **strict ancestor of
`origin/main`** with zero unique commits, with a plain `git branch -d`. Two
refusals were accepted rather than escalated to `-D`:
`ci/prove-deploy-gate` (not an ancestor of main, though its tree is
byte-identical to its merge base) and `qa/mobile-integration` (git objected
that its tip is not yet in `origin/qa/mobile-integration`, even though it is
in main). The 10 contained branches would also need `-D`; they are documented
as redundant and **recommended** for deletion, not deleted. A manageable
inventory was the goal, not a low number.

The single stash (`hotfix-typecheck-baseline-42294` on
`hotfix/accepted-trade-lifecycle`) was inventoried but not applied, popped,
dropped or rewritten — the stash stack is shared with every worktree and
another session may own it.

**Health after cleanup**: primary worktree clean and on its original branch and
HEAD (`6686797c`); `origin/main` still `35bb8ae9`; 0 prunable worktree
registrations; shared `node_modules` 576 entries, unchanged and never
reinstalled; the one remaining junction resolves; the port-5190 dev server was
never interrupted; `git fsck` reports no non-dangling problem; vite, vitest and
tsc all resolve; `guard:ci` PASS.

**Nothing was lost, and that is checked rather than claimed.** Across all
three passes every deleted branch tip is still present as an object and still
reachable from `origin/main`; every retired worktree's branch still exists at
the SHA it had before removal; and every one of those tips is independently
recoverable from a prerequisite-free `git bundle` that was verified by cloning
from it and diffing all 120 ref SHAs, not merely by listing its heads. No
`--force`, no `-D`, no `reset`, no `clean`, no recursive delete, and no remote
branch was touched at any point.
