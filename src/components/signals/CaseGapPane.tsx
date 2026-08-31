/**
 * What the product actually knows about a name with no written case.
 *
 * ── Why this pane exists instead of a chart ───────────────────────────────
 *
 * A no-case card has price history about as often as any other name, and
 * drawing it would be the wrong answer twice over: it would imply the price is
 * the finding, sending the reader to look for an event that is not there, and
 * it would fill the pane the card most needs — the one that says why an empty
 * case matters for THIS name rather than in general.
 *
 * So the facts, in the order that decides whether to act: who is supposed to
 * cover it, whether the book is exposed to it, whether anyone is proposing a
 * trade on it, and whether there is loose material sitting around that never
 * became a case.
 *
 * ── Every line is conditional ─────────────────────────────────────────────
 *
 * Nothing here has a placeholder. An unheld name shows no exposure row rather
 * than "0.0%", an uncovered one shows no owner row rather than "Unassigned",
 * and a name with no loose notes shows no evidence row. A pane of "none" and
 * "n/a" reads as a form the product failed to fill in; a shorter pane reads as
 * the truth. That is the same rule `PortfolioRef` states for weights, applied
 * to a whole pane.
 */

interface CaseGapPaneProps {
  symbol: string
  coverageOwners: string[]
  held: boolean
  portfolioName: string | null
  portfolioCount: number
  /** Current-snapshot weight. Null is never rendered as a zero. */
  weightPct: number | null
  liveIdeas: { id: string; action: string | null }[]
  /** Loose notes and thoughts filed against the name, case or no case. */
  evidenceCount: number
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <li className="flex items-baseline justify-between gap-3">
      <span className="shrink-0 text-[11px] uppercase tracking-wide text-gray-400 dark:text-gray-500">
        {label}
      </span>
      <span className="text-right text-[13px] font-medium text-gray-800 dark:text-gray-100">
        {value}
      </span>
    </li>
  )
}

export function CaseGapPane({
  symbol, coverageOwners, held, portfolioName, portfolioCount, weightPct, liveIdeas, evidenceCount,
}: CaseGapPaneProps) {
  const exposure = !held
    ? null
    : weightPct != null && Number.isFinite(weightPct)
      // The weight belongs to the current snapshot or it is not shown at all.
      ? `${weightPct.toFixed(1)}%${portfolioName ? ` · ${portfolioName}` : ''}`
      : portfolioName
        // Held with no weight recorded, which is 26 of 36 current positions in
        // production. Naming the book is true; inventing a number is not.
        ? `Held in ${portfolioName}`
        : 'Held'

  const ideas = liveIdeas.length === 0
    ? null
    : liveIdeas.length === 1 && liveIdeas[0].action
      ? liveIdeas[0].action.toUpperCase()
      // Several live ideas: the count, never one picked arbitrarily.
      : `${liveIdeas.length} live`

  const rows = [
    coverageOwners.length ? { label: 'Covered by', value: coverageOwners.join(', ') } : null,
    exposure ? { label: 'Exposure', value: exposure } : null,
    portfolioCount > 1 ? { label: 'Books', value: String(portfolioCount) } : null,
    ideas ? { label: 'Live idea', value: ideas } : null,
    evidenceCount > 0
      ? { label: 'Loose material', value: `${evidenceCount} note${evidenceCount === 1 ? '' : 's'}` }
      : null,
  ].filter((r): r is { label: string; value: string } => r != null)

  return (
    <div className="flex h-full flex-col justify-center" data-slot="case-gap-pane">
      <p className="text-[11px] font-medium uppercase tracking-wide text-gray-400 dark:text-gray-500">
        What we know
      </p>

      {rows.length ? (
        <ul className="mt-2 space-y-1.5">
          {rows.map(r => <Row key={r.label} {...r} />)}
        </ul>
      ) : (
        /**
         * The genuinely empty case, said plainly.
         *
         * An asset in the research universe with no coverage, no position, no
         * idea and no loose material is a real state — several unheld covered
         * names are close to it — and the honest response is a sentence, not a
         * table of dashes.
         */
        <p className="mt-2 text-[13px] leading-snug text-gray-600 dark:text-gray-300">
          {symbol} is in the research universe and nothing else is recorded against it.
        </p>
      )}
    </div>
  )
}
