/**
 * The chrome a research section and a research field are drawn in.
 *
 * ── Why this is its own file ──────────────────────────────────────────────
 *
 * The Asset page's research body draws every section as a `Card` with an
 * uppercase collapsible header and an alternating shade, and every field
 * inside it as a white tile with a blue left edge and an amber hover. That
 * markup was written inline, once per field TYPE, which is ten copies of the
 * same class list in `AssetTab.tsx` and nowhere a second page could reach.
 *
 * The Theme page is meant to be the same kind of page. The previous pass gave
 * it the same bar and the same read modes and it still did not look like the
 * Asset page below them, because its sections were bare `<h2>`s over a
 * `space-y-2` stack: no card, no header band, no shade, no field tiles, no
 * width grid. The fix is not a second stylesheet for themes -- it is this
 * module, used by both.
 *
 * ── What is deliberately NOT in here ──────────────────────────────────────
 *
 * No data. These take a name, a description and children. Which fields a
 * section holds, whether they are visible, how wide they are and who may edit
 * them are decided by the research hooks and passed in. A presentational
 * component that fetched would be a third place that disagrees about what the
 * layout says.
 */

import type { ReactNode } from 'react'
import { clsx } from 'clsx'
import { ChevronDown, ChevronUp } from 'lucide-react'
import { Card } from '../ui/Card'

/**
 * One field's tile.
 *
 * The blue left edge marks a field of the case; the amber hover is the
 * page's "this is editable" affordance. Exported as a string as well as a
 * component because `AssetTab` applies it to ten differently-shaped render
 * branches, and a shared constant is what stops the eleventh from being
 * drawn slightly differently.
 */
export const RESEARCH_FIELD_CARD_CLASS =
  'border border-gray-200/80 border-l-[3px] border-l-blue-500 bg-white rounded-xl hover:border-amber-200 hover:bg-amber-50/30 hover:shadow-sm transition-all duration-200 p-4 dark:border-gray-700 dark:bg-gray-800'

/**
 * The grid a section's fields sit in.
 *
 * Twelve columns from `xl` up, one column below it: a half-width thesis on a
 * laptop is a newspaper column. `items-start` so a short field beside a long
 * one is its own content's height rather than being stretched to match.
 */
export const RESEARCH_FIELD_GRID_CLASS =
  'grid grid-cols-1 items-start gap-3 border-t border-gray-100 px-5 py-2 xl:grid-cols-12 dark:border-gray-800'

export interface ResearchFieldCardProps {
  /** The org's own label for the field. */
  name: string
  description?: string | null
  /** Anchor id, for the deep links the attention surface builds. */
  id?: string
  children: ReactNode
  className?: string
}

export function ResearchFieldCard({ name, description, id, children, className }: ResearchFieldCardProps) {
  return (
    <div id={id} className={clsx(RESEARCH_FIELD_CARD_CLASS, className)}>
      <h4 className="text-sm font-medium text-gray-700 mb-1 dark:text-gray-300">{name}</h4>
      {description && (
        <p className="text-xs text-gray-500 mb-3 dark:text-gray-400">{description}</p>
      )}
      {children}
    </div>
  )
}

export interface ResearchSectionCardProps {
  name: string
  /**
   * The org's own note on what the section is for.
   *
   * On the header's `title` rather than as a line of its own, because the
   * Asset page's section header is the uppercase name and nothing else, and a
   * second line here would be the one place the two pages' sections differ in
   * height. It is still reachable, and it is still the org's words.
   */
  description?: string | null
  /**
   * Alternating shade, by the section's index in the page.
   *
   * Passed as a boolean rather than computed here: a page that hides some
   * sections for reading and draws them all for arranging has two different
   * indices for the same section, and only the caller knows which it is
   * using.
   */
  shaded?: boolean
  collapsed?: boolean
  onToggle?: () => void
  /**
   * Replaces the whole header band. Arrange mode draws its own, with the
   * drag handle, the rename control and the hide toggle, and it must sit in
   * the same place in the same card as the reading header.
   */
  header?: ReactNode
  /** Wraps the children in the twelve-column field grid. */
  grid?: boolean
  children: ReactNode
  className?: string
}

export function ResearchSectionCard({
  name, description, shaded, collapsed, onToggle, header, grid = true, children, className,
}: ResearchSectionCardProps) {
  return (
    <Card padding="none" className={clsx(shaded && '!bg-gray-50/60', className)}>
      {header ?? (
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={!collapsed}
          title={description || undefined}
          className="w-full px-5 py-3 flex items-center gap-2 bg-gray-50 hover:bg-gray-100 border-b border-gray-200 transition-colors rounded-t-xl dark:bg-gray-800/60 dark:hover:bg-gray-800 dark:border-gray-700"
        >
          <span className="text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">{name}</span>
          {collapsed ? (
            <ChevronDown className="h-5 w-5 text-gray-400" />
          ) : (
            <ChevronUp className="h-5 w-5 text-gray-400" />
          )}
        </button>
      )}
      {!collapsed && (
        grid ? <div className={RESEARCH_FIELD_GRID_CLASS}>{children}</div> : children
      )}
    </Card>
  )
}
