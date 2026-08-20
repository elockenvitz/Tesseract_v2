import {
  emit,
  suppress,
  type CardResult,
  type Severity,
  type SignalCard,
  type SignalType,
  type Surface,
} from '../contract'
import { gate, isDisplayableNumber, isQualityContent } from '../suppression'
import { actions, assetHref, bookAgeChip, dayKey, portfolioHref } from './shared'
import { feedActionIsRoutable } from '../feed-actions'
import type { TemplateCard } from '../../mobile/feed-templates'
import type { DerivedInsight } from '../../../hooks/mobile/useDerivedInsights'
import type {
  ConvictionGap,
  CrowdedName,
  StaleTarget,
  TargetBreach,
  UntargetedPosition,
} from '../../../hooks/mobile/usePortfolioLenses'

/**
 * The four remaining feed kinds, mapped onto the card contract.
 *
 * ── Why mapping rather than restyling ─────────────────────────────────────
 *
 * The feed rendered seven kinds through five different components, each with
 * its own header, its own chip row and its own action bar. Three had been moved
 * onto `SignalCardView`; the other four had not, so the surface read as two
 * products stitched together — which is what a reader notices first and what no
 * amount of matching colours would fix.
 *
 * The direction of convergence was decided deliberately: the legacy tiles move
 * to the scenario card, not the reverse. So these are builders, not styles.
 * Once a kind returns a `SignalCard`, it inherits the eyebrow, the severity
 * dot, the claim/metric split, the overflow menu, the show-more control, the
 * one-screen constraint and the action grammar — and every future fix to any of
 * those lands on all seven kinds at once instead of one.
 *
 * ── What is deliberately NOT forced ───────────────────────────────────────
 *
 * Uniform shell, kind-specific body. None of these gets a carousel, a ladder or
 * a chart, because none of their claims needs one. A news card with a
 * decorative chart is worse than a news card; the same is true of an economic
 * release with a sparkline. Evidence stays absent unless a card argues for it.
 */

/**
 * The portfolios a name sits in, said in a way that survives being read.
 *
 * Two rounds of this. "Held · 1" told the reader the one thing they already
 * knew — the position exists — and withheld the only part they wanted. Naming
 * every portfolio fixed that and introduced a worse problem: "Core Equity,
 * Large Cap Growth +2" is three names and an arithmetic expression fighting for
 * a 390px row, and readers still had to ask what the count counted.
 *
 * So: one portfolio gets its name, because that is short and it is the answer.
 * More than one gets "In N portfolios", which states what the number counts
 * without pretending a row this size can list them. The names remain one tap
 * away on the asset.
 *
 * A single-portfolio chip carries an href so the card can route a tap straight
 * to the positioning. Ids are optional because two of the three call sites
 * predate them; a chip without one is still a better label than a number.
 */
function heldInChips(names: string[], ids?: string[]): { label: string; href?: string }[] {
  if (!names.length) return [{ label: 'Not held' }]
  // One chip when there is one portfolio, so the tap target is the portfolio
  // itself and the reader gets the name rather than a count of one.
  if (names.length === 1) {
    return [{ label: names[0], ...(ids?.[0] ? { href: portfolioHref(ids[0]) } : {}) }]
  }
  // Beyond that, say what the number COUNTS. `heldInLabel` produces
  // "Core Equity, Large Cap Growth +2", which is three portfolio names and an
  // arithmetic expression competing for a 390px row; "In 4 portfolios" is the
  // fact the reader was trying to extract from it, and the individual names are
  // one tap away on the asset.
  return [{ label: `In ${names.length} portfolios` }]
}

/**
 * A chip is a label, not a sentence.
 *
 * Strips trailing sentence punctuation and capitalises the first letter, so
 * stored prose ("make a decision.", "review.") reads as a chip rather than as a
 * clause that has lost its sentence.
 */
function chipCase(s: string): string {
  const t = s.trim().replace(/[.!;:,]+$/, '').trim()
  return t ? t[0].toUpperCase() + t.slice(1) : t
}

/** Every one of these ends up on the asset, so the action grammar is shared. */
function assetActions(symbol: string, assetId: string | undefined) {
  return actions(
    { id: 'capture', label: 'Capture', inline: true },
    assetId
      ? { label: `Open ${symbol}`, href: assetHref(assetId) }
      : { label: 'Open feed', href: '/' },
  )
}

/**
 * A contextual primary, with Capture kept as a quick action.
 *
 * ── Why Capture is demoted rather than removed ────────────────────────────
 *
 * Capture is the only way to write a free-form thought against a name from the
 * feed, and several kinds still have no better destination. Replacing it with a
 * contextual button on the cards that DO have one, while keeping it one tap
 * away on the same row, is the whole change: the primary now describes the next
 * step, and nothing has been taken away.
 *
 * ── The truthfulness guard ────────────────────────────────────────────────
 *
 * `feedActionIsRoutable` is checked here, not assumed. A contextual key with no
 * asset id resolves to no destination, and this falls back to `assetActions`
 * rather than rendering a button that promises a surface it cannot reach. That
 * fallback is the reason a label can be trusted: it is impossible to declare
 * one without a destination behind it.
 */
