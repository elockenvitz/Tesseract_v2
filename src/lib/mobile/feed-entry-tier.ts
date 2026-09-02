import { cardTier, type CardTier } from '../signals/card-height'
import { ideaCardType } from '../signals/builders/ideas'
import type { SignalType } from '../signals/contract'

type AnyEntry = Record<string, any>

/**
 * How much room a feed entry's card will need, decided BEFORE it is built.
 *
 * ── Why this cannot wait for the card ─────────────────────────────────────
 *
 * `FeedSlot` reserves a box for an entry whether or not that entry is mounted,
 * and the whole windowing bargain rests on the reserved box being the same
 * size as the card that eventually fills it. Reading the tier off the card
 * after it mounts would satisfy that only for tiles the reader has already
 * passed: jumping straight to tile 40 would land at a different offset from
 * walking there, which is precisely the drift `feed-window.spec.ts` exists to
 * catch. So the height has to be knowable from the ENTRY.
 *
 * It is, because every entry either carries its contract card already or
 * carries the field its card type is derived from. This is the same shape of
 * function as `feedEntryKeys` next door, and for the same reason: the feed
 * needs to know something about an entry without rendering it.
 *
 * ── The card's type, not the ranker's ─────────────────────────────────────
 *
 * `ideaCardType`, not `ideaSignalType`. The ranker's version collapses `note`,
 * `thesis_update` and `message` into `thought` so the tail of the feed ranks
 * coherently — a deliberate coarsening documented at its definition, and the
 * wrong input here. `thought` is a compact tier; a research note rendered into
 * a compact box would be clipped. The tier has to follow what the card will
 * actually BE.
 *
 * ── Unknown kinds get a full screen ───────────────────────────────────────
 *
 * `tall` is one viewport, which is what every tile took before tiers existed.
 * So an entry shape this function does not recognise, or a card type nobody
 * has measured, keeps exactly today's layout. The failure mode of a wrong
 * guess here is a clipped card; the failure mode of no guess is a card with
 * some room to spare, and only one of those loses information.
 */
export function feedEntryTier(e: AnyEntry): CardTier {
  const t = entryCardType(e)
  return t ? cardTier(t) : 'tall'
}

function entryCardType(e: AnyEntry): SignalType | null {
  switch (e?.kind) {
    // Already contract cards — ask them.
    case 'scenario':
    case 'template':
      return (e.card?.type as SignalType) ?? null
    case 'signal':
      return (e.signal?.type as SignalType) ?? null
    // Posts: the builder's own map, so this cannot drift from what renders.
    case 'idea':
      return e.idea?.type != null ? ideaCardType(e.idea.type) : null
    case 'news':
      return 'news'
    /**
     * Attention, insight and lens entries are composed by the dashboard from
     * several sources and can each render as more than one card type, so there
     * is no single answer to give here. They keep the full screen until the
     * branches that build them are measured — see the header.
     */
    default:
      return null
  }
}
