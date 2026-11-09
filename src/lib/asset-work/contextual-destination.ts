/**
 * Where a click in the Work sidebar goes.
 *
 * ── The defect this exists to fix ───────────────────────────────────────
 *
 * Processes, ideas and conversations select IN PLACE: the asset tab stays
 * put and the working surface changes. Lists and portfolios did not. They
 * called `onNavigate`, which opens a TOP-LEVEL tab — so clicking "Large Cap
 * Growth" under an asset's Work sidebar closed the asset workspace and
 * opened the whole Portfolio application, with no way back except the
 * browser-tab strip and no memory of the process you were working.
 *
 * Two destinations in one list, one of which quietly ends your session on
 * the asset, is the single largest source of lost context in Work.
 *
 * ── The contract ────────────────────────────────────────────────────────
 *
 * One selection key owns the whole surface — `kind:id`, already persisted
 * in tab state, already restored on reload. Lists and portfolios join it as
 * two more kinds rather than acquiring a second state of their own.
 * Leaving the asset becomes an explicit, labelled action on the contextual
 * surface ("Open the full list"), never the side effect of a click in a
 * sidebar.
 */

export type WorkKind = 'idea' | 'process' | 'conversation' | 'list' | 'portfolio'

/** The kinds that render a contextual surface instead of a navigator item. */
export type ContextualKind = 'list' | 'portfolio'

export interface ParsedWorkKey {
  kind: WorkKind
  id: string
}

const KINDS: readonly WorkKind[] = ['idea', 'process', 'conversation', 'list', 'portfolio']

export const contextualKey = {
  list: (id: string) => `list:${id}`,
  portfolio: (id: string) => `portfolio:${id}`,
}

/**
 * A stored key, split.
 *
 * Returns null for anything unrecognised rather than guessing a kind: a key
 * saved by an older build, or corrupted in session storage, must resolve to
 * "no selection" and not to some other piece of work wearing its id.
 */
export function parseWorkKey(key: string | null | undefined): ParsedWorkKey | null {
  if (!key) return null
  const at = key.indexOf(':')
  if (at <= 0 || at === key.length - 1) return null
  const kind = key.slice(0, at) as WorkKind
  if (!KINDS.includes(kind)) return null
  return { kind, id: key.slice(at + 1) }
}

/** The selection, when it is one of the contextual destinations. */
export function contextualSelection(key: string | null | undefined): { kind: ContextualKind; id: string } | null {
  const parsed = parseWorkKey(key)
  if (!parsed) return null
  if (parsed.kind !== 'list' && parsed.kind !== 'portfolio') return null
  return { kind: parsed.kind, id: parsed.id }
}

export interface BackTarget {
  /** The key to restore. Null returns to the Work overview. */
  key: string | null
  /** What the control says, so Back is never a bare arrow. */
  label: string
}

/**
 * What the labelled Back control returns to, and what it is called.
 *
 * A reader who entered a contextual view directly — restored from session
 * state on a reload, with no previous selection — still needs a way out, so
 * the fallback is the Work overview under its own name rather than a
 * disabled control or a silent no-op.
 */
export function backTarget(
  previousKey: string | null | undefined,
  labelFor: (key: string) => string | null,
): BackTarget {
  if (previousKey) {
    const label = labelFor(previousKey)
    if (label) return { key: previousKey, label: `Back to ${label}` }
  }
  return { key: null, label: 'Back to work' }
}
