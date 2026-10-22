/**
 * The left side of Work: what this asset IS, and what there is to do about it.
 *
 * ── What it replaces ────────────────────────────────────────────────────
 *
 * Four places, in three different idioms. The work navigator was a 248px
 * rail; list membership was a horizontal strip above it; themes, portfolios
 * and projects were full-width collapsible Cards stranded 708px BELOW the
 * working surface, where a reader doing process work never saw them. Same
 * page, four visual languages, and the relationships furthest from the work
 * they relate to.
 *
 * ── Restraint ───────────────────────────────────────────────────────────
 *
 * One column, one idiom: a small caps header with its actions on the right,
 * then rows. No section is wrapped in a Card — the sidebar is the card.
 * Sections collapse through the SAME `collapsedSections` state the old cards
 * used, so the header's context chips still deep-link to
 * `lists-section-*Content` and find them here.
 *
 * ── It owns no actions of its own ───────────────────────────────────────
 *
 * Every control is the real one, passed in as a slot: `AddToListButton`,
 * `AddToThemeButton`, `AddToProjectButton`, `RelatedProjects`. Replacing a
 * management dialog with a decorative chip that cannot do what it replaced
 * is the specific failure this avoids.
 */
import { useState } from 'react'
import { clsx } from 'clsx'
import { ChevronDown, ChevronRight, ExternalLink, X, Users } from 'lucide-react'
import { WorkSidebarToggle, WORK_SIDEBAR_REGION_ID } from './WorkSidebarToggle'

/** Rows a relationship section shows before offering the rest. */
export const SECTION_PREVIEW = 5

export interface SidebarList {
  itemId: string
  listId: string
  name: string
  listType: 'mutual' | 'collaborative'
  /** The existing per-row rule from `lib/lists/list-permissions`. */
  canRemove: boolean
}

export interface SidebarTheme {
  id: string
  name: string
  /** Rendered as the existing badge; never inferred. */
  themeType?: string | null
  badgeVariant?: string
}

export interface SidebarPortfolio {
  id: string
  name: string
  /** Portfolio weight, when the holdings maths could produce one. */
  weight?: string | null
}

export interface AssetWorkSidebarProps {
  /** The work navigator — In Progress and Investigations. */
  workSlot: React.ReactNode

  // ── Lists ──────────────────────────────────────────────────────────────
  /** `null` is "not loaded" and renders no rows; `[]` is "in none". */
  lists?: SidebarList[] | null
  onOpenList?: (listId: string) => void
  onRemoveFromList?: (itemId: string) => void
  removingListItemId?: string | null
  addToListSlot?: React.ReactNode
  onOpenAllLists?: () => void

  // ── Themes ─────────────────────────────────────────────────────────────
  themes?: SidebarTheme[] | null
  onOpenTheme?: (theme: SidebarTheme) => void
  onOpenAllThemes?: () => void
  addToThemeSlot?: React.ReactNode

  // ── Portfolios ─────────────────────────────────────────────────────────
  portfolios?: SidebarPortfolio[] | null
  onOpenPortfolio?: (portfolioId: string) => void
  onOpenAllPortfolios?: () => void

  // ── Projects ───────────────────────────────────────────────────────────
  /** `RelatedProjects`, which owns its own query, rows and empty state. */
  projectsSlot?: React.ReactNode
  addToProjectSlot?: React.ReactNode

  /** The existing collapse map, shared with the header's context chips. */
  collapsed: Record<string, boolean>
  onToggleSection: (key: string) => void
  className?: string

  /**
   * Whole-sidebar visibility, as distinct from `collapsed`, which is the
   * per-section map. Hidden renders nothing at all — see the note in the
   * component for why this is the sidebar's job and not the caller's.
   */
  hidden?: boolean
  /** Omit to render no collapse control, which is how tests mount it bare. */
  onCollapse?: () => void
}

