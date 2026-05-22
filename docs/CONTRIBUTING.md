# Contributing

This is how we ship code. Read it once, follow it for every change.

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

## 4. Wait for CI

Two checks run on every PR:

| Check | What it does |
|---|---|
| **Type check** | `npx tsc --noEmit` against the whole project |
| **Unit tests** | `npm test -- --run --project unit` |

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

- Migrations live in `supabase/migrations/` and are timestamped.
- Apply migrations against **staging first**, verify, then apply to
  production.
- Migrations are tracked by Supabase — never edit a migration file
  that has already been applied. If you need to change something,
  write a *new* migration that alters the prior change.
- Service-role keys never leave Bitwarden or `.env.local` — never
  paste them into chat, GitHub, Slack, or anywhere else.

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
