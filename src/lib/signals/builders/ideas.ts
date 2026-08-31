import { emit, suppress, type CardMetric, type CardResult, type SignalCard, type SignalType } from '../contract'
import { gate, isQualityContent } from '../suppression'
import { actions, assetHref, dayKey } from './shared'

/**
 * The metric's label carries the horizon when the author set one.
 *
 * A target with no time on it is a wish; "$310 by the long horizon" is a claim
 * somebody can be held to. Where no horizon was stated the label says only
 * what is true.
 */
const HORIZON_METRIC_LABEL: Record<string, string> = {
  short: 'Target · short horizon',
  medium: 'Target · medium horizon',
  long: 'Target · long horizon',
}
import { ideaShapeFor, maturityOf, stanceOf } from '../idea-shape'

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
  /** trade_idea only. All four real directions — see `idea-shape`. */
  action?: 'buy' | 'sell' | 'add' | 'trim' | string | null
  urgency?: string | null
  rationale?: string | null
  portfolioName?: string | null
  /**
   * The investment content, joined as of Mobile Ideas V2.
   *
   * Every field is optional and every absence is a real state: an idea with no
   * target is a legitimate and common thing to write, and the card says so by
   * showing no metric rather than by showing a zero.
   */
  /** `trade_queue_items.stage`. Drives the maturity pill. */
  stage?: string | null
  /** The author's own number. */
  targetPrice?: number | null
  conviction?: 'low' | 'medium' | 'high' | string | null
  timeHorizon?: string | null
  /** Distinct rungs on this name's current case ladder. */
  ladderCaseCount?: number
  /** Whether a drawable cached series exists for the subject. */
  hasPriceHistory?: boolean
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
      /**
       * The author's own verb, for all four directions.
       *
       * This read `action === 'sell' ? 'sell' : action === 'buy' ? 'buy' :
       * 'trade'`, so every `add` and every `trim` — both real values of the
       * enum — collapsed to the word "trade". An analyst who asked the desk to
       * trim a position had their card say "wants to trade MSFT", which is
       * both vaguer than what they said and, on a name the book already holds,
       * actively misleading about whether a new position is being proposed.
       */
      const stance = stanceOf(i.action)
      const verb = stance
        ? { buy: 'buy', sell: 'sell', add: 'add to', trim: 'trim' }[stance.stance]
        : null
      if (!sym) return `${who ?? 'Someone'} proposed a trade`
      if (!verb) return `${who ?? 'Someone'} raised an idea on ${sym}`
      const where = i.portfolioName ? ` in ${i.portfolioName}` : ''
      return `${who ?? 'Someone'} wants to ${verb} ${sym}${where}`
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
  /**
   * Whether the caller can open the full idea.
   *
   * Declared rather than assumed, for the reason `feed-actions` gives: an
   * action may only be offered where the surface can honour it. The desktop
   * feed has no idea detail, so it does not set this and the entry does not
   * appear.
   */
  openDetail?: boolean
}

/**
 * What "open this" is called, given what the idea is about.
 *
 * ── Why not just "Open idea" ──────────────────────────────────────────────
 *
 * Because the destination is the same but the reason for going is not, and the
 * label is the only thing that tells a reader whether it is worth the tap. On
 * an idea resting on a price the answer is the target; on one resting on a case
 * ladder it is the cases; on one that is purely an argument it is the argument.
 *
 * Every label here resolves to the SAME detail surface, which is what keeps
 * this honest — these are four descriptions of one place, not four promises.
 * `feed-actions` forbids a contextual label whose destination does not exist;
 * it does not forbid naming a real destination by what the reader will find
 * there.
 */
const DETAIL_LABEL: Record<string, string> = {
  scenario: 'Review the cases',
  target: 'Review the target',
  performance: 'Revisit this idea',
  narrative: 'Read the full idea',
}

