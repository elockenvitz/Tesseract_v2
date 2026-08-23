import { signalTypeForTemplate } from '../signals/builders/legacy-kinds'
import { insightSignalType } from '../signals/insight-type'
import type { ExploreItem } from './explore-item'
import type { FeedCategory } from './feed-categories'

/**
 * Existing feed data, normalised into previews.
 *
 * ── Why the adapters are pure and live here ───────────────────────────────
 *
 * Every source Explore reads is already fetched for Curate: the lenses, the
 * scenario cards, the derived insights, the ideas feed, the market templates,
 * the news, the attention queue. Explore adds no query of its own for content —
 * it is a second arrangement of the same material, which is the whole reason it
 * can exist without a data programme behind it.
 *
 * The normalisation is pure so it can be tested against fixtures and imported
 * by the gallery, which has no Supabase environment. That is the Phase 6B/7/8.1
 * lesson applied up front rather than after 130 layout assertions fail at once
 * with no test naming the cause.
 *
 * ── On honesty ────────────────────────────────────────────────────────────
 *
 * Nothing here invents a fact. Where a source cannot supply a field the field
 * is absent and the tile renders without it — an absent weight is not 0.0%, an
 * absent author is not "Someone", and a source with no timestamp does not get
 * `Date.now()` so it can look fresh.
 */

const upper = (s: unknown) => String(s ?? '').trim().toUpperCase()

/** Portfolio lenses: targets hit and expired, positions with no target, sizing. */
export function lensesToExplore(lenses: {
  breaches?: any[]; stale?: any[]; untargeted?: any[]; conviction?: any[]; crowded?: any[]
} | null | undefined): ExploreItem[] {
  if (!lenses) return []
  const out: ExploreItem[] = []

  for (const b of lenses.breaches ?? []) {
    const pct = Math.abs(Number(b.overshootPct ?? 0) * 100)
    out.push({
      id: `lens-breach-${b.assetId}`,
      // Keyed on the CONDITION, not on the adapter. A target reached is one
      // artifact however many surfaces describe it.
      dedupeKey: `target_hit:${b.assetId}`,
      signalType: 'target_hit',
      category: 'decisions', subtype: 'signal',
      title: `${b.symbol} passed its target`,
      context: `Trading ${pct.toFixed(0)}% through $${Number(b.target).toFixed(0)}`,
      symbol: b.symbol, assetId: b.assetId, companyName: b.companyName,
      metric: { value: `+${pct.toFixed(0)}%`, label: 'through target', direction: 'good' },
      // Reaching a target is a good outcome, and Explore should say so rather
      // than filing every decision event under things that have gone wrong.
      positive: true,
      portfolio: { heldInCount: b.heldIn?.length, name: b.heldIn?.[0] },
      occurredAt: b.asOf ?? null,
      destination: { kind: 'action', action: 'review_target', assetId: b.assetId, symbol: b.symbol },
      importance: Math.min(pct / 40, 1),
    })
  }

  for (const t of lenses.stale ?? []) {
    out.push({
      id: `lens-stale-${t.assetId}`,
      dedupeKey: `target_expired:${t.assetId}`,
      signalType: 'target_expired',
      category: 'decisions', subtype: 'signal',
      title: `${t.symbol} target has run past its horizon`,
      context: `${t.overdueMonths} month${t.overdueMonths === 1 ? '' : 's'} past a ${t.timeframe ?? 'stated'} view`,
      symbol: t.symbol, assetId: t.assetId, companyName: t.companyName,
      metric: { value: `$${Number(t.target).toFixed(0)}`, label: 'stated target', direction: 'neutral' },
      portfolio: { heldInCount: t.heldIn?.length, name: t.heldIn?.[0] },
      occurredAt: t.expiredAt ?? null,
      destination: { kind: 'action', action: 'review_target', assetId: t.assetId, symbol: t.symbol },
      importance: Math.min((t.overdueMonths ?? 0) / 12, 1),
    })
  }

  for (const u of lenses.untargeted ?? []) {
    out.push({
      id: `lens-untargeted-${u.assetId}`,
      dedupeKey: `no_target:${u.assetId}`,
      signalType: 'no_target',
      category: 'decisions', subtype: 'signal',
      title: `${u.symbol} has no price target on record`,
      context: `${Number(u.weightPct).toFixed(1)}% of ${u.portfolioName}`,
      symbol: u.symbol, assetId: u.assetId, companyName: u.companyName,
      metric: { value: `${Number(u.weightPct).toFixed(1)}%`, label: 'of the portfolio', direction: 'neutral' },
      portfolio: { weightPct: Number(u.weightPct), heldInCount: u.heldIn?.length, name: u.portfolioName },
      occurredAt: u.asOf ?? null,
      destination: { kind: 'action', action: 'set_target', assetId: u.assetId, symbol: u.symbol },
      importance: Math.min(Number(u.weightPct) / 15, 1),
    })
  }

  for (const g of lenses.conviction ?? []) {
    const over = g.direction === 'overweight'
    out.push({
      id: `lens-conviction-${g.assetId}`,
      dedupeKey: `conviction:${g.assetId}`,
      // The ranker splits conviction by direction; the key never did.
      signalType: g.direction === 'overweight' ? 'conviction_oversized' : 'conviction_undersized',
      category: 'decisions', subtype: 'signal',
      title: `${g.symbol} is ${over ? 'larger' : 'smaller'} than its conviction`,
      context: `${Number(g.weightPct).toFixed(1)}% in ${g.portfolioName}${g.conviction ? ` · conviction ${g.conviction}` : ''}`,
      symbol: g.symbol, assetId: g.assetId, companyName: g.companyName,
      metric: { value: `${Number(g.weightPct).toFixed(1)}%`, label: 'position', direction: 'neutral' },
      portfolio: { weightPct: Number(g.weightPct), name: g.portfolioName },
      occurredAt: g.asOf ?? null,
      destination: { kind: 'action', action: 'open_asset', assetId: g.assetId, symbol: g.symbol },
      importance: Math.min(Math.abs(Number(g.tension ?? 0)), 1),
    })
  }

  for (const c of lenses.crowded ?? []) {
    out.push({
      id: `lens-crowded-${c.assetId}`,
      dedupeKey: `crowding:${c.assetId}`,
      signalType: 'crowding',
      category: 'decisions', subtype: 'signal',
      title: `${c.symbol} is held across ${c.portfolioCount} portfolios`,
      context: `Largest weight ${Number(c.maxWeightPct).toFixed(1)}%`,
      symbol: c.symbol, assetId: c.assetId, companyName: c.companyName,
      metric: { value: `${c.portfolioCount}`, label: 'portfolios', direction: 'neutral' },
      portfolio: { weightPct: Number(c.maxWeightPct), heldInCount: c.portfolioCount },
      occurredAt: c.asOf ?? null,
      destination: { kind: 'action', action: 'open_asset', assetId: c.assetId, symbol: c.symbol },
      importance: 0.4,
    })
  }

  return out
}

