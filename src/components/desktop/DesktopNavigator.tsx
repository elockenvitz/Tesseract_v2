/**
 * The index beside the workspace.
 *
 * Ideas, Research, Portfolio and Decisions each answer a different question,
 * but all four do the same thing structurally: hold a ranked list of objects
 * while one of them is open, and let you move between them without losing the
 * list. That interaction is shared; what a row SAYS is not.
 *
 * ── Flat, not floating ───────────────────────────────────────────────────
 *
 * Three of the four rendered their index as a column of elevated mini-cards --
 * rounded, shadowed, gapped. At forty entries that is a second dashboard beside
 * the first, and it competes with the workspace it is supposed to serve.
 * Decisions used flat ruled rows and read as an index, which is what these are.
 * So the shell is flat here, and the rows are separated by a hairline rather
 * than by air.
 *
 * ── Section headings are optional and must be earned ─────────────────────
 *
 * Decisions groups by month because its list IS a chronology. Nothing else here
 * has a grouping dimension that means anything, so nothing else passes a
 * `section` -- a heading over an arbitrary partition is worse than none.
 *
 * ── No call to action in a row ───────────────────────────────────────────
 *
 * Selecting is the action. A "Review this" button repeated down a column is
 * what makes a record look like a queue of work, which is the mistake Decisions
 * V1.1 corrected and the reason this component exists at all.
 */

import { useEffect, useRef } from 'react'
import { clsx } from 'clsx'

export function DesktopNavigator({
  title, count, action, children,
}: {
  title: React.ReactNode
  count?: number
  /** Filter or control for the whole index. Sits at the right of the header. */
  action?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <aside
      data-testid="desktop-navigator"
      className="flex h-full w-[27%] min-w-[252px] shrink-0 flex-col border-r border-gray-200 dark:border-white/10"
    >
      <div className="shrink-0 border-b border-gray-200 px-3 py-2.5 dark:border-white/10">
        <div className="flex items-center gap-2">
          <h2 className="min-w-0 truncate text-[13px] font-semibold tracking-tight">{title}</h2>
          {count != null && <span className="font-mono text-[10.5px] text-gray-500">{count}</span>}
          {action && <div className="ml-auto">{action}</div>}
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
    </aside>
  )
}

/** A sticky group heading. Only where the grouping is real. */
export function DesktopNavSection({ label }: { label: string }) {
  return (
    <div className="sticky top-0 z-10 border-b border-gray-200/70 bg-gray-50/95 px-3 py-1 text-[9.5px] font-bold uppercase tracking-[0.09em] text-gray-500 backdrop-blur dark:border-white/10 dark:bg-[#0b0f16]/95">
      {label}
    </div>
  )
}

/**
 * One entry.
 *
 * `title` and `trailing` form the identity line; `children` is whatever else
 * the surface needs beneath it. Scrolls itself into view when selected, so
 * arriving from another workspace lands somewhere the reader can see.
 */
export function DesktopNavRow({
  selected, onSelect, title, trailing, testId, dataAttrs, children,
}: {
  selected: boolean
  onSelect: () => void
  title: React.ReactNode
  /** Right of the identity line: an age, a weight, a count. */
  trailing?: React.ReactNode
  testId?: string
  dataAttrs?: Record<string, string | undefined>
  children?: React.ReactNode
}) {
  const ref = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    if (selected && ref.current && typeof ref.current.scrollIntoView === 'function') {
      ref.current.scrollIntoView({ block: 'nearest' })
    }
  }, [selected])

  return (
    <button
      ref={ref}
      type="button"
      data-testid={testId ?? 'desktop-nav-row'}
      aria-current={selected}
      onClick={onSelect}
      {...Object.fromEntries(
        Object.entries(dataAttrs ?? {}).filter(([, v]) => v != null),
      )}
      className={clsx(
        'w-full border-b border-gray-200/70 px-3 py-2 text-left dark:border-white/[0.06]',
        selected
          ? 'bg-blue-50 dark:bg-blue-950/30'
          : 'hover:bg-gray-100/70 dark:hover:bg-white/[0.04]',
      )}
    >
      <div className="flex items-baseline gap-1.5">
        {title}
        {trailing && <span className="ml-auto shrink-0">{trailing}</span>}
      </div>
      {children}
    </button>
  )
}

/** The object symbol, at the one weight every navigator uses. */
export function NavSymbol({ children }: { children: React.ReactNode }) {
  return <span className="font-mono text-[12.5px] font-bold tracking-tight">{children}</span>
}

/** Secondary text on the identity line — a direction, an action verb. */
export function NavQualifier({ children }: { children: React.ReactNode }) {
  return (
    <span className="font-mono text-[9.5px] font-bold uppercase tracking-[0.06em] text-gray-500">
      {children}
    </span>
  )
}

/** Right-hand figure: age, weight, count. */
export function NavTrailing({ children }: { children: React.ReactNode }) {
  return <span className="font-mono text-[10px] text-gray-500">{children}</span>
}

/** The muted line beneath the identity line. */
export function NavMeta({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <span className={clsx('min-w-0 truncate text-[10.5px] text-gray-500', className)}>{children}</span>
  )
}
