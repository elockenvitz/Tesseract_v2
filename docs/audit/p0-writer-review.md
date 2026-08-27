# P0 review — every function that can write `users.current_organization_id`

Reviews `d516136` (migrations `20260826100000` / `…100100` / `…100200`) for
alternate paths to the tenant pointer. Read with
`docs/audit/platform-readiness-2026-08.md` §P0-1 and
`docs/audit/production-verification-pack.md` Block 1.

**Verdict: one STOP condition (§3), and it is not a defect in these migrations
— it is a load-bearing assumption inside them that the repository cannot
confirm. Nothing else in the design should change. The design is sound.**

---

## 1. Summary

Seven functions can write the column. Three are in the repository and can be
reviewed here; four are not, which is `docs/audit/platform-readiness-2026-08.md`
§P0-5 landing on exactly the code that matters most.

| Function | In repo | Reviewable | Can write another user's pointer | Verdict |
|---|---|---|---|---|
| `morph_switch_org(uuid)` | ✅ `20260529130000` | yes | no — `WHERE id = auth.uid()` | **safe** |
| `morph_restore_org(uuid)` | ✅ `20260529120000` | yes | no — `WHERE id = auth.uid()` | **safe** |
| `erase_user_personal_data(uuid)` | ✅ `20260814200000` | yes | **yes** — but only to `NULL` | **safe as a pointer writer** (§2.3) |
| `set_current_org(uuid)` | ❌ | no | presumed no | behaviourally proven by test, body unverified |
| `auto_accept_pending_invites()` | ❌ | no | presumed no | **STOP — see §3** |
| `bootstrap_organization(...)` | ❌ | no | presumed no | unverified |
| `maintain_current_org_on_membership_change()` | ❌ | no | **yes** | not directly callable (trigger) |

The three layers hold against every path I *can* read. The question §3 raises is
not whether a layer fails — it is whether an attacker can satisfy all three
honestly.

---

## 2. The functions that can be reviewed

### 2.1 `morph_switch_org(p_org_id uuid)` — safe

`supabase/migrations/20260529130000_morph_switch_org_any_target_org.sql`

- **Declared:** `SECURITY DEFINER`, `SET search_path = public`, `LANGUAGE plpgsql`.
- **Owner:** not stated in the migration. `CREATE OR REPLACE` preserves the
  existing owner; a fresh create is owned by whoever applied it — in this project
  that is the Management API, i.e. `postgres`. **Verify, do not assume** (§5, Q1):
  the guard in `20260826100200` exempts on `current_user NOT IN ('authenticated','anon')`,
  so an owner of `authenticated` would make this function *fail* rather than
  escalate. Fail-closed, but it would break morphing.
- **Grants:** `GRANT EXECUTE … TO authenticated`. Directly invocable by any
  logged-in user.
- **Authorization:** three gates — `is_platform_admin()`, an active unexpired
  row in `morph_sessions` for `auth.uid()`, and `p_org_id` must be an active
  membership **of the morph target**.
- **Writes:** `UPDATE users … WHERE id = auth.uid()` — caller's own row only.
- **Why it stays safe:** it deliberately sets an org the caller is *not* a member
  of, which is why the guard could not be membership-shaped (the migration header
  says so). Its safety rests entirely on `is_platform_admin()`, which is not in
  the repository. If that function reads a boolean column on `public.users`, the
  P0 fix has a hole — but note that Layer B withholds every column except the
  seven allowlisted, and `is_platform_admin` is not among them, and `20260408300001`
  shows a `platform_admins` **table**. Consistent with safe. Verify anyway (§5, Q2).

### 2.2 `morph_restore_org(p_org_id uuid)` — safe

`supabase/migrations/20260529120000_morph_switch_org_rpcs.sql`

`SECURITY DEFINER`, `search_path = public`, granted to `authenticated`. Requires
`is_platform_admin()` **and** an active membership of `p_org_id` **by the
caller**. Writes `WHERE id = auth.uid()`. Strictly narrower than
`morph_switch_org`. No path to another user's row and no path to a non-member org.

### 2.3 `erase_user_personal_data(p_user_id uuid)` — safe *as a pointer writer*

`supabase/migrations/20260814200000_erase_user_validate_before_mutating.sql:209`

- `SECURITY DEFINER`, `search_path = public`, `REVOKE ALL … FROM PUBLIC`,
  `GRANT EXECUTE … TO authenticated`.
- **Authorization** (`:81-93`): `service_role`, **or** the caller holds an
  active `is_org_admin` membership in an organization the subject also belongs to.
- **Writes another user's pointer: yes** — `current_organization_id = NULL`.

**Safe as a pointer writer**, and the reasoning is worth stating because it is
the reason this one needs no change: the only value it can write is `NULL`, and
`NULL` grants nothing. Under Layer A a `NULL` pointer resolves to `NULL` and
every org policy denies. It can deny access; it cannot confer it.

