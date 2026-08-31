/**
 * Desktop Ideas — shared identity primitives.
 *
 * Direction and maturity are rendered as two separate pills, deliberately.
 * One badge reading WATCH collapses "we lean long" and "the work is not
 * finished" into a single word that says neither. BUY · RESEARCHING says both.
 *
 * Colour follows the same rule Today settled on: direction carries semantic
 * colour because it states intent; maturity is neutral because progress is not
 * good or bad. Nothing here turns an early-stage Idea red.
 */

import { clsx } from 'clsx'
import { MATURITY_LABEL, type IdeaDirection, type IdeaMaturity } from '../../lib/desktop-ideas'

const DIRECTION_STYLE: Record<IdeaDirection, string> = {
  buy:  'text-emerald-700 bg-emerald-50 dark:text-emerald-300 dark:bg-emerald-950/40',
  add:  'text-emerald-700 bg-emerald-50 dark:text-emerald-300 dark:bg-emerald-950/40',
  sell: 'text-rose-700 bg-rose-50 dark:text-rose-300 dark:bg-rose-950/40',
  trim: 'text-amber-800 bg-amber-50 dark:text-amber-300 dark:bg-amber-950/40',
}

export function DirectionPill({ direction }: { direction: IdeaDirection | null }) {
  if (!direction) return null
  return (
    <span className={clsx(
      'rounded-full px-2 py-[3px] text-[10px] font-bold uppercase tracking-[0.06em]',
      DIRECTION_STYLE[direction],
    )}>
      {direction}
    </span>
  )
}

export function MaturityPill({ maturity }: { maturity: IdeaMaturity }) {
  return (
    <span className="rounded-full bg-gray-100 px-2 py-[3px] text-[10px] font-semibold uppercase tracking-[0.05em] text-gray-600 dark:bg-white/[0.07] dark:text-gray-400">
      {MATURITY_LABEL[maturity]}
    </span>
  )
}

export function ConvictionPill({ conviction }: { conviction: string | null }) {
  if (!conviction) return null
  return (
    <span className="rounded-full border border-gray-200 px-2 py-[2px] text-[10px] font-medium text-gray-600 dark:border-white/10 dark:text-gray-400">
      {conviction} conviction
    </span>
  )
}

/** Ticker at mobile's headline weight — font-black, tight tracking. */
export function IdeaIdentity({
  symbol, company, size = 'md',
}: { symbol: string | null; company: string | null; size?: 'sm' | 'md' | 'lg' }) {
  const cls = size === 'lg' ? 'text-[30px]' : size === 'md' ? 'text-[22px]' : 'text-[15px]'
  return (
    <div className="flex min-w-0 items-baseline gap-2.5">
      <span className={clsx('font-black leading-[1.05] tracking-[-0.035em]', cls)}>
        {symbol ?? '—'}
      </span>
      {company && size !== 'sm' && (
        <span className="min-w-0 truncate text-[12px] font-medium text-gray-500 dark:text-gray-400">
          {company}
        </span>
      )}
    </div>
  )
}

export function Metric({
  value, label, tone,
}: { value: string; label: string; tone?: 'up' | 'down' | 'neutral' }) {
  return (
    <div className="min-w-0 flex-1 px-2.5 py-1">
      <span className={clsx(
        'block truncate font-mono text-[14px] font-semibold leading-tight tabular-nums',
        tone === 'up' && 'text-emerald-600 dark:text-emerald-400',
        tone === 'down' && 'text-rose-600 dark:text-rose-400',
      )}>
        {value}
      </span>
      <span className="mt-0.5 block text-[9px] font-semibold uppercase tracking-[0.07em] text-gray-500">
        {label}
      </span>
    </div>
  )
}

export function MetricStrip({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex divide-x divide-gray-200 overflow-hidden rounded-lg bg-gray-100/80 dark:divide-white/[0.07] dark:bg-white/[0.05]">
      {children}
    </div>
  )
}

/**
 * What has changed about the Idea, and when.
 *
 * Only what the data can prove. `trade_queue_items` stores no before/after
 * values, so this never renders "$180 → $215" or "Medium → High" — those would
 * be invented. `updated_at` supports "touched N ago", and the copy says
 * exactly that much and no more. A richer history belongs to the later
 * engagement-record stage.
 */
export function EvolutionStrip({ idea }: { idea: { updatedAt: string | null; createdAt: string } }) {
  const t = Date.parse(idea.updatedAt ?? idea.createdAt)
  if (!Number.isFinite(t)) return null
  const days = Math.floor((Date.now() - t) / 86_400_000)
  const isNew = !idea.updatedAt || idea.updatedAt === idea.createdAt

  const label = isNew
    ? days === 0 ? 'Raised today' : `Raised ${days}d ago`
    : days === 0 ? 'Updated today' : days === 1 ? 'Updated yesterday' : `Updated ${days}d ago`

  return (
    <div className={clsx(
      'flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-[10.5px]',
      days <= 7
        ? 'bg-blue-50 text-blue-800 dark:bg-blue-950/30 dark:text-blue-300'
        : 'bg-gray-100 text-gray-500 dark:bg-white/[0.05] dark:text-gray-400',
    )}>
      <span className="font-semibold">{label}</span>
      {days > 60 && <span className="ml-auto">no change in {Math.floor(days / 30)}mo</span>}
    </div>
  )
}
