/**
 * Suggested questions, derived from the reader's actual work.
 *
 * ── What was wrong with the old ones ─────────────────────────────────────
 *
 * They were written from the conversation's tags and nothing else, so on an
 * asset they were four rephrasings of "tell me about this company" and
 * everywhere else they were the generic market set. Correct, and useless:
 * nothing in them could only be true today, so there was never a reason to
 * press one rather than type.
 *
 * ── The rule this module follows ─────────────────────────────────────────
 *
 * A candidate exists ONLY because a record exists. Every suggestion carries
 * the record count and the words that justify it, and both come from data the
 * caller was allowed to read. Nothing here invents activity, infers urgency
 * from a vibe, or mentions a market event: "3 recommendations have been
 * waiting 9 days" is a fact with a row behind it, and that is the only kind of
 * claim this file is permitted to make.
 *
 * Overdue means a stored date has passed. Stalled means a stored timestamp is
 * old. If the data cannot support the adjective, the adjective is not used.
 *
 * ── Why it is pure, and totally ordered ──────────────────────────────────
 *
 * Pure because the previous prompt code lived in a module that builds a
 * Supabase client at import, so nothing could test it, and the defect that
 * shipped was a prompt offering to analyse a company called "asset".
 *
 * Totally ordered because the UI renders these in sequence, and a comparator
 * with ties lets two equal candidates swap places between renders. A reader
 * reaching for the third button gets a different question than the one they
 * read. So ties break on `key`, which is derived from content and stable
 * across renders and reloads.
 */

/** Where a candidate came from. One per genuine source of work. */
export type PromptSourceKind =
  | 'pending_decision'
  | 'ready_to_recommend'
  | 'stalled_idea'
  | 'overdue_requirement'
  | 'open_requirement'
  | 'flagged_list_item'
  | 'coverage'
  | 'recent_decision'
  | 'active_asset'
  | 'generic'

export interface GroundedPrompt {
  /** Stable identity, content-derived. The ordering tie-break and the React key. */
  key: string
  /** The question, as it appears on the button. */
  text: string
  /**
   * Why this is being offered, shown under the question.
   *
   * A statement about records, never a sales pitch: "4 waiting, longest 9
   * days" and not "needs your attention". Null only for the generic
   * fallbacks, which have no record behind them and must not pretend to.
   */
  reason: string | null
  kind: PromptSourceKind
  /** Higher sorts first. Derived, never hand-tuned per candidate. */
  weight: number
}

/* ── Input ───────────────────────────────────────────────────────────────
 *
 * Counts and a few exemplars, already fetched and already permission-scoped.
 * This module never queries: it is given what the reader may see, which is
 * what keeps "none visible to you" out of the suggestion layer entirely. A
 * suggestion is offered only when a record was returned, so an RLS-filtered
 * zero simply produces no candidate rather than a wrong one.
 */

export interface PendingDecisionFacts {
  count: number
  /** Days the longest-waiting request has been open. Null when unknown. */
  longestWaitingDays: number | null
  /** Of those, how many the reader is the named reviewer for. */
  yoursToAnswer: number
}

export interface PipelineFacts {
  /** Live ideas at the final maturity stage: understood, not yet submitted. */
  readyToRecommend: number
  /** A live idea that has not moved in a long time. */
  stalled: { symbol: string | null; daysInStage: number } | null
  liveTotal: number
}

export interface WorkFacts {
  overdueRequirements: number
  openRequirements: number
  /** The asset carrying the most open requirements, for a specific question. */
  busiestSymbol: string | null
}

export interface ListFacts {
  flaggedCount: number
  /** The list holding the most flagged entries. */
  flaggedListName: string | null
}

export interface CoverageFacts {
  /** Assets the reader covers. */
  assetCount: number
}

export interface RecentDecisionFacts {
  /** Rulings made in the recent window the caller defined. */
  count: number
  windowDays: number
}

export interface SubjectFacts {
  /** The asset, portfolio or theme the reader is looking at. */
  label: string | null
  kind: 'asset' | 'portfolio' | 'theme' | 'other' | null
}

export interface CandidateInput {
  subject?: SubjectFacts | null
  pendingDecisions?: PendingDecisionFacts | null
  pipeline?: PipelineFacts | null
  work?: WorkFacts | null
  lists?: ListFacts | null
  coverage?: CoverageFacts | null
  recentDecisions?: RecentDecisionFacts | null
  /** How many to return. The pane's layout decides. */
  limit: number
}

