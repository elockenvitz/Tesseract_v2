import { useState } from 'react'
import { clsx } from 'clsx'
import { Compass, Lightbulb } from 'lucide-react'
import { IdeasExplore } from './IdeasExplore'
import { IdeasExploreBrowse } from './IdeasExploreBrowse'
import { IdeasWorkPane } from './IdeasWorkPane'
import type { AttentionEntry } from '../../hooks/useDesktopAttentionFeed'

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
 * The two modes, and why Curate is not one of them.
 *
 * Mobile's state is `useState<'curate' | 'explore'>('curate')`, and reading
 * that alone I made Curate a peer of Explore and the name of the feed. It is
 * neither. `FeedFilterSheet` — the thing actually called Curate, headed
 * "Curate feed" — is a FACETED FILTER: kinds, signal types, sectors, countries,
 * exchanges and tickers, multi-select within a facet and intersected across
 * them, applied on close so Cancel means something.
 *
 * That answers "how do I shape what this feed shows me", not "which mode am I
 * in". On mobile the variable name is the feed's DEFAULT mode; the control the
 * reader knows as Curate is the sheet.
 *
 * So the hierarchy here is Ideas and Explore, and Curate sits with the type
 * lenses as a feed control. Three concepts, correctly ranked:
 *
 *   Ideas / Explore                which question am I asking
 *   All / Trade Ideas / ...        quick type lens
 *   Curate                         the deep faceted filter
 */
type IdeasMode = 'feed' | 'explore'

const MODES: { key: IdeasMode; label: string; hint: string; icon: typeof Lightbulb }[] = [
  { key: 'feed', label: 'Ideas', hint: 'What deserves attention', icon: Lightbulb },
  { key: 'explore', label: 'Explore', hint: 'What might be interesting', icon: Compass },
]

export function IdeasApp(_props: { selectedIdeaId?: string | null } = {}) {
  const [mode, setMode] = useState<IdeasMode>('feed')
  /*
   * The open workspace. Held HERE, above both regions, which is what makes the
   * feed permanent: selecting a tile changes this value and re-renders the
   * right column only. The feed component never unmounts, so its scroll, its
   * loaded pages, its lens and its Curate facets are not state to restore —
   * they are simply never lost.
   */
  const [selected, setSelected] = useState<AttentionEntry | null>(null)

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
        {/* Explore is MOUNTED beside Ideas, not instead of it — both stay in
            the tree so switching modes keeps Ideas' scroll, its loaded pages,
            its type lens and its Curate facets exactly as they were. Explore
            likewise keeps its own category between visits. */}
        <div className={clsx('h-full', mode !== 'explore' && 'hidden')}>
          <IdeasExploreBrowse />
        </div>
        <div className={clsx('flex h-full', mode === 'explore' && 'hidden')}>
        {/* Kept MOUNTED while Explore is open, not unmounted. Switching modes
            must not throw away loaded pages, scroll position or the type lens
            — mobile's modes switch instantly for the same reason. */}
        <div
          className={clsx(
            'min-w-0 border-r border-gray-200 dark:border-gray-700',
            /*
             * ~42% with a floor and a ceiling, not a bare percentage.
             *
             * Below about 30rem the cards stop being scannable; above 40rem the
             * feed is spending width the work pane needs. Closed, it takes the
             * whole column back — and because only the CLASS changes, the
             * component does not remount and the scroll does not move.
             */
            selected ? 'w-[42%] min-w-[30rem] max-w-[40rem]' : 'w-full border-r-0',
          )}
        >
        <IdeasExplore
          selectedKey={selected?.key ?? null}
          onSelect={entry => setSelected(entry)}
        />
        </div>
        {selected && (
          <div className="min-w-0 flex-1">
            <IdeasWorkPane entry={selected} onClose={() => setSelected(null)} />
          </div>
        )}
        </div>
      </div>
    </div>
  )
}
