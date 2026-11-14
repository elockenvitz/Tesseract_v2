/**
 * WHY the reader opened this name, as the page can act on it.
 *
 * ── The gap this closes ──────────────────────────────────────────────────
 *
 * `WorkspaceFacts.arrivalIntent` has existed since the workspace resolver was
 * written, and the Snapshot passed it `null`. Every lens already carries the
 * reason across the hop -- `openAsset` writes `focus`, `origin`, `issue` and
 * the book into tab data, and the Process dashboard writes the workflow, the
 * stage and the requirement -- and the surface that composes the page threw
 * all of it away. So a PM arriving to rule on a buy request and an analyst
 * arriving to read a thesis were handed the same page.
 *
 * This reads the descriptor the shell already delivered and answers one
 * question: which of three situations is the reader in.
 *
 * ── Three, and why not more ──────────────────────────────────────────────
 *
 *   general    reviewing the name: what do we think, where are we exposed,
 *              what changed
 *   decision   ruling on a specific request: what is proposed, on what
 *              evidence, and what is missing
 *   work       advancing a recorded process: what is outstanding, what we
 *              already have, what is next
 *
 * Each has a different first question, so each earns a different lead. A
 * fourth mode would have to name a question the three cannot answer, and
 * "arrived from Research" is not one: a reader sent to read the case is
 * reviewing the name, which is `general` landing on Research.
 *
 * ── Named records only ───────────────────────────────────────────────────
 *
 * A mode is never guessed from the shape of the data. `decision` is set
 * because a sender named a decision request (or asked for the decision
 * surface), never because the asset happens to have one waiting -- the
 * workspace STATE already says that, and it is a different claim. The page
 * composes differently when the reader came for a thing; it does not pretend
 * they did.
 *
 * Which is why `decisionId` may be null on a decision mode: the Decision
 * Inbox can say "this request", while a surface that sends a reader to the
 * decision destination can only say "they came here to decide". Both are
 * honest; the first is more useful, and a surface that needs the exact record
 * checks for it.
 *
 * `origin` never decides a mode. It says which lens raised the hop, which is
 * provenance for the reader, and a lens name is not a statement about what
 * the reader came to do.
 */

import { destinationFromTabData, type WorkDestination } from '../asset-work/work-destination'

export type WorkspaceEntryMode = 'general' | 'decision' | 'work'

export interface WorkspaceEntry {
  mode: WorkspaceEntryMode
  /**
   * The `decision_requests` row the reader came to rule on, when the sender
   * named one. Null on a decision entry that only named the intent.
   */
  decisionId: string | null
  /** The process run, stage and requirement, when the sender named them. */
  work: WorkDestination | null
  /** The book the sender was looking at the name from. Context, not a filter. */
  portfolioId: string | null
  /** Which lens sent them. Provenance for the reader; never a permission. */
  origin: string | null
  /** The sender's one-line reason, where it carried one. */
  reason: string | null
}

export const GENERAL_ENTRY: WorkspaceEntry = {
  mode: 'general',
  decisionId: null,
  work: null,
  portfolioId: null,
  origin: null,
  reason: null,
}

/**
 * The shape this reads: whatever the shell merged into the asset tab.
 *
 * Deliberately `unknown`-valued. Tab data is persisted across sessions and
 * written by a dozen senders, so a field can be missing, stale, or of the
 * wrong type, and every read below is typed at the boundary rather than
 * trusted.
 */
export type EntryDescriptor = Record<string, unknown> | null | undefined

const str = (v: unknown): string | null =>
  typeof v === 'string' && v.trim() !== '' ? v : null

/**
 * The sender's reason, whichever shape it used.
 *
 * `issue` is a string from some senders and `{ title, detail }` from others;
 * `issueTitle` in `desktop-asset/navigate` already normalises it, and this
 * repeats the two cases rather than importing it so the resolver stays free
 * of the navigation module (which dispatches window events on import).
 */
function reasonOf(issue: unknown): string | null {
  if (typeof issue === 'string') return str(issue)
  if (issue && typeof issue === 'object') return str((issue as { title?: unknown }).title)
  return null
}

export function resolveEntry(data: EntryDescriptor): WorkspaceEntry {
  if (!data) return GENERAL_ENTRY

  const origin = str(data.origin)
  const reason = reasonOf(data.issue)
  const portfolioId = str(data.portfolioId)
  const decisionId = str(data.decisionId)
  /*
   * One module knows the three spellings this payload uses for a work
   * destination. A fourth caller must not invent a fourth.
   *
   * It type-checks the ids but does not trim them, which is the right call
   * there -- it is read by the Work surface, whose behaviour must not change
   * because this resolver was written. A blank id is dropped here instead,
   * where the consequence is local: a work mode on a blank run would compose
   * a process block and then query for a workflow that cannot exist.
   */
  const named = destinationFromTabData(data)
  const work = named && str(named.workflowId) ? named : null

  /*
   * A named record, or an explicitly named destination. Never the origin.
   *
   * `origin` is provenance -- which lens raised the hop -- and it is too weak
   * to compose a page on. The Decisions lens sends a reader to a DECIDED
   * record with `focus: 'research'`, meaning "go and read the case"; treating
   * its origin as a decision entry would lead that page with whatever
   * unrelated request happens to be open on the name.
   */
  const mode: WorkspaceEntryMode =
    decisionId || str(data.focus) === 'decisions'
      ? 'decision'
      : work
        ? 'work'
        : 'general'

  return { mode, decisionId, work, portfolioId, origin, reason }
}

/**
 * Whether the entry still describes something the page can show.
 *
 * A decision entry whose request has since been ruled on, or a work entry
 * whose run has been closed, must not hold the page's lead slot: the reader
 * would get a prominent block about a record that is no longer open, which is
 * worse than the general page they would otherwise have had. Callers resolve
 * the mode through this, passing what they actually found.
 */
export function effectiveMode(
  entry: WorkspaceEntry,
  found: { openDecisionCount: number; hasWork: boolean },
): WorkspaceEntryMode {
  if (entry.mode === 'decision') return found.openDecisionCount > 0 ? 'decision' : 'general'
  if (entry.mode === 'work') return found.hasWork ? 'work' : 'general'
  return 'general'
}
