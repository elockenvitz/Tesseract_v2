import type { ItemType } from '../../hooks/ideas/types'

/**
 * The desktop Ideas type lens.
 *
 * ── Why type is the primary control ───────────────────────────────────────
 *
 * The desktop workspace used to read one table, so Direction and Maturity were
 * safe controls: everything on screen had both. Once the candidate set widens
 * to the canonical mixed feed, they are not. Leaving them permanently visible
 * over a mixed feed would mean selecting "Buy" silently removes every thought,
 * prompt and signal — a trade-only filter quietly redefining the candidate set
 * with nothing on screen saying so.
 *
 * So the lens comes first and says what kind of thing you are looking at, and
 * the investment controls appear only inside the lens where every row has
 * them. The reader sees WHY the set changed.
 *
 * ── Why this is a table and not a filter framework ────────────────────────
 *
 * Because four lenses do not need one. `investmentFilters` is a boolean, read
 * once, to decide whether to render controls that already exist. A generalised
 * per-lens filter registry would be more code, more indirection and no more
 * capability, and it is explicitly not what this task is for.
 */

export type IdeaLens = 'all' | 'trade_ideas' | 'thoughts' | 'prompts'

export interface IdeaLensSpec {
  key: IdeaLens
  label: string
  /**
   * Feed item types this lens admits, or `null` for "everything the feed
   * returns". Null is not the same as listing every type: signal cards are
   * inserted alongside feed items rather than being one, so only an unfiltered
   * lens can show both.
   */
  types: ItemType[] | null
  /**
   * Whether Direction, Maturity and the other investment-object controls
   * apply. True only where every row in the lens is a trade idea.
   */
  investmentFilters: boolean
  /** Shown when the lens is empty. Says what this lens is, not just "nothing". */
  emptyHint: string
}

export const IDEA_LENSES: IdeaLensSpec[] = [
  {
    key: 'all',
    label: 'All',
    types: null,
    investmentFilters: false,
    emptyHint: 'Nothing in the feed yet.',
  },
  {
    /**
     * The one-click route back to the narrow investment-object workflow the
     * desktop workspace was before this. It is a lens rather than a mode:
     * same feed, same ranking, one type.
     */
    key: 'trade_ideas',
    label: 'Trade Ideas',
    types: ['trade_idea', 'pair_trade'],
    investmentFilters: true,
    emptyHint: 'No trade ideas match these filters.',
  },
  {
    key: 'thoughts',
    label: 'Thoughts',
    types: ['quick_thought', 'note'],
    investmentFilters: false,
    emptyHint: 'No thoughts captured yet.',
  },
  {
    key: 'prompts',
    label: 'Prompts',
    // Prompts are `quick_thoughts` rows with an idea_type of prompt, so the
    // feed returns them under the same item type. The lens narrows further
    // downstream rather than by item type alone.
    types: ['quick_thought'],
    investmentFilters: false,
    emptyHint: 'No open prompts.',
  },
]

/*
 * There is deliberately no Signals lens yet.
 *
 * The machine-derived families — stale target, case versus price, target hit,
 * active risk, news — are not returned by `useIdeasFeed`. On mobile they come
 * from the portfolio-lens and scenario hooks, which desktop does not yet call.
 * A Signals tab over a feed that cannot produce a signal would be a label with
 * nothing behind it, and the instruction was to use the real type model rather
 * than invent one to fill the row.
 *
 * It arrives when those producers are reachable from both shells. Their
 * builders are already shared; only the hooks that feed them are not.
 */

const BY_KEY = new Map(IDEA_LENSES.map(l => [l.key, l]))

export function lensSpec(key: IdeaLens): IdeaLensSpec {
  return BY_KEY.get(key) ?? IDEA_LENSES[0]
}

/** True where the investment controls should be rendered at all. */
export function lensShowsInvestmentFilters(key: IdeaLens): boolean {
  return lensSpec(key).investmentFilters
}
