/**
 * "What did I park, and is it back yet?"
 *
 * One query answers it, for every obligation kind. The next slice's feed
 * consumes this; nothing here renders anything.
 *
 * ── Why one primitive ────────────────────────────────────────────────────
 *
 * There are already two ways to ask about obligations in this codebase: the
 * Trade Book sync reads open `trade_review` rows keyed by subject, and
 * `tradeReviewOwed` evaluates the rule from scratch. Adding a third shape
 * per kind is how "due" comes to mean something slightly different on each
 * surface. This is the shared one, filtered by org, kind, owner and due
 * state, resolving back to the canonical work object.
 *
 * ── RLS posture ──────────────────────────────────────────────────────────
 *
 * Unchanged, and relied upon. `memory_obligations` grants `authenticated`
 * SELECT only, under `is_member_of_org(organization_id)`. The explicit
 * `.eq('organization_id', …)` below is a narrowing convenience, not the
 * isolation boundary — the policy is. The resolver's joins run under the
 * caller's RLS too, so an obligation whose subject the caller cannot read
 * resolves to a null subject rather than leaking one.
 */
import { supabase } from '../supabase'
import {
  OBLIGATION_KINDS,
  dueState,
  elapsedDays,
  type DueState,
  type ObligationKind,
} from './obligations'

export interface ObligationRow {
  id: string
  organization_id: string
  kind: ObligationKind
  subject_type: string
  subject_id: string
  owner_id: string | null
  raised_at: string
  due_at: string | null
  source_type: string | null
  source_id: string | null
  provenance: string
  /**
   * What the person said they were waiting for, in their own words.
   *
   * Comes down with the obligation that is already being fetched — no
   * second query, which is why the candidate can show it without touching
   * the request budget.
   */
  waiting_for: string | null
}

const OBLIGATION_SELECT =
  'id, organization_id, kind, subject_type, subject_id, owner_id, ' +
  'raised_at, due_at, source_type, source_id, provenance, waiting_for'

export interface DueObligationQuery {
  organizationId: string
  /** Omit for every kind. */
  kinds?: ObligationKind[]
  /** Omit for the whole org. Null matches obligations with no owner. */
  ownerId?: string | null
  /** Omit for 'idea' | 'decision' | 'trade' | … all of them. */
  subjectType?: string
  /**
   * Which due states to include. Defaults to ['due'] — the question the
   * feed asks. Pass ['due','scheduled'] for a "what have I parked" view.
   */
  dueStates?: DueState[]
  /** Defaults to now. Injectable so tests do not depend on the wall clock. */
  now?: Date
  limit?: number
}

/**
 * Open obligations in the requested due states, newest due first.
 *
 * Only uncleared rows. The due filter is applied in SQL where it can be —
 * `due_at <= now` uses `memory_obligations_open_ix` — and refined in memory
 * for `open_ended`, which is a NULL and so cannot share the same comparison.
 */
export async function fetchObligations(q: DueObligationQuery): Promise<ObligationRow[]> {
  const now = q.now ?? new Date()
  const states = q.dueStates ?? ['due']

  let query = supabase
    .from('memory_obligations')
    .select(OBLIGATION_SELECT)
    .eq('organization_id', q.organizationId)
    .is('cleared_at', null)

  if (q.kinds?.length) query = query.in('kind', q.kinds)
  if (q.subjectType) query = query.eq('subject_type', q.subjectType)
  if (q.ownerId !== undefined) {
    query = q.ownerId === null ? query.is('owner_id', null) : query.eq('owner_id', q.ownerId)
  }

  // Narrow in SQL only when the request cannot include a NULL due_at —
  // `.lte` on a nullable column silently drops NULLs, which is correct for
  // 'due' alone and wrong the moment 'open_ended' is asked for.
  if (states.length === 1 && states[0] === 'due') {
    query = query.lte('due_at', now.toISOString())
  } else if (states.length === 1 && states[0] === 'scheduled') {
    query = query.gt('due_at', now.toISOString())
  }

  query = query.order('due_at', { ascending: true, nullsFirst: false }).order('id', { ascending: true })
  if (q.limit) query = query.limit(q.limit)

  const { data, error } = await query
  if (error) throw new Error(`Failed to read obligations: ${error.message}`)

  const rows = (data ?? []) as unknown as ObligationRow[]
  const wanted = new Set(states)
  return rows.filter(r => wanted.has(dueState(r.due_at, now)))
}

/* ── Display enrichment ────────────────────────────────────────────────── */

