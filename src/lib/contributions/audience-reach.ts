/**
 * Which org-chart nodes a contribution can actually be shared with.
 *
 * ── Reach is now inherited ───────────────────────────────────────────────
 *
 * Membership is inherited UPWARD: a member of a Team is an effective member
 * of its Department and Division. Read the same relation from the other end
 * and sharing with a node reaches its direct members AND everyone beneath it.
 *
 * So a node's reach is the count of distinct users in its SUBTREE, not the
 * count of rows naming it. Those two numbers differ by a lot — on the
 * production org chart, 6 direct (user, node) pairs become 15 effective ones.
 *
 * This module previously described the opposite, because authorization
 * matched the targeted node exactly and descent was unimplemented — a
 * convention set in `20260827090400_quick_thoughts_tenant_rls.sql:52-56`,
 * which recorded "whether a division-level post should reach its sub-teams is
 * a product question and is deliberately left open". It is now answered, and
 * `user_effective_node_ids()` implements it on the server. The counts here
 * must agree with that function or the picker goes back to describing an
 * audience the policy does not deliver — in the generous direction this time,
 * which is the one nobody notices.
 *
 * This module still decides nothing. It describes what selecting a node would
 * do, so the UI can say it.
 *
 * ── Two rules worth stating, because both protect a saved audience ───────
 *
 * 1. A node a contribution is ALREADY shared with is always in the list, even
 *    if the author could not pick it today — they may have left the team, or
 *    its last member may have. If such a node were missing, confirming the
 *    picker would drop it, and the audience would change because of a list
 *    the user never saw.
 *
 * 2. An unreachable node is never removed, deselected or rewritten here.
 *    Stored targets are preserved exactly; unreachable ones are flagged so the
 *    UI can explain them, and the author decides.
 */

export interface AudienceNode {
  id: string
  name: string
  color?: string | null
  node_type: string
  parent_id?: string | null
}

export interface AudienceOption extends AudienceNode {
  /**
   * Distinct users this node reaches: its direct members plus every member of
   * a group beneath it. Matches `user_effective_node_ids()` on the server.
   */
  memberCount: number
  /** False when selecting this node would share with nobody. */
  reachable: boolean
  /** The contribution is already shared with this node. */
  selected: boolean
  /**
   * Present only because it is already a target — the author could not pick
   * it from their own memberships today.
   */
  storedOnly: boolean
}

/**
 * How many distinct people each node reaches, counting the whole subtree.
 *
 * The server answers this by walking UP from one user; the UI needs it for
 * every node at once, so it walks DOWN from each. Same relation, and the
 * assertions in the test file pin the two together.
 *
 * Distinct USERS, not membership rows — somebody in two teams under the same
 * department is one person to that department, and counting rows would tell
 * an author they reach more people than exist.
 *
 * Cycle-safe. `parent_id` has no cycle guard in the schema, and the server's
 * recursion bounds itself at 32 for the same reason; here a per-walk visited
 * set does it, which also stops a node being counted twice through a diamond.
 */
export function effectiveMemberCounts(
  nodes: readonly AudienceNode[],
  members: readonly { node_id: string; user_id: string }[],
): Map<string, number> {
  const childrenOf = new Map<string, string[]>()
  for (const n of nodes) {
    if (!n.parent_id) continue
    const siblings = childrenOf.get(n.parent_id)
    if (siblings) siblings.push(n.id)
    else childrenOf.set(n.parent_id, [n.id])
  }

  const directMembers = new Map<string, string[]>()
  for (const m of members) {
    const existing = directMembers.get(m.node_id)
    if (existing) existing.push(m.user_id)
    else directMembers.set(m.node_id, [m.user_id])
  }

  const counts = new Map<string, number>()
  for (const node of nodes) {
    const reached = new Set<string>()
    const seen = new Set<string>()
    const stack = [node.id]
    while (stack.length) {
      const id = stack.pop()!
      if (seen.has(id)) continue
      seen.add(id)
      for (const u of directMembers.get(id) ?? []) reached.add(u)
      for (const child of childrenOf.get(id) ?? []) stack.push(child)
    }
    counts.set(node.id, reached.size)
  }
  return counts
}

export interface BuildAudienceOptionsInput {
  /** What the picker derived from the author's own memberships. */
  candidates: readonly AudienceNode[]
  /** Node ids this contribution is currently shared with. */
  storedTargetIds: readonly string[]
  /** Direct member counts, by node id. A missing id counts as zero. */
  memberCounts: ReadonlyMap<string, number>
  /**
   * Nodes that are stored targets but absent from `candidates` — looked up
   * separately so they can still be shown by name rather than as a bare id.
   */
  storedNodes?: readonly AudienceNode[]
}

/**
 * The option list for one visibility level.
 *
 * Ordering puts what is already shared first, then what can be shared, then
 * what cannot — so the author sees their current audience before the choices.
 */
export function buildAudienceOptions({
  candidates,
  storedTargetIds,
  memberCounts,
  storedNodes = [],
}: BuildAudienceOptionsInput): AudienceOption[] {
  const stored = new Set(storedTargetIds)
  const candidateIds = new Set(candidates.map(c => c.id))

  const byId = new Map<string, AudienceNode>()
  for (const n of candidates) byId.set(n.id, n)
  // Stored nodes fill gaps only; a candidate's own record wins, because it is
  // the one the author's context produced.
  for (const n of storedNodes) if (!byId.has(n.id)) byId.set(n.id, n)

  // Every stored target must appear, even if nothing could name it — rule 1.
  for (const id of stored) {
    if (!byId.has(id)) {
      byId.set(id, { id, name: 'Unknown group', node_type: 'unknown', parent_id: null })
    }
  }

  const options: AudienceOption[] = [...byId.values()].map(n => {
    const memberCount = memberCounts.get(n.id) ?? 0
    return {
      ...n,
      memberCount,
      reachable: memberCount > 0,
      selected: stored.has(n.id),
      storedOnly: !candidateIds.has(n.id),
    }
  })

  return options.sort((a, b) =>
    Number(b.selected) - Number(a.selected) ||
    Number(b.reachable) - Number(a.reachable) ||
    a.name.localeCompare(b.name)
  )
}

/**
 * May this visibility level be offered at all?
 *
 * A level with nothing reachable and nothing already shared can only produce a
 * contribution that names nobody, so it is disabled rather than allowed to
 * store an empty audience. A level that is unreachable but already in use
 * stays available — the author must be able to see and edit what exists.
 */
export function isLevelSelectable(options: readonly AudienceOption[]): boolean {
  return options.some(o => o.reachable || o.selected)
}

/**
 * Why a level or node is unavailable, in the user's terms.
 *
 * Returns null when there is nothing to explain. The wording states the
 * mechanism — nobody is a direct member — rather than "unavailable", because
 * the author can act on the former.
 */
export function unreachableReason(option: AudienceOption): string | null {
  if (option.reachable) return null
  if (option.selected) {
    return `Already shared with ${option.name}, but it has no members — not in the group itself and not in any group beneath it — so no one else can see it.`
  }
  return `${option.name} has no members, in it or beneath it. Sharing here would reach only you.`
}

/** The same explanation for a whole level whose options are all unreachable. */
export function emptyLevelReason(level: string): string {
  return `No ${level} you belong to has any members yet. Sharing with a ${level} reaches everyone in it and in the groups beneath it — there is nobody there yet.`
}
