import { useState } from 'react'
import { clsx } from 'clsx'
import { Compass, LayoutDashboard, Lightbulb } from 'lucide-react'
import { IdeasExplore } from '../ideas-app/IdeasExplore'
import { IdeasExploreBrowse } from '../ideas-app/IdeasExploreBrowse'
import { IdeasWorkPane } from '../ideas-app/IdeasWorkPane'
import { StartHereBand } from './StartHereBand'
import { ArticleReader } from '../mobile/ArticleReader'
import { useDesktopAttentionFeed, type AttentionEntry } from '../../hooks/useDesktopAttentionFeed'
import { selectionFor, type IdeasSelection } from '../../lib/desktop-ideas/selection'
import { exploreOpen, type ExploreOpen } from '../../lib/desktop-ideas/explore-open'
import { openAsset } from '../../lib/desktop-asset/navigate'
import { openIdeaDetail } from '../../lib/navigation/open-idea'
import type { Progression } from '../../lib/desktop-ideas/progression'
import { usePromptResolve } from '../../hooks/usePromptResolve'
import { usePilotOnboarding } from '../../hooks/usePilotOnboarding'

/**
 * The Dashboard, rebuilt as the Ideas feed. Tab type `dashboard-next`.
 *
 * ── Why a second shell instead of changing the Dashboard ──────────────────
 *
 * The decision this surface implements is that the Dashboard IS the feed, with
 * Ideas and Explore as its two lenses, exactly as the phone has it, and that
 * Today, Research and Decisions retire into it as card types. That is a large
 * claim to make about a reader's home screen, so it is being made in a tab of
 * its own first.
 *
 * `today` and `ideas` are untouched. Nothing in this directory is imported by
 * either of them, so this surface cannot break them and reverting it is
 * deleting a directory and four registration lines. The cost of that safety is
 * that the orchestration below — selection, the article reader, the workspace
 * seam — is a second copy of `IdeasApp`'s. That is deliberate and temporary: if
 * this wins, the Dashboard renders this and `IdeasApp` loses the feed, and
 * there is one copy again. The reasoning behind each piece of that
 * orchestration is in `IdeasApp` and is not repeated here.
 *
 * ── What is genuinely new, and what is only re-chromed ────────────────────
 *
 * New: the Start here band, and the framing that the lens row is the
 * Dashboard's rather than an application's.
 *
 * Re-chromed: the feed and Explore are `IdeasExplore` and
 * `IdeasExploreBrowse`, the same components the Ideas application renders,
 * passed the same props. Building a second feed would have meant a second
 * ranker and a second card contract, which is the duplication this whole
 * direction exists to end.
 *
 * ── What is NOT here yet ──────────────────────────────────────────────────
 *
 * The four card types that let Today, Research and Decisions retire — a
 * decision waiting on you, a case gone stale, a position with no case on file,
 * research a colleague filed — are not in the feed, because they are new
 * candidate FAMILIES, not new chrome. They belong beside `stale_target` and
 * `crowding` in the feed's own producer. Until they exist this surface shows
 * what the Ideas feed shows, so the other lenses still hold material it does
 * not, and nothing here claims otherwise.
 *
 * Explore also still draws preview tiles rather than the lens tile. Its own
 * header argues for that ("a preview is a preview"), so changing it is a
 * decision about Explore and gets its own change.
 */

type NextLens = 'feed' | 'explore'

const LENSES: { key: NextLens; label: string; hint: string; icon: typeof Lightbulb }[] = [
  { key: 'feed', label: 'Ideas', hint: 'What deserves attention', icon: Lightbulb },
  { key: 'explore', label: 'Explore', hint: 'What might be interesting', icon: Compass },
]

