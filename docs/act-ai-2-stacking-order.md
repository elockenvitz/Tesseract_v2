# ACT AI 2.0 — what is stacked on what

This file exists because the whole initiative sits in one pull request
(**#291**, `discovery/asset-page-2`) rather than seven, and a squash merge
collapses seven commits into one. If any of this has to be re-landed, split or
reverted in parts, the order below is what makes that possible.

Written 2026-11-11. Branch base: `origin/main`.

---

## The commits, oldest first

Each one builds on the one above it. The dependency is listed where it is not
simply "the previous commit".

| # | Commit | What it is | Depends on |
|---|--------|------------|------------|
| 1 | `4b690fbb` | A shared presentation layer for AI responses (`src/lib/ai`, `src/components/ai`) | — |
| 2 | `1b53f0ae` | Expanded research mode, and context the pane can prove | 1 |
| 3 | `5bb6e7b3` | **Section A.** ACT AI branding, one expand control, a first open that does not flinch | 1, 2 |
| 4 | `c2e9ff9a` | **Section C.** Five new retrieval tools and the visibility-scope contract | 1 |
| 5 | `8d8fdc3f` | **Section B.** Grounded suggestions, ranked by a deterministic layer | 4 (reads what 4 made reachable) |
| 6 | `ba437842` | **Section E.** Evidence that says how far it could see | 4 (`TOOL_VISIBILITY` is declared there) |
| 7 | `12581f14` | **Section D.** The presentation contract, mirrored into the edge prompt | 1, 6 |
| 8 | `58cc484d` | Org-scoping fix for the suggestion counts | 5 |
| 9 | `8b593ba3` | **Sections F+G.** The ACT AI Briefing on the asset Snapshot | 1, 4, 6, 7 |

Three merge commits from `origin/main` are interleaved (`7bbf0422`,
`2d2fd080`, `914a7b49`). They carry no initiative work.

## The parts that cannot be separated

**4 before 5 and before 6.** Commit 4 introduces `TOOL_VISIBILITY`, the table
that declares each retrieval tool's scope as `organization`, `caller_visible`
or `caller`. Commit 6's trail sentences read that table, and commit 5's
suggestion wording depends on knowing a count is partial. Landing 5 or 6
without 4 does not fail to compile — it silently loses the scope and the panel
goes back to saying "No matching records." in its own voice, which is the one
sentence the brief forbids.

**6 before 7.** The presentation contract in 7 tells the model how to attribute
a figure to a record. The records it attributes to are the source refs 6 added.

**6 before 9.** The briefing opens its research trail by default. Without 6 the
trail has no excerpts, no record state, and no scoped sentence — which is most
of what makes a briefing readable instead of a wall of prose with a JSON
appendix.

**1 under everything.** Both the chat pane and the briefing render through
`src/components/ai`. That is the thing that stops the two surfaces describing
one lookup two different ways, and it is why section G required no second
backend.

## If a squash merge happens

A squash lands all nine as one commit, which is fine — nothing here is meant
to be reverted independently in production. What is lost is the reasoning in
the individual commit messages, several of which record defects found and the
injections that proved a gate works. Before squashing, keep the full messages:

```
git log --format='%H%n%B' origin/main..discovery/asset-page-2 > act-ai-2-commits.txt
```

## What is NOT in this stack

- The parked Work-mode redesign. Section F explicitly does not absorb it.
- `/asset/:id` routing, deferred from the UX1 redesign.
- Any migration. This initiative applies none, and `db push` must not be run.
