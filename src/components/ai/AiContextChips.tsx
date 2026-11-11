/**
 * What this conversation is about, as a row the reader can see at a glance.
 *
 * ── The defect this closes ───────────────────────────────────────────────
 *
 * The pane's header said nothing about the active object unless the panel had
 * been opened from the engagement seam, and the seam's own header is the
 * frozen request: after walking from AAPL to MSFT it still announced AAPL, so
 * it is suppressed on disagreement and the reader was then left with no
 * indicator at all. On a 384px rail with a thread already scrolled, "which
 * company am I asking about" had no answer on screen.
 *
 * ── Why it is display-only, and must stay that way ───────────────────────
 *
 * The model's context is assembled SERVER-SIDE by the `ai-chat` function from
 * the conversation's tags. These chips describe that; they do not drive it. A
 * chip that set context would be a second, client-side source of truth for
 * what the model was told, and the two would diverge on the first bug.
 *
 * ── Why the target's extras are gated ────────────────────────────────────
 *
 * `subject` follows the reader (it comes from the active tab). `target` is the
 * engagement request and is never cleared. Anything taken from the target —
 * the ticker, the portfolio, the issue that raised it — is shown only while
 * the two still describe the same object, using the same `subjectsAgree` rule
 * that governs the bound-object header. Otherwise the row falls back to the
 * subject alone, which is always current.
 */
import { clsx } from 'clsx'
import { Briefcase, FileText, Layers, TrendingUp } from 'lucide-react'
import type { ReactNode } from 'react'
import { subjectsAgree, shortSubjectLabel } from '../../lib/ai/conversation-context'
import type { AiChatMode } from '../../lib/ai/chat-modes'

/** The active tab's object. The only one of the two inputs that follows navigation. */
export interface AiContextSubject {
  type: string
  id: string
  label?: string | null
}

/** The engagement request's fields this row can show. */
export interface AiContextTarget {
  objectType?: string
  objectId?: string
  label?: string | null
  symbol?: string | null
  portfolioName?: string | null
  issue?: { title?: string | null } | null
}

const TYPE_LABEL: Record<string, string> = {
  asset: 'Asset',
  portfolio: 'Portfolio',
  theme: 'Theme',
  note: 'Note',
  research_note: 'Research',
  trade_idea: 'Idea',
  quick_thought: 'Quick idea',
  decision: 'Decision',
  coverage: 'Coverage',
}

const TYPE_ICON: Record<string, ReactNode> = {
  asset: <TrendingUp className="h-2.5 w-2.5" />,
  portfolio: <Briefcase className="h-2.5 w-2.5" />,
  theme: <Layers className="h-2.5 w-2.5" />,
}

interface AiContextChipsProps {
  /** Where the reader is standing. */
  subject?: AiContextSubject | null
  /** Why the pane was opened, when it was opened from a surface. */
  target?: AiContextTarget | null
  mode?: AiChatMode
  className?: string
}

export function AiContextChips({
  subject = null, target = null, mode = 'compact', className,
}: AiContextChipsProps) {
  const targetSubject = target?.objectType && target?.objectId
    ? { type: target.objectType, id: target.objectId }
    : null
  /* Absent on either side is agreement, so a hand-built target or a reader on
     a dashboard does not suppress the extras. */
  const targetIsCurrent = subjectsAgree(targetSubject, subject)

  const type = subject?.type ?? (targetIsCurrent ? target?.objectType : undefined)
  const name = shortSubjectLabel(subject?.label) ?? (targetIsCurrent ? shortSubjectLabel(target?.label) : null)
  const symbol = targetIsCurrent ? (target?.symbol?.trim() || null) : null
  const portfolio = targetIsCurrent ? (target?.portfolioName?.trim() || null) : null
  const issue = targetIsCurrent ? (target?.issue?.title?.trim() || null) : null

  /* Nothing known is nothing shown. An empty indicator row is a band of
     chrome that says "context: " and stops. */
  if (!type && !name && !symbol && !portfolio && !issue) return null

  const typeLabel = type ? (TYPE_LABEL[type] ?? type.replace(/_/g, ' ')) : null

  return (
    <div
      data-testid="ai-context-chips"
      className={clsx(
        'flex-shrink-0 flex items-center gap-1.5 overflow-x-auto border-b px-3 py-1.5',
        'border-gray-200/80 bg-gray-50/70 dark:border-white/10 dark:bg-white/[0.03]',
        mode === 'research' && 'px-6',
        className,
      )}
    >
      <span className="shrink-0 text-[9px] font-semibold uppercase tracking-[0.1em] text-gray-500 dark:text-gray-500">
        About
      </span>

      {(symbol || name || typeLabel) && (
        <Chip
          icon={type ? TYPE_ICON[type] : null}
          label={typeLabel}
          value={symbol ?? name ?? ''}
          title={name ?? undefined}
        />
      )}

      {portfolio && <Chip icon={TYPE_ICON.portfolio} label="Portfolio" value={portfolio} />}

      {issue && (
        <Chip
          icon={<FileText className="h-2.5 w-2.5" />}
          label="Why"
          value={issue}
          title={issue}
          /* The reason is prose, not an identifier: it gets room to be read
             in research mode and a hard ceiling on the rail. */
          valueClassName={clsx('truncate', mode === 'research' ? 'max-w-[22rem]' : 'max-w-[9rem]')}
        />
      )}
    </div>
  )
}

function Chip({
  icon, label, value, title, valueClassName,
}: {
  icon?: ReactNode | null
  label?: string | null
  value: string
  title?: string
  valueClassName?: string
}) {
  if (!value && !label) return null
  return (
    <span
      title={title}
      className={clsx(
        'inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-[10.5px]',
        'border-gray-200 bg-white text-gray-600',
        'dark:border-white/10 dark:bg-white/[0.04] dark:text-gray-400',
      )}
    >
      {icon}
      {label && <span>{label}</span>}
      {value && (
        <span className={clsx('font-mono font-semibold text-gray-900 dark:text-gray-200', valueClassName)}>
          {value}
        </span>
      )}
    </span>
  )
}
