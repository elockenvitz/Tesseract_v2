/**
 * Process on a phone: the two ways out of it.
 *
 * Both of these were dead ends, and both were reachable in one tap from the
 * default phone view, so they are covered together.
 *
 *  1. The process list is a full-screen overlay on a phone. `All processes`
 *     opened it and nothing ever closed it — `setProcessListOpen(false)` did
 *     not exist anywhere in the page. A pilot who tapped it had to kill the
 *     app.
 *
 *  2. The `Configure` tab trigger had no `onClick`; its menu was revealed by
 *     `group-hover`. Touch has no hover, so Scope, Stages, Scheduling, Files
 *     and Access — five of the nine views — could not be opened at all.
 *
 * The assertions below are about reachability, not appearance: can the overlay
 * be dismissed, and can each Configure destination actually be selected.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent, within } from '@testing-library/react'

const env = vi.hoisted(() => ({ isMobile: true }))

vi.mock('../../hooks/useMediaQuery', () => ({
  useIsMobile: () => env.isMobile,
  useMediaQuery: () => env.isMobile,
}))

/*
  Stable identities, shared by every mocked hook. These are only ever read from
  inside a closure the page calls during render, so plain consts are safe
  alongside vi.mock's hoisting.
*/
const EMPTY: never[] = []
const NOOP = () => {}
const MUTATION = { mutate: NOOP, mutateAsync: async () => {}, isPending: false, isError: false, error: null }
const QUERY_CLIENT = {
  invalidateQueries: NOOP, setQueryData: NOOP, getQueryData: () => undefined,
  prefetchQuery: async () => {}, cancelQueries: async () => {}, removeQueries: NOOP,
}

const WORKFLOWS = [
  {
    id: 'w-1', name: 'Quarterly Review', description: 'Quarterly cycle', color: '#3b82f6',
    is_default: false, is_public: true, created_by: 'u1',
    created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z',
    cadence_days: 90, cadence_timeframe: 'quarterly', usage_count: 2,
    active_assets: 1, completed_assets: 0, scope_type: 'portfolio',
    user_permission: 'admin', stages: [],
  },
  {
    id: 'w-2', name: 'Earnings Watch', description: 'Earnings cycle', color: '#f59e0b',
    is_default: false, is_public: true, created_by: 'u1',
    created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z',
    cadence_days: 30, cadence_timeframe: 'monthly', usage_count: 1,
    active_assets: 0, completed_assets: 0, scope_type: 'general',
    user_permission: 'admin', stages: [],
  },
]

/*
  Every result is cached by query key and handed back by identity.

  Returning a fresh `{ data: [] }` per call is what a naive mock does, and it
  hangs this page: several effects depend on query data, so a new array
  identity on every render schedules another render forever. The first version
  of this file exhausted the heap before a single assertion ran.
*/
const queryResults = new Map<string, unknown>()
vi.mock('@tanstack/react-query', () => ({
  useQuery: (opts: any) => {
    const key = JSON.stringify(opts?.queryKey ?? [])
    if (!queryResults.has(key)) {
      const data = key.includes('workflows-full') ? WORKFLOWS : EMPTY
      queryResults.set(key, { data, isLoading: false, isError: false, error: null, refetch: NOOP })
    }
    return queryResults.get(key)
  },
  useMutation: () => MUTATION,
  useQueryClient: () => QUERY_CLIENT,
}))

vi.mock('../../lib/supabase', () => ({
  supabase: { from: () => ({}), rpc: async () => ({ data: null, error: null }) },
}))
vi.mock('../../hooks/useAuth', () => ({ useAuth: () => ({ user: { id: 'u1' } }) }))
vi.mock('../../contexts/OrganizationContext', () => ({
  useOrganization: () => ({ currentOrgId: 'org-1' }),
}))
vi.mock('../../hooks/useEntityOrgResolver', () => ({ useEntityOrgResolver: () => ({ data: null }) }))
// `canCreate` on, so the pinned primary CTA (Start Run) actually renders and
// its reachability can be asserted rather than assumed.
vi.mock('../../hooks/workflow/useCreateRunAction', () => ({
  useCreateRunAction: () => ({
    canCreate: true, isDisabled: false, disabledReason: null,
    createRun: () => {}, isPending: false,
  }),
}))

