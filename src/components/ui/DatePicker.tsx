import React, { useState, useRef, useEffect } from 'react'
import {
  format,
  startOfMonth,
  endOfMonth,
  startOfWeek,
  endOfWeek,
  addDays,
  addMonths,
  subMonths,
  isSameMonth,
  isSameDay,
  isToday,
  parseISO,
  differenceInDays,
  isPast,
  startOfDay,
  isAfter,
  isBefore,
  isValid,
  parse
} from 'date-fns'
import { ChevronLeft, ChevronRight, Calendar, X, Target } from 'lucide-react'
import { clsx } from 'clsx'

interface DatePickerProps {
  value?: string | null
  onChange: (date: string | null) => void
  placeholder?: string
  className?: string
  showClear?: boolean
  compact?: boolean
  variant?: 'default' | 'inline'
  showOverdue?: boolean
  isCompleted?: boolean
  maxDate?: string | null
  projectDueDate?: string | null
  allowPastDates?: boolean
}

export function DatePicker({
  value,
  onChange,
  placeholder = 'Set date',
  className,
  showClear = true,
  compact = false,
  variant = 'default',
  showOverdue = false,
  isCompleted = false,
  maxDate,
  projectDueDate,
  allowPastDates = false
}: DatePickerProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [currentMonth, setCurrentMonth] = useState(() =>
    value ? parseISO(value) : new Date()
  )
  const [popoverPosition, setPopoverPosition] = useState<{ top: number; left: number } | null>(null)
  const [customDateInput, setCustomDateInput] = useState('')
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const popoverRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)

  // Auto-clear error message after 3 seconds
  useEffect(() => {
    if (errorMessage) {
      const timer = setTimeout(() => setErrorMessage(null), 3000)
      return () => clearTimeout(timer)
    }
  }, [errorMessage])

  const selectedDate = value ? parseISO(value) : null
  const maxDateParsed = maxDate ? parseISO(maxDate) : null
  const projectDueDateParsed = projectDueDate ? parseISO(projectDueDate) : null

  // Calculate overdue status
  const isOverdue = showOverdue && selectedDate && !isCompleted && isPast(startOfDay(selectedDate)) && !isToday(selectedDate)
  const daysOverdue = isOverdue ? differenceInDays(startOfDay(new Date()), startOfDay(selectedDate)) : 0

  // Check if a date is disabled (before today or after maxDate)
  const isDateDisabled = (date: Date) => {
    const today = startOfDay(new Date())
    // Disable past dates (unless allowPastDates is true)
    if (!allowPastDates && isBefore(startOfDay(date), today)) {
      return true
    }
    // Disable dates after maxDate
    if (maxDateParsed && isAfter(startOfDay(date), startOfDay(maxDateParsed))) {
      return true
    }
    return false
  }

  // Check if date is the project due date
  const isProjectDueDate = (date: Date) => {
    if (!projectDueDateParsed) return false
    return isSameDay(date, projectDueDateParsed)
  }

  // Close on click outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setIsOpen(false)
      }
    }

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside)
      return () => document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [isOpen])

  // Close on Escape
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsOpen(false)
    }

    if (isOpen) {
      document.addEventListener('keydown', handleKeyDown)
      return () => document.removeEventListener('keydown', handleKeyDown)
    }
  }, [isOpen])

  // Clear error when popover closes
  useEffect(() => {
    if (!isOpen) {
      setErrorMessage(null)
    }
  }, [isOpen])

  const handleDateSelect = (date: Date) => {
    if (isDateDisabled(date)) return
    onChange(format(date, 'yyyy-MM-dd'))
    setCustomDateInput('')
    setIsOpen(false)
  }

  const handleClear = (e: React.MouseEvent) => {
    e.stopPropagation()
    onChange(null)
    setCustomDateInput('')
    setIsOpen(false)
  }

  const handleCustomDateSubmit = () => {
    if (!customDateInput.trim()) return

    // Try parsing common date formats
    const formats = ['MM/dd/yyyy', 'M/d/yyyy', 'yyyy-MM-dd', 'MM-dd-yyyy']
    let parsedDate: Date | null = null

    for (const fmt of formats) {
      const result = parse(customDateInput, fmt, new Date())
      if (isValid(result)) {
        parsedDate = result
        break
      }
    }

    if (!parsedDate) {
      setErrorMessage('Invalid format. Use MM/DD/YYYY')
      return
    }

    if (isDateDisabled(parsedDate)) {
      const isPastDate = isBefore(startOfDay(parsedDate), startOfDay(new Date()))
      const isAfterDeadline = maxDateParsed && isAfter(startOfDay(parsedDate), startOfDay(maxDateParsed))

      if (isAfterDeadline) {
        setErrorMessage('Select a date before the project deadline')
      } else if (!allowPastDates && isPastDate) {
        setErrorMessage('Please select a future date')
      } else {
        setErrorMessage('This date is not available')
      }
      return
    }

    handleDateSelect(parsedDate)
  }

  // Generate calendar days
  const monthStart = startOfMonth(currentMonth)
  const monthEnd = endOfMonth(currentMonth)
  const calendarStart = startOfWeek(monthStart)
  const calendarEnd = endOfWeek(monthEnd)

  const days: Date[] = []
  let day = calendarStart
  while (day <= calendarEnd) {
    days.push(day)
    day = addDays(day, 1)
  }

  // Quick date options - filter out disabled dates
  const baseQuickDates = [
    { label: 'Today', date: new Date() },
    { label: 'Tomorrow', date: addDays(new Date(), 1) },
    { label: '+1 week', date: addDays(new Date(), 7) },
  ]

  const quickDates = baseQuickDates.filter(({ date }) => !isDateDisabled(date))

  // Calculate popover position to avoid overflow
  const openPopover = () => {
    if (triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect()
      const popoverWidth = 288 // w-72 = 18rem = 288px
      const popoverHeight = 380 // approximate height

      let top = rect.bottom + 4
      let left = rect.left

      // Adjust if would overflow right edge
      if (left + popoverWidth > window.innerWidth - 16) {
        left = window.innerWidth - popoverWidth - 16
      }

      // Adjust if would overflow bottom edge - show above instead
      if (top + popoverHeight > window.innerHeight - 16) {
        top = rect.top - popoverHeight - 4
      }

      // Ensure not off left edge
      if (left < 16) {
        left = 16
      }

      setPopoverPosition({ top, left })
    }
    setIsOpen(true)
  }

  return (
    <div ref={containerRef} className={clsx('relative inline-block', className)}>
      {/* Trigger Button */}
      <button
        ref={triggerRef}
        type="button"
        onClick={(e) => {
          e.stopPropagation()
          if (isOpen) {
            setIsOpen(false)
          } else {
            openPopover()
          }
        }}
        className={clsx(
          'flex items-center gap-1 transition-colors',
          compact
            ? 'text-xs hover:text-primary-600 dark:hover:text-primary-400'
            : variant === 'inline'
            ? 'text-sm hover:text-primary-600 dark:hover:text-primary-400'
            : 'text-sm px-2 py-1 rounded border border-gray-300 dark:border-gray-600 hover:border-primary-500 bg-white dark:bg-gray-800',
          isOverdue
            ? 'text-red-600 dark:text-red-400'
            : variant === 'inline'
            ? 'text-gray-500 dark:text-gray-400'
            : selectedDate
            ? 'text-gray-900 dark:text-white'
            : 'text-gray-400 dark:text-gray-500'
        )}
      >
        <Calendar className={compact ? 'w-3 h-3' : 'w-4 h-4'} />
        <span>
          {isOverdue
            ? `${daysOverdue} day${daysOverdue !== 1 ? 's' : ''} overdue`
            : selectedDate
            ? format(selectedDate, compact ? 'MMM d' : 'MMM d, yyyy')
            : placeholder}
        </span>
        {showClear && selectedDate && !compact && variant !== 'inline' && (
          <X
            className="w-3 h-3 ml-1 text-gray-400 hover:text-red-500"
            onClick={handleClear}
          />
        )}
      </button>

      {/* Popover */}
      {isOpen && popoverPosition && (
        <div
          ref={popoverRef}
          className="fixed z-50 bg-white dark:bg-gray-800 rounded-lg shadow-xl border border-gray-200 dark:border-gray-700 p-3 w-72"
          style={{ top: popoverPosition.top, left: popoverPosition.left }}
          onClick={(e) => e.stopPropagation()}
        >
          {/* Quick Dates */}
          <div className="flex flex-wrap gap-1 mb-2 pb-2 border-b border-gray-200 dark:border-gray-700">
            {quickDates.map(({ label, date }) => (
              <button
                key={label}
                onClick={() => handleDateSelect(date)}
                className={clsx(
                  'px-2 py-0.5 text-xs rounded transition-colors',
                  selectedDate && isSameDay(date, selectedDate)
                    ? 'bg-primary-600 text-white'
                    : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
                )}
              >
                {label}
              </button>
            ))}
            {projectDueDateParsed && (
              <button
                onClick={() => handleDateSelect(projectDueDateParsed)}
                className={clsx(
                  'px-2 py-0.5 text-xs rounded transition-colors flex items-center gap-1',
                  selectedDate && isSameDay(projectDueDateParsed, selectedDate)
                    ? 'bg-orange-600 text-white'
                    : 'bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-400 hover:bg-orange-200 dark:hover:bg-orange-900/50'
                )}
              >
                <Target className="w-3 h-3" />
                Deadline
              </button>
            )}
            {showClear && selectedDate && (
              <button
                onClick={handleClear}
                className="px-2 py-0.5 text-xs rounded bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400 hover:bg-red-200 dark:hover:bg-red-900/50"
              >
                Clear
              </button>
            )}
          </div>

          {/* Custom Date Input */}
          <div className="mb-2 pb-2 border-b border-gray-200 dark:border-gray-700">
            <div className="flex gap-1">
              <input
                type="text"
                value={customDateInput}
                onChange={(e) => {
                  setCustomDateInput(e.target.value)
                  setErrorMessage(null)
                }}
                placeholder="MM/DD/YYYY"
                className={clsx(
                  "flex-1 px-2 py-1 text-xs border rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-1 cursor-text",
                  errorMessage
                    ? "border-red-300 dark:border-red-600 focus:ring-red-500"
                    : "border-gray-300 dark:border-gray-600 focus:ring-primary-500"
                )}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    handleCustomDateSubmit()
                  }
                }}
              />
              <button
                onClick={handleCustomDateSubmit}
                disabled={!customDateInput.trim()}
                className="px-2 py-1 text-xs rounded bg-primary-600 text-white hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Set
              </button>
            </div>
            {errorMessage && (
              <p className="mt-1.5 text-xs text-red-600 dark:text-red-400 flex items-center gap-1">
                <span className="inline-block w-1 h-1 rounded-full bg-red-500" />
                {errorMessage}
              </p>
            )}
          </div>

          {/* Month Navigation */}
          <div className="flex items-center justify-between mb-2">
            <button
              onClick={() => setCurrentMonth(subMonths(currentMonth, 1))}
              className="p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
            >
              <ChevronLeft className="w-4 h-4 text-gray-600 dark:text-gray-400" />
            </button>
            <span className="text-sm font-medium text-gray-900 dark:text-white">
              {format(currentMonth, 'MMMM yyyy')}
            </span>
            <button
              onClick={() => setCurrentMonth(addMonths(currentMonth, 1))}
              className="p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
            >
              <ChevronRight className="w-4 h-4 text-gray-600 dark:text-gray-400" />
            </button>
          </div>

          {/* Day Headers */}
          <div className="grid grid-cols-7 gap-1 mb-1">
            {['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'].map((d) => (
              <div
                key={d}
                className="text-center text-xs font-medium text-gray-500 dark:text-gray-400 py-1"
              >
                {d}
              </div>
            ))}
          </div>

          {/* Calendar Days */}
          <div className="grid grid-cols-7 gap-1">
            {days.map((d, i) => {
              const isSelected = selectedDate && isSameDay(d, selectedDate)
              const isCurrentMonth = isSameMonth(d, currentMonth)
              const isTodayDate = isToday(d)
              const isDisabled = isDateDisabled(d)
              const isDeadline = isProjectDueDate(d)

              return (
                <button
                  key={i}
                  onClick={() => handleDateSelect(d)}
                  disabled={isDisabled}
                  className={clsx(
                    'w-8 h-8 rounded text-sm transition-colors relative',
                    isDisabled
                      ? 'text-gray-300 dark:text-gray-600 cursor-not-allowed'
                      : isSelected
                      ? 'bg-primary-600 text-white font-medium'
                      : isDeadline
                      ? 'ring-2 ring-orange-500 text-orange-600 dark:text-orange-400 font-medium hover:bg-orange-50 dark:hover:bg-orange-900/20'
                      : isTodayDate
                      ? 'bg-primary-100 dark:bg-primary-900/30 text-primary-700 dark:text-primary-300 font-medium'
                      : isCurrentMonth
                      ? 'text-gray-900 dark:text-white hover:bg-gray-100 dark:hover:bg-gray-700'
                      : 'text-gray-400 dark:text-gray-600 hover:bg-gray-50 dark:hover:bg-gray-800'
                  )}
                >
                  {format(d, 'd')}
                </button>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
