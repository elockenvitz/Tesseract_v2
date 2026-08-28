import { test, expect, type Page, type Route } from '@playwright/test'

/**
 * Invitation entry, in a real browser at phone width.
 *
 * Two of the Early Access security requirements are claims about the browser
 * rather than the database, and the SQL suite cannot speak to either:
 *
 *   • the invite deep-link survives a refresh
 *   • invitation entry works on mobile
 *   • the token survives the round-trip through email confirmation — a new
 *     tab, a mail client, a browser that has never seen this invitation
 *   • the confirmation email is asked to come back to THIS invitation
 *
 * A link that a recipient opens in their phone's mail app, and that dies if
 * they pull-to-refresh, is a broken front door however well the RPC behind it
 * is guarded. So this drives the actual route.
 *
 * The database is not involved. `vite.invite-e2e.config.ts` points the Supabase
 * client at an unregistered *.supabase.co subdomain and every request to it is
 * intercepted below, so a missed intercept 500s instead of reaching a real
 * project. What is under test here is the page's behaviour given an answer, not
 * the answer — supabase/tests/early-access-invite-security.sql owns the answer.
 */

const TOKEN = '3f1b6a5e-9c42-4d1a-8b77-2ea50c9d4411'
const OTHER_TOKEN = '8a2c4d6e-1f30-4b59-9c88-5d7e0a1b2c33'

type Preview = Record<string, unknown>

/**
 * Stub the one RPC the signed-out invitation page makes, and make every other
 * call to the Supabase host a loud failure rather than a hang.
 */
async function stubInvite(page: Page, preview: Preview) {
  // Order matters: Playwright tries handlers in reverse registration order, so
  // the catch-all has to go on FIRST or it shadows everything specific after
  // it. Registered the other way round, every stub below silently became a 500
  // and the page rendered its generic "couldn't find that invitation" state —
  // which made the not_found test pass for entirely the wrong reason.
  await page.route('**/invite-e2e-fixture.supabase.co/**', (route: Route) =>
    route.fulfill({ status: 500, contentType: 'application/json', body: '{"message":"unstubbed"}' })
  )
  await page.route('**/rest/v1/rpc/get_invite_preview', (route: Route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(preview),
    })
  )
}

const VALID: Preview = {
  valid: true,
  email: 'dana@northharbor.test',
  org_name: 'North Harbor Capital',
}