/** A section header: name, optional actions, and the collapse affordance. */
function SectionHeader({
  id, label, count, collapsed, onToggle, onOpenAll, actions,
}: {
  id: string
  label: string
  count?: number | null
  collapsed: boolean
  onToggle: () => void
  onOpenAll?: () => void
  actions?: React.ReactNode
}) {
  return (
    <div className="flex items-center gap-1 px-1">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={!collapsed}
        data-testid={`sidebar-toggle-${id}`}
        className="flex min-w-0 flex-1 items-center gap-1 py-1 text-left"
      >
        {collapsed
          ? <ChevronRight className="h-3 w-3 shrink-0 text-gray-400" aria-hidden="true" />
          : <ChevronDown className="h-3 w-3 shrink-0 text-gray-400" aria-hidden="true" />}
        <span className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">
          {label}
        </span>
        {count != null && count > 0 && (
          <span className="text-[10px] tabular-nums text-gray-300">{count}</span>
        )}
      </button>
      {onOpenAll && (
        <button
          type="button"
          onClick={onOpenAll}
          aria-label={`Open all ${label.toLowerCase()}`}
          data-testid={`sidebar-all-${id}`}
          className="rounded p-0.5 text-gray-300 hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-700"
        >
          <ExternalLink className="h-3 w-3" aria-hidden="true" />
        </button>
      )}
      {actions}
    </div>
  )
}

/** "Not in any themes." — a fact, in the same voice everywhere. */
function Empty({ children }: { children: React.ReactNode }) {
  return <p className="px-2 py-1 text-[11px] text-gray-400">{children}</p>
}

/** Caps a long membership list without hiding it. */
function usePreview<T>(rows: readonly T[] | null | undefined) {
  const [open, setOpen] = useState(false)
  const all = rows ?? []
  const capped = !open && all.length > SECTION_PREVIEW
  return {
    shown: capped ? all.slice(0, SECTION_PREVIEW) : all,
    hasMore: all.length > SECTION_PREVIEW,
    open,
    toggle: () => setOpen(o => !o),
    total: all.length,
  }
}

