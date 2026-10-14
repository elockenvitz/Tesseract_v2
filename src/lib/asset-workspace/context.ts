/**
 * What this workspace is FOR, right now, for this reader.
 *
 * ── Why this exists ──────────────────────────────────────────────────────
 *
 * The Asset page shows the same five tabs in the same order to everyone, for
 * every security, in every situation. An analyst opening an uncovered name
 * they are about to research, and a PM opening a 2.5% position with a buy
 * recommendation sitting unanswered, get an identical page and have to find
 * their own way to the part that matters.
 *
 * This module turns the facts the page has ALREADY fetched into two answers:
 *
 *   1. Which situation this is  (`WorkspaceState`)
 *   2. What, specifically, deserves attention  (`WorkspaceSignal[]`)
 *
 * ── What it deliberately is not ──────────────────────────────────────────
 *
 * Not an engine. There is no layout composer, no rule registry, no ontology
 * and no model. It is a pure function from facts to a small closed set of
 * states, with a fixed list of signals, each of which either holds or does
 * not. Everything is `switch`-able and testable, and a reader could check any
 * claim it makes by hand.
 *
 * Not a source of facts. It reads what the canonical hooks already returned
 * and NEVER queries, derives a weight, invents a consensus, or decides a
 * permission. If the data to support a claim is absent the claim is absent —
 * there is no "probably" tier.
 *
 * Not a replacement for navigation. It proposes a landing destination; the
 * reader's explicit choice always wins, and `arrivalIntent` — where they came
 * from — outranks everything this module infers.
 *
 * ── Why signals carry their own provenance ───────────────────────────────
 *
 * Every signal names the records it was derived from. A surface that tells a
 * PM "your rating disagrees with an open recommendation" has to be able to
 * show which rating and which recommendation, or it is just a feeling with a
 * chip around it. `evidence` is what the UI links to.
 */

/** The five destinations the Asset page already has. */
export type WorkspaceDestination = 'snapshot' | 'research' | 'workflow' | 'decisions' | 'lists'

/**
 * The situation, as a closed set.
 *
 * Ordered by precedence in `resolveWorkspaceState`: the first that matches
 * wins, so the list reads as "the most urgent true thing about this name".
 */
export type WorkspaceState =
  /** A decision is waiting on somebody. The most time-sensitive state. */
  | 'decision-pending'
  /** Held, with a written case, nothing outstanding. The steady state. */
  | 'position-monitored'
  /** Held, and nobody has written why. Exposure without a thesis. */
  | 'position-unexplained'
  /** Work in progress: covered, case started, not yet a recommendation. */
  | 'research-active'
  /** Covered, nothing written yet. The blank page. */
  | 'research-unstarted'
  /** Nobody covers it and nobody owns it. */
  | 'unowned'

export type SignalKind =
  | 'pending'         // a human is blocked, waiting on another human
  | 'contradiction'   // two canonical records disagree
  | 'staleness'       // the record exists but has aged past a threshold
  | 'gap'             // something expected is absent
  | 'provenance'      // a claim is weaker than it looks

export interface WorkspaceSignal {
  id: string
  kind: SignalKind
  /** One line, stated as a fact. No advice, no imperative. */
  headline: string
  /** Where the reader goes to act on or verify it. */
  destination: WorkspaceDestination
  /**
   * The records this was derived from, so the UI can link and attribute.
   * A signal with no evidence is a bug, not a soft claim.
   */
  evidence: { label: string; table: string; id?: string }[]
  /** Higher sorts first. Only used to order; never rendered. */
  weight: number
}

/* ─────────────────────────────────────────────────────────── inputs ─── */

/**
 * Facts, all of which the Asset page already has in scope.
 *
 * Everything is optional-shaped and null-tolerant on purpose: this runs
 * during loading, and a half-arrived page must produce a smaller answer
 * rather than a wrong one.
 */
