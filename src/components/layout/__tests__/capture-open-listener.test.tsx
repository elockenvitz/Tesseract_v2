/**
 * The hop that had been broken since the action catalogue was written.
 *
 * ── The defect this pins ──────────────────────────────────────────────────
 *
 * `openThoughtsCapture` has carried a prefill for as long as the ACT AI
 * action catalogue has existed. Layout's listener pulled four fields off
 * `event.detail` and dropped the rest, so every prefill ever dispatched --
 * including the one behind the AI's own "draft a prompt" action -- reached
 * nothing. The form opened empty and the reader retyped what the model had
 * already written.
 *
 * ── Why this renders the real `Layout` and the real store ─────────────────
 *
 * The parser (`lib/capture/prefill`) is unit-tested and the consumer
 * (`ThoughtsSection`) is tested with a stub form. Between them sat the one
 * hop that was actually wrong, and it is a `window` listener inside a
 * component nothing had ever mounted. A test that rebuilt the listener in the
 * test file -- which is how `capture-draft.test` observes Layout's drawer
 * ordering -- cannot fail when the real listener changes, and the real
 * listener is exactly what was broken.
 *
 * So: the real `Layout`, the real `useSidebarStore`, the real parser, and a
 * stubbed `CommunicationPane` reporting the store state Layout put it in.
 * Everything between the event and the form's props is the code that ships.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, act, cleanup } from '@testing-library/react'
import { dispatchCaptureOpen, CAPTURE_OPEN_EVENT } from '../../../lib/capture/prefill'

/* The chrome, reduced to nothing: none of it is the subject. */
vi.mock('../Header', () => ({ Header: () => <div data-testid="header" /> }))
vi.mock('../TabManager', () => ({ TabManager: () => <div data-testid="tab-strip" /> }))
vi.mock('../../notifications/NotificationPane', () => ({ NotificationPane: () => null }))
vi.mock('../../mobile/MobileNavDrawer', () => ({ MobileNavDrawer: () => null }))
vi.mock('../../mobile/OverflowAuditOverlay', () => ({ OverflowAuditOverlay: () => null }))
vi.mock('../../../lib/supabase', () => ({
  supabase: { from: () => ({ select: () => ({ ilike: () => ({ limit: () => ({ data: [] }) }) }) }) },
}))
vi.mock('../../../lib/engagement', () => ({ subscribeToEngagement: () => () => {} }))
vi.mock('../../../hooks/useNotifications', () => ({
  useNotifications: () => ({ hasUnreadNotifications: false }),
}))
vi.mock('../../../contexts/OrganizationContext', () => ({
  useOrganization: () => ({ isOrgArchived: false, currentOrgId: 'o1' }),
}))
vi.mock('../../../hooks/useMediaQuery', () => ({ useIsMobile: () => false }))

/*
 * The pane, reporting what the REAL store holds.
 *
 * `sidebarStore` is deliberately not mocked: the prefill's journey is parser
 * -> `openCaptureSidebar` -> store -> form, and a mocked store would leave
 * the middle of that unobserved. The four values reported here are the ones
 * `ThoughtsSection` reads, so reporting them is reporting what the form will
 * be handed.
 */
vi.mock('../../communication/CommunicationPane', async () => {
  const { useSidebarStore } = await import('../../../stores/sidebarStore')
  return {
    CommunicationPane: ({ isOpen, view }: any) => {
      const mode = useSidebarStore(s => s.sidebarMode)
      const captureType = useSidebarStore(s => s.pendingCaptureType)
      const prefill = useSidebarStore(s => s.pendingCapturePrefill)
      return (
        <div
          data-testid="pane"
          data-open={isOpen ? 'yes' : 'no'}
          data-view={view ?? ''}
          data-mode={mode}
          data-capture-type={captureType ?? ''}
          data-prefill-text={prefill?.text ?? ''}
          data-prefill-type={prefill?.ideaType ?? ''}
          data-prefill-source={prefill?.sourceTitle ?? ''}
          data-prefill-asset={prefill?.assetId ?? ''}
        />
      )
    },
  }
})

import { Layout } from '../Layout'
import { useSidebarStore } from '../../../stores/sidebarStore'

const TABS = [{ id: 't-home', title: 'Ideas', type: 'today', data: null } as any]
const Page = () => <div data-testid="page" />

function renderShell() {
  render(
    <Layout
      tabs={TABS}
      activeTabId="t-home"
      onTabChange={() => {}}
      onTabClose={() => {}}
      onNewTab={() => {}}
      onTabReorder={() => {}}
      onSearchResult={() => {}}
    >
      <Page />
    </Layout>,
  )
}

const at = (name: string) => screen.getByTestId('pane').getAttribute(name)
const send = (detail: unknown) =>
  act(() => { window.dispatchEvent(new CustomEvent(CAPTURE_OPEN_EVENT, { detail })) })

/* The real store is a module singleton, so each case starts it clean. */
beforeEach(() => {
  act(() => { useSidebarStore.getState().closeSidebar() })
})
afterEach(cleanup)

/** What `AiKeep` dispatches when a reader keeps an answer. */
const KEEP = {
  captureType: 'idea' as const,
  prefill: {
    text: 'The target was set in March and the book is 10.8% through it.',
    ideaType: 'research_idea' as const,
    sourceTitle: 'ACT AI answer, AAPL target review',
  },
}

