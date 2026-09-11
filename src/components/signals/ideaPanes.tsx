import { ideaPanePlan, type IdeaPaneId } from '../../lib/signals/pane-plan'
import type { SignalCard } from '../../lib/signals/contract'

/**
 * The contextual panes for an idea card, assembled from the SHARED plan.
 *
 * ── The mistake this replaces ─────────────────────────────────────────────
 *
 * The first version of this file invented its own pane set — a "The claim"
 * pane holding target, conviction and horizon, and a "The case" pane holding
 * the body. Neither exists on mobile. Target and conviction are card CHROME
 * there: the builder puts them in the headline and the metric, where they are
 * read at a glance. Promoting them to a pane is what produced a carousel whose
 * only page said CONVICTION / High, with pagination dots under it, floating in
 * a card sized for something substantial.
 *
 * So the desktop card was not dropping anything the renderer needed. It was
 * being handed a different, thinner, invented composition.
 *
 * ── The actual seam ───────────────────────────────────────────────────────
 *
 * `ideaPanePlan` in `lib/signals/pane-plan.ts` already decides which panes an
 * idea gets, and it is pure, shared and tested. Mobile follows it. This now
 * follows it too, so both shells ask one function what a card should carry and
 * differ only in how they draw it.
 *
 *   cases     a scenario ladder                      needs ladder data
 *   legs      a pair's per-leg context                needs leg data
 *   changed   how the thesis evolved                  needs evolution data
 *   post      the body, when it outruns its clamp     needs only the card
 *   verdict   the reader's own response               needs judgment wiring
 *   price     the tape                                needs a cached series
 *
 * ── What desktop can build today, honestly ────────────────────────────────
 *
 * `post` only. The other five need inputs the desktop feed has no source for
 * yet — ladders and evolution come from the lens and scenario producers,
 * verdict needs the judgment write path, price needs the history cache. Those
 * are the same producers Explore is waiting on.
 *
 * Rendering an empty box for a pane whose data is absent would be the same
 * error again, so this asks the plan what is guaranteed and builds only what
 * it can actually fill. A card with nothing to turn over gets no carousel —
 * `SignalCardView` renders it as the typography it is.
 */

export interface IdeaPane {
  id: IdeaPaneId
  label: string
  content: React.ReactNode
}

/**
 * What this shell can currently draw. Everything else in the plan is skipped
 * rather than stubbed, so the carousel's dots always count real pages.
 */
const BUILDABLE: ReadonlySet<IdeaPaneId> = new Set<IdeaPaneId>(['post'])

export interface IdeaPaneContext {
  /** The post has an evolution strip, or is explicitly unchanged. */
  hasEvolution?: boolean
  /** A scenario-shaped idea WITH a ladder to draw. */
  hasLadder?: boolean
  /** A pair whose legs carry market context worth a pane. */
  hasLegContext?: boolean
}

export function ideaPanes(card: SignalCard, ctx: IdeaPaneContext = {}): IdeaPane[] {
  const plan = ideaPanePlan({
    isPair: card.type === 'pair_trade',
    hasLadder: ctx.hasLadder ?? false,
    hasAsset: !!card.entity?.id,
    bodyLength: card.body?.length ?? 0,
    hasEvolution: ctx.hasEvolution ?? false,
    hasLegContext: ctx.hasLegContext ?? false,
  })

  const panes: IdeaPane[] = []
  for (const id of plan.guaranteed) {
    if (!BUILDABLE.has(id)) continue
    if (id === 'post') {
      panes.push({
        id: 'post',
        label: 'Post',
        /*
         * The card clamps its body to two lines, so a post past the threshold
         * has a tail the reader cannot reach from the face of the card. Same
         * text, same threshold, same reason as mobile — only the type scale
         * differs, because this one is read at arm's length rather than held.
         */
        content: (
          <p className="whitespace-pre-line text-sm leading-relaxed text-gray-600 dark:text-gray-300">
            {card.body}
          </p>
        ),
      })
    }
  }
  return panes
}