**Separate pre-existing concern, out of scope for this PR.** Its authorization
join has the same shape as the new guard's `coverage_admin` branch —
`admin.status = 'active' AND admin.is_org_admin` joined to the subject on *any*
shared organization, with no `subject.status` filter and no binding to
`current_org_id()`. So an org admin of Org A can irreversibly erase a user who
also belongs to Org B, and Org B's admins never consented. That is a P1-shaped
cross-tenant destructive action that predates `d516136` and is untouched by it.
Recorded here because this review is the natural place to find it; it should not
gate this deployment.

---

## 3. STOP — the assumption I cannot confirm, and why it matters

**This does not describe a flaw in `d516136`. It describes a single sentence in
`20260826100100`'s header that the whole design leans on and that the repository
cannot check.**

### 3.1 The sentence

Migration B keeps `email` in the `authenticated` UPDATE allowlist, justified as:

> `email` stays granted because `useAuth` syncs it from the authenticated
> session. **Nothing authorises on `public.users.email`** — invite matching reads
> `auth.users.email` — so a forged value is a display-level lie, not an
> escalation.

The security of keeping `email` writable rests entirely on the clause in bold.

### 3.2 Why it is the right thing to question

`src/lib/org-domain-routing.ts:83-99` calls `auto_accept_pending_invites()` — no
arguments, no token — and documents it as:

> Auto-accept any pending invites matching **the authenticated user's email**.

So there exists a client-callable RPC that converts *an email address* into *an
organization membership*, and it is one of the seven writers of the tenant
pointer. Its body is not in the repository. Note the contrast with
`accept_org_invite`, which the same file describes as token-based (`:101-104`) —
the token-based path is not exposed this way; the email-driven one is.

### 3.3 The path, if the assumption is wrong

If `auto_accept_pending_invites()` matches against `public.users.email` rather
than `auth.users.email`:

1. Attacker learns an address with a pending invite to a victim org. Invite
   addresses are not secret — `OrgPeopleTab.tsx:141` lists them to org members,
   and a corporate address pattern is guessable.
2. `PATCH /rest/v1/users?id=eq.<self> {"email":"invitee@victim.example"}` —
   **permitted by the new allowlist**, and the guard trigger does not police
   `email`.
3. `POST /rest/v1/rpc/auto_accept_pending_invites` — grants a **genuine** active
   membership.
4. `set_current_org(<victim org>)` — succeeds, because the membership is real.
5. `current_org_id()` returns the victim org, because Layer A validates the
   membership and finds it **active and legitimate**.

Every layer is satisfied. The fix is not bypassed, it is *complied with* — which
is precisely the class of alternate path this review was asked to look for, and
the reason a "the write is blocked" proof is not sufficient on its own.

Layer A is what makes this reachable at all, and that is not an argument against
Layer A: before `d516136` the attacker did not need the invite, because they
could write the pointer directly. This is strictly harder than the bug being
fixed. It is a *residual* path, not a regression.

### 3.4 What settles it — three read-only queries

```sql
-- 1. Does the invite path match on public.users.email or auth.users.email?
SELECT pg_get_functiondef(p.oid)
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN ('auto_accept_pending_invites', 'accept_org_invite');

-- 2. Does anything else authorise on public.users.email?
SELECT tablename, policyname, cmd
FROM pg_policies
WHERE schemaname = 'public'
  AND (qual ILIKE '%users%email%' OR with_check ILIKE '%users%email%');

-- 3. Is public.users.email unique-constrained? (a UNIQUE index makes step 2
--    of the path fail whenever the victim address already has a row, which
--    materially narrows it)
SELECT i.relname, idx.indisunique, pg_get_indexdef(idx.indexrelid)
FROM pg_index idx
JOIN pg_class i ON i.oid = idx.indexrelid
JOIN pg_class t ON t.oid = idx.indrelid
JOIN pg_namespace n ON n.oid = t.relnamespace
WHERE n.nspname = 'public' AND t.relname = 'users' AND idx.indisunique;
```

**SAFE:** query 1 shows the match against `auth.users` (or `auth.email()`, or a
JWT claim), and query 2 returns zero rows. The header's claim is correct, nothing
changes, ship it.

**UNSAFE:** query 1 shows a join or comparison against `public.users.email`.
Then, before deploying, remove `email` from the `GRANT UPDATE` list in
`20260826100100` and let `useAuth`'s session sync go through a `SECURITY DEFINER`
RPC that takes the address from the JWT rather than from the request body. That
is a small change to one migration and one hook — but it must be decided before
deployment, not after, because the allowlist is the thing being deployed.

---

## 4. Findings from the `coverage_admin` tests

Added in `supabase/tests/tenant-boundary-p0-coverage-admin.sql`. Requirements
A–D pass by construction of the guard; the file also records three
characterisations. **None of these is a reason to change `d516136`.**