test.describe('a valid invitation', () => {
  test.beforeEach(async ({ page }) => {
    await stubInvite(page, VALID)
    await page.goto(`/invite/${TOKEN}`)
  })

  test('names the workspace and the invited address', async ({ page }) => {
    await expect(page.getByText(/You're invited to North Harbor Capital/)).toBeVisible()
    await expect(page.getByText('dana@northharbor.test')).toBeVisible()
    // The recipient should be told this is Early Access, not a general signup.
    await expect(page.getByText(/Professional Early Access/i)).toBeVisible()
  })

  test('offers account creation without asking for the email again', async ({ page }) => {
    await expect(page.getByRole('button', { name: /create account and join/i })).toBeVisible()
    // The address is fixed by the invitation. Offering an email field would
    // imply it is the user's to choose, and the server would then refuse them.
    await expect(page.locator('input[type="email"]')).toHaveCount(0)
  })

  test('survives a refresh', async ({ page }) => {
    // The requirement: an emailed deep link that still works when the recipient
    // reloads, backgrounds the tab, or reopens it from history. The token lives
    // in the URL, so this only holds while the route stays a real route.
    await expect(page.getByText('dana@northharbor.test')).toBeVisible()
    await page.reload()
    await expect(page.getByText(/You're invited to North Harbor Capital/)).toBeVisible()
    await expect(page.getByText('dana@northharbor.test')).toBeVisible()
    expect(new URL(page.url()).pathname).toBe(`/invite/${TOKEN}`)
  })

  test('can be reached directly at a second token without a full app boot', async ({ page }) => {
    await page.goto(`/invite/${OTHER_TOKEN}`)
    await expect(page.getByText(/You're invited to North Harbor Capital/)).toBeVisible()
  })

  test('fits a 390px phone and is tappable', async ({ page }) => {
    // Horizontal overflow on an auth screen is the classic mobile failure: the
    // button ends up off-screen and the invitation is unusable on the device
    // the link was opened on.
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth
    )
    expect(overflow, 'the invitation page scrolls sideways on a phone').toBeLessThanOrEqual(0)

    const submit = page.getByRole('button', { name: /create account and join/i })
    const box = await submit.boundingBox()
    expect(box, 'submit button has no layout box').not.toBeNull()
    // Apple's 44pt minimum: below this the primary action is a miss-tap.
    expect(box!.height).toBeGreaterThanOrEqual(40)
    expect(box!.width).toBeLessThanOrEqual(390)

    // And the long invited address must not be what pushes the card wide.
    const emailOverflow = await page.evaluate(() => {
      const el = Array.from(document.querySelectorAll('*')).find(
        (n) => n.textContent?.trim() === 'dana@northharbor.test'
      ) as HTMLElement | undefined
      return el ? el.scrollWidth - el.clientWidth : 0
    })
    expect(emailOverflow).toBeLessThanOrEqual(0)
  })
})

test.describe('an invitation that cannot be used', () => {
  test('expired says so and offers no form', async ({ page }) => {
    await stubInvite(page, { valid: false, reason: 'expired', org_name: 'North Harbor Capital' })
    await page.goto(`/invite/${TOKEN}`)
    await expect(page.getByText(/expired/i)).toBeVisible()
    await expect(page.getByRole('button', { name: /create account and join/i })).toHaveCount(0)
  })

  test('revoked says so and offers no form', async ({ page }) => {
    await stubInvite(page, { valid: false, reason: 'revoked' })
    await page.goto(`/invite/${TOKEN}`)
    await expect(page.getByText(/no longer valid/i)).toBeVisible()
    await expect(page.getByRole('button', { name: /create account and join/i })).toHaveCount(0)
  })

  test('an unknown token is a dead end, not a hint', async ({ page }) => {
    let asked = false
    await stubInvite(page, { valid: false, reason: 'not_found' })
    await page.route('**/rest/v1/rpc/get_invite_preview', (route: Route) => {
      asked = true
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ valid: false, reason: 'not_found' }),
      })
    })
    await page.goto(`/invite/${TOKEN}`)
    await expect(page.getByText(/couldn't find that invitation/i)).toBeVisible()
    // Checked after the assertion above, not before: `goto` resolves on load,
    // while the preview request is issued from an effect after hydration.
    // Guards against this passing because the request failed rather than
    // because the server said "no such invitation".
    expect(asked, 'the preview RPC was never reached').toBe(true)
    // Nothing about which organization, or whether the token ever existed.
    await expect(page.getByText(/North Harbor/)).toHaveCount(0)
  })

  test('a malformed token never reaches the network', async ({ page }) => {
    let called = false
    await page.route('**/rest/v1/rpc/get_invite_preview', (route: Route) => {
      called = true
      return route.fulfill({ status: 200, contentType: 'application/json', body: '{"valid":false}' })
    })
    await page.goto('/invite/not-a-token')
    await expect(page.getByText(/couldn't find that invitation/i)).toBeVisible()
    expect(called, 'a malformed token was sent to the server').toBe(false)
  })
})

test.describe('unsolicited signup', () => {
  test('/signup explains Early Access instead of creating an account', async ({ page }) => {
    await stubInvite(page, VALID)
    await page.goto('/signup')
    await expect(page.getByText(/Professional Early Access/i).first()).toBeVisible()
    await expect(page.getByText(/by invitation/i).first()).toBeVisible()
    // The form is gone: no password, no confirm, no create-account submit.
    await expect(page.locator('input[type="password"]')).toHaveCount(0)
    await expect(page.getByRole('button', { name: /create account/i })).toHaveCount(0)
    // But a real pilot can still get to their account.
    await expect(page.getByRole('link', { name: /sign in/i })).toBeVisible()
  })
})


/**
 * Email verification — the confirmation round-trip.
 *
 * These are the browser half of turning `mailer_autoconfirm` off. The database
 * half (an unconfirmed identity cannot accept; a confirmed one can) is checked
 * in supabase/tests/early-access-invite-security.sql. What cannot be checked
 * there is whether the recipient is ever able to come BACK — and that is the
 * failure mode that strands people silently: they confirm, they are signed in,
 * and the invitation is simply gone.
 */
test.describe('the confirmation round-trip', () => {
  /** Capture what the page asks Supabase to do, and answer as gotrue would. */
  async function stubSignup(page: Page, opts: { session: boolean }) {
    const seen: { url: string; body: Record<string, unknown> }[] = []
    await page.route('**/auth/v1/signup**', async (route: Route) => {
      seen.push({
        url: route.request().url(),
        body: JSON.parse(route.request().postData() || '{}'),
      })
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(
          opts.session
            ? {
                access_token: 'a',
                token_type: 'bearer',
                expires_in: 3600,
                refresh_token: 'r',
                user: { id: 'u1', email: 'dana@northharbor.test' },
              }
            : // gotrue with confirmations on: a user, and deliberately no session.
              { id: 'u1', email: 'dana@northharbor.test', identities: [], session: null }
        ),
      })
    })
    return seen
  }

  async function fillSignup(page: Page) {
    await page.getByLabel('First name').fill('Dana')
    await page.getByLabel('Last name').fill('Reyes')
    await page.getByLabel('Password').fill('correct horse battery')
    await page.getByRole('button', { name: /create account and join/i }).click()
  }

  test('asks for the confirmation email to come back to this invitation', async ({ page }) => {
    // The single most important line in this flow. Without `emailRedirectTo`,
    // Supabase sends the recipient to the project's site_url — they arrive
    // confirmed, signed in, and with no invitation anywhere in sight.
    await stubInvite(page, VALID)
    const seen = await stubSignup(page, { session: false })
    await page.goto(`/invite/${TOKEN}`)
    await fillSignup(page)

    await expect(page.getByText(/confirmation link/i)).toBeVisible()
    expect(seen, 'signup was never called').toHaveLength(1)

    // gotrue carries the redirect as a query parameter on the signup URL.
    const redirect = new URL(seen[0].url).searchParams.get('redirect_to')
    expect(redirect, 'signup carried no confirmation redirect').toBeTruthy()
    const target = new URL(redirect!)
    expect(target.pathname).toBe(`/invite/${TOKEN}`)
    // And it points at us, not at anywhere a token could have steered it.
    expect(target.origin).toBe(new URL(page.url()).origin)
  })

  test('parks the token where a NEW TAB can find it', async ({ page, context }) => {
    // The journey: sign up on a laptop, open the confirmation mail in a client
    // that spawns a fresh tab. A fresh tab has an EMPTY sessionStorage, so a
    // sessionStorage-only stash is gone at exactly the moment it was needed.
    await stubInvite(page, VALID)
    await page.goto(`/invite/${TOKEN}`)
    await expect(page.getByText('dana@northharbor.test')).toBeVisible()

    const fresh = await context.newPage()
    await stubInvite(fresh, VALID)
    await fresh.goto('/login')
    const parked = await fresh.evaluate(() => {
      const raw = localStorage.getItem('pending-invite-token')
      if (!raw) return null
      try {
        return (JSON.parse(raw) as { token: string }).token
      } catch {
        return raw
      }
    })
    expect(parked, 'the invitation did not survive into a new tab').toBe(TOKEN)

    // Not merely present — usable. This is the hop ProtectedRoute makes.
    await fresh.goto(`/invite/${parked}`)
    await expect(fresh.getByText(/You're invited to North Harbor Capital/)).toBeVisible()
    await fresh.close()
  })

  test('a signup that returns a session never shows the waiting room', async ({ page }) => {
    // The autoconfirm-on path, which is production today. Verification being on
    // must not be what makes this page work — it has to keep working before the
    // flip too, or there is no safe order to roll this out in.
    await stubInvite(page, VALID)
    await stubSignup(page, { session: true })
    await page.goto(`/invite/${TOKEN}`)
    await fillSignup(page)
    await expect(page.getByText(/We sent a confirmation link/i)).toHaveCount(0)
  })

  test('offers a resend, and does not let it be hammered', async ({ page }) => {
    // Someone who loses the email has no other way forward: they cannot sign in
    // (an unconfirmed identity is refused a session) and cannot sign up again
    // (the address is taken). The resend is the only exit.
    await stubInvite(page, VALID)
    await stubSignup(page, { session: false })
    await page.goto(`/invite/${TOKEN}`)
    await fillSignup(page)

    const resend = page.getByRole('button', { name: /resend/i })
    await expect(resend).toBeVisible()
    // Straight after a send it is counting down Supabase's own per-address
    // cooldown, rather than letting the person earn an error.
    await expect(resend).toBeDisabled()
    await expect(resend).toHaveText(/Resend in \d+s/)
  })

  test('the waiting room offers a way out for someone already confirmed', async ({ page }) => {
    // Supabase will not tell an existing confirmed address that it exists, and
    // sends it no new email. Without this escape the person waits forever for a
    // message that is never coming.
    await stubInvite(page, VALID)
    await stubSignup(page, { session: false })
    await page.goto(`/invite/${TOKEN}`)
    await fillSignup(page)

    await page.getByRole('button', { name: /already confirmed\? sign in/i }).click()
    await expect(page.getByRole('button', { name: /sign in and join/i })).toBeVisible()
  })

  test('a sign-in refused for an unconfirmed mailbox is not shown as a password problem', async ({
    page,
  }) => {
    await stubInvite(page, VALID)
    await page.route('**/auth/v1/token**', (route: Route) =>
      route.fulfill({
        status: 400,
        contentType: 'application/json',
        body: JSON.stringify({
          code: 'email_not_confirmed',
          error_code: 'email_not_confirmed',
          msg: 'Email not confirmed',
          message: 'Email not confirmed',
        }),
      })
    )
    await page.goto(`/invite/${TOKEN}`)
    await page.getByRole('button', { name: /^sign in$/i }).click()
    await page.getByLabel('Password').fill('correct horse battery')
    await page.getByRole('button', { name: /sign in and join/i }).click()

    await expect(page.getByText(/confirm that/i)).toBeVisible()
    await expect(page.getByRole('button', { name: /resend/i })).toBeVisible()
  })

  test('a valid invitation refused for the WRONG account stops re-routing it, but is kept', async ({
    page,
    context,
  }) => {
    // The shared-browser trap. A valid invitation parks for 24h; before the
    // fix, ProtectedRoute forwarded every no-workspace account to it, the
    // address check refused, and the next no-workspace screen forwarded it
    // again. Signing out did not help — the token was still there and the
    // forward was unconditional.
    //
    // The invitation must be MARKED, not deleted: on a shared browser the
    // person it was actually sent to is very often the next to sign in, and
    // "sign out and switch account" on this screen is the intended path there.
    await stubInvite(page, VALID)
    await page.route('**/auth/v1/signup**', (route: Route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          access_token: 'a',
          token_type: 'bearer',
          expires_in: 3600,
          refresh_token: 'r',
          // A session for somebody who is NOT the invited address.
          user: { id: 'wrong-uid-1', email: 'someone.else@elsewhere.test' },
        }),
      })
    )
    await page.goto(`/invite/${TOKEN}`)
    await fillSignup(page)

    // The page tells them plainly, and offers the exit.
    await expect(page.getByRole('button', { name: /sign out and switch account/i })).toBeVisible()

    const record = await page.evaluate(() => {
      const raw = localStorage.getItem('pending-invite-token')
      return raw ? (JSON.parse(raw) as { token: string; notFor?: string[] }) : null
    })
    // Kept — the rightful recipient still needs it...
    expect(record?.token, 'the invitation was discarded instead of marked').toBe(TOKEN)
    // ...and marked, so this account is no longer auto-routed back here.
    expect(record?.notFor ?? []).toContain('wrong-uid-1')

    // A brand-new tab (empty sessionStorage) reads the same marked record, so
    // the cross-tab forward stops too — that was the localStorage half of the
    // trap.
    const fresh = await context.newPage()
    await stubInvite(fresh, VALID)
    await fresh.goto('/login')
    const inFresh = await fresh.evaluate(() => {
      const raw = localStorage.getItem('pending-invite-token')
      return raw ? (JSON.parse(raw) as { token: string; notFor?: string[] }) : null
    })
    expect(inFresh?.token).toBe(TOKEN)
    expect(inFresh?.notFor ?? []).toContain('wrong-uid-1')
    // Still live and reachable at its URL. The wrong account is still signed
    // in in this context, so what it gets is the refusal screen and the exit
    // to switch accounts — not a lost or cleared invitation. That is the
    // distinction the fix turns on: the mark narrows who is auto-routed here,
    // never whether the invitation still exists.
    await fresh.goto(`/invite/${TOKEN}`)
    await expect(
      fresh.getByRole('button', { name: /sign out and switch account/i })
    ).toBeVisible()
    await fresh.close()
  })

  test('an unusable invitation does not stay parked to hijack the next arrival', async ({ page }) => {
    // A revoked token left in shared storage would keep redirecting whoever
    // next lands on the no-workspace screen into a dead end they cannot clear.
    await stubInvite(page, { valid: false, reason: 'revoked' })
    await page.goto(`/invite/${TOKEN}`)
    await expect(page.getByText(/no longer valid/i)).toBeVisible()
    const parked = await page.evaluate(() => localStorage.getItem('pending-invite-token'))
    expect(parked).toBeNull()
  })
})