export interface WorkspaceFacts {
  symbol: string | null
  /** Books the reader can see that hold it. Org-scoped upstream. */
  positions: { portfolioId: string; portfolioName: string; weightPct: number | null }[]
  /** Covering analysts, from `coverage`. */
  coveringUserIds: string[]
  /** When the core case was last written, if ever. */
  caseWrittenAt: string | null
  /** Core sections carrying prose, for the gap signals. */
  writtenSections: { section: string; updatedAt: string | null }[]
  /** Dominant rating and the n behind it, from `useAnalystRatings`. */
  rating: { value: string; count: number; total: number } | null
  target: number | null
  spot: number | null
  /** Research items dated after the case was last written. */
  newEvidenceCount: number
  /** Decision requests with no `decidedAt`. */
  openDecisions: { id: string; action: string | null; portfolioId: string | null; portfolioName: string | null }[]
  /** Live ideas not yet recommended. */
  liveIdeaCount: number
  /** Executions whose proof grade is not an observed fill. */
  unobservedExecutionCount: number
  /** Total executions on record, so the above can be stated as a ratio. */
  executionCount: number
  /** The reader, for "your" framing. Never used for permissions. */
  viewerId: string | null
  /** Where the reader came from, if the sender said. */
  arrivalIntent: { origin: string | null; focus: string | null; portfolioId: string | null } | null
}

/* ──────────────────────────────────────────────────────────── state ─── */

const DAY = 86_400_000

/** A case older than this is called stale. One quarter plus a reporting lag. */
export const STALE_CASE_DAYS = 120

export function daysSince(iso: string | null | undefined, now = Date.now()): number | null {
  if (!iso) return null
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return null
  return Math.floor((now - t) / DAY)
}

/**
 * The situation, by precedence.
 *
 * Written as an ordered sequence of guards rather than a scoring function:
 * a score would make "why am I seeing this" unanswerable, and every one of
 * these has to be explainable to a PM in one sentence.
 */
export function resolveWorkspaceState(f: WorkspaceFacts): WorkspaceState {
  const held = f.positions.length > 0
  const covered = f.coveringUserIds.length > 0
  const written = Boolean(f.caseWrittenAt)

  // Somebody is waiting on a human. Nothing outranks that.
  if (f.openDecisions.length > 0) return 'decision-pending'

  if (held) return written ? 'position-monitored' : 'position-unexplained'

  if (covered || written || f.liveIdeaCount > 0) {
    return written ? 'research-active' : 'research-unstarted'
  }

  return 'unowned'
}

/**
 * Where the page should open.
 *
 * `arrivalIntent` wins when the sender named a destination, because the
 * reader's last action is better evidence of what they want than anything
 * inferred from the record. This is the whole of the "arriving from a
 * decision request lands in the decision" behaviour — no engine required.
 */
/*
 * Note what is NOT a parameter: the state.
 *
 * It was one, and TypeScript pointed out that nothing read it. That is the
 * correct design rather than an oversight — every state lands on the
 * Snapshot, because each is a different emphasis WITHIN that page. Taking a
 * state and ignoring it would have implied a dependency that does not exist,
 * so the signature now says what the function actually does.
 */
export function resolveLanding(
  arrival: WorkspaceFacts['arrivalIntent'],
): WorkspaceDestination {
  const fromOrigin: Record<string, WorkspaceDestination> = {
    decisions: 'decisions',
    ideas: 'decisions',
    research: 'research',
    portfolio: 'snapshot',
    today: 'snapshot',
  }
  if (arrival?.focus && isDestination(arrival.focus)) return arrival.focus
  if (arrival?.origin && fromOrigin[arrival.origin]) return fromOrigin[arrival.origin]

  // Otherwise the Snapshot, always. It is the surface that answers "what is
  // the state of this name", and every state above is a different EMPHASIS
  // within it rather than a different page. Sending an analyst straight to
  // Research on an unstarted name would skip the context they need to decide
  // whether to start at all.
  return 'snapshot'
}

function isDestination(v: string): v is WorkspaceDestination {
  return ['snapshot', 'research', 'workflow', 'decisions', 'lists'].includes(v)
}

