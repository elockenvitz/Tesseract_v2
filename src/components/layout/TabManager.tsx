import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { X, Plus, TrendingUp, Briefcase, Tag, FileText, Home, File, List, User, Users, Settings, Lightbulb, Workflow, ChevronLeft, ChevronRight, Orbit, FolderKanban, ListTodo, Beaker, Clock, PieChart, Calendar, Building2, MessageSquareText, FolderOpen, LineChart, ChevronDown, Check } from 'lucide-react'
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
  | 'trade-queue' | 'simulation' | 'trade-lab' | 'tdf' | 'tdf-list' | 'asset-allocation'
  | 'calendar' | 'prioritizer' | 'coverage' | 'organization' | 'reasons' | 'files' | 'charting'
  data?: any
  isActive: boolean
  isBlank?: boolean
}

interface TabManagerProps {
  tabs: Tab[]
  activeTabId?: string
  onTabReorder: (fromIndex: number, toIndex: number) => void
  onTabChange: (tabId: string) => void
  onTabClose: (tabId: string) => void
  onNewTab: () => void
  onFocusSearch: () => void
}

// Types that should NOT be grouped (singleton types)
const SINGLETON_TYPES = new Set([
  'dashboard', 'idea-generator', 'workflows', 'trade-queue',
  'simulation', 'trade-lab', 'asset-allocation', 'calendar',
  'prioritizer', 'coverage', 'organization', 'reasons', 'files', 'charting'
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
    >
      {/* Icon with count badge overlay */}
      <button
        onClick={tabs.length > 1 ? handleToggleDropdown : undefined}
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

      {/* Tab name - clickable to switch */}
      <span
        className="text-sm font-medium truncate min-w-0 flex-1 cursor-pointer"
        title={displayTab.title}
        onClick={() => onTabChange(displayTab.id)}
      >
        {displayTab.title}
      </span>

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
          <div className="px-3 py-2 border-b border-gray-100">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
              {tabs.length} {getTypeDisplayName(displayTab.type)} Open
            </p>
          </div>
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
                    onClick={() => {
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
          {tabs.filter(t => !PARENT_TYPES.has(t.type)).length > 1 && (
            <div className="px-3 py-2 border-t border-gray-100">
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  // Close all child tabs except the current one (keep parent)
                  tabs
                    .filter(t => !PARENT_TYPES.has(t.type) && t.id !== displayTab.id)
                    .forEach(t => onTabClose(t.id))
                  setIsDropdownOpen(false)
                }}
                className="text-xs text-red-600 hover:text-red-800 font-medium"
              >
                Close Other Tabs
              </button>
            </div>
          )}
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
      <span className="text-sm font-medium truncate min-w-0 flex-1" title={tab.isBlank ? 'New Tab' : tab.title}>
        {tab.isBlank ? 'New Tab' : tab.title}
      </span>
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

export function TabManager({ tabs, onTabReorder, onTabChange, onTabClose, onNewTab, onFocusSearch }: TabManagerProps) {
  const [activeId, setActiveId] = useState<string | null>(null)
  const [showLeftArrow, setShowLeftArrow] = useState(false)
  const [showRightArrow, setShowRightArrow] = useState(false)
  const [isScrolling, setIsScrolling] = useState(false)
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const scrollTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const visibilityCheckTimeoutRef = useRef<NodeJS.Timeout | null>(null)

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
            // Multiple tabs in family - sort with parent first, then by recency (reverse order in array = more recent)
            const sortedTabs = [...familyTabs].sort((a, b) => {
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
            const activeInGroup = familyTabs.find(t => t.isActive)
            const selectedTab = familyTabs.find(t => t.id === selectedId)
            // Prefer non-parent tabs for display, but fall back to parent
            const displayTab = activeInGroup || selectedTab ||
              familyTabs.find(t => !PARENT_TYPES.has(t.type)) || familyTabs[0]

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
        distance: 5,
      },
    })
  )

  const handleDragStart = (event: DragStartEvent) => {
    setActiveId(event.active.id as string)
  }

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event

    if (over && active.id !== over.id) {
      const oldIndex = tabs.findIndex(tab => tab.id === active.id)
      const newIndex = tabs.findIndex(tab => tab.id === over.id)

      if (oldIndex !== -1 && newIndex !== -1) {
        onTabReorder(oldIndex, newIndex)
      }
    }

    setActiveId(null)
  }

  const checkScrollVisibility = () => {
    if (scrollContainerRef.current) {
      const { scrollLeft, scrollWidth, clientWidth } = scrollContainerRef.current
      const leftPadding = 16
      const rightPadding = 60

      setShowLeftArrow(scrollLeft > leftPadding + 10)
      setShowRightArrow(scrollLeft < scrollWidth - clientWidth - rightPadding - 10)
    }
  }

  const debouncedCheckScrollVisibility = () => {
    if (isScrolling) return

    if (visibilityCheckTimeoutRef.current) {
      clearTimeout(visibilityCheckTimeoutRef.current)
    }
    visibilityCheckTimeoutRef.current = setTimeout(() => {
      if (!isScrolling) {
        checkScrollVisibility()
      }
    }, 150)
  }

  const scrollLeft = () => {
    if (scrollContainerRef.current && !isScrolling) {
      setIsScrolling(true)
      const container = scrollContainerRef.current
      const containerWidth = container.clientWidth
      const currentScrollLeft = container.scrollLeft

      const scrollAmount = containerWidth * 0.75
      const targetScrollLeft = Math.max(0, currentScrollLeft - scrollAmount)

      container.scrollTo({
        left: targetScrollLeft,
        behavior: 'smooth'
      })

      if (scrollTimeoutRef.current) {
        clearTimeout(scrollTimeoutRef.current)
      }
      scrollTimeoutRef.current = setTimeout(() => {
        setIsScrolling(false)
      }, 400)
    }
  }

  const scrollRight = () => {
    if (scrollContainerRef.current && !isScrolling) {
      setIsScrolling(true)
      const container = scrollContainerRef.current
      const containerWidth = container.clientWidth
      const currentScrollLeft = container.scrollLeft
      const maxScrollLeft = container.scrollWidth - containerWidth
      const rightPadding = 60

      const scrollAmount = containerWidth * 0.75
      const targetScrollLeft = Math.min(currentScrollLeft + scrollAmount, maxScrollLeft - rightPadding)

      container.scrollTo({
        left: targetScrollLeft,
        behavior: 'smooth'
      })

      if (scrollTimeoutRef.current) {
        clearTimeout(scrollTimeoutRef.current)
      }
      scrollTimeoutRef.current = setTimeout(() => {
        setIsScrolling(false)
      }, 400)
    }
  }

  const scrollToShowLastTab = () => {
    if (scrollContainerRef.current) {
      const container = scrollContainerRef.current
      const lastTab = container.children[container.children.length - 1] as HTMLElement

      if (lastTab) {
        requestAnimationFrame(() => {
          const containerRect = container.getBoundingClientRect()
          const tabRect = lastTab.getBoundingClientRect()

          if (tabRect.right > containerRect.right) {
            const scrollDistance = container.scrollLeft + (tabRect.right - containerRect.right) + 24

            container.scrollTo({
              left: scrollDistance,
              behavior: 'smooth'
            })
          }
        })
      }
    }
  }

  useEffect(() => {
    checkScrollVisibility()
    const handleResize = () => checkScrollVisibility()
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [tabs])

  useEffect(() => {
    const timer = setTimeout(() => {
      scrollToShowLastTab()
      checkScrollVisibility()
    }, 100)

    return () => clearTimeout(timer)
  }, [tabs.length])

  useEffect(() => {
    const container = scrollContainerRef.current
    if (container) {
      container.addEventListener('scroll', debouncedCheckScrollVisibility)
      return () => {
        container.removeEventListener('scroll', debouncedCheckScrollVisibility)
        if (visibilityCheckTimeoutRef.current) {
          clearTimeout(visibilityCheckTimeoutRef.current)
        }
      }
    }
  }, [])

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
      case 'simulation': return <Beaker className="h-3.5 w-3.5" />
      case 'trade-lab': return <Beaker className="h-3.5 w-3.5" />
      case 'tdf': return <Clock className="h-3.5 w-3.5" />
      case 'tdf-list': return <Clock className="h-3.5 w-3.5" />
      case 'asset-allocation': return <PieChart className="h-3.5 w-3.5" />
      case 'calendar': return <Calendar className="h-3.5 w-3.5" />
      case 'prioritizer': return <ListTodo className="h-3.5 w-3.5" />
      case 'coverage': return <Users className="h-3.5 w-3.5" />
      case 'organization': return <Building2 className="h-3.5 w-3.5" />
      case 'reasons': return <MessageSquareText className="h-3.5 w-3.5" />
      case 'files': return <FolderOpen className="h-3.5 w-3.5" />
      case 'charting': return <LineChart className="h-3.5 w-3.5" />
      case 'dashboard': return <Home className="h-3.5 w-3.5" />
      case 'profile': return <User className="h-3.5 w-3.5" />
      case 'settings': return <Settings className="h-3.5 w-3.5" />
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
    <div className="bg-white border-b border-gray-200 px-2 sticky top-16 z-30">
      <div className="flex items-center">
        {showLeftArrow && (
          <button
            onClick={scrollLeft}
            className="flex items-center justify-center w-7 h-7 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded transition-colors mr-1 flex-shrink-0"
            title="Scroll left"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
        )}

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
                paddingRight: '40px'
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

        {showRightArrow && (
          <button
            onClick={scrollRight}
            className="flex items-center justify-center w-7 h-7 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded transition-colors ml-1 flex-shrink-0"
            title="Scroll right"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        )}

        <button
          onClick={handleNewTabClick}
          className="flex items-center justify-center w-7 h-7 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded transition-colors ml-1 flex-shrink-0"
          title={tabs.find(tab => tab.isBlank) ? "Go to new tab" : "New tab"}
        >
          <Plus className="h-4 w-4" />
        </button>
      </div>
    </div>
  )
}