/**
 * How old is old.
 *
 * Named constants rather than numbers inline, because each is a product
 * judgement someone may disagree with, and a disagreement about 14 should not
 * require reading a comparator.
 */
export const STALLED_IDEA_DAYS = 14
export const RECENT_DECISION_WINDOW_DAYS = 14

/**
 * A short, stable key from a candidate's content.
 *
 * Not a hash: a readable key makes a failing assertion legible, and there are
 * at most a dozen candidates so collisions are a review question rather than
 * a probability.
 */
function keyFor(kind: PromptSourceKind, detail = ''): string {
  const slug = detail.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
  return slug ? `${kind}:${slug}` : kind
}

/** "1 day" / "3 days", so no sentence says "1 days". */
function days(n: number): string {
  return n === 1 ? '1 day' : `${n} days`
}

/**
 * Every reason is scoped to the reader, and that is not a style choice.
 *
 * These counts come from permission-scoped reads, so the number is what the
 * CALLER can see, not what the organization holds. At the time of writing
 * there are 84 open decision requests in the database and this reader can see
 * a fraction of them -- so a reason reading "84 are waiting" would be wrong
 * and "18 are waiting" would be a visible count presented as a total.
 *
 * The fix is in the wording, not in a wider query: each sentence says whose
 * records it counted. "in your decision inbox" and "visible to you" are
 * claims that stay true under RLS, which is the same rule the retrieval tools
 * follow with their `visibility.scope` declaration.
 *
 * It also removes a subject-verb agreement trap for free: there is no "is" or
 * "are" left to get wrong at one.
 */
const SCOPED_INBOX = 'in your decision inbox'

/**
 * The candidates the data supports, ranked.
 *
 * Weights are bands, not a tuned list: something with a passed deadline
 * outranks something merely open, and anything with a record outranks the
 * generic fallbacks. Within a band the comparator falls through to `key`.
 */
