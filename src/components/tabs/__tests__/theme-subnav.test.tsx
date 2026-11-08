/**
 * The Theme page's nav: three modes, one list, both controls.
 *
 * ── What this suite used to pin, and why it was rewritten ─────────────────
 *
 * It pinned SIX peer sections -- Thesis, Chart, Related Assets, Notes,
 * Discussion, Process -- and the `OptionPicker` that was added because six
 * will not fit a 390px row. Those assertions were correct about the page they
 * described, and the page no longer exists: Theme now has the Asset page's
 * modes (Overview / Research / Work), Chart and Related Assets are bands of
 * Overview, Notes is a read mode of Research, and Discussion is gone.
 *
 * So the section-list assertions are replaced rather than deleted, and the
 * claims that outlived the restructure are kept verbatim in shape: the phone
 * gets the accepted primitive and not a Theme-only one, both controls read ONE
 * list, every entry is reachable with one thumb, and the theme's identity is
 * rendered outside the thing the nav switches.
 *
 * Two claims are new, and they are the ones worth having:
 *
 *   - Nothing is unreachable. Six sections became three modes, so every one
 *     of the six has to be somewhere. The modes table says WHERE a saved tab
 *     lands; this says the surface is actually rendered.
 *   - The desktop row is generated from THEME_MODES. It used to be six
 *     literal <button>s beside a picker that walked a table -- two controls
 *     over one list, free to disagree, which is what the old comment in the
 *     file warned about and then shipped.
 *
 * ── Why the source is read rather than the tab mounted ───────────────────
 *
 * `ThemeTab` mounts Supabase, react-query, a chart, a notes editor and the
 * research pane. The claims here are about the nav's SHAPE, so the shape is
 * asserted against the source and the picker itself is rendered for real.
 */

