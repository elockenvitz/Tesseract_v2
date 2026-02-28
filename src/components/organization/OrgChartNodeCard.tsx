/**
 * OrgChartNodeCard — renders a single org chart node with its children.
 *
 * Extracted from OrganizationPage for maintainability.
 * Recursive component: renders child nodes with T-shaped connectors.
 */

import { useState, useRef, useEffect } from 'react'
import {
  Building2,
  FolderOpen,
  Users,
  Briefcase,
  Plus,
  ChevronDown,
  ChevronRight,
  Trash2,
  UserPlus,
  Check,
  Link2,
  MoreHorizontal,
  Maximize2,
} from 'lucide-react'
import type { OrgGraphNode } from '../../lib/org-graph'

// ─── Types ──────────────────────────────────────────────────────────────

export interface OrgChartNode {
  id: string
  organization_id: string
  parent_id: string | null
  node_type: 'division' | 'department' | 'team' | 'portfolio' | 'custom'
  custom_type_label?: string
  name: string
  description?: string
  color: string
  icon: string
  sort_order: number
  settings: any
  is_active: boolean
  is_non_investment?: boolean
  coverage_admin_override?: boolean
  created_at: string
  children?: OrgChartNode[]
  isLinkedInstance?: boolean
}

export interface OrgChartNodeMember {
  id: string
  node_id: string
  user_id: string
  role: string
  focus: string | null
  is_coverage_admin?: boolean
  coverage_admin_blocked?: boolean
  created_at: string
  user?: {
    id: string
    email: string
    full_name: string | null
    avatar_url: string | null
    coverage_admin?: boolean
  }
}

export interface Portfolio {
  id: string
  name: string
  team_id: string | null
  description: string | null
  portfolio_type: string
  is_active: boolean
}

export interface OrgChartNodeCardProps {
  node: OrgChartNode
  isOrgAdmin: boolean
  onEdit: (node: OrgChartNode) => void
  onAddChild: (parentId: string) => void
  onAddSibling?: (parentId: string | null) => void
  onDelete: (nodeId: string) => void
  onAddMember: (node: OrgChartNode) => void
  onRemoveMember: (memberId: string) => void
  getNodeMembers: (nodeId: string) => OrgChartNodeMember[]
  getSharedTeams?: (nodeId: string) => string[]
  getTeamMembers?: (teamId: string) => any[]
  getTeamPortfolios?: (teamId: string) => Portfolio[]
  onAddTeamMember?: (teamId: string) => void
  onRemoveTeamMember?: (memberId: string) => void
  onInsertBetween?: (parentId: string, childIds: string[]) => void
  onViewDetails: (node: OrgChartNode) => void
  getCoverageStats?: (teamId: string) => { assetCount: number; analystCount: number } | undefined
  onViewTeamCoverage?: (teamId: string, teamName: string) => void
  depth?: number
  parentId?: string | null
  onRequestToJoin?: (node: OrgChartNode) => void
  isUserMember?: (nodeId: string) => boolean
  getNodeName?: (nodeId: string) => string | undefined
  defaultExpanded?: boolean
  collapsedNodes?: Set<string>
  onToggleCollapsed?: (nodeId: string) => void
  searchHighlightIds?: Set<string>
  onFocusNode?: (nodeId: string) => void
  getGraphNode?: (nodeId: string) => OrgGraphNode | undefined
  /** When false, hides HealthPill, risk dots, and risk indicator on cards */
  showGovernanceSignals?: boolean
}

// ─── Component ──────────────────────────────────────────────────────────

