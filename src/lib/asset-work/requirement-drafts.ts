/**
 * Unsent text belonging to a requirement.
 *
 * Selecting a different requirement unmounts its card — `InvestmentTimeline`
 * keys the detail surface on the requirement id — so a half-written note or
 * comment went to the garbage collector without a word. The reader had no
 * way to know that clicking the next requirement to check something would
 * cost them their paragraph.
 *
 * So a draft outlives its card. `sessionStorage` is the store the Asset tab
 * already keeps its own view state in (`TabStateManager`), it survives a
 * reload, it is per-tab and per-viewer, and it never reaches the database:
 * an unsent draft is not a saved note, and must not look like one to anyone
 * else.
 *
 * Every accessor is wrapped, because this throws in a private window and in
 * a tab with site data blocked, and a lost draft must never take the
 * requirement surface down with it.
 */
const PREFIX = 'tesseract:requirement-draft'

export type DraftField = 'notes' | 'comment'

/** Null when there is nothing to key on — an item with no row yet. */
export const draftKey = (itemKey: string | null | undefined, field: DraftField) =>
  itemKey ? `${PREFIX}:${itemKey}:${field}` : null

export function readDraft(key: string | null): string | null {
  if (!key) return null
  try {
    return sessionStorage.getItem(key)
  } catch {
    return null
  }
}

/**
 * Writes the draft, or clears it when the text is empty — an empty draft and
 * no draft are the same state, and keeping the empty one would reopen the
 * editor on the next visit for nothing.
 */
export function writeDraft(key: string | null, text: string): void {
  if (!key) return
  try {
    if (text.trim()) sessionStorage.setItem(key, text)
    else sessionStorage.removeItem(key)
  } catch {
    /* A draft that cannot be kept is still typed on screen. */
  }
}

export function clearDraft(key: string | null): void {
  if (!key) return
  try {
    sessionStorage.removeItem(key)
  } catch {
    /* ignore */
  }
}
