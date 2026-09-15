import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

/**
 * The first-session coverage prompt, tested through the surface a user touches.
 *
 * The data layer and RLS are already covered by their own suites; what is worth
 * asserting here is the product behaviour the stage was defined by — that
 * suggestions are never silently saved, that a personal declaration cannot
 * carry organizational authority, and that the prompt stops asking once the
 * answer exists.
 */

// ── stubs ───────────────────────────────────────────────────────────────────

const addCalls: string[] = []
let coverageState: any
/*
 * The component saves through `addMany` now — one read and one insert for the
 * whole selection, rather than two round trips per name. The stub takes the
 * batch and records each id, so every assertion about WHAT reached the
 * coverage layer reads the same as it did.
 */
let addImpl: (assetIds: string[]) => Promise<number>

vi.mock('../../../hooks/useMyCoverage', () => ({
  useMyCoverage: () => ({ ...coverageState, addMany: addImpl }),
}))

vi.mock('../../../hooks/useAuth', () => ({
  useAuth: () => ({ user: { id: 'user-1', first_name: 'Ada', last_name: 'Lovelace' } }),
}))

vi.mock('../../../contexts/OrganizationContext', () => ({
  useOrganization: () => ({ currentOrgId: 'org-1' }),
}))

/**
 * Suggestion sources. `portfolio_holdings` returns a name the user does NOT
 * cover, which is the case the "never auto-save holdings" assertion needs.
 */
const HOLDING = { id: 'asset-hold', symbol: 'HOLD', company_name: 'Held Co', sector: 'Tech' }
const SECTOR  = { id: 'asset-sect', symbol: 'SECT', company_name: 'Sector Co', sector: 'Tech' }
const FOUND   = { id: 'asset-find', symbol: 'FIND', company_name: 'Found Co', sector: 'Tech' }

function stubTable(table: string) {
  const api: any = {
    select: () => api, eq: () => api, in: () => api, or: () => api,
    // The sector list filters out null sectors, so the stub needs `.not` or
    // that query throws and the Sectors tab silently has nothing in it.
    not: () => api,
    order: () => api, limit: () => api,
    maybeSingle: () => Promise.resolve({ data: { sector_focus: ['Tech'] }, error: null }),
    then: undefined,
  }
  const rows =
    table === 'portfolio_holdings' ? [{ asset_id: HOLDING.id, assets: HOLDING }]
    : table === 'coverage' ? []
    : table === 'assets' ? [SECTOR, FOUND]
    : []
  api.limit = () => Promise.resolve({ data: rows, error: null })
  api.order = () => api
  if (table === 'assets') api.or = () => ({ limit: () => Promise.resolve({ data: [FOUND], error: null }) })
  return api
}

vi.mock('../../../lib/supabase', () => ({
  supabase: { from: (t: string) => stubTable(t) },
}))

import { CoverageQuickStart } from '../CoverageQuickStart'
import { FirstSessionCoveragePrompt, resetCoverageSessionDecision } from '../FirstSessionCoveragePrompt'

const renderWithQuery = (ui: React.ReactElement) => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>)
}

beforeEach(() => {
  // The show-decision is latched per session, deliberately outliving a
  // remount — so it has to be cleared between tests.
  resetCoverageSessionDecision()
  addCalls.length = 0
  localStorage.clear()
  addImpl = async (assetIds: string[]) => { addCalls.push(...assetIds); return assetIds.length }
  coverageState = {
    rows: [], personal: [], assigned: [],
    assetIds: new Set<string>(), hasCoverage: false,
    isLoading: false, error: null, isMutating: false,
    remove: vi.fn(), setNotes: vi.fn(),
  }
})

// ── the prompt appears only when it should ─────────────────────────────────

