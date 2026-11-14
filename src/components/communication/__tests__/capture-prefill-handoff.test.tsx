/**
 * The middle link: a promotion reaches the form the reader is shown.
 *
 * ── What is real here and what is not ─────────────────────────────────────
 *
 * The store is real, the effect that consumes it is real, and the host is the
 * real `ThoughtsSection`. The capture form is a stub that reports the props it
 * was handed, because what the form does with them is asserted against the
 * real component in
 * `src/components/thoughts/__tests__/capture-prefill-form.test.tsx`. Between
 * the two files every link in the chain is observed rather than assumed:
 *
 *   dispatch -> readCaptureOpen -> store -> this effect -> the form's props
 *                                                       -> the box on screen
 *
 * ── The defect worth pinning ──────────────────────────────────────────────
 *
 * The store's prefill is a one-shot, cleared in the same tick the form opens.
 * Render straight from it and the form is handed the words once and an empty
 * string on the very next render, which wipes what was just placed there. So
 * the draft is held in component state, and these tests check both halves:
 * the form gets the text, and the next capture opened by hand does not.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, cleanup } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { CapturePrefill } from '../../../lib/capture/prefill'

/* The capture form, replaced by something that says what it was given. */
vi.mock('../../thoughts/QuickThoughtCapture', () => ({
  QuickThoughtCapture: (props: Record<string, unknown>) => (
    <div
      data-testid="capture-form"
      data-content={String(props.initialContent ?? '')}
      data-idea-type={String(props.initialIdeaType ?? '')}
      data-source-title={String(props.initialSourceTitle ?? '')}
      data-asset-id={String(props.initialAssetId ?? '')}
    />
  ),
}))

/* Everything below is scaffolding this component needs to mount at all: a
   user, an org, a pilot verdict, and the four lists it shows when collapsed.
   None of it is the subject. */
vi.mock('../../../lib/supabase', () => {
  const builder: Record<string, unknown> = {}
  for (const method of ['select', 'eq', 'neq', 'in', 'order', 'limit', 'is', 'not', 'single', 'maybeSingle']) {
    builder[method] = () => builder
  }
  builder.then = (...args: unknown[]) =>
    (Promise.resolve({ data: [], error: null }) as never as { then: Function }).then(...args)
  return {
    supabase: {
      from: () => builder,
      auth: { getUser: async () => ({ data: { user: { id: 'u1' } } }) },
      storage: { from: () => ({ upload: async () => ({ data: null, error: null }) }) },
    },
  }
})
vi.mock('../../../hooks/useAuth', () => ({ useAuth: () => ({ user: { id: 'u1' } }) }))
vi.mock('../../../contexts/OrganizationContext', () => ({
  useOrganization: () => ({ currentOrg: { id: 'o1', name: 'Acme' }, userOrgs: [], switchOrg: () => {} }),
}))
vi.mock('../../../hooks/usePilotMode', () => ({
  usePilotMode: () => ({ effectiveIsPilot: false, hasGraduated: true }),
}))
vi.mock('../../../hooks/usePilotProgress', () => ({
  usePilotProgress: () => ({ dismissPilotCaptureBanner: () => {}, pilotBannerDismissed: true }),
}))
vi.mock('../../../hooks/useRecentQuickIdeas', () => ({
  useRecentQuickIdeas: () => ({ data: [], invalidate: () => {}, hasMore: false }),
}))
vi.mock('../../../hooks/useDirectCounts', () => ({
  useDirectCounts: () => ({ data: { prompts: 0, pending: 0 } }),
}))
vi.mock('../../../hooks/useDecisionRequests', () => ({
  useUpdateDecisionRequest: () => ({ mutateAsync: async () => {}, isPending: false }),
  useAcceptFromInbox: () => ({ mutateAsync: async () => {}, isPending: false }),
}))
vi.mock('../../../hooks/useMediaQuery', () => ({
  useIsMobile: () => false,
  useKeyboardInset: () => 0,
  useViewportHeight: () => 800,
}))

import { ThoughtsSection } from '../ThoughtsSection'
import { ToastProvider } from '../../common/Toast'
import { useSidebarStore } from '../../../stores/sidebarStore'

