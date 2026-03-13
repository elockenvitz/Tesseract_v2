# Notes System Architecture Audit

> Conducted 2026-03-09 on the `rationale-and-outcomes` branch.

---

## 1. Notes Data Model

### 1.1 Core Tables (4 entity-bound tables)

All four tables share an identical column set (with minor exceptions noted):

| Column | Type | Default | Notes |
|--------|------|---------|-------|
| `id` | uuid | `gen_random_uuid()` | PK |
| `{entity}_id` | uuid | — | FK to parent entity |
| `title` | text | `'Untitled'` | NOT NULL |
| `content` | text | `''` | NOT NULL, stores HTML |
| `content_preview` | text | null | Stripped plain-text (~300 chars) |
| `note_type` | `note_type` enum | `'general'` | See enum values below |
| `is_shared` | boolean | `false` | Team visibility |
| `is_deleted` | boolean | `false` | Soft delete |
| `created_by` | uuid | `auth.uid()` | FK to users |
| `updated_by` | uuid | null | FK to users |
| `created_at` | timestamptz | `now()` | — |
| `updated_at` | timestamptz | `now()` | — |
| `metadata` | jsonb | null | **Only on `asset_notes`** |

**asset_notes only** — extended file/link columns:
- `source_type` (text: `'platform'` | `'uploaded'` | `'external_link'`)
- `file_path`, `file_name`, `file_size` (bigint), `file_type`
- `external_url`, `external_provider`

**Tables:**
| Table | FK Column | Parent |
|-------|-----------|--------|
| `asset_notes` (37 rows) | `asset_id` | `assets` |
| `portfolio_notes` (0 rows) | `portfolio_id` | `portfolios` |
| `theme_notes` (9 rows) | `theme_id` | `themes` |
| `custom_notebook_notes` (0 rows) | `custom_notebook_id` | `custom_notebooks` |

### 1.2 Supporting Tables

| Table | Purpose | Rows |
|-------|---------|------|
| `note_versions` (72 rows) | Polymorphic version history. Key: `(note_id, note_type, version_number)`. Supports `is_pinned` checkpoints with labels. |
| `note_collaborations` (0 rows) | Polymorphic sharing. Key: `(note_id, note_type, user_id)`. Permission: `read` | `write` | `admin`. |
| `custom_notebooks` (0 rows) | Parent containers for custom_notebook_notes. |
| `tdf_notes` (8 rows) | Separate TDF-specific notes. Uses plain `text` for `note_type`, not the enum. |

### 1.3 Database Enum: `note_type`

The DB enum currently has **11 values**:

```
meeting, call, research, idea, analysis, general,
thesis_update, earnings, risk_review, trade_rationale, market_commentary
```

**Actual data distribution** (22 non-deleted notes across all tables):
- `research`: 18
- `idea`: 2
- `general`: 2

### 1.4 Indexes

Every note table has the same index set:
- **PK**: `btree (id)`
- **FK**: `btree ({entity}_id)`
- **GIN FTS**: `gin (to_tsvector('english', content))` — exists but **unused by app code**
- **btree**: `created_by`, `is_deleted`, `title`, `updated_at`

### 1.5 Metadata Support

- `asset_notes` has a `metadata` JSONB column (nullable, no current usage found)
- Other note tables do **not** have a metadata column
- Content itself carries structured data via TipTap node attributes (data-type, data-id, etc.)

---

## 2. Note Types

### 2.1 Where Defined

| Location | Format | Values |
|----------|--------|--------|
| **Database** | PostgreSQL ENUM `note_type` | 11 values (see 1.3) |
| **Frontend** | `src/lib/note-types.ts` `NoteTypeId` union | 8 values: `thesis`, `analysis`, `earnings`, `idea`, `decision`, `risk`, `meeting`, `call` |
| **TDF** | `src/types/tdf.ts` `TDFNoteType` | 4 values: `positioning`, `rationale`, `meeting`, `general` (plain text, not enum) |

### 2.2 CRITICAL: Frontend/Database Mismatch

