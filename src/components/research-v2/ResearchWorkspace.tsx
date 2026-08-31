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

import { useCallback, useEffect, useMemo } from 'react'
import { BookOpen } from 'lucide-react'
import { useResearchScan, useResearchExposure } from '../../hooks/useDesktopResearch'
import {
  stateOf, whyItMatters, compareSubjects, targetFor,
  subscribeToOpenResearch, STATE_LABEL, CORE_SECTIONS, SECTION_LABEL,
  type ResearchSubject, type ResearchFocus,
} from '../../lib/desktop-research'
import {
  DesktopGallery, DesktopTile, TileState, TileIdentity, TileReason, TileMeta,
  TileFigure, TileVisual, TileBar, TileLead, TileSections,
} from '../desktop/DesktopTile'
import { openAsset } from '../../lib/desktop-asset'
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
}

export function ResearchWorkspace({ selectedAssetId, issue, origin }: ResearchWorkspaceProps = {}) {
  const { subjects, isLoading } = useResearchScan()
  const exposure = useResearchExposure(subjects)

  const ranked = useMemo(() => subjects
    .map(s => ({ ...s, weightPct: exposure[s.assetId] }))
    .sort(compareSubjects), [subjects, exposure])

  /**
   * Choosing a subject leaves this surface.
   *
   * Stage 2D0 found the case, the evidence and the thesis editor implemented
   * here AND on the Asset page -- this workspace was literally mounting the
   * Asset page's own editor. Research is a lens: it answers which investment
   * cases need work. The work happens on the asset, and it happens in a tab of
   * its own, so returning here finds the scan exactly as it was left.
   */
  const open = useCallback((s: ResearchSubject, arrivalIssue?: string | null) => {
    const built = targetFor(s)
    openAsset({
      assetId: s.assetId,
      symbol: s.symbol,
      companyName: s.companyName,
      focus: 'research',
      // The reason travels with the reader. A sender's own words win over the
      // one this lens would have derived.
      issue: arrivalIssue
        ? { title: arrivalIssue, reason: `research:${stateOf(s)}` }
        : built?.issue ?? null,
      origin: 'research',
    })
  }, [])

  /**
   * A request for a name Research has nothing on must not open another one.
   *
   * Research lists names with a written case or recorded evidence, so arriving
   * from Ideas on a name with neither would otherwise fall through to whatever
   * the ranking put first -- the silent-substitution bug Stage 1.1 fixed. The
   * asset still opens; it is the SUBJECT that could not be found here, and the
   * asset workspace says so honestly from its own read.
   */
  const openById = useCallback((assetId: string, arrivalIssue?: string | null, from?: string | null) => {
    const found = ranked.find(s => s.assetId === assetId)
    if (found) return open(found, arrivalIssue)
    openAsset({
      assetId,
      focus: 'research',
      issue: arrivalIssue ?? null,
      origin: from ?? 'research',
    })
  }, [ranked, open])

  // A typed arrival is a request to work on a name, not to browse. It is
  // forwarded to the canonical destination rather than handled here.
  useEffect(() => {
    if (selectedAssetId && ranked.length) openById(selectedAssetId, issue, origin)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedAssetId, ranked.length])

  useEffect(() => subscribeToOpenResearch(r => {
    openById(r.assetId, r.issue, r.origin)
  }), [openById])

  const maxWeight = ranked.reduce((m, r) => Math.max(m, r.weightPct ?? 0), 0)

  if (isLoading) return <Loading />
  if (!ranked.length) return <Empty />

  return (
    <div className="h-full overflow-y-auto bg-gray-50/60 dark:bg-[#0b0f16]" data-testid="research-lens">
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
        {ranked.map(s => (
          <SubjectTile
            key={s.assetId}
            subject={s}
            maxWeight={maxWeight}
            onOpen={() => open(s)}
          />
        ))}
      </DesktopGallery>
    </div>
  )
}

/**
 * One name in the research scan.
 *
 * The state leads, because "the evidence has moved past the view" and "nobody
 * has written a view" are different problems that a reader sorts by first. The
 * visual is exposure where the name is held -- a stale case on a 25% position
 * is not the same finding as one on a watchlist name, and that is the fact the
 * rail had no room to carry.
 */
/**
 * One subject in the scan.
 *
 * ── Three states that must not look alike ────────────────────────────────
 *
 * The gallery previously said "new evidence", "core thesis not written" and
 * "not reviewed" in three differently-worded pills on three identical cards.
 * They are not variations of one problem: something ARRIVED, something was
 * never WRITTEN, something has not been LOOKED AT. Each gets the presentation
 * its own question deserves.
 *
 *   arrival    how much came in, and how recently -- the count leads
 *   absence    which parts of the case exist and which do not, named
 *   age        how long since anyone looked, against what we own
 *
 * None of them charts by default. A price path is only drawn where movement
 * since the review is itself the reason to look again, and Research's scan has
 * no price series, so that belongs to the detail workspace rather than here.
 */
function SubjectTile({
  subject, maxWeight, onOpen,
}: { subject: ResearchSubject; maxWeight: number; onOpen: () => void }) {
  const state = stateOf(subject)
  const tone = STATE_TONE[state]
  const arrivedDays = subject.newestEvidenceAt ? daysSince(subject.newestEvidenceAt) : null

  return (
    <DesktopTile
      testId="research-tile"
      dataAttrs={{ 'data-state': state }}
      tone={tone}
      onOpen={onOpen}
      eyebrow={<>
        <TileState tone={tone}>{STATE_LABEL[state]}</TileState>
        <TileFigure>
          {subject.daysSinceReview != null ? `reviewed ${subject.daysSinceReview}d ago` : 'never reviewed'}
        </TileFigure>
      </>}
    >
      <TileIdentity symbol={subject.symbol} name={subject.companyName} />

      {state === 'evidence-since-review' ? (
        <>
          {/* Arrival leads. The count is the fact; the sentence says what it
              arrived against. */}
          <TileLead
            figure={subject.newSinceReview}
            label={<>research item{subject.newSinceReview === 1 ? '' : 's'} arrived<br />after the case was written</>}
            tone="review"
          />
          <TileMeta>
            {arrivedDays != null && (
              <span>{arrivedDays === 0 ? 'newest today' : `newest ${arrivedDays}d ago`}</span>
            )}
            <span>{subject.evidenceCount} on record in total</span>
          </TileMeta>
        </>
      ) : state === 'no-thesis' ? (
        <>
          {/* Absence, made specific. Which argument is missing matters; a
              percentage complete would not. */}
          <TileSections present={presentLabels(subject)} all={CORE_LABELS} />
          <TileReason>{whyItMatters(subject)}</TileReason>
        </>
      ) : (
        <>
          <TileReason>{whyItMatters(subject)}</TileReason>
          <TileMeta>
            <span>{subject.evidenceCount} research item{subject.evidenceCount === 1 ? '' : 's'}</span>
            {subject.sectionCount > 0 && (
              <span>{subject.sectionCount} section{subject.sectionCount === 1 ? '' : 's'}</span>
            )}
          </TileMeta>
        </>
      )}

      {/* Exposure is the reason an unreviewed case matters, so it is shown
          wherever we own the name -- and nowhere else. */}
      {subject.weightPct != null && (
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
