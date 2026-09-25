import type { ReactNode } from 'react'
import { clsx } from 'clsx'
import { ChevronLeft, MoreHorizontal } from 'lucide-react'

/**
 * One editor chrome for every template type on a phone.
 *
 * ── Why a shell rather than four headers ───────────────────────────────────
 *
 * The four Templates sections have almost nothing in common as editors — a
 * rich-text box, an ordered block list, a five-step configuration form and a
 * cell mapper. What they DO have in common is everything around the editor:
 * how you get back, where the name sits, and where Save/Preview/Use are. Four
 * separate answers to that is how a product stops feeling like one product,
 * and it is four places to get the keyboard and the safe-area wrong instead
 * of one.
 *
 * So the shell owns the chrome and nothing else. It holds no template state,
 * performs no mutation, and knows nothing about any specific type — each
 * editor passes its own content and its own handlers. That is deliberate:
 * a shell that understood templates would become a fifth place where the
 * canonical model is interpreted.
 *
 * ── Keyboard ───────────────────────────────────────────────────────────────
 *
 * The action bar is pinned to the bottom and the content scrolls above it.
 * When a soft keyboard opens it covers the bottom of the layout viewport, so
 * the bar sits inside a container sized from `100%` of the flex parent rather
 * than `100vh` — the shell never reads vh, which is what pushes a pinned bar
 * under the keyboard. `pb-safe` keeps it off the home indicator.
 *
 * Desktop never renders this. Every Templates editor keeps its own desktop
 * chrome untouched.
 */

export interface MobileTemplateShellProps {
  /** e.g. "Quick Text" — what the tab strip calls this section. */
  typeLabel: string
  /** The template's own name, or a placeholder while creating. */
  name: string
  /**
   * Makes the name editable in place.
   *
   * Given rather than rendering a separate name field in the editor body:
   * two inputs for one value is two things to keep in sync and two labels a
   * screen reader has to disambiguate. When absent the name is a heading.
   */
  onNameChange?: (name: string) => void
  namePlaceholder?: string
  /** Optional second line: counts, shared state, last used. */
  meta?: ReactNode
  /** Back to the Templates landing. */
  onBack: () => void

  onSave?: () => void
  saveLabel?: string
  /** Disabled when nothing has changed, or while a save is in flight. */
  saveDisabled?: boolean
  saving?: boolean

  onPreview?: () => void
  onUse?: () => void
  /** Opens the type's own overflow sheet — share, duplicate, delete. */
  onMore?: () => void

  /** True when there are unsaved edits, shown next to the name. */
  dirty?: boolean

  children: ReactNode
}

export function MobileTemplateShell({
  typeLabel,
  name,
  onNameChange,
  namePlaceholder,
  meta,
  onBack,
  onSave,
  saveLabel = 'Save',
  saveDisabled = false,
  saving = false,
  onPreview,
  onUse,
  onMore,
  dirty = false,
  children,
}: MobileTemplateShellProps) {
  const hasActions = !!(onSave || onPreview || onUse || onMore)

  return (
    <div data-slot="mobile-template-shell" className="flex h-full min-h-0 flex-col bg-white dark:bg-gray-900">
      {/* Identity. Two rows at most: a back link, then the name with its
          type. The name truncates rather than wrapping — a template name can
          be a sentence, and a two-line name here costs the editor its
          height on every open. */}
      <div className="flex-shrink-0 border-b border-gray-200 px-3 pb-2 pt-1.5 dark:border-gray-700">
        <button
          type="button"
          onClick={onBack}
          /* `tap-pad` is safe here: nothing sits above it but the panel's own
             padding, so its hit region cannot steal a tap from text. */
          className="no-touch-target tap-pad -ml-1 mb-1 flex h-7 items-center gap-0.5 text-[12px] font-medium leading-none text-primary-600 dark:text-primary-400"
        >
          <ChevronLeft className="h-3.5 w-3.5" />
          Templates
        </button>

        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            {onNameChange ? (
              <input
                value={name}
                onChange={(e) => onNameChange(e.target.value)}
                placeholder={namePlaceholder ?? `Untitled ${typeLabel.toLowerCase()}`}
                aria-label="Template name"
                className="w-full bg-transparent text-[15px] font-semibold leading-tight text-gray-900 placeholder-gray-400 focus:outline-none dark:text-white"
              />
            ) : (
              <h1 className="truncate text-[15px] font-semibold leading-tight text-gray-900 dark:text-white">
                {name || `Untitled ${typeLabel.toLowerCase()}`}
              </h1>
            )}
            <p className="mt-0.5 flex items-center gap-1.5 truncate text-[12px] leading-none text-gray-500 dark:text-gray-400">
              <span>{typeLabel}</span>
              {meta && (
                <>
                  <span aria-hidden="true">·</span>
                  <span className="truncate">{meta}</span>
                </>
              )}
              {dirty && (
                <>
                  <span aria-hidden="true">·</span>
                  {/* Said in words, not a coloured dot: a dot beside a name
                      is ambiguous with every other status a dot could mean. */}
                  <span className="shrink-0 text-amber-600 dark:text-amber-400">Unsaved</span>
                </>
              )}
            </p>
          </div>
        </div>
      </div>

      {/* The editor. `min-h-0` is what lets this scroll instead of growing
          the flex parent and pushing the action bar off screen. */}
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 py-3">
        {children}
      </div>

      {/* Actions, pinned. */}
      {hasActions && (
        <div className="flex-shrink-0 border-t border-gray-200 bg-white px-3 py-2 pb-safe dark:border-gray-700 dark:bg-gray-900">
          <div className="flex items-center gap-2">
            {onSave && (
              <button
                type="button"
                onClick={onSave}
                disabled={saveDisabled || saving}
                className="no-touch-target inline-flex h-9 flex-1 items-center justify-center rounded-lg bg-primary-600 px-3 text-[13px] font-medium text-white disabled:opacity-40"
              >
                {saving ? 'Saving…' : saveLabel}
              </button>
            )}
            {onPreview && (
              <button
                type="button"
                onClick={onPreview}
                className="no-touch-target inline-flex h-9 items-center justify-center rounded-lg border border-gray-300 px-3 text-[13px] font-medium text-gray-700 dark:border-gray-600 dark:text-gray-200"
              >
                Preview
              </button>
            )}
            {onUse && (
              <button
                type="button"
                onClick={onUse}
                className="no-touch-target inline-flex h-9 items-center justify-center rounded-lg border border-gray-300 px-3 text-[13px] font-medium text-gray-700 dark:border-gray-600 dark:text-gray-200"
              >
                Use
              </button>
            )}
            {onMore && (
              <button
                type="button"
                onClick={onMore}
                aria-label="More actions"
                className={clsx(
                  'no-touch-target inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg',
                  'border border-gray-300 text-gray-500 dark:border-gray-600 dark:text-gray-400',
                )}
              >
                <MoreHorizontal className="h-4 w-4" />
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
