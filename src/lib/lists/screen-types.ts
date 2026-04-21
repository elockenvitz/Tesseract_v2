/**
 * Screen criteria — the filter tree stored in asset_lists.screen_criteria.
 *
 * Phase 1 only emits flat AND (`combinator: 'AND'`, `rules: ScreenRule[]`)
 * but the shape allows nested groups so we can extend later without a DB
 * migration.
 */

export type ScreenFieldType = 'text' | 'enum' | 'number' | 'date'

export type ScreenOperator =
  // Text
  | 'contains'
  | 'not_contains'
  | 'equals'
  | 'not_equals'
  // Enum
  | 'is'
  | 'is_not'
  | 'in'
  | 'not_in'
  // Number
  | 'gt' | 'gte' | 'lt' | 'lte' | 'between'
  // Date
  | 'before' | 'after' | 'within_last_days'
  // Presence (applies to every type)
  | 'is_empty'
  | 'is_not_empty'

export interface ScreenRule {
  id: string                   // stable UUID for UI keys + diffs
  field: string                // must match a SCREENABLE_FIELDS key
  op: ScreenOperator
  value?: unknown              // omitted for is_empty / is_not_empty
}

export interface ScreenGroup {
  id: string
  combinator: 'AND' | 'OR'
  rules: Array<ScreenRule | ScreenGroup>
}

export type ScreenCriteria = ScreenGroup

/** Empty starter criteria for a newly created screen. */
export function emptyScreenCriteria(): ScreenCriteria {
  return {
    id: crypto.randomUUID(),
    combinator: 'AND',
    rules: []
  }
}

/** Type guard: is this node a group (vs a rule)? */
export function isScreenGroup(node: ScreenRule | ScreenGroup): node is ScreenGroup {
  return 'combinator' in node
}

// ── Tree edit helpers ────────────────────────────────────────────────
// All helpers are pure — they return a new tree rather than mutating.

type TreeNode = ScreenRule | ScreenGroup

/** Recursively replace a rule by id. Returns a new tree. */
export function updateRuleInTree(
  group: ScreenGroup,
  ruleId: string,
  patch: Partial<ScreenRule>
): ScreenGroup {
  return {
    ...group,
    rules: group.rules.map(node => {
      if (isScreenGroup(node)) return updateRuleInTree(node, ruleId, patch)
      return node.id === ruleId ? { ...node, ...patch } : node
    })
  }
}

/** Remove a node (rule or group) by id. Returns a new tree. */
export function removeNodeFromTree(
  group: ScreenGroup,
  nodeId: string
): ScreenGroup {
  return {
    ...group,
    rules: group.rules
      .filter(node => node.id !== nodeId)
      .map(node => isScreenGroup(node) ? removeNodeFromTree(node, nodeId) : node)
  }
}

/** Append a node to the group with the given id. Returns a new tree. */
export function addNodeToGroup(
  root: ScreenGroup,
  targetGroupId: string,
  newNode: TreeNode
): ScreenGroup {
  if (root.id === targetGroupId) {
    return { ...root, rules: [...root.rules, newNode] }
  }
  return {
    ...root,
    rules: root.rules.map(node =>
      isScreenGroup(node) ? addNodeToGroup(node, targetGroupId, newNode) : node
    )
  }
}

/** Flip the combinator of a group by id. Returns a new tree. */
export function setGroupCombinator(
  root: ScreenGroup,
  groupId: string,
  combinator: 'AND' | 'OR'
): ScreenGroup {
  if (root.id === groupId) return { ...root, combinator }
  return {
    ...root,
    rules: root.rules.map(node =>
      isScreenGroup(node) ? setGroupCombinator(node, groupId, combinator) : node
    )
  }
}

/** Build a fresh empty sub-group. */
export function newSubGroup(combinator: 'AND' | 'OR' = 'AND'): ScreenGroup {
  return {
    id: (typeof crypto !== 'undefined' && crypto.randomUUID)
      ? crypto.randomUUID()
      : `g-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    combinator,
    rules: []
  }
}
