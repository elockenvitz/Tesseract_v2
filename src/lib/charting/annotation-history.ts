/**
 * Undo and redo for chart drawings.
 *
 * There was none. `grep -rniE "undo|redo"` over `pages/ChartingPage.tsx` and
 * the whole of `components/charting` returned nothing, so the only way back
 * from a misplaced mark was "Clear All Annotations" -- which takes every
 * other mark on the panel with it.
 *
 * ── Snapshots, not inverse commands ───────────────────────────────────────
 *
 * A command stack (add/remove/move, each with an inverse) is the usual shape
 * and it is the wrong one here. The subject is one array of plain data
 * objects, a few dozen at the very most, held in React state and already
 * replaced wholesale on every edit. An inverse-command implementation would
 * need a correct inverse for each of nine annotation types and would go
 * subtly wrong the first time someone added a tenth -- and a wrong inverse
 * silently corrupts the drawing rather than failing. Snapshots cannot: the
 * previous array either is the previous array or it is not.
 *
 * The cost is memory, bounded by `LIMIT` below.
 *
 * ── Why the present is inside the past stack ──────────────────────────────
 *
 * `past` always holds at least one entry, the current state, and `undo` moves
 * the pointer rather than popping. This is what makes `canUndo` honest at the
 * beginning: an empty-array history has nothing before it, and a "no-op
 * undo" that quietly returned the same state would leave a disabled-looking
 * button enabled.
 *
 * ── Pure and immutable ───────────────────────────────────────────────────
 *
 * Every operation returns a NEW history. Nothing mutates, so React sees a
 * changed reference and a test can hold an older history and assert it did
 * not move. The annotation arrays themselves are shared by reference: they
 * are treated as immutable everywhere they are produced, and copying each
 * one on every keystroke to defend against a mutation nobody performs would
 * be the more expensive mistake.
 */

/** How many states back you can go. */
export const LIMIT = 50

export interface History<T> {
  /** Oldest first; the LAST entry is the present. Never empty. */
  past: readonly T[]
  /** States undone from, newest first. Cleared by any new commit. */
  future: readonly T[]
}

export function createHistory<T>(present: T): History<T> {
  return { past: [present], future: [] }
}

export function present<T>(h: History<T>): T {
  return h.past[h.past.length - 1]
}

export function canUndo<T>(h: History<T>): boolean {
  return h.past.length > 1
}

export function canRedo<T>(h: History<T>): boolean {
  return h.future.length > 0
}

/**
 * Record a new state.
 *
 * Commits identical by reference are dropped. A canvas emits a great many
 * redundant updates -- a mouse-up after a drag that moved nothing, a style
 * re-applied with the same value -- and each one would otherwise consume an
 * undo step, so a reader would press Ctrl+Z and watch nothing happen.
 * Reference equality only: two arrays with equal contents are kept, because
 * deep-comparing on every commit costs more than the step it saves.
 *
 * Committing DISCARDS the redo future, which is the standard rule: once you
 * draw something new, the branch you undid is unreachable.
 */
export function commit<T>(h: History<T>, next: T): History<T> {
  if (present(h) === next) return h
  const past = [...h.past, next]
  /* Drop the oldest, never the present. */
  return { past: past.length > LIMIT ? past.slice(past.length - LIMIT) : past, future: [] }
}

export function undo<T>(h: History<T>): History<T> {
  if (!canUndo(h)) return h
  const undone = present(h)
  return { past: h.past.slice(0, -1), future: [undone, ...h.future] }
}

export function redo<T>(h: History<T>): History<T> {
  if (!canRedo(h)) return h
  const [next, ...rest] = h.future
  return { past: [...h.past, next], future: rest }
}

/**
 * Replace the present without recording a step, and drop the future.
 *
 * For a state change that is not the analyst's edit: switching the panel to
 * another symbol, or loading a stored workspace. Treating those as undoable
 * steps would let Ctrl+Z appear to "undo" a symbol change by putting another
 * asset's drawings onto the chart -- the kind of cross-asset mark that looks
 * like analysis and is not.
 */
export function reset<T>(present_: T): History<T> {
  return createHistory(present_)
}
