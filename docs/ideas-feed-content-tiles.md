# Ideas feed — content tiles (future direction)

Status: design captured, not yet built. The current Ideas feed strict-scopes
the four source tables by `organization_id` (June 2026 work); this doc
describes the model we're set up to evolve toward.

## Vision

The Ideas feed shows **content tiles**, not raw rows.

A tile is a derived, feed-shaped piece of content: a headline + blurb + chart
preview. Tiles come from two origins:

1. **Tesseract content-generation engine, fed by user input.** A user posts a
   trade idea, quick thought, asset note, or contribution. The engine reads
   the row and produces a tile that surfaces the salient signal for the
   audience that cares (PM of the affected portfolio, asset coverage analyst,
   theme followers, the author's followers).
2. **Tesseract content-generation engine, fed by external research.** Sell-side
   reports (or similar) are ingested via FTP / feed / upload, summarised, and
   tiled. Tiles carry the originating broker so they only render for users
   entitled to that broker's research.

The raw source rows still live in their domain tables — tiles are downstream
artifacts. The feed query reads `content_tiles`, not the source tables.

## Schema sketch

```
content_tiles
  id                  uuid primary key
  organization_id     uuid not null references organizations(id)   -- scopes the feed
  source_type         text not null  -- 'trade_idea' | 'quick_thought' | 'asset_note'
                                     -- | 'asset_contribution' | 'external_research'
  source_id           uuid           -- FK to the source row (nullable for external)
  source_user_id      uuid           -- original author (null for external)
  asset_id            uuid           -- primary ticker the tile is about
  portfolio_id        uuid           -- primary portfolio context
  theme_id            uuid           -- primary theme context
  pair_id             uuid           -- for pair trades
  headline            text not null  -- engine output, ~one sentence
  body                text           -- longer prose if needed
  chart_config        jsonb          -- symbols, timeframe, overlays
  generated_by        text not null  -- 'engine' | 'external'
  broker_id           uuid           -- nullable; required for external_research
  generated_at        timestamptz
  updated_at          timestamptz

brokers
  id, name, slug, logo_url

broker_subscriptions  -- per-user entitlement
  id, user_id, broker_id, granted_at
```

Per-user (not per-org) broker entitlement keeps the model flexible. Org-wide
broker access is just a bulk-insert of one row per user.

## Engine flow

Synchronous on insert: a Postgres trigger on each source table fires an
`http_post` (via `pg_net` or Supabase Webhooks) to an Edge Function. The
function reads the row, calls an LLM with a templated prompt to produce the
tile content, and inserts a `content_tiles` row stamped to the same
`organization_id`.

```
INSERT into trade_queue_items / quick_thoughts / asset_notes / asset_contributions
  → AFTER INSERT trigger
  → pg_net.http_post → supabase functions/tile-engine
  → LLM call (Claude)
  → INSERT into content_tiles
```

No backfill on engine deploy — only rows created from deploy day forward get
tiles. Pilot orgs start with an empty feed that fills as users post.

## Feed read query

```sql
SELECT * FROM content_tiles
WHERE organization_id = current_org_id()
  AND (
    -- relevance
    asset_id = ANY (my watchlist asset ids)
    OR portfolio_id = ANY (portfolios I manage)
    OR theme_id = ANY (themes I follow)
    OR source_user_id = ANY (authors I follow)
    OR (asset_id IS NULL AND portfolio_id IS NULL AND theme_id IS NULL) -- org-wide
  )
  AND (
    -- broker entitlement
    broker_id IS NULL
    OR EXISTS (
      SELECT 1 FROM broker_subscriptions
      WHERE user_id = auth.uid() AND broker_id = content_tiles.broker_id
    )
  )
ORDER BY generated_at DESC;
```

Single query replaces today's 4-way fan-out across source tables.

## Decisions deferred until we build

- **Tile lifecycle on source edits.** When the user edits the source row, do we
  regenerate the tile (Option A — simple) or version it (Option B — audit
  trail)? Defer; users edit infrequently. Most consumer feeds use A.
- **External research input path.** Will be an automated FTP / feed eventually.
  Not in scope for v0.
- **Tile content depth.** Today's "blurb + chart" UI carries over. Richer
  variants (metrics, LLM-generated angle, etc.) come once the lean tile is
  validated.

## What's already in place that supports this direction

- All four source tables now have a canonical `organization_id` column with a
  BEFORE INSERT trigger that stamps from `users.current_organization_id`. Tiles
  inherit the org of their source.
- Strict org-scoping is the established convention across the codebase, so when
  `content_tiles` lands it's obvious that the feed query needs
  `.eq('organization_id', currentOrgId)`.
- The Ideas feed UI already renders tiles as blurb + chart cards. Swapping the
  data source from raw rows to `content_tiles` is a one-file change.

## Two things to avoid until we build

- Don't merge the source content tables into a single polymorphic table. The
  separation is what gives the engine a clean per-domain event boundary.
- Don't add feed-shaped fields (`headline`, `summary`, `chart_config`) to source
  tables. Source captures what the user wrote; tiles capture what the engine
  produced. Keep them apart.
