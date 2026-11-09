/**
 * Who may rewrite an idea's argument.
 *
 * ── Why this is its own function ────────────────────────────────────────
 *
 * The Work surface is a SECOND place idea fields can be edited. The rule it
 * applies therefore has to be the same rule the modal applies, and has to
 * stay the same rule when either surface changes — a second editor that is
 * a little more permissive than the first is an authorization hole that
 * looks like a UI difference.
 *
 * The rule, as `TradeIdeaDetailModal` has it: the creator owns the content
 * (`created_by === user.id`). Collaborators are explicitly invited onto the
 * idea, and the modal's collaborator mutation exists to let the owner widen
 * exactly this set, so they are included here.
 *
 * ── What this is NOT ────────────────────────────────────────────────────
 *
 * Not a security boundary. Row-level security on `trade_queue_items` is,
 * and `updateTradeIdea` runs under the caller's own session, so a client
 * that lied about this would still be refused by the database. This decides
 * whether to render a disabled surface or an editable one, so that someone
 * without permission is told before they type a paragraph rather than
 * after.
 *
 * The assignee is deliberately absent: being asked to look at an idea is
 * not authority to rewrite its author's thesis.
 */

export interface IdeaEditSubject {
  created_by?: string | null
  collaborators?: string[] | null
}

export function canEditIdea(
  idea: IdeaEditSubject | null | undefined,
  userId: string | null | undefined,
): boolean {
  if (!idea || !userId) return false
  if (idea.created_by === userId) return true
  return Array.isArray(idea.collaborators) && idea.collaborators.includes(userId)
}