const promoted: CapturePrefill = {
  text: 'The mark is 11% through the March target.',
  ideaType: 'research_idea',
  sourceTitle: 'ACT AI answer, AAPL decisions',
  assetId: 'a-aapl',
}

function mountPane() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })
  return render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <ThoughtsSection sidebarMode="capture" initialContextType="asset" initialContextId="a-aapl" />
      </ToastProvider>
    </QueryClientProvider>,
  )
}

const form = () => screen.queryByTestId('capture-form')

beforeEach(() => {
  useSidebarStore.setState({
    sidebarOpen: false, sidebarMode: 'capture', selectedItem: null,
    pendingCaptureType: null, pendingCapturePrefill: null,
  })
})
afterEach(cleanup)

describe('a promotion arriving while the pane is open', () => {
  it('opens the capture form with the words and their provenance', async () => {
    mountPane()
    expect(form()).toBeNull()

    useSidebarStore.getState().openCaptureSidebar('idea', promoted)
    await screen.findByTestId('capture-form')

    const el = form()!
    expect(el.getAttribute('data-content')).toBe(promoted.text)
    expect(el.getAttribute('data-idea-type')).toBe('research_idea')
    expect(el.getAttribute('data-source-title')).toBe(promoted.sourceTitle)
    expect(el.getAttribute('data-asset-id')).toBe('a-aapl')
  })

  it('consumes the one-shot, so a later open does not reuse the draft', async () => {
    mountPane()
    useSidebarStore.getState().openCaptureSidebar('idea', promoted)
    await screen.findByTestId('capture-form')
    /* Cleared in the store the moment it is taken. A draft left behind there
       would turn up inside an unrelated capture later in the session. */
    expect(useSidebarStore.getState().pendingCapturePrefill).toBeNull()
    expect(useSidebarStore.getState().pendingCaptureType).toBeNull()
  })

  it('keeps the words while the form is open, rather than losing them to the next render', async () => {
    mountPane()
    useSidebarStore.getState().openCaptureSidebar('idea', promoted)
    await screen.findByTestId('capture-form')
    /* A re-render from any source. If the component read the draft from the
       store at render time, the cleared one-shot would empty the box here. */
    useSidebarStore.setState({ sidebarOpen: true })
    await Promise.resolve()
    expect(form()!.getAttribute('data-content')).toBe(promoted.text)
  })
})

describe('a capture the reader opens by hand', () => {
  it('starts empty, even straight after a promotion was kept', async () => {
    mountPane()
    useSidebarStore.getState().openCaptureSidebar('idea', promoted)
    await screen.findByTestId('capture-form')

    /* Back to the picker, then Quick thought again by hand. The promoted
       paragraph must not be sitting in it. */
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: /Cancel|Back/i }))
    await user.click(screen.getByText('Quick thought'))

    await screen.findByTestId('capture-form')
    expect(form()!.getAttribute('data-content')).toBe('')
  })

  it('does not hand an earlier promotion to a later request', async () => {
    /*
     * Two capture requests in one session, which is the reachable version of
     * this: a promotion opens the quick-thought form, something else then
     * asks for a different form, and the reader comes back. The second
     * request carried no draft, so the form must open empty -- the first
     * paragraph reappearing in it would be text the reader never chose for
     * this capture.
     */
    mountPane()
    useSidebarStore.getState().openCaptureSidebar('idea', promoted)
    await screen.findByTestId('capture-form')
    expect(form()!.getAttribute('data-content')).toBe(promoted.text)

    useSidebarStore.getState().openCaptureSidebar('trade_idea')
    await Promise.resolve()
    useSidebarStore.getState().openCaptureSidebar('idea')
    await screen.findByTestId('capture-form')
    expect(form()!.getAttribute('data-content')).toBe('')
  })

  it('opens empty when the request carried no draft at all', async () => {
    mountPane()
    useSidebarStore.getState().openCaptureSidebar('idea')
    await screen.findByTestId('capture-form')
    expect(form()!.getAttribute('data-content')).toBe('')
    expect(form()!.getAttribute('data-source-title')).toBe('')
  })
})
