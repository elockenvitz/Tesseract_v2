/**
 * The panel grammar the five canonical desktop workspaces share.
 *
 * Ideas, Research, Portfolio and Decisions each grew their own `Module` and
 * `Stat` with the same border, radius, header rule and padding rhythm. Four
 * copies of one concept drift: a heading weight changes in one workspace and
 * the others quietly disagree.
 *
 * ── What this owns, and what it must never own ───────────────────────────
 *
 * It owns chrome: the border, the radius, the ground, the header band and its
 * heading/meta/action slots, the body padding. That is all.
 *
 * It owns NO investment semantics, no data fetching, no ranking, no chart, no
 * workspace layout. Each workspace still decides what a module contains, how
 * many there are and what they mean -- which is why this is `DesktopModule`
 * and not `UniversalCard`. A shared box is not a shared idea.
 *
 * ── Not everything should be a box ───────────────────────────────────────
 *
 * Decisions V1.1 established that an absence must not become a hero panel, and
 * `DesktopNote` exists for exactly that: prose, a footnote or a stated gap that
 * would be overstated by chrome. Reach for it rather than wrapping two words in
 * a bordered card.
 */

import { clsx } from 'clsx'
import { ArrowUpRight } from 'lucide-react'

export interface DesktopModuleProps {
  /** Anchor id, for in-page jumps. */
  id?: string
  title: string
  /** Right-aligned qualifier: a date, a count, a window. */
  meta?: string
  /** Right-aligned control. Sits after `meta` when both are present. */
  action?: React.ReactNode
  /** Span both columns of a two-column workspace grid. */
  span?: boolean
  /** Draw attention because the reader was sent here. */
  focused?: boolean
  /**
   * Stable handle for in-page scrolling: rendered as `data-module`.
   *
   * IdeaDetail's primary action scrolls to `[data-module="decision"]`, which
   * matched nothing because the attribute was never emitted -- the button
   * silently did nothing.
   */
  moduleKey?: string
  className?: string
  children: React.ReactNode
}

export function DesktopModule({
  id, title, meta, action, span, focused, moduleKey, className, children,
}: DesktopModuleProps) {
  return (
    <section
      id={id}
      data-testid="desktop-module"
      data-module={moduleKey}
      className={clsx(
        'overflow-hidden rounded-xl border bg-white shadow-sm dark:bg-[#141a25]',
        span && 'xl:col-span-2',
        focused
          ? 'border-blue-400 ring-2 ring-blue-200 dark:border-blue-600 dark:ring-blue-900/50'
          : 'border-gray-200 dark:border-white/[0.08]',
        className,
      )}
    >
      <div className="flex items-center gap-2 border-b border-gray-200/80 bg-gray-50/80 px-4 py-2 dark:border-white/10 dark:bg-white/[0.03]">
        <h3 className="text-[10px] font-semibold uppercase tracking-[0.1em] text-gray-500">{title}</h3>
        {meta && <span className="ml-auto text-[10.5px] text-gray-500">{meta}</span>}
        {action && <span className={clsx(meta ? 'ml-2' : 'ml-auto')}>{action}</span>}
      </div>
      <div className="px-4 py-3.5">{children}</div>
    </section>
  )
}

/**
 * A single figure with its label beneath.
 *
 * `tone` is deliberately narrow. It is for a number whose SIGN or state the
 * reader must not miss -- an unrealised loss, an outstanding count -- and never
 * for grading a price return or an outcome. Most stats want no tone at all.
 */
export function DesktopStat({
  value, label, tone,
}: {
  value: string
  label: string
  tone?: 'warn' | 'up' | 'down'
}) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 shadow-sm dark:border-white/10 dark:bg-white/[0.03]">
      <span className={clsx(
        'block font-mono text-[16px] font-semibold tabular-nums tracking-tight',
        tone === 'warn' && 'text-amber-700 dark:text-amber-400',
        tone === 'up' && 'text-emerald-600 dark:text-emerald-400',
        tone === 'down' && 'text-rose-600 dark:text-rose-400',
      )}>{value}</span>
      <span className="mt-0.5 block text-[9px] font-semibold uppercase tracking-[0.07em] text-gray-500">
        {label}
      </span>
    </div>
  )
}

/** A quiet line: a footnote, a caveat, a stated absence. Never a box. */
export function DesktopNote({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <p className={clsx('text-[10.5px] leading-snug text-gray-500', className)}>{children}</p>
  )
}

