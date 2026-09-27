/**
 * OrgStructureTree — the org hierarchy as a touch-native tree.
 *
 * The phone counterpart to the desktop org chart, and deliberately only a
 * *renderer*: it takes the same `displayTree` the canvas takes, the same
 * `collapsedNodes` set, the same search-match ids, and the same type filter.
 * There is no second hierarchy model and no second source of truth — a node's
 * children, name, type, colour and member count are whatever the org graph
 * already says they are.
 *
 * Why a tree rather than the canvas: the chart is a pan-and-zoom diagram whose
 * width is set by its widest generation. On a phone that means a surface you
 * navigate before you can read it, with pan controls that exist only to undo
 * the layout. A tree says the same thing — parentage, depth, order — in a
 * column, which is the shape a phone already scrolls.
 */

import { ChevronRight, Users } from 'lucide-react'

export interface OrgTreeNode {
  id: string
  name: string
  color?: string
  node_type?: string
  custom_type_label?: string | null
  is_non_investment?: boolean
  children?: OrgTreeNode[]
  [key: string]: any
}

interface OrgStructureTreeProps {
  /** The already-filtered tree the desktop canvas renders. */
  tree: OrgTreeNode[]
  /** Shared with the canvas, so expansion survives switching form factor. */
  collapsedNodes: Set<string>
  onToggleCollapsed: (nodeId: string) => void
  /** Opens the one node-detail destination. */
  onOpenNode: (node: OrgTreeNode) => void
  /** Ids matching the current search; empty set means "no search running". */
  searchMatchIds?: Set<string>
  /**
   * Nodes the active filter resolves to, ancestors included. Empty or absent
   * means no filter, and the whole tree is shown.
   *
   * The canvas uses these sets to *highlight*, because a diagram can show a
   * match in place. A tree prunes to them instead: on a phone a filter chip
   * that leaves every row on screen and tints four of them reads as broken,
   * which is exactly how it read. The sets already carry each match's
   * ancestors, so pruning to them keeps the branch that leads to a match.
   */
  filterIds?: Set<string>
  /** Members directly on a node, for the row's count. */
  getMemberCount?: (nodeId: string) => number
}

const EMPTY_SET: Set<string> = new Set()

/** Keep nodes in `keep`, and any ancestor with a surviving descendant. */
function pruneTree(nodes: OrgTreeNode[], keep: Set<string>): OrgTreeNode[] {
  const out: OrgTreeNode[] = []
  for (const node of nodes) {
    const children = node.children ? pruneTree(node.children, keep) : []
    if (keep.has(node.id) || children.length > 0) {
      out.push({ ...node, children })
    }
  }
  return out
}

/** How a node's type reads in a row. Falls back to the raw type. */
function typeLabel(node: OrgTreeNode): string | null {
  if (node.custom_type_label) return node.custom_type_label
  if (!node.node_type) return null
  return node.node_type.charAt(0).toUpperCase() + node.node_type.slice(1)
}

export function OrgStructureTree({
  tree,
  collapsedNodes,
  onToggleCollapsed,
  onOpenNode,
  searchMatchIds,
  filterIds,
  getMemberCount,
}: OrgStructureTreeProps) {
  const filtering = !!filterIds && filterIds.size > 0
  const visible = filtering ? pruneTree(tree, filterIds!) : tree

  if (visible.length === 0) {
    return (
      <p className="py-6 text-center text-sm text-gray-400">
        No organization nodes match.
      </p>
    )
  }

  return (
    <div data-slot="org-structure-tree" role="tree" className="divide-y divide-gray-100 dark:divide-gray-800">
      {visible.map(node => (
        <TreeRow
          key={node.id}
          node={node}
          depth={0}
          /* While a filter is active the tree opens itself. Pruning to the
             matches is useless if a collapsed ancestor still hides them —
             the chip would look dead for the second time. */
          collapsedNodes={filtering ? EMPTY_SET : collapsedNodes}
          onToggleCollapsed={onToggleCollapsed}
          onOpenNode={onOpenNode}
          searchMatchIds={searchMatchIds}
          getMemberCount={getMemberCount}
        />
      ))}
    </div>
  )
}

function TreeRow({
  node,
  depth,
  collapsedNodes,
  onToggleCollapsed,
  onOpenNode,
  searchMatchIds,
  getMemberCount,
}: {
  node: OrgTreeNode
  depth: number
} & Omit<OrgStructureTreeProps, 'tree'>) {
  const children = node.children ?? []
  const hasChildren = children.length > 0
  const isCollapsed = collapsedNodes.has(node.id)
  const isMatch = !!searchMatchIds?.has(node.id)
  const members = getMemberCount?.(node.id) ?? 0
  const label = typeLabel(node)

  return (
    <div role="treeitem" aria-expanded={hasChildren ? !isCollapsed : undefined}>
      <div
        className={`flex items-stretch ${isMatch ? 'bg-amber-50/60 dark:bg-amber-900/10' : ''}`}
        /* Indentation is padding on the row, not a nested container, so a
           deep node keeps the full width for its name instead of losing a
           column per generation. */
        style={{ paddingLeft: `${depth * 14}px` }}
      >
        {/* Disclosure. Separate from the row's own tap target: expanding a
            branch and opening its detail are different intentions, and a
            phone has no hover to distinguish them. */}
        {hasChildren ? (
          <button
            type="button"
            onClick={() => onToggleCollapsed(node.id)}
            aria-label={`${isCollapsed ? 'Expand' : 'Collapse'} ${node.name}`}
            className="flex w-9 shrink-0 items-center justify-center text-gray-400 active:bg-gray-100 dark:active:bg-gray-800"
          >
            <ChevronRight className={`h-4 w-4 transition-transform ${isCollapsed ? '' : 'rotate-90'}`} />
          </button>
        ) : (
          <span className="w-9 shrink-0" aria-hidden />
        )}

        <button
          type="button"
          onClick={() => onOpenNode(node)}
          className="flex min-h-[44px] min-w-0 flex-1 items-center gap-2 py-2 pr-3 text-left active:bg-gray-50 dark:active:bg-gray-900"
        >
          <span
            className="h-2.5 w-2.5 shrink-0 rounded-full"
            style={{ backgroundColor: node.color || '#9ca3af' }}
          />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium text-gray-900 dark:text-white">
              {node.name}
            </span>
            {(label || node.is_non_investment) && (
              <span className="block truncate text-[11px] text-gray-400">
                {label}
                {node.is_non_investment && (label ? ' · Non-investment' : 'Non-investment')}
              </span>
            )}
          </span>
          {members > 0 && (
            <span className="flex shrink-0 items-center gap-1 text-[11px] tabular-nums text-gray-400">
              <Users className="h-3 w-3" />
              {members}
            </span>
          )}
        </button>
      </div>

      {hasChildren && !isCollapsed && (
        <div role="group" className="divide-y divide-gray-100 border-t border-gray-100 dark:divide-gray-800 dark:border-gray-800">
          {children.map(child => (
            <TreeRow
              key={child.id}
              node={child}
              depth={depth + 1}
              collapsedNodes={collapsedNodes}
              onToggleCollapsed={onToggleCollapsed}
              onOpenNode={onOpenNode}
              searchMatchIds={searchMatchIds}
              getMemberCount={getMemberCount}
            />
          ))}
        </div>
      )}
    </div>
  )
}
