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
import { actions, assetHref, dayKey } from './shared'
import type { TemplateCard } from '../../mobile/feed-templates'
import type { DerivedInsight } from '../../../hooks/mobile/useDerivedInsights'
import type {
  ConvictionGap,
  CrowdedName,
  StaleTarget,
  TargetBreach,
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

/** Every one of these ends up on the asset, so the action grammar is shared. */
function assetActions(symbol: string, assetId: string | undefined) {
  return actions(
    { id: 'capture', label: 'Capture', inline: true },
    assetId
      ? { label: `Open ${symbol}`, href: assetHref(assetId) }
      : { label: 'Open feed', href: '/' },
  )
}

// ── Template cards: unusual move, earnings, corporate action, economic ─────

const TEMPLATE_TYPE: Record<string, SignalType> = {
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
            value: `${days}`,
            label: 'Days since anyone wrote on it',
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
      entity: {
        kind: 'asset',
        id: insight.assetId,
        name: insight.companyName || insight.symbol,
        ticker: insight.symbol,
      },
      context: [
        ...(insight.portfolioName ? [{ label: insight.portfolioName }] : []),
        ...(isDisplayableNumber(weight) ? [{ label: `${weight!.toFixed(1)}% of book` }] : []),
      ],
      actions: assetActions(insight.symbol, insight.assetId),
      provenance: {
        occurredAt: new Date(Date.now() - (days ?? 0) * 86_400_000).toISOString(),
        reason: `${insight.symbol} is in the book and the written record has not kept up with it.`,
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
    staleAfterDays: number
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
      entity: {
        kind: 'asset',
        id: opts.assetId,
        name: opts.companyName || opts.symbol,
        ticker: opts.symbol,
      },
      context: opts.context,
      actions: assetActions(opts.symbol, opts.assetId),
      provenance: { occurredAt: new Date().toISOString(), reason: opts.reason },
      expiry: { staleAfterDays: opts.staleAfterDays },
      dedupeKey: `${type}:${opts.assetId}:${dayKey(new Date().toISOString())}`,
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
        ? `The position is ${g.weightPct.toFixed(1)}% of ${g.portfolioName} while the target implies ${(g.upsidePct * 100).toFixed(0)}% upside${g.conviction ? ` and the stated conviction is ${g.conviction}` : ''}. Either the size is wrong or the target is stale, and both are decisions.`
        : `The position is ${g.weightPct.toFixed(1)}% of ${g.portfolioName} with only ${(g.upsidePct * 100).toFixed(0)}% left to the target${g.conviction ? ` and conviction of ${g.conviction}` : ''}. Holding it at this size is a fresh decision, not a continuing one.`,
      metric: {
        value: `${g.weightPct.toFixed(1)}%`,
        label: under ? 'Position size, against a strong view' : 'Position size, against a spent view',
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
      ],
      reason: `Stated conviction and position size disagree on ${g.symbol}, and nothing in the product reconciles them.`,
      staleAfterDays: 14,
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
    body: `Held in ${c.portfolioCount} portfolios — ${c.portfolioNames.slice(0, 3).join(', ')}${c.portfolioNames.length > 3 ? ' and others' : ''} — reaching ${c.maxWeightPct.toFixed(1)}% in the heaviest. A single-portfolio view understates the firm's exposure to one thesis.`,
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
    ],
    reason: `${c.symbol} appears in ${c.portfolioCount} portfolios, so its risk is a firm-level position rather than a portfolio-level one.`,
    staleAfterDays: 14,
  })
}

