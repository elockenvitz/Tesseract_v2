import { ArrowRight, Check, ChevronRight, Sparkles } from 'lucide-react'
import { clsx } from 'clsx'

/**
 * The shared shell for the four per-surface pilot Get Started banners.
 *
 * ── What this is, and what it is not ─────────────────────────────────────
 *
 * Not a new onboarding system. The four banners — Idea Pipeline, Trade Lab,
 * Trade Book, Outcomes — already existed, already owned their own steps,
 * completion events and dismissal, and all four still do. What they did not
 * share was a shape: four copies of the same markup that had drifted into four
 * densities, and on a phone all four were unusable in the same way.
 *
 * So this owns layout and nothing else. Every caller passes its own steps and
 * its own actions, and none of its semantics move.
 *
 * ── The phone treatment ──────────────────────────────────────────────────
 *
 * Each copy set `whitespace-nowrap` on both the title AND the hint, inside a
 * row of three steps with `px-6` padding. On a 390px screen that is three
 * unbreakable columns in a container that cannot hold one, so the banner
 * either overflowed or ate a third of the viewport.
 *
 * A phone shows the step the reader is ON, with a count for the rest. Wrapping
 * is allowed. A reader with one next move does not need the other two spelled
 * out, and the count keeps the journey legible.
 *
 * Desktop is deliberately unchanged: the same three-across row, the same
 * type sizes, the same arrows.
 */

export interface PilotStep {
  n: number
  title: string
  hint: string
  done?: boolean
  /** Steps that are also the way to perform them. Optional by design. */
  onClick?: () => void
}

/**
 * The step to lead with on a narrow screen: the first unfinished one, or the
 * last if everything is done and the caller has not retired the banner yet.
 */
export function currentStep(steps: PilotStep[]): PilotStep | null {
  if (steps.length === 0) return null
  return steps.find(s => !s.done) ?? steps[steps.length - 1]
}

export type PilotBannerTone = 'amber' | 'emerald'

const TONE = {
  amber: {
    shell: 'border-amber-200 bg-gradient-to-r from-amber-50 via-amber-50/90 to-amber-100/30 dark:border-amber-800/60 dark:from-amber-900/25 dark:via-amber-900/15 dark:to-gray-900/40',
    label: 'text-amber-700 dark:text-amber-300',
    pip: 'bg-amber-500',
    chevron: 'text-amber-400 dark:text-amber-500',
    action: 'bg-amber-500 active:bg-amber-600',
  },
  emerald: {
    shell: 'border-emerald-200 bg-gradient-to-r from-emerald-50 via-teal-50 to-primary-50 dark:border-emerald-800/60 dark:from-emerald-950/40 dark:via-teal-950/20 dark:to-primary-950/30',
    label: 'text-emerald-700 dark:text-emerald-300',
    pip: 'bg-emerald-500',
    chevron: 'text-emerald-400 dark:text-emerald-500',
    action: 'bg-emerald-500 active:bg-emerald-600',
  },
} as const

