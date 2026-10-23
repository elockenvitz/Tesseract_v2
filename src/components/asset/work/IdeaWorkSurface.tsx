/**
 * One idea, as a working surface.
 *
 * ── Why this is not just `DecisionModule` ───────────────────────────────
 *
 * `DecisionModule` is the PM's half: accept, defer, reject, per portfolio
 * track. Mounting it alone would present an approval form as though it were
 * the whole life of an idea, which would be wrong in a specific and damaging
 * way — the analyst who wrote the thing would find no way to change it, and
 * a surface that offers only approval quietly says approval is all there is.
 *
 * So the surface has two named halves:
 *
 *   ANALYST   the rationale as written, its stage and book, and the way back
 *             into the real editor.
 *   DECISION  `DecisionModule`, unchanged, which owns the decision and its
 *             authorization.
 *
 * ── The editor is a handoff, not an embed ───────────────────────────────
 *
 * Idea authoring lives in `TradeIdeaDetailModal`, reached by the existing
 * `openIdeaDetail(tradeQueueItemId)` — a two-event dance that `QuickTradeIdeaCapture`
 * and `LinkedObjectsPanel` already use, and which `lib/navigation/open-idea`
 * exists to stop a third caller re-deriving. Re-implementing idea editing
 * here would be rebuilding the Ideas application, which this slice must not
 * do. Naming the handoff honestly is the alternative.
 */
import { ExternalLink, PencilLine } from 'lucide-react'
import { clsx } from 'clsx'
import { DecisionModule } from '../../ideas-v2/DecisionModule'
import { openIdeaDetail } from '../../../lib/navigation/open-idea'
import { stageLabel, stageColor } from '../../../lib/ideas/stage-model'

export interface IdeaWorkSurfaceIdea {
  id: string
  action?: string | null
  /** Raw stored stage; normalized for display, never rendered raw. */
  stage?: string | null
  rationale?: string | null
  portfolioName?: string | null
  creatorName?: string | null
  updatedAgo?: string | null
}

export interface IdeaWorkSurfaceProps {
  idea: IdeaWorkSurfaceIdea
  assetId: string
  className?: string
  /**
   * A control for the identity row — the sidebar expand button, while the
   * sidebar is collapsed. It rides this header rather than a reserved row
   * above the surface, which is what it used to have.
   */
  headerAction?: React.ReactNode
}

export function IdeaWorkSurface({ idea, assetId, className, headerAction }: IdeaWorkSurfaceProps) {
  return (
    <div className={clsx('space-y-5', className)} data-testid="idea-work-surface">
      {/* ── Identity ─────────────────────────────────────────────────── */}
      <div>
        <div className="flex flex-wrap items-center gap-2">
          {headerAction}
          {idea.action && (
            <span className="rounded bg-gray-900 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white dark:bg-gray-100 dark:text-gray-900">
              {idea.action}
            </span>
          )}
          {idea.stage && (
            <span className={clsx(
              'rounded-full px-2 py-0.5 text-[10px] font-semibold ring-1 ring-inset',
              stageColor(idea.stage),
            )}>
              {stageLabel(idea.stage)}
            </span>
          )}
          <span className="text-[11px] text-gray-500 dark:text-gray-400">
            {[idea.portfolioName, idea.creatorName, idea.updatedAgo].filter(Boolean).join(' · ')}
          </span>
        </div>
      </div>

      {/* ── Analyst half ─────────────────────────────────────────────── */}
      <section data-testid="idea-analyst">
        <h4 className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-gray-400">
          Analyst
        </h4>
        {/*
          The rationale at a readable measure, not stretched across the
          surface. A paragraph set to 1,800px is a paragraph nobody finishes.
        */}
        <p className="max-w-[68ch] whitespace-pre-wrap text-[13px] leading-relaxed text-gray-800 dark:text-gray-200">
          {idea.rationale?.trim() || <span className="text-gray-400">No rationale written.</span>}
        </p>
        <button
          type="button"
          data-testid="idea-open-editor"
          onClick={() => openIdeaDetail(idea.id)}
          className="mt-2 inline-flex items-center gap-1 rounded border border-gray-200 px-2 py-1 text-[11px] font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-200 dark:hover:bg-gray-800"
        >
          <PencilLine className="h-3 w-3" aria-hidden="true" />
          Edit in the idea pipeline
          <ExternalLink className="h-3 w-3 text-gray-400" aria-hidden="true" />
        </button>
      </section>

      {/* ── Decision half ────────────────────────────────────────────── */}
      <section data-testid="idea-decision">
        <h4 className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-gray-400">
          Decision
        </h4>
        {/*
          Unchanged, and it owns this half entirely: which portfolio tracks
          exist, which are awaiting an answer, whether there is anything to
          decide at all, and what to do when there is not. Second-guessing
          any of that here would put two answers to one authorization
          question on one screen.
        */}
        <DecisionModule ideaId={idea.id} assetId={assetId} />
      </section>
    </div>
  )
}
