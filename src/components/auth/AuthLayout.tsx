import React, { useEffect } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import { hideBootLoader } from '../../lib/boot-loader'
import { LegalFooter } from '../legal/LegalFooter'
import { TesseractLogo } from '../ui/TesseractLogo'

interface AuthLayoutProps {
  children: React.ReactNode
  title: string
  subtitle?: string
}

/**
 * The five stages the public site names, in the order it names them.
 *
 * Here as continuity rather than as a feature list: somebody arriving from a
 * recovery link in an email has not necessarily seen the marketing site, and
 * somebody who has should recognise where they have landed.
 */
const LIFECYCLE = ['Research', 'Develop', 'Recommend', 'Decide', 'Review']

/**
 * The shell behind every authentication screen.
 *
 * ── Why this file carries the brand, and the six pages do not ────────────
 *
 * Login, Signup, Reset Password, Update Password, the SSO callback and the
 * invitation screen all render through here. Before this change the shell was
 * a centred card on `bg-gray-50` beneath `/Tesseract Logo.png`, a yellow
 * wordmark that appears nowhere else in the product, while the public site is
 * near-black with the geometric mark and a single blue accent. Signing in
 * looked like arriving at a different company's software.
 *
 * So the continuity lives in the shell, and the six pages keep passing the
 * same `children`, `title` and `subtitle` they always did. Not one of them was
 * edited for this, which is the point: the next auth page inherits the brand
 * without having to know it exists.
 *
 * ── The split, and why the form column stayed light ──────────────────────
 *
 * Dark brand panel on the left, light form column on the right. The forms
 * inside `children` are built from the app-wide `Input` and `Button`
 * primitives, which are used on roughly three hundred other surfaces. Making
 * the form dark would have meant theming those primitives or overriding them
 * field by field, and a contrast regression inside a password box is a poor
 * trade for a background colour. The panel carries the brand; the form stays
 * the most legible thing on the screen.
 *
 * Below `lg` the panel is not rendered at all and the form fills the viewport,
 * because a phone opening a recovery link should land on the form rather than
 * scroll past a hero to reach it.
 */
