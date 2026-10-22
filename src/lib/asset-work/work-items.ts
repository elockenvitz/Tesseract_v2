/**
 * The things a reader can actually work on, for one asset.
 *
 * ── Why a model and not a list of features ──────────────────────────────
 *
 * Work was four features stacked vertically, and a sidebar of those same four
 * names is the same stack rotated. A navigator is only worth the space if its
 * rows are the NOUNS — this running process, this idea, this request — so
 * that selecting one can show the thing itself rather than a link to it.
 *
 * ── One row per underlying idea ─────────────────────────────────────────
 *
 * A decision request is a row in `decision_requests` that points at a
 * `trade_queue_items` row — the idea. So the same piece of work is in two
 * datasets, and listing both produces two rows that are the same thing with
 * different words. Here the idea is the identity and the request is a FACT
 * ABOUT it: it decides which group the row lands in and what the row says,
 * and selecting the row opens the idea either way.
 *
 * A request whose idea is not in the ideas set still gets a row. That should
 * not happen — the query inner-joins the item — but dropping work because two
 * reads disagreed is worse than showing it.
 *
 * ── No invented priority ────────────────────────────────────────────────
 *
 * Grouping is categorical and comes from rules that already exist:
 * `splitAttention` (the `portfolio_team` pm/admin rule) decides whose move it
 * is, and `is_started`/`is_completed` decide whether a process is running.
 * Within a group the order is the order the source query returned — created
 * or updated descending — never a score, a weight or a model.
 */

export type WorkItemKind = 'idea' | 'process' | 'conversation'

export type WorkItemGroup = 'needs-you' | 'in-progress' | 'investigations'

export const GROUP_LABEL: Record<WorkItemGroup, string> = {
  'needs-you': 'Needs your action',
  'in-progress': 'In progress',
  investigations: 'Investigations',
}

/** Groups in the order they are shown. */
export const GROUP_ORDER: readonly WorkItemGroup[] = [
  'needs-you', 'in-progress', 'investigations',
]

export interface WorkItem {
  /**
   * The selection key, and what persists across tabs and reloads.
   *
   * `kind:id` rather than a bare id, because a process id and an idea id are
   * both uuids and a saved selection has to survive the set changing
   * underneath it without ever resolving to the wrong kind of thing.
   */
  key: string
  kind: WorkItemKind
  id: string
  group: WorkItemGroup
  /** What it is. "BUY · Large Cap Growth", "Earnings Season - Q2 2026". */
  label: string
  /** ONE state fact. Never a restatement of the surface. */
  detail?: string | null
  /**
   * The full, unabbreviated name, when `label` is an abbreviation of it.
   *
   * Set for process runs, whose label is the process and whose run identity
   * moved to `detail`. It is what the row exposes as its tooltip and its
   * accessible name, so the whole string is still reachable from a row that
   * cannot show it all.
   */
  fullName?: string | null
  /** Conversations open the existing pane; they never become the surface. */
  launchesPane?: boolean
}

export interface RequestInput {
  id: string
  /** The `trade_queue_items` row this decision is about. */
  tradeQueueItemId?: string | null
  action?: string | null
  portfolioName?: string | null
  requesterName?: string | null
}

export interface IdeaInput {
  id: string
  action?: string | null
  /** Raw stored stage; the caller supplies the canonical label. */
  stageLabel?: string | null
  rationale?: string | null
  portfolioName?: string | null
}

export interface ProcessInput {
  workflowId: string
  name: string
  /**
   * `workflows.branch_suffix` — what tells one run of a process from another.
   *
   * "Apr 10 2026", "Q2 2026". Null on a process that is not a branch.
   */
  branchSuffix?: string | null
  /** The stage it is on, when known. Never guessed. */
  stageLabel?: string | null
  isStarted: boolean
  isCompleted: boolean
}

export interface ConversationInput {
  id: string
  title: string
  lastActivity?: string | null
}

export interface BuildWorkItemsInput {
  needsYourAction: readonly RequestInput[]
  awaitingOthers: readonly RequestInput[]
  ideas: readonly IdeaInput[]
  processes: readonly ProcessInput[]
  conversations: readonly ConversationInput[]
}

