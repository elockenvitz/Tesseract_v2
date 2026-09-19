/**
 * The plan's chosen picture, as data the shared renderer already draws.
 *
 * ── The gap this closes ───────────────────────────────────────────────────
 *
 * The resolver has always chosen a primitive. `primitiveFor` reads the claim's
 * predicate and its units and answers "a clock", "a ladder", "the tape" — and
 * `PresentationPlan.visuals` has carried that answer since the foundation.
 *
 * Nothing rendered it. `projectPlanOntoCard` records the choice in
 * `card.evidence.kind`, which `SignalCardView` reads only as a gate, and the
 * NODE in the evidence band is whatever the caller passed. The caller is
 * `MobileDashboard`, which builds panes from hand-written per-kind branches
 * that predate the engine. So every adopted card got the copy, the metric, the
 * actions, the context and the accent rail the plan resolved — and the picture
 * the feed had always drawn for that producer.
 *
 * That is the whole of "the tile still looks generic". The plan was right and
 * unread.
 *
 * ── Why this returns Explore's union rather than a node ───────────────────
 *
 * Because `ExploreVisualBlock` exists, renders all ten kinds, and is the
 * component the primitive vocabulary is ALIASED FROM — `VisualPrimitive` is
 * `ExploreVisual['kind']` precisely so a plan cannot ask for a picture the
 * product cannot draw. Producing that union here means the feed and Explore
 * draw one finding the same way, and it means this module stays pure: no React,
 * no component names, no second renderer to keep in step.
 *
 * ── The rule about data ───────────────────────────────────────────────────
 *
 * Every number comes from the CLAIM, which the adapter built from the
 * producer's own facts. Nothing is inferred, nothing is defaulted, and a
 * primitive whose data is absent returns null rather than a drawing with a
 * plausible number in it. `target_compare` on a structural absence is the case
 * that makes the rule concrete: the finding is that no target exists, so there
 * is no level to draw, and the honest answer is no picture at all.
 *
 * Pure. No React, no clock — `now` is the caller's.
 */

import type { ExploreVisual, VisualCase } from '../../mobile/explore-visual'
import type { SignalCard } from '../../signals/contract'
import type { PresentationPlan } from '../presentation'
import type { Situation } from '../situation'

/**
 * The cases the producer drew its band from, where it carried them.
 *
 * Read off the original card's evidence rather than rebuilt, for the reason
 * `projectEvidence` gives: the plan names a shape and the producer owns the
 * numbers that fill it. A ladder reassembled here would be a second assembler
 * of the same geometry.
 */
function casesFrom(original: SignalCard | null | undefined): VisualCase[] | undefined {
  const cases = (original?.evidence?.data as { cases?: unknown } | undefined)?.cases
  if (!Array.isArray(cases)) return undefined
  /**
   * `name` is what a case row calls its label.
   *
   * `selectCurrentLadders` stores "Bear", "Base", "Bull" under `name`, and the
   * visual union calls the same string a `label`. Reading both rather than
   * renaming either: the union is Explore's and the row is the database's, and
   * a rename in this file would be a third vocabulary for one word.
   */
  const out = cases
    .filter((c): c is Record<string, unknown> => !!c && typeof c === 'object')
    .map(c => ({ label: String(c.name ?? c.label ?? ''), price: Number(c.price) }))
    .filter(c => c.label && Number.isFinite(c.price))
  return out.length ? out : undefined
}

/**
 * What the tile should draw, or null when the claim cannot support a picture.
 *
 * Reads the LEAD finding only. A supporting finding is corroboration and its
 * picture is not the one the reader came for — the same rule
 * `situationPriorityInput` follows when it refuses to gap-fill a base from
 * corroboration.
 */
