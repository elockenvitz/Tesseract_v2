import { clsx } from 'clsx'
import { Skeleton } from '../common/LoadingSkeleton'

/**
 * The shapes the pilot home holds while it is working out what to draw.
 *
 * ── Why these exist ──────────────────────────────────────────────────────
 *
 * Every module on the pilot home returned `null` while its own query was in
 * flight, and they resolve at different times: the coverage read decides which
 * stage it is, the progress read decides whether the mission has anything in
 * it, and the mission facts read decides how much. So the home arrived as a
 * sequence of pop-ins, each one pushing the last down the page. Nothing was
 * slow enough to look like loading; it just moved.
 *
 * `null` was the right call for the flash it prevents — a module that guesses
 * and corrects itself is worse than one that waits. It is the wrong call for
 * the space: the page can reserve the room honestly without claiming to know
 * what goes in it.
 *
 * ── Why they match the real geometry ─────────────────────────────────────
 *
 * A placeholder of the wrong height moves the page exactly as much as no
 * placeholder at all, just later. These carry the real chrome — the same
 * rounded border, padding and row rhythm — so the swap changes the content
 * inside a box that has not moved.
 */

/** The five-step module, unexpanded height plus its rows. */
export function PilotMissionSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div
      data-slot="pilot-mission-skeleton"
      aria-hidden="true"
      className="rounded-xl border border-indigo-200/60 bg-gradient-to-r from-indigo-50 to-blue-50 dark:border-indigo-800/40 dark:from-indigo-950/30 dark:to-blue-950/20"
    >
      <div className="flex items-start gap-2 px-4 py-2.5">
        <Skeleton className="mt-0.5 h-4 w-4 rounded dark:bg-gray-700" />
        <div className="flex-1 space-y-1.5">
          <Skeleton className="h-3.5 w-32 dark:bg-gray-700" />
          <Skeleton className="h-2.5 w-56 dark:bg-gray-700" />
        </div>
      </div>
      <div className="space-y-1 px-3 pb-3">
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} className="flex items-start gap-2.5 px-2.5 py-2">
            <Skeleton className="mt-0.5 h-4 w-4 rounded-full dark:bg-gray-700" />
            <div className="flex-1 space-y-1.5">
              <Skeleton className="h-3 w-40 dark:bg-gray-700" />
              <Skeleton className="h-2.5 w-full max-w-sm dark:bg-gray-700" />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

/** The phone's one-step strip. */
export function PilotMissionStripSkeleton() {
  return (
    <div
      data-slot="pilot-mission-strip-skeleton"
      aria-hidden="true"
      className="rounded-xl border border-indigo-200/60 bg-gradient-to-r from-indigo-50 to-blue-50 px-3.5 py-3 dark:border-indigo-800/40 dark:from-indigo-950/30 dark:to-blue-950/20"
    >
      <Skeleton className="h-2.5 w-24 dark:bg-gray-700" />
      <Skeleton className="mt-2 h-3.5 w-44 dark:bg-gray-700" />
      <Skeleton className="mt-1.5 h-2.5 w-full max-w-xs dark:bg-gray-700" />
    </div>
  )
}

/**
 * The whole home, before the coverage read has said which stage it is.
 *
 * One shape for both stages on purpose. Which module goes here is exactly the
 * thing not yet known, and a skeleton shaped like the wrong guess is a pop-in
 * with extra steps.
 */
export function PilotHomeSkeleton({ dense = false }: { dense?: boolean }) {
  return (
    <div
      data-slot="pilot-home-skeleton"
      aria-busy="true"
      aria-label="Loading"
      className={clsx(
        'rounded-xl border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800',
        dense ? 'p-3' : 'p-5',
      )}
    >
      <Skeleton className="h-4 w-44 dark:bg-gray-700" />
      <Skeleton className="mt-2 h-3 w-full max-w-md dark:bg-gray-700" />
      <Skeleton className="mt-4 h-10 w-full rounded-lg dark:bg-gray-700" />
      <div className="mt-3 flex gap-1.5">
        <Skeleton className="h-6 w-32 rounded-full dark:bg-gray-700" />
        <Skeleton className="h-6 w-20 rounded-full dark:bg-gray-700" />
      </div>
      <div className="mt-4 space-y-2">
        {Array.from({ length: dense ? 3 : 5 }).map((_, i) => (
          <div key={i} className="flex items-center gap-3 px-2 py-2">
            <Skeleton className="h-5 w-5 rounded-md dark:bg-gray-700" />
            <div className="flex-1 space-y-1.5">
              <Skeleton className="h-3 w-16 dark:bg-gray-700" />
              <Skeleton className="h-2.5 w-40 dark:bg-gray-700" />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
