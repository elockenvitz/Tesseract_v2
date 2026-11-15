/**
 * What the server said it could actually read, as the pane understands it.
 *
 * ── Why the pane needs this at all ──────────────────────────────────────
 *
 * A context chip used to be the client reporting its own tag write. It drew
 * "Large Cap Growth" and said nothing about whether `ai-chat` then found the
 * portfolio, was allowed to read it, or got anything back -- and in the
 * failure that prompted this, the answer was built from no portfolio while
 * the chip sat there looking attached.
 *
 * So a chip now carries two independent facts, and they are not the same
 * question:
 *
 *   reachability  can the READER open this object? Resolved client-side by
 *                 `useReferenceTargets`, under the reader's own RLS. This is
 *                 what decides whether the chip is a link.
 *   retrieval     did the SERVER load it for the last answer? Reported by
 *                 `ai-chat` in its response. This is what decides whether
 *                 the chip is making a claim the answer supports.
 *
 * They disagree in both directions, which is why neither substitutes for the
 * other. An object the reader can open may still have failed to load for the
 * answer (the Large Cap Growth case: a broken query, not a permission
 * problem). An object that loaded fine for the answer may have been deleted
 * since.
 *
 * ── Trust boundary ──────────────────────────────────────────────────────
 *
 * Everything here arrives over the wire, so the parse is defensive: an
 * outcome this build does not recognise becomes `unknown` rather than being
 * shown to the reader as a status, and anything that is not an object with a
 * string type and id is dropped. A future server that adds a sixth outcome
 * must not make an old client render a label it cannot explain.
 */

/** The five the server reports. Mirrored from `_shared/context-manifest.ts`. */
export const CONTEXT_OUTCOMES = [
  'resolved', 'empty', 'unavailable', 'unsupported', 'failed',
] as const

export type ContextOutcome = typeof CONTEXT_OUTCOMES[number]

/**
 * `unknown` is a CLIENT state, not a server one.
 *
 * It means "no answer in this session has spoken about this object" -- which
 * is true of every chip before the first send, and of a chip attached after
 * the last one. It must not be drawn as a problem: the reader attached
 * something and has not asked anything yet, and a warning there would train
 * them to ignore the warning that matters.
 */
export type ChipRetrieval = ContextOutcome | 'unknown'

export interface ContextEntry {
  type: string
  id: string
  outcome: ContextOutcome
  loaded?: readonly string[]
  detail?: string
}

const isOutcome = (v: unknown): v is ContextOutcome =>
  typeof v === 'string' && (CONTEXT_OUTCOMES as readonly string[]).includes(v)

/** Parse the `context` array off a response. Anything malformed is dropped. */
export function parseContextManifest(value: unknown): ContextEntry[] {
  if (!Array.isArray(value)) return []
  const out: ContextEntry[] = []
  for (const raw of value) {
    if (!raw || typeof raw !== 'object') continue
    const r = raw as Record<string, unknown>
    if (typeof r.type !== 'string' || typeof r.id !== 'string') continue
    if (!isOutcome(r.outcome)) continue
    out.push({
      type: r.type,
      id: r.id,
      outcome: r.outcome,
      ...(Array.isArray(r.loaded) ? { loaded: r.loaded.filter(x => typeof x === 'string') as string[] } : {}),
      ...(typeof r.detail === 'string' ? { detail: r.detail } : {}),
    })
  }
  return out
}

export const contextKey = (t: { type: string; id: string }) => `${t.type}:${t.id}`

/** Index a manifest for per-chip lookup. */
export function manifestIndex(entries: readonly ContextEntry[]): Map<string, ContextEntry> {
  return new Map(entries.map(e => [contextKey(e), e]))
}

/**
 * Does this outcome mean the last answer was built without the object?
 *
 * `empty` is deliberately NOT a failure. The object was read; the firm has
 * written nothing on it. That is a finding, and an answer saying so is
 * correct. Marking it as a fault would tell the reader the system is broken
 * when what it found is that the research is missing.
 */
export function isRetrievalGap(outcome: ChipRetrieval): boolean {
  return outcome === 'unavailable' || outcome === 'unsupported' || outcome === 'failed'
}

/**
 * The sentence on the chip's tooltip.
 *
 * Each outcome gets its own, because the four failures call for four
 * different actions from the reader: re-attach, nothing, nothing, retry.
 * Collapsing them into "context unavailable" is what made the original
 * failure unreportable.
 *
 * `label` is the object's own name, which is already on the chip, so these
 * read as a continuation of it rather than repeating it.
 */
export function retrievalTitle(label: string, outcome: ChipRetrieval): string | null {
  switch (outcome) {
    case 'unknown':
    case 'resolved':
      /* Nothing to say. The chip's own title covers the normal case, and a
         tooltip asserting success on every chip is noise. */
      return null
    case 'empty':
      return `${label} was read for the last answer, but nothing is recorded on it yet.`
    case 'unavailable':
      return `${label} could not be read for the last answer. It may have been deleted, or it may no longer be visible to you.`
    case 'unsupported':
      return `ACT AI cannot load ${label} as context, so the last answer did not use it.`
    case 'failed':
      return `Reading ${label} failed, so the last answer did not use it. Asking again may work.`
  }
}

/**
 * The one-line banner above the composer when the last answer had a gap.
 *
 * A tooltip is not enough on its own: the reader has to hover the right chip
 * to find out the answer they are reading was built without it. This is the
 * part they cannot miss.
 *
 * Returns null when there is nothing to report, including when the only
 * non-resolved outcome is `empty`.
 */
export function retrievalBanner(
  entries: readonly ContextEntry[],
  labelFor: (e: ContextEntry) => string,
): string | null {
  const gaps = entries.filter(e => isRetrievalGap(e.outcome))
  if (gaps.length === 0) return null

  const names = gaps.map(labelFor)
  const list = names.length === 1
    ? names[0]
    : names.length === 2
      ? `${names[0]} and ${names[1]}`
      : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`

  const was = gaps.length === 1 ? 'was' : 'were'
  return `${list} ${was} attached but could not be read, so the last answer did not use ${gaps.length === 1 ? 'it' : 'them'}.`
}
