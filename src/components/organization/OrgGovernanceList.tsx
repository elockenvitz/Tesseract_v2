/**
 * Governance rows for a phone.
 *
 * Both Governance surfaces — Manage and Report — are desktop tables, and both
 * ask the same three questions of a person: who are they, what access do they
 * have, and is any of it risky. A table answers that well at 1200px and badly
 * at 390px: the columns either force a sideways scroll or get hidden, and
 * hiding them silently drops governance data from the screen where someone is
 * deciding whether the access is correct.
 *
 * So on a phone each person becomes a row that carries identity and the
 * role summary, and opens — at full width, outside any column geometry — to
 * the detail the columns were holding. Nothing is dropped; it is just no
 * longer arranged as columns.
 *
 * The desktop tables are untouched and still render from `sm` up.
 */

import type { ReactNode, Ref } from 'react'
import { ChevronRight } from 'lucide-react'

interface GovernanceListRowProps {
  name: string
  email: string
  /** Status pill, shown beside the name. */
  status?: ReactNode
  /** Risk indicator, shown after the status. */
  badge?: ReactNode
  /** Role chips — the line this list is scanned for. */
  meta?: ReactNode
  /** Quieter counts beneath the roles. */
  secondaryMeta?: ReactNode
  expanded: boolean
  onToggle: () => void
  /** Suspended people are dimmed, matching the table. */
  dimmed?: boolean
  children?: ReactNode
  rowRef?: Ref<HTMLDivElement>
}

/**
 * One person, collapsed to identity + roles, expanding in place.
 *
 * The expansion is a sibling of the button rather than inside it, so the
 * detail can contain its own controls — a button cannot nest a button, and
 * the expanded panel has "Manage roles", Grant/Remove and risk actions in it.
 */
export function GovernanceListRow({
  name,
  email,
  status,
  badge,
  meta,
  secondaryMeta,
  expanded,
  onToggle,
  dimmed,
  children,
  rowRef,
}: GovernanceListRowProps) {
  return (
    <div ref={rowRef} data-slot="governance-person" className={dimmed ? 'opacity-60' : ''}>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        data-slot="governance-person-toggle"
        className="flex w-full items-start gap-2 px-3 py-2.5 text-left active:bg-gray-50 dark:active:bg-gray-900"
      >
        {/* Spans throughout: a button may not contain block elements, and the
            layout needs stacked lines regardless. */}
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5">
            <span className="min-w-0 flex-1 truncate text-sm font-medium text-gray-900 dark:text-white">
              {name}
            </span>
            {status}
            {badge}
          </span>
          <span className="mt-0.5 block truncate text-xs text-gray-400">{email}</span>
          {meta && <span className="mt-1 flex flex-wrap items-center gap-1">{meta}</span>}
          {secondaryMeta && (
            <span className="mt-1 block text-[11px] text-gray-400">{secondaryMeta}</span>
          )}
        </span>
        <ChevronRight
          className={`mt-0.5 h-4 w-4 shrink-0 text-gray-300 transition-transform ${expanded ? 'rotate-90' : ''}`}
        />
      </button>

      {expanded && children && (
        <div className="border-t border-gray-100 dark:border-gray-800">{children}</div>
      )}
    </div>
  )
}

/**
 * A labelled block inside an expanded row.
 *
 * Used by the Report expansion to carry the columns a phone cannot show —
 * Teams, Portfolios, Admin Roles, Risk Flags — as full-width sections.
 */
export function GovernanceDetailSection({
  title,
  count,
  tone = 'default',
  children,
}: {
  title: string
  count?: number
  tone?: 'default' | 'risk'
  children: ReactNode
}) {
  return (
    <div>
      <div
        className={`text-[10px] font-semibold uppercase tracking-wider ${
          tone === 'risk' ? 'text-red-600' : 'text-gray-400'
        }`}
      >
        {title}
        {count != null && ` (${count})`}
      </div>
      <div className="mt-1">{children}</div>
    </div>
  )
}

/**
 * Names as wrapping rows rather than truncated chips.
 *
 * The table truncates team and portfolio names to keep row heights equal.
 * There are no columns to keep equal here, and a governance reviewer needs
 * the whole name, so these wrap.
 */
export function GovernanceNameList({
  items,
  empty = '—',
}: {
  items: string[]
  empty?: string
}) {
  if (items.length === 0) {
    return <p className="text-xs text-gray-400">{empty}</p>
  }
  return (
    <ul className="space-y-0.5">
      {items.map(item => (
        <li key={item} className="break-words text-xs text-gray-600 dark:text-gray-400">
          {item}
        </li>
      ))}
    </ul>
  )
}
