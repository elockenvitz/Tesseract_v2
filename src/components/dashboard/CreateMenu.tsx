/**
 * Make something from the object you are looking at.
 *
 * ── One control, two depths ──────────────────────────────────────────────
 *
 * The same component sits in the card's action row and in the workbench's,
 * so the two surfaces offer creation in one language rather than each growing
 * its own. What differs between them is only what the object supports and what
 * the reader reached for, which `createActionsFor` decides.
 *
 * ── What it does not do ──────────────────────────────────────────────────
 *
 * It does not create anything itself. Every entry opens the product's existing
 * capture sidebar on an existing form, with the asset already bound — the same
 * event `OPEN_ASSET_CREATE_IDEA` has always dispatched. There is no new form,
 * no new object type, and no modal of its own to keep in sync.
 */

import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { clsx } from 'clsx'
import { Plus } from 'lucide-react'
import {
  createActionsFor, openCreate, type CreateContext,
} from '../../lib/today/create-actions'
import type { FocusIntent } from '../../lib/dashboard/focus'

export function CreateMenu({
  context, intent = 'overview', compact,
}: {
  context: CreateContext
  intent?: FocusIntent
  compact?: boolean
}) {
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLDivElement | null>(null)

  /*
   * The menu is rendered into the document, not into the card.
   *
   * ── The bug this fixes ───────────────────────────────────────────────────
   *
   * Every card in the product is `overflow-hidden` -- it has to be, to clip
   * its own rounded corners -- and this dropdown was an absolutely positioned
   * child of one. Measured: a 155px menu with 25px visible on Ideas and 15px
   * on Today, the other 140px cut off at the card's edge. It shipped in two
   * stages looking, to a user, simply broken.
   *
   * It survived because the tests asked whether the menu was in the DOM. It
   * always was. Nothing asked whether any of it could be seen, and a clipped
   * element reports its full height to `getBoundingClientRect` regardless.
   *
   * A portal escapes every ancestor's overflow, so the fix cannot be undone by
   * a card somewhere else deciding to clip. The position is measured from the
   * trigger once per open -- there is no reflow loop, and the menu closes on
   * scroll rather than trying to follow it.
   */
  const trigger = useRef<HTMLButtonElement | null>(null)
  const [at, setAt] = useState<{ top: number; right: number } | null>(null)

  useLayoutEffect(() => {
    if (!open || !trigger.current) return
    const r = trigger.current.getBoundingClientRect()
    setAt({ top: r.bottom + 4, right: Math.max(8, window.innerWidth - r.right) })
  }, [open])

  useEffect(() => {
    if (!open) return
    const close = () => setOpen(false)
    // Capture phase: a scroll inside the card's own scroller still counts.
    window.addEventListener('scroll', close, true)
    window.addEventListener('resize', close)
    return () => {
      window.removeEventListener('scroll', close, true)
      window.removeEventListener('resize', close)
    }
  }, [open])

  const actions = createActionsFor(context, intent)

  /*
   * Dismiss on an outside press or Escape.
   *
   * `pointerdown` rather than `click`: a click that opens something else
   * should not have to travel through a menu that is still mounted, and a
   * pointerdown outside is unambiguously a decision to leave.
   */
  useEffect(() => {
    if (!open) return
    const away = (e: PointerEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false)
    }
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('pointerdown', away)
    document.addEventListener('keydown', esc)
    return () => {
      document.removeEventListener('pointerdown', away)
      document.removeEventListener('keydown', esc)
    }
  }, [open])

  // Nothing can be made from an object with no asset behind it, and a menu
  // that opens onto nothing is worse than no menu.
  if (!actions.length) return null

  return (
    <div className="relative" ref={box} data-no-portal>
      <button
        type="button"
        data-testid="create-menu"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Create from this object"
        ref={trigger}
        onClick={e => { e.stopPropagation(); setOpen(o => !o) }}
        className={clsx(
          'inline-flex items-center gap-1 rounded-md border border-gray-200 font-semibold text-gray-700',
          'transition-colors hover:bg-gray-50 focus-visible:outline focus-visible:outline-2',
          'focus-visible:outline-offset-1 focus-visible:outline-blue-600',
          'dark:border-white/15 dark:text-gray-200 dark:hover:bg-white/5',
          compact ? 'px-2 py-[3px] text-[12px]' : 'px-2.5 py-2 text-[12px]',
        )}
      >
        <Plus className="h-3.5 w-3.5" />
        Create
      </button>

      {open && at && createPortal(
        <div
          role="menu"
          data-testid="create-menu-list"
          data-no-portal
          onClick={e => e.stopPropagation()}
          style={{ top: at.top, right: at.right }}
          className="fixed z-[60] w-64 overflow-hidden rounded-lg border border-gray-300 bg-white shadow-lg dark:border-white/15 dark:bg-[#171e2b]"
        >
          {actions.map(a => (
            <button
              key={a.kind}
              type="button"
              role="menuitem"
              data-testid={`create-${a.kind}`}
              onClick={e => {
                e.stopPropagation()
                openCreate(a.kind, context)
                setOpen(false)
              }}
              className="block w-full px-3 py-2 text-left hover:bg-blue-50 focus-visible:bg-blue-50 focus-visible:outline-none dark:hover:bg-blue-950/30"
            >
              <span className="block text-[12px] font-medium text-gray-900 dark:text-gray-100">
                {a.label}
              </span>
              <span className="mt-0.5 block text-[10px] text-gray-500">{a.hint}</span>
            </button>
          ))}
        </div>,
        document.body,
      )}
    </div>
  )
}
