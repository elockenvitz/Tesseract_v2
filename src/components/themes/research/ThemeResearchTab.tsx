import React, { useEffect, useMemo, useState } from 'react'
import { clsx } from 'clsx'
import { useIsMobile } from '../../../hooks/useMediaQuery'
// `Star` marked the reader's own pill among the contributors; "My Research"
// is its own perspective now, so there is nothing to mark. `UserPlus` was
// already unused before this change.
import {
  Settings2, Users, Layers, History as HistoryIcon, Link2, Edit3, Target,
} from 'lucide-react'
import type { ThemeReadMode } from '../../../lib/theme-workspace/modes'
// `Button` went with the outlined "Manage" control, which is now a menu item.
import { ResearchToolbarMenu } from '../../asset/ResearchToolbarMenu'
import { Card } from '../../ui/Card'
/*
 * The Asset page's own research chrome, imported rather than approximated.
 *
 * `ResearchSectionCard` is the section band and the alternating shade;
 * `ArrangeableFieldGrid` / `ArrangeableField` are the twelve-column grid the
 * Asset page lays its fields out in. Both degrade to a plain div with no
 * arrange provider mounted, which is exactly what this page is today, so the
 * theme case gets the Asset page's layout from the Asset page's code and will
 * get Arrange itself the moment a theme can save a span.
 */
import {
  ResearchSectionCard, ArrangeableFieldGrid, ArrangeableField,
  RESEARCH_FIELD_GRID_CLASS,
} from '../../research'
/*
 * The firm's attributed record, shared with the Asset page's Firm
 * perspective. It reads only `id`, `section`, `content`, `created_by`,
 * `is_archived`, `updated_at` and `user` off a contribution, all of which a
 * theme contribution has, so this is one renderer over two tables rather
 * than a theme-shaped copy of it.
 */
import { OurViewSummary, type OurViewField } from '../../asset/OurViewSummary'
import type { Contribution } from '../../../hooks/useContributions'
import {
  ThemeContributionSection,
  type ThemeResearchActiveTab,
} from './ThemeContributionSection'
import { OptionPicker } from '../../ui/OptionPicker'
import { ThemeFieldManagerModal } from './ThemeFieldManagerModal'
import { ThemeThesisSummaryView } from './ThemeThesisSummaryView'
import { ThemeThesisHistoryView } from './ThemeThesisHistoryView'
import { ThemeKeyReferencesSection } from './ThemeKeyReferencesSection'
import {
  useThemeResearchLayout,
  useThemeContributionsV2,
} from '../../../hooks/useThemeResearch'
import { useThemeKeyReferences } from '../../../hooks/useThemeKeyReferences'
import { useAuth } from '../../../hooks/useAuth'

interface ThemeResearchTabProps {
  themeId: string
  themeIsPublic: boolean
  /**
   * Which read mode is open, owned by `ThemeTab`.
   *
   * Lifted out of here because the page has to be able to LAND on one: a note
   * opened from the dashboard, and a tab persisted on the old Notes section,
   * both arrive asking for the notes. Local state could not be told, so both
   * landed on the thesis with the thing they asked for one control away.
   */
  readMode: ThemeReadMode
  onReadModeChange: (next: ThemeReadMode) => void
  /**
   * The theme's notes, rendered under References beneath the links.
   *
   * A slot rather than a component reference because the notes surface
   * already exists in `ThemeTab` and carries its own editor state
   * (`showNoteEditor`, `selectedNoteId`, the dashboard deep link). Passing it
   * in moves where the reader finds it without rebuilding it, and without
   * this pane having to own note state it would then have to keep in sync.
   */
  notesSlot: React.ReactNode
  /**
   * How many notes `notesSlot` holds, for the count in the read-mode row.
   *
   * Passed in rather than counted here for the same reason as the slot: the
   * query lives in `ThemeTab`. Without it the count would say "links" while
   * the surface below showed links AND notes, which is the kind of number
   * that quietly stops matching what it is next to.
   */
  notesCount: number
}

