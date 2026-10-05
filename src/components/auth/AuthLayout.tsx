import React, { useEffect } from 'react'
import { Card } from '../ui/Card'
import { hideBootLoader } from '../../lib/boot-loader'

interface AuthLayoutProps {
  children: React.ReactNode
  title: string
  subtitle?: string
}

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
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex flex-col justify-center py-12 px-4 sm:px-6 lg:px-8">
      <div className="sm:mx-auto sm:w-full sm:max-w-md">
        <div className="text-center">
          <div className="flex justify-center mb-6">
            <img 
              src="/Tesseract Logo.png" 
              alt="Tesseract" 
              className="h-12 w-auto"
            />
          </div>
          <h2 className="mt-6 text-2xl font-semibold text-gray-900 dark:text-white">{title}</h2>
          {subtitle && (
            <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">{subtitle}</p>
          )}
        </div>
      </div>

      <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-md">
        <Card>
          {children}
        </Card>
      </div>
    </div>
  )
}