/**
 * The symbol and portfolio behind a batch of obligations, for display.
 *
 * ONE query per subject type for the whole batch, never one per obligation.
 * Twenty-four due obligations must not become twenty-four requests — the
 * defect `TileClosesBatch` exists to prevent, and the reason this takes an
 * array rather than being a per-row hook.
 *
 * Returns a Map keyed by the obligation's `subject_id`. A subject the caller
 * cannot read is simply absent, so an unreadable row degrades to a candidate
 * with no symbol rather than leaking one.
 */
export interface SubjectDisplay {
  symbol: string | null
  companyName: string | null
  assetId: string | null
  portfolioId: string | null
  portfolioName: string | null
}

export async function fetchTradeSubjectDisplay(
  tradeIds: string[],
): Promise<Map<string, SubjectDisplay>> {
  const out = new Map<string, SubjectDisplay>()
  if (tradeIds.length === 0) return out

  const { data, error } = await supabase
    .from('accepted_trades')
    .select('id, asset_id, portfolio_id, asset:asset_id (id, symbol, company_name), portfolio:portfolio_id (id, name)')
    .in('id', tradeIds)

  if (error) return out
  for (const row of (data ?? []) as any[]) {
    out.set(row.id, {
      symbol: row.asset?.symbol ?? null,
      companyName: row.asset?.company_name ?? null,
      assetId: row.asset_id ?? null,
      portfolioId: row.portfolio_id ?? null,
      portfolioName: row.portfolio?.name ?? null,
    })
  }
  return out
}

/* ── Candidate resolution ──────────────────────────────────────────────── */

/**
 * A due obligation resolved back to the work it is about.
 *
 * Everything needed to say "You asked to revisit NVDA today" without a model
 * and without a guess: the symbol, when it was parked, when it came due, how
 * long it has been, and the id to navigate to.
 */
export interface RevisitCandidate {
  obligationId: string
  kind: ObligationKind
  /** The canonical row this is about. */
  subjectType: string
  subjectId: string
  /**
   * The idea behind it.
   *
   * Equal to `subjectId` for an idea obligation. For a DEFERRED
   * RECOMMENDATION it is the idea behind the decision request, which is
   * what the change-fact engine compares against — passing the request id
   * there would silently return no facts for every deferred candidate.
   */
  ideaId: string | null
  ownerId: string | null
  /** When the user parked it. */
  parkedAt: string
  /** When they asked for it back. */
  dueAt: string | null
  /**
   * What they said they were waiting for. Null when they said nothing.
   *
   * A record of INTENT, never of a condition the product evaluated. No
   * reader may treat a passed due date as evidence that the named thing
   * occurred — see `describeCandidate` and the card builder.
   */
  waitingFor: string | null
  dueState: DueState
  /** Whole days since it came due. Zero on the day. */
  daysOverdue: number
  /** Days the work sat parked, raised → due. */
  daysParked: number
  symbol: string | null
  companyName: string | null
  assetId: string | null
  portfolioId: string | null
  portfolioName: string | null
  /** Where the user left it. Canonical columns, not derived. */
  stage: string | null
  conviction: string | null
  /** True when resurfacing would be nonsensical: decided, archived, gone. */
  terminal: boolean
  /** In-app route back to the work. */
  href: string
  /** False when the subject could not be read — RLS, or a deleted row. */
  resolved: boolean
}

/**
 * Would bringing this back make sense?
 *
 * An idea that was decided, archived or deleted while parked has nothing to
 * resume. The obligation is still open — only a real action clears it, and
 * nobody performed one — but the candidate must not be voiced.
 */
function isTerminalSubject(idea: IdeaSubject | null): boolean {
  if (!idea) return false
  if (idea.outcome != null) return true
  if (idea.visibility_tier && idea.visibility_tier !== 'active') return true
  return ['executed', 'rejected', 'cancelled', 'archived', 'deleted'].includes(idea.status ?? '')
}

interface IdeaSubject {
  id: string
  asset_id: string | null
  portfolio_id: string | null
  revisit_at: string | null
  /** Where the user left it, and whether resurfacing still makes sense. */
  stage: string | null
  conviction: string | null
  status: string | null
  outcome: string | null
  visibility_tier: string | null
  assets: { id: string; symbol: string; company_name: string | null } | null
  portfolios: { id: string; name: string | null } | null
}

const IDEA_SUBJECT_SELECT =
  'id, asset_id, portfolio_id, revisit_at, stage, conviction, status, outcome, visibility_tier, ' +
  'assets:asset_id (id, symbol, company_name), portfolios:portfolio_id (id, name)'

/**
 * Resolve due obligations to candidates.
 *
 * Read-only and deterministic. No model, no scoring, no ranking beyond the
 * due order the query already applied — this is the evidence a feed tile
 * would be built from, not the tile.
 *
 * Subjects are fetched in one batch per type rather than per row; a feed
 * asking for forty candidates must not issue forty queries.
 */
