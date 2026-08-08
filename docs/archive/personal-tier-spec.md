# Personal Tier — design spec

**Status: NOT PURSUED (Aug 2026). Archived for the architecture, not the plan.**

Written while exploring a free consumer tier with a public idea feed, then set
aside: a public feed is a consumer-social product with consumer-social
economics and cold-start problems, which is the wrong shape for this codebase
and the wrong bet for a solo founder. The direction taken instead is the idea
ledger — scoring the ideas a user considered and did not act on, inside the
existing product. See `scripts/idea-ledger-analysis.mjs`.

Two ideas here are still worth stealing if a single-player mode is ever built:

1. **A personal user is an organization of one** (§2 Decision A). Avoids
   org-less code paths entirely, so no existing RLS or query changes.
2. **Publishing by projection, not by loosened predicate** (§2 Decision B).
   A row's presence in the public table *is* the authorization, so there is no
   policy to get wrong.

Everything below is the original document, unedited.

---

A free, single-player entry point to Tesseract that a person can adopt alone,
in five minutes, with no organization, no invite, no data import, and no
colleagues. Its purpose is cheap traction and signal, and it is designed so
that **nothing about the existing multi-tenant product changes**.

The pitch is not "track your accuracy." It is **"never lose your reasoning."**
Scoring is a private, unlockable view that arrives only after the user has a
record worth scoring.

---

## 1. Non-negotiable constraints

These are the constraints the design is built around, not aspirations.

1. **Zero blast radius on the enterprise product.** No existing RLS predicate
   is loosened. No existing query's org filter is relaxed. The cross-org leak
   fixed in `20260605120000_quick_thoughts_organization_id.sql` and its
   siblings must remain fixed by construction, not by care.
2. **No org-less code paths.** Auditing every query and policy across 265
   migrations for `organization_id IS NULL` handling is weeks of work with a
   long tail of leaks. We will not do it.
3. **Nothing is public unless explicitly published**, per item, by the author.
4. **Firms can hard-disable publishing**, org-wide, and it defaults to off for
   existing orgs.
5. **The record belongs to the user.** Aggregate accuracy is never exposed to
   an employer, a firm admin, or the public without an explicit user action.
   This is a product principle, not a setting.

---

## 2. The two load-bearing decisions

Everything else follows from these.

### Decision A — a personal user is an organization of one

Do **not** build an "org-less" mode. Instead, on personal signup, provision a
real `organizations` row with `kind = 'personal'`, a membership, and set
`users.current_organization_id` to it.

Why this is the whole trick:

- Every existing query, trigger, policy, and `.eq('organization_id', …)` call
  works **unchanged**. `useIdeasFeed`'s `ctx.organizationId!` non-null
  assertion stays valid.
- No RLS is touched. The tenant-lint guard (`npm run tenant:lint:all`) keeps
  passing.
- The entire product you already built — notes, assets, price targets, themes,
  charting, Trade Lab — becomes single-player usable immediately. Gating is
  then a *navigation* concern, not an architecture concern.
- Multi-org is already supported (`OrganizationContext.switchOrg`). When a
  personal user later joins a firm, they get an org switcher for free, and
  their personal record follows them between jobs. That portability is the
  emotional core of the pitch.

Cost: one additive column, one RPC, one branch in signup.

### Decision B — the public feed is a projection, not a loosened predicate

Publishing **copies a snapshot** into a separate public table. The public feed
reads only that table. It never queries `quick_thoughts`, `trade_queue_items`,
or `asset_notes`.

Why:

- A row's presence in `public_posts` *is* the authorization. There is no
  predicate to get wrong, so there is no class of bug that leaks org content.
- Org-scoped reads keep their existing policies verbatim.
- It matches the architecture already sketched in
  `docs/ideas-feed-content-tiles.md` — `public_posts` is that doc's
  `content_tiles`, arriving earlier and via explicit user action rather than an
  LLM trigger. When the tile engine is built later it writes to the same table.

Cost: two new tables, one publish RPC, one unpublish RPC.