function contextualActions(
  actionId: string,
  actionLabel: string,
  symbol: string,
  assetId: string | undefined,
) {
  if (!feedActionIsRoutable(actionId, { assetId, symbol })) {
    return assetActions(symbol, assetId)
  }
  return actions(
    { id: actionId, label: actionLabel, inline: false },
    assetId
      ? { label: `Open ${symbol}`, href: assetHref(assetId) }
      : { label: 'Open feed', href: '/' },
    [{ id: 'capture', label: 'Capture', inline: true }],
  )
}

// ── Template cards: unusual move, earnings, corporate action, economic ─────

/**
 * Exported because the feed's ranking adapter needs the same mapping.
 *
 * It was briefly duplicated there instead, and the copy was wrong within
 * minutes: it spelled the economic-release key `economic_release` rather than
 * `economic`, so every economic card would have ranked as generic news. One map.
 */
export const TEMPLATE_TYPE: Record<string, SignalType> = {
  unusual_move: 'unusual_move',
  earnings_ahead: 'earnings_ahead',
  earnings_result: 'earnings_result',
  corporate_action: 'corporate_action',
  economic: 'economic_release',
}

/**
 * `active_risk` is absent from that map on purpose — it has its own builder,
 * with benchmark provenance and a peer pane the template shape cannot carry.
 */
export function buildTemplateCard(card: TemplateCard): CardResult {
  return gate(TEMPLATE_TYPE[card.kind] ?? 'unusual_move', () => {
    const entity = card.symbol || card.id
    const type = TEMPLATE_TYPE[card.kind]
    if (!type) {
      return suppress('resolved', entity, `no contract type for template kind ${card.kind}`)
    }
    if (!isQualityContent(card.headline)) {
      return suppress('content_quality', entity, `headline: ${JSON.stringify(card.headline)}`)
    }
    if (!isQualityContent(card.body)) {
      return suppress('content_quality', entity, `body: ${JSON.stringify(card.body)}`)
    }

    // An economic release is about no object the product owns — a CPI print,
    // an index level — which is exactly what EntityKind 'market' is for.
    const isMarket = card.kind === 'economic' || !card.symbol
    const occurredAt = card.eventDate || new Date().toISOString()

    return emit({
      id: `template:${card.id}`,
      type,
      surface: 'market',
      // Never critical. Something the market already knows is not an emergency
      // in the book, and a red dot on every earnings date would devalue it
      // everywhere else.
      severity: card.tone === 'negative' ? 'attention' : 'informational',
      headline: card.headline,
      metric: card.metric && isQualityContent(card.metricLabel ?? '')
        ? {
            value: card.metric,
            label: card.metricLabel!,
            direction: card.tone === 'positive' ? 'good' : card.tone === 'negative' ? 'bad' : 'neutral',
            // Template metrics are computed from a live quote at build time;
            // the template shape carries no timestamp of its own, so the event
            // date is the most honest thing available.
            source: 'computed',
            asOf: occurredAt,
          }
        : null,
      body: card.body,
      entity: isMarket
        ? { kind: 'market', id: card.symbol || 'market', name: card.symbol || 'Market' }
        : { kind: 'asset', id: card.assetId ?? card.symbol!, name: card.symbol!, ticker: card.symbol },
      context: [
        ...(card.symbol ? [{ label: card.symbol }] : []),
        ...(card.eventDate ? [{ label: dayKey(card.eventDate) }] : []),
      ],
      actions: assetActions(card.symbol ?? 'feed', card.assetId),
      provenance: {
        occurredAt,
        reason: `Derived from market data on ${card.symbol ?? 'the tape'} without anyone asking for it.`,
      },
      expiry: { staleAfterDays: 3 },
      dedupeKey: `${type}:${card.symbol ?? card.id}:${dayKey(occurredAt)}`,
    })
  })
}

// ── Derived insights: stale research, large unreviewed, no thesis ──────────

const INSIGHT_TYPE: Record<string, SignalType> = {
  stale_research: 'research_stale',
  large_unreviewed: 'research_stale',
  no_thesis: 'no_research',
  concentration: 'crowding',
}

