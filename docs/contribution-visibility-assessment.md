# P0 — `asset_contributions` SELECT visibility

Read-only assessment. No production SQL applied, no production research
modified. Prepared correction in `scripts/sql/contribution-visibility/`,
deliberately outside `supabase/migrations/` so a deploy cannot pick it up.

Isolated from the `content_updated_at` freshness lane — the two share no
object and neither needs the other.

**Caveat on every claim below:** migrations do not describe production in this
repo, and I have no database tool in this session. Everything here is read from
version control and application code. `00-verify-readonly.sql` Q1 is what
proves production's policies are the ones analysed.

---

## Findings, worst first

### V1 — restricted thesis prose is readable org-wide through `asset_contribution_history`. Unconditional.

`scripts/sql/security-c1/07-asset-contribution-history.sql:32-36`:

```sql
CREATE POLICY asset_contribution_history_select ON public.asset_contribution_history
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.asset_contributions c
                  WHERE c.id = asset_contribution_history.contribution_id
                    AND c.organization_id = public.current_org_id()));
```

It checks the parent contribution's **organization** and never its
**visibility**. `new_content` holds the full section prose. So every active
member of an organization can read the complete text — and edit history — of
every contribution in it, including ones narrowed to a single team.

No precondition. A correctly-restricted, single-target contribution is exposed.
The app reads this table directly at `ThesisHistoryView.tsx:838` and
`useContributions.ts:601,643`, so the exposure is reachable in the product, not
just via the API.

### V3 — same defect, second table: `asset_revision_events`. Unconditional.

`scripts/sql/security-c1/06-asset-revisions-events.sql:136-142` is
organization-scoped only. `before_value` / `after_value` carry the prose,
written on every publish (`useContributions.ts:429-435`). Same unconditional
org-wide exposure.

(The `organization_id IS NULL AND actor_user_id = auth.uid()` branch beside it
is correctly fail-closed and is *not* part of this defect.)

### V2 — `OR team_id IS NULL` is a grant, and the client produces that state routinely.

`scripts/sql/security-c1/08-asset-contributions.sql:70-81`:

```sql
USING (... AND organization_id = public.current_org_id()
       AND (created_by = auth.uid()
            OR visibility = 'firm'
            OR team_id IS NULL          -- ← grants to the whole org
            OR EXISTS (… contribution_visibility_targets …)))
```

`team_id` is a legacy single-target denormalisation. All three write paths set
it the same way — `useContributions.ts:193`, `:237`, `:528`:

```ts
team_id: targetIds.length === 1 ? targetIds[0] : null
```

So `team_id` is NULL whenever the target count is **not exactly one**. Two
reachable shapes:

- **Multiple targets.** The visibility picker is explicitly multi-select
  (`ContributionCard.tsx:276-311`, checkbox toggles into a `selectedTargetIds`
  array, Apply shows a count). Narrowing to two teams sets `team_id = NULL` and
  publishes org-wide. The `contribution_visibility_targets` rows that should
  have restricted it are written correctly and then never consulted, because
  the NULL branch short-circuits the `EXISTS`.
- **Zero targets** — see V4, which produces this on an ordinary edit.

### V4 — the edit path silently declassifies, and destroys the targeting data

`ContributionSection.tsx:655` declares `selectedTargetIds` as `useState<string[]>([])`.
It is cleared at `:822` and **never populated from the contribution's saved
`visibility_targets`** — the data is available on the row (it is read at
`:1263`), it is simply not loaded into the editor state. `handleSave` (`:915`)
then submits:

```ts
visibility: visibilityToUse,   // restored from the row at :906
targetIds: targetIdsToUse      // [] — never restored
```

`saveContribution` deletes all `contribution_visibility_targets` rows and
re-inserts only `if (targetIds.length > 0)` (`useContributions.ts:207-220`).

So: **open a team-restricted thesis, edit a word, save → the restriction is
gone and the targets are deleted.** Visibility still *reads* `team`, the badge
still *shows* a lock, and the row is now readable by the whole organization via
V2.

This is a client defect, not a policy one. **It is also why the fix removes
access from somebody:** for rows whose targets were destroyed this way, there
is no record of who they were shared with. `00-` Q6 lists them.

### V5 — the AI prompt inherits whatever these policies return

`supabase/functions/ai-chat/index.ts:938,1056` reads `asset_contributions`
through a client built with the **caller's** `Authorization` header
(`:163-165`), so RLS applies and this is **not an independent exposure**. But
it means restricted prose reaches an AI prompt for any user the policy leaks
it to. The comment at `:1049-1052` — "RLS already scopes them to the user's
org" — is accurate and insufficient: org scoping is not visibility scoping.
Fixing V1/V2/V3 fixes this with no change here.

