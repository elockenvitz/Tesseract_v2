import type { AttentionEntry } from '../../hooks/useDesktopAttentionFeed'
import type { AssetFocus } from '../desktop-asset/navigate'
import type { ScoredFeedItem } from '../../hooks/ideas/types'

/**
 * What the workspace router needs, and nothing else.
 *
 * ── Why not just hold the entry ───────────────────────────────────────────
 *
 * `AttentionEntry` carries a built card, a feed row and a builder input. All
 * three are PRESENTATION and all three are rebuilt whenever the candidate list
 * reranks, refetches or a page arrives. A workspace keyed on any of them would
 * be a workspace that can be invalidated by a background refresh of the feed
 * behind it — the reader is working, a page lands, and the object they had
 * open is a different JavaScript value.
 *
 * So selection is reduced to identity at the moment of the click and then held
 * on its own. The feed may rebuild underneath it as often as it likes.
 *
 * ── Why identity and not labels ───────────────────────────────────────────
 *
 * Nothing here is a title, a headline or a surface word. Branching on a
 * presentation string is how a copy change silently reroutes a workspace.
 * `family` comes from the producer that made the candidate; the ids come from
 * the card's own entity.
 */
export interface IdeasSelection {
  /**
   * Which producer made this. Decides the work surface.
   *
   * `'explore'` is the one value no producer emits: a preview opened from
   * Explore that has no candidate behind it in the attention pool. It names an
   * asset and nothing more specific, so it opens the asset at `overview` — see
   * `assetFocusFor`. It is a family the router can route and NOT a second
   * selection type, which is the thing Explore must not grow.
   */
  family: AttentionEntry['family'] | 'explore'
  /**
   * Which surface the reader was on when they selected this.
   *
   * Carried for RECONCILIATION, not for routing — the work surface is the same
   * either way, which is the whole point of the convergence. The Ideas feed
   * clears a selection that its own lens or facets no longer contain, and that
   * rule cannot be applied to something the reader opened from Explore: they
   * never asked the Ideas feed for it, so the Ideas feed's context has no
   * standing to take it away.
   */
  origin: 'ideas' | 'explore'
  /**
   * The card id. Used ONLY to mark the selected tile, so it must match
   * `AttentionEntry.key` — and must not be used to resolve data, because a
   * card id is a presentation identity.
   */
  key: string
  /** The underlying object, where the family has one distinct from the asset. */
  objectId: string | null
  /**
   * Which post this is, for `family === 'post'` only.
   *
   * Resolved ONCE at selection time from the feed row's own type and idea_type,
   * rather than re-derived in the router. A prompt is a `quick_thought` row
   * with `idea_type: 'prompt'`, and working that out in two places is how the
   * two places start disagreeing.
   */
  postType: 'trade_idea' | 'thought' | 'prompt' | null
  /**
   * The feed row, for the one surface that needs it.
   *
   * The trade-idea workspace maps this row onto the desktop Idea object rather
   * than re-reading `trade_queue_items` for something the caller is holding.
   * Presentation is NEVER read off it — only identity.
   */
  item: ScoredFeedItem | null
  assetId: string | null
  symbol: string | null
  portfolioId: string | null
  portfolioName: string | null
  /**
   * Why this surfaced, carried so the workspace is entered FROM an attention
   * event rather than arrived at cold.
   *
   * Taken from what the deterministic candidate already knows — the card's own
   * headline and provenance. Nothing is regenerated, and nothing is asked of a
   * model that the builder already computed.
   */
  why: {
    headline: string
    reason: string | null
    occurredAt: string | null
  }
}

/**
 * Which part of the asset workspace a finding is about.
 *
 * A stale target and a target hit are both arguments about the TARGET, so they
 * land on research where the case lives. Conviction and crowding are arguments
 * about the POSITION. A scenario gap is the case measured against price, which
 * is the framework. None of these is a guess about what the reader wants next;
 * each is where the object the finding is about actually lives.
 */
const FOCUS_FOR_FAMILY: Record<string, AssetFocus> = {
  stale_target: 'research',
  target_hit: 'research',
  scenario_gap: 'framework',
  conviction: 'position',
  crowding: 'position',
}

export function assetFocusFor(family: IdeasSelection['family']): AssetFocus {
  return FOCUS_FOR_FAMILY[family] ?? 'overview'
}

/** A prompt is a `quick_thought` row that says so, or carries an assignee tag. */
function postTypeOf(item: ScoredFeedItem | null): IdeasSelection['postType'] {
  if (!item) return null
  if (item.type === 'trade_idea' || item.type === 'pair_trade') return 'trade_idea'
  if (item.type === 'quick_thought') {
    const t = item as unknown as { idea_type?: string | null; tags?: string[] | null }
    const isPrompt = t.idea_type === 'prompt' ||
      (Array.isArray(t.tags) && t.tags.some(tag => tag.startsWith('assignee:')))
    return isPrompt ? 'prompt' : 'thought'
  }
  if (item.type === 'note') return 'thought'
  return null
}

export function selectionFor(entry: AttentionEntry): IdeasSelection {
  const card = entry.card
  const book = (card as unknown as { books?: { id?: string; name?: string }[] }).books?.[0]
  return {
    family: entry.family,
    origin: 'ideas',
    key: entry.key,
    // A post's own row id is the object; a finding's object IS its asset.
    objectId: entry.family === 'post' ? entry.item?.id ?? null : null,
    postType: entry.family === 'post' ? postTypeOf(entry.item) : null,
    item: entry.family === 'post' ? entry.item : null,
    assetId: card.entity?.kind === 'asset' ? card.entity.id : null,
    symbol: card.entity?.ticker ?? null,
    portfolioId: book?.id ?? null,
    portfolioName: book?.name ?? null,
    why: {
      headline: card.headline,
      reason: card.provenance?.reason ?? null,
      occurredAt: card.provenance?.occurredAt ?? null,
    },
  }
}
