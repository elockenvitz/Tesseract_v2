import { ChevronLeft } from 'lucide-react'
import { clsx } from 'clsx'
import { IdeaStancePills } from './IdeaStancePills'
import { IdeaEvolutionStrip } from './IdeaEvolutionStrip'
import { shortAge, type IdeaEvolution } from '../../../lib/signals/idea-evolution'
import { sameClaim, type IdeaShape } from '../../../lib/signals/idea-shape'

/**
 * Entering the idea, rather than enlarging its tile.
 *
 * ── The grammar, and why it is copied rather than shared ──────────────────
 *
 * Explore's detail shell settled the structure: a dedicated back header that is
 * separate from the content and owns the safe area, the status pill INSIDE the
 * body rather than in the header band, an injected visual the component never
 * fetches for itself, and short labelled facts under it.
 *
 * `ExploreDetail` is typed to `ExploreItem` and belongs to a parked lane. This
 * follows the same grammar with the idea's own content instead of generalising
 * that file — a small amount of structural duplication is the cheaper mistake
 * than reaching into another lane's component to add a second consumer, and the
 * behaviour worth sharing (`sliceWindow`, the anchored-caption rule) IS shared,
 * through `idea-performance`.
 *
 * ── What makes this deeper than the tile ──────────────────────────────────
 *
 * The tile answers "is this worth my attention". This answers "what is the
 * case, and is it still good": the full thesis rather than two clamped lines,
 * the sizing the author intended, the horizon, the conviction, who else is on
 * it, and the whole evolution rather than the top three lines of it. None of it
 * is invented — every block renders only when its field is present.
 */

function Fact({ label, value }: { label: string; value: React.ReactNode }) {
  if (value == null || value === '') return null
  return (
    <div className="min-w-0" data-detail-fact={label}>
      <div className="text-[10px] font-bold uppercase tracking-[0.06em] text-gray-400">{label}</div>
      <div className="mt-0.5 text-[14px] font-semibold text-gray-900 dark:text-white">{value}</div>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="border-t border-gray-100 px-5 py-4 dark:border-gray-800" data-detail-section={title}>
      <h3 className="text-[10px] font-bold uppercase tracking-[0.08em] text-gray-400">{title}</h3>
      <div className="mt-2">{children}</div>
    </section>
  )
}

export interface IdeaDetailProps {
  shape: IdeaShape
  headline: string
  symbol?: string | null
  companyName?: string | null
  /** The author's argument, in full. Never clamped here. */
  thesis?: string | null
  rationale?: string | null
  authorName?: string | null
  portfolioName?: string | null
  createdAt: string
  targetPrice?: number | null
  timeHorizon?: string | null
  conviction?: string | null
  proposedWeight?: number | null
  collaboratorCount?: number
  evolution: IdeaEvolution
  unchangedLine?: string | null
  /** The chart or ladder. Injected — this component never fetches. */
  visual?: React.ReactNode
  /** The response control, so a judgment can be made without going back. */
  respond?: React.ReactNode
  onBack: () => void
  onOpenAsset?: () => void
  now?: number
}

const HORIZON_TEXT: Record<string, string> = {
  short: 'Short', medium: 'Medium', long: 'Long',
}

