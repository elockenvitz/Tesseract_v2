/**
 * Coverage first, then the mission — and capturing an idea stops blanking the
 * module that tracks it.
 *
 * Three defects from the start of the pilot flow, which share a screen:
 *
 *   1. Coverage setup and the five-step mission rendered together, so a
 *      pilot's first screen asked two unrelated things at once.
 *   2. Coverage stayed 'hidden' for the whole pilot, so the setup they had
 *      just completed was the last time they could touch it.
 *   3. Adopting the just-captured idea changed the mission query key, and a
 *      new key has no data — so the whole module unmounted until three reads
 *      came back.
 */

import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import React from 'react'
import { renderHook, act, waitFor, cleanup } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

const coverage = vi.hoisted(() => ({ hasCoverage: false, isLoading: false }))
vi.mock('../useMyCoverage', () => ({ useHasCoverage: () => coverage }))
vi.mock('../useAuth', () => ({ useAuth: () => ({ user: { id: 'u1' } }) }))
const fetchSuggestions = vi.hoisted(() => vi.fn(async () => []))
vi.mock('../../lib/coverage/quick-start-suggestions', () => ({
  coverageSuggestionsKey: (u: string | null, o: string | null) => ['coverage-quick-start-suggestions', u, o],
  fetchCoverageSuggestions: fetchSuggestions,
}))

import { usePilotEntry } from '../usePilotEntry'

/*
 * The hook also starts the suggestions request, so it needs a client. That
 * request is the point of the third test below: the card that consumes it
 * mounts three round trips too late to ask for it itself.
 */
let entryClient: QueryClient
const entryWrapper = ({ children }: { children: React.ReactNode }) =>
  React.createElement(QueryClientProvider, { client: entryClient }, children)

beforeEach(() => {
  coverage.hasCoverage = false
  coverage.isLoading = false
  // Restored here rather than at the end of the one test that changes it: an
  // assertion that throws never reaches its own cleanup, and the leak then
  // fails unrelated tests further down the file.
  mission.effectiveIsPilot = true
  fetchSuggestions.mockClear()
  entryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
})
afterEach(cleanup)

const entry = () => renderHook(() => usePilotEntry(), { wrapper: entryWrapper }).result

describe('the pilot entry sequence', () => {
  it('asks for coverage before showing the mission', () => {
    expect(entry().current.stage).toBe('coverage')
  })

  it('reveals the mission once coverage exists', () => {
    coverage.hasCoverage = true
    expect(entry().current.stage).toBe('mission')
  })

  /**
   * Treating "not loaded yet" as "no coverage" shows the setup surface for a
   * frame to somebody who finished it last week.
   */
  it('says nothing until the rows have actually been read', () => {
    coverage.isLoading = true
    expect(entry().current.stage).toBe('loading')
  })

  /**
   * The card cannot ask for its own suggestions in time: it mounts behind the
   * coverage read, which is behind the stage decision. Starting the request
   * here puts it beside that read rather than after it.
   */
  it('starts the suggestions request before the card exists', async () => {
    entry()
    await waitFor(() => expect(fetchSuggestions).toHaveBeenCalled())
  })

  /** Only a pilot sees the card, so only a pilot pays for the reads. */
  it('does not start it for a reader who is not a pilot', () => {
    mission.effectiveIsPilot = false
    entry()
    expect(fetchSuggestions).not.toHaveBeenCalled()
  })
})

const src = (p: string) => readFileSync(path.join(process.cwd(), 'src', p), 'utf8')

describe('both homes follow the sequence', () => {
  it.each([
    ['desktop', 'pages/DashboardPage.tsx', 'PilotWelcomeBanner'],
    ['mobile', 'components/mobile/MobilePilotHome.tsx', 'PilotMissionStrip'],
  ])('%s shows the mission only in the mission stage', (_name, file, _module) => {
    const page = src(file)
    expect(page).toContain('usePilotEntry')
    expect(page).toMatch(/stage === 'mission'/)
  })

  /**
   * "Not now" while the card is the whole screen leaves a reader on an empty
   * home with no way forward — the argument the pilot banners already make.
   */
  it.each([
    ['desktop', 'pages/DashboardPage.tsx'],
    ['mobile', 'components/mobile/MobilePilotHome.tsx'],
  ])('%s makes the setup card undismissable while it is the whole screen', (_name, file) => {
    expect(src(file)).toMatch(/dismissible=\{[a-zA-Z.]*stage === 'mission'\}/)
  })

  /**
   * Saving flips the stage on the tick the first row lands. An unkeyed sibling
   * list reconciles by position, which would unmount the card mid-save and
   * take its confirmation with it.
   */
  it.each([
    ['desktop', 'pages/DashboardPage.tsx'],
    ['mobile', 'components/mobile/MobilePilotHome.tsx'],
  ])('%s keys the setup card so it survives the stage change', (_name, file) => {
    expect(src(file)).toContain('key="coverage-setup"')
  })
})