export function buildTargetHitCard(b: TargetBreach): CardResult {
  return lensCard('target_hit', 'research', b.overshootPct >= 0.1 ? 'critical' : 'attention', {
    id: `target_hit:${b.assetId}`,
    assetId: b.assetId,
    symbol: b.symbol,
    companyName: b.companyName,
    headline: `${b.symbol} has reached the target you set for it`,
    body: `The price is at $${b.price.toFixed(2)} against a target of $${b.target.toFixed(2)}${b.heldIn.length ? `, held in ${b.heldIn.join(', ')}` : ''}. The thesis played out and nothing in the product says so — either the target rises or the position is a hold with no stated upside, and both are decisions somebody has to make.`,
    metric: {
      value: `+${(b.overshootPct * 100).toFixed(0)}%`,
      label: `Past a $${b.target.toFixed(0)} target`,
      direction: 'good',
      source: 'holdings',
      asOf: b.asOf,
    },
    context: [
      ...(b.heldIn.length ? [{ label: `Held · ${b.heldIn.length}` }] : [{ label: 'Not held' }]),
      ...(b.conviction ? [{ label: `Conviction ${b.conviction}` }] : []),
    ],
    reason: `${b.symbol} passed its price target and no one has revised the view or the position.`,
    staleAfterDays: 7,
  })
}

export function buildStaleTargetCard(s: StaleTarget): CardResult {
  return lensCard('target_expired', 'research', s.overdueMonths >= 6 ? 'critical' : 'attention', {
    id: `target_expired:${s.assetId}`,
    assetId: s.assetId,
    symbol: s.symbol,
    companyName: s.companyName,
    headline: `Your view on ${s.symbol} has outlived its own horizon`,
    body: `The target of $${s.target.toFixed(2)} was set on a ${s.timeframe ?? 'stated'} horizon and is ${s.overdueMonths} months past it, with the price at $${s.price.toFixed(2)}. A target nobody has revisited is not a view; it is a number the screen keeps repeating.`,
    metric: {
      value: `${s.overdueMonths}mo`,
      label: 'Past its stated horizon',
      direction: 'bad',
      source: 'stated',
      asOf: new Date(Date.now() - s.ageMonths * 30.44 * 86_400_000).toISOString(),
    },
    context: [
      ...(s.heldIn.length ? [{ label: `Held · ${s.heldIn.length}` }] : [{ label: 'Not held' }]),
      ...(s.timeframe ? [{ label: s.timeframe }] : []),
    ],
    reason: `${s.symbol}'s target passed its own ${s.timeframe ?? 'stated'} horizon ${s.overdueMonths} months ago.`,
    staleAfterDays: 30,
  })
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
 * AttentionFeedCard, which is why they kept the old styling after everything
 * else converged — and why the feed still looked like two products.
 *
 * The primary action is deliberately NOT "Capture" here. Every other kind is an
 * observation the reader may or may not act on; an attention item is a request
 * addressed to them, and offering "Capture" as the main verb on somebody's
 * pending decision would be a way of not answering it.
 */
export function buildAttentionCard(
  a: AttentionLike,
  asset?: { id: string; symbol: string; companyName?: string | null } | null,
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

    // The body prefers the reason over the preview: the reason says WHY this is
    // in front of you, and the preview is only the first line of the thing
    // itself, which the title already names.
    const body = [a.reason_text, a.subtitle, a.preview]
      .find(t => isQualityContent(t)) ?? 'No further detail was recorded.'

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
      entity: asset
        ? { kind: 'asset', id: asset.id, name: asset.companyName || asset.symbol, ticker: asset.symbol }
        : { kind: 'project', id: a.attention_id, name: a.title.slice(0, 40) },
      context: [
        ...(a.next_action && isQualityContent(a.next_action) ? [{ label: a.next_action }] : []),
        ...(a.tags ?? []).slice(0, 2).map(t => ({ label: t })),
      ],
      actions: actions(
        // An answer, not a note.
        { id: 'resolve', label: 'Resolve', inline: true },
        asset
          ? { label: `Open ${asset.symbol}`, href: assetHref(asset.id) }
          : { label: 'Open item', href: `/attention/${a.attention_id}` },
        [{ id: 'capture', label: 'Note', inline: true }],
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
