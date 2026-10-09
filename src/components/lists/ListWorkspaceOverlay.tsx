/**
 * The maximized contextual workspace — a shell, never a second workspace.
 *
 * ── What this deliberately is not ─────────────────────────────────────────
 *
 * It is not an Asset Page, and it does not contain a single line of
 * investment logic. The thing inside it is the SAME `ListRowExpansion` that
 * was in the row a frame ago, moved here by `createPortal` rather than
 * re-mounted: identical modes, identical data hooks, identical canonical
 * actions, identical permissions. A second implementation of the five modes
 * would drift on precisely the details that are hardest to see and most
 * expensive to get wrong — which mode a column opens, which decision handoff
 * a PM is allowed, what the panel refuses to say when a lookback is short.
 *
 * ── What survives the transition, and what does not ───────────────────────
 *
 * The expansion is re-parented into this overlay, which puts it at a greater
 * depth in the element tree — and React remounts across a depth change, which
 * a portal does not prevent. So anything held in the expansion's own state is
 * discarded on maximize. That was measured, not assumed: the chart's range
 * silently snapped back from 6M to 1Y on the first working build.
 *
 * What the reader must not lose therefore lives ABOVE the remount, in
 * `ListTableView`: the security (it is the open row), and the mode (see
 * `ModeOverride`, hoisted for exactly this reason). The chart's range and
 * zoom do reset, which is a visible and acceptable cost — the maximized chart
 * is a different size and its range chips are right there.
 *
 * The LIST is untouched either way. The row underneath stays expanded and
 * keeps its height behind a placeholder, so restoring puts everything back as
 * it was: same preset, same filters, same cell selection, same scroll offset.
 */

import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'

export function ListWorkspaceOverlay({
  label, onClose, children,
}: {
  /** Names the dialog for a screen reader — the security, usually. */
  label: string
  onClose: () => void
  children: React.ReactNode
}) {
  const panelRef = useRef<HTMLDivElement | null>(null)

  /*
   * Going away means restored, however it happened.
   *
   * The table owns the maximized row id, and the row can disappear from under
   * this overlay without the overlay being told: the reader changes preset,
   * sorts, or filters the name out. Without this the id would survive the row
   * and the security would silently reopen maximized the next time it was
   * expanded — a modal nobody asked for. Idempotent: on an ordinary restore
   * the id is already null.
   *
   * ── Why the unmount is confirmed on a later tick ─────────────────────────
   *
   * A bare cleanup is wrong here, and visibly so: React's StrictMode mounts
   * every component, unmounts it, and mounts it again. The first synthetic
   * unmount called `onClose`, which cleared the id, which unmounted the
   * overlay for real — so in development the workspace closed in the same
   * frame it opened and never appeared at all. Observed in the running app.
   *
   * A remount sets `alive` back to true before the deferred check runs, so
   * the double-invoke is absorbed; a real unmount leaves it false.
   */
  const closeRef = useRef(onClose)
  closeRef.current = onClose
  const alive = useRef(false)
  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
      const t = setTimeout(() => { if (!alive.current) closeRef.current() }, 0)
      // Cleared by the next mount's own cleanup chain if one arrives first.
      queueMicrotask(() => { if (alive.current) clearTimeout(t) })
    }
  }, [])

  /*
   * Escape restores, and it does so in the CAPTURE phase.
   *
   * `AssetTableView` has its own window-level Escape handler that collapses
   * the expanded row. Without capturing first, one Escape would both restore
   * the workspace and close the row underneath it — the reader would lose the
   * security they were looking at as the price of making the panel smaller.
   * Capturing and stopping propagation makes Escape mean exactly one thing at
   * a time: restore while maximized, collapse once restored.
   *
   * The page behind also stops scrolling. The list is still mounted under
   * this, and a wheel gesture that misses the panel would otherwise move the
   * row the reader is about to come back to.
   */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.preventDefault()
      e.stopPropagation()
      onClose()
    }
    window.addEventListener('keydown', onKey, true)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey, true)
      document.body.style.overflow = prev
    }
  }, [onClose])

  /*
   * Focus moves in, and the browser's own focus restoration puts it back.
   *
   * On open, focus goes to the panel itself rather than to the first control:
   * the reader asked for more room to look at something, not to be dropped
   * onto a button. It is `tabIndex={-1}` so it can receive focus
   * programmatically without joining the tab order.
   *
   * On close, focus returns to whatever had it when this opened — the
   * maximize control, which is now the restore control in the row.
   */
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    panelRef.current?.focus({ preventScroll: true })
    return () => previous?.focus?.({ preventScroll: true })
  }, [])

  /*
   * Tab is trapped. A dialog whose tab order walks out into the table behind
   * it is a dialog a keyboard reader cannot tell they have left.
   */
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== 'Tab') return
    const root = panelRef.current
    if (!root) return
    const focusable = [...root.querySelectorAll<HTMLElement>(
      'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])',
    )].filter(el => el.offsetParent !== null || el === document.activeElement)
    if (focusable.length === 0) return
    const first = focusable[0]
    const last = focusable[focusable.length - 1]
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault()
      last.focus()
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault()
      first.focus()
    }
  }

  return createPortal(
    <div
      data-testid="list-workspace-overlay"
      className="fixed inset-0 z-50 flex flex-col bg-gray-900/25 p-4 backdrop-blur-[1px] dark:bg-black/50 motion-safe:animate-in motion-safe:fade-in motion-safe:duration-120"
      /* The scrim restores too — the standard affordance, and the reader's
         first instinct when a panel covers what they were reading. */
      onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={`${label} workspace`}
        tabIndex={-1}
        onKeyDown={onKeyDown}
        className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl bg-[rgb(250_251_253)] shadow-[0_24px_60px_-12px_rgba(15,23,42,0.35)] ring-1 ring-gray-900/10 focus:outline-none dark:bg-[rgb(15_20_30)] dark:ring-white/10"
      >
        {children}
      </div>
    </div>,
    document.body,
  )
}