---

## 3. Data model — additive only

No `ALTER` on any existing column. No policy rewrites.

```sql
-- A. Personal orgs -----------------------------------------------------------
ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'firm'
    CHECK (kind IN ('firm', 'personal'));

-- Org-wide publishing kill switch. OFF for every existing org.
ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS allow_public_publishing BOOLEAN NOT NULL DEFAULT FALSE;

-- B. Public projection -------------------------------------------------------
CREATE TABLE public.public_posts (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  author_id         UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  source_type       TEXT NOT NULL,     -- 'quick_thought' | 'trade_idea' | 'note' | 'claim'
  source_id         UUID NOT NULL,     -- row in the origin org; never joined from the feed
  source_org_id     UUID NOT NULL REFERENCES public.organizations(id),

  -- Denormalized snapshot. The feed renders ONLY these columns.
  headline          TEXT,
  body              TEXT NOT NULL,
  asset_id          UUID REFERENCES public.assets(id),
  symbol            TEXT,              -- denormalized so the feed needs no join
  sentiment         TEXT,
  claim_id          UUID,              -- FK to public_claims when this post is a call

  published_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  edited_at         TIMESTAMPTZ,
  retracted_at      TIMESTAMPTZ,       -- soft delete; retraction is visible, not silent

  reaction_count    INTEGER NOT NULL DEFAULT 0,
  comment_count     INTEGER NOT NULL DEFAULT 0
);

-- C. Public claims -----------------------------------------------------------
-- Mirrors the resolved state of an analyst_price_target so the public feed
-- never reads the org-scoped table.
CREATE TABLE public.public_claims (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  author_id         UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  price_target_id   UUID NOT NULL,     -- origin analyst_price_targets row
  asset_id          UUID NOT NULL REFERENCES public.assets(id),
  symbol            TEXT NOT NULL,

  direction         TEXT NOT NULL CHECK (direction IN ('up', 'down')),
  price_at_call     NUMERIC NOT NULL,  -- frozen at publish; this is the immutability anchor
  target_price      NUMERIC NOT NULL,
  target_date       DATE NOT NULL,
  confidence_pct    INTEGER,           -- from analyst_price_targets.probability
  rationale         TEXT,

  status            TEXT NOT NULL DEFAULT 'open',
  resolved_at       TIMESTAMPTZ,
  resolution_price  NUMERIC,
  accuracy_pct      NUMERIC,
  days_to_resolve   INTEGER,

  published_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

**Immutability.** Once `public_claims` has a row, `direction`, `price_at_call`,
`target_price`, `target_date`, and `confidence_pct` are locked by a `BEFORE
UPDATE` trigger. Changing your mind creates a *new* claim that supersedes the
old one; the old one still resolves. Without this the record is worthless, and
this is far cheaper to enforce now than to retrofit.

**RLS.**

- `public_posts` / `public_claims`: `SELECT` to `anon` and `authenticated`
  where `retracted_at IS NULL`. `INSERT`/`UPDATE`/`DELETE` only via
  `SECURITY DEFINER` RPCs — never direct from the client.
- `publish_post(source_type, source_id)` asserts: caller owns the row, the row
  is `visibility = 'public'`, and the source org has
  `allow_public_publishing = TRUE` **or** `kind = 'personal'`.
- Personal orgs get `allow_public_publishing = TRUE` at provisioning. Firms
  stay `FALSE` until an admin flips it. **This single default is what makes the
  feature invisible to every existing customer on day one.**

---

## 4. Surface gating

Mirror the established idiom in `src/lib/mobile/mobile-surfaces.ts`. Add
`src/lib/tiers/tier-surfaces.ts`, keyed the same way (`Tab['type']`), so
"what a personal user can see" is decided in exactly one file:

```ts
export type Tier = 'personal' | 'firm'