/* ────────────────────────────────────────────────────────── signals ─── */

/** Rating words that read as "reduce or avoid". Unknown words match neither. */
const NEGATIVE = /sell|underweight|underperform|reduce|avoid|short/i
const POSITIVE = /buy|overweight|outperform|accumulate|add|long/i
/** Recommendation actions that increase exposure. */
const INCREASING = /buy|add|initiate|increase|accumulate/i
const DECREASING = /sell|trim|reduce|exit|close/i

/**
 * What deserves attention, as facts rather than advice.
 *
 * Each signal fires only when the records it names actually exist. There is
 * no "possible" or "likely" — a relationship either holds in the data or is
 * not mentioned.
 */
export function resolveWorkspaceSignals(f: WorkspaceFacts, now = Date.now()): WorkspaceSignal[] {
  const out: WorkspaceSignal[] = []
  const held = f.positions.length > 0

  /*
   * The waiting decision itself — the highest-weight signal there is.
   *
   * This was missing from the first build, which produced a band announcing
   * the state "A decision is waiting" above a list that never said WHICH
   * decision, or in which book. A situation label with no corresponding fact
   * is the surface asserting something it then declines to evidence.
   */
  for (const d of f.openDecisions) {
    const what = d.action ? d.action.toLowerCase() : 'request'
    // "A add" was on screen. The actions are a known, small vocabulary, so a
    // vowel test is sufficient and cannot be wrong in a way that matters.
    const article = /^[aeiou]/.test(what) ? 'An' : 'A'
    out.push({
      id: `pending-${d.id}`,
      kind: 'pending',
      headline: d.portfolioName
        ? `${article} ${what} in ${d.portfolioName} is waiting on a decision`
        : `${article} ${what} is waiting on a decision`,
      destination: 'decisions',
      evidence: [{ label: `Request: ${d.action ?? 'decision'}`, table: 'decision_requests', id: d.id }],
      weight: 110,
    })
  }

  /*
   * A rating that disagrees with an open recommendation.
   *
   * The example in the brief: an underweight research rating alongside a
   * pending buy. Stated as the disagreement it is, with both records named —
   * never as a judgement about which is right.
   */
  if (f.rating && f.openDecisions.length > 0) {
    const ratingTone = NEGATIVE.test(f.rating.value) ? 'negative'
      : POSITIVE.test(f.rating.value) ? 'positive' : null
    for (const d of f.openDecisions) {
      const action = d.action ?? ''
      const actionTone = INCREASING.test(action) ? 'positive'
        : DECREASING.test(action) ? 'negative' : null
      if (ratingTone && actionTone && ratingTone !== actionTone) {
        out.push({
          id: `contradiction-rating-${d.id}`,
          kind: 'contradiction',
          headline: `Rated ${f.rating.value} by ${f.rating.count} of ${f.rating.total}, with a pending ${action.toLowerCase()} in ${d.portfolioName ?? 'a book'}`,
          destination: 'decisions',
          evidence: [
            { label: `Rating: ${f.rating.value}`, table: 'asset_ratings' },
            { label: `Open request: ${action}`, table: 'decision_requests', id: d.id },
          ],
          weight: 100,
        })
      }
    }
  }

  /* Exposure with nothing written behind it. */
  if (held && !f.caseWrittenAt) {
    const books = f.positions.length
    out.push({
      id: 'gap-held-uncased',
      kind: 'gap',
      headline: `Held in ${books} book${books === 1 ? '' : 's'} with no investment case on record`,
      destination: 'research',
      evidence: f.positions.slice(0, 3).map(p => ({
        label: p.portfolioName, table: 'portfolio_holdings', id: p.portfolioId,
      })),
      weight: 90,
    })
  }

  /* Research has moved since the case was last written. */
  if (f.caseWrittenAt && f.newEvidenceCount > 0) {
    out.push({
      id: 'staleness-new-evidence',
      kind: 'staleness',
      headline: `${f.newEvidenceCount} research item${f.newEvidenceCount === 1 ? '' : 's'} dated after the case was last written`,
      destination: 'research',
      evidence: [{ label: 'Investment case', table: 'asset_contributions' }],
      weight: 70,
    })
  }

  /* The case has simply aged. */
  const age = daysSince(f.caseWrittenAt, now)
  if (age != null && age >= STALE_CASE_DAYS) {
    out.push({
      id: 'staleness-case-age',
      kind: 'staleness',
      headline: `The case was last written ${Math.floor(age / 30)} months ago`,
      destination: 'research',
      evidence: [{ label: 'Investment case', table: 'asset_contributions' }],
      weight: 60,
    })
  }

  /*
   * Spot has left the valuation framework.
   *
   * Only when a target exists AND a spot exists. "Past the target" is a fact
   * about two numbers; what to do about it is not this module's business.
   */
  if (f.target != null && f.spot != null && f.spot > 0 && f.spot >= f.target) {
    out.push({
      id: 'contradiction-spot-past-target',
      kind: 'contradiction',
      headline: `Trading at or above the target (${f.spot.toFixed(2)} vs ${f.target.toFixed(2)})`,
      destination: 'research',
      evidence: [{ label: 'Price target', table: 'price_targets' }],
      weight: 80,
    })
  }

  /*
   * Executions that are not evidenced by an observed fill.
   *
   * A provenance signal, not a contradiction: the trades may well have
   * happened. What is weaker than it looks is the EVIDENCE, and that is worth
   * saying on a page whose whole claim is honest decision history.
   */
  if (f.unobservedExecutionCount > 0 && f.executionCount > 0) {
    out.push({
      id: 'provenance-unobserved-executions',
      kind: 'provenance',
      headline: `${f.unobservedExecutionCount} of ${f.executionCount} executions are not evidenced by an observed fill`,
      destination: 'decisions',
      evidence: [{ label: 'Execution history', table: 'portfolio_trade_events' }],
      weight: 50,
    })
  }

  /* Covered by nobody, but somebody is working on it. */
  if (f.coveringUserIds.length === 0 && (f.caseWrittenAt || f.liveIdeaCount > 0)) {
    out.push({
      id: 'gap-no-coverage',
      kind: 'gap',
      headline: 'Work is on record but nobody is assigned coverage',
      destination: 'workflow',
      evidence: [{ label: 'Coverage', table: 'coverage' }],
      weight: 40,
    })
  }

  return out.sort((a, b) => b.weight - a.weight)
}

