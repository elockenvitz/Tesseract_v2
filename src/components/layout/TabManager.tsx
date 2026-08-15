import React, { useState, useRef } from 'react'
import { X, Plus, TrendingUp, Briefcase, Tag, FileText, Home, File, List, User, Settings, Lightbulb, Workflow, ChevronLeft, ChevronRight } from 'lucide-react'
import { clsx } from 'clsx'

export interface Tab {
  id: string
  title: string
  type: 'asset' | 'portfolio' | 'theme' | 'note' | 'dashboard' | 'assets-list'
  | 'portfolios-list' | 'themes-list' | 'notes-list' | 'lists' | 'list'
  | 'idea-generator' | 'workflows'
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

export function TabManager({ tabs, onTabReorder, onTabChange, onTabClose, onNewTab, onFocusSearch }: TabManagerProps) {
  const [draggedTab, setDraggedTab] = useState<string | null>(null)
  const [draggedOverTab, setDraggedOverTab] = useState<string | null>(null)
  const [showLeftArrow, setShowLeftArrow] = useState(false)
  const [showRightArrow, setShowRightArrow] = useState(false)
  const [isScrolling, setIsScrolling] = useState(false)
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 })
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const scrollTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const visibilityCheckTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const dragStartPosRef = useRef({ x: 0, y: 0 })
  const lastReorderTimeRef = useRef(0)
  const dragStartIndexRef = useRef(0)
  const lastMousePosRef = useRef({ x: 0, y: 0 })
  const currentOffsetRef = useRef({ x: 0, y: 0 })

  const handleDragStart = (e: React.DragEvent, tabId: string) => {
    // Don't allow dragging the dashboard tab
    if (tabId === 'dashboard') {
      e.preventDefault()
      return
    }

    setDraggedTab(tabId)
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', tabId)

    // Store initial cursor position and tab index
    dragStartPosRef.current = { x: e.clientX, y: e.clientY }
    dragStartIndexRef.current = tabs.findIndex(tab => tab.id === tabId)
    lastMousePosRef.current = { x: e.clientX, y: e.clientY }
    currentOffsetRef.current = { x: 0, y: 0 }
    setDragOffset({ x: 0, y: 0 })

    // Create an invisible drag image to hide the default ghost image
    const invisibleImage = document.createElement('div')
    invisibleImage.style.width = '1px'
    invisibleImage.style.height = '1px'
    invisibleImage.style.opacity = '0'
    invisibleImage.style.position = 'absolute'
    invisibleImage.style.top = '-9999px'
    document.body.appendChild(invisibleImage)
    e.dataTransfer.setDragImage(invisibleImage, 0, 0)

    // Clean up the invisible image after drag starts
    setTimeout(() => {
      if (document.body.contains(invisibleImage)) {
        document.body.removeChild(invisibleImage)
      }
    }, 0)

    // Add document-level dragover to handle both position tracking and reordering
    const handleDocumentDragOver = (e: DragEvent) => {
      e.preventDefault()

      if (!scrollContainerRef.current) return
      if (e.clientX === 0 && e.clientY === 0) return

      // Calculate offset - ALWAYS just cursor movement
      const deltaX = e.clientX - dragStartPosRef.current.x
      currentOffsetRef.current = { x: deltaX, y: 0 }
      setDragOffset({ x: deltaX, y: 0 })

      // Check for reordering (throttled)
      const now = Date.now()
      if (now - lastReorderTimeRef.current < 150) return

      const draggedElement = scrollContainerRef.current.querySelector(`[data-tab-id="${tabId}"]`) as HTMLElement
      if (!draggedElement) return

      // Calculate where the dragged tab's visual center is
      const draggedRect = draggedElement.getBoundingClientRect()
      const visualCenterX = draggedRect.left + draggedRect.width / 2 + deltaX

      // Find current index
      const currentIndex = tabs.findIndex(t => t.id === tabId)
      if (currentIndex === -1) return

      // Check all tabs to see if we should swap
      const allTabElements = Array.from(scrollContainerRef.current.querySelectorAll('[data-tab-id]')) as HTMLElement[]

      for (let i = 0; i < allTabElements.length; i++) {
        const otherTabId = allTabElements[i].getAttribute('data-tab-id')
        if (otherTabId === tabId) continue

        const otherRect = allTabElements[i].getBoundingClientRect()
        const otherCenterX = otherRect.left + otherRect.width / 2

        // Check if visual center crossed this tab's center
        const shouldSwap = (
          (i < currentIndex && visualCenterX < otherCenterX) || // Moving left
          (i > currentIndex && visualCenterX > otherCenterX)     // Moving right
        )

        if (shouldSwap) {
          lastReorderTimeRef.current = now
          onTabReorder(currentIndex, i)

          // Reset reference point
          dragStartPosRef.current = { x: e.clientX, y: e.clientY }
          currentOffsetRef.current = { x: 0, y: 0 }
          setDragOffset({ x: 0, y: 0 })
          break
        }
      }
    }

    document.addEventListener('dragover', handleDocumentDragOver)

    // Clean up on drag end
    const cleanup = () => {
      document.removeEventListener('dragover', handleDocumentDragOver)
      document.removeEventListener('dragend', cleanup)
    }
    document.addEventListener('dragend', cleanup)
  }

  const handleDragOver = (e: React.DragEvent, tabId?: string) => {
    e.preventDefault()
    e.stopPropagation()
    e.dataTransfer.dropEffect = 'move'

    if (!draggedTab) return

    // The offset is already being tracked by the document drag handler
    // Just need to handle detection here

    // Throttle reordering to prevent too many calls
    const now = Date.now()
    if (now - lastReorderTimeRef.current < 100) return

    // Temporarily hide the dragged element to detect what's underneath
    const originalPointerEvents = draggedElement?.style.pointerEvents

    if (draggedElement) {
      draggedElement.style.pointerEvents = 'none'
    }

    // Use elementFromPoint to find what's under the cursor
    // Always use the container's vertical center for consistent detection
    const containerRect = scrollContainerRef.current?.getBoundingClientRect()
    const checkY = containerRect ? containerRect.top + containerRect.height / 2 : e.clientY

    const elementUnderCursor = document.elementFromPoint(e.clientX, checkY)

    // Restore pointer events
    if (draggedElement) {
      draggedElement.style.pointerEvents = originalPointerEvents || ''
    }

    if (elementUnderCursor) {
      // Find the closest tab element (the element or its parent)
      let tabElement = elementUnderCursor.closest('[data-tab-id]') as HTMLElement

      if (tabElement) {
        const targetTabId = tabElement.getAttribute('data-tab-id')

        // If we found a target tab and it's different from the dragged tab
        if (targetTabId && targetTabId !== draggedTab) {
          const fromIndex = tabs.findIndex(tab => tab.id === draggedTab)
          const toIndex = tabs.findIndex(tab => tab.id === targetTabId)

          if (fromIndex !== -1 && toIndex !== -1 && fromIndex !== toIndex) {
            lastReorderTimeRef.current = now
            setDraggedOverTab(targetTabId)
            onTabReorder(fromIndex, toIndex)
          }
        }
      }
    }
  }

  const handleDragEnter = (e: React.DragEvent, tabId: string) => {
    e.preventDefault()
    e.stopPropagation()
  }

  const handleDragLeave = (e: React.DragEvent) => {
    e.stopPropagation()
  }

  const handleDrop = (e: React.DragEvent, targetTabId: string) => {
    e.preventDefault()
    e.stopPropagation()

    setDraggedTab(null)
    setDraggedOverTab(null)
    setDragOffset({ x: 0, y: 0 })
  }

  const handleDragEnd = () => {
    setDraggedTab(null)
    setDraggedOverTab(null)
    setDragOffset({ x: 0, y: 0 })
  }

  const checkScrollVisibility = () => {
    if (scrollContainerRef.current) {
      const { scrollLeft, scrollWidth, clientWidth } = scrollContainerRef.current
      const leftPadding = 16
      const rightPadding = 60

      // With padding, arrows can always be visible
      setShowLeftArrow(scrollLeft > leftPadding + 10) // Show when scrolled past left padding + buffer
      setShowRightArrow(scrollLeft < scrollWidth - clientWidth - rightPadding - 10) // Show when not at right edge
    }
  }

  const debouncedCheckScrollVisibility = () => {
    // Don't check visibility while actively scrolling to prevent interference
    if (isScrolling) return

    if (visibilityCheckTimeoutRef.current) {
      clearTimeout(visibilityCheckTimeoutRef.current)
    }
    visibilityCheckTimeoutRef.current = setTimeout(() => {
      if (!isScrolling) { // Double check we're not scrolling
        checkScrollVisibility()
      }
    }, 150) // 150ms debounce to reduce interference
  }

  const scrollLeft = () => {
    if (scrollContainerRef.current && !isScrolling) {
      setIsScrolling(true)
      const container = scrollContainerRef.current
      const containerWidth = container.clientWidth
      const currentScrollLeft = container.scrollLeft

      // Calculate scroll amount - we can now scroll more freely with padding
      const scrollAmount = containerWidth * 0.75 // 75% of container width
      const targetScrollLeft = Math.max(0, currentScrollLeft - scrollAmount)

      container.scrollTo({
        left: targetScrollLeft,
        behavior: 'smooth'
      })

      // Reset scrolling state after animation completes
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

      // Simple scroll: move by 75% of container width, but respect boundaries
      const scrollAmount = containerWidth * 0.75
      const targetScrollLeft = Math.min(currentScrollLeft + scrollAmount, maxScrollLeft - rightPadding)

      container.scrollTo({
        left: targetScrollLeft,
        behavior: 'smooth'
      })

      // Reset scrolling state after animation completes
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
        // Use requestAnimationFrame to ensure the DOM has updated
        requestAnimationFrame(() => {
          const containerRect = container.getBoundingClientRect()
          const tabRect = lastTab.getBoundingClientRect()

          // Check if the last tab is not fully visible
          if (tabRect.right > containerRect.right) {
            const scrollDistance = container.scrollLeft + (tabRect.right - containerRect.right) + 24 // 24px padding for better visibility

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

  // Auto-scroll to show new tabs when they're added
  React.useEffect(() => {
    // Use a timeout to ensure the new tab has been rendered
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
      case 'workflows': return <Workflow className="h-3.5 w-3.5" />
      case 'dashboard': return <Home className="h-3.5 w-3.5" />
      case 'profile': return <User className="h-3.5 w-3.5" />
      case 'settings': return <Settings className="h-3.5 w-3.5" />
      default: return <File className="h-3.5 w-3.5" />
    }
  }

  const handleNewTabClick = () => {
    // Check if there's already a blank tab open
    const existingBlankTab = tabs.find(tab => tab.isBlank)

    if (existingBlankTab) {
      // Navigate to the existing blank tab instead of creating a new one
      onTabChange(existingBlankTab.id)
      // Focus search after a brief delay
      setTimeout(() => {
        onFocusSearch?.()
      }, 100)
    } else {
      // No blank tab exists, create a new one
      onNewTab()
      // Focus search after a brief delay to ensure the tab is created
      setTimeout(() => {
        onFocusSearch?.()
      }, 100)
    }
  }

  return (
    <div className="bg-white border-b border-gray-200 px-4 sticky top-16 z-30">
      <div className="flex items-center">
        {/* Left scroll button */}
        {showLeftArrow && (
          <button
            onClick={scrollLeft}
            className="flex items-center justify-center w-8 h-8 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded transition-colors mr-2 flex-shrink-0"
            title="Scroll left"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
        )}

        {/* Tabs container */}
        <div
          ref={scrollContainerRef}
          className="flex items-center space-x-1 overflow-x-auto flex-1"
          onDragOver={(e) => handleDragOver(e)}
          style={{
            scrollbarWidth: 'none',
            msOverflowStyle: 'none',
            WebkitScrollbar: 'none',
            paddingLeft: '16px',
            paddingRight: '60px'
          }}
        >
          {tabs.map((tab) => (
            <div
              key={tab.id}
              data-tab-id={tab.id}
              draggable={tab.id !== 'dashboard'}
              onDragStart={(e) => handleDragStart(e, tab.id)}
              onDragEnd={handleDragEnd}
              className={clsx(
                'flex items-center space-x-2 px-4 py-3 border-b-2 cursor-pointer group flex-shrink-0',
                'min-w-[120px] max-w-[200px]', // Set reasonable min and max width
                tab.isActive
                  ? 'border-primary-500 bg-primary-50 text-primary-700'
                  : 'border-transparent hover:bg-gray-50 text-gray-600 hover:text-gray-900',
                draggedTab === tab.id && 'opacity-50',
                draggedOverTab === tab.id && 'bg-primary-100 border-primary-300',
                tab.id === 'dashboard' && 'cursor-default',
                // No transitions during drag to prevent visual glitches
                !draggedTab && 'transition-all duration-200'
              )}
              onClick={() => onTabChange(tab.id)}
              style={{
                cursor: tab.id === 'dashboard' ? 'default' : draggedTab === tab.id ? 'grabbing' : 'grab',
                transform: draggedTab === tab.id ? `translate(${dragOffset.x}px, 0)` : undefined,
                zIndex: draggedTab === tab.id ? 50 : undefined
              }}
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
          ))}
        </div>

        {/* Right scroll button */}
        {showRightArrow && (
          <button
            onClick={scrollRight}
            className="flex items-center justify-center w-8 h-8 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded transition-colors ml-2 flex-shrink-0"
            title="Scroll right"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        )}

        {/* New tab button */}
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