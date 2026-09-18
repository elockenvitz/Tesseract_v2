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
  subscribeToOpenResearch, CORE_SECTIONS, SECTION_LABEL,
  dateWords, ageKindOf, thesisDateKindOf,
  type ResearchSubject, type ResearchFocus,
} from '../../lib/desktop-research'
import { useCoverageResearchGaps } from '../../hooks/useCoverageResearchGaps'
import {
  TileTimeline,
  DesktopGallery, DesktopTile, TileState, TileIdentity, TileReason, TileMeta,
  TileFigure, TileVisual, TileBar, TileLead,
  sizeByRank, GallerySkeleton, type TileSize,
} from '../desktop/DesktopTile'
/* The shared price chart, anchored on the date the case was last written. */
import { TilePriceChart } from '../desktop/TilePriceChart'
/* The corner weight control, shared with Portfolio. */
import { TileWeightChip } from '../desktop/TileWeightChip'
/* The position behind that weight, so the panel answers what Portfolio's does. */
import { useSubjectWeightDetail } from '../../hooks/useSubjectWeightDetail'
/* Keyed by symbol with a five-minute staleTime, so a gallery on one name
   makes one request -- which is what makes a price affordable in this lens. */
import { useTileCloses } from '../../hooks/useTileCloses'
import type { FocusIntent } from '../../lib/dashboard/focus'
import { ResearchDetail } from './ResearchDetail'
import { openAsset } from '../../lib/desktop-asset'
import {
  openDashboardFocus, type RailCard,
} from '../../lib/dashboard/focus'
import { clsx } from 'clsx'
import type { SemanticTone } from '../../lib/semantic-tone'

/**
 * Research state → shared severity.
 *
 * `no-thesis` was rose here while Portfolio painted the identical condition
 * amber. One fact, two screens, two severities. A case nobody has written is
 * work outstanding, not a framework that has broken, so it is `review` on both.
 *
 * `current` loses its emerald for `neutral`: a green badge on every healthy
 * name is decoration that dilutes the two tones carrying meaning.
 */
