import { useState } from 'react'
import { clsx } from 'clsx'
import { CalendarRange } from 'lucide-react'
import type { AccountabilityFilters } from '../../types/decision-accountability'
import { DATE_PRESET_BUTTONS, activePresetFor, customRange, presetRange } from '../../lib/outcomes/date-presets'

const LABEL: Record<string, string> = { '7d': '7D', '30d': '30D', '90d': '90D', QTD: 'QTD', YTD: 'YTD', '1Y': '1Y', ALL: 'All' }

/**
 * The Outcomes date range on a phone.
 *
 * The desktop bar is seven presets plus "Custom" in one scrolling track; at
 * 390px it ran past the edge and cut "Custom" in half. Here the seven presets
 * are a compact segmented track that fits the width, and Custom is a separate
 * calendar button that opens its two date fields inline below — no popover to
 * fall off the screen. Same presets, same ranges (lib/outcomes/date-presets).
 */
export function OutcomesRangeControl({
  filters,
  onChange,
}: {
  filters: Partial<AccountabilityFilters>
  onChange: (f: Partial<AccountabilityFilters>) => void
}) {
  const [showCustom, setShowCustom] = useState(false)
  const [customStart, setCustomStart] = useState('')
  const [customEnd, setCustomEnd] = useState('')
  const active = activePresetFor(filters.dateRange?.start)
  const customOn = showCustom || active === 'custom' || active === '2Y'

  return (
    <div data-slot="outcomes-range" className="min-w-0">
      <div className="flex items-center gap-1.5">
        {/* A filter, not a heading: no track, small grey labels, and the
            chosen range marked by a light fill rather than a raised chip. */}
        <div
          role="radiogroup"
          aria-label="Date range"
          className="flex min-w-0 items-center p-0.5"
        >
          {DATE_PRESET_BUTTONS.map(p => (
            <button
              key={p}
              type="button"
              role="radio"
              aria-checked={!showCustom && active === p}
              onClick={() => { setShowCustom(false); onChange({ ...filters, dateRange: presetRange(p as Exclude<typeof p, 'custom'>) }) }}
              className={clsx(
                'no-touch-target tap-pad h-7 min-w-[38px] px-1.5 rounded-md text-[11px] tabular-nums whitespace-nowrap transition-colors',
                !showCustom && active === p
                  ? 'bg-gray-100 font-semibold text-gray-700 dark:bg-gray-800 dark:text-gray-200'
                  : 'font-medium text-gray-400 active:text-gray-700 dark:text-gray-500',
              )}
            >
              {LABEL[p]}
            </button>
          ))}
        </div>
        <button
          type="button"
          aria-label="Custom range"
          aria-expanded={showCustom}
          onClick={() => setShowCustom(v => !v)}
          className={clsx(
            'no-touch-target tap-pad h-7 w-9 shrink-0 flex items-center justify-center rounded-md transition-colors',
            customOn
              ? 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-200'
              : 'text-gray-400 dark:text-gray-500',
          )}
        >
          <CalendarRange className="h-3.5 w-3.5" />
        </button>
      </div>

      {showCustom && (
        <div data-slot="outcomes-range-custom" className="mt-2 flex flex-wrap items-center gap-2">
          <input
            type="date"
            aria-label="From"
            value={customStart}
            onChange={e => setCustomStart(e.target.value)}
            className="min-w-0 flex-1 basis-[8rem] h-9 rounded-md border border-gray-200 px-2 text-[13px] dark:border-gray-700 dark:bg-gray-800"
          />
          <input
            type="date"
            aria-label="To"
            value={customEnd}
            onChange={e => setCustomEnd(e.target.value)}
            className="min-w-0 flex-1 basis-[8rem] h-9 rounded-md border border-gray-200 px-2 text-[13px] dark:border-gray-700 dark:bg-gray-800"
          />
          <button
            type="button"
            disabled={!customStart}
            onClick={() => { onChange({ ...filters, dateRange: customRange(customStart, customEnd) }); setShowCustom(false) }}
            className="no-touch-target tap-pad h-9 px-3 rounded-md bg-teal-600 text-[13px] font-medium text-white disabled:opacity-40"
          >
            Apply
          </button>
        </div>
      )}
    </div>
  )
}