// The nine views and every modal are irrelevant to reachability — what matters
// is which one the page asks for. Each stands in as a labelled marker.
vi.mock('../../components/workflow/views', () => ({
  OverviewView: () => <div data-testid="view-overview" />,
  StagesView: () => <div data-testid="view-stages" />,
  UniverseView: () => <div data-testid="view-scope" />,
  ModelsView: () => <div data-testid="view-models" />,
  AdminsView: () => <div data-testid="view-admins" />,
  CadenceView: () => <div data-testid="view-cadence" />,
  BranchesView: () => <div data-testid="view-branches" />,
  RecurringProcessesHomePanel: () => <div data-testid="home-panel" />,
  RunDetailPanel: () => null,
  RunHistoryTable: () => null,
  RunStatusStrip: () => null,
}))
vi.mock('../../components/workflow/modals', () => ({
  AddStageModal: () => null, EditStageModal: () => null, AddChecklistItemModal: () => null,
  EditChecklistItemModal: () => null, InviteUserModal: () => null, AddStakeholderModal: () => null,
  AddAdminModal: () => null, AccessRequestModal: () => null, AddRuleModal: () => null,
  EditRuleModal: () => null, AddAssetPopulationRuleModal: () => null, AddBranchEndingRuleModal: () => null,
}))
vi.mock('../../components/workflow/CreateWorkflowWizard', () => ({ CreateWorkflowWizard: () => null }))
vi.mock('../../components/workflow/SimplifiedUniverseBuilder', () => ({ SimplifiedUniverseBuilder: () => null }))
vi.mock('../../components/ui/WorkflowManager', () => ({ WorkflowManager: () => null }))
vi.mock('../../components/ui/ContentTileManager', () => ({ ContentTileManager: () => null }))
vi.mock('../../components/modals/CreateBranchModal', () => ({ CreateBranchModal: () => null }))
vi.mock('../../components/modals/UniversePreviewModal', () => ({ UniversePreviewModal: () => null }))
vi.mock('../../components/modals/TemplateVersionsModal', () => ({ TemplateVersionsModal: () => null }))
vi.mock('../../components/modals/CreateVersionModal', () => ({ CreateVersionModal: () => null }))
vi.mock('../../components/modals/VersionCreatedModal', () => ({ VersionCreatedModal: () => null }))
vi.mock('../../components/modals/VersionDetailModal', () => ({ VersionDetailModal: () => null }))
vi.mock('../../components/common/OrgSwitchBanner', () => ({ OrgSwitchBanner: () => null }))
vi.mock('../../components/common/OrgBadge', () => ({ OrgBadge: () => null }))

import { readFileSync } from 'node:fs'
import path from 'node:path'

import { WorkflowsPage, clampMenuToViewport } from '../WorkflowsPage'

const SOURCE = readFileSync(
  path.join(process.cwd(), 'src/pages/WorkflowsPage.tsx'),
  'utf8',
)

/** Pin the viewport jsdom reports, so clamping has something real to clamp to. */
function setViewport(width: number, height: number) {
  Object.defineProperty(window, 'innerWidth', { value: width, configurable: true })
  Object.defineProperty(window, 'innerHeight', { value: height, configurable: true })
}

const processList = () => screen.queryByRole('dialog', { name: 'Processes' })
const openListButton = () => screen.queryByRole('button', { name: /All processes/ })
const configTrigger = () => screen.getByRole('button', { name: /Configure|Scope|Stages|Scheduling|Files|Access/ })

/** Open the overlay and pick `Quarterly Review` from it. */
function selectFirstProcess() {
  fireEvent.click(openListButton()!)
  const list = processList()!
  fireEvent.click(within(list).getByText('Quarterly Review'))
}

describe('Process on a phone — the process list overlay', () => {
  beforeEach(() => {
    env.isMobile = true
    sessionStorage.clear()
  })
  afterEach(cleanup)

  it('starts closed, with a button offering it', () => {
    render(<WorkflowsPage />)
    expect(processList()).toBeNull()
    expect(openListButton()).not.toBeNull()
  })

  it('opens the overlay when All processes is tapped', () => {
    render(<WorkflowsPage />)
    fireEvent.click(openListButton()!)
    expect(processList()).not.toBeNull()
  })

  it('closes again from its own close button — the fix for the dead end', () => {
    render(<WorkflowsPage />)
    fireEvent.click(openListButton()!)
    const close = within(processList()!).getByRole('button', { name: 'Close process list' })
    fireEvent.click(close)
    expect(processList()).toBeNull()
    // And the way back in is offered again.
    expect(openListButton()).not.toBeNull()
  })

  it('closes when Escape is pressed', () => {
    render(<WorkflowsPage />)
    fireEvent.click(openListButton()!)
    expect(processList()).not.toBeNull()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(processList()).toBeNull()
  })

  it('closes when a process is selected, rather than covering it', () => {
    render(<WorkflowsPage />)
    selectFirstProcess()
    expect(processList()).toBeNull()
  })

  it('gives the overlay a labelled modal role so it is not an anonymous layer', () => {
    render(<WorkflowsPage />)
    fireEvent.click(openListButton()!)
    expect(processList()).toHaveAttribute('aria-modal', 'true')
  })

  it('is a column rather than an overlay on desktop, with no open button', () => {
    env.isMobile = false
    render(<WorkflowsPage />)
    expect(openListButton()).toBeNull()
    // Rendered, but not as a dialog — it is part of the layout.
    expect(screen.queryByRole('dialog', { name: 'Processes' })).toBeNull()
    expect(screen.getByText('Quarterly Review')).toBeTruthy()
  })
})