describe('FirstSessionCoveragePrompt — when it renders', () => {
  it('offers the prompt to a user with no coverage', async () => {
    renderWithQuery(<FirstSessionCoveragePrompt />)
    expect(await screen.findByText('What do you follow?')).toBeInTheDocument()
  })

  /**
   * The nag test. A user who already covers things — including one invited
   * into a configured team, whose rows are all org-assigned — is never asked.
   */
  it('does not nag a user who already has coverage', () => {
    coverageState.hasCoverage = true
    coverageState.assetIds = new Set(['asset-hold'])
    const { container } = renderWithQuery(<FirstSessionCoveragePrompt />)
    expect(container).toBeEmptyDOMElement()
  })

  /**
   * Never flash the prompt at somebody who does have coverage while the query
   * is still resolving.
   */
  it('renders nothing while coverage is still loading', () => {
    coverageState.isLoading = true
    const { container } = renderWithQuery(<FirstSessionCoveragePrompt />)
    expect(container).toBeEmptyDOMElement()
  })

  it('stays dismissed after the user skips, across a remount', async () => {
    const user = userEvent.setup()
    const first = renderWithQuery(<FirstSessionCoveragePrompt />)
    await screen.findByText('What do you follow?')
    await user.click(screen.getByRole('button', { name: 'Not now' }))
    expect(screen.queryByText('What do you follow?')).not.toBeInTheDocument()
    first.unmount()

    const second = renderWithQuery(<FirstSessionCoveragePrompt />)
    await waitFor(() =>
      expect(second.container.querySelector('[data-slot="coverage-quick-start"]')).toBeNull())
  })

  /**
   * The regression that only real testing found, twice.
   *
   * The mobile dashboard renders this prompt from two places, and declaring
   * coverage now re-ranks the feed — which can flip the empty-feed branch and
   * swap one mount for the other. Because coverage exists by then, a remount
   * that re-decided from scratch would latch "already covered" and take the
   * confirmation off screen mid-read: rows written, user shown nothing.
   *
   * The mount is what changed, so the decision cannot belong to the mount.
   */
  it('survives a remount that happens after coverage lands', async () => {
    const first = renderWithQuery(<FirstSessionCoveragePrompt />)
    await screen.findByText('What do you follow?')
    first.unmount()

    // The world the second mount wakes up in: the save succeeded.
    coverageState.hasCoverage = true
    const second = renderWithQuery(<FirstSessionCoveragePrompt />)
    await waitFor(() =>
      expect(second.container.querySelector('[data-slot="coverage-quick-start"]')).not.toBeNull())
  })

  /**
   * Reported after graduating: the pilot saved coverage on the setup screen,
   * finished the mission, and the ideas feed — a different surface, mounted in
   * the same page load — asked "What do you follow?" again. The setup screen's
   * latched decision was reused by the feed's prompt.
   */
  it('does not ask again on the feed after coverage was saved on the pilot setup screen', async () => {
    const user = userEvent.setup()
    // The pilot setup screen: the only thing on screen, replaced by the mission.
    const setup = renderWithQuery(<FirstSessionCoveragePrompt variant="sheet" dismissible={false} confirmOnSave={false} />)
    await user.click(await screen.findByText('HOLD'))
    await user.click(screen.getByRole('button', { name: /Follow 1 name/ }))
    await waitFor(() => expect(addCalls).toEqual(['asset-hold']))
    // Held on screen until the surface above replaces it — no blank frame.
    expect(setup.container.querySelector('[data-slot="coverage-quick-start"]')).not.toBeNull()

    // The mission replaces it; later the pilot graduates and the feed mounts
    // its own prompt. Coverage exists.
    setup.unmount()
    coverageState.hasCoverage = true
    const feed = renderWithQuery(<FirstSessionCoveragePrompt variant="sheet" />)
    await new Promise(r => setTimeout(r, 20))
    expect(feed.container.querySelector('[data-slot="coverage-quick-start"]')).toBeNull()
  })

  /**
   * Refresh after saving must not re-prompt. Simulated by the state the app
   * would be in on the next mount: rows exist.
   */
  it('does not re-prompt on a fresh mount once coverage exists', () => {
    coverageState.hasCoverage = true
    const { container } = renderWithQuery(<FirstSessionCoveragePrompt />)
    expect(container.querySelector('[data-slot="coverage-quick-start"]')).toBeNull()
  })
})

// ── suggestions are suggestions ────────────────────────────────────────────

