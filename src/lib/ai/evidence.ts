/**
 * One supporting-evidence model per answer.
 *
 * ── The problem this solves ─────────────────────────────────────────────
 *
 * A single response could show a reader three overlapping accounts of where
 * it got its information: a research trail of every lookup, a separate
 * citations list of quoted documents, and (when the action block leaked) a
 * JSON array of evidence labels. The same AAPL decision record could appear
 * in two of them under two different headings, and the reader was left to
 * work out whether those were one record or two.
 *
 * So: records are the primary unit, deduplicated, each labelled with the
 * strongest claim the answer makes about it.
 *
 * ── Why "quoted" versus "consulted" survives ────────────────────────────
 *
 * It would be simpler to pool everything into one undifferentiated list, and
 * that would be a real loss. A citation says "this sentence rests on these
 * words"; a trail entry says "I looked here". Flattening them lets a reader
 * take a list of files the model merely opened as support for a specific
 * claim, which is a stronger thing than actually happened.
 *
 * The old code kept that distinction by rendering TWO sections, which is what
 * produced the duplication. This keeps it per RECORD instead: one list, and
 * each entry says which it is. Quoted outranks consulted, because a record
 * that was both is, in the end, quoted.
 *
 * ── Why the lookups are still here ──────────────────────────────────────
 *
 * They are not evidence, but they are provenance, and they carry the only
 * honest answer to "did you look and find nothing, or did the lookup fail?".
 * They stay as a summary rather than as the headline: the question a reader
 * has is "what is this based on", and a list of function calls is an answer
 * to a different question.
 */
import type { AiSourceRef, MessageCitation, MessageToolCall } from './presentation'
import { toolCallLabel, toolCallOutcome } from './trail-text'

/** How strongly the answer leans on a record. */
export type EvidenceRelation = 'quoted' | 'consulted'

export interface EvidenceRecord {
  /** Stable key: the record's identity, not its position in the list. */
  key: string
  ref: AiSourceRef
  relation: EvidenceRelation
  /**
   * The record's own words. Citation snippets first, then the trail's
   * excerpt as a fallback, deduplicated.
   */
  quotes: string[]
}

export interface EvidenceLookup {
  /** "Checked the decision record for AAPL". */
  label: string
  /** The reach-and-outcome sentence, already scoped. */
  outcome: string | null
  /** The outcome's colour classes, as `toolCallOutcome` supplies them. */
  tone: string | null
  failed: boolean
}

export interface ConsolidatedEvidence {
  records: EvidenceRecord[]
  lookups: EvidenceLookup[]
  /** How many lookups failed outright. Drives the warning, never a count. */
  failedCount: number
  /** True when there is nothing at all to show. */
  isEmpty: boolean
}

/** Identity of a record, for deduplication. */
function keyOf(kind: string | undefined, id: string | undefined, title: string): string {
  /*
   * Id where there is one, title otherwise -- and the kind always, because
   * two different record types can legitimately share an id space. Falling
   * back to the title rather than dropping the entry is deliberate: two notes
   * CAN share a title and would then merge, which loses less than discarding
   * a source whose id the server did not send.
   */
  return `${kind ?? 'unknown'}:${id || `title:${title.trim().toLowerCase()}`}`
}

function addQuote(into: string[], text: unknown): void {
  if (typeof text !== 'string') return
  const flat = text.replace(/\s+/g, ' ').trim()
  if (!flat) return
  if (into.some(q => q === flat)) return
  into.push(flat)
}

/**
 * Fold a message's lookups and citations into one evidence model.
 *
 * Total: every malformed input degrades to "not included" rather than
 * throwing, because this runs on stored transcripts written by older versions
 * of the app as well as on fresh responses.
 */
