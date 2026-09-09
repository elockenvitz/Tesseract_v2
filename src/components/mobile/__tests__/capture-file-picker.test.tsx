/**
 * Filing an asset into a list or a theme, from a phone.
 *
 * ── The defects this pins ─────────────────────────────────────────────────
 *
 * 1. HALF THE LISTS WERE MISSING. The picker asked for `created_by = me` and
 *    nothing else, while the desktop `AddToListButton`, looking at the same
 *    asset, fetched owned lists AND lists shared through
 *    `asset_list_collaborations`. Filing from a phone therefore showed a
 *    shorter list than filing from a laptop, with no sign anything was absent.
 *
 * 2. THEMES WERE NOT SCOPED TO THE ORGANISATION AT ALL. The themes query
 *    carried no `organization_id` filter, so a user in more than one
 *    organisation was offered every organisation's themes. Every other themes
 *    query in the product filters on it.
 *
 * 3. NOTHING SAID IT HAD WORKED. Success set a tick that the closing sheet
 *    took with it 550ms later, and offered no route to the thing just filed
 *    into. "Did that work, and where did it go" had no answer.
 *
 * 4. AN EMPTY SEARCH WAS A DEAD END. Typing the name of a list that did not
 *    exist produced "No lists match" and nothing else, so filing a new idea
 *    meant leaving the feed to make the list first — the round trip this sheet
 *    exists to remove.
 *
 * ── Why the queries are asserted against source ───────────────────────────
 *
 * The component's claims are about WHICH ROWS IT ASKS FOR, and a stubbed
 * Supabase proves only that the stub was called. The scoping is read off the
 * component; the behaviour around it is rendered and clicked.
 */

import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const picker = readFileSync(resolve(__dirname, '../CaptureFilePicker.tsx'), 'utf8')
const desktopList = readFileSync(
  resolve(__dirname, '../../lists/AddToListButton.tsx'), 'utf8',
)

let rows: any[] = []
let shared: any[] = []
const inserted: { table: string; payload: any }[] = []
const toasts: { message: string; action?: { label: string; onClick: () => void } }[] = []

vi.mock('../../../hooks/useAuth', () => ({ useAuth: () => ({ user: { id: 'u1' } }) }))
vi.mock('../../../contexts/OrganizationContext', () => ({
  useOrganizationOptional: () => ({ currentOrgId: 'org-1' }),
}))
vi.mock('../../common/Toast', () => ({
  useToast: () => ({
    success: (message: string, opts?: any) => { toasts.push({ message, action: opts?.action }) },
    error: () => {}, info: () => {}, warning: () => {}, showToast: () => {}, hideToast: () => {}, toasts: [],
  }),
}))
vi.mock('../../../lib/supabase', () => {
  const table = (name: string) => {
    const api: any = {}
    api.select = () => api
    api.eq = () => api
    api.order = () => api
    api.limit = () => Promise.resolve({
      data: name === 'asset_list_collaborations' ? shared : rows, error: null,
    })
    api.insert = (payload: any) => {
      inserted.push({ table: name, payload })
      const ins: any = {}
      ins.select = () => ins
      ins.single = () => Promise.resolve({ data: { id: 'new-1' }, error: null })
      ins.then = (res: any) => Promise.resolve({ data: null, error: null }).then(res)
      return ins
    }
    // `existing` reads end at `.eq(...)`, so make the chain thenable.
    api.then = (res: any) => Promise.resolve({ data: [], error: null }).then(res)
    return api
  }
  return { supabase: { from: table } }
})

import { CaptureFilePicker } from '../CaptureFilePicker'

afterEach(() => { cleanup(); rows = []; shared = []; inserted.length = 0; toasts.length = 0 })

function view(target: 'list' | 'theme' = 'list') {
  const onDone = vi.fn()
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <CaptureFilePicker target={target} assetId="a1" assetSymbol="AMZN" onDone={onDone} />
    </QueryClientProvider>,
  )
  return { onDone }
}

describe('the phone offers the same lists the desktop does', () => {
  it('asks for shared lists as well as owned ones', () => {
    expect(picker).toContain("from('asset_list_collaborations')")
    // The same table the desktop button reads, so the two cannot disagree
    // about what "my lists" means.
    expect(desktopList).toContain("from('asset_list_collaborations')")
  })

  it('keeps the organisation filter on both arms', () => {
    // `created_by` alone is not a tenant filter, and the collaboration arm
    // could otherwise reach across organisations.
    expect(picker).toContain("eq('organization_id', currentOrgId!)")
    expect(picker).toContain('l.organization_id === currentOrgId')
  })

  it('deduplicates a list that is both owned and collaborated on', () => {
    expect(picker).toContain('new Map([...(((owned.data as any[]) ?? [])), ...sharedLists].map(l => [l.id, l]))')
  })

  it('scopes themes to the organisation, which it never did', () => {
    const at = picker.indexOf("from('themes')")
    expect(picker.slice(at, at + 300)).toContain("eq('organization_id', currentOrgId!)")
  })
})

describe('opening the action does not open the keyboard', () => {
  it('autofocuses nothing', async () => {
    // A selection action shows destinations first. The keyboard belongs to
    // search and to naming a new one, both of which the reader asks for.
    view()
    await waitFor(() => expect(screen.getByPlaceholderText(/Search lists/)).toBeTruthy())

    expect(picker).not.toContain('autoFocus')
    expect(document.activeElement).toBe(document.body)
  })
})

