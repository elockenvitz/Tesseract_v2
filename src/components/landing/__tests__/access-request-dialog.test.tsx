/**
 * The request-access box: what it sends, and what it does when sending fails.
 *
 * ── The bug this component exists to fix ─────────────────────────────────
 *
 * Every landing-page call to action resolved to `/login`, so a stranger who
 * clicked "Request a demo" got a password prompt. The old suite asserted the
 * href was `/login` and passed, because an href is a destination and not an
 * outcome. These cases assert the outcome: a filled-in form reaches the
 * endpoint with the values in it.
 *
 * ── Why the failure path gets as much coverage as the success path ───────
 *
 * The endpoint only exists on a real deploy. Locally, and in every test run,
 * a POST to it would 404. So "it failed" is not an edge case here, it is the
 * normal local result, and a dialog that swallowed a failure would look
 * identical to one that worked. The founder would have no way to tell a dead
 * form from a quiet one until a prospect mentioned never hearing back.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, cleanup, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AccessRequestDialog } from '../AccessRequestDialog'
import {
  ACCESS_REQUEST_ENDPOINT,
  ACCESS_REQUEST_FIELDS,
  ACCESS_REQUEST_FORM_NAME,
} from '../access-request-contract'

/**
 * The fetch mock, and the body of the one call it received.
 *
 * The signature is given as `vi.fn`'s type argument rather than as parameters
 * on the implementation, and both halves of that matter.
 *
 * `fetchMock.mock.calls` takes its type from the signature: an untyped
 * `vi.fn()` types every recorded call as `[]`, so reading `calls[0][1]` needs
 * a cast tsc rejects as a non-overlapping conversion. Declaring the
 * parameters on the implementation instead fixes that and trades it for two
 * eslint `no-unused-vars` errors, because nothing in the body reads them. The
 * type argument gives the calls their shape with no unused bindings at all.
 */
function stubFetch(result: { ok: boolean } | Error) {
  const fetchMock = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(() =>
    result instanceof Error ? Promise.reject(result) : Promise.resolve(result as Response),
  )
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

const postedBody = (fetchMock: ReturnType<typeof stubFetch>) =>
  new URLSearchParams(String(fetchMock.mock.calls[0]?.[1]?.body ?? ''))

async function fillIn(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText('Name'), 'Dana Reyes')
  await user.type(screen.getByLabelText('Work email'), 'dana@examplecapital.test')
  await user.type(screen.getByLabelText('Firm'), 'Example Capital')
  await user.type(screen.getByLabelText('Role'), 'Portfolio manager')
  await user.type(screen.getByLabelText('Anything we should know'), 'Nine analysts, one PM.')
}

const send = (user: ReturnType<typeof userEvent.setup>) =>
  user.click(screen.getByRole('button', { name: /send request/i }))

beforeEach(() => { vi.unstubAllGlobals() })
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks() })

describe('what the box sends', () => {
  it('posts every declared field, with the values typed in', async () => {
    const fetchMock = stubFetch({ ok: true })
    const user = userEvent.setup()
    render(<AccessRequestDialog topic="demo" onClose={() => {}} />)

    await fillIn(user)
    await send(user)

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe(ACCESS_REQUEST_ENDPOINT)
    expect(init?.method).toBe('POST')
    expect((init?.headers as Record<string, string>)['Content-Type'])
      .toBe('application/x-www-form-urlencoded')

    const body = postedBody(fetchMock)
    // The form name, or the submission is attributed to no form and rejected.
    expect(body.get('form-name')).toBe(ACCESS_REQUEST_FORM_NAME)
    // Every field, present even when empty, so the arriving record has the
    // same shape every time rather than a column that appears and vanishes.
    for (const field of ACCESS_REQUEST_FIELDS) {
      expect(body.has(field), `missing field: ${field}`).toBe(true)
    }
    expect(body.get('name')).toBe('Dana Reyes')
    expect(body.get('email')).toBe('dana@examplecapital.test')
    expect(body.get('firm')).toBe('Example Capital')
    expect(body.get('role')).toBe('Portfolio manager')
    expect(body.get('note')).toBe('Nine analysts, one PM.')
  })

  it('carries which call to action opened it', async () => {
    const fetchMock = stubFetch({ ok: true })
    const user = userEvent.setup()
    render(<AccessRequestDialog topic="partnership" onClose={() => {}} />)

    await fillIn(user)
    await send(user)

    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    // Without this the founder cannot tell a demo request from a partnership
    // enquiry, which is the distinction the two separate CTAs exist to draw.
    expect(postedBody(fetchMock).get('topic')).toBe('partnership')
  })

  it('leaves the honeypot empty for a person filling the form normally', async () => {
    const fetchMock = stubFetch({ ok: true })
    const user = userEvent.setup()
    render(<AccessRequestDialog topic="demo" onClose={() => {}} />)

    await fillIn(user)
    await send(user)

    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    expect(postedBody(fetchMock).get('bot-field')).toBe('')
  })
})