export function OrgChartNodeCard({ node, isOrgAdmin, onEdit, onAddChild, onAddSibling, onDelete, onAddMember, onRemoveMember, getNodeMembers, getSharedTeams, getTeamMembers, getTeamPortfolios, onAddTeamMember, onRemoveTeamMember, onInsertBetween, onViewDetails, getCoverageStats, onViewTeamCoverage, depth = 0, parentId, onRequestToJoin, isUserMember, getNodeName, defaultExpanded = true, collapsedNodes, onToggleCollapsed, searchHighlightIds, onFocusNode, getGraphNode, showGovernanceSignals = false }: OrgChartNodeCardProps) {
  const graphNode = getGraphNode?.(node.id)
  const [showAddMenu, setShowAddMenu] = useState(false)
  const addMenuRef = useRef<HTMLDivElement>(null)

  // Close menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (addMenuRef.current && !addMenuRef.current.contains(event.target as Node)) {
        setShowAddMenu(false)
      }
    }
    if (showAddMenu) {
      document.addEventListener('mousedown', handleClickOutside)
    }
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [showAddMenu])

  // Use persistent collapsed state if available, otherwise local state
  const isPersistentCollapse = collapsedNodes !== undefined && onToggleCollapsed !== undefined
  const [localExpanded, setLocalExpanded] = useState(defaultExpanded)
  const isExpanded = isPersistentCollapse ? !collapsedNodes.has(node.id) : localExpanded
  const setIsExpanded = isPersistentCollapse
    ? (_val: boolean) => onToggleCollapsed(node.id)
    : setLocalExpanded
  const [showSharedTooltip, setShowSharedTooltip] = useState(false)
  const isSearchActive = searchHighlightIds && searchHighlightIds.size > 0
  const isHighlighted = isSearchActive && searchHighlightIds.has(node.id)
  const isDimmed = isSearchActive && !searchHighlightIds.has(node.id)
  const hasChildren = node.children && node.children.length > 0
  const sharedTeams = getSharedTeams?.(node.id) || []
  const isSharedPortfolio = node.node_type === 'portfolio' && sharedTeams.length > 0

  // For team nodes linked to teams table
  const linkedTeamId = node.node_type === 'team' ? node.settings?.team_id : null
  const coverageTeamId = node.node_type === 'team' ? node.id : null
  const teamPortfolios = linkedTeamId && getTeamPortfolios ? getTeamPortfolios(linkedTeamId) : []

  // Member count from graph (includes portfolio_team members via unified array)
  const totalMemberCount = graphNode?.totalMemberCount ?? 0

  const getNodeIcon = () => {
    switch (node.node_type) {
      case 'division': return <Building2 className="w-4 h-4" style={{ color: node.color }} />
      case 'department': return <FolderOpen className="w-4 h-4" style={{ color: node.color }} />
      case 'team': return <Users className="w-4 h-4" style={{ color: node.color }} />
      case 'portfolio': return <Briefcase className="w-4 h-4" style={{ color: node.color }} />
      default: return <FolderOpen className="w-4 h-4" style={{ color: node.color }} />
    }
  }

  const getTypeLabel = () => {
    if (node.node_type === 'custom' && node.custom_type_label) {
      return node.custom_type_label
    }
    return node.node_type.charAt(0).toUpperCase() + node.node_type.slice(1)
  }

  return (
    <div className={`inline-flex flex-col items-center transition-opacity ${isDimmed ? 'opacity-40' : ''}`}>
      {/* Node Card Container */}
      <div className="relative group/node">
        {/* Hover overlay actions */}
        {(isOrgAdmin || (hasChildren && onFocusNode)) && (
          <div className="absolute -top-1 -right-1 opacity-0 group-hover/node:opacity-100 transition-all duration-200 z-20 flex items-center space-x-0.5 bg-white rounded-lg shadow-md p-1">
            {hasChildren && onFocusNode && (
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  onFocusNode(node.id)
                }}
                className="p-1.5 hover:bg-indigo-50 rounded transition-colors"
                title={`Focus on ${node.name}`}
              >
                <Maximize2 className="w-3.5 h-3.5 text-indigo-400" />
              </button>
            )}
            {isOrgAdmin && (
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  onDelete(node.id)
                }}
                className="p-1.5 hover:bg-red-50 rounded transition-colors"
                title={`Delete ${getTypeLabel()}`}
              >
                <Trash2 className="w-3.5 h-3.5 text-red-400" />
              </button>
            )}
          </div>
        )}

        {/* Request to Join button for non-admins (team nodes only) */}
        {!isOrgAdmin && node.node_type === 'team' && onRequestToJoin && isUserMember && !isUserMember(node.id) && (
          <div className="absolute -top-1 -right-1 opacity-0 group-hover/node:opacity-100 transition-all duration-200 z-20">
            <button
              onClick={(e) => {
                e.stopPropagation()
                onRequestToJoin(node)
              }}
              className="flex items-center space-x-1 px-2 py-1 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-medium rounded-lg shadow-md transition-colors"
              title={`Request to join ${node.name}`}
            >
              <UserPlus className="w-3 h-3" />
              <span>Join</span>
            </button>
          </div>
        )}

        {/* Member indicator for non-admins */}
        {!isOrgAdmin && node.node_type === 'team' && isUserMember && isUserMember(node.id) && (
          <div className="absolute -top-1 -right-1 z-20">
            <span className="inline-flex items-center px-2 py-0.5 bg-green-100 text-green-700 text-xs font-medium rounded-full">
              <Check className="w-3 h-3 mr-0.5" />
              Member
            </span>
          </div>
        )}

        {/* Node Card */}
        <div
          className={`relative border rounded-lg cursor-pointer transition-all hover:shadow-md ${
            node.is_non_investment
              ? 'bg-gray-50 border-gray-300 border-dashed'
              : `bg-white ${isExpanded && hasChildren ? 'border-gray-300 shadow-sm' : 'border-gray-200 shadow-sm'}`
          } ${node.node_type === 'portfolio' ? 'border-l-2' : ''} ${isHighlighted ? 'ring-2 ring-indigo-400 ring-offset-1' : ''}`}
          style={{
            borderTopColor: node.is_non_investment ? '#9ca3af' : node.color,
            borderTopWidth: '3px',
            borderTopStyle: 'solid',
            ...(node.node_type === 'portfolio' ? { borderLeftColor: node.color } : {}),
            width: '216px',
            minHeight: '88px'
          }}
          onClick={() => setIsExpanded(!isExpanded)}
        >
          {/* Status cluster — bottom-left corner: severity dot + health % (governance only) */}
          {showGovernanceSignals && graphNode && (() => {
            const hasRisks = graphNode.riskFlags.length > 0
            const showHealth = node.node_type === 'team' || node.node_type === 'portfolio'
            if (!hasRisks && !showHealth) return null
            const maxSeverity = hasRisks
              ? (graphNode.riskFlags.some(f => f.severity === 'high') ? 'high'
                : graphNode.riskFlags.some(f => f.severity === 'medium') ? 'medium' : 'low')
              : null
            const dotColor = maxSeverity === 'high' ? 'bg-red-500' : maxSeverity === 'medium' ? 'bg-amber-500' : maxSeverity === 'low' ? 'bg-gray-400' : ''
            const healthColor = graphNode.healthScore >= 80 ? 'text-emerald-700' : graphNode.healthScore >= 50 ? 'text-amber-700' : 'text-red-700'
            return (
              <div className="absolute bottom-1 left-1.5 z-10 flex items-center gap-1" title={hasRisks ? `${graphNode.riskFlags.length} risk${graphNode.riskFlags.length !== 1 ? 's' : ''} · Health ${graphNode.healthScore}%` : `Health ${graphNode.healthScore}%`}>
                {hasRisks && (
                  <span className={`w-2 h-2 rounded-full ${dotColor} flex-shrink-0`} />
                )}
                {showHealth && (
                  <span className={`text-[9px] font-bold tabular-nums ${healthColor}`}>
                    {graphNode.healthScore}%
                  </span>
                )}
              </div>
            )
          })()}

          {/* Non-investment indicator */}
          {node.is_non_investment && (
            <div className="absolute top-2 left-2 z-10">
              <span className="inline-flex items-center px-1.5 py-0.5 bg-gray-200 text-gray-600 text-[10px] font-medium rounded">
                Non-Investment
              </span>
            </div>
          )}

          {/* Collaborative/Linked portfolio indicator */}
          {(isSharedPortfolio || node.isLinkedInstance) && !node.is_non_investment && (
            <div
              className="absolute top-2 left-2 z-10"
              onMouseEnter={() => setShowSharedTooltip(true)}
              onMouseLeave={() => setShowSharedTooltip(false)}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-center w-5 h-5 rounded-full bg-indigo-100 text-indigo-600">
                <Link2 className="w-3 h-3" />
              </div>
              {showSharedTooltip && (
                <div className="absolute z-30 top-full left-0 mt-2 px-3 py-2 bg-gray-900 text-white text-xs rounded-lg shadow-lg whitespace-nowrap">
                  <div className="font-medium mb-1">{node.isLinkedInstance ? 'Linked portfolio' : 'Shared with:'}</div>
                  {node.isLinkedInstance ? (
                    <div className="text-gray-300">Primary location: {(node.parent_id && getNodeName?.(node.parent_id)) || 'Unknown'}</div>
                  ) : sharedTeams.map((teamName, idx) => (
                    <div key={idx} className="text-gray-300">{teamName}</div>
                  ))}
                  <div className="absolute bottom-full left-2 border-4 border-transparent border-b-gray-900" />
                </div>
              )}
            </div>
          )}
          <div className="px-2.5 py-2 text-center">
            {/* Icon */}
            <div
              className="inline-flex items-center justify-center w-8 h-8 rounded-md mb-1.5"
              style={{ backgroundColor: `${node.color}15` }}
            >
              {getNodeIcon()}
            </div>

            {/* Name */}
            <button
              onClick={(e) => {
                e.stopPropagation()
                onViewDetails(node)
              }}
              className="block w-full font-semibold text-gray-900 text-[13px] leading-tight hover:text-indigo-600 hover:underline"
            >
              {node.name}
            </button>
            <p className="text-[11px] text-gray-500 mt-0.5">
              {getTypeLabel()}
              {totalMemberCount > 0 && ` · ${totalMemberCount} member${totalMemberCount !== 1 ? 's' : ''}`}
              {linkedTeamId && teamPortfolios.length > 0 && ` · ${teamPortfolios.length} portfolio${teamPortfolios.length !== 1 ? 's' : ''}`}
            </p>

            {/* Role distribution line for team nodes */}
            {node.node_type === 'team' && (() => {
              const nodeMembers = getNodeMembers(node.id)
              const pmCount = nodeMembers.filter(m => /\bpm\b/i.test(m.role) || /portfolio\s*manager/i.test(m.role)).length
              const analystCount = nodeMembers.filter(m => /analyst/i.test(m.role) || /research/i.test(m.role)).length
              if (nodeMembers.length === 0) return null
              return (
                <div className="flex items-center justify-center gap-1 mt-1 text-[10px]">
                  <span className={pmCount === 0 ? 'text-red-600 font-medium' : 'text-gray-500'}>
                    {pmCount} PM{pmCount !== 1 ? 's' : ''}
                  </span>
                  <span className="text-gray-300">&bull;</span>
                  <span className="text-gray-500">{analystCount} Analyst{analystCount !== 1 ? 's' : ''}</span>
                </div>
              )
            })()}

            {/* Expand indicator for nodes with children */}
            {hasChildren && (
              <div className="mt-1">
                {isExpanded ? (
                  <ChevronDown className="w-3.5 h-3.5 text-gray-400 mx-auto" />
                ) : (
                  <ChevronRight className="w-3.5 h-3.5 text-gray-400 mx-auto" />
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Add button below node */}
      {isOrgAdmin && (
        <div className="relative group/addbutton" style={{ width: '24px', height: hasChildren && isExpanded ? '24px' : '32px', display: 'flex', justifyContent: 'center' }}>
          {hasChildren && isExpanded && (
            <div style={{ width: '2px', height: '100%', backgroundColor: '#9ca3af' }} />
          )}
          <div ref={addMenuRef} className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-20">
            <button
              onClick={(e) => {
                e.stopPropagation()
                setShowAddMenu(!showAddMenu)
              }}
              className={`w-5 h-5 bg-indigo-500 hover:bg-indigo-600 rounded-full flex items-center justify-center shadow-md transition-opacity ${showAddMenu ? 'opacity-100' : 'opacity-0 group-hover/addbutton:opacity-100'}`}
              title="Add node"
            >
              <Plus className="w-3 h-3 text-white" />
            </button>
            {showAddMenu && (
              <div className="absolute top-full left-1/2 -translate-x-1/2 mt-1 bg-white rounded-lg shadow-lg border border-gray-200 py-1 min-w-[160px] z-30">
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    onAddChild(node.id)
                    setShowAddMenu(false)
                  }}
                  className="w-full px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-50 flex items-center space-x-2"
                >
                  <ChevronDown className="w-4 h-4 text-gray-400" />
                  <span>Add child below</span>
                </button>
                {onAddSibling && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      onAddSibling(parentId || null)
                      setShowAddMenu(false)
                    }}
                    className="w-full px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-50 flex items-center space-x-2"
                  >
                    <ChevronRight className="w-4 h-4 text-gray-400" />
                    <span>Add sibling</span>
                  </button>
                )}
                {hasChildren && onInsertBetween && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      onInsertBetween(node.id, node.children!.map(c => c.id))
                      setShowAddMenu(false)
                    }}
                    className="w-full px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-50 flex items-center space-x-2"
                  >
                    <MoreHorizontal className="w-4 h-4 text-gray-400" />
                    <span>Insert between</span>
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Expanded Children with connectors */}
      {isExpanded && hasChildren && (
        <>

          {/* Children wrapper */}
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'center' }}>
            {node.children!.map((childNode, index) => (
              <div key={childNode.id} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', minWidth: '216px', flexShrink: 0, marginLeft: index > 0 ? '16px' : '0' }}>
                {/* T-connector with overlapping lines */}
                <div style={{ position: 'relative', width: '100%', height: '18px', overflow: 'visible' }}>
                  {/* Left horizontal segment */}
                  {index > 0 && (
                    <div style={{
                      position: 'absolute',
                      top: '0',
                      left: '-20px',
                      width: 'calc(50% + 21px)',
                      height: '2px',
                      backgroundColor: '#9ca3af'
                    }} />
                  )}
                  {/* Right horizontal segment */}
                  {index < node.children!.length - 1 && (
                    <div style={{
                      position: 'absolute',
                      top: '0',
                      right: '-20px',
                      width: 'calc(50% + 21px)',
                      height: '2px',
                      backgroundColor: '#9ca3af'
                    }} />
                  )}
                  {/* Center vertical drop */}
                  <div style={{
                    position: 'absolute',
                    top: '0',
                    left: '50%',
                    transform: 'translateX(-50%)',
                    width: '2px',
                    height: '100%',
                    backgroundColor: '#9ca3af'
                  }} />
                </div>
                {/* Child node */}
                <OrgChartNodeCard
                  node={childNode}
                  isOrgAdmin={isOrgAdmin}
                  onEdit={onEdit}
                  onAddChild={onAddChild}
                  onAddSibling={onAddSibling}
                  onDelete={onDelete}
                  onAddMember={onAddMember}
                  onRemoveMember={onRemoveMember}
                  getNodeMembers={getNodeMembers}
                  getSharedTeams={getSharedTeams}
                  getTeamMembers={getTeamMembers}
                  getTeamPortfolios={getTeamPortfolios}
                  onAddTeamMember={onAddTeamMember}
                  onRemoveTeamMember={onRemoveTeamMember}
                  onInsertBetween={onInsertBetween}
                  onViewDetails={onViewDetails}
                  getCoverageStats={getCoverageStats}
                  onViewTeamCoverage={onViewTeamCoverage}
                  depth={depth + 1}
                  parentId={node.id}
                  onRequestToJoin={onRequestToJoin}
                  isUserMember={isUserMember}
                  getNodeName={getNodeName}
                  collapsedNodes={collapsedNodes}
                  onToggleCollapsed={onToggleCollapsed}
                  searchHighlightIds={searchHighlightIds}
                  onFocusNode={onFocusNode}
                  getGraphNode={getGraphNode}
                  showGovernanceSignals={showGovernanceSignals}
                />
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