export function AuthLayout({ children, title, subtitle }: AuthLayoutProps) {
  /*
   * Every auth page is real content, so fade the boot loader here.
   *
   * `#tesseract-boot-loader` is painted by index.html at
   * `z-index: 2147483647`, `inset: 0`, `opacity: 1`, and only stops covering
   * the page — and only stops swallowing clicks, since `pointer-events: none`
   * lives in `.is-fading` — once something calls `hideBootLoader()`.
   *
   * It was called per page, and three of the six pages using this layout did
   * not: Update Password, Reset Password and the SSO callback. Nothing else
   * covers them, because they are PUBLIC routes and `ProtectedRoute` — the
   * other caller — never runs for them.
   *
   * In-app navigation hid the defect completely: arriving from `/login`, the
   * loader had already been faded by `LoginPage` and a client-side route
   * change never re-shows it. Only a COLD load breaks, which is exactly what
   * clicking a link in an email is. A pilot user clicking their recovery link
   * reached a correctly-rendered "Set your new password" form and saw
   * "Loading…" over it indefinitely; production shows the recovery token
   * consumed and the password never changed.
   *
   * Here rather than in the three pages, so the next auth page cannot
   * reintroduce it. Idempotent — the existing per-page calls are left alone
   * and fading twice is a no-op.
   */
  useEffect(() => { hideBootLoader() }, [])

  return (
    <div className="min-h-screen bg-[#050710] lg:grid lg:grid-cols-[1.05fr_1fr]">
      {/* ── Brand panel ───────────────────────────────────────────────────
          `hidden lg:flex`, so a phone never pays for it in layout or in paint. */}
      <aside
        className="relative hidden overflow-hidden lg:flex lg:flex-col lg:justify-between lg:p-12 xl:p-16"
        data-testid="auth-brand-panel"
      >
        {/* One soft light source in the upper right, where the landing page
            puts its own. Deliberately not animated: this screen is a doorway,
            and a moving background behind a password field is noise. */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              'radial-gradient(120% 90% at 92% 8%, rgba(99,102,241,0.14), rgba(5,7,16,0) 58%)',
          }}
        />
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-y-0 right-0 w-px bg-gradient-to-b from-transparent via-white/10 to-transparent"
        />

        {/*
          A LINK, not a decoration. Before this, the shell was a dead end: a
          visitor who clicked Sign in from the landing page had no control
          anywhere on the screen that went back to it, and the browser's own
          Back button was the only way out. The lockup is the control people
          try first, so it is the one that has to work.
        */}
        <Link
          to="/"
          className="relative inline-flex items-center gap-3 rounded-lg text-white transition hover:opacity-80 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-primary-400"
        >
          <TesseractLogo size={40} />
          <span className="text-[18px] font-semibold tracking-[-0.015em]">Tesseract</span>
        </Link>

        <div className="relative max-w-xl">
          <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-primary-300/80">
            The decision operating system for investment teams
          </p>
          <p className="mt-6 text-[32px] font-semibold leading-[1.18] tracking-[-0.02em] text-white xl:text-[38px]">
            Every investment decision has a story.
            <span className="block text-slate-400">Make sure your firm remembers it.</span>
          </p>
          {/* The same five things the landing hero names, in the same order,
              so the two pages do not describe the product differently. */}
          <p className="mt-6 max-w-md text-[15px] leading-relaxed text-slate-400">
            Research, ideas, recommendations, decisions and outcome reviews stay
            linked as one record, so a year from now your firm can still see why
            it acted.
          </p>
        </div>

        <div className="relative">
          <ul
            className="flex flex-wrap items-center gap-x-2 gap-y-2"
            aria-label="The decision lifecycle"
          >
            {LIFECYCLE.map((stage, i) => (
              <li key={stage} className="flex items-center gap-2">
                <span className="rounded-md bg-white/[0.04] px-2.5 py-1 text-[12px] font-medium text-slate-300 ring-1 ring-inset ring-white/10">
                  {stage}
                </span>
                {i < LIFECYCLE.length - 1 && (
                  <span aria-hidden="true" className="text-slate-600">
                    /
                  </span>
                )}
              </li>
            ))}
          </ul>
          {/*
            The not-an-adviser disclaimer is deliberately NOT repeated here.
            `LegalFooter` in the form column already carries it, and at
            1440x900 both were on screen at once, twenty lines apart, which
            reads as a page that lost track of what it had already said. One
            statement, in the component that owns it.
          */}
        </div>
      </aside>

      {/* ── Form column ───────────────────────────────────────────────────
          Carries its own `min-h-screen` so it still fills the viewport below
          `lg`, where the grid collapses and this is the only column. */}
      <main className="relative flex min-h-screen flex-col justify-center overflow-hidden bg-gray-50 px-6 py-12 dark:bg-gray-900 sm:px-10">
        {/*
          A brand wash, so the light column is recognisably the same product as
          the dark panel rather than a bare grey field beside it. Decorative and
          `pointer-events-none`, so it can never intercept a click on the form.
        */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 bg-[radial-gradient(85%_55%_at_50%_0%,rgba(37,99,235,0.08),rgba(255,255,255,0)_70%)] dark:bg-[radial-gradient(85%_55%_at_50%_0%,rgba(59,130,246,0.10),rgba(0,0,0,0)_70%)]"
        />

        <div className="relative mx-auto w-full max-w-[400px]">
          {/*
            The mark shows at EVERY width, not just below `lg`. On the wide
            layout it previously lived only in the dark panel, which put it
            diagonally opposite the form: the half of the screen a person is
            actually using carried no mark at all.

            Both this and the panel lockup go home, so there is a way back from
            the split layout at every viewport.
          */}
          <div className="mb-7 flex items-center justify-between gap-4">
            <Link
              to="/"
              aria-label="Tesseract home"
              className="flex items-center gap-2.5 rounded-lg transition hover:opacity-80 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-primary-500"
            >
              <TesseractLogo size={30} />
              <span className="text-[16px] font-semibold tracking-[-0.015em] text-gray-900 dark:text-white">
                Tesseract
              </span>
            </Link>

            <Link
              to="/"
              className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-2 text-[13px] font-medium text-gray-500 transition hover:bg-white hover:text-primary-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-500 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-primary-300"
            >
              <ArrowLeft size={14} aria-hidden="true" />
              Back to site
            </Link>
          </div>

          {/*
            The form sits on its own raised surface now. On a flat grey column
            nothing said where the thing you have to fill in begins and the
            page ends.
          */}
          <div className="rounded-2xl border border-gray-200/90 bg-white p-6 shadow-[0_1px_2px_rgba(16,24,40,0.04),0_8px_24px_-12px_rgba(16,24,40,0.12)] dark:border-gray-800 dark:bg-gray-950/60 sm:p-7">
            <h1 className="text-2xl font-semibold tracking-[-0.015em] text-gray-900 dark:text-white">
              {title}
            </h1>
            {subtitle && (
              <p className="mt-2 text-sm leading-relaxed text-gray-600 dark:text-gray-400">
                {subtitle}
              </p>
            )}

            <div className="mt-7">{children}</div>
          </div>

          {/*
            Here rather than in each of the six pages using this layout, for the
            same reason hideBootLoader() moved here: three of the six forgot it.
            A legal link missing from one auth page is the same class of defect
            and harder to notice, because nothing looks broken.
          */}
          <LegalFooter className="mt-10" />
        </div>
      </main>
    </div>
  )
}