---

## Intended access semantics

The current policy never stated these. The correction does.

| Visibility | Who may read | Mechanism |
|---|---|---|
| **owner** (`created_by = auth.uid()`) | always, at any visibility | direct |
| `firm` | every active member of the org | `visibility = 'firm'` |
| `portfolio` / `team` / `department` / `division` | members of the targeted node(s) | one `contribution_visibility_targets` row per target × `org_chart_node_members` |
| **multiple targets** | the **union** of those nodes' members | the per-target `EXISTS` already expresses this — only the NULL branch broke it |
| **zero targets** | **owner only** | fail closed: a non-firm contribution that names nobody cannot be satisfied |

Zero-target → owner-only matches the two precedents in this codebase: C1/08
chose denial for unresolved tenancy (`:51-53`, "quarantine denies, it does not
share"), and `quick_thoughts` requires `visibility_org_node_id IS NOT NULL`
before its membership `EXISTS` (`20260827090400:126`).

### One open question I did not decide

Should a `department` or `division` target **cascade** to descendant nodes?

If members are attached to leaf team nodes and a contribution targets their
department, the membership check finds nothing and the fix makes that
contribution owner-only — **legitimate access lost**. If members are attached
at every level, the flat check is correct and no cascade is needed.

This cannot be answered from the repo. `00-` Q8/Q8b/Q9 answer it with counts
(and Q9 says whether `org_chart_nodes` even has a hierarchy column). **If Q8b
shows targeted nodes without direct members, the cascade must be designed
before `10-` is applied.**

---

## Independent exposure paths checked

| Path | Finding |
|---|---|
| `asset_contribution_history` SELECT | **V1** — org-only, exposed |
| `asset_revision_events` SELECT | **V3** — org-only, exposed |
| `asset_revisions` SELECT | carries actor/asset/timestamp, no prose — left alone. If `review_note` holds analyst text it needs the same treatment; `00-` Q1 shows its columns |
| `contribution_visibility_targets` SELECT | org-scoped. Leaks *which nodes* a contribution targets, not its prose. Not fixed, flagged |
| `asset_field_history` | the `thesis_references` lane has no writer any more; included in `00-` Q1 to confirm it holds no contribution prose |
| Views / matviews | **none found in the repo.** `00-` Q2 checks production for views over these tables and whether `security_invoker` is set — a view without it runs with its owner's rights and bypasses RLS entirely |
| SECURITY DEFINER functions | **none found referencing contributions.** `00-` Q2 checks production, including which of `anon`/`authenticated` can EXECUTE |
| `ai-chat` edge function | forwards the caller's JWT, RLS applies — **V5**, amplifier not bypass |
| `global_search` RPC | does not touch contributions (checked) |
| Table grants to `anon` | none in repo (C1/11 revokes). `00-` Q3 confirms in production |

---

## The correction

`scripts/sql/contribution-visibility/10-policy-fix.sql`. Three policies, one
new predicate, nothing else:

1. **`can_read_asset_contribution(uuid)`** — "may this caller read this
   contribution": owner, firm, or member of a targeted node. Defined once so
   the history and revision policies **derive** visibility from the
   contribution instead of re-implementing it.

   `SECURITY DEFINER`, and that needs justifying. Inlined, a future narrowing
   of `org_chart_node_members` RLS would make the `EXISTS` silently false and
   **hide legitimate research** — a failure nobody reports as a security bug.
   The escalation is bounded by construction: it takes an id, answers a boolean
   about `auth.uid()` only, returns no row data, pins `search_path`, and is
   granted to `authenticated` alone with `anon` and `PUBLIC` revoked.

2. **`asset_contributions_select`** — `OR team_id IS NULL` deleted. The node
   check also confirms the node belongs to the contribution's organization.
   Owner, firm and the existing target mechanism are otherwise untouched; the
   INSERT/UPDATE/DELETE policies are not touched at all.

3. **`asset_contribution_history_select`** — `USING (can_read_asset_contribution(contribution_id))`.

4. **`asset_revision_events_select`** — harder, because a revision event is
   keyed by `(asset_id, field_key)`, not by contribution, and several authors
   can hold the same section. The rule: readable if you are the actor, **or**
   if no contribution in that `(asset, section)` is hidden from you.
   Deliberately conservative — it can withhold an event whose prose came from a
   firm-visible contribution sharing a section with a restricted one.
   Withholding a visible author's event is recoverable; leaking a restricted
   author's prose is not.

`team_id` is kept as a column (still read for the badge join) and simply stops
being treated as a grant.

---

## Tests

`supabase/tests/contribution-visibility-security.sql` — 10 assertions, real
`authenticated` and `anon` roles, real `request.jwt.claims`, self-cleaning,
matching the harness in `global-search-tenant-isolation.sql`. Application-level
filtering is not involved and could not substitute: every defect here is a
policy returning rows the client never asked it to hide.

Fixture: four contributions by one author on one asset (one section each, since
`unique_user_asset_section` is `UNIQUE(created_by, asset_id, section)`) —
single-target, multi-target, zero-target, firm — plus a member of the targeted
nodes, an untargeted same-org member, and an org-B user. History and revision
rows are inserted **directly** rather than by provoking the production trigger,
because that trigger is SECURITY DEFINER and not in version control.

| # | Covers | Pre-fix |
|---|---|---|
| 1 | `anon` reads nothing | PASS |
| 2 | **owner** sees all four of their own | PASS |
| 3 | **authorized team member** sees single- + multi-target, **not** zero-target | **FAIL** |
| 4 | **unauthorized same-org** sees only the firm row | **FAIL** |
| 5 | **cross-org** sees none | PASS |
| 6 | history denied to unauthorized same-org | **FAIL** |
| 7 | history still reaches the targeted member | PASS |
| 8 | revision events denied to unauthorized same-org | **FAIL** |
| 9 | actor still reads own revision events | PASS |
| 10 | cross-org denied on both side tables | PASS |

**Non-vacuity:** 6 PASS / 4 FAIL before the fix, 10/10 after. Assertions 3, 4,
6 and 8 are one per defect — V2 twice (both `team_id`-NULL shapes), V1 and V3
once each. If the suite passes on an unfixed database it is decoration and must
not be trusted. Assertions 2, 5, 7, 9, 10 must pass in **both** states; one of
them breaking means the fix is too tight.

I could not execute it — no database tool in this session.

---

## Before applying: what the fix takes away

The fix is correct and it is **not** access-neutral. Rows whose targets were
destroyed by V4 become owner-only, so teammates who can read them this morning
cannot this afternoon. There is no record of who they were shared with.

`00-` Q6 lists them. Three options, and this is yours to choose, not mine:

- **(a) Leave them owner-only** — fail closed, correct, and the owner can
  re-target. Recommended.
- **(b) Convert them to `firm`** — preserves current access by making the
  widening explicit and recorded instead of accidental. Needs consent; it
  publishes research the author marked restricted.
- **(c) Notify the owners** and let each decide before the policy lands.

Do not apply `10-` without picking one.

---

## Adjacent research visibility policies

- **`quick_thoughts`** (`20260827090400:121-135`) — **not vulnerable**, and it
  is the pattern to copy: `visibility_org_node_id IS NOT NULL AND EXISTS(…)`
  fails closed on a missing target.
- **`asset_notes`, `asset_models`** — fixed in an earlier pass; no
  `IS NULL`-as-grant branch found.
- **`excel_integration`** (`20260102100000:318`) — `USING (is_system = true OR
  organization_id IS NULL OR …)`. Same *class* of defect (a NULL org as a
  grant) on a different table. Templates, not research. **Flagged, not fixed.**
- `asset_revisions`, `contribution_visibility_targets` — org-scoped; no
  visibility bypass of prose. Metadata only.

---

## Adjacent problems found, unfixed

1. **V4, the client declassification bug** (`ContributionSection.tsx:655`).
   This is the one that *creates* exposed rows, and the policy fix does not
   stop it — after the fix it silently makes a restricted section owner-only
   instead of org-wide. It needs its own change: rehydrate `selectedTargetIds`
   from `myContribution.visibility_targets`, and refuse to save a non-`firm`
   visibility with zero targets.
2. **`team_id` is a denormalisation of a one-to-many relationship.** While it
   exists, a reader cannot tell "shared with one team" from "shared with
   several" without a second query. It should be dropped once nothing reads it.
3. **The visibility badge does not reflect reality.** It renders
   `contribution.visibility` regardless of whether any target survives, so a
   declassified section still shows a lock.
4. **`contribution_visibility_targets` leaks targeting metadata** org-wide —
   which teams a restricted contribution was shared with, though not its text.
5. **`excel_integration` NULL-org grant** (above).
