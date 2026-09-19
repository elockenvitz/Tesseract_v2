import { useState } from 'react'
import { clsx } from 'clsx'
import { Compass, Lightbulb } from 'lucide-react'
import { IdeasExplore } from './IdeasExplore'
import { IdeasExploreBrowse } from './IdeasExploreBrowse'
import { IdeasWorkPane } from './IdeasWorkPane'
import { ArticleReader } from '../mobile/ArticleReader'
import { useDesktopAttentionFeed, type AttentionEntry } from '../../hooks/useDesktopAttentionFeed'
import { selectionFor, type IdeasSelection } from '../../lib/desktop-ideas/selection'
import { exploreOpen, type ExploreOpen } from '../../lib/desktop-ideas/explore-open'
import { openAsset } from '../../lib/desktop-asset/navigate'
import type { Progression } from '../../lib/desktop-ideas/progression'
import { usePromptResolve } from '../../hooks/usePromptResolve'
import { usePilotOnboarding } from '../../hooks/usePilotOnboarding'

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
  /*
   * The entry is PRESENTATION and optional. `IdeasWorkPane` reads one field off
   * it for a header fallback and routes on none of it, which is why a selection
   * made in Explore can carry `null` here and reach the identical surface.
   */
  const [selected, setSelected] = useState<{ selection: IdeasSelection; entry: AttentionEntry | null } | null>(null)
  /**
   * The work mode a progression CTA asked for, if any.
   *
   * Held beside the selection rather than inside it: selection says WHAT is
   * open, this says what the reader came to do. Cleared on an ordinary tile
   * click, so opening the same candidate normally does not inherit a mode
   * from a press that happened earlier.
   */
  const [workMode, setWorkMode] = useState<Progression['mode'] | null>(null)
  const resolvePrompt = usePromptResolve()
  const { markSignalWorked } = usePilotOnboarding()
  /**
   * Two states, deliberately separate.
   *
   *   splitOpen   the LAYOUT: is there a work region beside the feed?
   *   selected    the CONTENT: which candidate is in it?
   *
   * They were one, so a lens change that invalidated the selection also
   * collapsed the pane — the reader was working in two columns, switched to
   * Thoughts, and the app rearranged itself around them.
   *
   * Only the close control returns to a single feed. A filter change may empty
   * the work region; it may not put it away.
   */
  const [splitOpen, setSplitOpen] = useState(false)

  /*
   * One place, because every route into the workspace passes through here:
   * a tile click, a progression CTA, and an Explore preview that resolved to a
   * candidate. Marking at the three call sites would be three chances to miss
   * one, and marking on mount would record "opened the app" as "worked a
   * signal", which is the conflation this step exists to avoid.
   *
   * Below `splitOpen` deliberately: it writes that setter, and the repo's
   * use-before-define ratchet is there because a TDZ error in banner code once
   * broke the feed on every render.
   */
  const openWorkspace = (selection: IdeasSelection, entry: AttentionEntry | null, mode: Progression['mode'] | null) => {
    setSelected({ selection, entry })
    setWorkMode(mode)
    setSplitOpen(true)
    markSignalWorked()
  }

  /**
   * The candidate pool, for RESOLVING an Explore preview — never for drawing.
   *
   * Always the `all` lens with no facets: the reader's Ideas lens is a question
   * about what the Ideas feed shows them, and it must not decide whether a
   * preview they tapped in Explore can be opened. Nothing is rendered from
   * this; `IdeasExplore` holds its own.
   *
   * No new query. `useDesktopAttentionFeed` is a memo over
   * `useDesktopCandidates`, whose React Query entries the feed and Explore
   * already share, so this re-derives cards from data in hand and fetches
   * nothing.
   */
  const resolver = useDesktopAttentionFeed('all')

  /**
   * The open story, if any.
   *
   * A story is read, not worked on, and `resolveExploreItem` has said so since
   * it was written. It gets the reader the product already has rather than a
   * second one, and deliberately NOT the workspace — putting an article there
   * for the sake of consistency would make the workspace a browser.
   */
  const [article, setArticle] = useState<Extract<ExploreOpen, { do: 'article' }> | null>(null)

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
        {/*
          One row, two browse surfaces, one workspace.

          The workspace used to live inside the Ideas branch, so Explore could
          not have reached it without growing its own — which is exactly the
          parallel detail system this stage exists to prevent. It is a sibling
          of the browse region now, and both surfaces feed the same one.

          Both browse surfaces stay MOUNTED and are hidden by class. Switching
          modes therefore keeps Ideas' scroll, its loaded pages, its type lens
          and its Curate facets, and keeps Explore's scroll and its category —
          none of it is state to restore, because none of it is ever lost.
        */}
        <div className="flex h-full">
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
            /*
             * The 8px is the application-side gutter, and it exists only in
             * the full-width state. The feed's own `px-6` gives 24px; the tile
             * therefore keeps 32px of air from the window edge on a canvas
             * narrower than the cap, instead of running to within 24px of it.
             * Split mode is left exactly as it was — this pane is already the
             * narrower half and has no width to give away.
             */
            splitOpen ? 'w-[42%] min-w-[30rem] max-w-[40rem]' : 'w-full border-r-0 px-2',
          )}
        >
        <div className={clsx('h-full', mode !== 'explore' && 'hidden')}>
          <IdeasExploreBrowse
            selectedKey={selected?.selection.key ?? null}
            /*
             * Resolution happens against the attention pool, so a preview
             * opens the SAME candidate the Ideas feed would — see
             * `exploreOpen`. Passed as a function rather than resolved inside
             * Explore, because the pool lives here beside the workspace.
             */
            resolve={item => exploreOpen(item, resolver.entries)}
            onOpen={open => {
              if (open.do === 'work') {
                openWorkspace(open.selection, null, null)
                return
              }
              if (open.do === 'article') { setArticle(open); return }
              if (open.do === 'navigate') {
                /*
                 * The shell's own tab channel — the same descriptor `openAsset`
                 * and the AI action seam dispatch. A tab destination names a
                 * surface; embedding a preview of it in the workspace would be
                 * answering a different question than the one the tile asked.
                 */
                window.dispatchEvent(new CustomEvent('decision-engine-action', { detail: open.target }))
                return
              }
              // `none` never reaches here: the tile is not a control.
              console.warn('[ideas/explore] nothing to open', open.why)
            }}
          />
        </div>
        <div className={clsx('h-full', mode === 'explore' && 'hidden')}>
        <IdeasExplore
          selectedKey={selected?.selection.key ?? null}
          onSelect={entry => openWorkspace(selectionFor(entry), entry, null)}
          onProgress={(entry, progression) => {
            /*
             * Resolve is a WRITE, not a destination. It finishes the prompt
             * where the reader is standing — opening the workspace to press
             * the same control would be the duplication this CTA exists to
             * avoid.
             */
            if (progression.mode.kind === 'prompt_resolve') {
              const item = entry.item as unknown as { tags?: string[] | null } | null
              resolvePrompt.mutate({ promptId: entry.item!.id, tags: item?.tags ?? [] })
              return
            }
            openWorkspace(selectionFor(entry), entry, progression.mode)
          }}
          /* The open candidate is not in the new context. Clear it and leave
             the work region open and empty — picking a replacement is the
             reader's, and so is putting the pane away. */
          onSelectionInvalid={() => {
            /*
             * Only the Ideas feed's own selections answer to the Ideas feed's
             * context. A candidate the reader opened from Explore was never
             * asked for here, so a lens change has no standing to take it
             * away — that is the reconciliation rule Explore must not inherit.
             */
            if (selected?.selection.origin !== 'ideas') return
            setSelected(null)
            setWorkMode(null)
          }}
        />
        </div>
        </div>
        {splitOpen && (
          <div className="min-w-0 flex-1">
            <IdeasWorkPane
              selection={selected?.selection ?? null}
              entry={selected?.entry ?? null}
              mode={workMode}
              /* The only route back to a single feed. */
              onClose={() => { setSelected(null); setWorkMode(null); setSplitOpen(false) }}
            />
          </div>
        )}
        </div>
      </div>

      {/* Portalled and full-screen, over whichever mode the reader was in. The
          same component the phone uses — its directory is historical, it holds
          no phone-specific layout, and a second reader would be a second
          answer to a question this product has already answered. */}
      {article && (
        <ArticleReader
          open
          url={article.url}
          fallbackTitle={article.title ?? undefined}
          fallbackSource={article.source ?? undefined}
          desk={article.desk}
          onClose={() => setArticle(null)}
          /* The route the story's own tile would have taken. */
          onOpenAsset={(assetId, symbol) => {
            if (assetId) openAsset({ assetId, symbol })
          }}
        />
      )}
    </div>
  )
}
