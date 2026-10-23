/**
 * One Process cycle, read end to end.
 *
 * ── What it is, and what it is not ──────────────────────────────────────
 *
 * It is a rendering of `buildProcessReport`, which is a rendering of the
 * requirement rows. It holds no state and stores nothing, so it cannot
 * disagree with the workspace: saving an assessment and reopening the
 * report shows the new text because they are the same row.
 *
 * It is NOT a summary. There is no stage conclusion and no overall
 * verdict, because composing one would put words in the organization's
 * mouth. Every line of prose on this surface was typed by a named person,
 * or is a count.
 *
 * Each requirement links back to itself in the workspace, so the report is
 * a way into the work rather than a dead end.
 */
import { clsx } from 'clsx'
import { ArrowLeft, FileText, Paperclip } from 'lucide-react'
import {
  reportHeadline,
  type ProcessReport as Report,
  type ReportEntry,
  type ReportRequirement,
} from '../../../lib/asset-work/process-report'

const EYEBROW = 'text-[10px] font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500'

const stamp = (iso: string | null): string | null => {
  if (!iso) return null
  const d = new Date(iso)
  return Number.isNaN(d.getTime())
    ? null
    : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

const OUTCOME: Record<ReportRequirement['outcome'], { label: string; cls: string }> = {
  documented: { label: 'documented', cls: 'text-emerald-700 dark:text-emerald-400' },
  /* Named for what it is. This is the distinction the report protects. */
  'done-undocumented': { label: 'done · nothing written', cls: 'text-amber-700 dark:text-amber-400' },
  'not-applicable': { label: 'not applicable', cls: 'text-gray-400' },
  outstanding: { label: 'open', cls: 'text-gray-400' },
}

export interface ProcessReportProps {
  symbol: string | null
  processName: string
  cycle: string | null
  /** "Complete", "In progress" — from the run row, never inferred. */
  status: string | null
  report: Report
  loading?: boolean
  error?: boolean
  /** Opens that requirement in the workspace this report belongs to. */
  onOpenRequirement: (requirementId: string) => void
  onBack: () => void
  backLabel?: string
  className?: string
}

function Entry({ entry }: { entry: ReportEntry }) {
  const at = stamp(entry.at)
  const who = entry.authorName

  if (entry.kind === 'attachment') {
    return (
      <li className="flex items-baseline gap-1.5 text-[12px] text-gray-700 dark:text-gray-200">
        <Paperclip className="h-3 w-3 flex-none translate-y-0.5 text-gray-400" aria-hidden="true" />
        <span className="min-w-0 truncate">{entry.text}</span>
        {(who || at) && (
          <span className="flex-none text-[10px] text-gray-400">
            {[who, at].filter(Boolean).join(' · ')}
          </span>
        )}
      </li>
    )
  }

  return (
    <li>
      {/* Quoted whole. Truncating an analyst's finding in the record of
          what they established would change what it says. */}
      <blockquote className="border-l-2 border-gray-200 pl-2.5 text-[13px] leading-relaxed text-gray-800 dark:border-gray-700 dark:text-gray-100">
        <span className="whitespace-pre-wrap">{entry.text}</span>
      </blockquote>
      <p className="mt-0.5 pl-2.5 text-[10px] text-gray-400">
        {entry.kind === 'note' && <span>working note</span>}
        {entry.kind === 'note' && (who || at) && <span> · </span>}
        {[who, at].filter(Boolean).join(' · ')}
        {entry.kind === 'note' && !who && !at && (
          /* Notes have no author or timestamp column; saying so beats an
             empty byline that reads as anonymous-on-purpose. */
          <span> · no author recorded</span>
        )}
      </p>
    </li>
  )
}

export function ProcessReport({
  symbol, processName, cycle, status, report, loading, error,
  onOpenRequirement, onBack, backLabel = 'Back to the process', className,
}: ProcessReportProps) {
  if (loading) {
    return (
      <div className={clsx('space-y-3', className)} data-testid="process-report-loading">
        <div className="h-10 animate-pulse rounded bg-gray-100 dark:bg-gray-800" />
        <div className="h-40 animate-pulse rounded bg-gray-100 dark:bg-gray-800" />
      </div>
    )
  }

  if (error) {
    return (
      <div className={clsx('min-w-0', className)} data-testid="process-report-error">
        <button type="button" onClick={onBack} className="mb-2 inline-flex items-center gap-1 text-[11px] font-medium text-gray-500 hover:text-gray-700">
          <ArrowLeft className="h-3 w-3" aria-hidden="true" /> {backLabel}
        </button>
        <p className="text-[12px] text-amber-700 dark:text-amber-500">
          This cycle's record could not be read, so none of it is shown rather than part of it.
        </p>
      </div>
    )
  }

  return (
    <div className={clsx('min-w-0', className)} data-testid="process-report">
      <button
        type="button"
        data-testid="process-report-back"
        onClick={onBack}
        className="mb-2 inline-flex items-center gap-1 text-[11px] font-medium text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
      >
        <ArrowLeft className="h-3 w-3" aria-hidden="true" /> {backLabel}
      </button>

      {/* ── Identity ─────────────────────────────────────────────────── */}
      <header className="border-b border-gray-200 pb-3 dark:border-gray-700">
        <div className="flex flex-wrap items-baseline gap-x-2">
          <FileText className="h-4 w-4 flex-none translate-y-0.5 text-gray-400" aria-hidden="true" />
          <h3 className="text-[16px] font-semibold text-gray-900 dark:text-gray-100">
            {processName}
          </h3>
          {cycle && <span className="text-[12px] text-gray-500">{cycle}</span>}
          {symbol && <span className="text-[12px] text-gray-400">· {symbol}</span>}
          {status && (
            <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-gray-600 dark:bg-gray-800 dark:text-gray-300">
              {status}
            </span>
          )}
        </div>

        <p className="mt-1 text-[12px] text-gray-600 dark:text-gray-300" data-testid="process-report-headline">
          {reportHeadline(report)}
        </p>

        <div className="mt-1 flex flex-wrap gap-x-4 text-[11px] text-gray-400">
          {report.contributors.length > 0 && (
            <span data-testid="process-report-contributors">
              {report.contributors.map(c => c.name).join(', ')}
            </span>
          )}
          {(report.firstAt || report.lastAt) && (
            <span>
              {[stamp(report.firstAt), stamp(report.lastAt)]
                .filter(Boolean)
                .filter((v, i, a) => a.indexOf(v) === i)
                .join(' – ')}
            </span>
          )}
        </div>
      </header>

      {/* ── Stage by stage ───────────────────────────────────────────── */}
      <div className="divide-y divide-gray-100 dark:divide-gray-800">
        {report.stages.map(stage => (
          <section key={stage.stageId} className="py-3" data-testid={`process-report-stage-${stage.stageId}`}>
            <div className="flex flex-wrap items-baseline gap-x-2">
              <span className={EYEBROW}>{stage.label}</span>
              <span className="text-[10px] text-gray-400">
                {stage.documented} documented
                {stage.outstanding > 0 && ` · ${stage.outstanding} open`}
              </span>
            </div>
            {stage.objective && (
              /* The DEFINITION's own words, attributed as such. */
              <p className="mt-0.5 text-[11px] italic text-gray-500 dark:text-gray-400">
                {stage.objective}
              </p>
            )}

            {stage.requirements.length === 0 ? (
              <p className="mt-1.5 text-[11px] text-gray-400">No requirements in this stage.</p>
            ) : (
              <ul className="mt-2 space-y-3">
                {stage.requirements.map(r => (
                  <li key={r.requirementId} data-testid={`process-report-requirement-${r.requirementId}`}>
                    <div className="flex flex-wrap items-baseline gap-x-2">
                      <button
                        type="button"
                        data-testid={`process-report-open-${r.requirementId}`}
                        onClick={() => onOpenRequirement(r.requirementId)}
                        className="text-left text-[12px] font-medium text-gray-900 hover:text-primary-600 hover:underline dark:text-gray-100"
                      >
                        {r.text}
                      </button>
                      <span className={clsx('text-[10px] font-medium', OUTCOME[r.outcome].cls)}>
                        {OUTCOME[r.outcome].label}
                      </span>
                      {r.completedAt && (
                        <span className="text-[10px] text-gray-400">
                          {[r.completedByName, stamp(r.completedAt)].filter(Boolean).join(' · ')}
                        </span>
                      )}
                    </div>

                    {r.entries.length > 0 ? (
                      <ul className="mt-1 space-y-2">
                        {r.entries.map((e, i) => <Entry key={`${r.requirementId}-${i}`} entry={e} />)}
                      </ul>
                    ) : (
                      <p className="mt-0.5 text-[11px] text-gray-400">
                        {r.outcome === 'done-undocumented'
                          ? 'Marked done, with no written finding.'
                          : r.outcome === 'not-applicable'
                            ? 'Marked not applicable.'
                            : 'Not started.'}
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>
        ))}
      </div>

      {/* ── What is still open ───────────────────────────────────────── */}
      {report.outstanding > 0 && (
        <section className="border-t border-gray-200 pt-3 dark:border-gray-700" data-testid="process-report-open">
          <span className={clsx(EYEBROW, 'mb-1.5 block')}>Still open</span>
          <ul className="space-y-1">
            {report.stages.flatMap(s =>
              s.requirements
                .filter(r => r.outcome === 'outstanding')
                .map(r => (
                  <li key={r.requirementId}>
                    <button
                      type="button"
                      onClick={() => onOpenRequirement(r.requirementId)}
                      className="text-left text-[12px] text-gray-700 hover:text-primary-600 hover:underline dark:text-gray-200"
                    >
                      {r.text}
                      <span className="ml-1.5 text-[10px] text-gray-400">{s.label}</span>
                    </button>
                  </li>
                )),
            )}
          </ul>
        </section>
      )}
    </div>
  )
}
