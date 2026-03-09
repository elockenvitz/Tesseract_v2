import React, { useState, useMemo, useRef } from 'react'
import { clsx } from 'clsx'
import {
  X, Search, ChevronDown, ChevronRight, ChevronUp, EyeOff, AlertCircle,
  Grid3X3, History, Users, Building2, FolderOpen, Check, Plus, MoreVertical, Pencil,
} from 'lucide-react'
import { Card } from '../../ui/Card'
import type { CoverageRecord, ListColumnId, ListGroupByLevel, AssetCoverageGroup, CoverageTarget } from '../../../lib/coverage/coverage-types'
import { calculateTenure, formatMarketCap, groupCoverageByAsset, detectConflicts, deriveCoverageTarget, type OrgNodeMap } from '../../../lib/coverage/coverage-utils'

// ─── Column definitions ──────────────────────────────────────────────

const LIST_COLUMN_DEFS: Record<ListColumnId, { label: string; width: number; filterable: boolean; sortable: boolean }> = {
  asset:        { label: 'Asset',         width: 3, filterable: true,  sortable: true },
  analyst:      { label: 'Analyst',       width: 2, filterable: true,  sortable: true },
  coversFor:    { label: 'Covers For',      width: 1, filterable: true,  sortable: true },
  coveredBy:    { label: 'Coverage',       width: 2, filterable: false, sortable: true },
  sector:       { label: 'Sector',        width: 2, filterable: true,  sortable: true },
  startDate:    { label: 'Start Date',    width: 1, filterable: false, sortable: true },
  tenure:       { label: 'Tenure',        width: 1, filterable: false, sortable: true },
  industry:     { label: 'Industry',      width: 2, filterable: true,  sortable: true },
  marketCap:    { label: 'Market Cap',    width: 1, filterable: false, sortable: true },
}

// ─── Props ────────────────────────────────────────────────────────────

export interface CoverageListViewProps {
  // Data
  filteredCoverage: CoverageRecord[]
  coverageRecords: CoverageRecord[] | undefined
  uncoveredAssets: Array<{ id: string; symbol: string; company_name: string; sector?: string; industry?: string; market_cap?: number }>
  assets: Array<{ id: string; symbol: string; company_name: string; sector?: string }> | undefined
  coverageLoading: boolean
  searchQuery: string
  viewerNodeIds: string[]

  // Org grouping data (passed through for flat-mode nested grouping)
  userTeamMemberships: Map<string, Array<{ id: string; name: string; type: string; role?: string }>> | undefined
  portfolioTeamMemberships: Map<string, string[]> | undefined
  allOrgChartNodes: { nodes: any[]; allNodes: any[]; nodeLinks: any[] } | undefined
  allOrgChartNodeMembers: Map<string, string[]> | undefined

  // List view state
  listVisibleColumns: ListColumnId[]
  setListVisibleColumns: React.Dispatch<React.SetStateAction<ListColumnId[]>>
  listGroupBy: 'asset' | 'none'
  listGroupByLevels: ListGroupByLevel[]
  listSortColumn: ListColumnId | null
  listSortDirection: 'asc' | 'desc'
  listColumnFilters: Partial<Record<ListColumnId, string>>
  setListColumnFilters: React.Dispatch<React.SetStateAction<Partial<Record<ListColumnId, string>>>>

  // Group state
  collapsedGroups: Set<string>
  setCollapsedGroups: React.Dispatch<React.SetStateAction<Set<string>>>
  hiddenGroups: Set<string>
  setHiddenGroups: React.Dispatch<React.SetStateAction<Set<string>>>
  hideEmptyGroups: boolean
  setHideEmptyGroups: React.Dispatch<React.SetStateAction<boolean>>

  // Callbacks
  handleColumnSort: (columnId: ListColumnId) => void
  handleFilterClick: (columnId: ListColumnId, e: React.MouseEvent) => void
  activeFilterColumn: ListColumnId | null
  setActiveFilterColumn: React.Dispatch<React.SetStateAction<ListColumnId | null>>
  getUniqueFilterValues: (columnId: ListColumnId, records: CoverageRecord[]) => string[]
  setGroupContextMenu: (ctx: { x: number; y: number; groupKey: string; groupName: string } | null) => void

  // Actions
  setViewHistoryAssetId: (id: string | null) => void
  setDeleteConfirm: (confirm: { isOpen: boolean; coverageId: string | null; assetSymbol: string; analystName: string }) => void
  setAddingCoverage: (coverage: any) => void
  setAssetSearchQuery: (query: string) => void
  setAnalystSearchQuery: (query: string) => void
  setShowAssetDropdown: (show: boolean) => void
  setShowAnalystDropdown: (show: boolean) => void
  setRequestingChange: (change: any) => void
  hasAnyCoverageAdminRights: boolean
  canChangeVisibility: (coverage: CoverageRecord) => boolean
  editingVisibility: { coverageId: string; currentVisibility: 'team' | 'division' | 'firm' } | null
  setEditingVisibility: (v: { coverageId: string; currentVisibility: 'team' | 'division' | 'firm' } | null) => void
  updateVisibilityMutation: { mutate: (args: { coverageId: string; visibility: 'team' | 'division' | 'firm' }) => void }
  coverageSettings: { default_visibility?: string; visibility_change_permission?: string; enable_hierarchy?: boolean } | undefined
  userTeams: Array<{ id: string; name?: string }> | undefined
  getLocalDateString: () => string

  // Flat-mode grouping render (delegated from CoverageManager for now)
  renderFlatGroupedContent: (() => React.ReactNode) | null

  // Inline edit callback for assignment fields (role, visibility)
  onUpdateAssignment: (coverageId: string, updates: { role?: string; is_lead?: boolean; visibility?: string }) => void
}

// ─── Hierarchy-aware color helper ────────────────────────────────────

function targetColorClasses(target: CoverageTarget): string {
  if (target.kind === 'unknown') return 'bg-amber-50 text-amber-700'
  if (target.kind === 'firm') return 'bg-gray-100 text-gray-600'
  switch (target.nodeType) {
    case 'division':   return 'bg-blue-50 text-blue-700'
    case 'department': return 'bg-teal-50 text-teal-700'
    case 'team':       return 'bg-emerald-50 text-emerald-700'
    case 'portfolio':  return 'bg-amber-50 text-amber-700'
    default:           return 'bg-gray-100 text-gray-600'
  }
}

function targetIcon(target: CoverageTarget): React.ReactNode {
  if (target.kind === 'unknown') return <AlertCircle className="h-2.5 w-2.5" />
  if (target.kind === 'firm') return <Building2 className="h-2.5 w-2.5" />
  if (target.nodeType === 'division' || target.nodeType === 'department') return <FolderOpen className="h-2.5 w-2.5" />
  return <Users className="h-2.5 w-2.5" />
}

// ─── Covers-for pill (shows actual group name with breadcrumb tooltip) ──

function CoversForPill({ target }: { target: CoverageTarget }) {
  const tooltip = target.kind === 'unknown'
    ? 'This assignment has no coverage scope set.'
    : target.breadcrumb?.length
      ? target.breadcrumb.join(' \u2192 ')
      : `Covers for: ${target.name}`
  return (
    <span
      title={tooltip}
      className={clsx(
        'inline-flex items-center gap-0.5 px-1.5 py-px text-[10px] font-medium rounded-full leading-tight',
        targetColorClasses(target),
      )}
    >
      {targetIcon(target)}
      {target.name}
    </span>
  )
}

// ─── Scope pills with counts (for parent "Covers For" column) ───────

