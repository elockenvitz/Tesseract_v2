/**
 * The request message must be fully readable before anyone approves or
 * declines.
 *
 * The card clamps it to four lines, which is right for scanning a list and
 * wrong if that is all you can ever see: the first version ended long
 * messages in an ellipsis with no way to reveal the rest, so the decision was
 * being made on a truncated sentence.
 *
 * Whether a message overflows is measured, not guessed — the clamp is CSS, so
 * only the element knows. jsdom performs no layout and reports every height
 * as 0, so these tests stub the two properties the component reads. That is
 * the honest simulation: it drives the real code path rather than a test-only
 * branch, and a component that stopped measuring would fail here.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'

vi.mock('../../../lib/supabase', () => ({
  supabase: { from: () => ({}), rpc: async () => ({ data: null, error: null }) },
}))
vi.mock('@tanstack/react-query', () => ({
  useQuery: () => ({ data: [], isLoading: false }),
  useMutation: () => ({ mutate: () => {}, isPending: false }),
  useQueryClient: () => ({ invalidateQueries: () => {} }),
}))
vi.mock('../../common/Toast', () => ({ useToast: () => ({ success: () => {}, info: () => {}, error: () => {} }) }))
vi.mock('../../../lib/org-activity-log', () => ({ logOrgActivity: () => {} }))

import { RequestMessage } from '../OrgRequestsTab'

/**
 * Make the next rendered element report itself as clamped (or not).
 *
 * `scrollHeight` is the full text; `clientHeight` is the box it is shown in.
 * A clamped paragraph hiding content has the former exceed the latter, which
 * is exactly what the component tests for.
 */
function stubHeights({ scroll, client }: { scroll: number; client: number }) {
  const scrollSpy = vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockReturnValue(scroll)
  const clientSpy = vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(client)
  return () => { scrollSpy.mockRestore(); clientSpy.mockRestore() }
}

const LONG = 'Requesting access to Growth Team to pick up coverage on large-cap consumer names while Dan is out. Happy to start read-only if that is easier, and I can hand it back whenever.'
const SHORT = 'Please add me.'

describe('request message expansion', () => {
  let restore = () => {}
  beforeEach(() => { restore = () => {} })
  afterEach(() => { restore(); cleanup() })

  it('offers More when the message is actually clamped', () => {
    restore = stubHeights({ scroll: 120, client: 80 })
    render(<RequestMessage text={LONG} />)

    expect(screen.getByRole('button', { name: 'More' })).toBeTruthy()
  })

  it('shows no More control when the message fits', () => {
    // The whole point: a short message must not grow a control that does
    // nothing. Measured, so this holds at any width.
    restore = stubHeights({ scroll: 40, client: 40 })
    render(<RequestMessage text={SHORT} />)

    expect(screen.queryByRole('button', { name: 'More' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Less' })).toBeNull()
  })

  it('More reveals the full text and becomes Less', () => {
    restore = stubHeights({ scroll: 120, client: 80 })
    render(<RequestMessage text={LONG} />)

    const message = screen.getByText(LONG)
    expect(message.className).toContain('line-clamp-4')

    fireEvent.click(screen.getByRole('button', { name: 'More' }))

    // The clamp is gone, so the element is no longer hiding anything.
    expect(screen.getByText(LONG).className).not.toContain('line-clamp-4')
    expect(screen.getByRole('button', { name: 'Less' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'More' })).toBeNull()
  })

  it('Less collapses it again', () => {
    restore = stubHeights({ scroll: 120, client: 80 })
    render(<RequestMessage text={LONG} />)

    fireEvent.click(screen.getByRole('button', { name: 'More' }))
    fireEvent.click(screen.getByRole('button', { name: 'Less' }))

    expect(screen.getByText(LONG).className).toContain('line-clamp-4')
    expect(screen.getByRole('button', { name: 'More' })).toBeTruthy()
  })

  it('keeps the toggle visible while expanded, so it is never a one-way door', () => {
    restore = stubHeights({ scroll: 120, client: 80 })
    render(<RequestMessage text={LONG} />)
    fireEvent.click(screen.getByRole('button', { name: 'More' }))

    // Once expanded the heights match, so the overflow flag alone would hide
    // the control and strand the reader in the expanded state.
    expect(screen.getByRole('button', { name: 'Less' })).toBeTruthy()
  })

  it('preserves the line breaks the requester typed', () => {
    restore = stubHeights({ scroll: 40, client: 40 })
    const multiline = 'First line.\n\nSecond paragraph.'
    render(<RequestMessage text={multiline} />)

    expect(screen.getByText(/First line/).className).toContain('whitespace-pre-wrap')
  })

  it('reports expansion state to assistive technology', () => {
    restore = stubHeights({ scroll: 120, client: 80 })
    render(<RequestMessage text={LONG} />)

    expect(screen.getByRole('button', { name: 'More' })).toHaveAttribute('aria-expanded', 'false')
    fireEvent.click(screen.getByRole('button', { name: 'More' }))
    expect(screen.getByRole('button', { name: 'Less' })).toHaveAttribute('aria-expanded', 'true')
  })
})