describe('Coverage opens once the pilot has some', () => {
  const mode = src('hooks/usePilotMode.ts')

  it('unlocks through the access map rather than around it', () => {
    expect(mode).toContain("if (hasCoverage && base.coverage === 'hidden') base.coverage = 'full'")
    expect(src('components/layout/Header.tsx')).toContain("pilotMode.canUse('coverage')")
  })

  /** Only this key. A pilot's other gates are unchanged. */
  it('unlocks nothing else', () => {
    const unlocks = mode.match(/base\.\w+ = 'full'/g) ?? []
    expect(new Set(unlocks)).toEqual(new Set([
      "base.tradeBook = 'full'",
      "base.outcomes = 'full'",
      "base.coverage = 'full'",
    ]))
  })

  /** Coverage is setup, not a step: the mission must not read it. */
  it('stays out of the mission', () => {
    for (const f of ['lib/pilot/mission.ts', 'hooks/usePilotMission.ts']) {
      expect(src(f)).not.toContain('overage')
    }
  })
})

// ─── The post-capture hitch ──────────────────────────────────────────────

const mission = vi.hoisted(() => ({
  currentOrgId: 'org1' as string | null,
  tutorialIdeaId: null as string | null,
  effectiveIsPilot: true,
  setTutorialIdea: vi.fn(),
}))

vi.mock('../../contexts/OrganizationContext', () => ({
  useOrganization: () => ({ currentOrgId: mission.currentOrgId }),
}))
vi.mock('../usePilotMode', () => ({
  usePilotMode: () => ({ effectiveIsPilot: mission.effectiveIsPilot }),
}))
vi.mock('../usePilotProgress', () => ({
  usePilotProgress: () => ({
    progress: {},
    tutorialIdeaId: mission.tutorialIdeaId,
    setTutorialIdea: mission.setTutorialIdea,
    mark: vi.fn(),
    hasGraduated: false,
    isLoading: false,
  }),
}))
vi.mock('../../lib/supabase', () => ({
  supabase: {
    from: () => {
      const chain: any = {
        select: () => chain,
        eq: () => chain,
        maybeSingle: async () => ({ data: { id: 'idea1', stage: 'idea', outcome: null } }),
        then: (res: any) => Promise.resolve({ count: 0 }).then(res),
      }
      return chain
    },
  },
}))

import { usePilotMission } from '../usePilotMission'

describe('adopting a just-captured idea', () => {
  let client: QueryClient
  const wrapper = ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client }, children)

  beforeEach(() => {
    mission.tutorialIdeaId = null
    mission.setTutorialIdea.mockReset()
    client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  })

  /**
   * The seeded facts are not guesses. The row was created a moment ago by this
   * reader, so it exists; nothing can have simulated or decided a trade on an
   * id that did not exist until now; and a fresh capture has not been
   * advanced. The read still runs and overwrites all four.
   */
  it('seeds the facts for the new idea so the module never blanks', async () => {
    renderHook(() => usePilotMission(), { wrapper })
    act(() => {
      window.dispatchEvent(new CustomEvent('pilot-mission:trade-idea-created', {
        detail: { tradeIdeaId: 'idea1' },
      }))
    })
    await waitFor(() => {
      expect(client.getQueryData(['pilot-mission', 'org1', 'idea1'])).toEqual({
        ideaExists: true,
        ideaStage: null,
        hasSimulationTrade: false,
        hasDecision: false,
      })
    })
  })

  it('still records the idea as the tutorial one', () => {
    renderHook(() => usePilotMission(), { wrapper })
    act(() => {
      window.dispatchEvent(new CustomEvent('pilot-mission:trade-idea-created', {
        detail: { tradeIdeaId: 'idea1' },
      }))
    })
    expect(mission.setTutorialIdea).toHaveBeenCalledWith('idea1')
  })

  it('ignores the announcement for a reader who is not a pilot', () => {
    mission.effectiveIsPilot = false
    renderHook(() => usePilotMission(), { wrapper })
    act(() => {
      window.dispatchEvent(new CustomEvent('pilot-mission:trade-idea-created', {
        detail: { tradeIdeaId: 'idea1' },
      }))
    })
    expect(client.getQueryData(['pilot-mission', 'org1', 'idea1'])).toBeUndefined()
    mission.effectiveIsPilot = true
  })
})

describe('recording the tutorial idea does not wait on the server', () => {
  const progress = src('hooks/usePilotProgress.ts')

  /** The module reads this id to decide step one. */
  it('writes the cache before the round trip, and rolls back on failure', () => {
    const fn = progress.slice(progress.indexOf('const setTutorialIdea'))
    const optimistic = fn.indexOf("queryClient.setQueryData(['pilot-progress', user.id], nextProgress)")
    const update = fn.indexOf('.update({ pilot_progress: nextProgress }')
    expect(optimistic).toBeGreaterThan(-1)
    expect(optimistic).toBeLessThan(update)
    expect(fn).toContain('if (previous !== undefined) queryClient.setQueryData')
  })
})