export function DashboardNext() {
  const [lens, setLens] = useState<NextLens>('feed')
  const [selected, setSelected] = useState<{ selection: IdeasSelection; entry: AttentionEntry | null } | null>(null)
  const [workMode, setWorkMode] = useState<Progression['mode'] | null>(null)
  const [splitOpen, setSplitOpen] = useState(false)
  const [article, setArticle] = useState<Extract<ExploreOpen, { do: 'article' }> | null>(null)
  const resolvePrompt = usePromptResolve()
  /* `markIdeasViewed` is deliberately not called here: `IdeasExplore` already
     records it when the feed settles, and a second caller in the shell would
     record "opened the tab" as "saw the feed". */
  const { markSignalWorked } = usePilotOnboarding()

  /* One route into the workspace, as in `IdeasApp`: a card click, a
     progression CTA, a resolved Explore preview, and now a Start here row. */
  const openWorkspace = (selection: IdeasSelection, entry: AttentionEntry | null, mode: Progression['mode'] | null) => {
    setSelected({ selection, entry })
    setWorkMode(mode)
    setSplitOpen(true)
    markSignalWorked()
  }

  /* Resolving an Explore preview, never for drawing. A memo over the shared
     candidate pool, so this fetches nothing. */
  const resolver = useDesktopAttentionFeed('all')

  /* The same thing a card click does, so Start here and the card it was
     derived from cannot land in different places. */
  const openEntry = (entry: AttentionEntry) => {
    if (entry.family === 'ready_to_revisit') {
      const target = entry.card.actions?.primary?.route?.idea?.tradeQueueItemId
      if (target) {
        openIdeaDetail(target)
        return
      }
    }
    openWorkspace(selectionFor(entry), entry, null)
  }

  return (
    <div className="flex h-full flex-col bg-white dark:bg-gray-900">
      {/*
        The Dashboard's own bar. The lens row is the product's home switching
        between its two questions, not an application's mode switch, which is
        why the identity beside it is the Dashboard and not "Ideas".
      */}
      <header className="flex shrink-0 items-center gap-4 border-b border-gray-200 px-6 py-2.5 dark:border-gray-700">
        <div className="flex items-center gap-2">
          <LayoutDashboard className="h-4 w-4 shrink-0 text-blue-500" />
          <h1 className="text-sm font-semibold text-gray-900 dark:text-white">Dashboard</h1>
        </div>
        <div className="flex items-center gap-1">
          {LENSES.map(m => {
            const Icon = m.icon
            return (
              <button
                key={m.key}
                onClick={() => setLens(m.key)}
                title={m.hint}
                aria-pressed={lens === m.key}
                className={clsx(
                  'flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors',
                  lens === m.key
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
          {LENSES.find(m => m.key === lens)?.hint}
        </span>
      </header>

      <div className="min-h-0 flex-1">
        {/* Both browse surfaces stay mounted and are hidden by class, so
            switching lens keeps each one's scroll, filters and loaded pages.
            See `IdeasApp` for why that is not state worth restoring. */}
        <div className="flex h-full">
          <div
            className={clsx(
              'min-w-0 border-r border-gray-200 dark:border-gray-700',
              splitOpen ? 'w-[42%] min-w-[30rem] max-w-[40rem]' : 'w-full border-r-0 px-2',
            )}
          >
            <div className={clsx('h-full', lens !== 'explore' && 'hidden')}>
              <IdeasExploreBrowse
                selectedKey={selected?.selection.key ?? null}
                resolve={item => exploreOpen(item, resolver.entries)}
                onOpen={open => {
                  if (open.do === 'work') {
                    openWorkspace(open.selection, null, null)
                    return
                  }
                  if (open.do === 'article') { setArticle(open); return }
                  if (open.do === 'navigate') {
                    window.dispatchEvent(new CustomEvent('decision-engine-action', { detail: open.target }))
                    return
                  }
                  console.warn('[dashboard-next/explore] nothing to open', open.why)
                }}
              />
            </div>
            <div className={clsx('h-full', lens === 'explore' && 'hidden')}>
              <IdeasExplore
                selectedKey={selected?.selection.key ?? null}
                /* The band is handed the entries this feed is drawing, so the
                   instructions and the cards are one list in one order. */
                lead={entries => <StartHereBand entries={entries} onOpen={openEntry} />}
                onSelect={openEntry}
                onProgress={(entry, progression) => {
                  if (progression.mode.kind === 'prompt_resolve') {
                    const item = entry.item as unknown as { tags?: string[] | null } | null
                    resolvePrompt.mutate({ promptId: entry.item!.id, tags: item?.tags ?? [] })
                    return
                  }
                  openWorkspace(selectionFor(entry), entry, progression.mode)
                }}
                onSelectionInvalid={() => {
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
                onClose={() => { setSelected(null); setWorkMode(null); setSplitOpen(false) }}
              />
            </div>
          )}
        </div>
      </div>

      {article && (
        <ArticleReader
          open
          url={article.url}
          fallbackTitle={article.title ?? undefined}
          fallbackSource={article.source ?? undefined}
          desk={article.desk}
          onClose={() => setArticle(null)}
          onOpenAsset={(assetId, symbol) => {
            if (assetId) openAsset({ assetId, symbol })
          }}
        />
      )}
    </div>
  )
}
