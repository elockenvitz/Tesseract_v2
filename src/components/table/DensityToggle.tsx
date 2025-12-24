/**
 * DensityToggle - Elegant density mode switcher for table views
 *
 * Three modes:
 * - Comfortable: Spacious rows with full info (64px)
 * - Compact: Balanced density (44px)
 * - Ultra: Maximum data density (32px)
 */

import React, { useState, useRef, useEffect } from 'react'
import { LayoutList, AlignJustify, List, Check } from 'lucide-react'
import { DensityMode, DENSITY_CONFIG, useTableContext } from '../../contexts/TableContext'

const DENSITY_OPTIONS: { mode: DensityMode; label: string; description: string; icon: React.ReactNode }[] = [
  {
    mode: 'comfortable',
    label: 'Comfortable',
    description: 'Spacious layout with full details',
    icon: <LayoutList className="w-4 h-4" />
  },
  {
    mode: 'compact',
    label: 'Compact',
    description: 'Balanced density for scanning',
    icon: <AlignJustify className="w-4 h-4" />
  },
  {
    mode: 'ultra',
    label: 'Ultra-Compact',
    description: 'Maximum data density',
    icon: <List className="w-4 h-4" />
  }
]

interface DensityToggleProps {
  className?: string
}

export function DensityToggle({ className = '' }: DensityToggleProps) {
  const { state, setDensity, cycleDensity } = useTableContext()
  const [isOpen, setIsOpen] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)

  // Close on click outside
  useEffect(() => {
    if (!isOpen) return

    const handleClick = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsOpen(false)
      }
    }

    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [isOpen])

  // Close on Escape
  useEffect(() => {
    if (!isOpen) return

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsOpen(false)
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [isOpen])

  const currentOption = DENSITY_OPTIONS.find(opt => opt.mode === state.density) || DENSITY_OPTIONS[0]
  const densityConfig = DENSITY_CONFIG[state.density]

  return (
    <div ref={dropdownRef} className={`relative ${className}`}>
      {/* Toggle Button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        onDoubleClick={(e) => {
          e.preventDefault()
          cycleDensity()
        }}
        className="flex items-center gap-2 px-3 py-1.5 text-sm text-gray-600 dark:text-gray-300
                   bg-white dark:bg-dark-card border border-gray-200 dark:border-gray-700
                   rounded-lg hover:bg-gray-50 dark:hover:bg-dark-hover
                   focus:outline-none focus:ring-2 focus:ring-primary-500/50
                   transition-all duration-150"
        title="Change table density (D to cycle)"
      >
        {currentOption.icon}
        <span className="hidden sm:inline">{currentOption.label}</span>
        <span className="hidden sm:inline text-xs text-gray-400 dark:text-gray-500 ml-1">
          {densityConfig.rowHeight}px
        </span>
        <svg
          className={`w-4 h-4 text-gray-400 transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {/* Dropdown Menu */}
      {isOpen && (
        <div className="absolute right-0 mt-2 w-64 bg-white dark:bg-dark-card border border-gray-200
                        dark:border-gray-700 rounded-xl shadow-lg shadow-black/10 dark:shadow-black/30
                        z-50 overflow-hidden animate-in fade-in slide-in-from-top-2 duration-150">
          {/* Header */}
          <div className="px-4 py-2.5 border-b border-gray-100 dark:border-gray-800">
            <p className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
              Table Density
            </p>
          </div>

          {/* Options */}
          <div className="py-1">
            {DENSITY_OPTIONS.map((option) => {
              const isActive = state.density === option.mode
              const config = DENSITY_CONFIG[option.mode]

              return (
                <button
                  key={option.mode}
                  onClick={() => {
                    setDensity(option.mode)
                    setIsOpen(false)
                  }}
                  className={`w-full flex items-start gap-3 px-4 py-2.5 text-left transition-colors
                    ${isActive
                      ? 'bg-primary-50 dark:bg-primary-900/20'
                      : 'hover:bg-gray-50 dark:hover:bg-dark-hover'
                    }`}
                >
                  {/* Icon */}
                  <div className={`mt-0.5 ${isActive ? 'text-primary-600 dark:text-primary-400' : 'text-gray-400 dark:text-gray-500'}`}>
                    {option.icon}
                  </div>

                  {/* Label & Description */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className={`text-sm font-medium ${isActive ? 'text-primary-700 dark:text-primary-300' : 'text-gray-700 dark:text-gray-200'}`}>
                        {option.label}
                      </span>
                      <span className="text-xs text-gray-400 dark:text-gray-500">
                        {config.rowHeight}px
                      </span>
                    </div>
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                      {option.description}
                    </p>
                  </div>

                  {/* Check */}
                  {isActive && (
                    <Check className="w-4 h-4 text-primary-600 dark:text-primary-400 mt-0.5" />
                  )}
                </button>
              )
            })}
          </div>

          {/* Footer with keyboard hint */}
          <div className="px-4 py-2 border-t border-gray-100 dark:border-gray-800 bg-gray-50 dark:bg-dark-hover">
            <p className="text-xs text-gray-500 dark:text-gray-400 flex items-center gap-2">
              <kbd className="px-1.5 py-0.5 text-[10px] font-mono bg-white dark:bg-dark-card border border-gray-200 dark:border-gray-600 rounded">
                D
              </kbd>
              <span>to cycle densities</span>
            </p>
          </div>
        </div>
      )}
    </div>
  )
}

/**
 * Inline density toggle - simpler 3-button variant for tight spaces
 */
export function DensityToggleInline({ className = '' }: DensityToggleProps) {
  const { state, setDensity } = useTableContext()

  return (
    <div className={`flex items-center rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden ${className}`}>
      {DENSITY_OPTIONS.map((option) => {
        const isActive = state.density === option.mode

        return (
          <button
            key={option.mode}
            onClick={() => setDensity(option.mode)}
            className={`p-2 transition-colors
              ${isActive
                ? 'bg-primary-100 dark:bg-primary-900/30 text-primary-600 dark:text-primary-400'
                : 'bg-white dark:bg-dark-card text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-dark-hover'
              }`}
            title={`${option.label} (${DENSITY_CONFIG[option.mode].rowHeight}px rows)`}
          >
            {option.icon}
          </button>
        )
      })}
    </div>
  )
}

export default DensityToggle
