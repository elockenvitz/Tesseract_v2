# Release 2026-11-26: full repository reconciliation

Thirty-seven open pull requests, none of them merged, against a production
deployment that was exactly equal to `origin/main`. This is the inventory, the
dependency graph, and what was done about it.

## 1. State established before anything was touched

Every line here is a measurement, not a reading of an earlier report.

| Fact | Value | How it was established |
| --- | --- | --- |
| `origin/main` | `a18f5d4962a94d51db3ff75c087251baf4aacb97` | `git rev-parse` |
| Live production bundle | `a18f5d4962a94d51db3ff75c087251baf4aacb97` | the full commit SHA is embedded in the entry chunk; fetched and grepped |
| Production vs main | identical | the two SHAs above |
| Open PRs | 37 | `gh pr list` |
| PRs merged into main | 0 | no open PR head is an ancestor of `origin/main` |
| Does main auto-deploy? | **yes** | `scripts/netlify-should-build.mjs` exits non-zero (BUILD) for `main` unconditionally |
| Branch protection | `enforce_admins: true`, 5 required checks, 0 required reviews, `strict: false` | `gh api .../branches/main/protection` |
| Required checks | Unit tests, Card layout, Type check (cards), Invite entry, static | same |

`strict: false` matters: GitHub will merge a PR whose required checks passed
against an older base. Several of these PRs carry green checks from runs that
predate a gate expiry described in section 5.

## 2. Pull request inventory

Target branch is `main` for every PR except where noted. No PR had been merged,
so "production status" is `not deployed` for all 37 and the column is omitted.

### The release candidate tips

These are the only PRs whose patches were replayed. Everything else reaches
`main` as an ancestor of one of them.

| PR | Branch | Head | Purpose | Contains | Recommendation |
| --- | --- | --- | --- | --- | --- |
| #338 | `release/charting-2026-11-19` | `ea0cb201` | Charting release candidate | #317, #318, #320–#324, #326–#331, #333–#337 (18) | A — merge |
| #344 | `release/decision-integrity-2026-11-20` | `fb7bdf50` | Decision-integrity release candidate | #340, #341, #342, #343 | A — merge |
| #352 | `legal/landing-page-footer` | `1ed6c043` | Landing page, legal links, access-request box | #349, #350, #351 | A — merge |
| #332 | `perf/gallery-viewport-window` | `f989527d` | Gallery fetches the field you reached | #325 | A — merge |
| #339 | `fix/recommendation-stage-eligibility` | `ceef52c2` | A new pilot org could not recommend anything it owned | — | A — merge |
| #345 | `fix/outcomes-stage-and-duplicates` | `2fe1afa5` | Outcomes reported a deferral as a rejection | — | A — merge |
| #346 | `cleanup/retire-alpha-vantage-news` | `d42a994c` | Retire Alpha Vantage from news | — | A — merge |
| #348 | `feat/asset-identity-and-search` | `7d8ba2e4` | Asset header states the instrument and its price source | — | A — merge |
| #247 | `fix/pilot-progress-atomic-merge` | `ef268b82` | Getting Started progress marks merge server-side | — | A — merge, dependency verified present in production |
| #292 | `docs/act-ai-2-4-handoff` | `7455070c` | ACT AI 2.4 handoff, consolidation notes | — | A — merge, docs only |
| #315 | `docs/chart-annotation-persistence-plan` | `f86224b9` | Chart annotation persistence plan | — | A — merge, docs only |

### Contained PRs

Merged as ancestors, not replayed. Each is superseded by its tip and should be
closed against it rather than merged separately.

| Tip | Superseded PRs |
| --- | --- |
| #338 | #317, #318, #320, #321, #322, #323, #324, #326, #327, #328, #329, #330, #331, #333, #334, #335, #336, #337 |
| #344 | #340, #341, #342, #343 |
| #352 | #349, #350, #351 |
| #332 | #325 |

#337's head SHA is identical to #338's. #324 is itself a release-candidate PR
("six completed PRs as one production build") that #338 subsumes.

Containment was proven per PR with `git merge-base --is-ancestor <head>
<candidate>`, not inferred from titles or from the PR description. All 37 heads
are ancestors of the candidate.

## 3. Worktrees

| Path | Branch | Head | Uncommitted | Disposition |
| --- | --- | --- | --- | --- |
| `C:/dev/Tesseract_v2` | `docs/commercial-launch-package` | `99fc53be` | clean | **primary — never remove, holds the shared `node_modules`** |
| `C:/dev/tesseract-asset-page` | `feat/memory-spine-convergence` | `4ec20839` | 1 untracked: `docs/followup-recommendation-withdrawn.md` | **protected — do not remove, do not switch its branch** |
| `C:/dev/_wt-prod-db-safeguards` | `feat/recommendation-withdrawn` | `e9a4b2f0` | clean | keep; branch has no PR |
| `C:/dev/_wt-rec-submit` | `perf/dashboard-request-coalescing` | `fc1b2797` | clean | keep until #318 closes |
| `C:/dev/tesseract-landing-legal` | `legal/landing-page-footer` | `1ed6c043` | clean | keep until #352 closes |
| `C:/dev/tesseract-landing-review` | `feat/public-landing-page` | `0b15d982` | 1 untracked: `vite.review.config.ts` | keep until #349 closes |
| `C:/dev/tesseract-legal` | `legal/readiness-package` | `f61e285f` | clean | keep until #351 closes |
| `C:/dev/_wt-release-20261126` | `release/consolidated-2026-11-26` | this release | the integration worktree | remove after merge |