/** Scenario cards, which are already built contract cards. */
export function scenarioCardsToExplore(cards: any[]): ExploreItem[] {
  return (cards ?? []).map(c => ({
    id: `scenario-${c.entity?.id ?? c.id}`,
    dedupeKey: `scenario_gap:${c.entity?.id ?? c.id}`,
    signalType: 'scenario_gap',
    category: 'decisions' as FeedCategory,
    subtype: 'signal' as const,
    title: c.headline,
    context: c.metric?.label,
    symbol: c.entity?.ticker ?? null,
    assetId: c.entity?.id ?? null,
    companyName: c.entity?.name ?? null,
    metric: c.metric
      ? { value: String(c.metric.value), label: c.metric.label, direction: c.metric.direction }
      : undefined,
    occurredAt: c.provenance?.occurredAt ?? null,
    destination: {
      kind: 'action' as const, action: 'open_cases',
      assetId: c.entity?.id ?? null, symbol: c.entity?.ticker ?? null,
    },
    // A card the builder called critical is genuinely more interesting than one
    // it called informational, and the builder computed that from the numbers.
    importance: c.severity === 'critical' ? 0.9 : c.severity === 'attention' ? 0.6 : 0.3,
  }))
}

/** Derived insights: documentation gaps and unreviewed changes. */
export function insightsToExplore(insights: any[]): ExploreItem[] {
  return (insights ?? []).map(i => {
    const moved = i.context?.kind === 'price_move'
    return {
      id: `insight-${i.id}`,
      dedupeKey: `${i.kind}:${i.assetId}`,
      // Insight kinds are their own vocabulary; the cards are not. One
      // function, because this disagreed with the ranker about
      // `concentration` and those tiles could never open.
      signalType: insightSignalType(i.kind),
      category: 'research' as FeedCategory,
      subtype: 'research' as const,
      title: i.headline,
      context: i.portfolioName
        ? `${i.weightPct != null ? `${Number(i.weightPct).toFixed(1)}% of ` : ''}${i.portfolioName}`
        : undefined,
      symbol: i.symbol, assetId: i.assetId, companyName: i.companyName,
      metric: moved
        ? {
            value: `${i.context.movePct >= 0 ? '+' : ''}${Math.round(i.context.movePct)}%`,
            label: 'since last look',
            direction: i.context.movePct >= 0 ? ('good' as const) : ('bad' as const),
          }
        : i.weightPct != null
          ? { value: `${Number(i.weightPct).toFixed(1)}%`, label: 'position', direction: 'neutral' as const }
          : undefined,
      portfolio: { weightPct: i.weightPct ?? undefined, name: i.portfolioName ?? undefined },
      occurredAt: i.lastTouchedAt ?? null,
      destination: {
        kind: 'action' as const,
        action: i.kind === 'no_thesis' ? 'update_thesis' : 'open_asset',
        assetId: i.assetId, symbol: i.symbol,
      },
      importance: Math.min((i.score ?? 0), 1),
    }
  })
}

