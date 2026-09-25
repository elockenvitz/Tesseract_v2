# Deferred: EXECUTE granted to PUBLIC on the tenancy helpers

**Status:** open, deliberately deferred out of the Files V1 rollout
**Raised:** 2026-09-27, during the Files V1 production preflight
**Scope:** cross-product — not a Files concern

## The observation

Read from the production catalog (`pg_proc.proacl`) on 2026-09-27:

```
current_org_id                      postgres=X/postgres | anon=X | authenticated=X | service_role=X
is_active_member_of_current_org     =X/postgres | postgres=X | anon=X | authenticated=X | service_role=X
is_active_org_admin_of_current_org  =X/postgres | postgres=X | anon=X | authenticated=X | service_role=X
```

The leading `=X/postgres` on the two helpers is `EXECUTE` granted to
**PUBLIC**. `current_org_id()` does not carry it. So three functions that are
otherwise a matched set, written by the same lane and called by the same
policies, disagree about who may execute them.

## Why it is not being fixed here

The Files V1 helper migration originally ended with:

```sql
REVOKE ALL ON FUNCTION public.is_active_member_of_current_org() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_active_org_admin_of_current_org() FROM PUBLIC;
GRANT EXECUTE ... TO anon, authenticated, service_role;
```

and described itself as a no-op against production. The bodies are a no-op;
the grants are not. That REVOKE removes a live privilege.

Three reasons it was pulled out rather than shipped:

1. **Blast radius is not Files-shaped.** These two helpers are referenced by
   policies introduced across roughly 25 migrations. The change touches every
   one of them; Files is a rounding error in that set.
2. **The failure mode is a hard error, not a closed door.** If some role
   reaches these only via PUBLIC, losing EXECUTE does not make its policy
   return no rows — the function call raises, and the whole query fails. That
   surfaces as a broken page, not as a tightened boundary.
3. **Files does not need it.** Files RLS is evaluated as `authenticated`,
   which holds an explicit grant either way. The rollout gains nothing from
   bundling it.

Shipping a privilege change inside a migration whose stated purpose is "make
the repo agree with production" is also how a security change lands without
anyone reviewing it as one.

## What a proper fix needs

- Enumerate every role that can currently reach these two functions **only**
  through PUBLIC. `anon`, `authenticated`, `service_role` and `postgres` all
  hold direct grants, so the question is what else exists — Supabase-internal
  roles (`authenticator`, `supabase_admin`, `supabase_storage_admin`,
  `dashboard_user`) and anything created by hand.
- Decide whether `current_org_id()`'s posture is the target, or whether it is
  the outlier and the other two are right.
- Apply to all three together, so the set stops disagreeing.
- Do it when it can be observed — not bundled behind a feature rollout.

## Related

The same review should cover the loose storage policies found during the
same preflight, none of which are Files:

- `model-templates` — all four verbs to any authenticated user, bucket-wide
- `thought-attachments` — `SELECT USING (bucket_id = 'thought-attachments')`,
  bucket-wide
- `captures` — `SELECT` granted `TO public`
- `org-exports` — no `storage.objects` policy in any migration
