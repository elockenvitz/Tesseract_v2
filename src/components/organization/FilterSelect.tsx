/**
 * FilterSelect — a filter dropdown that matches its neighbours on a phone.
 *
 * Native `<select>` on desktop, where it is the right control. On a phone a
 * button plus a sheet, for one reason: `index.css` forces every `select` to
 * `font-size: 16px !important` below 768px to stop iOS zooming the viewport
 * on focus and never zooming back. That guard is worth keeping, but it means
 * a native select can never match the `text-xs` pills and buttons sitting
 * beside it — it renders a third taller, in larger type, for a one-word
 * value. A button is outside the rule and never triggers the zoom.
 *
 * The options are declared once and rendered by both branches, so the two
 * form factors cannot drift into describing the same filter differently.
 */

import { useState } from 'react'
import { Check, ChevronDown } from 'lucide-react'
import { useIsMobile } from '../../hooks/useMediaQuery'

export interface FilterOption {
  value: string
  label: string
}

interface FilterSelectProps {
  value: string
  onChange: (value: string) => void
  options: FilterOption[]
  /** Describes the control itself, e.g. "Filter members by status". */
  ariaLabel: string
  /** Heading for the phone sheet. Defaults to `ariaLabel`. */
  sheetTitle?: string
  /** Applied to the desktop `<select>`, so each caller keeps its own look. */
  className?: string
  /** Applied to the phone button, for width or ordering tweaks. */
  buttonClassName?: string
}

export function FilterSelect({
  value,
  onChange,
  options,
  ariaLabel,
  sheetTitle,
  className,
  buttonClassName,
}: FilterSelectProps) {
  const isMobile = useIsMobile()
  const [sheetOpen, setSheetOpen] = useState(false)

  if (!isMobile) {
    return (
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-label={ariaLabel}
        className={className}
      >
        {options.map(o => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    )
  }

  const current = options.find(o => o.value === value)

  return (
    <>
      <button
        type="button"
        onClick={() => setSheetOpen(true)}
        aria-label={ariaLabel}
        aria-haspopup="dialog"
        data-slot="filter-select"
        className={`no-touch-target tap-pad inline-flex min-w-0 shrink items-center gap-1 rounded border border-gray-300 px-2.5 py-1.5 text-xs font-medium text-gray-700 dark:border-gray-600 dark:text-gray-300 ${buttonClassName ?? ''}`}
      >
        <span className="truncate">{current?.label ?? options[0]?.label}</span>
        <ChevronDown className="h-3 w-3 shrink-0 text-gray-400" />
      </button>

      {sheetOpen && (
        <div className="fixed inset-0 z-[70] flex items-end" role="dialog" aria-modal="true" aria-label={sheetTitle ?? ariaLabel}>
          <div className="absolute inset-0 bg-black/40" onClick={() => setSheetOpen(false)} />
          {/* Bounded height: some of these lists are every person or portfolio
              in the organisation, which is taller than the screen. */}
          <div className="relative max-h-[70dvh] w-full overflow-y-auto rounded-t-xl bg-white pb-[calc(0.75rem+env(safe-area-inset-bottom,0px))] shadow-2xl dark:bg-gray-800">
            <div className="sticky top-0 border-b border-gray-100 bg-white px-4 py-3 text-sm font-semibold text-gray-900 dark:border-gray-800 dark:bg-gray-800 dark:text-white">
              {sheetTitle ?? ariaLabel}
            </div>
            <div className="py-1">
              {options.map(o => (
                <button
                  key={o.value}
                  type="button"
                  onClick={() => { onChange(o.value); setSheetOpen(false) }}
                  className={`flex w-full min-h-[48px] items-center gap-2.5 px-4 text-left text-sm ${
                    o.value === value
                      ? 'font-medium text-indigo-700 dark:text-indigo-300'
                      : 'text-gray-700 dark:text-gray-200'
                  }`}
                >
                  <span className="min-w-0 flex-1 truncate">{o.label}</span>
                  {o.value === value && <Check className="h-4 w-4 shrink-0" />}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </>
  )
}