The frontend taxonomy (just refactored) defines types that **do not exist in the DB enum**:
- `thesis` — not in DB enum (was `thesis_update`)
- `decision` — not in DB enum (was `research`)
- `risk` — not in DB enum (was `risk_review`)

**Impact**: Any INSERT with `note_type: 'thesis'`, `'decision'`, or `'risk'` will fail at the DB level. This needs a migration to add new enum values.

### 2.3 Frontend Legacy Mapping

`note-types.ts` resolves old DB values gracefully for display:
```
general           → analysis
research          → decision
thesis_update     → thesis
risk_review       → risk
trade_rationale   → idea
market_commentary → analysis
```

### 2.4 Usage in UI

- **UniversalNoteEditor**: Grouped dropdown (Core Research / Decision Lifecycle / Interaction Logs) with dot indicators and keyboard navigation
- **NotesListPage**: Grouped filter dropdown with multi-select
- **PortfolioLogTab**: Maps note types to event types for timeline rendering
- **OverviewTab**: Maps note types to display labels
- **NotebookTab**: Maps note types to badge colors

---

## 3. Editor System

### 3.1 Library

**TipTap v3.14.0** (built on ProseMirror)
- Content stored as **HTML** (not Markdown, not JSON)
- Full content lazy-loaded separately from list metadata
- `content_preview` (plain text, ~300 chars) stored alongside for list display

### 3.2 Extensions (21 total)

**Inline Entity References (trigger-based autocomplete):**
| Extension | Trigger | HTML Output | Callback |
|-----------|---------|-------------|----------|
| MentionExtension | `@` | `<span data-type="mention" data-id="..." data-label="...">` | `onMentionSelect` |
| AssetExtension | `$` | `<span data-type="asset" data-id="..." data-symbol="...">` | `onAssetSelect` |
| HashtagExtension | `#` | `<span data-type="hashtag" data-id="..." data-tag-type="...">` | `onHashtagSelect` |
| NoteLinkExtension | `[[` | `<span data-type="noteLink" data-note-id="..." data-entity-type="...">` | `onNoteLinkNavigate` |

**Rich Embeds:**
- `DataValueExtension` — live financial data (price, volume, market cap, etc.)
- `InlineTaskExtension` — embedded tasks with due dates, priority, assignments
- `InlineEventExtension` — embedded calendar events
- `FileAttachmentExtension` — file uploads to Supabase Storage with previews
- `CaptureExtension` — entity snapshots, screenshots, URL embeds
- `ChartExtension` — embedded financial charts via lightweight-charts

**Formatting:** FontSize, FontFamily, Indent, ResizableImage, VisibilityBlock, TableOfContents, DragHandle, Highlight, Color, Table, Link, Lists, TaskList, CodeBlock

**Commands:** DotCommandExtension (`.` trigger), AIPromptExtension (`.AI`), CaptureSuggestionExtension

### 3.3 How References Work

References are **embedded in HTML content** as data attributes, not stored in relational tables:
- `$AAPL` → `<span data-type="asset" data-id="uuid" data-symbol="AAPL">`
- `@John` → `<span data-type="mention" data-id="uuid" data-label="John">`
- `[[Analysis Note]]` → `<span data-type="noteLink" data-note-id="uuid" data-entity-type="asset">`

There is **no relational extraction** — references exist only within the HTML blob. If the content is deleted, the reference is lost. There is no reverse lookup ("which notes mention $AAPL?") without parsing HTML.

### 3.4 Structured Content

TipTap stores content as a ProseMirror document (JSON internally) but persists as HTML via `editor.getHTML()`. No block-level structured content model is exposed to the rest of the app — it's treated as an opaque HTML string.

---

## 4. Object Relationships

### 4.1 Current Direct Relationships

| Object | Relationship to Notes | How |
|--------|----------------------|-----|
| **Assets** | 1:many via `asset_notes.asset_id` | FK |
| **Portfolios** | 1:many via `portfolio_notes.portfolio_id` | FK |
| **Themes** | 1:many via `theme_notes.theme_id` | FK |
| **Custom Notebooks** | 1:many via `custom_notebook_notes.custom_notebook_id` | FK |
| **Users** | Created by / updated by | `created_by`, `updated_by` FKs |
| **TDFs** | 1:many via `tdf_notes.tdf_id` | FK (separate system) |

