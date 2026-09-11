import { headlineIsThePost, type IdeaInput } from '../../lib/signals/builders/ideas'

/**
 * The contextual panes for an idea card, built once for every shell.
 *
 * ── The gap this closes ───────────────────────────────────────────────────
 *
 * `SignalCardView` takes `card`, and it also takes `evidence`, `detail` and
 * `panes`. The card is the claim; the panes are the things a reader can turn
 * over — the sizing bars, the case, the ladder, the chart. That is the whole
 * difference between a feed that feels alive and a list of flat text, and it
 * is a difference in what the CALLER passes, not in the renderer.
 *
 * Mobile passes all four. The desktop Explore feed passed `card` and
 * `onAction` and nothing else, so every desktop tile rendered as the typographic
 * half of a card whose interactive half was never constructed. The renderer was
 * never the problem, and neither were the visuals: `PRIMITIVE_COMPONENTS` maps
 * every plan primitive to a component in `src/components/signals`, which is
 * shared ground, not a mobile directory.
 *
 * What was NOT shared is this — the assembly. Mobile builds its pane arrays
 * inline at four call sites inside an 8,900-line component, so a second shell
 * could reach the primitives but not the composition. This is that composition,
 * extracted to where both shells can call it.
 *
 * ── Scope ─────────────────────────────────────────────────────────────────
 *
 * The idea family only — the posts the feed actually returns. The
 * machine-derived families build their panes from their own builder inputs
 * (recommendation sizing, scenario ladders, active-risk peers) and are not
 * reachable from the feed on desktop yet. Adding them here is the same shape
 * of work and is deliberately not guessed at now.
 *
 * Mobile is not switched onto this in this pass. That is a mobile change, and
 * the instruction was zero behavioural change there.
 */

export interface IdeaPane {
  id: string
  label: string
  content: React.ReactNode
}

/**
 * The written case.
 *
 * `thesis` is the longer argument where one exists; `rationale` is the single
 * claim. The card headline already carries the claim, so a pane that repeated
 * it would be a second copy of the same sentence — hence the longer text only.
 */
function casePane(input: IdeaInput): IdeaPane | null {
  /*
   * Only where the author wrote a TITLE.
   *
   * `headlineIsThePost` is true for every kind whose author wrote no title —
   * there the body already IS the headline, and a pane repeating it would put
   * the same sentence on the card twice, about 60px apart. The builder solved
   * that once for the card body; this is the same rule applied to the pane.
   */
  if (headlineIsThePost(input)) return null
  const text = input.content?.trim()
  if (!text) return null
  return {
    id: 'case',
    label: 'The case',
    content: (
      <div className="text-sm leading-relaxed text-gray-600 dark:text-gray-300">
        {input.authorName && (
          <p className="mb-2 text-[10px] font-bold uppercase tracking-wide text-gray-400">
            {input.authorName}’s case
          </p>
        )}
        {/* Clamped, because a pane is a box. The full text is one open away. */}
        <p className="line-clamp-6">{text}</p>
      </div>
    ),
  }
}

/**
 * What the author committed to, beyond the direction.
 *
 * One pane rather than three, because target, conviction and horizon are read
 * together — "$310, high conviction, long horizon" is one claim about how
 * strongly and by when, and splitting it into three panes would make the
 * reader swipe to assemble a sentence.
 */
function commitmentPane(input: IdeaInput): IdeaPane | null {
  const rows: { label: string; value: string }[] = []
  if (input.targetPrice != null && Number.isFinite(input.targetPrice)) {
    rows.push({ label: 'Target', value: `$${Number(input.targetPrice).toFixed(2)}` })
  }
  if (input.conviction) rows.push({ label: 'Conviction', value: String(input.conviction) })
  if (input.timeHorizon) rows.push({ label: 'Horizon', value: `${input.timeHorizon} term` })
  if (!rows.length) return null
  return {
    id: 'commitment',
    label: 'The claim',
    content: (
      <dl className="grid grid-cols-3 gap-4">
        {rows.map(r => (
          <div key={r.label}>
            <dt className="text-[10px] font-bold uppercase tracking-wide text-gray-400">{r.label}</dt>
            <dd className="mt-0.5 text-sm font-semibold capitalize text-gray-900 dark:text-white">{r.value}</dd>
          </div>
        ))}
      </dl>
    ),
  }
}

/**
 * Every pane this idea can support, in reading order.
 *
 * Order is the argument's order: what was claimed, then why. An empty array is
 * correct and common — a thought with no target and no separate body has
 * nothing to turn over, and `SignalCardView` renders it as the typography it
 * is rather than drawing an empty carousel.
 *
 * Deliberately no sizing pane. `IdeaInput` carries no proposed weight, and a
 * bar drawn from a number nobody wrote is worse than no bar.
 */
export function ideaPanes(input: IdeaInput): IdeaPane[] {
  return [commitmentPane(input), casePane(input)]
    .filter((p): p is IdeaPane => p !== null)
}
