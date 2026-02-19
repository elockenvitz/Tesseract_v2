import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { X, Plus, TrendingUp, Briefcase, Tag, FileText, Home, File, List, User, Users, Settings, Lightbulb, Workflow, ChevronLeft, ChevronRight, Orbit, FolderKanban, ListTodo, Beaker, Clock, PieChart, Calendar, Building2, Target, FolderOpen, LineChart, ChevronDown, Check, Activity } from 'lucide-react'
import { clsx } from 'clsx'
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
  DragStartEvent,
  DragOverlay,
  Modifier,
  pointerWithin,
  rectIntersection,
} from '@dnd-kit/core'
import {
  arrayMove,
  SortableContext,
  useSortable,
  horizontalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'

export interface Tab {
  id: string
  title: string
  type: 'asset' | 'portfolio' | 'theme' | 'note' | 'dashboard' | 'assets-list'
  | 'portfolios-list' | 'themes-list' | 'notes-list' | 'lists' | 'list'
  | 'idea-generator' | 'workflows' | 'projects-list' | 'project'
  | 'trade-queue' | 'trade-lab' | 'trade-plans' | 'tdf' | 'tdf-list' | 'asset-allocation'
  | 'calendar' | 'priorities' | 'coverage' | 'organization' | 'outcomes' | 'files' | 'charting' | 'audit'
  data?: any
  isActive: boolean
  isBlank?: boolean
}

interface TabManagerProps {
  tabs: Tab[]
  activeTabId?: string
  onTabReorder: (fromIndex: number, toIndex: number) => void
  onTabsReorder?: (newTabs: Tab[]) => void // For moving multiple tabs (groups)
  onTabChange: (tabId: string) => void
  onTabClose: (tabId: string) => void
  onNewTab: () => void
  onFocusSearch: () => void
}

// Types that should NOT be grouped (singleton types)
const SINGLETON_TYPES = new Set([
  'dashboard', 'idea-generator', 'workflows', 'trade-queue',
  'trade-lab', 'trade-plans', 'asset-allocation', 'calendar',
  'priorities', 'coverage', 'organization', 'outcomes', 'files', 'charting', 'audit'
])

// Parent-child type relationships (parent list type -> child item type)
const TYPE_FAMILY: Record<string, string[]> = {
  'assets': ['assets-list', 'asset'],
  'portfolios': ['portfolios-list', 'portfolio'],
  'themes': ['themes-list', 'theme'],
  'notes': ['notes-list', 'note'],
  'lists': ['lists', 'list'],
  'projects': ['projects-list', 'project'],
  'tdfs': ['tdf-list', 'tdf']
}

// Reverse lookup: type -> family key
const TYPE_TO_FAMILY: Record<string, string> = {}
Object.entries(TYPE_FAMILY).forEach(([family, types]) => {
  types.forEach(type => {
    TYPE_TO_FAMILY[type] = family
  })
})

// Parent types (the list views)
const PARENT_TYPES = new Set(['assets-list', 'portfolios-list', 'themes-list', 'notes-list', 'lists', 'projects-list', 'tdf-list'])

// Family key -> parent type & title for auto-injecting parent tabs
const FAMILY_PARENT_INFO: Record<string, { type: Tab['type']; title: string }> = {
  'assets': { type: 'assets-list', title: 'Assets' },
  'portfolios': { type: 'portfolios-list', title: 'Portfolios' },
  'themes': { type: 'themes-list', title: 'Themes' },
  'notes': { type: 'notes-list', title: 'Notes' },
  'lists': { type: 'lists', title: 'Lists' },
  'projects': { type: 'projects-list', title: 'Projects' },
  'tdfs': { type: 'tdf-list', title: 'TDFs' },
}

// Get display name for tab type family
const getTypeDisplayName = (type: string): string => {
  const family = TYPE_TO_FAMILY[type]
  switch (family) {
    case 'assets': return 'Assets'
    case 'portfolios': return 'Portfolios'
    case 'themes': return 'Themes'
    case 'notes': return 'Notes'
    case 'lists': return 'Lists'
    case 'projects': return 'Projects'
    case 'tdfs': return 'TDFs'
    default: return type
  }
}

// Modifier to restrict drag overlay movement to horizontal axis only
const restrictToHorizontalAxis: Modifier = ({ transform }) => {
  return {
    ...transform,
    y: 0,
  }
}

/** Shows title tooltip only when text is truncated */
function TruncatedLabel({ text, className }: { text: string; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null)
  const [isTruncated, setIsTruncated] = useState(false)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const check = () => setIsTruncated(el.scrollWidth > el.clientWidth)
    check()
    const observer = new ResizeObserver(check)
    observer.observe(el)
    return () => observer.disconnect()
  }, [text])

  return (
    <span ref={ref} className={className} title={isTruncated ? text : undefined}>
      {text}
    </span>
  )
}