### 4.2 Indirect / Content-Level References

| Object | Referenced In Notes? | How |
|--------|---------------------|-----|
| **Assets** | Yes | `$TICKER` inline tags (`data-type="asset"`) |
| **Users** | Yes | `@mention` inline tags (`data-type="mention"`) |
| **Other Notes** | Yes | `[[Note Title]]` inline links (`data-type="noteLink"`) |
| **Themes/Portfolios** | Yes | `#hashtag` inline tags (`data-type="hashtag"`) |

### 4.3 Objects With NO Note Relationship

| Object | Table | Current Link to Notes |
|--------|-------|----------------------|
| **Trade Ideas** | `trade_queue_items` | None. Has `rationale` text field but no FK to notes. |
| **Decisions** | No dedicated table | Represented by `note_type = 'decision'` on notes themselves. |
| **Trades / Lab Variants** | `lab_variants`, `simulation_trades` | None. No note FK. |
| **Trade Sheets** | `trade_sheets` | None. |
| **Workflows / Processes** | `workflows` | None. Checklists have `checklist_comment_references` that can reference notes. |
| **Projects** | `projects` | None. Has `project_comments` but no note link. |
| **Meetings** | `calendar_events` | None. Notes can embed events via InlineEventExtension, but no FK. |

### 4.4 Existing Linking Infrastructure

| Table | Purpose | Status |
|-------|---------|--------|
| `user_asset_references` | Per-user curated key references linking notes/models to assets | 0 rows, exists |
| `checklist_comment_references` | Can reference notes from workflow checklists | 0 rows, exists |
| `note_collaborations` | Polymorphic share tracking | 0 rows, exists |
| `asset_notes.metadata` | JSONB column for arbitrary metadata | Exists on asset_notes only, unused |

---

## 5. Portfolio Log Integration

### 5.1 Data Sources

`PortfolioLogTab.tsx` aggregates from **4 sources** via parallel queries:

1. **`trade_queue_items`** → Ideas (filtered by portfolio_id, not deleted)
2. **`lab_variants`** → Sized trades (with sizing_input, not deleted)
3. **`trade_sheets`** → Committed trade sheets
4. **`portfolio_notes`** → Research notes (not deleted)

### 5.2 Event Type Mapping

Notes are mapped to event types via `NOTE_TYPE_MAP`:
```
thesis     → thesis_update
analysis   → observation
earnings   → earnings_note
idea       → trade_rationale
decision   → research_note
risk       → observation
meeting    → research_note
call       → research_note
```

### 5.3 Timeline Display

- Events are grouped by time buckets (Today / This Week / This Month / Older)
- Filter pills: All | Research | Trade Rationale | Thesis | Earnings | Interaction
- Each event shows: icon, type label, title/description, author, timestamp
- **Portfolio Log is read-only** — it does not create notes, only displays them

---

## 6. Linking Capability Assessment

### 6.1 What Exists

| Capability | Implementation | Limitations |
|------------|---------------|-------------|
| **Asset tagging** | `$TICKER` in editor → `data-type="asset"` in HTML | Content-only, no relational extraction, no reverse lookup |
| **User mentions** | `@Name` in editor → `data-type="mention"` in HTML | Content-only |
| **Note-to-note links** | `[[Title]]` in editor → `data-type="noteLink"` in HTML | Content-only, title-based (fragile if renamed) |
| **Hashtag references** | `#tag` in editor → `data-type="hashtag"` in HTML | Content-only |
| **Key references** | `user_asset_references` table | Exists but 0 rows, only for asset→note direction |
| **Checklist refs** | `checklist_comment_references` table | Exists but 0 rows, workflow→note direction |

### 6.2 What's Missing

