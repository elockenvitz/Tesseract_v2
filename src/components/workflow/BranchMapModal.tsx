import React, { useMemo } from 'react'
import { X, Orbit, Network, Activity, CheckCircle, Copy, GitBranch, Trash2, Archive } from 'lucide-react'
import { Button } from '../ui/Button'

interface BranchNode {
  id: string
  name: string
  branch_suffix: string | null
  branched_at: string
  created_at: string
  parent_workflow_id: string | null
  source_branch_id: string | null
  status: 'active' | 'inactive' | 'ended'
  deleted: boolean
  archived: boolean
  totalAssets: number
  activeAssets: number
  completedAssets: number
}

interface BranchMapModalProps {
  isOpen: boolean
  onClose: () => void
  workflowName: string
  workflowId: string
  branches: BranchNode[]
}

interface TreeNode extends BranchNode {
  children: TreeNode[]
  depth: number
  isCopied: boolean
}

export function BranchMapModal({ isOpen, onClose, workflowName, workflowId, branches }: BranchMapModalProps) {
  if (!isOpen) return null

  // Build the tree structure
  const branchTree = useMemo(() => {
    console.log('BranchMapModal - Total branches received:', branches.length)
    console.log('BranchMapModal - Branches:', branches.map(b => ({
      name: b.name,
      source_branch_id: b.source_branch_id,
      deleted: b.deleted,
      archived: b.archived
    })))

    // Create a map for quick lookups
    const branchMap = new Map<string, TreeNode>()

    // Initialize all branches as tree nodes
    branches.forEach(branch => {
      branchMap.set(branch.id, {
        ...branch,
        children: [],
        depth: 0,
        isCopied: false
      })
    })

    // Build parent-child relationships with proper hierarchy
    // Template -> Clean Branches -> Copied Branches (max 3 levels)
    const rootBranches: TreeNode[] = []

    // First pass: identify clean vs copied branches
    branches.forEach(branch => {
      const node = branchMap.get(branch.id)!

      // Mark as copied if it has a source_branch_id
      if (branch.source_branch_id) {
        node.isCopied = true
      }
    })

    // Second pass: build hierarchy
    branches.forEach(branch => {
      const node = branchMap.get(branch.id)!

      if (!branch.source_branch_id) {
        // This is a clean branch (created directly from template)
        rootBranches.push(node)
      } else if (branchMap.has(branch.source_branch_id)) {
        const sourceNode = branchMap.get(branch.source_branch_id)!

        // If source is a clean branch, add as child
        if (!sourceNode.isCopied) {
          sourceNode.children.push(node)
        } else {
          // If source is a copied branch, find the clean parent and add as sibling
          // by finding the clean branch that the source belongs to
          let cleanParent = sourceNode
          const sourceBranch = branches.find(b => b.id === branch.source_branch_id)

          if (sourceBranch?.source_branch_id && branchMap.has(sourceBranch.source_branch_id)) {
            const potentialCleanParent = branchMap.get(sourceBranch.source_branch_id)!
            if (!potentialCleanParent.isCopied) {
              cleanParent = potentialCleanParent
            }
          }

          // Add as sibling to source (child of the same clean parent)
          if (cleanParent && !cleanParent.isCopied) {
            cleanParent.children.push(node)
          } else {
            // Fallback: add as root if we can't find clean parent
            rootBranches.push(node)
          }
        }
      } else {
        // Source not found, add as root
        rootBranches.push(node)
      }
    })

    // Calculate depths (max depth of 2: 0 for clean branches, 1 for copied branches)
    const calculateDepth = (node: TreeNode, depth: number) => {
      node.depth = depth
      if (depth < 2) {
        node.children.forEach(child => calculateDepth(child, depth + 1))
      }
    }
    rootBranches.forEach(node => calculateDepth(node, 0))

    // Sort by creation date
    const sortByDate = (a: TreeNode, b: TreeNode) => {
      return new Date(a.branched_at || a.created_at).getTime() - new Date(b.branched_at || b.created_at).getTime()
    }

    rootBranches.sort(sortByDate)
    rootBranches.forEach(node => {
      node.children.sort(sortByDate)
    })

    return rootBranches
  }, [branches])

  const renderBranchNode = (node: TreeNode, isLast: boolean, parentLines: boolean[] = []) => {
    const statusColors = {
      active: 'bg-green-100 text-green-700 border-green-300',
      inactive: 'bg-gray-100 text-gray-600 border-gray-300',
      ended: 'bg-gray-100 text-gray-600 border-gray-300'
    }

    const statusIcons = {
      active: Activity,
      inactive: CheckCircle,
      ended: CheckCircle
    }

    const StatusIcon = statusIcons[node.status as keyof typeof statusIcons]

    return (
      <div key={node.id}>
        {/* Branch Node */}
        <div className="flex items-start">
          {/* Tree lines */}
          <div className="flex items-center mr-3">
            {parentLines.map((hasLine, idx) => (
              <div key={idx} className="w-6 relative">
                {hasLine && (
                  <div className="absolute left-3 top-0 bottom-0 w-0.5 bg-gray-300" />
                )}
              </div>
            ))}
            {node.depth > 0 && (
              <div className="relative w-6 h-6">
                {/* Vertical line from parent */}
                <div className="absolute left-3 top-0 h-3 w-0.5 bg-gray-300" />
                {/* Horizontal line to node */}
                <div className="absolute left-3 top-3 w-6 h-0.5 bg-gray-300" />
                {/* Continue vertical line if not last */}
                {!isLast && (
                  <div className="absolute left-3 top-3 bottom-0 w-0.5 bg-gray-300" style={{ height: 'calc(100% + 1rem)' }} />
                )}
              </div>
            )}
          </div>

          {/* Branch Card */}
          <div className="flex-1 mb-4">
            <div className="bg-white border border-gray-200 rounded-lg p-3 hover:shadow-md transition-shadow">
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <div className="flex items-center space-x-2 mb-1">
                    {node.isCopied ? (
                      <Copy className="w-4 h-4 text-blue-600" />
                    ) : (
                      <Network className="w-4 h-4 text-purple-600" />
                    )}
                    <h4 className="text-sm font-semibold text-gray-900">{node.name}</h4>
                    {node.branch_suffix && (
                      <span className="text-xs text-gray-500 font-normal">
                        ({node.branch_suffix})
                      </span>
                    )}
                    {!node.deleted && !node.archived && (
                      <span className={`px-2 py-0.5 rounded-full text-xs flex items-center space-x-1 ${statusColors[node.status]}`}>
                        <StatusIcon className="w-3 h-3" />
                        <span className="capitalize">{node.status}</span>
                      </span>
                    )}
                    {node.deleted && (
                      <span className="px-2 py-0.5 rounded-full text-xs flex items-center space-x-1 bg-red-100 text-red-700 border border-red-300">
                        <Trash2 className="w-3 h-3" />
                        <span>Deleted</span>
                      </span>
                    )}
                    {node.archived && (
                      <span className="px-2 py-0.5 rounded-full text-xs flex items-center space-x-1 bg-amber-100 text-amber-700 border border-amber-300">
                        <Archive className="w-3 h-3" />
                        <span>Archived</span>
                      </span>
                    )}
                  </div>

                  <div className="flex items-center space-x-4 text-xs text-gray-600 ml-6">
                    <span>
                      Created {new Date(node.branched_at || node.created_at).toLocaleDateString()}
                    </span>
                    {node.totalAssets > 0 && (
                      <>
                        <span>•</span>
                        <span>{node.totalAssets} assets</span>
                        <span className="text-green-600">{node.activeAssets} active</span>
                        <span className="text-blue-600">{node.completedAssets} completed</span>
                      </>
                    )}
                    {node.isCopied && (
                      <>
                        <span>•</span>
                        <span className="text-blue-600 flex items-center space-x-1">
                          <Copy className="w-3 h-3" />
                          <span>Copied from parent</span>
                        </span>
                      </>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Children */}
        {node.children.length > 0 && (
          <div>
            {node.children.map((child, idx) =>
              renderBranchNode(
                child,
                idx === node.children.length - 1,
                [...parentLines, !isLast]
              )
            )}
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-5xl max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="p-6 border-b border-gray-200 flex items-center justify-between">
          <div>
            <div className="flex items-center space-x-2 mb-1">
              <GitBranch className="w-5 h-5 text-indigo-600" />
              <h2 className="text-xl font-bold text-gray-900">Branch Map</h2>
            </div>
            <p className="text-sm text-gray-500">Visual timeline of how "{workflowName}" has branched over time</p>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {branches.length === 0 ? (
            <div className="text-center py-12">
              <Network className="w-16 h-16 text-gray-300 mx-auto mb-4" />
              <h3 className="text-lg font-medium text-gray-900 mb-2">No branches yet</h3>
              <p className="text-sm text-gray-500">
                When workflow branches are created, they will appear here in a timeline view
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {/* Workflow Template */}
              <div className="mb-6">
                <div className="bg-indigo-50 border-2 border-indigo-200 rounded-lg p-4">
                  <div className="flex items-center space-x-2">
                    <Orbit className="w-5 h-5 text-indigo-600" />
                    <h3 className="text-base font-semibold text-indigo-900">{workflowName}</h3>
                    <span className="px-2 py-0.5 rounded-full text-xs bg-indigo-200 text-indigo-800">
                      Template
                    </span>
                  </div>
                  <p className="text-xs text-indigo-700 mt-1 ml-7">
                    Original workflow template • {branches.length} {branches.length === 1 ? 'branch' : 'branches'} created
                  </p>
                </div>
              </div>

              {/* Branch Tree */}
              <div className="ml-4">
                {branchTree.map((node, idx) =>
                  renderBranchNode(node, idx === branchTree.length - 1, [])
                )}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-gray-200 bg-gray-50">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-6 text-xs text-gray-600">
              <div className="flex items-center space-x-1">
                <Network className="w-4 h-4 text-purple-600" />
                <span>Created from template</span>
              </div>
              <div className="flex items-center space-x-1">
                <Copy className="w-4 h-4 text-blue-600" />
                <span>Copied from branch</span>
              </div>
              <div className="flex items-center space-x-1">
                <Activity className="w-4 h-4 text-green-600" />
                <span>Active</span>
              </div>
              <div className="flex items-center space-x-1">
                <CheckCircle className="w-4 h-4 text-gray-600" />
                <span>Inactive</span>
              </div>
              <div className="flex items-center space-x-1">
                <Trash2 className="w-4 h-4 text-red-600" />
                <span>Deleted</span>
              </div>
              <div className="flex items-center space-x-1">
                <Archive className="w-4 h-4 text-amber-600" />
                <span>Archived</span>
              </div>
            </div>
            <Button onClick={onClose} variant="outline" size="sm">
              Close
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