interface GroupedTabProps {
  tabs: Tab[]
  activeTab: Tab
  isGroupActive: boolean
  onTabChange: (tabId: string) => void
  onTabClose: (tabId: string) => void
  getTabIcon: (type: string) => JSX.Element
  sortableId: string
}

function GroupedTab({ tabs, activeTab, isGroupActive, onTabChange, onTabClose, getTabIcon, sortableId }: GroupedTabProps) {
  const [isDropdownOpen, setIsDropdownOpen] = useState(false)
  const [showCloseConfirm, setShowCloseConfirm] = useState(false)
  const [dropdownPosition, setDropdownPosition] = useState({ top: 0, left: 0 })
  const dropdownRef = useRef<HTMLDivElement>(null)

  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: sortableId,
  })

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    touchAction: 'none',
  }

  const containerRef = useRef<HTMLDivElement>(null)

  // Update dropdown position when opened
  const updateDropdownPosition = useCallback(() => {
    if (containerRef.current) {
      const rect = containerRef.current.getBoundingClientRect()
      setDropdownPosition({
        top: rect.bottom + 4,
        left: rect.left
      })
    }
  }, [])

  // Close dropdown on click outside
  useEffect(() => {
    if (!isDropdownOpen && !showCloseConfirm) return
    const handleClick = (e: MouseEvent) => {
      const target = e.target as Node
      if (
        dropdownRef.current && !dropdownRef.current.contains(target) &&
        containerRef.current && !containerRef.current.contains(target)
      ) {
        setIsDropdownOpen(false)
        setShowCloseConfirm(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [isDropdownOpen, showCloseConfirm])

  // Close dropdown on Escape
  useEffect(() => {
    if (!isDropdownOpen && !showCloseConfirm) return
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsDropdownOpen(false)
        setShowCloseConfirm(false)
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [isDropdownOpen, showCloseConfirm])

  // Update position on scroll/resize
  useEffect(() => {
    if (!isDropdownOpen && !showCloseConfirm) return
    updateDropdownPosition()
    window.addEventListener('scroll', updateDropdownPosition, true)
    window.addEventListener('resize', updateDropdownPosition)
    return () => {
      window.removeEventListener('scroll', updateDropdownPosition, true)
      window.removeEventListener('resize', updateDropdownPosition)
    }
  }, [isDropdownOpen, showCloseConfirm, updateDropdownPosition])

  const displayTab = activeTab

  const handleToggleDropdown = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (!isDropdownOpen) {
      updateDropdownPosition()
    }
    setIsDropdownOpen(!isDropdownOpen)
    setShowCloseConfirm(false)
  }

  const handleCloseClick = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (tabs.length > 1) {
      // Show confirmation before closing all tabs
      updateDropdownPosition()
      setShowCloseConfirm(true)
      setIsDropdownOpen(false)
    } else {
      onTabClose(displayTab.id)
    }
  }

  const handleConfirmCloseAll = () => {
    tabs.forEach(t => onTabClose(t.id))
    setShowCloseConfirm(false)
  }

  // Combine refs for sortable and container
  const combinedRef = useCallback((node: HTMLDivElement | null) => {
    setNodeRef(node)
    ;(containerRef as React.MutableRefObject<HTMLDivElement | null>).current = node
  }, [setNodeRef])

  return (
    <div
      ref={combinedRef}
      style={style}
      {...attributes}
      {...listeners}
      className={clsx(
        'relative flex items-center gap-2 pl-3 pr-8 py-2.5 border-b-2 cursor-pointer transition-colors duration-200 group flex-shrink-0',
        'min-w-[80px] max-w-[180px]',
        'border-r border-gray-200',
        isGroupActive
          ? 'border-b-primary-500 bg-primary-50 text-primary-700'
          : 'border-b-transparent hover:bg-gray-50 text-gray-600 hover:text-gray-900'
      )}
      onClick={() => onTabChange(displayTab.id)}
    >
      {/* Icon with count badge overlay */}
      <button
        onClick={(e) => { if (tabs.length > 1) { e.stopPropagation(); handleToggleDropdown(e) } }}
        onPointerDown={(e) => e.stopPropagation()}
        className={clsx(
          'relative text-gray-500 flex-shrink-0',
          tabs.length > 1 && 'cursor-pointer hover:text-gray-700'
        )}
        title={tabs.length > 1 ? `${tabs.length} ${getTypeDisplayName(displayTab.type)} open` : undefined}
      >
        {getTabIcon(displayTab.type)}
        {tabs.length > 1 && (
          <span className="absolute -top-2.5 -right-2 bg-gray-500 text-white text-[9px] font-semibold rounded-full min-w-[14px] h-[14px] flex items-center justify-center px-0.5">
            {tabs.length}
          </span>
        )}
      </button>

      {/* Tab name */}
      <TruncatedLabel text={displayTab.title} className="text-sm font-medium truncate min-w-0 flex-1" />

      {/* Close button - overlays text on hover */}
      <button
        onClick={handleCloseClick}
        onPointerDown={(e) => e.stopPropagation()}
        className="absolute right-2 opacity-0 group-hover:opacity-100 p-1 hover:bg-gray-200/80 rounded transition-opacity bg-white/80"
      >
        <X className="h-3 w-3" />
      </button>

      {/* Close confirmation - rendered via portal */}
      {showCloseConfirm && createPortal(
        <div
          ref={dropdownRef}
          className="fixed w-56 bg-white rounded-lg shadow-xl border border-gray-200 p-3 z-[100] animate-in fade-in slide-in-from-top-2 duration-150"
          style={{
            top: dropdownPosition.top,
            left: dropdownPosition.left
          }}
        >
          <p className="text-sm text-gray-700 mb-3">
            Close all {tabs.length} {getTypeDisplayName(displayTab.type).toLowerCase()}?
          </p>
          <div className="flex gap-2">
            <button
              onClick={() => setShowCloseConfirm(false)}
              className="flex-1 px-3 py-1.5 text-xs font-medium text-gray-600 bg-gray-100 hover:bg-gray-200 rounded transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleConfirmCloseAll}
              className="flex-1 px-3 py-1.5 text-xs font-medium text-white bg-red-500 hover:bg-red-600 rounded transition-colors"
            >
              Close All
            </button>
          </div>
        </div>,
        document.body
      )}

      {/* Dropdown menu - rendered via portal */}
      {isDropdownOpen && tabs.length > 1 && createPortal(
        <div
          ref={dropdownRef}
          className="fixed w-64 bg-white rounded-lg shadow-xl border border-gray-200 py-1 z-[100] animate-in fade-in slide-in-from-top-2 duration-150"
          style={{
            top: dropdownPosition.top,
            left: dropdownPosition.left
          }}
        >
          <div className="max-h-64 overflow-y-auto py-1">
            {tabs.map((tab, index) => {
              const isParent = PARENT_TYPES.has(tab.type)
              const prevTab = index > 0 ? tabs[index - 1] : null
              const showDivider = prevTab && PARENT_TYPES.has(prevTab.type) && !isParent

              return (
                <React.Fragment key={tab.id}>
                  {showDivider && (
                    <div className="mx-3 my-1 border-t border-gray-200" />
                  )}
                  <div
                    className={clsx(
                      'flex items-center gap-2 px-3 py-2 hover:bg-gray-50 cursor-pointer group/item',
                      tab.id === displayTab.id && 'bg-blue-50',
                      isParent && 'bg-gray-50/50'
                    )}
                    onClick={(e) => {
                      e.stopPropagation()
                      onTabChange(tab.id)
                      setIsDropdownOpen(false)
                    }}
                  >
                    <span className={clsx('text-gray-400', isParent && 'text-gray-500')}>
                      {getTabIcon(tab.type)}
                    </span>
                    <span className={clsx(
                      'text-sm flex-1 truncate',
                      tab.id === displayTab.id ? 'font-medium text-blue-700' : 'text-gray-700',
                      isParent && 'font-medium'
                    )}>
                      {isParent ? `All ${getTypeDisplayName(tab.type)}` : tab.title}
                    </span>
                    {tab.id === displayTab.id && (
                      <Check className="h-4 w-4 text-blue-600 flex-shrink-0" />
                    )}
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        onTabClose(tab.id)
                        if (tabs.length === 1) setIsDropdownOpen(false)
                      }}
                      className="opacity-0 group-hover/item:opacity-100 p-1 hover:bg-gray-200 rounded transition-opacity"
                    >
                      <X className="h-3 w-3 text-gray-400" />
                    </button>
                  </div>
                </React.Fragment>
              )
            })}
          </div>
        </div>,
        document.body
      )}
    </div>
  )
}

