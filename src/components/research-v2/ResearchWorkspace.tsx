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

import { useEffect, useMemo, useState } from 'react'
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
}

export function ResearchWorkspace({
  selectedAssetId, issue, origin, focusObjectId, intent,
}: ResearchWorkspaceProps = {}) {
  const { subjects, isLoading } = useResearchScan()
  const { exposure, settled: exposureSettled } = useResearchExposure(subjects)
  const [arrival, setArrival] = useState<Arrival | null>(
    selectedAssetId ? { issue, origin } : null,
  )

  useEffect(() => {
    if (selectedAssetId) setArrival({ issue, origin })
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
  const activeId = focusObjectId ?? null
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
        <TileFigure>
          {subject.daysSinceReview != null ? `${subject.daysSinceReview}d ${age.since}` : 'no thesis written'}
        </TileFigure>
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
        /* The shape of what is missing, at whatever scale the card has. */
        <div className="flex min-w-0 flex-1 flex-col">
          {/*
            Generated work leads with why it matters on this name, not with the
            blank: the position it puts at risk, or the idea being worked without
            a case. The missing structure follows where the card has room.
          */}
          {subject.generated && subject.generated.context !== 'unheld' && subject.weightPct != null && (
            <div className="mb-2">
              <TileLead
                figure={subject.weightPct.toFixed(1)}
                unit="%"
                label={subject.generated.portfolioName ? <>of {subject.generated.portfolioName}</> : <>of the book</>}
              />
            </div>
          )}
          {subject.generated && (
            <div data-testid="research-tile-reason" className="mb-2">
              <TileReason>{whyItMatters(subject)}</TileReason>
            </div>
          )}
          {(!subject.generated || big) && <MissingThesis present={subject.coreSections} size={size} />}
          <div className="mt-auto pt-3">
            <TileMeta>
              {subject.weightPct != null && !subject.generated && (
                <span className="font-mono font-semibold text-gray-800 dark:text-gray-200">
                  {subject.weightPct.toFixed(1)}% held
                </span>
              )}
              {!!subject.generated?.liveIdeaCount && (
                <span className="font-semibold text-gray-800 dark:text-gray-200">
                  {subject.generated.liveIdeaCount} open idea{subject.generated.liveIdeaCount === 1 ? '' : 's'}
                </span>
              )}
              <span>{subject.evidenceCount ? `${subject.evidenceCount} research on file` : 'Nothing on file yet'}</span>
            </TileMeta>
          </div>
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
      {big && subject.thesisUpdatedAt && state !== 'no-thesis' && (
        <div className="mt-3">
          <TileTimeline
            writtenAt={subject.thesisUpdatedAt}
            newestAt={subject.newestEvidenceAt}
            count={subject.newSinceReview}
            startLabel={dateWords(thesisDateKindOf(subject)).start}
          />
        </div>
      )}

      {/* Exposure is why an unreviewed thesis matters -- but only where the
          card has not already led with it. */}
      {subject.weightPct != null && big && state !== 'no-thesis' && (
        <TileVisual>
          <TileBar
            pct={subject.weightPct}
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
