/**
 * The frame both legal pages render inside, and the one place that fades the
 * boot loader for them.
 *
 * ── Why this file exists at all ──────────────────────────────────────────
 *
 * `#tesseract-boot-loader` is painted by index.html at
 * `z-index: 2147483647`, `inset: 0`, `opacity: 1`, and only stops covering the
 * page once something calls `hideBootLoader()`. Two callers exist:
 * `AuthLayout` and `ProtectedRoute`.
 *
 * Neither runs for `/legal`. These are PUBLIC routes outside the auth layout,
 * so the first version of these pages rendered correctly and sat invisible
 * under a full-screen "Loading…" for ever. Found by opening the page in a
 * browser; no test caught it, because jsdom has no index.html and therefore no
 * boot loader to be covered by.
 *
 * That is precisely the defect `AuthLayout`'s own comment records: three of
 * the six pages using it had forgotten the call, and the fix was to move it
 * somewhere a new page cannot miss. So the same shape here -- one shell, one
 * call -- rather than a `useEffect` copied into each page for the next one to
 * omit.
 *
 * ── Light palette only, deliberately ────────────────────────────────────
 *
 * `tailwind.config.js` sets `darkMode: 'class'`, and a signed-out visitor has
 * no theme class on the document, so every `dark:` variant on a public page is
 * dead code that reads as support for something that does not work. These
 * pages commit to one palette, which is the conclusion the public landing page
 * reached too.
 */

import { useEffect } from 'react'
import { hideBootLoader } from '../../lib/boot-loader'

interface LegalPageShellProps {
  children: React.ReactNode
}

export function LegalPageShell({ children }: LegalPageShellProps) {
  // Idempotent: fading twice is a no-op, so this is safe alongside the
  // existing callers if a reader navigates in from a signed-in surface.
  useEffect(() => { hideBootLoader() }, [])

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900" data-testid="legal-page-shell">
      <div className="mx-auto max-w-3xl px-4 py-12 sm:px-6 lg:px-8">{children}</div>
    </div>
  )
}

/**
 * The Suspense fallback for the lazily-loaded legal routes.
 *
 * Lives here rather than in App.tsx so that it fades the boot loader too. The
 * pages are a lazy chunk, so the fallback is what a visitor sees first, and if
 * the chunk fails to load it is what they see permanently -- under a
 * full-screen boot loader, if this did not make the same call.
 *
 * Plain text rather than `TesseractLoader`: these pages are read by someone
 * probably not signed in and possibly on a slow connection, and a full-screen
 * animated mark for a small chunk is heavier than the wait it covers.
 */
export function LegalPageFallback() {
  useEffect(() => { hideBootLoader() }, [])

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="mx-auto max-w-3xl px-4 py-12 text-slate-500 sm:px-6 lg:px-8">
        Loading…
      </div>
    </div>
  )
}

export default LegalPageShell
