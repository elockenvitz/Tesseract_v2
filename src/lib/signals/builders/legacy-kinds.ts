import {
  emit,
  suppress,
  type CardContextChip,
  type CardMetric,
  type PortfolioRef,
  type CardResult,
  type Severity,
  type SignalCard,
  type SignalType,
  type Surface,
} from '../contract'
import {
  CORE_THESIS_SECTIONS, RESEARCH_PILL, anchorVerb, researchReason,
} from '../../research/case-state'
import { gate, isDisplayableNumber, isQualityContent } from '../suppression'
import { actions, assetHref, bookAgeChip, dayKey, portfolioHref } from './shared'
import { feedActionIsRoutable } from '../feed-actions'
import { attributiveHorizon } from '../horizon-copy'
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
function heldInChips(
  names: string[],
  ids?: string[],
  /** Sizes, where the source has them. Matched to `names` by index. */
  weights?: (number | undefined)[],
): CardContextChip[] {
  if (!names.length) return [{ label: 'Not held' }]

  /**
   * The books themselves, carried alongside the label.
   *
   * The chip used to be either a bare name with an href or the string
   * "In 4 portfolios" with nothing behind it. The first navigated away on a
   * single tap; the second was a number the reader could not open. Both are
   * answered by shipping the list with the chip and letting the card disclose
   * it in place — see `CardContextChip.portfolios`.
   */
  const portfolios: PortfolioRef[] = names.map((name, i) => ({
    name,
    ...(ids?.[i] ? { id: ids[i] } : {}),
    ...(weights?.[i] != null ? { weightPct: weights[i] } : {}),
  }))

  // One portfolio: name it, because a count of one tells the reader nothing.
  // More: say what the number counts. "Core Equity, Large Cap Growth +2" is
  // three names and an arithmetic expression competing for a 390px row.
  return [{
    label: names.length === 1 ? names[0] : `In ${names.length} portfolios`,
    ...(names.length === 1 && ids?.[0] ? { href: portfolioHref(ids[0]) } : {}),
    portfolios,
  }]
}

/**
 * A chip is a label, not a sentence.
 *
 * Strips trailing sentence punctuation and capitalises the first letter, so
 * stored prose ("make a decision.", "review.") reads as a chip rather than as a
 * clause that has lost its sentence.
 */
/**
 * A chip is a LABEL, not a sentence — and now it is enforced.
 *
 * `next_action` and workflow tags are free text, so an attention card could
 * carry "Review the Q3 model and confirm the margin assumptions" as a single
 * chip. On a 390px row that runs off the edge; the card view truncates it, but
 * a chip that is a truncated sentence reads as broken rather than as a label.
 *
 * Cut at a word boundary where there is one nearby, so it ends on a word rather
 * than mid-syllable. Anything needing more than this is prose and belongs in
 * the body, which is where the full `next_action` already is.
 */
const MAX_CHIP = 26

