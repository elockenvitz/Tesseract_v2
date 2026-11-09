/**
 * Leave the Get Started flow and open the whole product.
 *
 * ── Why this is not a dismiss ─────────────────────────────────────────────
 *
 * `PilotWelcomeBanner` says, and is right to say, that it has no dismiss: it
 * is how a pilot advances, so a control that hides it is a control that hides
 * the way forward. This is the other thing. It does not hide the guide, it
 * FINISHES it: the steps are satisfied, the gate opens, and the reader lands
 * on the full Dashboard with every app reachable.
 *
 * ── Why it writes `graduated` and nothing else ────────────────────────────
 *
 * Because `graduated` is already the single definition of "this pilot's
 * access is wide", and introducing a second one is how the surfaces that read
 * it start disagreeing. Every gate in the flow reads `effectiveIsPilot`, which
 * is `hasGraduated ? false : isPilot`, so one mark retires all of them at
 * once: the Dashboard's first run, the Pipeline steps banner, the Trade Lab
 * intro, Trade Book's Get Started and the Outcomes strip. There is no list of
 * steps to tick off one by one, and a loop that ticked them would be a second
 * definition of done.
 *
 * `usePilotMission` stays the only thing that writes `graduated` from the five
 * real steps. This writes it from the reader saying they do not need them,
 * which is a different fact with the same consequence.
 *
 * ── Why the trophy is suppressed ──────────────────────────────────────────
 *
 * `PilotGraduationModal` opens on `hasGraduated` alone, by design -- so that
 * the celebration and the thing it celebrates cannot disagree. Skipping would
 * therefore congratulate somebody on finishing a loop they declined, over the
 * Dashboard they just asked to be let into. So the acknowledgement is written
 * in the same gesture. Both keys are timestamps in `pilot_progress` and
 * `enqueueProgressWrite` serialises them, reading the column again inside the
 * queue, so the second write carries the first rather than overwriting it.
 *
 * ── Why it asks first ─────────────────────────────────────────────────────
 *
 * Nothing in the product undoes it. Resetting is the Reset Progress button on
 * `OpsPilotPanel`, which a pilot does not have, so the confirm states that in
 * the reader's own terms rather than leaving them to find out.
 *
 * RLS posture: unchanged. `pilot_progress` is a column on the reader's own
 * `users` row, written through the same mutation every other mark uses. No
 * table, view or policy is touched.
 */

import { useState } from 'react'
import { ArrowRight } from 'lucide-react'
import { usePilotProgress } from '../../hooks/usePilotProgress'

export function PilotSkipOnboarding({
  /** `sheet` on a phone: the same control, with room for the reason to wrap. */
  variant = 'page',
}: { variant?: 'page' | 'sheet' } = {}) {
  const { mark, hasGraduated } = usePilotProgress()
  const [asking, setAsking] = useState(false)

  /* Already open. The homes that render this are gated on `effectiveIsPilot`
     so this should be unreachable, but a gate that has to be true elsewhere
     is a gate, and this is cheaper than finding out it was not. */
  if (hasGraduated) return null

  const finish = () => {
    /* Order matters only for the frame in between: `graduated` flips the gate
       optimistically, and the acknowledgement lands in the same tick, so the
       trophy has no render in which to open. */
    mark('graduated')
    mark('graduation_celebrated')
  }

  if (!asking) {
    return (
      <div
        data-testid="pilot-skip-onboarding"
        className={
          variant === 'sheet'
            ? 'flex flex-col gap-1 px-1 pt-1 text-center'
            : 'flex flex-wrap items-baseline justify-center gap-x-2 gap-y-1 pt-1 text-center'
        }
      >
        <span className="text-[13px] text-gray-500 dark:text-gray-400">
          Know your way around already?
        </span>
        <button
          type="button"
          onClick={() => setAsking(true)}
          className="text-[13px] font-semibold text-blue-600 underline-offset-2 hover:underline dark:text-blue-400"
        >
          Skip the guide and open the full Dashboard
        </button>
      </div>
    )
  }

  return (
    <div
      data-testid="pilot-skip-confirm"
      className="rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800"
    >
      <p className="text-[15px] font-semibold text-gray-900 dark:text-gray-100">
        Open everything now?
      </p>
      {/* What it does, then what it costs, in that order. Said plainly because
          the reader cannot put it back themselves. */}
      <p className="mt-1 max-w-[62ch] text-[13px] leading-relaxed text-gray-600 dark:text-gray-400">
        This marks the Get Started steps complete and unlocks every app, so you
        can begin working straight away. The guide will not come back, and only
        an administrator can restore it.
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={finish}
          className="inline-flex items-center gap-1.5 rounded-md border border-blue-600 bg-blue-600 px-3 py-1.5 text-[13px] font-semibold text-white hover:bg-blue-700"
        >
          Open the full Dashboard
          <ArrowRight className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          onClick={() => setAsking(false)}
          className="rounded-md px-3 py-1.5 text-[13px] font-semibold text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700"
        >
          Keep the guide
        </button>
      </div>
    </div>
  )
}
