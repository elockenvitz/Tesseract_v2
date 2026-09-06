/**
 * What `/dashboard` renders on a phone.
 *
 * ── The defect this pins ──────────────────────────────────────────────────
 *
 * `/dashboard` has no route of its own: it renders DashboardPage, which shows
 * whatever tab the session says is active. A session with nothing to restore
 * gets CANONICAL_HOME_TAB, whose type is `today`.
 *
 * `today` was never added to the mobile surface registry, and unregistered
 * types default to `desktop-only`. The desktop-only guard runs before the tab
 * switch, so every phone opening `/dashboard` was served a "Dashboard is
 * desktop only" card instead of the ideas feed that was sitting right there —
 * the feed was only ever wired to the LEGACY `dashboard` type.
 *
 * ── What is deliberately NOT asserted ─────────────────────────────────────
 *
 * Anything about the feed's contents, or about the desktop Dashboard's. Both
 * are stubbed. This is about which of the two a viewport width selects.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

// The page pulls the whole product in behind it. None of it is exercised
// here — this is about one branch in renderTabContent — so the module graph
// is stubbed at its heaviest edges, and the three surfaces the branch can
// choose between are replaced with sentinels.
vi.mock('../../lib/supabase', () => ({
  supabase: { from: () => ({ select: () => ({ data: [], error: null }) }), auth: {} },
}))
vi.mock('../../components/layout/Layout', () => ({
  Layout: ({ children }: any) => <div>{children}</div>,
}))
vi.mock('../../components/mobile/MobileDashboard', () => ({
  MobileDashboard: () => <div data-testid="mobile-ideas-feed" />,
}))
vi.mock('../../components/dashboard/DashboardShell', () => ({
  DashboardShell: ({ initialLens }: any) => (
    <div data-testid="desktop-dashboard" data-lens={initialLens} />
  ),
  LENS_FOR_TAB: {},
}))
vi.mock('../../components/mobile/DesktopOnlyCard', () => ({
  DesktopOnlyCard: () => <div data-testid="desktop-only-card" />,
}))
vi.mock('../../components/trading/AddTradeIdeaModal', () => ({ AddTradeIdeaModal: () => null }))
vi.mock('../../components/pilot/PilotGraduationModal', () => ({ PilotGraduationModal: () => null }))
vi.mock('../../components/pilot/PilotTeaserModal', () => ({ PilotTeaserModal: () => null }))
vi.mock('../../components/tabs/AssetTab', () => ({ AssetTab: () => null }))

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
    isPilot: false, isLoading: false, isInitialResolve: false, accessIsReady: true,
    effectiveIsPilot: false, hasCommittedTradeInOrg: false, hasGraduated: false,
    access: {}, accessFor: () => 'full', canSee: () => true, canUse: () => true,
  }),
}))

import { DashboardPage } from '../DashboardPage'
import { CANONICAL_HOME_TAB } from '../../lib/tabStateManager'
import { isDesktopOnly, getMobileNavSurfaces } from '../../lib/mobile/mobile-surfaces'

const PHONE = 390
const LAPTOP = 1440

/**
 * The real `useIsMobile` reads matchMedia, so the width is set the way the
 * browser would report it rather than by stubbing the hook. That keeps the
 * JS branch and the `md:` breakpoint answering the same question.
 */
function setViewportWidth(width: number) {
  window.matchMedia = ((query: string) => {
    const max = /max-width:\s*(\d+)px/.exec(query)
    const min = /min-width:\s*(\d+)px/.exec(query)
    const matches =
      (!max || width <= Number(max[1])) &&
      (!min || width >= Number(min[1])) &&
      !/pointer:\s*coarse/.test(query)
    return {
      matches, media: query, onchange: null,
      addEventListener: () => {}, removeEventListener: () => {},
      addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false,
    }
  }) as any
}

describe('/dashboard device resolution', () => {
  beforeEach(() => {
    sessionStorage.clear()
    localStorage.clear()
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('renders the mobile Ideas feed on a phone', () => {
    setViewportWidth(PHONE)
    render(<DashboardPage />)

    expect(screen.getByTestId('mobile-ideas-feed')).toBeInTheDocument()
    expect(screen.queryByTestId('desktop-dashboard')).not.toBeInTheDocument()
  })

  it('still renders the desktop Dashboard on a laptop', () => {
    setViewportWidth(LAPTOP)
    render(<DashboardPage />)

    const shell = screen.getByTestId('desktop-dashboard')
    expect(shell).toHaveAttribute('data-lens', 'today')
    expect(screen.queryByTestId('mobile-ideas-feed')).not.toBeInTheDocument()
  })

  it('never shows the desktop-only card on the phone home', () => {
    setViewportWidth(PHONE)
    render(<DashboardPage />)

    expect(screen.queryByTestId('desktop-only-card')).not.toBeInTheDocument()
  })
})

describe('mobile surface registry', () => {
  it('registers the canonical home type, so it cannot default to desktop-only', () => {
    // Renaming the home tab's type without a registry entry is exactly how
    // the phone home started serving a desktop-only card.
    expect(isDesktopOnly(CANONICAL_HOME_TAB.type)).toBe(false)
    expect(isDesktopOnly('dashboard')).toBe(false)
  })

  it('offers no desktop-only destination in the phone nav drawer', () => {
    const reachable = [...getMobileNavSurfaces('core'), ...getMobileNavSurfaces('work')]
    expect(reachable.length).toBeGreaterThan(0)
    expect(reachable.filter(s => isDesktopOnly(s.type))).toEqual([])
  })

  it('lists the Ideas home once in the drawer', () => {
    // `today` and `dashboard` are both the ideas feed on a phone; only one of
    // them carries the drawer row.
    const ideasRows = getMobileNavSurfaces('core').filter(s => s.title === 'Ideas')
    expect(ideasRows).toHaveLength(1)
  })
})
