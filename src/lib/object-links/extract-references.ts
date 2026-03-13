/**
 * Extracts structured object references from TipTap HTML content.
 *
 * When a note is saved, this utility parses the HTML for inline entity
 * references (assets, mentions, note links, hashtags) and translates
 * them into relational link records for the object_links table.
 *
 * Design principles:
 * - Never mutates note content
 * - Idempotent: produces the same output for the same input
 * - Deterministic extraction → deterministic upsert/delete
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type LinkableEntityType =
  | 'asset_note' | 'portfolio_note' | 'theme_note' | 'custom_note'
  | 'asset' | 'portfolio' | 'theme'
  | 'trade_idea' | 'trade' | 'trade_sheet'
  | 'workflow' | 'project' | 'calendar_event'
  | 'user'
  | 'quick_thought' | 'trade_proposal'

export type LinkRelationshipType = 'references' | 'supports' | 'results_in' | 'related_to' | 'opposes'

export interface ExtractedReference {
  targetType: LinkableEntityType
  targetId: string
}

/** Map from TipTap data-type to linkable entity type */
const DATA_TYPE_TO_ENTITY: Record<string, LinkableEntityType> = {
  asset: 'asset',
  mention: 'user',
  // noteLink requires inspecting data-entity-type to determine note table
  // hashtag requires inspecting data-tag-type to determine entity
}

/** Map from hashtag data-tag-type to entity type */
const HASHTAG_TAG_TYPE_TO_ENTITY: Record<string, LinkableEntityType> = {
  theme: 'theme',
  portfolio: 'portfolio',
}

/** Map from note entity type to note link entity type */
const NOTE_ENTITY_TYPE_TO_LINK_TYPE: Record<string, LinkableEntityType> = {
  asset: 'asset_note',
  portfolio: 'portfolio_note',
  theme: 'theme_note',
  custom: 'custom_note',
}

// ---------------------------------------------------------------------------
// Extraction
// ---------------------------------------------------------------------------

/**
 * Parse TipTap HTML and extract all object references.
 *
 * Detects:
 * - $TICKER  → asset references (data-type="asset", data-id)
 * - @mention → user references (data-type="mention", data-id)
 * - [[Note]] → note-to-note links (data-type="noteLink", data-note-id, data-entity-type)
 * - #tag     → theme/portfolio references (data-type="hashtag", data-id, data-tag-type)
 *
 * Does NOT detect:
 * - Inline tasks/events (these save to calendar_events independently)
 * - File attachments (stored in Supabase Storage, not linkable objects)
 * - Charts (snapshot data, not persistent objects)
 * - Data values (live data, not persistent objects)
 */
export function extractReferencesFromHTML(html: string): ExtractedReference[] {
  if (!html) return []

  const refs: ExtractedReference[] = []
  const seen = new Set<string>()

  // Use regex to parse data attributes from span elements.
  // This avoids needing a DOM parser (works in edge functions, tests, SSR).
  // TipTap generates consistent HTML so regex is reliable here.

  // Pattern: <span ... data-type="X" ... data-id="Y" ...>
  const spanPattern = /<span[^>]*>/gi
  let match: RegExpExecArray | null

  while ((match = spanPattern.exec(html)) !== null) {
    const tag = match[0]

    const dataType = extractAttr(tag, 'data-type')
    if (!dataType) continue

    // --- Asset references ($TICKER) ---
    if (dataType === 'asset') {
      const id = extractAttr(tag, 'data-id')
      if (id && isUUID(id)) {
        addRef(refs, seen, 'asset', id)
      }
      continue
    }

    // --- User mentions (@Name) ---
    if (dataType === 'mention') {
      const id = extractAttr(tag, 'data-id')
      if (id && isUUID(id)) {
        addRef(refs, seen, 'user', id)
      }
      continue
    }

    // --- Note links ([[Title]]) ---
    if (dataType === 'noteLink') {
      const noteId = extractAttr(tag, 'data-note-id')
      const entityType = extractAttr(tag, 'data-entity-type')
      if (noteId && isUUID(noteId) && entityType) {
        const linkType = NOTE_ENTITY_TYPE_TO_LINK_TYPE[entityType]
        if (linkType) {
          addRef(refs, seen, linkType, noteId)
        }
      }
      continue
    }

    // --- Hashtags (#tag) ---
    if (dataType === 'hashtag') {
      const id = extractAttr(tag, 'data-id')
      const tagType = extractAttr(tag, 'data-tag-type')
      if (id && isUUID(id) && tagType) {
        const entityType = HASHTAG_TAG_TYPE_TO_ENTITY[tagType]
        if (entityType) {
          addRef(refs, seen, entityType, id)
        }
      }
      continue
    }
  }

  return refs
}

// ---------------------------------------------------------------------------
// Plain-text pattern extraction
// ---------------------------------------------------------------------------

export interface PlainTextPatterns {
  tickers: string[]   // e.g. ['AAPL', 'COIN', 'MSFT']
  hashtags: string[]   // e.g. ['Semiconductor', 'LargeCapGrowth']
}

/**
 * Extract plain-text $TICKER and #Tag patterns from HTML content.
 *
 * Strips structured spans (data-type="...") first to avoid double-counting
 * references that already have proper TipTap node markup.
 * Then scans the remaining plain text for $TICKER and #Tag patterns.
 */
export function extractPlainTextPatterns(html: string): PlainTextPatterns {
  if (!html) return { tickers: [], hashtags: [] }

  // Strip all structured spans (including their text content) to avoid
  // double-counting e.g. <span data-type="asset">$AAPL</span>
  const stripped = html
    .replace(/<span[^>]*data-type="[^"]*"[^>]*>.*?<\/span>/gi, '')
    // Also strip all remaining HTML tags to get plain text
    .replace(/<[^>]+>/g, ' ')

  const tickers = new Set<string>()
  const hashtags = new Set<string>()

  // $TICKER: 1-5 uppercase letters following a $, word boundary after
  const tickerRe = /\$([A-Z]{1,5})\b/g
  let m: RegExpExecArray | null
  while ((m = tickerRe.exec(stripped)) !== null) {
    tickers.add(m[1])
  }

  // #Tag: word characters following a #, at least 2 chars long
  const hashtagRe = /(?:^|[\s(])#([A-Za-z]\w{1,})/g
  while ((m = hashtagRe.exec(stripped)) !== null) {
    hashtags.add(m[1])
  }

  return {
    tickers: Array.from(tickers),
    hashtags: Array.from(hashtags),
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function extractAttr(tag: string, attr: string): string | null {
  // Match both single and double quoted attribute values
  const pattern = new RegExp(`${attr}=["']([^"']*)["']`)
  const m = pattern.exec(tag)
  return m ? m[1] : null
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function isUUID(s: string): boolean {
  return UUID_RE.test(s)
}

function addRef(
  refs: ExtractedReference[],
  seen: Set<string>,
  targetType: LinkableEntityType,
  targetId: string,
): void {
  const key = `${targetType}:${targetId}`
  if (seen.has(key)) return
  seen.add(key)
  refs.push({ targetType, targetId })
}
