/**
 * /signup must never be a dead end.
 *
 * ── What it was ──────────────────────────────────────────────────────────
 *
 * The request-access button was wrapped in `{ACCESS_REQUEST_EMAIL && ...}`
 * and that variable is unset, so this page told a visitor that access is by
 * invitation and then offered them exactly one control: "Sign in", for the
 * account they are here because they do not have.
 *
 * It was also the page the landing page's call to action was meant to reach,
 * except that CTA pointed at `/login`, which does not render this component.
 * Two halves of one broken route, and no test saw either, because the tests
 * that existed checked that a link pointed at `/login`.
 *
 * So these cases assert the outcome a visitor gets, not the presence of a
 * control: the box opens, it takes what they type, and it posts it.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, cleanup, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'

/**
 * Re-import per configuration: `ACCESS_REQUEST_ROUTE` is read once at module
 * scope, because Vite inlines `import.meta.env` at build time.
 */
async function renderNotice(opts: { url?: string; email?: string } = {}) {
  vi.stubEnv('VITE_ACCESS_REQUEST_URL', opts.url ?? '')
  vi.stubEnv('VITE_ACCESS_REQUEST_EMAIL', opts.email ?? '')
  vi.resetModules()
  const { EarlyAccessNotice } = await import('../EarlyAccessNotice')
  render(<MemoryRouter><EarlyAccessNotice /></MemoryRouter>)
}

function stubFetch(result: { ok: boolean }) {
  const fetchMock = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(() =>
    Promise.resolve(result as Response),
  )
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

beforeEach(() => { vi.resetModules() })
afterEach(() => { cleanup(); vi.unstubAllEnvs(); vi.unstubAllGlobals() })

describe('with nothing configured, which is the live state', () => {
  it('offers a way to ask for access at all', async () => {
    await renderNotice()
    // The regression in one line: this used to render nothing.
    const button = screen.getByRole('button', { name: /request access/i })
    expect(button.tagName).toBe('BUTTON')
    expect(button.getAttribute('data-contact-mode')).toBe('inline')
  })

  it('opens the box and posts what a visitor types into it', async () => {
    const fetchMock = stubFetch({ ok: true })
    const user = userEvent.setup()
    await renderNotice()

    await user.click(screen.getByRole('button', { name: /request access/i }))

    const dialog = screen.getByRole('dialog')
    expect(dialog).toHaveAccessibleName('Request access')

    await user.type(screen.getByLabelText('Name'), 'Dana Reyes')
    await user.type(screen.getByLabelText('Work email'), 'dana@examplecapital.test')
    await user.type(screen.getByLabelText('Firm'), 'Example Capital')
    await user.click(screen.getByRole('button', { name: /send request/i }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    const body = new URLSearchParams(String(fetchMock.mock.calls[0]?.[1]?.body ?? ''))
    expect(body.get('form-name')).toBe('access-request')
    expect(body.get('name')).toBe('Dana Reyes')
    expect(body.get('firm')).toBe('Example Capital')
    /*
     * The topic separates this from a marketing CTA. Someone who reached
     * /signup is asking for an account, not for a meeting, and the founder
     * can see which from the submission.
     */
    expect(body.get('topic')).toBe('access')

    await waitFor(() => expect(screen.getByTestId('access-request-sent')).toBeTruthy())
  })

  it('submits from the keyboard without reaching for the mouse', async () => {
    const fetchMock = stubFetch({ ok: true })
    const user = userEvent.setup()
    await renderNotice()

    // Open with Enter on the focused control, not a click. One Tab reaches
    // it: it is the first focusable thing on the page, ahead of the sign-in
    // link, which is the order someone who came here for access wants.
    await user.tab()
    expect(document.activeElement).toBe(screen.getByRole('button', { name: /request access/i }))
    await user.keyboard('{Enter}')

    await waitFor(() => expect(screen.getByRole('dialog')).toBeTruthy())
    // Focus is already in the first field, so this types into it.
    await user.keyboard('Dana Reyes')
    await user.tab()
    await user.keyboard('dana@examplecapital.test{Enter}')

    // Enter inside a text field submits the form it belongs to. If the box
    // had no submit button, or the handler were on a click rather than on
    // submit, this would silently do nothing.
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    const body = new URLSearchParams(String(fetchMock.mock.calls[0]?.[1]?.body ?? ''))
    expect(body.get('name')).toBe('Dana Reyes')
    expect(body.get('email')).toBe('dana@examplecapital.test')
  })

  it('renders no address anywhere on the page', async () => {
    await renderNotice()
    expect(document.body.innerHTML).not.toContain('mailto:')
    expect(document.body.textContent).not.toMatch(/@tesseract\.com/)
  })

  it('keeps sign-in for someone who does have an account', async () => {
    await renderNotice()
    expect(screen.getByRole('link', { name: /sign in/i }).getAttribute('href')).toBe('/login')
  })
})

describe('with an intake form configured', () => {
  it('links out instead of opening the box', async () => {
    await renderNotice({ url: 'https://tally.example.test/r/abc123' })
    const link = screen.getByRole('link', { name: /request access/i })
    expect(link.getAttribute('href')).toBe('https://tally.example.test/r/abc123')
    expect(link.getAttribute('target')).toBe('_blank')
    // No referrer leak from a page a prospect is browsing privately.
    expect(link.getAttribute('rel')).toBe('noreferrer')
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})

describe('with a mailbox configured', () => {
  it('still opens the box, and shows the address only after a failure', async () => {
    stubFetch({ ok: false })
    const user = userEvent.setup()
    await renderNotice({ email: 'hello@example.test' })

    /*
     * The old behaviour was a mailto button. A mailto asks a stranger to
     * compose a cold email from nothing; the box asks five short questions.
     * The address is the fallback, so it is not sitting on a public page for
     * a scraper to harvest.
     */
    expect(document.body.innerHTML).not.toContain('mailto:')

    await user.click(screen.getByRole('button', { name: /request access/i }))
    await user.type(screen.getByLabelText('Name'), 'Dana Reyes')
    await user.type(screen.getByLabelText('Work email'), 'dana@examplecapital.test')
    await user.click(screen.getByRole('button', { name: /send request/i }))

    await waitFor(() => expect(screen.getByTestId('access-request-failed')).toBeTruthy())
    expect(screen.getByRole('link', { name: 'hello@example.test' }).getAttribute('href'))
      .toContain('mailto:hello@example.test')
  })
})