export function candidatePrompts(input: CandidateInput): GroundedPrompt[] {
  const out: GroundedPrompt[] = []
  const seen = new Set<string>()

  const push = (c: GroundedPrompt) => {
    if (seen.has(c.key)) return
    seen.add(c.key)
    out.push(c)
  }

  /* ── Something is waiting on a person ─────────────────────────────────
     The strongest candidate there is: a record whose next step is somebody
     doing something, and which names who. */
  const pd = input.pendingDecisions
  if (pd && pd.count > 0) {
    if (pd.yoursToAnswer > 0) {
      push({
        key: keyFor('pending_decision', 'yours'),
        text: 'What am I being asked to decide, and what does the evidence say?',
        reason: pd.yoursToAnswer === 1
          ? '1 recommendation is awaiting your ruling'
          : `${pd.yoursToAnswer} recommendations are awaiting your ruling`,
        kind: 'pending_decision',
        weight: 100,
      })
    }
    const waited = pd.longestWaitingDays
    push({
      key: keyFor('pending_decision', 'all'),
      text: 'Summarize the recommendations waiting for a decision',
      reason: waited !== null && waited > 0
        ? `${pd.count} ${SCOPED_INBOX}, the longest for ${days(waited)}`
        : `${pd.count} ${SCOPED_INBOX}`,
      kind: 'pending_decision',
      weight: 95,
    })
  }

  /* ── Work with a date that has passed ─────────────────────────────────── */
  const work = input.work
  if (work && work.overdueRequirements > 0) {
    push({
      key: keyFor('overdue_requirement'),
      text: 'What research work is overdue, and what does it block?',
      reason: work.overdueRequirements === 1
        ? '1 of your requirements is past its due date'
        : `${work.overdueRequirements} of your requirements are past their due date`,
      kind: 'overdue_requirement',
      weight: 90,
    })
  }

  /* ── An idea that is finished being understood ────────────────────────
     Ready-to-recommend is the end of the maturity axis, so the next step is
     a submission the reader has not made. Phrased as a readiness question,
     never as "submit this": the tool reports maturity and must not be read
     as a recommendation to act. */
  const pipe = input.pipeline
  if (pipe && pipe.readyToRecommend > 0) {
    push({
      key: keyFor('ready_to_recommend'),
      text: 'Which of my ideas are ready to recommend, and what is the case for each?',
      reason: pipe.readyToRecommend === 1
        ? '1 of your ideas is at ready to recommend'
        : `${pipe.readyToRecommend} of your ideas are at ready to recommend`,
      kind: 'ready_to_recommend',
      weight: 85,
    })
  }

  if (pipe?.stalled && pipe.stalled.daysInStage >= STALLED_IDEA_DAYS) {
    const sym = pipe.stalled.symbol
    push({
      key: keyFor('stalled_idea', sym ?? 'unnamed'),
      /* Without a ticker the question still works, which is the rule the
         earlier prompt bug broke: a name it does not have is never invented
         and never replaced by the word "asset". */
      text: sym
        ? `What is holding up ${sym}, and what would move it forward?`
        : 'Which of my ideas have stopped moving, and what is holding them up?',
      reason: sym
        ? `${sym} has not moved stage in ${days(pipe.stalled.daysInStage)}`
        : `An idea has not moved stage in ${days(pipe.stalled.daysInStage)}`,
      kind: 'stalled_idea',
      weight: 80,
    })
  }

  /* ── Flagged by the reader themselves ─────────────────────────────────── */
  const lists = input.lists
  if (lists && lists.flaggedCount > 0) {
    push({
      key: keyFor('flagged_list_item', lists.flaggedListName ?? ''),
      text: lists.flaggedListName
        ? `What has changed on the names I flagged in ${lists.flaggedListName}?`
        : 'What has changed on the names I flagged?',
      reason: lists.flaggedCount === 1
        ? '1 flagged entry on your lists'
        : `${lists.flaggedCount} flagged entries on your lists`,
      kind: 'flagged_list_item',
      weight: 70,
    })
  }

  /* ── Open work, without a passed date ─────────────────────────────────── */
  if (work && work.openRequirements > 0 && work.overdueRequirements === 0) {
    push({
      key: keyFor('open_requirement', work.busiestSymbol ?? ''),
      text: work.busiestSymbol
        ? `What is left to finish on ${work.busiestSymbol}?`
        : 'What research work is still open across my names?',
      reason: work.openRequirements === 1
        ? '1 of your requirements is still open'
        : `${work.openRequirements} of your requirements are still open`,
      kind: 'open_requirement',
      weight: 60,
    })
  }

  /* ── The shape of the reader's responsibility ─────────────────────────── */
  const cov = input.coverage
  if (cov && cov.assetCount > 0) {
    push({
      key: keyFor('coverage'),
      text: 'What should I be paying attention to across my coverage?',
      reason: cov.assetCount === 1
        ? 'You cover 1 name'
        : `You cover ${cov.assetCount} names`,
      kind: 'coverage',
      weight: 55,
    })
  }

  /* ── What the desk just decided ───────────────────────────────────────── */
  const recent = input.recentDecisions
  if (recent && recent.count > 0) {
    push({
      key: keyFor('recent_decision'),
      text: 'What was decided recently, and how do those decisions stand now?',
      /* "visible to you" for the same reason as the inbox above: this counts
         the rulings the reader may read, not the desk's. */
      reason: recent.count === 1
        ? `1 ruling visible to you in the last ${days(recent.windowDays)}`
        : `${recent.count} rulings visible to you in the last ${days(recent.windowDays)}`,
      kind: 'recent_decision',
      weight: 50,
    })
  }

  /* ── Where the reader is standing ─────────────────────────────────────
     Last among the grounded candidates on purpose. The subject is already on
     screen, so a question about it is the least informative thing the panel
     can offer -- but it is still better than the generic set, and it is the
     only candidate available on a surface with no open work. */
  const subj = input.subject
  if (subj?.label) {
    const l = subj.label
    push({
      key: keyFor('active_asset', l),
      text: subj.kind === 'portfolio'
        ? `What are the biggest risks in ${l} right now?`
        : subj.kind === 'theme'
          ? `Which names give me the most exposure to ${l}?`
          : `What do I need to know about ${l} that I might have missed?`,
      reason: `You are looking at ${l}`,
      kind: 'active_asset',
      weight: 40,
    })
    if (subj.kind === 'asset' || subj.kind === null) {
      push({
        key: keyFor('active_asset', `${l}-thesis`),
        text: `Analyze the ${l} thesis for blind spots`,
        reason: `You are looking at ${l}`,
        kind: 'active_asset',
        weight: 35,
      })
    }
  }

  /* ── Fallbacks ────────────────────────────────────────────────────────
     Reached when nothing above produced a candidate: a new account, a reader
     with no open work, or a failed fetch. They carry NO reason, because there
     is no record behind them and a fabricated justification here is exactly
     the invented urgency this module exists to avoid. */
  for (const [i, text] of FALLBACKS.entries()) {
    push({
      key: keyFor('generic', text),
      text,
      reason: null,
      kind: 'generic',
      weight: 10 - i,
    })
  }

  return out.sort(compareCandidates).slice(0, Math.max(1, input.limit))
}