export function IdeaDetail({
  shape, headline, symbol, companyName, thesis, rationale, authorName, portfolioName,
  createdAt, targetPrice, timeHorizon, conviction, proposedWeight, collaboratorCount = 0,
  evolution, unchangedLine, visual, respond, onBack, onOpenAsset, now = Date.now(),
}: IdeaDetailProps) {
  /**
   * The thesis where the author wrote one, the rationale otherwise — and both
   * only when they are genuinely different claims.
   *
   * `thesis_text` and `rationale` are separate columns that routinely hold the
   * same sentence, so an exact comparison printed the same paragraph twice.
   * `sameClaim` compares the claim rather than the bytes; see its header.
   */
  const body = (thesis || '').trim()
  const reason = (rationale || '').trim()
  const showBoth = !!body && !!reason && !sameClaim(body, reason)

  return (
    <div className="flex h-full min-h-0 flex-col bg-white dark:bg-gray-900" data-idea-detail={symbol ?? headline}>
      {/* The back header. Its own row, above the content, owning the safe area
          — never floating over the body, which is what made the Explore
          expansion read as an enlarged tile rather than a place. */}
      <div className="flex shrink-0 items-center gap-2 border-b border-gray-200 px-3 py-2 [padding-top:calc(0.5rem+env(safe-area-inset-top))] dark:border-gray-800">
        <button
          type="button"
          data-idea-detail-close
          onClick={onBack}
          className="flex h-9 items-center gap-1 rounded-full px-2 text-[13px] font-semibold text-gray-600 dark:text-gray-300"
        >
          <ChevronLeft className="h-4 w-4" />
          Ideas
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto pb-8">
        {/* Identity, inside the content. The pills live here rather than in the
            header band so the header stays a navigation bar and nothing else. */}
        <div className="px-5 pt-4">
          <IdeaStancePills stance={shape.stance} maturity={shape.maturity} />

          <h1 className="mt-2.5 text-[22px] font-bold leading-[1.2] tracking-[-0.01em] text-gray-900 dark:text-white">
            {headline}
          </h1>

          {symbol && (
            <button
              type="button"
              data-idea-detail-open-asset
              onClick={onOpenAsset}
              className="mt-1 text-[13px] font-semibold text-primary-600 dark:text-primary-400"
            >
              {symbol}
              {companyName ? ` · ${companyName}` : ''}
            </button>
          )}

          <IdeaEvolutionStrip
            evolution={evolution}
            unchangedLine={unchangedLine}
            now={now}
            className="mt-3"
          />
        </div>

        {/* The picture, at feature weight. One, chosen by family — the same
            archetype rule the tile follows. */}
        {visual && (
          <div className="mt-4 h-[190px] px-5" data-idea-detail-visual>
            {visual}
          </div>
        )}

        {/* The facts that fit on one line each. Absent fields render nothing
            rather than an em dash, because a grid of dashes reads as an
            outage. */}
        <div className="mt-4 grid grid-cols-3 gap-x-3 gap-y-4 px-5">
          <Fact
            label="Target"
            value={targetPrice != null ? `$${targetPrice >= 1000 ? targetPrice.toFixed(0) : targetPrice.toFixed(2)}` : null}
          />
          <Fact label="Horizon" value={timeHorizon ? HORIZON_TEXT[timeHorizon] ?? null : null} />
          <Fact
            label="Conviction"
            value={conviction ? conviction.charAt(0).toUpperCase() + conviction.slice(1) : null}
          />
          <Fact
            label="Intended size"
            value={proposedWeight != null ? `${proposedWeight.toFixed(1)}%` : null}
          />
          <Fact label="Raised" value={shortAge(createdAt, now)} />
          <Fact label="Book" value={portfolioName ?? null} />
        </div>

        {(body || reason) && (
          <Section title={showBoth ? 'The case' : 'Why'}>
            <p className="whitespace-pre-line text-[15px] leading-[1.55] text-gray-700 dark:text-gray-300">
              {body || reason}
            </p>
            {showBoth && (
              <p className="mt-3 whitespace-pre-line border-l-2 border-gray-200 pl-3 text-[14px] leading-[1.5] text-gray-500 dark:border-gray-700 dark:text-gray-400">
                {reason}
              </p>
            )}
          </Section>
        )}

        {(authorName || collaboratorCount > 0) && (
          <Section title="Who is on it">
            <p className="text-[14px] text-gray-700 dark:text-gray-300">
              {authorName ?? 'Unattributed'}
              {collaboratorCount > 0 && (
                <span className="text-gray-500 dark:text-gray-400">
                  {' '}· {collaboratorCount} {collaboratorCount === 1 ? 'co-analyst' : 'co-analysts'}
                </span>
              )}
            </p>
          </Section>
        )}

        {/* Everything the record can prove about how the idea has moved — the
            whole list here, where the tile showed at most three. */}
        {(evolution.lines.length > 0 || unchangedLine) && (
          <Section title="How it has changed">
            <IdeaEvolutionStrip
              evolution={evolution}
              unchangedLine={unchangedLine}
              now={now}
              className="flex-col !items-start gap-y-2"
            />
            <p className="mt-3 text-[12px] leading-snug text-gray-400">
              What changed and when, from the audit record. Previous values are not stored, so
              before-and-after figures are not shown.
            </p>
          </Section>
        )}

        {respond && (
          <Section title="Your view">
            <div className={clsx('rounded-xl')}>{respond}</div>
          </Section>
        )}
      </div>
    </div>
  )
}
