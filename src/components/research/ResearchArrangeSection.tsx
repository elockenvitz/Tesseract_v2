/**
 * A section's own controls, on the section, while arranging.
 *
 * ── Why this exists ────────────────────────────────────────────────────
 *
 * Arrange mode could move FIELDS and nothing else. Renaming a section,
 * reordering sections, hiding one, or adding one lived only in the
 * Customize Layout modal — the screen arrange mode was built to replace.
 * So the first question asked of the feature was "how am I supposed to
 * manage sections of fields in the layout?", and the honest answer was
 * "in the other screen, the one you stopped opening".
 *
 * The controls sit ON the section header rather than in the arrange bar.
 * A bar listing six sections with four buttons each is a form; a header
 * with its own handles is the thing you are editing. It also means
 * reordering and renaming are pointed at the same object the fields are
 * dragged into, so there is one mental model, not two.
 *
 * ── What it writes ─────────────────────────────────────────────────────
 *
 * This stock only, as `section_overrides` on
 * `user_asset_layout_selections` — the same per-stock layer the field
 * overrides use, and the same scope the arrange bar promises. Writes land
 * immediately rather than on Save, matching the template picker beside
 * them: the page below redraws, and that redraw IS the preview, so there
 * is nothing to confirm the reader cannot already see.
 *
 * Fields are different and stay different. A span dragged with the mouse
 * produces a write per pixel, which is why those are a draft.
 */

import { useEffect, useRef, useState } from 'react'
import { clsx } from 'clsx'
import { ChevronDown, ChevronUp, Eye, EyeOff, Pencil, RotateCcw, Trash2 } from 'lucide-react'

export interface ArrangeableSectionHeaderProps {
  sectionId: string
  /** The name as resolved — the rename if there is one, else the real name. */
  name: string
  /** The section's own name, so a rename can be undone. */
  originalName: string
  isHidden: boolean
  /** Added by this reader rather than part of the research schema. */
  isAdded: boolean
  canMoveUp: boolean
  canMoveDown: boolean
  busy?: boolean
  onRename: (name: string | null) => void
  onToggleHidden: (hidden: boolean) => void
  onMove: (direction: -1 | 1) => void
  /** Only offered for sections this reader added. */
  onRemove?: () => void
}

