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
  stateOf, whyItMatters, compareSubjects, issueFor,
  subscribeToOpenResearch, STATE_LABEL, CORE_SECTIONS, SECTION_LABEL,
  type ResearchSubject, type ResearchFocus,
} from '../../lib/desktop-research'
import {
  DesktopGallery, DesktopTile, TileState, TileIdentity, TileReason, TileMeta,
  TileFigure, TileVisual, TileBar, TileLead, TileSections, TileHeroNumber,
  sizeByRank, type TileSize,
} from '../desktop/DesktopTile'
import { ResearchDetail } from './ResearchDetail'
import { openAsset } from '../../lib/desktop-asset'
import {
  openDashboardFocus, type RailCard,
} from '../../lib/dashboard/focus'
import { EYEBROW } from '../desktop/DesktopModule'
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
  'no-thesis': 'review',
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
}

export function ResearchWorkspace({
  selectedAssetId, issue, origin, focusObjectId,
}: ResearchWorkspaceProps = {}) {
  const { subjects, isLoading } = useResearchScan()
  const exposure = useResearchExposure(subjects)
  const [arrival, setArrival] = useState<Arrival | null>(
    selectedAssetId ? { issue, origin } : null,
  )

  useEffect(() => {
    if (selectedAssetId) setArrival({ issue, origin })
  }, [selectedAssetId, issue, origin])

  const ranked = useMemo(() => subjects
    .map(s => ({ ...s, weightPct: exposure[s.assetId] }))
    .sort(compareSubjects), [subjects, exposure])

  /**
   * Selection lives in the deck, not here.
   *
   * The lens draws the field and says which card was chosen; the Dashboard
   * shell holds which card is expanded, which deck it came from and where
   * Back goes. That separation is what lets a card opened from Today expand
   * into a research workspace while Back still says Today.
   */
  const activeId = focusObjectId ?? null
  const requested = activeId ? ranked.find(s => s.assetId === activeId) ?? null : null
  const missing = !!activeId && !requested
  // Nothing deep is fetched while browsing, or when a request missed.
  const { detail } = useResearchDetail(requested)
  const maxWeight = ranked.reduce((m, r) => Math.max(m, r.weightPct ?? 0), 0)

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

  if (isLoading) return <Loading />
  if (!ranked.length) return <Empty />

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
      />
    )
  }

  return (
    <div className="h-full overflow-y-auto" data-testid="research-lens">
      <DesktopGallery
        title="Research"
        count={ranked.length}
        note={
          <p className="max-w-[74ch] text-[12.5px] text-gray-600 dark:text-gray-400">
            Which investment cases need work: what evidence we hold, what has
            arrived since each case was written, and whether the two still agree.
          </p>
        }
      >
        {ranked.map((s, i) => (
          <SubjectTile
            key={s.assetId}
            subject={s}
            maxWeight={maxWeight}
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
      symbol: s.symbol, reason: STATE_LABEL[state], tone: STATE_TONE[state],
      figure: arrivals > 1 ? String(arrivals) : null,
      figureLabel: arrivals > 1 ? 'new items' : null,
      secondary: s.weightPct != null
        ? { value: `${s.weightPct.toFixed(1)}%`, label: 'held' } : null,
      detail: arrivals === 1 && s.newestEvidenceTitle
        ? s.newestEvidenceTitle
        : `${arrivals} arrived since the case was written`,
      issue: issueFor(s),
    }
  }

  if (state === 'no-thesis') {
    const missing = CORE_SECTIONS.filter(k => !s.coreSections.includes(k))
      .map(k => SECTION_LABEL[k] ?? k)
    return {
      id: s.assetId, workspaceLens: 'research', objectType: 'asset',
      symbol: s.symbol, reason: STATE_LABEL[state], tone: STATE_TONE[state],
      figure: s.weightPct != null ? `${s.weightPct.toFixed(1)}%` : null,
      figureLabel: s.weightPct != null ? 'held' : null,
      secondary: s.evidenceCount
        ? { value: String(s.evidenceCount), label: 'on file' } : null,
      // The missing structure, named. Never a completion score.
      detail: missing.length ? `Missing: ${missing.join(', ')}` : whyItMatters(s),
      issue: issueFor(s),
    }
  }

  return {
    id: s.assetId, workspaceLens: 'research', objectType: 'asset',
    symbol: s.symbol, reason: STATE_LABEL[state], tone: STATE_TONE[state],
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
 * The gallery used to say "new evidence", "core thesis not written" and "not
 * reviewed" in three differently-worded pills on three identical cards. They
 * are not variations of one problem: something ARRIVED, something was never
 * WRITTEN, something has not been LOOKED AT. Each gets the presentation its
 * own question deserves, and at hero scale each gets the fact as the visual.
 *
 *   arrival    what came in, and how recently -- the count IS the visual
 *   absence    which parts of the case exist and which do not, named
 *   age        time and exposure, in numbers big enough to read
 *
 * None of them charts by default. Research's scan has no price series, so the
 * anchored move belongs to the focused workspace, not to a tile.
 */
function SubjectTile({
  subject, maxWeight, size, onOpen,
}: { subject: ResearchSubject; maxWeight: number; size: TileSize; onOpen: () => void }) {
  const state = stateOf(subject)
  const tone = STATE_TONE[state]
  const arrivedDays = subject.newestEvidenceAt ? daysSince(subject.newestEvidenceAt) : null
  const big = size !== 'compact'

  return (
    <DesktopTile
      testId="research-tile"
      dataAttrs={{ 'data-state': state }}
      tone={tone}
      size={size}
      onOpen={onOpen}
      eyebrow={<>
        <TileState tone={tone}>{STATE_LABEL[state]}</TileState>
        <TileFigure>
          {subject.daysSinceReview != null ? `reviewed ${subject.daysSinceReview}d ago` : 'never reviewed'}
        </TileFigure>
      </>}
    >
      <TileIdentity symbol={subject.symbol} name={subject.companyName} size={size} />

      {state === 'evidence-since-review' ? (
        <>
          {/*
            What arrived is the visual -- but for ONE arrival the thing that
            arrived is more interesting than the numeral one. A giant "1" tells
            a reader nothing they could not read from the pill above it; the
            title tells them whether to open it. Two or more, and the count is
            genuinely the fact.
          */}
          {size === 'hero' && subject.newSinceReview === 1 && subject.newestEvidenceTitle ? (
            <div>
              <div className={EYEBROW}>What arrived</div>
              <p className="mt-1 line-clamp-3 max-w-[46ch] text-[17px] font-medium leading-[1.4] text-gray-900 dark:text-gray-100">
                {subject.newestEvidenceTitle}
              </p>
              <p className="mt-1.5 text-[11.5px] text-gray-500">
                1 new item since the case was written
                {arrivedDays != null && (arrivedDays === 0 ? ', today' : `, ${arrivedDays}d ago`)}
              </p>
            </div>
          ) : size === 'hero' ? (
            <TileHeroNumber
              figure={subject.newSinceReview}
              label={<>research item{subject.newSinceReview === 1 ? '' : 's'} arrived after the case was written</>}
              tone="review"
            />
          ) : subject.newSinceReview === 1 && subject.newestEvidenceTitle ? (
            <div>
              <div className={EYEBROW}>What arrived</div>
              <p className="mt-0.5 line-clamp-2 text-[12.5px] font-medium leading-snug text-gray-900 dark:text-gray-100">
                {subject.newestEvidenceTitle}
              </p>
            </div>
          ) : (
            <TileLead
              figure={subject.newSinceReview}
              label={<>arrived after<br />the case was written</>}
              tone="review"
            />
          )}
          <TileMeta>
            {arrivedDays != null && (
              <span>{arrivedDays === 0 ? 'newest today' : `newest ${arrivedDays}d ago`}</span>
            )}
            <span>{subject.evidenceCount} on record in total</span>
          </TileMeta>
        </>
      ) : state === 'no-thesis' ? (
        <>
          {/* The missing structure is the visual, and materiality is why it
              matters -- not a completion score, which would invite someone to
              fill in a form rather than make an argument. */}
          <TileSections present={presentLabels(subject)} all={CORE_LABELS} />
          {size === 'hero' && subject.weightPct != null ? (
            <TileHeroNumber
              figure={subject.weightPct.toFixed(1)}
              unit="%"
              label={<>of the book it matters most in, with no written case</>}
              tone="review"
            />
          ) : (
            <TileReason>{whyItMatters(subject)}</TileReason>
          )}
        </>
      ) : (
        <>
          {/* Time is the fact. At hero scale it is stated as one. */}
          {size === 'hero' && subject.daysSinceReview != null ? (
            <TileHeroNumber
              figure={subject.daysSinceReview}
              unit="days"
              label={<>since the case was last written</>}
              tone={tone === 'review' ? 'review' : 'neutral'}
            />
          ) : (
            <TileReason>{whyItMatters(subject)}</TileReason>
          )}
          <TileMeta>
            <span>{subject.evidenceCount} research item{subject.evidenceCount === 1 ? '' : 's'}</span>
            {subject.sectionCount > 0 && (
              <span>{subject.sectionCount} section{subject.sectionCount === 1 ? '' : 's'}</span>
            )}
          </TileMeta>
        </>
      )}

      {/* Exposure is why an unreviewed case matters, so it is shown wherever
          we own the name -- and nowhere else. Not on a hero that already leads
          with its weight, which would print the same number twice. */}
      {subject.weightPct != null && big && !(size === 'hero' && state === 'no-thesis') && (
        <TileVisual>
          <TileBar
            pct={subject.weightPct}
            max={maxWeight}
            label="Largest position"
            tone={tone === 'review' ? 'attention' : 'neutral'}
          />
        </TileVisual>
      )}
    </DesktopTile>
  )
}

const CORE_LABELS = CORE_SECTIONS.map(k => SECTION_LABEL[k] ?? k)

function presentLabels(s: ResearchSubject): string[] {
  return s.coreSections.map(k => SECTION_LABEL[k] ?? k)
}

function daysSince(iso: string): number {
  return Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000))
}

function Loading() {
  return (
    <div className="h-full overflow-y-auto bg-gray-50/60 px-6 pt-6 dark:bg-[#0b0f16]">
      <div className="h-8 w-44 animate-pulse rounded bg-gray-200 dark:bg-white/10" />
      <div className="mt-5 grid grid-cols-1 gap-3.5 md:grid-cols-2 xl:grid-cols-3">
        {[0, 1, 2, 3, 4, 5].map(i => (
          <div key={i} className="h-52 animate-pulse rounded-xl border border-gray-200 bg-white dark:border-white/[0.08] dark:bg-[#141a25]" />
        ))}
      </div>
    </div>
  )
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
        <p className="mt-1.5 text-[12.5px] text-gray-600 dark:text-gray-400">
          Research lists names that have a written case or a recorded research
          item. This one has neither, so there is nothing here to open.
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

function Empty() {
  return (
    <div className="h-full overflow-y-auto bg-gray-50/60 px-6 pt-6 dark:bg-[#0b0f16]">
      <h1 className="text-[21px] font-semibold tracking-tight">Research</h1>
      <div className="mt-4 rounded-xl border border-gray-200 bg-white px-6 py-16 text-center shadow-sm dark:border-white/[0.08] dark:bg-[#141a25]">
        <BookOpen className="mx-auto h-7 w-7 text-gray-400" />
        <h2 className="mt-4 text-[17px] font-semibold">No recorded evidence yet</h2>
        <p className="mx-auto mt-1.5 max-w-[46ch] text-[12.5px] text-gray-600 dark:text-gray-400">
          Research appears here once a name has a written case or a research note
          against it.
        </p>
      </div>
    </div>
  )
}