function tabLabel(author: { first_name: string | null; last_name: string | null; email: string | null } | null | undefined, fallback = 'User'): string {
  if (!author) return fallback
  const full = [author.first_name, author.last_name].filter(Boolean).join(' ').trim()
  return full || author.email?.split('@')[0] || fallback
}
function shortName(author: { first_name: string | null; last_name: string | null; email: string | null } | null | undefined, fallback = 'User'): string {
  if (!author) return fallback
  const first = author.first_name
  const last = author.last_name
  if (first && last) return `${first[0]}. ${last}`
  return author.first_name || author.email?.split('@')[0] || fallback
}

export function ThemeResearchTab({
  themeId, themeIsPublic, readMode, onReadModeChange, notesSlot, notesCount,
}: ThemeResearchTabProps) {
  const { user } = useAuth()
  const { layout, isLoading: layoutLoading } = useThemeResearchLayout()
  const { contributions, contributors, isLoading: contribsLoading } = useThemeContributionsV2(themeId)
  const { references } = useThemeKeyReferences(themeId)
  /* References holds two kinds of thing now: the theme's links and the
     theme's notes. The count has to be both, or it describes half of what
     the button opens. */
  const referenceCount = references.length + notesCount
  const [showManager, setShowManager] = useState(false)

  // One control naming the current view, as on the asset case — a row of
  // analyst pills does not survive 390px.
  const isMobileViewport = useIsMobile()
  const [viewFilter, setViewFilter] = useState<ThemeResearchActiveTab>('aggregated')
  /* `viewMode` was local state here with four values, all / summary / history
     / references. It is now the page's `readMode` with three, because
     "Summary" merged into the aggregated perspective the same way the asset
     page's "AI summary" merged into Firm: both answered "what does the desk
     think" from the same contributions, one on each axis. */
  const viewMode = readMode
  const setViewMode = onReadModeChange

  // Analyst pills: contributors + current user if not already there
  const analysts = useMemo(() => {
    const seen = new Set<string>()
    const list: { id: string; name: string; shortName: string; isSelf: boolean }[] = []
    for (const c of contributors) {
      if (seen.has(c.user_id)) continue
      seen.add(c.user_id)
      const isSelf = c.user_id === user?.id
      list.push({
        id: c.user_id,
        name: isSelf ? 'You' : tabLabel(c.author),
        shortName: isSelf ? 'You' : shortName(c.author),
        isSelf,
      })
    }
    if (user?.id && !seen.has(user.id)) {
      list.push({ id: user.id, name: 'You', shortName: 'You', isSelf: true })
    }
    return list
  }, [contributors, user?.id])

  /* Split so the bar can offer "My Research" as its own perspective rather
     than leaving the reader's own case as a name among the contributors. The
     Asset page's bar is built the same way, and the asymmetry is the point:
     one of these is editable and the other four are not. */
  const selfAnalyst = useMemo(() => analysts.find(a => a.isSelf) ?? null, [analysts])
  const otherAnalysts = useMemo(() => analysts.filter(a => !a.isSelf), [analysts])

  // If selected analyst disappears, snap back to aggregated
  useEffect(() => {
    if (viewFilter === 'aggregated') return
    if (!analysts.some(a => a.id === viewFilter)) setViewFilter('aggregated')
  }, [analysts, viewFilter])

  const viewingOther = viewFilter !== 'aggregated' && viewFilter !== user?.id

  /*
   * Which sections are folded shut, by slug.
   *
   * The Asset page keeps the same state and for the same reason: a section
   * header you cannot collapse is a heading, and a research document whose
   * headings are only headings makes the reader scroll past every section to
   * reach the one they want. Per-slug rather than per-id so a reader's
   * collapse survives the template being re-pointed at a renamed section.
   *
   * Not persisted, on either page. It is where you are in a document, not a
   * preference about the document.
   */
  const [collapsedSections, setCollapsedSections] = useState<Record<string, boolean>>({})
  const toggleSection = (slug: string) =>
    setCollapsedSections(prev => ({ ...prev, [slug]: !prev[slug] }))

  /*
   * The template's fields, flattened for the firm's attributed record.
   *
   * A theme contribution's `section` IS the field slug, so each field maps to
   * exactly one key. On the Asset page several template slugs alias one
   * contribution section, which is why `sectionKeys` is a list there; here it
   * is a list of one, and writing it any other way would make this surface
   * the second thing that decides where a theme's prose lives.
   */
  const ourViewFields = useMemo<OurViewField[]>(
    () => layout.flatMap(section =>
      section.fields.map(field => ({
        slug: field.slug,
        label: field.name,
        sectionKeys: [field.slug],
      }))
    ),
    [layout],
  )

  /*
   * Theme contributions in the shape the shared record reads.
   *
   * The only difference is the author: a theme contribution carries `author`,
   * an asset contribution carries `user`. Everything else the record touches
   * is spelled the same on both tables. The cast is narrow and deliberate --
   * this is not an asset contribution and must never be passed anywhere that
   * would write it back as one.
   */
  const firmRecord = useMemo(
    () => contributions.map(c => ({
      ...c,
      user: c.author
        ? { id: c.author.id, first_name: c.author.first_name, last_name: c.author.last_name }
        : undefined,
    })) as unknown as Contribution[],
    [contributions],
  )

  return (
    <div className="space-y-3">
      {/* Filter bar.

          Two controls, both named. The whose-view control was a full-width
          native select on a phone — 16px type in a chrome-drawn box, taller
          than everything beside it and unable to say "Our View" without also
          saying "(All Contributors)". The what-to-show control was four
          unlabelled icons: a stack, a sparkle, a clock and a chain, which is
          not a legible way to offer Summary, Changes and Links. Both are
          pickers now, and the modes carry their names. */}
      {/* ── The bar, as the Asset page draws it ────────────────────────────
          It was a rounded, bordered grey card sitting inside the pane. The
          Asset page's equivalent is a full-width band on the page surface
          with a bottom hairline, which is what makes it read as page chrome
          rather than as the first item of content.

          Full-bleed: the negative margins cancel the scrollport's padding,
          which `ThemeTab` writes per breakpoint. Sticky, so the perspective
          and read-mode controls stay reachable down a long case -- the Asset
          page gets that by keeping the bar outside its scrollport; this one
          is inside the pane that owns it, and `sticky` gets the same result
          without lifting three controls into the page.

          `-top-4`, NOT `top-0`, and that is the whole difference the page
          was still showing. A sticky element's offset is measured from its
          scroll container's PADDING box, and `ThemeTab`'s scrollport is
          `py-4`. With `top-0` the bar was pinned 16px below the nav's
          hairline -- permanently, at scroll position zero as well -- so the
          `-mt-4` beside it was overridden and a grey band sat between the
          active mode tab and the bar. Measured: nav hairline y=298, bar top
          y=314. The Asset page's bar starts flush on its nav's hairline
          (286 and 286) because it is OUTSIDE the scrollport and needs no
          offset at all. `-top-4` cancels that padding, so the bar sits on
          the hairline statically and stays there while the case scrolls.

          `mb-4` rather than `mb-3`: the Asset page leaves 16px between its
          bar and the first thing below it (its scrollport's own `py-4`), and
          the pane's `space-y-3` only contributes 12px. Adjoining margins
          collapse to the larger, so 16 is what this has to say. */}
      <div className="-mx-3 sm:-mx-6 lg:-mx-8 -mt-4 mb-4 px-3 sm:px-6 lg:px-8 py-2 sticky -top-4 z-[5] bg-gray-50 dark:bg-gray-900 border-b border-gray-200 dark:border-gray-700">
        {/* flex-wrap lets the perspective (left) and the read/utility controls
            (right) drop to a second row on narrow widths instead of
            overflowing, which is what the Asset page's bar does. */}
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
          {/* Left: whose research */}
          <div className="flex items-center gap-3 min-w-0 flex-1 sm:flex-none flex-wrap">
            <span className="hidden sm:inline text-xs text-gray-400 uppercase tracking-wide font-medium">View</span>
            {isMobileViewport ? (
              <OptionPicker
                label="Whose view"
                value={viewFilter}
                onChange={setViewFilter}
                className="min-w-0"
                options={[
                  ...(selfAnalyst ? [{ value: selfAnalyst.id, label: 'My Research' }] : []),
                  { value: 'aggregated', label: 'Firm', hint: 'All contributors' },
                  ...otherAnalysts.map(a => ({ value: a.id, label: a.name })),
                ]}
              />
            ) : analysts.length <= 5 ? (
              <div className="flex items-center gap-1 bg-gray-100 rounded-lg p-1 dark:bg-gray-800">
                {/* My Research first, then Firm, then everyone else -- the
                    Asset page's order and the Asset page's two names.

                    "Our View" is gone. It was one label doing two jobs: it
                    had to mean both "the firm's view" and "not yours", and
                    the reader's OWN view had no pill of its own, only a name
                    among the analysts. Two explicit perspectives is what the
                    asset case settled on, and "Firm" is the word the rest of
                    the product uses for this scope -- visibility is
                    team | division | firm, so "Team" or "Our" would name the
                    narrowest while showing the widest. */}
                {selfAnalyst && (
                  <button
                    onClick={() => setViewFilter(selfAnalyst.id)}
                    className={clsx(
                      'px-3 py-1.5 rounded-md text-sm font-medium transition-all flex items-center gap-1.5',
                      viewFilter === selfAnalyst.id
                        ? 'bg-primary-600 text-white shadow-sm'
                        : 'text-gray-600 hover:text-gray-900 dark:hover:text-white dark:text-gray-400'
                    )}
                  >
                    My Research
                  </button>
                )}
                <button
                  onClick={() => setViewFilter('aggregated')}
                  className={clsx(
                    'px-3 py-1.5 rounded-md text-sm font-medium transition-all flex items-center gap-1.5',
                    viewFilter === 'aggregated'
                      ? 'bg-primary-600 text-white shadow-sm'
                      : 'text-gray-600 hover:text-gray-900 dark:hover:text-white dark:text-gray-400'
                  )}
                >
                  <Users className="w-3.5 h-3.5" />
                  Firm
                </button>
                {otherAnalysts.map(a => (
                  <button
                    key={a.id}
                    onClick={() => setViewFilter(a.id)}
                    className={clsx(
                      'px-3 py-1.5 rounded-md text-sm font-medium transition-all flex items-center gap-1.5',
                      viewFilter === a.id
                        ? 'bg-primary-600 text-white shadow-sm'
                        : 'text-gray-600 hover:text-gray-900 dark:hover:text-white dark:text-gray-400'
                    )}
                  >
                    {a.shortName}
                  </button>
                ))}
              </div>
            ) : (
              <select
                value={viewFilter}
                onChange={(e) => setViewFilter(e.target.value)}
                className="w-full sm:w-auto px-3 h-9 rounded-lg text-sm font-medium bg-gray-100 text-gray-700 border-0 focus:ring-2 focus:ring-primary-500 dark:text-gray-300 dark:bg-gray-800"
              >
                {/* The same two names as the pills above; this is the other
                    arm of one control, so they cannot differ. */}
                {selfAnalyst && <option value={selfAnalyst.id}>My Research</option>}
                <option value="aggregated">Firm</option>
                {otherAnalysts.map(a => (
                  <option key={a.id} value={a.id}>{a.name}</option>
                ))}
              </select>
            )}
          </div>

          {/* Right: how to read it, then the overflow */}
          <div className="flex items-center gap-2 min-w-0">
            {isMobileViewport ? (
              <OptionPicker
                label="Show"
                value={viewMode}
                onChange={setViewMode}
                align="right"
                className="min-w-0"
                options={[
                  { value: 'thesis',  label: 'Investment Case' },
                  { value: 'changes', label: 'History' },
                  { value: 'notes',   label: 'Key references', count: referenceCount },
                ]}
              />
            ) : (
              <>
                {/* One divider, not two, and in the same place the Asset page
                    puts it: what is to the left is status about THIS view,
                    what is to the right is how to read it. That is one
                    boundary. */}
                <div className="mx-0.5 h-5 w-px bg-gray-200 dark:bg-gray-700" aria-hidden="true" />
                <div className="flex items-center gap-0.5 bg-gray-100 rounded-lg p-0.5 dark:bg-gray-800">
                  {/* Three, with the Asset page's OWN three words, not
                      near-synonyms of them. They were Thesis / Changes /
                      References, which named the same three things in a
                      different vocabulary, and a reader moving between the
                      two pages had to learn that "Changes" here is "History"
                      there. One nav, one set of names:

                        Investment Case   the case itself
                        History           what changed in it, and when
                        Key references    the material it rests on

                      The persisted keys stay `thesis`/`changes`/`notes`,
                      because they are written into saved tab state
                      (`themeResearchRead`) and into `LEGACY_SECTION_MODE`.
                      Renaming a stored value to tidy a label would strand
                      every reader who left the page on one.

                      Sizing and the label breakpoint are the Asset page's:
                      `px-2 py-1.5 text-sm`, and the words appear from `xl` so
                      a narrow desktop keeps three compact icons with their
                      titles intact rather than wrapping the bar. */}
                  {([
                    { mode: 'thesis',  label: 'Investment Case', Icon: Layers },
                    { mode: 'changes', label: 'History',         Icon: HistoryIcon },
                    { mode: 'notes',   label: 'Key references',  Icon: Link2 },
                  ] as const).map(({ mode, label, Icon }) => (
                    <button
                      key={mode}
                      onClick={() => setViewMode(mode)}
                      title={label}
                      className={clsx(
                        'relative flex items-center gap-1.5 rounded-md px-2 py-1.5 text-sm font-medium transition-colors',
                        viewMode === mode
                          ? 'bg-white shadow-sm text-primary-600 dark:bg-gray-700 dark:text-primary-400'
                          : 'text-gray-500 hover:text-gray-700 dark:hover:text-gray-200 dark:text-gray-400',
                      )}
                    >
                      <Icon className="w-4 h-4" />
                      <span className="hidden xl:inline">{label}</span>
                      {mode === 'notes' && referenceCount > 0 && (
                        /* The Asset page's count: a filled blue pill, not a
                           grey number, so it reads as a quantity of things
                           waiting rather than as part of the label. */
                        <span className="ml-0.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-blue-500 px-1 text-[10px] font-medium text-white">
                          {referenceCount}
                        </span>
                      )}
                    </button>
                  ))}
                </div>
              </>
            )}
            {/*
              The overflow.

              "Manage" was an outlined button on the bar, at the same visual
              weight as the controls that decide how the case is read, for a
              one-shot action nobody uses twice in a sitting. Behind `⋯` it
              costs no permanent width and its label is spelled out instead of
              living in an aria-label.

              It is the Asset page's own `ResearchToolbarMenu`, imported
              rather than reimplemented: focus management, Escape, outside
              click and arrow-key movement are already solved there, and a
              second copy would be a second set of those bugs. Export and
              Arrange layout are absent because the theme case has neither
              yet, and the menu hides an unavailable item rather than
              advertising it disabled.
            */}
            <ResearchToolbarMenu
              className="shrink-0"
              items={[
                {
                  key: 'customize',
                  label: 'Customize fields',
                  icon: Settings2,
                  onSelect: () => setShowManager(true),
                },
              ]}
            />
          </div>
        </div>
      </div>

      {/* Content area */}
      {viewMode === 'changes' ? (
        <ThemeThesisHistoryView themeId={themeId} viewFilter={viewFilter} />
      ) : viewMode === 'notes' ? (
        /* ── References: the links AND the notes, in one place ───────────
           Notes was a seventh tab of the page. It is here rather than beside
           Thesis because a note and a link are the same kind of thing to a
           reader: the material the case rests on, as opposed to the case.

           Links first because they are one-line rows and the notes surface
           below opens a full editor; putting the editor above would push
           the links off the screen whenever a note was open. */
        <div className="space-y-8">
          <ThemeKeyReferencesSection themeId={themeId} />
          {notesSlot}
        </div>
      ) : layoutLoading || contribsLoading ? (
        <div className="space-y-3">
          {[...Array(2)].map((_, i) => <div key={i} className="h-32 bg-gray-100 rounded-lg animate-pulse dark:bg-gray-800" />)}
        </div>
      ) : viewFilter === 'aggregated' ? (
        /* ══ Firm ═════════════════════════════════════════════════════════
           The Asset page's Firm perspective in the same three parts, in the
           same order, and the order is the argument:

             a notice      this is read-only, and here is the way back
             a synthesis   generated, and labelled as generated
             the record    every contributor's own words, attributed

           It was none of those. The theme's Firm view rendered the synthesis
           and then the SAME editable field stack the reader's own view
           renders, with each field's card quietly listing other people's
           prose underneath. So "Firm" and "My Research" were the same screen
           with different contents in the boxes, there was nothing saying the
           firm view is not yours to edit, and the firm's position was a thing
           you assembled yourself by reading down nine cards.

           Nothing is synthesised here that was not synthesised before, and
           nothing is authored. `OurViewSummary` quotes; it never merges two
           analysts into a firm opinion. */
        contributions.length === 0 ? (
          /* Empty, and it says which perspective is empty. "No research yet"
             on a page with a My Research tab reads as "you have not written
             anything", which is a different and possibly false claim. */
          <Card padding="none">
            <div className="flex flex-col items-center justify-center py-16 px-6">
              <div className="relative mb-6">
                <div className="w-20 h-20 rounded-full bg-gradient-to-br from-primary-50 to-primary-100 flex items-center justify-center">
                  <Target className="w-10 h-10 text-primary-400" />
                </div>
                <div className="absolute -bottom-1 -right-1 w-8 h-8 rounded-full bg-white shadow-md flex items-center justify-center border border-gray-100 dark:border-gray-800 dark:bg-gray-800">
                  <Users className="w-4 h-4 text-gray-400" />
                </div>
              </div>
              <h3 className="text-lg font-semibold text-gray-900 mb-2 dark:text-white">No team research yet</h3>
              <p className="text-sm text-gray-500 text-center max-w-sm mb-6 dark:text-gray-400">
                No one has written on this theme yet. Switch to your own view to start documenting the case.
              </p>
              {user?.id && (
                <button
                  onClick={() => setViewFilter(user.id)}
                  className="inline-flex items-center gap-2 px-4 py-2 bg-primary-600 text-white text-sm font-medium rounded-lg hover:bg-primary-700 transition-colors shadow-sm"
                >
                  <Target className="w-4 h-4" />
                  Start Your Research
                </button>
              )}
            </div>
          </Card>
        ) : (
          <div className="space-y-3">
            {user?.id && (
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-gray-200 bg-white px-4 py-3 dark:border-gray-700 dark:bg-gray-800">
                <span className="text-sm text-gray-500 dark:text-gray-400">
                  Read-only firm view: a generated synthesis, and each analyst's own research. Not a firm-authored conclusion.
                </span>
                <button
                  type="button"
                  onClick={() => setViewFilter(user.id)}
                  className="inline-flex items-center gap-2 rounded-lg bg-primary-600 px-3.5 py-2 text-sm font-semibold text-white hover:bg-primary-700"
                >
                  <Edit3 className="h-4 w-4" />
                  Edit my research
                </button>
              </div>
            )}

            {/* ── The synthesis, which used to be its own read mode ──────
                "Summary" was a fourth button in the row above, and it
                answered the same question this perspective does, from the
                same contributions. The asset page merged its equivalent into
                Firm for exactly that reason; this is the same merge. It
                belongs between the notice and the record because it is a
                reading OF the words below it. */}
            <ThemeThesisSummaryView themeId={themeId} viewFilter={viewFilter} />

            {/* ── The record ────────────────────────────────────────────
                Every visible field of the org's own theme template, with
                each contributor's opening claim under it, by name and by
                date. This is the part the theme page had no equivalent of,
                and it is the part that answers "what does the desk think".

                It reports on `ourViewFields`, which is the TEMPLATE, so a
                firm that adds a theme field sees it here. The synthesis
                above reads a fixed handful of sections, so on its own it
                would silently omit everything a firm added. */}
            <OurViewSummary
              contributions={firmRecord}
              fields={ourViewFields}
              currentUserId={user?.id}
              onOpenAnalyst={setViewFilter}
              mode="full"
              className="px-1"
            />
          </div>
        )
      ) : (
        /* ══ One analyst's document: the reader's own, or someone else's ══
           Sections are cards with an uppercase collapsible band and an
           alternating shade, and fields sit in the twelve-column grid, which
           is the Asset page's structure drawn by the Asset page's own
           components. It was an `<h2>` over a flat stack.

           Every theme field is drawn full width (span 12) because no theme
           has a saved span yet: `user_theme_page_layouts.field_config` exists
           as of 20261104150001 but nothing writes it, and there is no
           `save_theme_layout_customization` to write it with. Passing 12
           rather than skipping the grid is the point -- the moment a span can
           be saved, this already honours it, because `ArrangeableField` is
           the same component the Asset page hands its saved spans to. */
        <>
          {layout.map((section, sectionIdx) => {
            const collapsed = !!collapsedSections[section.slug]
            return (
              <ResearchSectionCard
                key={section.id}
                name={section.name}
                description={section.description}
                shaded={sectionIdx % 2 === 1}
                collapsed={collapsed}
                onToggle={() => toggleSection(section.slug)}
                /* The grid comes from `ArrangeableFieldGrid` below, which is
                   also the drop target once arranging exists, so the card
                   must not draw a second one around it. */
                grid={false}
              >
                <ArrangeableFieldGrid
                  sectionId={section.id}
                  sectionSlug={section.slug}
                  fieldIds={section.fields.map(f => f.id)}
                  className={RESEARCH_FIELD_GRID_CLASS}
                >
                  {section.fields.length === 0 ? (
                    <div className="xl:col-span-12 bg-gray-50 border border-dashed border-gray-300 rounded-lg p-6 text-center dark:border-gray-600 dark:bg-gray-900">
                      <p className="text-sm text-gray-500 dark:text-gray-400">
                        No fields in this section yet. Add one from Customize fields.
                      </p>
                    </div>
                  ) : (
                    section.fields.map(field => (
                      <ArrangeableField
                        key={field.id}
                        fieldId={field.id}
                        fieldName={field.name}
                        sectionId={section.id}
                        sectionSlug={section.slug}
                        savedSpan={12}
                        savedVisible
                      >
                        <ThemeContributionSection
                          themeId={themeId}
                          themeIsPublic={themeIsPublic}
                          field={field}
                          activeTab={viewFilter}
                          hideWhenEmpty={viewingOther}
                          onTabChange={setViewFilter}
                        />
                      </ArrangeableField>
                    ))
                  )}
                </ArrangeableFieldGrid>
              </ResearchSectionCard>
            )
          })}
        </>
      )}

      {showManager && (
        <ThemeFieldManagerModal onClose={() => setShowManager(false)} />
      )}
    </div>
  )
}
