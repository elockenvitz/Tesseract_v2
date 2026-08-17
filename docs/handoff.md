# Handoff — signal card system

Written 2026-08-16. Updated after a production outage the same evening. Read this before touching the mobile feed, the signal card
contract, or anything named `guard`, `ratchet` or `verification`.

---

## 0. The blocker, stated first

**The layout win is impossible while the legacy tiles hold `h-full snap-always`.**

Every legacy tile in `MobileDashboard` sits in a section classed
`h-full w-full snap-start snap-always` — one viewport per card. That container,
not card quality, is why the feed still feels the same with three cards
migrated. Content-height cards inside a viewport-per-item scroller cannot
produce the "several cards visible, finite queue" feel, because the four
remaining kinds keep forcing a screen each.

The path, and none of it has started:

```
remaining four builders  →  delete legacy components  →  content-height scroll
```

Nothing else — not the scanner fix, not the enumeration audit, not Phase 2 —
comes before this. It has been asked for three times and is still not visible.

---

## 1. State of the feed

### On the contract

Three of seven kinds render through `src/components/signals/SignalCardView.tsx`
via builders in `src/lib/signals/builders/`:

| Kind | Builder | Data source |
|---|---|---|
| `active_risk` | `activeRisk.ts` | `portfolio_holdings` + `portfolio_benchmark_weights`, via `activeRiskRows` in `MobileDashboard` |
| `recommendation` | `recommendation.ts` | `trade_queue_items`, via `useRecommendationCards` |
| `news` | `news.ts` | `market-news` edge function, via `useMarketNews` |

Each builder is a pure function returning `CardResult` — `{ok: true, card}` or a
suppression with a reason. Suppressions are logged by `gate()` in
`suppression.ts` with reason, type and entity. `SignalCardView` has **no
per-type branch** and must never grow one; if a type will not render from the
contract, the contract changes.

### Still legacy

`PortfolioLensTile` (conviction / crowding / target breach / stale target),
`DerivedInsightTile`, `TemplateFeedTile` (five kinds: unusual move, earnings
ahead, earnings result, corporate action, economic), `AttentionFeedCard`
(non-trade-queue items), `SignalFeedTile`.

### The flag

`signal-cards`, defined in `src/lib/flags.ts`.

```
https://tesseract2025.netlify.app/?flag=signal-cards      on
https://tesseract2025.netlify.app/?flag=-signal-cards     off
https://tesseract2025.netlify.app/?flag=none              clear
```

Consumed in `main.tsx` **before React mounts**, then persisted to localStorage
and stripped from the URL. It must stay there: the root route redirects with
`<Navigate to="/dashboard" replace />`, which discards the query string, so any
flag read from inside a screen happens after the parameter is gone. That defect
shipped and meant **the flag was never on for anyone** for a full day while
being reported as live. An amber banner now shows the flag state and the count
of contract cards actually in the feed — two separate claims.

### What renders in the real database

Measured against production, orgs `Joe Test Capital` and `Tesseract`:

| Kind | Renders | Detail |
|---|---|---|
| **News** | Yes | The only one that genuinely works today |
| **Recommendation** | 23 cards, **all with no metric** | `has_weight = 0` on every row, so `proposedWeightPct` is null and the metric block is empty. Headline + rationale only |
| **Active risk** | 3 cards, **all making a false claim** | See §3 |

---

## 2. Verification standard

Non-negotiable, and it exists because claims outran artifacts repeatedly here.

- **"Verified" means the artifact**: the SHA, the CI run, the failing output.
  Not the assertion that a check was performed.
- **Say where tests ran.** "80 pass locally" and "80 pass in CI on main at
  `<sha>`" are different claims.
- **Guards are proven by deliberate breakage**, and the breakage must target the
  check's *subject*, not its *threshold* — see §4, instance 4.

Current gates:

| | Netlify (publish) | Branch protection (merge) |
|---|---|---|
| `guard:unit` (org-scope, signals, signal components) | yes | yes |
| full unit suite | no | yes |
| `tsc --noEmit` | no | yes |
| `Card layout` (Playwright, 390px) | no | yes |

`enforce_admins` is **true**. Direct pushes to `main` are rejected for everyone,
including the repo owner. To disable from a phone: GitHub → repo → Settings →
Branches → `main` → Edit → uncheck "Do not allow bypassing the above settings".

