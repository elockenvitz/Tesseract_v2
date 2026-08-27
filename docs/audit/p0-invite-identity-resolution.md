# STOP condition resolved — `auto_accept_pending_invites()` identity source

Closes the blocking question in `docs/audit/p0-writer-review.md` §3.

**Method:** read-only inspection of production via the Supabase Management API
`/database/query` endpoint, using the token in the main checkout's `.mcp.json`.
Only `SELECT` statements were issued (the helper refused anything else). No user
data was read: catalog metadata and function definitions only, scanned for
embedded secrets before being recorded (zero hits).

*Correction to the platform audit:* `docs/audit/platform-readiness-2026-08.md` §0
states no live database was reachable. That was wrong — the check looked for
`Tesseract-v2/.mcp.json` (hyphen) when the checkout is `Tesseract_v2`
(underscore). The audit's findings stand, but its central limitation was
avoidable, and several `[VERIFY]` items in
`docs/audit/production-verification-pack.md` can now simply be answered.

---

## VERDICT

**`auto_accept_pending_invites()` reads `auth.users.email`, keyed on
`auth.uid()`. `public.users.email` has no influence on membership. The email
allowlist decision in `20260826100100` is ACCEPTABLE. `d516136` and `9f7e8f7`
proceed unchanged.**

---

## The answers

### 1–5. Identity, mode, ownership, grants

| | `auto_accept_pending_invites()` |
|---|---|
| Signature | `auto_accept_pending_invites()` — no arguments |
| Security | **SECURITY DEFINER** |
| Owner | `postgres` |
| `search_path` | **not set** — see §Incidental 1 |
| EXECUTE | `authenticated` ✅, `service_role` ✅, `anon` ❌ |
| Directly callable by an authenticated client | **Yes** (`src/lib/org-domain-routing.ts:94`) |

Owner `postgres` also confirms the guard in `20260826100200` will correctly
stand aside for it: inside the function `current_user` is `postgres`, not
`authenticated`.

### 6. Email source — `auth.users.email`

The first statement in the function body:

```sql
v_caller_uid uuid := auth.uid();
...
SELECT email INTO v_caller_email FROM auth.users WHERE id = v_caller_uid;
IF v_caller_email IS NULL THEN
  RETURN jsonb_build_object('accepted_count', 0);
END IF;
```

Not `public.users.email`. Not a JWT claim. Not an argument — the function takes
none. The address is **derived from `auth.uid()`**, which is the one identity a
client cannot forge without the auth server.

### 7. Independent binding to `auth.uid()` — yes, twice over

- The email is looked up *by* `auth.uid()`, so the caller never supplies it.
- The membership is created for `v_caller_uid`, not for anyone named in the
  invite row.

There is no argument through which a caller can nominate a different identity.

### 8. Validation performed

| Check | Present | Implementation |
|---|---|---|
| Invitation status | ✅ | `i.status IN ('pending','sent')` |
| Expiry | ✅ | `i.expires_at IS NULL OR i.expires_at > now()` |
| Organization | ✅ | taken from `i.organization_id`; never caller-supplied |
| Intended recipient | ✅ | `lower(i.email) = lower(v_caller_email)` |
| Existing membership | ✅ | `ON CONFLICT … DO UPDATE … WHERE organization_memberships.status IN ('invited','inactive','pending')` — an already-**active** membership is not rewritten, and `is_org_admin` is preserved when already true rather than downgraded |

The `expires_at IS NULL` branch is intentional, not an oversight: migration
`20260615220000_pilot_invites_no_expiry.sql` sets pilot invites to never expire
because the 7-day TTL was breaking pre-signup provisioning.

### 9. Can writing `public.users.email` influence membership? — **No**

Three independent confirmations from production:

1. **No function authorizes on it.** Zero functions in `public` contain a
   comparison of the form `users.email = …` or `… = users.email`.
2. **The one policy that matches on an email reads `auth.users`.**
   `organization_invites` → *"Org admins or invited user can update invites in
   current org"*:
   ```sql
   lower(email) = lower((SELECT users.email FROM auth.users WHERE users.id = auth.uid()))
   ```
