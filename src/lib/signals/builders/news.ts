import {
  emit,
  suppress,
  type CardEntity,
  type CardMetric,
  type CardResult,
  type SignalCard,
} from '../contract'
import { gate, isDisplayableNumber, isQualityContent, isQuoteFresh } from '../suppression'
import { actions, assetHref, dayKey, pct } from './shared'

/**
 * A news story, with the book's stake in it.
 *
 * News is the only card type whose content arrives from outside the product,
 * which changes what the card is for. The other two tell you something about
 * your own book that you did not know; this one tells you something the world
 * did, and the value it adds is the second half — that you hold the name, and
 * at what size.
 *
 * A story about nothing the org owns is still worth a card (a CPI print moves
 * everything), which is why `EntityKind` has a `market` member. Making the
 * entity nullable instead would have broken dedupeKey, which needs one.
 */

export interface NewsInput {
  /** Stable per story. Syndicated reposts of one story share it. */
  id: string
  headline: string
  summary?: string | null
  url: string
  source: string
  /** ISO. */
  publishedAt: string
  /** The ticker the story is *about*, as opposed to ones it merely mentions. */
  primarySymbol?: string | null
  symbols?: string[]
  sentiment?: 'positive' | 'negative' | 'neutral' | null
  /** The asset in the book, when the primary symbol resolves to one. */
  asset?: { id: string; symbol: string; companyName?: string | null } | null
  /** Portfolios holding it, for the stake line. */
  heldIn?: string[]
  /** Largest weight the name takes in any one of them, percent. */
  maxWeightPct?: number | null
  /** Today's move for the primary symbol, if a quote is on hand. */
  quote?: { changePercent: number; asOf: string } | null
}

/** How old a story may be and still be news rather than history. */
const MAX_AGE_DAYS = 3
const DAY_MS = 86_400_000

