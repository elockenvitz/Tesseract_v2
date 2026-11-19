# Chart annotation persistence — schema reconciliation plan

**Status: BLOCKED pending approval. No migration applied. No code written.**

The two migrations described here exist as reviewable files, deliberately
**outside** `supabase/migrations/` so that no tooling can apply them:

- [`proposed-migrations/chart_annotations_A_schema.sql`](proposed-migrations/chart_annotations_A_schema.sql)
  — schema only, no rows touched
- [`proposed-migrations/chart_annotations_B_retire_legacy.sql`](proposed-migrations/chart_annotations_B_retire_legacy.sql)
  — retires the three legacy rows, reversible, with a guard that aborts if the
  row count has drifted from what was measured

Moving either file into `supabase/migrations/` is the act that proposes
applying it. See [`proposed-migrations/README.md`](proposed-migrations/README.md).

Everything below production-side was measured read-only on 2026-11-17/18
(`current_user` = `supabase_read_only_user`, `transaction_read_only` = `on`,
verified before each query).

---

## 1. Actual production schema

`public.chart_annotations`, 19 columns:

| column | type | null | default |
|---|---|---|---|
| id | uuid | NO | gen_random_uuid() |
| user_id | uuid | NO | — |
| chart_id | uuid | YES | — |
| feed_item_id | uuid | YES | — |
| feed_item_type | text | YES | — |
| annotation_type | text | NO | — |
| x1 | numeric | NO | — |
| y1 | numeric | NO | — |
| x2 | numeric | YES | — |
| y2 | numeric | YES | — |
| text_content | text | YES | — |
| color | text | YES | '#6366f1' |
| stroke_width | integer | YES | 2 |
| is_dashed | boolean | YES | false |
| is_visible | boolean | YES | true |
| symbol | text | YES | — |
| timeframe | text | YES | — |
| created_at | timestamptz | YES | now() |
| updated_at | timestamptz | YES | now() |

No `organization_id`. No JSON column.

## 2. Migration / schema mismatch

`supabase/migrations/20251215000001_add_charting_tables.sql` declares a
**different table**:

```sql
type TEXT NOT NULL,
data JSONB NOT NULL,     -- coordinates, style, properties
z_index INTEGER DEFAULT 0,
visible BOOLEAN DEFAULT true,
locked BOOLEAN DEFAULT false,
```

Production has **none of those five columns**. So the repo's migration history
does not describe production, and the JSONB design exists only in the file. Any
plan that assumes `data jsonb` is already there is wrong.

## 3. Dead hook assumptions

`src/hooks/useChartData.ts:199`, `useChartAnnotations`. Written against the
migration, so it cannot work against production:

- `.order('z_index', { ascending: true })` — no such column. PostgREST 400.
- `annotations.map(a => a.data)` — no such column. Every annotation becomes
  `undefined` even on a successful read.
- `.eq('chart_id', chartId)` with `enabled: !!chartId` — all three live rows
  have `chart_id` NULL, so it would match nothing regardless.

**It has zero callers.** The only occurrence of the name in the repository is
its own definition. This is dead code, not a live defect — but it is a trap:
it reads like a working persistence layer.

## 4. Existing rows

Three, and they store **canvas pixels, not time and price**:

```
vertical   COIN 1Y  x1=595  y1=0        x2=595  y2=280.546875
rectangle  COIN 1Y  x1=524  y1=255.328  x2=426  y2=160.328
rectangle  COIN 1Y  x1=397  y1=122.328  x2=314  y2=129.328
```

COIN trades near $230, so y=0 and y=280.55 are not prices, and x=595 is not a
timestamp. A pixel does not survive a resize, a pan, a zoom or a timeframe
change: the mark would drift away from the data it was drawn about.

All three share `created_at` to the microsecond
(`2026-01-24 15:05:49.874229+00`), one user, all `feed_item_type =
'thesis_update'`, all `chart_id` NULL. No application code writes this table
(the only repo references are the dead hook and
`scripts/tenant-boundary-lint.mjs`), so they were inserted directly. Per
CLAUDE.md they are not evidence any feature works.

