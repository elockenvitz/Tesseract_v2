/**
 * useOrgGraph — React hook that builds an OrgGraph from raw query data.
 *
 * Memoizes the graph so downstream consumers only recompute
 * when nodes, members, links, or coverage actually change.
 */

import { useMemo } from 'react'
import {
  buildOrgGraph,
  type OrgGraph,
  type RawOrgNode,
  type RawNodeMember,
  type RawNodeLink,
  type CoverageRecord,
} from '../lib/org-graph'

interface UseOrgGraphInput {
  nodes: RawOrgNode[]
  members: RawNodeMember[]
  links: RawNodeLink[]
  coverage: CoverageRecord[]
}

/**
 * Returns a memoized OrgGraph derived from the raw org chart data.
 *
 * Usage:
 * ```ts
 * const graph = useOrgGraph({ nodes: orgChartNodes, members: orgChartNodeMembers, links: orgChartNodeLinks, coverage: coverageData })
 * ```
 */
export function useOrgGraph(input: UseOrgGraphInput): OrgGraph {
  const { nodes, members, links, coverage } = input

  return useMemo(
    () => buildOrgGraph({ nodes, members, links, coverage }),
    [nodes, members, links, coverage],
  )
}
