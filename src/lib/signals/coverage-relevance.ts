/**
 * Coverage as a feed input, and as an explanation.
 *
 * ── The slot this fills ───────────────────────────────────────────────────
 *
 * `PriorityInput.owned` has existed since the ranking was written, with a
 * comment saying it is `undefined` for every signal on mobile because "no feed
 * hook queries `coverage`". That was true, and it was true for a good reason:
 * coverage was admin-assigned and almost nobody had any, so a feed that ranked
 * by it would have ranked by nothing.
 *
 * Self-service coverage changes the premise, so this fills the slot. It is a
 * separate module rather than three lines inside `MobileDashboard` because the
 * decision it encodes is subtle enough to be worth testing on its own, and
 * because the desktop feed will want the identical rule.
 *
 * ── Why "not covered" is usually NOT a penalty ────────────────────────────
 *
 * `computePriority` scores `owned === false` at zero and treats `undefined` as
 * neutral, so the only way coverage can matter is if something says `false` —
 * and saying `false` too eagerly is the failure the original comment warns
 * about: "Hiding a 12% position below its bear case because we could not
 * establish who covers it would be the worst possible failure mode."
 *
 * That warning survives here as three refusals:
 *
 *   1. A reader with no coverage at all gets `undefined` for everything.
 *      Their feed is exactly what it is today. Coverage that nobody has must
 *      not silently flatten the ranking for everyone who has not answered yet.
 *
 *   2. A held position is never marked unowned. A name in the book is the
 *      reader's business whether or not anyone has claimed research
 *      responsibility for it — that is the exact 12%-position case, and it is
 *      also the common one, because most pilot workspaces have holdings and no
 *      coverage.
 *
 *   3. An entity we cannot identify as an asset is never marked unowned. A
 *      macro release or a workflow item has no asset id to check against, so
 *      "not in your coverage" is not a fact about it, it is a fact about the
 *      question being wrong.
 *
 * What is left is the case the signal is actually for: a reader who HAS
 * declared coverage, looking at a card about an equity they do not hold and did
 * not claim. Ranking that below the names they said they follow is the whole
 * point of asking.
 */

/** Asset ids are UUIDs; a market card's "entity id" is a ticker string. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export interface CoverageRelevanceInput {
  /** Asset ids the reader covers, either lane. Empty when they have none. */
  coveredAssetIds: ReadonlySet<string>
  /** The card's entity id, if it has one. */
  entityId?: string | null
  /** Whether the card's asset is in the reader's book. */
  held?: boolean
}

/**
 * The value for `PriorityInput.owned`.
 *
 * `true` — the reader covers this name.
 * `false` — the reader has coverage and this is not in it (a demotion).
 * `undefined` — we decline to answer. See the three refusals above.
 */
export function coverageOwnership(input: CoverageRelevanceInput): boolean | undefined {
  const { coveredAssetIds, entityId, held } = input

  // Refusal 3: not an asset we can check.
  if (!entityId || !UUID.test(entityId)) return undefined

  if (coveredAssetIds.has(entityId)) return true

  // Refusal 1: the reader has told us nothing, so we know nothing.
  if (coveredAssetIds.size === 0) return undefined

  // Refusal 2: it is in their book, which is its own claim on their attention.
  if (held === true) return undefined

  return false
}

export type CoverageAttributionKind = 'covered' | 'held' | 'discovery'

export interface CoverageAttribution {
  kind: CoverageAttributionKind
  /** One short clause naming why this card is in front of the reader. */
  label: string
}

/**
 * Why this card is here, in the reader's terms.
 *
 * ── Why this is not a tutorial overlay ────────────────────────────────────
 *
 * The obvious way to teach a feed is a coach-mark pointing at the first card
 * saying "we chose this for you because…". It gets dismissed once and never
 * seen again, including by the reader who wanted it on their fourth session
 * when a card surprised them.
 *
 * A standing attribution line is better on every axis: it is present exactly
 * when it is relevant, it never has to be dismissed, and it stays true as the
 * reason changes. It is also falsifiable, which a tutorial is not — a reader
 * who sees "in your coverage" on a name they dropped last month has learned
 * something real about their own setup, and can go fix it.
 *
 * Three kinds, because there are three honest answers. `discovery` is
 * deliberately not dressed up as personalization: a card the reader neither
 * covers nor holds is there because the product thinks it is interesting, and
 * saying so is more useful than implying a relevance we did not compute.
 */
export function coverageAttribution(
  input: CoverageRelevanceInput,
): CoverageAttribution {
  const owned = coverageOwnership(input)

  if (owned === true) return { kind: 'covered', label: 'In your coverage' }
  if (input.held === true) return { kind: 'held', label: 'In your book' }
  return { kind: 'discovery', label: 'Suggested' }
}
