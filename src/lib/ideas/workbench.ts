import type { RankReason } from '../signals/feed-priority'

/**
 * Ideas as the primary object, with everything else explaining them.
 *
 * ── The inversion this module performs ────────────────────────────────────
 *
 * `rankMixedCandidates` ranks five kinds of thing into one stream: posts,
 * signals, contract cards, portfolio lenses and process findings. The cockpit
 * rendered that stream literally — every candidate became a peer row — which
 * is why a desk of eleven ideas read as nineteen exceptions. The ranking was
 * right; the presentation took "these all scored" to mean "these are all
 * things".
 *
 * They are not. A scenario break on CROX is not a sibling of the CROX idea, it
 * is the REASON the CROX idea needs attention. So this folds the non-post
 * candidates into the idea they are about, keyed on ticker, and the ranked
 * order survives as the idea's own priority.
 *
 * What that buys, concretely: the left pane lists ideas, each carrying the
 * evidence that raised it, and the right pane can answer "why now" and "what
 * next" without a second query or a second ranker.
 *
 * ── What happens to evidence with no idea behind it ───────────────────────
 *
 * A target break on a name nobody has written an idea about is still real and
 * still worth surfacing. Rather than inventing a fake idea to hold it, those
 * become ideas of their own with `origin: 'signal'` — a position the desk owns
 * and has not yet formed a view on is exactly the thing a workbench should
 * raise. They are visibly different from an authored idea: no thesis, no
 * author, and the stance reads `WATCH`.
 *
 * Pure. No React, no Supabase, no clock of its own — `now` is passed in, so the
 * same candidates always produce the same workbench.
 */

/** What the ranker produced, flattened to what this module needs. */
export interface WorkbenchCandidate {
  kind: 'post' | 'signal' | 'card' | 'lens' | 'process'
  /** The id the ranker saw. Stable, source-specific. */
  id: string
  symbol: string | null
  /** Canonical tier — lower is more urgent. */
  tier: number
  reasons: readonly RankReason[]
  /** One line: what this finding says. Supplied by the caller's converters. */
  headline: string
  /** One line: why it matters now, where the source has one. */
  why?: string | null
  /**
   * The finding's own type key — `target_hit`, `scenario_gap`,
   * `execution_unconfirmed`. Drives the next action; never rendered raw.
   */
  typeKey?: string | null
  /** Present only on `post` candidates. The authored idea itself. */
  post?: {
    id: string
    type: string
    action?: string | null
    status?: string | null
    urgency?: string | null
    rationale?: string | null
    content?: string | null
    created_at?: string | null
    author?: { first_name?: string | null; last_name?: string | null; email?: string | null } | null
    asset?: { id?: string | null; symbol?: string | null; company_name?: string | null; current_price?: number | null } | null
    portfolio?: { name?: string | null } | null
  } | null
}

export type Stance = 'buy' | 'sell' | 'watch'

export interface WorkbenchEvidence {
  id: string
  kind: WorkbenchCandidate['kind']
  headline: string
  why?: string | null
  typeKey?: string | null
  tier: number
}

/** The one thing this idea is asking the reader to do. */
export interface NextAction {
  /** The verb, as the product says it. Never an internal key. */
  label: string
  /**
   * Which existing surface performs it. The workbench routes; it never
   * invents a mutation of its own.
   */
  route: 'target' | 'scenarios' | 'research' | 'thesis' | 'sizing' | 'trade_queue' | 'deliverable' | 'idea'
  /** Why this verb and not another. Asserted in tests, read in review. */
  because: string
}

export interface WorkbenchIdea {
  id: string
  /** `authored` when a person wrote it; `signal` when the desk owns the name only. */
  origin: 'authored' | 'signal'
  symbol: string | null
  /** Needed to route: the product opens assets by id, not by ticker. */
  assetId: string | null
  companyName: string | null
  stance: Stance
  /** The author's own words, where there are any. */
  thesis: string | null
  author: string | null
  status: string | null
  portfolioName: string | null
  createdAt: string | null
  currentPrice: number | null
  /** Best (lowest) tier across the idea and everything explaining it. */
  tier: number
  /** Sorted strongest-first. May be empty for a quiet idea. */
  evidence: WorkbenchEvidence[]
  /** The single line that says why this is near the top today. */
  whyNow: string | null
  next: NextAction | null
}

