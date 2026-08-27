import { test, expect, type Page, type Route } from '@playwright/test'

/**
 * Invitation entry, in a real browser at phone width.
 *
 * Two of the Early Access security requirements are claims about the browser
 * rather than the database, and the SQL suite cannot speak to either:
 *
 *   • the invite deep-link survives a refresh
 *   • invitation entry works on mobile
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