### 4.1 `coverage_admin` is global, so an org admin can confer it in orgs they do not administer

`users.coverage_admin` is a single boolean on the user, not a per-org grant. The
guard's join (`20260826100200`) requires the actor and subject to share *an*
organization the actor administers — mirroring the existing
`Org admins can update coverage_admin for org members` row policy. So an admin
of Org A can set the flag on a user who is also an active member of Org B, and
that user becomes a coverage admin in B.

Bounded by the fact that coverage policies AND the flag with an org predicate
(`organization_id = current_org_id() AND users.coverage_admin`), so the effect is
confined to orgs the subject can already enter. Population is real but small: the
commit message measured 4 of 24 users holding more than one active membership.

**Pre-existing and not widened by this PR** — the row policy already allowed it;
the trigger mirrors the policy. The PR strictly improves matters by making
self-granting impossible. Correct fix belongs with the §8 membership work in the
platform audit: make coverage administration a per-membership attribute
(`organization_memberships.is_coverage_admin`) rather than a global user flag.
Assertion [8] characterises it.

### 4.2 The guard checks `actor.status` but not `subject.status`

An admin can set the flag on a user whose only shared membership is `inactive` —
a former colleague. Low severity: the flag is inert without an active membership,
because the coverage policies require one. Assertion [6] probes it and
assertion [9] confirms the *actor* side is correctly gated (a deactivated admin
cannot act). If tightened later, add `AND subject.status = 'active'` to the join
in `20260826100200`.

### 4.3 An org admin can set the flag on themselves

The join is satisfied when actor and subject are the same membership row.
Consistent with the row policy — an admin can already target their own row
through the same UI — so this is intended. Assertion [7] characterises it so a
future change is deliberate.

---

## 5. What must be verified on the target database before deployment

Four queries. None writes. All are drawn from the gaps above.

```sql
-- Q1/Q3/Q4 — inventory: every writer's owner, mode, search_path and grants.
SELECT p.proname,
       pg_get_userbyid(p.proowner)                              AS owner,
       p.prosecdef                                              AS security_definer,
       p.proconfig                                              AS settings,
       has_function_privilege('anon',          p.oid, 'EXECUTE') AS anon_exec,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') AS auth_exec
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.prokind = 'f'
  AND p.proname IN ('set_current_org','morph_switch_org','morph_restore_org',
                    'maintain_current_org_on_membership_change',
                    'erase_user_personal_data','auto_accept_pending_invites',
                    'bootstrap_organization','current_org_id',
                    'user_has_active_membership','is_platform_admin');
```
- **SAFE:** every row `owner = postgres`, `security_definer = true`,
  `settings = {search_path=public}`, `anon_exec = false`.
- **UNSAFE:** `owner` is `authenticated` or `anon` on any of them — the guard's
  exemption would not apply and that writer would start failing. Or `anon_exec =
  true` on any writer.

```sql
-- Q5 — the completeness check: is the list of seven actually complete?
SELECT p.proname, p.prosecdef,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') AS auth_exec
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND pg_get_functiondef(p.oid) ILIKE '%current_organization_id%'
  AND pg_get_functiondef(p.oid) ~* '(update|insert)[[:space:]]'
ORDER BY 1;
```
- **SAFE:** returns exactly the seven named above (plus `current_org_id` and
  `user_has_active_membership`, which only read).
- **UNSAFE:** an eighth writer. Review it against this table before deploying —
  the guard covers it, but a writer that is `SECURITY DEFINER` and
  `authenticated`-callable and does *not* validate membership is a new §3-shaped
  path.

```sql
-- Q6 — the row policies the guard relies on for coverage_admin.
SELECT policyname, cmd, roles, qual, with_check
FROM pg_policies WHERE schemaname = 'public' AND tablename = 'users';
```
- Confirms `Org admins can update coverage_admin for org members` exists and is
  shaped as the guard assumes. If it is absent, test assertion [4] reports WARN
  rather than PASS and the OrganizationPage flow is gated by something else.

Plus §3.4's three queries, which are the blocking ones.

---

## 6. Conclusion

- The three-layer design is correct and I recommend no change to it.
- Layer A is the right primary control: it is the only one that repairs an
  already-wrong value, and the `IS NOT DISTINCT FROM` / `COALESCE` / explicit-NULL
  audit recorded in its header is the right proof that NULL fails closed.
- The `SECURITY INVOKER` + `current_user NOT IN ('authenticated','anon')` shape of
  the guard is the correct way to distinguish privileged writers, and the header's
  account of why the obvious membership check would have broken morphing,
  membership maintenance and erasure is accurate against the three writers I can
  read.
- **One item blocks deployment**, and it is a question, not a fix: §3.4 query 1.
  If invite matching reads `public.users.email`, remove `email` from the allowlist
  before deploying. If it reads `auth.users.email`, deploy as designed.
