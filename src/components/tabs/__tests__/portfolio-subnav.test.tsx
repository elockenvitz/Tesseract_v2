/**
 * Nine portfolio sections, on a screen that fits two and a half of them.
 *
 * ── The defect this pins ──────────────────────────────────────────────────
 *
 * The section nav is `overflow-x-auto no-scrollbar`. At 390px roughly two and a
 * half of the nine tabs are visible and nothing says the other six exist,
 * because the scrollbar that would have hinted at them is deliberately hidden.
 *
 * Worse, the active tab is never scrolled into view. `PortfolioTab` restores
 * the last section from `TabStateManager`, so a session that ended on Settings
 * or Universe reopened showing a nav whose highlighted item was off-screen —
 * and the page gave no answer at all to "which section am I in".
 *
 * `OptionPicker` is the answer already used one level down, inside Positions,
 * for the identical problem. Nine tabs is that argument again.
 *
 * ── Why the section list is tested rather than the whole tab ──────────────
 *
 * `PortfolioTab` mounts nine sub-tabs, Supabase, react-query and the holdings
 * stack. The claims here are about the SECTION LIST — that it is complete, that
 * every entry can be reached, and that its counts are computed once — so the
 * list and the counting rule are exercised directly, and the wiring is asserted
 * against the source.
 */

import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { OptionPicker } from '../../ui/OptionPicker'

const source = readFileSync(resolve(__dirname, '../PortfolioTab.tsx'), 'utf8')

afterEach(cleanup)

/** The section list as the component declares it. */
const SECTIONS = [...source.matchAll(/\{ key: '([a-z]+)', label: '([^']+)'/g)]
  .map(m => ({ key: m[1], label: m[2] }))

describe('the section list is what the phone has to fit', () => {
  it('has enough sections that a single row cannot hold them', () => {
    // If this ever drops to three or four, a scrolling row would be fine again
    // and this whole treatment should be revisited rather than kept out of
    // habit.
    expect(SECTIONS.length).toBeGreaterThanOrEqual(8)
  })

  it('names every section exactly once', () => {
    const labels = SECTIONS.map(s => s.label)
    expect(labels).toHaveLength(new Set(labels).size)
  })
})

describe('the phone gets a picker, the desktop keeps its tabs', () => {
  it('renders the picker only on a phone', () => {
    expect(source).toContain('{isMobileViewport ? (')
    const at = source.indexOf('{isMobileViewport ? (')
    const block = source.slice(at, at + 900)

    expect(block).toContain('<OptionPicker')
    expect(block).toContain('label="Portfolio section"')
  })

  it('leaves the desktop nav untouched behind the same branch', () => {
    // The tab row, its icons and its Badge are all still there for wide
    // screens; only which of the two renders is new.
    expect(source).toContain('<nav className="flex gap-4 sm:gap-8 px-3 sm:px-6 overflow-x-auto no-scrollbar" aria-label="Tabs">')
    expect(source).toContain('border-b-2 font-medium text-sm transition-colors')
  })

  it('offers every section to the picker, not a shortened list', () => {
    const at = source.indexOf('<OptionPicker')
    const block = source.slice(at, at + 600)

    // Mapped from the same TABS constant the desktop row walks, so the two
    // cannot come to offer different sections.
    expect(block).toContain('options={TABS.map(')
    expect(block).not.toContain('.slice(')
    expect(block).not.toContain('.filter(')
  })

  it('drives the same state the tab row does', () => {
    const at = source.indexOf('<OptionPicker')
    const block = source.slice(at, at + 600)

    expect(block).toContain('value={activeTab}')
    expect(block).toContain('onChange={setActiveTab}')
  })
})

describe('a section counts the same in both controls', () => {
  it('computes the count in one place', () => {
    expect(source).toContain('const badgeFor = (badgeKey?: string): number | null => {')
  })

  it('is read by the picker and by the tab row', () => {
    expect(source).toContain('count: badgeFor(badgeKey) ?? undefined')
    expect(source).toContain('const badge = badgeFor(badgeKey)')
  })

  it('no longer recomputes the counts inline in the row', () => {
    expect(source).not.toContain("if (badgeKey === 'holdings' && holdings && holdings.length > 0) badge = holdings.length")
  })
})

describe('the picker itself reaches every section with one thumb', () => {
  function view(active = 'overview') {
    cleanup()
    const onChange = vi.fn()
    render(
      <OptionPicker
        label="Portfolio section"
        value={active}
        onChange={onChange}
        options={SECTIONS.map(s => ({ value: s.key, label: s.label }))}
        className="w-full"
      />,
    )
    return { onChange }
  }

  it('names the section you are in without opening anything', () => {
    view('settings')

    expect(screen.getByText('Settings')).toBeTruthy()
  })

  it('shows a restored off-screen section as plainly as the first one', () => {
    // The old row could not: Universe sat past the right edge with no
    // indicator visible at all.
    view('universe')

    expect(screen.getByText('Universe')).toBeTruthy()
  })

  it('lists all nine once opened', () => {
    view()
    fireEvent.click(screen.getByRole('button'))

    for (const s of SECTIONS) {
      expect(screen.getAllByText(s.label).length).toBeGreaterThan(0)
    }
  })

  it('switches section on a single tap', () => {
    const { onChange } = view()
    fireEvent.click(screen.getByRole('button'))

    fireEvent.click(screen.getAllByText('Performance')[0])

    expect(onChange).toHaveBeenCalledWith('performance')
  })
})

describe('the treatment makes no desktop-width or viewport assumption', () => {
  it('adds no fixed pixel width', () => {
    const at = source.indexOf('<OptionPicker')
    expect(source.slice(at, at + 600)).not.toMatch(/w-\[\d{3,}px\]/)
  })

  it('adds no bare vh sizing', () => {
    // `viewport-sizing.test` guards this repo-wide; asserted here too so a
    // change to this file fails in its own suite.
    expect(source).not.toMatch(/\b(?:max-|min-)?h-\[\d+vh\]/)
  })
})