function chipCase(s: string): string {
  const t = s.trim().replace(/[.!;:,]+$/, '').trim()
  if (!t) return t
  const cased = t[0].toUpperCase() + t.slice(1)
  if (cased.length <= MAX_CHIP) return cased
  const cut = cased.slice(0, MAX_CHIP)
  const space = cut.lastIndexOf(' ')
  return `${(space > MAX_CHIP * 0.6 ? cut.slice(0, space) : cut).trimEnd()}…`
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
 * The signal type a template card becomes — including the one that is not in
 * the map.
 *
 * `active_risk` is absent from `TEMPLATE_TYPE` on purpose: it has its own
 * builder, with benchmark provenance and a peer pane the template shape cannot
 * carry. But that absence meant every caller had to remember to special-case
 * it, and one of them — the feed's category resolution — did not, which is how
 * a position-sizing decision came to be filed under News.
 *
 * One function, so the exception travels with the map instead of being
 * re-derived by whoever needs it next.
 */
export function signalTypeForTemplate(kind: string): SignalType {
  if (kind === 'active_risk') return 'active_risk'
  return TEMPLATE_TYPE[kind] ?? 'news'
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

// ── Derived insights: the Research family ──────────────────────────────────

/**
 * Five framings, two card types.
 *
 * The hook has already collapsed its framings into the two kinds the feed's
 * dedupe rule, Explore adapter and ranking adapter switch on, so this map is
 * the last hop rather than a second taxonomy. `incomplete_case` deliberately
 * does NOT get a type of its own — see `researchSignalTypeFor`.
 */
const INSIGHT_TYPE: Record<string, SignalType> = {
  stale_research: 'research_stale',
  no_thesis: 'no_research',
}

/**
 * What the card's big number should be, per framing.
 *
 * The metric has to be the thing the card is ABOUT. A no-case card leading with
 * a position size says the problem is the size; a new-evidence card leading
 * with days-since says the problem is the calendar. Each framing therefore
 * names its own, and a framing with nothing honest to put there gets no metric
 * at all rather than a filler number at the loudest size on the card.
 */
function insightMetric(insight: DerivedInsight): CardMetric | null {
  const { issue } = insight
  const days = insight.daysSinceReview

  /**
   * The label for a number measured from the effective anchor.
   *
   * ── The lie this prevents ─────────────────────────────────────────────────
   *
   * Two durable events can anchor these numbers and only one of them is an
   * edit: a section save, or a completed "reviewed, unchanged" judgment. The
   * metric is computed from whichever is LATER, so a fixed label of "Since case
   * written" would print a since-review number under a since-written word — a
   * percentage measured from a day nobody wrote anything.
   *
   * `anchorVerb` is the one function that turns `anchoredOn` into the word, and
   * the headline, the body and the case pane all call it too.
   */
  const anchorLabel = anchorVerb(insight.anchoredOn) === 'reviewed'
    ? 'Since review'
    : 'Since case written'

  const sinceAnchor = (): CardMetric | null =>
    isDisplayableNumber(days)
      ? {
          /**
           * The unit lives in the value, and the label is three words.
           *
           * It was a bare "179" over "Days since anyone wrote on it", which put
           * a raw integer at the loudest size on the card and then spent a full
           * line explaining what it counted. A number that needs a sentence to
           * be legible is not the number the card should be leading with.
           */
          value: days! >= 365 ? `${(days! / 365).toFixed(1)}y` : `${days}d`,
          label: anchorLabel,
          direction: 'neutral',
          // Derived from the written record, not from a market feed.
          source: 'computed',
          asOf: insight.reviewAnchor ?? new Date(Date.now() - days! * 86_400_000).toISOString(),
        }
      : null

  switch (issue.framing) {
    case 'new_evidence': {
      const n = issue.evidence?.length ?? 0
      /**
       * No hero number for a single arrival.
       *
       * "1 / New item since" put the least informative fact on the card at the
       * loudest size, above the title of the thing that actually arrived. One
       * item is not a quantity worth leading with — the item is the finding,
       * and the Evidence pane now sets it at reading size.
       *
       * At two or more the count IS part of the finding: how much has piled up
       * against an unrevised case is a real measure of the backlog, and the
       * age tells the reader how long it has been piling.
       */
      if (n < 2) return sinceAnchor()
      return {
        value: String(n),
        label: `New since case ${anchorVerb(insight.anchoredOn)}`,
        // Neutral, and it matters: nothing records whether evidence supports or
        // challenges the case, so grading the count good or bad would assert a
        // classification the product does not hold. See `case-state.ts`.
        direction: 'neutral',
        source: 'computed',
        asOf: issue.evidence?.[issue.evidence.length - 1]?.at ?? new Date().toISOString(),
      }
    }

    case 'price_move':
      return {
        /**
         * Signed, and neutral.
         *
         * NKE at −30.5% and PLTR at +37.7% are the same finding: the written
         * case has not accounted for the move. Colouring the fall bad and the
         * rally good would tell the reader the product has a view on the
         * direction, which it does not and must not.
         */
        value: `${issue.movePct! >= 0 ? '+' : '−'}${Math.abs(issue.movePct!).toFixed(1)}%`,
        // The label names the timestamp the percentage was actually measured
        // from. See `anchorLabel`.
        label: anchorLabel,
        direction: 'neutral',
        source: 'computed',
        asOf: insight.reviewAnchor ?? new Date().toISOString(),
      }

    case 'incomplete_case':
      return {
        value: `${issue.present.length} of ${CORE_THESIS_SECTIONS.length}`,
        /**
         * "Core thesis", and the denominator names what it counts.
         *
         * It read "Core sections written" over a bare "1/3", which invited the
         * reading that one third of the CASE exists. The case is eight fields;
         * this counts the three that state a view. Naming the set is the whole
         * fix — and it is still a count, never a percentage, because two of
         * three is not 67% of anything.
         */
        label: 'Core thesis written',
        direction: 'neutral',
        source: 'computed',
        asOf: insight.reviewAnchor ?? new Date().toISOString(),
      }

    /**
     * No metric on a no-case card, deliberately.
     *
     * "0/3" at the loudest size on the card is a score, and the reader would
     * read it as one. The absence is already the headline, and the panes say
     * what is known. Putting the position size here instead would be worse: it
     * would make the card look like it is about the size.
     */
    case 'no_case':
      return null

    default:
      return sinceAnchor()
  }
}

export function buildInsightCard(insight: DerivedInsight): CardResult {
  const type = INSIGHT_TYPE[insight.kind] ?? 'research_stale'
  return gate(type, () => {
    const entity = insight.symbol || insight.assetId
    if (!isQualityContent(insight.headline)) {
      return suppress('content_quality', entity, `headline: ${JSON.stringify(insight.headline)}`)
    }

    const weight = insight.weightPct
    const { issue } = insight

    return emit({
      id: `insight:${insight.id}`,
      type,
      // The type is what Curate filters on; the pill is what this card IS.
      // See `RESEARCH_PILL` for why the two levels are separate.
      kindLabel: RESEARCH_PILL[issue.framing],
      surface: 'research',
      /**
       * Never critical. Amber is the whole range this family has.
       *
       * The old rule promoted a large, long-quiet position to `critical`, which
       * drives the rose accent reserved for a position that has left the
       * framework it was written against. A case nobody has revisited is work
       * that is owed, not capital that is breaking — and the moment "old"
       * renders the same as "broken", the reader stops being able to tell the
       * difference at a glance, which is the only thing the accent is for.
       *
       * Size does not change this either. A 12% position with no written case
       * is more IMPORTANT than a 0.3% one and no more SEVERE; that distinction
       * is `feed-priority`'s materiality band, and it orders cards within the
       * tier rather than promoting them out of it.
       */
      severity: 'attention',
      headline: insight.headline,
      metric: insightMetric(insight),
      body: insight.body,
      // The question the framing actually implies, from the one function that
      // also writes the headline — so the card and its judgment pane cannot
      // ask different things about the same finding.
      prompt: insight.prompt,
      entity: {
        kind: 'asset',
        id: insight.assetId,
        name: insight.companyName || insight.symbol,
        ticker: insight.symbol,
      },
      context: [
        /**
         * Exposure, said only where it is true and current.
         *
         * `portfolioId` is what turns the chip from a label into a link. A
         * weight is attached only when there is one: 26 of 36 positions in the
         * current production snapshot carry none, and "0.0%" is a claim where
         * silence is not.
         */
        ...(insight.portfolioName ? [{
          label: insight.portfolioCount > 1
            ? `${insight.portfolioName} +${insight.portfolioCount - 1}`
            : insight.portfolioName,
          ...(insight.portfolioId ? {
            portfolios: [{
              id: insight.portfolioId,
              name: insight.portfolioName,
              ...(isDisplayableNumber(weight) ? { weightPct: weight! } : {}),
            }],
          } : {}),
        }] : []),
        ...(isDisplayableNumber(weight)
          ? [{ label: `${weight!.toFixed(1)}% of ${insight.portfolioName ?? 'the book'}` }]
          : insight.held && insight.portfolioName
            ? [{ label: `Held in ${insight.portfolioName}` }]
            : []),
        /**
         * The live idea, quietly and never as the headline.
         *
         * Research state and idea maturity are different objects: a live BUY
         * does not make a case staler, it makes the staleness more consequential
         * — which is importance, and importance is already the ranker's job. So
         * this is a context chip and it changes nothing about tier or score.
         * Where several exist the count is stated rather than one being picked.
         */
        ...(insight.liveIdeas.length === 1 && insight.liveIdeas[0].action
          ? [{ label: `Live idea · ${insight.liveIdeas[0].action.toUpperCase()}` }]
          : insight.liveIdeas.length > 1
            ? [{ label: `${insight.liveIdeas.length} live ideas` }]
            : []),
      ],
      /**
       * The action names the reader's actual task, per framing.
       *
       * All four land on the asset page's own case editor with the thesis
       * field in focus, and the labels differ because the work does: starting a
       * case, finishing one, and reconciling a written one against something
       * that happened are three different sittings. `contextualActions` checks
       * `feedActionIsRoutable` first, so a label can never promise a
       * destination that does not exist.
       */
      actions: contextualActions(
        type === 'no_research' ? 'add_rationale' : 'update_thesis',
        /**
         * Names the THESIS where the work is the thesis.
         *
         * "Write the case" promised the eight-field template and delivered the
         * thesis editor. "Review the evidence" claimed an adjudication the
         * product cannot make — see `RESEARCH_PILL.new_evidence`.
         */
        issue.framing === 'no_case' ? 'Write the thesis'
          : issue.framing === 'incomplete_case' ? 'Finish the thesis'
          : issue.framing === 'new_evidence' ? 'Review the research'
          : 'Review the case',
        insight.symbol,
        insight.assetId,
      ),
      provenance: {
        // The effective anchor: the later of the last edit and the last
        // completed review, which is the event this card is about. Never
        // "now", and never dated from a note.
        occurredAt: insight.reviewAnchor ?? new Date().toISOString(),
        /**
         * The facts, not a characterisation.
         *
         * A reader looking at "why this surfaced" on a card they did not expect
         * needs the ingredients, in the order they were evaluated. Written by
         * the same module that decided the framing, so the explanation cannot
         * drift from the rule.
         */
        reason: researchReason(issue, insight.symbol),
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
    /**
     * `CardContextChip`, not a bare label.
     *
     * It was narrowed to `{ label }`, which silently forbade the one thing a
     * context chip is most often for — disclosing the books behind it. A
     * portfolio rendered as inert text on every card routed through this
     * helper, and the type made that look deliberate.
     */
    context: CardContextChip[]
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
        /**
         * The book, as a disclosure. Same omission `activeRisk` had: a bare
         * label is not tappable and carries none of the position detail the
         * card already holds. Reported as portfolios not being selectable on
         * the oversized tiles.
         */
        {
          label: g.portfolioName,
          portfolios: [{ id: g.portfolioId, name: g.portfolioName, weightPct: g.weightPct }],
        },
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
    /**
     * Says the finding, in words somebody would use.
     *
     * It read "is held across more of the book than any one portfolio shows",
     * which is both jargon and a riddle: "the book" is not a thing the reader
     * has on screen, and the sentence asks them to work out the comparison.
     * The finding is that one name sits in several portfolios and reaches a
     * meaningful weight in at least one of them. Say that.
     */
    headline: c.portfolioCount > 1
      ? `${c.symbol} is held across ${c.portfolioCount} portfolios`
      : `${c.symbol} is ${c.maxWeightPct.toFixed(1)}% of one portfolio`,
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
    body: `The position is marked at $${b.price.toFixed(2)} against a target of $${b.target.toFixed(2)}${b.heldIn.length ? `, held in ${b.heldIn.join(', ')}` : ''}. The thesis played out and nothing in the product says so. Either the target rises or the position is a hold with no stated upside, and both are decisions somebody has to make.`,
    metric: {
      value: `+${(b.overshootPct * 100).toFixed(0)}%`,
      label: `Past a $${b.target.toFixed(0)} target`,
      direction: 'good',
      source: 'holdings',
      asOf: b.asOf,
    },
    context: [
      ...heldInChips(b.heldIn, b.heldInIds),
      /**
       * Which case the price passed.
       *
       * Every stored target belongs to a scenario, so "target reached" alone
       * asks the reader to guess which of their numbers this was. Named where
       * the row has one; plain "Target" where it does not, rather than a
       * fabricated case.
       */
      ...(b.caseName ? [{ label: `${b.caseName} case` }] : []),
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
    /**
     * The headline carries the FACTS; the eyebrow and metric carry the age.
     *
     * ── The repetition this removes ──────────────────────────────────────
     *
     * The card stated one thing five times. `occurredAt` is `expiredAt`, so the
     * eyebrow rendered "8 months ago"; the metric rendered "8mo / PAST ITS
     * HORIZON" — the same quantity, in the same units, 40px apart. Then the
     * headline said the view had outlived its horizon, the body said it was 8
     * months past it, and the prompt asked whether it was still the view.
     *
     * None of that is wrong and all of it is the same sentence. It also cost
     * the evidence band about 60px on a card whose panes are the part a reader
     * can work with.
     *
     * What survives is one statement of each fact: the KIND says it expired,
     * the metric says by how much, and the headline carries the three things
     * neither of them can — the number, the horizon it was given, and when it
     * was set. The body is now about why that matters rather than a third
     * recital of the dates.
     */
    headline: `${s.symbol}'s $${s.target.toFixed(2)} target outlived its ${
      s.timeframe ? attributiveHorizon(s.timeframe) : 'stated'} horizon`,
    /**
     * No price in the body.
     *
     * It read "The position is marked at $142.80" — the holdings mark — while
     * the chart two rows down ended at $348.06. Two numbers, one card, both
     * describing "the price". The card has ONE price now and the chart is where
     * it is stated, with its own date on the axis; a second copy in prose is a
     * copy that can go stale on its own. See `price-snapshot`.
     */
    body: `Set ${new Date(s.statedAt).toLocaleDateString(undefined, { month: 'long', year: 'numeric', timeZone: 'UTC' })} and not revisited since. A target nobody has revisited is not a view; it is a number the screen keeps repeating.`,
    metric: {
      value: `${s.overdueMonths}mo`,
      /**
       * Named, because the eyebrow beside it is also a duration.
       *
       * "8 months ago" (when the horizon closed) and "8mo" (how long it has
       * been overdue) are the same number here and diverge on nothing — they
       * are one fact. The label now says which fact, so the pair reads as a
       * date and its elapsed time rather than as two unexplained eights.
       */
      label: 'Overdue, past its horizon',
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
    /**
     * The books, and nothing the headline already said.
     *
     * The horizon and the set date used to be chips here. Both now appear
     * once each — the horizon in the headline, the set date in the body and
     * on the horizon pane's own axis — and a chip repeating either was a
     * third statement of a fact the card had already made twice. What is left
     * is the one thing none of the copy carries: whether this is your problem.
     */
    context: heldInChips(s.heldIn, s.heldInIds),
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
      /**
       * States the gap, and nothing beyond it.
       *
       * It read "${'${u.symbol}'} is a real position with no price on it", which is
       * wrong twice over. A listed stock HAS a price — it trades all day — so
       * "no price on it" describes something that is not true. And "a real
       * position with…" argues that the analyst has been careless, on a card
       * that cannot possibly know that: a name can be covered thoroughly and
       * held on a framework Tesseract has no field for.
       *
       * The actual fact is narrow and checkable: this application has no price
       * target recorded. Say that.
       */
      headline: `${u.symbol} has no price target on record`,
      // Explains the gap without judging the work behind the position. The old
      // last sentence — "can never be wrong and never be sized" — was a verdict
      // on the analyst's process from a card that only knows one database field
      // is empty.
      body: `It is ${u.weightPct.toFixed(1)}% of ${u.portfolioName}${
        u.heldIn.length > 1 ? ` and sits in ${u.heldIn.length} portfolios` : ''
      }${
        u.conviction ? `, with a stated conviction of ${u.conviction}` : ''
      }. Nothing in Tesseract says what it is worth, so there is no number here to size against or to check the price into.`,
      metric: {
        value: `${u.weightPct.toFixed(1)}%`,
        // "Unpriced" said the stock has no price. It has one; the target is
        // what is missing, and the metric is the weight either way.
        label: 'Of the portfolio',
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
        // The lens knows this position's weight in its primary book, so the
        // disclosure can show a size rather than a bare name for that row.
        ...heldInChips(u.heldIn, u.heldInIds,
          u.heldIn.map(n => (n === u.portfolioName ? u.weightPct : undefined))),
        ...(u.conviction ? [{ label: `Conviction ${u.conviction}` }] : []),
      ],
      /**
       * Asks whether a target BELONGS here, not how the position is valued.
       *
       * "How is this position being valued?" presumes the absence is an
       * oversight and asks the analyst to justify their process. Plenty of
       * positions are held on frameworks that do not reduce to one number, and
       * the honest question is the narrower one Tesseract can actually act on.
       */
      prompt: 'Does this position need a price target?',
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
    /**
     * Also suppressed by design, and for two independent reasons.
     *
     * ── It is the retired rule, still firing ─────────────────────────────────
     *
     * `generateStaleCoverageSignals` fires on `days >= 30` and nothing else.
     * `useDerivedInsights` used to do the same and deliberately stopped: "Silence
     * PLUS a reason. Never silence alone. The old rule is a fact about the
     * product rather than about the investment." Both paths emit `research_stale`,
     * so the mobile feed carried the superseded rule and the rule that replaced
     * it side by side, under one label, with no dedupe between them — `claimed
     * Subjects` reconciles insights against lens and scenario entries only. One
     * name can produce two "Unreviewed change" cards saying different things.
     *
     * ── It contradicts itself on its own face ────────────────────────────────
     *
     * The signal carries `createdAt: new Date()`, so `provenance.occurredAt` is
     * the moment the reader opened the app. The eyebrow reads "just now" directly
     * above a metric reading "30+ days silent". That is the failure this file's
     * own `occurredAt` contract names — "these cards are derived in the browser,
     * so `new Date()` made every one read '1 minute ago' on every login" — and
     * the builder cannot repair it, because the hook computes the silence and
     * then discards the date it measured it from.
     *
     * Suppressed here rather than at the source: `useSignalCards` also feeds the
     * desktop Ideas surface, which renders it through its own component and is
     * not this lane's to change. The mobile answer is that the sharper card
     * already exists, and showing the blunter one beside it teaches the reader
     * that "Unreviewed change" sometimes means nothing changed.
     *
     * `attention_cluster` and `conflict` are unaffected: both state something
     * that is true as of the moment they are computed, so "just now" is honest
     * for them, and neither has a competing producer.
     */
    if (sig.signalType === 'stale_coverage') {
      return suppress(
        'resolved', entity,
        'superseded by useDerivedInsights stale_research, which requires a reason as well as silence',
      )
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
    /**
     * A next action too long for a chip belongs in the prose.
     *
     * The context row now drops anything that is a sentence rather than a
     * label — see below. Dropping it without putting it anywhere would lose
     * the one line telling the reader what to DO, which is worse than the
     * clipped chip it replaced. The dedupe above already guards against saying
     * it twice when the subtitle or preview covers the same ground.
     */
    if (a.next_action && isQualityContent(a.next_action) && a.next_action.trim().length > MAX_CHIP) {
      const act = a.next_action.trim()
      if (!parts.some(p => p.includes(act) || act.includes(p))) {
        parts.push(act.endsWith('.') ? act : `${act}.`)
      }
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
        /**
         * `next_action` is prose, and prose does not fit a chip row.
         *
         * "Update thesis, rating, or research for this covered name" is a
         * SENTENCE. Truncating it to 26 characters produced "Update thesis,
         * rating" sitting on a row of middot-separated labels, which reads as
         * a rendering fault rather than as a label — reported as the text on
         * that line being cut off.
         *
         * The full sentence is already in the body, where it has room and
         * where prose belongs. Only genuinely short actions stay as chips: a
         * one-or-two word verb IS a label, and those are the ones worth having
         * on the scan line.
         */
        ...(a.next_action && isQualityContent(a.next_action) && a.next_action.trim().length <= MAX_CHIP
          ? [{ label: chipCase(a.next_action) }]
          : []),
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
            /**
             * `open_item`, not `resolve`, when the surface cannot resolve.
             *
             * ── The dead button this replaces ─────────────────────────────
             *
             * `resolve` is in `SURFACE_HANDLED`, so `feedActionIsRoutable`
             * passes it: the guard reads it as a promise the card surface will
             * keep. The mobile feed does not keep it. Every non-recommendation
             * attention card renders through `renderCard`, which passes
             * `onPrimary={() => {}}` — so the largest, darkest control on an
             * `awaiting_review`, `project_overdue`, `thesis_conflict` or
             * `team_focus` card said "Resolve" and did nothing at all.
             *
             * The header above already conceded the shape of this: "the mobile
             * feed wires none, and gets the generic Resolve". What it missed is
             * that the generic fallback was not merely weak, it was inert.
             *
             * Resolution has not moved: the feed's verdict pane on these cards
             * offers Done / In progress / Defer / Not mine and writes both the
             * disposition and the attention row. What changes is that the
             * button no longer claims to be a second way of doing it. It names
             * the one thing this surface can honestly do — take you to the
             * thing being asked about — and the feed wires it to exactly that.
             */
            : {
                id: 'open_item',
                label: asset ? `Open ${asset.symbol}` : 'Open item',
                inline: false,
              },
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
