# Dashboard Convergence — preserved-work ledger

Recorded at the creation of `release/dashboard-convergence`.

The release integrates exactly two accepted sources of truth:

| Lane | Branch | SHA |
| --- | --- | --- |
| Mobile | `feat/mobile-dashboard-frontend` | `d588eb4` |
| Desktop | `feat/desktop-dashboard-4d` | `0e05628` |

Base: `origin/main` at `6cb7862`.

Everything below is real work that is **deliberately outside** this release. It is
recorded here so that it survives any later branch cleanup. A branch being absent
from the release is not evidence that its work was abandoned — check this file
before deleting anything.

## Parked — revisit after the release

| Work | Branch | SHA | Why it is parked |
| --- | --- | --- | --- |
| Adaptive / reactive tiles | `feat/adaptive-tile-foundations` | `c47d363` | V0 foundations; `src/lib/tiles/*` is imported by neither release head. Needs reconciling with the shipped `src/lib/signals/tile-geometry.ts`. |
| Engagement affordance cleanup | `feat/engagement-seam-4c` | `90d30c4` | A DRY refactor (`affordances.ts` + seam test) over call sites the Desktop lane rewrote. The engagement seam itself already ships via trunk. Post-release by intent. |

## Hand-port later — not mergeable as-is

| Work | Branch | SHA | Note |
| --- | --- | --- | --- |
| Decision memory / durable disposition | `audit/decision-memory` | `64d530b` | Stale ancestry, and carries a `.sql.draft` migration that must be re-authored rather than merged. |
| Readthrough intelligence | `feat/readthrough-intelligence` | `0efa3bf` | Explicit work-in-progress commit. |
| Post-226 activation milestones | `reconcile/post-226-outstanding` | `398d248` | Onboarding, not Dashboard. Port together with coverage self-service below. |
| Coverage self-service | `feat/onboarding-coverage` | `4f5d825` | Overlaps the activation milestones; port as one unit. |

## Security reconciliation — a separate workstream

Explicitly **not** part of this release. These branches touch `supabase/` and the
auth path directly; neither release lane modifies any of their files, and neither
lane touches `supabase/` at all, so the release cannot regress them.

| Work | Branch | SHA | State |
| --- | --- | --- | --- |
| Signup / invite authority | `fix/signup-invite-security` | `674e3ea` | Genuinely unmerged. `src/lib/invites.ts`, `ProtectedRoute.tsx`, `useAuth.ts`, `InvitePage.tsx` and `early-access-invite-security.sql` are absent from main. |
| Quick Thoughts tenant isolation | `fix/quick-thoughts-tenant-isolation` | `fc8f247` | Partially in main. Components landed; `useSignalCards.ts`, `known-unscoped-queries.json` and `OpsClientDetailPage.tsx` did not. |
| P0 tenant boundary | `fix/security-p0-tenant-boundary` | `e1b3eff` | The fix itself **is** in main (three `20260826*` RLS migrations and the `tenant-boundary-p0*` tests). Only residual tooling remains outstanding: `p0-application-smoke.sql`, `schema-baseline.mjs`. |

## Superseded — do not resurrect

| Work | Branch | SHA | Superseded by |
| --- | --- | --- | --- |
| Personal Defer scoping | `feat/pipeline-convergence` | `2b58b5d` | Desktop `57efd94`, which deletes the localStorage `src/lib/attention-feed/snooze.ts` in favour of durable `src/lib/attention-state/`. Do not cherry-pick Pipeline, and do not restore `snooze.ts`. |

## DO NOT USE

**`feat/desktop-convergence` `0dfce85`** — contaminated by a wrong-worktree Stage 4B.

Its only content beyond the clean `feat/engagement-seam-4c` `90d30c4` is that
Stage 4B: `src/lib/signals/card-height.ts` and `src/lib/mobile/feed-entry-tier.ts`.
Both are obsolete — the Mobile lane deleted `card-height.ts` in `8c6c7b7` when it
consolidated on `tile-geometry.ts`. Nothing of value is stranded on this branch.
Never integrate it.

## Known inherited defects carried into the release

Neither was introduced by integration; both are present on the accepted source of
truth and are recorded so they are not mistaken for merge damage.

| Defect | Origin | Detail |
| --- | --- | --- |
| `guard:holdings` fails | Desktop `0e05628` (fails identically on its own) | 10 aggregating `portfolio_holdings` queries with no date constraint, in `useAssetWorkspace`, `useDesktopDecisions`, `useDesktopIdeas`, `useDesktopResearch`, `useTodayEnrichment`. Summing dated snapshots without a date multiplies totals. |
| `org-scope-guard` fails | Desktop `0e05628` (fails identically on its own) | 21 new unscoped queries against org-scoped tables; the `known-unscoped-queries.json` baseline was never updated. |
| `case-state.test.ts` fails | Mobile `d588eb4` (fails identically on its own) | `framingWantsPrice('no_case')` now returns `true` because No-Core-Thesis tiles were deliberately given price charts. The test still encodes the older "structural finding, no chart" intent. Outside `guard:unit`'s gated paths, which is why the Mobile baseline reads green. |
