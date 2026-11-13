/**
 * Attaching a real object to a conversation.
 *
 * The thing being tested is a distinction, not a widget: ACT AI's sources
 * come from the conversation's tags, and until now a reader could not add
 * one. So the questions here are whether the control writes a TYPED
 * reference, whether it can only offer objects the reader can already open,
 * and whether the three kinds of context stay apart on screen --
 *
 *   attached   the reader chose it, and can take it away
 *   inherited  the page the pane was opened from put it there
 *   mentioned  a name in the prose, which is deliberately not a chip
 *
 * The search hook is mocked because it reads four tables through RLS; what
 * matters here is that the component asks it for the four attachable types
 * and attaches exactly what it returns, never a name typed into the box.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const search = vi.hoisted(() => ({
  calls: [] as Array<{ query: string; types?: string[]; enabled?: boolean }>,
  results: [] as Array<{ id: string; type: string; title: string; subtitle?: string; data?: unknown }>,
  isLoading: false,
}))

vi.mock('../../../hooks/useEntitySearch', () => ({
  useEntitySearch: (opts: { query: string; types?: string[]; enabled?: boolean }) => {
    search.calls.push(opts)
    return {
      results: opts.enabled ? search.results : [],
      isLoading: opts.enabled ? search.isLoading : false,
      error: null,
    }
  },
  getEntityIcon: () => '',
  getEntityLabel: () => '',
  getEntityColor: () => '',
}))

import { AiContextAttach, ATTACHABLE_TYPES } from '../AiContextAttach'

const onAttach = vi.fn()
const onDetach = vi.fn()
const onOpenObject = vi.fn()

function attach(props: Partial<React.ComponentProps<typeof AiContextAttach>> = {}) {
  return render(
    <AiContextAttach
      attached={[{ type: 'asset', id: 'a-aapl', label: 'AAPL' }]}
      inheritedKeys={['asset:a-aapl']}
      labels={{}}
      onAttach={onAttach}
      onDetach={onDetach}
      {...props}
    />,
  )
}

const chips = () =>
  Array.from(document.querySelectorAll<HTMLElement>('[data-slot="ai-context-chip"]'))

beforeEach(() => {
  search.calls.length = 0
  search.results.length = 0
  search.isLoading = false
  onAttach.mockReset()
  onDetach.mockReset()
  onOpenObject.mockReset()
})

describe('what the row shows', () => {
  it('marks the page the pane was opened from as inherited, not as a choice', () => {
    attach()
    expect(chips()).toHaveLength(1)
    expect(chips()[0].getAttribute('data-attach-origin')).toBe('inherited')
    expect(chips()[0]).toHaveAttribute('title', expect.stringContaining('comes from the page'))
  })

  it('marks what the reader added as attached', () => {
    attach({
      attached: [
        { type: 'asset', id: 'a-aapl', label: 'AAPL' },
        { type: 'portfolio', id: 'p-1', label: 'Vision Fund' },
      ],
      inheritedKeys: ['asset:a-aapl'],
    })
    const [first, second] = chips()
    expect(first.getAttribute('data-attach-origin')).toBe('inherited')
    expect(second.getAttribute('data-attach-origin')).toBe('attached')
    expect(second).toHaveAttribute('title', expect.stringContaining('was added to this conversation'))
  })

  it('takes a label from the resolver when the tag carries none', () => {
    attach({
      attached: [{ type: 'theme', id: 't-1' }],
      inheritedKeys: [],
      labels: { 'theme:t-1': 'Power and cooling' },
    })
    expect(chips()[0]).toHaveTextContent('Power and cooling')
  })

  it('removes one on the readers say-so, inherited or not', async () => {
    attach()
    await userEvent.click(screen.getByRole('button', { name: 'Remove AAPL from this conversation' }))
    expect(onDetach).toHaveBeenCalledWith({ type: 'asset', id: 'a-aapl', label: 'AAPL' })
  })
})

describe('adding one', () => {
  it('searches only the four types the server can load', async () => {
    attach()
    await userEvent.click(screen.getByTestId('ai-context-add'))
    await userEvent.type(screen.getByTestId('ai-context-search'), 'vis')

    const last = search.calls[search.calls.length - 1]
    expect(last.types).toEqual([...ATTACHABLE_TYPES])
    /* The tag table's CHECK accepts these four and nothing else. Offering a
       trade idea here would draw a chip the retrieval layer cannot honour. */
    expect(last.types).toEqual(['asset', 'portfolio', 'theme', 'note'])
  })

  it('asks for nothing until there is something to search for', async () => {
    attach()
    expect(search.calls.every(c => c.enabled === false)).toBe(true)

    await userEvent.click(screen.getByTestId('ai-context-add'))
    await userEvent.type(screen.getByTestId('ai-context-search'), 'v')
    expect(search.calls[search.calls.length - 1].enabled).toBe(false)

    await userEvent.type(screen.getByTestId('ai-context-search'), 'i')
    expect(search.calls[search.calls.length - 1].enabled).toBe(true)
  })

  it('attaches the typed object the search returned, not the text typed', async () => {
    search.results.push({ id: 'p-vision', type: 'portfolio', title: 'Vision Fund', subtitle: '12 positions' })
    attach()
    await userEvent.click(screen.getByTestId('ai-context-add'))
    await userEvent.type(screen.getByTestId('ai-context-search'), 'vision')

    const results = screen.getByTestId('ai-context-results')
    await userEvent.click(within(results).getByText('Vision Fund'))

    /* An id and a type, from a record the search could read. A tag built from
       the words in the box would name an object that may not exist. */
    expect(onAttach).toHaveBeenCalledWith({ type: 'portfolio', id: 'p-vision', label: 'Vision Fund' })
  })

  it('says plainly when nothing the reader can open matches', async () => {
    attach()
    await userEvent.click(screen.getByTestId('ai-context-add'))
    await userEvent.type(screen.getByTestId('ai-context-search'), 'zzz')
    /* The search reads through the caller's own RLS, so "no results" means
       "nothing you can open", and the wording says so rather than implying
       the object does not exist. */
    expect(screen.getByTestId('ai-context-results'))
      .toHaveTextContent('Nothing you can open matches that.')
  })

  it('offers an already-attached object as unavailable rather than hiding it', async () => {
    search.results.push({ id: 'a-aapl', type: 'asset', title: 'AAPL' })
    attach()
    await userEvent.click(screen.getByTestId('ai-context-add'))
    await userEvent.type(screen.getByTestId('ai-context-search'), 'aapl')

    const candidate = screen.getByTestId('ai-context-results').querySelector('[data-slot="ai-context-candidate"]')!
    expect(candidate).toHaveTextContent('already added')
    expect(candidate).toBeDisabled()

    await userEvent.click(candidate)
    expect(onAttach).not.toHaveBeenCalled()
  })
})

describe('opening what a chip names', () => {
  it('makes an asset chip a link to the canonical page', async () => {
    attach({ onOpenObject, openable: t => t.type === 'asset' })
    await userEvent.click(screen.getByRole('button', { name: 'AAPL' }))
    expect(onOpenObject).toHaveBeenCalledWith({ type: 'asset', id: 'a-aapl', label: 'AAPL' })
  })

  it('leaves a type with no opener as plain text', () => {
    /* The inert-control rule: the application has `openAsset` and no
       equivalent single call for a portfolio, so that chip does not pretend
       to be a link. */
    attach({
      attached: [{ type: 'portfolio', id: 'p-1', label: 'Vision Fund' }],
      inheritedKeys: [],
      onOpenObject,
      openable: t => t.type === 'asset',
    })
    expect(screen.queryByRole('button', { name: 'Vision Fund' })).not.toBeInTheDocument()
    expect(chips()[0]).toHaveTextContent('Vision Fund')
  })

  it('leaves every chip as text when the host offers no opener at all', () => {
    attach({ onOpenObject: undefined })
    expect(screen.queryByRole('button', { name: 'AAPL' })).not.toBeInTheDocument()
  })
})
