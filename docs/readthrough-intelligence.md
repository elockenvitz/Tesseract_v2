# Readthrough Intelligence

**Status:** design only. No schema, no ranking change, no UI change.
**Branch:** `feat/readthrough-intelligence` (worktree `C:\dev\tesseract-readthrough`)
**Scope boundary:** this pass touches documentation only. It deliberately does not
modify `DashboardPage`, `IdeasFeedPage`, desktop cards, or any ranking weight —
those belong to `feat/desktop-ideas-redesign`.

---

## 0. The product question

Tesseract today answers:

> *"Show me things about the names I follow."*

The question it should answer is:

> **"What changed in the world that could change my view on the things I care about?"**

Those are different retrieval problems. The first is a filter over events already
tagged with the reader's names. The second requires the product to hold an opinion
about **how companies relate to each other**, and to carry an event *across* that
relation to a name the reader cares about.

The worked example throughout:

```
Microsoft raises AI infrastructure capex        ← event, about MSFT
        │
        │  relationship: MSFT is a hyperscaler customer of NVDA's GPUs
        ▼
NVDA                                             ← readthrough target
        │
        │  NVDA is in this reader's My Scope
        ▼
"Readthrough to NVDA — Microsoft's AI infrastructure spending can affect GPU demand."
```

### Terminology (binding for this workstream)

| Term | Meaning | Where it lives today |
|---|---|---|
| **My Scope** | names the reader personally selected | `coverage.coverage_scope = 'personal'` → `CoverageRelevance.direct` |
| **Assigned to Me** | names the organization assigned to the reader | `coverage.coverage_scope = 'org'` → `CoverageRelevance.assigned` |
| **In Portfolio** | held exposure | `portfolio_holdings` → `CoverageRelevance.held` |
| **Readthrough** | an event *outside* those names that matters because of a relationship to something the reader cares about | **does not exist** |
| **Discovery** | important information outside the known scope/portfolio graph | **name is currently squatted** — see below |

Two naming debts this design inherits and should pay off:

1. `CoverageRelevance` uses `direct` / `assigned` / `held`. `direct` is the value
   behind the phrase "Direct Coverage" we are retiring. The *internal* enum can
   stay (renaming it is a cross-lane change), but **no user-facing string may say
   "Direct Coverage"**. The presentation mapping is `direct → "My Scope"`,
   `assigned → "Assigned to me"`, `held → "In portfolio"`.
