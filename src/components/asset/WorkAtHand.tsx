/**
 * The process the reader came to advance.
 *
 * ── What this is for ─────────────────────────────────────────────────────
 *
 * An analyst who follows an assigned requirement -- from their own open-tasks
 * list, or from a process run -- arrives at an asset page whose Overview has
 * never mentioned the process at all. The work was two clicks away on another
 * mode, and the page they landed on led with a thesis excerpt.
 *
 * This states the run, how far through it is, and what is still owed, with the
 * requirement they followed at the top. It does NOT reproduce the Work
 * surface: nothing here completes a requirement, writes a takeaway, advances
 * a stage or edits a process. Every one of those is one button away, in the
 * surface that owns it.
 *
 * ── Where the facts come from ────────────────────────────────────────────
 *
 * `useAssetOpenRequirements` (a narrow projection of `asset_checklist_items`,
 * org-scoped server-side) and the workflow's own name. The stage rail, the
 * deadlines and the takeaways are the Work surface's, read through keys this
 * file deliberately does not touch.
 *
 * ── Permission scope ─────────────────────────────────────────────────────
 *
 * RLS posture is stated on the hook: caller's client, RLS enabled, SELECT
 * scoped to the caller's active organization. Nothing here writes.
 */
import { clsx } from 'clsx'
import { useAssetOpenRequirements } from '../../hooks/useAssetOpenRequirements'
import { SnapBlock, StatusChip, QuietLine } from './SnapshotBlocks'

export interface WorkAtHandProps {
  assetId: string
  workflowId: string
  /** The run's name, where the page already resolved one. */
  workflowName?: string | null
  /** The requirement the reader followed in, when the sender named one. */
  requirementId?: string | null
  /** The sender's one-line reason for the hop. */
  reason?: string | null
  /** Through to the Work surface, at the process. */
  onOpenProcess: () => void
}

/** How many open requirements to name before the list stops being readable. */
const SHOWN = 4

const dueLabel = (iso: string | null): string | null => {
  if (!iso) return null
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return null
  return `due ${new Date(t).toLocaleDateString()}`
}

export function WorkAtHand({
  assetId, workflowId, workflowName, requirementId, reason, onOpenProcess,
}: WorkAtHandProps) {
  const { all, open, doneCount, isLoading } = useAssetOpenRequirements(assetId, workflowId)

  /* The one the reader followed leads, then the process's own order. */
  const ordered = requirementId
    ? [...open].sort((a, b) => (a.id === requirementId ? -1 : b.id === requirementId ? 1 : 0))
    : open
  const shown = ordered.slice(0, SHOWN)
  /*
   * The arrived requirement may already be done -- a link followed after
   * somebody completed it. It is then not in `open`, and saying nothing about
   * it would leave the reader wondering whether they arrived at the wrong
   * place.
   */
  const arrivedDone = requirementId
    ? all.find(r => r.id === requirementId && r.completed) ?? null
    : null

  return (
    <SnapBlock
      testId="snapshot-work-at-hand"
      rail="action"
      title="Work in progress"
      meta={workflowName ?? undefined}
      action={(
        <button
          type="button"
          data-testid="work-at-hand-open"
          onClick={onOpenProcess}
          className="text-sm text-primary-600 hover:underline dark:text-primary-400"
        >
          Open the process →
        </button>
      )}
    >
      {reason && <QuietLine className="mb-3">You were sent here: {reason}</QuietLine>}

      {/* Progress as a count of records, never a percentage: a process with
          three requirements does not have a meaningful 33%. */}
      {all.length > 0 ? (
        <div className="text-sm text-gray-700 dark:text-gray-300" data-testid="work-at-hand-progress">
          {doneCount} of {all.length} requirement{all.length === 1 ? '' : 's'} complete
          {open.length > 0 ? `, ${open.length} still owed` : ', nothing outstanding'}
        </div>
      ) : isLoading ? (
        <QuietLine>Reading the process.</QuietLine>
      ) : (
        <QuietLine>
          This run has no requirements on record. The process surface is where they are added.
        </QuietLine>
      )}

      {arrivedDone && (
        <div className="mt-3 rounded-lg border border-gray-200 p-3 dark:border-white/[0.08]">
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
            <span className="text-sm text-gray-800 dark:text-gray-200">
              {arrivedDone.text ?? 'Untitled requirement'}
            </span>
            <StatusChip tone="done">Already complete</StatusChip>
          </div>
        </div>
      )}

      {shown.length > 0 && (
        <ul className="mt-3 flex flex-col gap-2" data-testid="work-at-hand-open-list">
          {shown.map(r => {
            const arrived = !!requirementId && r.id === requirementId
            const meta = [r.assigneeName ? `assigned to ${r.assigneeName}` : 'unassigned', dueLabel(r.dueDate)]
              .filter(Boolean)
              .join(' · ')
            return (
              <li
                key={r.id}
                data-testid="work-at-hand-requirement"
                data-requirement={r.id}
                data-arrived={arrived ? 'yes' : undefined}
                className={clsx(
                  'rounded-lg border p-3',
                  arrived
                    ? 'border-amber-300 bg-amber-50/60 dark:border-amber-500/40 dark:bg-amber-500/[0.06]'
                    : 'border-gray-200 dark:border-white/[0.08]',
                )}
              >
                <div className="text-sm text-gray-800 dark:text-gray-200">
                  {/* An untitled requirement is a real state of this data and
                      is said plainly rather than rendered as a blank row. */}
                  {r.text ?? 'Untitled requirement'}
                </div>
                <div className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">{meta}</div>
              </li>
            )
          })}
        </ul>
      )}
      {open.length > shown.length && (
        <QuietLine className="mt-2">
          {open.length - shown.length} more outstanding, on the process surface.
        </QuietLine>
      )}
    </SnapBlock>
  )
}