export function buildInsightCard(insight: DerivedInsight): CardResult {
  const type = INSIGHT_TYPE[insight.kind] ?? 'research_stale'
  return gate(type, () => {
    const entity = insight.symbol || insight.assetId
    if (!isQualityContent(insight.headline)) {
      return suppress('content_quality', entity, `headline: ${JSON.stringify(insight.headline)}`)
    }

    const days = insight.daysSinceActivity
    const weight = insight.weightPct

    return emit({
      id: `insight:${insight.id}`,
      type,
      surface: type === 'crowding' ? 'risk' : 'research',
      // A large position nobody has written about for a long time is the case
      // worth escalating; a small one is a note.
      severity: isDisplayableNumber(weight) && weight! >= 3 && (days ?? 0) >= 90
        ? 'critical'
        : 'attention',
      headline: insight.headline,
      metric: isDisplayableNumber(days)
        ? {
            /**
             * The unit lives in the value, and the label is three words.
             *
             * It was a bare "179" over "Days since anyone wrote on it", which
             * put a raw integer at the loudest size on the card and then spent
             * a full line explaining what it counted. A number that needs a
             * sentence to be legible is not the number the card should be
             * leading with at that weight.
             */
            value: days! >= 365 ? `${(days! / 365).toFixed(1)}y` : `${days}d`,
            label: 'Since last written on',
            direction: 'neutral',
            // Derived from written record, not a market feed.
            source: 'computed',
            asOf: new Date(Date.now() - days! * 86_400_000).toISOString(),
          }
        : isDisplayableNumber(weight)
          ? {
              value: `${weight!.toFixed(1)}%`,
              label: 'Position size',
              direction: 'neutral',
              // 'computed', not 'holdings'. The insight hook does not carry the
              // snapshot date, and claiming `holdings` without one made the
              // eyebrow print "book <today>" over a weight from an April
              // upload. Better to say less than to date it wrongly.
              source: 'computed',
              asOf: new Date().toISOString(),
            }
          : null,
      body: insight.body,
      prompt: type === 'no_research'
        ? 'What best describes this position?'
        // The card no longer says "this went quiet"; it says something moved
        // and the view did not follow. The question asks about that.
        : 'Does this change need a look?',
      entity: {
        kind: 'asset',
        id: insight.assetId,
        name: insight.companyName || insight.symbol,
        ticker: insight.symbol,
      },
      context: [
        ...(insight.portfolioName ? [{ label: insight.portfolioName }] : []),
        ...(isDisplayableNumber(weight) ? [{ label: `${weight!.toFixed(1)}% of portfolio` }] : []),
      ],
      /**
       * `no_research` gets "Add rationale"; `research_stale` gets "Update
       * thesis". Both land on the same rich-text field editor, and the labels
       * differ because the reader's task does: one is starting a case, the
       * other is revising one. The deep link also switches the case view out of
       * its aggregated default, or the reader would arrive somewhere they
       * cannot type.
       */
      actions: contextualActions(
        type === 'no_research' ? 'add_rationale' : 'update_thesis',
        type === 'no_research' ? 'Add rationale' : 'Update thesis',
        insight.symbol,
        insight.assetId,
      ),
      provenance: {
        occurredAt: new Date(Date.now() - (days ?? 0) * 86_400_000).toISOString(),
        /**
         * The facts, not a characterisation.
         *
         * This card is composite now — silence plus a reason — so "the written
         * record has not kept up" no longer says why it fired. A reader looking
         * at "why this surfaced" on a card they did not expect needs the
         * ingredients, in the order they were evaluated.
         */
        reason: insight.context
          ? [
              insight.context.kind === 'price_move'
                ? `${Math.abs(insight.context.movePct!).toFixed(0)}% price move since the last recorded view`
                : `${insight.context.weightPct!.toFixed(1)}% position`,
              `${insight.context.days} days with no thesis, judgment or decision recorded`,
              ...(insight.context.kind === 'price_move' && insight.context.weightPct != null
                ? [`${insight.context.weightPct.toFixed(1)}% of the portfolio`]
                : []),
            ].join(' · ')
          : `${insight.symbol} is in the book and the written record has not kept up with it.`,
      },
      expiry: { staleAfterDays: 14 },
      dedupeKey: `${type}:${insight.assetId}:${dayKey(new Date().toISOString())}`,
    })
  })
}

// ── Portfolio lens: conviction, crowding, target hit, target expired ───────

function lensCard(
  type: SignalType,
  surface: Surface,
  severity: Severity,
  opts: {
    id: string
    assetId: string
    symbol: string
    companyName?: string | null
    headline: string
    body: string
    metric: SignalCard['metric']
    context: { label: string }[]
    reason: string
    /** The question the card is asking. See SignalCard.prompt. */
    prompt?: string
    /**
     * A contextual primary, when this kind has an honest destination.
     *
     * Falls back to the generic Capture grammar when the action does not
     * resolve — see `contextualActions`.
     */
    primaryAction?: { id: string; label: string }
    staleAfterDays: number
    /**
     * When the CONDITION became true — never when this ran.
     *
     * These cards are derived in the browser, so `new Date()` made every one
     * read "1 minute ago" on every login. That is false and it is also the
     * wrong story: it says the feed is generated for the reader rather than
     * waiting for them, and it hides the age of the finding. A target that
     * expired in March is not news from a minute ago.
     */
    occurredAt: string
    /**
     * Declares that a chart is WARRANTED on this card — not that one exists.
     *
     * The contract splits the decision in two on purpose. The builder knows
     * whether the claim deserves a picture; only the feed knows whether the
     * data to draw it was actually fetched. `SignalCardView` renders the band
     * when both agree, so a card that argues for a chart and has no series
     * collapses cleanly instead of leaving a labelled hole.
     */
    evidence?: SignalCard['evidence']
  },
): CardResult {
  return gate(type, () => {
    if (!isQualityContent(opts.symbol)) {
      return suppress('content_quality', opts.symbol || opts.assetId, 'symbol')
    }
    return emit({
      id: opts.id,
      type,
      surface,
      severity,
      headline: opts.headline,
      metric: opts.metric,
      body: opts.body,
      ...(opts.prompt ? { prompt: opts.prompt } : {}),
      entity: {
        kind: 'asset',
        id: opts.assetId,
        name: opts.companyName || opts.symbol,
        ticker: opts.symbol,
      },
      context: opts.context,
      ...(opts.evidence ? { evidence: opts.evidence } : {}),
      actions: opts.primaryAction
        ? contextualActions(opts.primaryAction.id, opts.primaryAction.label, opts.symbol, opts.assetId)
        : assetActions(opts.symbol, opts.assetId),
      provenance: { occurredAt: opts.occurredAt, reason: opts.reason },
      expiry: { staleAfterDays: opts.staleAfterDays },
      dedupeKey: `${type}:${opts.assetId}:${dayKey(opts.occurredAt)}`,
    })
  })
}

