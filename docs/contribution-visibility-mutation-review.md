# Audience mutation — design review

**Design only. Nothing implemented, nothing applied.** Immediate next action is
unchanged: the read-only preflight.

Both concerns hold, and tracing them turned up a third problem that is worse
than either: **the widening path does not need a stale client at all, and the
audience-destroying state is reachable from a dropped network connection.**
That changes the recommendation from a temporary freeze to a permanent
safeguard.

---

## 1. Exact mutations, traced

### What production runs today (`dc9d12ab`, pre-fix)

`saveContribution` — every content save, one `UPDATE` on the parent row:

```ts
visibility = 'firm' as ContributionVisibility,   // the default
targetIds  = []
…
.update({ content, supporting_detail, attachments,
          visibility,                                   // ← parent row
          team_id: targetIds.length === 1 ? targetIds[0] : null,
          updated_at })
```

then, unconditionally, two further requests:

```ts
await supabase.from('contribution_visibility_targets').delete().eq('contribution_id', id)
if (visibility !== 'firm' && targetIds.length > 0) { await …insert(…) }
```

### Concern 1 is real, and it is not only a stale-client problem

`sharedThesisVisibility` initialises to `'firm'` (`AssetTab.tsx:460`) and is
seeded from a saved contribution only if one exists in **thesis**,
**where_different** or **risks_to_thesis** (`:1037-1039`).

So for an author with no contribution in those three legacy sections, editing
any other section — `business_model`, `key_catalysts` — sends
`visibility: 'firm'` on an **ordinary content save**. If that section was
restricted, it is now firm-visible.

This is reachable in production today, with no stale bundle involved. A freeze
on `contribution_visibility_targets` does nothing about it, because the
widening happens on the parent row and `visibility = 'firm'` makes the target
rows irrelevant.

### A third defect, found while tracing: the replace is not atomic

The delete and the insert are **two separate HTTP requests with no
transaction**. If the insert fails — a dropped connection, a tab closed, an RLS
denial, a validation error — the delete has already committed and the audience
is gone.

So the state this lane exists to prevent is reachable by a network blip. That
is not a transition risk; it is a standing defect in the write path, and it is
the strongest argument for fixing the mutation rather than fencing it for a
window.

### Mutation matrix

| Flow | Parent `visibility` | Parent `team_id` | Target rows |
|---|---|---|---|
| **Stale content save**, seeded | saved value rewritten | → `NULL` | **deleted**, not replaced |
| **Stale content save**, unseeded | **→ `'firm'` — widening** | → `NULL` | deleted (moot: firm) |
| **Stale explicit change** → firm | → `'firm'` | → `NULL` | deleted |
| **Stale explicit change** → restricted | → that level | 1 target: set; else `NULL` | deleted, then inserted *(non-atomic)* |
| **Fixed client, content save** | untouched | untouched | untouched |
| **Fixed client, explicit change** | → chosen level | as above | deleted, then inserted *(non-atomic)* |

---

## 2. Smallest server-side protection against widening during a transition

Two statements, because the damage has two locations:

```sql
-- (a) the parent row: visibility and team_id become unchangeable by any client
CREATE OR REPLACE FUNCTION public.asset_contributions_pin_audience()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER
SET search_path = public, pg_temp AS $$
BEGIN
  NEW.visibility := OLD.visibility;
  NEW.team_id    := OLD.team_id;
  RETURN NEW;
END $$;

CREATE TRIGGER a_pin_audience
  BEFORE UPDATE ON public.asset_contributions
  FOR EACH ROW EXECUTE FUNCTION public.asset_contributions_pin_audience();

-- (b) the target rows: no client may add or remove an audience member
DROP POLICY IF EXISTS contribution_visibility_targets_insert ON public.contribution_visibility_targets;
DROP POLICY IF EXISTS contribution_visibility_targets_delete ON public.contribution_visibility_targets;
```

Silently preserving rather than raising is deliberate, and it is what keeps
ordinary research editing working: the `UPDATE` still writes `content`,
`supporting_detail`, `attachments` and `updated_at`, so a content save
succeeds for every client, old or new. Only the audience is inert.

(a) is what concern 1 requires. Without it the freeze is incomplete.

---

## 3. Can a *permanent* safeguard do this? Yes, and it is better

The question to settle is whether stale clients can be made permanently
harmless without a versioning framework. They can, because the problem is not
"old code" — it is that **the audience is editable field-by-field by anything
holding a session**. Make the audience changeable only through one operation
and the client's age stops mattering.

```sql
-- One function, one purpose. Not a framework.
CREATE FUNCTION public.set_contribution_audience(
  p_contribution_id uuid,
  p_visibility      text,
  p_node_ids        uuid[]
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  -- author-only, org-pinned: the same rule the UPDATE policy already enforces
  -- a non-firm visibility with no nodes is refused, not stored
  -- delete + insert happen HERE, in ONE transaction
  -- sets a local flag the pin trigger honours, so only this path may move
  --   visibility / team_id
END $$;

REVOKE INSERT, DELETE ON public.contribution_visibility_targets FROM authenticated;
```

The pin trigger from §2(a) stays **permanently**, with one addition: it allows
the change when `current_setting('app.audience_change', true) = 'on'`, which
only the function sets. Direct field updates remain inert forever.

What this buys beyond the transition:

