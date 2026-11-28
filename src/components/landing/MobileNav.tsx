/**
 * The navigation a phone and a tablet get.
 *
 * ── The deficiency this closes ───────────────────────────────────────────
 *
 * Below `lg` the header collapsed to the mark and Sign in. Every section
 * link disappeared, which on a page roughly 21,000px tall on a phone means
 * the only way to reach the trust section is to scroll past everything in
 * front of it. The primary action was not in the header either: a visitor
 * who decided they were interested halfway down found a login link.
 *
 * ── Why a disclosure and not a drawer ────────────────────────────────────
 *
 * A full-screen drawer needs a scroll lock, and this page's scroll
 * behaviour is already load-bearing: `data-public-scroll` exists because
 * the app shell's mobile CSS froze the public page at one screen, and that
 * shipped. A panel that hangs off the sticky header needs none of that
 * machinery, so it cannot reintroduce the bug.
 *
 * ── What is deliberate in here ───────────────────────────────────────────
 *
 *   ACCESSIBILITY. The button is a real `aria-expanded` disclosure naming
 *   the panel it controls. Opening moves focus to the first item, Escape
 *   closes and hands focus back to the button, Tab cycles inside the panel
 *   while it is open, and choosing anything closes it. A click anywhere
 *   outside dismisses it.
 *
 *   TOUCH TARGETS. Every row is at least 48px tall. The repo's gate floor
 *   is 24px and that is a floor, not a target; a navigation list is the
 *   one place on a phone where a cramped row is felt immediately.
 *
 *   MOTION. A CSS transition on opacity and translation, never a keyframe
 *   animation, and `motion-reduce` turns it off. The page asserts it
 *   contributes no stylesheet and no inline animation of its own, and this
 *   stays inside that rule.
 */
import { useEffect, useId, useRef, useState } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent, ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { Menu, X } from 'lucide-react'

const ROW =
  'flex min-h-[48px] items-center rounded-lg px-3 text-[17px] font-medium text-slate-300 transition-colors hover:bg-white/[0.04] hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-300'

export function MobileNav({
  items,
  cta,
}: {
  items: readonly (readonly [string, string])[]
  cta: ReactNode
}) {
  const [open, setOpen] = useState(false)
  const panelId = useId()
  const buttonRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)

  const close = (returnFocus: boolean) => {
    setOpen(false)
    if (returnFocus) buttonRef.current?.focus()
  }

  /* Focus the first item when the panel opens, so a keyboard user is
     inside it rather than still on the button with the list below them. */
  useEffect(() => {
    if (!open) return
    panelRef.current?.querySelector<HTMLElement>('a, button')?.focus()
  }, [open])

  /* Escape anywhere, and a pointer anywhere outside the panel or the
     button. Both are registered only while the panel is open, so the page
     carries no listeners when it is shut. */
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        close(true)
      }
    }
    const onPointer = (e: MouseEvent) => {
      const t = e.target as Node
      if (panelRef.current?.contains(t) || buttonRef.current?.contains(t)) return
      setOpen(false)
    }
    document.addEventListener('keydown', onKey)
    document.addEventListener('mousedown', onPointer)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('mousedown', onPointer)
    }
  }, [open])

  /* Tab cycles within the panel. Not a library trap: this is one short
     list with no nested widgets, and the whole behaviour is the two edges. */
  const onPanelKeyDown = (e: ReactKeyboardEvent) => {
    if (e.key !== 'Tab') return
    const focusable = [...(panelRef.current?.querySelectorAll<HTMLElement>('a, button') ?? [])]
    if (focusable.length === 0) return
    const first = focusable[0]
    const last = focusable[focusable.length - 1]
    if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault()
      first.focus()
    } else if (e.shiftKey && document.activeElement === first) {
      e.preventDefault()
      last.focus()
    }
  }

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        aria-label={open ? 'Close main menu' : 'Open main menu'}
        onClick={() => setOpen(v => !v)}
        className="inline-flex size-11 items-center justify-center rounded-lg text-slate-300 transition-colors hover:bg-white/[0.05] hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-300 lg:hidden"
      >
        {open ? (
          <X className="size-5" aria-hidden="true" />
        ) : (
          <Menu className="size-5" aria-hidden="true" />
        )}
      </button>

      {/*
        Always rendered, so the transition has something to run on and so
        the control it names exists for assistive technology whether or not
        it is open. `invisible` rather than `hidden` keeps it out of the tab
        order while shut without removing it from the accessibility tree's
        relationship with the button.
      */}
      <div
        id={panelId}
        ref={panelRef}
        onKeyDown={onPanelKeyDown}
        /*
          OPAQUE, and the first version was not. `bg-[#050710]/95` plus a
          backdrop blur is the header's own treatment and it is right
          there, because the header is a thin bar over a dark page. A
          panel is 490px of menu sitting directly on top of the hero, and
          at 95% the headline behind it was legible THROUGH the items:
          "Who it's for" was printed across "Every investment decision has
          a story." Verified in a real browser at 390x844, which is the
          only place this is visible at all.
        */
        className={`absolute inset-x-0 top-full origin-top border-b border-white/[0.08] bg-[#050710] shadow-2xl shadow-black/60 transition duration-150 ease-out motion-reduce:transition-none lg:hidden ${
          open
            ? 'visible translate-y-0 opacity-100'
            : 'invisible pointer-events-none -translate-y-1 opacity-0'
        }`}
      >
        <nav aria-label="Sections" className="px-4 py-4 sm:px-6">
          <ul className="space-y-0.5">
            {items.map(([href, label]) => (
              <li key={href}>
                <a
                  href={href}
                  tabIndex={open ? 0 : -1}
                  onClick={() => close(false)}
                  className={ROW}
                >
                  {label}
                </a>
              </li>
            ))}
          </ul>

          <div className="mt-4 flex flex-col gap-2 border-t border-white/[0.08] pt-4">
            <Link to="/login" tabIndex={open ? 0 : -1} onClick={() => close(false)} className={ROW}>
              Sign in
            </Link>
            {/* The primary action, last and loudest, which is the one
                ordering that makes sense on a phone: the reader has just
                read the section list and this is what to do about it.
                Rendered bare rather than wrapped in a click handler: the
                CTA opens a dialog or leaves the page, and a wrapper div
                carrying onClick is a control that no keyboard can reach. */}
            {cta}
          </div>
        </nav>
      </div>
    </>
  )
}