export function buildConvictionCard(g: ConvictionGap): CardResult {
  const under = g.direction === 'underweight'
  return lensCard(
    under ? 'conviction_undersized' : 'conviction_oversized',
    'risk',
    Math.abs(g.upsidePct) >= 0.3 ? 'critical' : 'attention',
    {
      id: `conviction:${g.portfolioId}:${g.assetId}`,
      assetId: g.assetId,
      symbol: g.symbol,
      companyName: g.companyName,
      // The claim, not the number — the metric block carries that.
      headline: under
        ? `${g.symbol} is sized smaller than your view of it`
        : `${g.symbol} is sized larger than your view supports`,
      body: under
        ? `The position is ${g.weightPct.toFixed(1)}% of ${g.portfolioName} while the target implies ${(g.upsidePct * 100).toFixed(0)}% upside${g.conviction ? `, and the stated conviction is ${g.conviction}` : ''}. Either the size is wrong or the target is stale, and both are decisions.`
        : `The position is ${g.weightPct.toFixed(1)}% of ${g.portfolioName} with only ${(g.upsidePct * 100).toFixed(0)}% left to the target${g.conviction ? ` and conviction of ${g.conviction}` : ''}. Holding it at this size is a fresh decision, not a continuing one.`,
      metric: {
        value: `${g.weightPct.toFixed(1)}%`,
        label: under ? 'Size, against a strong view' : 'Size, against a spent view',
        direction: 'neutral',
        source: 'holdings',
        // The snapshot the weight came from, never now. Stamping a book number
        // with the current time is the fabricated-freshness defect.
        asOf: g.asOf,
      },
      context: [
        { label: g.portfolioName },
        { label: `${(g.upsidePct * 100).toFixed(0)}% to target` },
        ...(g.conviction ? [{ label: `Conviction ${g.conviction}` }] : []),
        // Silent when the book is current, which is the normal case. The age of
        // the snapshot only becomes part of the finding once it stops being
        // able to speak for today.
        ...bookAgeChip(g.asOf),
      ],
      prompt: under
        ? 'Should the position be bigger, or the target lower?'
        : 'Is this still worth the size it takes?',
      reason: `Stated conviction and position size disagree on ${g.symbol}, and nothing in the product reconciles them.`,
      staleAfterDays: 14,
    // The weight is what makes this true, so the snapshot it came from is
    // when it became true.
      occurredAt: g.asOf,
    },
  )
}

export function buildCrowdingCard(c: CrowdedName): CardResult {
  return lensCard('crowding', 'risk', c.portfolioCount >= 4 ? 'critical' : 'attention', {
    id: `crowding:${c.assetId}`,
    assetId: c.assetId,
    symbol: c.symbol,
    companyName: c.companyName,
    headline: `${c.symbol} is held across more of the book than any one portfolio shows`,
    // The spread across books IS the claim; the maximum is one point on it.
    evidence: { kind: 'peer_bar', data: { books: c.portfolioCount } },
    body: `It is held in ${c.portfolioCount} portfolios (${c.portfolioNames.slice(0, 3).join(', ')}${c.portfolioNames.length > 3 ? ' and others' : ''}), reaching ${c.maxWeightPct.toFixed(1)}% in the heaviest. A single-portfolio view understates the firm's exposure to one thesis.`,
    metric: {
      value: `${c.portfolioCount}`,
      label: 'Portfolios holding it',
      direction: 'neutral',
      source: 'holdings',
      asOf: c.asOf,
    },
    context: [
      { label: `Max ${c.maxWeightPct.toFixed(1)}%` },
      ...c.portfolioNames.slice(0, 2).map(n => ({ label: n })),
      ...bookAgeChip(c.asOf),
    ],
    prompt: 'Is this one view, or several that happen to agree?',
    reason: `${c.symbol} appears in ${c.portfolioCount} portfolios, so its risk is a firm-level position rather than a portfolio-level one.`,
    staleAfterDays: 14,
    // Crowding is a fact about the books as they stood on that snapshot.
    occurredAt: c.asOf,
  })
}

