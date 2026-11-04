/**
 * The pilot Get Started flow on the Dashboard, and the way out of it.
 *
 * ── Two subjects, and why they are one suite ──────────────────────────────
 *
 * The Dashboard's home surface changed: `today` renders `DashboardNext` now
 * rather than the lens shell. The pilot first run is the OTHER arm of that
 * same branch, so the thing most likely to have broken silently is the one
 * nobody looks at on a non-pilot account. The first block below is that
 * check, driven through the real page.
 *
 * The second is the control the first run was missing. The coverage card is
 * `dismissible={false}` on purpose -- "not now" there leaves a reader on an
 * empty home -- so a pilot who already knows the product had nothing to press
 * but the one question. `PilotSkipOnboarding` finishes the guide instead of
 * hiding it: it writes `graduated`, which is the single definition of "this
 * pilot's access is wide" that every gate in the flow already reads.
 */

import type React from 'react'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const pilot = vi.hoisted(() => ({ isPilot: true, hasGraduated: false }))
const entry = vi.hoisted(() => ({ stage: 'mission' as 'loading' | 'coverage' | 'mission' }))
const marks = vi.hoisted(() => ({ list: [] as string[], graduated: false }))
/**
 * A subscribable store, because the gate has to actually open.
 *
 * The real `mark` flips the react-query cache synchronously in `onMutate`,
 * which re-renders every reader of `usePilotProgress` and `usePilotMode` --
 * that is how one press takes a pilot to the full Dashboard without a reload,
 * and it is the behaviour the last case in this file is about.
 *
 * A plain mutable object cannot model it: the mocks would return the new value
 * on the NEXT render and nothing would schedule one, so the press would write
 * the marks and change no pixel. That looked like a product bug and was a
 * harness one.
 */
const store = vi.hoisted(() => {
  const subs = new Set<() => void>()
  return {
    subs,
    subscribe: (fn: () => void) => { subs.add(fn); return () => { subs.delete(fn) } },
    version: 0,
    bump() { this.version += 1; for (const fn of subs) fn() },
  }
})

vi.mock('../../../lib/supabase', () => ({
  supabase: { from: () => ({ select: () => ({ data: [], error: null }) }), rpc: async () => ({ data: null, error: null }), auth: {} },
}))
vi.mock('../../layout/Layout', () => ({ Layout: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }))
vi.mock('../../dashboard-next/DashboardNext', () => ({ DashboardNext: () => <div data-testid="full-dashboard" /> }))
vi.mock('../../dashboard/DashboardShell', () => ({
  DashboardShell: () => <div data-testid="retired-shell" />,
  LENS_FOR_TAB: {},
}))
vi.mock('../../mobile/MobileDashboard', () => ({ MobileDashboard: () => <div data-testid="mobile-feed" /> }))
vi.mock('../../mobile/MobilePilotHome', () => ({ MobilePilotHome: () => <div data-testid="mobile-pilot-home" /> }))
vi.mock('../../mobile/DesktopOnlyCard', () => ({ DesktopOnlyCard: () => <div data-testid="desktop-only-card" /> }))
vi.mock('../../dashboard/PilotWelcomeBanner', () => ({ PilotWelcomeBanner: () => <div data-testid="mission-banner" /> }))
vi.mock('../../coverage/CoverageSummaryBanner', () => ({ CoverageSummaryBanner: () => <div data-testid="coverage-summary" /> }))
vi.mock('../../coverage/FirstSessionCoveragePrompt', () => ({
  FirstSessionCoveragePrompt: ({ dismissible }: { dismissible?: boolean }) => (
    <div data-testid="coverage-prompt" data-dismissible={String(dismissible)} />
  ),
}))
vi.mock('../../trading/AddTradeIdeaModal', () => ({ AddTradeIdeaModal: () => null }))
vi.mock('../PilotGraduationModal', () => ({
  /* A sentinel that renders only when the real modal would: graduated, not
     yet acknowledged. That is what makes the trophy case below real. */
  PilotGraduationModal: () =>
    marks.graduated && !marks.list.includes('graduation_celebrated')
      ? <div data-testid="trophy" />
      : null,
}))
vi.mock('../PilotTeaserModal', () => ({ PilotTeaserModal: () => null }))
vi.mock('../../tabs/AssetTab', () => ({ AssetTab: () => null }))
vi.mock('../../../pages/TradeQueuePage', () => ({ TradeQueuePage: () => null }))
vi.mock('../../../pages/SimulationPage', () => ({ SimulationPage: () => null }))
vi.mock('../../../pages/TradeBookPage', () => ({ TradeBookPage: () => null }))
vi.mock('../../../pages/DecisionAccountabilityPage', () => ({ DecisionAccountabilityPage: () => null }))