describe('the existing destinations render', () => {
  it('lists what came back', async () => {
    rows = [{ id: 'l1', name: 'Watchlist', color: '#f00' }, { id: 'l2', name: 'Compounders' }]
    view()

    await waitFor(() => expect(screen.getByText('Watchlist')).toBeTruthy())
    expect(screen.getByText('Compounders')).toBeTruthy()
  })

  it('narrows on search without needing a fetch', async () => {
    rows = [{ id: 'l1', name: 'Watchlist' }, { id: 'l2', name: 'Compounders' }]
    view()
    await waitFor(() => expect(screen.getByText('Watchlist')).toBeTruthy())

    fireEvent.change(screen.getByPlaceholderText(/Search lists/), { target: { value: 'comp' } })

    expect(screen.queryByText('Watchlist')).toBeNull()
    expect(screen.getByText('Compounders')).toBeTruthy()
  })
})

describe('an empty search is no longer a dead end', () => {
  it('offers to create what was typed', async () => {
    rows = [{ id: 'l1', name: 'Watchlist' }]
    view()
    await waitFor(() => expect(screen.getByText('Watchlist')).toBeTruthy())

    fireEvent.change(screen.getByPlaceholderText(/Search lists/), { target: { value: 'Semis' } })

    expect(screen.getByText('Semis')).toBeTruthy()
  })

  it('offers nothing to create before anything is typed', async () => {
    rows = [{ id: 'l1', name: 'Watchlist' }]
    view()
    await waitFor(() => expect(screen.getByText('Watchlist')).toBeTruthy())

    expect(screen.queryByText(/^Create/)).toBeNull()
  })

  it('does not invite a duplicate of a name that already exists', async () => {
    rows = [{ id: 'l1', name: 'Watchlist' }]
    view()
    await waitFor(() => expect(screen.getByText('Watchlist')).toBeTruthy())

    fireEvent.change(screen.getByPlaceholderText(/Search lists/), { target: { value: 'watchlist' } })

    expect(screen.queryByText(/^Create/)).toBeNull()
  })

  it('creates and files in one act, with the desktop payload', async () => {
    rows = []
    view()
    await waitFor(() => expect(screen.getByPlaceholderText(/Search lists/)).toBeTruthy())
    fireEvent.change(screen.getByPlaceholderText(/Search lists/), { target: { value: 'Semis' } })

    fireEvent.click(screen.getByText('Semis').closest('button')!)

    await waitFor(() => expect(inserted.length).toBe(2))
    expect(inserted[0]).toEqual({
      table: 'asset_lists',
      // Org explicitly, not left to a trigger the call site cannot show.
      payload: { name: 'Semis', created_by: 'u1', list_type: 'mutual', organization_id: 'org-1' },
    })
    expect(inserted[1].table).toBe('asset_list_items')
  })
})

describe('a successful file says so, and offers the way in', () => {
  it('confirms by name', async () => {
    rows = [{ id: 'l1', name: 'Watchlist' }]
    const { onDone } = view()
    await waitFor(() => expect(screen.getByText('Watchlist')).toBeTruthy())

    fireEvent.click(screen.getByText('Watchlist').closest('button')!)

    await waitFor(() => expect(toasts).toHaveLength(1))
    expect(toasts[0].message).toBe('Added to Watchlist')
    expect(onDone).not.toHaveBeenCalled()
  })

  it('offers View list, and opens it only when asked', async () => {
    rows = [{ id: 'l1', name: 'Watchlist' }]
    const events: any[] = []
    const listener = (e: Event) => events.push((e as CustomEvent).detail)
    window.addEventListener('navigate-to-list', listener)
    view()
    await waitFor(() => expect(screen.getByText('Watchlist')).toBeTruthy())

    fireEvent.click(screen.getByText('Watchlist').closest('button')!)
    await waitFor(() => expect(toasts).toHaveLength(1))

    // Nothing has navigated yet: the reader was capturing from a feed.
    expect(events).toHaveLength(0)
    expect(toasts[0].action?.label).toBe('View list')

    toasts[0].action!.onClick()
    window.removeEventListener('navigate-to-list', listener)
    expect(events).toEqual([{ id: 'l1', name: 'Watchlist' }])
  })

  it('says Theme, and fires the theme event, on the theme target', async () => {
    rows = [{ id: 't1', name: 'AI infrastructure' }]
    const events: any[] = []
    const listener = (e: Event) => events.push((e as CustomEvent).detail)
    window.addEventListener('navigate-to-theme', listener)
    view('theme')
    await waitFor(() => expect(screen.getByText('AI infrastructure')).toBeTruthy())

    fireEvent.click(screen.getByText('AI infrastructure').closest('button')!)
    await waitFor(() => expect(toasts).toHaveLength(1))

    expect(toasts[0].message).toBe('Added to AI infrastructure')
    expect(toasts[0].action?.label).toBe('View theme')
    toasts[0].action!.onClick()
    window.removeEventListener('navigate-to-theme', listener)
    expect(events).toEqual([{ id: 't1', name: 'AI infrastructure' }])
  })

  it('uses the product toast rather than a second notification system', () => {
    expect(picker).toContain("import { useToast } from '../common/Toast'")
  })
})

describe('the shell makes no width or viewport assumption', () => {
  it('adds no bare vh sizing', () => {
    expect(picker).not.toMatch(/\b(?:max-|min-)?h-\[\d+vh\]/)
  })

  it('assumes no desktop width', () => {
    const wide = [...picker.matchAll(/w-\[(\d+)px\]/g)].filter(m => Number(m[1]) >= 300)
    expect(wide.map(m => m[0])).toEqual([])
  })

  it('owns one scrolling region', () => {
    expect(picker.match(/overflow-y-auto/g) ?? []).toHaveLength(1)
  })
})
