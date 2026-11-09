/**
 * The Theme Research body reads the RESOLVED layout stack.
 *
 * ── The defect ────────────────────────────────────────────────────────────
 *
 * `ThemeResearchTab` rendered `useThemeResearchLayout()`, which selects
 * `theme_research_sections` and `theme_research_fields` DIRECTLY and
 * consults neither `user_theme_page_layouts` nor
 * `user_theme_layout_selections`. So everything the Customize fields modal
 * wrote about LAYOUT -- template choice, field width, per-theme visibility,
 * field order -- was saved and then ignored.
 *
 * It looked correct because production holds 0 template rows and 0 selection
 * rows, which makes "the raw catalogue" and "resolved with no template and
 * no overrides" the same list. The first saved template would have made them
 * differ, with nothing anywhere reporting it.
 *
 * ── Why these are source assertions ───────────────────────────────────────
 *
 * This component cannot be rendered in a unit test without standing up
 * Supabase, the org context, the audience context and four React Query
 * caches. What is at stake is not a computation -- it is WHICH HOOK the
 * body reads, and whether the two filters the resolver's answer requires are
 * applied. Those are structural, and the structural failure is silent, so
 * they are pinned structurally. The behaviour was verified live and is
 * recorded in the commit.
 *
 * Every assertion below was confirmed to fail with its change reverted.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/* Comments stripped, so prose in the file cannot satisfy an assertion. */
const strip = (s: string) => s
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
  .replace(/^\s*\/\/.*$/gm, '')

const read = (p: string) => strip(readFileSync(join(process.cwd(), p), 'utf8'))

const TAB = read('src/components/themes/research/ThemeResearchTab.tsx')
const ASSET_TAB = read('src/components/tabs/AssetTab.tsx')

describe('the theme body reads the resolved layout stack', () => {
  it('reads it through the subject-aware hook, pointed at this theme', () => {
    expect(TAB).toMatch(/useResearchPagePreferences\(subject\)/)
    expect(TAB).toMatch(/const subject = useMemo\(\(\) => themeSubject\(themeId\), \[themeId\]\)/)
  })

  it('builds the rendered sections from it, not from the raw catalogue', () => {
    /*
     * The raw hook is still called, deliberately, for a field's
     * `placeholder` and a section's `description` -- typed columns on
     * `theme_research_*` with no counterpart on `research_*`. So its
     * presence is not the defect; taking the STRUCTURE from it is. The
     * structure must come from `displayedFieldsBySection`.
     */
    const at = TAB.indexOf('const layout = useMemo(')
    expect(at, 'the layout memo was renamed or removed').toBeGreaterThan(-1)
    const body = TAB.slice(at, TAB.indexOf('}, [', at))
    expect(body).toContain('displayedFieldsBySection')
    expect(body).not.toContain('useThemeResearchLayout')
    /* The two lookups that justify still reading the raw catalogue. */
    expect(body).toMatch(/fieldById\.get\(f\.field_id\)/)
    expect(body).toMatch(/sectionById\.get\(section\.section_id\)\?\.description/)
  })

  it('applies the resolver’s visibility answer, both levels of it', () => {
    /*
     * `displayedFieldsBySection` keeps a hidden field in the list on
     * purpose, so the customizer can offer it as available. A body that
     * does not filter on `is_visible` therefore renders every field a
     * template or an override hides -- the opposite failure, and just as
     * silent.
     */
    const at = TAB.indexOf('const layout = useMemo(')
    const body = TAB.slice(at, TAB.indexOf('}, [', at))
    expect(body).toMatch(/\.filter\(f => f\.is_visible\)/)
    expect(body).toMatch(/!section\.section_is_hidden/)
  })

  it('draws a field at the span the stack resolved, not a hardcoded row', () => {
    expect(TAB).toMatch(/savedSpan=\{field\.span\}/)
    expect(TAB).not.toMatch(/savedSpan=\{12\}/)
  })

  it('drops a field whose catalogue row has not arrived, rather than half of one', () => {
    /* The two queries settle independently, so for a frame one can be
       ahead. A field drawn with no placeholder and no field_type is worse
       than a field drawn a moment later. */
    const at = TAB.indexOf('const layout = useMemo(')
    const body = TAB.slice(at, TAB.indexOf('}, [', at))
    expect(body).toMatch(/if \(!raw\) return null/)
    expect(body).toMatch(/\.filter\(\(f\): f is NonNullable<typeof f> => f !== null\)/)
  })

  it('waits for both queries before drawing, not just the catalogue', () => {
    expect(TAB).toMatch(/catalogueLoading \|\| layoutStackLoading \|\| contribsLoading/)
  })
})

describe('arranging is mounted, and only where it writes what it shows', () => {
  it('wraps the real sections in the provider, as the asset page does', () => {
    expect(TAB).toMatch(/<ResearchArrangeProvider subject=\{subject\} active=\{arranging\}>/)
    expect(TAB).toMatch(/<ResearchArrangeBar\b/)
    /* The same component, not a theme-shaped copy of it. */
    expect(ASSET_TAB).toMatch(/<ResearchArrangeProvider\b/)
  })

  it('names the subject so every scope sentence says “theme”', () => {
    /*
     * The bar states the scope in three places -- the note, the
     * new-section note and the Save button -- and they have to agree.
     * Without the noun they all read "this stock" on a theme page, which
     * is a false promise about where a save lands.
     *
     * Scoped to the BAR's own props. A bare `subjectNoun="theme"` search
     * over the file passed with the prop deleted, because
     * `AssetPageFieldCustomizer` lower down carries the same prop: the
     * gate was reading a different component's correctness as this one's.
     */
    const at = TAB.indexOf('<ResearchArrangeBar')
    expect(at, 'the arrange bar is no longer rendered here').toBeGreaterThan(-1)
    expect(TAB.slice(at, TAB.indexOf('/>', at))).toMatch(/subjectNoun="theme"/)
  })

  it('offers it only on your own research, on the document view', () => {
    /*
     * Arranging writes THIS reader's selection row. Offered while reading
     * someone else's research, or the firm synthesis, it would be a control
     * that silently rearranges a different page than the one on screen.
     */
    const at = TAB.indexOf("key: 'arrange'")
    expect(at, 'the Arrange layout menu item is gone').toBeGreaterThan(-1)
    const item = TAB.slice(at, at + 400)
    expect(item).toMatch(/available: viewMode === 'thesis' && viewFilter === user\?\.id/)
  })

  it('draws the empty sections while arranging, so a field can go back', () => {
    /*
     * `displayedFieldsBySection` drops a section with no visible field,
     * which is right for reading and wrong for arranging: a section you
     * cannot see is a section you cannot drag a field INTO, so moving the
     * last field out of one would make the move permanent.
     */
    const at = TAB.indexOf('const layout = useMemo(')
    const body = TAB.slice(at, TAB.indexOf('}, [', at))
    expect(body).toMatch(/arranging \? sectionsForArranging : displayedFieldsBySection/)
    expect(body).toMatch(/\.filter\(section => arranging \|\| section\.fields\.length > 0\)/)
  })
})
