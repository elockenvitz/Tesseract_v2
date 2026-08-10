import { useEffect, useId, useRef, useState } from 'react'
import { clsx } from 'clsx'
import { Check, ChevronDown } from 'lucide-react'
import { useIsMobile } from '../../hooks/useMediaQuery'
import { BottomSheet } from '../mobile/BottomSheet'

/**
 * A single-choice control for dense toolbars.
 *
 * It exists because the two obvious alternatives both fail on a phone: a row
 * of pills grows past 390px and turns the whole page into a horizontal pan
 * surface, and a native `<select>` renders as a chrome-styled box that is
 * taller than the toolbar around it and cannot be made to match it.
 *
 * The trigger is a text button sized to the toolbar. The menu is a popover on
 * desktop and a bottom sheet on touch, where a popover's ~28px rows are below
 * a comfortable tap target.
 */

export interface PickerOption<T extends string> {
  value: T
  label: string
  /** Shown dimmed after the label — a match count, typically. */
  count?: number
  /** Second line in the menu. Never rendered in the trigger. */
  hint?: string
}

interface OptionPickerProps<T extends string> {
  value: T
  options: PickerOption<T>[]
  onChange: (value: T) => void
  /** Sheet title and accessible name. */
  label: string
  /** Dimmed word before the value in the trigger, e.g. "Group". */
  prefix?: string
  /** Which edge of the trigger the desktop popover hangs from. */
  align?: 'left' | 'right'
  className?: string
}

export function OptionPicker<T extends string>({
  value,
  options,
  onChange,
  label,
  prefix,
  align = 'left',
  className,
}: OptionPickerProps<T>) {
  const isMobile = useIsMobile()
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)
  const menuId = useId()

  const selected = options.find(o => o.value === value)

  // Desktop popover only. The sheet has its own backdrop.
  useEffect(() => {
    if (!open || isMobile) return
    const onPointerDown = (event: MouseEvent) => {
      if (!wrapRef.current?.contains(event.target as Node)) setOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open, isMobile])

  const choose = (next: T) => {
    onChange(next)
    setOpen(false)
  }

  const trigger = (
    <button
      type="button"
      onClick={() => setOpen(v => !v)}
      aria-haspopup="listbox"
      aria-expanded={open}
      aria-controls={open ? menuId : undefined}
      aria-label={label}
      // Deliberately no `no-touch-target`: h-7 is the right size beside a dense
      // desktop toolbar, and on a touch phone the global 44px minimum should
      // win — this is the control that now carries the whole view choice.
      className={clsx(
        'inline-flex items-center gap-1 h-7 max-w-full px-2 rounded',
        'text-[11px] font-medium border transition-colors',
        open
          ? 'border-gray-300 bg-gray-100 text-gray-900 dark:border-gray-600 dark:bg-gray-700 dark:text-white'
          : 'border-gray-200 text-gray-600 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800',
      )}
    >
      {prefix && <span className="text-gray-400 shrink-0">{prefix}</span>}
      <span className="truncate">{selected?.label ?? label}</span>
      {selected?.count != null && selected.count > 0 && (
        <span className="text-[10px] tabular-nums text-gray-400 shrink-0">{selected.count}</span>
      )}
      <ChevronDown
        className={clsx('h-3 w-3 shrink-0 text-gray-400 transition-transform', open && 'rotate-180')}
      />
    </button>
  )

  if (isMobile) {
    return (
      <>
        <div className={clsx('min-w-0', className)}>{trigger}</div>
        <BottomSheet open={open} onClose={() => setOpen(false)} title={label} fitContent>
          <ul id={menuId} role="listbox" aria-label={label} className="py-1 pb-safe">
            {options.map(option => (
              <li key={option.value}>
                <button
                  type="button"
                  role="option"
                  aria-selected={option.value === value}
                  onClick={() => choose(option.value)}
                  className="w-full flex items-center gap-3 px-4 py-3 text-left active:bg-gray-100 dark:active:bg-gray-800"
                >
                  <span className="flex-1 min-w-0">
                    <span
                      className={clsx(
                        'block text-sm truncate',
                        option.value === value
                          ? 'font-semibold text-gray-900 dark:text-white'
                          : 'text-gray-700 dark:text-gray-300',
                      )}
                    >
                      {option.label}
                    </span>
                    {option.hint && (
                      <span className="block text-xs text-gray-400 truncate mt-0.5">{option.hint}</span>
                    )}
                  </span>
                  {option.count != null && (
                    <span className="text-xs tabular-nums text-gray-400 shrink-0">{option.count}</span>
                  )}
                  {option.value === value && <Check className="h-4 w-4 text-primary-600 shrink-0" />}
                </button>
              </li>
            ))}
          </ul>
        </BottomSheet>
      </>
    )
  }

  return (
    <div ref={wrapRef} className={clsx('relative min-w-0', className)}>
      {trigger}
      {open && (
        <ul
          id={menuId}
          role="listbox"
          aria-label={label}
          className={clsx(
            'absolute top-full mt-1 z-30 min-w-[10rem] max-h-72 overflow-y-auto py-1',
            'bg-white border border-gray-200 rounded-lg shadow-lg',
            'dark:bg-gray-800 dark:border-gray-700',
            align === 'right' ? 'right-0' : 'left-0',
          )}
        >
          {options.map(option => (
            <li key={option.value}>
              <button
                type="button"
                role="option"
                aria-selected={option.value === value}
                onClick={() => choose(option.value)}
                className="w-full flex items-center gap-2 px-3 py-1.5 text-left text-[12px] hover:bg-gray-50 dark:hover:bg-gray-700/60"
              >
                <span
                  className={clsx(
                    'flex-1 min-w-0 truncate',
                    option.value === value
                      ? 'font-semibold text-gray-900 dark:text-white'
                      : 'text-gray-600 dark:text-gray-300',
                  )}
                >
                  {option.label}
                </span>
                {option.count != null && (
                  <span className="text-[10px] tabular-nums text-gray-400 shrink-0">{option.count}</span>
                )}
                {option.value === value && <Check className="h-3.5 w-3.5 text-primary-600 shrink-0" />}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