Nothing was discarded. No `reset --hard`, no `clean -fd`, no force-push, and no
recursive delete through a `node_modules` junction.

### Remote branches are not an inventory of unmerged work

About 125 remote branches are "ahead of `origin/main`" by at least one commit.
That number means nothing here, because **this repository squash-merges**: a
squashed branch's own commits never become ancestors of `main`, so every branch
ever merged still reports as ahead, forever. Deciding whether any of those
branches holds unique work needs a per-branch patch comparison, which this
release did not do. **No branch was deleted.**

## 4. The one merge conflict

Twenty-three merges produced exactly one conflict: `MAX_REPO_ERRORS` in
`scripts/typecheck-cards.mjs`. #338 ratcheted the ceiling 8568 → 8563 and #344
ratcheted 8568 → 8562, independently, each measured against a tree the other
had not touched.

Both numbers are ceilings, so neither describes the combination. Resolved by
measuring the merged tree: **8567**, which is below main's own committed ceiling
of 8568, so the release still tightens the gate. Against main's *actual* count
of 8562 the release is net **+5**, itemized by file in the source comment and
carried as a follow-up.

## 5. The `static` required check was failing for a reason that was not a finding

`static` was red on #349 with `UNVERIFIED — not a pass`: 14 known findings, 0
new, but the committed policy capture was 9.1 days old against a 7-day limit.
The guard reads a committed file and never connects to the database, so it
refused to claim a pass rather than passing vacuously. That is the gate working.

Recaptured read-only against production with the real script
(`node scripts/audit/schema-baseline.mjs --ci-minimal`, verified
`transaction_read_only = on` as `supabase_read_only_user` first). **The only
line that changed is `captured_at`** — 296 tables, 955 policies, byte-identical
otherwise, which is itself the useful result: production's policy posture has
not moved since 2026-11-16. `security:check --static` then passes with 14 known
findings and 0 new.

### A trap found while doing it

The guard prefers `docs/audit/baselines/production-security-inventory.json` over
the CI capture when that file is present. It is gitignored, so it exists only on
a developer machine, and the copy in the primary worktree is `schema_version: 2`
from **2026-08-29**. Against that stale snapshot the same guard reports **FAIL
with 103 findings** not in `KNOWN_UNRESOLVED`. CI and any fresh worktree see
only the CI capture and report 14. So the gate's verdict depends on an untracked
local file, and the local answer is the alarming one. Not fixed here; recorded
as a follow-up.

## 6. Schema dependencies, checked against production rather than assumed

Three PRs carry migrations. Merging to `main` deploys the application but
**does not apply a migration**, so each had to be checked for whether the
application breaks in the window before its migration lands.

| Migration | From | Status in production | Consequence of merging without applying |
| --- | --- | --- | --- |
| `20261005210000_mark_pilot_progress_atomic.sql` | #247 | **already applied** — `mark_pilot_progress(p_key text, p_value text)` exists, returns `jsonb`, `SECURITY DEFINER` with `search_path=public`, EXECUTE to `authenticated` and **not** `anon` | none; the RPC the new hook calls is present with the expected signature, return type and grants |
| `20261120010000_pilot_seed_freezes_reasoning.sql` | #344 | not applied; `ensure_pilot_decision_request_for_user(p_user_id uuid)` exists in its older form | none; the fix is dormant until applied. The seeded pilot request keeps an unfrozen `proposal_version_id` until then |
| `20261125120000_terms_acceptances.sql` | #352 | not applied | the acceptance table does not exist. Legal publication stays behind its gate, which is the designed state |

Edge functions were checked the same way. #338 calls `op: 'splits'` on
`eodhd-market-data`; the **deployed version 5 already contains `case 'splits'`
and `fetchSplits`**, so that dependency is satisfied. #346 removes `sentiment`
and `relevanceScore` from the client's `NewsItem`; the deployed `market-news`
version 18 still returns them and the client now ignores them, which is
additive-safe in the frontend-first direction. #346 does not change the request
payload; what it removes is `fetchFromAlphaVantage` and
`fetchNewsFromAlphaVantage` from the **browser** client, which also removes a
provider-key exposure path from the bundle.

**No migration was applied and no function was deployed as part of this
release.** Every one of the three remains outstanding and needs explicit
human approval for the statement.

## 7. Deployment and rollback

Merging to `main` triggers a Netlify production build automatically. A batch of
merges in quick succession deploys **one** of them, because concurrent builds
cancel each other, so the only honest confirmation is to read the 40-character
commit SHA embedded in the deployed entry chunk and compare it to the merge
commit.

Rollback is a single `git revert -m 1` of the release merge commit, which
restores `a18f5d49` behaviour and triggers a fresh build. Nothing in this
release changes a database object, a function, a secret or a Netlify setting, so
there is no state to unwind alongside the revert.

## 8. What this release does not do

- does not apply any migration
- does not deploy any Edge Function
- does not change Supabase configuration or any secret
- does not mutate production data
- does not activate a legal agreement; the publication gate stays closed
- does not expand Charting beyond the stack already reviewed in #338
- does not delete a branch or a worktree other than the integration worktree