- **No relational link table** for note→object associations (the fundamental gap)
- **No reverse lookup**: "Which notes reference $AAPL?" requires full HTML parsing across all tables
- **No link to trade ideas, trades, decisions, workflows, meetings, or projects**
- **No link extraction on save**: When a user types `$AAPL` in a note, the asset reference is embedded in HTML but never extracted to a relational table
- **Note-to-note links use titles**, not stable IDs in the rendered text (though `data-note-id` attribute exists)

---

## 7. Search + Indexing

### 7.1 Database Indexes

**GIN full-text search indexes exist** on all 4 note tables:
```sql
CREATE INDEX idx_asset_notes_content ON asset_notes USING gin (to_tsvector('english', content));
CREATE INDEX idx_portfolio_notes_content ON portfolio_notes USING gin (to_tsvector('english', content));
CREATE INDEX idx_theme_notes_content ON theme_notes USING gin (to_tsvector('english', content));
CREATE INDEX idx_custom_notebook_notes_content ON custom_notebook_notes USING gin (to_tsvector('english', content));
```

### 7.2 Application Search

Despite the DB indexes, **the app does not use them**:
- `NotesListPage`: Fetches all notes, filters client-side via `string.includes()`
- `UniversalNoteEditor`: Filters by `content_preview.includes()` within a single entity
- `GlobalSearch` RPC: Does **not** include notes as a searchable type
- Note linking (`[[`): Uses `ilike` on `title` column, limited to 5 results

### 7.3 Impact of Object Linking on Search

Adding a relational link table would **not break** existing search — it would enhance it by enabling:
- "Find all notes about $AAPL" via join instead of HTML parsing
- Including notes in GlobalSearch results
- Reverse lookups: "What notes link to this trade idea?"

---

## 8. RLS / Permissions

### 8.1 Policy Summary

| Table | SELECT | INSERT | UPDATE | DELETE |
|-------|--------|--------|--------|--------|
| `asset_notes` | Owner OR `is_shared=true` OR collaboration (read/write/admin) | `created_by = auth.uid()` | Owner OR collaboration (write/admin) | Owner only |
| `portfolio_notes` | Owner only | `created_by = auth.uid()` | Owner only | Owner only |
| `theme_notes` | Owner OR collaboration (read/write/admin) | `created_by = auth.uid()` | Owner OR collaboration (write/admin) | Owner only |
| `custom_notebook_notes` | (no explicit policy found) | (no explicit policy found) | (no explicit policy found) | (no explicit policy found) |
| `note_versions` | Polymorphic CASE: checks parent note ownership or is_shared | Creator owns parent note | — | — |
| `note_collaborations` | User is participant OR `has_note_permission(admin)` | `has_note_permission(admin)` | Same | Same |

### 8.2 Key Functions

- `has_note_permission(note_id, note_type, user_id, permission)` — used by `note_collaborations` policies
- `notify_note_sharing()` — trigger function on `note_collaborations` INSERT

### 8.3 Permission Gap: Portfolio Notes

Portfolio notes use **owner-only** SELECT policy (`created_by = auth.uid()`), meaning shared portfolio notes are **invisible to other team members** even if `is_shared = true`. This differs from `asset_notes` and `theme_notes` which respect `is_shared` and collaborations.

### 8.4 Impact of Object Linking on Permissions

A new linking table would need its own RLS. Key concern: if a note links to a trade idea, can someone who can see the trade idea also see the note? **Recommendation**: Link visibility should follow the **note's** existing permissions, not the linked object's. The link table itself should be readable by anyone who can read either the note or the linked object.

---

