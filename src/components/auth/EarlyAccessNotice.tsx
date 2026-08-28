/**
 * EarlyAccessNotice — what /signup shows during Professional Early Access.
 *
 * It replaces a working signup form. That form created a real Supabase account
 * and a real `public.users` row for anyone who filled it in, and then, because
 * every production organization is invite_only and no domain routing is
 * configured, dropped them on an "Invite Required" screen they could do nothing
 * with. Two of the 26 profile rows in production are exactly that: an account
 * with no membership, no workspace, and no way forward.
 *
 * Access during Early Access is granted by invitation, so this page says so and
 * creates nothing. The route into the product is /invite/:token.
 *
 * This is UX, not enforcement — removing a form removes nobody's ability to
 * POST to /auth/v1/signup. What makes an unsolicited account harmless is that
 * it can no longer reach an organization: bootstrap_organization is
 * platform-admin only, invitations cannot be self-issued, and the retired
 * auto-accept path no longer hands out memberships on an email match.
 */

import { Link } from 'react-router-dom'
import { KeyRound } from 'lucide-react'

/**
 * Where access requests go. Set VITE_ACCESS_REQUEST_EMAIL in Netlify to turn
 * the request-access button on; with it unset the page still explains the
 * situation and offers sign-in, rather than showing a button that goes
 * nowhere. Deliberately not defaulted to a guessed address.
 */
const ACCESS_REQUEST_EMAIL = import.meta.env.VITE_ACCESS_REQUEST_EMAIL as string | undefined

export function EarlyAccessNotice() {
  return (
    <div className="space-y-6 text-center">
      <div className="w-14 h-14 rounded-full bg-primary-50 dark:bg-primary-900/30 flex items-center justify-center mx-auto">
        <KeyRound className="w-7 h-7 text-primary-600" />
      </div>

      <div className="space-y-2">
        <p className="text-sm text-gray-600 dark:text-gray-400">
          Tesseract is in Professional Early Access. Accounts are created by
          invitation, so there's no sign-up form yet.
        </p>
        <p className="text-sm text-gray-600 dark:text-gray-400">
          If you have an invitation, open the link in your email — it takes you
          straight into your workspace.
        </p>
      </div>

      {ACCESS_REQUEST_EMAIL && (
        <a
          href={`mailto:${ACCESS_REQUEST_EMAIL}?subject=${encodeURIComponent('Tesseract Early Access request')}`}
          className="inline-flex items-center justify-center w-full px-4 py-2 border border-transparent text-sm font-medium rounded-lg text-white bg-primary-600 hover:bg-primary-700"
        >
          Request access
        </a>
      )}

      <p className="text-sm text-gray-600 dark:text-gray-400">
        Already have an account?{' '}
        <Link to="/login" className="font-medium text-primary-600 hover:text-primary-500">
          Sign in
        </Link>
      </p>
    </div>
  )
}
