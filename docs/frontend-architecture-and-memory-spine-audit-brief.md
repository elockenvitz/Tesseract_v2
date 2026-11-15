# Frontend architecture & Memory Spine audit — read-only brief

**Status: a brief, not an implementation.** Nothing in here authorises building
Memory Spine infrastructure. The output of this next phase is a map and a
priority list, to be memorialised in the team Google Sheet.

Written 2026-11-14, at the close of the ACT AI 2.4 / Asset Workspace cycle.
Main at that point: see `docs/act-ai-2-4-release.md`.

---

## Why this phase exists

The product's core claim is a decision ontology: investment workflow captured
as typed, linked entities rather than text. The release just closed shows the
claim is only partly true in the frontend. Three findings from it are the
reason this audit is worth doing before any new feature:

1. **The same question had two answers.** "Has this price target expired?" was
   computed independently by the Dashboard lens and by the Asset Page, from
   different anchors with different arithmetic, and they disagreed on 18 of 26
   live rows. Neither was obviously wrong in isolation. One was found only by
   querying production and comparing.
2. **A stored status silently went stale.** `price_target_outcomes.status` held
   `pending` on five rows whose own horizon had passed months earlier, because
   nothing moves a lifecycle column on a schedule. A stored state with no
   writer is a fact nobody is maintaining.
3. **Whole features were unreachable and looked finished.** Trade Lab views
   and notebook notes had RLS on with no policy; the artifact save form is
   complete and gated behind a table that does not exist. Reading the code
   does not tell you which surfaces a user can actually get to.

The pattern in all three: **the frontend holds derived knowledge that no single
owner is responsible for.** That is the thing to map.

---

## The question to answer

For each domain below, establish:

- **Canonical object** — which table is the source of truth, and which tables
  merely resemble it.
- **Owner** — who may write it, enforced where (RLS policy, trigger, RPC).
- **Lifecycle** — the states it moves through, what moves it, and whether
  anything moves it *on time*.
- **Derived readers** — every surface that computes something from it, and
  whether they share one rule or each own a copy.
- **History** — what event record exists, and whether the current state can be
  reconstructed from it.
- **Dead ends** — surfaces that cannot be reached, writes that never persist,
  events dispatched with no listener.

The last two are the Memory Spine's actual input. The first four are what make
the answer trustworthy.

---

## Domains to map

Ordered by how much decision history they are supposed to carry.

### 1. Notes and Quick Thoughts
The lowest-ceremony capture path, and the one most likely to hold reasoning
that exists nowhere else. Establish whether a thought can be promoted into a
typed entity or only referenced. `quick_thoughts` tenant isolation was
remediated; confirm the four-verb posture still holds.

### 2. Assets, Themes, Lists and Coverage
The subject layer. A `ResearchSubject` abstraction already spans assets and
themes — map what it does and does not cover. Coverage has near-zero adoption
and admin-only RLS; decide whether it is part of the spine or a separate
concern. `asset_lists` is documented as deliberately not org-scoped; confirm
that is still the intent.

### 3. Prompts and research templates
Where the firm's method is encoded. Theme/research templates, fields and
sections have parity; the contribution-audience work shipped. Establish
whether a template change is versioned or destructive, because a thesis
written under an old template is history.

### 4. Idea Pipeline and Trade Ideas
Where a view becomes a candidate. Map the boundary between an idea, a
recommendation and a committed trade — the release found `decision_requests`
has no `asset_id`, so the decision chain is four records, not one.

### 5. Recommendations, Decision Inbox and Trade Lab
The approval path. Trade Lab execute is PM-only; snapshots and access tiers
exist. Confirm which Trade Lab surfaces are reachable — several views were
found to be dead code rather than broken features.

### 6. Portfolio Simulation and Holdings
`portfolio_holdings` aggregation collapse is a documented recurring defect
class; there are also two duplicate portfolio-membership tables, where a
collaborator added in the UI is invisible to half the app. Both belong in the
map as known structural faults, not bugs to fix mid-audit.

### 7. Trade Book and Outcomes
`accepted_trades` is the only committed trade; `trade_batches.source_type` is
a lossy rollup of per-trade `source`. Outcomes are where the spine's value
shows — a decision whose result was never scored has no memory. Note that two
real trades carry contaminated seeded prices and outcomes were never scored.

### 8. Workflows, Projects and deliverables
The work-tracking layer. A branch trigger is known to die `55000/42703` with
an undeployed fix, armed by publishing a template. Map which workflow state is
authoritative versus displayed.

### 9. Dashboard / Ideas Feed
Pure derivation — it owns no entity and computes everything. The best place to
find duplicated rules, and where the expiry divergence was found. Treat every
lens as a candidate owner-less rule.

### 10. Asset Workspaces
The contextual surface just shipped. It reads a tab descriptor or a typed
event; its retention and scroll continuity are now explicit. Map what it reads
versus what it owns — the answer should be "owns nothing".

### 11. ACT AI, conversations and artifacts
`ai_conversations` has no `organization_id` by design — one list across all
orgs. Artifacts are authored but the table is unapplied. This is the domain
where the spine is most likely to be *created* rather than mapped, so the
audit must be especially careful to record what exists today.

### 12. Existing history and event infrastructure
`audit_events` carries activation milestones; a Memory Spine V1 and Execution
Truth already shipped (acceptance is not execution, enforced in code);
decision memory and dispositions are parked with a hard-gated draft migration.
**Start here, not at domain 1** — knowing what history already exists prevents
the audit proposing a second one.

---

## Method

Read-only, and evidence-based rather than document-based. Three rules learned
the hard way in the cycle just closed:

- **Query production, do not read migrations.** The migration files do not
  describe the live database: the applied ledger uses different version
  strings than the repo filenames, `ai_project_folders` is applied without
  appearing under its filename version, and `analyst_price_targets.target_date`
  exists but is null on every row. A claim about the schema needs a query
  behind it.
- **Trace to a rendered component, not a service call site.** A hook with
  callers is not a reachable feature. This is how dead features were found to
  be dead rather than broken.
- **A count that is not grouped by organization is wrong.** The Management API
  bypasses RLS and merges 26 pilot orgs.

Two cautions specific to this tooling: the Supabase MCP `execute_sql` tool is
a **read-write** connection to production with no confirmation prompt for DDL,
and the demo corpus is largely junk, so demo-tenant output is not evidence
that anything works.

---

## What a good output looks like

Per domain, one page: canonical table, writer, lifecycle diagram, the list of
derived readers with whether they share a rule, the event record, and the dead
ends. Plus one cross-cutting list — **every place two surfaces answer the same
question independently** — which is the Memory Spine's priority queue, ranked
by whether a disagreement would be visible to a user.

The expiry divergence closed in this release is the worked example of one
entry on that list, start to finish: two readers, measured disagreement,
one rule, a test that reproduces the original divergence.
