/**
 * Desktop Ideas — shared identity primitives.
 *
 * Direction and maturity are rendered as two separate pills, deliberately.
 * One badge reading WATCH collapses "we lean long" and "the work is not
 * finished" into a single word that says neither. BUY · RESEARCHING says both.
 *
 * ── Direction is not severity ────────────────────────────────────────────
 *
 * BUY was emerald and SELL was rose, which read as good and bad. They are
 * neither: a sell is a stance, and selling a name we no longer believe in is
 * the correct outcome of good work. Direction now gets a restrained
 * categorical treatment -- weight and a rule separate the four, not hue -- so
 * the severity palette keeps meaning what it says elsewhere in the product.
 *
 * Maturity stays neutral for the same reason it always was: progress is not
 * good or bad.
 */

import { clsx } from 'clsx'
import { MATURITY_LABEL, type IdeaDirection, type IdeaMaturity } from '../../lib/desktop-ideas'

/**
 * ── Why these stopped being pills ────────────────────────────────────────
 *
 * Two `rounded-full` badges opened every card, so a field of ten put twenty of
 * them on one screen — the loudest marks on the surface, carrying the least
 * information, and the single strongest reason the cards read as an app rather
 * than an instrument. Direction and maturity are still both stated, still
 * separately, and still without hue ranking one above another. They are now
 * set as type: weight and letter-spacing separate them, and the border, the
 * fill and the capsule go.
 *
 * The distinction the old fill carried — increasing exposure solid, reducing
 * it outlined — survives as weight against colour, which is the same
 * categorical signal without the badge.
 */
const DIRECTION_TEXT: Record<IdeaDirection, string> = {
  buy: 'font-bold text-gray-900 dark:text-gray-100',
  add: 'font-bold text-gray-900 dark:text-gray-100',
  sell: 'font-semibold text-gray-500 dark:text-gray-400',
  trim: 'font-semibold text-gray-500 dark:text-gray-400',
}

export function DirectionPill({ direction }: { direction: IdeaDirection | null }) {
  if (!direction) return null
  return (
    <span className={clsx(
      'text-[10px] uppercase tracking-[0.14em]',
      DIRECTION_TEXT[direction],
    )}>
      {direction}
    </span>
  )
}

/**
 * Maturity and conviction, as type.
 *
 * The card stopped wearing capsules a stage ago; the workspace header kept
 * them, so opening an idea swapped a crisp typographic line for three filled
 * badges describing the same three facts. Same words, same order, same
 * separation -- carried by a rule and by weight, which is what the card does.
 */
export function MaturityPill({ maturity }: { maturity: IdeaMaturity }) {
  return (
    <span className="border-l border-gray-300 pl-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-gray-500 dark:border-white/15 dark:text-gray-400">
      {MATURITY_LABEL[maturity]}
    </span>
  )
}

export function ConvictionPill({ conviction }: { conviction: string | null }) {
  if (!conviction) return null
  return (
    <span className="border-l border-gray-300 pl-2 text-[10px] font-medium uppercase tracking-[0.12em] text-gray-500 dark:border-white/15 dark:text-gray-400">
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
      <span className="mt-0.5 block text-[9px] font-semibold uppercase tracking-widest text-gray-500">
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

  /*
    A line of metadata, not a filled panel.
    
    This was a rounded grey block the width of the lead column, holding four
    words. Filled zones are what the cards stopped using; the age is a fact
    about the claim above it and now sits under it as one.
  */
  return (
    <div className={clsx(
      'flex items-center gap-2 text-[10px] font-semibold uppercase tracking-wide',
      days <= 7 ? 'text-blue-700 dark:text-blue-300' : 'text-gray-400',
    )}>
      {/* "Updated 89d ago" and "no change in 2mo" are the same fact stated
          twice with different rounding. One of them is enough, and the exact
          one is more useful than the rounded one. */}
      <span className="font-semibold">{label}</span>
    </div>
  )
}