const ideaKey = (id: string) => `idea:${id}`
const processKey = (id: string) => `process:${id}`
const conversationKey = (id: string) => `conversation:${id}`

export const workItemKey = { idea: ideaKey, process: processKey, conversation: conversationKey }

/**
 * Split a run's name into the process it belongs to and the run it is.
 *
 * ── What was wrong ────────────────────────────────────────────────────────
 *
 * Three rows of the sidebar read, identically:
 *
 *     Weekly Portfolio Review - Vision Fund 10K - …
 *     Weekly Portfolio Review - Vision Fund 10K - …
 *     Weekly Portfolio Review - Vision Fund 10K - …
 *
 * They are the Apr 10, Apr 3 and Mar 27 runs. A 296px column truncates from
 * the END, so the shared 40-character prefix always survived and the only
 * thing that distinguished them never did. There was no `title` either, so
 * hovering said nothing: the reader had to open rows until one was right.
 *
 * ── Why a split and not a wider column or a middle ellipsis ───────────────
 *
 * The information is already two things. `workflows.branch_suffix` holds the
 * run's identity and the name is the process plus that suffix, so the row can
 * say both without inventing anything or stealing width:
 *
 *     Weekly Portfolio Review - Vision Fund 10K      <- what it is
 *     Apr 10 2026 · Momentum Check                   <- which run, where it is
 *
 * The discriminator now LEADS the second line, so it is the part that
 * survives truncation rather than the part that is lost.
 *
 * The suffix is removed from the head only when the name actually ends with
 * it. `generate_unique_workflow_name` builds the name as `parent - suffix`,
 * but it also uniquifies collisions, and a name that has been edited by hand
 * owes this function nothing. When the tail does not match, the full name
 * stays as the label and the suffix still shows beneath it — duplicated
 * wording in a rare case, never a dropped fact.
 */
export function splitRunName(
  name: string,
  branchSuffix: string | null | undefined,
): { process: string; run: string | null } {
  const full = (name ?? '').trim()
  const run = (branchSuffix ?? '').trim()
  if (!run) return { process: full, run: null }
  if (!full.toLowerCase().endsWith(run.toLowerCase())) return { process: full, run }

  /* Drop the suffix, then any separator left dangling. */
  const head = full.slice(0, full.length - run.length).replace(/[\s–—·|-]+$/, '').trim()
  return { process: head || full, run }
}

/** "BUY · Large Cap Growth", or just the action, or a neutral name. */
function ideaLabel(action: string | null | undefined, portfolioName: string | null | undefined): string {
  const act = (action ?? '').trim().toUpperCase()
  const book = (portfolioName ?? '').trim()
  if (act && book) return `${act} · ${book}`
  return act || book || 'Idea'
}

