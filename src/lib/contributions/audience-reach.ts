/**
 * Which org-chart nodes a contribution can actually be shared with.
 *
 * ── The gap this closes ──────────────────────────────────────────────────
 *
 * The picker offers the author their department and division by walking UP
 * the org chart from their own memberships. Authorization, however, matches
 * DIRECT membership only — a reader must be a member of the targeted node
 * itself, not of a team beneath it. Subtree descent is unimplemented, by a
 * convention this codebase set deliberately in an earlier security change
 * (`20260827090400_quick_thoughts_tenant_rls.sql:52-56`) and is not being
 * changed here.
 *
 * So the picker could promise an audience the policy would never deliver:
 * pick "Equity Division", and if nobody is a direct member of that division
 * node, the contribution reaches the author and nobody else — silently.
 *
 * This module makes that reachability explicit so the UI can SAY it. It does
 * not change who can read anything; it describes what selecting a node would
 * do.
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
  /** Direct members of this node. The only count authorization acts on. */
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
    return `Already shared with ${option.name}, but nobody is a direct member of it right now, so no one else can see it. Members of groups beneath it are not included.`
  }
  return `No one is a direct member of ${option.name}. Sharing here would reach only you — members of groups beneath it are not included.`
}

/** The same explanation for a whole level whose options are all unreachable. */
export function emptyLevelReason(level: string): string {
  return `No ${level} can be reached directly. Sharing is limited to groups you are a direct member of; members of groups beneath a ${level} are not included.`
}
