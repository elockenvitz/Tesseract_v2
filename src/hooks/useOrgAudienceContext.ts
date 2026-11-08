/**
 * Where the signed-in user sits in the org chart, and therefore which groups
 * they may address when choosing an audience.
 *
 * ── Why this is a hook and not inline ────────────────────────────────────
 *
 * This was ~80 lines inside `AssetTab.tsx` (the `['user-org-context']` query
 * plus a `getTargetOptions` callback beside it). Nothing in it is about an
 * asset: it reads the CALLER's own memberships and the org's node tree, and
 * every output is a property of the user. `AudiencePicker` is already
 * subject-agnostic -- it takes `saved`, `nodesFor`, `memberCounts`,
 * `nodeById` and `onApply` and knows nothing about what is being shared --
 * so the only thing stopping the Theme page from using the same control was
 * that its inputs were built in the Asset page's component body.
 *
 * So this is a move, not a rewrite. The query key, the tables, the traversal
 * and the sort order are the ones that shipped; `useAssetPage`-shaped callers
 * get the identical object back. See `src/lib/research/subject.ts` for the
 * same idea applied to the research data layer.
 *
 * ── What "effective" means, and why it matters ───────────────────────────
 *
 * Membership is inherited UPWARD: being on a team makes you a member of its
 * department and division for reach purposes. Two consequences the picker
 * depends on:
 *
 *   - `nodesFor('department')` lists the departments above your teams, not
 *     only departments you are directly a member of. That is what makes
 *     "share with my department" offerable to someone whose only direct
 *     membership is a team.
 *   - `memberCounts` counts distinct PEOPLE a node reaches, including
 *     everyone in the groups beneath it. One person on two teams under the
 *     same department is one reader, not two. Understating this would let an
 *     author share more widely than the number in front of them implied.
 *
 * `portfolios` is deliberately NOT traversed: a portfolio is a leaf audience,
 * and reaching one because you sit above it in the chart is not the same as
 * being on it.
 */
import { useCallback } from 'react'

import { useQuery } from '@tanstack/react-query'

import {
  effectiveMemberCounts,
  type AudienceNode,
} from '../lib/contributions/audience-reach'
import { supabase } from '../lib/supabase'

import { useAuth } from './useAuth'

/** The five audience levels. `firm` addresses everyone and names no group. */
export type AudienceLevel = 'firm' | 'division' | 'department' | 'team' | 'portfolio'

export interface OrgAudienceContext {
  /** Direct portfolio memberships only, by name. */
  portfolios: AudienceNode[]
  /** Teams joined directly, plus none inherited (a team has no sub-teams here). */
  teams: AudienceNode[]
  /** Departments above the user's teams, and any joined directly. */
  departments: AudienceNode[]
  /** Divisions above those departments, and any joined directly. */
  divisions: AudienceNode[]
  /** Distinct people each node reaches, counting the groups beneath it. */
  memberCounts: Map<string, number>
  /** Every node in the org, so a stored target the user can no longer pick is
   *  still shown by name rather than as a bare uuid. */
  nodeById: Map<string, AudienceNode>
}

const EMPTY: OrgAudienceContext = {
  portfolios: [], teams: [], departments: [], divisions: [],
  memberCounts: new Map(),
  nodeById: new Map(),
}

/** The query key, exported so a caller can invalidate it after an org change. */
export const orgAudienceContextKey = (userId: string | undefined) =>
  ['user-org-context', userId] as const

export function useOrgAudienceContext() {
  const { user } = useAuth()

  const { data: context, isLoading } = useQuery({
    queryKey: orgAudienceContextKey(user?.id),
    queryFn: async (): Promise<OrgAudienceContext> => {
      const { data: memberships } = await supabase
        .from('org_chart_node_members')
        .select('node_id, org_chart_nodes(id, name, color, node_type, parent_id)')
        .eq('user_id', user?.id)

      if (!memberships) return EMPTY

      const directNodes = memberships
        .map(m => m.org_chart_nodes as unknown as AudienceNode)
        .filter(Boolean)

      const { data: allNodes } = await supabase
        .from('org_org_chart_nodes_v')
        .select('id, name, color, node_type, parent_id')

      if (!allNodes) return EMPTY

      /*
       * `user_id` is selected because the rollup counts distinct PEOPLE, not
       * membership rows. See the header, and
       * src/lib/contributions/audience-reach.ts.
       */
      const { data: allMembers } = await supabase
        .from('org_chart_node_members')
        .select('node_id, user_id')

      const memberCounts = effectiveMemberCounts(
        allNodes as AudienceNode[],
        (allMembers ?? []) as { node_id: string; user_id: string }[],
      )
      const nodeById = new Map<string, AudienceNode>(
        (allNodes as AudienceNode[]).map(n => [n.id, n])
      )

      const nodeMap = new Map((allNodes as AudienceNode[]).map(n => [n.id, n]))
      const teamsSet = new Map<string, AudienceNode>()
      const departmentsSet = new Map<string, AudienceNode>()
      const divisionsSet = new Map<string, AudienceNode>()

      const traverseUp = (nodeId: string | null) => {
        if (!nodeId) return
        const node = nodeMap.get(nodeId)
        if (!node) return
        if (node.node_type === 'team') teamsSet.set(node.id, node)
        else if (node.node_type === 'department') departmentsSet.set(node.id, node)
        else if (node.node_type === 'division') divisionsSet.set(node.id, node)
        traverseUp(node.parent_id)
      }

      directNodes.forEach(node => {
        if (node.node_type === 'team') teamsSet.set(node.id, node)
        traverseUp(node.parent_id)
      })

      const byName = (a: AudienceNode, b: AudienceNode) => a.name.localeCompare(b.name)

      return {
        portfolios: directNodes.filter(n => n.node_type === 'portfolio').sort(byName),
        teams: Array.from(teamsSet.values()).sort(byName),
        departments: Array.from(departmentsSet.values()).sort(byName),
        divisions: Array.from(divisionsSet.values()).sort(byName),
        memberCounts,
        nodeById,
      }
    },
    enabled: !!user?.id,
  })

  /**
   * The groups offerable at one level. `firm` names no group, so it is an
   * empty list rather than an error: the picker reads the empty list as
   * "nothing to choose", which is correct for "everyone".
   */
  const nodesFor = useCallback((level: AudienceLevel): AudienceNode[] => {
    if (!context) return []
    switch (level) {
      case 'firm': return []
      case 'division': return context.divisions
      case 'department': return context.departments
      case 'team': return context.teams
      case 'portfolio': return context.portfolios
      default: return []
    }
  }, [context])

  return {
    context: context ?? null,
    isLoading,
    nodesFor,
    /** Pass-throughs so a caller does not have to cope with `context` being
     *  null before the query settles; the picker wants maps, not nulls. */
    memberCounts: context?.memberCounts ?? EMPTY.memberCounts,
    nodeById: context?.nodeById ?? EMPTY.nodeById,
  }
}