vi.mock('@tanstack/react-query', () => ({
  useQuery: () => ({ data: undefined, isLoading: false, error: null, refetch: () => {} }),
  useQueryClient: () => ({ invalidateQueries: () => {}, setQueryData: () => {}, getQueryData: () => undefined }),
}))
vi.mock('../../../hooks/useAuth', () => ({ useAuth: () => ({ user: { id: 'u1' } }) }))
vi.mock('../../../contexts/OrganizationContext', () => ({
  useOrganization: () => ({ currentOrgId: 'o1' }),
  useOrganizationOptional: () => ({ currentOrgId: 'o1' }),
}))
vi.mock('../../../hooks/useSessionTracking', () => ({ useSessionTracking: () => {} }))
vi.mock('../../../hooks/useDashboardScope', () => ({ useDashboardScope: () => ['all', () => {}] }))
vi.mock('../../../hooks/useCockpitFeed', () => ({ useCockpitFeed: () => ({ items: [], isLoading: false }) }))
vi.mock('../../common/Toast', () => ({ useToast: () => ({ showToast: () => {} }) }))
vi.mock('../../../hooks/usePilotEntry', () => ({ usePilotEntry: () => ({ stage: entry.stage }) }))
vi.mock('../../../hooks/usePilotMode', async () => {
  const { useSyncExternalStore } = await import('react')
  return {
    usePilotMode: () => {
      useSyncExternalStore(store.subscribe, () => store.version)
      return {
        isPilot: pilot.isPilot, isLoading: false, isInitialResolve: false, accessIsReady: true,
        effectiveIsPilot: pilot.hasGraduated ? false : pilot.isPilot,
        hasCommittedTradeInOrg: true, hasGraduated: pilot.hasGraduated,
        access: {}, accessFor: () => 'full', canSee: () => true, canUse: () => true,
      }
    },
  }
})
/*
 * The real `usePilotProgress` writes through react-query and Supabase, both
 * stubbed above. The subject here is WHICH stages the control writes, so the
 * mark is recorded and `hasGraduated` is wired to the same store the pilot
 * gate reads -- so pressing the button really does open the full Dashboard in
 * this tree rather than merely being asserted to.
 */
vi.mock('../../../hooks/usePilotProgress', async () => {
  const { useSyncExternalStore } = await import('react')
  return {
    usePilotProgress: () => {
      useSyncExternalStore(store.subscribe, () => store.version)
      return {
        progress: {},
        mark: (stage: string) => {
          marks.list.push(stage)
          if (stage === 'graduated') { marks.graduated = true; pilot.hasGraduated = true }
          store.bump()
        },
        hasGraduated: pilot.hasGraduated,
        hasCelebratedGraduation: marks.list.includes('graduation_celebrated'),
        isLoading: false,
        hasReadyProgress: true,
        setTutorialIdea: () => {},
        tutorialIdeaId: null,
      }
    },
  }
})

import { DashboardPage } from '../../../pages/DashboardPage'
import { PilotSkipOnboarding } from '../PilotSkipOnboarding'

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
  }) as never
}

beforeEach(() => {
  sessionStorage.clear()
  localStorage.clear()
  pilot.isPilot = true
  pilot.hasGraduated = false
  entry.stage = 'mission'
  marks.list = []
  marks.graduated = false
  store.subs.clear()
  setViewportWidth(1440)
})

describe('the pilot Get Started flow survives the Dashboard becoming the feed', () => {
  it('gives a pilot the mission, not the full Dashboard', () => {
    render(<DashboardPage />)
    expect(screen.getByTestId('mission-banner')).toBeInTheDocument()
    expect(screen.getByTestId('coverage-summary')).toBeInTheDocument()
    /*
     * The point of the branch. Layering the mission over the home mounted the
     * lens bar and every one of its queries under the guidance, so this is
     * substitution and the absence is the subject.
     */
    expect(screen.queryByTestId('full-dashboard')).not.toBeInTheDocument()
  })

  it('gives a pilot who has not set coverage the setup card, and no way to skip past the question', () => {
    entry.stage = 'coverage'
    render(<DashboardPage />)
    const prompt = screen.getByTestId('coverage-prompt')
    expect(prompt).toHaveAttribute('data-dismissible', 'false')
    expect(screen.queryByTestId('mission-banner')).not.toBeInTheDocument()
    expect(screen.queryByTestId('full-dashboard')).not.toBeInTheDocument()
  })

  it('draws nothing but the skeleton while the stage is unknown', () => {
    entry.stage = 'loading'
    render(<DashboardPage />)
    /* Treating "not loaded" as "no coverage" shows the setup card for a frame
       to a pilot who finished it last week. */
    expect(screen.queryByTestId('coverage-prompt')).not.toBeInTheDocument()
    expect(screen.queryByTestId('mission-banner')).not.toBeInTheDocument()
    expect(screen.queryByTestId('pilot-skip-onboarding')).not.toBeInTheDocument()
  })

  it('gives a graduated pilot the full Dashboard', () => {
    pilot.hasGraduated = true
    render(<DashboardPage />)
    expect(screen.getByTestId('full-dashboard')).toBeInTheDocument()
    expect(screen.queryByTestId('mission-banner')).not.toBeInTheDocument()
    /* And the surface it replaced stays retired on both arms. */
    expect(screen.queryByTestId('retired-shell')).not.toBeInTheDocument()
  })

  it('gives a non-pilot the full Dashboard with no pilot chrome at all', () => {
    pilot.isPilot = false
    render(<DashboardPage />)
    expect(screen.getByTestId('full-dashboard')).toBeInTheDocument()
    expect(screen.queryByTestId('pilot-skip-onboarding')).not.toBeInTheDocument()
  })
})

