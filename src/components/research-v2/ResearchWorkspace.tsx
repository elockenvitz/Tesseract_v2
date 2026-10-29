/**
 * Desktop Research — the evidence workspace.
 *
 * Same shape as Desktop Ideas because the workflow is the same: browse a
 * visual scan of what needs attention, open one subject into the full canvas,
 * come back to the scan where you left it.
 *
 * Research creates EngagementTargets and nothing else. Ask AI and Team open
 * the existing CommunicationPane through the D1 seam — no AI panel, no chat
 * system, no comment table is defined here.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowUpRight, BookOpen } from 'lucide-react'
import {
  useResearchScan, useResearchExposure, useResearchDetail,
} from '../../hooks/useDesktopResearch'

/** Why the reader was sent, preserved so the workspace can say it. */
interface Arrival { issue?: string | null; origin?: string | null }
import {
  stateOf, whyItMatters, compareSubjects, issueFor, withCoverageSubjects, subjectFromCoverage,
  subscribeToOpenResearch, CORE_SECTIONS, SECTION_LABEL, STATE_TONE,
  dateWords, ageKindOf, targetFor,
  type ResearchSubject, type ResearchFocus,
} from '../../lib/desktop-research'
/* The same two engagements the Ideas field offers on a tile, through the
   shared dispatcher. `targetFor` is this lens's own, already used by the
   detail surface -- the tile had the capability and simply never exposed it. */
import { askAI, discuss, canDiscuss } from '../../lib/engagement'
import { useCoverageResearchGaps } from '../../hooks/useCoverageResearchGaps'
import {
  DesktopGallery, DesktopTile, TileState, TileIdentity, TileReason, TileMeta,
  TileFigure, TileLead, TileAction,
  sizeByRankWithRhythm, GallerySkeleton, type TileSize,
} from '../desktop/DesktopTile'
/* The shared price chart, anchored on the date the case was last written. */
import { TilePriceChart } from '../desktop/TilePriceChart'
/* The corner weight control, shared with Portfolio. */
import { TileWeightChip } from '../desktop/TileWeightChip'
/* The position behind that weight, so the panel answers what Portfolio's does. */
import { useSubjectWeightDetail } from '../../hooks/useSubjectWeightDetail'
/* Keyed by symbol with a five-minute staleTime, so a gallery on one name
   makes one request -- which is what makes a price affordable in this lens. */
import { useTileCloses, useGalleryCloses, type TileClose } from '../../hooks/useTileCloses'
import type { FocusIntent } from '../../lib/dashboard/focus'
import { ResearchDetail } from './ResearchDetail'
import { openAsset } from '../../lib/desktop-asset'
import {
  openDashboardFocus, type RailCard,
} from '../../lib/dashboard/focus'
import { clsx } from 'clsx'

/*
 * `STATE_TONE` -- Research state → shared severity -- now lives in
 * `lib/desktop-research/model.ts`, with the reasoning that produced its
 * values. It moved because the detail HEADER badges state as well as the
 * rail does, and a component importing a tone map from a sibling component
 * is how one fact ends up with two severities on two screens.
 */

export interface ResearchWorkspaceProps {
  selectedAssetId?: string | null
  focus?: ResearchFocus | null
  issue?: string | null
  /** Which surface sent the user. Named in the banner, never guessed. */
  origin?: string | null
  /** Set by the Dashboard deck when this lens is the expanded workspace. */
  focusObjectId?: string | null
  /**
   * Which part of the object the reader reached for on the way in.
   *
   * Passed straight through to the detail, which decides what it means for
   * this surface. The workspace does not interpret it: the same intent means
   * different things to a research surface and a portfolio one, and only the
   * surface knows which of its panels can answer it.
   */
  intent?: FocusIntent
  /** Reported once the arriving subject has actually been opened, so the shell
   *  can drop it from the tab. See `DashboardShellProps.onFocusConsumed`. */
  onFocusConsumed?: () => void
}