- **Stale clients are permanently harmless.** No thaw, so concern 2 has no
  window to live in.
- **The replace becomes atomic**, closing the dropped-connection defect in §1.
- **The zero-target rule moves server-side.** Today it is a client guard
  (`assertVisibilityNamesAnAudience`) that an old bundle does not have.
- It is one function over one table pair — narrower than the RLS work already
  in this lane, and not a generalized authorization mechanism.

**Cost:** the application must call the function for explicit visibility
changes. That is a real change to `useContributions`, and it means **the
currently committed app fix is not the version to deploy** — it would need the
RPC wiring first. That work is not started, pending your review.

---

## 4. Comparison

| | A. Temporary freeze | B. Permanent safeguard | C. App-first rollout |
|---|---|---|---|
| Stops widening via parent row | yes, with §2(a) | yes, permanently | no |
| Stops target deletion | during window only | permanently | no |
| Safe thaw | **unresolved — concern 2** | **no thaw exists** | n/a |
| Fixes non-atomic replace | no | **yes** | no |
| Zero-target rule enforced server-side | no | **yes** | no |
| Exposure closes | step 3 | step 3 | after deploy + refresh wait |
| Ordinary editing during transition | works | works | works |
| Audience changes unavailable | window | between apply and deploy | never |
| Client change needed | none | **RPC wiring** | none |
| New concepts | none | one function | none |

A is a fence with a gate nobody can safely open. B removes the fence by fixing
what it was guarding. C is the status quo plus a known residual risk.

**Recommendation: B.** A's §2(a) trigger is not thrown away — it becomes B's
permanent pin.

---

## 5. Revised rollout

```
1  read-only preflight (00-, 01-)                  ← immediate next action
2  isolated database test: policy + safeguard + stale-client simulation
3  apply, ONE transaction:  10-policy-fix.sql
                          + pin trigger
                          + set_contribution_audience()
                          + REVOKE insert/delete on targets
       ↳ exposure closed. Stale clients permanently inert.
4  deploy the application (with RPC wiring, not yet written)
5  post-apply verification — read-only
```

There is no step 6 and no thaw.

**Between 3 and 4**, nobody can change an audience: old clients are inert, new
ones do not exist yet. Ordinary research editing — writing, publishing, drafts,
attachments — works throughout, for every client. A visibility change attempted
in that window silently does not take effect; that silence is the honest cost,
and the window is the length of one deploy.

### Conditions to thaw safely

**None are needed, because nothing is frozen.** That is the point of choosing
B: concern 2 asked when it is safe to re-enable direct audience writes, and the
answer is that they are never re-enabled for any client. A stale tab open for a
month can still save research and still cannot touch an audience.

If B is rejected and A is taken instead, the thaw conditions would be:

1. Deployment live **and** every pre-deploy session provably ended — which the
   application cannot currently establish (no build stamp, no session
   telemetry). In practice this means a forced sign-out or a long, arbitrary
   wait.
2. `01-` re-run showing no new zero-target contributions since the freeze.

Condition 1 is not satisfiable with what exists today. **That is the finding
behind the recommendation**, not a preference.

---

## 6. Test specification

These are specified, not written: the suite should be extended once the design
is approved, so the assertions match what is actually built. They extend
`supabase/tests/contribution-visibility-security.sql` as 15–22, using the same
real-role harness.

| # | Scenario | Expected with safeguard | Must fail without it |
|---|---|---|---|
| 15 | **Content-only save** — update `content` alone on a restricted contribution | `visibility`, `team_id` and all target rows unchanged; content changed | yes — baseline that editing still works |
| 16 | **Stale content save, unseeded** — `UPDATE … SET content=…, visibility='firm', team_id=NULL` | `visibility` stays restricted; content changed | **yes — concern 1** |
| 17 | **Stale target deletion** — direct `DELETE FROM contribution_visibility_targets` | 0 rows deleted, no error | **yes — concern 2** |
| 18 | **Restricted → firm** via `set_contribution_audience` | `visibility='firm'`, targets cleared, readable org-wide | — |
| 19 | **Firm → restricted** via the function | `visibility` set, targets inserted, readable only by those nodes' direct members | — |
| 20 | **Restricted → restricted** (different nodes) | old targets gone, new present, **never both** — guards the append-instead-of-replace case | yes |
| 21 | **Restricted → restricted with zero nodes** | refused; audience unchanged | **yes — the rule moves server-side** |
| 22 | **Atomicity** — force a failure between delete and insert inside the function | whole change rolls back; original audience intact | **yes — §1's third defect** |

Non-vacuity, as in the rest of this lane: 16, 17, 20, 21 and 22 must be shown
**failing** against a database without the safeguard before they are trusted.
15 must pass in both states — if it ever fails, the safeguard has broken
ordinary research editing and is too tight.

---

## 7. Out of scope, restated

No generalized authorization framework: one function over one table pair, with
the existing author-only and org-pinned rules reused rather than reinvented. No
organizational hierarchy work — descent stays unimplemented and assertion 12
still pins it. No client-versioning mechanism; the safeguard works by making
client age irrelevant rather than by detecting it.

Nothing is implemented. The next action is the read-only preflight, and the
safeguard should not be built until this design is approved — its shape may
change once `00-` Q1 shows what the target-table policies actually are.
