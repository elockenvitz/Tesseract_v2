import { clsx } from 'clsx'
import { shortAge, type IdeaEvolution } from '../../../lib/signals/idea-evolution'

/**
 * "Since you last looked" — as far as the record can actually prove it.
 *
 * ── Why there are no arrows in here ───────────────────────────────────────
 *
 * "Target $120 → $135" is the line everybody wants and the audit log cannot
 * support it: `updateTradeIdea` writes `changed_fields` accurately and writes
 * `state.from` as `{ rationale }` only, so every other field has an after and
 * no before. See `lib/signals/idea-evolution` for why chaining events to
 * synthesise one is worse than not having it.
 *
 * So this says what moved and when. A reader who wants the old number opens the
 * idea, which is a real answer; a card that makes one up is not.
 *
 * ── Why it is a strip and not a section ───────────────────────────────────
 *
 * Most ideas have never been revised, and a heading with nothing under it on
 * three cards out of four teaches people to skip the region. Nothing renders
 * when there is nothing to say.
 */

interface IdeaEvolutionStripProps {
  evolution: IdeaEvolution
  /**
   * The one line that needs a negative to be worth saying — see
   * `unchangedThesisLine`. Passed in rather than derived here because it needs
   * the anchored return, which is the chart's business, not the strip's.
   */
  unchangedLine?: string | null
  now?: number
  className?: string
}

const KIND_DOT = {
  thesis: 'bg-violet-500',
  framework: 'bg-amber-500',
  stage: 'bg-sky-500',
  sizing: 'bg-gray-400',
} as const

export function IdeaEvolutionStrip({
  evolution, unchangedLine, now = Date.now(), className,
}: IdeaEvolutionStripProps) {
  const hasLines = evolution.lines.length > 0
  if (!hasLines && !unchangedLine) return null

  return (
    <div className={clsx('flex flex-wrap items-center gap-x-3 gap-y-1', className)} data-idea-evolution>
      {/* The divergence line leads when it exists: "the market moved and we did
          not" is a bigger fact than any single field edit. */}
      {unchangedLine && (
        <span
          data-evolution-unchanged
          className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-gray-700 dark:text-gray-200"
        >
          <span className="h-1.5 w-1.5 rounded-full bg-gray-900 dark:bg-white" />
          {unchangedLine}
        </span>
      )}
      {evolution.lines.map(line => {
        const age = shortAge(line.at, now)
        return (
          <span
            key={line.label}
            data-evolution-line={line.kind}
            className="inline-flex items-center gap-1.5 text-[12px] text-gray-500 dark:text-gray-400"
          >
            <span className={clsx('h-1.5 w-1.5 rounded-full', KIND_DOT[line.kind])} />
            {line.label}
            {age && <span className="text-gray-400 dark:text-gray-500">· {age}</span>}
          </span>
        )
      })}
    </div>
  )
}