export function buildWorkItems(input: BuildWorkItemsInput): WorkItem[] {
  const { needsYourAction, awaitingOthers, ideas, processes, conversations } = input

  /* Which ideas carry an open request, and whose move it is. */
  const yours = new Map<string, RequestInput>()
  const theirs = new Map<string, RequestInput>()
  for (const r of needsYourAction) {
    if (r.tradeQueueItemId) yours.set(r.tradeQueueItemId, r)
  }
  for (const r of awaitingOthers) {
    if (r.tradeQueueItemId && !yours.has(r.tradeQueueItemId)) theirs.set(r.tradeQueueItemId, r)
  }

  const items: WorkItem[] = []
  const seenIdeas = new Set<string>()

  /*
   * Processes lead the in-progress group.
   *
   * Not a priority score — an ordering, and the reason is categorical: a
   * running process always has a stage with requirements the reader can act
   * on, whereas an idea in this group is by definition NOT theirs to decide
   * (anything that were would have been sorted into "needs your action").
   * Opening Work on a row that reads "awaiting a decision" would land the
   * reader on the one thing they cannot move.
   *
   * Anything genuinely theirs to act on is in the group above and is
   * selected before either.
   */
  for (const p of processes) {
    if (!p?.workflowId) continue
    /* Not started or already finished is not work in progress. Neither is
       invented: both flags are columns on `asset_workflow_progress`. */
    if (!p.isStarted || p.isCompleted) continue
    /*
     * The run's identity leads the detail line, ahead of the stage. Several
     * runs of one process are the case that needs telling apart; which stage
     * each is on is the next question, not the first.
     */
    const { process, run } = splitRunName(p.name, p.branchSuffix)
    const detail = [run, p.stageLabel].filter(Boolean).join(' · ')

    items.push({
      key: processKey(p.workflowId),
      kind: 'process',
      id: p.workflowId,
      group: 'in-progress',
      label: process,
      detail: detail || null,
      /* The unabbreviated name, for the row's tooltip and its accessible
         name. Two runs can still share a suffix, and this is what separates
         them when they do. */
      fullName: p.name,
    })
  }

  for (const idea of ideas) {
    if (!idea?.id || seenIdeas.has(idea.id)) continue
    seenIdeas.add(idea.id)

    const mine = yours.get(idea.id)
    const other = theirs.get(idea.id)

    items.push({
      key: ideaKey(idea.id),
      kind: 'idea',
      id: idea.id,
      group: mine ? 'needs-you' : 'in-progress',
      label: ideaLabel(idea.action, idea.portfolioName),
      detail: mine
        ? (mine.requesterName ? `Decision requested by ${mine.requesterName}` : 'Decision requested')
        : other
          ? 'Awaiting a decision'
          : idea.stageLabel ?? null,
    })
  }

  /*
   * A request whose idea the ideas query did not return.
   *
   * `useAssetTradeIdeas` filters to open items, so a request against an idea
   * that has since been closed lands here. It is still the reader's move, and
   * hiding it because two reads disagreed would lose real work.
   */
  for (const [tradeQueueItemId, r] of yours) {
    if (seenIdeas.has(tradeQueueItemId)) continue
    seenIdeas.add(tradeQueueItemId)
    items.push({
      key: ideaKey(tradeQueueItemId),
      kind: 'idea',
      id: tradeQueueItemId,
      group: 'needs-you',
      label: ideaLabel(r.action, r.portfolioName),
      detail: r.requesterName ? `Decision requested by ${r.requesterName}` : 'Decision requested',
    })
  }

  for (const c of conversations) {
    if (!c?.id) continue
    items.push({
      key: conversationKey(c.id),
      kind: 'conversation',
      id: c.id,
      group: 'investigations',
      label: c.title,
      detail: c.lastActivity ?? null,
      launchesPane: true,
    })
  }

  return items
}

/** The items of one group, in the order they were built. */
export function itemsInGroup(items: readonly WorkItem[], group: WorkItemGroup): WorkItem[] {
  return items.filter(i => i.group === group)
}

export interface SelectionResolution {
  /** What the surface should show. Null means the neutral Work overview. */
  selected: WorkItem | null
  /**
   * True when a saved selection could not be honoured.
   *
   * The caller must say so rather than quietly showing something else: an
   * item that completed, or that the reader lost access to, is information,
   * and a surface that swaps in a different piece of work while implying it
   * is the one you left is worse than an empty one.
   */
  recovered: boolean
}

/**
 * Which item the surface shows.
 *
 * A saved key wins whenever it still exists. Otherwise the first genuinely
 * actionable item, then the first item in progress — the same categorical
 * order the navigator renders, so "what opens first" and "what is listed
 * first" can never disagree.
 *
 * A conversation is never auto-selected: it launches the CoAnalyst pane, and
 * opening a pane because a reader opened a tab is not something they asked
 * for.
 */
export function resolveSelection(
  items: readonly WorkItem[],
  savedKey: string | null | undefined,
): SelectionResolution {
  const selectable = items.filter(i => !i.launchesPane)

  if (savedKey) {
    const saved = selectable.find(i => i.key === savedKey)
    if (saved) return { selected: saved, recovered: false }
  }

  const first =
    selectable.find(i => i.group === 'needs-you') ??
    selectable.find(i => i.group === 'in-progress') ??
    null

  return { selected: first, recovered: !!savedKey }
}