**Touch-action arbitration is permanently unprovable in this CI harness.**
Headless Chromium will not drive compositor scrolling from synthetic touch.
Measured on the same page and container (`scrollHeight 7596 / clientHeight 844`,
programmatic `scrollTop` works):

```
Input.synthesizeScrollGesture gestureSourceType 'touch' -> scrollTop 0
Input.synthesizeScrollGesture gestureSourceType 'mouse' -> scrollTop 844
page.mouse.wheel                                        -> scrollTop 844
```

`hasTouch` was false on the phone project and has been fixed; it changed
nothing. The gesture tests therefore drive **wheel**, which exercises
scroll-snap and overscroll-behavior but NOT `touch-action`. **The carousel's
`pan-x` behaviour rests on the user's phone alone** — no CI test covers it, and
any test claiming to must be renamed.

Layout rules are measured in a real browser (`e2e/signal-cards.spec.ts`) because
jsdom has no layout engine — `offsetHeight` is always 0 there, so card height at
390px is unassertable in the unit suite. Screenshots land in `artifacts/cards/`
and upload as a CI artifact.

---

## 3. The data problem — read this before writing any builder

**Every builder must be verified against what is actually in the database before
it is written.** Not the schema, not the migration history, not the type
definitions — the rows.

What is actually there:

- **`portfolio_benchmark_weights` is empty.** Zero rows for every portfolio.
- **`portfolio_holdings`: 5 rows per portfolio, latest date `2025-08-02`** —
  over a year stale as of writing.
- **`trade_queue_items`: `proposed_weight` is null on all 23** open rows in
  these orgs.
- Live status distribution: `idea` 90, `executed` 49, `deleted` 49, `approved`
  11, `deciding` 9, `discussing` 9, `simulating` 6.

### What guessing cost, concretely

I wrote `useRecommendationCards` filtering
`status IN ('pending', 'proposed', 'awaiting_review')`. **None of those three
values exists in the table.** The hook returned zero rows unconditionally. No
recommendation card could ever render — flag on or off — and this shipped to
main, was reported as wired, and survived a full CI run including 80 unit tests
and 26 browser assertions, because nothing in the test suite touches production
data. It was found only by querying the database when the user said the feed
looked unchanged.

The same failure mode produced the `asset_notes` migration that would have
no-opped (§4, instance 3): a policy name reconstructed from the repo's migration
history rather than read from `pg_policies`.

### The open correctness bug

`buildActiveRiskCard` treats `benchmarkWeightPct: null` as *"the benchmark does
not hold this name"* and prints:

> "the benchmark does not hold it, so all of it is active risk"

Given an empty `portfolio_benchmark_weights`, that sentence is false on all
three cards it renders. The real meaning is *"there is no benchmark data at
all"*, which is not a finding about the portfolio — it is missing data, and the
correct response is an `insufficient_coverage` suppression when a portfolio has
zero benchmark rows.

**This is the defect class, written by me after I wrote the ticket about it.**

---

## 4. Defect class: a check that cannot observe its own failure mode

Full write-up: `docs/tickets/guards-defeated-by-defaults.md`.

A check is worthless if the thing it checks for would leave the check's inputs
unchanged. Five instances, each found separately before the pattern was named:

| | The check | What it could not see |
|---|---|---|
| 1 | `netlify.toml` build gate | No build command was set. Main's CI was red across three merges and every one published. **No test had ever gated a deploy on this project.** |
| 2 | `isQuoteFresh(asOf)` | That the quote was fabricated. `createPlaceholderQuote` stamped `new Date()`, making the fake the *freshest* value in the system. The guard passed, correctly, on a lie |
| 3 | asset_notes migration verification | That the old permissive policy persisted. Policies OR together and the DROP no-opped on a name reconstructed from repo history. Two correct new policies would have appeared and the check would have passed |
| 4 | org-scope scanner | That a query *selects* `organization_id` without filtering on it — and that 63 of 73 org-carrying tables exist at all. It greps a literal string near ten hardcoded table names |
| 5 | `buildActiveRiskCard` | That a null benchmark weight means "no benchmark data" rather than "not in the index". Absence rendered as a meaningful zero — **written after instance 2 was ticketed** |
| 6 | all three required CI checks | That the app does not boot. #138 passed Type check, Unit tests and Card layout, and hung production on the loading spinner for every logged-in user. Every gate tests components in isolation; none of them starts the app |
| 7 | `eslint` exiting 0 | That it never ran. A SyntaxError in `eslint.config.js` made it exit without linting, and the resulting `0` was read and reported as "zero violations" — **committed while adding the gate against instance 6** |

