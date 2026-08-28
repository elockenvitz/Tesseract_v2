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
 * Onboarding state that is a flag on the user is state that can disagree with
 * reality. `pilot_progress` is the cautionary example already in this
 * codebase: per-org JSONB keys, a localStorage mirror to stop it flickering, a
 * write-dedupe set to stop it flooding a telemetry table, and a documented
 * list of legacy keys that must never be read. All of that exists to make a
 * flag agree with what the user has actually done.
 *
 * Coverage does not need any of it, because the artifact IS the state. A user
 * with coverage rows does not see this; a user without them does. That is
 * correct for every case the brief asks about without a single extra column:
 *
 *   * started on desktop, continued on mobile — the rows are in Postgres, so
 *     the second device already knows
 *   * invited into a configured team — they arrive with assigned rows, so the
 *     prompt never appears and they are not asked to redo somebody's work
 *   * holdings but no coverage — the prompt appears, pre-loaded with the names
 *     in their book, which is the fastest possible version of this question
 *   * returning incomplete user — still no rows, so still asked; nothing had
 *     to remember they bailed
 *   * skipped optional setup — same
 *
 * ── Why dismissal is local and coverage is not ────────────────────────────
 *
 * "I do not want to answer this right now" is a per-device presentation
 * preference with a one-card cost if it is lost, which is exactly the bar
 * `feed-rotation` and `dispositions` set for using localStorage. What the user
 * actually decides — the coverage itself — goes to the database. The split is
 * the same one the rest of the mobile surface already makes.
 */

interface FirstSessionCoveragePromptProps {
  variant?: 'card' | 'sheet'
  className?: string
}

const dismissKey = (userId: string, orgId: string) =>
  `tesseract:coverage-prompt-dismissed:${userId}:${orgId}`

export function FirstSessionCoveragePrompt({
  variant = 'card',
  className,
}: FirstSessionCoveragePromptProps) {
  const { user } = useAuth()
  const { currentOrgId } = useOrganization()
  const { hasCoverage, isLoading } = useMyCoverage()

  const [dismissed, setDismissed] = useState(true)

  // Read after mount rather than during render: localStorage access throws in
  // some embedded contexts, and this component renders inside the gallery
  // harness as well as the app.
  useEffect(() => {
    if (!user?.id || !currentOrgId) return
    try {
      setDismissed(!!localStorage.getItem(dismissKey(user.id, currentOrgId)))
    } catch {
      setDismissed(false)
    }
  }, [user?.id, currentOrgId])

  // Never flash the prompt at a user who does have coverage while the query is
  // still resolving. Being told to set up something already set up is the
  // specific failure that makes onboarding feel like it is not paying
  // attention.
  if (isLoading || hasCoverage || dismissed) return null
  if (!user?.id || !currentOrgId) return null

  return (
    <CoverageQuickStart
      variant={variant}
      className={className}
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
