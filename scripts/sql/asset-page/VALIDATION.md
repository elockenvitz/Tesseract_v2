# Asset Page 2.0 — integration validation, and what is NOT covered

Run 2026-10-11 against production (`wfcebeagznzgeuyysbnt`), read-only.
No production record was modified.

---

## What WAS validated

### 1. The real application boots with real providers

`npx vite build` succeeds (55.5s, exit 0). Loaded the real dev server —
**not** the harness, so the real `OrganizationProvider`, `AuthProvider` and
query client are in the tree:

```
title:               Tesseract - Investment Dashboard
rendered:            Sign in to your account … Email address Password … Sign in
root has children:   1
genuine JS errors:   none
```

The only console errors are two pre-existing CSP warnings about
`frame-ancestors` and `X-Frame-Options` in `<meta>`, which predate this work
and are unrelated to it.

This is the check that would have caught an import cycle, a TDZ error or a
provider crash introduced by 2B-2E. It passes.

### 2. The authenticated DATA LAYER, as a real user

`authenticated-read-validation.sql` runs the query shapes
`useAssetDecisionTimeline`, `useAssetWorkspace` and `DecisionMemorySummary`
issue, with `set local role authenticated` and a real user's JWT claims, inside
a transaction that ends by raising. As `elockenvitz@gmail.com` (Tesseract):

```
OK  both fixture securities resolve as authenticated
OK  HELD AAPL: ideas=11 requests=1 ruled=0 withdrawn=0 committed=0 unfilled=0
    executions=2 verified=2 outcomes(all/timeline)=4/0 books=3
OK  no visible outcome outlives an invisible parent (the #252 invariant)
OK  observed executions (2) cannot exceed total (2)
OK  scoping narrows: one book=0 of 2 executions
OK  UNHELD AA: every read returns zero -- the empty path is reachable
OK  quote basis columns on assets: current_price
```

Three of those numbers are worth reading rather than skimming:

- **`requests=1` where 22 exist.** Per-portfolio-team scoping, working. This
  user is on 10 AAPL books but only 1 of the 22 requests is on a book whose
  team they are on. The coverage note exists precisely because of this.
- **`outcomes(all/timeline)=4/0`.** Four price-target outcomes are visible and
  NONE match the timeline's `status IN ('hit','missed','expired')` filter —
  they are all still pending. So no Outcome row renders for AAPL today. That is
  correct: a pending target is not a scored outcome.
- **`executions=2 verified=2`.** Both AAPL executions this user can see were
  genuinely observed, so no unobserved-execution caveat appears for them.

## What was NOT validated, and exactly why

**Authenticated UI interaction — opening the Asset Page as a logged-in user —
could not be done.** It stops at the login screen, for these specific reasons:

1. **No credential exists anywhere I can reach.** `.env.local` carries only
   `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`. A repo-wide search for
   `TEST_USER_PASSWORD`, `E2E_PASSWORD`, `PLAYWRIGHT_USER` and `TEST_EMAIL`
   returns nothing.
2. **No stored session.** Nothing in the worktree holds a Supabase session.
3. **No auth bypass or authenticated e2e suite.** The only Playwright suite
   that builds the real app is `invite-entry.spec.ts`, and it **stubs** the
   auth endpoints (`page.route('**/auth/v1/signup**')`). It never signs in.
4. **Minting a session with the `service_role` key was deliberately not
   done.** The admin API would write rows to `auth.sessions` /
   `auth.refresh_tokens` in production — which the instruction forbids — and it
   would be impersonating a named person's account.

A JWT signed locally with the project's JWT secret WOULD authenticate PostgREST
without writing anything, which is the one technically read-only route. It is
still fabricating an auth token for a real user's identity, so it is not
something to do without being asked for it directly.

**What would unblock it:** a session or credentials provided deliberately — e.g.
typed into the session with `!` — or a seeded test user on staging. Note that
staging is NOT equivalent: the three 2026-10-11 migrations
(`price_target_outcomes` tenant isolation, the coverage notification fix, the
atomic org delete) were applied to **production only**, so staging would
exercise a different read model and prove less than nothing about this one.

**Also still unverified:** quote freshness end to end. `assets.current_price`
exists, but there is no `last_price_update` or `price_as_of` column on
`assets`, so the "as of" labelling on these surfaces is fed from the live quote
hook rather than from a stored timestamp — and that hook needs a backend plus a
session to exercise.

## Regressions found by this pass

None. The build is clean, the provider tree mounts, every authenticated read
returns a self-consistent result, and no invariant is violated.

## Reproducing

```bash
# 1. The build and boot check
npx vite build
npx vite --port 5191            # loads to the login screen, no errors

# 2. The authenticated data layer (read-only, aborts by construction)
#    via the Management API query endpoint, or psql as a superuser:
psql "$DATABASE_URL" -f scripts/sql/asset-page/authenticated-read-validation.sql
```

The script ends by raising on purpose. A clean run prints the OK lines inside
the error message and commits nothing.
