/**
 * Dialog — the modal behaviour every modal in this codebase is missing.
 *
 * ── Why this exists rather than reusing something ────────────────────────
 *
 * There is no accessible dialog primitive here, and no dialog library in
 * `package.json`. There are roughly forty hand-rolled modals. The closest
 * thing to a shared one is `ui/ConfirmDialog`, with fifteen importers, and
 * it has none of the following:
 *
 *   - no `role="dialog"` and no `aria-modal`, so it is not announced as a
 *     dialog and the page behind it is not implicitly removed from the
 *     reading order;
 *   - no `aria-labelledby`, so it has no accessible name;
 *   - no Escape handler;
 *   - no focus management: focus stays on whatever opened it, so a keyboard
 *     user has to Tab through the whole page behind to reach the buttons;
 *   - no focus restoration on close, so the next Tab starts from the top of
 *     the document;
 *   - no focus trap, so Tab walks straight out of the modal and into the
 *     page it is covering;
 *   - an unlabelled close button, announced as just "button";
 *   - and `message: string`, so it cannot hold a form at all.
 *
 * So "use the existing primitive" was not available: adopting ConfirmDialog
 * would have been a net accessibility regression over the hand-rolled
 * behaviour it replaced. This is the primitive that was missing.
 *
 * ── Deliberately not retrofitted ─────────────────────────────────────────
 *
 * The other modals are left alone. Rewriting forty surfaces to adopt this is
 * a change nobody can review in one piece, and each one would need its own
 * verification. This ships with one caller; adopting it elsewhere is a
 * separate, per-surface change.
 *
 * ── Mount to open ────────────────────────────────────────────────────────
 *
 * There is no `open` prop. The caller renders it when it should be open and
 * unmounts it to close, which is what makes the focus effects run exactly
 * once per opening rather than on a prop change, and what guarantees a fresh
 * dialog has fresh state.
 */

import { useCallback, useEffect, useRef } from 'react'

/**
 * What can hold focus inside the panel.
 *
 * `[tabindex="-1"]` is excluded, which is what keeps a honeypot field out of
 * the tab order while leaving it in the DOM for spam filtering.
 */
const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

interface DialogProps {
  /** The id of the element naming the dialog. Required: a dialog with no
   *  accessible name is announced as just "dialog". */
  labelledBy: string
  /** The id of a short description, if there is one. */
  describedBy?: string
  onClose: () => void
  /** Where focus goes on open. Without it, focus goes to the first focusable
   *  element, which for a form panel is usually the close button rather than
   *  the first field. */
  initialFocusRef?: React.RefObject<HTMLElement | null>
  /** Classes for the panel. The overlay is the primitive's; the panel's look
   *  belongs to the caller, because a dialog over a dark marketing page and
   *  one over a light app page are not the same surface. */
  panelClassName?: string
  /** Classes for the overlay, for the backdrop tint and the panel's position. */
  overlayClassName?: string
  'data-testid'?: string
  children: React.ReactNode
}

export function Dialog({
  labelledBy,
  describedBy,
  onClose,
  initialFocusRef,
  panelClassName = '',
  overlayClassName = '',
  children,
  ...rest
}: DialogProps) {
  const panelRef = useRef<HTMLDivElement>(null)

  /*
   * Focus in on open, focus back on close, and the page behind held still.
   *
   * The restore matters as much as the move in: without it, closing leaves
   * focus on `document.body` and the next Tab starts again from the top of
   * the page, which on a long page is indistinguishable from the control
   * having done nothing.
   */
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null
    const target =
      initialFocusRef?.current ??
      panelRef.current?.querySelector<HTMLElement>(FOCUSABLE) ??
      panelRef.current
    target?.focus?.()

    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    return () => {
      document.body.style.overflow = previousOverflow
      opener?.focus?.()
    }
    // Intentionally once per mount: see the file header on mount-to-open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /**
   * Escape closes, and Tab cycles within the panel.
   *
   * The trap is what `aria-modal` promises and markup alone cannot deliver.
   * `aria-modal="true"` tells a screen reader the rest of the page is
   * inert; it does nothing to the tab order, so without this a keyboard
   * user Tabs out of the dialog into the page behind it and has no way back
   * except Shift+Tab through everything they passed.
   */
  const onKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation()
        onClose()
        return
      }
      if (event.key !== 'Tab') return

      const focusable = [...(panelRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])]
        /*
         * Attribute-based, deliberately, not `offsetParent !== null`.
         *
         * jsdom performs no layout, so `offsetParent` is null for every
         * element in it. A visibility filter written that way drops the whole
         * list in a test run, leaving the trap doing nothing while every case
         * still passes: the cycle collapses to one element and wrapping to
         * "the only element" looks correct. The browser would behave
         * differently from the suite, which is the worst of both.
         *
         * `hidden` and an `aria-hidden` ancestor are both readable without
         * layout, so this rule means the same thing in jsdom and in Chrome.
         * A control hidden purely by CSS cannot be detected without layout;
         * nothing here is, and the browser pass is the backstop.
         */
        .filter(el => !el.hasAttribute('hidden') && !el.closest('[aria-hidden="true"]'))
      if (focusable.length === 0) return

      /*
       * Every Tab is handled, not only the ones at the boundaries.
       *
       * Wrapping at the ends and letting the browser handle the middle looks
       * equivalent and is not. A control inside an `aria-hidden` subtree is
       * still natively focusable, so the native tab order walks onto it even
       * though it is excluded from the list above, and focus lands on
       * something a screen reader has been told does not exist. The first
       * version of this file did exactly that and a test caught it: three
       * Tabs around a two-control cycle ended up one position out.
       *
       * Driving every Tab from the filtered list makes the cycle the list,
       * which is the only way the two agree.
       */
      event.preventDefault()
      const active = document.activeElement as HTMLElement | null
      const current = active ? focusable.indexOf(active) : -1
      const step = event.shiftKey ? -1 : 1
      // -1, meaning focus is on the panel itself, enters at the first control
      // going forward and at the last going backward.
      const next =
        current === -1
          ? (event.shiftKey ? focusable.length - 1 : 0)
          : (current + step + focusable.length) % focusable.length
      focusable[next].focus()
    },
    [onClose],
  )

  return (
    <div
      className={overlayClassName}
      onKeyDown={onKeyDown}
      /*
       * mousedown, not click: a click whose press started inside the panel
       * and whose release landed on the overlay, which is what a drag-select
       * across a text field does, has the overlay as its click target and
       * would close a dialog the person was typing in.
       */
      onMouseDown={event => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        aria-describedby={describedBy}
        tabIndex={-1}
        className={panelClassName}
        {...rest}
      >
        {children}
      </div>
    </div>
  )
}

export default Dialog
