/**
 * Desktop Research — the evidence workspace.
 *
 * Same shape as Desktop Ideas because the workflow is the same: a visual scan
 * of what needs attention, then a persistent navigator beside a deep
 * workspace, so reading one case never costs you the list.
 *
 * Research creates EngagementTargets and nothing else. Ask AI and Team open
 * the existing CommunicationPane through the D1 seam — no AI panel, no chat
 * system, no comment table is defined here.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { clsx } from 'clsx'
import { ArrowRight, BookOpen } from 'lucide-react'
import { askAI } from '../../lib/engagement'
import {
  useResearchScan, useResearchExposure, useResearchDetail,
} from '../../hooks/useDesktopResearch'
import {
  stateOf, whyItMatters, primaryActionFor, targetFor, compareSubjects,
  subscribeToOpenResearch, STATE_LABEL,
  type ResearchSubject, type ResearchFocus,
} from '../../lib/desktop-research'
interface Arrival { focus?: ResearchFocus | null; issue?: string | null; origin?: string | null }

import { ResearchDetail } from './ResearchDetail'
import {
  DesktopNavigator, DesktopNavRow, NavSymbol, NavQualifier, NavTrailing, NavMeta,
} from '../desktop/DesktopNavigator'
import { TONE_PILL, type SemanticTone } from '../../lib/semantic-tone'

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

export function ResearchWorkspace({ selectedAssetId, focus, issue, origin }: ResearchWorkspaceProps = {}) {
  const { subjects, isLoading } = useResearchScan()
  const exposure = useResearchExposure(subjects)
  const [selectedId, setSelectedId] = useState<string | null>(selectedAssetId ?? null)
  const [arrival, setArrival] = useState<Arrival | null>(
    selectedAssetId ? { focus, issue, origin } : null,
  )

  useEffect(() => {
    if (selectedAssetId) { setSelectedId(selectedAssetId); setArrival({ focus, issue, origin }) }
  }, [selectedAssetId, focus, issue, origin])

  useEffect(() => subscribeToOpenResearch(r => {
    setSelectedId(r.assetId)
    setArrival({ focus: r.focus, issue: r.issue, origin: r.origin })
  }), [])

  const ranked = useMemo(() => subjects
    .map(s => ({ ...s, weightPct: exposure[s.assetId] }))
    .sort(compareSubjects), [subjects, exposure])

  // The tier-first ranking is untouched; entry simply opens on its head
  // rather than making the reader pick from a grid first.
  //
  // But a REQUESTED subject that is not in the list must never fall through to
  // the head of it. Research only lists names with a written case or recorded
  // evidence, so arriving from Ideas on a name with neither would otherwise
  // open a different company under a banner naming the one you asked for.
  const requested = selectedId ? ranked.find(s => s.assetId === selectedId) ?? null : null
  const missing = !!selectedId && !requested
  const selected = requested ?? ranked[0] ?? null
  // Nothing is being shown when the request missed, so nothing is fetched.
  const { detail } = useResearchDetail(missing ? null : selected)

  // Choosing by hand clears the arrival reason — someone else's reason does
  // not apply to the subject you picked yourself.
  const select = (id: string) => { setSelectedId(id); setArrival(null) }

  if (isLoading) return <Loading />
  if (!ranked.length || !selected) return <Empty />

  return (
    <div className="flex h-full overflow-hidden bg-gray-50/60 dark:bg-[#0b0f16]">
      <DesktopNavigator title="Research" count={ranked.length}>
        {ranked.map(s => (
          <NavRow
            key={s.assetId}
            subject={s}
            selected={s.assetId === selected.assetId}
            onSelect={() => select(s.assetId)}
          />
        ))}
      </DesktopNavigator>

      <div className="min-w-0 flex-1 overflow-y-auto">
        {missing ? (
          <NothingOnRecord issue={arrival?.issue ?? null} origin={arrival?.origin ?? null} />
        ) : (
        <ResearchDetail
          subject={selected}
          detail={detail}
          focus={arrival?.focus ?? null}
          arrivedFor={arrival?.issue ?? null}
          arrivedFrom={arrival?.origin ?? null}
        />
        )}
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ pieces */



/**
 * One name in the research index.
 *
 * Symbol, what state its case is in, and how long since anyone looked. The
 * new-evidence count leads when there is one, because that is the reason the
 * name is near the top.
 */
function NavRow({
  subject, selected, onSelect,
}: { subject: ResearchSubject; selected: boolean; onSelect: () => void }) {
  const state = stateOf(subject)
  return (
    <DesktopNavRow
      testId="research-nav-row"
      dataAttrs={{ 'data-state': state }}
      selected={selected}
      onSelect={onSelect}
      title={<>
        <NavSymbol>{subject.symbol ?? '—'}</NavSymbol>
        {subject.newSinceReview > 0 && (
          <NavQualifier>+{subject.newSinceReview} new</NavQualifier>
        )}
      </>}
      trailing={subject.weightPct != null ? <NavTrailing>{subject.weightPct.toFixed(1)}%</NavTrailing> : undefined}
    >
      <div className="mt-1 flex items-center gap-1.5">
        <span className={clsx(
          'rounded-full border px-1.5 py-[1px] text-[9px] font-semibold uppercase tracking-[0.05em]',
          TONE_PILL[STATE_TONE[state]],
        )}>
          {STATE_LABEL[state]}
        </span>
        <NavMeta>
          {subject.daysSinceReview != null ? `${subject.daysSinceReview}d since review` : 'never reviewed'}
        </NavMeta>
      </div>
    </DesktopNavRow>
  )
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
/** Sender names, shared with the arrival banner's vocabulary. */
const ORIGIN_NAME: Record<string, string> = {
  today: 'Dashboard', portfolio: 'Portfolio', ideas: 'Ideas', decisions: 'Decisions',
}

function NothingOnRecord({ issue, origin }: { issue: string | null; origin: string | null }) {
  return (
    <div className="px-6 pt-6">
      <div className="rounded-xl border border-dashed border-gray-300 bg-white px-6 py-10 text-center dark:border-white/15 dark:bg-[#141a25]">
        <h2 className="text-[16px] font-semibold">Nothing on record for that name yet</h2>
        <p className="mx-auto mt-1.5 max-w-[52ch] text-[12.5px] text-gray-600 dark:text-gray-400">
          Research lists names that have a written case or a recorded research
          item. This one has neither, so there is nothing here to open.
          {issue && ` You arrived${origin ? ` from ${ORIGIN_NAME[origin] ?? origin}` : ''} for: ${issue}.`}
        </p>
        <p className="mx-auto mt-2 max-w-[52ch] text-[11px] text-gray-500">
          Pick a name from the index to the left.
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
        <p className="mx-auto mt-1.5 max-w-[46ch] text-[12.5px] text-gray-600 dark:text-gray-400">
          Research appears here once a name has a written case or a research note
          against it.
        </p>
      </div>
    </div>
  )
}
