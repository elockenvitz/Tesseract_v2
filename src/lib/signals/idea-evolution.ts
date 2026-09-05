/**
 * What has changed about an idea, said only as far as the record can prove it.
 *
 * ── The line this module will not cross ───────────────────────────────────
 *
 * "Target $120 → $135" is the sentence everybody wants and the one the data
 * cannot support. `updateTradeIdea` records `changed_fields` correctly and
 * records `state.from` as `{ rationale }` only, so every non-rationale field
 * has an "after" and no "before". Chaining consecutive events to synthesise one
 * fails on the first revision, because `createTradeIdea`'s audit `to` never
 * wrote `target_price` or `conviction` in the first place.
 *
 * So the vocabulary here is deliberately "what and when", not "from and to":
 *
 *   Target revised · 6d ago
 *   Conviction revised · 3w ago
 *   Thesis updated · yesterday
 *
 * Each of those is fully backed. A reader who wants the old number opens the
 * idea, which is a real answer; a card that invents one is not.
 *
 * ── Pure ──────────────────────────────────────────────────────────────────
 *
 * The hook fetches and groups; this decides what the group MEANS. Keeping the
 * meaning testable without a network is the same split `judgment-policy` uses.
 */

export interface IdeaChangeEvent {
  actionType: string
  changedFields: string[]
  /** ISO. */
  occurredAt: string
  actorName?: string | null
}

/** What kind of change this was, for ordering and for the accent. */
export type EvolutionKind =
  /** The written case moved. */
  | 'thesis'
  /** A number the idea rests on moved. */
  | 'framework'
  /** The idea advanced or retreated through the pipeline. */
  | 'stage'
  /** Intended sizing moved. */
  | 'sizing'

export interface EvolutionLine {
  kind: EvolutionKind
  /** "Target revised". Never carries a before/after pair. */
  label: string
  /** ISO of the event this line describes. */
  at: string
}

export interface IdeaEvolution {
  /** Most significant first, de-duplicated by label, capped. */
  lines: EvolutionLine[]
  /** ISO of the newest change of any kind, or null. */
  lastChangedAt: string | null
  /**
   * Whether the written case has moved at all.
   *
   * Its own field because the most useful thing a resurfaced idea can say is
   * that the thesis has NOT changed while the price has — and that sentence
   * needs a negative, which a list of lines cannot express.
   */
  thesisChanged: boolean
}

/**
 * Which fields produce which line.
 *
 * A field absent from this map produces no line rather than a generic
 * "updated". `context_tags` and `sharing_visibility` are real edits and are not
 * investment changes; announcing them would make the strip noise, and a strip
 * that fires on everything is one readers learn to skip.
 */
const FIELD_LINE: Record<string, { kind: EvolutionKind; label: string }> = {
  target_price: { kind: 'framework', label: 'Target revised' },
  conviction: { kind: 'framework', label: 'Conviction revised' },
  time_horizon: { kind: 'framework', label: 'Horizon revised' },
  stop_loss: { kind: 'framework', label: 'Risk levels revised' },
  take_profit: { kind: 'framework', label: 'Risk levels revised' },
  rationale: { kind: 'thesis', label: 'Thesis updated' },
  thesis_text: { kind: 'thesis', label: 'Thesis updated' },
  proposed_weight: { kind: 'sizing', label: 'Sizing revised' },
  proposed_shares: { kind: 'sizing', label: 'Sizing revised' },
  expected_position_size: { kind: 'sizing', label: 'Sizing revised' },
  max_position_size: { kind: 'sizing', label: 'Sizing revised' },
  stage: { kind: 'stage', label: 'Moved forward' },
  urgency: { kind: 'framework', label: 'Urgency changed' },
}

/**
 * Which kind leads when an idea changed several things at once.
 *
 * The written case first: a moved thesis is the change a colleague most needs
 * to know about, and a target revision usually follows from one. Sizing last —
 * it is an expectation, not a claim about the investment.
 */
const KIND_RANK: Record<EvolutionKind, number> = {
  thesis: 0,
  framework: 1,
  stage: 2,
  sizing: 3,
}

/** Three lines is a strip; five is a change log nobody reads on a phone. */
const MAX_LINES = 3

export function summariseEvolution(events: IdeaChangeEvent[]): IdeaEvolution {
  const byLabel = new Map<string, EvolutionLine>()
  let lastChangedAt: string | null = null
  let thesisChanged = false

  for (const e of events) {
    // `create` is not evolution. Every idea has one and a strip that always
    // says "created" says nothing.
    if (e.actionType === 'create') continue

    for (const f of e.changedFields) {
      const spec = FIELD_LINE[f]
      if (!spec) continue
      if (spec.kind === 'thesis') thesisChanged = true

      // Events arrive newest-first, so the first sighting of a label is its
      // most recent occurrence and later ones are history.
      if (!byLabel.has(spec.label)) {
        byLabel.set(spec.label, { kind: spec.kind, label: spec.label, at: e.occurredAt })
      }
      if (!lastChangedAt || e.occurredAt > lastChangedAt) lastChangedAt = e.occurredAt
    }
  }

  const lines = [...byLabel.values()]
    .sort((a, b) => (KIND_RANK[a.kind] - KIND_RANK[b.kind]) || (a.at < b.at ? 1 : -1))
    .slice(0, MAX_LINES)

  return { lines, lastChangedAt, thesisChanged }
}

/** Empty, for the common case of an idea nobody has revised. */
export const NO_EVOLUTION: IdeaEvolution = {
  lines: [], lastChangedAt: null, thesisChanged: false,
}

/**
 * "6d", "3w", "yesterday" — compact enough for a strip on a 390px card.
 *
 * Its own function rather than `formatDistanceToNow` because that produces
 * "about 2 months ago", which wraps a chip. The card has room for a unit and a
 * number.
 */
export function shortAge(iso: string | null | undefined, now: number = Date.now()): string | null {
  if (!iso) return null
  const t = new Date(iso).getTime()
  if (!Number.isFinite(t)) return null
  const days = Math.floor((now - t) / 86_400_000)
  if (days < 0) return null
  if (days === 0) return 'today'
  if (days === 1) return 'yesterday'
  if (days < 7) return `${days}d ago`
  if (days < 31) return `${Math.floor(days / 7)}w ago`
  if (days < 365) return `${Math.floor(days / 30)}mo ago`
  return `${Math.floor(days / 365)}y ago`
}

/**
 * The one sentence a resurfaced idea is actually for.
 *
 * Returns a line only when BOTH halves are provable: the thesis has not moved,
 * and there is an anchored return to quote. Either missing and there is no
 * claim — "thesis unchanged" alone is not news, and a price move alone is a
 * chart, which the card already has.
 */
export function unchangedThesisLine(
  evolution: IdeaEvolution,
  sinceIdeaChangePct: number | null,
): string | null {
  if (evolution.thesisChanged) return null
  if (sinceIdeaChangePct == null) return null
  // Below this the sentence is about noise rather than about a divergence
  // between the market and the view.
  if (Math.abs(sinceIdeaChangePct) < 8) return null
  const sign = sinceIdeaChangePct >= 0 ? '+' : '−'
  return `Thesis unchanged · price ${sign}${Math.abs(sinceIdeaChangePct).toFixed(0)}%`
}