describe('the way out is offered at both stages', () => {
  it('is on the mission screen', () => {
    render(<DashboardPage />)
    expect(screen.getByTestId('pilot-skip-onboarding')).toBeInTheDocument()
  })

  it('is on the coverage screen, which has no other control', () => {
    /* THE case this exists for: that card cannot be dismissed, so without
       this a pilot who knows the product has one question and no way past. */
    entry.stage = 'coverage'
    render(<DashboardPage />)
    expect(screen.getByTestId('pilot-skip-onboarding')).toBeInTheDocument()
  })
})

describe('taking it finishes the guide rather than hiding it', () => {
  it('asks before it does anything', async () => {
    const user = userEvent.setup()
    render(<PilotSkipOnboarding />)
    await user.click(screen.getByRole('button', { name: /skip the guide/i }))
    expect(screen.getByTestId('pilot-skip-confirm')).toBeInTheDocument()
    /* Nothing written yet: the product cannot undo this, so the first press
       must not be the one that does it. */
    expect(marks.list).toEqual([])
  })

  it('can be backed out of', async () => {
    const user = userEvent.setup()
    render(<PilotSkipOnboarding />)
    await user.click(screen.getByRole('button', { name: /skip the guide/i }))
    await user.click(screen.getByRole('button', { name: /keep the guide/i }))
    expect(screen.getByTestId('pilot-skip-onboarding')).toBeInTheDocument()
    expect(marks.list).toEqual([])
  })

  it('writes graduation, which is the one gate every Get Started surface reads', async () => {
    const user = userEvent.setup()
    render(<PilotSkipOnboarding />)
    await user.click(screen.getByRole('button', { name: /skip the guide/i }))
    await user.click(screen.getByRole('button', { name: /open the full dashboard/i }))
    /*
     * `graduated` and nothing invented beside it. A loop that ticked the five
     * steps off one by one would be a second definition of done, and the five
     * surfaces that gate on `effectiveIsPilot` do not read the steps.
     */
    expect(marks.list).toContain('graduated')
  })

  it('does not congratulate the reader for a loop they declined', async () => {
    const user = userEvent.setup()
    render(<PilotSkipOnboarding />)
    await user.click(screen.getByRole('button', { name: /skip the guide/i }))
    await user.click(screen.getByRole('button', { name: /open the full dashboard/i }))
    /*
     * `PilotGraduationModal` opens on `hasGraduated` alone, on purpose, so
     * the celebration and the thing it celebrates cannot disagree. A skip
     * would therefore pop a trophy over the Dashboard the reader just asked
     * to be let into, so the acknowledgement is written in the same gesture.
     */
    expect(marks.list).toContain('graduation_celebrated')
    expect(marks.list.indexOf('graduated'))
      .toBeLessThan(marks.list.indexOf('graduation_celebrated'))
  })

  it('opens the full Dashboard once it is taken', async () => {
    const user = userEvent.setup()
    render(<DashboardPage />)
    await user.click(screen.getByRole('button', { name: /skip the guide/i }))
    await user.click(screen.getByRole('button', { name: /open the full dashboard/i }))
    /* The end of the whole request: not the guide hidden, the product open. */
    expect(screen.getByTestId('full-dashboard')).toBeInTheDocument()
    expect(screen.queryByTestId('mission-banner')).not.toBeInTheDocument()
    expect(screen.queryByTestId('trophy')).not.toBeInTheDocument()
  })

  it('is not offered to a pilot who has already graduated', () => {
    pilot.hasGraduated = true
    render(<PilotSkipOnboarding />)
    expect(screen.queryByTestId('pilot-skip-onboarding')).not.toBeInTheDocument()
  })
})

describe('the phone home offers the same way out', () => {
  it('renders it at both stages, in the sheet variant', () => {
    const home = readFileSync(join(process.cwd(), 'src/components/mobile/MobilePilotHome.tsx'), 'utf8')
    /* Source-pinned: `MobilePilotHome` is stubbed above so the page suite can
       drive the desktop branch, and mounting the real one here would mean a
       second copy of every mock in this file. */
    expect(home).toContain('PilotSkipOnboarding')
    expect(home).toMatch(/stage !== 'loading' && <PilotSkipOnboarding variant="sheet" \/>/)
  })
})
