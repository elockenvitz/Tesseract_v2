import { emit, suppress, type CardResult, type SignalCard, type SignalType } from '../contract'
import { gate, isQualityContent } from '../suppression'
import { actions, assetHref, dayKey } from './shared'

/**
 * The ideas feed, on the card contract.
 *
 * ── Why these were the last holdouts ──────────────────────────────────────
 *
 * Every machine-derived kind moved onto `SignalCardView` weeks ago. The posts
 * did not, because they are not observations — they are what a colleague
 * wrote. So they kept rendering through `ReelsFeedItem` and the old
 * `FeedTileHeader`, which meant the mobile feed still looked like two
 * products: a trade idea from Priya sat directly beside an active-risk card
 * wearing completely different furniture, in the same scroller.
 *
 * That is the same "two paradigms" complaint that drove the original
 * migration, surviving in the one place nobody had looked because the posts
 * were never counted among the "seven kinds".
 *
 * ── Surface: `desk`, not `research` ───────────────────────────────────────
 *
 * "Priya thinks this name is mispriced" and "the book is 6.2% overweight" are
 * not the same kind of claim. Folding posts into `research` would have put the
 * same badge on both, on exactly the cards where provenance matters most. A
 * reader should be able to tell a person's view from a machine's observation
 * before reading a word of either.
 *
 * ── What is deliberately NOT forced ───────────────────────────────────────
 *
 * No metric on most of them. A thought has no number, and inventing one — a
 * reaction count, a character count, a "score" — would put a figure in the
 * loudest slot on the card that nobody asked for and nothing acts on. The
 * metric block is omitted, which the card already handles.
 */

export type IdeaItemType =
  | 'quick_thought' | 'trade_idea' | 'pair_trade'
  | 'note' | 'thesis_update' | 'insight' | 'message'

const TYPE: Record<IdeaItemType, SignalType> = {
  quick_thought: 'thought',
  trade_idea: 'trade_idea',
  pair_trade: 'pair_trade',
  note: 'research_note',
  thesis_update: 'thesis_update',
  insight: 'thought',
  message: 'discussion',
}

/** The shape a post needs to become a card. Narrowed from `ScoredFeedItem`. */
export interface IdeaInput {
  id: string
  type: IdeaItemType
  /** Body text. May contain markup — stripped before it reaches a card. */
  content?: string | null
  title?: string | null
  createdAt: string
  authorName?: string | null
  asset?: { id: string; symbol: string; companyName?: string | null } | null
  /** trade_idea only. */
  action?: 'buy' | 'sell' | string | null
  urgency?: string | null
  rationale?: string | null
  portfolioName?: string | null
  /** pair_trade only. */
  longLegs?: { symbol: string }[]
  shortLegs?: { symbol: string }[]
  /** quick_thought only. */
  sentiment?: string | null
  tickerMentions?: string[]
}

/** Markup arrives from the editors; a card renders text. */
function stripMarkup(html: string): string {
  return html.replace(/<[^>]*>/g, ' ').replace(/&[a-z]+;/gi, ' ').replace(/\s+/g, ' ').trim()
}

/**
 * The claim, in the author's own words where possible.
 *
 * Deliberately NOT a generated summary. The headline of a post is the thing
 * the person wrote, and paraphrasing it would put words in their mouth on a
 * card that names them.
 */
function headlineFor(i: IdeaInput, body: string): string {
  const who = i.authorName?.trim()
  const sym = i.asset?.symbol
  switch (i.type) {
    case 'trade_idea': {
      const verb = i.action === 'sell' ? 'sell' : i.action === 'buy' ? 'buy' : 'trade'
      return sym
        ? `${who ?? 'Someone'} wants to ${verb} ${sym}${i.portfolioName ? ` in ${i.portfolioName}` : ''}`
        : `${who ?? 'Someone'} proposed a trade`
    }
    case 'pair_trade': {
      /**
       * "IDEA:" first, and the sides named.
       *
       * It read "<name> is long LLY against CLOV", which states the position
       * as though it were on. It is not: a pair trade in this feed is a
       * PROPOSAL somebody has put up for the desk, and a headline in the
       * present indicative is a claim about the book that is simply false.
       *
       * The prefix does that work in four characters, and the sides are named
       * as sides — Long and Short — rather than joined by "against", which
       * leaves a reader to work out which half is which.
       */
      const longs = (i.longLegs ?? []).map(l => l.symbol).join('/')
      const shorts = (i.shortLegs ?? []).map(l => l.symbol).join('/')
      if (!longs && !shorts) return `IDEA: pair trade from ${who ?? 'someone'}`
      const sides = [longs && `Long ${longs}`, shorts && `Short ${shorts}`].filter(Boolean)
      return `IDEA: ${sides.join(', ')}`
    }
    case 'note':
    case 'thesis_update':
      return i.title?.trim() || body.slice(0, 90)
    default:
      // The post itself is the headline. Truncated on a word boundary rather
      // than mid-syllable, because this is somebody's sentence.
      return body.length > 90 ? `${body.slice(0, 87).replace(/\s+\S*$/, '')}…` : body
  }
}