export function buildTargetHitCard(b: TargetBreach): CardResult {
  return lensCard('target_hit', 'research', b.overshootPct >= 0.1 ? 'critical' : 'attention', {
    id: `target_hit:${b.assetId}`,
    assetId: b.assetId,
    symbol: b.symbol,
    companyName: b.companyName,
    // The tape against the target it crossed. This is the one lens claim that
    // is entirely about a price path, and it had no picture of one.
    evidence: { kind: 'sparkline', data: { target: b.target } },
    headline: `${b.symbol} has reached the target you set for it`,
    /**
     * "The book marks it at", not "the price is at".
     *
     * ── A real inconsistency, fixed in the wording rather than the maths ────
     *
     * `b.price` is the holdings mark from `portfolio_holdings`. The chart on
     * this same card draws `price_history_cache` and prints its own last close
     * in the header. Those are two different numbers from two different
     * sources, and the body was calling one of them "the price" — so the card
     * showed, say, $232.99 in the prose and $270.23 above the chart with
     * nothing to tell a reader which was which, or that they were measuring
     * different things.
     *
     * Naming the source costs three words and makes the two numbers
     * distinguishable rather than contradictory. The metric above is computed
     * from the same mark, so the card is now internally consistent about what
     * it is comparing.
     *
     * NOT fixed here, and deliberately: which price SHOULD drive
     * `overshootPct` is a calculation decision, not a rendering one. A mark
     * carried forward from an upload can sit well away from the last traded
     * close, and "has this target been reached" arguably deserves the closer of
     * the two. Changing it would move every target_hit card in and out of
     * existence, which is beyond a phase about response controls.
     */
    body: `The book marks it at $${b.price.toFixed(2)} against a target of $${b.target.toFixed(2)}${b.heldIn.length ? `, held in ${b.heldIn.join(', ')}` : ''}. The thesis played out and nothing in the product says so. Either the target rises or the position is a hold with no stated upside, and both are decisions somebody has to make.`,
    metric: {
      value: `+${(b.overshootPct * 100).toFixed(0)}%`,
      label: `Past a $${b.target.toFixed(0)} target`,
      direction: 'good',
      source: 'holdings',
      asOf: b.asOf,
    },
    context: [
      ...heldInChips(b.heldIn, b.heldInIds),
      ...(b.conviction ? [{ label: `Conviction ${b.conviction}` }] : []),
      ...bookAgeChip(b.asOf),
    ],
    prompt: 'What should happen next?',
    // `MobileCaseTargets`: Bull / Base / Bear, each with a price and a horizon,
    // the reader's own row editable. Deliberately NOT a trade or sell flow —
    // this card prompts a review, and the button says review.
    primaryAction: { id: 'review_target', label: 'Review target' },
    reason: `${b.symbol} passed its price target and no one has revised the view or the position.`,
    staleAfterDays: 7,
    // The crossing happened between snapshots; the snapshot is the most
    // precise thing that is true rather than inferred.
    occurredAt: b.asOf,
  })
}

export function buildStaleTargetCard(s: StaleTarget): CardResult {
  return lensCard('target_expired', 'research', s.overdueMonths >= 6 ? 'critical' : 'attention', {
    id: `target_expired:${s.assetId}`,
    assetId: s.assetId,
    symbol: s.symbol,
    companyName: s.companyName,
    // A horizon that ran out is a statement about elapsed time and where the
    // price went during it. Both belong on an axis.
    evidence: { kind: 'sparkline', data: { target: s.target } },
    headline: `Your view on ${s.symbol} has outlived its own horizon`,
    // Same source-naming as target_hit: this is the holdings mark, and the
    // chart beside it draws cached closes.
    body: `The target of $${s.target.toFixed(2)} was set on a ${s.timeframe ?? 'stated'} horizon and is ${s.overdueMonths} months past it. The book marks it at $${s.price.toFixed(2)}. A target nobody has revisited is not a view; it is a number the screen keeps repeating.`,
    metric: {
      value: `${s.overdueMonths}mo`,
      label: 'Past its horizon',
      direction: 'bad',
      source: 'stated',
      /**
       * Now, because "months past the horizon" is computed from today.
       *
       * This was `Date.now() - ageMonths × 30.44 days`, an attempt to date the
       * metric with the moment the target was written. It was wrong twice
       * over: the value being dated is an elapsed-time count that grows every
       * day, not the target price, and the timestamp itself was synthetic,
       * reconstructed from a rounded month count rather than read from the
       * row. It surfaced in the eyebrow as a bare "Jun 18" that matched no
       * date anybody had entered. The real stated date is now carried as
       * `statedAt` and drawn on the horizon timeline, where it has a label.
       */
      asOf: new Date().toISOString(),
    },
    context: [
      ...heldInChips(s.heldIn, s.heldInIds),
      ...(s.timeframe ? [{ label: `${s.timeframe} horizon` }] : []),
      { label: `Set ${new Date(s.statedAt).toLocaleDateString(undefined, { month: 'short', year: 'numeric', timeZone: 'UTC' })}` },
    ],
    /**
     * A horizon question, not a thesis question.
     *
     * This card fires on `ageMonths - timeframeMonths >= 2` and nothing else.
     * Asking whether the investment VIEW changed imports a premise the signal
     * never established: a twelve-month target reaching thirteen months old is
     * evidence about a clock, not about a thesis. The honest question is
     * whether the number still stands.
     */
    prompt: 'Is this target still your view?',
    /**
     * The target editor, NOT the case editor.
     *
     * This card fires on `ageMonths - timeframeMonths >= 2` and nothing else:
     * it is a horizon elapsing, not the market moving outside a modelled range.
     * It has shared card plumbing with case-vs-price since both were built, and
     * this is the first place the two are told apart in behaviour rather than
     * only in prose.
     */
    primaryAction: { id: 'review_target', label: 'Review target' },
    reason: `${s.symbol}'s target passed its own ${s.timeframe ?? 'stated'} horizon ${s.overdueMonths} months ago.`,
    staleAfterDays: 30,
    // The moment the horizon ran out, from the target's own stated date and
    // timeframe — so this reads "5 months ago", not "now".
    occurredAt: s.expiredAt,
  })
}