import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { readFileSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'

import { OptionPicker } from '../../ui/OptionPicker'
import { THEME_MODES, THEME_MODE_LABEL, THEME_READ_MODES } from '../../../lib/theme-workspace/modes'

const source = readFileSync(resolve(__dirname, '../ThemeTab.tsx'), 'utf8')
const portfolio = readFileSync(resolve(__dirname, '../PortfolioTab.tsx'), 'utf8')
const research = readFileSync(
  resolve(__dirname, '../../themes/research/ThemeResearchTab.tsx'), 'utf8',
)

/** The file with its commentary stripped, so prose cannot satisfy an assertion. */
const code = source
  .split('\n').map(l => l.replace(/\/\/.*$/, '')).join('\n')
  .replace(/\/\*[\s\S]*?\*\//g, '')

afterEach(cleanup)

describe('the nav is four modes, declared once', () => {
  it('asks which mode, not which feature', () => {
    expect(THEME_MODES).toEqual(['overview', 'assets', 'research', 'work'])
  })

  it('types the active-mode state from that list', () => {
    // It was `useState<ThemeSection>`, a union repeated inline. Two places to
    // add a mode is how one gets forgotten.
    expect(code).toContain('useState<ThemeMode>(')
  })

  it('no longer declares a six-entry section table', () => {
    /* The defect this replaces: `THEME_SECTIONS` held the list the phone
       picker walked, while the desktop row hand-wrote the same six. */
    expect(code).not.toContain('THEME_SECTIONS')
    expect(code).not.toContain('ThemeSection')
  })
})

describe('every one of the six old sections still has a surface', () => {
  /* The modes table says where a SAVED tab lands. This says the thing it
     lands on is rendered, which is the half a mapping cannot prove. */

  it('renders the chart inside Overview, as one band of a digest', () => {
    const at = code.indexOf("activeMode === 'overview'")
    expect(at, 'no Overview branch').toBeGreaterThan(-1)

    const branch = code.slice(at, code.indexOf("activeMode === 'assets'"))
    expect(branch, 'the chart tab left no band behind').toContain('<ThemeIndexChart')
    expect(branch, 'no held-positions band').toContain('<ThemeHeldPositions')
    expect(branch, 'no notes digest').toContain('<ThemeNotesDigest')
    expect(branch, 'no activity band').toContain('<ThemeActivityFeed')
  })

  it('keeps the roster out of Overview and in its own mode', () => {
    /* The regression this pins: the roster was a band of Overview for one
       commit. It is a working table -- selection, bulk remove, its own Add --
       and under a chart and two digests it was a surface you scrolled past
       everything else to reach. */
    const overview = code.slice(
      code.indexOf("activeMode === 'overview'"),
      code.indexOf("activeMode === 'assets'"),
    )
    expect(overview, 'the roster table is back in Overview').not.toContain('<AssetTableView')
    expect(overview, 'Overview is editing the roster').not.toContain('setShowAddAssetModal')

    const assets = code.slice(
      code.indexOf("activeMode === 'assets'"),
      code.indexOf("activeMode === 'work'"),
    )
    expect(assets, 'the roster has no table').toContain('<AssetTableView')
    expect(assets, 'the roster lost its Add control').toContain('setShowAddAssetModal')
  })

  it('reads the notes digest off the page\'s own query, not a second one', () => {
    /* Two queries for one list is two cache entries free to disagree. The
       digest takes rows; the Research pane's surface takes the same rows. */
    const at = code.indexOf('<ThemeNotesDigest')
    const el = code.slice(at, code.indexOf('/>', at))
    expect(el).toContain('notes={notes}')
  })

  it('counts the roster on the mode that holds it', () => {
    /*
     * The count followed the table. A badge on Overview would number a
     * surface Overview no longer shows. That claim is unchanged.
     *
     * It used to be pinned as the literal `mode === 'assets' && relatedAssets`,
     * which also pinned a DEFECT: the `&& relatedAssets.length > 0` that
     * followed withheld the count until the query landed, so it appeared
     * after paint and widened the picker's trigger. The count is now always
     * sent for Assets (0 while loading) and the slot is reserved, so the
     * markup this asserted no longer exists. Rewritten to the claim rather
     * than the spelling.
     */
    expect(code).toMatch(/mode === 'assets' \?/)
    expect(code).not.toContain("mode === 'overview' && relatedAssets")
    expect(code).not.toMatch(/mode === 'overview' \?.*relatedAssets/)
  })

  it('renders the research pane, and hands it the notes', () => {
    const at = code.indexOf('<ThemeResearchTab')
    expect(at).toBeGreaterThan(-1)

    const el = code.slice(at, code.indexOf('/>', at))
    expect(el).toContain('readMode={researchRead}')
    expect(el).toContain('notesSlot={notesSurface}')
  })

  it('builds the notes surface once, outside the nav', () => {
    /* It was a seventh branch of this nav. Built as a value instead, so the
       editor state and the dashboard deep link stay here while the surface
       renders inside the pane that owns the control revealing it. */
    expect(code).toContain('const notesSurface =')
    expect(code).toContain('<ThemeNoteEditor')
    expect(code).not.toMatch(/activeMode === 'notes'/)
  })

  it('renders the notes beneath the links, not instead of them', () => {
    /* Merging the notes into References must not displace what was already
       there. Both render, links first. */
    const at = research.indexOf("viewMode === 'notes'")
    expect(at).toBeGreaterThan(-1)

    const branch = research.slice(at, at + 1200)
    const links = branch.indexOf('<ThemeKeyReferencesSection')
    const notes = branch.indexOf('{notesSlot}')
    expect(links, 'the links surface was dropped').toBeGreaterThan(-1)
    expect(notes, 'the notes surface is not rendered').toBeGreaterThan(-1)
    expect(links).toBeLessThan(notes)
  })

  it('counts both kinds of thing under References', () => {
    // `references.length` alone would describe half of what the button opens.
    expect(research).toContain('references.length + notesCount')
  })

  it('renders the process panel inside Work', () => {
    const at = code.indexOf("activeMode === 'work'")
    expect(code.slice(at, at + 300)).toContain('<ThemeProcessesPanel')
  })

  it('leaves no trace of Discussion anywhere', () => {
    /* `theme_discussions` held zero posts across all 51 themes, so removing
       it orphaned no content. The panel, the hook and the table are all gone
       now; this asserts the page does not still reach for any of them. */
    expect(code).not.toContain('ThemeDiscussionPanel')
    expect(code).not.toContain('useThemeDiscussion')
    expect(code).not.toMatch(/activeMode === 'discussion'/)
  })

  it('has no file left importing the deleted discussion module', () => {
    /* The panel and hook are deleted, not merely unreferenced by this page.
       A dangling import of either is a build failure the unit suite would not
       necessarily surface, since nothing mounts them. */
    const hits: string[] = []
    const walk = (dir: string) => {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        const p = join(dir, e.name)
        if (e.isDirectory()) { walk(p); continue }
        if (!/\.(ts|tsx)$/.test(e.name)) continue
        // This file names them in order to assert their absence.
        if (e.name === 'theme-subnav.test.tsx') continue
        if (/ThemeDiscussionPanel|useThemeDiscussions/.test(readFileSync(p, 'utf8'))) hits.push(p)
      }
    }
    walk(resolve(__dirname, '../../..'))

    expect(hits, `still referenced by: ${hits.join(', ')}`).toEqual([])
  },
  /* 30s, not the 5s default. This reads every .ts/.tsx under src -- about two
     thousand files -- and inside the full guard it does that while several
     hundred other test files are running, where it overran 5s and failed the
     whole guard with "Test timed out" rather than with a finding. The scan IS
     the test, so the budget moves rather than the scope. */
  30_000)
})

describe('the phone gets the accepted picker, not a new primitive', () => {
  it('renders OptionPicker only at phone width', () => {
    const at = source.indexOf('{isMobileViewport ? (')
    expect(at).toBeGreaterThan(0)

    const block = source.slice(at, at + 1400)
    expect(block).toContain('<OptionPicker')
    expect(block).toContain('label="Theme section"')
  })

  it('offers every mode, not a shortened list', () => {
    const at = source.indexOf('<OptionPicker')
    const block = source.slice(at, at + 700)

    expect(block).toContain('options={THEME_MODES.map(')
    expect(block).not.toContain('.slice(')
    expect(block).not.toContain('.filter(')
  })

  it('drives the same state the tab row does', () => {
    const at = source.indexOf('<OptionPicker')
    const block = source.slice(at, at + 700)

    expect(block).toContain('value={activeMode}')
    expect(block).toContain('onChange={setActiveMode}')
  })

  it('keeps the one count the desktop row shows', () => {
    /* Still the same claim -- the phone picker carries the Assets count
       rather than dropping it. The expression moved from
       `relatedAssets.length` to `relatedAssets?.length ?? 0` so that a count
       still in flight reserves its slot instead of appearing late and
       shoving the label. */
    const at = source.indexOf('<OptionPicker')
    expect(at).toBeGreaterThan(-1)
    expect(source.slice(at, at + 1400)).toMatch(/relatedAssets\?\.length \?\? 0/)
  })

  it('is the same treatment Portfolio uses, not a second implementation', () => {
    for (const file of [source, portfolio]) {
      expect(file).toContain("import { OptionPicker } from '../ui/OptionPicker'")
      expect(file).toContain('{isMobileViewport ? (')
      // Compact and prefixed on both, rather than a full-width control that
      // reads as a large empty dropdown.
      expect(file).toContain('prefix="Section"')
      expect(file).toContain('<div className="flex items-center px-3 py-1.5">')
      expect(file).not.toMatch(/className="w-full"\s*\/>/)
    }
  })
})

describe('the desktop row reads the same list the picker does', () => {
  it('is generated, not hand-written', () => {
    const at = code.indexOf('<nav className=')
    expect(at).toBeGreaterThan(-1)

    const nav = code.slice(at, code.indexOf('</nav>', at))
    expect(nav, 'the desktop row does not walk THEME_MODES').toContain('THEME_MODES.map(')
    /* Four modes, one `<button>` in the source. More than one means somebody
       wrote a mode out by hand again. */
    expect(nav.match(/<button/g) ?? []).toHaveLength(1)
  })

  it('draws the Asset page\'s joined tab, not an underlined word', () => {
    /* This pinned `border-b-2` + `border-primary-500`, which was an UNDERLINE
       nav. It is replaced rather than deleted: the claim it was making (the
       active mode is visibly distinct, and the row keeps its icons) is still
       the right claim, and the markup it named is now the Asset page's --
       a white tab with a top-and-sides border and `-mb-px`, so the active
       mode sits on the header's bottom edge and joins the content under it.

       The exact classes are asserted because "looks like the Asset page" is
       the requirement, and the only way two files look alike is by saying the
       same thing. The matching strings in AssetTab are checked below. */
    const at = code.indexOf('<nav className=')
    const nav = code.slice(at, code.indexOf('</nav>', at))

    expect(nav).toContain('rounded-t-lg')
    expect(nav).toContain('-mb-px')
    expect(nav).toContain('border-t border-l border-r border-gray-200')
    expect(nav, 'the row lost its icons').toContain('<Icon className="h-4 w-4" />')
    expect(nav, 'still an underline nav').not.toContain('border-b-2')
  })

  it('is laid out once, so an arriving count cannot shift it', () => {
    /* The defect: the Assets tab's count pill was rendered only once the
       `relatedAssets` query had resolved AND come back non-empty:

         {mode === 'assets' && relatedAssets && relatedAssets.length > 0 && (
           <span className="... min-w-[18px] ...">{relatedAssets.length}</span>
         )}

       `relatedAssets` is async, so on first paint the pill was absent and the
       Assets tab was narrower by the pill's own box plus the row's
       `space-x-2` gap. When the query landed the tab widened and Research and
       Work were shoved right -- on every load of the page.

       The fix is to let the element keep its box at all times and toggle
       `visibility` instead, so the row is measured once. Asserted on the
       desktop nav only: the phone `OptionPicker` renders its counts inside a
       dropdown that is closed on load, so it has no such shift. */
    const at = code.indexOf('<nav className=')
    const nav = code.slice(at, code.indexOf('</nav>', at))

    expect(
      nav,
      'the count pill is back behind a data guard, so the row reflows when the query resolves'
    ).not.toMatch(/mode === 'assets' && relatedAssets/)

    // An absent element gives up its box; an invisible one keeps it.
    expect(nav, 'the pill is omitted rather than hidden when there is nothing to count')
      .toContain("'invisible'")
    // And it must still show the real number when there is one.
    expect(nav).toMatch(/relatedAssets\?\.length/)
  })

  it('is the Asset page\'s nav markup, not a lookalike', () => {
    /* Two files can only match by saying the same thing, and the way they
       drift is one of them being restyled alone. These are the exact strings
       that make the tab a tab in both. */
    const assetTab = readFileSync(resolve(__dirname, '../AssetTab.tsx'), 'utf8')
    for (const shared of [
      'px-4 py-2 text-sm font-medium rounded-t-lg transition-colors',
      'bg-white border-t border-l border-r border-gray-200 text-primary-600 -mb-px dark:border-gray-700 dark:bg-gray-800',
    ]) {
      expect(assetTab, `AssetTab no longer has: ${shared}`).toContain(shared)
      expect(source, `ThemeTab drifted from: ${shared}`).toContain(shared)
    }
  })

  it('says which mode is current to a screen reader, not only in colour', () => {
    const at = code.indexOf('<nav className=')
    expect(code.slice(at, code.indexOf('</nav>', at))).toContain('aria-current=')
  })
})

describe('the picker reaches every mode with one thumb', () => {
  function view(active: string = 'overview') {
    cleanup()
    const onChange = vi.fn()
    render(
      <OptionPicker
        label="Theme section"
        value={active}
        onChange={onChange}
        options={THEME_MODES.map(m => ({ value: m, label: THEME_MODE_LABEL[m] }))}
        className="w-full"
      />,
    )
    return { onChange }
  }

  it('names the mode you are in without opening anything', () => {
    view('work')
    expect(screen.getByText('Work')).toBeTruthy()
  })

  it('lists every mode once opened', () => {
    view()
    fireEvent.click(screen.getByRole('button'))

    for (const mode of THEME_MODES) {
      expect(screen.getAllByText(THEME_MODE_LABEL[mode]).length).toBeGreaterThan(0)
    }
  })

  it('switches mode on a single tap', () => {
    const { onChange } = view()
    fireEvent.click(screen.getByRole('button'))

    fireEvent.click(screen.getAllByText('Research')[0])

    expect(onChange).toHaveBeenCalledWith('research')
  })
})

describe('the page is the same KIND of page as the Asset page', () => {
  /*
   * The requirement was "look, feel and functionality must match the Asset
   * page", and for a long time it did not, however closely the controls
   * inside it were matched: this was a `space-y-6` stack whose nav and
   * content lived in a bordered `<Card>`, sitting inside Layout's padded
   * document. The Asset page is a full-bleed workspace -- a floating identity
   * band, a sticky header, and ONE scrollport under it.
   *
   * These assert the shell, which is the part a reader sees before any
   * control.
   */
  const assetTab = readFileSync(resolve(__dirname, '../AssetTab.tsx'), 'utf8')

  it('opts into the Asset page\'s visual language instead of copying it', () => {
    /* `ux2-scope` carries the band surface, its hairline and shadow, the ink
       levels and the strip dividers. Importing it means the two workspaces
       cannot drift to two palettes; a hand-copied hex would. */
    expect(source).toContain("import '../asset/asset-ux2.css'")
    expect(source).toContain('ux2-scope')
    expect(assetTab, 'AssetTab stopped using the scope').toContain('ux2-scope')
  })

  it('is a full-bleed workspace, not a card in a padded document', () => {
    expect(code, 'the nav and content are back inside a Card').not.toMatch(/<Card padding="none">/)
    expect(code).toContain('flex flex-col bg-gray-50')
    expect(code, 'no sticky header').toContain('sticky top-0 z-10')
    expect(code, 'no single scrollport').toContain('flex-1 overflow-auto')
  })

  it('cancels Layout\'s padding per breakpoint, not with the Asset page\'s flat pull', () => {
    /* Layout gives a non-full-width tab `px-3 py-4 sm:px-6 sm:py-6 lg:px-8`.
       The Asset page cancels it with a flat `-mx-8 -my-6`, which over-pulls
       by 20px at phone width -- it gets away with that because a separate
       mobile shell takes over there, and this page has none. */
    expect(code).toContain('-mx-3 -my-4 sm:-mx-6 sm:-my-6 lg:-mx-8')
    expect(code, 'the Asset page\'s flat pull would clip the phone').not.toContain('-mx-8 -my-6')
  })

  it('floats the identity band over the content, meeting the tab bar', () => {
    // -mt-4 pulls the band up over the sticky header's pt-4, so there is no
    // white gutter between the band and the tabs. Same trick, same reason.
    expect(code).toContain('ux2-band')
    expect(code).toContain('-mt-4')

    // The Asset page draws its band in AssetWorkspaceHeader, not AssetTab.
    const assetBand = readFileSync(
      resolve(__dirname, '../../asset/AssetWorkspaceHeader.tsx'), 'utf8',
    )
    expect(assetBand, 'AssetWorkspaceHeader stopped doing this').toContain('ux2-band -mx-8 -mt-4')
  })

  it('carries a context strip, collapsible from inside the band', () => {
    expect(code).toContain('<ThemeContextStrip')
    expect(code).toContain('headerCollapsed')
    // Collapsed hides the strip and keeps identity, actions and the tabs.
    expect(code).toContain('{!headerCollapsed && (')
  })

  it('has strip cells that name a fact, never a page', () => {
    /* The Asset strip's own comment records what the other way costs: it used
       to hand over a sub-page, which is how its Research cells landed
       wherever Research was last scrolled to. A cell here returns a mode and
       optionally a read mode; the page resolves it. */
    const strip = readFileSync(resolve(__dirname, '../../themes/ThemeContextStrip.tsx'), 'utf8')
    expect(strip).toContain('onJump: (jump: ThemeStripJump) => void')
    expect(strip, 'a cell is setting page state itself').not.toContain('setActiveMode')
  })

  it('adds no query path of its own for the strip', () => {
    /* Every cell reads a hook some mode of this page already calls, under the
       same key, so one cache entry serves both and the RLS boundary is the
       one those modes already rely on. A fresh query here would be a second
       entry free to disagree with the surface it summarises. */
    const strip = readFileSync(resolve(__dirname, '../../themes/ThemeContextStrip.tsx'), 'utf8')
    expect(strip, 'the strip is querying directly').not.toContain("from('")
    for (const hook of ['useThemeWorkflows', 'useThemeContributionsV2', 'useHoldingsForAssets']) {
      expect(strip, `strip does not read ${hook}`).toContain(hook)
    }
  })
})

describe('the Research bar matches the Asset page\'s', () => {
  const research = readFileSync(
    resolve(__dirname, '../../themes/research/ThemeResearchTab.tsx'), 'utf8',
  )
  /* Commentary stripped for the label checks. A note explaining that "Our
     View" was retired contains the string it retired, so prose would satisfy
     an assertion about what the UI says -- the same trap the suites at the
     top of this file strip for. */
  const researchCode = research
    .split('\n').map(l => l.replace(/\/\/.*$/, '')).join('\n')
    .replace(/\/\*[\s\S]*?\*\//g, '')
  const assetTab = readFileSync(resolve(__dirname, '../AssetTab.tsx'), 'utf8')

  it('is page chrome, not the first item of content', () => {
    /* It was a rounded, bordered grey card inside the pane. The Asset page's
       equivalent is a full-width band on the page surface with a bottom
       hairline, and that is what makes it read as chrome. */
    expect(research, 'the bar is still a card').not.toContain('rounded-lg bg-gray-50 border border-gray-200 px-3 py-2')
    expect(research).toContain('border-b border-gray-200')
    expect(research, 'the bar scrolls away down a long case').toContain('sticky')
  })

  it('starts flush on the nav\'s hairline, not 16px below it', () => {
    /* This is the gap that was still visible after the chrome pass. A sticky
       element's offset is measured from its scroll container's PADDING box,
       and `ThemeTab`'s scrollport is `py-4`, so `sticky top-0` pinned the bar
       16px under the nav -- at scroll position zero too, which made the
       `-mt-4` beside it dead and left a grey band between the active mode tab
       and the bar.

       Measured at 1920 before: nav hairline bottom y=298, bar top y=314.
       After: 298 and 298, which is the Asset page's own relationship (286 and
       286 -- its bar is outside the scrollport and needs no offset).

       Asserted as the offset rather than as a pixel, because a pixel cannot
       be checked without a browser and the offset is the thing that was
       wrong. */
    expect(research, 'the bar is pinned to the scrollport padding again').not.toContain('sticky top-0')
    expect(research).toContain('sticky -top-4')
    expect(research).toContain('-mt-4')

    /* And 16px below it, which is what the Asset page's scrollport `py-4`
       leaves between its bar and the first content. The pane's `space-y-3`
       contributes 12; adjoining margins collapse to the larger, so the bar
       has to carry the 16. */
    expect(research, 'the gap below the bar is back to 12px').not.toContain('-mt-4 mb-3')
    expect(research).toContain('mb-4')
  })

  it('offers the Asset page\'s two perspectives, by its names', () => {
    /* "Our View" was one label doing two jobs -- the firm's view AND not
       yours -- and the reader's own case had no pill, only a name among the
       contributors. "Firm" is also the word the product uses for this scope:
       visibility is team | division | firm, so "Team" or "Our" would name the
       narrowest while showing the widest. */
    expect(researchCode).toContain('My Research')
    expect(researchCode).toContain('Firm')
    expect(researchCode, '"Our View" is back').not.toContain('Our View')

    expect(assetTab, 'AssetTab renamed its perspectives').toContain('My Research')
  })

  it('splits the reader out of the contributor list, as the Asset bar does', () => {
    // One of these is editable and four are not; that asymmetry is the point.
    expect(research).toContain('selfAnalyst')
    expect(research).toContain('otherAnalysts')
  })

  it('separates whose-view from how-to-read with one divider', () => {
    const shared = 'mx-0.5 h-5 w-px bg-gray-200 dark:bg-gray-700'
    expect(research).toContain(shared)
    expect(assetTab, 'AssetTab lost its divider').toContain(shared)
  })

  it('names the three read modes with the Asset page\'s own words', () => {
    /* They were Thesis / Changes / References: the same three things in a
       second vocabulary, so a reader moving between the pages had to learn
       that this page's "Changes" is that page's "History".

       Asserted in BOTH directions, as everything else in this block is, so
       renaming either page alone fails here rather than quietly producing two
       vocabularies again. */
    for (const label of ['Investment Case', 'History', 'Key references']) {
      expect(researchCode, `the theme bar no longer says: ${label}`).toContain(`'${label}'`)
      expect(assetTab, `AssetTab no longer says: ${label}`).toContain(label)
    }
    /* The old names are gone from the markup. Checked against the
       comment-stripped source because the note above the row explains the
       rename and therefore contains all three retired words. */
    for (const retired of ["label: 'Thesis'", "label: 'Changes'", "label: 'References'"]) {
      expect(researchCode, `an old read-mode label is back: ${retired}`).not.toContain(retired)
    }
  })

  it('keeps the persisted read-mode keys, which are not the labels', () => {
    /* `themeResearchRead` and `LEGACY_SECTION_MODE` store these three
       strings. Renaming a stored value to match a label would strand every
       reader who left the page on one, so the keys stay and only the words
       on screen changed. */
    expect(THEME_READ_MODES).toEqual(['thesis', 'changes', 'notes'])
    expect(researchCode).toContain("mode: 'thesis'")
    expect(researchCode).toContain("mode: 'changes'")
    expect(researchCode).toContain("mode: 'notes'")
  })

  it('shows read-mode labels from xl, keeping icons below it', () => {
    // A narrow desktop keeps three compact icons with titles intact rather
    // than wrapping the bar. Same breakpoint as the Asset page.
    expect(research).toContain('hidden xl:inline')
    expect(research).toContain('title={label}')
    expect(assetTab).toContain('hidden xl:inline')
  })

  it('puts the one-shot action behind the Asset page\'s own overflow menu', () => {
    /* "Manage" was an outlined button at the same weight as the controls that
       decide how the case is read. The menu is imported, not reimplemented:
       focus management, Escape, outside click and arrow keys are solved
       there, and a copy would be a second set of those bugs. */
    expect(research).toContain("import { ResearchToolbarMenu } from '../../asset/ResearchToolbarMenu'")
    expect(research).toContain('<ResearchToolbarMenu')
    expect(research).toContain("label: 'Customize fields'")
    expect(research, 'the outlined Manage button is back').not.toMatch(/aria-label="Manage fields"/)
  })
})

describe('the Research body matches the Asset page\'s', () => {
  /* Comment-stripped, including JSX comments: this file's prose quotes the
     Asset page's class names and its read-mode labels, and a suite that let
     commentary satisfy it would pass with the body reverted. */
  const researchCode = research
    .split('\n').map(l => l.replace(/\/\/.*$/, '')).join('\n')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
  const assetTab = readFileSync(resolve(__dirname, '../AssetTab.tsx'), 'utf8')

  it('draws a section as the Asset page\'s card, not as a bare heading', () => {
    /* It was `<h2 class="text-sm font-semibold">` over a `space-y-2` stack:
       no card, no header band, no shade, so the bar above it matched and
       everything below it did not. */
    expect(researchCode).toContain('<ResearchSectionCard')
    expect(researchCode).toContain('shaded={sectionIdx % 2 === 1}')
    expect(researchCode, 'the flat heading stack is back')
      .not.toMatch(/<h2 className="text-sm font-semibold/)
  })

  it('lays fields out in the Asset page\'s own twelve-column grid', () => {
    /* The same two components the Asset page uses, not a theme-shaped copy:
       they fall back to a plain div with no arrange provider mounted, which
       is what this page is today, and they already honour a saved span for
       the day a theme can save one. */
    expect(researchCode).toContain('<ArrangeableFieldGrid')
    expect(researchCode).toContain('<ArrangeableField')
    expect(researchCode).toContain('className={RESEARCH_FIELD_GRID_CLASS}')
    expect(assetTab, 'the Asset page stopped using the grid these share')
      .toContain('<ArrangeableFieldGrid')
  })

  it('still folds a section shut, as the Asset page does', () => {
    expect(researchCode).toContain('collapsedSections')
    expect(researchCode).toContain('onToggle={() => toggleSection(section.slug)}')
  })

  it('gives Firm the Asset page\'s three parts, in the Asset page\'s order', () => {
    /* Notice, then synthesis, then the record. The order is the argument:
       the generated reading sits between the caveat and the words it is a
       reading OF, so it cannot be mistaken for either. */
    const notice = researchCode.indexOf('Read-only firm view')
    const synthesis = researchCode.indexOf('<ThemeThesisSummaryView')
    const record = researchCode.indexOf('<OurViewSummary')
    expect(notice, 'nothing says the Firm view is not yours to edit').toBeGreaterThan(-1)
    expect(synthesis).toBeGreaterThan(notice)
    expect(record, 'the attributed record is missing or above the synthesis')
      .toBeGreaterThan(synthesis)
    expect(researchCode).toContain('Edit my research')
  })

  it('uses the Asset page\'s attributed record rather than a theme copy of it', () => {
    expect(researchCode).toContain("from '../../asset/OurViewSummary'")
    expect(assetTab).toContain('<OurViewSummary')
  })

  it('reports on the template, so a firm-added field is not silently omitted', () => {
    /* The synthesis reads a fixed handful of sections. The record reads the
       org's own theme template, which is the only one of the two that can
       show a field the firm added. */
    expect(researchCode).toContain('fields={ourViewFields}')
    expect(researchCode).toMatch(/ourViewFields[\s\S]{0,400}layout\.flatMap/)
  })

  it('says WHICH perspective is empty, not that nothing is written', () => {
    expect(researchCode).toContain('No team research yet')
    expect(researchCode, 'the Firm empty state offers no way in')
      .toContain('Start Your Research')
  })
})

describe('the identity band separates what the theme is from how it is doing', () => {
  it('puts the description beside the name, not on a row of its own', () => {
    expect(code.indexOf('flex items-baseline gap-3 flex-wrap'))
      .toBeGreaterThan(-1)
    expect(code, 'the name row is centred again, so the description cannot sit on its baseline')
      .not.toContain('flex items-center gap-3 mb-1 flex-wrap')
  })

  it('puts the type and lifecycle pills on the right, with the actions', () => {
    const actions = code.indexOf('flex items-center gap-2 shrink-0')
    expect(actions).toBeGreaterThan(-1)
    expect(code.indexOf('currentThemeType.dotColor'), 'the type badge is back beside the name')
      .toBeGreaterThan(actions)
    expect(code.indexOf('currentLifecycle.dotClass'), 'the lifecycle pill is back beside the name')
      .toBeGreaterThan(actions)
    expect(code.indexOf('setShowShareModal(true)')).toBeGreaterThan(actions)
  })

  it('opens the lifecycle menu leftwards, now that the pill sits at the right edge', () => {
    expect(code).toMatch(/absolute right-0 top-full mt-1 w-44/)
    expect(code, 'a menu anchored left from the right edge hangs off the page')
      .not.toMatch(/absolute left-0 top-full mt-1 w-44/)
  })
})

describe('theme identity survives the change', () => {
  it('leaves the header outside the mode container', () => {
    // The name and its disclosure are rendered before the Card that holds the
    // nav, so switching mode cannot take the theme's name with it.
    expect(source.indexOf('isMobileViewport ? setShowThemeMeta'))
      .toBeLessThan(source.indexOf('label="Theme section"'))
  })
})

describe('no viewport or width regressions', () => {
  it('adds no bare vh sizing', () => {
    expect(source).not.toMatch(/\b(?:max-|min-)?h-\[\d+vh\]/)
  })

  it('assumes no desktop width', () => {
    const wide = [...source.matchAll(/w-\[(\d+)px\]/g)].filter(m => Number(m[1]) >= 300)
    expect(wide.map(m => m[0])).toEqual([])
  })
})

describe('the context strip is measured once', () => {
  const strip = readFileSync(
    resolve(__dirname, '../../themes/ThemeContextStrip.tsx'),
    'utf8',
  )

  it('reserves the Held cell\'s second line instead of growing into it', () => {
    /* The defect, measured live on a cold theme open: the mode nav sat at
       y=253, rose to 237, and dropped back to 253 at +1607ms. The band
       around it went 137 -> 121 -> 137. The 16px was the Held cell's
       "top X%" sub-line, which was rendered inside the holdings branch:

         ) : (
           <>
             <div className={VALUE}>{held.names.length} of {assetIds.length}</div>
             <div className={SUB}>top {...}%</div>
           </>
         )

       It is the only cell in the strip with a second line, so it sets the
       strip's height. `useHoldingsForAssets` is async and depends on
       `assetIds`, which is itself async, so the line arrived two queries
       deep -- long after the nav had been painted and pointed at.

       SUB is `text-[11px] leading-tight mt-0.5`: 14px of line plus 2px of
       margin, which is exactly the 16px that was measured. */
    const at = strip.indexOf('label="Held"')
    expect(at, 'the Held cell is gone; this gate no longer watches anything')
      .toBeGreaterThan(-1)
    const cell = strip.slice(at, strip.indexOf('label="Case"', at))

    // An absent element gives up its box; an invisible one keeps it.
    expect(cell, 'the sub-line is omitted rather than hidden when nothing is held')
      .toContain('invisible')
    /* And it must sit OUTSIDE the ternary, so no branch can drop it. A
       branch of a ternary renders ONE element, so the only way to put a
       second line inside one is to wrap both in a fragment -- which is
       exactly what the defective version did. No fragment in this cell means
       every branch is one line and the sub-line is a sibling of all of
       them. */
    expect(cell, 'a fragment is back in a branch, so that branch owns a line the others lack')
      .not.toContain('<>')
    // It still shows the real figure when there is one.
    expect(cell).toMatch(/topWeightPct\.toFixed\(1\)/)
  })

  it('has no other cell that can gain a line after paint', () => {
    /* Every other cell renders exactly one line in every branch. If a second
       SUB appears in the strip, it must be reserved the same way or the
       header starts shifting again. */
    const subs = [...strip.matchAll(/className=\{clsx\(SUB|className=\{SUB\}/g)]
    expect(subs.length, 'a new sub-line was added; reserve its box too').toBe(1)
  })
})