export interface TierSurface {
  type: string          // matches Tab['type'] in TabManager.tsx
  tiers: Tier[]
  /** Shown on the upgrade card when a personal user reaches a firm surface. */
  firmReason?: string
}
```

Personal tier gets: `ideas`, `asset`, `note`, `search`, `profile`,
`settings`, `charting`, plus a new `record` surface. Everything else —
coverage, portfolios, trade book, trade queue, approvals, projects, ops,
admin — is firm-only and simply never renders in nav.

This composes with `MOBILE_SURFACES` rather than replacing it: a surface must
pass both registries to render on a phone.

---

## 5. What it looks like

Five screens. Four of them are components you already have.

### 5.1 Onboarding — under 60 seconds

```
┌──────────────────────────────────────┐
│                                      │
│   Your investing memory.             │
│                                      │
│   Write down what you think and      │
│   why. We'll remember, and tell      │
│   you how it turned out.             │
│                                      │
│   [ Continue with email       ]      │
│   [ Continue with Google      ]      │
│                                      │
└──────────────────────────────────────┘
          ↓
┌──────────────────────────────────────┐
│  What do you follow?                 │
│  ┌────────────────────────────────┐  │
│  │ 🔍 Search tickers              │  │
│  └────────────────────────────────┘  │
│  ✓ NVDA  ✓ MSFT  ✓ TSM   + AAPL     │
│  + GOOGL  + AMZN  + META             │
│                        [ Done → ]    │
└──────────────────────────────────────┘
```

No org step, no invite, no team. Behind it: `create_personal_org()` RPC →
org row (`kind='personal'`, name = user's name) → membership → coverage rows
for the picked tickers so the feed and attention system have something to
rank against on first load.

### 5.2 Home — the feed

`IdeasFeedPage` with the source swapped to `public_posts`. Same
`FeedCard` / `FeedChart` / `SignalFeedCard` components.

```
┌────────────────────────────────────────────┐
│  Tesseract              🔍      ⚙          │
│  ┌──────────┬──────────┬────────────────┐  │
│  │ Following│ Discover │ My Record      │  │
│  └──────────┴──────────┴────────────────┘  │
├────────────────────────────────────────────┤
│ ⏱ 3 of your calls resolve this month   →   │  ← own-stake strip
├────────────────────────────────────────────┤
│ ┌────────────────────────────────────────┐ │
│ │ Sarah Chen  · 2h                       │ │
│ │ ▲ 64% · 41 calls                       │ │  ← record badge, opt-in
│ │                                        │ │
│ │ NVDA  $412 → $480 by Q3   ▲ 16%        │ │
│ │ "Hyperscaler capex guides all revised  │ │
│ │  up; supply is the only constraint."   │ │
│ │  ╭──────────────────────────────────╮  │ │
│ │  │      ╱‾‾╲      ╱╲   ┈┈┈┈┈ target │  │ │
│ │  │   ╱‾╯    ╲╱‾‾╲╱                  │  │ │
│ │  ╰──────────────────────────────────╯  │ │
│ │  ♡ 24   💬 6   ⤴                       │ │
│ └────────────────────────────────────────┘ │
│ ┌────────────────────────────────────────┐ │
│ │ ⚡ DEBATE                               │ │  ← existing SignalFeedCard
│ │ Two people you follow disagree on TSM   │ │
│ └────────────────────────────────────────┘ │
│                                    ( + )   │
└────────────────────────────────────────────┘
```

The record badge (`▲ 64% · 41 calls`) is **opt-in per user** and only offered
once they have ≥ 10 resolved claims. Off by default. It is a flex people
choose, not an audit imposed. Below 10 resolved it renders as
`· 4 calls tracked` with no percentage — never a percentage on a small sample.

### 5.3 Capture — the core loop

`QuickThoughtCapture.tsx` already has the visibility selector including
`public`. Add a second mode.

```
┌────────────────────────────────────────────┐
│  ┌──────────┬──────────┐              ✕    │
│  │ Thought  │ ✓ Call   │                   │
│  └──────────┴──────────┘                   │
│                                            │
│   NVDA   Nvidia Corp          $412.30      │
│                                            │
│   ▲ Up          ▼ Down                     │
│                                            │
│   Target  $ 480          by  Q3 2026 ▾     │
│                          ↑ +16.4%          │
│                                            │
│   How confident?                           │
│   ───────────●──────────  70%              │
│                                            │
│   Why (one line)                           │
│   ┌──────────────────────────────────────┐ │
│   │ Capex guides revised up across all   │ │
│   └──────────────────────────────────────┘ │
│                                            │
│   🔒 Private ▾                    [ Post ] │
└────────────────────────────────────────────┘
```

Writes to `analyst_price_targets` in the personal org — the **existing** table,
with its existing `create_outcome_for_target()` trigger. If visibility is
Public, the client then calls `publish_post` + `publish_claim`.

Private is the default and it must stay the default. Most value accrues to
users who never publish anything.

### 5.4 My Record — the private page

```
┌────────────────────────────────────────────┐
│  My Record                                 │
│                                            │
│   14 open      ·   23 resolved             │
│                                            │
│  ┌──────────────────────────────────────┐  │
│  │  🔒 Calibration                      │  │
│  │  ████████████░░░░  23 / 30           │  │
│  │  7 more resolved calls unlocks this. │  │
│  └──────────────────────────────────────┘  │
│                                            │
│  RESOLVING SOON                            │
│   NVDA  $480 by Mar 31    $471  ▲ 98%      │
│   TSM   $210 by Apr 15    $186  ▼ 89%      │
│                                            │
│  RESOLVED                                  │
│   ✓ MSFT $480 · hit in 47d · +2.1% over    │
│   ✗ ADBE $620 · expired at $541            │
│                                            │
│  ─────────────────────────────────────     │
│  Only you can see this page.               │
└────────────────────────────────────────────┘
```

The lock is a real gate, not a paywall — calibration on n < 30 is noise, and
saying so builds more trust than showing a number. It is also the single best
retention mechanic in the product: a progress bar that only advances by using
it, whose payoff arrives on the market's schedule rather than yours.

Calibration, when unlocked: bucket resolved claims by stated
`confidence_pct` (50–60, 60–70, …), plot stated vs. actual hit rate against
the 45° line, and report a Brier score. This is the one genuinely new metric —
`useScorecards.ts:310` currently computes `hitRate * 0.6 + avgAccuracy * 0.4`
and discards `probability` entirely, even though it is already stored on every
target.

### 5.5 The resolution artifact — the growth loop

When `price_target_outcomes.status` flips to `hit` or `missed`, notify the
author. Tapping it opens a shareable card.

```
┌────────────────────────────────────────┐
│                                        │
│   NVDA                          ✓ HIT  │
│                                        │
│   $412  →  $480                        │
│   Called 14 Jan · Hit in 47 days       │
│                                        │
│   ╭────────────────────────────────╮   │
│   │              ╱‾╲    ┈┈┈┈┈┈┈┈┈  │   │
│   │      ╱‾╲   ╱╯   ╲╱             │   │
│   │  ╱‾╲╱   ╲╱                     │   │
│   ╰────────────────────────────────╯   │
│                                        │
│   "Hyperscaler capex guides all        │
│    revised up."                        │
│                                        │
│   Sarah Chen · tesseract.app           │
└────────────────────────────────────────┘
        [ Share ]    [ Keep private ]