/** The canonical eyebrow. One tracking value across the whole desktop. */
export const EYEBROW = 'text-[9px] font-bold uppercase tracking-[0.1em] text-gray-500'

/**
 * An open section: a heading and its content, with no box around it.
 *
 * ── Why this exists ──────────────────────────────────────────────────────
 *
 * A detail page of five equally-weighted white rectangles tells the reader
 * that its five parts matter equally, which is almost never true. A written
 * thesis, a decision's stated reason and a list of key-values do not want the
 * same chrome: the first two want room and quiet, the third wants almost
 * nothing at all.
 *
 * Use `DesktopModule` for structured analytical comparison, a chart, a bounded
 * interaction or a genuinely distinct state. Use this for everything else --
 * prose, rationale, lightweight metadata, a stated absence.
 *
 * `lead` sets the section in the page's dominant type rather than the eyebrow
 * rhythm: for the one section that IS the object (the case, the reason we
 * decided), where a small grey label above it would undersell it.
 */
export function DesktopSection({
  id, title, meta, action, lead, className, children,
}: {
  id?: string
  title: string
  meta?: string
  action?: React.ReactNode
  lead?: boolean
  className?: string
  children: React.ReactNode
}) {
  return (
    <section id={id} data-testid="desktop-section" className={className}>
      <div className="flex items-baseline gap-2 border-b border-gray-200/70 pb-1.5 dark:border-white/[0.07]">
        <h3 className={clsx(
          lead
            ? 'text-[13px] font-semibold tracking-tight text-gray-900 dark:text-gray-100'
            : 'text-[10px] font-semibold uppercase tracking-[0.1em] text-gray-500',
        )}>
          {title}
        </h3>
        {meta && <span className="ml-auto text-[10.5px] text-gray-500">{meta}</span>}
        {action && <span className={clsx(meta ? 'ml-2' : 'ml-auto')}>{action}</span>}
      </div>
      <div className="pt-2.5">{children}</div>
    </section>
  )
}

/**
 * The analytical region of a detail page: a lead column and a context column.
 *
 * Stage 2B gave these pages the whole canvas and they kept using the top-left
 * quarter of it, because half-width modules auto-placed into a two-column grid
 * stack down the left and leave the right empty whenever the data is sparse.
 * Two explicit columns fix that: content flows down the column it belongs to,
 * and a column with nothing in it takes no width.
 *
 * The split is ~62/38 rather than 50/50 because the two columns are not peers.
 * The left is what the reader came to read; the right is what they need beside
 * it. Below `xl` it is one column, lead first.
 */
export function DesktopColumns({
  lead, context, className,
}: {
  lead: React.ReactNode
  /** Omit entirely when there is no context worth a column. */
  context?: React.ReactNode
  className?: string
}) {
  if (!context) {
    return <div className={clsx('flex max-w-[100ch] flex-col gap-6', className)}>{lead}</div>
  }
  return (
    <div className={clsx(
      'grid grid-cols-1 gap-x-8 gap-y-6 xl:grid-cols-[minmax(0,1.62fr)_minmax(300px,1fr)]',
      className,
    )}>
      <div className="flex min-w-0 flex-col gap-6">{lead}</div>
      <div className="flex min-w-0 flex-col gap-6">{context}</div>
    </div>
  )
}

/**
 * The deep handoffs.
 *
 * A focused Dashboard workspace answers why the tile appeared and stops. When
 * the reader needs the whole object -- every note, the workflow, the lists,
 * the estimates -- that is the product's own page, and this is how they get
 * there, carrying the reason they came.
 *
 * Deliberately quiet, and deliberately not the only thing here: a workspace
 * whose sole content is a link out has no reason to exist.
 */
export function DeepLinks({ children }: { children: React.ReactNode }) {
  return (
    <div className="mt-8 flex flex-wrap items-center gap-x-1 gap-y-1 border-t border-gray-200/70 pt-3 dark:border-white/[0.07]">
      <span className="mr-1 text-[10px] font-semibold uppercase tracking-[0.09em] text-gray-400">
        Full product
      </span>
      {children}
    </div>
  )
}

export function DeepLink({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[12px] text-gray-600 hover:bg-gray-100 hover:text-gray-900 dark:text-gray-400 dark:hover:bg-white/[0.06] dark:hover:text-gray-100"
    >
      {label}
      <ArrowUpRight className="h-3 w-3 opacity-70" />
    </button>
  )
}