const STATE_TONE: Record<string, SemanticTone> = {
  'evidence-since-review': 'review',
  'moved-since-review': 'review',
  'no-thesis': 'review',
  'incomplete-thesis': 'review',
  stale: 'review',
  thin: 'neutral',
  current: 'neutral',
}

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
  const maxWeight = ranked.reduce((m, r) => Math.max(m, r.weightPct ?? 0), 0)
  /*
   * Every held stake in the queue, so a tile can draw the set it belongs to
   * rather than a bar filled against its largest member -- which is 100% full
   * for that largest member, the one a reader is most likely looking at.
   */
  const weights = ranked
    .map(r => r.weightPct)
    .filter((w): w is number => w != null && w > 0)

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

  return (
    <div className="h-full overflow-y-auto" data-testid="research-lens">
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
            maxWeight={maxWeight}
            weights={weights}
            size={sizeByRank(i, ranked.length)}
            onOpen={() => open(s)}
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
      secondary: s.evidenceCount
        ? { value: String(s.evidenceCount), label: 'on file' } : null,
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
  subject, maxWeight, weights, size, onOpen,
}: {
  subject: ResearchSubject; maxWeight: number; weights: number[]
  size: TileSize; onOpen: () => void
}) {
  const state = stateOf(subject)
  const tone = STATE_TONE[state]
  const arrivedDays = subject.newestEvidenceAt ? daysSince(subject.newestEvidenceAt) : null
  const big = size === 'hero' || size === 'large'

  /*
   * ── The price, now that it costs one request per name ────────────────────
   *
   * This lens deliberately drew no chart: "fetching one per card to decorate
   * a gallery is exactly the cost this must not add." That was true when each
   * card would have fetched its own series. `useTileCloses` is keyed by symbol
   * alone with a five-minute staleTime, so a gallery of tiles on one name
   * makes ONE request, and Decisions and Portfolio have usually already made
   * it -- the reader arriving at Research is looking at names they just saw.
   *
   * The constraint that survives is the real one: the price never displaces
   * this lens's own answer. See `trailing` below.
   */
  const { data: closesData } = useTileCloses(subject.symbol)
  const closes = closesData ?? []

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

  const drawsTimeline = big && !!subject.thesisUpdatedAt && state !== 'no-thesis'
  const drawsWeight = big && subject.weightPct != null && state !== 'no-thesis'
  /*
   * The no-thesis branch draws the chart inside its own body, so the trailing
   * one is skipped there -- that is the only remaining condition, and it is
   * about not drawing the SAME chart twice on one card, not about whether the
   * subject has earned one.
   */
  const composesOwnChart = drawsChart && (state === 'no-thesis' || state === 'incomplete-thesis')
  const drawsSpark = drawsChart && !composesOwnChart
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
          <div className="flex min-w-0 flex-1 flex-col">
            <p className={clsx(
              'font-medium leading-[1.3] text-gray-900 dark:text-gray-100',
              size === 'hero' ? 'line-clamp-3 text-[26px] tracking-tight'
                : size === 'large' ? 'line-clamp-2 text-[19px]'
                : 'line-clamp-2 text-[14px]',
            )}>
              {subject.newestEvidenceTitle}
            </p>
            <p className="mt-2 text-[11px] text-gray-500">
              {subject.newestEvidenceAt && new Date(subject.newestEvidenceAt).toLocaleDateString(
                undefined, { day: 'numeric', month: 'short', year: 'numeric' })}
              {arrivedDays != null && ` · ${arrivedDays === 0 ? 'today' : `${arrivedDays}d ago`}`}
            </p>
            <p className="mt-auto pt-3 text-[11px] text-gray-500">
              1 new note {age.sinceThe}
              {subject.weightPct != null && ` · ${subject.weightPct.toFixed(1)}% held`}
            </p>
          </div>
        ) : (
          <div className="flex min-w-0 flex-1 flex-col">
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
            <TileMeta>
              {arrivedDays != null && <span>newest {arrivedDays === 0 ? 'today' : `${arrivedDays}d ago`}</span>}
              <span>{subject.evidenceCount} on file</span>
            </TileMeta>
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
          <div
            data-testid="research-tile-facts"
            className="flex min-w-0 flex-wrap items-baseline gap-x-5 gap-y-1 text-[11px] text-gray-500"
          >
            {(!subject.generated || big) && (
              <MissingThesis present={subject.coreSections} size={size} />
            )}
            {/* No weight line here: the corner states it, names the book it
                is in, and opens the rest. Saying it twice on one card is what
                this pass removed. */}
            {!!subject.generated?.liveIdeaCount && (
              <span className="font-semibold text-gray-800 dark:text-gray-200">
                {subject.generated.liveIdeaCount} open idea{subject.generated.liveIdeaCount === 1 ? '' : 's'}
              </span>
            )}
            <span>{subject.evidenceCount ? `${subject.evidenceCount} research on file` : 'Nothing on file yet'}</span>
          </div>

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
                height={size === 'hero' ? 190 : size === 'large' ? 160 : size === 'medium' ? 84 : 64}
              />
            </div>
          )}
        </div>
      ) : state === 'moved-since-review' ? (
        /* The move is the finding: the figure leads, the case's age beneath. */
        <div className="flex min-w-0 flex-1 flex-col">
          <TileLead
            figure={`${(subject.generated?.movePct ?? 0) >= 0 ? '+' : ''}${(subject.generated?.movePct ?? 0).toFixed(1)}`}
            unit="%"
            label={<>{age.sinceTheLines[0]}<br />{age.sinceTheLines[1]}</>}
            tone="review"
          />
          <div className="mt-auto pt-3">
            <TileMeta>
              {subject.weightPct != null && <span>{subject.weightPct.toFixed(1)}% held</span>}
              <span>{subject.evidenceCount} research on file</span>
            </TileMeta>
          </div>
        </div>
      ) : (
        <div className="flex min-w-0 flex-1 flex-col">
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
          <div className="mt-auto pt-3">
            <TileMeta>
              <span>{subject.evidenceCount} research on file</span>
              {subject.sectionCount > 0 && <span>{subject.sectionCount} sections</span>}
              {subject.weightPct != null && <span>{subject.weightPct.toFixed(1)}% held</span>}
            </TileMeta>
          </div>
        </div>
      )}

      {/*
        The window the case has been standing in, where there is room to draw
        it. This is the lens's own question -- how long since we wrote it, and
        how much has landed since -- and it was three sentences of prose above
        three hundred pixels of nothing.
      */}
      {drawsTimeline && (
        <div className="mt-3">
          <TileTimeline
            writtenAt={subject.thesisUpdatedAt!}
            newestAt={subject.newestEvidenceAt}
            count={subject.newSinceReview}
            startLabel={dateWords(thesisDateKindOf(subject)).start}
          />
        </div>
      )}

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
            height={big ? 110 : size === 'medium' ? 84 : 64}
          />
        </div>
      )}

      {/* Exposure is why an unreviewed thesis matters -- but only where the
          card has not already led with it. */}
      {drawsWeight && (
        <TileVisual>
          <TileBar
            pct={subject.weightPct!}
            max={maxWeight}
            population={weights}
            label="Held, against the rest of the queue"
            tone={tone === 'review' ? 'attention' : 'neutral'}
          />
        </TileVisual>
      )}
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
    return (
      <span className={clsx('text-gray-500', big ? 'text-[12px]' : 'text-[11px]')}>
        No {CORE_SECTIONS.map(k => SECTION_LABEL[k] ?? k).join(' · no ')}
      </span>
    )
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
