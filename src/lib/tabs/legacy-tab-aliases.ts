/**
 * Tab types that no longer have an application behind them.
 *
 * ── What an alias is for ──────────────────────────────────────────────────
 *
 * Retiring a surface is not the same as deleting its tab type. Sessions are
 * persisted, deep links are shared, and a reader who had the ideas experience
 * open before the change still has it open after. The tab type is the only
 * record of that intent, so it has to keep resolving — to the surface that now
 * answers the question it was asking.
 *
 * An alias therefore carries exactly one thing forward: "I had this experience
 * open". Not the position, not the filters, not the internal view mode. Those
 * belonged to a different application and have no counterpart in the one that
 * replaces it; carrying them across would be inventing a state the reader
 * never chose.
 *
 * ── Why `idea-generator` is aliased and `ideas-v2` is not ─────────────────
 *
 * `idea-generator` WAS the standalone desktop ideas application, so the
 * standalone ideas application is what it meant. `ideas-v2` is the Dashboard's
 * Ideas LENS — a view inside another surface — and reinterpreting that as a
 * separate application would move a reader somewhere they never chose. It
 * keeps its own render path in `DashboardPage` and is deliberately absent from
 * this table.
 *
 * ── One tab, not two ──────────────────────────────────────────────────────
 *
 * The alias rewrites the id as well as the type, because the shell reuses a
 * tab by id. Without that, a restored `idea-generator` and a freshly opened
 * `ideas` would be two tabs showing one application.
 *
 * Pure: no React, no storage, no clock.
 */

export interface TabLike {
  id?: string
  type?: string
  title?: string
  data?: unknown
}

interface Alias {
  type: string
  id: string
  title: string
}

/** Legacy tab type → the surface that answers for it now. */
export const LEGACY_TAB_ALIASES: Readonly<Record<string, Alias>> = Object.freeze({
  /*
   * The Idea Generator: a masonry discovery grid and a single-column feed
   * behind a view toggle. Replaced by the standalone Ideas application, which
   * is the same question — what should I be thinking about — asked with the
   * attention feed, Explore and a persistent workspace.
   *
   * Its `data` carried `initialFilters` and `selectedThoughtId`. Neither has a
   * counterpart in the standalone app, so both are dropped rather than
   * translated into something that looks equivalent.
   */
  'idea-generator': { type: 'ideas', id: 'ideas', title: 'Ideas' },

  /*
   * The legacy desktop Dashboard: a scope bar over a decision, research or
   * portfolio workbench. Replaced by `today`, which is the same question asked
   * through the lens shell.
   *
   * ── Why a global rewrite is safe for phones ─────────────────────────────
   *
   * This table has no idea what device it is running on, and it does not need
   * one. `DashboardPage` already routes `today` on a phone into
   * `renderDashboardContent()`, which returns `MobileDashboard` — the same
   * component `dashboard` reached there. So rewriting the type preserves the
   * mobile meaning exactly, and `MobileNavDrawer` already prefers the
   * canonical id when it looks for home. A device-conditional migration would
   * be machinery for a difference that does not exist.
   *
   * ── What stays behind ───────────────────────────────────────────────────
   *
   * The `dashboard` TYPE is not retired. It still has a render path, because
   * the pilot action dashboard lives on it pending a separate decision about
   * the pilot programme. What this removes is the ability to arrive there by
   * navigating: no launcher entry creates it, and no restored session keeps
   * it.
   */
  'dashboard': { type: 'today', id: 'today', title: 'Dashboard' },

  /*
   * My Priorities: a standalone list of what had gone stale, what was waiting
   * on a decision, and what others had changed. It was a shell over
   * `useAttention` — the same scoring that Today, the feed and the tile engine
   * read — so retiring it removed a second front door to one system, not a
   * capability.
   *
   * `today` is what it meant. Both asked "what needs me now", and both answer
   * it from attention; Today answers it beside the work rather than in a page
   * of its own. That is the same reasoning that sent `dashboard` here.
   *
   * ── Why both types ──────────────────────────────────────────────────────
   *
   * `prioritizer` was the original id and `priorities` the later one, and
   * `DashboardPage` rendered them through a single `case`, so both are live in
   * saved sessions. Aliasing only the newer one would leave the older sessions
   * resolving to nothing.
   *
   * The page held its section filter in local state, never in `data`, so there
   * is nothing to carry across and nothing being dropped that a reader chose.
   */
  'priorities': { type: 'today', id: 'today', title: 'Today' },
  'prioritizer': { type: 'today', id: 'today', title: 'Today' },
})

export function isLegacyTabType(type: string | undefined | null): boolean {
  return !!type && type in LEGACY_TAB_ALIASES
}

/**
 * The tab a descriptor should actually open.
 *
 * Returns the input unchanged when there is nothing to alias, so it is safe to
 * put in front of every navigation rather than at the call sites that happen
 * to be known today. That is the point: a legacy descriptor can arrive from a
 * saved session, a deep link, an event, a search result or a banner, and the
 * ones enumerated in a migration are never all of them.
 */
export function canonicalTabTarget<T extends TabLike>(target: T): T {
  const alias = target?.type ? LEGACY_TAB_ALIASES[target.type] : undefined
  if (!alias) return target
  return { ...target, type: alias.type, id: alias.id, title: alias.title, data: undefined }
}

/**
 * Migrate a restored tab list in place of the old types.
 *
 * Collapses duplicates by id as it goes: a session holding both the legacy tab
 * and the canonical one becomes a session holding one, and the first
 * occurrence wins so the reader's own ordering survives. `activeTabId` is
 * remapped too, or the session restores with an active id no tab has.
 */
export function migrateLegacyTabs<T extends TabLike>(
  tabs: T[],
  activeTabId: string | null | undefined,
): { tabs: T[]; activeTabId: string | null; migrated: string[] } {
  const migrated: string[] = []
  const seen = new Set<string>()
  const out: T[] = []

  for (const tab of tabs ?? []) {
    const next = canonicalTabTarget(tab)
    if (next !== tab && tab.type) migrated.push(tab.type)
    const id = next.id
    if (id && seen.has(id)) continue
    if (id) seen.add(id)
    out.push(next)
  }

  const activeAlias = activeTabId ? aliasForId(tabs, activeTabId) : null
  return { tabs: out, activeTabId: activeAlias ?? activeTabId ?? null, migrated }
}

/** The new id for a tab that was active under its old one. */
function aliasForId<T extends TabLike>(tabs: T[], activeTabId: string): string | null {
  for (const tab of tabs ?? []) {
    if (tab.id !== activeTabId) continue
    const alias = tab.type ? LEGACY_TAB_ALIASES[tab.type] : undefined
    return alias ? alias.id : null
  }
  return null
}
