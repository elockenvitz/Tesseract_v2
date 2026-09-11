import { Lightbulb } from 'lucide-react'
import { IdeasExplore } from './IdeasExplore'
import type { SignalCard } from '../../lib/signals/contract'

/**
 * Ideas — the standalone application.
 *
 * ── Why this exists, and why it is not DashboardShell ─────────────────────
 *
 * `DashboardShell` collapsed Today, Ideas, Research, Portfolio and Decisions
 * into one surface with five lenses, on the reasoning that they are five
 * questions about one investment process rather than five applications. That
 * reasoning holds for the Dashboard. It does not make the Dashboard's Ideas
 * LENS the Ideas application.
 *
 * The two answer different questions and want different shapes. The lens is a
 * view onto attention across the whole process and belongs beside the other
 * four. The application is where a reader explores ideas, opens one, works on
 * it, and carries on exploring without losing their place — a persistent
 * workspace, not a lens you switch away from.
 *
 * So this shell is independent: its own tab type (`ideas`), its own launcher
 * entry, its own lifecycle. It does not import `DashboardShell`, does not
 * render the lens bar, and cannot be navigated into a different lens. Sharing
 * happens below both of them — the feed, the card contract, the tile engine,
 * the design primitives — which is where sharing belongs.
 *
 * ── What Stage 4 is ───────────────────────────────────────────────────────
 *
 * Identity and mounting only. `IdeasExplore` is the same component the flagged
 * Dashboard lens renders today, so this stage proves it works under its own
 * roof before that experimental branch is removed from `IdeasWorkspace`.
 *
 * The contextual workspace — select an item, work on it beside the feed, keep
 * scroll and filters — is Stage 5. Selection here does nothing yet, which is
 * deliberate: wiring it to the Dashboard's focus seam would couple the new app
 * to the shell it exists to be independent of.
 */
export function IdeasApp(_props: { selectedIdeaId?: string | null } = {}) {
  return (
    <div className="flex h-full flex-col bg-white dark:bg-gray-900">
      {/*
        The app's own identity bar.

        Deliberately not the Dashboard's lens rail: there is nothing to switch
        to. The type lens lives inside Explore, where it belongs — it chooses
        what KIND of idea you are looking at, which is a question about the
        feed, not about which application you are in.
      */}
      <header className="flex shrink-0 items-center gap-2 border-b border-gray-200 px-6 py-3 dark:border-gray-700">
        <Lightbulb className="h-4 w-4 text-purple-500" />
        <h1 className="text-sm font-semibold text-gray-900 dark:text-white">Ideas</h1>
        <span className="text-xs text-gray-400 dark:text-gray-500">
          Explore what the desk is thinking
        </span>
      </header>

      <div className="min-h-0 flex-1">
        <IdeasExplore
          onOpenCard={(_card: SignalCard) => {
            /*
             * Stage 5. Left explicitly empty rather than wired to
             * `openDashboardFocus`: that seam hands an object to the Dashboard
             * shell and would pull the reader out of this application into
             * that one, which is the exact flow this app is being built to
             * replace. An inert click for one stage is better than a route
             * that has to be unpicked in the next.
             */
          }}
        />
      </div>
    </div>
  )
}
