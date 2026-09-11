import { ScenarioLadder } from './ScenarioLadder'
import type { SignalCard } from '../../lib/signals/contract'

/**
 * A card's declared evidence, rendered from shared primitives.
 *
 * ── Why the caller has to do this at all ──────────────────────────────────
 *
 * `SignalCardView` takes `evidence` as a React node, deliberately: the card
 * component "never imports a chart". So the builder DECLARES the evidence —
 * kind, data, annotations — and the host renders it. Mobile does that inline
 * at its call sites; desktop passed nothing, which is why its tiles had no
 * contextual object at all.
 *
 * This is that step, done once, from the card's own declaration. It invents
 * nothing: the kind and the data both come from the builder, and each branch
 * maps to a primitive that already exists in this directory.
 *
 * ── What it refuses to do ─────────────────────────────────────────────────
 *
 * Return something for every kind. Two of the declared kinds cannot be drawn
 * from what the card carries, and a placeholder in their place would be the
 * invented-pane mistake again:
 *
 *   sparkline   data is `{ target }` or `{ symbol }` — a reference, not a
 *               series. Drawing a line needs price history, which this shell
 *               has no producer for. Reported, not faked.
 *   peer_bar    data is `{ books: n }` — one number, which the card's own
 *               metric already prints. A bar chart of a single count is
 *               decoration.
 *
 * Both return null, and `SignalCardView` then renders the card as the
 * typography it is, which is correct rather than a gap.
 */
export function CardEvidenceView({ card }: { card: SignalCard }) {
  const evidence = card.evidence
  if (!evidence || evidence.kind === 'none') return null

  if (evidence.kind === 'scenario_ladder') {
    /*
     * The one chart that carries the argument rather than decorating it — the
     * builder's own words. `data` is already the ladder's props, because the
     * builder shapes it for exactly this composer.
     */
    const d = evidence.data as {
      price?: number
      cases?: unknown[]
      expected?: unknown
      statedOn?: string | null
    } | null
    if (!d || !Array.isArray(d.cases) || d.cases.length === 0) return null
    return (
      <ScenarioLadder
        price={d.price as never}
        cases={d.cases as never}
        expected={d.expected as never}
        statedOn={d.statedOn as never}
      />
    )
  }

  return null
}

/**
 * Whether this card has evidence this shell can actually draw.
 *
 * Used to decide layout before rendering, so a tile does not reserve a region
 * for a visual that will return null.
 */
export function hasDrawableEvidence(card: SignalCard): boolean {
  const e = card.evidence
  if (!e || e.kind !== 'scenario_ladder') return false
  const d = e.data as { cases?: unknown[] } | null
  return !!d && Array.isArray(d.cases) && d.cases.length > 0
}