describe('CoverageQuickStart — suggestions are never silently saved', () => {
  it('offers holdings as candidates', async () => {
    renderWithQuery(<CoverageQuickStart />)
    expect(await screen.findByText('HOLD')).toBeInTheDocument()
    /* The source is named for what it is — a seeded pilot workspace's sample
       book, not the reader's own positions — and each row names the portfolio
       it is actually in rather than repeating a generic label. */
    expect(screen.getByText('Preloaded portfolio')).toBeInTheDocument()
  })

  /**
   * The one that matters. A position is a fact about a portfolio; coverage is a
   * claim about attention. Rendering the prompt must write nothing.
   */
  it('writes nothing on render, however many suggestions there are', async () => {
    renderWithQuery(<CoverageQuickStart />)
    await screen.findByText('HOLD')
    expect(addCalls).toEqual([])
  })

  it('writes nothing when a suggestion is merely selected', async () => {
    const user = userEvent.setup()
    renderWithQuery(<CoverageQuickStart />)
    await user.click(await screen.findByText('HOLD'))
    expect(addCalls).toEqual([])
  })

  it('saves only after the user explicitly confirms', async () => {
    const user = userEvent.setup()
    renderWithQuery(<CoverageQuickStart />)
    await user.click(await screen.findByText('HOLD'))
    await user.click(screen.getByRole('button', { name: /Follow 1 name/ }))
    await waitFor(() => expect(addCalls).toEqual(['asset-hold']))
  })

  it('keeps the save button inert until something is selected', async () => {
    renderWithQuery(<CoverageQuickStart />)
    await screen.findByText('HOLD')
    expect(screen.getByRole('button', { name: 'Follow' })).toBeDisabled()
  })
})

// ── a personal declaration cannot assert authority ─────────────────────────

describe('CoverageQuickStart — no governed fields are reachable', () => {
  /**
   * Stage 3.5 closed owner reassignment; follow-up B leaves `role` free text.
   * The recorded Stage 4 constraint is that the first version must not let a
   * user choose a role at all, and must never offer "Lead Analyst".
   */
  it('exposes no role, lead, team, analyst or organization control', async () => {
    const { container } = renderWithQuery(<CoverageQuickStart />)
    await screen.findByText('HOLD')

    const text = container.textContent ?? ''
    for (const forbidden of ['Lead Analyst', 'Role', 'Team', 'Primary', 'Secondary']) {
      expect(text).not.toContain(forbidden)
    }
    /* Exactly one text input — the search box, which is now always present
       rather than hidden behind a Companies tab — and no select at all. The
       point is unchanged: there is nowhere here to type a role, a team or an
       analyst name. */
    expect(container.querySelectorAll('input')).toHaveLength(1)
    expect(container.querySelector('input')).toHaveAttribute(
      'data-slot', 'coverage-quick-start-search',
    )
    expect(container.querySelectorAll('select')).toHaveLength(0)

    // Browsing by sector adds no control of any other kind either.
    fireEvent.click(screen.getByText('Sectors'))
    expect(container.querySelectorAll('input')).toHaveLength(1)
    expect(container.querySelectorAll('select')).toHaveLength(0)
  })

  /**
   * The write path takes an asset id and nothing else. There is no signature
   * through which the surface could send a role, a team or another user.
   */
  it('passes only asset ids to the coverage layer', async () => {
    const user = userEvent.setup()
    const add = vi.fn(async (ids: string[]) => ids.length)
    addImpl = add
    renderWithQuery(<CoverageQuickStart />)
    await user.click(await screen.findByText('HOLD'))
    await user.click(screen.getByRole('button', { name: /Follow 1 name/ }))
    await waitFor(() => expect(add).toHaveBeenCalledTimes(1))
    /* One call for the whole selection, carrying ids and nothing else. The
       analyst name, the lane and the organization are the data layer's to
       supply; a picker that could send them is a picker that could send the
       wrong ones. */
    expect(add).toHaveBeenCalledWith(['asset-hold'])
  })
})

// ── after save ─────────────────────────────────────────────────────────────

