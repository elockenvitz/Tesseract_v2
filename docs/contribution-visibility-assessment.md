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

### The hierarchy: answered, and the gap is in the picker

`org_chart_nodes` **does** have `parent_id`, with five node types — division,
department, team, portfolio, custom (`src/lib/org-graph.ts:11`). So the
hierarchy is real.

**The picker offers a downward audience.** `userOrgContext`
(`ContributionSection.tsx:781-794`) walks **up** from the author's own direct
memberships via `traverseUp(node.parent_id)`, collecting ancestors. "My
department" is therefore the department *above* a team the author belongs to —
a node the author is usually **not a direct member of**. The author picks an
ancestor precisely because it names a broader audience than their own team.

**The policy grants on direct membership only.** Both C1/08 and the
correction match `org_chart_node_members.node_id = cvt.node_id`. No descent.

**And that is a decision, not an oversight.** It was stated in a prior security
change, for the same reason it is being held here:

> "Node scope is direct membership, matching the established convention on
> `layout_collaborations` rather than inventing subtree traversal inside a
> security change. Whether a division-level post should reach its sub-teams is
> a product question and is deliberately left open."
> — `20260827090400_quick_thoughts_tenant_rls.sql:52-56`

**So the existing intended behaviour is direct membership, and the missing
implementation is descent.** The consequence, stated plainly:

- A department- or division-targeted contribution reaches only the **direct
  members of that node** — frequently nobody, since members tend to sit on leaf
  team nodes.
- Under the **current** policy, a multi-target one of those is readable by the
  whole organization. So the fix replaces an over-share with an under-share for
  exactly those rows.

**I did not add descent.** Inventing inheritance semantics inside a security
change is what the quoted precedent refused to do, and the brief asked me not
to. The honest fix is in the **picker**: it should stop offering an audience the
authorization model does not deliver. That is a separate change.

`01-preflight-checklist.sql` #7 counts the targeted nodes that reach nobody,
and #6 lists every contribution that loses a reader for this reason.
`supabase/tests/contribution-visibility-security.sql` assertion 12 pins the
no-descent behaviour as a tested fact — if descent is ever implemented, that
assertion must be deliberately inverted.

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

4. **`asset_revision_events_select`** — see the attribution section below.

`team_id` is kept as a column (still read for the badge join) and simply stops
being treated as a grant.

### Revision-event attribution, and where it runs out

`asset_revision_events` has **no `contribution_id`**. Neither it nor
`asset_revisions` has a migration in this repo — the shape below is read from
`src/lib/revision-service.ts:14-20` and `src/hooks/useAssetRevisions.ts:6-21`,
and `00-` Q1 must confirm it.

**It is still reliably attributable, through the actor.** `publishDraft` passes
`actorUserId: user.id` (`useContributions.ts:424`), and the author-only UPDATE
policy means nobody else can publish that contribution — so **the actor is the
author**. With `unique_user_asset_section UNIQUE (created_by, asset_id,
section)`, the triple `(r.asset_id, e.field_key, r.actor_user_id)` identifies
**exactly one** contribution. No "most recent wins", no guessing. That is
better than the conservative rule I proposed last round, which would have
withheld a firm-visible author's event merely for sharing a section with a
restricted one.

**The invariant this rests on, stated so it can be checked:** actor == author.
If any future path writes a revision event whose actor is not the author of the
matching contribution — a bulk tool, an admin action, a server job — then both
the actor branch *and* the derivation become wrong, and that path would hand
one analyst's prose to another. Test assertion 14 asserts it rather than
assuming it, and `01-` has the same check against production data.

**Does actor-based access expose restricted prose?** Not today, and the reason
is exactly that invariant. A revision is a *session* keyed by
`(asset, actor, scope)` and can hold events across several `field_key`s — but
all published by that one actor, so all from that actor's own contributions.
Granting the actor access grants them their own words. `asset_revisions` also
carries a `review_note` the actor writes about their own session, which is why
C1/06's policy on that table is left alone; if the note is found to quote other
analysts, it needs the same treatment.

**Two cases cannot be attributed, and both are handled explicitly:**

| Case | Treatment | Why |
|---|---|---|
| `category = 'valuation_targets'` (`field_key = 'price_target'`) | organization-visible, **unchanged** | not contribution prose, and the only revision category the Evolution Timeline renders (`ThesisHistoryView.tsx:1058`). Restricting it would break a working feature on no evidence |
| contribution-category event with **no** matching contribution | denied to everyone but the actor | **orphaned prose**: the contribution was deleted and its before/after text outlived it. Nothing records who it was shared with |

