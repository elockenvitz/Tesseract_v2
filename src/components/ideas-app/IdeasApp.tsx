import { useState } from 'react'
import { clsx } from 'clsx'
import { Compass, Lightbulb } from 'lucide-react'
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
/**
 * Curate and Explore, as mobile defines them.
 *
 * Traced from `MobileDashboard`, where the state is
 * `useState<'curate' | 'explore'>('curate')` and the comment beside it is
 * explicit: a browsing MODE, not a filter. Curate answers "what deserves my
 * attention" — the composed, ranked feed. Explore answers "what might be
 * interesting" — the SAME candidates in a second arrangement, which is why
 * switching is instant rather than a load.
 *
 * Kept deliberately apart from the type lens inside the feed. The mode is
 * which question you are asking; the lens is which kind of answer you want to
 * see. Mobile's own note says folding them together would make Explore look
 * like a sixth category, "the one thing the phase brief is explicit that it is
 * not". Same reasoning holds here, so they are two rows, not one.
 */
type IdeasMode = 'curate' | 'explore'

const MODES: { key: IdeasMode; label: string; hint: string; icon: typeof Lightbulb }[] = [
  { key: 'curate', label: 'Curate', hint: 'What deserves attention', icon: Lightbulb },
  { key: 'explore', label: 'Explore', hint: 'What might be interesting', icon: Compass },
]

export function IdeasApp(_props: { selectedIdeaId?: string | null } = {}) {
  const [mode, setMode] = useState<IdeasMode>('curate')

  return (
    <div className="flex h-full flex-col bg-white dark:bg-gray-900">
      {/*
        The app's own identity bar.

        Deliberately not the Dashboard's lens rail: there is nothing to switch
        to. The type lens lives inside Explore, where it belongs — it chooses
        what KIND of idea you are looking at, which is a question about the
        feed, not about which application you are in.
      */}
      <header className="flex shrink-0 items-center gap-4 border-b border-gray-200 px-6 py-2.5 dark:border-gray-700">
        <div className="flex items-center gap-2">
          <Lightbulb className="h-4 w-4 shrink-0 text-purple-500" />
          <h1 className="text-sm font-semibold text-gray-900 dark:text-white">Ideas</h1>
        </div>
        {/* The mode row. Above the feed, because it is a question about the
            whole surface; the type lens lives inside the feed, because it is a
            question about the feed's contents. */}
        <div className="flex items-center gap-1">
          {MODES.map(m => {
            const Icon = m.icon
            return (
              <button
                key={m.key}
                onClick={() => setMode(m.key)}
                title={m.hint}
                className={clsx(
                  'flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors',
                  mode === m.key
                    ? 'bg-gray-900 text-white dark:bg-gray-100 dark:text-gray-900'
                    : 'text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800',
                )}
              >
                <Icon className="h-3.5 w-3.5" />
                {m.label}
              </button>
            )
          })}
        </div>
        <span className="hidden text-xs text-gray-400 lg:inline dark:text-gray-500">
          {MODES.find(m => m.key === mode)?.hint}
        </span>
      </header>

      <div className="min-h-0 flex-1">
        {mode === 'explore' && (
          /*
           * Explore is NOT built yet, and says so rather than showing Curate
           * under a second name.
           *
           * Its real semantics are a second arrangement of candidates already
           * in hand — `lensesToExplore`, `scenarioCardsToExplore`,
           * `insightsToExplore`, `newsToExplore`, `templatesToExplore` in
           * `lib/mobile/explore-adapters`. Those modules are PURE despite the
           * directory name, so desktop can consume them. What desktop cannot
           * yet reach is the hooks that feed them — `usePortfolioLenses`,
           * `useScenarioCards`, `useDerivedInsights` — which are the same
           * producers the tile engine's adopted families need.
           *
           * One piece of work unlocks both, and guessing at it would produce
           * the "unrelated desktop browse system" this was explicitly not to
           * become.
           */
          <div className="flex h-full items-center justify-center px-6">
            <div className="max-w-sm text-center">
              <Compass className="mx-auto h-6 w-6 text-gray-300 dark:text-gray-600" />
              <p className="mt-3 text-sm font-medium text-gray-700 dark:text-gray-200">
                Explore is not wired up yet
              </p>
              <p className="mt-1 text-xs leading-relaxed text-gray-500 dark:text-gray-400">
                It rearranges the same candidates Curate reads, rather than
                querying for new ones. Desktop still needs the lens and scenario
                producers those arrangements are built from.
              </p>
            </div>
          </div>
        )}
        <div className={clsx('h-full', mode === 'explore' && 'hidden')}>
        {/* Kept MOUNTED while Explore is open, not unmounted. Switching modes
            must not throw away loaded pages, scroll position or the type lens
            — mobile's modes switch instantly for the same reason. */}
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
    </div>
  )
}
