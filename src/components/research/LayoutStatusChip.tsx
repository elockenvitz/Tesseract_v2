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
 * So this says both halves out loud — the template being followed, and
 * whether this stock is overriding it — and offers the only action that
 * resolves the second one.
 */

import { clsx } from 'clsx'
import { Layers, RotateCcw } from 'lucide-react'

export function LayoutStatusChip({
  templateName,
  overridden,
  onReset,
  resetting,
  className,
}: {
  /** The template being followed. Null means the built-in default. */
  templateName: string | null
  /** Does this stock carry its own settings on top of that template? */
  overridden: boolean
  /** Clears this stock's overrides. Absent when the reader cannot. */
  onReset?: () => void
  resetting?: boolean
  className?: string
}) {
  const template = templateName ?? 'Default layout'

  return (
    <span
      data-testid="layout-status-chip"
      className={clsx(
        'inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px]',
        overridden
          ? 'bg-amber-50 text-amber-800 ring-1 ring-amber-200 dark:bg-amber-950/40 dark:text-amber-200 dark:ring-amber-900'
          : 'text-gray-500 dark:text-gray-400',
        className,
      )}
    >
      <Layers className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      {/*
        Both halves, always. Naming only the template when the page is
        overridden is what caused the confusion this chip exists to end;
        naming only the override would hide which template a reset
        returns to.
      */}
      {overridden ? (
        <span data-testid="layout-status-overridden">
          <span className="font-semibold">Custom layout</span>
          <span className="opacity-75"> · this stock only, not following {template}</span>
        </span>
      ) : (
        <span data-testid="layout-status-following">Following {template}</span>
      )}

      {overridden && onReset && (
        <>
          <span className="mx-0.5 h-3 w-px bg-amber-300 dark:bg-amber-800" aria-hidden="true" />
          <button
            type="button"
            onClick={onReset}
            disabled={resetting}
            data-testid="layout-status-reset"
            title={`Discard this stock's own layout and follow ${template} again`}
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
