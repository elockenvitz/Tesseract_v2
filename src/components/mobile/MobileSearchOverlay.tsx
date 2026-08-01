import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { clsx } from 'clsx'
import { ArrowLeft } from 'lucide-react'
import { GlobalSearch } from '../search/GlobalSearch'

interface MobileSearchOverlayProps {
  open: boolean
  onClose: () => void
  onSelectResult: (result: any) => void
}

/**
 * Full-screen search for phones.
 *
 * The header cannot host a text input at this width: an `<input>` carries an
 * intrinsic min-content width from its default `size` attribute (~20
 * characters), which no amount of `flex-1 min-w-0` on the wrapper can shrink
 * past. That single element was holding the header row wider than the
 * viewport, truncating the placeholder and pushing the profile button
 * off-screen. Promoting search to its own surface removes the constraint
 * instead of fighting it, and gives results the full screen to render in.
 */
export function MobileSearchOverlay({ open, onClose, onSelectResult }: MobileSearchOverlayProps) {
  const panelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = previous
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [open, onClose])

  // Focus the search field once the panel is on screen. GlobalSearch owns its
  // own input ref, so reach for it through the DOM rather than threading a ref
  // through a shared component used on desktop too.
  useEffect(() => {
    if (!open) return
    const timer = setTimeout(() => {
      panelRef.current?.querySelector('input')?.focus()
    }, 60)
    return () => clearTimeout(timer)
  }, [open])

  if (!open || typeof document === 'undefined') return null

  return createPortal(
    <div
      ref={panelRef}
      role="dialog"
      aria-modal="true"
      aria-label="Search"
      className={clsx(
        'fixed inset-0 z-[80] flex flex-col',
        'bg-white dark:bg-gray-900'
      )}
    >
      <div className="flex items-center gap-2 px-2 h-16 pt-safe border-b border-gray-200 dark:border-gray-700">
        <button
          type="button"
          onClick={onClose}
          className="flex items-center justify-center h-11 w-11 flex-shrink-0 rounded-full text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800"
          aria-label="Close search"
        >
          <ArrowLeft className="h-5 w-5" />
        </button>
        <div className="flex-1 min-w-0">
          <GlobalSearch
            placeholder="Search…"
            onSelectResult={result => {
              onClose()
              onSelectResult(result)
            }}
          />
        </div>
      </div>

      {/* GlobalSearch renders its own absolutely-positioned results panel just
          below the field, so this area is intentionally empty — it exists to
          paint the rest of the screen in the surface colour rather than
          letting the app show through behind the results. */}
      <div className="flex-1 bg-white dark:bg-gray-900" />
    </div>,
    document.body
  )
}