2. `generateDiscoveryItems` in `src/hooks/ideas/useIdeasFeed.ts:780` currently emits
   eight canned writing prompts ("What are the biggest risks to your portfolio right
   now?"). That is filler to keep an infinite feed infinite — it is not discovery in
   the sense this document uses. Before Readthrough ships a user-facing "Discovery"
   concept, that function needs a different name (`generateFeedPrompts`) or the
   product word needs to be different. Two things called Discovery, one of which is
   a placeholder, is how a feature loses its meaning.

---

## 1. Existing relationship capabilities in Tesseract

Audited against this worktree: `src/`, `supabase/migrations/` (294 files),
`supabase/functions/`, `docs/`. Note the standing caveat that migrations do not
fully describe production — anything below marked ⚠ needs a live-DB check before
it is relied on.

### 1.1 What genuinely exists

**`object_links` — a real, general entity graph.** This is the single most
important finding. The table carries
`source_type / source_id → target_type / target_id`, a `link_type` of enum
`link_relationship_type`, a free-text `context`, an `is_auto` boolean and
`created_by`. Its entity vocabulary (`LinkableEntityType` in
`src/lib/object-links/extract-references.ts:19`) already covers `asset`,
`portfolio`, `theme`, every note table, `trade_idea`, `trade`, `trade_sheet`,
`workflow`, `project`, `quick_thought`, `trade_proposal`, `trade_idea_thesis`.
Relationship vocabulary today: `references`, `supports`, `results_in`,
`related_to`, `opposes`, `informs`, `derived_from`.

⚠ `object_links` is **not** in `supabase/migrations` (it predates the ledger) and
**not** in `src/types/database.ts` — `src/lib/mobile/readthrough-service.ts:60`
carries an `as never` cast specifically because the generated types resolve the row
to `never`. Its columns, indexes and RLS need to be read off production before any
design commits to them. In particular: **whether it has `organization_id` is
unknown and is a blocking question for §15.**

**A human-authored readthrough already ships on mobile.**
`src/lib/mobile/readthrough-service.ts` + `src/components/mobile/ReadthroughSheet.tsx`
let a reader say "this post changes how I think about a *different* stock",
writing `object_links` with `link_type = 'informs'`, `target_type = 'asset'`,
`is_auto = false` and the reason in `context`. `MobileFeedActionRail` renders it as
"Read-thru". This is the manual version of the feature, and it is a genuine asset:
it is a **labelled seed and evaluation set** of reader-asserted event→asset edges
with free-text rationale, produced by the exact people whose judgment we want to
encode.

**Reader scope resolution is already canonical and already good.**
`src/lib/signals/coverage-relevance.ts` is the one place that decides what an asset
is to a reader: `direct | assigned | held | none | unknown`, with three explicit
refusals (no-coverage reader, non-asset entity, unresolved query) that all return
the neutral `unknown` rather than a penalty. Both shells consume it through
`useCoverageRelevance`. **Readthrough personalization needs no new scope machinery
— it needs to call this function with a different asset id.** That is the cleanest
seam in the whole design.

**Human-asserted asset↔asset relations, scattered but real:**

- **Pair trades** — `long_legs[]` / `short_legs[]` (`src/hooks/ideas/types.ts:103`).
  A pair trade is a person stating "these two names are substitutes / a spread".
  This is high-quality, low-volume relationship data nobody is reading as such.
- **`opposes` links** — counter-views on trade ideas
  (`20260314000000_add_opposes_link_type.sql`). Idea-to-idea, not asset-to-asset.
- **Notes with inline `$TICKER` references** — `extractReferencesFromHTML` already
  turns TipTap `$TICKER` spans into `object_links` rows of `link_type 'references'`.
  A note on NVDA that mentions $MSFT is a weak, free, already-persisted co-mention
  edge.

**Set membership, which yields peer sets by construction:**

- `assets.sector`, `assets.industry`, `assets.country`, `assets.exchange`,
  `assets.market_cap`, and (since `20260818141000_asset_instrument_identity.sql`)
  `asset_type`, `currency`, `isin`, `figi`, `mic`.
- `themes` (org-scoped; `theme_type ∈ sector|geography|strategy|macro|general`;
  `lifecycle_status ∈ emerging|active|playing_out|played_out|invalidated`) +
  `theme_assets`. The 11 GICS sectors are auto-seeded as themes per org
  (`20260425170000_seed_gics_sector_themes.sql`). **`theme_assets` is the closest
  thing in the product to a curated thematic edge set.**
- `asset_lists` / `asset_list_items` — watchlists, org-scoped.
- `benchmark_weight_snapshots` + `portfolio_benchmark_weights` — index/ETF
  membership with `source_type ∈ etf_proxy | licensed_benchmark`, per portfolio,
  org-scoped, with provenance and a weight-sum plausibility check.
- `workflow_universe_rules` — **a rule language for asset sets already exists**:
  `rule_type ∈ index | list | theme | portfolio | sector | market_cap | priority |
  stage | coverage | custom_filter` with JSONB config, resolved by
  `resolve_universe_rules` and `src/lib/universeAssetMatcher.ts`. Any "peers of X"
  definition should be expressible in this language rather than inventing a second
  one.

**An LLM substrate that is production-grade:**

- `supabase/functions/ai-chat/index.ts` — multi-provider (Anthropic / OpenAI /
  Google / Perplexity), BYOK per org via `organization_ai_config`, pre-flight rate
  limiting (daily requests, daily tokens, monthly USD budget, max tokens per
  request), a `PRICING` table, `ai_usage_log` cost accounting, prompt caching, and
  **purpose-based model routing** (`chat | column | snippet | analysis`) that
  already routes cheap work to a Haiku-class model.
- AI Columns (`src/lib/ai-columns/`, `useAIColumns`, `ai_column_library`) —
  per-asset LLM enrichment with a stored prompt, a context config, and **caching per
  asset**. This is the exact shape of a relationship-enrichment job.

**Two separate, correctly-separated feedback ledgers:**

- Investment judgment → `audit_events` via `judgment-log.ts` (immutable, checksummed,
  actor / entity / parent_entity / from_state / to_state, retention policy).
- Product-quality feedback → `pilot_telemetry_events` via `feed-feedback-log.ts`,
  vocabulary `feed_not_useful` / `feed_wrong_person`, with `signal_type`,
  `card_surface`, `entity_kind`, `entity_id` in the metadata. Ranking is
  **explicitly forbidden** from consuming these today, and
  `PriorityComponents.personalization` exists as a declared-always-zero slot for the
  day it may.
- Mobile interest telemetry — `src/lib/mobile/feed-telemetry.ts` already weights a
  `readthrough` action at **30**, the highest interest signal in the table.

**Explanation plumbing:** `SignalCard.provenance.reason` is specified as
"human-readable, machine-generated: *'You hold this in 3 portfolios and have not
written on it since March.'*" and `WHY` exists as a `CardAction`
(`src/lib/signals/builders/shared.ts:96`). The menu item was removed from the UI,
but **the field and the contract for it survive**. Readthrough's explanation has a
home.

### 1.2 The `ReadthroughLink` seam named in the brief

The brief asks me to audit "the future-compatible seam already introduced in
canonical ranking":

```ts
ReadthroughLink { sourceAssetId, targetAssetId, relationshipType, strength, explanation }
```

**No such type exists in this repo.** `grep -ri readthrough` across `src/`,
`supabase/` and `docs/` returns only the mobile human-authored feature, the feed
action rail, `feed-telemetry`'s weight of 30, and the card-menu action id. There is
no `ReadthroughLink`, no `readthrough` `SignalType`, and no readthrough field on
`PriorityInput`.

What *does* exist as a forward seam, and is genuinely useful:

- `PriorityInput.coverage: CoverageRelevance` — takes the target's scope, not the
  card's own asset. Nothing stops a readthrough candidate from passing NVDA's
  relevance while the story is about MSFT.
- `PriorityComponents.personalization` — declared, always `0`, documented as the
  slot for the day ranking reads feedback telemetry.
- `object_links.is_auto` — the machine/human provenance bit, already present.
- `CardProvenance.reason` — the explanation string.

So §6 below designs the shape rather than auditing one, and §14 says exactly where
it would attach.

### 1.3 What does **not** exist

| Capability | State |
|---|---|
| Asset↔asset relationship table with type + strength + confidence + provenance | **absent** |
| Supplier / customer / competitor data (any source) | **absent** |
| Normalised industry taxonomy (GICS codes, sub-industry) | **absent** — `assets.sector` and `assets.industry` are free text, no codes, no hierarchy |
| Materialised peer sets | **absent** — derivable from sector/theme/index, never derived |
| Event→relationship→target resolution of any kind | **absent** |
| Any LLM job that infers relationships | **absent** — every AI feature is single-entity |
| Relationship feedback vocabulary | **absent** — `feed_not_useful` cannot say *which* claim was wrong |
| `RankReason[]` | **absent** — there is one `reason` string, and `explainPriority`, which is explicitly "never for the product surface" |
| Visibility class on graph edges (global vs org-private vs personal) | **absent** |
| Correlation / factor exposure / macro sensitivity data | **absent** |
| Commodity, FX or rate sensitivity per name | **absent** |

### 1.4 The retrieval problem — the finding that reorders the roadmap

**Readthrough is currently impossible to build without changing candidate retrieval,
because the candidate pool is defined as the reader's own names.**

`src/components/mobile/MobileDashboard.tsx:955` derives `newsSymbols` from the assets
*already visible in the feed*, caps it at 24, and passes it to `useMarketNews` → the
`market-news` edge function, which queries providers **per symbol**
(`company-news?symbol=`, `NEWS_SENTIMENT&tickers=`, Yahoo per-symbol RSS). The
comment is explicit and correct for the product it was built for:

> *"Deliberately derived from what the feed is showing rather than the whole book …
> a story about a name you are not looking at is not why you opened this."*

The Microsoft story therefore **never enters the system** for a reader who covers
only NVDA. There is nothing to read through *from*. No amount of relationship
modelling fixes this downstream; the fix is in retrieval, and it must come first.

This also constrains the relationship model in a useful way: the 1-hop neighbour set
of the reader's scope is exactly the symbol set that must be added to the news query.
**The graph pays for itself twice — once as an explanation, once as a retrieval key.**

---

## 2. Missing capabilities, ordered by what blocks what

1. **Candidate retrieval beyond the reader's own names.** Blocks everything. (§1.4)
2. **A durable asset↔asset edge store** with type, direction, strength, confidence,
   provenance and visibility. Blocks explanation, ranking and audit.
3. **Seed relationship content.** An empty graph is a shipped feature that does
   nothing. Needs a concrete answer for the pilot universe (§5, §16).
4. **Event characterisation.** Today a story is a headline plus tickers; there is no
   notion of *what kind of claim it makes* (capex, guidance, pricing, regulatory,
   supply). Relationship types are close to useless without it — a supplier edge
   should carry a demand story, not a CFO departure.
5. **A relationship-aware feedback vocabulary** — "wrong relationship" is a distinct
   claim from "not useful", and conflating them makes the graph uncorrectable.
6. **`RankReason[]`** or an equivalent structured explanation, so "why you're seeing
   this" is generated from facts rather than assembled per card type.
7. **Edge visibility classes** and the RLS to enforce them, before any firm's
   proprietary supply-chain map is entered into the product (§15).

---

## 3. Recommended conceptual model

Four objects, three of which are new. The discipline that makes this safe is the
**separation of the durable edge from the event-time instance**, and the separation
of both from the reader.

```
┌───────────────┐        ┌──────────────────────┐        ┌───────────────┐
│  EVENT        │        │  RELATIONSHIP EDGE   │        │  TARGET ASSET │
│  (about MSFT) │───────▶│  MSFT --customer-->  │───────▶│  NVDA         │
│               │        │  NVDA                │        │               │
│  news, post,  │        │  durable, global or  │        │               │
│  filing, note │        │  org-scoped, curated │        │               │
└───────────────┘        └──────────────────────┘        └───────┬───────┘
        │                          │                             │
        └──────────┬───────────────┘                             │
                   ▼                                             ▼
        ┌────────────────────────┐                 ┌──────────────────────────┐
        │  READTHROUGH INSTANCE  │                 │  SCOPE RELEVANCE         │
        │  event × edge          │                 │  coverageRelevanceFor(   │
        │  + channel, direction  │                 │    index, NVDA)          │
        │  + one-sentence why    │                 │  → direct|assigned|held  │
        │  + confidence          │                 │     |none|unknown        │
        │  NOT reader-specific   │                 │  reader-specific         │
        └────────────┬───────────┘                 └────────────┬─────────────┘
                     └──────────────┬───────────────────────────┘
                                    ▼
                       ┌─────────────────────────────┐
                       │  PERSONALIZED CANDIDATE     │
                       │  (what ranking receives)    │
                       └─────────────────────────────┘
```

**The invariant:** the graph and the instance are **global or org-global facts**.
Nothing about a reader is ever written into them. Personalization is a *join at read
time* against `CoverageIndex`. This is what makes the system cacheable (one inference
per event, not one per reader), auditable (one explanation, not N), and correctable
(fix the edge once).

Concretely: computing "MSFT capex → NVDA GPU demand" once serves every reader who
has NVDA in any scope. A per-reader inference would multiply LLM cost by the user
count for zero additional truth.

---

## 4. Relationship taxonomy

For each candidate: what it means, where the data comes from, stability, direction,
achievable confidence, investor usefulness, and the v1 verdict.

### Tier A — ship in v1 (deterministic or already curated in-product)

| Type | Means | Source | Stability | Direction | Confidence | Usefulness | v1 |
|---|---|---|---|---|---|---|---|
| `same_industry` | same `assets.industry`, or co-members of a `theme_type='sector'` theme | in-product | high (quarterly) | symmetric | high on the *fact*, low on the *implication* | medium — a peer's guide-down is real information, and it is the most common readthrough an analyst actually makes | ✅ |
| `index_cohort` | co-members of the same benchmark snapshot | `benchmark_weight_snapshots` | high | symmetric | high | low-medium — mostly a flow/macro channel | ✅ as a weak edge only |
| `theme_member` | both in the same org theme (`theme_type ∈ strategy|macro|geography`) | `theme_assets` | medium — themes already carry a `lifecycle_status` that models decay | symmetric | high on membership; the *thesis* is the analyst's | **high — an analyst's own map of what relates to what, already in the product** | ✅ |
| `pair_leg` | opposite legs of a stated pair trade | `pair_trade.long_legs/short_legs` | low (idea-lifetime) | directional (long vs short) | high — a person asserted it | high, narrow | ✅ |
| `analyst_asserted` | a reader marked a readthrough by hand | `object_links`, `is_auto = false` | high while unretracted | directional | highest in the system | highest | ✅ |
| `co_mentioned` | note or idea text names both assets | `object_links`, `link_type = 'references'` | low | symmetric | **low — proximity is not relation** | low alone; **useful as corroboration** | ✅ as a *modifier*, never as a standalone edge |

### Tier B — v2 (real, valuable, needs data we do not have)

| Type | Means | Source | Stability | Direction | Confidence | Usefulness | v1 |
|---|---|---|---|---|---|---|---|
| `customer` | A buys from B; A's demand drives B's revenue | 10-K concentration disclosures, vendor supply-chain data, analyst curation | high (annual) | **strongly directional** — MSFT→NVDA is not NVDA→MSFT | high if sourced, low if inferred | **highest of all — this is the flagship example** | ⚠ curated seed only |
| `supplier` | inverse of `customer` | as above | high | directional | high if sourced | high — input cost and availability | ⚠ curated seed only |
| `competitor` | contests the same demand | curation; sector + revenue overlap | high | mostly symmetric, occasionally asymmetric (a small name is affected by a large rival far more than the reverse) | medium | high — share shift is a first-order readthrough | ⚠ curated seed only |
| `substitute` | demand shifts between them on price or technology | curation | medium | symmetric | medium | medium | ❌ |
| `partner` | joint venture, distribution, co-development | curation, news extraction | low-medium | symmetric | medium | medium — mostly episodic | ❌ |
| `input_cost` | a commodity or component is a material COGS line | filings, analyst curation | high | directional (input → company) | medium | high in industrials, materials, staples, airlines | ❌ v1, ✅ v2 |
| `commodity_sensitivity` | revenue or margin moves with a commodity price | curation, statistical | medium | directional | medium | high in energy and materials | ❌ v1, ✅ v2 |
| `geographic_exposure` | material revenue or production in a region | segment disclosures | high | directional (region → company) | medium-high | high — the export-control case | ❌ v1, ✅ v2 |
| `regulatory_exposure` | subject to a named regime | curation | high | directional | medium | high, episodic | ❌ v1, ✅ v2 |

### Tier C — explicitly out of scope, with reasons

| Type | Why not |
|---|---|
| `macro_sensitivity` (rates, USD, oil) | Fans out to nearly everything. A CPI print "relates to" the whole book, so the edge carries no information and the feed becomes a macro newsletter. Only ever admissible if the *target* is a specific name with a *quantified* sensitivity, which is a v3 data problem. |
| `correlation` | Statistical co-movement is not a reason. "NVDA and MSFT are 0.7 correlated" tells an analyst nothing they can act on and is unfalsifiable as a claim about *why*. Correlation belongs in risk tooling, not in an explanation. |
| `portfolio_factor` | Real and useful, but it is a **risk** surface (active weight, crowding — `builders/activeRisk.ts` already exists), not a news readthrough. Mixing them makes both worse. |
| `co_held` (same portfolios) | Circular: everything in the book relates to everything in the book. |

### The two rules the taxonomy turns on

**Direction is not decoration.** `customer` and `supplier` are the same physical fact
read in opposite directions, and they carry *opposite* readthroughs. Microsoft raising
capex is good news read down the supply chain to NVDA. The same fact read the other
way — NVDA's results telling you about Microsoft's spend — is a much weaker inference,
because NVDA sells to many hyperscalers. Storing an undirected edge and letting the
explanation guess the direction is the single most likely way this feature says
something false.

**Strength and confidence are different numbers and must not be multiplied into one
before ranking sees them.**

- **Strength** = *if this relationship is real, how much does it move the target?*
  (MSFT is a large share of NVDA's revenue → strong. MSFT is a customer of a
  200-vendor commodity supplier → weak.)
- **Confidence** = *how sure are we the relationship is real and correctly
  described?* (Disclosed in a 10-K → high. Inferred by a model from a headline → low.)

A weak-but-certain edge and a strong-but-speculative edge are different products.
Collapsing them means a speculative claim can be surfaced as loudly as a disclosed
one, which is exactly the failure mode §10 exists to prevent.

---

## 5. Structured vs inferred sources

### A. Structured / deterministic — no model in the loop

Computable today from data in the product, with an exact provenance string:

- `same_industry` — `assets.industry` equality, or co-membership of a
  `theme_type='sector'` theme. ⚠ `industry` is free text with no taxonomy; equality
  will be noisy ("Semiconductors" vs "Semiconductor Equipment" vs "Semis"). **A
  normalisation pass, or falling back to the auto-seeded GICS sector themes, is a
  prerequisite.**
- `index_cohort` — join through `benchmark_weight_snapshots` /
  `portfolio_benchmark_weights`.
- `theme_member` — `theme_assets` self-join, org-scoped, weighted by the theme's
  `lifecycle_status` (an `invalidated` or `played_out` theme produces no edges).
- `pair_leg` — from pair trade legs.
- `analyst_asserted` — existing `object_links` readthrough rows.
- `co_mentioned` — `object_links` `references` rows, as a corroboration modifier only.

These need **no LLM, no vendor, and no migration to compute** — only a place to store
the result, and a decision about whether to materialise or compute on read (§12).

### B. Curated — humans assert, the product stores

The Tier-B relationships (`customer`, `supplier`, `competitor`) for the **pilot
universe only**. This is a bounded content task, not an engineering one: of the ~900
rows in `assets`, the names that actually matter to pilot readers are far fewer. A
research associate can enter the top three to five customers, suppliers and
competitors for the covered set, sourced from filings, with a citation.

**This is the recommendation, and it is deliberately unglamorous.** The Microsoft→NVDA
example in the brief is a *curated* edge, not an inferred one. Every credible version
of this feature at launch is a curated edge with a model-written sentence on top.

### C. Inferred / model-assisted

The critical design decision of this whole document:

> **In v1, the LLM never creates a relationship. It only writes the sentence for a
> relationship that already exists, given a specific event.**

A hallucinated *edge* ("Company A supplies Company B" — false) is a factual claim
about the world that the product asserts, that a professional user will catch, and
that poisons every future event crossing it. A hallucinated *sentence about a real
edge* ("Microsoft's capex commentary may affect GPU demand") is bounded: the
relationship is true, the event is quoted, and the worst case is an over-eager verb.
The blast radii differ by orders of magnitude.

#### The v1 inference job — event-time relevance and explanation

**When it runs:** once per (event × candidate edge), at ingest, not per reader. Only
for events that have already passed a materiality gate (§10) and only for edges above
the strength floor. Cached on `(event_id, edge_id)` permanently — events are
immutable.

**Inputs (and nothing else):**

```
event:        { headline, summary, source, published_at, primary_symbol, symbols[] }
source_asset: { symbol, company_name, sector, industry }
target_asset: { symbol, company_name, sector, industry }
edge:         { relationship_type, direction, strength_band, provenance_label }
```

Deliberately **not** provided: the reader, their scope, their holdings, their notes,
their org, anything from the book. The model must not be able to tailor a claim to a
position — that is how a research tool becomes a confirmation machine, and it is also
a tenant-isolation hazard (§15).

**Required output schema** (strict; anything else is a hard failure, not a retry):

```jsonc
{
  "relevant": true,                  // is this event material to the target AT ALL
  "channel": "demand",               // demand|supply|pricing|cost|regulatory|
                                     // competitive|capital_allocation|sentiment
  "direction": "positive",           // positive|negative|ambiguous
  "confidence": 0.72,                // 0-1, the model's own
  "explanation": "Microsoft's AI infrastructure spending can affect GPU demand.",
                                     // <= 140 chars, one sentence, hedged verb,
                                     // must name both the event's subject and the
                                     // mechanism; must not name a price or a target
  "quote": "raising capex to $X on AI infrastructure"
                                     // verbatim span from the event text that
                                     // grounds the claim — REQUIRED
}
```

**The `quote` field is the anti-hallucination mechanism.** It must be a verbatim
substring of the supplied headline or summary, and that is **verified in code, not
trusted**. If the span is not found, `relevant` is forced to `false` and the
readthrough is dropped. A model that cannot point at the words justifying its claim
does not get to make the claim. This is cheap, deterministic, and catches the majority
of confabulation.

**Confidence threshold:** the *effective* confidence is
`min(edge.confidence, model.confidence)` — a model cannot be more certain than the
edge it is reasoning over. Suggested v1 floor: **0.6**, tuned against the manual
readthrough corpus before launch rather than guessed at in production.

**Persistence:** the *instance* persists (it is an artifact of an immutable event and
must be reproducible for audit). The *edge* is untouched by inference — a model may
never write to the graph in v1.

**Human inspection and correction:** an admin surface listing recent readthrough
instances with their event, edge, explanation, quote, confidence and engagement,
filterable by relationship type, with actions: *approve*, *suppress this instance*,
*weaken this edge*, *retire this edge*. Every action writes `audit_events` with
`from_state` / `to_state` — the table already supports exactly this shape.

**Not built in this pass.** The above is a specification, not an implementation.

---

## 6. Event → target → user relevance flow

### 6.1 Is the proposed `ReadthroughLink` shape sufficient?

```ts
ReadthroughLink { sourceAssetId, targetAssetId, relationshipType, strength, explanation }
```

**No — it conflates two objects with different lifetimes, and it is missing five
fields the rest of this design depends on.**

The conflation: `sourceAssetId` / `targetAssetId` / `relationshipType` / `strength`
describe a **durable fact about the world** that changes on a scale of quarters.
`explanation` describes **one event's implication**, is valid for one story, and must
be regenerated for the next one. Storing them in one object means either the
explanation is generic ("MSFT is a customer of NVDA" — true, useless) or the edge is
rewritten on every news story, destroying its stability and its audit trail.

Missing:

1. `confidence` — distinct from `strength` (§4).
2. `direction` — `customer` and `supplier` are not interchangeable (§4).
3. `provenance` / `visibility` — a curated global edge, a firm's proprietary edge and
   a model guess must be distinguishable, and the middle one must not leak (§15).
4. A validity window — relationships end. A retired edge must stop producing
   readthroughs without deleting the history that explains past cards.
5. Event grounding — the `quote` span, and the event id.

### 6.2 The proposed shapes

```ts
/**
 * A durable claim about how two assets relate. Global or org-scoped;
 * never reader-scoped. Changes on the scale of quarters, not stories.
 */
interface AssetRelationship {
  id: string
  sourceAssetId: string
  targetAssetId: string
  /** Read as: source <type> target. `customer` = source is a customer of target. */
  relationshipType: RelationshipType
  /** Symmetric edges are stored once and read both ways; directed edges are not. */
  symmetric: boolean

  /** If real, how much does source move target? Banded, not continuous. */
  strength: 'weak' | 'moderate' | 'strong'
  /** How sure are we it is real and correctly described? 0-1. */
  confidence: number

  provenance: {
    source: 'derived' | 'curated' | 'analyst' | 'vendor' | 'model_proposed'
    /** Free text a human can check: "NVDA FY24 10-K, customer concentration". */
    citation?: string
    curatedBy?: string
    curatedAt?: string
  }

  /** Who may see this edge, and therefore any explanation built on it. */
  visibility: 'global' | 'organization' | 'personal'
  organizationId?: string   // required when visibility !== 'global'
  createdBy?: string        // required when visibility === 'personal'

  effectiveFrom?: string
  effectiveTo?: string      // set, never deleted — history stays explicable
  status: 'active' | 'proposed' | 'retired'
}

/**
 * One event's implication for one target, through one edge.
 * Immutable. Cached on (eventId, relationshipId). Not reader-scoped.
 */
interface ReadthroughInstance {
  id: string
  eventId: string
  eventSourceType: 'news' | 'quick_thought' | 'trade_idea' | 'asset_note'
                 | 'earnings_result' | 'economic_release'
  sourceAssetId: string | null    // null for a macro/market event
  targetAssetId: string
  relationshipId: string

  channel: 'demand' | 'supply' | 'pricing' | 'cost' | 'regulatory'
         | 'competitive' | 'capital_allocation' | 'sentiment'
  direction: 'positive' | 'negative' | 'ambiguous'

  /** <=140 chars, hedged, no price, no target. The user-facing sentence. */
  explanation: string
  /** Verbatim span from the event. Verified in code. Never rendered as proof. */
  groundingQuote: string

  /** min(edge.confidence, model.confidence). */
  confidence: number
  generator: 'deterministic' | 'model'
  generatorVersion: string        // prompt + model id, so a bad batch is findable
  generatedAt: string
}

/**
 * What ranking receives. Assembled at read time. Never persisted.
 */
interface ReadthroughCandidate {
  instance: ReadthroughInstance
  relationship: AssetRelationship
  /** The TARGET's relevance to THIS reader, from coverageRelevanceFor(). */
  scopeConnection: CoverageRelevance
  /** All scoped targets of this event, when it reads through to several. */
  siblingTargets: { assetId: string; symbol: string; scope: CoverageRelevance }[]
}
```

Every field earns its place against a failure it prevents: `groundingQuote` →
confabulation; `generatorVersion` → recalling a bad prompt batch; `effectiveTo`
rather than delete → past cards stay explicable; `visibility` → §15; `symmetric` →
the direction bug; `siblingTargets` → the "relates to two names in My Scope" case
in §7.

---

## 7. The personalization chain

```
1. RETRIEVE    an event enters the system                            [global]
2. RESOLVE     edges from the event's subject → candidate targets    [global / org]
3. INSTANTIATE per (event × edge): channel, direction, explanation   [global / org]
4. PERSONALIZE for this reader: coverageRelevanceFor(index, target)  [reader]
5. ADMIT       keep only what clears the scope and quality gates     [reader]
6. RANK        one candidate per event, carrying the target's scope  [reader]
7. EXPLAIN     label + sentence + expandable basis                   [reader]
```

Steps 1–3 run **once**, at ingest. Steps 4–7 run per reader, per feed load, and touch
no model and no vendor. **The graph is never a user-specific object.**

### The cases

**NVDA is in My Scope** (`direct`) — admitted. Label: *"Readthrough to NVDA · My
Scope"*.

**NVDA is Assigned to Me** (`assigned`) — admitted, identical treatment. The two are
kept apart in the label (the reader should know whether this is their own declaration
or the firm's assignment) but score the same, exactly as `coverageWeightFor` and
`coverageBonusFor` already do.

**NVDA is In Portfolio only** (`held`) — admitted at a **higher bar**. A readthrough
is already one inferential step from the reader; a readthrough to a name nobody has
claimed is two steps from anyone's attention. Require `strength = strong` **and**
`confidence ≥ 0.75`, and take the same `0.6` weight the existing `held` band already
carries. This is the tier most likely to generate noise and it needs the tightest gate.

**Multiple scoped targets** — one event reads through to NVDA *and* AMD, both in My
Scope. **Emit one card, not two.** Two cards about one story is the duplication
problem `dedupeKey` exists to prevent, and it is how a single foundry story becomes
the reader's whole morning.

- Primary target = the strongest (scope rank, then strength, then confidence).
- Label becomes *"Related to two names in My Scope"*; the sentence names both:
  *"TSMC advanced-node commentary is relevant to NVDA and AMD."*
- `siblingTargets` carries the rest for the expandable detail.
- Materiality uses the **maximum** across scoped targets — the reader's largest
  exposure to the story is the right measure of what it is worth.
- Cap the named targets at three; beyond that the phrasing becomes *"and 4 other
  names in your scope"*, because a sentence listing seven tickers is a list, not an
  explanation.

**No connection to any target** (`none`) — **dropped entirely, not demoted.** A
readthrough exists *only* because of the reader's connection to the target. With no
connection there is no readthrough; there is just a news story about a company they do
not follow, which the feed already declines to show. This is a hard filter, and it is
different from how `none` is treated for direct cards (there it is a score penalty).
The asymmetry is correct: a direct card about an uncovered name is still a fact about
a name in the book; a readthrough to an uncovered name is a fact about nothing.

**Reader has no coverage at all** (`unknown` everywhere) — **emit no readthroughs.**
`hasAnyCoverage(index) === false` disables the entire feature for that reader. This
follows Refusal 1 in `coverage-relevance.ts` and is the strongest possible statement
of the design: readthrough is a *reward for having told the product what you care
about*. A reader who has declared nothing gets exactly the feed they have today,
bit-for-bit — the same property the coverage work protected.

**Coverage has not loaded** (`ready === false`) — emit no readthroughs, and do not
render a placeholder. Refusal 3: a pending query must never produce a claim.

---

## 8. Ranking input contract

No ranking code changes in this pass. This is the contract the canonical ranker
should eventually receive.

### 8.1 The shape

```ts
interface PriorityInput {
  // ... everything that exists today, unchanged ...

  /**
   * Present only on a readthrough candidate. Absent means "this is a direct
   * card", and every existing call site keeps its exact behaviour.
   */
  readthrough?: {
    targetAssetId: string
    sourceAssetId: string | null
    relationshipType: RelationshipType
    strength: 'weak' | 'moderate' | 'strong'
    confidence: number
    channel: ReadthroughChannel
    /** Number of the reader's scoped names this event reaches. */
    scopedTargetCount: number
  }
}
```

`coverage` is **already** the right field for the scope connection — it just carries
the *target's* relevance rather than the card asset's. **No new scope field.** That is
the whole value of `coverage-relevance.ts` being the one definition.

### 8.2 What affects eligibility vs what affects score

**Eligibility gates — binary, applied before ranking, never as a score penalty:**

| Gate | Rule | Why binary |
|---|---|---|
| Scope | target ∈ {direct, assigned, held}; reader `hasAnyCoverage` | §7 — no connection, no readthrough |
| Confidence | `confidence ≥ 0.6` (0.75 for `held`) | A claim we do not believe should not be made quietly at the bottom of the feed. It should not be made. |
| Strength | `strength ≥ moderate` (`strong` for `held`) | Weak edges are the spam vector |
| Grounding | `groundingQuote` verified verbatim | Ungrounded claim, dropped |
| Event materiality | source event clears its own bar | §8.4 |
| Edge status | `status = 'active'`, within validity window | Retired means retired |

**Score inputs — continuous, only among candidates that already passed:**

| Input | Affects score | Notes |
|---|---|---|
| `strength` | yes | `weak 0 / moderate 0.6 / strong 1.0`, banded like `materialityBand` |
| `confidence` | **only above the gate**, and weakly | Confidence is mostly an admission question. Letting it drive score means a 0.61 and a 0.95 claim differ by a rounding error in position while differing enormously in what they assert — the honest response to low confidence is silence, not a lower rank. |
| `coverage` (of target) | yes | Through the existing `coverageWeightFor` + `coverageBonusFor`. Unchanged. |
| materiality | yes | **Target's** position weight, never the source's (§8.4) |
| `severity` / urgency | yes | Inherited from the source event, capped by the tier rule |
| recency | yes | Existing `recencyBoost`, unchanged |
| `scopedTargetCount` | small positive | An event touching three scoped names is more consequential than one touching one — but bounded, or a sector-wide story wins by fan-out alone |
| `channel` | no | Presentation and copy only. Ranking by channel is a taste judgment with no evidence behind it. |

### 8.3 The tier rule — the most important line in this section

> **A readthrough may never enter tier 0 or tier 1.**

Tiers 0 and 1 mean *"the price has left the framework the desk wrote down"* and *"the
framework itself is missing"*. Both are claims about a **specific position against a
specific written number**. A readthrough establishes neither — it says something
happened elsewhere that *may* bear on a name. Promoting it into a decision tier would
let an inference outrank a fact, which is precisely the failure `priorityFor`'s
tier-before-score partition was built to make impossible.

Placement: **tier 4**, alongside `news`, with a base **below** direct news about a
name in scope. Suggested `readthrough: { tier: 4, base: 0.25 }` against
`news: 0.30` — a story *about* your name always leads a story that merely *reaches*
it. Under no circumstances should a readthrough be promoted the way `project_overdue`
is promoted out of tier 3; there is no condition under which "this might matter"
becomes "you must decide".

**This single rule is worth more than every threshold in §10.** It means the worst
realistic failure of readthrough is a mildly irrelevant card in the informational tail
— not a buried decision. And it means the answer to *"how does an urgent
non-readthrough event still compete?"* is structural rather than tuned: it always
wins, by construction, regardless of how the weights drift.

### 8.4 Avoiding double-counted materiality

An event can be material in three different senses, and adding them is how a mid-cap's
readthrough beats a real position card:

1. **Source materiality** — how big a deal the event is for the company it is about.
2. **Edge strength** — how much of it transmits.
3. **Target materiality** — how much the reader is exposed to the target.

Rule: **(1) is an eligibility gate only; (2) and (3) are the score.** How large
Microsoft's capex announcement is decides whether the event is worth propagating at
all; once it has been propagated, the reader's card is about NVDA, and only NVDA's
size in their book and the strength of the transmission should order it. Letting
source materiality into the score means a huge story about a name the reader does not
hold outranks a moderate story about one they do — an inversion of the entire premise.

Concretely: `materialityBand(weightPct, held)` is called with the **target's** weight.
`deviationPct` is `null` — a readthrough has no framework to deviate from, and
supplying one would be a fabricated number.

### 8.5 Preventing weak-relationship spam

- Gates in §8.2 remove weak edges before ranking sees them.
- **Fan-out cap: at most three targets per event** (highest scope, then strength). A
  single sector story must not become nine cards.
- **Feed cap: at most two or three readthroughs per feed load**, enforced as a
  *category* in the existing `diversify` opening cap — readthrough gets its own
  `categoryOf` value, so it competes for opening slots rather than filling them.
- **Run cap:** readthrough inherits `MAX_RUN`, so no two consecutive readthrough cards.
- **`comparableTotal` must strip the readthrough contribution** the same way it
  already strips the coverage bonus, or readthroughs become incomparable to
  alternatives and silently disable the run rule — the exact bug that comment
  documents.

---

## 9. "Why you're seeing this"

Three layers, and a hard rule about the fourth.

### Layer 1 — headline label (always visible, ≤ 40 chars)

Says **which thing they care about** this relates to. This is the line that earns the
read.

```
Readthrough to NVDA
Readthrough to CAT
Related to two names in My Scope
Readthrough to NVDA · In portfolio
```

The scope qualifier appears only when it is not `direct` / `assigned` — the default
case needs no explanation, the weaker ones do.

### Layer 2 — the sentence (always visible, ≤ 140 chars)

Says **why the relationship matters**. Hedged, mechanistic, no price, no target, no
recommendation.

```
"Microsoft's AI capex outlook may affect GPU demand."
"Dealer inventory commentary from DE may signal weakening construction equipment demand."
"TSMC advanced-node commentary is relevant to NVDA and AMD."
```

Rules, enforced in code and not merely prompted:

- one sentence; hard character cap
- a hedged verb (`may`, `can`, `could`, `may signal`) unless the edge is
  `analyst_asserted`, where an analyst already committed
- names the mechanism (`GPU demand`, `dealer inventory`), not just the entities —
  *"MSFT news is relevant to NVDA"* is a non-explanation and should fail validation
- never a price, a target, a rating, or an action
- never *"our model believes"* or any reference to the machinery

The **what happened** comes from the card's existing headline and source line, which
already work. Readthrough adds the *bridge*, not a second copy of the news.

### Layer 3 — expandable basis (behind "Why am I seeing this")

The existing `CardProvenance.reason` field and the `WHY` action are the home for this.

```
Why you're seeing this
  The story          Microsoft Q3 capex guidance raised    · Reuters · 2h ago
  The connection     Microsoft is a major customer for AI infrastructure
                     Source: NVDA FY24 10-K, customer concentration
                     Curated by Research · reviewed 12 Jun 2026
  Your connection    NVDA is in My Scope
                     Also in Growth Equity (3.2%)

  [ Useful ]  [ Not relevant ]  [ Wrong connection ]
```

Every line is a checkable fact with a citation. **This panel is the enterprise sale** —
it is what makes an inference auditable rather than magic — and it is where the
`provenance.citation` field pays for itself.

### Confidence disclosure

**Never a number.** "72% confident" invites an argument about the number instead of
the investment, is not calibrated in any defensible way, and would be the single most
quoted thing in a product demo for the wrong reasons. The existing `explainPriority`
comment already makes this argument about priority scores, and it applies with more
force here.

Confidence is disclosed **grammatically and structurally**:

- hedged verbs carry it in the sentence
- the provenance line carries it as fact (*"Source: FY24 10-K"* vs *"Sector peer"*)
- and below the threshold, it is disclosed by the card **not existing**

### The prohibition

**No raw model reasoning, ever.** Not the chain of thought, not the prompt, not the
alternatives considered, and not the `groundingQuote` presented as proof of
correctness (a verbatim span proves the model read the story — it does not prove the
inference). The `groundingQuote` is an internal validation artifact and an
admin-surface field.

---

## 10. False-positive safeguards

Ordered by how much noise each one removes. **Readthrough must increase
signal-to-noise. A feature that adds "AI guessed this might matter" cards to a
professional research feed is worse than no feature.**

| # | Safeguard | Rule |
|---|---|---|
| 1 | **Tier ceiling** | Never above tier 4. A readthrough cannot outrank a decision. (§8.3) |
| 2 | **Scope requirement** | Target must be in My Scope / Assigned to Me / In Portfolio. No connection → dropped, not demoted. |
| 3 | **Off for readers with no coverage** | `hasAnyCoverage === false` → feature disabled entirely |
| 4 | **Minimum strength** | `moderate` or better; `strong` for portfolio-only targets |
| 5 | **Minimum confidence** | 0.6; 0.75 for portfolio-only targets |
| 6 | **Source materiality gate** | The event must clear its own bar first. Readthrough is *not* a way for a low-value story to reach a feed it could not otherwise reach. This inverts most recommender designs and is deliberate. |
| 7 | **Grounding verification** | `groundingQuote` verbatim-checked in code; failure → drop |
| 8 | **Fan-out cap** | ≤ 3 targets per event |
| 9 | **Feed cap** | ≤ 2–3 readthroughs per feed load, via the `diversify` category |
| 10 | **No 2-hop** | A readthrough may not originate from a readthrough. Second-order inference compounds error and is unexplainable in one sentence. Hard structural limit in v1 and v2. |
| 11 | **Direct card wins** | If the reader already has a direct card about the target this period, suppress the readthrough — extend `dedupeKey` to `(target, period)`, not just `(type, entity, period)` |
| 12 | **Tier 0/1 suppression** | If the target already has a tier-0 or tier-1 card, suppress the readthrough. Somebody's position has left its framework; a maybe about the same name is noise at the worst moment. |
| 13 | **Repetition suppression** | The same (edge, channel) pair may produce at most one card per reader per N days, however many stories arrive. Ten hyperscaler-capex stories in a week is one readthrough. |
| 14 | **Relationship decay** | Edges carry `effectiveTo` and a review date. `theme_member` edges inherit the theme's `lifecycle_status` — `played_out` and `invalidated` themes produce nothing. Curated edges unreviewed for over twelve months drop a confidence band. |
| 15 | **Provenance floor** | `model_proposed` edges never produce reader-facing cards in v1. They queue for curation. |
| 16 | **Three-way feedback** | *Useful* / *Not relevant* / *Wrong connection* — see §11 |
| 17 | **Kill switch** | A flag (`src/lib/flags.ts` exists) that disables readthrough per org and globally, without a deploy |
| 18 | **Silent shadow period** | Generate instances and log them **before** rendering anything. Measure precision against the manual `object_links` readthrough corpus and against research-lead review. Ship on evidence. |

Safeguard 18 is the cheapest one on this list and the only one that can tell us
whether the rest are set correctly. It should not be skipped for schedule.

---

## 11. Learning and feedback

The governing rule:

> **A user's dismissal is evidence about that user's interests. It is not evidence
> that a supplier relationship is false for everyone.**

Two ledgers, never crossed — the same discipline `feed-feedback.ts` already applies to
keep product complaints out of the research record.

### Ledger A — reader preference (fast, private, per-user)

Signals: card opened, expanded to the basis panel, dismissed, *Not relevant*, target
added to or removed from scope, judgment recorded on the card, repeated engagement
with a channel or relationship type.

- Written to `pilot_telemetry_events` via the existing `recordFeedFeedback` path,
  extended with `relationship_type`, `channel`, `target_asset_id` and
  `readthrough_instance_id`.
- Consumed — eventually — through `PriorityComponents.personalization`, the slot that
  already exists and is documented as being for exactly this.
- Effect is **bounded and reversible**: a per-reader multiplier on readthroughs of a
  given `relationship_type` / `channel`, floored well above zero. A reader who
  dismisses three sector-peer readthroughs sees fewer of them, never none — people's
  interests change, and a feed that learns permanently from a bad week is a feed that
  has quietly stopped working.
- Strictly per-user. Not shared with the org, not visible to colleagues, not exported.

### Ledger B — graph truth (slow, deliberate, reviewed)

Only **Wrong connection** feeds this, and only as *evidence for review* — never as an
automatic edit.

Escalation:

1. One report → logged against the edge. No effect on anyone.
2. Reports from **≥ 3 distinct users in ≥ 2 distinct organizations** → the edge is
   flagged for curator review and drops one confidence band pending it. Two
   organizations, because one firm's house view is a legitimate disagreement rather
   than a fact, and because a single org disliking an edge must not degrade the
   product for every other tenant.
3. A curator retires or corrects the edge → `effectiveTo` set (never deleted), and
   `audit_events` records actor, `from_state` and `to_state`.

For `visibility = 'organization'` edges the quorum is **within that org**, and the
correction affects only that org.

### What must never happen

- A dismissal silently editing a global edge.
- Engagement teaching the system that a *false* relationship is true. Clicks measure
  interest, not correctness — Ledger A may only ever *reorder*, never *promote a
  proposed edge to active*. Promotion is a human act.
- Any per-reader signal reaching the shared graph without human review.
- Learning that cannot be inspected. Every effective multiplier must be legible in the
  admin surface, or the feature becomes unfalsifiable.

---

## 12. Storage and compute

| | **A. Persist a stable graph** | **B. Infer per event** | **C. Hybrid — stable graph + event-time reasoning** |
|---|---|---|---|
| **Latency** | Best — a join | Worst — a model call in the read path, or an ingest queue for every story | Good — the model runs at ingest per (event × edge) and is cached; reads are joins |
| **Cost** | Near zero after curation | Highest and unbounded — scales with story volume × universe size, with no cache key that repeats | Bounded — one call per (event × surviving edge). The gates in §10 cut this by an order of magnitude before any call is made |
| **Explainability** | Best per edge (every edge has a citation), but explanations are generic | Poor — nothing durable to point at; the same story can be explained differently twice | Strong — durable edge with a citation, plus one grounded cached sentence |
| **Maintenance** | Curation burden; edges go stale silently | No curation, but no correction mechanism either — a bad inference recurs forever with nothing to fix | Curation burden on a *small* edge set; instances are disposable and regenerable |
| **Freshness** | Poor — a new supply agreement is invisible until curated | Best — reflects today's news by construction | Good for events, lagged for structure. Acceptable: supply chains change quarterly, news changes hourly |
| **Auditability** | Best | Effectively none — non-deterministic and unreproducible | Strong — the edge is versioned, the instance carries `generatorVersion` and `groundingQuote` |
| **Correctability** | Best — fix one row and every future card is fixed | Impossible — nothing to correct | Best, same as A — the edge is the correction surface |

### Recommendation: **C, with a deliberately conservative v1**

Specifically:

- **Structure is persisted and human-owned.** Deterministic edges materialised nightly;
  curated edges entered by hand with citations. The graph is small, slow-moving and
  correctable.
- **Implication is computed at ingest and cached permanently** on
  `(event_id, edge_id)`, because events are immutable.
- **Personalization is computed at read time and never stored**, because it is a cheap
  set lookup against `CoverageIndex` and storing it would multiply rows by users for no
  gain.
- **The model may never write to the graph in v1.**

The cost shape matters and is worth stating: the gates in §10 (source materiality,
edge strength, edge status) run *before* any model call. A typical day's stories for a
pilot universe, after gating, is a small number of `(event, edge)` pairs, each a short
Haiku-class call through the existing `ai-chat` `analysis` purpose route — which
already has per-org budgets, rate limits and `ai_usage_log` cost accounting. **The cost
control mechanism is already built.**

Option B is rejected primarily on **correctability**, not cost. A product that tells a
portfolio manager something false about a supply chain and offers no way to fix it is
not shippable into an enterprise, at any price.

---

## 13. Fourteen concrete investment examples

Generic and illustrative — no live news. Each shows: source event → target →
relationship → why it matters → how Tesseract says it.

**1. Semiconductors — hyperscaler capex (the flagship)**
Event: a large cloud provider raises AI infrastructure capex guidance.
Target: a GPU vendor. Relationship: `customer` (source is a customer of target),
strength `strong`, channel `demand`, source: customer-concentration disclosure.
Why: the buyer of the target's highest-margin product just told the market it intends
to buy more.
> **Readthrough to NVDA** — *"Microsoft's AI capex outlook may affect GPU demand."*

**2. Semiconductors — foundry commentary, two targets**
Event: a leading foundry comments on advanced-node capacity and pricing.
Targets: two fabless designers, both in My Scope. Relationship: `supplier`, strength
`strong`, channel `supply`.
> **Related to two names in My Scope** — *"TSMC advanced-node commentary is relevant to NVDA and AMD."*

**3. Semiconductors — export controls**
Event: new export restrictions on advanced computing hardware to a region.
Target: a semiconductor capital-equipment maker. Relationship: `geographic_exposure`
(v2), strength `strong`, channel `regulatory`.
> **Readthrough to a semicap holding** — *"New export restrictions may limit shipments to a region that is a material share of revenue."*

**4. Software / cloud — seat-based pricing pressure**
Event: a large enterprise-software vendor reports slowing seat growth and discounting.
Target: a competing SaaS platform. Relationship: `competitor`, strength `moderate`,
channel `pricing`.
> **Readthrough to a SaaS holding** — *"Discounting at a large enterprise vendor may signal broader seat-growth pressure."*

**5. Software / cloud — infrastructure cost**
Event: a hyperscaler raises published compute pricing.
Target: an AI-native application company. Relationship: `input_cost` (v2), strength
`moderate`, channel `cost`.
> **Readthrough to an application holding** — *"Higher cloud compute pricing may pressure gross margin at inference-heavy applications."*

**6. Consumer — traffic commentary as a category read**
Event: a mass-market retailer describes weakening discretionary basket size.
Target: a mid-tier apparel brand. Relationship: `same_industry` + `theme_member`
("US consumer health"), strength `moderate`, channel `demand`.
> **Readthrough to an apparel holding** — *"Softer discretionary basket commentary at Walmart may point to weaker mid-tier apparel demand."*

**7. Consumer staples — input cost**
Event: a packaging producer raises resin prices.
Target: a packaged-food company. Relationship: `supplier` / `input_cost`, strength
`moderate`, channel `cost`.
> **Readthrough to a staples holding** — *"Resin price increases may raise packaging costs into next year's guidance."*

**8. Industrials — dealer inventory (the brief's own example)**
Event: an agricultural-equipment maker flags elevated dealer inventories.
Target: a construction-equipment maker. Relationship: `same_industry` +
`analyst_asserted`, strength `moderate`, channel `demand`.
> **Readthrough to CAT** — *"Dealer inventory commentary from DE may signal weakening construction equipment demand."*

**9. Industrials — freight as a leading indicator**
Event: a major freight carrier cuts volume guidance.
Target: a distribution and logistics company. Relationship: `same_industry`, strength
`moderate`, channel `demand`.
> **Readthrough to a distributor holding** — *"Lower freight volume guidance may indicate softening industrial shipment activity."*

**10. Financials — credit normalisation**
Event: a large card issuer raises its provision for credit losses.
Target: a regional bank with a consumer-lending book. Relationship: `same_industry` +
`theme_member` ("US consumer credit"), strength `moderate`, channel `demand`.
> **Readthrough to a regional bank holding** — *"Rising card-issuer provisions may point to broader consumer credit normalisation."*

**11. Healthcare — reimbursement**
Event: a payer announces tighter coverage criteria for a therapy class.
Target: a specialty pharmaceutical company with revenue in that class. Relationship:
`regulatory_exposure` (v2), strength `strong`, channel `regulatory`.
> **Readthrough to a pharma holding** — *"Tighter coverage criteria may affect volumes in a class that is a material share of revenue."*

**12. Healthcare — procedure volumes**
Event: a hospital operator reports higher elective procedure volumes.
Target: a medical-device manufacturer. Relationship: `customer`, strength `strong`,
channel `demand`.
> **Readthrough to a device holding** — *"Higher elective procedure volumes at hospital operators may support device unit demand."*

**13. Energy — differentials**
Event: a midstream operator reports a pipeline constraint widening regional
differentials. Target: an E&P producer concentrated in that basin. Relationship:
`geographic_exposure` + `supplier`, strength `strong`, channel `pricing`.
> **Readthrough to an E&P holding** — *"Widening basin differentials may affect realised pricing for producers concentrated there."*

**14. Energy — the counter-example, deliberately included**
Event: crude oil closes up 3%. Target: an integrated energy major. Relationship:
`macro_sensitivity`, strength `weak`, confidence low.
> **No card.** This is Tier C in §4. Every energy name "relates to" the oil price; the
> edge carries no information, the explanation would be a tautology, and shipping it is
> how the feed becomes a commodity ticker. **The right output is silence.**

Note the shape of the copy across all of these: **hedged verb, named mechanism, no
price, no recommendation, no reference to the machinery.** They read like a colleague
pointing something out, which is the register the surface should hold.

---

## 14. Integration with the current architecture

### 14.1 The pipeline, with the new stages marked

```
  ┌─ EXISTING ──────────────────────────────────────────────────────────┐
  │ candidate retrieval                                                  │
  │   MobileDashboard.newsSymbols  →  useMarketNews  →  market-news fn    │
  │   useIdeasFeed.fetchFeedPage                                         │
  └──────────────────────────────┬───────────────────────────────────────┘
                                 │   ▲ CHANGE #1: symbol set must expand to
                                 │     scope ∪ 1-hop neighbours (§1.4)
                                 ▼
  ┌─ NEW ────────────────────────────────────────────────────────────────┐
  │ relationship resolution   lib/readthrough/resolve-edges.ts           │
  │ instance lookup / build   lib/readthrough/instances.ts               │
  └──────────────────────────────┬───────────────────────────────────────┘
                                 ▼
  ┌─ EXISTING, UNCHANGED ────────────────────────────────────────────────┐
  │ ScopeRelevance   lib/signals/coverage-relevance.ts                   │
  │                  coverageRelevanceFor(index, TARGET_ASSET_ID)        │
  └──────────────────────────────┬───────────────────────────────────────┘
                                 ▼
  ┌─ NEW ────────────────────────────────────────────────────────────────┐
  │ admission / gating        lib/readthrough/admit.ts   (§8.2, §10)     │
  │ card construction         lib/signals/builders/readthrough.ts        │
  └──────────────────────────────┬───────────────────────────────────────┘
                                 ▼
  ┌─ EXISTING, MINIMAL ADDITIONS ────────────────────────────────────────┐
  │ canonical ranking   lib/signals/feed-priority.ts                     │
  │   + TIER entry for 'readthrough' (tier 4, base 0.25)                 │
  │   + optional PriorityInput.readthrough                               │
  │   + diversify categoryOf gets a 'readthrough' category               │
  │   + comparableTotal strips the readthrough contribution              │
  ├──────────────────────────────────────────────────────────────────────┤
  │ explanation      contract.ts CardProvenance.reason (exists)          │
  │ presentation     SignalCardView / mobile card (both lanes' files)    │
  └──────────────────────────────────────────────────────────────────────┘
```

### 14.2 Before or after candidate normalization?

**Relationship resolution runs BEFORE normalization; admission runs AFTER.**

Resolution needs the *raw event* — its subject symbol, its text, its provider metadata
— which normalization discards. Admission needs the *normalized candidate*, because it
must compare against the other cards competing for the same feed (§10 safeguards 11 and
12 are comparisons across candidates).

So a readthrough enters the pipeline as **a normalized candidate like any other**,
carrying an extra `readthrough` block. It is not a parallel feed, not a separate
section, and not a post-processing pass over the ranked list. Anything else
reintroduces the problem `feed-priority.ts` was written to fix — cards that render
outside the ranking and therefore cannot be compared to it. The scenario-cards block is
the cautionary tale, and its header says so.

### 14.3 Does candidate retrieval need a readthrough pool?

**Yes — and this is the largest engineering change in the feature.**

The needed symbol set is `reader scope ∪ {1-hop neighbours of scope, capped}`. Two
consequences:

- **Provider cost is no longer bounded by the reader's attention.** The current cap of
  24 symbols was chosen because the marginal cost of a name is a longer query string —
  but that is true for Alpha Vantage's batched `tickers=` call and *false* for Finnhub
  and Yahoo, which the edge function queries **per symbol in a loop**. A 24 → ~80
  symbol expansion is roughly a 3× multiplier on those loops. This needs measuring
  before it is designed around.
- **The neighbour set should be cached org-wide, not per reader**, and should drive a
  **shared** news fetch. Two analysts covering NVDA and AMD have overlapping neighbour
  sets; fetching per reader duplicates provider calls for identical data. The edge
  function's existing symbol-set-keyed cache is the right place.

A cheaper interim: fetch news for the **union of the org's coverage plus a curated
watch set of roughly 30 bellwethers** (the hyperscalers, the large-cap index leaders,
the majors) whose events read through to many names. This gets the flagship example
working without a general neighbour expansion, and is the recommended v1 (§16).

### 14.4 Where this logic must NOT go

| Don't | Why |
|---|---|
| `src/lib/signals/coverage-relevance.ts` | It answers one question — *what is this asset to this reader* — and it is the shared definition across both shells. Adding relationship logic makes it the second thing it does and puts it in the readthrough lane's blast radius. It should be **called** by readthrough, never modified for it. |
| `src/components/mobile/MobileDashboard.tsx` | 5,000+ lines and the reason the feed once had three ranking mechanisms. New pipeline stages go in `src/lib/`, pure, so the gallery can import them. |
| `useIdeasFeed.scoreFeedItem` | Desktop's scorer, owned by the lane this pass runs alongside. Readthrough must not touch it. |
| `src/lib/signals/builders/news.ts` | A readthrough is not a news card with an extra line; it is a card about a *different asset* than the story's subject. Branching inside `buildNewsCard` reintroduces the per-type special-casing the contract exists to prevent. New builder. |
| Any component | No component may resolve a relationship, call a model, or decide admission. The contract's rule — *no card component reads from the database, no card component special-cases a type* — holds. |
| `explainPriority` | Explicitly "never for the product surface". The reader-facing explanation is `provenance.reason`, built by the builder. |

### 14.5 Files likely involved later (not touched in this pass)

**New:** `src/lib/readthrough/{types,resolve-edges,instances,admit,explain}.ts`,
`src/lib/signals/builders/readthrough.ts`, an ingest edge function, an admin curation
surface.

**Modified later, by agreement across lanes:** `src/lib/signals/feed-priority.ts`
(TIER entry, optional input, diversify category), `src/lib/signals/contract.ts`
(`SignalType`), `supabase/functions/market-news/index.ts` (symbol set),
`src/hooks/useMarketNews.ts`, `src/lib/signals/feed-feedback.ts` (third feedback key),
`src/types/database.ts` (regenerate — it is stale and already forcing an `as never`
cast in `readthrough-service.ts`).

**Read but never modified:** `coverage-relevance.ts`, `useCoverageRelevance.ts`.

---

## 15. Enterprise and security implications

The graph is the first thing in Tesseract where **a firm's proprietary intellectual
property would be stored as structured data**. An analyst's mapping of who really
supplies whom is research output, sometimes the most valuable kind. This changes the
security posture from "tenant isolation as hygiene" to "tenant isolation as the product
promise", and it must be designed in, not added.

### Three visibility classes, enforced at the row

| Class | Contents | Rule |
|---|---|---|
| `global` | Public or derived structure: sector, index cohort, curated relationships from public filings with citations | Readable by all tenants. `organization_id IS NULL`. Writable only by platform admins. |
| `organization` | The firm's own map — analyst-curated supplier/customer links, house themes, proprietary channel checks | `organization_id NOT NULL`, RLS `organization_id = current_org_id()`, ANDed across the whole policy and never OR-ed into a branch (the pattern `benchmark_weight_snapshots` already follows) |
| `personal` | A single analyst's working links, including today's hand-marked readthroughs | `created_by = auth.uid()`; visible to the org only if explicitly promoted |

### The leak vectors, and the rule for each

1. **The explanation is the leak.** A readthrough sentence built on an org-private edge
   *is* that edge, restated. Any cached explanation must carry the visibility of the
   **most restricted edge** used to build it, and a global cache may never be populated
   from an org edge. Instances are cached on `(event, edge)` and inherit the edge's
   visibility — which is why visibility lives on the edge and is copied, not inferred.
2. **The model call is the leak.** The v1 inference input (§5) deliberately excludes
   the reader, the org, holdings and notes. That is a product decision *and* an
   isolation control: nothing tenant-specific reaches a provider. When an org edge is
   the subject of a call, the call must run under that org's BYOK config
   (`organization_ai_config`) — a firm's proprietary structure must not travel through
   the platform's shared key. `get_org_ai_config_for_resolution` already enforces
   membership for exactly this reason.
3. **Retrieval is the leak.** The 1-hop neighbour expansion (§14.3) derives a symbol
   list from the graph. If org edges contribute, that list encodes them and must not be
   cached across tenants. The cache key must include `organization_id` whenever an org
   edge contributed — the same shape as the existing org-scope guard on React Query
   keys.
4. **Aggregate learning is the leak.** The cross-org quorum in §11 must never surface
   *which* org reported an edge, and must never operate on `organization`-visibility
   edges at all.

⚠ **Blocking prerequisite:** `object_links` — the table the manual readthrough feature
already writes to — is not in the migration ledger and its `organization_id` and RLS
are unverified. Given the standing schema-drift caveat, **this must be read off
production before any readthrough work builds on it.** If those rows are not org-scoped
today, that is a live tenant-isolation question about a shipped feature, independent of
anything in this document.

### Governance

- **Who may curate:** org admins and a designated research-lead capability. The
  `user_capabilities` / `authority-map.ts` machinery exists.
- **Who may propose:** any member. Proposals land as `status = 'proposed'` and produce
  no reader-facing cards (§10, safeguard 15).
- **Who may override a global edge for their org:** an org curator, by creating an
  `organization` edge that shadows it. The global edge is never mutated by a tenant.
- **Audit:** every create / promote / weaken / retire writes `audit_events` with actor,
  entity, `from_state` and `to_state`. That table already carries a checksum,
  parent-entity linkage and a retention policy — it is the correct home, and this is a
  decision about an entity rather than product feedback, so the `feed-feedback.ts`
  split points here rather than at `pilot_telemetry_events`.

---

## 16. V1 / V2 boundary

The brief's hypothesis is close to right. Two amendments, both from the audit.

### Amendment 1 — retrieval leads, not the graph

The brief's V1 starts with relationships. But §1.4 shows the Microsoft story never
enters the system at all. **A perfect graph with today's retrieval produces zero
readthroughs.** The first shippable increment is a retrieval change, and it has
standalone value: a curated bellwether news pool makes the feed better even before any
edge exists.

### Amendment 2 — `theme_assets` outranks sector as the v1 edge source

The brief assumes sector/peer is the natural starting point. The audit suggests
otherwise:

- `assets.industry` is **free text with no taxonomy** — equality matching will be noisy
  and needs normalisation work before it produces trustworthy edges.
- `theme_assets` is **already an analyst's own curated map** of what relates to what,
  already org-scoped, already carrying a `lifecycle_status` that models decay, and
  already seeded with the 11 GICS sectors per org so it is never empty.

Themes give better edges *and* better explanations ("both in your Datacenter Buildout
theme" is a reason a reader recognises, because they wrote it) for less work. Sector
equality becomes the fallback beneath it.

### V1 — the smallest thing that is genuinely useful

1. **Bellwether news pool.** Expand the news symbol set beyond the reader's visible
   names to a curated set of roughly 30 large-cap bellwethers plus the org's full
   coverage union. Measure the provider-cost impact of the per-symbol loops first.
2. **Edge sources, in priority order:** `analyst_asserted` (existing `object_links`
   readthroughs — free, highest confidence, already there), `theme_member`, `pair_leg`,
   `same_industry` (fallback), `index_cohort` (weak).
3. **A hand-curated `customer` / `supplier` seed set** for the pilot universe's top
   names, with filing citations. Bounded content work. This is what makes the flagship
   example real.
4. **The LLM writes the sentence only.** No edge inference. Grounding quote verified in
   code. Runs at ingest through the existing `ai-chat` `analysis` route.
5. **Conservative gates:** `strength ≥ moderate`, `confidence ≥ 0.6`, ≤ 3 targets per
   event, ≤ 2 cards per feed, tier-4 ceiling, off entirely for readers with no coverage.
6. **Three-layer explanation** with the provenance panel.
7. **Three-way feedback**, both ledgers wired, neither yet consumed by ranking.
8. **A shadow period before rendering.**

### V2

- Model-*proposed* edges into a curation queue, with a human promotion step.
- Tier-B relationship types as real data: `input_cost`, `commodity_sensitivity`,
  `geographic_exposure`, `regulatory_exposure`.
- Event characterisation (§2, item 4) — classifying what kind of claim a story makes,
  so a supplier edge only carries demand stories and a regulatory edge only carries
  regulatory ones. **This is the biggest single precision gain available after v1**,
  and it may deserve to be pulled forward if the shadow period shows channel mismatches
  dominating the false positives.
- Ledger A consumed through `PriorityComponents.personalization`.
- General 1-hop neighbour retrieval, replacing the bellwether list.
- Org-curated relationship management as a first-class surface.

### V3 and beyond

Factor and macro sensitivity with quantified per-name exposures; cross-org relationship
quorum; readthrough on filings and transcripts rather than headlines.

**Never:** 2-hop readthrough. Unquantified macro edges. Correlation as an explanation.

---

## 17. Recommended implementation sequence

Each step is independently shippable and independently reversible. Nothing here is
started in this pass.

| # | Step | Why here |
|---|---|---|
| 0 | **Verify `object_links` against production** — columns, indexes, `organization_id`, RLS. Regenerate `src/types/database.ts`. | Blocking. The manual readthrough feature already writes here; §14.5 and §15 both depend on the answer, and the `as never` cast is a standing smell. |
| 1 | **Rename `generateDiscoveryItems`** to something that does not claim the product word "Discovery". | Two-line change; prevents a terminology collision that gets expensive later. Cross-lane — coordinate. |
| 2 | **Measure the news retrieval cost curve.** How much does the `market-news` function actually cost at 24 vs 50 vs 100 symbols, given the per-symbol loops in three of four providers? | Decides whether v1 is a bellwether list or a general expansion. Cheap to answer, expensive to guess. |
| 3 | **Ship the bellwether news pool.** No graph, no readthrough. Just a wider candidate set, behind a flag. | Standalone value, de-risks the largest infrastructure change, and produces the corpus the rest is tuned against. |
| 4 | **Design-review the `AssetRelationship` / `ReadthroughInstance` schema** against production, with visibility classes and RLS. Still no migration. | The security model (§15) must be settled before any firm's IP is storable. |
| 5 | **Materialise deterministic edges read-only** — `theme_member`, `pair_leg`, `same_industry`, `index_cohort`, plus existing `analyst_asserted` rows. No UI. Inspect them. | Answers "does the graph even look sane?" before anything is rendered. |
| 6 | **Curate the customer/supplier seed set** for the pilot universe, with citations. Content work, parallel to 4–5. | The flagship example is a curated edge. This is the long-lead item — start it early. |
| 7 | **Build the ingest inference job** — explanation only, grounding verified, cached on `(event, edge)`, through `ai-chat` `analysis`. Output logged, nothing rendered. | The shadow period (§10, safeguard 18). |
| 8 | **Evaluate precision** against the manual readthrough corpus and research-lead review. Tune thresholds on evidence. **Go / no-go gate.** | The only honest place to decide whether this ships. |
| 9 | **Add the ranking seam** — `TIER` entry, optional `PriorityInput.readthrough`, diversify category, `comparableTotal` fix. Cross-lane; needs the desktop lane's agreement. | Small and mechanical *if* steps 4–8 got the contract right. |
| 10 | **Build the card and the explanation panel**, mobile first. Behind a flag, one org. | |
| 11 | **Wire the three-way feedback**, both ledgers. Consumed by nobody yet. | Collecting before consuming is what makes step 12 possible. |
| 12 | **Admin curation surface** — inspect, weaken, retire, with `audit_events`. | Ships before general availability, not after. A graph nobody can correct is not enterprise software. |

The gate at step 8 is the point of the whole sequence. Everything before it is
reversible and cheap; everything after it is a commitment. **If precision does not
clear the bar there, the correct outcome is to ship steps 3 and 6 — a wider news pool
and a curated relationship map that the product merely displays — and stop.** That is
still a better product than today.

---

## 18. Files touched

Documentation only, as intended.

| File | Change |
|---|---|
| `docs/readthrough-intelligence.md` | **new** — this document |

No source file, migration, test, or configuration was modified. No schema was created.
No ranking code was changed. No desktop or mobile UI was touched. Nothing was merged,
deployed, or pushed to Netlify.

### Open questions for the product owner

1. **`object_links` org scoping** — blocking, and possibly a live isolation question
   about the already-shipped manual readthrough (§15).
2. **Curated seed set** — who does the content work in §17 step 6, and for which
   universe? This is the long pole and it is not an engineering task.
3. **Portfolio-only targets** — should a readthrough reach a name that is `held` but
   nobody has claimed? §7 says yes at a tighter bar; the opposite (My Scope and
   Assigned to Me only) is defensible and materially quieter.
4. **The "Discovery" word** — is it a user-facing product concept, or does
   `generateDiscoveryItems` keep it?
5. **Which shell first?** Mobile has the manual readthrough, the action rail, the
   telemetry weight of 30, and the canonical ranker. Desktop is being redesigned in a
   parallel lane. Mobile-first is the recommendation.