**The residual, documented rather than fixed:** orphaned prose is still *in*
the table — it becomes unreadable, not removed. `01-` #9 counts it. Deleting it
is a data decision, not a policy one, and is not part of this change.

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

Fixture hierarchy — `division ⊃ department ⊃ team t1` — so the department and
division cases are real nesting, not flat nodes. `v_member` is a direct member
of `t1`, `t2` and the **department**; nobody is a direct member of the
**division**.

| # | Covers | Pre-fix |
|---|---|---|
| 1 | `anon` reads nothing | PASS |
| 2 | **owner** sees all of their own | PASS |
| 3 | **authorized team member** sees single- + multi-target, **not** zero-target | **FAIL** |
| 4 | **unauthorized same-org** sees only the firm row | **FAIL** |
| 5 | **cross-org** sees none | PASS |
| 6 | history denied to unauthorized same-org | **FAIL** |
| 7 | history still reaches the targeted member | PASS |
| 8 | restricted revision prose denied to unauthorized same-org | **FAIL** |
| 9 | actor still reads all three of their own revision events | PASS |
| 10 | cross-org denied on both side tables | PASS |
| 11 | **department** target: direct member yes, non-member no | PASS |
| 12 | **division** target does **not** reach a descendant team member | PASS |
| 13 | **orphaned** revision prose denied to non-actor | **FAIL** |
| 14 | price targets stay org-visible; **actor == author** holds | PASS |

**Non-vacuity:** 9 PASS / 5 FAIL before the fix, 14/14 after. The five failures
are one per defect — V2 twice (both `team_id`-NULL shapes), V1, V3, and the
orphan case. If the suite passes on an unfixed database it is decoration and
must not be trusted. The nine others must pass in **both** states; one breaking
means the fix is too tight.

Assertion **12 is a documentation assertion**: it pins the unimplemented
subtree descent as a tested fact. It is not an endorsement — if descent is ever
implemented, 12 must be deliberately inverted, and its failure is the signal to
do so on purpose.

I could not execute any of it — no database tool in this session.

### Application-side tests (these did run)

`src/hooks/__tests__/contribution-visibility-preservation.test.ts` — 17
source-pinned assertions, all passing. The hook cannot be mounted (live
Supabase client, auth session, organization context) and mocking the client
would only prove a mock returned what the test told it to, so the invariants
are pinned against source, as this repo already does for AssetTab and
ContributionSection.

Non-vacuity proven by injection: restoring the `visibility = 'firm'` default
and removing AssetTab's ref guard failed exactly the two assertions that name
them (15 passed / 2 failed), reverted after.

The five target shapes the brief named — one team, several teams, a department,
a division, none — differ only in what `visibility_targets` holds and the node
type behind each id. **Nothing in the preservation path branches on node type
or target count** (asserted), which is why preservation needs no per-shape
case; whether each shape then grants the right *readers* is the authorization
question, covered per shape in the SQL suite above.

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

1. ~~**V4, the client declassification bug.**~~ **FIXED** — commit
   `071e2673`, separate from the SQL. Three causes: the mutation defaults,
   ContributionSection never loading the audience it submitted, and AssetTab's
   level-reset effect wiping its own rehydration in the same render cycle. A
   central guard now refuses a non-`firm` visibility with zero targets on all
   three write paths.
2. **The picker offers an audience the policy will not deliver** — department
   and division targets, per the hierarchy section above. This is now the
   largest open item, and it is a product decision.
3. **`team_id` is a denormalisation of a one-to-many relationship.** While it
   exists, a reader cannot tell "shared with one team" from "shared with
   several" without a second query. It should be dropped once nothing reads it.
4. **The visibility badge does not reflect reality.** It renders
   `contribution.visibility` regardless of whether any target survives, so a
   section already declassified by V4 still shows a lock. The fix stops new
   ones; it does not relabel the existing ones.
5. **Selecting a restricted level with nothing to pick now does nothing
   visible.** `handleVisibilitySelect` no longer applies such a level — correct,
   but the menu gives no reason. Telling the user why needs UI this change
   should not invent.
6. **`contribution_visibility_targets` leaks targeting metadata** org-wide —
   which teams a restricted contribution was shared with, though not its text.
7. **Orphaned revision prose** stays in `asset_revision_events` after the fix,
   unreadable rather than removed. `01-` #9 counts it; deleting it is a data
   decision.
8. **`excel_integration` NULL-org grant** (above).
