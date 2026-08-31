/**
 * Today — visual-per-problem.
 *
 * Six small renderers, one per archetype. The rule from the approved
 * prototype: the graphic explains why THIS item surfaced, so a stale thesis
 * gets decay, an unresolved proposal gets an age line, and an item whose
 * evaluator carries no such number gets strong typography instead of a
 * decorative chart.
 *
 * Every visual names its window. That rule is borrowed from mobile's
 * `TileSparkline`, which documents the failure it prevents: an unlabelled
 * graphic beside a metric reads as a contradiction, and the reader resolves it
 * by distrusting the number — the one thing on the tile that was unambiguous.
 */

import { clsx } from 'clsx'
import { ArrowRight } from 'lucide-react'
import type { TodayVisual as Visual } from '../../lib/today'

export function TodayVisual({ visual, compact }: { visual: Visual; compact?: boolean }) {
  // No visual is better than an apology. The user should never read
  // implementation language about what the engine could not measure -- the
  // metric strip and the claim already carry the situation.
  if (visual.archetype === 'metrics') return null

  return (
    <div
      className={clsx(
        'rounded-lg border bg-white dark:bg-white/[0.02]',
        'border-gray-200/70 dark:border-white/[0.07]',
        compact ? 'px-2.5 pt-2 pb-1.5' : 'px-3 pt-2.5 pb-2',
      )}
      data-archetype={visual.archetype}
    >
      <div className="flex items-baseline gap-2 mb-1.5">
        <span className="text-[9px] font-semibold uppercase tracking-[0.09em] text-gray-500 dark:text-gray-500">
          {visual.caption}
        </span>
        <span className="ml-auto font-mono text-[9.5px] text-gray-500 dark:text-gray-500">
          {visual.window}
        </span>
      </div>

      <Body visual={visual} compact={compact} />

      {visual.note && (
        <div className="mt-1.5 text-[10.5px] leading-snug text-gray-500 dark:text-gray-500">
          {visual.note}
        </div>
      )}
    </div>
  )
}

function Body({ visual, compact }: { visual: Visual; compact?: boolean }) {
  switch (visual.archetype) {
    case 'exposure':      return <Exposure v={visual} />
    case 'aging':         return <Aging v={visual} />
    case 'staleness':     return <Staleness v={visual} compact={compact} />
    case 'transition':    return <Transition v={visual} />
    case 'expected-return': return <ExpectedReturn v={visual} />
    default:              return null
  }
}

/* ---------------------------------------------------------------- exposure */

function Exposure({ v }: { v: Visual }) {
  const e = v.exposure!
  // The track is the whole book and nothing else.
  //
  // There was a policy-max tick here at a hard-coded 10%. No policy-limit
  // source exists in the data Today loads, so that tick was a constraint the
  // product invented and then drew as though it knew it -- and a marker is
  // read as authoritative precisely because it looks measured. It is gone,
  // and it is not replaced by another reference: NAV is a fact, a threshold
  // would be a guess.
  //
  // The number leads, because at a 4% weight an honest 0-100% bar is a sliver
  // -- which is true, and is exactly why the bar must not be the whole story.
  return (
    <div>
      <div className="font-mono text-[19px] font-semibold leading-none tracking-tight text-gray-900 dark:text-gray-100">
        {e.weightPct.toFixed(1)}%
      </div>
      <div className="mt-1.5 h-1.5 rounded-full bg-gray-100 dark:bg-white/[0.06]">
        <i
          className="block h-full rounded-full bg-blue-500/55"
          style={{ width: `${Math.min(100, Math.max(0, e.weightPct))}%` }}
        />
      </div>
      <div className="mt-1.5 text-[10px] text-gray-500 dark:text-gray-500">
        of NAV — no policy limit is recorded for this position
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------- aging */

function Aging({ v }: { v: Visual }) {
  const a = v.aging!
  return (
    <div className="relative h-7">
      <div className="absolute inset-x-0 top-4 h-0.5 rounded bg-gray-100 dark:bg-white/[0.07]" />
      <div className="absolute left-0 top-4 h-0.5 rounded bg-amber-500/70" style={{ width: '100%' }} />
      {a.milestones.map(m => (
        <span key={m.label}>
          <span
            className="absolute top-0 -translate-x-1/2 whitespace-nowrap text-[9px] text-gray-500 dark:text-gray-500"
            style={{ left: `${m.atPct}%` }}
          >
            {m.label}
          </span>
          <i
            className={clsx(
              'absolute top-[11px] h-2 w-2 -translate-x-1/2 rounded-full border-2',
              m.hot
                ? 'border-rose-500 bg-rose-500'
                : 'border-amber-500 bg-amber-500',
            )}
            style={{ left: `${m.atPct}%` }}
          />
        </span>
      ))}
      <span className="absolute right-0 top-[19px] font-mono text-[11px] font-semibold text-amber-700 dark:text-amber-400">
        {a.days}d
      </span>
    </div>
  )
}

/* --------------------------------------------------------------- staleness */

function Staleness({ v, compact }: { v: Visual; compact?: boolean }) {
  const s = v.staleness!
  const tone = s.days >= 180 ? 'bg-rose-500/60' : s.days >= 135 ? 'bg-amber-500/60' : 'bg-emerald-500/50'
  return (
    <div className={clsx('flex items-end gap-1', compact ? 'h-6' : 'h-7')}>
      {s.quarters.map((h, i) => (
        <i key={i} className={clsx('flex-1 rounded-sm', tone)} style={{ height: `${Math.max(6, h)}%` }} />
      ))}
    </div>
  )
}

/* -------------------------------------------------------------- transition */

function Transition({ v }: { v: Visual }) {
  const t = v.transition!
  return (
    <div className="flex items-center gap-2.5 py-0.5">
      <span className="rounded-md border border-gray-200 bg-gray-50 px-2 py-0.5 font-mono text-[12px] font-semibold text-gray-500 line-through dark:border-white/10 dark:bg-white/[0.04] dark:text-gray-500">
        {t.from}
      </span>
      <ArrowRight className="h-3 w-3 flex-none text-gray-400 dark:text-gray-600" />
      <span className="rounded-md border border-amber-200 bg-amber-50 px-2 py-0.5 font-mono text-[12px] font-bold text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-300">
        {t.to}
      </span>
    </div>
  )
}

/* --------------------------------------------------------- expected return */

function ExpectedReturn({ v }: { v: Visual }) {
  const e = v.expectedReturn!
  const pct = Math.min(100, Math.abs(e.evPct) * 2)
  const up = e.evPct >= 0
  return (
    <div>
      <div className="flex items-baseline gap-2">
        <span
          className={clsx(
            'font-mono text-[19px] font-semibold leading-none tracking-tight',
            up ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400',
          )}
        >
          {up ? '+' : ''}{e.evPct}%
        </span>
        {e.direction && (
          <span className="text-[10.5px] uppercase tracking-wide text-gray-500 dark:text-gray-500">
            {e.direction}
          </span>
        )}
      </div>
      <div className="mt-1.5 h-1.5 rounded-full bg-gray-100 dark:bg-white/[0.06]">
        <i
          className={clsx('block h-full rounded-full', up ? 'bg-emerald-500/55' : 'bg-rose-500/55')}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  )
}

/* ---------------------------------------------------------------- fallback */

// `metrics` renders nothing at all -- see the guard at the top of this file.