## A. Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────┐
│                        NOTES SYSTEM                                 │
│                                                                     │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐              │
│  │ asset_notes   │  │portfolio_notes│  │ theme_notes   │  + custom   │
│  │ (37 rows)     │  │ (0 rows)     │  │ (9 rows)     │  notebook   │
│  │               │  │              │  │              │  notes      │
│  │ FK: asset_id  │  │FK:portfolio_id│ │FK: theme_id  │              │
│  │ + metadata    │  │              │  │              │              │
│  │ + source_type │  │              │  │              │              │
│  │ + file fields │  │              │  │              │              │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘              │
│         │                 │                 │                       │
│         │    ┌────────────┴─────────────────┘                       │
│         │    │  Polymorphic (note_id + note_type)                   │
│         ▼    ▼                                                      │
│  ┌──────────────────┐   ┌──────────────────┐                       │
│  │  note_versions    │   │note_collaborations│                      │
│  │  (72 rows)        │   │  (0 rows)        │                      │
│  │  version_number   │   │  permission:      │                      │
│  │  is_pinned, label │   │  read|write|admin │                      │
│  └──────────────────┘   └──────────────────┘                       │
│                                                                     │
│  ┌──────────────────────────────────────────┐                       │
│  │         CONTENT LAYER (TipTap HTML)       │                      │
│  │                                           │                      │
│  │  Inline references (in HTML, no DB link): │                      │
│  │  • $AAPL   → data-type="asset"           │                      │
│  │  • @John   → data-type="mention"         │                      │
│  │  • [[Note]]→ data-type="noteLink"        │                      │
│  │  • #theme  → data-type="hashtag"         │                      │
│  │                                           │                      │
│  │  Embeds (in HTML, saved to other tables): │                      │
│  │  • Tasks   → calendar_events             │                      │
│  │  • Events  → calendar_events             │                      │
│  │  • Files   → Supabase Storage            │                      │
│  │  • Charts  → snapshot data in attributes │                      │
│  └──────────────────────────────────────────┘                       │
│                                                                     │
│  ┌──────────────────────────────────────────┐                       │
│  │         TYPE SYSTEM                       │                      │
│  │                                           │                      │
│  │  DB Enum (note_type):                     │                      │
│  │  meeting, call, research, idea, analysis, │                      │
│  │  general, thesis_update, earnings,        │                      │
│  │  risk_review, trade_rationale,            │                      │
│  │  market_commentary                        │                      │
│  │                                           │                      │
│  │  Frontend (note-types.ts):                │                      │
│  │  thesis, analysis, earnings,              │                      │
│  │  idea, decision, risk, meeting, call      │                      │
│  │                                           │                      │
│  │  ⚠ MISMATCH: thesis, decision, risk      │                      │
│  │    not in DB enum yet                     │                      │
│  └──────────────────────────────────────────┘                       │
│                                                                     │
│  ┌──────────────────────────────────────────┐                       │
│  │         CONSUMERS                         │                      │
│  │                                           │                      │
│  │  • UniversalNoteEditor (create/edit)      │                      │
│  │  • UniversalNoteViewer (read + comments)  │                      │
│  │  • NotesListPage (cross-entity list)      │                      │
│  │  • PortfolioLogTab (timeline aggregation) │                      │
│  │  • OverviewTab (recent notes preview)     │                      │
│  │  • NotebookTab (custom notebook UI)       │                      │
│  │  • ContentAggregation (ideas feed)        │                      │
│  │  • KeyReferencesSection (asset page)      │                      │
│  └──────────────────────────────────────────┘                       │
└─────────────────────────────────────────────────────────────────────┘

OBJECTS WITH NO NOTE RELATIONSHIP:
  ┌────────────────┐  ┌────────────────┐  ┌────────────────┐
  │ trade_queue_   │  │ lab_variants   │  │ trade_sheets   │
  │ items (ideas)  │  │ (trades)       │  │ (committed)    │
  │ rationale:text │  │ no note FK     │  │ no note FK     │
  └────────────────┘  └────────────────┘  └────────────────┘
  ┌────────────────┐  ┌────────────────┐  ┌────────────────┐
  │ workflows      │  │ projects       │  │ calendar_events│
  │ (processes)    │  │                │  │ (meetings)     │
  │ no note FK     │  │ no note FK     │  │ no note FK     │
  └────────────────┘  └────────────────┘  └────────────────┘
