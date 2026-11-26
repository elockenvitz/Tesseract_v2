-- ============================================================================
-- PROPOSED, NOT APPLIED.  Migration A of 2: schema only, no rows touched.
--
-- What it changes
--   Adds three columns to public.chart_annotations and widens one.
--   No policy, no grant, no RLS change, no data change.
--
-- Can it fail on existing data?
--   No. All three added columns have defaults and are added NOT NULL with a
--   default, which Postgres 11+ applies without rewriting the table. The one
--   type change is integer -> numeric(5,2), which is a widening: every
--   existing value is representable, so it cannot fail or lose precision.
--
-- Is it reversible?
--   Yes, structurally: the three columns can be dropped and stroke_width can
--   be narrowed back to integer PROVIDED no fractional value has been written
--   yet. Once a 1.5 has been stored, narrowing back truncates it, so the
--   reverse is only clean before the application starts writing.
--
-- What has to be true before it runs
--   * Applied to a development or staging database first, and the round-trip
--     test in the accompanying plan shown failing BEFORE and passing AFTER.
--   * A recovery point captured by hand. This project has no automated
--     backup (backups: [], pitr_enabled: false), so there is nothing to roll
--     back to otherwise. That matters less here than for migration B, since
--     this one changes no rows -- but the habit is the point.
--
-- Why these specific columns: see
--   docs/chart-annotation-persistence-plan.md, sections 5 and 6.
-- ============================================================================

begin;

-- ----------------------------------------------------------------------------
-- 1. style jsonb — the typed fields the flattened columns cannot hold.
--
-- AnnotationStyle carries fillColor, fillOpacity and fontSize; FibonacciAnnotation
-- carries levels (7 numbers); TextAnnotation carries anchor; LineAnnotation
-- carries label. None of these has a column, and inventing one column each
-- would mean a migration per annotation variant forever.
--
-- The GEOMETRY deliberately stays in real columns (x1/y1/x2/y2) so it remains
-- queryable and indexable. Only the presentation travels as JSON.
-- ----------------------------------------------------------------------------
alter table public.chart_annotations
  add column if not exists style jsonb not null default '{}'::jsonb;

-- ----------------------------------------------------------------------------
-- 2. is_locked — already read by the shipped hit-test.
--
-- src/lib/charting/annotation-hit-test.ts skips a locked mark, and
-- BaseAnnotation.locked exists in the union. Without this column every
-- persisted mark comes back unlocked, silently discarding the one piece of
-- state whose whole purpose is to stop an accidental edit.
-- ----------------------------------------------------------------------------
alter table public.chart_annotations
  add column if not exists is_locked boolean not null default false;

-- ----------------------------------------------------------------------------
-- 3. anchor_domain — which coordinate system x1/y1/x2/y2 are in.
--
-- This is the column that stops the original defect recurring. The three rows
-- in production today hold CANVAS PIXELS (y1=0 and y2=280.55 on COIN, which
-- trades near $230). Nothing in the schema said so, so nothing could tell a
-- pixel from a price, and a reader of the table cannot tell either.
--
-- The default is 'pixel' on purpose: every existing row becomes
-- self-describing as legacy without an UPDATE, and any new writer has to say
-- 'time_price' explicitly. A default of 'time_price' would silently relabel
-- the three junk rows as valid prices, which is the worse failure.
-- ----------------------------------------------------------------------------
alter table public.chart_annotations
  add column if not exists anchor_domain text not null default 'pixel';

-- Added separately from the column so that re-running is harmless; a CHECK
-- cannot take IF NOT EXISTS.
do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.chart_annotations'::regclass
       and conname  = 'chart_annotations_anchor_domain_check'
  ) then
    alter table public.chart_annotations
      add constraint chart_annotations_anchor_domain_check
      check (anchor_domain in ('pixel', 'time_price'));
  end if;
end $$;

-- ----------------------------------------------------------------------------
-- 4. stroke_width: integer -> numeric(5,2).
--
-- DEFAULT_ANNOTATION_STYLE.lineWidth is 1.5. An integer column truncates the
-- DEFAULT style of every annotation -- so the flattening is lossy on the
-- common path, not only on exotic fields. This is the single clearest reason
-- migration A is necessary rather than tidy.
-- ----------------------------------------------------------------------------
alter table public.chart_annotations
  alter column stroke_width type numeric(5,2),
  alter column stroke_width set default 1.5;

-- ----------------------------------------------------------------------------
-- 5. Say what the columns mean, in the database.
--
-- The pixel/price ambiguity is exactly the kind of thing that is obvious to
-- whoever wrote the writer and invisible to everyone after.
-- ----------------------------------------------------------------------------
comment on column public.chart_annotations.x1 is
  'anchor_domain=time_price: unix SECONDS (matches OHLC.time). anchor_domain=pixel: legacy canvas x, not renderable.';
comment on column public.chart_annotations.y1 is
  'anchor_domain=time_price: a PRICE in the instrument''s quoting currency, unconverted (GBp is pence, GBP is pounds). anchor_domain=pixel: legacy canvas y.';
comment on column public.chart_annotations.x2 is
  'Second anchor. Same domain as x1. Null for one-point marks (horizontal-line, vertical-line, text).';
comment on column public.chart_annotations.y2 is
  'Second anchor. Same domain as y1. Null for one-point marks.';
comment on column public.chart_annotations.anchor_domain is
  'Coordinate system of x1/y1/x2/y2. Legacy rows are pixel and must never be rendered as prices.';
comment on column public.chart_annotations.style is
  'AnnotationStyle plus the per-variant fields with no column: fibonacci levels, text anchor, line label, fillColor, fillOpacity, fontSize.';

commit;

-- ============================================================================
-- Verification after applying (read-only, run as a separate step):
--
--   select column_name, data_type, column_default
--     from information_schema.columns
--    where table_schema = 'public' and table_name = 'chart_annotations'
--      and column_name in ('style','is_locked','anchor_domain','stroke_width')
--    order by column_name;
--
-- Expect exactly four rows: anchor_domain text 'pixel', is_locked boolean
-- false, style jsonb '{}', stroke_width numeric 1.5.
--
-- And confirm the legacy rows self-describe:
--
--   select anchor_domain, count(*) from public.chart_annotations group by 1;
--
-- Expect pixel = 3, time_price = 0.
-- ============================================================================
