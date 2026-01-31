/**
 * DensityToggle - Simple zoom-style control for table row density
 *
 * Four zoom levels:
 * - Zoomed in: Comfortable, spacious rows (64px)
 * - Default: Compact, balanced (44px)
 * - Zoomed out: Ultra-compact, maximum density (32px)
 * - Micro: Extreme density for maximum assets (24px)
 */

import React, { useState, useContext } from 'react'
import { ZoomIn, ZoomOut } from 'lucide-react'
import { DensityMode, TableContext } from '../../contexts/TableContext'
import { clsx } from 'clsx'

const DENSITY_ORDER: DensityMode[] = ['micro', 'ultra', 'compact', 'comfortable']

interface DensityToggleProps {
  className?: string
}

// Hook that works with or without TableContext
function useDensityState() {
  const context = useContext(TableContext)

  // Standalone state (used when outside TableProvider)
  const [standaloneDensity, setStandaloneDensity] = useState<DensityMode>(() => {
    const saved = localStorage.getItem('table-density')
    return (saved as DensityMode) || 'compact'
  })

  // If we have context, use it
  if (context) {
    return {
      density: context.state.density,
      setDensity: context.setDensity
    }
  }

  // Standalone fallback
  const setDensity = (mode: DensityMode) => {
    setStandaloneDensity(mode)
    localStorage.setItem('table-density', mode)
    // Dispatch custom event (StorageEvent only works across tabs, not same window)
    window.dispatchEvent(new CustomEvent('density-change', { detail: { density: mode } }))
  }

  return {
    density: standaloneDensity,
    setDensity
  }
}

export function DensityToggle({ className = '' }: DensityToggleProps) {
  const { density, setDensity } = useDensityState()

  const currentIndex = DENSITY_ORDER.indexOf(density)
  const canZoomOut = currentIndex > 0
  const canZoomIn = currentIndex < DENSITY_ORDER.length - 1

  const zoomIn = () => {
    if (canZoomIn) {
      setDensity(DENSITY_ORDER[currentIndex + 1])
    }
  }

  const zoomOut = () => {
    if (canZoomOut) {
      setDensity(DENSITY_ORDER[currentIndex - 1])
    }
  }

  return (
    <div className={clsx('flex items-center bg-gray-100 rounded-md p-0.5', className)}>
      <button
        onClick={zoomOut}
        disabled={!canZoomOut}
        className={clsx(
          'p-1 rounded transition-colors',
          canZoomOut
            ? 'text-gray-600 hover:bg-white hover:shadow-sm'
            : 'text-gray-300 cursor-not-allowed'
        )}
        title="Zoom out (smaller rows)"
      >
        <ZoomOut className="w-3.5 h-3.5" />
      </button>

      <div className="w-px h-3 bg-gray-300 mx-0.5" />

      <button
        onClick={zoomIn}
        disabled={!canZoomIn}
        className={clsx(
          'p-1 rounded transition-colors',
          canZoomIn
            ? 'text-gray-600 hover:bg-white hover:shadow-sm'
            : 'text-gray-300 cursor-not-allowed'
        )}
        title="Zoom in (larger rows)"
      >
        <ZoomIn className="w-3.5 h-3.5" />
      </button>
    </div>
  )
}

/**
 * Inline density toggle - kept for backwards compatibility
 */
export function DensityToggleInline({ className = '' }: DensityToggleProps) {
  return <DensityToggle className={className} />
}

export default DensityToggle
