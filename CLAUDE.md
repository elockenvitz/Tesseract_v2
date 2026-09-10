# Tesseract — Claude Code Project Instructions

## What this is
Mobile-first financial intelligence platform for institutional buy-side
investors. The product's core is a decision ontology: unstructured investment
workflow captured as typed, linked database entities — not generic text records.
When a change would flatten a typed entity into free text, stop and flag it.

## Stack
- Frontend: React + TypeScript + Vite
- Backend: Supabase (Postgres with Row Level Security)
- Deploy: Netlify
- VCS: GitHub, with branch protection and required checks (`enforce_admins` on)

---

## Command hygiene

These exist because violating them makes every action slow. Auto mode routes
each command through a classifier before it runs, and commands that hide their
own operation get denied and retried.

- **Never prefix a command with `cd`.** You are already in the correct working
  directory. A compound command opening with a directory change conceals the
  real operation and will be denied.
- **Never modify files with shell commands.** No `node -e`, no `sed`, no
  PowerShell string replacement. Use the Edit and Write tools. They are faster,
  they bypass the classifier entirely, and they cannot be broken by quote
  escaping.
- **One Edit call per change.** Do not batch multiple edits into a single
  scripted command.
- **Never start the dev server.** A canonical server runs on port 5190 already.
  Starting vite or `npm run dev` in the foreground blocks until timeout.
- Prefer PowerShell-native commands over bash builtins on this machine.

---

## Standing rules

### 1. Findings lead by severity
When reporting on an audit, review, or investigation, order findings by
severity — highest first. Do not open with methodology, scope, or a summary of
what you did. Open with the worst thing you found.

### 2. Evidence applies to verification, not modification
Make file changes with Edit and Write — no narration needed. Show artifacts for
the *checks*: test output, typecheck results, `git diff` after edits land, the
failing case. "I verified X" without an artifact is a hypothesis, not evidence.

### 3. Gates must be proven non-vacuous
Any check, gate, ratchet, or test you add must be proven to fail when it should.
Inject a deliberate failure and show the gate catching it. This is a documented
recurring defect class in this codebase:
- CI typechecks that pass because they type-check nothing
- Ratchets that assert a threshold rather than the subject the threshold governs
- ESLint configs that exit 0 on internal error
If a gate cannot observe its own failure mode, it is decoration.

### 4. Scope discipline
Do the task asked. If you find adjacent problems, list them at the end as
separate findings — do not fix them in the same change. Unbundled work is
reviewable; bundled work is not.

---

## Known defect classes — check for these

- **Weight inflation**: silently corrupts conviction card output. Any change
  touching weight computation needs an explicit numeric check.
- **Portfolio holdings collapse**: present across most aggregating query sites.
  Verify aggregation behavior anywhere holdings are grouped or summed.
- **Temporal dead zone**: a TDZ error in banner code previously broke the feed
  on every render. Watch initialization order in component-level code.
- **Demo tenant data quality**: the demo corpus is largely junk. Do not treat
  demo-tenant output as evidence that a feature works.
- **Generic status mapping**: rows without a due date have been mis-mapped to
  Overdue and rendered with an empty hero slot. When a card derives a metric
  from a single field, handle the absent-field case at the source rather than
  compensating downstream.

## RLS
Supabase RLS policies are partially audited (`asset_notes`, `asset_models`
fixed). Gaps remain. Any new table, view, or query path requires an explicit
statement of its RLS posture — do not assume a policy exists. Never widen a
policy to make a query work without saying so prominently.

## Data provenance
Benchmark weights derive from SSGA/SPY ETF holdings as the active-risk proxy.
Provenance is enforced: any figure surfaced to a user must be traceable to its
source. Do not introduce derived numbers without a provenance path.

---

## How to work with me

I am a non-technical founder. That changes what good output looks like:

- Explain *what* a change does and *what could break*, in plain language,
  before the diff.
- Do not assume I will catch a subtle correctness problem in review. Say it.
- If I ask for something that is a bad idea, say so directly and say why.
  Agreement I can't evaluate is worse than disagreement I can.
- Prefer one reviewable change per session over a large multi-part change.

## Definition of done
1. The change works, demonstrated by an artifact.
2. Typecheck and lint pass, and I have confirmed they actually ran.
3. RLS posture stated if any data path changed.
4. Any adjacent problems found are listed, unfixed, at the end.
