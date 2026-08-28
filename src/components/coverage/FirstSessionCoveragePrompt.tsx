import { useEffect, useState } from 'react'
import { useAuth } from '../../hooks/useAuth'
import { useOrganization } from '../../contexts/OrganizationContext'
import { useMyCoverage } from '../../hooks/useMyCoverage'
import { CoverageQuickStart } from './CoverageQuickStart'

/**
 * Shows the coverage prompt to a user who has none, and then stops.
 *
 * ── Why the condition is "has no coverage" and not "is new" ───────────────
 *
 * Onboarding state that lives in a flag is state that can disagree with
 * reality. `pilot_progress` is the cautionary example already in this codebase:
 * per-org JSONB keys, a localStorage mirror to stop it flickering, a write
 * dedupe set to stop it flooding a telemetry table, and a documented list of
 * legacy keys that must never be read. All of it exists to make a flag agree
 * with what the user has actually done.
 *
 * Coverage needs none of it, because the artifact IS the state. A user with
 * coverage rows does not see this; a user without them does. That is correct
 * for every case without a single extra column:
 *
 *   * started on desktop, continued on mobile — the rows are in Postgres, so
 *     the second device already knows
 *   * invited into a configured team — they arrive with assigned rows, so the
 *     prompt never appears and they are not asked to redo somebody's work
 *   * holdings but no coverage — the prompt appears, pre-loaded with the names
 *     in their book, which is the fastest version of this question
 *   * returning without finishing — still no rows, so still asked; nothing had
 *     to remember they bailed
 *   * refreshed after saving — rows exist, so no nag
 *
 * ── Why dismissal is local and coverage is not ────────────────────────────
 *
 * "Not now" is a per-device presentation preference whose worst case is seeing
 * one card again, which is the bar `feed-rotation` and `dispositions` already
 * set for using localStorage. What the user actually decides — the coverage —
 * goes to the database.
 *
 * The dismissal is deliberately NOT permanent-until-coverage-exists: it is
 * keyed per user and organization, so somebody who joins a second workspace is
 * asked there once. Clearing it is a matter of declaring any coverage.
 */

interface FirstSessionCoveragePromptProps {
  variant?: 'card' | 'sheet'
  /** Where "see what's happening" goes, if this surface is not already Ideas. */
  onGoToIdeas?: () => void
  className?: string
}

const dismissKey = (userId: string, orgId: string) =>
  `tesseract:coverage-prompt-dismissed:${userId}:${orgId}`

export function FirstSessionCoveragePrompt({
  variant = 'card',
  onGoToIdeas,
  className,
}: FirstSessionCoveragePromptProps) {
  const { user } = useAuth()
  const { currentOrgId } = useOrganization()
  const { hasCoverage, isLoading } = useMyCoverage()

  // Starts dismissed so nothing can flash before the real answer is known.
  const [dismissed, setDismissed] = useState(true)

  /**
   * The decision to show, latched on the first trustworthy evaluation.
   *
   * Found in real authenticated testing on staging, not by the fixture tests:
   * saving invalidates the coverage query, `hasCoverage` flips true the moment
   * the FIRST row lands, and re-reading it here unmounted CoverageQuickStart
   * mid-save — so the rows were written correctly and the user was shown
   * nothing. The confirmation, and the route into Ideas, were both lost.
   *
   * Latching also fixes a subtler version: coverage arriving from another
   * device mid-session would otherwise make the card vanish under the reader's
   * cursor. The decision belongs to the mount, not to every render; a refresh
   * is a new mount and re-evaluates honestly.
   */
  const [show, setShow] = useState<boolean | null>(null)

  // Read after mount rather than during render: localStorage throws in some
  // embedded contexts, and this renders inside the gallery harness too.
  useEffect(() => {
    if (!user?.id || !currentOrgId) return
    try {
      setDismissed(!!localStorage.getItem(dismissKey(user.id, currentOrgId)))
    } catch {
      setDismissed(false)
    }
  }, [user?.id, currentOrgId])

  // Latch the decision once the coverage query has actually resolved.
  useEffect(() => {
    if (isLoading || show !== null) return
    setShow(!hasCoverage)
  }, [isLoading, hasCoverage, show])

  if (!user?.id || !currentOrgId) return null

  // Never flash the prompt at somebody who already has coverage while the
  // query resolves. Being told to set up something already set up is the exact
  // failure that makes onboarding feel like it is not paying attention.
  if (isLoading || show === null) return null
  if (dismissed) return null
  if (!show) return null

  return (
    <CoverageQuickStart
      variant={variant}
      className={className}
      onGoToIdeas={onGoToIdeas}
      onDismiss={() => {
        try {
          localStorage.setItem(dismissKey(user.id, currentOrgId), '1')
        } catch {
          /* a dismissal failing to persist must not break the surface */
        }
        setDismissed(true)
      }}
    />
  )
}
