/**
 * The process title IS the switcher.
 *
 * ── What this replaces ──────────────────────────────────────────────────
 *
 * "⋯" → a dropdown trigger inside the menu → a 384px floating panel. Three
 * clicks and two layers of popover to answer "which process am I on", with
 * the open process listed as a choice to make rather than a fact.
 *
 * Here the title states the answer and opening it offers the alternatives.
 * One layer, one panel, flat groups with headings. The open run is shown at
 * the top as context with a check — not as a row that has to be picked
 * before the rest becomes reachable.
 *
 * ── Staying on screen ───────────────────────────────────────────────────
 *
 * The panel measures its trigger and flips its horizontal anchor when the
 * left-aligned position would run past the viewport, and caps its height
 * against the space below. The old panel was a fixed `w-96` that could and
 * did hang off the right edge on a narrow window, with `max-h-[500px]`
 * regardless of whether 500px existed.
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { clsx } from 'clsx'
import { Check, ChevronDown, ClipboardList, CornerUpLeft, FileText, History, Plus } from 'lucide-react'
import type { SwitcherEntry, SwitcherGroups } from '../../../lib/asset-work/process-switcher'

const EYEBROW =
  'px-3 pt-2.5 pb-1 block text-[10px] font-semibold uppercase tracking-wider text-gray-400'

const shortDate = (iso: string | null): string | null => {
  if (!iso) return null
  const d = new Date(iso)
  return Number.isNaN(d.getTime())
    ? null
    : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

interface Props {
  groups: SwitcherGroups
  /** Falls back to this when no run is open yet. */
  fallbackLabel?: string
  onSelect: (workflowId: string) => void
  onJoin?: (workflowId: string) => void
  /** The two views that used to be buried in an unrelated "⋯" menu. */
  onOpenDocuments?: () => void
  onOpenActivity?: () => void
  /** The consolidated record of this cycle. */
  onOpenReport?: () => void
  documentsActive?: boolean
  activityActive?: boolean
  reportActive?: boolean
  /**
   * Cycles the cadence will cut but which do not exist yet.
   *
   * Informational only, and not buttons: a run that has not been created
   * cannot be opened, and a row that looks clickable but is not is worse
   * than a row that plainly says "due".
   */
  upcoming?: ReadonlyArray<{ workflowId: string; branchName: string; estimatedStartDate: Date }>
  busy?: boolean
  className?: string
}

function Row({
  entry, onSelect, muted, showName,
}: {
  entry: SwitcherEntry
  onSelect: (id: string) => void
  muted?: boolean
  /**
   * Whether the PROCESS name has to be printed on the row.
   *
   * Under "Previous cycles of Earnings Season" the heading already names
   * the process, so the rows say only which cycle — "Feb 2026". Under
   * "Finished", which mixes processes, the same row read as a bare date
   * with nothing to say what had finished.
   */
  showName?: boolean
}) {
  const stamp = shortDate(entry.at)
  const lead = showName ? entry.name : (entry.run || entry.name)
  const trail = showName && entry.run ? entry.run : null
  return (
    <button
      type="button"
      role="menuitem"
      data-testid={`process-switcher-run-${entry.workflowId}`}
      onClick={() => onSelect(entry.workflowId)}
      className="flex w-full items-baseline gap-2 px-3 py-1.5 text-left hover:bg-gray-50 dark:hover:bg-gray-800"
    >
      <span className={clsx(
        'min-w-0 flex-1 truncate text-[12px]',
        muted ? 'text-gray-600 dark:text-gray-300' : 'font-medium text-gray-900 dark:text-gray-100',
      )}>
        {lead}
        {trail && <span className="ml-1.5 text-gray-400">{trail}</span>}
      </span>
      {entry.completed && (
        <span className="flex-none text-[10px] font-semibold uppercase tracking-wide text-emerald-700 dark:text-emerald-400">
          done
        </span>
      )}
      {stamp && <span className="flex-none text-[10px] text-gray-400">{stamp}</span>}
    </button>
  )
}

