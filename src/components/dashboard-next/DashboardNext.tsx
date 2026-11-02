import { Fragment, useRef, useState } from 'react'
import { clsx } from 'clsx'
import { Compass, LayoutDashboard, Lightbulb, Scale } from 'lucide-react'
import { IdeasExplore } from '../ideas-app/IdeasExplore'
import { IdeasExploreBrowse } from '../ideas-app/IdeasExploreBrowse'
import { PortfolioWorkspace } from '../portfolio-v2/PortfolioWorkspace'
import { IdeasWorkPane } from '../ideas-app/IdeasWorkPane'
import { BackToSection } from '../desktop/BackToSection'
import { StartHereBand } from './StartHereBand'
import { ArticleReader } from '../mobile/ArticleReader'
import { useDesktopAttentionFeed, type AttentionEntry, type AttentionInclude } from '../../hooks/useDesktopAttentionFeed'
import { selectionFor, selectionForPosition, type IdeasSelection } from '../../lib/desktop-ideas/selection'
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
 * ── The families that let the other lenses retire ─────────────────────────
 *
 * All four conditions are in the feed now, through `INCLUDE` below: a position
 * with no case on file, a case nobody has revisited, research a colleague
 * filed since the case was written, and a proposed trade nobody has answered.
 * Two more arrive with the research family because they are the same object —
 * a case the price has outrun, and a case only partly written.
 *
 * Almost none of it is new product. Every one was already a declared signal
 * type with its own builder, its own tier and its own producer. What was
 * missing was desktop asking for them — and, for the decision family, a
 * producer that read the table the rows are actually in.
 *
 * Opt-in rather than simply on, because asking for them changes what the Ideas
 * TAB means too, and this tab is where that gets tried first.
 *
 * ── And the book, which is not a card ─────────────────────────────────────
 *
 * Portfolio is the one thing on this screen that does NOT retire into the
 * feed, and that is the point rather than an omission. "How is this book
 * doing" is a report about an object, not a finding about a name, and the
 * answer to it is a table of positions against a benchmark. Turning that into
 * cards would produce one card per holding, which is the filler the feed
 * already learned to refuse.
 *
 * So the feed answers what deserves attention, and Portfolio answers how the
 * books are doing, and they are different surfaces behind one bar.
 */

type NextLens = 'feed' | 'explore' | 'portfolio'

/**
 * One constant, read by the feed and by the Explore resolver.
 *
 * Two call sites, because `exploreOpen` matches a preview against the ranked
 * candidates to decide what it opens. Asked with a narrower set, Explore would
 * fail to resolve exactly the previews this tab has just started carding and
 * would fall back to opening the asset cold. It costs no query either way:
 * the pool has been fetching the research scan all along.
 */
const INCLUDE: AttentionInclude = { research: true, decisions: true }

/**
 * Two lenses on the feed, and then the book.
 *
 * ── Why Portfolio is not a third lens ─────────────────────────────────────
 *
 * Ideas and Explore are two questions about one body of material: what
 * deserves attention, and what is here that might be worth investigating.
 * Portfolio is not a third question about that material. It is a different
 * OBJECT — a per-book report — which is what was asked for, and which is
 * exactly what a "Portfolio filter over the feed" would not have been.
 *
 * So it sits in the same row behind a divider rather than beside the other
 * two as an equal. One row, because nobody should have to learn two
 * navigation idioms on one screen; a divider, because the row is not a flat
 * list of three interchangeable views.
 */
const LENSES: { key: NextLens; label: string; hint: string; icon: typeof Lightbulb }[] = [
  { key: 'feed', label: 'Ideas', hint: 'What deserves attention', icon: Lightbulb },
  { key: 'explore', label: 'Explore', hint: 'What might be interesting', icon: Compass },
  { key: 'portfolio', label: 'Portfolio', hint: 'How the books are doing', icon: Scale },
]

/** Where the divider falls: after the lenses that read the feed. */
const FEED_LENSES = 2