/**
 * A position of real size with no price target behind it.
 *
 * ── Why the metric is the WEIGHT and not the absence ──────────────────────
 *
 * The obvious metric here is "0 targets", which is a number standing in for
 * nothing and exactly what `isDisplayableNumber` exists to keep off the
 * surface. What makes this card worth a screen is how much money is riding on
 * the gap, so the weight is the number and the absence is the claim.
 *
 * ── Why this is not suppressed for missing data ───────────────────────────
 *
 * Every other suppression in this file fires because the card would state
 * something it cannot support. This card's subject IS the missing thing, and it
 * states nothing about a target beyond the fact that there isn't one. The
 * holdings mark is carried for the tuner to start from and is never compared to
 * anything, which is what keeps it clear of `snapshot_vs_live`.
 */
export function buildNoTargetCard(u: UntargetedPosition): CardResult {
  return lensCard(
    'no_target',
    'research',
    // A rated name with no number is a sharper contradiction than an unrated
    // one: somebody formed a view strong enough to record and still never
    // priced it.
    u.weightPct >= 5 || (u.conviction === 'high' && u.weightPct >= 3) ? 'critical' : 'attention',
    {
      id: `no_target:${u.assetId}`,
      assetId: u.assetId,
      symbol: u.symbol,
      companyName: u.companyName,
      /**
       * A chart is warranted here even though there is no line to draw against.
       *
       * The other target cards put the tape beside a number to compare it to.
       * This one has no number, and that is exactly why the tape earns its
       * place: somebody is about to price this name for the first time, and
       * where it has traded is the first thing they will want. An empty axis
       * would be decoration; a year of closes under "put a number on it" is the
       * input to the decision the card is asking for.
       */
      evidence: { kind: 'sparkline', data: { price: u.price } },
      headline: `${u.symbol} is a real position with no price on it`,
      body: `It is ${u.weightPct.toFixed(1)}% of ${u.portfolioName}${
        u.heldIn.length > 1 ? ` and sits in ${u.heldIn.length} books` : ''
      }, and no one has recorded a price target for it${
        u.conviction ? `, despite a stated conviction of ${u.conviction}` : ''
      }. A position with no number attached cannot be too expensive or too cheap, which means it can never be wrong and never be sized.`,
      metric: {
        value: `${u.weightPct.toFixed(1)}%`,
        label: 'Of the portfolio, unpriced',
        direction: 'bad',
        source: 'holdings',
        asOf: u.asOf,
      },
      // Two chips at most on a card that also carries a chart and a slider.
      //
      // It was four: the books, "Unrated", and the snapshot age. They ran past
      // the edge of a 390px row and the reader could not tell what any of them
      // were for. "Unrated" is the absence of a rating stated as though it were
      // a fact about the position, which is noise on a card whose entire
      // subject is a different absence. The snapshot age is real but belongs
      // where it changes a decision, not on the card that is about a missing
      // target.
      context: [
        ...heldInChips(u.heldIn, u.heldInIds),
        ...(u.conviction ? [{ label: `Conviction ${u.conviction}` }] : []),
      ],
      prompt: 'How is this position being valued?',
      /**
       * "Set a target", not "Set framework".
       *
       * The judgment set on this card deliberately allows `not_price_driven`,
       * so a CTA reading "Set framework" would be the right product intent —
       * and the destination cannot honour it. `MobileCaseTargets` sets a price
       * and a horizon per scenario; there is no surface for choosing a
       * non-price framework, and no way to record that a position is held on
       * one. Labelling the button for a chooser that does not exist would be
       * exactly the failure this phase is guarding against.
       *
       * So the narrower true label, and the gap is documented rather than
       * papered over. When a framework-selection surface exists this becomes
       * "Set framework" and the destination changes with it.
       */
      primaryAction: { id: 'set_target', label: 'Set a target' },
      reason: `${u.symbol} is one of the larger positions in ${u.portfolioName} and nothing in the product says what it is worth.`,
      staleAfterDays: 21,
      // The weight is what makes this true, so the snapshot it came from is
      // when it became true.
      occurredAt: u.asOf,
    },
  )
}

// ── Ideas-feed signals: team focus, stale coverage, conflict, catalyst ─────

/**
 * The shape `useIdeasFeed` produces. Declared here rather than imported so this
 * builder does not drag the whole feed hook into the signal library.
 */
export interface IdeasSignal {
  id: string
  signalType: 'attention_cluster' | 'stale_coverage' | 'conflict' | 'catalyst_proximity' | 'prompt'
  headline: string
  body: string
  relatedAssets?: Array<{ id: string; symbol: string }>
  metric?: string
  metricLabel?: string
  createdAt: string
  priority: number
}

