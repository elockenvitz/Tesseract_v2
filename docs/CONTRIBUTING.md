# Contributing

This is how we ship code. Read it once, follow it for every change.

---

## Environments

Three environments. The point of three is to catch each kind of bug at
the cheapest possible place.

| Env | What it is | Database | Who uses it | Cost of breaking |
|---|---|---|---|---|
| **localhost** | `npm run dev` on your laptop | **staging** (via `.env.local`) | Just you | Free — restart |
| **staging** | https://tesseract-platform-staging.netlify.app | staging Supabase | You as a test user | Free — wipe and redeploy |
| **production** | https://tesseract2025.netlify.app | prod Supabase | Real pilot users | Real — a pilot has a bad day |

Key rules:

- **`.env.local` points at staging by default.** Local dev cannot touch
  prod data. To temporarily point at prod (e.g. to reproduce a real
  pilot bug), comment out the staging block in `.env.local` and
  uncomment the prod block. Switch back when you're done.
- **Staging is empty by design.** It has the same schema as prod but
  no real data. To preview pilot flows, run `node scripts/seed-staging.mjs`
  (see [Seeding staging](#seeding-staging) below).
- **Never test risky changes in prod.** Run them through staging first
  — the [staging branch](#5-test-on-staging-for-anything-risky) flow
  exists for exactly that.

---

## The flow

```
git pull main  →  feature branch  →  PR  →  CI green  →  review  →  squash-merge  →  auto-deploy
```

`main` is protected. You **cannot** push to it directly — even by
accident. Every change goes through a pull request that gates on CI.

---

## 1. Start a branch

Branch off the latest `main`:

```bash
git checkout main
git pull --ff-only
git checkout -b <type>/<short-description>
```

Branch naming convention:

| Prefix | Use for |
|---|---|
| `feat/` | New user-facing functionality |
| `fix/` | Bug fix |
| `chore/` | Infrastructure, deps, config, repo hygiene |
| `refactor/` | Internal code changes with no behavior delta |
| `docs/` | Documentation only |

Examples: `feat/decision-inbox-bulk-accept`, `fix/sim-table-keyboard-nav`,
`chore/upgrade-vitest-to-5`.

---

## 2. Make changes, commit, push

Commit messages follow [Conventional Commits](https://www.conventionalcommits.org/):

```
type(optional-scope): short description

Optional longer body — explain the *why*, not the *what*. The diff
already shows what changed.
```

Examples:

- `feat(trade-lab): keyboard-driven row selection`
- `fix(pilot): per-org unlock keys not refreshed after reset`
- `chore(ci): bump Node to 22 to match local`

Push your branch to the remote:

```bash
git push -u origin <your-branch-name>
```

---

## 3. Open a PR

GitHub prints a `Create pull request` URL after you push — open it.

- **Base**: `main` (or `staging` for risky changes that need
  pre-prod verification first)
- **Compare**: your branch
- Use the PR template (`.github/pull_request_template.md`) — fill
  in **What**, **Why**, **Test plan**, **Risk**, and any **Screenshots**
  if there's a UI change

---

## 3.5 The test loop

Run the cheap thing while you work and the expensive thing once at the end.
Timings are from a 16-core dev machine, Aug 2026.

**While iterating** — pick the narrowest level that covers what you changed:

| Level | Command | ~Time |
|---|---|---|
| Pure logic | `npx vitest run --project unit <file>` | 7s |
| Types | `node scripts/typecheck-cards.mjs --fast` | 10s warm |
| One browser test | `npm run test:phone -- e2e/explore.spec.ts -g "320px"` | 15s |
| One browser spec | `npm run test:phone -- e2e/explore.spec.ts` | 19s |
| Fast guard | `npm run guard:quick` | 34s warm |

**Before opening a PR** — once:

```
npm run guard
```

`npm run guard` is the gate and its meaning has not changed: ci, holdings,
unit, tdz, types, layout. Roughly 2m40s.

### Two traps

**`npx tsc --noEmit` checks zero files.** The root tsconfig is solution-style
with `"files": []`, so it exits 0 whatever the code says. Never quote it as
evidence. Use `npm run typecheck` (whole app, reports the ~8.8k historical
backlog, informational), `npm run typecheck:all` (`tsc -b`), or
`npm run guard:types` — which is the actual gate: card surface only, ceiling
of zero, plus a floor on how many files tsc loaded so a misconfigured run
fails instead of passing.

**Phone tests run against the BUILT gallery.** `npx playwright test` serves
`dist-gallery`, so after a source change it tests the previous bundle. Use
`npm run test:phone`, which rebuilds first. Skipping that once cost an
afternoon: a probe reported a card at 1155px while the source said 836, and
the flex chain got investigated before the stale bundle turned out to be the
whole story.

### When a browser test fails

Isolate it, fix it against that one test, then widen. Do not answer one
failing test by re-running the whole suite:

```
full suite -> failure X -> npm run test:phone -- <spec> -g "X" -> fix
           -> targeted passes -> affected spec passes -> full guard once
```

## 4. Wait for CI

Three checks run on every PR:

| Check | What it does |
|---|---|
| **Type check (cards)** | `npm run guard:types` — card surface at zero errors |
| **Unit tests** | `npm run guard:unit` |
| **Card layout** | `npm run guard:layout` — gallery build + phone Playwright |

Both must pass before merge. The Merge button is disabled until they
do.

If CI fails, click `Details` on the failing check → read the logs →
push a fix to the same branch. CI re-runs automatically; you don't
need to re-open the PR.

---

## 5. Test on staging (for anything risky)

For PRs that touch business logic, RLS, or any user-facing
behavior, **target the `staging` branch first, not `main`**:

```
your branch → PR to staging → merge → auto-deploy to staging.tesseract-platform.netlify.app
                                       ↓
                                       test in staging
                                       ↓
                                       PR from staging to main
```

Staging has its own Supabase project with synthetic data. Pilots
never see staging. The point is to verify destructive changes
(schema migrations, data shape shifts, large refactors) before they
land on `main` and auto-deploy to production.

Small changes that obviously can't break production (typo fixes,
README edits, doc-only PRs) can skip staging and go straight to `main`.

---

## 6. Merge

After CI is green and review is approved:

- **Squash and merge** (default). Keeps `main` history clean — one
  commit per feature, not 47 WIP commits.
- The squashed commit message uses your PR title; edit it if needed.
- Delete the branch after merging (button on the merged PR page).

Merging to `main` auto-deploys to production via Netlify (~3 min).

---

## Rolling back a bad deploy

If a merge to `main` causes a regression in production:

1. Go to the merged PR.
2. Click `Revert` (top-right). This opens a new PR that undoes the merge.
3. Merge the revert PR — auto-deploys the rollback in ~3 min.

For database migrations: reverting frontend code is fine, but **DB
schema changes are NOT automatically reverted** by a code revert.
If you shipped a migration and need to roll back, you need to write
a reverse migration. Plan for this when designing migrations
(prefer `ADD COLUMN nullable` over `DROP COLUMN`; ship the data shape
change ahead of the code that uses it).

---

## Migrations & database changes

`supabase/migrations/` is the source of truth for schema. Every change
to the database goes through a migration file, even if you initially
made it via the dashboard. The flow:

1. **Make the change locally** — easiest path is to use the Supabase
   dashboard for the staging project to draft the SQL, since localhost
   points at staging anyway.
2. **Capture as a migration file** in `supabase/migrations/` with a
   timestamped name: `20260523120000_short_description.sql`. The file
   should contain the full DDL (`CREATE TABLE …`, `ALTER TABLE …`),
   not a description.
3. **Apply to staging** via the apply script:
   ```
   SUPABASE_PROJECT_REF=pdajkwtrrjcqnjsyvyqt \
     node scripts/apply-migrations-to-staging.mjs
   ```
   The script is idempotent — re-applying a migration that already
   ran is a no-op.
4. **Verify on staging** — sign up, click through the affected flow,
   confirm the schema is what you expected.
5. **Apply to prod** the same way, with the prod project ref:
   ```
   SUPABASE_PROJECT_REF=wfcebeagznzgeuyysbnt \
     node scripts/apply-migrations-to-staging.mjs
   ```
   (Yes, the script is named "staging" but works against any project
   ref. Confusing name, will rename.)
6. **Commit and PR** the migration file. The merged PR is the
   permanent record of the change.

Rules:

- **Never edit a migration file that has already been applied** to
  prod. If you need to change something, write a *new* migration.
- **Migrations should be backwards-compatible** when possible. Ship
  the schema change first, then the code that uses it. That way a
  rollback of the code doesn't strand prod with a broken schema.
- **Prefer additive changes** (`ADD COLUMN nullable`, `CREATE TABLE`)
  over destructive ones (`DROP COLUMN`, `DROP TABLE`). Destructive
  migrations are hard to undo.
- **Service-role keys never leave Bitwarden or `.env.local`** — never
  paste them into chat, GitHub, Slack, or anywhere else.

### Seeding staging

Staging is empty by design. To get useful test data:

```
SUPABASE_PROJECT_REF=pdajkwtrrjcqnjsyvyqt \
  node scripts/seed-staging.mjs
```

This creates a test org, sample assets, and a few trade ideas so the
dashboard renders something interesting when you log in. Run it any
time staging feels too empty to test against. Safe to re-run — it's
idempotent (uses upserts).

---

## Security & secrets

- **No secrets in source code.** Anything in `.env.local` is
  developer-local; production secrets are in Netlify's env-vars dashboard.
- `.env.local`, `.mcp.json`, and any `*.local` files are gitignored.
- If you accidentally commit or paste a secret anywhere it shouldn't
  be: assume it's compromised, rotate it immediately, and revoke
  the old token.
- Secrets are stored centrally in our Bitwarden vault (folder
  `Tesseract`). Add a new entry there any time you create or rotate
  a credential.

---

## What you don't have to do (yet)

- **You don't have to fix every ESLint error you see.** We have a
  4,666-error backlog being cleared in a separate effort. Fix lint
  errors in code you change; don't go on cleanup safaris in
  unrelated files.
- **You don't have to add tests for every change.** Tests are
  encouraged but not required — see what's `__tests__/`'d already
  and follow the pattern when modifying that subsystem.
- **You don't have to be in a hurry.** PRs that take a day or
  two to land are fine. PRs over a week start to rot — split them.
