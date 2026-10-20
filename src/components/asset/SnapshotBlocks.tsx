/**
 * Snapshot-local presentation primitives.
 *
 * ── Why these are not `DesktopModule` ────────────────────────────────────
 *
 * `desktop/DesktopModule` is the SHARED panel grammar for six workspaces
 * (ideas-v2, research-v2, portfolio-v2, decisions-v2 ×2, asset-v2). The
 * Snapshot had to match the Asset Page's OWN Research language — 14/15px type,
 * one readable heading per block instead of a stack of 10px uppercase labels,
 * rounded-xl cards with a thin accent rail — and editing the shared chrome to
 * get there would have silently redesigned five other workspaces. So the
 * Snapshot carries its own blocks and the shared grammar is left alone.
 *
 * These own CHROME ONLY: no data, no investment semantics, no navigation
 * decisions. The Snapshot decides what a block contains and where a row goes.
 */

import { clsx } from 'clsx'
import { ChevronRight } from 'lucide-react'

/**
 * Status tones. Deliberately few, and each means one thing:
 *   waiting     — somebody owes a decision (amber, the only "act now" colour)
 *   recommended — raised, not yet ruled on
 *   done        — observed, evidenced (never "assumed")
 *   risk        — a contradiction or an unobserved claim
 * `neutral` carries no state at all. Colour is never applied to a whole card.
 */
export type Tone = 'neutral' | 'waiting' | 'recommended' | 'done' | 'risk'

const TONE_CHIP: Record<Tone, string> = {
  neutral: 'bg-gray-100 text-gray-600 dark:bg-white/[0.06] dark:text-gray-300',
  waiting: 'bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300',
  recommended: 'bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300',
  done: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300',
  risk: 'bg-rose-50 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300',
}

/** The accent rail. Only the two blocks that lead the page carry one. */
export type Rail = 'primary' | 'action'

const RAIL: Record<Rail, string> = {
  primary: 'border-l-[3px] border-l-blue-500',
  action: 'border-l-[3px] border-l-amber-400',
}

/**
 * A Snapshot section card, in Research's language: white, hairline, rounded-xl,
 * flat at rest. One heading at a readable size — not an eyebrow.
 */
export function SnapBlock({
  title, meta, rail, action, children, className, testId,
}: {
  title: string
  /** A qualifier beside the heading: a date, a count, a scope. */
  meta?: React.ReactNode
  rail?: Rail
  /** One contextual control, right-aligned. Not a row of generic links. */
  action?: React.ReactNode
  children: React.ReactNode
  className?: string
  testId?: string
}) {
  return (
    <section
      data-testid={testId}
      className={clsx(
        'rounded-xl border border-gray-200/80 bg-white dark:border-white/[0.08] dark:bg-[#141a25]',
        rail && RAIL[rail],
        className,
      )}
    >
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-5 pt-4">
        <h3 className="text-[15px] font-semibold tracking-tight text-gray-900 dark:text-gray-100">
          {title}
        </h3>
        {meta && <span className="text-xs text-gray-400 dark:text-gray-500">{meta}</span>}
        {action && <span className="ml-auto">{action}</span>}
      </div>
      <div className="px-5 pb-4 pt-2.5 text-sm leading-relaxed text-gray-700 dark:text-gray-300">
        {children}
      </div>
    </section>
  )
}

/** A small state label. Never a sentence, never a whole-card colour. */
export function StatusChip({ tone = 'neutral', children }: { tone?: Tone; children: React.ReactNode }) {
  return (
    <span className={clsx(
      'inline-flex shrink-0 items-center rounded px-1.5 py-px text-[11px] font-semibold uppercase tracking-wide',
      TONE_CHIP[tone],
    )}>
      {children}
    </span>
  )
}

/**
 * A missing piece of the case, stated in one line and actionable.
 *
 * This replaces the pattern where an absence ("no bear/bull case", "not held")
 * was given a full bordered module at the top of the page — the emptiest thing
 * on the screen drawn as the largest.
 */
export function GapChip({ label, onClick }: { label: string; onClick?: () => void }) {
  const cls = 'inline-flex items-center gap-1 rounded-md border border-dashed border-gray-300 px-2 py-0.5 text-xs text-gray-500 dark:border-white/15 dark:text-gray-400'
  if (!onClick) return <span className={cls}>{label}</span>
  return (
    <button
      type="button"
      onClick={onClick}
      className={clsx(cls, 'transition-colors hover:border-gray-400 hover:bg-gray-50 hover:text-gray-700 dark:hover:bg-white/[0.04]')}
    >
      {label}
      <ChevronRight className="h-3 w-3 opacity-60" />
    </button>
  )
}

/**
 * One actionable item: a state, what it is, where it lives — and a click that
 * goes there. The row IS the navigation, which is what replaced the identical
 * "Open in full" link-rows that used to sit under every module.
 */
export function ActionRow({
  tone, status, title, meta, onClick,
}: {
  tone?: Tone
  status: string
  title: string
  meta?: string
  onClick?: () => void
}) {
  const body = (
    <>
      <StatusChip tone={tone}>{status}</StatusChip>
      <span className="min-w-0 flex-1 truncate text-sm text-gray-800 dark:text-gray-200">{title}</span>
      {meta && <span className="shrink-0 text-xs text-gray-500">{meta}</span>}
      {onClick && <ChevronRight className="h-4 w-4 shrink-0 text-gray-300 group-hover:text-gray-500" />}
    </>
  )
  if (!onClick) {
    return <div className="flex items-center gap-2.5 rounded-lg px-2 py-1.5">{body}</div>
  }
  return (
    <button
      type="button"
      onClick={onClick}
      className="group -mx-2 flex w-[calc(100%+1rem)] items-center gap-2.5 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-gray-50 dark:hover:bg-white/[0.04]"
    >
      {body}
    </button>
  )
}

/** A stated absence or caveat. One quiet line, never a box. */
export function QuietLine({ children, className }: { children: React.ReactNode; className?: string }) {
  return <p className={clsx('text-sm text-gray-500 dark:text-gray-400', className)}>{children}</p>}

/** A label/value pair for the exposure figures. */
export function FactRow({ label, value }: { label: string; value: string | null }) {
  return (
    <li className="flex items-baseline gap-2">
      <span className={value ? 'text-gray-700 dark:text-gray-300' : 'text-gray-400'}>{label}</span>
      <span className={clsx(
        'ml-auto font-mono text-[13px] tabular-nums',
        value ? 'font-semibold text-gray-900 dark:text-gray-100' : 'text-gray-300 dark:text-gray-600',
      )}>
        {value ?? '—'}
      </span>
    </li>
  )
}