export function visualDataFor(
  situation: Situation,
  plan: PresentationPlan,
  original?: SignalCard | null,
): ExploreVisual | null {
  const lead = plan.visuals.find(v => v.role === 'lead')
  if (!lead) return null

  const { claim, stakes } = situation.lead

  switch (lead.primitive) {
    /**
     * The valuation picture: the band, the cases in it, and where the price is.
     *
     * The reader's question is "how does the price compare with the case", and
     * this is the only primitive that answers it in one glance — a band with
     * the modelled cases ticked on it and the live price marked against them.
     * Degrades by itself: with two ends and no ticks it is still a range with a
     * marker, which is a smaller answer to the same question rather than a
     * different one.
     */
    case 'scenario_range': {
      const b = claim.band
      if (!b || !Number.isFinite(b.low) || !Number.isFinite(b.high) || !Number.isFinite(b.current)) {
        return null
      }
      if (b.high <= b.low) return null
      return {
        kind: 'scenario_range',
        low: b.low,
        high: b.high,
        current: b.current,
        ...(b.breachedLabel ? { breachedLabel: b.breachedLabel } : {}),
        ...(casesFrom(original) ? { cases: casesFrom(original) } : {}),
      }
    }

    /**
     * One level and the value that passed it.
     *
     * `threshold` present is a target that was reached. Absent is the
     * structural case — no target was ever written — and the union models that
     * as `target: null`, a dashed empty slot rather than a zero. But it still
     * needs a CURRENT price to draw the slot against, and a claim of pure
     * absence carries no price. No price, no picture.
     */
    case 'target_compare': {
      const t = claim.threshold
      if (t && Number.isFinite(t.observed) && Number.isFinite(t.level)) {
        return {
          kind: 'target_compare',
          current: t.observed,
          target: t.level,
          ...(t.label ? { targetLabel: t.label } : {}),
        }
      }
      return null
    }

    /**
     * Time, in whichever of its two shapes the claim supports.
     *
     * A claim with an interval whose end is in the past is a commitment that
     * was missed, and the picture is the honoured stretch beside the overrun. A
     * claim whose interval ends now is an elapsed span nobody promised
     * anything about, and the picture is one stretch and its length. The
     * primitive is the same; which shape it takes is a property of the data.
     */
    case 'timeline': {
      const iv = claim.interval
      if (!iv?.from) return null
      const from = Date.parse(iv.from)
      const to = iv.to ? Date.parse(iv.to) : NaN
      if (!Number.isFinite(from)) return null

      /**
       * A deadline, or an elapsed span. Decided by the PREDICATE.
       *
       * `expired` is the predicate for "a stated horizon has passed", so its
       * interval ends at the horizon and that is a due date. `unreviewed`
       * measures from the last look to now, and its end is simply today —
       * passing that as a due date would draw an amber cap on a promise nobody
       * made.
       */
      const isDeadline = claim.predicate === 'expired' && Number.isFinite(to) && to > from
      return {
        kind: 'timeline',
        statedAt: new Date(from).toISOString(),
        ...(isDeadline ? { dueAt: new Date(to).toISOString() } : {}),
      }
    }

    /**
     * A measured move, with the review that predates it marked.
     *
     * Both halves are required: the move is the number and the review is what
     * makes it a finding rather than a quote.
     */
    case 'last_look': {
      const q = claim.quantity
      const iv = claim.interval
      if (!q || q.unit !== 'pct' || !iv?.from) return null
      return { kind: 'last_look', movePct: q.value, lastLookAt: iv.from }
    }

    /**
     * How much of the book rides on it, where the finding is about exposure.
     *
     * `unowned` is the case: the claim is that a position this size has nobody
     * answering for it, and the size is the argument. The resolver already
     * refuses this primitive without a weight, so this agrees rather than
     * re-deciding.
     */
    case 'exposure': {
      const weight = stakes.weightPct
      if (weight == null || !Number.isFinite(weight)) return null
      return { kind: 'exposure', weightPct: weight }
    }

    /**
     * The tape, the stage rail, somebody's words, and nothing.
     *
     * `price_trend` is drawn by the caller's own sparkline — the renderer takes
     * it as an injected node for exactly that reason, and rebuilding it here
     * would be a second implementation of a chart. The other three have no
     * structured source on a claim today; each is a seam rather than a gap to
     * fill with a guess.
     */
    case 'price_trend':
    case 'workflow':
    case 'comparison':
    case 'quote':
    case 'none':
      return null
  }
}

/**
 * The trailing sentence on a timeline, in the finding's own terms.
 *
 * The renderer defaults to "overdue", which is right for a missed commitment
 * and wrong for an elapsed silence. The words belong with the copy layer rather
 * than in the component, so they travel with the visual.
 */
export function timelineLabelFor(situation: Situation): string | undefined {
  if (situation.lead.claim.predicate !== 'unreviewed') return undefined
  return situation.question === 'coverage'
    ? 'since your last contribution'
    : 'since anybody last looked'
}
