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
  className?: string
  children: React.ReactNode
}

export function DesktopModule({
  id, title, meta, action, span, focused, className, children,
}: DesktopModuleProps) {
  return (
    <section
      id={id}
      data-testid="desktop-module"
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