```

---

## B. Proposal: Universal Object Linking System

### B.1 Design Principles

1. **Additive, not destructive** — existing entity FKs (`asset_id`, `portfolio_id`, etc.) stay. Links are supplementary.
2. **Bidirectional by convention** — a single row represents a link; either side can discover it.
3. **Polymorphic but bounded** — use a controlled `entity_type` enum, not free-text.
4. **Permission-transparent** — link visibility follows the note's existing RLS. The link table is read-accessible to anyone who can read either endpoint.
5. **Extract on save** — when a note is saved, parse HTML for `data-type="asset"`, `data-type="mention"`, etc. and upsert to the link table. This gives us relational reverse lookups.

### B.2 Proposed Table: `object_links`

```sql
CREATE TYPE linkable_entity_type AS ENUM (
    'asset_note', 'portfolio_note', 'theme_note', 'custom_note',
    'asset', 'portfolio', 'theme',
    'trade_idea', 'trade', 'trade_sheet',
    'workflow', 'project', 'calendar_event',
    'user'
);

CREATE TYPE link_type AS ENUM (
    'references',        -- generic: A mentions/references B
    'supports',          -- A is rationale/evidence for B
    'results_in',        -- A led to decision B
    'related_to'         -- loose association
);

CREATE TABLE object_links (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Source endpoint
    source_type linkable_entity_type NOT NULL,
    source_id   UUID NOT NULL,

    -- Target endpoint
    target_type linkable_entity_type NOT NULL,
    target_id   UUID NOT NULL,

    -- Link metadata
    link_type   link_type NOT NULL DEFAULT 'references',
    context     TEXT,               -- optional description ("mentioned in paragraph 2")
    is_auto     BOOLEAN NOT NULL DEFAULT false,  -- true = extracted from content, false = user-created
    created_by  UUID REFERENCES users(id),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),

    -- Prevent duplicate links
    UNIQUE (source_type, source_id, target_type, target_id, link_type)
);

-- Indexes for bidirectional lookup
CREATE INDEX idx_object_links_source ON object_links(source_type, source_id);
CREATE INDEX idx_object_links_target ON object_links(target_type, target_id);
CREATE INDEX idx_object_links_created_by ON object_links(created_by);
```

### B.3 RLS Policy

```sql
ALTER TABLE object_links ENABLE ROW LEVEL SECURITY;

-- Anyone authenticated can read links (visibility governed by endpoints)
CREATE POLICY object_links_select ON object_links
    FOR SELECT TO authenticated USING (true);

-- Users can create links
CREATE POLICY object_links_insert ON object_links
    FOR INSERT TO authenticated WITH CHECK (created_by = auth.uid());

-- Users can delete their own links, or auto-extracted links for notes they own
CREATE POLICY object_links_delete ON object_links
    FOR DELETE TO authenticated USING (
        created_by = auth.uid()
        OR (is_auto = true AND created_by = auth.uid())
    );

GRANT SELECT, INSERT, DELETE ON object_links TO authenticated;
```

### B.4 Auto-Extraction (on note save)

When `UniversalNoteEditor` saves content, a post-save hook:

1. Parses HTML for `data-type="asset"`, `data-type="mention"`, `data-type="noteLink"`, `data-type="hashtag"`
2. Extracts `(data-type, data-id)` pairs
3. Upserts to `object_links` with `is_auto = true`
4. Deletes stale auto-links (references removed from content)

This runs client-side after successful save, not as a DB trigger (avoids parsing HTML in PL/pgSQL).

### B.5 Manual Linking UI

A future "Link to..." action in the note editor toolbar or context menu:
- Opens a universal object picker (assets, trade ideas, trades, workflows, etc.)
- Creates a link with `is_auto = false`
- Shown in a "Linked Objects" sidebar panel on the note

### B.6 Example Queries

```sql
-- All notes that reference asset $AAPL (reverse lookup)
SELECT ol.source_type, ol.source_id
FROM object_links ol
WHERE ol.target_type = 'asset' AND ol.target_id = '<aapl-uuid>'
  AND ol.source_type IN ('asset_note', 'portfolio_note', 'theme_note');

-- All objects linked from a specific note
SELECT ol.target_type, ol.target_id, ol.link_type
FROM object_links ol
WHERE ol.source_type = 'asset_note' AND ol.source_id = '<note-uuid>';

-- Decision trail: note → trade idea → trade
SELECT ol1.source_id AS note_id,
       ol1.target_id AS idea_id,
       ol2.target_id AS trade_id
