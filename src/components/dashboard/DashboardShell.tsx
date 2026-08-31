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

import { useState } from 'react'
import { clsx } from 'clsx'
import { Sun, Lightbulb, Microscope, Scale, Landmark } from 'lucide-react'
import { TodayPage } from '../today/TodayPage'
import { IdeasWorkspace } from '../ideas-v2/IdeasWorkspace'
import { ResearchWorkspace } from '../research-v2/ResearchWorkspace'
import { PortfolioWorkspace } from '../portfolio-v2/PortfolioWorkspace'
import { DecisionsWorkspace } from '../decisions-v2/DecisionsWorkspace'

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
                onClick={() => setLens(l.id)}
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
          <span className="ml-3 hidden text-[11.5px] text-gray-500 lg:inline">
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
      <div className="min-h-0 flex-1 overflow-hidden" data-testid="dashboard-lens-body" data-lens={lens}>
        {lens === 'today' && <TodayPage />}
        {lens === 'ideas' && (
          <IdeasWorkspace
            selectedIdeaId={selectedIdeaId ?? null}
            focus={(focus as any) ?? null}
            issue={issue ?? null}
          />
        )}
        {lens === 'research' && (
          <ResearchWorkspace
            selectedAssetId={selectedAssetId ?? null}
            issue={issue ?? null}
            origin={origin ?? null}
          />
        )}
        {lens === 'portfolio' && (
          <PortfolioWorkspace
            selectedPortfolioId={selectedPortfolioId ?? null}
            selectedAssetId={selectedAssetId ?? null}
          />
        )}
        {lens === 'decisions' && (
          <DecisionsWorkspace
            selectedPortfolioId={selectedPortfolioId ?? null}
            selectedDecisionId={selectedDecisionId ?? null}
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