export async function resolveRevisitCandidates(
  obligations: ObligationRow[],
  now: Date = new Date(),
): Promise<RevisitCandidate[]> {
  const ideaIds = obligations.filter(o => o.subject_type === 'idea').map(o => o.subject_id)
  const decisionIds = obligations.filter(o => o.subject_type === 'decision').map(o => o.subject_id)

  const ideas = new Map<string, IdeaSubject>()
  if (ideaIds.length) {
    const { data } = await supabase
      .from('trade_queue_items')
      .select(IDEA_SUBJECT_SELECT)
      .in('id', ideaIds)
    for (const row of (data ?? []) as unknown as IdeaSubject[]) ideas.set(row.id, row)
  }

  // A deferred recommendation's identity lives on the idea behind it, so the
  // decision resolves through its own trade_queue_item embed.
  const decisions = new Map<string, { id: string; trade_queue_item_id: string | null; portfolio_id: string | null; idea: IdeaSubject | null }>()
  if (decisionIds.length) {
    const { data } = await supabase
      .from('decision_requests')
      .select(`id, trade_queue_item_id, portfolio_id, idea:trade_queue_item_id (${IDEA_SUBJECT_SELECT})`)
      .in('id', decisionIds)
    for (const row of (data ?? []) as any[]) {
      decisions.set(row.id, { ...row, idea: row.idea ?? null })
    }
  }

  return obligations.map((o): RevisitCandidate => {
    const idea =
      o.subject_type === 'idea'
        ? ideas.get(o.subject_id) ?? null
        : decisions.get(o.subject_id)?.idea ?? null

    const state = dueState(o.due_at, now)
    return {
      obligationId: o.id,
      kind: o.kind,
      subjectType: o.subject_type,
      subjectId: o.subject_id,
      ideaId: idea?.id ?? null,
      ownerId: o.owner_id,
      parkedAt: o.raised_at,
      dueAt: o.due_at,
      waitingFor: o.waiting_for ?? null,
      dueState: state,
      daysOverdue: o.due_at && state === 'due' ? elapsedDays(o.due_at, now) : 0,
      daysParked: o.due_at ? Math.max(0, elapsedDays(o.raised_at, new Date(o.due_at))) : elapsedDays(o.raised_at, now),
      symbol: idea?.assets?.symbol ?? null,
      companyName: idea?.assets?.company_name ?? null,
      assetId: idea?.asset_id ?? null,
      portfolioId: idea?.portfolio_id ?? decisions.get(o.subject_id)?.portfolio_id ?? null,
      portfolioName: idea?.portfolios?.name ?? null,
      stage: idea?.stage ?? null,
      conviction: idea?.conviction ?? null,
      terminal: isTerminalSubject(idea),
      href: candidateHref(o, idea),
      // The subject row came back. False means RLS hid it or it is gone —
      // either way the candidate must not be voiced as though we know what
      // it is about.
      resolved: !!idea,
    }
  })
}

/**
 * Where "resume work" goes.
 *
 * Plain routes, deliberately. An earlier version of this returned
 * `/trade-queue?idea=<id>` and `?inbox=1` — neither parameter is read by
 * `TradeQueuePage`, so both were links that silently did nothing while
 * looking like deep links. That is the same class of defect as inventing a
 * fact: a claim the product cannot honour.
 *
 * The page itself is the right destination in the meantime, and it is now a
 * useful one: the idea is no longer suppressed there, because its revisit
 * date has passed. Deep-linking to a specific idea needs
 * `TradeQueuePage` to read a parameter first, and that is a separate change.
 */
function candidateHref(_o: ObligationRow, _idea: IdeaSubject | null): string {
  return '/trade-queue'
}

/**
 * The sentence, built from facts alone.
 *
 * Exported so the next slice's tile and this slice's tests agree on what is
 * claimable. Every component is a column value or a subtraction of two
 * timestamps. Nothing here needs a model, and nothing here asserts WHY the
 * work was parked — we recorded that it was, not the reasoning behind it.
 */
export function describeCandidate(c: RevisitCandidate): string | null {
  if (!c.resolved || !c.symbol) return null
  const subject = c.kind === OBLIGATION_KINDS.decisionRevisit ? 'the recommendation on' : ''
  const head = `You asked to revisit ${subject ? subject + ' ' : ''}${c.symbol}`
  if (c.dueState !== 'due') return null
  if (c.daysOverdue <= 0) return `${head} today.`
  if (c.daysOverdue === 1) return `${head} yesterday.`
  return `${head} ${c.daysOverdue} days ago.`
}