```

This card is the entire marketing budget. It carries the product's whole
thesis in one image, it is generated automatically, and people only share
their wins — which is fine, because the private record stays complete either
way and the public graph still gets built.

- **v1:** render the card as real DOM, rasterize client-side (`html-to-image`),
  hand to the Web Share API. Zero infrastructure.
- **v2:** an `og-card` Edge Function rendering the same layout server-side so
  links unfurl on X. This matters more than it sounds — an unfurled card is the
  difference between a link and an ad. Defer it, but design the layout once so
  both renderers share it.

---

## 6. Claims and resolution — mostly already built

This is the part that is far cheaper than it looks. Already in the schema from
`20251230000000_add_price_target_analytics.sql`:

- `price_target_outcomes` — `status` (pending/hit/missed/expired/cancelled),
  `hit_date`, `hit_price`, `accuracy_pct`, `days_to_hit`
- `create_outcome_for_target()` — trigger that opens an outcome on insert
- `calculate_accuracy()`, `calculate_target_date()`
- `update_analyst_performance()` + `analyst_performance_snapshots`
- `price_history_cache`

And `supabase/functions/yahoo-chart-proxy` is a working free price source.

What is missing is only the **sweep**: a scheduled job that walks pending
outcomes, pulls closes since `target_set_date`, marks hit/missed/expired, and
mirrors the result onto `public_claims`. One Edge Function on a daily cron.

Resolution rule, stated explicitly so it can't drift: a claim is `hit` if the
**daily close** touches the target at any point on or before `target_date`;
`missed` if `target_date` passes without that; direction-aware. Intraday highs
are excluded deliberately — they are noisy and unfalsifiable to a reader.

---

## 7. Blast radius on the existing product

| Area | Change |
|---|---|
| Existing RLS policies | none |
| Existing queries / org filters | none |
| `organizations` | two additive columns, both defaulted safely |
| Firm users' experience | none, until an admin sets `allow_public_publishing` |
| `tenant:lint:all` | unaffected; `public_posts` added to the known-unscoped allowlist with a written justification |
| New tables | `public_posts`, `public_claims` — read-only to clients |
| Rollback | drop the two tables and the RPCs; nothing else references them |

The whole personal tier sits behind one flag (`VITE_PERSONAL_TIER`) so it can
ship to `main` dark and be flipped on independently of deploys.

---

## 8. Build order

Sequenced so something is demoable early and nothing is wasted if you stop.

| # | Slice | Rough size |
|---|---|---|
| 1 | `kind` + `allow_public_publishing` columns, `create_personal_org()` RPC, signup branch | S |
| 2 | `tier-surfaces.ts` registry + nav gating | S–M |
| 3 | Call mode in `QuickThoughtCapture` → `analyst_price_targets` | S |
| 4 | Resolution sweep Edge Function + daily cron | M |
| 5 | My Record page (open / resolved lists, locked calibration meter) | M |
| 6 | Resolution artifact card + client-side share | M |
| 7 | `public_posts` / `public_claims` + publish RPCs | M |
| 8 | Feed source swap behind `mode='discover'` | M |
| 9 | Onboarding flow | S |
| 10 | Calibration view unlock | M |

Slices 1 and 3–6 give a complete, useful, **entirely private** product with no
public surface at all. That is worth shipping on its own, and it is the
lower-risk half. Public (7–9) can follow once the private loop retains.

---

## 9. What signal this is actually for

Define these before launch or the data won't mean anything.

- **Activation:** % of signups that log ≥ 1 claim in week 1.
- **The real one — return-after-resolution:** % of users who open the app
  within 48h of their first claim resolving. This tests the single hypothesis
  the whole product rests on: *does automated feedback on your own judgment
  pull people back?* If this is weak, the thesis is wrong and no amount of feed
  polish saves it.
- **Retention:** % still logging in week 4. Idea journals die here; the
  resolution loop is the only defense.
- **Publish rate:** % of claims made public. Low is fine and expected — but if
  it is near zero, the public feed will never have supply and slices 7–9 should
  be cut rather than built.

---

## 10. Open questions

1. **Naming.** "Personal tier" is internal. The public-facing frame should
   lead with memory, not measurement.
2. **Asset universe.** Personal orgs need `assets` rows for arbitrary tickers.
   Does the existing asset table cover the retail long tail, or is on-demand
   creation from the Yahoo proxy needed at capture time?
3. **Personal → firm migration.** When a personal user joins a firm, does their
   record move, copy, or stay separate? Recommend: stays personal, always;
   portability is the promise. Needs a UI answer, not a schema one.
4. **Moderation.** A public feed of financial claims will attract promotion.
   Minimum viable: report button, rate limit on publish, and no public feed
   until slice 7 is genuinely needed.
