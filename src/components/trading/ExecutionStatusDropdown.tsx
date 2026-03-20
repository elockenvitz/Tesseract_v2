/**
 * ExecutionStatusDropdown — Trader-facing status transition control.
 */

import { useState, useRef, useEffect } from 'react'
import { ChevronDown } from 'lucide-react'
import { clsx } from 'clsx'
import type { ExecutionStatus } from '../../types/trading'

const STATUS_CONFIG: Record<ExecutionStatus, { label: string; color: string; dot: string }> = {
  not_started: {
    label: 'Not Started',
    color: 'text-gray-600 dark:text-gray-400',
    dot: 'bg-gray-400',
  },
  in_progress: {
    label: 'In Progress',
    color: 'text-amber-600 dark:text-amber-400',
    dot: 'bg-amber-400',
  },
  complete: {
    label: 'Complete',
    color: 'text-green-600 dark:text-green-400',
    dot: 'bg-green-500',
  },
  cancelled: {
    label: 'Cancelled',
    color: 'text-red-600 dark:text-red-400',
    dot: 'bg-red-400',
  },
}

const TRANSITIONS: Record<ExecutionStatus, ExecutionStatus[]> = {
  not_started: ['in_progress', 'cancelled'],
  in_progress: ['complete', 'cancelled'],
  complete: [],
  cancelled: [],
}

interface ExecutionStatusDropdownProps {
  status: ExecutionStatus
  onChange: (status: ExecutionStatus) => void
  disabled?: boolean
  className?: string
}

export function ExecutionStatusDropdown({
  status,
  onChange,
  disabled,
  className,
}: ExecutionStatusDropdownProps) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  const config = STATUS_CONFIG[status]
  const options = TRANSITIONS[status]

  return (
    <div ref={ref} className={clsx('relative inline-block', className)}>
      <button
        onClick={() => !disabled && options.length > 0 && setOpen(!open)}
        disabled={disabled || options.length === 0}
        className={clsx(
          'flex items-center gap-1.5 px-2 py-1 rounded text-xs font-medium transition-colors',
          config.color,
          options.length > 0 && !disabled && 'hover:bg-gray-100 dark:hover:bg-gray-700 cursor-pointer',
          (disabled || options.length === 0) && 'cursor-default'
        )}
      >
        <span className={clsx('w-1.5 h-1.5 rounded-full', config.dot)} />
        {config.label}
        {options.length > 0 && !disabled && (
          <ChevronDown className="w-3 h-3 opacity-50" />
        )}
      </button>

      {open && (
        <div className="absolute z-50 mt-1 right-0 w-36 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-lg py-1">
          {options.map(opt => {
            const c = STATUS_CONFIG[opt]
            return (
              <button
                key={opt}
                onClick={() => { onChange(opt); setOpen(false) }}
                className="w-full flex items-center gap-2 px-3 py-1.5 text-xs hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
              >
                <span className={clsx('w-1.5 h-1.5 rounded-full', c.dot)} />
                <span className={c.color}>{c.label}</span>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
