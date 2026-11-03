import { Fragment, memo, useCallback, useEffect, useRef, useState } from 'react'
import { clsx } from 'clsx'
import { Compass, LayoutDashboard, Lightbulb, Scale } from 'lucide-react'
import { IdeasExplore } from '../ideas-app/IdeasExplore'
import { IdeasExploreBrowse } from '../ideas-app/IdeasExploreBrowse'
import { PortfolioWorkspace } from '../portfolio-v2/PortfolioWorkspace'
import { IdeasWorkPane } from '../ideas-app/IdeasWorkPane'
import { BackToSection } from '../desktop/BackToSection'
import { StartHereBand } from './StartHereBand'
import { useDesktopAttentionFeed, type AttentionEntry, type AttentionInclude } from '../../hooks/useDesktopAttentionFeed'
import { selectionFor, selectionForPosition, selectionForStory, type IdeasSelection } from '../../lib/desktop-ideas/selection'
import { exploreOpen, type ExploreOpen } from '../../lib/desktop-ideas/explore-open'
import type { ExploreItem } from '../../lib/mobile/explore-item'
import { openIdeaDetail } from '../../lib/navigation/open-idea'
import type { Progression } from '../../lib/desktop-ideas/progression'
import type { DashboardFocusTarget } from '../../lib/dashboard/focus'
import { usePromptResolve } from '../../hooks/usePromptResolve'
import { usePilotOnboarding } from '../../hooks/usePilotOnboarding'
/*
 * `hooks/useAuth`, NOT `contexts/AuthContext`.
 *
 * Both export a `useAuth`, and the context one is the wrong answer here: its
 * `AuthProvider` is mounted nowhere in this application, so its hook throws
 * "useAuth must be used within an AuthProvider" and takes the whole tab to the
 * error boundary. Caught by opening the tab, not by the suite, which mocks it.
 * The 148 other callers in this codebase all read the hook.
 */
import { useAuth } from '../../hooks/useAuth'
import { readPlace, writePlace, type LensPlace, type NextLens } from './place'

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

/* `NextLens` lives in `./place`, which is where the lens is remembered. */

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

/**
 * The three browse surfaces, memoised FOR THIS SHELL.
 *
 * ── What was measured ─────────────────────────────────────────────────────
 *
 * In the running app at 1920, with a `longtask` observer across a lens press
 * and 400ms after it, on the live Dashboard (83 feed cards, 151 Explore
 * tiles, a 22-line book):
 *
 *   Ideas <-> Explore   one 159ms task, first paint 167-200ms after the click
 *   Portfolio <-> any   one 96-99ms task
 *
 * A frame is 16ms, so that is ten dropped frames on a press that changes one
 * `hidden` class. Reported as flickering when flipping back and forth.
 *
 * The click handler itself measured 1-2ms and forcing layout straight after
 * it measured 0ms, so none of it was the browser: it was React re-rendering
 * all three surfaces because a lens change changed something they were
 * handed. Three somethings, in fact -- the per-lens selection, the handler
 * identities, and the rail host node -- each fixed at its source above and
 * each commented where it was.
 *
 * `memo` is what turns those fixes into a skipped render. Applied HERE, at
 * the call site, rather than by wrapping the components' own exports: this
 * shell is the only caller that keeps all three mounted at once and flips
 * between them, and `IdeasApp` must not inherit a memo it did not ask for.
 *
 * It is not a correctness mechanism. Every prop below is a primitive, a
 * module constant, a value from a memo, or a `useCallback` with no lens in
 * it, so a surface whose input genuinely changes still re-renders. If a
 * future prop is written inline in the JSX this silently stops working
 * rather than going wrong, which is why `dashboard-next.test.tsx` pins the
 * prop shapes.
 */
const Feed = memo(IdeasExplore)
const Explore = memo(IdeasExploreBrowse)
const Book = memo(PortfolioWorkspace)

