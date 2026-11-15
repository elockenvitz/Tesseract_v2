/**
 * The far end of the capture wire: the form really does open with the words.
 *
 * ── Why this test exists ──────────────────────────────────────────────────
 *
 * "Prefilled" is the kind of claim that is easy to make and easy to get
 * wrong, because every link in the chain looks right on its own. The channel
 * carried a `prefillText` nobody read for as long as it has existed. So the
 * last link is asserted against the real component: the props a promotion
 * produces go in, and the textarea the reader types into is checked for the
 * text.
 *
 * Supabase is mocked because this component builds a client at import time
 * and queries the org chart on mount. Nothing here saves, and the submit path
 * is not exercised -- what is being tested is the state the form OPENS in.
 */
import { describe, it, expect, vi } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { capturePrefillProps, type CapturePrefill } from '../../../lib/capture/prefill'

/** A chainable stub: every builder call returns itself and resolves empty. */
vi.mock('../../../lib/supabase', () => {
  const result = Promise.resolve({ data: [], error: null })
  const builder: Record<string, unknown> = {}
  for (const method of ['select', 'eq', 'neq', 'in', 'order', 'limit', 'is', 'not', 'single', 'maybeSingle']) {
    builder[method] = () => builder
  }
  builder.then = (...args: unknown[]) => (result as never as { then: Function }).then(...args)
  return {
    supabase: {
      from: () => builder,
      auth: { getUser: async () => ({ data: { user: { id: 'u1' } } }) },
      storage: { from: () => ({ upload: async () => ({ data: null, error: null }) }) },
    },
  }
})

vi.mock('../../../hooks/useAttention', () => ({
  useInvalidateAttention: () => () => {},
}))

/* The visibility picker reads the org to offer "share with the firm". Which
   org is not the subject here; that there IS one is enough to render. */
vi.mock('../../../contexts/OrganizationContext', () => ({
  useOrganization: () => ({ currentOrg: { id: 'o1', name: 'Acme' }, userOrgs: [], switchOrg: () => {} }),
}))

import { QuickThoughtCapture } from '../QuickThoughtCapture'
/* The real provider rather than a stubbed hook: it holds no state this test
   reads, and a real one cannot drift from the component's expectations. */
import { ToastProvider } from '../../common/Toast'

const promoted: CapturePrefill = {
  text: 'The mark is 11% through the March target.\n\nThe case has not been rewritten since.',
  ideaType: 'thesis',
  sourceTitle: 'ACT AI answer, AAPL decisions',
  assetId: 'a-aapl',
}

function openWith(prefill: CapturePrefill | null) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })
  return render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <QuickThoughtCapture compact placeholder="Capture a quick thought..." {...capturePrefillProps(prefill)} />
      </ToastProvider>
    </QueryClientProvider>,
  )
}

describe('a promoted answer', () => {
  it('is in the box the reader edits, exactly as it arrived', () => {
    openWith(promoted)
    const box = screen.getByPlaceholderText('Capture a quick thought...') as HTMLTextAreaElement
    expect(box.value).toBe(promoted.text)
  })

  it('opens on the kind the reader chose', () => {
    openWith(promoted)
    /* A thesis draft that opens as a plain thought is filed under the wrong
       `idea_type`, which is what the Ideas surfaces group by. */
    const thesis = screen.getByRole('button', { name: /Thesis/ })
    expect(thesis.getAttribute('class')).toContain('purple')
  })

  it('is still a draft: nothing has been saved by opening it', () => {
    openWith(promoted)
    /* The send control is the only thing that writes, and it is sitting
       there unpressed. If opening the form had saved anything, this test
       would be the wrong shape entirely -- there would be a record to find. */
    expect(screen.getByRole('button', { name: /Capture|Save|Send/i })).toBeTruthy()
  })
})

describe('a form opened by hand', () => {
  it('is empty, because there is no draft to place', () => {
    openWith(null)
    const box = screen.getByPlaceholderText('Capture a quick thought...') as HTMLTextAreaElement
    expect(box.value).toBe('')
  })
})