describe('CoverageQuickStart — after save', () => {
  /**
   * Confirming no longer REPLACES the picker.
   *
   * It used to, so a reader who declared four names had no way to declare a
   * fifth without leaving and coming back — survivable while the coverage
   * manager was one click away, and not survivable on the pilot home, where it
   * is not reachable at all. The confirmation is a line above the picker now
   * and the picker is still there underneath it.
   */
  it('confirms without taking the picker away', async () => {
    const user = userEvent.setup()
    renderWithQuery(<CoverageQuickStart />)
    await user.click(await screen.findByText('HOLD'))
    await user.click(screen.getByRole('button', { name: /Follow 1 name/ }))

    expect(await screen.findByText(/Following 1 name/)).toBeInTheDocument()
    // Still able to add more, which is the point.
    expect(screen.getByText('What do you follow?')).toBeInTheDocument()
    expect(screen.getByText('Sectors')).toBeInTheDocument()
  })

  /**
   * The defect this whole final pass existed to catch, reproduced on staging
   * with a MutationObserver: about a second after the confirm is pressed, the
   * mobile dashboard replaces the subtree this prompt lives in, because saving
   * coverage re-ranks the feed. The child's `savedCount` went with it and the
   * reader was shown the SELECTION screen again — rows written, question
   * re-asked.
   *
   * A remount is simulated the only honest way: throw the tree away and build
   * a new one, exactly as React does.
   */
  it('keeps the confirmation across a remount caused by the feed re-ranking', async () => {
    const user = userEvent.setup()
    const first = renderWithQuery(<FirstSessionCoveragePrompt />)
    await user.click(await screen.findByText('HOLD'))
    await user.click(screen.getByRole('button', { name: /Follow 1 name/ }))
    expect(await screen.findByText(/Following 1 name/)).toBeInTheDocument()

    // The feed re-ranks and the subtree is swapped. Coverage now exists.
    first.unmount()
    coverageState.hasCoverage = true

    const second = renderWithQuery(<FirstSessionCoveragePrompt />)
    expect(await screen.findByText(/Following 1 name/)).toBeInTheDocument()
    expect(second.container.querySelector('[data-slot="coverage-quick-start-done"]')).not.toBeNull()
  })

  it('reports the count it actually saved', async () => {
    const user = userEvent.setup()
    renderWithQuery(<CoverageQuickStart />)
    await user.click(await screen.findByText('HOLD'))
    await user.click(await screen.findByText('SECT'))
    await user.click(screen.getByRole('button', { name: /Follow 2 names/ }))
    expect(await screen.findByText(/Following 2 names/)).toBeInTheDocument()
  })

  /**
   * A failed write has to say something useful and keep the selection, so the
   * user can retry rather than rebuild it.
   */
  it('surfaces a useful error and keeps the selection', async () => {
    const user = userEvent.setup()
    addImpl = async () => { throw new Error('Network request failed.') }
    renderWithQuery(<CoverageQuickStart />)
    await user.click(await screen.findByText('HOLD'))
    await user.click(screen.getByRole('button', { name: /Follow 1 name/ }))

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Network request failed.')
    expect(alert).toHaveTextContent(/try again/i)
    // Still selected, so retry does not mean re-picking.
    expect(screen.getByRole('button', { name: /Follow 1 name/ })).toBeEnabled()
  })
})

// ── already-covered names ──────────────────────────────────────────────────

describe('CoverageQuickStart — names already followed', () => {
  it('shows them as followed and refuses to re-select them', async () => {
    const user = userEvent.setup()
    coverageState.assetIds = new Set([HOLDING.id])
    renderWithQuery(<CoverageQuickStart />)
    await screen.findByText('HOLD')

    expect(screen.getByText('Following')).toBeInTheDocument()
    await user.click(screen.getByText('HOLD'))
    expect(screen.getByRole('button', { name: 'Follow' })).toBeDisabled()
    expect(addCalls).toEqual([])
  })
})

// ── both shells share one state ────────────────────────────────────────────

describe('CoverageQuickStart — one component, two shells', () => {
  it.each([['card'], ['sheet']] as const)('renders the same question in the %s variant', async (variant) => {
    renderWithQuery(<CoverageQuickStart variant={variant} />)
    expect(await screen.findByText('What do you follow?')).toBeInTheDocument()
  })

  /**
   * Desktop and mobile differ in density and nothing else: both read the same
   * hook and write the same rows, which is what makes coverage declared on a
   * phone present on the desktop without a second state machine.
   */
  it('drives both variants from the same coverage state', () => {
    coverageState.hasCoverage = true
    const card = renderWithQuery(<FirstSessionCoveragePrompt variant="card" />)
    expect(card.container).toBeEmptyDOMElement()
    card.unmount()
    const sheet = renderWithQuery(<FirstSessionCoveragePrompt variant="sheet" />)
    expect(sheet.container).toBeEmptyDOMElement()
  })
})