const IDEAS_TYPE: Record<IdeasSignal['signalType'], SignalType> = {
  attention_cluster: 'team_focus',
  stale_coverage: 'research_stale',
  conflict: 'thesis_conflict',
  catalyst_proximity: 'catalyst_ahead',
  // A "prompt" is a canned question, not an observation. It has no contract
  // type because it should not be a card: the feed already tried filler and it
  // eroded trust in everything beside it.
  prompt: 'research_stale',
}

export function buildIdeasSignalCard(sig: IdeasSignal): CardResult {
  const type = IDEAS_TYPE[sig.signalType] ?? 'research_stale'
  return gate(type, () => {
    const asset = sig.relatedAssets?.[0]
    const entity = asset?.symbol || sig.id

    if (sig.signalType === 'prompt') {
      // Suppressed by design. An "AI insight" asking what your biggest risks
      // are is filler, and filler on this surface costs the cards next to it.
      return suppress('content_quality', entity, 'prompt signals are canned questions, not observations')
    }
    if (!isQualityContent(sig.headline)) {
      return suppress('content_quality', entity, `headline: ${JSON.stringify(sig.headline)}`)
    }
    if (!isQualityContent(sig.body)) {
      return suppress('content_quality', entity, `body: ${JSON.stringify(sig.body)}`)
    }

    return emit({
      id: `ideas:${sig.id}`,
      type,
      surface: type === 'thesis_conflict' ? 'risk' : 'research',
      // Conviction between colleagues pulling apart is worth more attention
      // than a coverage gap; neither is an emergency.
      severity: type === 'thesis_conflict' ? 'critical' : 'attention',
      headline: sig.headline,
      metric: sig.metric && isQualityContent(sig.metricLabel ?? '')
        ? {
            value: sig.metric,
            label: sig.metricLabel!,
            direction: 'neutral',
            source: 'computed',
            asOf: sig.createdAt,
          }
        : null,
      body: sig.body,
      entity: asset
        ? { kind: 'asset', id: asset.id, name: asset.symbol, ticker: asset.symbol }
        : { kind: 'market', id: sig.id, name: 'The desk' },
      context: (sig.relatedAssets ?? []).slice(0, 3).map(a => ({ label: a.symbol })),
      actions: assetActions(asset?.symbol ?? 'feed', asset?.id),
      provenance: {
        occurredAt: sig.createdAt,
        reason: 'Derived from what the team has been working on, not from anything you asked for.',
      },
      expiry: { staleAfterDays: 7 },
      dedupeKey: `${type}:${asset?.id ?? sig.id}:${dayKey(sig.createdAt)}`,
    })
  })
}

// ── Attention: decision needed, action needed, alignment ───────────────────

/**
 * The shape `useAttention` produces, narrowed to what a card needs. Declared
 * here rather than imported so the signal library does not depend on the whole
 * attention type surface.
 */
export interface AttentionLike {
  attention_id: string
  attention_type: 'informational' | 'action_required' | 'decision_required' | 'alignment'
  reason_text?: string | null
  title: string
  subtitle?: string | null
  preview?: string | null
  tags?: string[]
  severity?: string | null
  due_at?: string | null
  last_activity_at?: string | null
  created_at?: string | null
  next_action?: string | null
  context?: { asset_id?: string | null } | null
}

const ATTENTION_TYPE: Record<AttentionLike['attention_type'], SignalType> = {
  decision_required: 'awaiting_review',
  action_required: 'project_overdue',
  alignment: 'thesis_conflict',
  informational: 'team_focus',
}

/**
 * The last kind still rendering as a legacy tile.
 *
 * "Decision needed", "action needed" and "trade idea" all came through
 * AttentionFeedCard (deleted 2026-08-18), which is why they kept the old
 * styling after everything else converged — and why the feed looked like two
 * products for as long as it did.
 *
 * The primary action is deliberately NOT "Capture" here. Every other kind is an
 * observation the reader may or may not act on; an attention item is a request
 * addressed to them, and offering "Capture" as the main verb on somebody's
 * pending decision would be a way of not answering it.
 */
