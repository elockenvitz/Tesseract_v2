import { ArrowLeft, ExternalLink } from 'lucide-react'
import { clsx } from 'clsx'

/**
 * The shell every contextual Work surface shares.
 *
 * A process, an idea, a list and a portfolio have different information
 * needs and should not be forced into one card layout — but they must agree
 * on four things, because those four are what a reader uses to stay
 * oriented: what this is, what kind of thing it is, how to get back, and
 * where the full application lives.
 *
 * The "open the full …" control is deliberately part of this header rather
 * than something a surface improvises. Leaving the asset workspace is the
 * one navigation in Work that cannot be undone with Back, so it is always
 * named, always in the same place, and never the side effect of selecting
 * something in a sidebar.
 */

interface Props {
  /** The destination's own name. */
  title: string
  /** "List · Collaborative", "Portfolio". Short, and never the title again. */
  kindLabel: string
  /** One line of context: membership, snapshot date, status. */
  detail?: string | null
  /** Labelled, never a bare arrow. */
  back: { label: string; onBack: () => void }
  /** The deliberate departure from the asset workspace. */
  openFull?: { label: string; onOpen: () => void }
  /** Surface-specific controls, kept to the right of the identity. */
  actions?: React.ReactNode
  className?: string
}

export function ContextualWorkHeader({
  title, kindLabel, detail, back, openFull, actions, className,
}: Props) {
  return (
    <header
      className={clsx('border-b border-gray-200 pb-3 dark:border-gray-700', className)}
      data-testid="contextual-work-header"
    >
      <button
        type="button"
        onClick={back.onBack}
        data-testid="contextual-back"
        className="inline-flex items-center gap-1.5 text-[11px] font-medium text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-100"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        {back.label}
      </button>

      <div className="mt-1.5 flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="min-w-0">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500">
            {kindLabel}
          </span>
          <h3 className="truncate text-[17px] font-semibold leading-snug text-gray-900 dark:text-gray-100">
            {title}
          </h3>
          {detail && (
            <p className="mt-0.5 text-[12px] text-gray-500 dark:text-gray-400">{detail}</p>
          )}
        </div>

        <div className="flex flex-none items-center gap-2">
          {actions}
          {openFull && (
            <button
              type="button"
              onClick={openFull.onOpen}
              data-testid="contextual-open-full"
              className="inline-flex items-center gap-1.5 rounded border border-gray-300 px-2.5 py-1 text-[12px] font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-200 dark:hover:bg-gray-700"
            >
              {openFull.label}
              <ExternalLink className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>
    </header>
  )
}