FROM object_links ol1
JOIN object_links ol2
  ON ol2.source_type = 'trade_idea' AND ol2.source_id = ol1.target_id
     AND ol2.target_type = 'trade'
WHERE ol1.source_type = 'asset_note'
  AND ol1.target_type = 'trade_idea';
```

---

## C. Schema Changes Required

### C.1 Fix Note Type Enum (URGENT — blocks current frontend)

The frontend now uses `thesis`, `decision`, `risk` which don't exist in the DB enum. Needs migration:

```sql
-- Add new enum values
ALTER TYPE note_type ADD VALUE IF NOT EXISTS 'thesis';
ALTER TYPE note_type ADD VALUE IF NOT EXISTS 'decision';
ALTER TYPE note_type ADD VALUE IF NOT EXISTS 'risk';

-- Migrate existing data to new canonical values
UPDATE asset_notes SET note_type = 'decision' WHERE note_type = 'research';
UPDATE asset_notes SET note_type = 'thesis' WHERE note_type = 'thesis_update';
UPDATE asset_notes SET note_type = 'risk' WHERE note_type = 'risk_review';
UPDATE asset_notes SET note_type = 'idea' WHERE note_type = 'trade_rationale';
UPDATE asset_notes SET note_type = 'analysis' WHERE note_type = 'general';
UPDATE asset_notes SET note_type = 'analysis' WHERE note_type = 'market_commentary';

-- Repeat for portfolio_notes, theme_notes, custom_notebook_notes

-- Update default
ALTER TABLE asset_notes ALTER COLUMN note_type SET DEFAULT 'analysis';
ALTER TABLE portfolio_notes ALTER COLUMN note_type SET DEFAULT 'analysis';
ALTER TABLE theme_notes ALTER COLUMN note_type SET DEFAULT 'analysis';
ALTER TABLE custom_notebook_notes ALTER COLUMN note_type SET DEFAULT 'analysis';
```

### C.2 Add `metadata` JSONB to All Note Tables

Currently only `asset_notes` has it. For consistency:
```sql
ALTER TABLE portfolio_notes ADD COLUMN IF NOT EXISTS metadata JSONB;
ALTER TABLE theme_notes ADD COLUMN IF NOT EXISTS metadata JSONB;
ALTER TABLE custom_notebook_notes ADD COLUMN IF NOT EXISTS metadata JSONB;
```

### C.3 Add `content_preview` Where Missing

`portfolio_notes` and `theme_notes` have `content_preview` but `custom_notebook_notes` does not:
```sql
ALTER TABLE custom_notebook_notes ADD COLUMN IF NOT EXISTS content_preview TEXT;
```

### C.4 Fix Portfolio Notes RLS

Portfolio notes SELECT policy is owner-only, inconsistent with other note tables:
```sql
DROP POLICY IF EXISTS "Users can read portfolio notes" ON portfolio_notes;
CREATE POLICY "Users can read portfolio notes" ON portfolio_notes
    FOR SELECT USING (
        created_by = auth.uid()
        OR is_shared = true
        OR user_is_portfolio_member(portfolio_id)
    );