/**
 * The contract type a post becomes, and the id its card carries.
 *
 * Exported because the FEED needs both before the card exists. `rankInputFor`
 * looks a stored judgment up by `type + entity`, and a post's entity is its own
 * card id — so a ranker that guessed either half would look up a key nothing
 * ever wrote, and every answer to every post would silently fail to suppress.
 *
 * The ranker's own `ideaSignalType` is deliberately NOT this: it answers a
 * coarser question ("is this a trade idea or a thought") that drives tiering,
 * and it collapses `note`, `thesis_update` and `message` into `thought`. Two
 * questions, two functions, and this is the one the disposition store speaks.
 */
export function ideaCardType(itemType: unknown): SignalType {
  return TYPE[itemType as IdeaItemType] ?? 'thought'
}

export function ideaCardId(itemType: unknown, id: string): string {
  return `idea:${String(itemType)}:${id}`
}

/**
 * The question the card puts to the reader, in one place.
 *
 * ── Why this is exported ──────────────────────────────────────────────────
 *
 * `SignalCardView` suppresses the response bar's own heading when
 * `card.prompt === question`, comparing the two STRINGS. So the builder and the
 * call site that constructs the `VerdictBar` have to produce a byte-identical
 * sentence, and the only way to guarantee that is for both to call the same
 * function. Two copies of the same wording is how a 390px card ends up asking
 * the same question twice in two type styles.
 *
 * ── Why the wording follows maturity ──────────────────────────────────────
 *
 * "Would you put this on?" is the right question for an idea that is finished
 * and waiting on the desk. It is the wrong question for one somebody started
 * yesterday — asking a colleague to commit to unfinished work invites either a
 * false yes or a shrug, and neither is a useful record. Early-stage ideas are
 * asked whether the work is pointing the right way, which is the thing a
 * reader can actually answer.
 */
export function ideaPromptFor(input: {
  type?: string | null
  stage?: string | null
  pairSides?: string | null
  symbol?: string | null
}): string | null {
  /**
   * A pair is asked about the RELATIONSHIP.
   *
   * "Would you buy LLY?" is the wrong question for an object whose claim is
   * that one side beats the other — answering it says nothing about the trade
   * being proposed. The sides are deliberately NOT appended: the card renders
   * them as structure directly above, and repeating them here would put the
   * same fact on screen twice and wrap the question onto three lines.
   */
  if (input.type === 'pair_trade' || input.pairSides) {
    return maturityOf(input.stage).awaitingDesk
      ? 'Would you put this pair on?'
      : 'Is this relative view pointing the right way?'
  }
  if (input.type !== 'trade_idea') return null
  if (!input.symbol) return null
  return maturityOf(input.stage).awaitingDesk
    ? 'Would you put this on?'
    : `Is this pointing the right way on ${input.symbol}?`
}

/**
 * The one number the decision turns on — or none, which is common and fine.
 *
 * ── Why this is the target and not the upside ─────────────────────────────
 *
 * "+34% to target" is the more decision-shaped number and it cannot be stated
 * honestly here. Computing it needs a current price, and the only price
 * available at build time is `assets.current_price`, which carries NO
 * timestamp anywhere in the schema. `price-snapshot` is explicit that the
 * defect it exists to prevent is a number whose vintage is hidden by its
 * label — a card reading "+34%" off an undated mark is exactly that, and the
 * eyebrow would have to invent an `asOf` to render at all.
 *
 * So the metric is the figure the AUTHOR stated, as of the day they stated it.
 * That is fully provable from the row. The gap against the tape lives in
 * `IdeaTargetBar`, which fetches the dated close series itself and can say
 * which day it is comparing against — and which degrades to "target, no gap"
 * when nothing is cached rather than reaching for the undated mark.
 *
 * A pleasant side effect: the metric and the pane now say different things
 * instead of the same thing twice, which is the rule `SignalCard.headline`
 * already states for the headline and the metric.
 *
 * ── Why this can still return null ────────────────────────────────────────
 *
 * `metric: null` used to be unconditional, with a comment saying a post has no
 * number. True of a thought, false of a trade idea carrying a target the feed
 * simply never selected. An idea with no target genuinely has no number, and
 * inventing one — an urgency score, a conviction rendered 1-5 — would put a
 * figure in the loudest slot that nobody asked for and nothing acts on. That
 * original reasoning still governs the empty case.
 */
