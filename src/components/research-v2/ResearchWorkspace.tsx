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

const STATE_TONE: Record<string, string> = {
  'evidence-since-review': 'text-amber-800 bg-amber-50 dark:text-amber-300 dark:bg-amber-950/40',
  'no-thesis': 'text-rose-700 bg-rose-50 dark:text-rose-300 dark:bg-rose-950/40',
  stale: 'text-amber-800 bg-amber-50 dark:text-amber-300 dark:bg-amber-950/40',
  thin: 'text-gray-600 bg-gray-100 dark:text-gray-400 dark:bg-white/[0.07]',
  current: 'text-emerald-700 bg-emerald-50 dark:text-emerald-300 dark:bg-emerald-950/40',
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

  const selected = ranked.find(s => s.assetId === selectedId) ?? null
  const { detail } = useResearchDetail(selected)

  // Choosing by hand clears the arrival reason — someone else's reason does
  // not apply to the subject you picked yourself.
  const select = (id: string) => { setSelectedId(id); setArrival(null) }

  if (isLoading) return <Loading />
  if (!ranked.length) return <Empty />

  if (!selected) {
    return (
      <div className="h-full overflow-y-auto bg-gray-50/60 pb-12 dark:bg-[#0b0f16]">
        <Header count={ranked.length} />
        <div className="grid grid-cols-1 gap-3.5 px-6 pt-4 md:grid-cols-2 xl:grid-cols-3">
          {ranked.map(s => <ScanTile key={s.assetId} subject={s} onOpen={() => select(s.assetId)} />)}
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-full overflow-hidden bg-gray-50/60 dark:bg-[#0b0f16]">
      <aside className="h-full w-[28%] min-w-[260px] shrink-0 overflow-y-auto border-r border-gray-200 px-3 py-3 dark:border-white/10">
        <div className="mb-2 flex items-center gap-2 px-1">
          <h2 className="text-[12px] font-semibold">Research</h2>
          <span className="font-mono text-[10.5px] text-gray-500">{ranked.length}</span>
          <button
            type="button"
            onClick={() => setSelectedId(null)}
            className="ml-auto rounded-md px-2 py-1 text-[11px] font-semibold text-blue-700 hover:bg-blue-50 dark:text-blue-400 dark:hover:bg-blue-950/30"
          >
            Full scan
          </button>
        </div>
        <div className="flex flex-col gap-2">
          {ranked.map(s => (
            <NavTile
              key={s.assetId}
              subject={s}
              selected={s.assetId === selected.assetId}
              onSelect={() => select(s.assetId)}
            />
          ))}
        </div>
      </aside>

      <div className="min-w-0 flex-1 overflow-y-auto">
        <ResearchDetail
          subject={selected}
          detail={detail}
          focus={arrival?.focus ?? null}
          arrivedFor={arrival?.issue ?? null}
          arrivedFrom={arrival?.origin ?? null}
        />
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ pieces */

function Header({ count }: { count: number }) {
  return (
    <header className="px-6 pt-6">
      <h1 className="text-[21px] font-semibold tracking-tight">Research</h1>
      <p className="mt-1 max-w-[68ch] text-[12.5px] text-gray-600 dark:text-gray-400">
        What evidence we hold, what has arrived since each case was written, and
        whether the two still agree. Ordered by whether the evidence has moved
        past the view.
      </p>
      <div className="mt-3 text-[11.5px] text-gray-500">
        <strong className="font-semibold text-gray-700 dark:text-gray-300">{count} names</strong>
        {' '}with a written case or recorded evidence
      </div>
    </header>
  )
}

function ScanTile({ subject, onOpen }: { subject: ResearchSubject; onOpen: () => void }) {
  const state = stateOf(subject)
  const target = targetFor(subject)
  const why = whyItMatters(subject)

  return (
    <article
      data-testid="research-scan-tile"
      data-state={state}
      className="flex min-w-0 flex-col overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm transition-shadow hover:shadow-md dark:border-white/[0.08] dark:bg-[#141a25]"
    >
      <div className="flex flex-wrap items-center gap-2 border-b border-gray-200/80 bg-gray-50/80 px-3.5 py-2 dark:border-white/10 dark:bg-white/[0.03]">
        <span className={clsx(
          'rounded-full px-2 py-[3px] text-[10px] font-bold uppercase tracking-[0.06em]',
          STATE_TONE[state],
        )}>
          {STATE_LABEL[state]}
        </span>
        {subject.weightPct != null && (
          <span className="ml-auto font-mono text-[10.5px] text-gray-500">
            {subject.weightPct.toFixed(1)}%
          </span>
        )}
      </div>

      <div className="flex flex-1 flex-col gap-2.5 px-3.5 pt-2.5">
        <div className="flex min-w-0 items-baseline gap-2.5">
          <span className="font-black text-[22px] leading-[1.05] tracking-[-0.035em]">
            {subject.symbol ?? '—'}
          </span>
          {subject.companyName && (
            <span className="min-w-0 truncate text-[12px] font-medium text-gray-500">
              {subject.companyName}
            </span>
          )}
        </div>

        <p className="text-[12.5px] leading-snug text-gray-700 dark:text-gray-300">{why}</p>

        <div className="flex divide-x divide-gray-200 overflow-hidden rounded-lg bg-gray-100/80 dark:divide-white/[0.07] dark:bg-white/[0.05]">
          {subject.daysSinceReview != null && (
            <Cell value={`${subject.daysSinceReview}d`} label="Last review" tone="down" />
          )}
          <Cell value={String(subject.evidenceCount)} label="Evidence" />
          {subject.newSinceReview > 0 && (
            <Cell value={`+${subject.newSinceReview}`} label="Since review" tone="warn" />
          )}
        </div>
      </div>

      <div className="mt-2 px-3.5 text-[9px] font-bold uppercase tracking-[0.11em] text-gray-500">Next</div>
      <div className="flex flex-wrap items-center gap-1 px-3.5 pb-2.5 pt-1">
        <button
          type="button"
          onClick={onOpen}
          className="inline-flex items-center gap-2 rounded-lg border border-blue-700 bg-blue-700 px-3.5 py-2 text-[12.5px] font-semibold text-white hover:border-blue-800 hover:bg-blue-800"
        >
          {primaryActionFor(subject)}
          <ArrowRight className="h-3.5 w-3.5 opacity-70" />
        </button>
        {target && (
          <button
            type="button"
            onClick={() => askAI(target)}
            className="inline-flex items-baseline gap-1.5 rounded-md px-2.5 py-2 text-[12px] text-amber-800 hover:bg-amber-50 dark:text-amber-400 dark:hover:bg-amber-950/30"
          >
            Ask AI
            <span className="font-mono text-[10.5px] opacity-75">{target.contextChips?.length ?? 0}</span>
          </button>
        )}
      </div>
    </article>
  )
}

function Cell({ value, label, tone }: { value: string; label: string; tone?: 'down' | 'warn' }) {
  return (
    <div className="min-w-0 flex-1 px-2.5 py-1">
      <span className={clsx(
        'block truncate font-mono text-[14px] font-semibold leading-tight tabular-nums',
        tone === 'down' && 'text-rose-600 dark:text-rose-400',
        tone === 'warn' && 'text-amber-700 dark:text-amber-400',
      )}>{value}</span>
      <span className="mt-0.5 block text-[9px] font-semibold uppercase tracking-[0.07em] text-gray-500">
        {label}
      </span>
    </div>
  )
}

function NavTile({
  subject, selected, onSelect,
}: { subject: ResearchSubject; selected: boolean; onSelect: () => void }) {
  const state = stateOf(subject)
  const ref = useRef<HTMLDivElement>(null)

  // Arriving from Today can select a name well below the fold. Bringing it
  // into view is the difference between "it selected something" and being
  // able to see where you are in the list.
  useEffect(() => {
    if (!selected) return
    const el = ref.current
    if (el && typeof el.scrollIntoView === 'function') {
      el.scrollIntoView({ block: 'nearest' })
    }
  }, [selected])

  return (
    <div
      ref={ref}
      data-testid="research-nav-tile"
      role="button"
      tabIndex={0}
      aria-current={selected}
      onClick={onSelect}
      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect() } }}
      className={clsx(
        // flex:none — the navigator is a flex column and the default shrink
        // would crush every tile to its chrome band.
        'flex-none cursor-pointer overflow-hidden rounded-lg border bg-white shadow-sm dark:bg-[#141a25]',
        selected
          ? 'border-blue-600 shadow-[0_0_0_1px_theme(colors.blue.600)]'
          : 'border-gray-200 hover:shadow-md dark:border-white/[0.08]',
      )}
    >
      <div className={clsx(
        'flex items-center gap-1.5 border-b px-2.5 py-1.5',
        selected
          ? 'border-blue-200 bg-blue-50 dark:border-blue-900/40 dark:bg-blue-950/30'
          : 'border-gray-200/80 bg-gray-50/80 dark:border-white/10 dark:bg-white/[0.03]',
      )}>
        <span className="font-mono text-[13px] font-bold tracking-tight">{subject.symbol ?? '—'}</span>
        {subject.newSinceReview > 0 && (
          <span className="rounded-full bg-amber-100 px-1.5 py-[1px] font-mono text-[9.5px] font-bold text-amber-800 dark:bg-amber-950/50 dark:text-amber-300">
            +{subject.newSinceReview}
          </span>
        )}
        {subject.weightPct != null && (
          <span className="ml-auto font-mono text-[10px] text-gray-500">{subject.weightPct.toFixed(1)}%</span>
        )}
      </div>
      <div className="flex flex-col items-start gap-1.5 px-2.5 py-2">
        <span className={clsx(
          'rounded-full px-2 py-[2px] text-[9.5px] font-semibold uppercase tracking-[0.05em]',
          STATE_TONE[state],
        )}>
          {STATE_LABEL[state]}
        </span>
        <span className="font-mono text-[10.5px] text-gray-500">
          {subject.daysSinceReview != null ? `${subject.daysSinceReview}d since review` : 'never reviewed'}
          {' · '}{subject.evidenceCount} item{subject.evidenceCount === 1 ? '' : 's'}
        </span>
      </div>
    </div>
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

function Empty() {
  return (
    <div className="h-full overflow-y-auto bg-gray-50/60 dark:bg-[#0b0f16]">
      <Header count={0} />
      <div className="mx-6 mt-4 rounded-xl border border-gray-200 bg-white px-6 py-16 text-center shadow-sm dark:border-white/[0.08] dark:bg-[#141a25]">
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
