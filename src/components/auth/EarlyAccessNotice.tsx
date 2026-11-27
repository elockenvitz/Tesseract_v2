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
 *
 * ── The dead end this page used to be ────────────────────────────────────
 *
 * The request-access button was wrapped in `{ACCESS_REQUEST_EMAIL && ...}`,
 * and that variable is unset, so a visitor who arrived here wanting an
 * account was told access is by invitation and given nothing to do about it.
 * The only control on the page was "Sign in", for the account they are here
 * because they do not have.
 *
 * It was also the page the landing page's CTAs were supposed to be sending
 * people to, except they pointed at `/login`, which does not render this
 * component at all. Two halves of one broken route.
 *
 * Now the button is always here, and it opens the same box the landing page
 * uses, with the same submission path. `ACCESS_REQUEST_ROUTE` is shared so
 * the two surfaces cannot drift apart again.
 */

import { useState } from 'react'
import { Link } from 'react-router-dom'
import { KeyRound } from 'lucide-react'
import { AccessRequestDialog } from '../landing/AccessRequestDialog'
import { ACCESS_REQUEST_ROUTE } from '../landing/access-request-contract'

const BUTTON_CLASS =
  'inline-flex items-center justify-center w-full px-4 py-2 border border-transparent text-sm font-medium rounded-lg text-white bg-primary-600 hover:bg-primary-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2'

export function EarlyAccessNotice() {
  const [requesting, setRequesting] = useState(false)

  /*
   * Left-aligned, matching `AuthLayout`'s title and the form fields on every
   * sibling auth page. It was centred when the shell was a centred card; the
   * shell is now a left-aligned column, and a centred block inside it reads as
   * a different page.
   */
  return (
    <div className="space-y-6">
      <div className="w-12 h-12 rounded-xl bg-primary-50 dark:bg-primary-900/30 flex items-center justify-center">
        <KeyRound className="w-6 h-6 text-primary-600" />
      </div>

      <div className="space-y-2">
        <p className="text-sm text-gray-600 dark:text-gray-400">
          Tesseract is in Professional Early Access. Accounts are created by
          invitation, so there's no sign-up form yet.
        </p>
        <p className="text-sm text-gray-600 dark:text-gray-400">
          If you have an invitation, open the link in your email. It takes you
          straight into your workspace.
        </p>
      </div>

      {/*
        Always present, in one of two forms, because a visitor who wants
        access must always have somewhere to go from here.

        An external intake form links out. Otherwise the button opens the
        box, which is a `<button>` and not a `<Link>`, because it does not
        navigate.
      */}
      {ACCESS_REQUEST_ROUTE.mode === 'form' ? (
        <a
          href={ACCESS_REQUEST_ROUTE.url}
          target="_blank"
          rel="noreferrer"
          data-contact-mode="form"
          className={BUTTON_CLASS}
        >
          Request access
        </a>
      ) : (
        <button
          type="button"
          onClick={() => setRequesting(true)}
          data-contact-mode="inline"
          className={BUTTON_CLASS}
        >
          Request access
        </button>
      )}

      <p className="text-sm text-gray-600 dark:text-gray-400">
        Already have an account?{' '}
        <Link to="/login" className="font-medium text-primary-600 hover:text-primary-500">
          Sign in
        </Link>
      </p>

      {/*
        `light`, because the auth pages are a white card on bg-gray-50 and
        `darkMode: 'class'` means a signed-out visitor has no theme class. The
        landing page's near-black panel would read as pasted in from another
        site. Same box, same fields, same POST.
      */}
      {requesting && (
        <AccessRequestDialog
          topic="access"
          tone="light"
          onClose={() => setRequesting(false)}
          fallbackEmail={ACCESS_REQUEST_ROUTE.fallbackEmail}
        />
      )}
    </div>
  )
}
