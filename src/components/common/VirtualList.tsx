/**
 * VirtualList Component
 *
 * Renders large lists efficiently using virtual scrolling.
 * Only renders items that are visible in the viewport.
 */

import React, { useRef, ReactElement } from 'react'
import { useVirtualizer, VirtualizerOptions } from '@tanstack/react-virtual'

interface VirtualListProps<T> {
  /**
   * Array of items to render
   */
  items: T[]

  /**
   * Height of the scrollable container
   */
  height: number | string

  /**
   * Estimated height of each item (for initial measurements)
   */
  estimateSize: number

  /**
   * Render function for each item
   */
  renderItem: (item: T, index: number) => ReactElement

  /**
   * Optional key extractor function
   */
  getItemKey?: (item: T, index: number) => string | number

  /**
   * Number of items to render outside visible area
   */
  overscan?: number

  /**
   * Optional className for the container
   */
  className?: string

  /**
   * Optional empty state component
   */
  emptyState?: ReactElement

  /**
   * Optional loading state component
   */
  loadingState?: ReactElement

  /**
   * Is the list currently loading?
   */
  isLoading?: boolean
}

export function VirtualList<T>({
  items,
  height,
  estimateSize,
  renderItem,
  getItemKey,
  overscan = 5,
  className = '',
  emptyState,
  loadingState,
  isLoading = false
}: VirtualListProps<T>) {
  const parentRef = useRef<HTMLDivElement>(null)

  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => estimateSize,
    overscan
  })

  // Show loading state
  if (isLoading && loadingState) {
    return (
      <div
        ref={parentRef}
        className={className}
        style={{ height, overflow: 'auto' }}
      >
        {loadingState}
      </div>
    )
  }

  // Show empty state
  if (!isLoading && items.length === 0 && emptyState) {
    return (
      <div
        ref={parentRef}
        className={className}
        style={{ height, overflow: 'auto' }}
      >
        {emptyState}
      </div>
    )
  }

  return (
    <div
      ref={parentRef}
      className={`${className} custom-scrollbar`}
      style={{ height, overflow: 'auto' }}
      role="list"
      aria-label="Scrollable list"
    >
      <div
        style={{
          height: `${virtualizer.getTotalSize()}px`,
          width: '100%',
          position: 'relative'
        }}
        aria-live="polite"
        aria-atomic="false"
      >
        {virtualizer.getVirtualItems().map((virtualItem) => {
          const item = items[virtualItem.index]
          const key = getItemKey
            ? getItemKey(item, virtualItem.index)
            : virtualItem.index

          return (
            <div
              key={key}
              data-index={virtualItem.index}
              ref={virtualizer.measureElement}
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                transform: `translateY(${virtualItem.start}px)`
              }}
              role="listitem"
            >
              {renderItem(item, virtualItem.index)}
            </div>
          )
        })}
      </div>
    </div>
  )
}

/**
 * Grid variant for virtual scrolling
 */
interface VirtualGridProps<T> {
  items: T[]
  height: number | string
  estimateSize: number
  columns: number
  renderItem: (item: T, index: number) => ReactElement
  getItemKey?: (item: T, index: number) => string | number
  overscan?: number
  className?: string
  gap?: number
  emptyState?: ReactElement
  loadingState?: ReactElement
  isLoading?: boolean
}

export function VirtualGrid<T>({
  items,
  height,
  estimateSize,
  columns,
  renderItem,
  getItemKey,
  overscan = 5,
  className = '',
  gap = 16,
  emptyState,
  loadingState,
  isLoading = false
}: VirtualGridProps<T>) {
  const parentRef = useRef<HTMLDivElement>(null)

  // Calculate rows based on columns
  const rowCount = Math.ceil(items.length / columns)

  const virtualizer = useVirtualizer({
    count: rowCount,
    getScrollElement: () => parentRef.current,
    estimateSize: () => estimateSize + gap,
    overscan
  })

  // Show loading state
  if (isLoading && loadingState) {
    return (
      <div
        ref={parentRef}
        className={className}
        style={{ height, overflow: 'auto' }}
      >
        {loadingState}
      </div>
    )
  }

  // Show empty state
  if (!isLoading && items.length === 0 && emptyState) {
    return (
      <div
        ref={parentRef}
        className={className}
        style={{ height, overflow: 'auto' }}
      >
        {emptyState}
      </div>
    )
  }

  return (
    <div
      ref={parentRef}
      className={`${className} custom-scrollbar`}
      style={{ height, overflow: 'auto' }}
      role="grid"
      aria-label="Scrollable grid"
    >
      <div
        style={{
          height: `${virtualizer.getTotalSize()}px`,
          width: '100%',
          position: 'relative'
        }}
        aria-live="polite"
        aria-atomic="false"
      >
        {virtualizer.getVirtualItems().map((virtualRow) => {
          const startIndex = virtualRow.index * columns
          const endIndex = Math.min(startIndex + columns, items.length)
          const rowItems = items.slice(startIndex, endIndex)

          return (
            <div
              key={virtualRow.index}
              data-index={virtualRow.index}
              ref={virtualizer.measureElement}
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                transform: `translateY(${virtualRow.start}px)`,
                display: 'grid',
                gridTemplateColumns: `repeat(${columns}, 1fr)`,
                gap: `${gap}px`
              }}
              role="row"
            >
              {rowItems.map((item, colIndex) => {
                const itemIndex = startIndex + colIndex
                const key = getItemKey
                  ? getItemKey(item, itemIndex)
                  : itemIndex

                return (
                  <div key={key} role="gridcell">
                    {renderItem(item, itemIndex)}
                  </div>
                )
              })}
            </div>
          )
        })}
      </div>
    </div>
  )
}

/**
 * Hook for manual virtual scrolling control
 * Use this when you need fine-grained control over the virtualizer
 */
export function useVirtualList<T>(
  items: T[],
  options: Partial<VirtualizerOptions<HTMLDivElement, Element>>
) {
  const parentRef = useRef<HTMLDivElement>(null)

  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => parentRef.current,
    ...options
  })

  return {
    parentRef,
    virtualizer,
    virtualItems: virtualizer.getVirtualItems(),
    totalSize: virtualizer.getTotalSize()
  }
}
