import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { clsx } from 'clsx'
import { ArrowLeft } from 'lucide-react'
import { GlobalSearch } from '../search/GlobalSearch'
import { ExploreResults } from './ExploreResults'

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
  const [query, setQuery] = useState('')

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

  // Focus the field as soon as it exists, rather than after a fixed delay.
  //
  // The old version waited 60ms and focused once. iOS only raises the keyboard
  // for a focus() it can attribute to the tap that caused it, and a timeout
  // long enough for React to paint is already too late — the field took focus
  // but no keyboard appeared, so the panel had to be tapped a second time to
  // type. Polling on animation frames focuses at the first frame the input is
  // mounted, which is inside the gesture's window.
  useEffect(() => {
    if (!open) return
    let frame = 0
    let cancelled = false

    const tryFocus = () => {
      if (cancelled) return
      const input = panelRef.current?.querySelector('input')
      if (input) {
        input.focus()
        // Safari occasionally restores a previous selection; putting the caret
        // at the end makes typing continue rather than overwrite.
        const end = input.value.length
        try { input.setSelectionRange(end, end) } catch { /* not all inputs support it */ }
        return
      }
      // Give up after ~1s rather than spinning forever if the field never
      // renders; a stuck rAF loop is worse than an unfocused input.
      if (frame++ < 60) requestAnimationFrame(tryFocus)
    }

    tryFocus()
    return () => { cancelled = true }
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
            placeholder="Search or explore a topic…"
            onQueryChange={setQuery}
            onSelectResult={result => {
              onClose()
              onSelectResult(result)
            }}
          />
        </div>
      </div>

      {/* GlobalSearch renders its own absolutely-positioned panel of object
          matches over the top of this area. Underneath it sits the topic feed:
          the same term searched against prose rather than names, so a keyword
          with no matching object still leads somewhere. */}
      <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain bg-white dark:bg-gray-900">
        <ExploreResults
          query={query}
          onSelect={result => {
            onClose()
            onSelectResult(result)
          }}
        />
      </div>
    </div>,
    document.body
  )
}