### The rule that generalises all of it

**AN EXIT CODE IS NOT EVIDENCE A CHECK RAN.**

Zero violations and zero execution are indistinguishable from the outside.
Every gate must emit positive proof of work — files scanned, tests collected,
rules applied — and the CI assertion is on *that output*, not on the exit
status.

Three instances from three different angles:

- `vite build` exited 0 having run no tests at all
- `eslint` exited 0 having thrown on its own config
- the org-scope ratchet exited 0 having counted a number that measured the
  wrong thing

This is the one most likely to recur, because every tool in the pipeline
reports success the same way it reports vacuity. `scripts/lint-mobile-ratchet.mjs`
is the worked example: it parses the JSON formatter, requires at least 40 files
actually linted, and fails if the count collapses — a passing exit code with
zero files linted is a failure, not a pass.

Instance 4 deserves emphasis: the ratchet **had** passed a deliberate
break-and-restore (allowlist raised to 110, build failed, `dist/` absent) and
was reported to the user as protection, twice. That proved the ratchet compares
two numbers correctly. It proved nothing about whether the number counts what it
claims to — and probing showed it missed three of four constructed violations.
Breaking a threshold is not breaking a subject.

The one guard that has worked as intended: the org-scope ratchet caught a
transitive org filter written fresh in `useRecommendationCards` — org-scoped
query yields portfolio ids, ids filter positions, no org filter on the second
query. Identical reasoning to the `asset_lists` leak it exists to prevent. See
`docs/tenant-isolation-enumeration.md` §1 for why that pattern is easy to write
and what makes it wrong (**RLS evaluates the row, not the provenance of the
id**).

---

## 5. Standing rules

0. **A PROPERTY IS NOT A BEHAVIOUR.** Any claim about runtime behaviour needs an
   observation *of that behaviour* — a driven gesture, an injected failure, a
   screenshot, a fetched byte stream. Configuration that should produce the
   behaviour is not the behaviour. Three instances, each of which was reported
   as evidence and was not:

   - a **source comment** (`MobileNavDrawer.tsx:218`) cited as evidence that the
     ideas feed renders scenario cards
   - a **green required check** (`Type check`) cited as evidence that types were
     checked, while `tsc --noEmit` on a solution tsconfig checked nothing
   - **`overscroll-behavior-y: contain`** cited as evidence the scroll conflict
     was handled — while being its cause. It means "do not chain to the
     ancestor", so it *blocked* the feed from advancing at the detail's scroll
     end. A driven gesture showed the feed sitting at 844 and refusing to move.

   State this rule in the evidence section of every report.

1. **Read live state before generating anything.** Never build a migration from
   the repo's migration history — query production for the actual current
   object first, and reproduce it verbatim including predicates that look
   irrelevant. The repo and production have demonstrably drifted. Same for data:
   check the rows before writing code that reads them.
2. **Every verification asserts a negative.** Not "the new policy exists" —
   "the old policy is gone". Not "the guard ran" — "the build fails when it is
   broken".
3. **Breakage must target the check's subject, not its threshold.** A ratchet
   proven by raising its allowlist has been shown only to compare two numbers.
4. **Nothing is deleted from the decision record, ever.** Superseded tables get
   renamed (`price_targets` → `price_targets_archived_2026_08`), not dropped.
   See `docs/adr/0001-decision-record-is-append-only.md`.
5. **Security findings lead the report but go in tickets** — they do not preempt
   product work unless something is actively leaking to a real user right now.
   This rule exists because security work displaced the feed rebuild three times.
6. **No schema or settings change without explicit per-migration sign-off.** Not
   implied by a phase approval. Paste the full body — new text, what it replaces,
   restore path — and wait.
7. **State where tests ran.** Local and CI are different claims.
8. **Material facts lead.** If something would change the reader's decision, it
   goes in the first line, not the sixth paragraph.

