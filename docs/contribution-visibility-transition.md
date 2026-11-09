# Stale clients during the transition — assessment

**Design only. Nothing here is implemented, and nothing should be until this is
reviewed.** The immediate next action remains the read-only preflight.

Your concern is correct: "wait for browsers to refresh" is not an enforcement
mechanism. A tab open since yesterday keeps the old bundle indefinitely, and
sessions can live far longer than a deploy window.

---

## 1. What exists today to enforce a client version: nothing

| Mechanism | Present? |
|---|---|
| Service worker / PWA update channel | No — no `serviceWorker`, `registerSW` or workbox anywhere in `src`, `vite.config.ts` or `index.html` |
| Build stamp or `APP_VERSION` in the bundle | No |
| `x-client-version` or any custom header on the Supabase client | No — `createClient` (`src/lib/supabase.ts:11`) passes only `auth` and `realtime` |
| Server-side version check | No |

So there is no mechanism to extend, and adding one means building the
generalized versioning framework you ruled out. Even then PostgREST does not
gate on request headers without a custom RPC in front of every write, which is
a larger change than the fix it would be protecting.

**Conclusion: a client-version guard is the wrong shape for this problem.**

---

## 2. The smallest reliable restriction, and why it is small

The damage a stale client does is specific. It is not "defective contribution
writes" in general — it is exactly this, from the old bundle's
`saveContribution`:

```ts
await supabase.from('contribution_visibility_targets').delete().eq('contribution_id', id)
// …then re-insert only if targetIds.length > 0, which for a stale client it never is
```

Two facts make this easy to contain:

1. **Under the new policy, `team_id` is irrelevant.** Only
   `contribution_visibility_targets` decides who can read a restricted
   contribution. A stale client setting `team_id = null` is harmless once
   `10-` is applied; the damage is solely the deleted target rows.
2. **Every client already ignores the result of that delete.** The `await` is
   not destructured and no error is checked — in the old bundle and the new one
   (`useContributions.ts:257`). A denied delete therefore does not throw, does
   not surface an error, and does not block the content save.

So the restriction is: **deny `INSERT` and `DELETE` on
`contribution_visibility_targets` to `authenticated` for the duration of the
transition.** One table, two verbs.

`INSERT` has to be denied alongside `DELETE`. With only `DELETE` denied, a
*new* client's replace becomes an append — the old rows survive and the new
ones are added — which widens the audience instead of replacing it. Denying
both makes the pair a no-op rather than a merge.

Proposed shape, for review — **not written to the lane, not to be applied**:

```sql
-- FREEZE (applied in the same transaction as 10-policy-fix.sql)
DROP POLICY IF EXISTS contribution_visibility_targets_insert ON public.contribution_visibility_targets;
DROP POLICY IF EXISTS contribution_visibility_targets_delete ON public.contribution_visibility_targets;
-- SELECT policy untouched: everyone keeps seeing the audience that exists.

-- THAW (a separate, later transaction — restores C1/08 verbatim)
-- …recreate both policies exactly as scripts/sql/security-c1/08-asset-contributions.sql
--    lines 105-117 define them.
```

Dropping the policies rather than `REVOKE`ing the grant is deliberate: with RLS
on and no policy, the write matches zero rows and returns success, which is
what the clients already expect. A `REVOKE` returns `42501`, and while the
current code ignores that too, relying on an ignored error is more fragile than
relying on zero rows.

### What it costs

| Still works during the freeze | Unavailable during the freeze |
|---|---|
| Writing, editing and publishing research | Changing who a contribution is shared with |
| Drafts, autosave, the unsaved-edits guard | Creating a *new* contribution with a restricted audience (it saves owner-only) |
| Attachments and evidence | |
| Reading everything, at correct visibility | |

The cost is real but narrow, and it fails closed in every case: a visibility
change during the window silently does not take effect, and a new restricted
contribution reaches its author only.

**The silent part is the honest drawback.** Making it loud would require a
client change, which is precisely what cannot be relied on here. The mitigation
is to keep the window to the length of a deploy and to tell people it is
happening, not to engineer around it.

---

## 3. Compared against the alternatives

| Option | Reliability vs stale clients | Operational cost | Verdict |
|---|---|---|---|
| **Audience-write freeze** (deny INSERT/DELETE on one table) | Total — server-side, version-agnostic, applies to every client that ever existed | One capability unavailable for the length of a deploy. Reversible in one statement. | **Recommended** |
| **Narrow compatibility guard** (client sends a version, server rejects old) | Good, once built | Requires a mechanism that does not exist: a build stamp, a header, and an RPC in front of every contribution write. That is the versioning framework, arriving as a security change. | Rejected |
| **Full contribution-write freeze** (block all writes to `asset_contributions`) | Total | Analysts cannot write research at all. Strictly larger than the freeze above with no extra safety — stale clients damage *targets*, not content. | Rejected: same protection, far more disruption |
| **Wait for refresh** (the current plan) | None. A stale tab is indefinite. | Zero | Rejected — this is the concern being raised |

The freeze is smaller than the compatibility guard in every dimension that
matters: no new concepts, no client change, no code to maintain afterwards, and
its blast radius is one table for one window.

---

## 4. Revised rollout sequence

The freeze changes the ordering constraint entirely. With stale clients unable
to touch target rows, the policy no longer has to wait for the deploy — so
**exposure closes at the earliest possible moment** instead of after a deploy
plus an unbounded refresh wait.

```
1  read-only preflight (00-, 01-)                 production, SELECT only   ← next action
2  isolated database test, A→B→C→D                NEVER production
   …plus: freeze applied, confirm a simulated stale write cannot delete targets
3  FREEZE + 10-policy-fix.sql, ONE transaction    production
       ↳ exposure closed here. Stale clients can no longer damage anything.
4  deploy the application fix                     app only
5  THAW — restore the two target policies         production, one transaction
6  post-apply verification                        read-only
```

Compared with the previous plan:

| | Old sequence | With the freeze |
|---|---|---|
| Exposure closes | step 5, after deploy **and** an unbounded refresh wait | step 3 |
| Stale clients can destroy audiences | yes, for the whole window | no, at any point |
| Depends on client refresh | yes | no |
| Audience changes unavailable | never | steps 3→5 only |

The old sequence traded continued exposure for safety from stale clients. The
freeze removes the trade: there is no longer a window in which production is
both exposed and vulnerable to stale writes.

**Step 5 should not be rushed.** Thawing before the deploy has fully rolled out
reintroduces the original hazard, so the thaw is gated on the deploy being
live, not on a timer.

### If the freeze is rejected

Then the previous ordering stands — application first, policy after a refresh
wait — and the residual risk is explicit: every save by a stale client between
step 5 and that client refreshing destroys that section's audience
irrecoverably. That is the risk the freeze exists to remove, and it should be
accepted deliberately rather than by default.

---

## 5. What still has to be true

The freeze is **not** a substitute for any gate in
`docs/contribution-visibility-gate.md`. The hard stops are unchanged, and the
preflight still comes first. In particular a non-zero
`invariant_violations_actor_is_not_author` still means `10-` §4 is redesigned
before anything is applied — the freeze protects target rows, not a wrong
policy.

Two things to confirm before step 3, neither of which I can establish from
here:

- That production's `contribution_visibility_targets` policies are the two
  C1/08 defines, so the thaw restores exactly what was there (`00-` Q1).
- Roughly how long steps 3→5 will take, since that is the freeze window and the
  length of the user-visible limitation.
