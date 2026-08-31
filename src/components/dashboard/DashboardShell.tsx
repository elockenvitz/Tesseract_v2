/**
 * The Dashboard — one experience, five lenses.
 *
 * ── What the Dashboard is ────────────────────────────────────────────────
 *
 * A visual command centre and a jumping-off point. It shows what deserves
 * attention and helps move that specific issue forward. It is not another
 * Asset page, not another Research application, not a second Portfolio tool
 * and not an alert table. The deep product surfaces remain the work system;
 * this sits above them and hands off to them explicitly.
 *
 * ── Why one shell ────────────────────────────────────────────────────────
 *
 * Today, Ideas, Research, Portfolio and Decisions were five entries in the app
 * launcher, each opening its own tab. That reads as five applications. They are
 * five questions about ONE investment process:
 *
 *   Today       what should I do?
 *   Ideas       what do we believe?
 *   Research    where does the case need work?
 *   Portfolio   where does capital or framework need attention?
 *   Decisions   what did we decide, and what happened?
 *
 * ── One shell is not one layout ──────────────────────────────────────────
 *
 * The lenses share page geometry, typography, tile primitives, interaction
 * grammar and semantic colour. They do NOT share composition: Today is finite
 * and editorial, Portfolio leads with a book map, Decisions is chronological,
 * Ideas and Research are ranked fields. A single card grid with different
 * filter values would throw away everything each lens knows.
 *
 * ── Saved sessions ───────────────────────────────────────────────────────
 *
 * The `ideas-v2` / `research-v2` / `portfolio-v2` / `decisions-v2` tab types
 * still exist and still render -- they now mount this shell on the matching
 * lens, so a session saved last week opens exactly where it left off and
 * simply gains the lens bar. Nothing is migrated and nothing is deleted; the
 * irreversible collapse is a later, separate decision.
 */

import { useEffect, useState } from 'react'
import { clsx } from 'clsx'
import { Sun, Lightbulb, Microscope, Scale, Landmark } from 'lucide-react'
import { TodayPage } from '../today/TodayPage'
import { IdeasWorkspace } from '../ideas-v2/IdeasWorkspace'
import { ResearchWorkspace } from '../research-v2/ResearchWorkspace'
import { PortfolioWorkspace } from '../portfolio-v2/PortfolioWorkspace'
import { DecisionsWorkspace } from '../decisions-v2/DecisionsWorkspace'
import {
  subscribeToDashboardFocus, type DashboardFocusTarget,
} from '../../lib/dashboard/focus'

export type DashboardLens = 'today' | 'ideas' | 'research' | 'portfolio' | 'decisions'

/**
 * The question each lens answers, in the user's words.
 *
 * Shown under the lens bar rather than as a tooltip: the point of naming the
 * question is that a reader can see WHY the five are siblings, and a tooltip
 * is invisible to someone deciding which one to click.
 */
const LENS: { id: DashboardLens; label: string; icon: React.ElementType; question: string }[] = [
  { id: 'today', label: 'Today', icon: Sun, question: 'What should I do?' },
  { id: 'ideas', label: 'Ideas', icon: Lightbulb, question: 'What do we believe?' },
  { id: 'research', label: 'Research', icon: Microscope, question: 'Where does the case need work?' },
  { id: 'portfolio', label: 'Portfolio', icon: Scale, question: 'Where does capital or framework need attention?' },
  { id: 'decisions', label: 'Decisions', icon: Landmark, question: 'What did we decide, and what happened?' },
]

export interface DashboardShellProps {
  /** Which lens to open on. A saved v2 tab supplies its own. */
  initialLens?: DashboardLens
  /** Selection carried in tab data, so a typed arrival lands inside a lens. */
  selectedIdeaId?: string | null
  selectedAssetId?: string | null
  selectedPortfolioId?: string | null
  selectedDecisionId?: string | null
  focus?: string | null
  issue?: string | null
  origin?: string | null
}