describe('Process on a phone — the Configure menu', () => {
  beforeEach(() => {
    env.isMobile = true
    sessionStorage.clear()
  })
  afterEach(cleanup)

  it('is closed until it is tapped, and needs no hover to open', () => {
    render(<WorkflowsPage />)
    selectFirstProcess()

    const trigger = configTrigger()
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('menu')).toBeNull()

    // No mouseEnter — a tap alone must open it.
    fireEvent.click(trigger)
    expect(trigger).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('menu')).not.toBeNull()
  })

  it('closes on a second tap', () => {
    render(<WorkflowsPage />)
    selectFirstProcess()
    fireEvent.click(configTrigger())
    expect(screen.queryByRole('menu')).not.toBeNull()
    fireEvent.click(configTrigger())
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('closes on Escape and on an outside tap', () => {
    render(<WorkflowsPage />)
    selectFirstProcess()

    // Assert the menu is open before asserting it shuts. Without this, a
    // trigger that never opens at all would satisfy both closes and the test
    // would pass on a page where Configure is completely dead.
    fireEvent.click(configTrigger())
    expect(screen.getByRole('menu')).not.toBeNull()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('menu')).toBeNull()

    fireEvent.click(configTrigger())
    expect(screen.getByRole('menu')).not.toBeNull()
    fireEvent.mouseDown(document.body)
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it.each([
    ['Scope', 'view-scope'],
    ['Stages', 'view-stages'],
    ['Scheduling', 'view-cadence'],
    ['Files', 'view-models'],
    ['Access', 'view-admins'],
  ])('reaches %s by tap alone, and closes the menu on the way', (label, testId) => {
    render(<WorkflowsPage />)
    selectFirstProcess()

    fireEvent.click(configTrigger())
    fireEvent.click(within(screen.getByRole('menu')).getByText(label))

    expect(screen.getByTestId(testId)).toBeTruthy()
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('omits Scope for a general-scope process, and still reaches the other four', () => {
    render(<WorkflowsPage />)
    fireEvent.click(openListButton()!)
    fireEvent.click(within(processList()!).getByText('Earnings Watch'))

    fireEvent.click(configTrigger())
    const menu = screen.getByRole('menu')
    expect(within(menu).queryByText('Scope')).toBeNull()
    for (const label of ['Stages', 'Scheduling', 'Files', 'Access']) {
      expect(within(menu).getByText(label)).toBeTruthy()
    }
  })

  it('names the active view on the trigger once one is chosen', () => {
    render(<WorkflowsPage />)
    selectFirstProcess()

    fireEvent.click(configTrigger())
    fireEvent.click(within(screen.getByRole('menu')).getByText('Stages'))

    expect(screen.getByRole('button', { name: /Stages/ })).toBeTruthy()
  })
})

/*
  The workspace chrome around the process, at phone width.

  The header was one non-wrapping `justify-between` row with no `min-w-0`, so
  the process name's intrinsic width pushed Start Run / Archive / Delete off
  the right edge of a clipped page. The two inline editors were hardcoded to
  400px — wider than the viewport itself. None of this is measurable in jsdom,
  which has no layout engine, so these assert the two things that are: that the
  controls are present and operable, and that the responsive contract which
  keeps them on screen is actually declared.
*/
describe('Process on a phone — header chrome', () => {
  beforeEach(() => {
    env.isMobile = true
    sessionStorage.clear()
  })
  afterEach(cleanup)

  const actionTray = () => document.querySelector('[data-slot="process-header-actions"]')!

  it('keeps every header action in the DOM and clickable', () => {
    render(<WorkflowsPage />)
    selectFirstProcess()

    const tray = actionTray()
    // The primary run action and the secondary archive action both survive.
    expect(within(tray as HTMLElement).getByRole('button', { name: /Start Run/ })).toBeTruthy()
    expect(within(tray as HTMLElement).getByRole('button', { name: /Archive/ })).toBeTruthy()
  })

  it('lets the action tray wrap instead of overflowing, and does not re-fix the row', () => {
    render(<WorkflowsPage />)
    selectFirstProcess()

    const cls = actionTray().className
    expect(cls).toContain('flex-wrap')
    // Desktop keeps its single row.
    expect(cls).toContain('sm:flex-nowrap')
    expect(cls).toContain('sm:shrink-0')
    // A fixed width here would recreate the original overflow.
    expect(cls).not.toMatch(/\bw-\[\d/)
    expect((actionTray() as HTMLElement).style.width).toBe('')
  })

  it('stacks identity above actions on a phone and restores the row at sm', () => {
    render(<WorkflowsPage />)
    selectFirstProcess()

    const row = actionTray().parentElement!
    expect(row.className).toContain('flex-col')
    expect(row.className).toContain('sm:flex-row')
    // Without min-w-0 the title cannot shrink and the tray is pushed out again.
    expect(row.className).toContain('min-w-0')
  })

  it('gives the header actions a real tap target below sm', () => {
    render(<WorkflowsPage />)
    selectFirstProcess()

    const tray = actionTray() as HTMLElement
    for (const button of Array.from(tray.querySelectorAll('button'))) {
      expect(button.className).toContain('max-sm:min-h-[44px]')
    }
  })
})

describe('Process on a phone — inline name and description editors', () => {
  beforeEach(() => {
    env.isMobile = true
    sessionStorage.clear()
  })
  afterEach(cleanup)

  it('opens the name editor at the column width, not a hardcoded 400px', () => {
    render(<WorkflowsPage />)
    selectFirstProcess()

    fireEvent.click(screen.getByRole('heading', { name: /Quarterly Review/ }))
    const input = screen.getByDisplayValue('Quarterly Review') as HTMLInputElement

    expect(input.style.width).toBe('')
    expect(input.className).toContain('w-full')
    expect(input.className).toContain('sm:w-[400px]')
  })

  it('opens the description editor the same way', () => {
    render(<WorkflowsPage />)
    selectFirstProcess()

    fireEvent.click(screen.getByText('Quarterly cycle'))
    const input = screen.getByDisplayValue('Quarterly cycle') as HTMLInputElement

    expect(input.style.width).toBe('')
    expect(input.className).toContain('w-full')
    expect(input.className).toContain('sm:w-[400px]')
  })

  it('has no hardcoded 400px width left anywhere in the page', () => {
    // A ratchet, not a restatement: the two editors above are the ones that
    // existed, and this catches a third being added the same way.
    expect(SOURCE).not.toMatch(/width:\s*['"]400px['"]/)
  })
})

describe('clampMenuToViewport', () => {
  const W = 160
  const H = 80

  it('leaves a menu that already fits exactly where it was opened', () => {
    expect(clampMenuToViewport(100, 200, W, H, 390, 844)).toEqual({ left: 100, top: 200 })
  })

  it('pulls a menu opened near the right edge back on screen', () => {
    // 380 + 160 would end at 540 in a 390px viewport.
    expect(clampMenuToViewport(380, 100, W, H, 390, 844).left).toBe(390 - W - 8)
  })

  it('pulls a menu opened near the bottom edge back on screen', () => {
    expect(clampMenuToViewport(100, 840, W, H, 390, 844).top).toBe(844 - H - 8)
  })

  it('pins to the top-left rather than off the other side when the viewport is smaller than the menu', () => {
    expect(clampMenuToViewport(10, 10, W, H, 100, 60)).toEqual({ left: 8, top: 8 })
  })

  it('never returns a negative coordinate for a pointer at the origin', () => {
    const { left, top } = clampMenuToViewport(0, 0, W, H, 390, 844)
    expect(left).toBeGreaterThanOrEqual(0)
    expect(top).toBeGreaterThanOrEqual(0)
  })
})

describe('Process on a phone — the workflow context menu', () => {
  beforeEach(() => {
    env.isMobile = true
    sessionStorage.clear()
    setViewport(390, 844)
  })
  afterEach(cleanup)

  const contextMenu = () => document.querySelector('[data-slot="workflow-context-menu"]') as HTMLElement | null

  it('stays inside the viewport when opened at the right edge', () => {
    render(<WorkflowsPage />)
    fireEvent.click(openListButton()!)

    const row = within(processList()!).getByText('Quarterly Review')
    fireEvent.contextMenu(row, { clientX: 385, clientY: 400 })

    const menu = contextMenu()
    expect(menu).not.toBeNull()
    const left = parseFloat(menu!.style.left)
    // The whole 160px panel has to fit, not just its left edge.
    expect(left + 160).toBeLessThanOrEqual(390)
  })

  it('stays inside the viewport when opened at the bottom edge', () => {
    render(<WorkflowsPage />)
    fireEvent.click(openListButton()!)

    const row = within(processList()!).getByText('Quarterly Review')
    fireEvent.contextMenu(row, { clientX: 20, clientY: 840 })

    const top = parseFloat(contextMenu()!.style.top)
    expect(top).toBeLessThanOrEqual(844 - 44)
  })

  it('keeps its commands', () => {
    render(<WorkflowsPage />)
    fireEvent.click(openListButton()!)

    const row = within(processList()!).getByText('Quarterly Review')
    fireEvent.contextMenu(row, { clientX: 385, clientY: 820 })

    expect(within(contextMenu()!).getByText('Duplicate')).toBeTruthy()
  })
})
