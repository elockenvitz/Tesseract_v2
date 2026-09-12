import { FirstSessionCoveragePrompt } from '../coverage/FirstSessionCoveragePrompt'
import { PilotMissionStrip } from './PilotMissionStrip'

/**
 * The phone's home while a pilot is still working through the mission.
 *
 * ── Why this replaces the feed rather than sitting above it ───────────────
 *
 * It was a coverage card stacked on top of the ordinary dashboard, so a reader
 * on step one got a setup prompt, a guidance strip and a full attention feed at
 * once — three unrelated invitations on a 390px screen, and the feed carried
 * seeded sample thoughts that competed with the one thing they were being
 * asked to do. Same mistake the desktop home had, same fix: while the mission
 * is unfinished this IS the home, and nothing behind it renders or fetches.
 *
 * ── Same truth, phone composition ─────────────────────────────────────────
 *
 * `PilotMissionStrip` reads the shared mission state and draws the count, the
 * current step and one control. Deliberately not the five desktop rows: five
 * labels, five hints and five states in a phone column is a checklist, and the
 * reader only has one next move.
 *
 * The ordinary `MobileDashboard` returns on its own at graduation, because the
 * branch that chooses between them reads `effectiveIsPilot`, which is already
 * `hasGraduated ? false : isPilot`.
 */
export function MobilePilotHome({ onNavigate }: { onNavigate: (result: any) => void }) {
  return (
    <div className="h-full overflow-y-auto bg-gray-50 px-3 [padding-top:calc(0.75rem+env(safe-area-inset-top))] pb-6 dark:bg-gray-900">
      <div className="space-y-2.5">
        <PilotMissionStrip onNavigate={onNavigate} />
        {/* Setup under the story, and it still owns its own latched
            show/dismiss decision — a pilot with coverage sees nothing here. */}
        <FirstSessionCoveragePrompt variant="sheet" />
      </div>
    </div>
  )
}
