/**
 * The four modes of the Asset page, and how the five existing sub-pages fold
 * into them.
 *
 * ── Why a mapping and not a rename ───────────────────────────────────────
 *
 * The page had five peer tabs — Snapshot, Research, Process, Decisions,
 * Lists — which asked the reader to know which feature holds the thing they
 * want. The four modes ask a different question: am I orienting, reading,
 * working, or looking back?
 *
 *   Overview   what is the state of this name
 *   Research   the written case
 *   Work       everything with an open loop: ideas, the running process, the
 *              lists this name sits in
 *   History    what was decided, and the capital behind it
 *
 * `AssetSubPage` is deliberately KEPT as the unit of navigation rather than
 * replaced by the mode. Three things depend on it and would all break on a
 * rename: the per-tab state persisted under `activeSubPage`, the `asset.focus`
 * deep-links, and every existing handoff (`onOpenSubPage`, `onOpenList`,
 * `onOpenProcess`). So a sub-page still names a DESTINATION; the mode is
 * derived from it, and in Work the three work sub-pages all render on one
 * surface with the sub-page choosing which section to scroll to.
 *
 * That is the whole point of the Work mode: Process, Ideas and Lists stop
 * being three places to visit and become three parts of one page.
 */

export type AssetMode = 'overview' | 'research' | 'work' | 'history'

/**
 * A navigation destination. The first five are the page's original tabs,
 * unchanged in name so persisted state and deep-links keep working; `history`
 * is new, and carries the half of the old Decisions tab that is a record
 * rather than a task.
 */
export type AssetSubPage =
  | 'snapshot'
  | 'research'
  | 'workflow'
  | 'decisions'
  | 'lists'
  | 'history'

/** Which mode renders a given destination. Total by construction. */
export const SUBPAGE_MODE: Record<AssetSubPage, AssetMode> = {
  snapshot: 'overview',
  research: 'research',
  workflow: 'work',
  decisions: 'work',
  lists: 'work',
  history: 'history',
}

/** Where a mode lands when the reader picks it from the nav. */
export const MODE_LANDING: Record<AssetMode, AssetSubPage> = {
  overview: 'snapshot',
  research: 'research',
  /* Work lands on `decisions` because that is the sub-page the old Decisions
     tab persisted, so a reader returning to a saved tab lands where they
     left. The Work surface opens at its top regardless — the scroll anchor is
     set only by an explicit handoff, never by entering the mode. */
  work: 'decisions',
  history: 'history',
}

/** Nav order, left to right: orient, read, do, look back. */
export const ASSET_MODES: readonly AssetMode[] = ['overview', 'research', 'work', 'history']

export const MODE_LABEL: Record<AssetMode, string> = {
  overview: 'Overview',
  research: 'Research',
  work: 'Work',
  history: 'History',
}

/** The three sub-pages that render as sections of the one Work surface. */
export const WORK_SUBPAGES = ['decisions', 'workflow', 'lists'] as const
export type WorkSubPage = (typeof WORK_SUBPAGES)[number]

/**
 * DOM ids for the Work sections, so a handoff that used to switch tabs can
 * scroll instead. These are the anchors; `AssetTab` owns the elements.
 */
export const WORK_SECTION_ID: Record<WorkSubPage, string> = {
  decisions: 'work-ideas',
  workflow: 'work-process',
  lists: 'work-lists',
}

export function isAssetSubPage(value: unknown): value is AssetSubPage {
  /* `in` would answer yes to 'toString' — every object literal inherits
     Object.prototype — and a persisted 'toString' would resolve to an
     undefined mode. Own properties only. */
  return typeof value === 'string'
    && Object.prototype.hasOwnProperty.call(SUBPAGE_MODE, value)
}

/**
 * The mode for a destination.
 *
 * Tolerant on purpose: tab state persisted by an older build can hold a
 * string this union no longer has, and a reader opening a saved tab should
 * get the Overview rather than a blank page.
 */
export function modeOf(sub: string | null | undefined): AssetMode {
  return isAssetSubPage(sub) ? SUBPAGE_MODE[sub] : 'overview'
}

/** The Work section a destination scrolls to, or null if it is not in Work. */
export function workSectionId(sub: string | null | undefined): string | null {
  if (!isAssetSubPage(sub)) return null
  return Object.prototype.hasOwnProperty.call(WORK_SECTION_ID, sub)
    ? WORK_SECTION_ID[sub as WorkSubPage]
    : null
}