export function PilotStepsBanner({
  steps,
  label = 'Get started',
  tone = 'amber',
  icon: Icon = Sparkles,
  variant = 'bar',
}: {
  steps: PilotStep[]
  /** Each banner keeps its own words. Outcomes is not "get started". */
  label?: string
  tone?: PilotBannerTone
  icon?: typeof Sparkles
  /**
   * `bar` spans its container and rules off beneath it, which is right where
   * the banner is the first thing under the app bar.
   *
   * `inset` is a card with a margin, for a surface whose own controls come
   * first. On the phone's Pipeline the banner sat between the view tabs and
   * the stage pager as a third full-bleed strip, so guidance about the board
   * read as another piece of the board's chrome. Same content, same steps,
   * one rung quieter.
   */
  variant?: 'bar' | 'inset'
}) {
  const t = TONE[tone]
  const current = currentStep(steps)
  /*
   * Where the reader is, not how much they have banked.
   *
   * The phone line read "Get started \u00b7 0 of 3" beside step one's title
   * and instruction, which says the opposite of what the rest of the row is
   * doing: it counts a step as nothing until it is finished, so the reader is
   * told zero while being shown one. A position reads as progress on a first
   * screen; a completed-count reads as a failure on it.
   *
   * Completion is untouched — `currentStep` still finds the first unfinished
   * step, the pip still shows a tick when everything is done, and the desktop
   * half still draws every step's own state.
   */
  if (!current) return null

  return (
    <div
      data-slot="pilot-steps-banner"
      data-variant={variant}
      className={clsx(
        'flex-shrink-0 border',
        variant === 'inset'
          ? 'mx-3 mb-2 rounded-xl'
          : 'border-x-0 border-t-0',
        t.shell,
      )}
    >
      {/* ── Phone ──────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-2.5 px-3 py-2 sm:hidden">
        <span
          className={clsx(
            'flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold tabular-nums text-white shadow-sm',
            current.done ? 'bg-emerald-500' : t.pip,
          )}
        >
          {current.done ? <Check className="h-3 w-3" /> : current.n}
        </span>
        <div className="min-w-0 flex-1">
          <p className={clsx('text-[10px] font-semibold uppercase tracking-wider', t.label)}>
            {label} · {current.done ? 'done' : `step ${current.n} of ${steps.length}`}
          </p>
          {/* Wrapping, not clipping. The hint is the instruction — truncating
              it leaves a step nobody can follow. */}
          <p className="text-[12px] font-semibold leading-tight text-gray-900 dark:text-white">
            {current.title}
          </p>
          {/*
            Only until the reader has done one.
            Once a step is behind them they have seen the pattern, and a
            module that keeps spending a line on instructions is a module
            that keeps costing the surface it is teaching.
          */}
          {!steps.some(s => s.done) && (
            <p className="mt-0.5 text-[11px] leading-snug text-gray-600 dark:text-gray-400">
              {current.hint}
            </p>
          )}
        </div>
        {current.onClick && (
          <button
            type="button"
            data-slot="pilot-steps-cta"
            onClick={current.onClick}
            /* A real touch target rather than a 24px glyph, and nothing
               more: a step that needs a named button is a step whose surface
               should be offering one. */
            className={clsx(
              'shrink-0 h-9 w-9 inline-flex items-center justify-center rounded-lg text-white no-touch-target',
              t.action,
            )}
            aria-label={current.title}
          >
            <ArrowRight className="h-4 w-4 shrink-0" />
          </button>
        )}
      </div>

      {/* ── Desktop, unchanged ─────────────────────────────────────────── */}
      <div className="hidden px-6 py-3 sm:flex sm:items-start sm:gap-4">
        <div className={clsx('mt-0.5 flex shrink-0 items-center gap-1.5 font-semibold', t.label)}>
          <Icon className="h-4 w-4" />
          <span className="whitespace-nowrap text-[12px] uppercase tracking-wider">{label}</span>
        </div>
        <div className="flex min-w-0 items-start gap-x-4 text-gray-700 dark:text-gray-300">
          {steps.map((step, i) => (
            <div key={step.n} className="flex min-w-0 items-start gap-x-4">
              {i > 0 && (
                <ChevronRight className={clsx('mt-[3px] h-3.5 w-3.5 shrink-0', t.chevron)} />
              )}
              {step.onClick ? (
                <button
                  type="button"
                  onClick={step.onClick}
                  className="flex min-w-0 cursor-pointer items-start gap-2 transition-opacity hover:opacity-90"
                >
                  <WideStep step={step} pip={t.pip} />
                </button>
              ) : (
                <div className="flex min-w-0 items-start gap-2">
                  <WideStep step={step} pip={t.pip} />
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

function WideStep({ step, pip }: { step: PilotStep; pip: string }) {
  return (
    <>
      <span
        className={clsx(
          'flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold tabular-nums text-white shadow-sm',
          step.done ? 'bg-emerald-500' : pip,
        )}
      >
        {step.done ? <Check className="h-3 w-3" /> : step.n}
      </span>
      <div className="min-w-0 text-left">
        <div className={clsx(
          'whitespace-nowrap text-[12px] font-semibold leading-tight',
          step.done
            ? 'text-emerald-700 line-through opacity-70 dark:text-emerald-300'
            : 'text-gray-900 dark:text-white',
        )}>
          {step.title}
        </div>
        <div className={clsx(
          'whitespace-nowrap text-[11px] leading-snug',
          step.done
            ? 'text-emerald-600/60 dark:text-emerald-400/60'
            : 'text-gray-600 dark:text-gray-400',
        )}>
          {step.hint}
        </div>
      </div>
    </>
  )
}
