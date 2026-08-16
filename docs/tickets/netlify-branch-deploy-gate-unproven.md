# Deploy gate is proven locally, unproven on Netlify

**Status:** parked
**Opened:** 2026-08-15
**Priority:** medium — the gate is believed to work; what is missing is the remote proof

## Claim under test

`netlify.toml` now sets:

```toml
command = "npm run guard && npm run build"
```

If `npm run guard` fails, the build must fail and no `dist/` must be published.
Before this line existed there was **no build command at all**, which is why
main's CI could be red across three merges and every one of them still shipped.

## What is proven

**Locally: definitive.** With `MAX_KNOWN_UNSCOPED` raised to 110 on branch
`ci/prove-deploy-gate`, the exact Netlify command exits non-zero and produces
no output directory:

```
$ npm run guard && npm run build
  ... ratchet assertion fails ...
exit: 1
$ ls dist
  ABSENT
```

That is the shell semantics of `&&` and it cannot behave differently on
Netlify's runner.

## What is not proven

**Remotely: inconclusive.** Both the deliberately-red and the restored-green
commits on `ci/prove-deploy-gate` returned **HTTP 404** for the branch deploy
URL, and Netlify reported **0 checks** against either SHA. A 404 on both the
red and the green state proves nothing about the gate — it means Netlify is
not building this branch at all.

Branch deploys were switched on mid-investigation, so the most likely cause is
simply that the branch-deploy scope does not include this branch (Netlify
defaults to "none" or to a named allowlist). It has not been confirmed.

## To close

1. Netlify → Site configuration → Build & deploy → Branches: confirm branch
   deploys include `ci/prove-deploy-gate` (or "all branches").
2. Push the red commit. Expect: deploy **failed**, no branch URL.
3. Push the green commit. Expect: deploy **succeeded**, branch URL serves.
4. Record both deploy IDs here. A green-only result does not close this — the
   red one is the whole test.

## Why it is parked rather than dropped

The local proof is strong enough that the gate is not treated as unknown, and
the branch is preserved. But "the build command is set" and "a failing test
stops a deploy" are different claims, and only the first has an artifact
against the real runner. Until step 2 above produces a *failed* Netlify
deploy, the deploy gate is believed, not verified.

Branch: `ci/prove-deploy-gate` (pushed, do not delete)