function ScopePillWithCount({ target, count }: { target: CoverageTarget; count: number }) {
  const tooltip = target.kind === 'unknown'
    ? 'This assignment has no coverage scope set.'
    : target.breadcrumb?.length
      ? target.breadcrumb.join(' \u2192 ')
      : `Covers for: ${target.name}`
  return (
    <span
      title={tooltip}
      className={clsx(
        'inline-flex items-center gap-0.5 px-1.5 py-px text-[10px] font-medium rounded-full leading-tight',
        targetColorClasses(target),
      )}
    >
      {targetIcon(target)}
      {target.name}
      {count > 1 && <span className="opacity-60 ml-0.5">({count})</span>}
    </span>
  )
}

function GroupNamePills({ targets, assignments, orgNodeMap }: {
  targets: CoverageTarget[]
  assignments?: CoverageRecord[]
  orgNodeMap?: OrgNodeMap
}) {
  const real = targets.filter(t => t.kind !== 'unknown')
  if (real.length === 0) return null

  // Count assignments per scope
  const countPerScope = new Map<string, number>()
  if (assignments && orgNodeMap) {
    for (const a of assignments) {
      const t = deriveCoverageTarget(a, orgNodeMap)
      const key = t.kind === 'org_node' && t.id ? `node:${t.id}` : t.kind
      countPerScope.set(key, (countPerScope.get(key) || 0) + 1)
    }
  }

  const getCount = (target: CoverageTarget) => {
    const key = target.kind === 'org_node' && target.id ? `node:${target.id}` : target.kind
    return countPerScope.get(key) || 0
  }

  // 1–2 groups: show each with count
  if (real.length <= 2) {
    return (
      <div className="flex items-center gap-0.5 flex-wrap">
        {real.map(target => (
          <ScopePillWithCount
            key={target.id ?? target.kind}
            target={target}
            count={assignments ? getCount(target) : 0}
          />
        ))}
      </div>
    )
  }

  // 3+ groups: show count with tooltip listing all
  const allNames = real.map(t => t.name).join(', ')
  return (
    <span
      title={allNames}
      className="px-1.5 py-px text-[10px] font-medium rounded-full leading-tight bg-gray-100 text-gray-600"
    >
      {real.length} scopes
    </span>
  )
}

// ─── Role pills ─────────────────────────────────────────────────────

/** Role pills — show explicit role assignment if present. */
function RolePill({ role }: { role?: string | null }) {
  switch (role) {
    case 'primary':   return <span className="px-1.5 py-px text-[10px] font-medium rounded-full border bg-yellow-50 text-yellow-700 border-yellow-200 leading-tight">Primary</span>
    case 'secondary': return <span className="px-1.5 py-px text-[10px] font-medium rounded-full border bg-blue-50 text-blue-600 border-blue-200 leading-tight">Secondary</span>
    case 'tertiary':  return <span className="px-1.5 py-px text-[10px] font-medium rounded-full border bg-gray-50 text-gray-500 border-gray-200 leading-tight">Tertiary</span>
    default:          return null
  }
}

// ─── Outer group key derivation ──────────────────────────────────────

/** Walk UP the org tree from a node to find the nearest ancestor of the given type. */
function findAncestorOfType(nodeId: string, targetType: string, orgNodeMap?: OrgNodeMap): string | undefined {
  if (!orgNodeMap) return undefined
  const visited = new Set<string>()
  let currentId: string | null | undefined = nodeId
  while (currentId && !visited.has(currentId)) {
    visited.add(currentId)
    const node = orgNodeMap.get(currentId)
    if (!node) break
    if (node.node_type === targetType) return node.name
    currentId = node.parent_id
  }
  return undefined
}

function deriveOuterGroupKey(group: AssetCoverageGroup, level: ListGroupByLevel, orgNodeMap?: OrgNodeMap): string {
  switch (level) {
    case 'sector':    return group.sector || 'Uncategorized'
    case 'industry':  return (group.assignments[0]?.assets as any)?.industry || 'Unknown'
    case 'analyst':   return group.coveredByNames[0] || 'Unassigned'
    case 'team': {
      const names = [...new Set(group.assignments.map(a => {
        if (!a.teams?.id) return null
        // Only use direct node name if it's a team; otherwise walk up
        if (a.teams.node_type === 'team') return a.teams.name
        return findAncestorOfType(a.teams.id, 'team', orgNodeMap) || a.teams.name
      }).filter(Boolean))]
      return names.length === 1 ? names[0]! : names.length > 1 ? names.join(', ') : 'No Team'
    }
    case 'portfolio': {
      const names = [...new Set(group.assignments.map(a => a.portfolios?.name).filter(Boolean))]
      return names.length === 1 ? names[0]! : names.length > 1 ? names.join(', ') : 'No Portfolio'
    }
    case 'division':
    case 'department': {
      // Walk up the org tree from each assignment's org node to find ancestor of the target type
      const names = [...new Set(group.assignments.map(a => {
        if (!a.teams?.id) return null
        // If the node IS the target type, use its name directly
        if (a.teams.node_type === level) return a.teams.name
        // Otherwise walk up to find ancestor of target type
        return findAncestorOfType(a.teams.id, level, orgNodeMap) || null
      }).filter(Boolean))]
      return names.length === 1 ? names[0]! : names.length > 1 ? names.join(', ') : `No ${level.charAt(0).toUpperCase() + level.slice(1)}`
    }
    default: return 'Other'
  }
}

// ─── Grouped-mode column layout ─────────────────────────────────────
// Fixed columns: Chevron | Asset | Covers For | Analysts | Sector | Industry | Mkt Cap | Actions
// No optional toggling — all columns always visible in grouped mode.

// ─── Component ────────────────────────────────────────────────────────