export function DashboardNext() {
  const [lens, setLens] = useState<NextLens>('feed')
  /*
   * Latched, the same shape `useDesktopCandidates` uses for its settle gate:
   * Portfolio costs several queries, so it is not mounted until it is asked
   * for, and it stays mounted afterwards so returning to it keeps the book the
   * reader had chosen. Derived during render rather than set in an effect,
   * which would cost a pass with the lens selected and nothing drawn.
   */
  const seenPortfolio = useRef(false)
  if (lens === 'portfolio') seenPortfolio.current = true
  const portfolioSeen = seenPortfolio.current
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
  const resolver = useDesktopAttentionFeed('all', { include: INCLUDE })

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
          {LENSES.map((m, i) => {
            const Icon = m.icon
            return (
              <Fragment key={m.key}>
                {/* The row is the feed's two lenses, and then the book. */}
                {i === FEED_LENSES && (
                  <span
                    aria-hidden
                    className="mx-1.5 h-4 w-px shrink-0 bg-gray-200 dark:bg-gray-700"
                  />
                )}
              <button
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
              </Fragment>
            )
          })}
        </div>
        <span className="hidden text-xs text-gray-400 lg:inline dark:text-gray-500">
          {LENSES.find(m => m.key === lens)?.hint}
        </span>
      </header>

      <div className="min-h-0 flex-1">
        {/* All three browse surfaces stay mounted and are hidden by class, so
            switching lens keeps each one's scroll, filters and loaded pages.
            See `IdeasApp` for why that is not state worth restoring.

            One split row holds all three, rather than Portfolio sitting
            outside it at full width as it did. The book was the one lens a
            reader could not open a name from, and it is the lens where the
            question "what is going on in this holding" comes up most. Putting
            it in the same row means the workspace, the way back out of it and
            the feed's own geometry are one mechanism for every lens instead
            of two. */}
        <div className="flex h-full">
          <div
            className={clsx(
              'flex min-w-0 flex-col border-r border-gray-200 dark:border-gray-700',
              /*
               * ~30% between 20rem and 26rem, down from ~42% between 30 and
               * 40. Two reasons, and the second is the one that matters.
               *
               * The obvious one: at 40rem the column was reported as holding
               * a lot of empty space, and the workspace beside it is where
               * the reading happens.
               *
               * The structural one: 26rem is under the 34rem that
               * `.gallery-region` and the rail gutter are both keyed on, so
               * the rail is ONE COLUMN at every window width rather than two
               * narrow ones, and its gutter drops to 12px. A 40rem cap sat
               * above that threshold and gave Explore and the book two
               * columns of slivers in a pane the reader scans as a list.
               */
              splitOpen ? 'w-[30%] min-w-[20rem] max-w-[26rem]' : 'w-full border-r-0 px-2',
            )}
          >
            {/*
              The way back, over the column it widens.

              It was drawn above the WORK PANE first, which is the wrong half
              of the screen: pressing it gives this column its full width
              back, so a control on the other side points away from where the
              press lands. Above the list, it is over the thing it restores.

              One band for all three lenses rather than one per surface: the
              press means the same thing on each, and three copies is how a
              label starts differing from its neighbour.
            */}
            {splitOpen && (
              <div className="flex shrink-0 items-center border-b border-gray-200 px-3 py-1.5 dark:border-gray-700">
                <BackToSection
                  /* The lens the reader is standing in, from the same table
                     the bar's own buttons read, so the two labels are one
                     string. */
                  backTo={LENSES.find(m => m.key === lens)?.label ?? 'Dashboard'}
                  onBack={() => { setSelected(null); setWorkMode(null); setSplitOpen(false) }}
                />
              </div>
            )}
            {/*
              The book report.

              Mounting the existing lens rather than writing a second one is
              the same decision the feed made about `IdeasExplore` -- a second
              portfolio surface would be a second answer to "what does this
              book weigh", which is the duplication this direction exists to
              end.

              Mounted on first use and kept mounted after: it runs several
              queries, so a reader who never opens it pays nothing, and a
              reader who does keeps their chosen book when they go back to the
              feed and return.

              `onOpenPosition` is what makes a holding open HERE. Without it
              the lens dispatches a window event that only the old Dashboard
              deck listens for, so in this shell a click on a position did
              nothing at all.
            */}
            {portfolioSeen && (
              <div
                /* `min-h-0 flex-1`, not `h-full`: the column is a flex column
                   with a back band above, and `h-full` would measure the whole
                   column and push the surface's own scroller past the bottom.
                   All three wrappers below carry the same pair. */
                className={clsx('min-h-0 flex-1', lens !== 'portfolio' && 'hidden')}
              >
                <PortfolioWorkspace
                  onOpenPosition={target => openWorkspace(selectionForPosition(target), null, null)}
                />
              </div>
            )}
            <div className={clsx('min-h-0 flex-1', lens !== 'explore' && 'hidden')}>
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
            {/* `!== 'feed'`, not `=== 'explore'`. With Portfolio outside this
                column the two spellings meant the same thing; now that there
                are three lenses in it, the old one would draw the feed
                underneath the book. */}
            <div className={clsx('min-h-0 flex-1', lens !== 'feed' && 'hidden')}>
              <IdeasExplore
                selectedKey={selected?.selection.key ?? null}
                include={INCLUDE}
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
