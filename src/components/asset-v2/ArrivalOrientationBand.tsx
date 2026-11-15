/**
 * The arrival band as the canonical asset page draws it.
 *
 * ── Why this exists separately from `EntryOrientation` ────────────────────
 *
 * `EntryOrientation` is the band. This is the decision about whether the
 * canonical page shows one, and which of its controls that page can honour
 * -- three claims that were previously a JSX conditional buried at line
 * 4,475 of a 6,300-line file, inside a component with a hundred imports that
 * no test can stand up:
 *
 *   both or neither   a context with no facts yet would be a band stating an
 *                     event with nothing to compare it against. The page
 *                     fetches, so "not yet" is a real state and the honest
 *                     render for it is nothing.
 *   one destination   `reviewCase` and `openScenarios` both land in Research
 *                     on this page, because the scenario framework is a
 *                     section of it. The band is given one and draws one.
 *                     `openFullWorkspace` would link to the page the reader
 *                     is standing on, so it is not given either.
 *   the waiting one   `openPending` is always handed over, because the band
 *                     itself draws the control only beside a request that is
 *                     actually open (`EntryOrientation`'s own
 *                     `facts.pending` gate, covered by its own tests). A
 *                     second gate here would be decoration: injecting a
 *                     failure into it changes nothing a test can see, which
 *                     is the definition of a check that is not one.
 *
 * ── What the host still owns ──────────────────────────────────────────────
 *
 * Where Research is, where decisions are, and how a question reaches ACT AI.
 * This composes the issue that accompanies the question -- the headline the
 * reader pressed, and the intent it came from -- because that comes off the
 * context and is the part worth checking.
 */
import { EntryOrientation, type OrientationPageFacts } from './EntryOrientation'
import type { WorkspaceEntryContext } from '../../lib/asset-workspace/entry-context'

/** The issue an arrival question carries, for whoever routes it. */
export interface ArrivalAskIssue {
  title: string
  reason: string
}

export function arrivalAskIssue(context: WorkspaceEntryContext): ArrivalAskIssue | null {
  if (!context.why) return null
  return { title: context.why.headline, reason: `entry:${context.intent}` }
}

export function ArrivalOrientationBand({
  context, facts, onReviewCase, onOpenPending, onAsk, now,
}: {
  context: WorkspaceEntryContext | null
  facts: OrientationPageFacts | null
  /** Research, where the case and the framework under it both live. */
  onReviewCase: () => void
  /** Where a waiting request is answered. */
  onOpenPending: () => void
  onAsk: (question: string, issue: ArrivalAskIssue | null) => void
  now?: number
}) {
  if (!context || !facts) return null

  return (
    <div className="mb-4" data-slot="asset-arrival-orientation">
      <EntryOrientation
        context={context}
        facts={facts}
        {...(now !== undefined ? { now } : {})}
        actions={{
          reviewCase: onReviewCase,
          openPending: onOpenPending,
          ask: (question: string) => onAsk(question, arrivalAskIssue(context)),
        }}
      />
    </div>
  )
}
