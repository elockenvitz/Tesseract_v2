import { useQuery } from '@tanstack/react-query'
import { useAuth } from './useAuth'
import { useOrganization } from '../contexts/OrganizationContext'
import { useHasCoverage } from './useMyCoverage'
import { usePilotMode } from './usePilotMode'
import {
  coverageSuggestionsKey,
  fetchCoverageSuggestions,
} from '../lib/coverage/quick-start-suggestions'

/**
 * What a pilot who has not finished onboarding is looking at: setup, or the
 * mission.
 *
 * ── Why there are two stages and not one screen ──────────────────────────
 *
 * Coverage setup and the five-step mission used to render together, stacked.
 * A pilot's first screen therefore asked two unrelated things at once — tell
 * us what you follow, and also capture an investment idea — and the mission's
 * first step is a worse invitation when the product still knows nothing about
 * the reader. Coverage is what makes everything downstream relevant, so it
 * goes first and alone.
 *
 * It is setup, NOT a sixth step. The mission is five steps about one idea and
 * stays five; nothing here is added to it, and coverage has no bearing on
 * whether a pilot graduates.
 *
 * ── Why the stage is derived from the rows ───────────────────────────────
 *
 * Same reason `FirstSessionCoveragePrompt` gives for its own condition: a flag
 * describing whether setup happened is a flag that can disagree with whether
 * setup happened. The rows are the state. A pilot invited into a configured
 * team arrives with assigned coverage and goes straight to the mission, which
 * is correct — they are not asked to redo somebody else's work.
 *
 * ── Why it also starts the suggestions request ───────────────────────────
 *
 * Because the card that needs them mounts too late to ask. The chain was
 * serial: read coverage to decide the stage, mount the prompt, mount the card,
 * and only then ask what to suggest — three round trips before a screen whose
 * whole job is to be answered in a minute showed anything but a spinner.
 *
 * Starting it here puts that request beside the coverage read instead of
 * behind it. Same query key, so the card finds the answer already in the cache
 * rather than issuing a second request, and a reader who turns out to have
 * coverage already has simply warmed a cache entry nobody reads.
 *
 * ── Why loading is its own stage ─────────────────────────────────────────
 *
 * Treating "not loaded yet" as "no coverage" shows the setup surface for a
 * frame to a pilot who finished it last week. Callers render nothing while
 * this says `loading`, which is the same thing both homes already do with
 * `mission.isLoading`.
 */
export type PilotEntryStage = 'loading' | 'coverage' | 'mission'

export function usePilotEntry(): { stage: PilotEntryStage } {
  const { user } = useAuth()
  const { currentOrgId } = useOrganization()
  const { effectiveIsPilot } = usePilotMode()
  const { hasCoverage, isLoading } = useHasCoverage()

  // Only a pilot sees the setup card, so only a pilot should pay for the three
  // reads behind it. The shell calls this hook for everyone.
  useQuery({
    queryKey: coverageSuggestionsKey(user?.id ?? null, currentOrgId),
    enabled: !!user?.id && !!currentOrgId && effectiveIsPilot,
    staleTime: 5 * 60_000,
    queryFn: () => fetchCoverageSuggestions(user!.id, currentOrgId!),
  })

  if (isLoading) return { stage: 'loading' }
  return { stage: hasCoverage ? 'mission' : 'coverage' }
}