const nameOf = (a: WorkbenchCandidate['post'] extends infer _ ? any : never): string | null => {
  if (!a) return null
  const parts = [a.first_name, a.last_name].filter(Boolean).map(String)
  if (parts.length) return parts.join(' ')
  const email = typeof a.email === 'string' ? a.email.split('@')[0] : ''
  return email || null
}

/**
 * Buy, sell, or watching.
 *
 * Read from `action`, the one column that states direction, and never inferred
 * from prose. An idea with no stated direction is `watch` — which is honest:
 * the desk is looking at the name without having committed to a side.
 */
export function stanceOf(post: WorkbenchCandidate['post']): Stance {
  const raw = String(post?.action ?? '').toLowerCase().trim()
  if (raw === 'buy' || raw === 'add' || raw === 'long') return 'buy'
  if (raw === 'sell' || raw === 'trim' || raw === 'short' || raw === 'exit') return 'sell'
  return 'watch'
}

/**
 * The verb each kind of finding actually resolves to.
 *
 * ── Why this is a map and not a default ───────────────────────────────────
 *
 * "Open" on every row is the failure the brief names: a generic button where a
 * specific one already exists teaches the reader that the workbench does not
 * know what it is looking at. Each entry here points at a surface the product
 * already has, so the button can perform real work rather than gesture at it.
 *
 * A finding whose type is not in this map contributes no action, and the idea
 * falls back to opening itself. Deliberately not a default verb: a wrong verb
 * is worse than an honest one.
 */
const ACTION_FOR: Record<string, { label: string; route: NextAction['route'] }> = {
  target_hit: { label: 'Review target', route: 'target' },
  target_expired: { label: 'Review target', route: 'target' },
  no_target: { label: 'Set a target', route: 'target' },
  scenario_gap: { label: 'Review scenarios', route: 'scenarios' },
  case_break: { label: 'Review scenarios', route: 'scenarios' },
  above_bull: { label: 'Review scenarios', route: 'scenarios' },
  below_bear: { label: 'Review scenarios', route: 'scenarios' },
  research_stale: { label: 'Review research', route: 'research' },
  unreviewed_change: { label: 'Review research', route: 'research' },
  no_thesis: { label: 'Write the thesis', route: 'thesis' },
  conviction_oversized: { label: 'Review sizing', route: 'sizing' },
  conviction_undersized: { label: 'Review sizing', route: 'sizing' },
  crowding: { label: 'Review sizing', route: 'sizing' },
  execution_unconfirmed: { label: 'Confirm execution', route: 'trade_queue' },
  project_overdue: { label: 'Open deliverable', route: 'deliverable' },
}

/**
 * What to do next, from the strongest piece of evidence that names an action.
 *
 * Walks evidence in ranked order rather than taking the first entry: the
 * top-scoring finding may be one this product has no specific verb for, and
 * the reader is better served by the second finding's real action than by a
 * generic one attached to the first.
 */
export function nextActionFor(idea: WorkbenchIdea): NextAction | null {
  for (const e of idea.evidence) {
    const hit = e.typeKey ? ACTION_FOR[e.typeKey] : undefined
    if (hit) return { ...hit, because: e.headline }
  }
  /**
   * No finding with a verb. An open proposal still has one thing to do — be
   * answered — and a quiet idea has none, which is the correct answer for an
   * idea that is simply on the list.
   */
  if (idea.origin === 'authored' && (idea.status === 'idea' || idea.status === 'proposed')) {
    return { label: 'Open idea', route: 'idea', because: 'An open proposal waiting on an answer' }
  }
  return null
}

const keyOf = (c: WorkbenchCandidate): string =>
  c.symbol ? c.symbol.toUpperCase() : `__${c.kind}:${c.id}`

/**
 * Fold ranked candidates into ideas.
 *
 * Input order is the ranked order and is preserved: the first idea to appear
 * is the one whose strongest candidate ranked highest. That is what keeps
 * "intelligently prioritised" true without a second sort.
 */