export function DashboardShell({
  initialLens = 'today',
  selectedIdeaId, selectedAssetId, selectedPortfolioId, selectedDecisionId,
  focus, issue, origin,
}: DashboardShellProps = {}) {
  const [lens, setLens] = useState<DashboardLens>(initialLens)

  /**
   * Focus Mode, in this tab.
   *
   * A Dashboard action does not navigate. It names an issue, and the shell
   * switches to the lens that owns it and hands that lens the selection --
   * which the lens already knows how to open, because a tile click inside it
   * does the same thing. Today's "Review thesis" used to build a tab
   * descriptor instead, which is how a Dashboard action ended up leaving the
   * Dashboard.
   *
   * Held as one target rather than per-lens selection state so that switching
   * lens by hand clears it: choosing Portfolio from the lens bar is a decision
   * to browse, not a request to keep reading somebody else's issue.
   */
  const [focusTarget, setFocusTarget] = useState<DashboardFocusTarget | null>(null)

  useEffect(() => subscribeToDashboardFocus(t => {
    setLens(t.lens)
    setFocusTarget(t)
  }), [])

  const chooseLens = (id: DashboardLens) => {
    setLens(id)
    setFocusTarget(null)
  }

  // A focus target wins over the tab's own arrival data: it is the more recent
  // statement of what the reader asked for.
  const inFocus = (l: DashboardLens) => (focusTarget?.lens === l ? focusTarget : null)
  const focusedAsset = inFocus('research')?.objectId ?? inFocus('portfolio')?.objectId ?? null

  return (
    <div className="flex h-full flex-col overflow-hidden bg-gray-50/60 dark:bg-[#0b0f16]">
      <nav
        data-testid="dashboard-lenses"
        aria-label="Dashboard lenses"
        className="shrink-0 border-b border-gray-200 bg-white px-6 pt-3 dark:border-white/10 dark:bg-[#141a25]"
      >
        <div className="flex flex-wrap items-center gap-1">
          {LENS.map(l => {
            const active = l.id === lens
            return (
              <button
                key={l.id}
                type="button"
                aria-current={active ? 'page' : undefined}
                data-lens={l.id}
                onClick={() => chooseLens(l.id)}
                className={clsx(
                  'inline-flex items-center gap-1.5 rounded-t-lg px-3 py-2 text-[13px] font-medium transition-colors',
                  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-blue-600',
                  active
                    ? 'bg-gray-50 text-gray-900 shadow-[inset_0_-2px_0_0] shadow-blue-600 dark:bg-white/[0.06] dark:text-gray-100'
                    : 'text-gray-500 hover:bg-gray-100 hover:text-gray-800 dark:hover:bg-white/[0.05] dark:hover:text-gray-200',
                )}
              >
                <l.icon className="h-4 w-4" />
                {l.label}
              </button>
            )
          })}
          {/* One quiet line, not a second heading: it explains why the five
              are siblings, and then gets out of the way. */}
          <span className="ml-3 hidden text-[11px] text-gray-400 xl:inline dark:text-gray-500">
            {LENS.find(l => l.id === lens)?.question}
          </span>
        </div>
      </nav>

      {/*
        One lens mounts at a time.
        Keeping the others alive would run four scans against production to
        render one, and the lenses each hold their own selection state -- a
        hidden Portfolio lens quietly holding a stale book is worse than a
        remount that reads a cached query.
      */}
      <div
        className="min-h-0 flex-1 overflow-hidden"
        data-testid="dashboard-lens-body"
        data-lens={lens}
        data-focus={focusedAsset ?? focusTarget?.objectId ?? undefined}
      >
        {lens === 'today' && <TodayPage />}
        {lens === 'ideas' && (
          <IdeasWorkspace
            selectedIdeaId={inFocus('ideas')?.objectId ?? selectedIdeaId ?? null}
            focus={(focus as any) ?? null}
            issue={inFocus('ideas')?.issue ?? issue ?? null}
          />
        )}
        {lens === 'research' && (
          <ResearchWorkspace
            selectedAssetId={inFocus('research')?.objectId ?? selectedAssetId ?? null}
            issue={inFocus('research')?.issue ?? issue ?? null}
            origin={inFocus('research')?.origin ?? origin ?? null}
          />
        )}
        {lens === 'portfolio' && (
          <PortfolioWorkspace
            selectedPortfolioId={inFocus('portfolio')?.portfolioId ?? selectedPortfolioId ?? null}
            selectedAssetId={inFocus('portfolio')?.objectId ?? selectedAssetId ?? null}
          />
        )}
        {lens === 'decisions' && (
          <DecisionsWorkspace
            selectedPortfolioId={inFocus('decisions')?.portfolioId ?? selectedPortfolioId ?? null}
            selectedDecisionId={inFocus('decisions')?.objectId ?? selectedDecisionId ?? null}
          />
        )}
      </div>
    </div>
  )
}

/** Which lens a legacy v2 tab type belongs to. */
export const LENS_FOR_TAB: Record<string, DashboardLens> = {
  today: 'today',
  'ideas-v2': 'ideas',
  'research-v2': 'research',
  'portfolio-v2': 'portfolio',
  'decisions-v2': 'decisions',
}
