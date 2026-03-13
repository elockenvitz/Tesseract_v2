/**
 * ObjectLinkPicker — Modal for manually linking notes to platform objects.
 *
 * Supports multi-select with per-object relationship assignment.
 * A global default relationship applies to newly selected objects,
 * but each object can be overridden independently before confirm.
 */

import { useState, useRef, useEffect, useCallback, useMemo, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import {
  X, Search, TrendingUp, Briefcase, Tag, FileText, GitBranch, Folder, Zap,
  Check, Loader2, ArrowRightLeft, ClipboardCheck, Calendar, ChevronDown,
  Link2, Pin, ArrowRight, Repeat2, Layers
} from 'lucide-react'
import { useEntitySearch, type EntityType as SearchEntityType } from '../../hooks/useEntitySearch'
import type { LinkableEntityType, LinkRelationshipType } from '../../lib/object-links'

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

/** Ordered by decision-graph hierarchy: core objects first, then supporting. */
const PICKER_TYPES: { key: SearchEntityType; label: string; icon: typeof TrendingUp }[] = [
  // Core investment objects
  { key: 'asset',       label: 'Assets',        icon: TrendingUp },
  { key: 'trade_idea',  label: 'Ideas',         icon: Zap },
  { key: 'trade',       label: 'Trades',        icon: ArrowRightLeft },
  { key: 'portfolio',   label: 'Portfolios',    icon: Briefcase },
  // Supporting / knowledge objects
  { key: 'note',        label: 'Notes',         icon: FileText },
  { key: 'theme',       label: 'Themes',        icon: Tag },
  { key: 'workflow',    label: 'Processes',     icon: GitBranch },
  { key: 'project',     label: 'Projects',      icon: Folder },
  { key: 'meeting',     label: 'Meetings',      icon: Calendar },
  { key: 'trade_sheet', label: 'Trade Sheets',  icon: ClipboardCheck },
]

const TYPE_ICON_MAP: Record<string, typeof TrendingUp> = Object.fromEntries(
  PICKER_TYPES.map(t => [t.key, t.icon])
)

const TYPE_COLORS: Record<string, { bg: string; icon: string; pill: string }> = {
  asset:       { bg: 'bg-emerald-50',  icon: 'text-emerald-600', pill: 'bg-emerald-600 text-white' },
  portfolio:   { bg: 'bg-orange-50',   icon: 'text-orange-600',  pill: 'bg-orange-600 text-white' },
  trade_idea:  { bg: 'bg-amber-50',    icon: 'text-amber-600',   pill: 'bg-amber-600 text-white' },
  trade:       { bg: 'bg-rose-50',     icon: 'text-rose-600',    pill: 'bg-rose-600 text-white' },
  trade_sheet: { bg: 'bg-teal-50',     icon: 'text-teal-600',    pill: 'bg-teal-600 text-white' },
  meeting:     { bg: 'bg-sky-50',      icon: 'text-sky-600',     pill: 'bg-sky-600 text-white' },
  note:        { bg: 'bg-gray-100',    icon: 'text-gray-600',    pill: 'bg-gray-700 text-white' },
  theme:       { bg: 'bg-purple-50',   icon: 'text-purple-600',  pill: 'bg-purple-600 text-white' },
  workflow:    { bg: 'bg-cyan-50',     icon: 'text-cyan-600',    pill: 'bg-cyan-600 text-white' },
  project:     { bg: 'bg-indigo-50',   icon: 'text-indigo-600',  pill: 'bg-indigo-600 text-white' },
}

/** Reverse map: linkable_entity_type → search entity type (for icon/color lookup) */
const LINKABLE_TO_SEARCH_TYPE: Record<string, SearchEntityType> = {
  asset: 'asset',
  portfolio: 'portfolio',
  theme: 'theme',
  workflow: 'workflow',
  project: 'project',
  trade_idea: 'trade_idea',
  trade: 'trade',
  trade_sheet: 'trade_sheet',
  calendar_event: 'meeting',
  user: 'asset', // fallback — mentions don't appear as links in picker
  asset_note: 'note',
  portfolio_note: 'note',
  theme_note: 'note',
  custom_note: 'note',
}

/** Singular type labels for result rows */
const TYPE_LABELS: Record<string, string> = {
  asset: 'Asset',
  portfolio: 'Portfolio',
  trade_idea: 'Idea',
  trade: 'Trade',
  trade_sheet: 'Trade Sheet',
  meeting: 'Meeting',
  note: 'Note',
  theme: 'Theme',
  workflow: 'Process',
  project: 'Project',
}

const LINK_INTENTS: { value: LinkRelationshipType; label: string; description: string; icon: typeof Link2 }[] = [
  { value: 'references',  label: 'References',  description: 'This note mentions or cites the object',                   icon: Link2 },
  { value: 'supports',    label: 'Supports',    description: 'This note provides evidence or rationale for the object',  icon: Pin },
  { value: 'results_in',  label: 'Results In',  description: 'This note led to or produced the object',                  icon: ArrowRight },
  { value: 'related_to',  label: 'Related To',  description: 'This note is associated with the object',                  icon: Repeat2 },
]

const INTENT_MAP = new Map(LINK_INTENTS.map(i => [i.value, i]))

/** Map search result entity type → linkable_entity_type */
function toLinkableType(searchType: SearchEntityType, data?: any): LinkableEntityType {
  switch (searchType) {
    case 'asset':       return 'asset'
    case 'portfolio':   return 'portfolio'
    case 'theme':       return 'theme'
    case 'workflow':    return 'workflow'
    case 'project':     return 'project'
    case 'trade_idea':  return 'trade_idea'
    case 'trade':       return 'trade'
    case 'trade_sheet': return 'trade_sheet'
    case 'meeting':     return 'calendar_event'
    case 'note': {
      const noteType = data?.noteType
      if (noteType === 'asset') return 'asset_note'
      if (noteType === 'portfolio') return 'portfolio_note'
      if (noteType === 'theme') return 'theme_note'
      return 'custom_note'
    }
    default: return 'asset'
  }
}

/**
 * Build a richer context line for each result type using available data fields.
 */
function buildContextLine(type: SearchEntityType, subtitle: string | undefined, data: any): string {
  const label = TYPE_LABELS[type] || type
  const parts: string[] = [label]

  switch (type) {
    case 'asset':
      if (data?.company_name) parts.push(data.company_name)
      if (data?.sector) parts.push(data.sector)
      break
    case 'trade_idea':
      if (data?.assets?.company_name) parts.push(data.assets.company_name)
      if (data?.stage) parts.push(data.stage)
      break
    case 'trade':
      if (data?.portfolio?.name) parts.push(data.portfolio.name)
      if (data?.sizing_input) parts.push(data.sizing_input)
      break
    case 'trade_sheet':
      if (data?.status) parts.push(data.status)
      if (data?.portfolio?.name) parts.push(data.portfolio.name)
      break
    case 'portfolio':
      if (data?.benchmark) parts.push(data.benchmark)
      else if (subtitle) parts.push(subtitle)
      break
    case 'theme':
      if (data?.theme_type) parts.push(data.theme_type)
      else if (subtitle) parts.push(subtitle)
      break
    case 'workflow':
      if (subtitle) parts.push(subtitle)
      break
    case 'project':
      if (data?.status) parts.push(data.status)
      break
    case 'meeting':
      if (subtitle) return `${label} · ${subtitle}`
      break
    case 'note':
      if (subtitle) parts.push(subtitle)
      break
    default:
      if (subtitle) parts.push(subtitle)
  }

  return parts.join(' · ')
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SelectedLinkItem {
  id: string
  entityType: LinkableEntityType
  label: string
  subtitle?: string
  context?: string
  searchType: SearchEntityType
  linkType: LinkRelationshipType
}

export interface ExistingLinkItem {
  id: string           // object_link row ID
  targetId: string     // the linked object's ID
  targetType: LinkableEntityType
  label: string
  subtitle?: string
  linkType: string
  isAuto: boolean
}

interface ObjectLinkPickerProps {
  isOpen: boolean
  onLinkMultiple: (items: SelectedLinkItem[]) => void
  onClose: () => void
  existingLinkIds?: Set<string>
  existingLinks?: ExistingLinkItem[]
  onDeleteLink?: (linkId: string) => void
}

// ---------------------------------------------------------------------------
// Per-item relationship selector (inline dropdown)
// ---------------------------------------------------------------------------

function RelationshipPill({
  value,
  onChange,
}: {
  value: LinkRelationshipType
  onChange: (v: LinkRelationshipType) => void
}) {
  const [open, setOpen] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const [menuStyle, setMenuStyle] = useState<CSSProperties>({})
  const intent = INTENT_MAP.get(value)!
  const IntentIcon = intent.icon

  // Position the portal menu relative to the trigger button
  useEffect(() => {
    if (!open || !triggerRef.current) return
    const rect = triggerRef.current.getBoundingClientRect()
    const menuHeight = 220 // approximate max height of 4 options
    const spaceAbove = rect.top
    const spaceBelow = window.innerHeight - rect.bottom

    // Prefer opening upward (above trigger); fall back to below if not enough space
    if (spaceAbove >= menuHeight) {
      setMenuStyle({
        position: 'fixed',
        left: rect.left,
        bottom: window.innerHeight - rect.top + 4,
        zIndex: 9999,
      })
    } else {
      setMenuStyle({
        position: 'fixed',
        left: rect.left,
        top: rect.bottom + 4,
        zIndex: 9999,
      })
    }
  }, [open])

  // Close on outside click — check both trigger and portal menu
  useEffect(() => {
    if (!open) return
    const handleClick = (e: MouseEvent) => {
      const target = e.target as Node
      if (
        triggerRef.current && !triggerRef.current.contains(target) &&
        menuRef.current && !menuRef.current.contains(target)
      ) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [open])

  // Close on scroll in any ancestor (menu would be mispositioned)
  useEffect(() => {
    if (!open) return
    const handleScroll = () => setOpen(false)
    // Capture phase so we catch scroll on any ancestor
    document.addEventListener('scroll', handleScroll, true)
    return () => document.removeEventListener('scroll', handleScroll, true)
  }, [open])

  return (
    <>
      <button
        ref={triggerRef}
        onClick={(e) => { e.stopPropagation(); setOpen(!open) }}
        className="flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-medium text-gray-500 bg-white border border-gray-200 rounded hover:border-gray-300 hover:bg-gray-50 transition-colors"
      >
        <IntentIcon className="h-2.5 w-2.5 text-gray-400" />
        <span>{intent.label}</span>
        <ChevronDown className="h-2 w-2 text-gray-400" />
      </button>

      {open && createPortal(
        <div
          ref={menuRef}
          style={menuStyle}
          className="bg-white rounded-lg shadow-xl border border-gray-200 py-1 w-[220px]"
        >
          {LINK_INTENTS.map(opt => {
            const OptIcon = opt.icon
            return (
              <button
                key={opt.value}
                onClick={(e) => { e.stopPropagation(); onChange(opt.value); setOpen(false) }}
                className={`w-full px-2.5 py-1.5 text-left hover:bg-gray-50 transition-colors flex items-center gap-2 ${
                  value === opt.value ? 'bg-gray-50' : ''
                }`}
              >
                <OptIcon className={`h-3 w-3 flex-shrink-0 ${value === opt.value ? 'text-primary-500' : 'text-gray-400'}`} />
                <div className="flex-1 min-w-0">
                  <span className="text-[11px] font-medium text-gray-900">{opt.label}</span>
                  <p className="text-[10px] text-gray-500 leading-tight">{opt.description}</p>
                </div>
                {value === opt.value && <Check className="h-3 w-3 text-primary-500 flex-shrink-0" />}
              </button>
            )
          })}
        </div>,
        document.body
      )}
    </>
  )
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function ObjectLinkPicker({ isOpen, onLinkMultiple, onClose, existingLinkIds, existingLinks = [], onDeleteLink }: ObjectLinkPickerProps) {
  const [query, setQuery] = useState('')
  const [activeFilter, setActiveFilter] = useState<SearchEntityType | null>(null)
  const [selected, setSelected] = useState<Map<string, SelectedLinkItem>>(new Map())
  const [defaultRelationship, setDefaultRelationship] = useState<LinkRelationshipType>('references')
  const [showDefaultMenu, setShowDefaultMenu] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const defaultMenuRef = useRef<HTMLDivElement>(null)

  const searchTypes = activeFilter ? [activeFilter] : PICKER_TYPES.map(t => t.key)

  const { results, isLoading } = useEntitySearch({
    query: query || ' ',
    types: searchTypes,
    limit: 8,
    enabled: isOpen,
  })

  // Reset state when modal opens
  useEffect(() => {
    if (isOpen) {
      setQuery('')
      setActiveFilter(null)
      setSelected(new Map())
      setDefaultRelationship('references')
      setShowDefaultMenu(false)
      setTimeout(() => inputRef.current?.focus(), 100)
    }
  }, [isOpen])

  // Close on Escape
  useEffect(() => {
    if (!isOpen) return
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (showDefaultMenu) { setShowDefaultMenu(false); return }
        onClose()
      }
    }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [isOpen, onClose, showDefaultMenu])

  // Close default menu on outside click
  useEffect(() => {
    if (!showDefaultMenu) return
    const handleClick = (e: MouseEvent) => {
      if (defaultMenuRef.current && !defaultMenuRef.current.contains(e.target as Node)) {
        setShowDefaultMenu(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [showDefaultMenu])

  const toggleSelect = useCallback((result: any) => {
    const isAlreadyLinked = existingLinkIds?.has(result.id)
    if (isAlreadyLinked) return

    setSelected(prev => {
      const next = new Map(prev)
      if (next.has(result.id)) {
        next.delete(result.id)
      } else {
        next.set(result.id, {
          id: result.id,
          entityType: toLinkableType(result.type, result.data),
          label: result.title,
          subtitle: result.subtitle,
          context: buildContextLine(result.type, result.subtitle, result.data),
          searchType: result.type,
          linkType: defaultRelationship,
        })
      }
      return next
    })
  }, [existingLinkIds, defaultRelationship])

  const updateItemRelationship = useCallback((id: string, linkType: LinkRelationshipType) => {
    setSelected(prev => {
      const next = new Map(prev)
      const item = next.get(id)
      if (item) next.set(id, { ...item, linkType })
      return next
    })
  }, [])

  const handleConfirm = useCallback(() => {
    if (selected.size === 0) return
    onLinkMultiple(Array.from(selected.values()))
  }, [selected, onLinkMultiple])

  // Deduplicate results
  const dedupedResults = useMemo(() => {
    const seen = new Set<string>()
    return results.filter(r => {
      if (seen.has(r.id)) return false
      seen.add(r.id)
      return true
    })
  }, [results])

  if (!isOpen) return null

  const activeDefault = INTENT_MAP.get(defaultRelationship)!
  const activeFilterLabel = activeFilter
    ? PICKER_TYPES.find(t => t.key === activeFilter)?.label || ''
    : ''

  return (
    <div
      className="fixed inset-0 bg-black/40 flex items-start justify-center z-50 pt-[12vh]"
      onClick={onClose}
    >
      <div
        className={`bg-white rounded-xl shadow-2xl w-full mx-4 overflow-hidden flex flex-col h-[520px] transition-all ${
          selected.size > 0 || existingLinks.length > 0 ? 'max-w-[850px]' : 'max-w-[600px]'
        }`}
        onClick={e => e.stopPropagation()}
      >
        {/* Search header */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-200">
          <Search className="h-4 w-4 text-gray-400 flex-shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search objects..."
            className="flex-1 text-sm bg-transparent border-0 outline-none placeholder-gray-400"
          />
          {query && (
            <button onClick={() => setQuery('')} className="p-0.5 hover:bg-gray-100 rounded transition-colors">
              <X className="h-3.5 w-3.5 text-gray-400" />
            </button>
          )}
          <button
            onClick={onClose}
            className="p-1 hover:bg-gray-100 rounded-md transition-colors"
          >
            <X className="h-4 w-4 text-gray-400" />
          </button>
        </div>

        {/* Type filter pills */}
        <div className="flex flex-wrap items-center gap-1.5 px-4 py-2 border-b border-gray-100">
          <button
            onClick={() => setActiveFilter(null)}
            className={`flex items-center gap-1 px-2.5 py-1 text-[11px] font-medium rounded-full whitespace-nowrap transition-colors ${
              activeFilter === null
                ? 'bg-gray-900 text-white'
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            <Layers className="h-3 w-3" />
            All
          </button>
          {PICKER_TYPES.map((t, i) => {
            const Icon = t.icon
            const isActive = activeFilter === t.key
            const colors = TYPE_COLORS[t.key]
            return (
              <button
                key={t.key}
                onClick={() => setActiveFilter(isActive ? null : t.key)}
                className={`flex items-center gap-1 px-2 py-1 text-[11px] font-medium rounded-full whitespace-nowrap transition-colors ${
                  i === 4 ? 'ml-1 ' : ''
                }${
                  isActive
                    ? colors?.pill || 'bg-gray-900 text-white'
                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}
              >
                <Icon className="h-3 w-3" />
                {t.label}
              </button>
            )
          })}
        </div>

        {/* Body: results (left) + selected panel (right) */}
        <div className="flex flex-1 min-h-0">
          {/* Results — left column */}
          <div className={`overflow-y-auto flex-1 min-h-0 ${selected.size > 0 || existingLinks.length > 0 ? 'border-r border-gray-100' : ''}`}>
            {isLoading ? (
              <div className="flex items-center justify-center py-10">
                <Loader2 className="h-5 w-5 text-gray-400 animate-spin" />
              </div>
            ) : dedupedResults.length === 0 ? (
              <div className="text-center py-10 px-6">
                <Search className="h-7 w-7 text-gray-300 mx-auto mb-2.5" />
                <p className="text-sm font-medium text-gray-500">
                  {query.trim() ? 'No matching objects' : 'Search to link objects'}
                </p>
                <p className="text-xs text-gray-400 mt-1">
                  {query.trim()
                    ? activeFilter
                      ? `No ${activeFilterLabel.toLowerCase()} match "${query}". Try a broader search or different filter.`
                      : 'Try a different search term or filter by object type'
                    : 'Link assets, ideas, trades, notes, and processes to this note'
                  }
                </p>
              </div>
            ) : (
              <div className="py-1">
                {dedupedResults.map(result => {
                  const Icon = TYPE_ICON_MAP[result.type] || FileText
                  const colors = TYPE_COLORS[result.type] || TYPE_COLORS.note
                  const isAlreadyLinked = existingLinkIds?.has(result.id) || false
                  const isSelected = selected.has(result.id)
                  const contextLine = buildContextLine(result.type, result.subtitle, result.data)

                  return (
                    <button
                      key={`${result.type}-${result.id}`}
                      onClick={() => toggleSelect(result)}
                      disabled={isAlreadyLinked}
                      className={`w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors ${
                        isAlreadyLinked
                          ? 'opacity-50 cursor-default'
                          : isSelected
                            ? 'bg-primary-50 border-l-2 border-l-primary-500'
                            : 'hover:bg-gray-50 cursor-pointer border-l-2 border-l-transparent'
                      }`}
                    >
                      {/* Selection indicator */}
                      <div className={`w-4 h-4 rounded border flex items-center justify-center flex-shrink-0 transition-colors ${
                        isSelected
                          ? 'bg-primary-600 border-primary-600'
                          : isAlreadyLinked
                            ? 'bg-gray-200 border-gray-300'
                            : 'border-gray-300'
                      }`}>
                        {(isSelected || isAlreadyLinked) && <Check className="h-3 w-3 text-white" />}
                      </div>

                      {/* Type icon */}
                      <div className={`w-7 h-7 rounded-lg ${colors.bg} flex items-center justify-center flex-shrink-0`}>
                        <Icon className={`h-3.5 w-3.5 ${colors.icon}`} />
                      </div>

                      {/* Content */}
                      <div className="flex-1 min-w-0">
                        <p className="text-[13px] font-medium text-gray-900 truncate leading-tight">{result.title}</p>
                        <p className="text-[11px] text-gray-500 truncate leading-tight mt-0.5">{contextLine}</p>
                      </div>

                      {isAlreadyLinked && (
                        <span className="text-[10px] font-medium text-gray-400 flex-shrink-0 bg-gray-100 px-1.5 py-0.5 rounded">Linked</span>
                      )}
                    </button>
                  )
                })}
              </div>
            )}
          </div>

          {/* Right panel: existing links + new selections */}
          {(selected.size > 0 || existingLinks.length > 0) && (
            <div className="w-[240px] flex-shrink-0 overflow-y-auto bg-gray-50/60 flex flex-col">
              {/* Existing links section */}
              {existingLinks.length > 0 && (
                <>
                  <div className="flex items-center justify-between px-3 pt-3 pb-1.5">
                    <p className="text-[11px] font-semibold text-gray-600">
                      Linked
                      <span className="text-gray-400 font-normal ml-1">({existingLinks.length})</span>
                    </p>
                  </div>
                  <div className="px-3 pb-2 space-y-1.5">
                    {existingLinks.map(link => {
                      // Resolve icon/color from target type
                      const searchType = LINKABLE_TO_SEARCH_TYPE[link.targetType]
                      const Icon = TYPE_ICON_MAP[searchType] || FileText
                      const colors = TYPE_COLORS[searchType] || TYPE_COLORS.note
                      const intentLabel = INTENT_MAP.get(link.linkType as LinkRelationshipType)?.label || link.linkType
                      return (
                        <div
                          key={link.id}
                          className="rounded-lg border border-gray-200 bg-white/80"
                        >
                          <div className="flex items-start gap-2 px-2.5 pt-2 pb-1.5">
                            <div className={`w-6 h-6 rounded-md ${colors.bg} flex items-center justify-center flex-shrink-0 mt-0.5`}>
                              <Icon className={`h-3 w-3 ${colors.icon}`} />
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="text-[12px] font-medium text-gray-900 truncate leading-tight">{link.label}</p>
                              {link.subtitle && (
                                <p className="text-[10px] text-gray-500 truncate leading-tight mt-0.5">{link.subtitle}</p>
                              )}
                            </div>
                            {!link.isAuto && onDeleteLink && (
                              <button
                                onClick={() => onDeleteLink(link.id)}
                                className="p-1 -mr-0.5 -mt-0.5 rounded-md hover:bg-red-50 hover:text-red-500 text-gray-400 transition-colors flex-shrink-0"
                                title="Remove link"
                              >
                                <X className="h-3 w-3" />
                              </button>
                            )}
                          </div>
                          <div className="px-2.5 pb-1.5 flex items-center gap-1.5">
                            <span className="text-[10px] text-gray-400">Relationship:</span>
                            <span className="text-[10px] font-medium text-gray-600">{intentLabel}</span>
                            {link.isAuto && (
                              <span className="text-[9px] text-gray-400 italic ml-auto">Inline reference</span>
                            )}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </>
              )}

              {/* New selections section */}
              {selected.size > 0 && (
                <>
                  <div className="flex items-center justify-between px-3 pt-2 pb-1.5">
                    <p className="text-[11px] font-semibold text-gray-600">
                      {existingLinks.length > 0 ? 'Adding' : 'Objects to Link'}
                      <span className="text-gray-400 font-normal ml-1">({selected.size})</span>
                    </p>
                    {selected.size > 1 && (
                      <button
                        onClick={() => setSelected(new Map())}
                        className="text-[10px] text-gray-400 hover:text-red-500 font-medium transition-colors"
                      >
                        Clear All
                      </button>
                    )}
                  </div>
                  <div className="flex-1 overflow-y-auto px-3 pb-3 space-y-2">
                    {Array.from(selected.values()).map(item => {
                      const Icon = TYPE_ICON_MAP[item.searchType] || FileText
                      const colors = TYPE_COLORS[item.searchType] || TYPE_COLORS.note
                      return (
                        <div
                          key={item.id}
                          className="rounded-lg border border-gray-200 bg-white shadow-sm"
                        >
                          {/* Object identity row */}
                          <div className="flex items-start gap-2 px-2.5 pt-2 pb-1.5">
                            <div className={`w-6 h-6 rounded-md ${colors.bg} flex items-center justify-center flex-shrink-0 mt-0.5`}>
                              <Icon className={`h-3 w-3 ${colors.icon}`} />
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="text-[12px] font-medium text-gray-900 truncate leading-tight">{item.label}</p>
                              {item.context && (
                                <p className="text-[10px] text-gray-500 truncate leading-tight mt-0.5">{item.context}</p>
                              )}
                            </div>
                            <button
                              onClick={() => setSelected(prev => {
                                const next = new Map(prev)
                                next.delete(item.id)
                                return next
                              })}
                              className="p-1 -mr-0.5 -mt-0.5 rounded-md hover:bg-red-50 hover:text-red-500 text-gray-400 transition-colors flex-shrink-0"
                              title="Remove"
                            >
                              <X className="h-3 w-3" />
                            </button>
                          </div>

                          {/* Relationship selector */}
                          <div className="px-2.5 pb-2 flex items-center gap-1.5">
                            <span className="text-[10px] text-gray-400">Relationship:</span>
                            <RelationshipPill
                              value={item.linkType}
                              onChange={(v) => updateItemRelationship(item.id, v)}
                            />
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </>
              )}
            </div>
          )}
        </div>

        {/* Footer: global default relationship + confirm */}
        <div className="border-t border-gray-200 px-4 py-2.5 bg-gray-50/80 flex items-center justify-between gap-3">
          {/* Global default relationship selector */}
          <div className="relative" ref={defaultMenuRef}>
            <button
              onClick={() => setShowDefaultMenu(!showDefaultMenu)}
              className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-gray-600 bg-white border border-gray-200 rounded-lg hover:border-gray-300 transition-colors"
            >
              <activeDefault.icon className="h-3 w-3 text-gray-400" />
              <span className="text-gray-400">Default Relationship:</span>
              <span>{activeDefault.label}</span>
              <ChevronDown className={`h-3 w-3 text-gray-400 transition-transform ${showDefaultMenu ? 'rotate-180' : ''}`} />
            </button>

            {showDefaultMenu && (
              <div className="absolute bottom-full left-0 mb-1.5 bg-white rounded-lg shadow-xl border border-gray-200 py-1 z-50 min-w-[240px]">
                {LINK_INTENTS.map(intent => {
                  const IntentIcon = intent.icon
                  return (
                    <button
                      key={intent.value}
                      onClick={() => { setDefaultRelationship(intent.value); setShowDefaultMenu(false) }}
                      className={`w-full px-3 py-2 text-left hover:bg-gray-50 transition-colors ${
                        defaultRelationship === intent.value ? 'bg-gray-50' : ''
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        <IntentIcon className={`h-3.5 w-3.5 flex-shrink-0 ${defaultRelationship === intent.value ? 'text-primary-500' : 'text-gray-400'}`} />
                        <span className="text-xs font-medium text-gray-900 flex-1">{intent.label}</span>
                        {defaultRelationship === intent.value && <Check className="h-3.5 w-3.5 text-primary-500 flex-shrink-0" />}
                      </div>
                      <p className="text-[11px] text-gray-500 mt-0.5 ml-[22px]">{intent.description}</p>
                    </button>
                  )
                })}
              </div>
            )}
          </div>

          {/* Confirm button */}
          <button
            onClick={handleConfirm}
            disabled={selected.size === 0}
            className={`px-4 py-1.5 text-xs font-medium rounded-lg transition-all flex-shrink-0 ${
              selected.size > 0
                ? 'bg-primary-600 text-white hover:bg-primary-700 shadow-sm'
                : 'bg-gray-100 text-gray-400 cursor-not-allowed'
            }`}
          >
            {selected.size === 0
              ? 'Select Objects to Link'
              : selected.size === 1
                ? 'Link 1 Object'
                : `Link ${selected.size} Objects`
            }
          </button>
        </div>
      </div>
    </div>
  )
}