export function DashboardNext() {
  /*
   * ── The place survives the tab switch ───────────────────────────────────
   *
   * `DashboardPage` renders the active tab only, so this component is
   * unmounted whenever the reader looks at anything else and every `useState`
   * below starts from scratch on the way back. Reported as the Dashboard not
   * keeping "where I was and what I was working on", and it was exactly that:
   * the lens, the selected name and the open work pane were all gone.
   *
   * The initialisers read the remembered place and the effect below writes it.
   * `./place` carries why it is memory rather than storage, and why it is
   * keyed by the reader. Owner is read first because the initialisers need it.
   */
  const { user } = useAuth()
  const owner = user?.id ?? null
  /* A lazy initialiser, so the read happens once at mount and not on every
     render -- `readPlace` forgets a place it cannot hand back, and calling it
     during render would make that a side effect of drawing. */
  const [resume] = useState(() => readPlace(owner))

  const [lens, setLens] = useState<NextLens>(resume.lens)
  /*
   * Latched, the same shape `useDesktopCandidates` uses for its settle gate:
   * Portfolio costs several queries, so it is not mounted until it is asked
   * for, and it stays mounted afterwards so returning to it keeps the book the
   * reader had chosen. Derived during render rather than set in an effect,
   * which would cost a pass with the lens selected and nothing drawn.
   *
   * NOT seeded from the remembered place, and `./place` records why: being
   * derived during render, it is already true on the first pass whenever the
   * restored lens is Portfolio, and seeding it would mount the book for a
   * reader who came back to the FEED and charge them its queries unasked.
   */
  const seenPortfolio = useRef(false)
  if (lens === 'portfolio') seenPortfolio.current = true
  const portfolioSeen = seenPortfolio.current
  /*
   * What is open, PER LENS. See `LensPlace` for why this is not one object.
   *
   * The three lenses ask three questions, and a reader pressing Explore is
   * changing the question rather than carrying an answer across. One shared
   * work pane meant an AMZN workspace opened from the feed was still there
   * under Explore, relabelled "Back to Explore", pointing at a field the
   * reader had never been in.
   */
  const [at, setAt] = useState<Record<NextLens, LensPlace>>(resume.at)
  const here = at[lens]
  const selected = here.selected
  const workMode = here.workMode
  const splitOpen = here.splitOpen
  /*
   * Writes land on the lens the reader is standing in, read at call time
   * rather than captured. A handler built for one lens and pressed after a
   * switch must act on the lens on screen.
   *
   * ── Why the lens comes from a ref and not from the closure ──────────────
   *
   * This was `useCallback(..., [lens])`, which did the same thing and gave
   * every handler built on it A NEW IDENTITY ON EVERY LENS CHANGE. That is
   * what made flipping lenses cost a full re-render of all three browse
   * surfaces: measured in the running app, one 159ms task per press, with
   * first paint 167-200ms after it. The click itself was 1-2ms.
   *
   * A ref read inside the updater is the same rule stated in a way that does
   * not churn: the handler never captures a lens at all, so there is nothing
   * for a switch to invalidate.
   */
  const lensNow = useRef(lens)
  lensNow.current = lens
  const setHere = useCallback((patch: Partial<LensPlace>) => {
    setAt(prev => ({ ...prev, [lensNow.current]: { ...prev[lensNow.current], ...patch } }))
  }, [])
  const closeHere = useCallback(() => {
    setHere({ selected: null, workMode: null, splitOpen: false })
  }, [setHere])
  /*
   * The node the feed portals its filter rail into, in this bar's right-hand
   * end. State rather than a ref, because the child needs to RE-RENDER once
   * the node exists -- a ref assignment does not schedule one, and the rail
   * would stay in the feed's own band until something else happened to
   * re-render it.
   */
  const [railHost, setRailHost] = useState<HTMLElement | null>(null)

  /*
   * Written on every change rather than on unmount. An unmount-time write
   * would be the obvious place and is the wrong one: React can drop a tree
   * without running cleanup in the order a reader expects, and a value
   * captured in a closure that ran once is the previous place, not this one.
   */
  useEffect(() => {
    writePlace(owner, { lens, at })
  }, [owner, lens, at])
  const resolvePrompt = usePromptResolve()
  /* `markIdeasViewed` is deliberately not called here: `IdeasExplore` already
     records it when the feed settles, and a second caller in the shell would
     record "opened the tab" as "saw the feed". */
  const { markSignalWorked } = usePilotOnboarding()

  /* One route into the workspace, as in `IdeasApp`: a card click, a
     progression CTA, a resolved Explore preview, and now a Start here row.

     `useCallback` because the Explore field below hands this, through `onOpen`,
     to 145 memoised tiles -- an identity that changed every render would defeat
     every one of them. All four calls are setters or a stable hook callback. */
  const openWorkspace = useCallback((
    selection: IdeasSelection, entry: AttentionEntry | null, mode: Progression['mode'] | null,
  ) => {
    setHere({ selected: { selection, entry }, workMode: mode, splitOpen: true })
    markSignalWorked()
  }, [setHere, markSignalWorked])

  /* Resolving an Explore preview, never for drawing. A memo over the shared
     candidate pool, so this fetches nothing. */
  const resolver = useDesktopAttentionFeed('all', { include: INCLUDE })

  /**
   * The Explore field's two callbacks, hoisted out of JSX and stabilised.
   *
   * ── The hitch this fixes ────────────────────────────────────────────────
   *
   * MEASURED in the running app with a long-task observer: opening a tile cost
   * 234ms in two long tasks, and going back cost 258ms in two more, both well
   * past the 50ms threshold. Nothing was refetching -- the tile count never
   * left 145 and no skeleton appeared -- so the whole cost was rendering: a
   * selection change re-rendered all 145 tiles twice, to change the appearance
   * of two of them.
   *
   * These were inline arrows in the JSX, so every render of this component
   * handed the field new function identities. `React.memo` on the tile cannot
   * see past that, which is why the tile was not memoised before: it would
   * have been decoration.
   *
   * `resolve` is called at RENDER time, not on click, so it cannot be hidden
   * behind a ref -- its result has to change when the candidate pool does.
   * Keying it on `resolver.entries` is exactly that and no more.
   */
  const resolveExplore = useCallback(
    (item: ExploreItem) => exploreOpen(item, resolver.entries),
    [resolver.entries],
  )

  const onExploreOpen = useCallback((open: Exclude<ExploreOpen, { do: 'filter' }>) => {
    if (open.do === 'work') {
      openWorkspace(open.selection, null, null)
      return
    }
    /* The story goes in the pane, like everything else a tile opens. It used
       to take the whole screen as an overlay; see `selectionForStory`. */
    if (open.do === 'article') { openWorkspace(selectionForStory(open), null, null); return }
    if (open.do === 'navigate') {
      window.dispatchEvent(new CustomEvent('decision-engine-action', { detail: open.target }))
      return
    }
    console.warn('[dashboard-next/explore] nothing to open', open.why)
  }, [openWorkspace])

  /* The same thing a card click does, so Start here and the card it was
     derived from cannot land in different places.

     `useCallback` for the same reason as `openWorkspace`: the feed below is
     memoised now, and a handler rebuilt on every render would re-render all
     83 of its cards on every lens press. */
  const openEntry = useCallback((entry: AttentionEntry) => {
    if (entry.family === 'ready_to_revisit') {
      const target = entry.card.actions?.primary?.route?.idea?.tradeQueueItemId
      if (target) {
        openIdeaDetail(target)
        return
      }
    }
    openWorkspace(selectionFor(entry), entry, null)
  }, [openWorkspace])

  /* The band above the cards, built from the entries the feed is drawing. */
  const feedLead = useCallback(
    (entries: AttentionEntry[]) => <StartHereBand entries={entries} onOpen={openEntry} />,
    [openEntry],
  )

  /*
   * `resolvePrompt.mutate`, NOT `resolvePrompt`.
   *
   * The mutation RESULT is a new object on every render of this component, so
   * depending on it gave this handler a new identity on every lens press and
   * re-rendered the memoised feed -- all 83 cards -- to change one `hidden`
   * class. Measured with a render counter in the running app: two feed
   * renders per press, which the switch to `.mutate` takes to zero.
   * `mutate` itself is stable for the life of the mutation.
   */
  const resolveTags = resolvePrompt.mutate
  const onFeedProgress = useCallback((entry: AttentionEntry, progression: Progression) => {
    if (progression.mode.kind === 'prompt_resolve') {
      const item = entry.item as unknown as { tags?: string[] | null } | null
      resolveTags({ promptId: entry.item!.id, tags: item?.tags ?? [] })
      return
    }
    openWorkspace(selectionFor(entry), entry, progression.mode)
  }, [openWorkspace, resolveTags])

  /**
   * The feed's own candidate is no longer in the feed's own set.
   *
   * Acts on `feed` by name rather than on "here", and reads the place inside
   * the updater rather than from the render that built this handler. Both for
   * the same reason: this fires from the feed, which stays mounted while the
   * reader is in another lens, and it must neither clear that other lens's
   * place nor make this handler's identity depend on which lens is on screen.
   *
   * The pane stays OPEN and loses its subject, which is what this handler
   * always did: the reader changed the feed's context and their candidate is
   * no longer in it.
   */
  const onFeedSelectionInvalid = useCallback(() => {
    setAt(prev => (prev.feed.selected?.selection.origin === 'ideas'
      ? { ...prev, feed: { ...prev.feed, selected: null, workMode: null } }
      : prev))
  }, [])

  const openPosition = useCallback(
    (target: DashboardFocusTarget) => openWorkspace(selectionForPosition(target), null, null),
    [openWorkspace],
  )

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

        {/*
          Where the feed draws its own filters.

          The feed used to put a second full-width control band directly under
          this one: a mode row, a rule, a chip row, a rule. Two bands of
          controls, stacked, for one surface -- and the lower one went on
          drawing itself while the reader was looking at Explore or the book,
          where its chips mean nothing.

          An empty node, filled by `IdeasExplore` through a portal, so the
          lens, the applied facets and the Curate popover all stay owned by
          the component whose state they are. `ml-auto` is the right-hand end
          of the bar, which is where a filter belongs beside a mode switch.

          HIDDEN off the feed, not unmounted -- and that is a change with a
          measurement behind it. It was `{lens === 'feed' && <div …>}`, so the
          host node was destroyed and rebuilt on every press, `railHost` went
          null and back, and the feed re-rendered all 83 of its cards each
          time because one of its props had genuinely changed. That was part
          of the 159ms-per-press task.

          `display: none` keeps the node, so the portal keeps its children and
          the prop never moves. The original reason for unmounting still holds
          and is still met: React removes a portal's children with its host,
          and a host reused ACROSS lenses would leave the feed's chips sitting
          over the book. Hidden, they sit over nothing.
        */}
        <div
          ref={setRailHost}
          className={clsx('ml-auto flex min-w-0 items-center', lens !== 'feed' && 'hidden')}
        />
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
                  onBack={closeHere}
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
                <Book
                  onOpenPosition={openPosition}
                  /*
                    Which line the workspace beside this column belongs to.

                    Read from `at.portfolio` and NOT from `here`: this lens
                    stays mounted while the reader is in the feed, so handing
                    it the feed's selection would mark a line in a book
                    nobody is looking at -- and `./place` is the whole reason
                    those two are different objects now.

                    Not `selectedAssetId` or `focusObjectId`: both of those
                    mean "replace the book with this position's detail pane",
                    which is the deck's seam. See `openAssetId`.
                  */
                  openAssetId={at.portfolio.selected?.selection.assetId ?? null}
                />
              </div>
            )}
            <div className={clsx('min-h-0 flex-1', lens !== 'explore' && 'hidden')}>
              <Explore
                /*
                  EXPLORE's own selection, not the lens the reader happens to
                  be standing in. `selected` is `at[lens]`, so this field used
                  to be handed the Ideas feed's key whenever the reader was in
                  Ideas -- a key it can never match, so nothing looked wrong,
                  and a prop that moved on every press, so everything
                  re-rendered. Now that a selection also decides which tiles
                  collapse, handing a field another lens's selection would be
                  a visible fault and not only a cost.
                */
                selectedKey={at.explore.selected?.selection.key ?? null}
                resolve={resolveExplore}
                onOpen={onExploreOpen}
              />
            </div>
            {/* `!== 'feed'`, not `=== 'explore'`. With Portfolio outside this
                column the two spellings meant the same thing; now that there
                are three lenses in it, the old one would draw the feed
                underneath the book. */}
            <div className={clsx('min-h-0 flex-1', lens !== 'feed' && 'hidden')}>
              <Feed
                /* The FEED's own selection. See the note on Explore's: these
                   read `selected`, which is whichever lens is on screen, so
                   each field was handed another lens's key on every press. */
                selectedKey={at.feed.selected?.selection.key ?? null}
                include={INCLUDE}
                /* Its filters draw in this shell's own bar, not in a second
                   band under it. See the node in the header. */
                railHost={railHost}
                /* The band is handed the entries this feed is drawing, so the
                   instructions and the cards are one list in one order.

                   Every callback below is hoisted and memoised rather than
                   written inline. This field is `memo`'d now, and one inline
                   arrow is enough to re-render all 83 of its cards on every
                   lens press -- which is what it was doing. */
                lead={feedLead}
                onSelect={openEntry}
                onProgress={onFeedProgress}
                onSelectionInvalid={onFeedSelectionInvalid}
              />
            </div>
          </div>
          {splitOpen && (
            <div className="min-w-0 flex-1">
              <IdeasWorkPane
                selection={selected?.selection ?? null}
                entry={selected?.entry ?? null}
                mode={workMode}
                onClose={closeHere}
              />
            </div>
          )}
        </div>
      </div>

    </div>
  )
}