function ideaMetric(i: IdeaInput): CardMetric | null {
  const target = i.targetPrice
  if (target == null || !Number.isFinite(target) || target <= 0) return null

  return {
    value: target >= 1000 ? `$${target.toFixed(0)}` : `$${target.toFixed(2)}`,
    label: HORIZON_METRIC_LABEL[String(i.timeHorizon ?? '')] ?? 'Target price',
    // Neither good nor bad. A target is an intention, and colouring it would
    // imply the card has an opinion about somebody else's number.
    direction: 'neutral',
    // Stated by a person, on the day they stated it. Not a market number.
    source: 'stated',
    asOf: i.createdAt,
  }
}

export function buildIdeaCard(i: IdeaInput, can: IdeaCapabilities = {}): CardResult {
  const type = ideaCardType(i.type)
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

    /**
     * Stance, maturity and family, resolved once and read three times.
     *
     * The shape is a property of the row, so it is computed here rather than in
     * the call site — a card and the pane beside it disagreeing about which
     * family they are is exactly the class of drift the contract exists to
     * prevent.
     */
    const shape = ideaShapeFor({
      action: i.action,
      stage: i.stage,
      createdAt: i.createdAt,
      targetPrice: i.targetPrice,
      ladderCaseCount: i.ladderCaseCount,
      hasPriceHistory: i.hasPriceHistory,
    })

    const metric = i.type === 'trade_idea' ? ideaMetric(i) : null
    const prompt = ideaPromptFor({
      type: i.type,
      stage: i.stage,
      symbol: i.asset?.symbol ?? null,
    })

    return emit({
      id: ideaCardId(i.type, i.id),
      type,
      surface: 'desk',
      // A colleague asking for something outranks a colleague noting
      // something. Nothing here is `critical`: a post is a person's view, and
      // a red rule on somebody's thought would devalue the mark everywhere it
      // means a real problem.
      severity: isTrade ? 'attention' : 'informational',
      headline,
      // A trade idea's number, where it has one — see `ideaMetric`. Still null
      // for a thought, a note or an idea carrying neither a target nor an
      // anchored path, which is the case the original rule was written for.
      metric,
      ...(prompt ? { prompt } : {}),
      body: body || i.title || '',
      entity: i.asset
        ? { kind: 'asset', id: i.asset.id, name: i.asset.companyName || i.asset.symbol, ticker: i.asset.symbol }
        : { kind: 'project', id: i.id, name: headline.slice(0, 40) },
      /**
       * Maturity and conviction lead on a trade idea; the author and the book
       * are already in the headline.
       *
       * The row is capped at three and was spending all three on facts the
       * sentence above it had just stated — the author's name, the portfolio —
       * so the two things it could ONLY say here, how worked-through the idea
       * is and how strongly its author holds it, never appeared.
       *
       * The stance is not a chip. It is the verb of the headline, and putting
       * BUY in a chip beside a sentence that already says "wants to buy" is the
       * same duplication in the other direction.
       */
      context: (isTrade
        ? [
            /**
             * Maturity appears exactly ONCE per card, and which row owns it
             * depends on whether the card has a pane to put pills in.
             *
             * Reported from the phone: DECIDING in the metadata row AND in the
             * pill, THESIS FORMING twice, DECISION READY twice. The pills are
             * the right home — they pair the maturity with the stance, which is
             * the comparison a reader is making — so the chip yields to them.
             *
             * A `narrative` idea has no visual pane at all (see the feed's idea
             * branch), so there are no pills on it and the chip is the only
             * home left. That is not the duplication returning: it is the same
             * fact, still stated once, on a card shaped differently.
             */
            ...(shape.family === 'narrative' && shape.maturity.label
              ? [{ label: shape.maturity.label }]
              : []),
            /**
             * Conviction OR urgency, never both, and no portfolio.
             *
             * The row was carrying conviction, urgency and the book on top of a
             * headline that already names the book — "wants to buy COIN in Core
             * Equity" — so the same fact appeared twice and the row had no
             * room left to breathe. A card is for scanning; the full set lives
             * in the detail.
             *
             * Conviction wins where both exist: how strongly the author holds
             * the view is a claim about the investment, and urgency is a claim
             * about the calendar. `low` urgency stays suppressed as before —
             * it is the default and says nothing.
             */
            ...(i.conviction
              ? [{ label: `${i.conviction} conviction` }]
              : i.urgency && i.urgency !== 'low'
                ? [{ label: `${i.urgency} urgency` }]
                : []),
          ]
        : [
            ...(i.authorName ? [{ label: i.authorName }] : []),
            ...(i.portfolioName ? [{ label: i.portfolioName }] : []),
            ...(i.urgency && i.urgency !== 'low' ? [{ label: `${i.urgency} urgency` }] : []),
            ...(i.sentiment ? [{ label: i.sentiment }] : []),
          ]
      ).slice(0, 3),
      // A trade idea argues about a price, so the tape is evidence for it. A
      // thought does not, and a sparkline under someone's musing would be
      // decoration — the rule the contract has held since the first builder.
      ...(isTrade && i.asset ? { evidence: { kind: 'sparkline' as const, data: { symbol: i.asset.symbol } } } : {}),
      actions: actions(
        // React, not "resolve". These are posts; the reader is an audience,
        // not an approver, and offering "Resolve" on a colleague's thought
        // would be a category error.
        //
        // ── Why a trade idea no longer gets its own primary ────────────────
        //
        // It had one — `{ id: 'primary', label: 'Open idea' }` — and it was a
        // dead button. `primary` is not a `FeedActionKey`, so
        // `resolveFeedAction` returned null, `SignalCardSection` fell through
        // to `onPrimary`, and the feed's post branch matches `share`, `ask`,
        // `promote` and `readthrough` before defaulting to a telemetry write.
        // So the loudest control on the desk's actual proposals recorded that
        // it had been pressed and did nothing else.
        //
        // Every other builder passes its primary through `contextualActions`,
        // which checks `feedActionIsRoutable` and falls back rather than
        // declare a destination it cannot reach. This one does not, which is
        // exactly how the declaration went unchecked —
        // `feedActionIsRoutable('primary', …)` is false.
        //
        // A post's honest primary is the one every other post already has:
        // the actions sheet, whose first entry is `Open <SYMBOL>` and which
        // also carries share, ask, promote and readthrough. Where the reader
        // wants to answer rather than route, the verdict pane is the control,
        // and it is reached from the card's own "Your view" affordance.
        { id: 'capture', label: 'Capture', inline: true },
        i.asset
          ? { label: `Open ${i.asset.symbol}`, href: assetHref(i.asset.id) }
          : { label: 'Open post', href: `/feed/${i.id}` },
        // No quick action. `capture` is the primary now, and listing it twice
        // would put the same sheet behind both buttons in the bar.
        [],
        // Everything the old action rail carried, minus what has become a
        // primary. Order is by how often it is reached for, not by how easy it
        // was to implement.
        [
          ...(can.ask ? [{ id: 'ask', label: 'Ask about this', inline: false }] : []),
          ...(can.share ? [{ id: 'share', label: 'Share with someone', inline: false }] : []),
          ...(can.promote ? [{ id: 'promote', label: 'Promote to trade idea', inline: false }] : []),
          ...(can.readthrough ? [{ id: 'readthrough', label: 'See what this refers to', inline: false }] : []),
          // First in the list on a trade idea: it is the entry a reader
          // actually wants, and it names what they will find rather than the
          // generic "open" the other kinds get through `actions.open`.
          ...(can.openDetail && isTrade
            ? [{ id: 'open_idea', label: DETAIL_LABEL[shape.family] ?? 'Open the full idea', inline: false }]
            : []),
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