/*
 * ── Finding a name you already have in mind ────────────────────────────────
 *
 * Search was one of three sources, so it was reachable only by first pressing
 * a Companies tab: the reader had to tell the card what KIND of thing they
 * were about to do before they could do it. The box is always present now and
 * takes over the list whenever it has anything in it.
 */
describe('CoverageQuickStart — search', () => {
  it('can be typed into without choosing a mode first', async () => {
    const user = userEvent.setup()
    const { container } = renderWithQuery(<CoverageQuickStart />)
    await screen.findByText('HOLD')

    const box = container.querySelector('[data-slot="coverage-quick-start-search"]')
    expect(box).not.toBeNull()
    await user.type(box as HTMLElement, 'FIND')
    expect(await screen.findByText('FIND')).toBeInTheDocument()
  })

  /** While there is a query, the list is the results — not the browse list. */
  it('takes the list over, and hands it back when cleared', async () => {
    const user = userEvent.setup()
    const { container } = renderWithQuery(<CoverageQuickStart />)
    await screen.findByText('HOLD')

    const box = container.querySelector('[data-slot="coverage-quick-start-search"]') as HTMLElement
    await user.type(box, 'FIND')
    await waitFor(() => expect(screen.queryByText('HOLD')).toBeNull())
    // The browse chips go with it: the list is not the reader's to choose.
    expect(container.querySelector('[data-slot="coverage-quick-start-sources"]')).toBeNull()

    await user.click(screen.getByLabelText('Clear search'))
    expect(await screen.findByText('HOLD')).toBeInTheDocument()
    expect(container.querySelector('[data-slot="coverage-quick-start-sources"]')).not.toBeNull()
  })

  /**
   * A name selected from search survives clearing it. The staged set is the
   * reader's answer, not a property of whichever list produced it.
   */
  it('keeps a staged name after the search is cleared', async () => {
    const user = userEvent.setup()
    const { container } = renderWithQuery(<CoverageQuickStart />)
    await screen.findByText('HOLD')

    const box = container.querySelector('[data-slot="coverage-quick-start-search"]') as HTMLElement
    await user.type(box, 'FIND')
    await user.click(await screen.findByText('FIND'))
    await user.click(screen.getByLabelText('Clear search'))

    expect(screen.getByRole('button', { name: /Follow 1 name/ })).toBeInTheDocument()
  })
})

/*
 * ── Two states that drew the same mark ─────────────────────────────────────
 *
 * A name the reader already follows and one they have just staged both drew a
 * filled primary check, so a list of names they already followed looked like a
 * list they had just selected.
 */
describe('CoverageQuickStart — followed is not selected', () => {
  it('marks them differently', async () => {
    const user = userEvent.setup()
    coverageState.assetIds = new Set(['asset-hold'])
    coverageState.hasCoverage = true
    const { container } = renderWithQuery(<CoverageQuickStart />)

    await screen.findByText('HOLD')
    await user.click(screen.getByText('Sectors'))
    const rows = () => [...container.querySelectorAll('[data-slot="coverage-quick-start-option"]')]

    // Back to the suggestions, where the followed name is.
    await user.click(screen.getByText('Preloaded portfolio'))
    const followed = rows().find(r => r.textContent?.includes('HOLD'))!
    expect(followed.getAttribute('data-selected')).toBe('false')
    expect(followed.querySelector('.bg-primary-500')).toBeNull()
  })
})

/*
 * ── One fact, one representation ───────────────────────────────────────────
 *
 * A staged name could be shown four ways at once: a ticked row, a tinted row,
 * a removable chip in a cloud below the list, and a count. Selecting forty
 * names therefore made the screen busier the further the reader got, and the
 * chip cloud grew until it pushed the button off the screen.
 */