```

### C.5 Create `object_links` Table

As described in section B.2.

---

## D. Safe Migration Plan

### Phase 1: Fix Enum + Data Migration (do first, unblocks frontend)

1. **Migration**: `add_new_note_type_enum_values`
   - Add `thesis`, `decision`, `risk` to `note_type` enum
   - Update existing rows to canonical values
   - Change defaults from `'general'` to `'analysis'`
   - **Risk**: Low. PostgreSQL `ADD VALUE` is non-destructive. Data migration is small (22 rows).
   - **Rollback**: Old enum values still exist, frontend legacy mapping handles both directions.

### Phase 2: Schema Normalization

2. **Migration**: `normalize_note_tables`
   - Add `metadata` JSONB to portfolio_notes, theme_notes, custom_notebook_notes
   - Add `content_preview` to custom_notebook_notes
   - Fix portfolio_notes SELECT RLS policy
   - **Risk**: Low. Additive columns, policy replacement.

### Phase 3: Object Links Table

3. **Migration**: `create_object_links`
   - Create enums, table, indexes, RLS policies
   - **Risk**: None. New table, no impact on existing data.

### Phase 4: Auto-Extraction (frontend)

4. **Code change**: Add `extractLinksFromContent()` utility
   - Parse TipTap HTML for entity references
   - Call on note save success
   - Upsert/delete auto-links
   - **Risk**: Low. Additive behavior, does not modify note content.

### Phase 5: Backfill

5. **One-time script**: Parse all existing note content to extract links
   - Run client-side or as edge function
   - Creates initial `object_links` rows with `is_auto = true`
   - **Risk**: Low. Read-only against notes, write-only to new table.

### Phase 6: Manual Linking UI

6. **Code change**: Add "Link to..." UI in editor
   - Universal object picker
   - Linked objects sidebar
   - **Risk**: Low. New UI, no schema changes.

---

## 10. Search Impact Summary (Phase 8)

> Added 2026-03-09 after completing Phases 0–7.

### Current Search Architecture

| Surface | File | Method | Scope |
|---------|------|--------|-------|
| NotesListPage | `src/pages/NotesListPage.tsx` | Client-side `.toLowerCase().includes()` on title + content + source_name | All notes user can see |
| UniversalNoteEditor quick search | `src/components/notes/UniversalNoteEditor.tsx` | `.ilike('title', '%query%')` per table | Title only, 5/type |
| Dashboard recent notes | `src/components/dashboard/ContentSection.tsx` | `order('updated_at')` — no search | Last 5 per type |

**Key observation**: No existing search parses HTML content for entity references. All search is substring matching on raw text. The `object_links` table is completely orthogonal to existing search — zero risk of breakage.

### How `object_links` Enables Future Search

**1. Notes about an asset** (e.g., "show me all notes mentioning $AAPL"):
```sql
-- Today: impossible without client-side HTML parsing
-- With object_links:
SELECT n.* FROM object_links ol
  JOIN asset_notes n ON n.id = ol.source_id
  WHERE ol.target_type = 'asset' AND ol.target_id = :asset_uuid
    AND ol.source_type = 'asset_note'
    AND n.is_deleted = false;
```
Already exposed via `useBacklinks('asset', assetId)` hook.

**2. Notes linked to decisions/ideas** (e.g., "what analysis supports this decision?"):
```sql
-- note-to-note links (forward):
SELECT * FROM object_links
  WHERE source_type = 'asset_note' AND source_id = :note_uuid
    AND target_type IN ('asset_note','portfolio_note','theme_note','custom_note');
```
Already exposed via `useForwardLinks(sourceType, noteId)` hook.

**3. Reverse navigation** (e.g., "from this asset page, see all referencing notes"):
The `useBacklinkCount` hook provides badge counts. The full `useBacklinks` hook returns enriched `BacklinkNote[]` with author, title, type, and timestamp — ready for a sidebar or panel.

**4. Cross-entity graph queries** (future):
```sql
-- "What assets are discussed together?" (co-occurrence)
SELECT ol2.target_id AS co_asset, COUNT(*) as mentions
  FROM object_links ol1
  JOIN object_links ol2 ON ol1.source_id = ol2.source_id
    AND ol1.source_type = ol2.source_type
  WHERE ol1.target_type = 'asset' AND ol1.target_id = :asset_uuid
    AND ol2.target_type = 'asset' AND ol2.target_id != :asset_uuid
  GROUP BY ol2.target_id ORDER BY mentions DESC;
```

### GIN Full-Text Search (Future Enhancement)

The audit found no GIN indexes on note tables despite the DB supporting them. When full-text search is added:
- `object_links` complements FTS — FTS finds notes by keyword, links find notes by relationship
- Combined query: "notes mentioning 'earnings' that also reference $AAPL" = FTS + link join
- `content_preview` column (added in Phase 2) enables snippet display without loading full HTML

### What Was NOT Changed

No search queries were modified in this phase. The existing search patterns are functional for current scale. The `object_links` query layer (hooks) provides the new relational query path that can be wired into UI surfaces incrementally.
