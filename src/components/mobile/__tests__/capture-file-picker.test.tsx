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
    // The lists arm reads `(is_default OR organization_id)`, which is the
    // predicate the migration specifies.
    api.or = () => api
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

  it('reads lists by the predicate the migration wrote down', () => {
    /*
      This is the acceptance failure. The picker used
      `.eq('organization_id', currentOrgId)`, and
      `20260603160000_asset_lists_organization_id` deliberately leaves two
      kinds of row org-NULL: the two system-seeded default lists every user
      gets on signup, and every list that predates the migration. A pilot who
      has never hand-made a list owns exactly those two, so an equality filter
      returned an empty picker while the desktop button showed them.

      The migration states the correct read as
      `(is_default = TRUE) OR (organization_id = X)`. `useListSurfaces` and
      `AssetListManager` already use it.
    */
    expect(picker).toContain('.or(`is_default.eq.true,organization_id.eq.${currentOrgId!}`)')
    expect(picker).not.toMatch(/eq\('organization_id', currentOrgId!\)\s*\.eq\('created_by'/)
  })

  it('applies the same rule to shared lists', () => {
    // A default list shared with you is still org-NULL; dropping it on the
    // join side would reintroduce the bug one arm over.
    expect(picker).toContain('l.is_default === true || l.organization_id === currentOrgId')
  })

  it('matches how the rest of the product reads this table', () => {
    const surfaces = readFileSync(
      resolve(__dirname, '../../../hooks/lists/useListSurfaces.ts'), 'utf8',
    )
    expect(surfaces).toContain('is_default.eq.true,organization_id.eq.')
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

/**
 * Filing into MORE THAN ONE destination, which is the normal case.
 *
 * ── The defect this pins ──────────────────────────────────────────────────
 *
 * The picker treated one add as the end of the task: it set a tick and closed
 * itself 550ms later. An asset belongs in several lists far more often than in
 * exactly one, so filing into three meant opening the same sheet three times,
 * re-finding the asset's action each time, and having no way to tell which of
 * the three had already been done — the rows looked identical before and after.
 *
 * The rows are membership rows now. A row says whether the asset is in that
 * destination, adding flips it, and the sheet stays open until dismissed.
 */
describe('filing into several destinations is one visit', () => {
  it('stays open after the first add', async () => {
    rows = [{ id: 'l1', name: 'Watchlist' }, { id: 'l2', name: 'Semis' }]
    const { onDone } = view()
    await waitFor(() => expect(screen.getByText('Watchlist')).toBeTruthy())

    fireEvent.click(screen.getByText('Watchlist').closest('button')!)
    await waitFor(() => expect(screen.getAllByText('Added').length).toBe(1))

    // Long enough that the 550ms auto-close this replaced would have fired.
    await new Promise(resolve => setTimeout(resolve, 700))

    expect(onDone).not.toHaveBeenCalled()
    expect(screen.getByText('Semis')).toBeTruthy()
  })

  it('takes a second destination without reopening anything', async () => {
    rows = [{ id: 'l1', name: 'Watchlist' }, { id: 'l2', name: 'Semis' }]
    view()
    await waitFor(() => expect(screen.getByText('Watchlist')).toBeTruthy())

    fireEvent.click(screen.getByText('Watchlist').closest('button')!)
    await waitFor(() => expect(inserted.length).toBe(1))
    fireEvent.click(screen.getByText('Semis').closest('button')!)

    await waitFor(() => expect(inserted.length).toBe(2))
    expect(inserted.map(i => i.payload.list_id)).toEqual(['l1', 'l2'])
  })

  it('shows which destinations it is already in', async () => {
    rows = [{ id: 'l1', name: 'Watchlist' }, { id: 'l2', name: 'Semis' }]
    view()
    await waitFor(() => expect(screen.getByText('Watchlist')).toBeTruthy())

    // Before: two invitations to add.
    expect(screen.getAllByText('Add')).toHaveLength(2)

    fireEvent.click(screen.getByText('Watchlist').closest('button')!)

    // After: one membership and one invitation.
    await waitFor(() => expect(screen.getAllByText('Added')).toHaveLength(1))
    expect(screen.getAllByText('Add')).toHaveLength(1)
  })

  it('cannot file the same destination twice', async () => {
    rows = [{ id: 'l1', name: 'Watchlist' }]
    view()
    await waitFor(() => expect(screen.getByText('Watchlist')).toBeTruthy())
    const row = screen.getByText('Watchlist').closest('button')!

    fireEvent.click(row)
    await waitFor(() => expect(row.getAttribute('aria-pressed')).toBe('true'))
    fireEvent.click(row)
    fireEvent.click(row)

    expect(row).toBeDisabled()
    expect(inserted).toHaveLength(1)
  })

  it('confirms once, not once per add', async () => {
    rows = [{ id: 'l1', name: 'Watchlist' }, { id: 'l2', name: 'Semis' }]
    view()
    await waitFor(() => expect(screen.getByText('Watchlist')).toBeTruthy())

    fireEvent.click(screen.getByText('Watchlist').closest('button')!)
    await waitFor(() => expect(toasts).toHaveLength(1))
    fireEvent.click(screen.getByText('Semis').closest('button')!)
    await waitFor(() => expect(inserted).toHaveLength(2))

    // The rows themselves say what happened. A toast per add is the spam this
    // avoids, and three of them would cover the sheet being filed from.
    expect(toasts).toHaveLength(1)
  })

  it('does not close itself on a timer', () => {
    expect(picker).not.toContain('setTimeout(onDone')
  })

  it('keeps the sheet open after creating a destination too', async () => {
    rows = []
    const { onDone } = view()
    await waitFor(() => expect(screen.getByPlaceholderText(/Search lists/)).toBeTruthy())
    fireEvent.change(screen.getByPlaceholderText(/Search lists/), { target: { value: 'Semis' } })

    fireEvent.click(screen.getByText('Semis').closest('button')!)

    await waitFor(() => expect(inserted.length).toBe(2))
    expect(onDone).not.toHaveBeenCalled()
  })

  it('does the same on the theme target, from the same code', async () => {
    rows = [{ id: 't1', name: 'AI infrastructure' }, { id: 't2', name: 'Power' }]
    const { onDone } = view('theme')
    await waitFor(() => expect(screen.getByText('AI infrastructure')).toBeTruthy())

    fireEvent.click(screen.getByText('AI infrastructure').closest('button')!)
    await waitFor(() => expect(inserted.length).toBe(1))
    fireEvent.click(screen.getByText('Power').closest('button')!)

    await waitFor(() => expect(inserted.length).toBe(2))
    expect(onDone).not.toHaveBeenCalled()
    expect(toasts).toHaveLength(1)
  })

  it('does not infer membership from optimistic state alone', async () => {
    // The rows the picker starts from are the rows the database returns; the
    // set of "just added" ids only ever ADDS to that, so a failed insert cannot
    // leave a row claiming a membership that does not exist.
    expect(picker).toContain('existing.has(o.id)')
    expect(picker).toContain('justAdded.has(o.id)')
  })

  it('keeps the destinations on screen when an add fails', () => {
    // The error used to replace the list, so recovering meant starting over.
    expect(picker).toContain('add.isError || createAndAdd.isError')
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