describe('CoverageQuickStart — the selection is shown once', () => {
  it('has no chip cloud under the list', async () => {
    const user = userEvent.setup()
    const { container } = renderWithQuery(<CoverageQuickStart />)
    await user.click(await screen.findByText('HOLD'))

    expect(container.querySelector('[data-slot="coverage-selected-chip"]')).toBeNull()
    expect(container.querySelector('[data-slot="coverage-quick-start-selection"]')).toBeNull()
  })

  /** The tick carries the state; the row stays a row. */
  it('does not paint a block behind every staged name', async () => {
    const user = userEvent.setup()
    const { container } = renderWithQuery(<CoverageQuickStart />)
    await user.click(await screen.findByText('HOLD'))

    const row = container.querySelector('[data-slot="coverage-quick-start-option"][data-selected="true"]')!
    expect(row).not.toBeNull()
    expect(row.className).not.toContain('bg-primary-50')
    // The mark itself still says so.
    expect(row.querySelector('.bg-primary-500')).not.toBeNull()
  })

  it('keeps one count, beside the one action', async () => {
    const user = userEvent.setup()
    const { container } = renderWithQuery(<CoverageQuickStart />)
    await user.click(await screen.findByText('HOLD'))

    const status = container.querySelector('[data-slot="coverage-quick-start-status"]')!
    expect(status.textContent).toBe('1 selected')
    expect(screen.getByRole('button', { name: /Follow 1 name/ })).toBeInTheDocument()
  })
})

/*
 * ── Browsing a sector ──────────────────────────────────────────────────────
 *
 * "Add all 0" was a live-looking control that could do nothing, and the way
 * back out of a sector was styled like a second call to action competing with
 * it.
 */
describe('CoverageQuickStart — sector browsing', () => {
  const openSector = async (user: ReturnType<typeof userEvent.setup>) => {
    await user.click(screen.getByText('Sectors'))
    await user.click(await screen.findByText('Tech'))
  }

  /**
   * The name, and nothing appended to it. A selected count lived here too,
   * which at 390px truncated the sector name in order to repeat a number the
   * footer already owns.
   */
  it('names the open sector and leaves counting to the footer', async () => {
    const user = userEvent.setup()
    const { container } = renderWithQuery(<CoverageQuickStart />)
    await screen.findByText('HOLD')
    await openSector(user)

    const title = () => container.querySelector('[data-slot="coverage-quick-start-list-title"]')!.textContent
    expect(title()).toBe('Tech')
    await user.click(await screen.findByText('SECT'))
    expect(title()).toBe('Tech')
    expect(container.querySelector('[data-slot="coverage-quick-start-status"]')!.textContent)
      .toBe('1 selected')
  })

  /** Nothing left to add is a finished state, not a disabled button. */
  it('replaces Add all with a completed state once nothing remains', async () => {
    const user = userEvent.setup()
    const { container } = renderWithQuery(<CoverageQuickStart />)
    await screen.findByText('HOLD')
    await openSector(user)

    await user.click(await screen.findByRole('button', { name: /Add all/ }))
    expect(container.querySelector('[data-slot="coverage-add-sector"]')).toBeNull()
    expect(container.querySelector('[data-slot="coverage-sector-complete"]')).not.toBeNull()
  })

  it('offers a way back that reads as navigation', async () => {
    const user = userEvent.setup()
    const { container } = renderWithQuery(<CoverageQuickStart />)
    await screen.findByText('HOLD')
    await openSector(user)

    const back = container.querySelector('[data-slot="coverage-sector-back"]')! as HTMLElement
    expect(back.className).not.toContain('bg-primary-600')
    await user.click(back)
    expect(await screen.findByText('Tech')).toBeInTheDocument()
  })
})

/*
 * ── Loading keeps the shape ────────────────────────────────────────────────
 *
 * The list region had a ceiling and no floor, so it was one line tall while a
 * query was in flight and fifty rows tall a moment later. Opening a sector
 * threw the footer half a screen down the page.
 */