/**
 * A TOTAL order. Weight, then kind, then key.
 *
 * The last term is what matters: a comparator that can return 0 for two
 * different candidates lets them swap places between renders, and a reader
 * reaching for the third button gets a different question than the one they
 * read. `key` is content-derived, so the order is the same on every render
 * and across a reload.
 */
export function compareCandidates(a: GroundedPrompt, b: GroundedPrompt): number {
  if (a.weight !== b.weight) return b.weight - a.weight
  if (a.kind !== b.kind) return a.kind < b.kind ? -1 : 1
  return a.key < b.key ? -1 : a.key > b.key ? 1 : 0
}

/**
 * The questions offered when the reader has no open work the panel can see.
 *
 * Deliberately about the firm's own records rather than the market: the
 * assistant can answer these from Tesseract, and a market question it has no
 * feed for produces a confident answer about nothing.
 */
export const FALLBACKS: readonly string[] = [
  'What is in my Idea Pipeline?',
  'What needs a decision right now?',
  'What research work is outstanding?',
  'Which names am I covering?',
]

/** The text alone, for callers that have not adopted reasons yet. */
export function candidatePromptTexts(input: CandidateInput): string[] {
  return candidatePrompts(input).map(c => c.text)
}

/**
 * How many questions are worth showing when none of them is grounded.
 *
 * Three, because a single button on an empty surface reads as a bug while a
 * full grid of market questions reads as filler. This is the ONLY count the
 * generic tier is allowed to reach.
 */
export const GENERIC_FLOOR = 3

/**
 * The panel's final list: grounded questions first, context questions to fill.
 *
 * Two sources exist and both are worth keeping. This module's candidates are
 * grounded in records and are the reason to press a button at all. The
 * tag-derived ones from `suggested-prompts` are about whatever the
 * conversation is bound to, and on a surface with no open work they are the
 * only specific thing available.
 *
 * The order is the argument: a question with a record behind it outranks a
 * question about the thing already on screen, which outranks a question about
 * nothing. The generic fallbacks sort last whatever else arrives, which is
 * why they are separated out here rather than left in weight order -- they
 * are a floor, not a tier.
 *
 * Deduplicated on TEXT, not key: the two sources can phrase the same question
 * identically, and a panel offering it twice looks broken.
 */
export function mergePrompts(
  grounded: readonly GroundedPrompt[],
  contextual: readonly string[],
  limit: number,
  floor: number = GENERIC_FLOOR,
): GroundedPrompt[] {
  const out: GroundedPrompt[] = []
  const seenText = new Set<string>()

  const push = (c: GroundedPrompt) => {
    const t = c.text.trim().toLowerCase()
    if (!t || seenText.has(t)) return
    seenText.add(t)
    out.push(c)
  }

  for (const c of grounded) if (c.kind !== 'generic') push(c)
  for (const text of contextual) {
    push({ key: keyFor('active_asset', text), text, reason: null, kind: 'active_asset', weight: 30 })
  }
  /*
   * A floor, and now actually used as one.
   *
   * This filled up to `limit` with the generic market questions, which meant
   * a reader looking at AAPL with two real pieces of open work was offered
   * those two and then "What sectors are showing momentum?" to make up the
   * number. Four weak suggestions are worse than two good ones: the weak
   * ones are what a reader reads first if they happen to sit higher, and
   * their presence says the panel had nothing better, which was false.
   *
   * So generic questions appear only when there is nothing else AT ALL --
   * not when the real list is merely short. One strong question is a better
   * panel than one strong question and two about the market, because the two
   * are what a reader's eye lands on while deciding whether to bother.
   *
   * `floor` is then how many to show in that empty case: a single lonely
   * button reads as a bug.
   */
  if (out.length === 0) {
    for (const c of grounded) {
      if (c.kind !== 'generic') continue
      if (out.length >= Math.max(1, floor)) break
      push(c)
    }
  }

  return out.slice(0, Math.max(1, limit))
}
