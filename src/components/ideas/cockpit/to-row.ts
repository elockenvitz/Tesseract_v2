/**
 * A ranked feed row, as the cockpit needs to render it.
 *
 * The adapter between the ranking pipeline and the presentation layer, and the
 * only place the two meet. Everything downstream of here is props; everything
 * upstream is the canonical ranker. That boundary is what keeps `IdeaRow`
 * gallery-pure and therefore screenshot-testable at real viewport sizes.
 *
 * It derives nothing it can borrow. The headline comes from `builders/ideas`,
 * which is where a post's name is decided for the mobile card; the type label
 * comes from `KIND_LABEL`, which is where a signal type's name is decided for
 * every surface. A cockpit that invented either would be a second vocabulary.
 */

import { ideaCardType, ideaHeadline } from '../../../lib/signals/builders/ideas'
import { KIND_LABEL } from '../../signals/card-identity'
import type { Priority } from '../../../lib/signals/feed-priority'
import { canonicalTypeFor, type GeneratedSignal } from '../../../lib/ideas/signal-candidates'
import type { IdeaRowModel } from './IdeaRow'

/** The shape a ranked feed row arrives in. Structural, so a test can build one. */
export interface RankedFeedRow {
  id: string | number
  type: string
  created_at: string
  content?: string | null
  title?: string | null
  rationale?: string | null
  action?: string | null
  asset?: { id?: string | null; symbol?: string | null; company_name?: string | null } | null
  author?: { id?: string | null; first_name?: string | null; last_name?: string | null } | null
  long_legs?: readonly { asset?: { symbol?: string } }[]
  short_legs?: readonly { asset?: { symbol?: string } }[]
  /** The canonical ranking result the feed hook attaches to every scored row. */
  priority?: unknown
}

/**
 * Age as a glance, not a timestamp.
 *
 * A row is scanned, not read: "3d" lands in peripheral vision where
 * "25 August, 14:32" has to be parsed. Precision beyond the unit is noise —
 * nobody triages differently at 3.4 days than at 3.
 */
export function compactAge(createdAt: string, now: number): string {
  const ms = now - new Date(createdAt).getTime()
  if (!Number.isFinite(ms)) return ''
  const minutes = Math.floor(ms / 60_000)
  if (minutes < 1) return 'now'
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h`
  const days = Math.floor(hours / 24)
  if (days < 14) return `${days}d`
  const weeks = Math.floor(days / 7)
  if (weeks < 9) return `${weeks}w`
  return `${Math.floor(days / 30)}mo`
}

const authorName = (a: RankedFeedRow['author']): string | undefined => {
  const name = [a?.first_name, a?.last_name].filter(Boolean).join(' ').trim()
  return name || undefined
}

export function toIdeaRow(item: RankedFeedRow, now: number): IdeaRowModel {
  const priority = item.priority as Priority | undefined
  const signalType = ideaCardType(item.type)

  return {
    id: String(item.id),
    symbol: item.asset?.symbol ?? null,
    kindLabel: KIND_LABEL[signalType] ?? 'Update',
    headline: ideaHeadline({
      id: String(item.id),
      type: item.type as any,
      content: item.content,
      rationale: item.rationale,
      title: item.title,
      action: item.action as any,
      authorName: authorName(item.author),
      asset: item.asset?.symbol
        ? {
            id: item.asset.id ?? '',
            symbol: item.asset.symbol,
            companyName: item.asset.company_name ?? undefined,
          }
        : undefined,
      longLegs: item.long_legs?.map(l => ({ symbol: l.asset?.symbol ?? '' })),
      shortLegs: item.short_legs?.map(l => ({ symbol: l.asset?.symbol ?? '' })),
    } as any),
    age: compactAge(item.created_at, now),
    reasons: priority?.reasons ?? [],
    // A row with no priority is not an error — the generated discovery prompts
    // are synthesised after ranking — and it belongs at the bottom band rather
    // than pretending to a tier it was never given.
    tier: priority?.tier ?? 4,
    actionable: item.type === 'trade_idea' || item.type === 'pair_trade',
  }
}

/**
 * A system signal, as a row.
 *
 * The `whyNow` line is the signal's own `body` — "3 contributors have posted
 * recently, but no formal trade idea exists yet". Posts do not get one: their
 * headline already IS the content, and repeating a truncated version of it
 * under itself is how a dense list becomes a sparse one. A signal's headline
 * states the finding and the body states why it matters, which is exactly the
 * split an Attention row wants.
 *
 * `age` is empty on purpose. These describe standing conditions with no event
 * behind them — see `signalPriorityInput` — so a duration would be a
 * measurement of when the query ran.
 */
export function signalToIdeaRow(signal: GeneratedSignal, priority: Priority): IdeaRowModel {
  const type = canonicalTypeFor(signal.signalType)
  return {
    id: signal.id,
    symbol: signal.relatedAssets[0]?.symbol ?? null,
    kindLabel: (type && KIND_LABEL[type]) || 'Signal',
    headline: signal.headline,
    whyNow: signal.body,
    age: '',
    reasons: priority.reasons,
    tier: priority.tier,
    actionable: true,
  }
}