interface SortableTabProps {
  tab: Tab
  isActive: boolean
  onTabChange: (tabId: string) => void
  onTabClose: (tabId: string) => void
  getTabIcon: (type: string) => JSX.Element
}

function SortableTab({ tab, isActive, onTabChange, onTabClose, getTabIcon }: SortableTabProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: tab.id,
    disabled: tab.id === 'dashboard',
  })

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    touchAction: 'none',
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      className={clsx(
        'relative flex items-center gap-2 pl-3 pr-8 py-2.5 border-b-2 cursor-pointer transition-colors duration-200 group flex-shrink-0',
        'min-w-[80px] max-w-[180px]',
        'border-r border-gray-200',
        isActive
          ? 'border-b-primary-500 bg-primary-50 text-primary-700'
          : 'border-b-transparent hover:bg-gray-50 text-gray-600 hover:text-gray-900'
      )}
      onClick={() => onTabChange(tab.id)}
    >
      <span className="text-gray-500 flex-shrink-0">{getTabIcon(tab.type)}</span>
      <TruncatedLabel text={tab.isBlank ? 'New Tab' : tab.title} className="text-sm font-medium truncate min-w-0 flex-1" />
      {(tab.type !== 'dashboard' || tab.isBlank) && (
        <button
          onClick={(e) => {
            e.stopPropagation()
            onTabClose(tab.id)
          }}
          className="absolute right-2 opacity-0 group-hover:opacity-100 p-1 hover:bg-gray-200/80 rounded transition-opacity bg-white/80"
        >
          <X className="h-3 w-3" />
        </button>
      )}
    </div>
  )
}

