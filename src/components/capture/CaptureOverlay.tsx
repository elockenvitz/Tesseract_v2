import React, { useEffect, useState, useCallback, useRef } from 'react'
import { X, Target, MousePointer2 } from 'lucide-react'
import { clsx } from 'clsx'
import { useCaptureMode } from '../../contexts/CaptureContext'

export function CaptureOverlay() {
  const { isCaptureModeActive, cancelCaptureMode, captureElement, capturedElement } = useCaptureMode()
  const [hoveredElement, setHoveredElement] = useState<HTMLElement | null>(null)
  const [highlightRect, setHighlightRect] = useState<DOMRect | null>(null)
  const overlayRef = useRef<HTMLDivElement>(null)

  // Handle mouse move to highlight hovered elements
  const handleMouseMove = useCallback((e: MouseEvent) => {
    // Get element under cursor - overlay has pointer-events: none so this works directly
    const elementUnderCursor = document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null

    if (elementUnderCursor && elementUnderCursor !== hoveredElement) {
      // Find the best capturable parent (card, section, or meaningful element)
      const capturable = findCapturableElement(elementUnderCursor)
      setHoveredElement(capturable)
      if (capturable) {
        setHighlightRect(capturable.getBoundingClientRect())
      } else {
        setHighlightRect(null)
      }
    }
  }, [hoveredElement])

  // Handle click to capture (only with Ctrl/Cmd modifier)
  const handleClick = useCallback((e: MouseEvent) => {
    // Only capture if Ctrl (Windows/Linux) or Cmd (Mac) is held
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault()
      e.stopPropagation()

      if (hoveredElement) {
        captureElement(hoveredElement)
      }
    }
    // Otherwise, let the click pass through for normal navigation
  }, [hoveredElement, captureElement])

  // Handle escape to cancel
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      cancelCaptureMode()
    }
  }, [cancelCaptureMode])

  // Set up event listeners when capture mode is active (but not when modal is open)
  useEffect(() => {
    // Don't capture events when modal is open
    if (!isCaptureModeActive || capturedElement) return

    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('click', handleClick, true)
    document.addEventListener('keydown', handleKeyDown)

    // Add capture mode class to body
    document.body.classList.add('capture-mode-active')

    return () => {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('click', handleClick, true)
      document.removeEventListener('keydown', handleKeyDown)
      document.body.classList.remove('capture-mode-active')
    }
  }, [isCaptureModeActive, capturedElement, handleMouseMove, handleClick, handleKeyDown])

  // Update highlight rect on scroll
  useEffect(() => {
    if (!isCaptureModeActive || !hoveredElement) return

    const updateRect = () => {
      if (hoveredElement) {
        setHighlightRect(hoveredElement.getBoundingClientRect())
      }
    }

    window.addEventListener('scroll', updateRect, true)
    return () => window.removeEventListener('scroll', updateRect, true)
  }, [isCaptureModeActive, hoveredElement])

  // Hide overlay when modal is open (capturedElement is set)
  if (!isCaptureModeActive || capturedElement) return null

  return (
    <div
      ref={overlayRef}
      className="fixed inset-0 z-[9999] pointer-events-none"
    >
      {/* Top banner - needs pointer-events for cancel button */}
      <div className="absolute top-0 left-0 right-0 bg-primary-600 text-white px-4 py-3 flex items-center justify-between shadow-lg pointer-events-auto">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-white/20 rounded-lg">
            <Target className="h-5 w-5" />
          </div>
          <div>
            <div className="font-semibold">Capture Mode</div>
            <div className="text-sm text-white/80">Navigate freely, then Ctrl+click to capture</div>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2 text-sm bg-white/20 px-3 py-1.5 rounded-lg">
            <MousePointer2 className="h-4 w-4" />
            <span><kbd className="font-mono">Ctrl</kbd> + Click to capture</span>
          </div>
          <button
            onClick={cancelCaptureMode}
            className="flex items-center gap-2 px-3 py-1.5 bg-white/20 hover:bg-white/30 rounded-lg transition-colors"
          >
            <X className="h-4 w-4" />
            <span>Cancel</span>
            <kbd className="ml-1 px-1.5 py-0.5 bg-white/20 rounded text-xs">Esc</kbd>
          </button>
        </div>
      </div>

      {/* Highlight box for hovered element */}
      {highlightRect && (
        <div
          className="absolute pointer-events-none border-2 border-primary-500 bg-primary-500/10 rounded-lg transition-all duration-75"
          style={{
            top: highlightRect.top,
            left: highlightRect.left,
            width: highlightRect.width,
            height: highlightRect.height
          }}
        >
          {/* Capture hint label */}
          <div className="absolute -top-7 left-0 bg-primary-600 text-white text-xs px-2 py-1 rounded shadow-lg whitespace-nowrap">
            <kbd className="font-mono">Ctrl</kbd> + Click to capture
          </div>
        </div>
      )}
    </div>
  )
}

// Find the best capturable parent element
function findCapturableElement(element: HTMLElement): HTMLElement | null {
  let current: HTMLElement | null = element

  while (current) {
    // Skip the overlay itself
    if (current.closest('[data-capture-overlay]')) {
      return null
    }

    // Check for explicit capturable marker
    if (current.dataset.capturable === 'true') {
      return current
    }

    // Check for entity data attributes
    if (
      current.dataset.entityType ||
      current.dataset.assetId ||
      current.dataset.portfolioId ||
      current.dataset.noteId ||
      current.dataset.themeId ||
      current.dataset.workflowId ||
      current.dataset.projectId
    ) {
      return current
    }

    // Check for common card/container patterns
    const classes = current.className || ''
    if (
      classes.includes('card') ||
      classes.includes('Card') ||
      classes.includes('tile') ||
      classes.includes('Tile') ||
      classes.includes('panel') ||
      classes.includes('Panel') ||
      classes.includes('item') ||
      classes.includes('Item')
    ) {
      // Make sure it has some content
      if (current.offsetWidth > 50 && current.offsetHeight > 30) {
        return current
      }
    }

    // Check for role attributes
    if (
      current.getAttribute('role') === 'article' ||
      current.getAttribute('role') === 'listitem' ||
      current.getAttribute('role') === 'button'
    ) {
      return current
    }

    // Check for interactive elements with meaningful size
    if (
      (current.tagName === 'BUTTON' || current.tagName === 'A' || current.tagName === 'DIV') &&
      current.offsetWidth > 100 &&
      current.offsetHeight > 50
    ) {
      // Check if it looks like a meaningful container
      const hasText = current.textContent && current.textContent.trim().length > 10
      const hasChildren = current.children.length > 0
      if (hasText || hasChildren) {
        return current
      }
    }

    current = current.parentElement
  }

  // Fallback: return the original element if it's reasonably sized
  if (element.offsetWidth > 50 && element.offsetHeight > 30) {
    return element
  }

  return null
}

export default CaptureOverlay