export function ResearchWorkspace({
  selectedAssetId, issue, origin, focusObjectId, intent, onFocusConsumed,
}: ResearchWorkspaceProps = {}) {
  const { subjects, isLoading } = useResearchScan()
  const { exposure, settled: exposureSettled } = useResearchExposure(subjects)
  const [arrival, setArrival] = useState<Arrival | null>(
    selectedAssetId ? { issue, origin } : null,
  )

  /*
   * One arrival, one opening -- the rule the Outcomes focus and the Trade Book
   * highlight both follow. The id stays on the tab for the life of that tab,
   * so honouring it on every render would re-open the same subject on every
   * later visit. Reset when a DIFFERENT asset arrives, so a second hand-off
   * into an already-open tab is still honoured.
   */
  const [arrivalConsumed, setArrivalConsumed] = useState(false)
  const lastArrivalRef = useRef<string | null>(selectedAssetId ?? null)

  useEffect(() => {
    if (!selectedAssetId) return
    setArrival({ issue, origin })
    if (lastArrivalRef.current !== selectedAssetId) {
      lastArrivalRef.current = selectedAssetId
      setArrivalConsumed(false)
    }
  }, [selectedAssetId, issue, origin])

  const scanned = useMemo(() => subjects
    .map(s => ({ ...s, weightPct: exposure[s.assetId] }))
    .sort(compareSubjects), [subjects, exposure])

  /*
   * The field: research on record, then work Tesseract can see on the reader's
   * coverage filling whatever capacity that left (lib/desktop-research/
   * coverage-subjects). Generated subjects are ordinary subjects from here on:
   * same tile, same rail, same detail, same navigation.
   */
  const gaps = useCoverageResearchGaps()
  const ranked = useMemo(
    () => withCoverageSubjects(scanned, gaps.candidates),
    [scanned, gaps.candidates],
  )

  /* Every tile's price in ONE batched read, rather than one request per tile
     resolving on its own schedule and reflowing its card when it lands. The
     same hook and the same reasoning as the Ideas field. */
  const { map: fieldCloses } = useGalleryCloses(useMemo(
    () => ranked.map(s => s.symbol),
    [ranked],
  ))

  /**
   * Selection lives in the deck, not here.
   *
   * The lens draws the field and says which card was chosen; the Dashboard
   * shell holds which card is expanded, which deck it came from and where
   * Back goes. That separation is what lets a card opened from Today expand
   * into a research workspace while Back still says Today.
   */
  /*
   * The deck first, then the arrival.
   *
   * `focusObjectId` is a card opened inside this lens and must always win.
   * `selectedAssetId` is the tab payload -- Today's "update this thesis",
   * Portfolio's "open the research", the asset strip. This read
   * `focusObjectId ?? null`, so every one of those producers landed on the
   * gallery with nothing open, and the `issue` string that travelled four
   * layers to say WHY the reader was sent was never shown either: `arrival`
   * feeds `arrivedFor`, which only renders inside the detail pane.
   */
  const activeId = focusObjectId ?? (arrivalConsumed ? null : selectedAssetId ?? null)
  /*
   * A coverage name opened from elsewhere (Today's backfill) may sit below the
   * capacity this field shows. It is still the reader's coverage work, so it
   * opens as the same generated subject rather than as "nothing on record".
   */
  const requested = activeId
    ? ranked.find(s => s.assetId === activeId)
      ?? (() => {
        const c = gaps.candidates.find(x => x.assetId === activeId)
        return c ? subjectFromCoverage(c) : null
      })()
    : null
  const missing = !!activeId && !requested

  /*
   * Spent only once it actually opened something. Marking it on arrival would
   * lose the hand-off whenever the scan had not answered yet -- the id would
   * clear a render before the subject it names exists. A payload naming an
   * asset this lens genuinely has nothing on stays unconsumed and falls to
   * `NothingOnRecord`, which is the honest answer rather than a silent no-op.
   */
  useEffect(() => {
    if (arrivalConsumed || focusObjectId || !requested) return
    setArrivalConsumed(true)
    // And tell the shell, so the id leaves the tab rather than lingering for
    // `lib/ai/context-selection` to bind the subject chip from.
    onFocusConsumed?.()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [arrivalConsumed, focusObjectId, requested])

  // Nothing deep is fetched while browsing, or when a request missed.
  const { detail } = useResearchDetail(requested)
  /*
   * The field's weight distribution is no longer computed here.
   *
   * It existed for one consumer: the tile's `TileBar`, which drew each stake
   * against the set it belongs to rather than against the largest member.
   * That bar has gone -- the tile's corner chip states the same percentage
   * and names the book -- so the field stopped needing to know its own
   * distribution. Restoring the bar means restoring `maxWeight` and
   * `weights` with it.
   */

  /** Expand a card. The rail travels with it, built from what is already here. */
  const open = (s: ResearchSubject) => openDashboardFocus({
    target: {
      originLens: 'research',
      workspaceLens: 'research',
      objectType: 'asset',
      objectId: s.assetId,
      symbol: s.symbol,
      label: s.companyName,
      issue: issueFor(s),
      origin: 'research',
    },
    backLabel: 'Research',
    rail: ranked.map(toRailCard),
  })

  useEffect(() => subscribeToOpenResearch(r => {
    const found = ranked.find(s => s.assetId === r.assetId)
    if (found) open(found)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [ranked])

  /*
   * Hold until everything that can change the ORDER has answered.
   *
   * `ranked` decides each tile's index and `ranked.length` its total, and
   * `sizeByRank(i, total)` reads both -- so a late input does not merely
   * reorder the gallery, it resizes every tile in it. Two inputs qualify:
   * `exposure`, a term in `scoreOf` and therefore in `compareSubjects`, and
   * the generated coverage subjects that `withCoverageSubjects` appends.
   *
   * The coverage gate is no longer conditional on `!scanned.length`. Waiting
   * only when there was nothing on record meant a desk WITH research painted
   * its real subjects, then re-sorted and re-sized all of them when the
   * generated ones appended -- the more established the desk, the worse the
   * jump.
   */
  if (isLoading) return <Loading />
  if (!exposureSettled || gaps.status === 'loading') return <Loading />
  /* A failed or org-less coverage scan is not an empty record. */
  if (!ranked.length && !requested && (gaps.status === 'error' || gaps.status === 'no_org')) {
    return <ScanUnavailable />
  }
  if (!ranked.length && !requested) return <Empty />

  if (activeId) {
    if (missing || !requested) {
      return (
        <NothingOnRecord
          assetId={activeId}
          issue={arrival?.issue ?? null}
          origin={arrival?.origin ?? null}
        />
      )
    }
    return (
      <ResearchDetail
        subject={requested}
        detail={detail}
        arrivedFor={arrival?.issue ?? null}
        arrivedFrom={arrival?.origin ?? null}
        intent={intent}
      />
    )
  }

  /* The ground is stated on the scroll box below, not inherited. Measured,
     that element was transparent and the field showed through to the shell's
     `bg-gray-50/60` -- about #fcfcfd against white cards, so the tiles had no
     edge at all. Today settled this first and Ideas took the same pair; this
     is the third lens of five to carry it, not a third answer. */
  return (
    <div
      className="h-full overflow-y-auto bg-gray-100 dark:bg-[#070a10]"
      data-testid="research-lens"
    >
      <DesktopGallery
        title="Research"
        count={ranked.length}
        note={
          <p className="max-w-[74ch] text-[12px] text-gray-600 dark:text-gray-400">
            Names that need new research reviewed, a thesis revisited, or a
            thesis written.
          </p>
        }
      >
        {ranked.map((s, i) => (
          <SubjectTile
            key={s.assetId}
            subject={s}
            /* Ranked, with a larger cell every few rows past the leading band.
               The monotonic grade flattened into an unbroken run of compacts
               below the fold; the rhythm is positional, so nothing is promoted
               for having a chart to draw. */
            size={sizeByRankWithRhythm(i, ranked.length)}
            onOpen={() => open(s)}
            closesIn={fieldCloses.get(s.symbol ?? '')}
          />
        ))}
      </DesktopGallery>
    </div>
  )
}

/**
 * A research subject as a rail card.
 *
 * The state leads, then the fact that makes it matter: how much arrived, or
 * how long since anyone looked, or what we own. Never a bare ticker and a
 * percentage -- the rail has to make a reader want to open something.
 */
export function toRailCard(s: ResearchSubject): RailCard {
  const state = stateOf(s)
  const arrivals = s.newSinceReview

  /*
    Each state leads with the fact that state is ABOUT, so a column of research
    cards does not read as four copies of "ticker, number, sentence".

      arrival   what came in -- its title where there is one, its count where
                there are several
      absence   what the case is missing, and what we hold anyway
      age       how long since anyone looked
  */
  if (state === 'evidence-since-review') {
    return {
      id: s.assetId, workspaceLens: 'research', objectType: 'asset',
      symbol: s.symbol, reason: issueFor(s), tone: STATE_TONE[state],
      figure: arrivals > 1 ? String(arrivals) : null,
      figureLabel: arrivals > 1 ? 'new items' : null,
      secondary: s.weightPct != null
        ? { value: `${s.weightPct.toFixed(1)}%`, label: 'held' } : null,
      detail: arrivals === 1 && s.newestEvidenceTitle
        ? s.newestEvidenceTitle
        : `${arrivals} arrived ${dateWords(ageKindOf(s)).sinceThe}`,
      issue: issueFor(s),
    }
  }

  if (state === 'moved-since-review') {
    const m = s.generated?.movePct
    return {
      id: s.assetId, workspaceLens: 'research', objectType: 'asset',
      symbol: s.symbol, reason: issueFor(s), tone: STATE_TONE[state],
      figure: m != null ? `${m >= 0 ? '+' : ''}${m.toFixed(1)}%` : null,
      figureLabel: m != null ? dateWords(ageKindOf(s)).since : null,
      secondary: s.weightPct != null
        ? { value: `${s.weightPct.toFixed(1)}%`, label: 'held' } : null,
      detail: whyItMatters(s),
      issue: issueFor(s),
    }
  }

  if (state === 'no-thesis' || state === 'incomplete-thesis') {
    const missing = CORE_SECTIONS.filter(k => !s.coreSections.includes(k))
      .map(k => SECTION_LABEL[k] ?? k)
    return {
      id: s.assetId, workspaceLens: 'research', objectType: 'asset',
      symbol: s.symbol, reason: issueFor(s), tone: STATE_TONE[state],
      figure: s.weightPct != null ? `${s.weightPct.toFixed(1)}%` : null,
      figureLabel: s.weightPct != null ? 'held' : null,
      /*
        No "N on file".

        It read as "1 ON FILE" under a ticker and answered no question a
        reader was asking: one WHAT, on whose file, and so what? The count
        that matters on a card with no thesis is the weight behind it, and
        where a reader does want the number it is a labelled row -- "Research
        on file" -- in the weight chip's own panel. The same span was removed
        from the tile body three passes ago for the same reason and survived
        here, as the rail card's secondary figure.
      */
      secondary: null,
      // Generated work says why it matters on this name; otherwise the missing
      // structure, named. Never a completion score.
      detail: s.generated ? whyItMatters(s) : missing.length ? `Missing: ${missing.join(', ')}` : whyItMatters(s),
      issue: issueFor(s),
    }
  }

  return {
    id: s.assetId, workspaceLens: 'research', objectType: 'asset',
    symbol: s.symbol, reason: issueFor(s), tone: STATE_TONE[state],
    figure: s.daysSinceReview != null ? `${s.daysSinceReview}d` : null,
    figureLabel: s.daysSinceReview != null ? 'since the case' : null,
    secondary: s.weightPct != null
      ? { value: `${s.weightPct.toFixed(1)}%`, label: 'held' } : null,
    detail: `${s.evidenceCount} research item${s.evidenceCount === 1 ? '' : 's'} on record`,
    issue: issueFor(s),
  }
}

/**
 * One subject in the scan.
 *
 * ── Three states that must not look alike ────────────────────────────────
 *
 * Something ARRIVED, something was never WRITTEN, something has not been
 * LOOKED AT. These are different problems and they get different compositions,
 * not one rectangle with a different word in the pill.
 *
 * ── The object is the visual ─────────────────────────────────────────────
 *
 * A single arriving note leads with the note: its title set as a headline, its
 * author and date beneath. That is what a reader wants to see, and it is
 * already loaded. A missing thesis leads with the shape of what is missing --
 * three named sections, struck through -- because absence has a structure and
 * prose about it does not.
 *
 * Nothing here charts. Research's scan holds no price series, and fetching one
 * per card to decorate a gallery is exactly the cost this must not add.
 */
function SubjectTile({
  subject, size, onOpen, closesIn,
}: {
  subject: ResearchSubject
  size: TileSize; onOpen: () => void
  /** This name's closes out of the field's one batched read. */
  closesIn?: TileClose[]
}) {
  const state = stateOf(subject)
  const tone = STATE_TONE[state]
  /* What the shelf's two engagements act on. Null for a subject that has no
     object to thread -- the actions are then simply not offered, rather than
     offered and silently inert. */
  const engage = targetFor(subject)
  const talkable = !!engage && canDiscuss(engage)
  const arrivedDays = subject.newestEvidenceAt ? daysSince(subject.newestEvidenceAt) : null
  const big = size === 'hero' || size === 'large'

  /*
   * ── The price, handed down from the field ────────────────────────────────
   *
   * This lens deliberately drew no chart: "fetching one per card to decorate
   * a gallery is exactly the cost this must not add." Caching by symbol made
   * that affordable, but it did not make it ONE read -- thirteen tiles still
   * opened thirteen round trips, each resolving on its own schedule and each
   * arrival changing its card's height as the chart appeared. Ideas measured
   * the same pattern at 56 tiles and moved to a batched fetcher; this is the
   * same move, and `useGalleryCloses` is the same hook.
   *
   * `closesIn` is optional so a test that renders one tile directly still
   * works: with no batch to belong to it falls back to the single-symbol
   * hook, exactly as the Ideas tile does.
   *
   * The constraint that survives is the real one: the price never displaces
   * this lens's own answer. See `trailing` below.
   */
  const solo = useTileCloses(closesIn ? null : subject.symbol)
  const closes = closesIn ?? solo.data ?? []

  /*
   * ── One object per tile, chosen by what this lens is asking ──────────────
   *
   * The price is the LAST rung, never a displacement. This lens's own answers
   * come first:
   *
   *   timeline  how long the case has stood and what landed since. This is
   *             the question Research asks, and it covers both "new evidence
   *             since I looked" and "this review is going stale".
   *   weight    the share of the queue, which is why an unreviewed thesis
   *             matters at all.
   *   spark     the price -- only where NEITHER of those drew anything.
   *
   * Both existing objects keep their original conditions untouched, so no
   * tile that already had a visual changes. What changes is the tile that had
   * none: the no-thesis card, which this lens excludes from both, and the
   * medium card, which was never given either.
   *
   * Nothing is invented where there are no rows. A name with no stored closes
   * draws no chart rather than a flat line through a made-up series, which is
   * most of the reason this lens avoided price in the first place.
   */
  /**
   * Whether the claim sentence is the eyebrow chip in longer words.
   *
   * `coverageWorkLabel` and `coverageWorkClaim` describe the same finding at
   * two lengths. For a HELD name with no case they converge completely: the
   * chip reads "Position without a thesis", the sentence reads "A live
   * position with no written thesis behind it", and the missing-parts block
   * added a third "No written case" on top of both.
   *
   * Decided from the context rather than by comparing the two strings. A first
   * attempt did compare them -- every word of the chip present in the sentence
   * -- and it failed on "without" against "with no", which is exactly how a
   * clever textual rule earns its keep right up until it silently stops. The
   * condition is a fact about the subject, so it is read as one.
   *
   * The other two contexts keep their sentences, because they say something
   * the chip does not: `idea` names the open ideas being worked without a
   * case, `unheld` names the coverage relationship.
   */
  const absenceIsRestated =
    subject.generated?.context === 'held' && state === 'no-thesis'

  /** Two columns only where there is width AND a price to put in the second. */
  /* `bigTwoCol` is gone with the two-column layout it named: the card stacks
     now, and whether a chart draws is `drawsChart` alone. */

  /*
   * ── The chart is not in competition with anything ────────────────────────
   *
   * It used to be the last rung of a ladder: the standing-window timeline won
   * the slot if there was a review date, the share-of-queue bar won it if
   * there was a weight, and only a subject with NEITHER got a price. Which
   * meant the names with the most recorded about them showed no chart at all,
   * and the rule was invisible from the outside -- it looked like the chart
   * came and went by name.
   *
   * A price is not an alternative to a review date or a weight. It answers a
   * different question and it is drawn for every subject that has closes.
   */
  /*
   * Compact included.
   *
   * The cut was at medium, so the whole second row of the gallery drew no
   * price at all -- and those are the cards with the least else on them, where
   * a line is the only thing that distinguishes one from the next. A compact
   * tile has room for a short chart; it does not have room for nothing.
   */
  const drawsChart = closes.length >= 2

  /**
   * What the weight is OF, for the corner.
   *
   * A weight belongs to ONE book. Naming a single book when three hold the
   * name states the wrong thing, so above one the corner counts them instead
   * and the panel carries the rest.
   */
  /*
   * The position behind the weight -- market value, shares, price, active
   * weight -- so the corner opens the same panel it does in Portfolio.
   *
   * Only asked where a single book holds the name: a weight belongs to one
   * book, and with several there is no one position to describe. Shares
   * `useBook`'s cache key with the Portfolio lens, so a reader who has opened
   * both pays for one read.
   */
  const weightDetail = useSubjectWeightDetail(
    (subject.generated?.portfolioCount ?? 0) === 1 ? subject.generated?.portfolioId : null,
    subject.assetId,
  )

  /*
   * A COUNT, never the book's name.
   *
   * Research can be looking across any number of books, so "weight" alone is
   * not enough here the way it is on Portfolio -- 5.4% of what. But a name in
   * the corner is a variable-length string in a fixed-width slot, and
   * "Tech & Consumer Growth" or longer simply truncates, which is worse than
   * not naming it: a half-name reads as a different book.
   *
   * So the corner counts the books and the panel names them. The count never
   * outgrows its space and is honest at any number.
   */
  const books = subject.generated?.portfolioCount ?? 0
  const weightCaption = books === 1
    ? 'in 1 portfolio'
    : books > 1
      ? `in ${books} portfolios`
      : 'weight'

  /*
   * ── Two visuals removed, because both were restatement ───────────────────
   *
   * `drawsTimeline` drew "Case updated · 1 new since", a track with a mark on
   * it, and "19 Feb · newest 20 Feb · today". Every one of those facts was
   * already on the card in words: the eyebrow said New research, the header
   * figure said 251d since update, and the body said when the note arrived.
   * 62px of card to say a fourth time what the reader had already read three
   * times.
   *
   * `drawsWeight` drew a bar captioned "Held, against the rest of the queue"
   * under a corner chip that states the same percentage and opens a panel
   * naming the book it is in. 30px for a second copy of one number.
   *
   * Between them they were taking 92px of a 452px card whose price chart had
   * been squeezed to 56px. The chart gets it.
   *
   * ── What was NOT removed ─────────────────────────────────────────────────
   *
   * `TileTimeline` stays in `DesktopTile` and is still exported. It is the
   * right drawing for a card whose question IS the window -- it is this
   * lens's tiles that already answered that question in prose above it.
   */
  /* Nothing reads these any more; the blocks they gated are gone. The
     reasoning stays here because this is where a future pass would add them
     back, and the question it has to answer first is what the card would
     then be saying twice. */
  /*
   * The no-thesis branch draws the chart inside its own body, so the trailing
   * one is skipped there -- that is the only remaining condition, and it is
   * about not drawing the SAME chart twice on one card, not about whether the
   * subject has earned one.
   */
  const composesOwnChart = drawsChart && (state === 'no-thesis' || state === 'incomplete-thesis')
  /*
   * ── A big card draws the slot even with nothing to put in it ─────────────
   *
   * This was `drawsChart && !composesOwnChart`, so a hero whose name has no
   * price history simply had no chart block -- and a hero's height is set by
   * its row-mate, not by its own content. Measured on COIN, which holds under
   * two closes in the cache: a 154px hole in the middle of a 452px card, then
   * a 101px hole after the text around it was cut, because the card still had
   * to stand as tall as PLTR beside it.
   *
   * Centring the claim in the space was tried first and is not an answer: it
   * halves one hole into two. The slot is drawn instead, and `TilePriceChart`
   * renders the caller's `empty` node in it -- the same seam Decisions uses
   * for exactly this. The space is then accounted for rather than blank, and
   * it says something true about the name.
   *
   * Only on the big sizes. A compact tile with no price would otherwise fill
   * most of itself with a dashed box saying so, which trades one bad use of
   * the space for another.
   */
  const drawsSpark = !composesOwnChart && (drawsChart || big)
  // The age, new-note count and move count from this date: a recorded review
  // only on a generated subject anchored on one (lib/desktop-research/anchor-words).
  const age = dateWords(ageKindOf(subject))

  return (
    <DesktopTile
      testId="research-tile"
      dataAttrs={{ 'data-state': state }}
      tone={tone}
      size={size}
      onOpen={onOpen}
      /*
        The hover shelf, as on Today and Ideas.
        Three lenses drew the same card and only two of them offered its
        actions: a reader who learned Open / Ask AI / Discuss on the Ideas
        field found bare tiles here. Nothing new is wired -- `targetFor` is
        this lens's own and the detail surface already uses it with these
        same two dispatchers. `canDiscuss` gates the second, because a
        subject with no thread-able object must not be offered one.
      */
      actions={<>
        <TileAction label="Open" onClick={onOpen} primary testId="research-open" />
        {engage && (
          <TileAction label="Ask AI" onClick={() => askAI(engage)} testId="research-ai" />
        )}
        {talkable && (
          <TileAction label="Discuss" onClick={() => discuss(engage!)} testId="research-discuss" />
        )}
      </>}
      eyebrow={<>
        <TileState tone={tone}>{issueFor(subject)}</TileState>
        {/* The age, where there is one. Where there is not, the chip beside
            this already says so -- "no thesis written" next to "No thesis on
            file" was the same sentence twice in one row. */}
        {subject.daysSinceReview != null && (
          <TileFigure>{`${subject.daysSinceReview}d ${age.since}`}</TileFigure>
        )}
        {/*
          The same corner control Portfolio uses, so a weight is a weight
          wherever the reader meets one.

          What it can open is less here, and deliberately so: Research's
          coverage rows carry the weight and the book, not the market value,
          the share count or the benchmark comparison. Those are Portfolio's
          own read of the book, and this lens does not load one -- inventing
          them, or showing a zero, would give the reader a number to act on
          that nothing stands behind.
        */}
        {subject.weightPct != null && (
          <TileWeightChip
            pct={subject.weightPct}
            testId="subject-weight"
            caption={weightCaption}
            details={[
              /* The book's name lives here, not in the corner: the panel can
                 wrap it, the corner would truncate it. */
              ...(subject.generated?.portfolioName
                ? [{ label: 'Book', value: subject.generated.portfolioName }]
                : []),
              ...(weightDetail?.details ?? []),
              ...(subject.generated?.liveIdeaCount
                ? [{ label: 'Open ideas', value: String(subject.generated.liveIdeaCount) }]
                : []),
              { label: 'Research on file', value: String(subject.evidenceCount) },
              ...(subject.daysSinceReview != null
                ? [{ label: `Last ${age.verb}`, value: `${subject.daysSinceReview}d ago` }]
                : []),
            ]}
          />
        )}
      </>}
    >
      <TileIdentity symbol={subject.symbol} name={subject.companyName} size={size} />

      {state === 'evidence-since-review' ? (
        subject.newSinceReview === 1 && subject.newestEvidenceTitle ? (
          /* One note. The note IS the card. */
          /*
            Not `flex-1` any more. This block held a headline, a date line and
            a footer pinned to the bottom with `mt-auto`, so it had to own the
            slack for the footer to sit where it did. With both those lines
            gone it holds one headline, and keeping the slack meant the claim
            stretched while the chart below it stayed at its floor -- on COIN,
            83px of nothing between the headline and the price slot. The
            chart takes the slack now, which is where the reader wants it.
          */
          <div className="flex min-w-0 flex-col">
            <p className={clsx(
              'font-medium leading-[1.3] text-gray-900 dark:text-gray-100',
              size === 'hero' ? 'line-clamp-3 text-[26px] tracking-tight'
                : size === 'large' ? 'line-clamp-2 text-[19px]'
                : 'line-clamp-2 text-[14px]',
            )}>
              {subject.newestEvidenceTitle}
            </p>
            {/*
              ── Two lines removed, and where each of them already was ───────

              This card carried the note's title, then its date, then a line
              saying a note had arrived since the review -- and then a
              timeline drawing the same two dates again, and then a weight bar
              drawing the number already in the corner chip. Measured on PLTR
              at 923x452: 138px of that card was restatement and 56px was the
              price chart.

              `{date} · {n}d ago`      the corner panel's "Last reviewed" row
                                       carries the age, and the header's
                                       figure carries the days since update.
              `1 new note since …`     the eyebrow already reads "New
                                       research", which is what that sentence
                                       says in five more words.

              What stays is what nothing else on the card says: the note's own
              headline. It is the claim somebody wrote, and it is now the only
              prose on the card.
            */}
          </div>
        ) : (
          /* Content-height, so the trailing chart takes the slack -- the
             same correction as the two branches below. */
          <div className="flex min-w-0 flex-col">
            <TileLead
              figure={subject.newSinceReview}
              label={<>new notes since<br />{age.sinceThe.replace(/^since /, '')}</>}
              tone="review"
            />
            {big && subject.newestEvidenceTitle && (
              <p className="mt-3 line-clamp-2 text-[14px] font-medium leading-snug text-gray-900 dark:text-gray-100">
                {subject.newestEvidenceTitle}
              </p>
            )}
            {/* `N on file` is gone -- the corner chip's panel carries it.
                What stays is the one fact nothing else on this card says:
                how recently the newest of those notes landed. */}
            {arrivedDays != null && (
              <TileMeta>
                <span>newest {arrivedDays === 0 ? 'today' : `${arrivedDays}d ago`}</span>
              </TileMeta>
            )}
          </div>
        )
      ) : state === 'no-thesis' || state === 'incomplete-thesis' ? (
        /*
          ── One statement of the absence, and the width used ────────────────

          A held name with no case said it three times: the eyebrow chip
          ("Position without a thesis"), the claim sentence ("A live position
          with no written thesis behind it") and the missing-parts block ("No
          written case"). Three sentences, one fact, and the card still had to
          fit a chart underneath them.

          Now: the chip states the condition, the left column names WHICH parts
          are missing -- the only part of that trio that adds anything -- and
          the right column takes the price at a size worth reading. Where the
          claim genuinely says something the chip does not (an idea being
          worked, a position the gap puts at risk) it survives; where it is the
          chip restated it does not. See `absenceIsRestated`.
        */
        /*
          ── Text across the top, chart across the bottom ────────────────────

          Not a left/right split. Splitting the card put the chart in half the
          width and left the text in a narrow column that wrapped more, which
          is worse for both: a price line wants width, and a short run of facts
          does not want a column.

          So the card stacks. The facts run ACROSS the full width in one
          wrapping row -- what is missing, what it weighs, what is on file --
          rather than stacking into four short lines, and the chart takes the
          whole width beneath them and all the height that is left.
        */
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          {/*
            Generated work leads with why it matters on this name -- the
            position the gap puts at risk, or the idea being worked without a
            case. Suppressed where that sentence is the eyebrow again.
          */}
          {subject.generated && !absenceIsRestated && (
            <div data-testid="research-tile-reason">
              <TileReason>{whyItMatters(subject)}</TileReason>
            </div>
          )}

          {/*
            One row, wrapping, instead of a stack.

            Which parts are missing is the finding and leads; the weight, the
            book, the open ideas and what is on file are context and follow it
            on the same line. At hero width they fit comfortably on one row --
            which is the horizontal space the stacked version was leaving
            empty to the right of every short line.
          */}
          {/*
            ── Gated, because the row can now be empty ─────────────────────

            It used to be unconditional, and the thing guaranteeing it had
            content was the "N research on file" span -- which was the
            duplicative half. With that gone and `MissingThesis` silent on a
            name with nothing written, a held no-thesis card would render an
            empty 11px line box and the `gap-2` above it. The row draws when
            it has a fact to carry.
          */}
          {((!subject.generated || big) && subject.coreSections.length > 0
            || !!subject.generated?.liveIdeaCount) && (
            <div
              data-testid="research-tile-facts"
              className="flex min-w-0 flex-wrap items-baseline gap-x-5 gap-y-1 text-[11px] text-gray-500"
            >
              {(!subject.generated || big) && (
                <MissingThesis present={subject.coreSections} size={size} />
              )}
              {/* No weight line here: the corner states it, names the book it
                  is in, and opens the rest. Saying it twice on one card is
                  what the previous pass removed. */}
              {/*
                And no "N research on file" either. The corner chip's panel
                carries a "Research on file" row with the same count, which
                is where a reader goes for it -- and "Nothing on file yet"
                was a third way of saying the absence the chip states.
              */}
              {!!subject.generated?.liveIdeaCount && (
                <span className="font-semibold text-gray-800 dark:text-gray-200">
                  {subject.generated.liveIdeaCount} open idea{subject.generated.liveIdeaCount === 1 ? '' : 's'}
                </span>
              )}
            </div>
          )}

          {/* Full width, and all the height the facts above did not use. At
              every size: this branch is where the smallest cards land, and
              gating it on `big` is what left the gallery's second row with no
              price at all. */}
          {drawsChart && (
            <div className="min-h-0 flex-1">
              <TilePriceChart
                points={closes}
                anchorISO={subject.thesisUpdatedAt ?? null}
                anchorLabel="review"
                fill
                /* The small sizes match the trailing chart's -- see the note
                   there. The two must not disagree: this branch and that one
                   land side by side in the same gallery row. */
                height={size === 'hero' ? 190 : size === 'large' ? 160 : size === 'medium' ? 104 : 96}
              />
            </div>
          )}
        </div>
      ) : state === 'moved-since-review' ? (
        /* The move is the finding: the figure leads, the case's age beneath. */
        /*
          ── No `flex-1`, and no footer to need it ─────────────────────────

          This block was `flex-1` with its meta row pinned to the bottom by
          `mt-auto`, which made it claim the card's whole slack -- while the
          trailing chart, a `flex-1` sibling with a `minHeight` floor it
          cannot go below, was pushed down and then spilled out of the tile.
          Measured on the stale band at 1920x889: the chart started 164px
          into a 260px tile and ended 28px PAST its bottom edge, which is the
          "moved down and squished" in rows three and four.

          The footer it was holding slack for is gone -- "14.2% held" is the
          corner chip and "1 research on file" is that chip's panel -- so
          the block is the height of its own text and the chart takes the
          rest, exactly as it does on the no-thesis cards in row two.
        */
        <div className="flex min-w-0 flex-col">
          <TileLead
            figure={`${(subject.generated?.movePct ?? 0) >= 0 ? '+' : ''}${(subject.generated?.movePct ?? 0).toFixed(1)}`}
            unit="%"
            label={<>{age.sinceTheLines[0]}<br />{age.sinceTheLines[1]}</>}
            tone="review"
          />
        </div>
      ) : (
        /*
          ── The band that was overflowing ────────────────────────────────

          Same shape as the move branch above and the same fix: `flex-1` plus
          an `mt-auto` footer, so the text claimed the slack and the chart
          below it was pushed out of the card. This is the branch the whole
          stale band lands in -- rows three and four of the gallery -- so it
          is where the defect was reported.

          The footer carried three facts and the card already carried all
          three: "N research on file" is a row in the corner chip's panel,
          "N% held" is the chip itself, and the review age is the eyebrow
          figure beside it. `sectionCount` went with them rather than being
          kept alone: a 27px row and its 12px gap to carry a count of thesis
          headings is not a trade this card can make against its only chart.
          The detail pane still states it.
        */
        <div className="flex min-w-0 flex-col">
          {big ? (
            <TileLead
              figure={subject.daysSinceReview ?? 0}
              unit="days"
              label={<>{age.sinceTheLines[0]}<br />{age.sinceTheLines[1]}</>}
              tone={tone === 'review' ? 'review' : 'neutral'}
            />
          ) : (
            <TileReason>{whyItMatters(subject)}</TileReason>
          )}
        </div>
      )}

      {/* The timeline that used to sit here is gone -- see the note beside
          the removed flags above. */}

      {/*
        The price, where this lens has no standing window to draw instead.

        Measured from the date the case was last written where there is one,
        so the line answers "what has the market done since we argued this"
        rather than being an undated decoration. Where no review date exists
        -- the no-thesis card -- it shows the history it has and says so,
        which the shared component handles by refusing the since-claim.
      */}
      {drawsSpark && (
        <div className={clsx('min-h-0 flex-1', big ? 'mt-3' : 'mt-2')}>
          <TilePriceChart
            points={closes}
            anchorISO={subject.thesisUpdatedAt ?? null}
            anchorLabel="review"
            fill
            /*
              ── Why the small sizes went up ────────────────────────────────

              64px of plot was the reported "squished", and it was a real
              mismatch rather than a preference: measured at 1920x889, the
              `large` cards in row two drew 85-100px plots from their own box
              while the compacts in rows three and four sat pinned at 64 --
              same component, same width (455px tiles, 429px plots), a 6.7:1
              aspect against row two's 4.3:1. A line that flat reads as a
              different, lesser chart.

              The room is the room the duplicative footer was using. Each of
              these cards shed a 27px meta row and its 12px gap when "N
              research on file · N sections · N% held" came off, and this is
              where it goes -- so the card is no taller than it was before
              that line was removed, and the chart is what grew.
            */
            height={big ? 110 : size === 'medium' ? 104 : 96}
            empty={
              <div
                data-testid="research-price-empty"
                className="flex h-full min-h-0 flex-col justify-center rounded border border-dashed border-gray-200 px-3 text-[10px] text-gray-400 dark:border-white/10"
              >
                <span className="font-semibold uppercase tracking-[0.09em]">No price history</span>
                {/* What the reader can do about it, not what the cache did.
                    "No data" with no cause is what sent the Decisions column
                    round three diagnosis passes. */}
                <span className="mt-0.5 normal-case tracking-normal">
                  {subject.symbol ?? 'This name'} is not in the price cache yet
                </span>
              </div>
            }
          />
        </div>
      )}

      {/* The weight bar that used to sit here is gone -- the corner chip
          states the same number and names the book it is in. */}
    </DesktopTile>
  )
}

/**
 * The three sections a thesis is made of, and which of them exist.
 *
 * A skeleton rather than a sentence: "no thesis has been written" is one line
 * of prose that leaves a card empty, while three struck-through names show at
 * a glance that nothing has been argued. Never a completion score -- the
 * question is whether the case makes its argument, not whether a form is full.
 */
function MissingThesis({ present, size }: { present: string[]; size: TileSize }) {
  const big = size === 'hero' || size === 'large'

  /*
   * ── Nothing written is one finding, not three ────────────────────────────
   *
   * This checklist earns its space when SOME sections are written: "Thesis
   * written / Where we differ — / Risks —" tells a reader exactly what is
   * left, and that is the shape of the remaining work.
   *
   * When none are, every row is a dash. Three labelled rows of nothing look
   * like content, so a reader scans all three before finding that out, and
   * they occupy the whole card while doing it. The finding -- that this
   * subject has no written case at all -- is one fact and gets one line.
   *
   * No chart is put in the freed space, deliberately. Research's scan holds
   * no price series and fetching one per card to decorate a gallery is the
   * cost this lens is built to avoid. The gain here is the room, not a
   * replacement object.
   */
  if (present.length === 0) {
    /*
      No "No written case" heading.

      It was the third statement of one fact: the eyebrow chip says it, the
      claim sentence said it, and this said it again -- and the chip is
      already the heading, sitting directly above this on the same card.

      What survives is the only part of that trio that adds anything: WHICH
      parts are missing, named. The labels keep their own capitalisation;
      lowercasing them to make the line read as prose stopped the card naming
      them, which is the half a reader needs -- not "something is missing" but
      which three things.
    */
    /*
      ── And now the one line goes too ──────────────────────────────────────

      "No Thesis · no Where we differ · no Risks to thesis" was the last
      survivor of a trio that said the same thing three times, and it is
      still the eyebrow chip in longer words: the chip directly above it
      reads "No thesis on file". Naming the three parts looked like it added
      something -- not "something is missing" but which three things -- and
      on a name with NOTHING written those three things are the whole thesis.
      "No thesis" and "no thesis, no where we differ, no risks" are one fact.

      The checklist below is untouched, and that is the distinction: with
      some sections written it tells the reader what is LEFT, which the chip
      cannot. With none written there is no remaining work to describe, only
      the absence the chip already states.
    */
    return null
  }

  return (
    <ul className="flex flex-col gap-1.5">
      {CORE_SECTIONS.map(k => {
        const have = present.includes(k)
        return (
          <li key={k} className="flex items-baseline gap-3">
            <span className={clsx(
              'font-medium',
              big ? 'text-[16px]' : 'text-[12px]',
              have ? 'text-gray-900 dark:text-gray-100' : 'text-gray-400 dark:text-gray-500',
            )}>
              {SECTION_LABEL[k] ?? k}
            </span>
            <span aria-hidden className={clsx(
              'mb-1 flex-1 border-b border-dashed',
              have ? 'border-gray-300 dark:border-white/20' : 'border-gray-200 dark:border-white/10',
            )} />
            <span className={clsx(
              'font-mono',
              big ? 'text-[15px]' : 'text-[12px]',
              have ? 'text-gray-700 dark:text-gray-300' : 'text-gray-300 dark:text-gray-600',
            )}>
              {have ? 'written' : '—'}
            </span>
          </li>
        )
      })}
    </ul>
  )
}

function daysSince(iso: string): number {
  return Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000))
}

/* The canonical gallery skeleton, in the ranked flow this lens uses, so the
   handover is a fade rather than a re-layout. */
function Loading() {
  return <GallerySkeleton title="Research" />
}

/**
 * Asked for a name Research has nothing on.
 *
 * Says so, rather than opening the next name down and letting the arrival
 * banner attribute someone else's case to the asset the reader asked about.
 */
/**
 * Asked for a name Research has nothing on.
 *
 * Says so, rather than opening the next name down and letting the arrival
 * banner attribute someone else's case to the asset the reader asked about.
 * The asset still exists, so the way forward is offered.
 */
function NothingOnRecord({
  assetId, issue, origin,
}: { assetId: string; issue: string | null; origin: string | null }) {
  return (
    <div className="px-6 pt-6">
      <div className="max-w-[62ch] rounded-xl border border-dashed border-gray-300 bg-white px-6 py-10 dark:border-white/15 dark:bg-[#141a25]">
        <h2 className="text-[16px] font-semibold">Nothing on record for that name yet</h2>
        <p className="mt-1.5 text-[12px] text-gray-600 dark:text-gray-400">
          Nothing on file for this name — no thesis, no research notes.
          {issue && ` You arrived${origin ? ` from ${ARRIVAL_ORIGIN[origin] ?? origin}` : ''} for: ${issue}.`}
        </p>
        <button
          type="button"
          onClick={() => openAsset({ assetId, focus: 'research', issue, origin: 'research' })}
          className="mt-4 inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[12px] font-semibold text-blue-700 hover:bg-blue-50 dark:text-blue-400 dark:hover:bg-blue-950/30"
        >
          Open the asset anyway
          <ArrowUpRight className="h-3 w-3" />
        </button>
      </div>
    </div>
  )
}

/** Sender names, shared with the arrival banner's vocabulary. */
const ARRIVAL_ORIGIN: Record<string, string> = {
  today: 'Dashboard', portfolio: 'Portfolio', ideas: 'Ideas', decisions: 'Decisions',
}

/**
 * The scan could not be read.
 *
 * "No recorded evidence yet" says the desk has written nothing down. A failed
 * or org-less coverage scan says we could not find out, which is the opposite
 * kind of news and must not be delivered as the reassuring one.
 */
function ScanUnavailable() {
  return (
    <div className="h-full overflow-y-auto bg-gray-50/60 px-6 pt-6 dark:bg-[#0b0f16]">
      <h1 className="text-[21px] font-semibold tracking-tight">Research</h1>
      <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50/60 px-6 py-16 text-center dark:border-amber-900/40 dark:bg-amber-950/20">
        <h2 className="text-[17px] font-semibold">Research could not be loaded</h2>
        <p className="mx-auto mt-1.5 max-w-[46ch] text-[12px] text-gray-600 dark:text-gray-400">
          This is a failed read, not an empty record. Reload to try again.
        </p>
      </div>
    </div>
  )
}

function Empty() {
  return (
    <div className="h-full overflow-y-auto bg-gray-50/60 px-6 pt-6 dark:bg-[#0b0f16]">
      <h1 className="text-[21px] font-semibold tracking-tight">Research</h1>
      <div className="mt-4 rounded-xl border border-gray-200 bg-white px-6 py-16 text-center shadow-sm dark:border-white/[0.08] dark:bg-[#141a25]">
        <BookOpen className="mx-auto h-7 w-7 text-gray-400" />
        <h2 className="mt-4 text-[17px] font-semibold">No recorded evidence yet</h2>
        <p className="mx-auto mt-1.5 max-w-[46ch] text-[12px] text-gray-600 dark:text-gray-400">
          Names appear here once they have a thesis or a research note on file.
        </p>
      </div>
    </div>
  )
}
