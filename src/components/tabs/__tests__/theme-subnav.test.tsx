/**
 * The Portfolio nav defect, one surface over.
 *
 * ── The defect this pins ──────────────────────────────────────────────────
 *
 * Theme's section nav is the same `overflow-x-auto no-scrollbar` row Portfolio
 * had: at 390px most of the six sections sit off the right edge, the scrollbar
 * that would have hinted at them is deliberately hidden, and nothing scrolls
 * the active tab into view. `ThemeTab` restores `activeTab` from
 * `TabStateManager`, so a session that ended on Discussion or Process reopened
 * showing a nav whose highlighted item was off-screen.
 *
 * The treatment is the accepted one rather than a second Theme-only primitive:
 * `OptionPicker` on a phone, the tab row untouched on desktop. These assertions
 * are deliberately the same shape as `portfolio-subnav.test`, because the claim
 * is that the two surfaces now behave alike.
 *
 * ── Why the section list is tested rather than the whole tab ──────────────
 *
 * `ThemeTab` mounts six sections, Supabase, react-query, a chart and a
 * discussion panel. The claims here are about the SECTION LIST — that it is
 * complete, that every entry is reachable, that both controls read one source —
 * so the list is exercised directly and the wiring asserted against the source.
 */

import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { OptionPicker } from '../../ui/OptionPicker'

const source = readFileSync(resolve(__dirname, '../ThemeTab.tsx'), 'utf8')
const portfolio = readFileSync(resolve(__dirname, '../PortfolioTab.tsx'), 'utf8')

afterEach(cleanup)

/** The section list as the component declares it. */
const SECTIONS = [...source.matchAll(/\{ key: '([a-z-]+)', label: '([^']+)' \}/g)]
  .map(m => ({ key: m[1], label: m[2] }))

describe('the section list is complete and single-sourced', () => {
  it('declares every section the nav used to hand-write', () => {
    expect(SECTIONS.map(s => s.key)).toEqual([
      'thesis', 'chart', 'related-assets', 'notes', 'discussion', 'processes',
    ])
  })

  it('has more sections than a phone row can hold', () => {
    expect(SECTIONS.length).toBeGreaterThanOrEqual(5)
  })

  it('names each one exactly once', () => {
    const labels = SECTIONS.map(s => s.label)
    expect(labels).toHaveLength(new Set(labels).size)
  })

  it('types the active-section state from that same list', () => {
    // It was a repeated inline union. Two places to add a section is how one
    // gets forgotten.
    expect(source).toContain('useState<ThemeSection>(() => {')
  })
})

describe('the phone gets the accepted picker, not a new primitive', () => {
  it('renders OptionPicker only at phone width', () => {
    const at = source.indexOf('{isMobileViewport ? (')
    expect(at).toBeGreaterThan(0)

    const block = source.slice(at, at + 1000)
    expect(block).toContain('<OptionPicker')
    expect(block).toContain('label="Theme section"')
  })

  it('offers every section, not a shortened list', () => {
    const at = source.indexOf('<OptionPicker')
    const block = source.slice(at, at + 700)

    expect(block).toContain('options={THEME_SECTIONS.map(')
    expect(block).not.toContain('.slice(')
    expect(block).not.toContain('.filter(')
  })

  it('drives the same state the tab row does', () => {
    const at = source.indexOf('<OptionPicker')
    const block = source.slice(at, at + 700)

    expect(block).toContain('value={activeTab}')
    expect(block).toContain('onChange={setActiveTab}')
  })

  it('keeps the one count the desktop row shows', () => {
    const at = source.indexOf('<OptionPicker')
    expect(source.slice(at, at + 700)).toContain('relatedAssets.length')
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

describe('the desktop nav is untouched', () => {
  it('keeps the tab row behind the same branch', () => {
    expect(source).toContain('<nav className="flex gap-4 sm:gap-8 px-3 sm:px-6 overflow-x-auto no-scrollbar" aria-label="Tabs">')
  })

  it('keeps its icons and active underline', () => {
    expect(source).toContain('border-b-2 font-medium text-sm transition-colors')
    expect(source).toContain('border-primary-500 text-primary-600')
  })
})

describe('the picker reaches every section with one thumb', () => {
  function view(active = 'thesis') {
    cleanup()
    const onChange = vi.fn()
    render(
      <OptionPicker
        label="Theme section"
        value={active}
        onChange={onChange}
        options={SECTIONS.map(s => ({ value: s.key, label: s.label }))}
        className="w-full"
      />,
    )
    return { onChange }
  }

  it('names the section you are in without opening anything', () => {
    view('discussion')
    expect(screen.getByText('Discussion')).toBeTruthy()
  })

  it('names a restored section that used to sit off the right edge', () => {
    view('processes')
    expect(screen.getByText('Process')).toBeTruthy()
  })

  it('lists all six once opened', () => {
    view()
    fireEvent.click(screen.getByRole('button'))

    for (const s of SECTIONS) {
      expect(screen.getAllByText(s.label).length).toBeGreaterThan(0)
    }
  })

  it('switches section on a single tap', () => {
    const { onChange } = view()
    fireEvent.click(screen.getByRole('button'))

    fireEvent.click(screen.getAllByText('Related Assets')[0])

    expect(onChange).toHaveBeenCalledWith('related-assets')
  })
})

describe('theme identity survives the change', () => {
  it('leaves the header outside the section container', () => {
    // The name and its disclosure are rendered before the Card that holds the
    // nav, so switching section cannot take the theme's name with it.
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
