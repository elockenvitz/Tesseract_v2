import { clsx } from 'clsx'
import { ArrowRight, User } from 'lucide-react'

import type { NextAction, WorkbenchIdea } from '../../../lib/ideas/workbench'

/**
 * The right-hand workspace for the selected idea.
 *
 * ── Why this is a pane and not a page ─────────────────────────────────────
 *
 * The brief's requirement: scan several ideas, click one, understand it, act —
 * without navigating. Every navigation costs the reader their place in the
 * ranked list and their memory of what they were comparing it against. So
 * selection changes this pane and nothing else; the queue keeps its scroll and
 * its selection.
 *
 * ── Progressive, not padded ───────────────────────────────────────────────
 *
 * Sections render only when the idea has the material. A trade-idea row from
 * `useIdeasFeed` carries a stance, a rationale, an author, a status, a
 * portfolio and a current price — and nothing else. Targets, scenario ladders,
 * research recency and process state arrive as EVIDENCE, attached by
 * `buildWorkbench` from the lens, card and process candidates about the same
 * name. An idea with no evidence renders a shorter workspace, which is the
 * truth about it, rather than six empty headings.
 */

const STANCE: Record<WorkbenchIdea['stance'], { label: string; className: string }> = {
  buy: { label: 'BUY', className: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300' },
  sell: { label: 'SELL', className: 'bg-rose-50 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300' },
  watch: { label: 'WATCH', className: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300' },
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="border-t border-gray-100 px-6 py-4 dark:border-gray-800">
      <h3 className="text-[10px] font-bold uppercase tracking-wide text-gray-400">{title}</h3>
      <div className="mt-2">{children}</div>
    </section>
  )
}

interface IdeaWorkspaceProps {
  idea: WorkbenchIdea | null
  /** The larger price chart, injected. Absent where the name has no history. */
  chart?: React.ReactNode
  /**
   * Carries out a next action. The workspace routes; it never mutates.
   * Returning false lets the pane say so rather than appear to have worked.
   */
  onAct?: (action: NextAction, idea: WorkbenchIdea) => void
  onOpenAsset?: (symbol: string) => void
}

export function IdeaWorkspace({ idea, chart, onAct, onOpenAsset }: IdeaWorkspaceProps) {
  if (!idea) {
    return (
      <div className="flex h-full items-center justify-center px-8" data-workbench-empty>
        <p className="max-w-[34ch] text-center text-[13px] leading-[1.5] text-gray-400">
          Select an idea to see why it surfaced, what the market has done, and what to do next.
        </p>
      </div>
    )
  }

  const stance = STANCE[idea.stance]
  const price = idea.currentPrice != null && Number.isFinite(idea.currentPrice)
    ? `$${idea.currentPrice >= 100 ? idea.currentPrice.toFixed(0) : idea.currentPrice.toFixed(2)}`
    : null

  return (
    <div className="flex h-full min-h-0 flex-col" data-workbench-workspace={idea.id}>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {/* ── Header ───────────────────────────────────────────────────── */}
        <header className="px-6 pt-5">
          <div className="flex min-w-0 items-center gap-2">
            <h2 className="shrink-0 text-[20px] font-bold tracking-tight text-gray-900 dark:text-white">
              {idea.symbol ?? 'Idea'}
            </h2>
            <span className={clsx('shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold tracking-wide', stance.className)}>
              {stance.label}
            </span>
            {price && (
              <span className="ml-auto shrink-0 text-[18px] font-bold tabular-nums text-gray-900 dark:text-white">
                {price}
              </span>
            )}
          </div>
          <div className="mt-1 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-gray-400">
            {idea.companyName && <span className="truncate">{idea.companyName}</span>}
            {idea.author && <span className="flex items-center gap-1"><User className="h-3 w-3" />{idea.author}</span>}
            {idea.portfolioName && <span>{idea.portfolioName}</span>}
            {idea.status && <span className="uppercase tracking-wide">{idea.status}</span>}
          </div>
        </header>

        {/* ── Next action, at the top because it is the point ──────────────
            The brief's most important requirement: make the next best action
            obvious. Above the thesis deliberately — a reader who already knows
            the name needs the verb, not the argument. */}
        {idea.next && (
          <div className="mx-6 mt-4 rounded-lg border border-primary-200 bg-primary-50/60 p-3 dark:border-primary-900 dark:bg-primary-900/20">
            <p className="text-[10px] font-bold uppercase tracking-wide text-primary-700 dark:text-primary-300">Next</p>
            <p className="mt-1 text-[13px] leading-[1.45] text-gray-700 dark:text-gray-200">{idea.next.because}</p>
            <button
              type="button"
              data-workbench-next={idea.next.route}
              onClick={() => onAct?.(idea.next!, idea)}
              className="mt-2 inline-flex items-center gap-1.5 rounded-lg bg-primary-600 px-3 py-2 text-[13px] font-semibold text-white hover:bg-primary-700"
            >
              {idea.next.label} <ArrowRight className="h-3.5 w-3.5" />
            </button>
          </div>
        )}

        {idea.thesis && (
          <Section title="Thesis">
            <p className="whitespace-pre-line text-[14px] leading-[1.6] text-gray-700 dark:text-gray-200">
              {idea.thesis}
            </p>
          </Section>
        )}

        {chart && (
          <Section title="Market context">
            <div data-workbench-chart>{chart}</div>
          </Section>
        )}

        {/* ── Why now: every finding attached to this idea ─────────────────
            The inversion made visible. These are the candidates the ranker
            raised; here they are reasons rather than rows. */}
        {idea.evidence.length > 0 && (
          <Section title="Why now">
            <ul className="space-y-2.5" data-workbench-evidence>
              {idea.evidence.map(e => (
                <li key={e.id} className="border-l-2 border-amber-400 pl-3">
                  <p className="text-[13px] font-semibold leading-[1.4] text-gray-800 dark:text-gray-100">
                    {e.headline}
                  </p>
                  {e.why && (
                    <p className="mt-0.5 text-[12px] leading-[1.45] text-gray-500 dark:text-gray-400">{e.why}</p>
                  )}
                </li>
              ))}
            </ul>
          </Section>
        )}

        {idea.evidence.length === 0 && (
          <Section title="Why now">
            <p className="text-[13px] text-gray-400">
              Nothing has changed on this name. It is here on its own merits.
            </p>
          </Section>
        )}
      </div>

      {/* ── The one route out, pinned ───────────────────────────────────── */}
      {idea.symbol && (
        <div className="shrink-0 border-t border-gray-100 px-6 py-3 dark:border-gray-800">
          <button
            type="button"
            data-workbench-open-asset
            onClick={() => onOpenAsset?.(idea.symbol!)}
            className="text-[13px] font-semibold text-primary-700 hover:underline dark:text-primary-300"
          >
            Open {idea.symbol}
          </button>
        </div>
      )}
    </div>
  )
}
