/**
 * Every restorable tab type renders at phone width without throwing.
 *
 * ── The defect this pins ──────────────────────────────────────────────────
 *
 * `/dashboard` renders whatever tab the session says was active, so a throw
 * inside any one surface takes down the whole app: the user gets a loading
 * screen that never resolves, with no indication that a surface failed or
 * which one.
 *
 * That happened. A `ChevronLeft` was used in new JSX in ProjectDetailTab and
 * never imported, and it reached the browser as `ReferenceError: ChevronLeft
 * is not defined` — anyone whose session restored a project tab could not get
 * into the product at all. `guard:types` had counted that TS2304 and still
 * reported PASS, because the repo total was sitting two points under the
 * ceiling and the error fitted in the slack. The ceiling is now closed to the
 * exact count, and this renders the surfaces as a second, independent check
 * that does not depend on an error budget.
 *
 * ── What is deliberately NOT asserted ─────────────────────────────────────
 *
 * Anything about what these surfaces show — queries are stubbed empty. One
 * question per tab: does it render at all.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render } from '@testing-library/react'

vi.mock('../../lib/supabase', () => ({
  supabase: { from: () => ({ select: () => ({ data: [], error: null }) }), auth: {} },
}))
vi.mock('../../components/layout/Layout', () => ({
  Layout: ({ children }: any) => <div>{children}</div>,
}))
vi.mock('../../components/mobile/MobileDashboard', () => ({ MobileDashboard: () => <div /> }))
vi.mock('../../components/dashboard/DashboardShell', () => ({
  DashboardShell: () => <div />, LENS_FOR_TAB: {},
}))
vi.mock('../../components/mobile/DesktopOnlyCard', () => ({ DesktopOnlyCard: () => <div /> }))
vi.mock('../../components/trading/AddTradeIdeaModal', () => ({ AddTradeIdeaModal: () => null }))
vi.mock('../../components/pilot/PilotGraduationModal', () => ({ PilotGraduationModal: () => null }))
vi.mock('../../components/pilot/PilotTeaserModal', () => ({ PilotTeaserModal: () => null }))
vi.mock('@tanstack/react-query', () => ({
  useQuery: () => ({ data: undefined, isLoading: false, isError: false, error: null, refetch: () => {} }),
  useQueryClient: () => ({ invalidateQueries: () => {}, setQueryData: () => {}, getQueryData: () => undefined }),
  useMutation: () => ({ mutate: () => {}, mutateAsync: async () => {}, isPending: false }),
  keepPreviousData: undefined,
}))
vi.mock('../../hooks/useAuth', () => ({ useAuth: () => ({ user: { id: 'u1' } }) }))
vi.mock('../../contexts/OrganizationContext', () => ({
  useOrganization: () => ({ currentOrgId: 'o1' }),
  useOrganizationOptional: () => ({ currentOrgId: 'o1' }),
}))
vi.mock('../../hooks/useSessionTracking', () => ({ useSessionTracking: () => {} }))
vi.mock('../../hooks/useDashboardScope', () => ({ useDashboardScope: () => ['all', () => {}] }))
vi.mock('../../hooks/useCockpitFeed', () => ({ useCockpitFeed: () => ({ items: [], isLoading: false }) }))
vi.mock('../../components/common/Toast', () => ({ useToast: () => ({ showToast: () => {} }) }))
vi.mock('../../hooks/usePilotMode', () => ({
  usePilotMode: () => ({
    isPilot: false, isLoading: false, isInitialResolve: false, accessIsReady: true,
    effectiveIsPilot: false, hasCommittedTradeInOrg: false, hasGraduated: false,
    access: {}, accessFor: () => 'full', canSee: () => true, canUse: () => true,
  }),
}))

import { DashboardPage } from '../DashboardPage'

function setViewportWidth(width: number) {
  window.matchMedia = ((query: string) => {
    const max = /max-width:\s*(\d+)px/.exec(query)
    const min = /min-width:\s*(\d+)px/.exec(query)
    const matches = (!max || width <= Number(max[1])) && (!min || width >= Number(min[1])) && !/pointer:\s*coarse/.test(query)
    return { matches, media: query, onchange: null, addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false }
  }) as any
}

function seed(tab: any) {
  sessionStorage.setItem('tesseract_tabs_u1_o1', JSON.stringify({
    tabs: [tab], activeTabId: tab.id, tabStates: {}, version: 3, userId: 'u1', orgId: 'o1',
  }))
}

describe('boot smoke at 390px', () => {
  beforeEach(() => { sessionStorage.clear(); localStorage.clear() })

  it('renders projects-list', () => {
    setViewportWidth(390)
    seed({ id: 't1', title: 'Projects', type: 'projects-list' })
    expect(() => render(<DashboardPage />)).not.toThrow()
  })

  it('renders project detail', () => {
    setViewportWidth(390)
    seed({
      id: 't2', title: 'P', type: 'project',
      data: { id: 'p1', title: 'P', status: 'in_progress', priority: 'medium', created_at: new Date().toISOString(), updated_at: new Date().toISOString(), due_date: null, created_by: 'u1', description: 'd' },
    })
    expect(() => render(<DashboardPage />)).not.toThrow()
  })

  it('renders files', () => {
    setViewportWidth(390)
    seed({ id: 't3', title: 'Files', type: 'files' })
    expect(() => render(<DashboardPage />)).not.toThrow()
  })

  it('renders the default home', () => {
    setViewportWidth(390)
    expect(() => render(<DashboardPage />)).not.toThrow()
  })
})