export function ProcessSwitcher({
  groups, fallbackLabel, onSelect, onJoin,
  onOpenDocuments, onOpenActivity, onOpenReport,
  documentsActive, activityActive, reportActive,
  upcoming = [], busy, className,
}: Props) {
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  const panel = useRef<HTMLDivElement>(null)
  const [place, setPlace] = useState<{ right: boolean; maxH: number }>({ right: false, maxH: 420 })

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  /*
   * Measured before paint, so the panel never appears in the wrong place
   * and jumps. 320px is the panel's width; 16px keeps it off the edge.
   */
  useLayoutEffect(() => {
    if (!open || !root.current) return
    const r = root.current.getBoundingClientRect()
    setPlace({
      right: r.left + 320 > window.innerWidth - 16,
      maxH: Math.max(220, window.innerHeight - r.bottom - 24),
    })
  }, [open])

  const { current, active, previousCycles, otherCompleted, joinable, returnTo } = groups
  const title = current ? current.name : (fallbackLabel ?? 'Process')
  const choose = (id: string) => { setOpen(false); onSelect(id) }

  const hasAnything =
    active.length > 0 || previousCycles.length > 0 ||
    otherCompleted.length > 0 || joinable.length > 0

  return (
    <div ref={root} className={clsx('relative min-w-0', className)}>
      <button
        type="button"
        data-testid="process-switcher-trigger"
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={busy}
        onClick={() => setOpen(o => !o)}
        className="flex min-w-0 items-center gap-1.5 rounded px-1 py-0.5 -ml-1 hover:bg-gray-100 disabled:opacity-60 dark:hover:bg-gray-800"
      >
        <span
          className="truncate text-[15px] font-semibold text-gray-900 dark:text-gray-100"
          data-testid="process-identity"
        >
          {title}
        </span>
        {current?.run && (
          <span className="flex-none text-[12px] text-gray-500 dark:text-gray-400">
            {current.run}
          </span>
        )}
        {current?.completed && (
          <span className="flex-none rounded bg-emerald-50 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-400">
            Complete
          </span>
        )}
        <ChevronDown
          className={clsx('h-3.5 w-3.5 flex-none text-gray-400 transition-transform', open && 'rotate-180')}
          aria-hidden="true"
        />
      </button>

      {open && (
        <div
          ref={panel}
          role="menu"
          data-testid="process-switcher-panel"
          style={{ maxHeight: place.maxH }}
          className={clsx(
            'absolute top-full z-50 mt-1 w-[320px] max-w-[calc(100vw-32px)] overflow-y-auto overscroll-contain',
            'rounded-lg border border-gray-200 bg-white py-1 shadow-lg',
            'dark:border-gray-700 dark:bg-gray-900',
            place.right ? 'right-0' : 'left-0',
          )}
        >
          {/* The open run, stated. Not a choice to re-make. */}
          {current && (
            <div className="flex items-baseline gap-2 border-b border-gray-100 px-3 pb-2 pt-2 dark:border-gray-800">
              <Check className="h-3.5 w-3.5 flex-none translate-y-0.5 text-emerald-600" aria-hidden="true" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[12px] font-medium text-gray-900 dark:text-gray-100">
                  {current.run || current.name}
                </span>
                <span className="block text-[10px] text-gray-400">Open now</span>
              </span>
            </div>
          )}

          {/* Only when the open run is finished AND a live one exists. */}
          {returnTo && (
            <button
              type="button"
              role="menuitem"
              data-testid="process-switcher-return"
              onClick={() => choose(returnTo.workflowId)}
              className="flex w-full items-center gap-2 border-b border-gray-100 px-3 py-2 text-left hover:bg-gray-50 dark:border-gray-800 dark:hover:bg-gray-800"
            >
              <CornerUpLeft className="h-3.5 w-3.5 flex-none text-primary-600" aria-hidden="true" />
              <span className="min-w-0 flex-1 truncate text-[12px] font-medium text-primary-600">
                Back to the current cycle
              </span>
              <span className="flex-none text-[10px] text-gray-400">{returnTo.run}</span>
            </button>
          )}

          {active.length > 0 && (
            <>
              <span className={EYEBROW}>Also running on this asset</span>
              {active.map(e => <Row key={e.workflowId} entry={e} onSelect={choose} showName />)}
            </>
          )}

          {previousCycles.length > 0 && (
            <>
              <span className={EYEBROW}>Previous cycles of {current?.name ?? 'this process'}</span>
              {previousCycles.map(e => (
                <Row key={e.workflowId} entry={e} onSelect={choose} muted />
              ))}
            </>
          )}

          {otherCompleted.length > 0 && (
            <>
              <span className={EYEBROW}>Finished</span>
              {otherCompleted.map(e => (
                <Row key={e.workflowId} entry={e} onSelect={choose} muted showName />
              ))}
            </>
          )}

          {joinable.length > 0 && onJoin && (
            <>
              <span className={EYEBROW}>Add a process</span>
              {joinable.slice(0, 8).map(j => (
                <button
                  key={j.id}
                  type="button"
                  role="menuitem"
                  data-testid={`process-switcher-add-${j.id}`}
                  onClick={() => { setOpen(false); onJoin(j.id) }}
                  className="flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-gray-50 dark:hover:bg-gray-800"
                >
                  <Plus className="h-3.5 w-3.5 flex-none text-gray-400" aria-hidden="true" />
                  <span className="min-w-0 flex-1 truncate text-[12px] text-gray-700 dark:text-gray-200">
                    {j.name}
                  </span>
                </button>
              ))}
            </>
          )}

          {upcoming.length > 0 && (
            <>
              <span className={EYEBROW}>Scheduled</span>
              {upcoming.slice(0, 4).map(u => (
                <div
                  key={`${u.workflowId}-${u.branchName}`}
                  data-testid={`process-switcher-upcoming-${u.workflowId}`}
                  className="flex items-baseline gap-2 px-3 py-1.5"
                >
                  <span className="min-w-0 flex-1 truncate text-[12px] text-gray-500 dark:text-gray-400">
                    {u.branchName}
                  </span>
                  <span className="flex-none text-[10px] text-gray-400">
                    {shortDate(u.estimatedStartDate.toISOString())}
                  </span>
                </div>
              ))}
            </>
          )}

          {!hasAnything && upcoming.length === 0 && (
            <p className="px-3 py-2 text-[11px] text-gray-400">
              No other process is available on this asset.
            </p>
          )}

          {/*
            Documents and activity belong to the process, so they live with
            it rather than in a separate unlabelled "⋯" two controls away.
          */}
          {(onOpenDocuments || onOpenActivity || onOpenReport) && (
            <div className="mt-1 border-t border-gray-100 pt-1 dark:border-gray-800">
              {onOpenReport && (
                <button
                  type="button"
                  role="menuitem"
                  data-testid="process-switcher-report"
                  onClick={() => { setOpen(false); onOpenReport() }}
                  className={clsx(
                    'flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12px] hover:bg-gray-50 dark:hover:bg-gray-800',
                    reportActive ? 'font-medium text-primary-600' : 'text-gray-700 dark:text-gray-200',
                  )}
                >
                  <ClipboardList className="h-3.5 w-3.5 flex-none text-gray-400" aria-hidden="true" />
                  Process report
                </button>
              )}
              {onOpenActivity && (
                <button
                  type="button"
                  role="menuitem"
                  data-testid="process-switcher-activity"
                  onClick={() => { setOpen(false); onOpenActivity() }}
                  className={clsx(
                    'flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12px] hover:bg-gray-50 dark:hover:bg-gray-800',
                    activityActive ? 'font-medium text-primary-600' : 'text-gray-700 dark:text-gray-200',
                  )}
                >
                  <History className="h-3.5 w-3.5 flex-none text-gray-400" aria-hidden="true" />
                  Previous runs and activity
                </button>
              )}
              {onOpenDocuments && (
                <button
                  type="button"
                  role="menuitem"
                  data-testid="process-switcher-documents"
                  onClick={() => { setOpen(false); onOpenDocuments() }}
                  className={clsx(
                    'flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12px] hover:bg-gray-50 dark:hover:bg-gray-800',
                    documentsActive ? 'font-medium text-primary-600' : 'text-gray-700 dark:text-gray-200',
                  )}
                >
                  <FileText className="h-3.5 w-3.5 flex-none text-gray-400" aria-hidden="true" />
                  Documents
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
