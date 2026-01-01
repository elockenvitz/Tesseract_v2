import { Node, mergeAttributes } from '@tiptap/core'
import { ReactNodeViewRenderer, NodeViewWrapper, NodeViewProps } from '@tiptap/react'
import React, { useRef, useEffect, useState, useCallback } from 'react'
import { clsx } from 'clsx'
import { ChevronDown, Lock, Unlock } from 'lucide-react'

const ASPECT_RATIOS = [
  { label: 'Free', value: null },
  { label: '1:1', value: 1 },
  { label: '4:3', value: 4/3 },
  { label: '16:9', value: 16/9 },
  { label: '3:2', value: 3/2 },
  { label: '2:1', value: 2 },
]

function ResizableImageView({ node, updateAttributes, selected }: NodeViewProps) {
  const imageRef = useRef<HTMLImageElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  // Track the committed size (what's saved to TipTap)
  const [isResizing, setIsResizing] = useState(false)
  const [pendingSize, setPendingSize] = useState<{ width: number; height: number } | null>(null)
  const [showAspectMenu, setShowAspectMenu] = useState(false)
  const [lockedAspectRatio, setLockedAspectRatio] = useState<number | null>(null)
  const [showSizeInputs, setShowSizeInputs] = useState(false)
  const [inputWidth, setInputWidth] = useState('')
  const [inputHeight, setInputHeight] = useState('')
  const [lockDimensions, setLockDimensions] = useState(true)
  const [, forceUpdate] = useState(0)

  // Force re-render when selected to calculate positions
  useEffect(() => {
    if (selected) {
      // Small delay to ensure DOM is ready
      const timer = setTimeout(() => forceUpdate(n => n + 1), 10)
      return () => clearTimeout(timer)
    }
  }, [selected])

  // Use refs for values needed in event handlers
  const isResizingRef = useRef(false)
  const resizeDirectionRef = useRef<string | null>(null)
  const startPosRef = useRef({ x: 0, y: 0, width: 0, height: 0 })
  const currentSizeRef = useRef<{ width: number; height: number } | null>(null)
  const naturalAspectRatioRef = useRef(1)

  const { src, alt, title, width, height, alignment } = node.attrs

  // Display size: use pending size if set, otherwise use saved node attrs
  const displayWidth = pendingSize?.width ?? width
  const displayHeight = pendingSize?.height ?? height

  // Clear pending size when node attrs match
  useEffect(() => {
    if (pendingSize && width === pendingSize.width && height === pendingSize.height) {
      setPendingSize(null)
    }
  }, [width, height, pendingSize])

  // Save function that persists to TipTap
  const saveSize = useCallback((w: number, h: number) => {
    const roundedW = Math.round(w)
    const roundedH = Math.round(h)

    // Set pending size to maintain visual until TipTap updates
    setPendingSize({ width: roundedW, height: roundedH })

    // Persist to TipTap
    updateAttributes({
      width: roundedW,
      height: roundedH
    })
  }, [updateAttributes])

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isResizingRef.current || !resizeDirectionRef.current) return

      e.preventDefault()

      const deltaX = e.clientX - startPosRef.current.x
      const deltaY = e.clientY - startPosRef.current.y

      let newWidth = startPosRef.current.width
      let newHeight = startPosRef.current.height
      const aspectRatio = lockedAspectRatio ?? naturalAspectRatioRef.current
      const direction = resizeDirectionRef.current

      // Calculate new dimensions based on resize direction
      if (direction.includes('e')) {
        newWidth = Math.max(50, startPosRef.current.width + deltaX)
      }
      if (direction.includes('w')) {
        newWidth = Math.max(50, startPosRef.current.width - deltaX)
      }
      if (direction.includes('s')) {
        newHeight = Math.max(50, startPosRef.current.height + deltaY)
      }
      if (direction.includes('n')) {
        newHeight = Math.max(50, startPosRef.current.height - deltaY)
      }

      // Maintain aspect ratio for corner handles OR if aspect ratio is locked
      if (direction.length === 2 || lockedAspectRatio !== null) {
        newHeight = newWidth / aspectRatio
      }

      const size = {
        width: Math.round(newWidth),
        height: Math.round(newHeight)
      }

      currentSizeRef.current = size
      setPendingSize(size)
    }

    const handleMouseUp = () => {
      if (isResizingRef.current && currentSizeRef.current) {
        const finalSize = currentSizeRef.current

        // Set pending size and save to TipTap
        setPendingSize(finalSize)
        updateAttributes({
          width: finalSize.width,
          height: finalSize.height
        })
      }

      isResizingRef.current = false
      resizeDirectionRef.current = null
      currentSizeRef.current = null
      setIsResizing(false)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }

    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)

    return () => {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
    }
  }, [updateAttributes, lockedAspectRatio])

  const handleMouseDown = (e: React.MouseEvent, direction: string) => {
    e.preventDefault()
    e.stopPropagation()

    if (!imageRef.current) return

    const rect = imageRef.current.getBoundingClientRect()

    isResizingRef.current = true
    resizeDirectionRef.current = direction
    naturalAspectRatioRef.current = rect.width / rect.height

    startPosRef.current = {
      x: e.clientX,
      y: e.clientY,
      width: rect.width,
      height: rect.height
    }

    const initialSize = { width: Math.round(rect.width), height: Math.round(rect.height) }
    currentSizeRef.current = initialSize
    setIsResizing(true)
    setPendingSize(initialSize)

    const cursorMap: Record<string, string> = {
      'nw': 'nwse-resize', 'ne': 'nesw-resize',
      'sw': 'nesw-resize', 'se': 'nwse-resize',
      'n': 'ns-resize', 's': 'ns-resize',
      'e': 'ew-resize', 'w': 'ew-resize'
    }
    document.body.style.cursor = cursorMap[direction] || 'default'
    document.body.style.userSelect = 'none'
  }

  const applyAspectRatio = (ratio: number | null) => {
    setLockedAspectRatio(ratio)
    setShowAspectMenu(false)

    if (ratio !== null && imageRef.current) {
      const currentWidth = width || imageRef.current.getBoundingClientRect().width
      const newHeight = currentWidth / ratio
      saveSize(currentWidth, newHeight)
    }
  }

  const getCurrentAspectLabel = () => {
    if (lockedAspectRatio === null) return 'Free'
    const found = ASPECT_RATIOS.find(r => r.value === lockedAspectRatio)
    return found?.label || 'Custom'
  }

  const openSizeInputs = () => {
    const currentW = displayWidth || (imageRef.current?.getBoundingClientRect().width ?? 200)
    const currentH = displayHeight || (imageRef.current?.getBoundingClientRect().height ?? 200)
    setInputWidth(String(Math.round(currentW)))
    setInputHeight(String(Math.round(currentH)))
    setShowSizeInputs(true)
    setShowAspectMenu(false)
  }

  const handleWidthChange = (newWidth: string) => {
    setInputWidth(newWidth)
    const w = parseInt(newWidth)
    if (!isNaN(w) && w > 0 && lockDimensions && displayHeight && displayWidth) {
      const ratio = displayWidth / displayHeight
      setInputHeight(String(Math.round(w / ratio)))
    }
  }

  const handleHeightChange = (newHeight: string) => {
    setInputHeight(newHeight)
    const h = parseInt(newHeight)
    if (!isNaN(h) && h > 0 && lockDimensions && displayHeight && displayWidth) {
      const ratio = displayWidth / displayHeight
      setInputWidth(String(Math.round(h * ratio)))
    }
  }

  const applySizeInputs = () => {
    const w = parseInt(inputWidth)
    const h = parseInt(inputHeight)
    if (!isNaN(w) && !isNaN(h) && w > 0 && h > 0) {
      saveSize(w, h)
      setShowSizeInputs(false)
    }
  }

  const handleSizeKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      applySizeInputs()
    } else if (e.key === 'Escape') {
      setShowSizeInputs(false)
    }
  }

  const handleStyle = "absolute bg-white border border-primary-500 rounded-sm z-10 hover:bg-primary-100 transition-colors shadow-sm"

  return (
    <NodeViewWrapper
      className="resizable-image-wrapper my-4"
      style={{
        display: 'flex',
        justifyContent: alignment === 'center' ? 'center' : alignment === 'right' ? 'flex-end' : 'flex-start',
        overflow: 'visible'
      }}
    >
      <div
        ref={containerRef}
        className={clsx(
          'relative inline-block',
          selected && !isResizing && 'ring-2 ring-primary-500 ring-offset-2 rounded'
        )}
        style={{ overflow: 'visible' }}
      >
        <img
          ref={imageRef}
          src={src}
          alt={alt || ''}
          title={title || ''}
          className="block rounded"
          style={{
            width: displayWidth ? `${displayWidth}px` : 'auto',
            height: displayHeight ? `${displayHeight}px` : 'auto',
            maxWidth: isResizing ? 'none' : '100%'
          }}
          draggable={false}
        />

        {/* Resize handles - visible when selected (small handles) */}
        {selected && (
          <>
            <div className={clsx(handleStyle, "w-2 h-2 -top-1 -left-1 cursor-nwse-resize")} onMouseDown={(e) => handleMouseDown(e, 'nw')} />
            <div className={clsx(handleStyle, "w-2 h-2 -top-1 -right-1 cursor-nesw-resize")} onMouseDown={(e) => handleMouseDown(e, 'ne')} />
            <div className={clsx(handleStyle, "w-2 h-2 -bottom-1 -left-1 cursor-nesw-resize")} onMouseDown={(e) => handleMouseDown(e, 'sw')} />
            <div className={clsx(handleStyle, "w-2 h-2 -bottom-1 -right-1 cursor-nwse-resize")} onMouseDown={(e) => handleMouseDown(e, 'se')} />
            <div className={clsx(handleStyle, "w-4 h-1.5 left-1/2 -translate-x-1/2 -top-0.5 cursor-ns-resize")} onMouseDown={(e) => handleMouseDown(e, 'n')} />
            <div className={clsx(handleStyle, "w-4 h-1.5 left-1/2 -translate-x-1/2 -bottom-0.5 cursor-ns-resize")} onMouseDown={(e) => handleMouseDown(e, 's')} />
            <div className={clsx(handleStyle, "w-1.5 h-4 top-1/2 -translate-y-1/2 -left-0.5 cursor-ew-resize")} onMouseDown={(e) => handleMouseDown(e, 'w')} />
            <div className={clsx(handleStyle, "w-1.5 h-4 top-1/2 -translate-y-1/2 -right-0.5 cursor-ew-resize")} onMouseDown={(e) => handleMouseDown(e, 'e')} />
          </>
        )}

        {/* Size display during resize */}
        {isResizing && pendingSize && (
          <div className="absolute -bottom-8 left-1/2 -translate-x-1/2 bg-gray-900 text-white text-xs px-2 py-1 rounded whitespace-nowrap z-50 shadow-lg">
            {pendingSize.width} × {pendingSize.height}
          </div>
        )}

        {/* Toolbar - positioned above, stays within note content area */}
        {selected && !isResizing && (
          <div
            className="fixed flex items-center gap-1 bg-white border border-gray-200 rounded-lg shadow-lg px-1.5 py-1 z-[9999]"
            style={{
              left: (() => {
                if (!containerRef.current) return '50%'
                const rect = containerRef.current.getBoundingClientRect()
                const toolbarWidth = 300
                // Find the editor wrapper to get the content area bounds
                const editorWrapper = containerRef.current.closest('.ProseMirror')?.parentElement
                const editorRect = editorWrapper?.getBoundingClientRect()
                const minLeft = editorRect ? editorRect.left + 8 : 400
                const maxLeft = (editorRect ? editorRect.right : window.innerWidth) - toolbarWidth - 8
                const centerX = rect.left + rect.width / 2
                return Math.min(maxLeft, Math.max(minLeft, centerX - toolbarWidth / 2))
              })(),
              top: containerRef.current ? Math.max(60, containerRef.current.getBoundingClientRect().top - 44) : 60,
              minWidth: 'max-content'
            }}
          >
            {/* Alignment buttons */}
            <button
              onClick={() => updateAttributes({ alignment: 'left' })}
              className={clsx('p-1.5 rounded hover:bg-gray-100', alignment === 'left' && 'bg-primary-100 text-primary-600')}
              title="Align left"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h10M4 18h16" />
              </svg>
            </button>
            <button
              onClick={() => updateAttributes({ alignment: 'center' })}
              className={clsx('p-1.5 rounded hover:bg-gray-100', alignment === 'center' && 'bg-primary-100 text-primary-600')}
              title="Align center"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M7 12h10M4 18h16" />
              </svg>
            </button>
            <button
              onClick={() => updateAttributes({ alignment: 'right' })}
              className={clsx('p-1.5 rounded hover:bg-gray-100', alignment === 'right' && 'bg-primary-100 text-primary-600')}
              title="Align right"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M10 12h10M4 18h16" />
              </svg>
            </button>

            <div className="w-px h-5 bg-gray-200 mx-0.5" />

            {/* Aspect ratio dropdown */}
            <div className="relative">
              <button
                onClick={() => { setShowAspectMenu(!showAspectMenu); setShowSizeInputs(false); }}
                className="flex items-center gap-1 px-2 py-1 text-xs text-gray-600 hover:bg-gray-100 rounded"
              >
                {getCurrentAspectLabel()}
                <ChevronDown className="w-3 h-3" />
              </button>
              {showAspectMenu && (
                <div className="absolute top-full left-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-xl py-1 min-w-[80px] z-50">
                  {ASPECT_RATIOS.map((ratio) => (
                    <button
                      key={ratio.label}
                      onClick={() => applyAspectRatio(ratio.value)}
                      className={clsx(
                        'w-full px-3 py-1.5 text-left text-xs hover:bg-gray-50',
                        lockedAspectRatio === ratio.value && 'bg-primary-50 text-primary-600'
                      )}
                    >
                      {ratio.label}
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="w-px h-5 bg-gray-200 mx-0.5" />

            {/* Size display / input toggle */}
            <button
              onClick={openSizeInputs}
              className="text-xs text-gray-600 px-2 py-1 hover:bg-gray-100 rounded whitespace-nowrap font-mono"
              title="Click to set exact dimensions"
            >
              {displayWidth ? `${Math.round(displayWidth)}×${Math.round(displayHeight || 0)}` : 'auto'}
            </button>
          </div>
        )}

        {/* Size input popup - fixed positioning to stay visible */}
        {selected && showSizeInputs && !isResizing && (
          <div
            className="fixed bg-white border border-gray-200 rounded-lg shadow-xl p-3 z-[10000]"
            style={{
              left: (() => {
                if (!containerRef.current) return '50%'
                const rect = containerRef.current.getBoundingClientRect()
                const popupWidth = 320
                const editorWrapper = containerRef.current.closest('.ProseMirror')?.parentElement
                const editorRect = editorWrapper?.getBoundingClientRect()
                const minLeft = editorRect ? editorRect.left + 8 : 400
                const maxLeft = (editorRect ? editorRect.right : window.innerWidth) - popupWidth - 8
                const centerX = rect.left + rect.width / 2
                return Math.min(maxLeft, Math.max(minLeft, centerX - popupWidth / 2))
              })(),
              top: containerRef.current ? Math.max(60, containerRef.current.getBoundingClientRect().top - 110) : 60
            }}
          >
            <div className="flex items-center gap-2">
              <div className="flex flex-col">
                <label className="text-[10px] text-gray-500 mb-0.5">Width (px)</label>
                <input
                  type="number"
                  value={inputWidth}
                  onChange={(e) => handleWidthChange(e.target.value)}
                  onKeyDown={handleSizeKeyDown}
                  className="w-20 px-2 py-1.5 text-sm border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-primary-500 font-mono"
                  min="1"
                  autoFocus
                />
              </div>

              <button
                onClick={() => setLockDimensions(!lockDimensions)}
                className={clsx(
                  'p-1.5 rounded mt-4 transition-colors',
                  lockDimensions ? 'text-primary-600 bg-primary-100' : 'text-gray-400 hover:bg-gray-100'
                )}
                title={lockDimensions ? 'Unlock aspect ratio' : 'Lock aspect ratio'}
              >
                {lockDimensions ? <Lock className="w-4 h-4" /> : <Unlock className="w-4 h-4" />}
              </button>

              <div className="flex flex-col">
                <label className="text-[10px] text-gray-500 mb-0.5">Height (px)</label>
                <input
                  type="number"
                  value={inputHeight}
                  onChange={(e) => handleHeightChange(e.target.value)}
                  onKeyDown={handleSizeKeyDown}
                  className="w-20 px-2 py-1.5 text-sm border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-primary-500 font-mono"
                  min="1"
                />
              </div>

              <button
                onClick={applySizeInputs}
                className="px-3 py-1.5 mt-4 text-sm bg-primary-500 text-white rounded hover:bg-primary-600 transition-colors font-medium"
              >
                Apply
              </button>
            </div>
            <p className="text-[10px] text-gray-400 mt-2 text-center">Enter to apply • Esc to cancel</p>
          </div>
        )}
      </div>
    </NodeViewWrapper>
  )
}

export const ResizableImageExtension = Node.create({
  name: 'resizableImage',
  group: 'block',
  atom: true,
  draggable: true,

  addAttributes() {
    return {
      src: { default: null },
      alt: { default: null },
      title: { default: null },
      width: { default: null },
      height: { default: null },
      alignment: { default: 'left' }
    }
  },

  parseHTML() {
    return [
      {
        tag: 'img[src]',
        getAttrs: (dom) => {
          const element = dom as HTMLElement
          return {
            src: element.getAttribute('src'),
            alt: element.getAttribute('alt'),
            title: element.getAttribute('title'),
            width: element.getAttribute('width') ? parseInt(element.getAttribute('width')!) : null,
            height: element.getAttribute('height') ? parseInt(element.getAttribute('height')!) : null,
            alignment: element.getAttribute('data-alignment') || 'left'
          }
        }
      }
    ]
  },

  renderHTML({ node, HTMLAttributes }) {
    return ['img', mergeAttributes(HTMLAttributes, {
      src: node.attrs.src,
      alt: node.attrs.alt,
      title: node.attrs.title,
      width: node.attrs.width,
      height: node.attrs.height,
      'data-alignment': node.attrs.alignment,
      class: 'editor-image'
    })]
  },

  addNodeView() {
    return ReactNodeViewRenderer(ResizableImageView)
  }
})

export default ResizableImageExtension