export function CoverageListView(props: CoverageListViewProps) {
  const {
    filteredCoverage, coverageRecords, uncoveredAssets, assets, coverageLoading, searchQuery,
    viewerNodeIds,
    allOrgChartNodes,
    listVisibleColumns, setListVisibleColumns,
    listGroupBy,
    listGroupByLevels,
    listSortColumn, listSortDirection,
    listColumnFilters, setListColumnFilters,
    collapsedGroups, setCollapsedGroups,
    hiddenGroups, setHiddenGroups,
    hideEmptyGroups, setHideEmptyGroups,
    handleColumnSort, handleFilterClick,
    activeFilterColumn, setActiveFilterColumn,
    getUniqueFilterValues,
    setGroupContextMenu,
    setViewHistoryAssetId, setDeleteConfirm,
    setAddingCoverage, setAssetSearchQuery, setAnalystSearchQuery,
    setShowAssetDropdown, setShowAnalystDropdown, setRequestingChange,
    hasAnyCoverageAdminRights,
    canChangeVisibility, editingVisibility, setEditingVisibility, updateVisibilityMutation,
    coverageSettings, userTeams, getLocalDateString,
    renderFlatGroupedContent,
    onUpdateAssignment,
  } = props

  // ── Local state ──────────────────────────────────────────────────
  const [expandedAssets, setExpandedAssets] = useState<Set<string>>(new Set())
  const [showColumnManager, setShowColumnManager] = useState(false)
  const [showConflictsOnly, setShowConflictsOnly] = useState(false)
  const [showMissingGroupsOnly, setShowMissingGroupsOnly] = useState(false)
  const [kebabOpen, setKebabOpen] = useState<string | null>(null)
  const columnManagerRef = useRef<HTMLDivElement>(null)

  // Fixed grouped grid: chevron | Asset | Covers For | Analysts | Sector | Industry | Mkt Cap | Actions
  const gridCols = '28px 2.5fr 2fr 0.7fr 1.2fr 1.2fr 0.8fr 40px'

  // Effective columns for flat mode
  const effectiveColumns = useMemo(() => {
    const valid = listVisibleColumns.filter(c => c in LIST_COLUMN_DEFS)
    if (listGroupBy === 'asset') {
      return valid.filter(c => c !== 'analyst' && c !== 'coversFor')
        .concat(valid.includes('coveredBy') ? [] : ['coveredBy' as ListColumnId])
    }
    return valid.filter(c => c !== 'coveredBy')
  }, [listGroupBy, listVisibleColumns])

  const colDefs = LIST_COLUMN_DEFS
  const totalColumnWidth = effectiveColumns.reduce((sum, c) => sum + (colDefs[c]?.width ?? 1), 0) + 1

  // ── Org node map (for breadcrumbs and target derivation) ────────
  const orgNodeMap: OrgNodeMap | undefined = useMemo(() => {
    const allNodes = allOrgChartNodes?.allNodes
    if (!allNodes?.length) return undefined
    const map: OrgNodeMap = new Map()
    for (const n of allNodes) {
      map.set(n.id, { id: n.id, name: n.name, node_type: n.node_type, parent_id: n.parent_id })
    }
    return map
  }, [allOrgChartNodes?.allNodes])

  // ── Grouped data ─────────────────────────────────────────────────
  const assetGroups = useMemo(
    () => groupCoverageByAsset(filteredCoverage, viewerNodeIds, orgNodeMap),
    [filteredCoverage, viewerNodeIds, orgNodeMap],
  )

  const allConflicts = useMemo(
    () => detectConflicts(filteredCoverage),
    [filteredCoverage],
  )

  // Asset groups with at least one assignment with no scope + total missing count
  const { missingGroupAssetIds, missingGroupCount } = useMemo(() => {
    const ids = new Set<string>()
    let count = 0
    for (const g of assetGroups) {
      for (const a of g.assignments) {
        if (deriveCoverageTarget(a, orgNodeMap).kind === 'unknown') {
          ids.add(g.assetId)
          count++
        }
      }
    }
    return { missingGroupAssetIds: ids, missingGroupCount: count }
  }, [assetGroups, orgNodeMap])

  const displayedGroups = useMemo(() => {
    let groups = assetGroups
    if (showConflictsOnly) {
      const conflictAssetIds = new Set(allConflicts.map(c => c.assetId))
      groups = groups.filter(g => conflictAssetIds.has(g.assetId))
    }
    if (showMissingGroupsOnly) {
      groups = groups.filter(g => missingGroupAssetIds.has(g.assetId))
    }
    return groups
  }, [assetGroups, allConflicts, showConflictsOnly, showMissingGroupsOnly, missingGroupAssetIds])

  // Search in grouped mode
  const groupsMatchingSearch = useMemo(() => {
    if (!searchQuery || listGroupBy !== 'asset') return displayedGroups
    const q = searchQuery.toLowerCase()
    return displayedGroups.filter(g =>
      g.symbol.toLowerCase().includes(q) ||
      g.companyName.toLowerCase().includes(q) ||
      g.assignments.some(a => a.analyst_name.toLowerCase().includes(q))
    )
  }, [displayedGroups, searchQuery, listGroupBy])

  // Sort grouped asset rows by the active sort column
  const groupsWithSearchMatch = useMemo(() => {
    if (!listSortColumn) return groupsMatchingSearch
    const sorted = [...groupsMatchingSearch]
    sorted.sort((a, b) => {
      let aVal: any, bVal: any
      switch (listSortColumn) {
        case 'asset':
          aVal = a.symbol; bVal = b.symbol; break
        case 'coveredBy':
          aVal = new Set(a.assignments.map(r => r.user_id)).size
          bVal = new Set(b.assignments.map(r => r.user_id)).size
          return listSortDirection === 'asc' ? aVal - bVal : bVal - aVal
        case 'coversFor':
          aVal = a.groupNames[0] || ''; bVal = b.groupNames[0] || ''; break
        case 'sector':
          aVal = a.sector || ''; bVal = b.sector || ''; break
        case 'industry':
          aVal = (a.assignments[0]?.assets as any)?.industry || ''
          bVal = (b.assignments[0]?.assets as any)?.industry || ''
          break
        case 'marketCap':
          aVal = (a.assignments[0]?.assets as any)?.market_cap || 0
          bVal = (b.assignments[0]?.assets as any)?.market_cap || 0
          return listSortDirection === 'asc' ? aVal - bVal : bVal - aVal
        default: return 0
      }
      const cmp = String(aVal).localeCompare(String(bVal))
      return listSortDirection === 'asc' ? cmp : -cmp
    })
    return sorted
  }, [groupsMatchingSearch, listSortColumn, listSortDirection])

  const autoExpandedAssets = useMemo(() => {
    if (!searchQuery || listGroupBy !== 'asset') return new Set<string>()
    const set = new Set<string>()
    const q = searchQuery.toLowerCase()
    for (const g of groupsWithSearchMatch) {
      if (g.assignments.some(a => a.analyst_name.toLowerCase().includes(q))) {
        set.add(g.assetId)
      }
    }
    return set
  }, [groupsWithSearchMatch, searchQuery, listGroupBy])

  // Outer grouping sections for asset mode (e.g. Sector → Asset groups)
  const outerGroupedSections = useMemo(() => {
    if (listGroupByLevels.length === 0) return null
    // Use the first grouping level as the outer section
    const level = listGroupByLevels[0]
    const map = new Map<string, AssetCoverageGroup[]>()
    for (const g of groupsWithSearchMatch) {
      const key = deriveOuterGroupKey(g, level, orgNodeMap)
      const arr = map.get(key)
      if (arr) arr.push(g)
      else map.set(key, [g])
    }
    return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b))
  }, [groupsWithSearchMatch, listGroupByLevels, orgNodeMap])

  const isExpanded = (assetId: string) => expandedAssets.has(assetId) || autoExpandedAssets.has(assetId)

  const toggleExpand = (assetId: string) => {
    setExpandedAssets(prev => {
      const next = new Set(prev)
      if (next.has(assetId)) next.delete(assetId)
      else next.add(assetId)
      return next
    })
  }

  // Helper: open Add Coverage pre-filled for an asset
  const openAddCoverage = (assetId: string, symbol: string, companyName: string) => {
    setAddingCoverage({
      assetId, analystId: '', startDate: getLocalDateString(), endDate: '',
      role: '', portfolioIds: [], notes: '',
      teamId: userTeams?.[0]?.id || null,
      visibility: coverageSettings?.default_visibility || 'team',
      isLead: false,
    })
    setAssetSearchQuery(`${symbol} - ${companyName}`)
    setAnalystSearchQuery('')
    setShowAssetDropdown(false)
    setShowAnalystDropdown(false)
  }

  // Helper: open modal in edit mode pre-filled from an existing assignment
  const openEditAssignment = (assignment: CoverageRecord) => {
    setAddingCoverage({
      editingCoverageId: assignment.id,
      assetId: assignment.asset_id,
      analystId: assignment.user_id,
      startDate: assignment.start_date || getLocalDateString(),
      endDate: assignment.end_date || '',
      role: assignment.role || '',
      portfolioIds: assignment.portfolio_id ? [assignment.portfolio_id] : [],
      notes: assignment.notes || '',
      teamId: assignment.team_id || null,
      visibility: assignment.visibility || 'team',
      isLead: assignment.is_lead || false,
    })
    const symbol = assignment.assets?.symbol || ''
    const name = assignment.assets?.company_name || ''
    setAssetSearchQuery(symbol && name ? `${symbol} - ${name}` : symbol)
    setAnalystSearchQuery(assignment.analyst_name)
    setShowAssetDropdown(false)
    setShowAnalystDropdown(false)
  }

  // Close any open kebab when clicking outside
  const closeKebab = () => setKebabOpen(null)

  // ── Render a single asset group row (parent + children) ────────
  const renderAssetGroupRow = (group: AssetCoverageGroup) => {
    const expanded = isExpanded(group.assetId)
    const hasConflict = group.conflicts.length > 0
    const n = group.assignments.length

    return (
      <div key={group.assetId} className="border-b border-gray-100">
        {/* ── Parent row ──────────────────────────────── */}
        <div
          role="button"
          tabIndex={0}
          aria-expanded={expanded}
          onClick={() => toggleExpand(group.assetId)}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleExpand(group.assetId) } }}
          className={clsx(
            'w-full px-4 py-1.5 transition-colors text-left cursor-pointer select-none',
            'hover:bg-gray-100/60',
            hasConflict && 'bg-red-50/30',
          )}
        >
          <div className="grid items-center gap-2" style={{ gridTemplateColumns: gridCols }}>
            {/* Chevron */}
            <div className="flex items-center justify-center">
              <ChevronRight className={clsx(
                'h-3.5 w-3.5 text-gray-400 transition-transform duration-150',
                expanded && 'rotate-90',
              )} />
            </div>

            {/* Asset */}
            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                <span className="text-[13px] font-semibold text-gray-900 truncate">{group.symbol}</span>
                {hasConflict && (
                  <span className="flex-shrink-0 px-1 py-px text-[9px] font-semibold rounded bg-red-100 text-red-700">
                    {group.conflicts.length > 1 ? `${group.conflicts.length} conflicts` : 'Conflict'}
                  </span>
                )}
              </div>
              <p className="text-[11px] text-gray-500 truncate leading-tight">{group.companyName}</p>
            </div>

            {/* Covers For — scope targets with counts */}
            <div className="flex items-center gap-1 min-w-0">
              {(() => {
                const realTargets = group.coverageTargets.filter(t => t.kind !== 'unknown')
                const missingCount = group.assignments.filter(a => {
                  const t = deriveCoverageTarget(a, orgNodeMap)
                  return t.kind === 'unknown'
                }).length
                if (realTargets.length === 0) {
                  return (
                    <span
                      className="inline-flex items-center gap-1 text-[11px] text-amber-600"
                      title={`${missingCount} coverage assignment${missingCount !== 1 ? 's' : ''} missing a Firm or Team scope`}
                    >
                      <AlertCircle className="h-3 w-3 flex-shrink-0" />
                      No scope
                    </span>
                  )
                }
                return (
                  <>
                    <GroupNamePills targets={realTargets} assignments={group.assignments} orgNodeMap={orgNodeMap} />
                    {missingCount > 0 && (
                      <span
                        className="inline-flex items-center gap-0.5 text-[10px] text-amber-600 flex-shrink-0"
                        title={`${missingCount} coverage assignment${missingCount !== 1 ? 's' : ''} missing a Firm or Team scope`}
                      >
                        <AlertCircle className="h-2.5 w-2.5" />
                        {missingCount}
                      </span>
                    )}
                  </>
                )
              })()}
            </div>

            {/* Analysts count (unique people, not assignments) */}
            <div className="text-[12px] text-gray-700 tabular-nums text-center">
              {new Set(group.assignments.map(a => a.user_id)).size}
            </div>

            {/* Sector */}
            <div className="text-[11px] text-gray-500 truncate">{group.sector || '—'}</div>

            {/* Industry */}
            <div className="text-[11px] text-gray-500 truncate">{(group.assignments[0]?.assets as any)?.industry || '—'}</div>

            {/* Mkt Cap */}
            <div className="text-[11px] text-gray-500 truncate">{formatMarketCap((group.assignments[0]?.assets as any)?.market_cap)}</div>

            {/* Actions — parent kebab */}
            <div className="flex justify-end" onClick={e => e.stopPropagation()}>
              <div className="relative">
                <button
                  onClick={() => setKebabOpen(kebabOpen === `parent-${group.assetId}` ? null : `parent-${group.assetId}`)}
                  className="p-1 text-gray-400 hover:text-gray-600 rounded hover:bg-gray-100 transition-colors"
                  aria-label="Asset actions"
                >
                  <MoreVertical className="h-3.5 w-3.5" />
                </button>
                {kebabOpen === `parent-${group.assetId}` && (
                  <>
                    <div className="fixed inset-0 z-30" onClick={closeKebab} />
                    <div className="absolute right-0 top-full mt-1 z-40 bg-white rounded-lg shadow-lg border border-gray-200 py-1 min-w-[180px]">
                      {hasAnyCoverageAdminRights && (
                        <button
                          onClick={() => { openAddCoverage(group.assetId, group.symbol, group.companyName); closeKebab() }}
                          className="w-full px-3 py-1.5 text-left text-[12px] text-gray-700 hover:bg-gray-50 flex items-center gap-2"
                        >
                          <Plus className="h-3.5 w-3.5 text-gray-400" /> Add assignment
                        </button>
                      )}
                      <button
                        onClick={() => { setViewHistoryAssetId(group.assetId); closeKebab() }}
                        className="w-full px-3 py-1.5 text-left text-[12px] text-gray-700 hover:bg-gray-50 flex items-center gap-2"
                      >
                        <History className="h-3.5 w-3.5 text-gray-400" /> View history
                      </button>
                      {hasConflict && (
                        <button
                          onClick={() => {
                            if (!expanded) toggleExpand(group.assetId)
                            closeKebab()
                          }}
                          className="w-full px-3 py-1.5 text-left text-[12px] text-red-600 hover:bg-red-50 flex items-center gap-2"
                        >
                          <AlertCircle className="h-3.5 w-3.5" /> Review conflicts
                        </button>
                      )}
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* ── Expanded assignments (grouped by scope) ── */}
        {expanded && (() => {
          // Group assignments by scope
          const scopeGroups = new Map<string, { target: CoverageTarget; assignments: typeof group.assignments }>()
          for (const a of group.assignments) {
            const target = deriveCoverageTarget(a, orgNodeMap)
            const key = target.kind === 'org_node' && target.id ? `node:${target.id}` : target.kind
            const existing = scopeGroups.get(key)
            if (existing) {
              existing.assignments.push(a)
            } else {
              scopeGroups.set(key, { target, assignments: [a] })
            }
          }
          // Sort: org_node first (alphabetical), then firm, then unknown
          const scopeOrder = (kind: string) => kind === 'unknown' ? 2 : kind === 'firm' ? 1 : 0
          const sortedScopes = [...scopeGroups.entries()].sort((a, b) => {
            const orderDiff = scopeOrder(a[1].target.kind) - scopeOrder(b[1].target.kind)
            if (orderDiff !== 0) return orderDiff
            return a[1].target.name.localeCompare(b[1].target.name)
          })
          const multipleScopes = sortedScopes.length > 1

          return (
            <div className="border-t border-gray-100 bg-gray-50/40 pb-1">
              {sortedScopes.map(([scopeKey, scopeGroup], scopeIdx) => {
                const target = scopeGroup.target
                const isMissingScopeGroup = target.kind === 'unknown'
                return (
                  <div key={scopeKey} className={clsx(scopeIdx > 0 && 'mt-px')}>
                    {/* Scope header */}
                    {multipleScopes && (
                      <div className={clsx(
                        'pl-12 pr-4 py-1',
                        scopeIdx > 0 && 'border-t border-gray-200/60',
                      )}>
                        <span className={clsx(
                          'inline-flex items-center gap-1 text-[11px] font-semibold',
                          isMissingScopeGroup ? 'text-amber-600' : 'text-gray-600',
                        )}>
                          {targetIcon(target)}
                          {target.name}
                          <span className="text-gray-400 font-normal">
                            ({scopeGroup.assignments.length})
                          </span>
                        </span>
                      </div>
                    )}
                    {/* Assignment rows */}
                    {scopeGroup.assignments.map(assignment => {
                      const isConflictRow = hasConflict && group.conflicts.some(c =>
                        c.records.some(r => r.id === assignment.id)
                      )
                      const isMissingGroup = target.kind === 'unknown'
                      const tenureLabel = assignment.start_date ? calculateTenure(assignment.start_date).label : null
                      const tenureTooltip = assignment.start_date
                        ? `Started ${new Date(assignment.start_date).toLocaleDateString()}${tenureLabel ? ` · ${tenureLabel}` : ''}`
                        : undefined
                      return (
                        <div
                          key={assignment.id}
                          className={clsx(
                            'group/row pl-10 pr-4 py-1 transition-colors',
                            isConflictRow ? 'bg-red-50/40' : '',
                            'hover:bg-gray-100/60',
                          )}
                        >
                          <div className="flex items-center gap-2">
                            {/* Left accent */}
                            <div className={clsx(
                              'w-0.5 h-4 rounded-full flex-shrink-0',
                              isConflictRow ? 'bg-red-300' : 'bg-gray-200',
                            )} />

                            {/* Analyst + role + scope */}
                            <div className="flex items-center gap-1.5 min-w-0 flex-1">
                              <span
                                className="text-[12px] text-gray-700 truncate"
                                title={tenureTooltip}
                              >
                                {assignment.analyst_name}
                              </span>
                              <RolePill role={assignment.role} />
                              {!multipleScopes && (
                                <CoversForPill target={target} />
                              )}
                            </div>

                            {/* Kebab */}
                            {hasAnyCoverageAdminRights && (
                              <div className="relative flex-shrink-0 opacity-0 group-hover/row:opacity-100 transition-opacity">
                                <button
                                  onClick={() => setKebabOpen(kebabOpen === assignment.id ? null : assignment.id)}
                                  className="p-0.5 text-gray-400 hover:text-gray-600 rounded hover:bg-gray-100 transition-colors"
                                  aria-label="Assignment actions"
                                >
                                  <MoreVertical className="h-3.5 w-3.5" />
                                </button>
                                {kebabOpen === assignment.id && (
                                  <>
                                    <div className="fixed inset-0 z-30" onClick={closeKebab} />
                                    <div className="absolute right-0 top-full mt-1 z-40 bg-white rounded-lg shadow-lg border border-gray-200 py-1 min-w-[190px]">
                                      <button
                                        onClick={() => { openEditAssignment(assignment); closeKebab() }}
                                        className={clsx(
                                          'w-full px-3 py-1.5 text-left text-[12px] hover:bg-gray-50 flex items-center gap-2',
                                          isMissingGroup ? 'text-amber-700 hover:bg-amber-50' : 'text-gray-700',
                                        )}
                                      >
                                        {isMissingGroup
                                          ? <><AlertCircle className="h-3.5 w-3.5" /> Edit assignment</>
                                          : <><Pencil className="h-3.5 w-3.5 text-gray-400" /> Edit assignment</>}
                                      </button>
                                      <div className="border-t border-gray-100 my-1" />
                                      <button
                                        onClick={() => {
                                          setDeleteConfirm({
                                            isOpen: true,
                                            coverageId: assignment.id,
                                            assetSymbol: assignment.assets?.symbol || '',
                                            analystName: assignment.analyst_name,
                                          })
                                          closeKebab()
                                        }}
                                        className="w-full px-3 py-1.5 text-left text-[12px] text-red-600 hover:bg-red-50 flex items-center gap-2"
                                      >
                                        <X className="h-3.5 w-3.5" /> Remove assignment
                                      </button>
                                    </div>
                                  </>
                                )}
                              </div>
                            )}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )
              })}
            </div>
          )
        })()}
      </div>
    )
  }

  // ── Loading skeleton ─────────────────────────────────────────────
  if (coverageLoading) {
    return (
      <Card padding="none" className="h-[calc(90vh-280px)] flex flex-col overflow-hidden">
        <div className="p-6 space-y-3">
          {[...Array(8)].map((_, i) => (
            <div key={i} className="animate-pulse flex items-center gap-4">
              <div className="w-8 h-8 bg-gray-200 rounded" />
              <div className="flex-1 space-y-1.5">
                <div className="h-3.5 bg-gray-200 rounded w-1/4" />
                <div className="h-3 bg-gray-100 rounded w-1/3" />
              </div>
              <div className="w-20 h-6 bg-gray-100 rounded" />
            </div>
          ))}
        </div>
      </Card>
    )
  }

  // ── Empty state ──────────────────────────────────────────────────
  if (filteredCoverage.length === 0 && uncoveredAssets.length === 0) {
    return (
      <Card padding="none" className="h-[calc(90vh-280px)] flex flex-col overflow-hidden">
        <div className="p-8">
          {searchQuery && (() => {
            const matchingUncoveredAssets = assets?.filter(asset => {
              const isMatch = asset.symbol.toLowerCase().includes(searchQuery.toLowerCase()) ||
                asset.company_name.toLowerCase().includes(searchQuery.toLowerCase())
              const hasCoverage = coverageRecords?.some(c => c.asset_id === asset.id)
              return isMatch && !hasCoverage
            }) || []

            if (matchingUncoveredAssets.length > 0) {
              return (
                <div>
                  <div className="text-center mb-6">
                    <div className="w-12 h-12 bg-amber-100 rounded-full flex items-center justify-center mx-auto mb-3">
                      <AlertCircle className="h-6 w-6 text-amber-600" />
                    </div>
                    <h3 className="text-lg font-medium text-gray-900 mb-1">
                      No coverage found for &ldquo;{searchQuery}&rdquo;
                    </h3>
                    <p className="text-sm text-gray-500">
                      The following assets match your search but have no coverage assigned
                    </p>
                  </div>
                  <div className="space-y-2 max-w-md mx-auto">
                    {matchingUncoveredAssets.slice(0, 5).map(asset => (
                      <div key={asset.id} className="flex items-center justify-between p-3 bg-amber-50 border border-amber-200 rounded-lg">
                        <div>
                          <span className="font-medium text-gray-900">{asset.symbol}</span>
                          <span className="text-gray-500 ml-2 text-sm">{asset.company_name}</span>
                        </div>
                        {hasAnyCoverageAdminRights ? (
                          <button
                            onClick={() => openAddCoverage(asset.id, asset.symbol, asset.company_name)}
                            className="px-3 py-1.5 text-xs font-medium text-primary-600 bg-primary-50 hover:bg-primary-100 rounded-md transition-colors"
                          >
                            Assign Coverage
                          </button>
                        ) : (
                          <button
                            onClick={() => setRequestingChange({
                              assetId: asset.id, assetSymbol: asset.symbol,
                              currentUserId: null, currentAnalystName: null, currentRole: null,
                              requestedUserId: '', requestedRole: 'primary', requestType: 'add', reason: '',
                            })}
                            className="px-3 py-1.5 text-xs font-medium text-primary-600 bg-primary-50 hover:bg-primary-100 rounded-md transition-colors"
                          >
                            Request Coverage
                          </button>
                        )}
                      </div>
                    ))}
                    {matchingUncoveredAssets.length > 5 && (
                      <p className="text-xs text-gray-500 text-center mt-2">
                        And {matchingUncoveredAssets.length - 5} more matching assets...
                      </p>
                    )}
                  </div>
                </div>
              )
            }
            return null
          })()}
          {(!searchQuery || !(assets?.some(asset => {
            const isMatch = asset.symbol.toLowerCase().includes(searchQuery.toLowerCase()) ||
              asset.company_name.toLowerCase().includes(searchQuery.toLowerCase())
            const hasCoverage = coverageRecords?.some(c => c.asset_id === asset.id)
            return isMatch && !hasCoverage
          }))) && (
            <div className="text-center">
              <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <Users className="h-8 w-8 text-gray-400" />
              </div>
              <h3 className="text-lg font-medium text-gray-900 mb-2">
                {coverageRecords?.length === 0 ? 'No coverage assignments yet' : 'No coverage assignments match the current filters.'}
              </h3>
              <p className="text-gray-500 mb-4">
                {coverageRecords?.length === 0
                  ? 'Start by assigning analysts to cover specific assets.'
                  : 'Try adjusting your search criteria.'}
              </p>
            </div>
          )}
        </div>
      </Card>
    )
  }

  // ── Main render ──────────────────────────────────────────────────
  return (
    <Card padding="none" className="h-[calc(90vh-280px)] flex flex-col overflow-hidden">
      {/* ─── Toolbar ─────────────────────────────────────────────── */}
      <div className="px-4 py-1.5 bg-gray-50/80 border-b border-gray-200">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            {/* Conflicts filter */}
            {allConflicts.length > 0 && (
              <button
                onClick={() => setShowConflictsOnly(!showConflictsOnly)}
                className={clsx(
                  'px-2 py-0.5 text-[11px] font-medium rounded-md border transition-colors',
                  showConflictsOnly
                    ? 'bg-red-50 text-red-700 border-red-300'
                    : 'text-red-600 border-gray-200 hover:border-red-200 hover:bg-red-50/50',
                )}
              >
                <span className="flex items-center gap-1">
                  <AlertCircle className="w-3 h-3" />
                  {allConflicts.length} conflict{allConflicts.length !== 1 ? 's' : ''}
                </span>
              </button>
            )}

            {/* Missing group filter */}
            {missingGroupCount > 0 && (
              <button
                onClick={() => setShowMissingGroupsOnly(!showMissingGroupsOnly)}
                className={clsx(
                  'px-2 py-0.5 text-[11px] font-medium rounded-md border transition-colors',
                  showMissingGroupsOnly
                    ? 'bg-amber-50 text-amber-700 border-amber-300'
                    : 'text-amber-600 border-gray-200 hover:border-amber-200 hover:bg-amber-50/50',
                )}
              >
                <span className="flex items-center gap-1">
                  <AlertCircle className="w-3 h-3" />
                  {missingGroupCount} {missingGroupCount !== 1 ? 'assignments' : 'assignment'} missing a scope
                </span>
              </button>
            )}

            {Object.keys(listColumnFilters).length > 0 && (
              <button onClick={() => setListColumnFilters({})} className="text-[11px] text-gray-500 hover:text-red-600 flex items-center gap-1">
                <X className="w-3 h-3" /> Clear filters
              </button>
            )}
            {hiddenGroups.size > 0 && (
              <button onClick={() => setHiddenGroups(new Set())} className="text-[11px] text-amber-600 hover:text-amber-700 bg-amber-50 px-2 py-0.5 rounded flex items-center gap-1">
                <EyeOff className="w-3 h-3" />
                {hiddenGroups.size} hidden
              </button>
            )}
            {listGroupByLevels.length > 0 && listGroupBy === 'none' && (
              <label className="flex items-center gap-1 text-[11px] text-gray-600 cursor-pointer">
                <input
                  type="checkbox"
                  checked={hideEmptyGroups}
                  onChange={(e) => setHideEmptyGroups(e.target.checked)}
                  className="w-3 h-3 rounded border-gray-300 text-primary-600"
                />
                Hide empty
              </label>
            )}

            <span className="text-[11px] text-gray-400 ml-1">
              {listGroupBy === 'asset'
                ? `${groupsWithSearchMatch.length} asset${groupsWithSearchMatch.length !== 1 ? 's' : ''} shown`
                : `${filteredCoverage.length} row${filteredCoverage.length !== 1 ? 's' : ''} shown`}
            </span>
          </div>
          {/* Column manager — only in flat mode (grouped mode has fixed columns) */}
          {listGroupBy !== 'asset' && (
            <div className="relative">
              <button onClick={() => setShowColumnManager(!showColumnManager)} className="text-[11px] text-gray-500 hover:text-primary-600 flex items-center gap-1">
                <Grid3X3 className="w-3 h-3" /> Columns
              </button>
              {showColumnManager && (
                <>
                  <div className="fixed inset-0 z-30" onClick={() => setShowColumnManager(false)} />
                  <div ref={columnManagerRef} className="absolute right-0 top-full mt-1 z-40 bg-white rounded-lg shadow-lg border border-gray-200 p-3 min-w-[200px]">
                    <p className="text-xs font-semibold text-gray-700 mb-2">Visible Columns</p>
                    <div className="space-y-1 max-h-64 overflow-y-auto">
                      {(Object.keys(colDefs) as ListColumnId[]).filter(c => c !== 'coveredBy').map(colId => (
                        <label key={colId} className="flex items-center gap-2 px-2 py-1 rounded hover:bg-gray-50 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={listVisibleColumns.includes(colId)}
                            onChange={(e) => {
                              if (e.target.checked) setListVisibleColumns(prev => [...prev, colId])
                              else setListVisibleColumns(prev => prev.filter(c => c !== colId))
                            }}
                            disabled={colId === 'asset'}
                            className="rounded text-primary-600 focus:ring-primary-500"
                          />
                          <span className="text-sm text-gray-700">{colDefs[colId].label}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      </div>

      {/* ─── Column Headers ─────────────────────────────────────── */}
      {listGroupBy === 'asset' ? (
        <div className="px-4 py-1.5 border-b border-gray-200 bg-white">
          <div className="grid items-center gap-2 text-[10px] font-semibold text-gray-500 uppercase tracking-wider"
            style={{ gridTemplateColumns: gridCols }}
          >
            <div />
            {([
              { id: 'asset' as ListColumnId, label: 'Asset' },
              { id: 'coversFor' as ListColumnId, label: 'Covers For' },
              { id: 'coveredBy' as ListColumnId, label: 'Analysts' },
              { id: 'sector' as ListColumnId, label: 'Sector' },
              { id: 'industry' as ListColumnId, label: 'Industry' },
              { id: 'marketCap' as ListColumnId, label: 'Mkt Cap' },
            ] as const).map(col => (
              <div
                key={col.id}
                className={clsx('flex items-center gap-1 cursor-pointer select-none hover:text-gray-700', col.id === 'coveredBy' && 'justify-center', listSortColumn === col.id && 'text-primary-600')}
                onDoubleClick={() => handleColumnSort(col.id)}
                title="Double-click to sort"
              >
                <span>{col.label}</span>
                {listSortColumn === col.id && (
                  <span className="flex flex-col">
                    <ChevronUp className={clsx('w-2.5 h-2.5 -mb-0.5', listSortDirection === 'asc' ? 'text-primary-600' : 'text-gray-300')} />
                    <ChevronDown className={clsx('w-2.5 h-2.5 -mt-0.5', listSortDirection === 'desc' ? 'text-primary-600' : 'text-gray-300')} />
                  </span>
                )}
              </div>
            ))}
            <div />
          </div>
        </div>
      ) : (
        <div className="px-4 py-1.5 border-b border-gray-200 bg-white">
          <div className="grid gap-2 text-[10px] font-semibold text-gray-500 uppercase tracking-wider"
            style={{ gridTemplateColumns: `repeat(${totalColumnWidth}, minmax(0, 1fr))` }}
          >
            {effectiveColumns.map(colId => {
              const col = colDefs[colId]
              const isFiltered = !!listColumnFilters[colId]
              const isSorted = listSortColumn === colId
              return (
                <div key={colId} className="relative" style={{ gridColumn: `span ${col.width}` }}>
                  <div
                    className={clsx('flex items-center gap-1 cursor-pointer hover:text-gray-700 select-none', isSorted && 'text-primary-600')}
                    onClick={() => handleColumnSort(colId)}
                  >
                    <span className="truncate">{col.label}</span>
                    {col.sortable && (
                      <span className="flex flex-col">
                        <ChevronUp className={clsx('w-2.5 h-2.5 -mb-0.5', isSorted && listSortDirection === 'asc' ? 'text-primary-600' : 'text-gray-300')} />
                        <ChevronDown className={clsx('w-2.5 h-2.5 -mt-0.5', isSorted && listSortDirection === 'desc' ? 'text-primary-600' : 'text-gray-300')} />
                      </span>
                    )}
                    {col.filterable && (
                      <button
                        onClick={(e) => handleFilterClick(colId, e)}
                        className={clsx('p-0.5 rounded hover:bg-gray-200', isFiltered && 'bg-primary-100 text-primary-600')}
                      >
                        <Search className="w-2.5 h-2.5" />
                      </button>
                    )}
                  </div>
                  {activeFilterColumn === colId && (
                    <>
                      <div className="fixed inset-0 z-30" onClick={() => setActiveFilterColumn(null)} />
                      <div className="absolute left-0 top-full mt-1 z-40 bg-white rounded-lg shadow-lg border border-gray-200 p-2 min-w-[180px]">
                        <input
                          type="text"
                          placeholder={`Filter ${col.label}...`}
                          value={listColumnFilters[colId] || ''}
                          onChange={(e) => setListColumnFilters(prev => ({ ...prev, [colId]: e.target.value }))}
                          className="w-full px-2 py-1 text-sm border border-gray-200 rounded focus:outline-none focus:ring-1 focus:ring-primary-500"
                          autoFocus
                        />
                        {getUniqueFilterValues(colId, coverageRecords || []).length > 0 && (
                          <div className="mt-1.5 max-h-32 overflow-y-auto">
                            {getUniqueFilterValues(colId, coverageRecords || []).slice(0, 10).map(val => (
                              <button
                                key={val}
                                onClick={() => { setListColumnFilters(prev => ({ ...prev, [colId]: val })); setActiveFilterColumn(null) }}
                                className="block w-full text-left px-2 py-1 text-xs text-gray-700 hover:bg-gray-100 rounded truncate"
                              >
                                {val}
                              </button>
                            ))}
                          </div>
                        )}
                        {listColumnFilters[colId] && (
                          <button
                            onClick={() => { setListColumnFilters(prev => { const next = { ...prev }; delete next[colId]; return next }); setActiveFilterColumn(null) }}
                            className="mt-1.5 w-full text-[11px] text-red-600 hover:text-red-700"
                          >
                            Clear filter
                          </button>
                        )}
                      </div>
                    </>
                  )}
                </div>
              )
            })}
            <div style={{ gridColumn: 'span 1' }} className="text-right">Actions</div>
          </div>
        </div>
      )}

      {/* ─── Scrollable Content ──────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto">
        {listGroupBy === 'asset' ? (
          /* ════════════════════════════════════════════════════════
             GROUPED BY ASSET MODE
             ════════════════════════════════════════════════════════ */
          <>
            {groupsWithSearchMatch.length === 0 && (
              <div className="p-8 text-center text-sm text-gray-500">
                {showConflictsOnly ? 'No coverage conflicts found.' : 'No coverage assignments match the current filters.'}
              </div>
            )}
            {outerGroupedSections ? (
              /* With outer grouping sections (e.g. Sector → Asset groups) */
              outerGroupedSections.map(([sectionKey, sectionGroups]) => {
                const sectionCollapsed = collapsedGroups.has(sectionKey)
                return (
                  <div key={sectionKey}>
                    <div
                      role="button"
                      tabIndex={0}
                      onClick={() => setCollapsedGroups(prev => {
                        const next = new Set(prev)
                        if (next.has(sectionKey)) next.delete(sectionKey)
                        else next.add(sectionKey)
                        return next
                      })}
                      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setCollapsedGroups(prev => { const next = new Set(prev); if (next.has(sectionKey)) next.delete(sectionKey); else next.add(sectionKey); return next }) } }}
                      className="sticky top-0 z-10 px-4 py-2 bg-gray-100/95 border-b border-gray-200 flex items-center gap-2 cursor-pointer select-none hover:bg-gray-150/95"
                    >
                      <ChevronRight className={clsx('h-3.5 w-3.5 text-gray-500 transition-transform duration-150', !sectionCollapsed && 'rotate-90')} />
                      <span className="text-[12px] font-semibold text-gray-700">{sectionKey}</span>
                      <span className="text-[11px] text-gray-400">{sectionGroups.length} asset{sectionGroups.length !== 1 ? 's' : ''}</span>
                    </div>
                    {!sectionCollapsed && sectionGroups.map(group => renderAssetGroupRow(group))}
                  </div>
                )
              })
            ) : (
              /* No outer grouping — flat list of asset groups */
              groupsWithSearchMatch.map(group => renderAssetGroupRow(group))
            )}
          </>
        ) : (
          /* ════════════════════════════════════════════════════════
             FLAT ROWS MODE
             ════════════════════════════════════════════════════════ */
          <>
            {listGroupByLevels.length > 0 && renderFlatGroupedContent ? (
              renderFlatGroupedContent()
            ) : (
              filteredCoverage.map((coverage) => {
                return (
                  <div key={coverage.id} className="px-4 py-1.5 hover:bg-gray-50 transition-colors border-b border-gray-50">
                    <div className="grid gap-2 items-center" style={{ gridTemplateColumns: `repeat(${totalColumnWidth}, minmax(0, 1fr))` }}>
                      {effectiveColumns.map(colId => {
                        const col = colDefs[colId]
                        return (
                          <div key={colId} style={{ gridColumn: `span ${col.width}` }} className="min-w-0">
                            {colId === 'asset' && (
                              <div className="min-w-0">
                                <p className="text-[13px] font-semibold text-gray-900 truncate">{coverage.assets?.symbol || 'Unknown'}</p>
                                <p className="text-[11px] text-gray-500 truncate leading-tight" title={coverage.assets?.company_name}>{coverage.assets?.company_name || 'Unknown'}</p>
                              </div>
                            )}
                            {colId === 'analyst' && (
                              <span className="text-[12px] text-gray-700 truncate">{coverage.analyst_name}</span>
                            )}
                            {colId === 'coversFor' && (() => {
                              const target = deriveCoverageTarget(coverage, orgNodeMap)
                              const tooltip = target.breadcrumb?.length
                                ? target.breadcrumb.join(' \u2192 ')
                                : `Covers for: ${target.name}`
                              return (
                              <div className="relative inline-block">
                                <button
                                  onClick={() => canChangeVisibility(coverage) && setEditingVisibility(
                                    editingVisibility?.coverageId === coverage.id ? null : { coverageId: coverage.id, currentVisibility: coverage.visibility || 'team' }
                                  )}
                                  disabled={!canChangeVisibility(coverage)}
                                  className={clsx(
                                    'inline-flex items-center gap-0.5 px-1.5 py-px text-[10px] font-medium rounded-full transition-all leading-tight',
                                    targetColorClasses(target),
                                    canChangeVisibility(coverage) && 'hover:ring-2 hover:ring-primary-300 cursor-pointer',
                                    !canChangeVisibility(coverage) && 'cursor-default opacity-75',
                                  )}
                                  title={tooltip}
                                >
                                  {targetIcon(target)}
                                  {target.name}
                                </button>
                                {editingVisibility?.coverageId === coverage.id && (
                                  <>
                                    <div className="fixed inset-0 z-30" onClick={() => setEditingVisibility(null)} />
                                    <div className="absolute left-0 top-full mt-1 z-40 bg-white rounded-lg shadow-lg border border-gray-200 py-1 min-w-[180px]">
                                      <div className="px-3 py-1 text-[10px] font-semibold text-gray-400 uppercase tracking-wider">Covers For:</div>
                                      {[
                                        { value: 'team' as const, label: 'Team Only', icon: Users, color: 'text-emerald-600 bg-emerald-50' },
                                        { value: 'division' as const, label: 'Division', icon: FolderOpen, color: 'text-blue-600 bg-blue-50' },
                                        { value: 'firm' as const, label: 'Firm-wide', icon: Building2, color: 'text-gray-600 bg-gray-100' },
                                      ].map(option => (
                                        <button
                                          key={option.value}
                                          onClick={() => updateVisibilityMutation.mutate({ coverageId: coverage.id, visibility: option.value })}
                                          className={clsx('w-full px-3 py-1.5 text-left hover:bg-gray-50 flex items-center gap-3', coverage.visibility === option.value && 'bg-gray-50')}
                                        >
                                          <div className={clsx('p-1 rounded-md', option.color)}><option.icon className="h-3 w-3" /></div>
                                          <span className="text-[12px] font-medium text-gray-900">{option.label}</span>
                                          {coverage.visibility === option.value && <Check className="h-3.5 w-3.5 text-primary-600 ml-auto" />}
                                        </button>
                                      ))}
                                    </div>
                                  </>
                                )}
                              </div>
                              )
                            })()}
                            {colId === 'sector' && <span className="text-[11px] text-gray-500 truncate block">{coverage.assets?.sector || '—'}</span>}
                            {colId === 'startDate' && <span className="text-[11px] text-gray-500">{coverage.start_date ? new Date(coverage.start_date).toLocaleDateString() : '—'}</span>}
                            {colId === 'tenure' && (
                              <span className={clsx(
                                'text-[10px] px-1 py-px rounded',
                                calculateTenure(coverage.start_date).days < 90 && 'bg-yellow-50 text-yellow-700',
                                calculateTenure(coverage.start_date).days >= 90 && calculateTenure(coverage.start_date).days < 365 && 'bg-blue-50 text-blue-700',
                                calculateTenure(coverage.start_date).days >= 365 && 'bg-emerald-50 text-emerald-700',
                              )}>
                                {calculateTenure(coverage.start_date).label}
                              </span>
                            )}
                            {colId === 'industry' && <span className="text-[11px] text-gray-500 truncate block">{(coverage.assets as any)?.industry || '—'}</span>}
                            {colId === 'marketCap' && <span className="text-[11px] text-gray-500">{formatMarketCap((coverage.assets as any)?.market_cap)}</span>}
                          </div>
                        )
                      })}
                      <div style={{ gridColumn: 'span 1' }} className="text-right">
                        <button onClick={() => setViewHistoryAssetId(coverage.assets?.id || null)} className="p-1 text-gray-400 hover:text-primary-600 transition-colors" title="View history">
                          <History className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>
                  </div>
                )
              })
            )}

            {/* Not Covered Section - flat mode only, no grouping */}
            {uncoveredAssets.length > 0 && listGroupByLevels.length === 0 && (
              <>
                <div className="px-4 py-1.5 bg-amber-50 border-t border-amber-200">
                  <div className="flex items-center gap-2">
                    <AlertCircle className="h-3.5 w-3.5 text-amber-600" />
                    <span className="text-[10px] font-semibold text-amber-900 uppercase tracking-wider">
                      Not Covered ({uncoveredAssets.length})
                    </span>
                  </div>
                </div>
                {uncoveredAssets.map(asset => (
                  <div key={asset.id} className="px-4 py-1.5 bg-amber-50/20 hover:bg-amber-50/40 transition-colors border-b border-gray-50">
                    <div className="grid gap-2 items-center" style={{ gridTemplateColumns: `repeat(${totalColumnWidth}, minmax(0, 1fr))` }}>
                      {effectiveColumns.map(colId => {
                        const col = colDefs[colId]
                        return (
                          <div key={colId} style={{ gridColumn: `span ${col.width}` }} className="min-w-0">
                            {colId === 'asset' && (
                              <div className="min-w-0">
                                <p className="text-[13px] font-semibold text-gray-900 truncate">{asset.symbol}</p>
                                <p className="text-[11px] text-gray-500 truncate leading-tight" title={asset.company_name}>{asset.company_name}</p>
                              </div>
                            )}
                            {colId === 'analyst' && (
                              <span className="inline-flex items-center px-1.5 py-px rounded-full text-[10px] font-medium bg-amber-100 text-amber-800">No Coverage</span>
                            )}
                            {colId === 'coversFor' && <span className="text-[11px] text-gray-400">—</span>}
                            {colId === 'sector' && <span className="text-[11px] text-gray-500 truncate block">{asset.sector || '—'}</span>}
                            {colId === 'startDate' && <span className="text-[11px] text-gray-400">—</span>}
                            {colId === 'tenure' && <span className="text-[11px] text-gray-400">—</span>}
                            {colId === 'industry' && <span className="text-[11px] text-gray-500 truncate block">{(asset as any)?.industry || '—'}</span>}
                            {colId === 'marketCap' && <span className="text-[11px] text-gray-500">{formatMarketCap((asset as any)?.market_cap)}</span>}
                          </div>
                        )
                      })}
                      <div style={{ gridColumn: 'span 1' }} className="text-right">
                        {hasAnyCoverageAdminRights ? (
                          <button
                            onClick={() => openAddCoverage(asset.id, asset.symbol, asset.company_name)}
                            className="px-2 py-0.5 text-[11px] font-medium text-primary-600 bg-primary-50 hover:bg-primary-100 rounded transition-colors"
                          >
                            Assign
                          </button>
                        ) : (
                          <button
                            onClick={() => setRequestingChange({
                              assetId: asset.id, assetSymbol: asset.symbol,
                              currentUserId: null, currentAnalystName: null, currentRole: null,
                              requestedUserId: '', requestedRole: 'primary', requestType: 'add', reason: '',
                            })}
                            className="px-2 py-0.5 text-[11px] font-medium text-amber-600 bg-amber-50 hover:bg-amber-100 rounded transition-colors"
                          >
                            Request
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </>
            )}
          </>
        )}
      </div>
    </Card>
  )
}
