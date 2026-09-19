/**
 * A Dashboard lens tab is the pilot home until the pilot graduates.
 *
 * `ideas-v2`, `research-v2`, `portfolio-v2` and `decisions-v2` each mount the
 * Dashboard shell on a lens. They had no pilot access entry and no pilot
 * branch, so a saved session or a deep link (the decision engine opens
 * `ideas-v2` directly) put the full Dashboard in front of a pilot on step 1.
 * They now render through the same gate `today` does.
 */
import type React from 'react'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, act } from '@testing-library/react'

const pilot = vi.hoisted(() => ({ isPilot: true, hasGraduated: false }))

vi.mock('../../lib/supabase', () => ({
  supabase: { from: () => ({ select: () => ({ data: [], error: null }) }), rpc: async () => ({ data: null, error: null }), auth: {} },
}))
vi.mock('../../components/layout/Layout', () => ({ Layout: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }))
vi.mock('../../components/mobile/MobileDashboard', () => ({ MobileDashboard: () => <div data-testid="mobile-ideas-feed" /> }))
vi.mock('../../components/mobile/MobilePilotHome', () => ({ MobilePilotHome: () => <div data-testid="mobile-pilot-home" /> }))
vi.mock('../../components/dashboard/DashboardShell', () => ({
  DashboardShell: ({ initialLens }: { initialLens: string }) => <div data-testid="dashboard-shell" data-lens={initialLens} />,
  LENS_FOR_TAB: {},
}))
vi.mock('../../components/dashboard/PilotWelcomeBanner', () => ({ PilotWelcomeBanner: () => <div data-testid="pilot-home" /> }))
vi.mock('../../components/coverage/CoverageSummaryBanner', () => ({ CoverageSummaryBanner: () => null }))
vi.mock('../../components/coverage/FirstSessionCoveragePrompt', () => ({ FirstSessionCoveragePrompt: () => null }))
vi.mock('../../hooks/usePilotEntry', () => ({ usePilotEntry: () => ({ stage: 'mission' }) }))
vi.mock('../../components/mobile/DesktopOnlyCard', () => ({ DesktopOnlyCard: () => <div data-testid="desktop-only-card" /> }))
vi.mock('../../components/trading/AddTradeIdeaModal', () => ({ AddTradeIdeaModal: () => null }))
vi.mock('../../components/pilot/PilotGraduationModal', () => ({ PilotGraduationModal: () => null }))
vi.mock('../../components/pilot/PilotTeaserModal', () => ({ PilotTeaserModal: () => null }))
vi.mock('../../components/tabs/AssetTab', () => ({ AssetTab: () => null }))
vi.mock('../../pages/TradeQueuePage', () => ({ TradeQueuePage: () => <div data-testid="pipeline" /> }))
vi.mock('../../pages/SimulationPage', () => ({ SimulationPage: () => <div data-testid="trade-lab" /> }))
vi.mock('../../pages/TradeBookPage', () => ({ TradeBookPage: () => <div data-testid="trade-book" /> }))
vi.mock('../../pages/DecisionAccountabilityPage', () => ({ DecisionAccountabilityPage: () => <div data-testid="outcomes" /> }))

vi.mock('@tanstack/react-query', () => ({
  useQuery: () => ({ data: undefined, isLoading: false, error: null, refetch: () => {} }),
  useQueryClient: () => ({ invalidateQueries: () => {}, setQueryData: () => {}, getQueryData: () => undefined }),
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
    isPilot: pilot.isPilot, isLoading: false, isInitialResolve: false, accessIsReady: true,
    // What the real hook computes once loaded.
    effectiveIsPilot: pilot.hasGraduated ? false : pilot.isPilot,
    hasCommittedTradeInOrg: true, hasGraduated: pilot.hasGraduated,
    access: {}, accessFor: () => 'full', canSee: () => true, canUse: () => true,
  }),
}))

import { DashboardPage } from '../DashboardPage'
import { CANONICAL_HOME_TAB } from '../../lib/tabStateManager'
import { DASHBOARD_LENS_TAB_TYPES } from '../../lib/pilot/tab-gate'

const LENS = { 'ideas-v2': 'ideas', 'research-v2': 'research', 'portfolio-v2': 'portfolio', 'decisions-v2': 'decisions' } as const

