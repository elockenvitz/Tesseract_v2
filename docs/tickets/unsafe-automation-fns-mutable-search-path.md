# The two unsafe automation functions still have a mutable search_path

**Status:** open, deliberately out of scope for the November 2026 security release
**Opened:** 2026-11-06
**Priority:** low — both are now unreachable by `anon` and `authenticated`, so
the only roles that can trigger it are `service_role` and `postgres`, which can
already do anything

## What is wrong

`public.execute_single_automation_rule(uuid, uuid, text)` and
`public.evaluate_pending_rules()` are both SECURITY DEFINER and neither pins its
`search_path`. Supabase's own linter flags them:

```
WARN  function_search_path_mutable  execute_single_automation_rule
WARN  function_search_path_mutable  evaluate_pending_rules
```

Confirmed from the catalog after the release:

| function | security | search_path pinned |
|---|---|---|
| `execute_single_automation_rule` | DEFINER | **no** |
| `evaluate_pending_rules` | DEFINER | **no** |

A SECURITY DEFINER function with an unpinned `search_path` resolves unqualified
object names through the *caller's* search_path while running with the owner's
privileges. If a caller can create an object in a schema that sorts ahead of
`public`, it can shadow a table or function the body references.

## Why it was not fixed in this release

Migration C2 (`20261106160400`) is deliberately privilege-only: four REVOKEs and
two GRANTs, no `CREATE OR REPLACE`. Pinning the search_path means replacing both
bodies, and both are large automation executors that this release did not read
line by line or test functionally. Replacing them to fix a lint would have put
untested body changes into an emergency authorization release.

The other twelve functions in the release all gained
`SET search_path TO 'public', 'pg_temp'` because they were being replaced anyway.

## Why the severity is low

C2 removed `authenticated` and `anon` EXECUTE from both. Measured after the
release:

| role | `execute_single_automation_rule` | `evaluate_pending_rules` |
|---|---|---|
| `anon` | no | no |
| `authenticated` | no | no |
| `service_role` | yes | yes |
| `postgres` | yes | yes |

So exploiting the mutable search_path now requires already holding
`service_role` or `postgres`, and both of those bypass RLS outright. There is no
privilege to escalate from. Before C2 this was a genuine concern, because any
logged-in user could call both.

Also worth noting: `pg_temp` is where a shadowing object would most plausibly be
planted, and neither function's caller set can create temp objects through the
API.

## The fix

Add `SET search_path TO 'public', 'pg_temp'` to both, and schema-qualify every
object reference in both bodies. That is a `CREATE OR REPLACE` of two large
functions, so it needs its own change with functional tests of the automation
executor, not a one-line amendment.

Do it together with the pre-existing automation defects already on file, since
they touch the same code: see
[branch trigger schema drift](../../README.md) notes on
`auto_create_workflow_branch()` dying `55000` / `42703`.

## Scope note

Not a regression. Both functions had a mutable search_path before this release
as well; the release neither introduced nor widened it, and in fact narrowed who
can reach it from "every logged-in user" to "service_role and postgres only".