Also note `annotation_type = 'vertical'`, while the application's union uses
`'vertical-line'`. The existing rows do not even use the app's vocabulary.

## 5. What the flattened columns cannot hold

The in-memory model (`src/components/charting/engine/annotations.ts`) is
already correct — it works in **unix seconds and price**, via
`startTime/startPrice/endTime/endPrice`. Mapping it onto today's columns loses:

| union field | today | loss |
|---|---|---|
| `style.lineWidth` | `stroke_width integer` | **the DEFAULT is 1.5** — truncated |
| `style.lineStyle` | `is_dashed boolean` | `'dotted'` unrepresentable |
| `style.fillColor` | — | dropped |
| `style.fillOpacity` | — | dropped (default 0.1) |
| `style.fontSize` | — | dropped |
| `locked` | — | dropped; the hit-test already reads it |
| `fibonacci.levels` | — | dropped (7 numbers) |
| `text.anchor` | — | dropped |
| `line.label` | — | dropped |

The first row is the one that matters most: the flattening is lossy for the
**default style of every annotation**, not only for exotic fields. An integer
column cannot store 1.5.

## 6. Proposed canonical schema

Keep production's flattened geometry (it is the truth, and three junk rows are
nothing to preserve), add what the typed union needs, and **state the
coordinate domain in the column names** so a pixel can never be mistaken for a
price again.

```sql
-- UNAPPLIED. Requires approval. Dev/staging first.
alter table public.chart_annotations
  add column if not exists style jsonb not null default '{}'::jsonb,
  add column if not exists is_locked boolean not null default false,
  add column if not exists anchor_domain text not null default 'pixel'
    check (anchor_domain in ('pixel', 'time_price'));

-- lineWidth 1.5 is the DEFAULT style and does not fit an integer.
alter table public.chart_annotations
  alter column stroke_width type numeric(5,2);

comment on column public.chart_annotations.x1 is
  'When anchor_domain = time_price: unix SECONDS. When pixel: legacy canvas x.';
comment on column public.chart_annotations.y1 is
  'When anchor_domain = time_price: a PRICE in the instrument''s quoting currency.';
comment on column public.chart_annotations.anchor_domain is
  'Which coordinate system x1/y1/x2/y2 are in. Legacy rows are pixel and are not renderable.';
```

### Price/time anchor representation

- **x = unix seconds** (integer-valued numeric), matching `OHLC.time` and
  `ChartPoint.time` in `src/lib/charting/annotation-geometry.ts`.
- **y = a price**, in the instrument's quoting currency, stored as given.
  **Not** normalised and **not** converted: GBp is pence and GBP is pounds, and
  the existing `classifyQuotingCurrency` / `displayMoney` handle presentation.
  Storing a converted number would make the stored mark depend on an FX rate at
  write time.
- `symbol` + `timeframe` stay as written; the anchor is absolute, so a mark
  drawn on 1D renders correctly on 1Y without rescaling. That is the whole
  point of leaving pixels behind.
- `style jsonb` holds `AnnotationStyle` plus `levels`, `anchor`, `label`. The
  geometry stays in columns so it remains queryable and indexable.

`anchor_domain` defaulting to `'pixel'` is deliberate: it makes every existing
row self-describing as legacy without an UPDATE, and makes a new writer state
its domain explicitly. New code writes `'time_price'`.

## 7. RLS posture

**No RLS change is required, and none should be made.**

Measured: RLS enabled, 4 policies, all owner-scoped on `auth.uid() = user_id`
(SELECT / INSERT / UPDATE / DELETE). The UPDATE policy has no `WITH CHECK`,
which is safe because Postgres reuses `USING` for the new row, so a user cannot
reassign a row to another `user_id`.

Two things to decide explicitly rather than inherit:

1. **There is no `organization_id`.** Annotations are owner-scoped only. The
   moment an annotation is shown to anyone but its author — which is what
   linking it to a research record implies — that becomes a tenant question.
   Per the org-feature rule this needs RLS authorization *and* a cross-org test
   in the same change.
