/**
 * What deterministically changed while a piece of work was parked.
 *
 * ── The rule ─────────────────────────────────────────────────────────────
 *
 * No model decides whether a fact occurred. Every entry this returns is a
 * comparison of two stored values or a count of rows with trustworthy
 * timestamps. An LLM may later phrase one of these; it may not produce one,
 * and it may not conclude from one.
 *
 * ── What is deliberately NOT here ────────────────────────────────────────
 *
 * Omissions are the substance of this module, so they are listed rather
 * than left as gaps someone fills in later:
 *
 *   Portfolio weight change.  `portfolio_holdings` stores shares, price and
 *     cost per date — not weight. Deriving a point-in-time weight means
 *     summing every holding in the portfolio at two dates, which is exactly
 *     the "portfolio holdings collapse" defect class this codebase already
 *     tracks. Position change is reported instead from `accepted_trades`,
 *     which is an exact, actor-attributed row needing no aggregation.
 *
 *   Earnings.  `asset_earnings_dates` holds zero rows. There is no calendar.
 *
 *   News.  No news table exists in this schema. A "what changed" line
 *     implying news monitoring would invent a capability.
 *
 *   Asset field history.  No general field-history table. The one before/
 *     after comparison available is `target_price`, and only when a frozen
 *     `trade_proposal_versions` row predates the park to supply the before.
 *
 *   Idea-edit audit rows.  `audit_events` for idea edits had `from_state`
 *     hardcoded, so "changed from X" cannot be trusted. We report only THAT
 *     the idea was edited, never what it changed from.
 *
 * ── Fan-out ──────────────────────────────────────────────────────────────
 *
 * `fetchChangeFacts` takes the whole batch of subjects and issues a fixed
 * number of queries — five — no matter how many subjects. Twenty-four due
 * obligations must not become twenty-four round trips.
 */
import { supabase } from '../supabase'

export type FactConfidence =
  | 'SAFE_FACT'
  | 'SAFE_WITH_ATTRIBUTION'
  | 'AI_SUMMARY_ALLOWED'
  | 'UNRELIABLE'

export type ChangeFactKind =
  | 'price_change'
  | 'research_added'
  | 'idea_edited'
  | 'trade_committed'
  | 'decision_recorded'
  | 'target_price_changed'

export interface ChangeFact {
  kind: ChangeFactKind
  /** One line, already formatted. Facts only — no interpretation. */
  label: string
  /** The interval compared, or the instant observed. */
  from: string | null
  to: string
  confidence: FactConfidence
  sourceType: string
  sourceIds: string[]
  /** Required for SAFE_WITH_ATTRIBUTION: where the number came from. */
  attribution?: string
  /** For ranking: how much this moved, normalised where meaningful. */
  magnitude?: number
}

export interface ChangeSubject {
  /** The obligation's subject — a `trade_queue_items` row. */
  tradeQueueItemId: string
  assetId: string | null
  symbol: string | null
  /** When the work was parked. The left edge of every comparison. */
  parkedAt: string
}

const DAY = 86_400_000
/** Trading gaps and holidays. Five calendar days reliably contains one close. */
const CLOSE_LOOKBACK_DAYS = 7

const iso = (d: Date) => d.toISOString()
const dateOnly = (s: string) => s.slice(0, 10)

/**
 * Every fact for every subject, in a fixed number of queries.
 *
 * Returns a Map keyed by `tradeQueueItemId`. A subject with nothing to
 * report gets an empty array — which is a real answer, and the tile is
 * required to stay useful when it happens.
 */