describe('a kept answer reaches the form', () => {
  it('carries the words, the type and where they came from', () => {
    renderShell()
    act(() => { dispatchCaptureOpen(KEEP) })

    expect(at('data-prefill-text')).toBe(KEEP.prefill.text)
    expect(at('data-prefill-type')).toBe('research_idea')
    expect(at('data-prefill-source')).toBe(KEEP.prefill.sourceTitle)
  })

  it('opens the capture form on the type that was asked for', () => {
    renderShell()
    act(() => { dispatchCaptureOpen(KEEP) })

    expect(at('data-mode')).toBe('capture')
    expect(at('data-capture-type')).toBe('idea')
  })

  it('brings the pane into view on the thoughts side', () => {
    renderShell()
    act(() => { dispatchCaptureOpen(KEEP) })

    expect(at('data-open')).toBe('yes')
    expect(at('data-view')).toBe('thoughts')
  })

  it('binds the record to the asset the answer was about', () => {
    renderShell()
    act(() => {
      dispatchCaptureOpen({ ...KEEP, prefill: { ...KEEP.prefill, assetId: 'a-aapl' } })
    })

    expect(at('data-prefill-asset')).toBe('a-aapl')
  })

  it('replaces an earlier prefill rather than keeping the first', () => {
    /* Two keeps in one sitting. The second must not open on the first
       answer's words. */
    renderShell()
    act(() => { dispatchCaptureOpen(KEEP) })
    act(() => {
      dispatchCaptureOpen({ ...KEEP, prefill: { ...KEEP.prefill, text: 'A second answer.' } })
    })

    expect(at('data-open')).toBe('yes')
    expect(at('data-prefill-text')).toBe('A second answer.')
  })

  it('records the context the answer came from when one is given', () => {
    renderShell()
    send({ ...KEEP, contextType: 'asset', contextId: 'a-aapl', contextTitle: 'AAPL' })

    expect(at('data-prefill-text')).toBe(KEEP.prefill.text)
    expect(at('data-open')).toBe('yes')
  })
})

describe('what the listener will not pass on', () => {
  it('does nothing at all for a detail that is not a request', () => {
    renderShell()
    send(null)

    expect(at('data-open')).toBe('no')
    expect(at('data-prefill-text')).toBe('')
  })

  it('does nothing for an array, which carries none of the fields', () => {
    renderShell()
    send([])

    expect(at('data-open')).toBe('no')
  })

  it('opens the picker rather than guessing at an unknown form', () => {
    /* An unrecognised type is not a reason to refuse to open -- failing to
       open is unrecoverable from the reader's side -- but it IS a reason to
       pick no form and carry no draft. */
    renderShell()
    send({ captureType: 'invoice', prefill: KEEP.prefill })

    expect(at('data-open')).toBe('yes')
    expect(at('data-capture-type')).toBe('')
    expect(at('data-prefill-text')).toBe('')
  })

  it('opens a form that cannot show a prefill without one', () => {
    /*
     * Only the idea form renders a prefilled body. A trade idea or a prompt
     * opens empty, so the parser drops the text rather than letting a surface
     * claim a draft it never displays.
     */
    renderShell()
    send({ captureType: 'trade_idea', prefill: KEEP.prefill })

    expect(at('data-open')).toBe('yes')
    expect(at('data-capture-type')).toBe('trade_idea')
    expect(at('data-prefill-text')).toBe('')
  })

  it('opens empty when the words are blank', () => {
    renderShell()
    send({ captureType: 'idea', prefill: { ...KEEP.prefill, text: '   ' } })

    expect(at('data-capture-type')).toBe('idea')
    expect(at('data-prefill-text')).toBe('')
  })

  it('refuses a draft with no stated source', () => {
    /* A draft on screen with no attribution is a sentence the reader cannot
       trace back, so the text goes with the source. */
    renderShell()
    send({ captureType: 'idea', prefill: { text: KEEP.prefill.text, ideaType: 'thought' } })

    expect(at('data-prefill-text')).toBe('')
    expect(at('data-prefill-source')).toBe('')
  })
})

describe('the conversation survives a trip to an object', () => {
  it('stays open when a reference opens a tab behind it', () => {
    /*
     * Pressing a reference chip dispatches a tab descriptor on the shell's
     * own channel (`lib/ai/reference-targets`). Nothing in that path touches
     * pane state, and `Layout` renders the pane unconditionally rather than
     * conditionally, so the thread -- and anything typed into it -- is still
     * there when the reader comes back. Asserted here because the opposite
     * is a silent loss: a conditional pane would pass every other test in
     * this file.
     */
    renderShell()
    act(() => { dispatchCaptureOpen(KEEP) })
    expect(at('data-open')).toBe('yes')

    act(() => {
      window.dispatchEvent(new CustomEvent('decision-engine-action', {
        detail: { id: 'p-core', title: 'Core Equity', type: 'portfolio', data: { id: 'p-core' } },
      }))
    })

    expect(at('data-open')).toBe('yes')
    expect(at('data-prefill-text')).toBe(KEEP.prefill.text)
  })
})

describe('the listener belongs to the shell', () => {
  it('stops answering the event once Layout unmounts', () => {
    renderShell()
    cleanup()
    act(() => { dispatchCaptureOpen(KEEP) })

    expect(useSidebarStore.getState().pendingCapturePrefill).toBeNull()
  })
})