export function consolidateEvidence(input: {
  toolCalls?: readonly MessageToolCall[] | null
  citations?: readonly MessageCitation[] | null
}): ConsolidatedEvidence {
  const toolCalls = Array.isArray(input.toolCalls) ? input.toolCalls : []
  const citations = Array.isArray(input.citations) ? input.citations : []

  const byKey = new Map<string, EvidenceRecord>()
  /* Insertion order is the answer's own order, which is the most defensible
     tie-break available: it follows how the answer was assembled. */
  const order: string[] = []

  const upsert = (
    ref: AiSourceRef,
    relation: EvidenceRelation,
    quote?: unknown,
  ): void => {
    if (!ref || typeof ref.title !== 'string' || !ref.title.trim()) return
    const key = keyOf(ref.kind, ref.id, ref.title)
    const existing = byKey.get(key)
    if (!existing) {
      const record: EvidenceRecord = { key, ref, relation, quotes: [] }
      addQuote(record.quotes, quote)
      byKey.set(key, record)
      order.push(key)
      return
    }
    /* Quoted outranks consulted. A record that was both is quoted. */
    if (relation === 'quoted') existing.relation = 'quoted'
    /*
     * Keep the richer reference. A later lookup may carry the date or the
     * lifecycle state that the first one lacked, and losing it would make the
     * same record render less completely purely because of call ordering.
     */
    existing.ref = mergeRefs(existing.ref, ref)
    addQuote(existing.quotes, quote)
  }

  for (const tc of toolCalls) {
    if (!tc || !Array.isArray(tc.sources)) continue
    for (const s of tc.sources) {
      upsert(s, 'consulted', (s as { excerpt?: unknown }).excerpt)
    }
  }

  /* Citations second, so `quoted` can upgrade a record the trail already saw. */
  for (const c of citations) {
    if (!c || typeof c.document_title !== 'string') continue
    const ref: AiSourceRef = {
      kind: c.kind ?? 'note',
      id: c.document_id ?? '',
      asset_id: c.asset_id ?? null,
      symbol: c.symbol ?? null,
      title: c.document_title,
      timestamp: c.timestamp ?? null,
    }
    upsert(ref, 'quoted', c.cited_text)
  }

  const lookups: EvidenceLookup[] = toolCalls
    .filter(tc => tc && typeof tc.name === 'string')
    .map(tc => {
      const o = toolCallOutcome(tc)
      return {
        label: toolCallLabel(tc.name, tc.input),
        outcome: o.text || null,
        tone: o.text ? o.tone : null,
        failed: tc.status === 'error',
      }
    })

  const records = order
    .map(k => byKey.get(k))
    .filter((r): r is EvidenceRecord => Boolean(r))
  /*
   * Quoted first. Stable within each group because `sort` is stable in every
   * engine this ships to, so equal entries keep the answer's own order and
   * the list does not reshuffle between renders.
   */
  records.sort((a, b) => rank(a.relation) - rank(b.relation))

  return {
    records,
    lookups,
    failedCount: lookups.filter(l => l.failed).length,
    isEmpty: records.length === 0 && lookups.length === 0,
  }
}

function rank(r: EvidenceRelation): number {
  return r === 'quoted' ? 0 : 1
}

/** The more complete of two references to the same record. */
function mergeRefs(a: AiSourceRef, b: AiSourceRef): AiSourceRef {
  return {
    ...a,
    /* Field by field: a present value never loses to an absent one. */
    asset_id: a.asset_id ?? b.asset_id ?? null,
    symbol: a.symbol ?? b.symbol ?? null,
    timestamp: a.timestamp ?? b.timestamp ?? null,
    state: a.state ?? b.state ?? null,
    id: a.id || b.id,
    /* The longer title is the less truncated one. */
    title: b.title.length > a.title.length ? b.title : a.title,
  }
}

/**
 * The section's own heading.
 *
 * "Sources" rather than "Research": the reader is being told what the answer
 * rests on, not what the machine did. The count is of RECORDS, because that
 * is what the list contains -- counting lookups there was part of why the old
 * trail read as diagnostics.
 */
export function evidenceHeading(e: ConsolidatedEvidence): string {
  if (e.records.length === 0) {
    return e.lookups.length === 1 ? '1 lookup, no records' : `${e.lookups.length} lookups, no records`
  }
  return e.records.length === 1 ? '1 source' : `${e.records.length} sources`
}

/** The quiet provenance line under the records. */
export function lookupSummary(e: ConsolidatedEvidence): string | null {
  if (e.lookups.length === 0) return null
  const n = e.lookups.length
  const base = n === 1 ? 'From 1 lookup' : `From ${n} lookups`
  if (e.failedCount === 0) return base
  /* Never swallowed. A failed lookup means the answer may be missing
     something, and that is the reader's call to make, not ours. */
  return e.failedCount === n
    ? `${base}, which failed`
    : `${base}, ${e.failedCount} of which failed`
}