2. `anon` holds a SELECT privilege on the table. It is inert behind RLS (no
   policy grants anon a row), but it should be revoked on principle; that is a
   grant change and therefore needs approval separately.

## 8. Legacy records — preserve or retire

Three rows, one user, inserted by hand, in a coordinate system that cannot be
rendered. **Recommendation: retire them explicitly, do not migrate them.**

There is no sound backfill. Recovering a price from y=280.55 would need the
exact canvas height, price range and padding of the viewport that created it in
January, none of which was stored. Any conversion would be an invented number
presented as the analyst's mark — exactly what the provenance rule forbids.

Retire by marking, not deleting, so the decision is visible:

```sql
-- UNAPPLIED.
update public.chart_annotations
   set is_visible = false,
       style = style || jsonb_build_object(
         'legacy_retired', true,
         'legacy_reason', 'pixel anchors; no viewport recorded, not recoverable')
 where anchor_domain = 'pixel';
```

If you would rather they were gone, deleting 3 hand-inserted rows is also
defensible — but that is a destructive production write and needs its own
explicit approval, and there is **no production backup** (`backups: []`,
`pitr_enabled: false`), so a recovery point has to be captured by hand first.

## 9. Bounded migration + test plan

Deliberately small. Three steps, each independently revertible.

**Step 1 — schema (migration A).** The `alter table` above. Additive: three new
columns with defaults plus one type widening (`integer` → `numeric(5,2)`,
which cannot fail on existing data). No policy, no grant, no data change.

**Step 2 — retire legacy (migration B).** The `update` above. Separate file so
step 1 can ship without touching a row.

**Step 3 — code.**
- Delete `useChartAnnotations` rather than repair it.
- Add a mapper, `src/lib/charting/annotation-record.ts`, pure, both directions:
  `toRecord(annotation, ctx)` and `fromRecord(row)`.
- Wire save/load in `ChartingPage` against the existing
  `annotation-geometry` / `annotation-history` modules, which already work in
  the time/price domain and need no change.

**Tests, all in already-gated directories:**

1. **Round-trip is lossless for every variant of the union** — one case per
   member (`horizontal-line`, `vertical-line`, `trend-line`, `ray`,
   `rectangle`, `ellipse`, `fibonacci`, `text`, `arrow`), asserting
   `fromRecord(toRecord(a)) ≡ a`. This is the test the current schema would
   fail: `lineWidth: 1.5` and `levels` both survive or the test reds.
2. **`lineWidth: 1.5` survives.** Named separately because it is the default
   and because an integer column is what broke it.
3. **`'dotted'` survives**, since `is_dashed` cannot express it.
4. **A pixel-domain row never renders.** `fromRecord` on an `anchor_domain =
   'pixel'` row returns null, and the loader drops it. Proven by fault
   injection: force it to `'time_price'` and assert the test fails.
5. **The vocabulary gap is explicit.** `'vertical'` is not a member of
   `AnnotationType`; assert `fromRecord` rejects it rather than coercing.
6. **Cross-org isolation**, if and only if annotations become visible to
   anyone but their author — a second user in a second org cannot read or
   update row 1, by the same method as PR #251.

**Non-vacuity**: every gate above gets a deliberate failure injected and the
failure shown, per the standing rule. The round-trip test is the one that
matters: it must be demonstrated failing against today's schema (no `style`
column, integer `stroke_width`) before migration A is applied, which is also
the cleanest proof that migration A is necessary rather than merely tidy.

## 10. Approvals required

1. Apply migration A (additive schema) — dev/staging, then production.
2. Apply migration B (retire 3 legacy rows) — or approve deleting them, after
   capturing a recovery point by hand.
3. Decide whether annotations become org-visible. If yes, that is an RLS
   authorization change plus a cross-org test in the same change, and it is
   the only part of this plan that touches policy.
4. Revoke `anon`'s SELECT privilege (inert today, principle only).