/**
 * Posts from the ideas feed: trades, thoughts, notes, thesis updates.
 *
 * Reads `item.asset`, matching the corrected Phase 8.1 mapping. The bug that
 * phase fixed — `e.item` where the entry stored `e.idea` — came from exactly
 * this kind of second adapter written against a guessed shape, so this one
 * takes the post itself rather than a feed entry wrapping it.
 */
export function ideasToExplore(posts: any[]): ExploreItem[] {
  return (posts ?? []).map(p => {
    const type = String(p.type ?? p.item_type ?? '')
    const isTrade = type === 'trade' || type === 'trade_idea'
    // A thesis update is research, not a post about research — the artifact is
    // the thesis. Categorising by what it IS keeps Curate and Explore agreeing.
    const isThesis = type === 'thesis_update' || type === 'research_note'
    const author = p.author?.name ?? p.author?.full_name ?? null
    return {
      id: `idea-${p.id}`,
      dedupeKey: `post:${p.id}`,
      signalType: p.type === 'trade' || p.type === 'trade_idea' ? 'trade_idea' : 'thought',
      category: (isThesis ? 'research' : 'ideas') as FeedCategory,
      subtype: isThesis ? ('research' as const) : ('idea' as const),
      title: p.title ?? p.headline ?? (isTrade ? 'Trade idea' : 'Thought'),
      context: p.summary ?? p.body ?? undefined,
      symbol: p.asset?.symbol ?? null,
      assetId: p.asset?.id ?? null,
      companyName: p.asset?.company_name ?? null,
      source: author ? ({ kind: 'person' as const, label: author }) : undefined,
      occurredAt: p.created_at ?? p.updated_at ?? null,
      destination: p.asset?.id
        ? { kind: 'action' as const, action: isThesis ? 'update_thesis' : 'open_asset',
            assetId: p.asset.id, symbol: p.asset.symbol }
        : { kind: 'filter' as const, category: 'ideas' as FeedCategory },
      // A colleague publishing something is a positive development by default:
      // it is thinking that has happened, not a gap that has been found.
      positive: true,
      importance: 0.4,
    }
  })
}

/** Market news, where it is about a name the desk follows. */
export function newsToExplore(news: any[]): ExploreItem[] {
  return (news ?? []).map(n => ({
    id: `news-${n.id ?? n.url}`,
    dedupeKey: `news:${n.id ?? n.url}`,
    signalType: 'news',
    category: 'news' as FeedCategory,
    subtype: 'news' as const,
    title: n.headline ?? n.title ?? '',
    context: n.summary ?? undefined,
    symbol: n.primarySymbol ?? null,
    assetId: n.assetId ?? null,
    source: n.source ? { kind: 'market' as const, label: String(n.source) } : undefined,
    occurredAt: n.publishedAt ?? n.published_at ?? null,
    destination: n.assetId
      ? { kind: 'action' as const, action: 'open_asset', assetId: n.assetId, symbol: n.primarySymbol }
      : { kind: 'filter' as const, category: 'news' as FeedCategory },
    importance: 0.25,
  }))
}