/**
 * What the SURFACE can do with this post.
 *
 * The old `MobileFeedActionRail` offered share, react, promote, ask and
 * readthrough as a vertical rail. Moving posts onto the card contract must not
 * quietly lose them — a migration that drops functionality while looking
 * tidier is the worst kind. They move into the card's menu, and the card only
 * offers what the caller says it can honour.
 */
export interface IdeaCapabilities {
  share?: boolean
  ask?: boolean
  /** Only a quick thought can be promoted to a trade idea. */
  promote?: boolean
  /** Only types with an `object_links` counterpart. */
  readthrough?: boolean
}

export function buildIdeaCard(i: IdeaInput, can: IdeaCapabilities = {}): CardResult {
  const type = TYPE[i.type] ?? 'thought'
  return gate(type, () => {
    const entity = i.asset?.symbol || i.id
    const body = stripMarkup(i.content ?? '') || stripMarkup(i.rationale ?? '')

    // A post with no words is not a post. This is the same content_quality bar
    // the other builders use, and it is what keeps the eight hardcoded
    // "discovery prompts" out of the feed.
    if (!isQualityContent(body) && !isQualityContent(i.title ?? '')) {
      return suppress('content_quality', entity, `empty ${i.type}`)
    }

    const headline = headlineFor(i, body)
    if (!isQualityContent(headline)) {
      return suppress('content_quality', entity, `headline: ${JSON.stringify(headline)}`)
    }

    const isTrade = i.type === 'trade_idea' || i.type === 'pair_trade'

    return emit({
      id: `idea:${i.type}:${i.id}`,
      type,
      surface: 'desk',
      // A colleague asking for something outranks a colleague noting
      // something. Nothing here is `critical`: a post is a person's view, and
      // a red rule on somebody's thought would devalue the mark everywhere it
      // means a real problem.
      severity: isTrade ? 'attention' : 'informational',
      headline,
      // No metric on a post. Inventing one — reaction counts, a score — would
      // put a number nobody asked for in the loudest slot on the card.
      metric: null,
      body: body || i.title || '',
      entity: i.asset
        ? { kind: 'asset', id: i.asset.id, name: i.asset.companyName || i.asset.symbol, ticker: i.asset.symbol }
        : { kind: 'project', id: i.id, name: headline.slice(0, 40) },
      context: [
        ...(i.authorName ? [{ label: i.authorName }] : []),
        ...(i.portfolioName ? [{ label: i.portfolioName }] : []),
        ...(i.urgency && i.urgency !== 'low' ? [{ label: `${i.urgency} urgency` }] : []),
        ...(i.sentiment ? [{ label: i.sentiment }] : []),
      ].slice(0, 3),
      // A trade idea argues about a price, so the tape is evidence for it. A
      // thought does not, and a sparkline under someone's musing would be
      // decoration — the rule the contract has held since the first builder.
      ...(isTrade && i.asset ? { evidence: { kind: 'sparkline' as const, data: { symbol: i.asset.symbol } } } : {}),
      actions: actions(
        // React, not "resolve". These are posts; the reader is an audience,
        // not an approver, and offering "Resolve" on a colleague's thought
        // would be a category error.
        isTrade
          ? { id: 'primary', label: 'Open idea', inline: false }
          : { id: 'capture', label: 'Capture', inline: true },
        i.asset
          ? { label: `Open ${i.asset.symbol}`, href: assetHref(i.asset.id) }
          : { label: 'Open post', href: `/feed/${i.id}` },
        isTrade ? [{ id: 'capture', label: 'Note', inline: true }] : [],
        // Everything the old action rail carried, minus what has become a
        // primary. Order is by how often it is reached for, not by how easy it
        // was to implement.
        [
          ...(can.ask ? [{ id: 'ask', label: 'Ask about this', inline: false }] : []),
          ...(can.share ? [{ id: 'share', label: 'Share with someone', inline: false }] : []),
          ...(can.promote ? [{ id: 'promote', label: 'Promote to trade idea', inline: false }] : []),
          ...(can.readthrough ? [{ id: 'readthrough', label: 'See what this refers to', inline: false }] : []),
          { id: 'snooze', label: 'Snooze for a week', inline: false },
          { id: 'dismiss', label: 'Dismiss', inline: false },
        ],
      ),
      provenance: {
        ...(i.authorName ? { actor: { name: i.authorName } } : {}),
        // The post's own timestamp. Never `new Date()` — a feed that re-dates
        // itself on every login tells the reader it was generated for them.
        occurredAt: i.createdAt,
        reason: i.authorName
          ? `${i.authorName} posted this to the team feed.`
          : 'Posted to the team feed.',
      },
      // Posts do not go stale the way a derived observation does — a thesis
      // update from March is still what somebody thinks until they say
      // otherwise. 60 days is long enough to stop repeating and short enough
      // that the feed does not become an archive.
      expiry: { staleAfterDays: 60 },
      dedupeKey: `${type}:${i.id}:${dayKey(i.createdAt)}`,
    } satisfies SignalCard)
  })
}
