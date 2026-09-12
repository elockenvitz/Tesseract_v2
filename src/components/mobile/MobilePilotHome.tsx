import { FirstSessionCoveragePrompt } from '../coverage/FirstSessionCoveragePrompt'
import { PilotMissionStrip } from './PilotMissionStrip'
import { usePilotEntry } from '../../hooks/usePilotEntry'

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
 * ── Setup comes before the mission ────────────────────────────────────────
 *
 * The same two things were still stacked here, one layer down: coverage setup
 * and the mission strip, asking a reader who has told us nothing to go capture
 * an investment idea. Coverage is what makes the mission's destinations worth
 * visiting, so it goes first and alone — and the moment it is saved, the
 * mission appears. `usePilotEntry` decides which; it is a sequence, not a
 * sixth step, and nothing about graduation changes.
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
  const { stage } = usePilotEntry()

  return (
    <div className="h-full overflow-y-auto bg-gray-50 px-3 [padding-top:calc(0.75rem+env(safe-area-inset-top))] pb-6 dark:bg-gray-900">
      <div className="space-y-2.5">
        {stage === 'mission' && <PilotMissionStrip key="mission" onNavigate={onNavigate} />}
        {/*
          Keyed so the prompt is the SAME instance either side of the stage
          change. Saving coverage flips the stage on the tick the first row
          lands, and an unkeyed sibling list would reconcile by position —
          unmounting the card mid-save and taking the confirmation with it.

          Not dismissible while it is the whole screen: "Not now" there leaves
          a reader on an empty home.
        */}
        {stage !== 'loading' && (
          <FirstSessionCoveragePrompt
            key="coverage-setup"
            variant="sheet"
            dismissible={stage === 'mission'}
          />
        )}
      </div>
    </div>
  )
}
