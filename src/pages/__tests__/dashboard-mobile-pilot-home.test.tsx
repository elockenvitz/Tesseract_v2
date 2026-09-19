/**
 * What the phone's home renders for a pilot.
 *
 * The resolver: on a phone `today`, `dashboard` and `ideas` all render
 * `renderDashboardContent`, which picks `MobilePilotHome` while
 * `effectiveIsPilot` (`hasGraduated ? false : isPilot`) and `MobileDashboard`
 * otherwise. These pin that for a fresh session, for restored home and Ideas
 * tabs, and across a remount, with the real pilot home and roadmap rendered.
 */
import type React from 'react'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'

const pilot = vi.hoisted(() => ({ isPilot: true, hasGraduated: false }))

vi.mock('../../lib/supabase', () => ({
  supabase: { from: () => ({ select: () => ({ data: [], error: null }) }), rpc: async () => ({ data: null, error: null }), auth: {} },
}))
vi.mock('../../components/layout/Layout', () => ({ Layout: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }))
vi.mock('../../components/mobile/MobileDashboard', () => ({ MobileDashboard: () => <div data-testid="mobile-ideas-feed" /> }))
vi.mock('../../components/dashboard/DashboardShell', () => ({ DashboardShell: () => <div data-testid="dashboard-shell" />, LENS_FOR_TAB: {} }))
vi.mock('../../components/coverage/CoverageSummaryBanner', () => ({ CoverageSummaryBanner: () => null }))
vi.mock('../../components/coverage/FirstSessionCoveragePrompt', () => ({ FirstSessionCoveragePrompt: () => null }))
vi.mock('../../hooks/usePilotEntry', () => ({ usePilotEntry: () => ({ stage: 'mission' }) }))
vi.mock('../../components/mobile/DesktopOnlyCard', () => ({ DesktopOnlyCard: () => <div data-testid="desktop-only-card" /> }))
vi.mock('../../components/trading/AddTradeIdeaModal', () => ({ AddTradeIdeaModal: () => null }))
vi.mock('../../components/pilot/PilotGraduationModal', () => ({ PilotGraduationModal: () => null }))
vi.mock('../../components/pilot/PilotTeaserModal', () => ({ PilotTeaserModal: () => null }))
vi.mock('../../components/tabs/AssetTab', () => ({ AssetTab: () => null }))

const LABELS = ['Capture an investment idea', 'Develop the thesis', 'Test the trade', 'Make the decision', 'Close the loop']
vi.mock('../../hooks/usePilotMission', () => {
  const ids = ['idea_created', 'pipeline_advanced', 'simulation_completed', 'decision_submitted', 'outcome_reviewed']
  const labels = ['Capture an investment idea', 'Develop the thesis', 'Test the trade', 'Make the decision', 'Close the loop']
  // Steps 1–4 done: the pilot is on Close the loop.
  return {
    usePilotMission: () => ({
      steps: ids.map((id, i) => ({ id, label: labels[i], hint: `Hint ${i + 1}`, cta: `Go ${i + 1}`, done: i < 4, available: true, blockedBy: null })),
      completedCount: 4, total: 5, currentStepId: 'outcome_reviewed', complete: false,
      tutorialIdeaId: 'idea-1', isLoading: false, setTutorialIdea: () => {}, markOutcomeReviewed: () => {},
    }),
  }
})

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

function setPhone() {
  window.matchMedia = ((query: string) => {
    const max = /max-width:\s*(\d+)px/.exec(query)
    const min = /min-width:\s*(\d+)px/.exec(query)
    const matches = (!max || 390 <= Number(max[1])) && (!min || 390 >= Number(min[1])) && !/pointer:\s*coarse/.test(query)
    return { matches, media: query, onchange: null, addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false }
  }) as unknown as typeof window.matchMedia
}

/** A session saved with this tab active, as TabStateManager writes it. */
function restore(type: string) {
  const tabs = [
    { ...CANONICAL_HOME_TAB, isActive: type === CANONICAL_HOME_TAB.type },
    ...(type === CANONICAL_HOME_TAB.type ? [] : [{ id: type, title: 'Ideas', type, isActive: true }]),
  ]
  sessionStorage.setItem('tesseract_tabs_u1_o1', JSON.stringify({
    tabs, activeTabId: type === CANONICAL_HOME_TAB.type ? CANONICAL_HOME_TAB.id : type,
    tabStates: {}, version: 3, userId: 'u1', orgId: 'o1',
  }))
}

const roadmap = (c: HTMLElement) => [...c.querySelectorAll('[data-slot="pilot-mission-step"]')]

function expectPilotHome(c: HTMLElement) {
  const steps = roadmap(c)
  expect(steps).toHaveLength(5)
  for (const label of LABELS) expect(screen.getByText(label)).toBeInTheDocument()
  expect(steps.filter(s => s.getAttribute('data-state') === 'current')).toHaveLength(1)
  expect(steps[4].getAttribute('data-state')).toBe('current')
  expect(screen.queryByTestId('mobile-ideas-feed')).not.toBeInTheDocument()
}

beforeEach(() => {
  sessionStorage.clear()
  localStorage.clear()
  pilot.isPilot = true
  pilot.hasGraduated = false
  setPhone()
})
afterEach(() => { cleanup(); vi.restoreAllMocks() })

describe('a pilot who has not graduated', () => {
  it('gets Pilot Home with the five-stage roadmap on a fresh session', () => {
    const { container } = render(<DashboardPage />)
    expectPilotHome(container)
  })

  it.each(['today', 'dashboard', 'ideas', 'idea-generator'])('still gets it with a restored %s tab', (type) => {
    restore(type)
    const { container } = render(<DashboardPage />)
    expectPilotHome(container)
  })

  it('still gets it after a refresh', () => {
    restore('ideas')
    const first = render(<DashboardPage />)
    expectPilotHome(first.container)
    first.unmount()

    const second = render(<DashboardPage />)
    expectPilotHome(second.container)
  })
})

describe('everyone else gets the Ideas feed', () => {
  it.each(['today', 'ideas'])('a graduated pilot, on %s', (type) => {
    pilot.hasGraduated = true
    restore(type)
    const { container } = render(<DashboardPage />)
    expect(screen.getByTestId('mobile-ideas-feed')).toBeInTheDocument()
    expect(roadmap(container)).toHaveLength(0)
  })

  it.each(['today', 'ideas'])('a reader who is not a pilot, on %s', (type) => {
    pilot.isPilot = false
    restore(type)
    const { container } = render(<DashboardPage />)
    expect(screen.getByTestId('mobile-ideas-feed')).toBeInTheDocument()
    expect(roadmap(container)).toHaveLength(0)
  })
})