describe('the box refuses to send a request nobody can reply to', () => {
  it('does not post without a name and a usable email', async () => {
    const fetchMock = stubFetch({ ok: true })
    const user = userEvent.setup()
    render(<AccessRequestDialog topic="demo" onClose={() => {}} />)

    await send(user)

    // Checked in code rather than left to `required` and `type="email"`:
    // jsdom does not implement constraint validation, so a test would watch
    // an empty form "succeed" and the rule would exist only in a browser.
    expect(fetchMock).not.toHaveBeenCalled()
    expect(screen.getByTestId('access-request-invalid').textContent)
      .toMatch(/name and a work email/i)
  })

  it('rejects an address with no domain', async () => {
    const fetchMock = stubFetch({ ok: true })
    const user = userEvent.setup()
    render(<AccessRequestDialog topic="demo" onClose={() => {}} />)

    await user.type(screen.getByLabelText('Name'), 'Dana Reyes')
    await user.type(screen.getByLabelText('Work email'), 'dana@localhost')
    await send(user)

    expect(fetchMock).not.toHaveBeenCalled()
    expect(screen.getByTestId('access-request-invalid').textContent).toMatch(/work email/i)
  })
})

describe('when sending fails, which is the normal local result', () => {
  it('says so, keeps every value, and offers another attempt', async () => {
    stubFetch({ ok: false })
    const user = userEvent.setup()
    render(<AccessRequestDialog topic="demo" onClose={() => {}} />)

    await fillIn(user)
    await send(user)

    await waitFor(() => expect(screen.getByTestId('access-request-failed')).toBeTruthy())
    expect(screen.getByTestId('access-request-failed').textContent).toMatch(/did not send/i)
    // Nothing retyped. A form that clears itself on failure is a form nobody
    // fills in twice.
    expect((screen.getByLabelText('Name') as HTMLInputElement).value).toBe('Dana Reyes')
    expect((screen.getByLabelText('Firm') as HTMLInputElement).value).toBe('Example Capital')
    expect(screen.getByRole('button', { name: /try again/i })).toBeTruthy()
    expect(screen.queryByTestId('access-request-sent')).toBeNull()
  })

  it('treats a thrown request as a failure, not a success', async () => {
    stubFetch(new Error('network down'))
    const user = userEvent.setup()
    render(<AccessRequestDialog topic="demo" onClose={() => {}} />)

    await fillIn(user)
    await send(user)

    await waitFor(() => expect(screen.getByTestId('access-request-failed')).toBeTruthy())
  })

  it('shows the configured mailbox only in the failure state', async () => {
    stubFetch({ ok: false })
    const user = userEvent.setup()
    render(
      <AccessRequestDialog topic="demo" onClose={() => {}} fallbackEmail="hello@example.test" />,
    )

    // Not before. A visitor who never sees an error never sees an address,
    // which keeps it away from scrapers reading the rendered page.
    expect(document.body.innerHTML).not.toContain('mailto:')

    await fillIn(user)
    await send(user)

    await waitFor(() => expect(screen.getByTestId('access-request-failed')).toBeTruthy())
    const link = screen.getByRole('link', { name: 'hello@example.test' })
    expect(link.getAttribute('href')).toContain('mailto:hello@example.test')
  })

  it('renders no address at all when no mailbox is configured', async () => {
    stubFetch({ ok: false })
    const user = userEvent.setup()
    render(<AccessRequestDialog topic="demo" onClose={() => {}} />)

    await fillIn(user)
    await send(user)

    await waitFor(() => expect(screen.getByTestId('access-request-failed')).toBeTruthy())
    // Never a guessed address. `sales@tesseract.com` is hard-coded elsewhere
    // in this codebase and points at a domain that is not ours.
    expect(document.body.innerHTML).not.toContain('mailto:')
    expect(document.body.textContent).not.toMatch(/@tesseract\.com/)
  })
})