function setViewportWidth(width: number) {
  window.matchMedia = ((query: string) => {
    const max = /max-width:\s*(\d+)px/.exec(query)
    const min = /min-width:\s*(\d+)px/.exec(query)
    const matches = (!max || width <= Number(max[1])) && (!min || width >= Number(min[1])) && !/pointer:\s*coarse/.test(query)
    return { matches, media: query, onchange: null, addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false }
  }) as unknown as typeof window.matchMedia
}

/** A session saved with this tab active, as TabStateManager writes it. */
function restore(type: string) {
  const tabs = [
    { ...CANONICAL_HOME_TAB, isActive: false },
    { id: type, title: type, type, isActive: true },
  ]
  sessionStorage.setItem('tesseract_tabs_u1_o1', JSON.stringify({
    tabs, activeTabId: type, tabStates: {}, version: 3, userId: 'u1', orgId: 'o1',
  }))
}

beforeEach(() => {
  sessionStorage.clear()
  localStorage.clear()
  pilot.isPilot = true
  pilot.hasGraduated = false
  setViewportWidth(1440)
})
afterEach(() => vi.restoreAllMocks())

describe('a restored Dashboard lens tab on desktop', () => {
  it('covers every lens type', () => {
    expect([...DASHBOARD_LENS_TAB_TYPES].sort()).toEqual(Object.keys(LENS).sort())
  })

  it.each(Object.keys(LENS))('%s renders the pilot home before graduation', (type) => {
    restore(type)
    render(<DashboardPage />)
    expect(screen.getByTestId('pilot-home')).toBeInTheDocument()
    expect(screen.queryByTestId('dashboard-shell')).not.toBeInTheDocument()
  })

  it.each(Object.entries(LENS))('%s renders its lens after graduation', (type, lens) => {
    pilot.hasGraduated = true
    restore(type)
    render(<DashboardPage />)
    expect(screen.getByTestId('dashboard-shell')).toHaveAttribute('data-lens', lens)
    expect(screen.queryByTestId('pilot-home')).not.toBeInTheDocument()
  })

  it.each(Object.entries(LENS))('%s renders its lens for a reader who is not a pilot', (type, lens) => {
    pilot.isPilot = false
    restore(type)
    render(<DashboardPage />)
    expect(screen.getByTestId('dashboard-shell')).toHaveAttribute('data-lens', lens)
  })
})

describe('a deep link into a lens', () => {
  const openIdeasLens = () => act(() => {
    window.dispatchEvent(new CustomEvent('decision-engine-action', {
      detail: { type: 'ideas-v2', id: 'ideas-v2', title: 'Ideas', data: { selectedIdeaId: 'i1', focus: 'decision' } },
    }))
  })

  it('lands a pilot on the pilot home before graduation', async () => {
    render(<DashboardPage />)
    await openIdeasLens()
    expect(screen.getByTestId('pilot-home')).toBeInTheDocument()
    expect(screen.queryByTestId('dashboard-shell')).not.toBeInTheDocument()
  })

  it('opens the Ideas lens after graduation', async () => {
    pilot.hasGraduated = true
    render(<DashboardPage />)
    await openIdeasLens()
    expect(screen.getByTestId('dashboard-shell')).toHaveAttribute('data-lens', 'ideas')
  })
})

describe('on a phone', () => {
  it('a restored lens tab is the mobile pilot home before graduation', () => {
    setViewportWidth(390)
    restore('research-v2')
    render(<DashboardPage />)
    expect(screen.getByTestId('mobile-pilot-home')).toBeInTheDocument()
  })

  it('is unchanged after graduation', () => {
    setViewportWidth(390)
    pilot.hasGraduated = true
    restore('research-v2')
    render(<DashboardPage />)
    expect(screen.getByTestId('desktop-only-card')).toBeInTheDocument()
  })
})

describe('the surfaces the pilot needs are not caught', () => {
  it.each([
    ['trade-queue', 'pipeline'],
    ['trade-lab', 'trade-lab'],
    ['trade-book', 'trade-book'],
    ['outcomes', 'outcomes'],
  ])('%s still renders before graduation', async (type, testId) => {
    restore(type)
    render(<DashboardPage />)
    // Three of these are lazy-loaded.
    expect(await screen.findByTestId(testId, {}, { timeout: 5000 })).toBeInTheDocument()
    expect(screen.queryByTestId('pilot-home')).not.toBeInTheDocument()
  })
})
