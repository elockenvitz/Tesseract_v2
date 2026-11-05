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
import { THEME_MODES, THEME_MODE_LABEL } from '../../../lib/theme-workspace/modes'

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

describe('the nav is three modes, declared once', () => {
  it('asks which mode, not which feature', () => {
    expect(THEME_MODES).toEqual(['overview', 'research', 'work'])
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

  it('renders the chart and the membership inside Overview', () => {
    const at = code.indexOf("activeMode === 'overview'")
    expect(at, 'no Overview branch').toBeGreaterThan(-1)

    const branch = code.slice(at, code.indexOf("activeMode === 'work'"))
    expect(branch, 'the chart tab left no band behind').toContain('<ThemeIndexChart')
    expect(branch, 'related assets left no band behind').toContain('relatedAssets')
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
  })
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
    const at = source.indexOf('<OptionPicker')
    expect(source.slice(at, at + 900)).toContain('relatedAssets.length')
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
    /* Three modes, one `<button>` in the source. More than one means somebody
       wrote a mode out by hand again. */
    expect(nav.match(/<button/g) ?? []).toHaveLength(1)
  })

  it('keeps its icons and active underline', () => {
    expect(source).toContain('border-b-2 font-medium text-sm transition-colors')
    expect(source).toContain('border-primary-500 text-primary-600')
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

  it('lists all three once opened', () => {
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