describe('CoverageQuickStart — loading geometry', () => {
  it('reserves the list region rather than collapsing it', () => {
    const { container } = renderWithQuery(<CoverageQuickStart />)
    const region = container.querySelector('[data-slot="coverage-quick-start-list-title"]')!
      .parentElement!.nextElementSibling!
    expect(region.className).toMatch(/min-h-\[/)
  })

  /** Rows, not a spinner: the reader is about to read a list. */
  it('draws rows while the first list is in flight', () => {
    const { container } = renderWithQuery(<CoverageQuickStart />)
    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull()
    expect(container.querySelectorAll('.animate-pulse').length).toBeGreaterThan(3)
  })

  it('never blanks the card while it loads', () => {
    const { container } = renderWithQuery(<CoverageQuickStart />)
    expect(screen.getByText('What do you follow?')).toBeInTheDocument()
    expect(container.querySelector('[data-slot="coverage-quick-start-search"]')).not.toBeNull()
    expect(container.querySelector('[data-slot="coverage-quick-start-save"]')).not.toBeNull()
  })
})

/*
 * ── Saving ─────────────────────────────────────────────────────────────────
 *
 * The write is the only thing that changes state. The list, the ticks and the
 * card all stay, so a save never looks like a navigation.
 */
describe('CoverageQuickStart — saving', () => {
  it('keeps the selection on screen and moves only the button', async () => {
    const user = userEvent.setup()
    let release: (n: number) => void = () => {}
    addImpl = (ids: string[]) => new Promise<number>(res => {
      release = () => res(ids.length)
    })

    const { container } = renderWithQuery(<CoverageQuickStart />)
    await user.click(await screen.findByText('HOLD'))
    await user.click(screen.getByRole('button', { name: /Follow 1 name/ }))

    expect(await screen.findByRole('button', { name: /Following/ })).toBeInTheDocument()
    // Still selected, still listed, card intact.
    expect(container.querySelector('[data-slot="coverage-quick-start-option"][data-selected="true"]')).not.toBeNull()
    expect(screen.getByText('What do you follow?')).toBeInTheDocument()

    release(1)
    await waitFor(() =>
      expect(container.querySelector('[data-slot="coverage-quick-start-done"]')).not.toBeNull())
  })
})

/*
 * ── The first-run save has no middle ───────────────────────────────────────
 *
 * On the pilot home, declaring coverage is what replaces this card with the
 * mission. The confirmation panel rendered there for exactly one refetch of
 * `my-coverage` and was then thrown away — a success screen nobody had time
 * to read, arriving between the write and the screen the write was for. The
 * selection cleared and the button dropped back to a disabled "Follow" in the
 * same frame, which was a second intermediate state for the same round trip.
 *
 * Everywhere the card survives its own save, the confirmation is the only
 * feedback there is, and it stays.
 */
describe('CoverageQuickStart — confirmOnSave', () => {
  const saveOne = async (user: ReturnType<typeof userEvent.setup>) => {
    await user.click(await screen.findByText('HOLD'))
    await user.click(screen.getByRole('button', { name: /Follow 1 name/ }))
  }

  it('holds the selection and the button when the card is about to be replaced', async () => {
    const user = userEvent.setup()
    const { container } = renderWithQuery(<CoverageQuickStart confirmOnSave={false} />)
    await saveOne(user)

    await waitFor(() => expect(addCalls).toEqual(['asset-hold']))
    // No success panel, and nothing un-ticked itself.
    expect(container.querySelector('[data-slot="coverage-quick-start-done"]')).toBeNull()
    expect(container.querySelector('[data-slot="coverage-quick-start-option"][data-selected="true"]')).not.toBeNull()
    expect(screen.getByRole('button', { name: /Following/ })).toBeInTheDocument()
  })

  /** Where nothing replaces the card, the confirmation is all the reader gets. */
  it('still confirms in place by default', async () => {
    const user = userEvent.setup()
    const { container } = renderWithQuery(<CoverageQuickStart />)
    await saveOne(user)

    expect(await screen.findByText(/Following 1 name/)).toBeInTheDocument()
    expect(container.querySelector('[data-slot="coverage-quick-start-done"]')).not.toBeNull()
  })

  /** A failure always comes back, whichever surface it is on. */
  it('releases the button and keeps the selection when the write fails', async () => {
    const user = userEvent.setup()
    addImpl = async () => { throw new Error('Nope') }
    const { container } = renderWithQuery(<CoverageQuickStart confirmOnSave={false} />)
    await saveOne(user)

    expect(await screen.findByRole('alert')).toHaveTextContent('Nope')
    expect(screen.getByRole('button', { name: /Follow 1 name/ })).toBeEnabled()
    expect(container.querySelector('[data-slot="coverage-quick-start-option"][data-selected="true"]')).not.toBeNull()
  })
})

describe('the pilot home lets the mission be the confirmation', () => {
  const read = (p: string) =>
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    require('node:fs').readFileSync(require('node:path').join(process.cwd(), 'src', p), 'utf8')

  it.each([
    ['desktop', 'pages/DashboardPage.tsx'],
    ['mobile', 'components/mobile/MobilePilotHome.tsx'],
  ])('%s suppresses the in-place confirmation', (_name, file) => {
    expect(read(file)).toContain('confirmOnSave={false}')
  })
})
