import type { IdeaInput } from './builders/ideas'

/**
 * A canonical feed item, as the shared idea builder wants it.
 *
 * ── Why this is its own module ────────────────────────────────────────────
 *
 * `buildIdeaCard` is already the one place a feed post becomes a `SignalCard`
 * — identity, dedupe key, expiry, suppression and the maturity/stance
 * vocabulary all come from it and from `idea-shape` behind it. What was NOT
 * shared was the twenty lines of field-shuffling that get a `ScoredFeedItem`
 * into its input shape. That lived inline in `MobileDashboard`, so a second
 * shell could only reach the shared builder by copying the glue.
 *
 * Copying it is exactly the failure this convergence exists to prevent: the
 * two shells would agree about the builder and drift about what they fed it,
 * which is the subtlest way to end up with two products again.
 *
 * Pure, and deliberately free of React, Supabase and any clock, so both shells
 * and the tests call the same function.
 *
 * ── What it does NOT do ───────────────────────────────────────────────────
 *
 * It does not decide whether a card should exist. `buildIdeaCard` owns that,
 * and returns a suppression when the answer is no. This only translates.
 *
 * It also does not reach for enrichment. `ladderCaseCount` and
 * `hasPriceHistory` are capability inputs the CALLER resolves, because each
 * shell has its own source for them and neither belongs in a pure mapper.
 */

/** The subset of a feed item this mapper reads. Structural, so either shell's row fits. */
export interface FeedItemLike {
  id: string
  type: string
  content?: string | null
  title?: string | null
  created_at: string
  author?: {
    id?: string
    email?: string
    first_name?: string
    last_name?: string
    full_name?: string
  } | null
  asset?: { id: string; symbol: string; company_name?: string | null } | null
  portfolio?: { id?: string; name?: string | null } | null
  action?: string | null
  urgency?: string | null
  rationale?: string | null
  stage?: string | null
  target_price?: number | string | null
  conviction?: string | null
  time_horizon?: string | null
}

/** Enrichment the caller resolves, because its source differs per shell. */
export interface FeedItemCapabilities {
  /** Distinct rungs on this name's current case ladder. */
  ladderCaseCount?: number
  /** Whether a drawable cached price series exists for the subject. */
  hasPriceHistory?: boolean
}

/**
 * The author's display name, in the order the card should prefer.
 *
 * Email is last and is cut at the `@`: a card that says
 * "priya@example.com thinks" reads as a system notification, not a colleague.
 */
export function feedAuthorName(author: FeedItemLike['author']): string | null {
  if (!author) return null
  return (
    author.full_name ||
    [author.first_name, author.last_name].filter(Boolean).join(' ') ||
    author.email?.split('@')[0] ||
    null
  )
}

/** `null` unless the value is a real, finite number. A missing target is not zero. */
function numOrNull(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : null
}

export function feedItemToIdeaInput(
  item: FeedItemLike,
  can: FeedItemCapabilities = {},
): IdeaInput {
  const asset = item.asset ?? null
  return {
    id: item.id,
    type: item.type as IdeaInput['type'],
    content: item.content ?? null,
    title: item.title ?? null,
    createdAt: item.created_at,
    authorName: feedAuthorName(item.author),
    asset: asset
      ? { id: asset.id, symbol: asset.symbol, companyName: asset.company_name ?? null }
      : null,
    // All four real directions pass through untouched. Narrowing this to
    // buy/sell is how an ADD once rendered as SELL.
    action: item.action ?? null,
    urgency: item.urgency ?? null,
    rationale: item.rationale ?? null,
    portfolioName: item.portfolio?.name ?? null,
    // `stage` changes the card most: it is how a buy sketched this morning is
    // told from a buy sitting in front of a PM.
    stage: item.stage ?? null,
    targetPrice: numOrNull(item.target_price),
    conviction: item.conviction ?? null,
    timeHorizon: item.time_horizon ?? null,
    ladderCaseCount: can.ladderCaseCount ?? 0,
    hasPriceHistory: can.hasPriceHistory ?? false,
  }
}
