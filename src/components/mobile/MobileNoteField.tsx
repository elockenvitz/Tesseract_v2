import { useCallback, useEffect, useLayoutEffect, useRef, type ReactNode } from 'react'

/**
 * A full-width note field for a phone, with its actions kept on screen.
 *
 * ── Why a textarea that grows ─────────────────────────────────────────────
 *
 * A one-line input truncates its placeholder and every line typed after the
 * first, and a fixed three-row box turns a long rationale into a box that
 * scrolls inside a page that also scrolls. This starts at a readable few lines
 * and grows with the text instead, so the page is the only thing that scrolls.
 *
 * ── Why it scrolls its own footer ─────────────────────────────────────────
 *
 * Opening the keyboard shrinks the visual viewport and the browser keeps the
 * caret visible, not the Save button under the field. So on focus, and
 * whenever the visual viewport resizes while focused, the actions row is
 * brought into view — `block: 'nearest'`, so nothing moves when they already
 * are.
 *
 * Font size is left to the phone base layer, which pins inputs to 16px so iOS
 * does not zoom on focus.
 */
export function MobileNoteField({
  value,
  onChange,
  placeholder,
  minRows = 4,
  autoFocus = false,
  disabled = false,
  onSubmitShortcut,
  onEscape,
  actions,
  inputClassName = '',
  ariaLabel,
  dataSlot,
}: {
  value: string
  onChange: (next: string) => void
  placeholder: string
  minRows?: number
  autoFocus?: boolean
  disabled?: boolean
  /** Ctrl/Cmd+Enter, for a hardware keyboard. Enter alone adds a line. */
  onSubmitShortcut?: () => void
  onEscape?: () => void
  /** The actions row under the field. */
  actions: ReactNode
  inputClassName?: string
  ariaLabel?: string
  dataSlot?: string
}) {
  const areaRef = useRef<HTMLTextAreaElement>(null)
  const actionsRef = useRef<HTMLDivElement>(null)

  // Grow to fit. Reset first so it can also shrink when text is deleted.
  useLayoutEffect(() => {
    const el = areaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  }, [value])

  const revealActions = useCallback(() => {
    actionsRef.current?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' })
  }, [])

  useEffect(() => {
    const viewport = typeof window !== 'undefined' ? window.visualViewport : null
    if (!viewport) return
    const onResize = () => {
      if (document.activeElement === areaRef.current) revealActions()
    }
    viewport.addEventListener('resize', onResize)
    return () => viewport.removeEventListener('resize', onResize)
  }, [revealActions])

  return (
    <div data-slot={dataSlot} className="w-full min-w-0">
      <textarea
        ref={areaRef}
        value={value}
        onChange={e => onChange(e.target.value)}
        onFocus={() => requestAnimationFrame(revealActions)}
        onKeyDown={e => {
          if ((e.ctrlKey || e.metaKey) && e.key === 'Enter' && onSubmitShortcut) { e.preventDefault(); onSubmitShortcut() }
          if (e.key === 'Escape' && onEscape) onEscape()
        }}
        rows={minRows}
        autoFocus={autoFocus}
        disabled={disabled}
        placeholder={placeholder}
        aria-label={ariaLabel ?? placeholder}
        className={`block w-full min-w-0 resize-none overflow-hidden rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-2.5 leading-relaxed text-gray-900 dark:text-gray-100 placeholder:text-gray-400 dark:placeholder:text-gray-500 focus:outline-none focus:ring-2 ${inputClassName}`}
      />
      <div ref={actionsRef} className="mt-2 flex items-stretch gap-2">
        {actions}
      </div>
    </div>
  )
}
