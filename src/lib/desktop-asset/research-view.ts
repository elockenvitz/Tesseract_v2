/**
 * Which research perspective the Asset Page opens on, and whether that is a
 * DECISION or merely a placeholder waiting on data.
 *
 * This exists because getting it wrong is visible as a flicker rather than as
 * a wrong answer, which made it easy to ship. The Asset Page used to seed the
 * perspective to `'aggregated'` (the Organization/firm summary) and leave the
 * real choice to an effect that waited on three async queries — contributor
 * profiles, coverage and thesis contributions. Every asset open therefore
 * painted somebody else's case for ~70ms and then replaced it with the
 * reader's own, which reads as the page flipping between two different cases.
 *
 * The waiting was never needed for a signed-in reader. `ProtectedRoute`
 * renders the asset tree only once `user` is non-null, so the reader's own id
 * is in hand on the very first render; the async inputs are needed only to
 * pick a STANDIN when there is no reader at all. So:
 *
 *   - an arriving navigation intent wins outright (someone asked for a view),
 *   - otherwise a signed-in reader lands on their own view, decided,
 *   - otherwise we are genuinely undecided and the caller's resolver runs.
 *
 * `'aggregated'` is the sentinel for the undecided case because many
 * downstream consumers treat any other value as a user id. "Undecided" is
 * carried by `decided: false`, never by the filter value.
 */

/** The reader's own id, an analyst's id, or `'aggregated'` for the firm view. */
export type ResearchViewFilter = 'aggregated' | string

export interface ResearchViewSeed {
  /** What the perspective selector starts on. */
  filter: ResearchViewFilter
  /**
   * True when `filter` is a real answer. False means "placeholder" and the
   * caller's deferred resolver must still settle it once its data lands.
   */
  decided: boolean
  /**
   * True only when a person (or a navigation carrying their intent) picked
   * this. A default must never be persisted as a preference — doing so keeps
   * sending the reader to a view they never chose, which is the outcome the
   * default exists to prevent.
   */
  chosen: boolean
}

export function initialResearchView(input: {
  /** A perspective carried by the navigation that opened this asset. */
  arriving?: ResearchViewFilter | null
  /** The signed-in reader's id, if there is one. */
  userId?: string | null
}): ResearchViewSeed {
  if (input.arriving) {
    return { filter: input.arriving, decided: true, chosen: true }
  }
  if (input.userId) {
    return { filter: input.userId, decided: true, chosen: false }
  }
  return { filter: 'aggregated', decided: false, chosen: false }
}
