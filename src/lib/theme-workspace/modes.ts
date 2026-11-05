/**
 * The modes of the Theme page, and how the six old sections fold into them.
 *
 * ── Why this exists ──────────────────────────────────────────────────────
 *
 * The Theme page had six peer tabs — Thesis, Chart, Related Assets, Notes,
 * Discussion, Process — which is the shape the Asset page was deliberately
 * moved away from. Six peers ask the reader to know which feature holds the
 * thing they want. The modes ask a different question: am I orienting,
 * reading, or working?
 *
 *   Overview   where this theme stands right now
 *   Assets     the names in it
 *   Research   the written case on it
 *   Work       the processes running against it
 *
 * This file is the Theme counterpart of `lib/asset-workspace/modes.ts` and
 * follows its reasoning deliberately, because the point of the change is that
 * the two pages stop being different products.
 *
 * ── No History, and that is not an omission ──────────────────────────────
 *
 * The Asset page's fourth mode is History: what was decided and the capital
 * behind it. A theme has no decisions and no capital deployed against it, so
 * there is nothing for that mode to render. A tab for it would be empty, or
 * would have to be filled by moving the thesis change log out of Research and
 * away from the thing it is a log of.
 *
 * So the change log stays a read mode of Research, and History arrives here
 * only if themes ever gain decisions of their own.
 *
 * ── Why Assets is its own mode and the chart is not ───────────────────────
 *
 * Both were tabs, and the first pass folded both into Overview as bands. That
 * was wrong about one of them.
 *
 * The roster is a working surface: a sortable table with selection, bulk
 * remove, a held/watchlist split and its own Add Assets control. Stacked
 * under a chart and two digests it is a table you have to scroll past
 * everything else to reach, and its own controls read as controls for the
 * page. So it is a mode.
 *
 * Overview is now a digest and nothing else: where the theme stands (the
 * index chart), what the firm actually owns of it, what has been written
 * lately, and what has happened. Each band is a few rows deep and links to
 * the mode that owns the detail. Nothing is edited there.
 *
 * ── One section was removed outright ──────────────────────────────────────
 *
 * Discussion. `theme_discussions` held ZERO posts across all 51 themes, so
 * the tab orphaned nothing, and the table, its policies and its triggers have
 * since been dropped as well
 * (20261104120000_drop_theme_discussions.sql). Notes stopped being a tab and
 * became the third read mode of Research, which is where the Asset page keeps
 * them ("Key references").
 */

export type ThemeMode = 'overview' | 'assets' | 'research' | 'work'

/** Nav order, left to right: orient, then the names, then read, then do. */
export const THEME_MODES: readonly ThemeMode[] = ['overview', 'assets', 'research', 'work']

export const THEME_MODE_LABEL: Record<ThemeMode, string> = {
  overview: 'Overview',
  assets: 'Assets',
  research: 'Research',
  work: 'Work',
}

/**
 * How Research is being read. The Asset page's equivalent row is
 * Investment Case / History / Key references; a theme's case is its thesis,
 * so the first is named for that.
 */
export type ThemeReadMode = 'thesis' | 'changes' | 'notes'

export const THEME_READ_MODES: readonly ThemeReadMode[] = ['thesis', 'changes', 'notes']

/**
 * Where each section the page used to persist now lives.
 *
 * Kept as a table rather than inlined in a `switch` because it is the whole
 * migration: every value `activeTab` could have been saved as, and nothing
 * else. A tab persisted by an older build is the only reason this is needed,
 * and it is the one case nobody tests by hand.
 *
 * `outcomes` was already being migrated to `thesis` by the page before the
 * modes existed, so it is carried rather than dropped — a tab saved that long
 * ago would otherwise skip straight to the fallback.
 *
 * `discussion` maps to Overview because its feature is gone. There is no
 * successor surface to approximate, so a reader lands on the page's own
 * default rather than somewhere chosen to look like an answer.
 */
export const LEGACY_SECTION_MODE: Record<string, ThemeMode> = {
  thesis: 'research',
  notes: 'research',
  outcomes: 'research',
  chart: 'overview',
  'related-assets': 'assets',
  discussion: 'overview',
  processes: 'work',
}

/**
 * The mode for a persisted section value.
 *
 * Tolerant on purpose, the same way `modeOf` is on the Asset page: tab state
 * written by an older build can hold a string this union never had, and a
 * reader opening a saved tab should get the Overview rather than a blank
 * page.
 */
export function themeModeOf(saved: string | null | undefined): ThemeMode {
  if (typeof saved !== 'string') return 'overview'
  return Object.prototype.hasOwnProperty.call(LEGACY_SECTION_MODE, saved)
    ? LEGACY_SECTION_MODE[saved]
    : 'overview'
}

/**
 * The Research read mode a persisted section implies, if it implies one.
 *
 * Only `notes` does. It was a tab of its own, so a reader who left the page
 * on Notes has to arrive in Research already reading the notes; landing them
 * on the thesis instead would lose the destination they actually saved.
 *
 * `thesis` returns null rather than 'thesis' so the caller can tell "this
 * section asks for a particular read mode" from "this section does not care",
 * and leave a read mode the reader has since chosen alone.
 */
export function themeReadModeOf(saved: string | null | undefined): ThemeReadMode | null {
  return saved === 'notes' ? 'notes' : null
}

export function isThemeMode(value: unknown): value is ThemeMode {
  return typeof value === 'string' && (THEME_MODES as readonly string[]).includes(value)
}

export function isThemeReadMode(value: unknown): value is ThemeReadMode {
  return typeof value === 'string' && (THEME_READ_MODES as readonly string[]).includes(value)
}
