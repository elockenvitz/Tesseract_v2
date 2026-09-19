import { ArrowRight, Compass } from 'lucide-react'
import { Button } from '../ui/Button'

/**
 * What a pilot sees when they reach a surface that is not part of their loop
 * yet.
 *
 * ── What this replaces, and why ───────────────────────────────────────────
 *
 * A `useEffect` in DashboardPage that watched the active tab and, if its
 * feature was gated `hidden`, silently reassigned `activeTabId` back to the
 * Dashboard. The user clicked a thing, the thing opened, and then the app took
 * it away with no explanation. There is no message that arrives with a
 * redirect, so every one of these read as a bug — and to be fair to the
 * reader, a surface you can open and cannot stay on is indistinguishable from
 * one that crashed.
 *
 * The redirect also fought the rest of the app for control of the tab bar.
 * `visibleTabs` already filters gated surfaces out of the picker, so the only
 * way to reach one is a deep link, a restored tab from a previous session, or
 * an internal navigation the guard did not know about — and that last case
 * caused a real bug: expanding a chart from the Ideas tab opened `charting`
 * and got bounced to Dashboard, which is why `effectiveIsPilot` had to grow a
 * graduation carve-out.
 *
 * Progressive disclosure and hard navigation denial look similar on a
 * whiteboard and are not the same thing. Not putting a surface in the nav is
 * disclosure. Letting someone open it and then confiscating it is denial with
 * extra steps. This component is the disclosure version: the surface is real,
 * it says what it is and when it becomes useful, and the user stays exactly
 * where they chose to be until they decide otherwise.
 */

interface PilotNotYetCardProps {
  /** Human label for the surface, e.g. "Calendar". */
  title: string
  /** Where the useful work is right now. */
  onGoToDashboard: () => void
}

/**
 * One line per gated surface saying what it does and what makes it useful.
 *
 * Written per-surface rather than as one generic string because a generic
 * string is what makes a gate feel arbitrary. "Not available during your pilot"
 * tells the reader nothing; "Calendar tracks earnings dates and catalysts for
 * the names you cover" tells them what they would get and implies what to do
 * to get there.
 */
const EXPLANATIONS: Record<string, string> = {
  calendar:
    'Calendar tracks earnings dates, catalysts and deadlines across the names you cover. It fills in once you have coverage and a few positions in flight.',
  charting:
    'Charting is the full price and fundamentals workbench. Individual charts are already available from any asset page — this is the standalone surface for comparing several at once.',
  files:
    'Files is shared document storage for a research team. It becomes useful once more than one person is working in this workspace.',
  priorities:
    'Priorities ranks what to work on next across your whole coverage. It needs a few weeks of research activity before its ordering means anything.',
  projects:
    'Projects coordinates multi-step research work across a team — deliverables, owners and deadlines. It is built for a workspace with several people in it.',
}

export function PilotNotYetCard({ title, onGoToDashboard }: PilotNotYetCardProps) {
  const key = title.toLowerCase()
  const explanation =
    EXPLANATIONS[key] ??
    `${title} is part of Tesseract but is not wired into your workspace yet.`

  return (
    <div className="h-full w-full overflow-auto">
      <div className="mx-auto max-w-lg px-6 py-16 text-center">
        <div className="mx-auto mb-5 flex h-12 w-12 items-center justify-center rounded-xl bg-gray-100 dark:bg-gray-800">
          <Compass className="h-6 w-6 text-gray-400" />
        </div>

        <h2 className="mb-2 text-base font-semibold text-gray-900 dark:text-white">
          {title} is not set up yet
        </h2>

        <p className="mb-6 text-sm leading-relaxed text-gray-500 dark:text-gray-400">
          {explanation}
        </p>

        <Button variant="outline" onClick={onGoToDashboard}>
          Back to your workspace
          <ArrowRight className="ml-2 h-4 w-4" />
        </Button>
      </div>
    </div>
  )
}
