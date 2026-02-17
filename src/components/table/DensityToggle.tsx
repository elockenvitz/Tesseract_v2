/**
 * DensityToggle - Segmented control for table row density
 *
 * Three visible options: Comfortable | Compact | Ultra
 * "micro" is a hidden power-user mode (mapped to Ultra in the UI).
 */

import React, { useState, useContext } from 'react'
import { DensityMode, TableContext } from '../../contexts/TableContext'
import { clsx } from 'clsx'

const VISIBLE_MODES: { value: DensityMode; label: string }[] = [
  { value: 'comfortable', label: 'Comfortable' },
  { value: 'compact', label: 'Compact' },
  { value: 'ultra', label: 'Ultra' },
]

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

  // Map micro → ultra for display purposes
  const activeValue: DensityMode = density === 'micro' ? 'ultra' : density

  return (
    <div className={clsx('flex items-center bg-gray-100 rounded-md p-0.5', className)}>
      {VISIBLE_MODES.map(mode => (
        <button
          key={mode.value}
          onClick={() => setDensity(mode.value)}
          className={clsx(
            'px-2.5 py-1 text-[11px] font-medium rounded transition-all',
            activeValue === mode.value
              ? 'bg-white text-gray-900 shadow-sm'
              : 'text-gray-500 hover:text-gray-700'
          )}
        >
          {mode.label}
        </button>
      ))}
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