export function buildAttentionCard(
  a: AttentionLike,
  asset?: { id: string; symbol: string; companyName?: string | null } | null,
  /**
   * Which resolutions the SURFACE can actually perform.
   *
   * An attention item is a request addressed to the reader, and the honest
   * verbs differ by what it is: a decision can be approved or rejected, a task
   * can be marked done, everything else can only be acknowledged. The desktop
   * attention surface wires all of them; the mobile feed wires none, and gets
   * the generic "Resolve".
   *
   * Passing the capability in rather than assuming it is what stops the card
   * offering a button the caller cannot honour — the same rule that keeps
   * `CaseEditor` from showing an edit control for a row RLS will refuse.
   */
  can?: { approve?: boolean; reject?: boolean; markDone?: boolean; defer?: boolean },
): CardResult {
  const type = ATTENTION_TYPE[a.attention_type] ?? 'awaiting_review'
  return gate(type, () => {
    const entity = asset?.symbol || a.attention_id
    if (!isQualityContent(a.title)) {
      return suppress('content_quality', entity, `title: ${JSON.stringify(a.title)}`)
    }

    const occurredAt = a.last_activity_at || a.created_at || new Date().toISOString()
    const dueDays = a.due_at
      ? Math.round((new Date(a.due_at).getTime() - Date.now()) / 86_400_000)
      : null

    /**
     * The body composes what is there, rather than picking one field.
     *
     * It used to take the first of `reason_text | subtitle | preview` that
     * passed a quality check and drop the rest, so a card headed "BUY MSFT"
     * arrived under a single clause and looked like a notification with the
     * body missing. On an item that is a REQUEST addressed to the reader, "why
     * is this in front of me" and "what is it about" are different questions
     * and the card was answering only whichever happened to be populated.
     *
     * Ordered by what a reader needs first: why it was routed to them, then
     * what it concerns, then the opening of the thing itself. Deduplicated,
     * because these three columns frequently repeat each other verbatim and a
     * body that says the same sentence twice reads worse than one clause.
     */
    const parts: string[] = []
    for (const t of [a.reason_text, a.subtitle, a.preview]) {
      if (!isQualityContent(t)) continue
      const clean = t!.trim()
      // Substring rather than equality: `preview` is routinely `subtitle` plus
      // the next few words.
      if (parts.some(p => p.includes(clean) || clean.includes(p))) continue
      parts.push(clean)
    }
    // The due date belongs in the prose too. It is already the metric, but the
    // metric is a bare number and "overdue by four days" is the part that makes
    // an action-required item feel like one.
    if (dueDays != null && Number.isFinite(dueDays) && dueDays < 0) {
      parts.push(`It was due ${Math.abs(dueDays)} day${Math.abs(dueDays) === 1 ? '' : 's'} ago.`)
    }
    const body = parts.length
      ? parts.join(' ')
      : `${a.attention_type === 'decision_required' ? 'A decision' : 'An action'} is waiting on you and no further detail was recorded against it.`

    return emit({
      id: `attention:${a.attention_id}`,
      type,
      surface: 'workflow',
      severity:
        a.attention_type === 'decision_required' ? 'critical'
        : a.attention_type === 'action_required' ? 'attention'
        : 'informational',
      headline: a.title.trim(),
      metric: dueDays != null && Number.isFinite(dueDays)
        ? {
            value: dueDays < 0 ? `${Math.abs(dueDays)}d` : `${dueDays}d`,
            label: dueDays < 0 ? 'Overdue' : 'Until due',
            direction: dueDays < 0 ? 'bad' : 'neutral',
            source: 'stated',
            asOf: a.due_at!,
          }
        : null,
      body: body.trim(),
      prompt: a.attention_type === 'decision_required'
        ? 'What is your answer?'
        : 'Where does this stand?',
      entity: asset
        ? { kind: 'asset', id: asset.id, name: asset.companyName || asset.symbol, ticker: asset.symbol }
        : { kind: 'project', id: a.attention_id, name: a.title.slice(0, 40) },
      context: [
        // Trailing punctuation stripped. `next_action` is stored as a sentence
        // ("Make a decision."), and a chip row separated by middots rendered it
        // as "Make a decision. · Trading" — a full stop floating between two
        // fragments. A chip is a label, not a sentence, so it loses the period
        // and gains a capital.
        ...(a.next_action && isQualityContent(a.next_action) ? [{ label: chipCase(a.next_action) }] : []),
        ...(a.tags ?? []).slice(0, 2).map(t => ({ label: chipCase(t) })),
      ],
      actions: actions(
        // The primary is the verb this item actually takes. "Resolve" is the
        // fallback for a surface that cannot do anything more specific — it is
        // honest but weak, and a decision that can be approved should say so.
        a.attention_type === 'decision_required' && can?.approve
          ? { id: 'approve', label: 'Approve', inline: true }
          : a.attention_type === 'action_required' && can?.markDone
            ? { id: 'mark_done', label: 'Mark done', inline: true }
            : { id: 'resolve', label: 'Resolve', inline: true },
        asset
          ? { label: `Open ${asset.symbol}`, href: assetHref(asset.id) }
          : { label: 'Open item', href: `/attention/${a.attention_id}` },
        // At most two, and reject earns its place over a note: declining is a
        // real answer to a decision, and burying it in a menu makes approving
        // the path of least resistance.
        [
          ...(a.attention_type === 'decision_required' && can?.reject
            ? [{ id: 'reject', label: 'Decline', inline: true }]
            : []),
          { id: 'capture', label: 'Note', inline: true },
        ].slice(0, 2),
        [
          ...(can?.defer ? [{ id: 'defer', label: 'Defer a day', inline: false }] : []),
          { id: 'snooze', label: 'Snooze for a week', inline: false },
          { id: 'dismiss', label: 'Dismiss', inline: false },
        ],
      ),
      provenance: {
        occurredAt,
        reason: isQualityContent(a.reason_text)
          ? a.reason_text!.trim()
          : 'This was routed to you by the attention engine.',
      },
      expiry: { staleAfterDays: 30 },
      dedupeKey: `${type}:${a.attention_id}:${dayKey(occurredAt)}`,
    })
  })
}