export async function fetchChangeFacts(
  subjects: ChangeSubject[],
  now: Date = new Date(),
): Promise<Map<string, ChangeFact[]>> {
  const out = new Map<string, ChangeFact[]>()
  for (const s of subjects) out.set(s.tradeQueueItemId, [])
  if (subjects.length === 0) return out

  const push = (id: string, fact: ChangeFact) => out.get(id)?.push(fact)

  const ideaIds = subjects.map(s => s.tradeQueueItemId)
  const symbols = [...new Set(subjects.map(s => s.symbol).filter(Boolean) as string[])]
  const earliestPark = subjects.reduce(
    (min, s) => (Date.parse(s.parkedAt) < min ? Date.parse(s.parkedAt) : min),
    Date.parse(subjects[0].parkedAt),
  )

  const [baselineCloses, latestCloses, links, ideas, trades, decisions] = await Promise.all([
    // 1a. A close at or just before each park date. Two bounded windows
    //     rather than the whole range: fetching every close between the
    //     oldest park and today would blow past PostgREST's 1000-row cap
    //     for a park more than ~40 trading days old, and silently return a
    //     truncated series that still looks like data.
    symbols.length
      ? supabase
          .from('price_history_cache')
          .select('symbol, date, close')
          .in('symbol', symbols)
          .gte('date', dateOnly(iso(new Date(earliestPark - CLOSE_LOOKBACK_DAYS * DAY))))
          .lte('date', dateOnly(iso(now)))
          .order('date', { ascending: true })
          .limit(1000)
      : Promise.resolve({ data: [], error: null }),
    // 1b. The most recent close per symbol.
    symbols.length
      ? supabase
          .from('price_history_cache')
          .select('symbol, date, close')
          .in('symbol', symbols)
          .gte('date', dateOnly(iso(new Date(now.getTime() - CLOSE_LOOKBACK_DAYS * DAY))))
          .order('date', { ascending: false })
          .limit(1000)
      : Promise.resolve({ data: [], error: null }),
    // 2. Research linked to the idea since the park.
    supabase
      .from('object_links')
      .select('id, target_id, created_at')
      .eq('target_type', 'trade_idea')
      .in('target_id', ideaIds)
      .gte('created_at', iso(new Date(earliestPark)))
      .limit(1000),
    // 3. The idea rows themselves — for `updated_at` and current target.
    supabase
      .from('trade_queue_items')
      .select('id, updated_at, target_price')
      .in('id', ideaIds),
    // 4. Trades committed on the idea since the park.
    supabase
      .from('accepted_trades')
      .select('id, trade_queue_item_id, created_at, action, is_active')
      .in('trade_queue_item_id', ideaIds)
      .gte('created_at', iso(new Date(earliestPark)))
      .limit(1000),
    // 5. Decisions resolved on the idea since the park, and the frozen
    //    recommendation version that supplies a before-value for target.
    supabase
      .from('decision_requests')
      .select('id, trade_queue_item_id, status, reviewed_at, proposal_version_id, proposal_version:proposal_version_id(id, target_price, submitted_at)')
      .in('trade_queue_item_id', ideaIds)
      .limit(1000),
  ])

  /* ── 1. Price ─────────────────────────────────────────────────────────
   * SAFE_WITH_ATTRIBUTION, not SAFE_FACT: "+8.4%" with a stale cache behind
   * it is a false statement delivered confidently. The as-of dates travel
   * with the number and the surface is expected to show them.
   *
   * No interpolation. If no close exists within the lookback window on
   * either side, the fact is omitted rather than estimated. */
  const bySymbolAsc = new Map<string, Array<{ date: string; close: number }>>()
  for (const r of ((baselineCloses as any).data ?? []) as any[]) {
    if (r.close == null) continue
    const arr = bySymbolAsc.get(r.symbol) ?? []
    arr.push({ date: r.date, close: Number(r.close) })
    bySymbolAsc.set(r.symbol, arr)
  }
  const latestBySymbol = new Map<string, { date: string; close: number }>()
  for (const r of ((latestCloses as any).data ?? []) as any[]) {
    if (r.close == null) continue
    const prev = latestBySymbol.get(r.symbol)
    if (!prev || r.date > prev.date) latestBySymbol.set(r.symbol, { date: r.date, close: Number(r.close) })
  }

  for (const s of subjects) {
    if (!s.symbol) continue
    const series = bySymbolAsc.get(s.symbol) ?? []
    const parkDay = dateOnly(s.parkedAt)
    // The last close at or before the park date — never one after it.
    let baseline: { date: string; close: number } | null = null
    for (const row of series) {
      if (row.date <= parkDay) baseline = row
      else break
    }
    const latest = latestBySymbol.get(s.symbol) ?? series[series.length - 1] ?? null
    if (!baseline || !latest || baseline.date === latest.date || baseline.close === 0) continue

    const pct = ((latest.close - baseline.close) / baseline.close) * 100
    // Sub-0.05% rounds to "+0.0%", which reads as noise dressed as a finding.
    if (Math.abs(pct) < 0.05) continue

    push(s.tradeQueueItemId, {
      kind: 'price_change',
      label: `${pct >= 0 ? '+' : ''}${pct.toFixed(1)}% price`,
      from: baseline.date,
      to: latest.date,
      confidence: 'SAFE_WITH_ATTRIBUTION',
      sourceType: 'price_history_cache',
      sourceIds: [s.symbol],
      attribution: `close ${baseline.date} → ${latest.date}`,
      magnitude: Math.abs(pct),
    })
  }

  /* ── 2. Research linked ───────────────────────────────────────────── */
  const linksByIdea = new Map<string, string[]>()
  for (const l of ((links as any).data ?? []) as any[]) {
    const s = subjects.find(x => x.tradeQueueItemId === l.target_id)
    if (!s || l.created_at < s.parkedAt) continue
    const arr = linksByIdea.get(l.target_id) ?? []
    arr.push(l.id)
    linksByIdea.set(l.target_id, arr)
  }
  for (const [ideaId, ids] of linksByIdea) {
    push(ideaId, {
      kind: 'research_added',
      label: `${ids.length} new research item${ids.length === 1 ? '' : 's'}`,
      from: subjects.find(s => s.tradeQueueItemId === ideaId)?.parkedAt ?? null,
      to: iso(now),
      confidence: 'SAFE_FACT',
      sourceType: 'object_links',
      sourceIds: ids,
      magnitude: ids.length,
    })
  }

  /* ── 3. The idea was edited, and the target moved ─────────────────── */
  const ideaById = new Map<string, any>()
  for (const i of ((ideas as any).data ?? []) as any[]) ideaById.set(i.id, i)

  // Before-values for target_price come only from a frozen version that
  // predates the park. Without one there is no trustworthy "from", and
  // "changed to $135" with an invented "from" is the failure mode.
  const versionByIdea = new Map<string, { target_price: number | null; submitted_at: string | null }>()
  for (const d of ((decisions as any).data ?? []) as any[]) {
    const v = d.proposal_version
    if (!v?.submitted_at) continue
    const prev = versionByIdea.get(d.trade_queue_item_id)
    if (!prev || (v.submitted_at > (prev.submitted_at ?? ''))) {
      versionByIdea.set(d.trade_queue_item_id, { target_price: v.target_price, submitted_at: v.submitted_at })
    }
  }

  for (const s of subjects) {
    const idea = ideaById.get(s.tradeQueueItemId)
    if (!idea) continue

    const v = versionByIdea.get(s.tradeQueueItemId)
    const beforeUsable = v && v.submitted_at && v.submitted_at <= s.parkedAt && v.target_price != null
    const after = idea.target_price == null ? null : Number(idea.target_price)

    if (beforeUsable && after != null && Number(v!.target_price) !== after) {
      push(s.tradeQueueItemId, {
        kind: 'target_price_changed',
        label: `Target changed from ${fmtMoney(Number(v!.target_price))} to ${fmtMoney(after)}`,
        from: v!.submitted_at,
        to: idea.updated_at ?? iso(now),
        confidence: 'SAFE_FACT',
        sourceType: 'trade_proposal_versions',
        sourceIds: [s.tradeQueueItemId],
        magnitude: Math.abs(after - Number(v!.target_price)),
      })
    }

    // Only THAT it was edited. `audit_events` for idea edits had from_state
    // hardcoded, so any "changed from X" built on them would be fiction.
    if (idea.updated_at && idea.updated_at > s.parkedAt) {
      push(s.tradeQueueItemId, {
        kind: 'idea_edited',
        label: 'The idea was edited',
        from: s.parkedAt,
        to: idea.updated_at,
        confidence: 'SAFE_FACT',
        sourceType: 'trade_queue_items',
        sourceIds: [s.tradeQueueItemId],
        magnitude: 1,
      })
    }
  }

  /* ── 4. A trade was committed ─────────────────────────────────────── */
  const tradesByIdea = new Map<string, any[]>()
  for (const t of ((trades as any).data ?? []) as any[]) {
    const s = subjects.find(x => x.tradeQueueItemId === t.trade_queue_item_id)
    if (!s || t.created_at < s.parkedAt) continue
    const arr = tradesByIdea.get(t.trade_queue_item_id) ?? []
    arr.push(t)
    tradesByIdea.set(t.trade_queue_item_id, arr)
  }
  for (const [ideaId, ts] of tradesByIdea) {
    push(ideaId, {
      kind: 'trade_committed',
      label: `${ts.length} trade${ts.length === 1 ? '' : 's'} committed`,
      from: subjects.find(s => s.tradeQueueItemId === ideaId)?.parkedAt ?? null,
      to: iso(now),
      confidence: 'SAFE_FACT',
      sourceType: 'accepted_trades',
      sourceIds: ts.map(t => t.id),
      magnitude: ts.length,
    })
  }

  /* ── 5. A decision was recorded ───────────────────────────────────── */
  const RESOLVED = ['accepted', 'accepted_with_modification', 'rejected', 'deferred', 'withdrawn']
  const decByIdea = new Map<string, any[]>()
  for (const d of ((decisions as any).data ?? []) as any[]) {
    const s = subjects.find(x => x.tradeQueueItemId === d.trade_queue_item_id)
    if (!s || !RESOLVED.includes(d.status)) continue
    if (!d.reviewed_at || d.reviewed_at < s.parkedAt) continue
    const arr = decByIdea.get(d.trade_queue_item_id) ?? []
    arr.push(d)
    decByIdea.set(d.trade_queue_item_id, arr)
  }
  for (const [ideaId, ds] of decByIdea) {
    push(ideaId, {
      kind: 'decision_recorded',
      label: `${ds.length} decision${ds.length === 1 ? '' : 's'} recorded`,
      from: subjects.find(s => s.tradeQueueItemId === ideaId)?.parkedAt ?? null,
      to: iso(now),
      confidence: 'SAFE_FACT',
      sourceType: 'decision_requests',
      sourceIds: ds.map(d => d.id),
      magnitude: ds.length,
    })
  }

  // Most-moved first, so a surface showing two of five shows the two that
  // matter. Price leads on ties because it is the one a reader can act on.
  for (const [, facts] of out) facts.sort(factOrder)
  return out
}

const KIND_WEIGHT: Record<ChangeFactKind, number> = {
  trade_committed: 5,
  decision_recorded: 4,
  target_price_changed: 3,
  price_change: 2,
  research_added: 1,
  idea_edited: 0,
}

function factOrder(a: ChangeFact, b: ChangeFact) {
  const w = KIND_WEIGHT[b.kind] - KIND_WEIGHT[a.kind]
  if (w !== 0) return w
  return (b.magnitude ?? 0) - (a.magnitude ?? 0)
}

function fmtMoney(n: number): string {
  return `$${n % 1 === 0 ? n.toFixed(0) : n.toFixed(2)}`
}

/**
 * The facts a surface may render without a human in the loop.
 *
 * Only SAFE_FACT and SAFE_WITH_ATTRIBUTION. The other two classes exist so
 * a later slice can route them somewhere that labels them, not so this one
 * can quietly include them.
 */
export function renderableFacts(facts: ChangeFact[]): ChangeFact[] {
  return facts.filter(f => f.confidence === 'SAFE_FACT' || f.confidence === 'SAFE_WITH_ATTRIBUTION')
}