export function TabManager({ tabs, onTabReorder, onTabsReorder, onTabChange, onTabClose, onNewTab, onFocusSearch }: TabManagerProps) {
  const [activeId, setActiveId] = useState<string | null>(null)
  const [showLeftArrow, setShowLeftArrow] = useState(false)
  const [showRightArrow, setShowRightArrow] = useState(false)
  const [hasOverflow, setHasOverflow] = useState(false)
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const prevTabsLengthRef = useRef(tabs.length)

  // Track the "selected" tab for each family (e.g., 'assets', 'themes')
  const [selectedTabPerFamily, setSelectedTabPerFamily] = useState<Record<string, string>>({})

  // Update selected tab when active tab changes
  useEffect(() => {
    const activeTab = tabs.find(t => t.isActive)
    if (activeTab) {
      const family = TYPE_TO_FAMILY[activeTab.type]
      if (family) {
        setSelectedTabPerFamily(prev => ({
          ...prev,
          [family]: activeTab.id
        }))
      }
    }
  }, [tabs])

  // Group tabs by family and create consolidated view
  const consolidatedTabs = useMemo(() => {
    const finalResult: { type: 'single' | 'group'; tab?: Tab; tabs?: Tab[]; activeTab?: Tab; key: string }[] = []
    const groupedByFamily: Record<string, Tab[]> = {}
    const processedFamilies = new Set<string>()

    // First pass: group tabs by family
    tabs.forEach(tab => {
      if (tab.isBlank) return // Skip blank tabs in first pass

      const family = TYPE_TO_FAMILY[tab.type]
      if (family) {
        if (!groupedByFamily[family]) {
          groupedByFamily[family] = []
        }
        groupedByFamily[family].push(tab)
      }
    })

    // Second pass: build result maintaining tab order
    tabs.forEach(tab => {
      if (tab.isBlank) {
        // Blank tabs are always shown individually
        finalResult.push({ type: 'single', tab, key: tab.id })
      } else if (SINGLETON_TYPES.has(tab.type)) {
        // Singleton types shown individually
        finalResult.push({ type: 'single', tab, key: tab.id })
      } else {
        const family = TYPE_TO_FAMILY[tab.type]

        if (!family) {
          // No family, show individually
          finalResult.push({ type: 'single', tab, key: tab.id })
        } else if (!processedFamilies.has(family)) {
          // First occurrence of this family
          processedFamilies.add(family)
          const familyTabs = groupedByFamily[family] || []

          if (familyTabs.length === 1) {
            // Only one tab in this family, show as single
            finalResult.push({ type: 'single', tab: familyTabs[0], key: familyTabs[0].id })
          } else if (familyTabs.length > 1) {
            // Auto-inject parent tab if none exists
            const hasParent = familyTabs.some(t => PARENT_TYPES.has(t.type))
            const parentInfo = FAMILY_PARENT_INFO[family]
            const allTabs = hasParent || !parentInfo ? familyTabs : [
              { id: parentInfo.type, title: parentInfo.title, type: parentInfo.type, isActive: false } as Tab,
              ...familyTabs
            ]

            // Multiple tabs in family - sort with parent first, then by recency
            const sortedTabs = [...allTabs].sort((a, b) => {
              const aIsParent = PARENT_TYPES.has(a.type)
              const bIsParent = PARENT_TYPES.has(b.type)

              // Parent always first
              if (aIsParent && !bIsParent) return -1
              if (!aIsParent && bIsParent) return 1

              // For children, maintain original order (which is open order)
              return 0
            })

            // Determine which tab to show (active or selected or first non-parent)
            const selectedId = selectedTabPerFamily[family]
            const activeInGroup = allTabs.find(t => t.isActive)
            const selectedTab = allTabs.find(t => t.id === selectedId)
            // Prefer non-parent tabs for display, but fall back to parent
            const displayTab = activeInGroup || selectedTab ||
              allTabs.find(t => !PARENT_TYPES.has(t.type)) || allTabs[0]

            finalResult.push({
              type: 'group',
              tabs: sortedTabs,
              activeTab: displayTab,
              key: `group-${family}`
            })
          }
        }
        // Skip subsequent tabs of already-processed families
      }
    })

    return finalResult
  }, [tabs, selectedTabPerFamily])

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 10,
      },
    })
  )

  const handleDragStart = (event: DragStartEvent) => {
    setActiveId(event.active.id as string)
  }

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event
    setActiveId(null)

    if (!over) return

    const activeIdStr = String(active.id)
    const overIdStr = String(over.id)

    if (activeIdStr === overIdStr) return

    // Get sortable items (same as SortableContext)
    const sortableItems = consolidatedTabs.map(item =>
      item.type === 'single' && item.tab ? item.tab.id :
      item.type === 'group' && item.tabs ? item.tabs[0].id : item.key
    )

    const activeIndex = sortableItems.indexOf(activeIdStr)
    const overIndex = sortableItems.indexOf(overIdStr)

    if (activeIndex === -1 || overIndex === -1 || activeIndex === overIndex) return

    // Get the consolidated item being moved
    const activeConsolidated = consolidatedTabs[activeIndex]

    // Get all tab IDs being moved (single tab or all tabs in group)
    const movingTabIds: string[] = []
    if (activeConsolidated.type === 'single' && activeConsolidated.tab) {
      movingTabIds.push(activeConsolidated.tab.id)
    } else if (activeConsolidated.type === 'group' && activeConsolidated.tabs) {
      activeConsolidated.tabs.forEach(t => movingTabIds.push(t.id))
    }

    if (movingTabIds.length === 0) return

    // For single tab moves, use the simple callback
    if (movingTabIds.length === 1) {
      const oldIndex = tabs.findIndex(t => t.id === movingTabIds[0])
      const newIndex = tabs.findIndex(t => t.id === overIdStr)
      if (oldIndex !== -1 && newIndex !== -1 && oldIndex !== newIndex) {
        onTabReorder(oldIndex, newIndex)
      }
      return
    }

    // For group moves, we need to move all tabs together
    if (!onTabsReorder) {
      // Fallback: just move the first tab
      const oldIndex = tabs.findIndex(t => t.id === movingTabIds[0])
      const newIndex = tabs.findIndex(t => t.id === overIdStr)
      if (oldIndex !== -1 && newIndex !== -1 && oldIndex !== newIndex) {
        onTabReorder(oldIndex, newIndex)
      }
      return
    }

    // Use arrayMove on consolidated items to get new order
    const newConsolidatedOrder = arrayMove(consolidatedTabs, activeIndex, overIndex)

    // Rebuild tabs array based on new consolidated order
    const newTabs: Tab[] = []
    for (const item of newConsolidatedOrder) {
      if (item.type === 'single' && item.tab) {
        newTabs.push(item.tab)
      } else if (item.type === 'group' && item.tabs) {
        newTabs.push(...item.tabs)
      }
    }

    onTabsReorder(newTabs)
  }

  // Simple function to update all scroll-related state
  const updateScrollState = useCallback(() => {
    const container = scrollContainerRef.current
    if (!container) return

    const { scrollLeft, scrollWidth, clientWidth } = container
    const maxScrollLeft = scrollWidth - clientWidth
    const contentOverflows = maxScrollLeft > 0

    setHasOverflow(contentOverflows)
    setShowLeftArrow(scrollLeft > 20)
    setShowRightArrow(contentOverflows && scrollLeft < maxScrollLeft - 10)
  }, [])

  const scrollLeftClick = () => {
    const container = scrollContainerRef.current
    if (!container) return

    const scrollAmount = container.clientWidth * 0.75
    const targetScrollLeft = Math.max(0, container.scrollLeft - scrollAmount)

    container.scrollTo({ left: targetScrollLeft, behavior: 'smooth' })
  }

  const scrollRightClick = () => {
    const container = scrollContainerRef.current
    if (!container) return

    const maxScrollLeft = container.scrollWidth - container.clientWidth
    const scrollAmount = container.clientWidth * 0.75
    const targetScrollLeft = Math.min(maxScrollLeft, container.scrollLeft + scrollAmount)

    container.scrollTo({ left: targetScrollLeft, behavior: 'smooth' })
  }

  const scrollToEnd = useCallback(() => {
    const container = scrollContainerRef.current
    if (!container) return

    const maxScrollLeft = container.scrollWidth - container.clientWidth
    if (maxScrollLeft > 0) {
      container.scrollLeft = maxScrollLeft
    }
  }, [])

  // Update scroll state on tabs change, resize, and scroll
  useEffect(() => {
    updateScrollState()
    window.addEventListener('resize', updateScrollState)
    return () => window.removeEventListener('resize', updateScrollState)
  }, [tabs, updateScrollState])

  // Handle tab additions - scroll to show new tab
  useEffect(() => {
    const wasAdding = tabs.length > prevTabsLengthRef.current
    prevTabsLengthRef.current = tabs.length

    if (wasAdding) {
      // Wait for DOM to update, then scroll to end and update state
      requestAnimationFrame(() => {
        scrollToEnd()
        // After scroll, update state
        requestAnimationFrame(() => {
          updateScrollState()
        })
      })
    } else if (tabs.length < prevTabsLengthRef.current + 1) {
      // Tab removed - update state
      requestAnimationFrame(updateScrollState)
    }
  }, [tabs.length, scrollToEnd, updateScrollState])

  // Listen for scroll events
  useEffect(() => {
    const container = scrollContainerRef.current
    if (!container) return

    const handleScroll = () => updateScrollState()
    container.addEventListener('scroll', handleScroll)
    return () => container.removeEventListener('scroll', handleScroll)
  }, [updateScrollState])

  const getTabIcon = (type: string) => {
    switch (type) {
      case 'asset': return <TrendingUp className="h-3.5 w-3.5" />
      case 'assets-list': return <TrendingUp className="h-3.5 w-3.5" />
      case 'portfolios-list': return <Briefcase className="h-3.5 w-3.5" />
      case 'themes-list': return <Tag className="h-3.5 w-3.5" />
      case 'notes-list': return <FileText className="h-3.5 w-3.5" />
      case 'lists': return <List className="h-3.5 w-3.5" />
      case 'list': return <List className="h-3.5 w-3.5" />
      case 'idea-generator': return <Lightbulb className="h-3.5 w-3.5" />
      case 'portfolio': return <Briefcase className="h-3.5 w-3.5" />
      case 'theme': return <Tag className="h-3.5 w-3.5" />
      case 'note': return <FileText className="h-3.5 w-3.5" />
      case 'workflows': return <Orbit className="h-3.5 w-3.5" />
      case 'projects-list': return <FolderKanban className="h-3.5 w-3.5" />
      case 'project': return <FolderKanban className="h-3.5 w-3.5" />
      case 'trade-queue': return <ListTodo className="h-3.5 w-3.5" />
      case 'trade-lab': return <Beaker className="h-3.5 w-3.5" />
      case 'tdf': return <Clock className="h-3.5 w-3.5" />
      case 'tdf-list': return <Clock className="h-3.5 w-3.5" />
      case 'asset-allocation': return <PieChart className="h-3.5 w-3.5" />
      case 'calendar': return <Calendar className="h-3.5 w-3.5" />
      case 'priorities': return <Target className="h-3.5 w-3.5" />
      case 'coverage': return <Users className="h-3.5 w-3.5" />
      case 'organization': return <Building2 className="h-3.5 w-3.5" />
      case 'outcomes': return <Target className="h-3.5 w-3.5" />
      case 'files': return <FolderOpen className="h-3.5 w-3.5" />
      case 'charting': return <LineChart className="h-3.5 w-3.5" />
      case 'audit': return <Activity className="h-3.5 w-3.5" />
      case 'dashboard': return <Home className="h-3.5 w-3.5" />
      case 'profile': return <User className="h-3.5 w-3.5" />
      case 'user': return <User className="h-3.5 w-3.5" />
      case 'settings': return <Settings className="h-3.5 w-3.5" />
      case 'templates': return <FileText className="h-3.5 w-3.5" />
      default: return <File className="h-3.5 w-3.5" />
    }
  }

  const handleNewTabClick = () => {
    const existingBlankTab = tabs.find(tab => tab.isBlank)

    if (existingBlankTab) {
      onTabChange(existingBlankTab.id)
      setTimeout(() => {
        onFocusSearch?.()
      }, 100)
    } else {
      onNewTab()
      // The useEffect on tabs.length handles scrolling to show the new tab
      setTimeout(() => {
        onFocusSearch?.()
      }, 100)
    }
  }

  // Find the tab to show in drag overlay - for groups, show the displayed tab
  const getDragOverlayTab = () => {
    if (!activeId) return null

    // Check if this is a grouped tab by finding it in consolidatedTabs
    for (const item of consolidatedTabs) {
      if (item.type === 'group' && item.tabs) {
        // Check if activeId matches the sortableId (first tab's id)
        if (item.tabs[0].id === activeId) {
          // Return the displayed tab for this group
          return item.activeTab
        }
      } else if (item.type === 'single' && item.tab?.id === activeId) {
        return item.tab
      }
    }

    // Fallback to finding by id
    return tabs.find(tab => tab.id === activeId)
  }

  const dragOverlayTab = getDragOverlayTab()

  return (
    <div className="bg-white border-b border-gray-200 px-2 sticky top-16 z-30 relative">
      <div className="flex items-center">
        {/* Left arrow - smoothly expands/collapses */}
        <div
          className={clsx(
            "flex-shrink-0 overflow-hidden transition-all duration-200 ease-in-out",
            showLeftArrow ? "w-8 mr-1" : "w-0"
          )}
        >
          <button
            onClick={scrollLeftClick}
            className="flex items-center justify-center w-7 h-7 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded transition-colors"
            title="Scroll left"
            tabIndex={showLeftArrow ? 0 : -1}
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
        </div>

        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
          modifiers={[restrictToHorizontalAxis]}
        >
          <SortableContext
            items={consolidatedTabs.map(item =>
              item.type === 'single' && item.tab ? item.tab.id :
              item.type === 'group' && item.tabs ? item.tabs[0].id : item.key
            )}
            strategy={horizontalListSortingStrategy}
          >
            <div
              ref={scrollContainerRef}
              className="flex items-center overflow-x-auto flex-1"
              style={{
                scrollbarWidth: 'none',
                msOverflowStyle: 'none',
                paddingLeft: '8px',
                paddingRight: hasOverflow ? (showRightArrow ? '60px' : '44px') : '8px' // Reserve space for fixed controls
              }}
            >
              {consolidatedTabs.map((item) => {
                if (item.type === 'single' && item.tab) {
                  return (
                    <SortableTab
                      key={item.key}
                      tab={item.tab}
                      isActive={item.tab.isActive}
                      onTabChange={onTabChange}
                      onTabClose={onTabClose}
                      getTabIcon={getTabIcon}
                    />
                  )
                } else if (item.type === 'group' && item.tabs && item.activeTab) {
                  const isGroupActive = item.tabs.some(t => t.isActive)
                  return (
                    <GroupedTab
                      key={item.key}
                      tabs={item.tabs}
                      activeTab={item.activeTab}
                      isGroupActive={isGroupActive}
                      onTabChange={onTabChange}
                      onTabClose={onTabClose}
                      getTabIcon={getTabIcon}
                      sortableId={item.tabs[0].id}
                    />
                  )
                }
                return null
              })}
              {/* Inline plus button - shown when no overflow */}
              {!hasOverflow && (
                <button
                  onClick={handleNewTabClick}
                  className="flex items-center justify-center w-7 h-7 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded transition-colors flex-shrink-0 ml-1"
                  title={tabs.find(tab => tab.isBlank) ? "Go to new tab" : "New tab"}
                >
                  <Plus className="h-4 w-4" />
                </button>
              )}
            </div>
          </SortableContext>
          <DragOverlay>
            {activeId && dragOverlayTab ? (
              <div className="flex items-center gap-2 px-3 py-2.5 border-b-2 border-b-primary-500 bg-primary-50 text-primary-700 rounded shadow-lg flex-shrink-0 min-w-[100px] max-w-[200px]">
                <span className="text-gray-500 flex-shrink-0">{getTabIcon(dragOverlayTab.type)}</span>
                <span className="text-sm font-medium truncate">{dragOverlayTab.title}</span>
              </div>
            ) : null}
          </DragOverlay>
        </DndContext>

        {/* Right side controls - only shown when tabs overflow */}
        {hasOverflow && (
          <div className="absolute right-2 top-0 bottom-0 flex items-center bg-white pl-2">
            {/* Right arrow - only shown when there's more content to scroll */}
            {showRightArrow && (
              <button
                onClick={scrollRightClick}
                className="flex items-center justify-center w-7 h-7 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded transition-colors bg-white mr-1"
                title="Scroll right"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            )}

            <button
              onClick={handleNewTabClick}
              className="flex items-center justify-center w-7 h-7 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded transition-colors flex-shrink-0 bg-white"
              title={tabs.find(tab => tab.isBlank) ? "Go to new tab" : "New tab"}
            >
              <Plus className="h-4 w-4" />
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