---

## 6. Queue, in order

1. **Fix active-risk benchmark suppression.** Emit `insufficient_coverage` when
   a portfolio has zero rows in `portfolio_benchmark_weights`, rather than
   claiming the benchmark excludes the name. Three currently-false cards.
2. **Verify data for each remaining builder** before writing it — rows, not
   schema. Portfolio lens needs `analyst_price_targets` (30 rows, live) and
   `analyst_ratings` (10 rows against ~1,086 holdings, so every absence-based
   claim on it is correctly suppressed by `MIN_COVERAGE_RATIO`).
3. **The remaining four builders**: portfolio lens (split into
   `conviction_undersized` / `conviction_oversized`, crowding, target breach,
   stale target), derived insight, template kinds, attention.
4. **Delete the legacy components and the `h-full snap-always` container.** One
   PR. This is the exit from the two-paradigm state and the point of all of it.
5. **Phase 2** — single quote source with `asOf` (the placeholder is already
   dead), reconcile the AMZN snapshot-vs-live disagreement, confirm no card
   compares a holdings price to a target or a live quote.
6. **Scanner fix** — `docs/tenant-isolation-enumeration.md` §3. Derive the table
   list from the schema, require a filter rather than a mention, re-baseline in
   the open, probe the result.
7. **Enumeration audit** — all 286 RLS policy bodies, then the column groups,
   then the behavioural CI test with two fixture orgs.

### The outage, 2026-08-16 evening

**#138 hung production.** `signalCardCount` in `MobileDashboard` read
`feedEntries` in its dependency array at line 434; `feedEntries` was declared at
line 495. Temporal dead zone — `ReferenceError: Cannot access 'feedEntries'
before initialization` on every render of the feed, regardless of flag state.

Reverted, not fixed forward: `d05a103d08d07ed4249312c03ac88621292ce154`.
Production confirmed loading by booting it in real Chromium — `#root` had
children, the login page rendered, zero page errors.

Guard added: `npm run guard:tdz` (`scripts/lint-mobile-ratchet.mjs`), scoped to
`src/components/mobile` and ratcheted at 0. Runs in CI **and** in the Netlify
build command, so it blocks the deploy as well as the merge. Proven by
break-and-restore against the subject: checking out #138's `MobileDashboard`
makes it exit 1 naming both lines.

137 `no-use-before-define` violations exist repo-wide and are **not**
allowlisted. The rule is scoped to one directory; widen it one directory at a
time, each widening reported with its count before it lands.

### Open ruling: the authenticated smoke test

A boot test that stops at the login screen tests nothing — verified, not
assumed: the broken #138 build boots cleanly at `/`, because `MobileDashboard`
only renders once authenticated. Catching instance 6 requires a test that logs
in and renders the feed.

That needs a dedicated CI user, and it needs a ruling before it is built:

- A throwaway organisation containing only seeded fixture data, created for
  this purpose and never joined to a real org.
- A user that is a member of **that org only**. No membership in
  `Joe Test Capital` or `Tesseract`.
- Least privilege: whatever the lowest role is that can still load the feed —
  read on assets, portfolios, holdings, trade queue items within its own org.
  Explicitly not PM (Trade Lab execute is PM-only), not an org admin, no
  service-role key, no Management API token.
- Credentials in GitHub Actions secrets, referenced only by the smoke-test job.
  Never printed, and the job must not run on `pull_request` from forks.
- The assertion is that the feed renders at least one card — not that the page
  loads.

Open question for the ruling: whether that org's fixture data is seeded by a
migration, by a script run against production, or by a Supabase branch. All
three have different blast radii and the last one may not exist on this plan.

### Open PRs at handoff

- **#134** — defect class ticket (docs). Needs instances 6 and 7 and the
  exit-code rule added; they are written above but not yet in the ticket
- **#136** — asset_notes migration file corrected to match production (the SQL
  is already applied; this only fixes the committed file)
- **#137** — tenant enumeration seed + queued scanner fix (docs)

### Applied to production this session

`asset_notes` SELECT policy, 2026-08-16. Two policies, org-scoped, old
permissive policy dropped. Verified: exactly 2 rows, old name absent, no SELECT
policy lacking an org predicate. 57 rows, 0 shared, 0 without an org.