describe('when sending succeeds', () => {
  it('replaces the form with a confirmation', async () => {
    stubFetch({ ok: true })
    const user = userEvent.setup()
    render(<AccessRequestDialog topic="demo" onClose={() => {}} />)

    await fillIn(user)
    await send(user)

    await waitFor(() => expect(screen.getByTestId('access-request-sent')).toBeTruthy())
    expect(screen.queryByLabelText('Work email')).toBeNull()
    expect(screen.getByTestId('access-request-sent').textContent).toMatch(/request received/i)

    /*
     * Two controls, two distinct names.
     *
     * The corner control is named Close. Found in a browser, not here: the
     * confirmation panel's own button also said "Close", so the dialog
     * offered two buttons with the same accessible name and nothing to
     * distinguish them. It is "Done" now.
     */
    const names = screen.getAllByRole('button').map(b => b.textContent?.trim() || b.getAttribute('aria-label'))
    expect(names).toEqual([...new Set(names)])
    expect(names).toContain('Done')
  })

  it('never says a request was received when the POST was rejected', async () => {
    stubFetch({ ok: false })
    const user = userEvent.setup()
    render(<AccessRequestDialog topic="demo" onClose={() => {}} />)

    await fillIn(user)
    await send(user)

    await waitFor(() => expect(screen.getByTestId('access-request-failed')).toBeTruthy())
    // The whole point of reading `response.ok`. A thank-you over a dropped
    // submission is worse than an error, because nobody follows it up.
    expect(document.body.textContent).not.toMatch(/request received/i)
  })
})

describe('keyboard and focus', () => {
  it('puts focus in the first field on open', () => {
    render(<AccessRequestDialog topic="demo" onClose={() => {}} />)
    expect(document.activeElement).toBe(screen.getByLabelText('Name'))
  })

  it('closes on Escape', async () => {
    const onClose = vi.fn()
    const user = userEvent.setup()
    render(<AccessRequestDialog topic="demo" onClose={onClose} />)
    await user.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalled()
  })

  it('closes on the close control and on the backdrop, but not on the panel', async () => {
    const onClose = vi.fn()
    const user = userEvent.setup()
    render(<AccessRequestDialog topic="demo" onClose={onClose} />)

    await user.click(screen.getByTestId('access-request-dialog'))
    expect(onClose).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: /close/i }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('is announced as a modal dialog with a name', () => {
    render(<AccessRequestDialog topic="demo" onClose={() => {}} />)
    const dialog = screen.getByRole('dialog')
    expect(dialog.getAttribute('aria-modal')).toBe('true')
    expect(dialog).toHaveAccessibleName('Request a demo')
  })

  it('hides the honeypot from the accessibility tree and from tabbing', () => {
    render(<AccessRequestDialog topic="demo" onClose={() => {}} />)
    const honeypot = document.querySelector('input[name="bot-field"]')
    expect(honeypot).toBeTruthy()
    expect(honeypot?.getAttribute('tabindex')).toBe('-1')
    expect(honeypot?.closest('[aria-hidden="true"]')).toBeTruthy()

    /*
     * A screen-reader user must not be asked to fill a trap field, so the
     * assertion is a ROLE query, not a label query.
     *
     * `queryByLabelText` finds it regardless: label queries walk the DOM and
     * ignore `aria-hidden`, which is precisely why the first version of this
     * case failed against correct markup. Role queries respect the
     * accessibility tree, so this is the one that asserts what an assistive
     * technology actually sees.
     */
    expect(screen.queryByRole('textbox', { name: /leave this field empty/i })).toBeNull()
    // The five fields a person is asked for, and nothing else.
    expect(screen.getAllByRole('textbox')).toHaveLength(5)
  })
})
