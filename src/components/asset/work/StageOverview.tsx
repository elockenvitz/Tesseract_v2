import { clsx } from 'clsx'
import { ArrowRight } from 'lucide-react'
import {
  presentRequirement,
  chooseResume,
  stageObjective,
  tallyStage,
  synthesisNote,
  type RequirementFacts,
  type WorkState,
} from '../../../lib/asset-work/stage-overview'

/**
 * The stage before a requirement is open.
 *
 * ── What it replaces ────────────────────────────────────────────────────
 *
 * A dashed box reading "Pick a requirement to record what you found",
 * filling two thirds of the working surface beside a column of titles. It
 * asked the analyst to choose before telling them anything they could
 * choose on.
 *
 * This answers, in order: what is this stage asking, where should I pick
 * up and why, what state is each requirement in, what has anyone actually
 * found, and what would finishing look like.
 *
 * ── What it is not ──────────────────────────────────────────────────────
 *
 * Not a second requirement list. The rail to its left is still the
 * navigation surface; this is the same five rows read as WORK STATE, which
 * the rail does not carry. Not a summary either: the findings shown are
 * quoted from `checklist_item_comments` with their author and date, never
 * condensed, and a stage with nothing recorded says so.
 *
 * Every row and every label is derived in `lib/asset-work/stage-overview`,
 * which has no knowledge of any particular Process. There are no
 * per-Process branches here.
 */

const EYEBROW = 'text-[10px] font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500'

/** One dot per state. Colour carries the state; the word carries the detail. */
const STATE_DOT: Record<WorkState, string> = {
  complete: 'bg-emerald-500',
  'not-applicable': 'bg-gray-300 dark:bg-gray-600',
  documented: 'bg-amber-500',
  assigned: 'bg-blue-400',
  'not-started': 'bg-gray-200 dark:bg-gray-700',
}

const STATE_TEXT: Record<WorkState, string> = {
  complete: 'text-emerald-700 dark:text-emerald-400',
  'not-applicable': 'text-gray-400',
  documented: 'text-amber-700 dark:text-amber-500',
  assigned: 'text-blue-700 dark:text-blue-400',
  'not-started': 'text-gray-400',
}

export interface StageFinding {
  requirementId: string
  requirementText: string
  text: string
  authorName: string | null
  when: string | null
}

interface Props {
  stage: { label?: string | null; description?: string | null }
  assetSymbol?: string | null
  facts: readonly RequirementFacts[]
  /** Quoted from `checklist_item_comments`, newest first. Never summarised. */
  findings: readonly StageFinding[]
  viewerId?: string | null
  /** The existing selection handler — the same one the rail calls. */
  onOpenRequirement: (id: string) => void
  className?: string
}