export function ArrangeableSectionHeader({
  sectionId,
  name,
  originalName,
  isHidden,
  isAdded,
  canMoveUp,
  canMoveDown,
  busy,
  onRename,
  onToggleHidden,
  onMove,
  onRemove,
}: ArrangeableSectionHeaderProps) {
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState(name)
  const inputRef = useRef<HTMLInputElement>(null)

  /* Reopening the editor must show what the section says NOW, not what it
     said the last time this component rendered — a rename from another
     tab, or a template switch underneath, both change it. */
  useEffect(() => {
    if (!editing) setValue(name)
  }, [name, editing])

  useEffect(() => {
    if (editing) inputRef.current?.select()
  }, [editing])

  const renamed = name !== originalName

  const commit = () => {
    const next = value.trim()
    setEditing(false)
    /* Typing the section's real name back is not a rename — it is
       undoing one, so it clears the override rather than storing a
       value identical to the thing it shadows. */
    if (next === name) return
    onRename(next && next !== originalName ? next : null)
  }

  const btn =
    'inline-flex items-center justify-center rounded p-1 text-primary-700 hover:bg-primary-100 ' +
    'disabled:cursor-not-allowed disabled:opacity-30 dark:text-primary-200 dark:hover:bg-primary-900/60'

  return (
    <div
      data-testid={`arrange-section-${sectionId}`}
      className={clsx(
        'flex w-full items-center gap-1.5 border-b border-primary-200 bg-primary-50/80 px-5 py-2',
        'dark:border-primary-800 dark:bg-primary-950/60',
        isHidden && 'opacity-60',
      )}
    >
      {editing ? (
        <input
          ref={inputRef}
          value={value}
          autoFocus
          disabled={busy}
          data-testid={`arrange-section-name-input-${sectionId}`}
          aria-label={`Rename ${originalName} on this stock`}
          onChange={e => setValue(e.target.value)}
          onBlur={commit}
          onKeyDown={e => {
            if (e.key === 'Enter') { e.preventDefault(); commit() }
            /* Escape abandons the edit. Committing on Escape is the
               behaviour people use to get OUT of a rename they did not
               mean to start. */
            if (e.key === 'Escape') { e.preventDefault(); setValue(name); setEditing(false) }
          }}
          className="min-w-0 flex-1 rounded border border-primary-300 bg-white px-2 py-1 text-xs font-semibold uppercase tracking-wider text-gray-800 focus:border-primary-500 focus:outline-none dark:border-primary-700 dark:bg-gray-900 dark:text-gray-100"
        />
      ) : (
        <button
          type="button"
          disabled={busy}
          onClick={() => setEditing(true)}
          data-testid={`arrange-section-rename-${sectionId}`}
          title={`Rename ${originalName} on this stock only`}
          className="group flex min-w-0 flex-1 items-center gap-1.5 text-left"
        >
          <span className="truncate text-xs font-semibold uppercase tracking-wider text-gray-600 dark:text-gray-300">
            {name}
          </span>
          <Pencil className="h-3 w-3 shrink-0 text-primary-400 opacity-0 transition-opacity group-hover:opacity-100" aria-hidden="true" />
        </button>
      )}

      {/* What state this section is in, said rather than implied by a
          faded header nobody reads as "hidden". */}
      {isHidden && (
        <span
          data-testid={`arrange-section-hidden-${sectionId}`}
          className="shrink-0 rounded bg-gray-200 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-gray-600 dark:bg-gray-700 dark:text-gray-300"
        >
          Hidden
        </span>
      )}
      {renamed && !editing && (
        <button
          type="button"
          disabled={busy}
          onClick={() => onRename(null)}
          data-testid={`arrange-section-reset-name-${sectionId}`}
          title={`Call it "${originalName}" again`}
          className="inline-flex shrink-0 items-center gap-1 rounded px-1 py-0.5 text-[10px] font-medium text-primary-700 hover:bg-primary-100 disabled:opacity-40 dark:text-primary-300 dark:hover:bg-primary-900/60"
        >
          <RotateCcw className="h-3 w-3" aria-hidden="true" />
          {originalName}
        </button>
      )}

      <span className="ml-auto flex shrink-0 items-center gap-0.5">
        <button
          type="button"
          disabled={busy || !canMoveUp}
          onClick={() => onMove(-1)}
          data-testid={`arrange-section-up-${sectionId}`}
          title="Move this section up"
          aria-label={`Move ${name} up`}
          className={btn}
        >
          <ChevronUp className="h-4 w-4" aria-hidden="true" />
        </button>
        <button
          type="button"
          disabled={busy || !canMoveDown}
          onClick={() => onMove(1)}
          data-testid={`arrange-section-down-${sectionId}`}
          title="Move this section down"
          aria-label={`Move ${name} down`}
          className={btn}
        >
          <ChevronDown className="h-4 w-4" aria-hidden="true" />
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => onToggleHidden(!isHidden)}
          data-testid={`arrange-section-visibility-${sectionId}`}
          title={isHidden
            ? `Show ${name} on this stock`
            : `Hide ${name} on this stock. Nothing in it is deleted.`}
          aria-label={isHidden ? `Show ${name}` : `Hide ${name}`}
          className={btn}
        >
          {isHidden
            ? <EyeOff className="h-4 w-4" aria-hidden="true" />
            : <Eye className="h-4 w-4" aria-hidden="true" />}
        </button>
        {/*
          Removing is offered only for a section this reader ADDED, and it
          removes the section from this stock — not from the organization's
          research schema. A system section is hidden, never removed,
          because the fields in it belong to everyone.
        */}
        {isAdded && onRemove && (
          <button
            type="button"
            disabled={busy}
            onClick={onRemove}
            data-testid={`arrange-section-remove-${sectionId}`}
            title={`Take ${name} off this stock. The section itself is not deleted.`}
            aria-label={`Remove ${name} from this stock`}
            className="inline-flex items-center justify-center rounded p-1 text-gray-400 hover:bg-error-50 hover:text-error-600 disabled:opacity-30 dark:hover:bg-error-950/40"
          >
            <Trash2 className="h-4 w-4" aria-hidden="true" />
          </button>
        )}
      </span>
    </div>
  )
}
