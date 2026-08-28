import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
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
let addImpl: (assetId: string) => Promise<void>

vi.mock('../../../hooks/useMyCoverage', () => ({
  useMyCoverage: () => ({ ...coverageState, add: addImpl }),
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
  addImpl = async (assetId: string) => { addCalls.push(assetId) }
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
    expect(screen.getByText('In your book')).toBeInTheDocument()
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
    expect(screen.getByRole('button', { name: 'Select names to follow' })).toBeDisabled()
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
    // One text input only — the search box.
    expect(container.querySelectorAll('input')).toHaveLength(1)
    expect(container.querySelectorAll('select')).toHaveLength(0)
  })

  /**
   * The write path takes an asset id and nothing else. There is no signature
   * through which the surface could send a role, a team or another user.
   */
  it('passes only an asset id to the coverage layer', async () => {
    const user = userEvent.setup()
    const add = vi.fn(async () => {})
    addImpl = add
    renderWithQuery(<CoverageQuickStart />)
    await user.click(await screen.findByText('HOLD'))
    await user.click(screen.getByRole('button', { name: /Follow 1 name/ }))
    await waitFor(() => expect(add).toHaveBeenCalledTimes(1))
    expect(add).toHaveBeenCalledWith('asset-hold')
  })
})

// ── after save ─────────────────────────────────────────────────────────────

describe('CoverageQuickStart — after save', () => {
  it('confirms concisely and offers the way into Ideas', async () => {
    const user = userEvent.setup()
    const onGoToIdeas = vi.fn()
    renderWithQuery(<CoverageQuickStart onGoToIdeas={onGoToIdeas} />)
    await user.click(await screen.findByText('HOLD'))
    await user.click(screen.getByRole('button', { name: /Follow 1 name/ }))

    expect(await screen.findByText('Following 1 name')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /See what/ }))
    expect(onGoToIdeas).toHaveBeenCalledTimes(1)
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
    expect(await screen.findByText('Following 1 name')).toBeInTheDocument()

    // The feed re-ranks and the subtree is swapped. Coverage now exists.
    first.unmount()
    coverageState.hasCoverage = true

    const second = renderWithQuery(<FirstSessionCoveragePrompt />)
    expect(await screen.findByText('Following 1 name')).toBeInTheDocument()
    expect(second.container.querySelector('[data-slot="coverage-quick-start-done"]')).not.toBeNull()
    // And emphatically NOT back to asking the question.
    expect(screen.queryByText('What do you follow?')).not.toBeInTheDocument()
  })

  it('reports the count it actually saved', async () => {
    const user = userEvent.setup()
    renderWithQuery(<CoverageQuickStart />)
    await user.click(await screen.findByText('HOLD'))
    await user.click(await screen.findByText('SECT'))
    await user.click(screen.getByRole('button', { name: /Follow 2 names/ }))
    expect(await screen.findByText('Following 2 names')).toBeInTheDocument()
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
    expect(screen.getByRole('button', { name: 'Select names to follow' })).toBeDisabled()
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