export function buildNewsCard(input: NewsInput): CardResult {
  return gate('news', () => {
    const { id, headline, summary, url, source, publishedAt, asset, heldIn = [] } = input
    const entity = input.primarySymbol || asset?.symbol || id

    if (!isQualityContent(headline)) {
      return suppress('content_quality', entity, `headline: ${JSON.stringify(headline)}`)
    }
    if (!url) {
      return suppress('content_quality', entity, 'url is empty — the card would not open')
    }
    const published = new Date(publishedAt).getTime()
    if (!Number.isFinite(published)) {
      // No date means the eyebrow cannot say when this happened, and a news
      // card that cannot place itself in time is not fit to display. Routed
      // through content_quality rather than a new reason because the failure
      // is the same one: a field arrived unusable.
      return suppress('content_quality', entity, `publishedAt: ${JSON.stringify(publishedAt)}`)
    }
    const ageDays = (Date.now() - published) / DAY_MS
    if (ageDays > MAX_AGE_DAYS) {
      return suppress('resolved', entity, `published ${Math.round(ageDays)} days ago`)
    }

    const held = heldIn.length > 0
    const weight = input.maxWeightPct

    /**
     * The move is attached only when the quote is fresh.
     *
     * A stale quote does not suppress the *card* — the story is still news
     * whether or not we can price it — it suppresses the *number*. That
     * distinction is the whole reason a number carries its own `asOf`: the
     * alternative is a card showing "-4.2% today" from a quote taken
     * yesterday, which is worse than showing no number at all.
     */
    let metric: CardMetric | null = null
    const q = input.quote
    if (q && isDisplayableNumber(q.changePercent, { allowZero: true }) && isQuoteFresh(q.asOf)) {
      metric = {
        value: pct(q.changePercent),
        label: 'Today',
        direction: q.changePercent >= 0 ? 'good' : 'bad',
        source: 'quote',
        asOf: q.asOf,
      }
    }

    const cardEntity: CardEntity = asset
      ? {
          kind: 'asset',
          id: asset.id,
          name: asset.companyName || asset.symbol,
          ticker: asset.symbol,
        }
      : {
          // Not a thing the product owns. A macro print, or a name nobody here
          // covers — both are still worth reading, neither is an asset row.
          kind: 'market',
          id: input.primarySymbol || 'market',
          name: input.primarySymbol || 'Market',
          ticker: input.primarySymbol || undefined,
        }

    const stake = held && isDisplayableNumber(weight)
      ? `You hold it in ${heldIn.length} portfolio${heldIn.length === 1 ? '' : 's'}, up to ${weight!.toFixed(1)}% in ${heldIn[0]}.`
      : held
        ? `You hold it in ${heldIn.length} portfolio${heldIn.length === 1 ? '' : 's'}.`
        : ''

    // The summary, then the stake. If the provider gave no summary the stake
    // carries the body alone — better than repeating the headline underneath
    // itself, which is what the old tile did whenever a summary was missing,
    // and summaries were missing on entire batches of thirty.
    const body = [isQualityContent(summary) ? summary!.trim() : '', stake]
      .filter(Boolean)
      .join(' ')

    if (!body) {
      return suppress('content_quality', entity, 'no summary and no holding — headline only')
    }

    const card: SignalCard = {
      id: `news:${id}`,
      type: 'news',
      surface: 'market',
      // News is never critical. Something the market already knows is not an
      // emergency in the book, and a red rail on a headline would devalue the
      // rail everywhere else.
      severity: held ? 'attention' : 'informational',
      // The headline IS the message here — the one card type where the
      // contract's "full sentence carrying the number" is already satisfied by
      // the source, and rewriting it would be editorialising.
      headline: headline.trim(),
      metric,
      body,
      entity: cardEntity,
      context: [
        { label: source },
        ...(held ? [{ label: heldIn.length === 1 ? 'In 1 portfolio' : `In ${heldIn.length} portfolios` }] : []),
        ...(input.sentiment ? [{ label: input.sentiment }] : []),
      ],
      /**
       * Three things a reader actually wants from a story, each with an id the
       * surface routes.
       *
       * ── Why both buttons did nothing ────────────────────────────────────
       *
       * The secondaries carried an `href` and no `id`. The card dispatches on
       * `onAction(a.id, card)` and never reads `href`, so each fired with an
       * undefined id — and fell through to the news card's `onPrimary`, which
       * was an empty function. Two independent reasons for the same silence,
       * which is why it looked like the buttons were decorative.
       *
       * Read opens the story. Capture writes a thought against the name while
       * it is still in front of you — the whole reason a story sits in a
       * research feed rather than a newsreader. Open <SYMBOL> appears only
       * when there IS a resolved asset; a macro story has nowhere to send
       * anybody, and a button that admits that is better than one that guesses.
       */
      actions: actions(
        { id: 'read', label: 'Read', inline: true },
        // The `open` slot is a NAVIGATION and takes an href, not an id — which
        // is why giving it one changed nothing.
        asset
          ? { label: `Open ${asset.symbol}`, href: assetHref(asset.id) }
          : { label: 'Open source', href: url },
        // Capture is a quick action, so it dispatches through `onAction`, and
        // the card surface already routes `capture` to the composer.
        [{ id: 'capture', label: 'Capture', inline: true }],
      ),
      provenance: {
        occurredAt: publishedAt,
        reason: held
          ? `${source} published this about ${cardEntity.ticker ?? cardEntity.name}, which you hold in ${heldIn.length} portfolio${heldIn.length === 1 ? '' : 's'}.`
          : `${source} published this about ${cardEntity.ticker ?? cardEntity.name}, which sits adjacent to what the desk covers.`,
      },
      expiry: {
        staleAfterDays: MAX_AGE_DAYS,
      },
      // The story, not the ticker: two stories about one name on one day are
      // two claims, and only a syndicated repost of the same story is the same
      // claim recurring.
      dedupeKey: `news:${id}:${dayKey(publishedAt)}`,
    }

    return emit(card)
  })
}
