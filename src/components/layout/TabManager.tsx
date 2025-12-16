import React, { useState, useRef } from 'react'
import { X, Plus, TrendingUp, Briefcase, Tag, FileText, Home, File, List, User, Users, Settings, Lightbulb, Workflow, ChevronLeft, ChevronRight, Orbit, FolderKanban, ListTodo, Beaker, Clock, PieChart, Calendar, Building2, MessageSquareText, FolderOpen, LineChart } from 'lucide-react'
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

interface SortableTabProps {
  tab: Tab
  isActive: boolean
  onTabChange: (tabId: string) => void
  onTabClose: (tabId: string) => void
  getTabIcon: (type: string) => JSX.Element
}

// Modifier to restrict drag overlay movement to horizontal axis only
const restrictToHorizontalAxis: Modifier = ({ transform }) => {
  return {
    ...transform,
    y: 0,
  }
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

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    cursor: tab.id === 'dashboard' ? 'default' : 'grab',
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      className={clsx(
        'flex items-center space-x-2 px-4 py-3 border-b-2 cursor-pointer transition-colors duration-200 group flex-shrink-0',
        'min-w-[120px] max-w-[200px]',
        isActive
          ? 'border-primary-500 bg-primary-50 text-primary-700'
          : 'border-transparent hover:bg-gray-50 text-gray-600 hover:text-gray-900',
        tab.id === 'dashboard' && 'cursor-default'
      )}
      onClick={() => onTabChange(tab.id)}
    >
      <span className="text-gray-500">{getTabIcon(tab.type)}</span>
      <span className="text-sm font-medium truncate min-w-0 max-w-[120px]" title={tab.isBlank ? 'New Tab' : tab.title}>
        {tab.isBlank ? 'New Tab' : tab.title}
      </span>
      {(tab.type !== 'dashboard' || tab.isBlank) && (
        <button
          onClick={(e) => {
            e.stopPropagation()
            onTabClose(tab.id)
          }}
          className="opacity-0 group-hover:opacity-100 p-1 hover:bg-gray-200 rounded transition-opacity"
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

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8, // Require 8px of movement before drag starts
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

  React.useEffect(() => {
    checkScrollVisibility()
    const handleResize = () => checkScrollVisibility()
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [tabs])

  React.useEffect(() => {
    const timer = setTimeout(() => {
      scrollToShowLastTab()
      checkScrollVisibility()
    }, 100)

    return () => clearTimeout(timer)
  }, [tabs.length])

  React.useEffect(() => {
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

  const activeTab = tabs.find(tab => tab.id === activeId)

  return (
    <div className="bg-white border-b border-gray-200 px-4 sticky top-16 z-30">
      <div className="flex items-center">
        {showLeftArrow && (
          <button
            onClick={scrollLeft}
            className="flex items-center justify-center w-8 h-8 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded transition-colors mr-2 flex-shrink-0"
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
            items={tabs.map(tab => tab.id)}
            strategy={horizontalListSortingStrategy}
          >
            <div
              ref={scrollContainerRef}
              className="flex items-center space-x-1 overflow-x-auto flex-1"
              style={{
                scrollbarWidth: 'none',
                msOverflowStyle: 'none',
                WebkitScrollbar: 'none',
                paddingLeft: '16px',
                paddingRight: '60px'
              }}
            >
              {tabs.map((tab) => (
                <SortableTab
                  key={tab.id}
                  tab={tab}
                  isActive={tab.isActive}
                  onTabChange={onTabChange}
                  onTabClose={onTabClose}
                  getTabIcon={getTabIcon}
                />
              ))}
            </div>
          </SortableContext>

          <DragOverlay>
            {activeTab ? (
              <div
                className={clsx(
                  'flex items-center space-x-2 px-4 py-3 border-b-2 group flex-shrink-0 bg-white shadow-lg',
                  'min-w-[120px] max-w-[200px]',
                  activeTab.isActive
                    ? 'border-primary-500 bg-primary-50 text-primary-700'
                    : 'border-transparent text-gray-600'
                )}
              >
                <span className="text-gray-500">{getTabIcon(activeTab.type)}</span>
                <span className="text-sm font-medium truncate min-w-0 max-w-[120px]">
                  {activeTab.isBlank ? 'New Tab' : activeTab.title}
                </span>
              </div>
            ) : null}
          </DragOverlay>
        </DndContext>

        {showRightArrow && (
          <button
            onClick={scrollRight}
            className="flex items-center justify-center w-8 h-8 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded transition-colors ml-2 flex-shrink-0"
            title="Scroll right"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        )}

        <button
          onClick={handleNewTabClick}
          className="flex items-center justify-center w-8 h-8 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded transition-colors ml-2 flex-shrink-0"
          title={tabs.find(tab => tab.isBlank) ? "Go to new tab" : "New tab"}
        >
          <Plus className="h-4 w-4" />
        </button>
      </div>
    </div>
  )
}