export function buildWorkbench(
  candidates: readonly WorkbenchCandidate[],
  _now: number = Date.now(),
): WorkbenchIdea[] {
  const byKey = new Map<string, WorkbenchIdea>()
  const order: string[] = []

  for (const c of candidates) {
    const key = keyOf(c)
    let idea = byKey.get(key)

    if (!idea) {
      idea = {
        id: c.kind === 'post' ? c.id : `name:${key}`,
        origin: c.kind === 'post' ? 'authored' : 'signal',
        symbol: c.symbol,
        assetId: c.post?.asset?.id ?? null,
        companyName: c.post?.asset?.company_name ?? null,
        stance: c.kind === 'post' ? stanceOf(c.post) : 'watch',
        thesis: c.kind === 'post' ? (c.post?.rationale || c.post?.content || null) : null,
        author: c.kind === 'post' ? nameOf(c.post?.author) : null,
        status: c.post?.status ?? null,
        portfolioName: c.post?.portfolio?.name ?? null,
        createdAt: c.post?.created_at ?? null,
        currentPrice: c.post?.asset?.current_price ?? null,
        tier: c.tier,
        evidence: [],
        whyNow: null,
        next: null,
      }
      byKey.set(key, idea)
      order.push(key)
    } else if (c.kind === 'post' && idea.origin === 'signal') {
      /**
       * A later authored idea claims a name that evidence reached first.
       *
       * The findings arrived higher in the ranking, but they were always about
       * this idea — so the idea takes over the row and keeps everything already
       * attached to it, rather than appearing twice.
       */
      idea.origin = 'authored'
      idea.id = c.id
      idea.stance = stanceOf(c.post)
      idea.thesis = c.post?.rationale || c.post?.content || null
      idea.author = nameOf(c.post?.author)
      idea.status = c.post?.status ?? null
      idea.portfolioName = c.post?.portfolio?.name ?? null
      idea.createdAt = c.post?.created_at ?? null
      idea.companyName = c.post?.asset?.company_name ?? idea.companyName
      idea.assetId = c.post?.asset?.id ?? idea.assetId
      idea.currentPrice = c.post?.asset?.current_price ?? idea.currentPrice
    }

    // The best tier any of its parts earned — an idea is as urgent as the most
    // urgent true thing about it.
    if (c.tier < idea.tier) idea.tier = c.tier

    /**
     * A post does not explain itself.
     *
     * Its own headline is its content, which the row already shows as the
     * thesis. Only the OTHER kinds become evidence, which is the whole point
     * of the inversion.
     */
    if (c.kind !== 'post') {
      idea.evidence.push({
        id: c.id, kind: c.kind, headline: c.headline,
        why: c.why ?? null, typeKey: c.typeKey ?? null, tier: c.tier,
      })
    }
  }

  const out = order.map(k => byKey.get(k)!)
  for (const idea of out) {
    // Strongest evidence first, ties keeping arrival (ranked) order.
    idea.evidence.sort((a, b) => a.tier - b.tier)
    idea.whyNow = idea.evidence[0]?.why || idea.evidence[0]?.headline || null
    idea.next = nextActionFor(idea)
  }
  return out
}

/** How many ideas are carrying at least one finding. The queue's one count. */
export function needsAttentionCount(ideas: readonly WorkbenchIdea[]): number {
  return ideas.filter(i => i.evidence.length > 0).length
}

export type WorkbenchFilter = 'all' | 'attention' | 'authored' | 'watching'

/**
 * The queue's segments.
 *
 * Deliberately filters over ONE ranked list rather than sections that carve the
 * page up. Attention is metadata about an idea, not a place ideas live — which
 * is the correction this pass makes to the cockpit's ATTENTION/NEXT split.
 */
export function filterWorkbench(
  ideas: readonly WorkbenchIdea[],
  filter: WorkbenchFilter,
): WorkbenchIdea[] {
  switch (filter) {
    case 'attention': return ideas.filter(i => i.evidence.length > 0)
    case 'authored': return ideas.filter(i => i.origin === 'authored')
    case 'watching': return ideas.filter(i => i.origin === 'signal')
    default: return [...ideas]
  }
}