/** Market templates: unusual moves, earnings, corporate actions, releases. */
export function templatesToExplore(cards: any[]): ExploreItem[] {
  return (cards ?? []).map(c => ({
    id: `tpl-${c.id ?? `${c.kind}-${c.symbol}`}`,
    dedupeKey: `${c.kind}:${c.assetId ?? c.symbol ?? c.id}`,
    // `economic` is not `economic_release`, and `active_risk` is not in the map
    // at all — both are exactly why this goes through one function.
    signalType: signalTypeForTemplate(c.kind),
    category: 'news' as FeedCategory,
    subtype: 'news' as const,
    title: c.headline ?? '',
    context: c.body ?? undefined,
    symbol: c.symbol ?? null,
    assetId: c.assetId ?? null,
    metric: c.metric ? { value: String(c.metric), label: c.metricLabel, direction: c.tone === 'negative' ? 'bad' : 'neutral' } : undefined,
    source: { kind: 'market' as const, label: 'Market' },
    occurredAt: c.occurredAt ?? null,
    destination: c.assetId
      ? { kind: 'action' as const, action: 'open_asset', assetId: c.assetId, symbol: c.symbol }
      : { kind: 'filter' as const, category: 'news' as FeedCategory },
    importance: 0.3,
  }))
}

/** The attention queue, split the way Phase 8.1's taxonomy splits it. */
export function attentionToExplore(items: any[]): ExploreItem[] {
  return (items ?? []).map(a => {
    const isTrade = a.source_type === 'trade_queue_item'
    return {
      id: `attn-${a.attention_id}`,
      dedupeKey: `attention:${a.attention_id}`,
      signalType: a.source_type === 'trade_queue_item' ? 'recommendation'
        : a.source_type === 'project' || a.source_type === 'project_deliverable' ? 'project_overdue'
        : 'awaiting_review',
      category: (isTrade ? 'decisions' : 'workflow') as FeedCategory,
      subtype: isTrade ? ('signal' as const) : ('workflow' as const),
      title: a.title ?? a.summary ?? 'Awaiting you',
      context: a.summary && a.title ? a.summary : undefined,
      symbol: a.context?.symbol ?? null,
      assetId: a.context?.asset_id ?? null,
      source: a.owner_name ? { kind: 'person' as const, label: a.owner_name } : undefined,
      occurredAt: a.created_at ?? null,
      destination: a.context?.asset_id
        ? { kind: 'action' as const, action: 'open_asset', assetId: a.context.asset_id, symbol: a.context?.symbol }
        : { kind: 'filter' as const, category: (isTrade ? 'decisions' : 'workflow') as FeedCategory },
      importance: a.priority === 'high' ? 0.6 : 0.3,
    }
  })
}

/**
 * Aggregate tiles, and only where the underlying items genuinely exist.
 *
 * "4 new ideas this week" is worth a tile because it stands for four things the
 * reader can go and read; the same four rendered as four near-identical small
 * tiles is the monotony this surface exists to avoid. It routes to the filtered
 * Explore surface rather than nowhere — an aggregate that is a dead end is
 * worse than no aggregate.
 *
 * Never fabricated: the count is the count of items actually in hand, and the
 * tile is omitted below `MIN_AGGREGATE` because "2 new ideas" is not a
 * discovery, it is two tiles.
 */
const MIN_AGGREGATE = 3
const AGGREGATE_WINDOW_DAYS = 7

export function aggregatesFor(items: ExploreItem[], now: number): ExploreItem[] {
  const recent = items.filter(i => {
    if (!i.occurredAt) return false
    const t = new Date(i.occurredAt).getTime()
    return Number.isFinite(t) && now - t <= AGGREGATE_WINDOW_DAYS * 86_400_000
  })

  const out: ExploreItem[] = []
  const groups: { category: FeedCategory; label: (n: number) => string }[] = [
    { category: 'ideas', label: n => `${n} new ideas this week` },
    { category: 'research', label: n => `${n} research updates this week` },
  ]

  for (const g of groups) {
    const n = recent.filter(i => i.category === g.category).length
    if (n < MIN_AGGREGATE) continue
    out.push({
      id: `agg-${g.category}`,
      dedupeKey: `aggregate:${g.category}`,
      // No single card behind it, by design — see the aggregate behaviour.
      signalType: null,
      category: g.category,
      subtype: 'aggregate',
      title: g.label(n),
      count: n,
      // The newest member's timestamp, so an aggregate of stale things does not
      // present itself as fresh.
      occurredAt: recent
        .filter(i => i.category === g.category)
        .map(i => i.occurredAt!)
        .sort()
        .reverse()[0] ?? null,
      destination: { kind: 'filter', category: g.category },
      importance: 0.5,
      positive: true,
    })
  }
  return out
}

/** Every symbol an Explore page would like a sparkline for, in page order. */
export function exploreSymbols(items: ExploreItem[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const i of items) {
    const s = upper(i.symbol)
    if (!s || seen.has(s)) continue
    seen.add(s)
    out.push(s)
  }
  return out
}
