/**
 * The small line that says where a number came from and when it was true.
 *
 * ── Why this is not decoration ────────────────────────────────────────────
 *
 * An EODHD quote is delayed by 15 to 20 minutes, and its timestamp is the
 * last TRADE instant rather than the moment the snapshot was generated — so a
 * thinly traded name can read half an hour old and be perfectly healthy.
 * Without a badge, a reader comparing that figure against a live venue price
 * has no way to know which of the two is stale, and the product's provenance
 * rule exists precisely so that question is answerable from the screen.
 *
 * It renders nothing for an unlabelled Yahoo quote, so no existing surface
 * gains a badge it did not have. Only data that arrives WITH a delivery
 * statement gets one.
 */
import { AlertTriangle, Clock } from 'lucide-react'
import type { AdapterFailure } from '../../lib/market-data/contracts'
import { deliveryLabel, failureMessage } from '../../lib/market-data/eodhd-series'

export interface DataProvenanceBadgeProps {
  /** `delayed` / `eod` / `realtime`, as the provider stated it. */
  delivery?: string
  /** The instant the figure was true, ISO 8601. */
  effectiveAt?: string
  /**
   * How precisely `effectiveAt` is known.
   *
   * `session_date` means only the trading DATE is known: the server stamps
   * midnight UTC as a deliberate lower bound, so the age shown can only be an
   * over-statement. The badge says "bar" rather than a clock time in that
   * case, because printing 00:00 as a time would be a claim nobody made.
   */
  precision?: 'instant' | 'session_date'
  /** Raw versus adjusted, where stated. */
  adjustment?: string
  /** Shown instead of a timestamp when the provider declined. */
  failure?: AdapterFailure
  className?: string
}

/** A short, honest age. Never negative, never a false precision. */
function ageLabel(effectiveAt: string, precision?: 'instant' | 'session_date'): string | null {
  const at = Date.parse(effectiveAt)
  if (!Number.isFinite(at)) return null

  if (precision === 'session_date') {
    // Only the date is known. Say the date.
    return new Date(at).toISOString().slice(0, 10)
  }

  const minutes = Math.floor((Date.now() - at) / 60_000)
  // A clock skew should not render as a price from the future.
  if (minutes < 0) return 'just now'
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  return new Date(at).toISOString().slice(0, 10)
}

export function DataProvenanceBadge({
  delivery,
  effectiveAt,
  precision,
  adjustment,
  failure,
  className = '',
}: DataProvenanceBadgeProps) {
  if (failure) {
    return (
      <span
        className={`inline-flex items-center gap-1 text-xs text-amber-600 dark:text-amber-400 ${className}`}
        title={'detail' in failure ? failure.detail : undefined}
      >
        <AlertTriangle className="w-3 h-3" aria-hidden="true" />
        {failureMessage(failure)}
      </span>
    )
  }

  // Nothing stated, nothing claimed. This keeps every pre-existing Yahoo
  // surface looking exactly as it did.
  if (!delivery && !effectiveAt) return null

  const label = delivery ? deliveryLabel(delivery) : null
  const age = effectiveAt ? ageLabel(effectiveAt, precision) : null

  /*
   * The tooltip carries the full instant and the adjustment basis. The
   * inline text stays to two short tokens so it fits beside a price on a
   * phone without wrapping the price onto a second line.
   */
  const tooltip = [
    effectiveAt
      ? precision === 'session_date'
        ? `Trading date ${effectiveAt.slice(0, 10)} (time within the day not stated)`
        : `As of ${effectiveAt}`
      : null,
    adjustment && adjustment !== 'unknown' ? `Basis: ${adjustment.replace(/_/g, ' ')}` : null,
  ]
    .filter(Boolean)
    .join(' · ')

  return (
    <span
      className={`inline-flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400 ${className}`}
      title={tooltip || undefined}
    >
      <Clock className="w-3 h-3" aria-hidden="true" />
      {label && <span>{label}</span>}
      {label && age && <span aria-hidden="true">·</span>}
      {age && <span>{age}</span>}
    </span>
  )
}