export function StageOverview({
  stage, assetSymbol, facts, findings, viewerId, onOpenRequirement, className,
}: Props) {
  const objective = stageObjective(stage)
  const tally = tallyStage(facts)
  const resume = chooseResume(facts, viewerId)
  const rows = facts.map(f => ({ facts: f, view: presentRequirement(f) }))

  return (
    <section className={clsx('min-w-0', className)} data-testid="stage-overview">
      {/* ── What this stage is asking ──────────────────────────────── */}
      <header className="border-b border-gray-200 pb-3 dark:border-gray-700">
        <div className="flex flex-wrap items-center gap-x-2">
          <span className={EYEBROW}>{stage.label ?? 'Stage'}</span>
          {assetSymbol && (
            <>
              <span className="text-[10px] text-gray-300 dark:text-gray-600">·</span>
              <span className={EYEBROW}>{assetSymbol}</span>
            </>
          )}
          {/* The count is NOT repeated here. The action bar directly above
              states "n of m done · k open", and the stage chip above that
              carries n/m. Three copies of one number was the pattern this
              surface kept recreating. */}
        </div>
        {objective.source === 'definition' ? (
          <h3 className="mt-1 text-[17px] font-semibold leading-snug text-gray-900 dark:text-gray-100">
            {objective.text}
          </h3>
        ) : (
          <>
            <h3 className="mt-1 text-[17px] font-semibold leading-snug text-gray-900 dark:text-gray-100">
              {objective.text}
            </h3>
            {/* Stated absence, not a composed objective. */}
            <p className="mt-1 text-[11px] text-gray-400 dark:text-gray-500">
              This Process records no objective for the stage.
            </p>
          </>
        )}

        {/* ── Where to pick up, and why ───────────────────────────── */}
        {resume ? (
          <div className="mt-2.5 flex flex-wrap items-center gap-x-2 gap-y-1">
            <button
              type="button"
              data-testid="stage-resume"
              onClick={() => onOpenRequirement(resume.id)}
              className="inline-flex min-w-0 items-center gap-1.5 rounded bg-gray-900 px-2.5 py-1 text-[12px] font-medium text-white hover:bg-gray-700 dark:bg-gray-100 dark:text-gray-900 dark:hover:bg-gray-300"
            >
              <span className="truncate">{resume.verb} “{resume.text}”</span>
              <ArrowRight className="h-3.5 w-3.5 flex-none" />
            </button>
            {/* The recommendation is checkable, so it states its reason. */}
            <span className="text-[11px] text-gray-500 dark:text-gray-400" data-testid="stage-resume-reason">
              because {resume.reason}
            </span>
          </div>
        ) : (
          <p className="mt-2.5 text-[12px] text-gray-500 dark:text-gray-400" data-testid="stage-resume-none">
            Nothing is open in this stage.
          </p>
        )}
      </header>

      {/* ── The investigation, as work state ────────────────────────── */}
      <div className="border-b border-gray-200 py-3 dark:border-gray-700">
        <span className={clsx(EYEBROW, 'mb-2 block')}>The investigation</span>
        {rows.length === 0 ? (
          <p className="text-[12px] text-gray-400">This stage has no requirements yet.</p>
        ) : (
          <ul className="space-y-0.5" data-testid="stage-breakdown">
            {rows.map(({ facts: f, view }, i) => (
              <li key={f.id}>
                <button
                  type="button"
                  onClick={() => onOpenRequirement(f.id)}
                  data-testid={`stage-breakdown-${f.id}`}
                  className="flex w-full items-baseline gap-2 rounded px-1 py-1 text-left hover:bg-gray-50 dark:hover:bg-gray-800"
                >
                  <span className="w-4 flex-none text-[11px] tabular-nums text-gray-300 dark:text-gray-600">
                    {i + 1}
                  </span>
                  <span className={clsx(
                    'min-w-0 flex-1 truncate text-[13px]',
                    view.state === 'complete' || view.state === 'not-applicable'
                      ? 'text-gray-400'
                      : 'text-gray-900 dark:text-gray-100',
                  )}>
                    {f.text}
                  </span>
                  <span className="flex flex-none items-center gap-1.5">
                    <span className={clsx('h-1.5 w-1.5 rounded-full', STATE_DOT[view.state])} aria-hidden />
                    <span className={clsx('text-[11px]', STATE_TEXT[view.state])}>{view.label}</span>
                    {view.detail && (
                      <span className="text-[11px] text-gray-400 dark:text-gray-500">{view.detail}</span>
                    )}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* ── What anyone has actually found ──────────────────────────── */}
      <div className="border-b border-gray-200 py-3 dark:border-gray-700">
        <span className={clsx(EYEBROW, 'mb-2 block')}>Findings so far</span>
        {findings.length === 0 ? (
          <p className="text-[12px] text-gray-500 dark:text-gray-400" data-testid="stage-findings-empty">
            Nothing has been written against this stage's requirements yet.
          </p>
        ) : (
          <ul className="space-y-2.5" data-testid="stage-findings">
            {findings.map(f => (
              <li key={`${f.requirementId}-${f.authorName ?? ''}-${f.when ?? ''}`}>
                <button
                  type="button"
                  onClick={() => onOpenRequirement(f.requirementId)}
                  className="block w-full text-left"
                >
                  <span className="block text-[11px] font-medium text-gray-500 dark:text-gray-400">
                    {f.requirementText}
                  </span>
                  {/* Quoted, never condensed — two lines, then the rest is
                      on the requirement where it was written. */}
                  <span className="mt-0.5 line-clamp-2 block text-[13px] leading-relaxed text-gray-800 dark:text-gray-100">
                    {f.text}
                  </span>
                  <span className="mt-0.5 block text-[10px] text-gray-400">
                    {[f.authorName, f.when].filter(Boolean).join(' · ')}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/*
        ── What finishing looks like ─────────────────────────────────
        Shown only when it says something the list above does not.

        On an untouched stage both blocks reduced to the same sentence —
        "Nothing has been written against this stage's requirements yet"
        followed by "None of the 5 open requirements has an assessment
        written yet" — which read as two findings rather than one fact
        stated twice. The note earns its place when there ARE findings
        (it quantifies how far they go) or when the stage is finished
        (it separates ticked from argued, which the list cannot).
      */}
      {(findings.length > 0 || tally.finished) && (
        <div className="py-3">
          <span className={clsx(EYEBROW, 'mb-1.5 block')}>What this stage establishes</span>
          <p className="max-w-[78ch] text-[12px] leading-relaxed text-gray-500 dark:text-gray-400" data-testid="stage-synthesis">
            {synthesisNote(tally)}
          </p>
        </div>
      )}
    </section>
  )
}