3. **The other invite path is bound the same way.** `accept_org_invite(uuid)` —
   token-based — also does
   `SELECT email INTO v_caller_email FROM auth.users WHERE id = v_caller_uid`
   and raises *"This invite was sent to a different email address"* on mismatch,
   in addition to status and expiry checks.

The attack path hypothesised in `p0-writer-review.md` §3.3 **does not exist**.
Step 2 of it — forging `public.users.email` to influence invite matching — has
no effect on any code path in the database.

---

## Why the allowlist decision is acceptable

`20260826100100` keeps `email` in the `authenticated` UPDATE allowlist and
justifies it as: *"Nothing authorises on `public.users.email` — invite matching
reads `auth.users.email` — so a forged value is a display-level lie, not an
escalation."*

**That statement is correct as written.** Verified against production, not
inferred:

- Both invite RPCs read `auth.users.email`.
- The only email-matching RLS policy reads `auth.users.email`.
- No function compares `public.users.email` to a caller identity.
- `public.users.email` carries no unique constraint (`users_pkey` on `id` is the
  only unique index), which is itself consistent with a display column rather
  than an identity one.

The residual risk is what the migration header already claims: a user can make
their displayed email say something untrue, which appears in member pickers and
mention lists. That is impersonation-flavoured and worth fixing, but it is not
privilege escalation and it does not belong in a P0 whose value is a minimal
blast radius.

---

## Does `public.users.email` need client write access at all?

Asked separately, and the answer is **yes today, no in principle.**

The only database-side writer of `public.users.email` is `handle_new_user()`:

```sql
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION handle_new_user()
```
```sql
INSERT INTO users (id, email) VALUES (NEW.id, NEW.email)
ON CONFLICT (id) DO UPDATE SET email = NEW.email, updated_at = now();
```

**`AFTER INSERT` only.** The single `AFTER UPDATE` trigger on `auth.users` is
`trigger_deactivate_coverage_on_user_ban`, which handles `banned_until` and
`deleted_at` and does not touch email.

So `public.users.email` is stamped once at signup and never re-synced by the
database. That is precisely why `src/hooks/useAuth.ts:116` writes it from the
session — and removing the grant now would leave the column permanently stale
for anyone who ever changes their address in Supabase Auth.

**The clean fix, for a later PR, not this one:** add an
`AFTER UPDATE OF email ON auth.users` trigger that syncs the column, then drop
`email` from the allowlist entirely. That removes both the staleness and the
display-lie in one change, and it is strictly out of scope for a P0.

---

## Incidental findings (none blocking)

1. **`auto_accept_pending_invites()` has no `SET search_path`.** It is
   `SECURITY DEFINER`, owned by `postgres`, executable by `authenticated`, and it
   **grants organization memberships and org-admin flags**. This is the highest-
   value instance of `platform-readiness-2026-08.md` P2-1 found so far. Not
   exploitable on its own — `authenticated` cannot create objects in `public` on
   Supabase — but it is one grant away from being so, and it sits in this PR's
   blast radius. Recommend a one-line follow-up migration.

2. **`accept_org_invite(uuid)` and `create_org_invite(uuid,text,boolean)` are
   executable by `anon`.** Both derive identity from `auth.uid()`, which is NULL
   for `anon`, so both fail closed. The grants are unnecessary and should be
   revoked in the same follow-up.

3. **`anon` currently holds INSERT and UPDATE on all 14 columns of
   `public.users`.** Confirms P0-1 is live and confirms Layer B is needed — the
   pre-change baseline is exactly what `20260826100100`'s header describes.
   Recorded here as the before-state for the staging gate.

---

## Conclusion

- **Q6 answer: `auth.users.email`.** The client cannot modify it.
- **STOP condition cleared.** No change to `20260826100100` is required.
- **`d516136` and `9f7e8f7` proceed unchanged** to the staging procedure in
  `docs/audit/p0-staging-execution-plan.md`.
- Step 7 of that plan (resolve the invite-matching question) is now **complete**;
  it can be marked done rather than run again.
- The three follow-ups above belong in a separate PR and must not delay this one.
