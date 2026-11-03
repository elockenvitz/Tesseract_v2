import type { ItemType } from '../../hooks/ideas/types'
import type { SignalType } from '../signals/contract'

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

export type IdeaLens =
  | 'all' | 'trade_ideas' | 'thoughts' | 'prompts'
  | 'decisions' | 'case_vs_price' | 'case_gaps' | 'needs_review' | 'from_the_team'

/**
 * Which band of the rail a lens belongs to.
 *
 * The rail asks two different questions and used to ask only the first:
 * `post` is "what KIND of thing did somebody write", `signal` is "what did
 * the system notice". A reader scanning one flat row of chips has no way to
 * tell that "Thoughts" and "Case vs price" come from different places -- one
 * is a post type and the other is a finding nobody typed -- and the chips
 * that answer the second question were simply absent.
 *
 * A hairline between the bands says it without a word of copy. The group is
 * data here rather than a divider hard-coded at index 4, so adding a lens
 * cannot silently land it on the wrong side of the rule.
 */
export type IdeaLensGroup = 'post' | 'signal'

export interface IdeaLensSpec {
  key: IdeaLens
  label: string
  /** Which band of the rail this chip sits in. See {@link IdeaLensGroup}. */
  group: IdeaLensGroup
  /**
   * Feed item types this lens admits, or `null` for "everything the feed
   * returns". Null is not the same as listing every type: signal cards are
   * inserted alongside feed items rather than being one, so only an unfiltered
   * lens can show both.
   */
  types: ItemType[] | null
  /**
   * Card types this lens admits, for a lens about what the system NOTICED
   * rather than what somebody posted.
   *
   * ── Why card type and not candidate family ───────────────────────────────
   *
   * The feed's `family` is which PRODUCER a candidate came from, and that is
   * one level too coarse in one direction and too fine in the other: the
   * `research` family emits two signal types that answer different questions,
   * while a type like `scenario_gap` is one question whoever produced it. A
   * card's own type is the identity it declares, carries into its eyebrow,
   * and is already what Curate filters on -- so a chip and the pill on the
   * cards beneath it cannot drift apart.
   *
   * Set on a signal lens, null on a post lens. The two are exclusive by
   * construction: a lens reads either posts or cards, never both, because a
   * chip that silently mixed them would be the mixed-feed problem this file
   * exists to prevent.
   */
  cardTypes: SignalType[] | null
  /**
   * Posts by anyone but the reader.
   *
   * This is the one lens that narrows by AUTHOR rather than by kind, which is
   * why it is a flag and not a type list: "what are my colleagues putting up"
   * is a question about the desk, and every post type can answer it. It sits
   * in the signal band because, like the card lenses, it is about work that
   * arrived rather than work the reader filed.
   */
  othersOnly?: boolean
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
    group: 'post',
    types: null,
    cardTypes: null,
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
    group: 'post',
    types: ['trade_idea', 'pair_trade'],
    cardTypes: null,
    investmentFilters: true,
    emptyHint: 'No trade ideas match these filters.',
  },
  {
    key: 'thoughts',
    label: 'Thoughts',
    group: 'post',
    types: ['quick_thought', 'note'],
    cardTypes: null,
    investmentFilters: false,
    emptyHint: 'No thoughts captured yet.',
  },
  {
    key: 'prompts',
    label: 'Prompts',
    group: 'post',
    // Prompts are `quick_thoughts` rows with an idea_type of prompt, so the
    // feed returns them under the same item type. The lens narrows further
    // downstream rather than by item type alone.
    types: ['quick_thought'],
    cardTypes: null,
    investmentFilters: false,
    emptyHint: 'No open prompts.',
  },

  /*
   * ── The second band: what the system noticed ─────────────────────────────
   *
   * Every lens above selects a POST TYPE, and for as long as that was the
   * whole rail the feed's machine-derived half was reachable only under All.
   * A reader who wanted the proposed trades waiting on them, or the names the
   * price has outrun, had one chip for all of it and the chip was "All".
   *
   * Each label below is the card's OWN label, copied from `KIND_LABEL` rather
   * than invented here. That is the point: the chip and the pill on the cards
   * it returns say the same words, so a reader can tell at a glance that the
   * filter did what they asked. The alternative -- two names a word apart for
   * one finding -- is recorded in `card-identity.ts` as how a reader stops
   * trusting both.
   *
   * It follows that the prototype's "No case" is NOT one of these. The type
   * behind it is `no_research`, which the product calls "Case gaps" because
   * it covers a name with nothing written AND a name whose case is
   * unfinished. A chip saying "No case" over a name with half a case written
   * is a false label on a tool people size positions with.
   */
  {
    key: 'decisions',
    label: 'Awaiting decision',
    group: 'signal',
    types: null,
    cardTypes: ['recommendation'],
    investmentFilters: false,
    emptyHint: 'No proposed trades are waiting on an answer.',
  },
  {
    key: 'case_vs_price',
    label: 'Case vs price',
    group: 'signal',
    types: null,
    cardTypes: ['scenario_gap'],
    investmentFilters: false,
    emptyHint: 'No name is trading outside the cases you modelled.',
  },
  {
    key: 'case_gaps',
    label: 'Case gaps',
    group: 'signal',
    types: null,
    cardTypes: ['no_research'],
    investmentFilters: false,
    emptyHint: 'Every name you hold has a case on file.',
  },
  {
    key: 'needs_review',
    label: 'Needs review',
    group: 'signal',
    types: null,
    cardTypes: ['research_stale'],
    investmentFilters: false,
    emptyHint: 'No case is waiting on a review.',
  },
  {
    key: 'from_the_team',
    label: 'From the team',
    group: 'signal',
    // Every post type, narrowed by author rather than by kind.
    types: null,
    cardTypes: null,
    othersOnly: true,
    investmentFilters: false,
    emptyHint: 'Nobody else has posted yet.',
  },
]

/*
 * A Signals lens still does not exist as one chip, and that is deliberate.
 *
 * The band above names FINDINGS -- a decision waiting, a price past its
 * cases, a case missing, a case stale. One chip called "Signals" would be a
 * container rather than a question, and a reader who taps it learns nothing
 * about what is inside. The families that genuinely have no chip yet
 * (crowding, conviction, target hit, ready to revisit) are reachable under
 * All, and each gets a chip when it is worth asking for on its own rather
 * than to fill the row.
 */

const BY_KEY = new Map(IDEA_LENSES.map(l => [l.key, l]))

export function lensSpec(key: IdeaLens): IdeaLensSpec {
  return BY_KEY.get(key) ?? IDEA_LENSES[0]
}

/** True where the investment controls should be rendered at all. */
export function lensShowsInvestmentFilters(key: IdeaLens): boolean {
  return lensSpec(key).investmentFilters
}