/* ───────────────────────────────────────────────────────── emphasis ─── */

/**
 * What the Snapshot leads with, per state.
 *
 * The same panels in a different order — not different panels. Reordering is
 * reversible, explainable and cannot hide anything; conditional panels would
 * mean a reader cannot find a thing because of a rule they cannot see.
 */
export const STATE_EMPHASIS: Record<WorkspaceState, {
  /** One line naming the situation, shown to the reader. */
  label: string
  /** Panel order, most relevant first. */
  order: ('conclusion' | 'decision' | 'case' | 'position' | 'work' | 'memory')[]
}> = {
  'decision-pending': {
    label: 'A decision is waiting',
    order: ['conclusion', 'decision', 'position', 'case', 'memory', 'work'],
  },
  'position-monitored': {
    label: 'Held, with a written case',
    order: ['conclusion', 'case', 'position', 'memory', 'work', 'decision'],
  },
  'position-unexplained': {
    label: 'Held, with no case on record',
    order: ['conclusion', 'position', 'case', 'work', 'memory', 'decision'],
  },
  'research-active': {
    label: 'Research in progress',
    order: ['conclusion', 'case', 'work', 'memory', 'position', 'decision'],
  },
  'research-unstarted': {
    label: 'Covered, nothing written yet',
    order: ['conclusion', 'case', 'work', 'position', 'memory', 'decision'],
  },
  unowned: {
    label: 'Not held, not covered',
    order: ['conclusion', 'case', 'work', 'position', 'memory', 'decision'],
  },
}
