/**
 * Which layout this stock's Research page is actually drawing.
 *
 * ── Why this exists ────────────────────────────────────────────────────
 *
 * The layout a reader SEES is resolved from two layers: a template, and
 * this stock's own overrides on top of it. Until now the page named
 * neither. The template picker inside arrange mode said "Default layout"
 * while the page in front of you was nothing like the default, because
 * this stock had its own settings shadowing it — and nothing anywhere
 * said so.
 *
 * That produces a specific wrong belief, reported from use: make a change
 * to one stock, set it back by hand, and assume you are back on the
 * default. You are not. You are on an override that currently agrees with
 * the default and will stop agreeing the moment the template changes.
 *
 * ── Why it is usually silent ───────────────────────────────────────────
 *
 * The first version said "Following Default layout" permanently, on every
 * page. That is the state of almost every stock almost all of the time,
 * and a label that is always there and always the same is read once and
 * then never again — it was noise sitting at the same visual weight as
 * the controls that decide how the case is read.
 *
 * So it speaks only when the page is NOT what you would expect:
 *
 *  - overriding its template  → amber, named, with the way back
 *  - on a template that is not your default → quiet, just the name
 *  - on your default, no overrides → nothing at all
 *
 * The identity of the template in the ordinary case belongs to the tool
 * that changes it: arrange mode's picker names it, and this chip appears
 * there too so both places use one word for one state.
 */

import { clsx } from 'clsx'
import { Layers, RotateCcw } from 'lucide-react'

export function LayoutStatusChip({
  templateName,
  isDefaultTemplate = false,
  overridden,
  onReset,
  resetting,
  className,
}: {
  /** The template being followed. Null means the built-in default. */
  templateName: string | null
  /**
   * Is that template the reader's own default — the one they would get
   * without choosing anything? Following it is the unremarkable state
   * and earns no label; following some OTHER template is worth naming.
   */
  isDefaultTemplate?: boolean
  /** Does this stock carry settings that DIFFER from that template? */
  overridden: boolean
  /** Clears this stock's overrides. Absent when the reader cannot. */
  onReset?: () => void
  resetting?: boolean
  className?: string
}) {
  const template = templateName ?? 'Default layout'

  /* Nothing to report: the page is drawing the layout the reader already
     expects. Returning null rather than rendering a muted "all normal"
     is the whole point — see the note above. */
  if (!overridden && (templateName === null || isDefaultTemplate)) return null

  if (!overridden) {
    return (
      <span
        data-testid="layout-status-chip"
        className={clsx(
          'inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px] text-gray-500 dark:text-gray-400',
          className,
        )}
      >
        <Layers className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        <span data-testid="layout-status-following">Following {template}</span>
      </span>
    )
  }

  return (
    <span
      data-testid="layout-status-chip"
      className={clsx(
        'inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px]',
        'bg-amber-50 text-amber-800 ring-1 ring-amber-200 dark:bg-amber-950/40 dark:text-amber-200 dark:ring-amber-900',
        className,
      )}
    >
      <Layers className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      {/*
        Short label, named template on the action. "Custom layout · this
        stock only, not following Default layout" said it all in one
        breath and was too long to sit in a toolbar; the template's name
        still has to appear, because a reset that does not say what it
        resets TO is not a safe button to press — so it moved onto the
        button, where it is both shorter and more use.
      */}
      <span data-testid="layout-status-overridden" className="font-semibold">
        Custom layout
      </span>

      {onReset && (
        <>
          <span className="mx-0.5 h-3 w-px bg-amber-300 dark:bg-amber-800" aria-hidden="true" />
          <button
            type="button"
            onClick={onReset}
            disabled={resetting}
            data-testid="layout-status-reset"
            title={`This stock has its own layout, which only applies here. Discard it and follow ${template} again.`}
            className="inline-flex items-center gap-1 rounded px-1 py-0.5 font-semibold hover:bg-amber-100 disabled:opacity-50 dark:hover:bg-amber-900/50"
          >
            <RotateCcw className="h-3 w-3" aria-hidden="true" />
            {resetting ? 'Resetting…' : `Reset to ${template}`}
          </button>
        </>
      )}
    </span>
  )
}