export function AssetWorkSidebar({
  workSlot,
  lists = null, onOpenList, onRemoveFromList, removingListItemId = null,
  addToListSlot, onOpenAllLists,
  themes = null, onOpenTheme, onOpenAllThemes, addToThemeSlot,
  portfolios = null, onOpenPortfolio, onOpenAllPortfolios,
  projectsSlot, addToProjectSlot,
  collapsed, onToggleSection, className,
  hidden = false, onCollapse,
}: AssetWorkSidebarProps) {
  const listPreview = usePreview(lists)
  const themePreview = usePreview(themes)
  const portfolioPreview = usePreview(portfolios)

  /*
    Rendering nothing, rather than the caller rendering nothing.

    The grid holds two children: this and the working surface. If the caller
    dropped this one, the surface would move from the second slot to the
    first, React would see a different element type there and rebuild the
    whole working surface — losing the selected requirement, the open
    editor and any unsent draft. Returning null keeps the element in place
    and puts no node in the DOM, so there is no column and no gutter.
  */
  if (hidden) return null

  return (
    /*
      ── Wide-and-short when it cannot be tall-and-narrow ──────────────────

      Below `xl` the sidebar sits ABOVE the working surface rather than
      beside it, and five stacked sections measured 566px of a 559px
      viewport — the work was pushed entirely off the screen. The
      relationship sections flow into columns there instead, so the sidebar
      is as wide as the page and only a few rows deep. At `xl` it is one
      296px column again.
    */
    <aside
      className={clsx(
        'grid grid-cols-2 items-start gap-x-5 gap-y-3 sm:grid-cols-3 xl:grid-cols-1 xl:gap-x-0',
        className,
      )}
      aria-label="Asset work and relationships"
      data-testid="asset-work-sidebar"
      id={WORK_SIDEBAR_REGION_ID}
    >
      {/* ── The collapse control ────────────────────────────────────────
          A single quiet row, not a toolbar: the sidebar has no header of
          its own and does not need one to carry a 24px button. */}
      {onCollapse && (
        <div className="col-span-full -mb-1 flex justify-end">
          <WorkSidebarToggle direction="collapse" onToggle={onCollapse} />
        </div>
      )}

      {/* ── The work itself ─────────────────────────────────────────── */}
      <div className="col-span-full">{workSlot}</div>

      <div className="col-span-full border-t border-gray-100 dark:border-gray-800" />

      {/* ── Lists ───────────────────────────────────────────────────── */}
      <section id="lists-section-listsContent" data-testid="sidebar-lists" className="scroll-mt-2">
        <SectionHeader
          id="lists"
          label="Lists"
          count={lists?.length}
          collapsed={!!collapsed.listsContent}
          onToggle={() => onToggleSection('listsContent')}
          onOpenAll={onOpenAllLists}
          actions={addToListSlot}
        />
        {!collapsed.listsContent && lists !== null && (
          lists.length === 0 ? (
            <Empty>Not in any lists.</Empty>
          ) : (
            <>
              <ul className="space-y-0.5">
                {listPreview.shown.map(l => {
                  const removing = removingListItemId === l.itemId
                  return (
                    <li key={l.itemId}>
                      <div
                        data-testid={`sidebar-list-${l.listId}`}
                        className={clsx(
                          'group flex items-center gap-1 rounded px-2 py-1 hover:bg-gray-100 dark:hover:bg-gray-800',
                          removing && 'opacity-50',
                        )}
                      >
                        <button
                          type="button"
                          onClick={() => onOpenList?.(l.listId)}
                          disabled={!onOpenList}
                          data-testid={`sidebar-list-open-${l.listId}`}
                          className="min-w-0 flex-1 truncate text-left text-[12px] text-gray-800 hover:text-primary-600 disabled:cursor-default dark:text-gray-200"
                        >
                          {l.name}
                        </button>
                        {l.listType === 'collaborative' && (
                          <Users className="h-3 w-3 shrink-0 text-gray-400" aria-hidden="true" />
                        )}
                        {/* Only where the existing rule permits THIS row. On a
                            collaborative list write access is not permission
                            to remove somebody else's. */}
                        {l.canRemove && onRemoveFromList && (
                          <button
                            type="button"
                            onClick={() => onRemoveFromList(l.itemId)}
                            disabled={removing}
                            aria-label={`Remove from ${l.name}`}
                            data-testid={`sidebar-list-remove-${l.listId}`}
                            className="rounded p-0.5 text-gray-300 opacity-0 hover:bg-gray-200 hover:text-gray-700 focus:opacity-100 group-hover:opacity-100 disabled:cursor-default dark:hover:bg-gray-700"
                          >
                            <X className="h-3 w-3" aria-hidden="true" />
                          </button>
                        )}
                      </div>
                    </li>
                  )
                })}
              </ul>
              {listPreview.hasMore && (
                <button type="button" onClick={listPreview.toggle} data-testid="sidebar-more-lists"
                  className="w-full rounded px-2 py-0.5 text-left text-[11px] text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800">
                  {listPreview.open ? 'Show fewer' : `Show all ${listPreview.total}`}
                </button>
              )}
            </>
          )
        )}
      </section>

      {/* ── Themes ──────────────────────────────────────────────────── */}
      <section id="lists-section-themesContent" data-testid="sidebar-themes" className="scroll-mt-2">
        <SectionHeader
          id="themes"
          label="Themes"
          count={themes?.length}
          collapsed={!!collapsed.themesContent}
          onToggle={() => onToggleSection('themesContent')}
          onOpenAll={onOpenAllThemes}
          actions={addToThemeSlot}
        />
        {!collapsed.themesContent && themes !== null && (
          themes.length === 0 ? (
            <Empty>Not in any themes.</Empty>
          ) : (
            <>
              <ul className="space-y-0.5">
                {themePreview.shown.map(t => (
                  <li key={t.id}>
                    <button
                      type="button"
                      onClick={() => onOpenTheme?.(t)}
                      data-testid={`sidebar-theme-${t.id}`}
                      className="flex w-full items-center gap-1.5 rounded px-2 py-1 text-left hover:bg-gray-100 dark:hover:bg-gray-800"
                    >
                      <span className="min-w-0 flex-1 truncate text-[12px] text-gray-800 dark:text-gray-200">
                        {t.name}
                      </span>
                      {t.themeType && (
                        <span className="shrink-0 rounded-full bg-gray-100 px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wide text-gray-500 dark:bg-gray-700 dark:text-gray-300">
                          {t.themeType}
                        </span>
                      )}
                    </button>
                  </li>
                ))}
              </ul>
              {themePreview.hasMore && (
                <button type="button" onClick={themePreview.toggle} data-testid="sidebar-more-themes"
                  className="w-full rounded px-2 py-0.5 text-left text-[11px] text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800">
                  {themePreview.open ? 'Show fewer' : `Show all ${themePreview.total}`}
                </button>
              )}
            </>
          )
        )}
      </section>

      {/* ── Portfolios ──────────────────────────────────────────────── */}
      <section id="lists-section-portfoliosContent" data-testid="sidebar-portfolios" className="scroll-mt-2">
        {/*
          No action on this header.

          It carried `AddToQueueButton`, labelled "New Trade Idea" — which is
          not a portfolio relationship, and is now the + on In Progress. One
          control, one place.
        */}
        <SectionHeader
          id="portfolios"
          label="Portfolios"
          count={portfolios?.length}
          collapsed={!!collapsed.portfoliosContent}
          onToggle={() => onToggleSection('portfoliosContent')}
          onOpenAll={onOpenAllPortfolios}
        />
        {!collapsed.portfoliosContent && portfolios !== null && (
          portfolios.length === 0 ? (
            <Empty>Not held in any portfolios.</Empty>
          ) : (
            <>
              <ul className="space-y-0.5">
                {portfolioPreview.shown.map(p => (
                  <li key={p.id}>
                    <button
                      type="button"
                      onClick={() => onOpenPortfolio?.(p.id)}
                      title={p.weight ? `Open portfolio · Port Wgt: ${p.weight}%` : 'Open portfolio'}
                      data-testid={`sidebar-portfolio-${p.id}`}
                      className="flex w-full items-center gap-1.5 rounded px-2 py-1 text-left hover:bg-gray-100 dark:hover:bg-gray-800"
                    >
                      <span className="min-w-0 flex-1 truncate text-[12px] text-gray-800 dark:text-gray-200">
                        {p.name}
                      </span>
                      {/* Weight is holdings arithmetic the page already did.
                          It is exposure, not membership, and not a
                          recommendation — so it is a number beside the name
                          and nothing more. */}
                      {p.weight && (
                        <span className="shrink-0 text-[10px] tabular-nums text-gray-400">{p.weight}%</span>
                      )}
                    </button>
                  </li>
                ))}
              </ul>
              {portfolioPreview.hasMore && (
                <button type="button" onClick={portfolioPreview.toggle} data-testid="sidebar-more-portfolios"
                  className="w-full rounded px-2 py-0.5 text-left text-[11px] text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800">
                  {portfolioPreview.open ? 'Show fewer' : `Show all ${portfolioPreview.total}`}
                </button>
              )}
            </>
          )
        )}
      </section>

      {/* ── Projects ────────────────────────────────────────────────── */}
      <section id="lists-section-projectsContent" data-testid="sidebar-projects" className="scroll-mt-2">
        <SectionHeader
          id="projects"
          label="Projects"
          collapsed={!!collapsed.projectsContent}
          onToggle={() => onToggleSection('projectsContent')}
          actions={addToProjectSlot}
        />
        {/* `RelatedProjects` owns its own query, rows and empty state. */}
        {!collapsed.projectsContent && (
          <div className="px-1">{projectsSlot}</div>
        )}
      </section>
    </aside>
  )
}
