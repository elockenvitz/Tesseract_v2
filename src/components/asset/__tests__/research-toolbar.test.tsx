/**
 * Lane A — the Research toolbar.
 *
 * Two kinds of assertion, deliberately separated:
 *
 *   · the overflow menu is RENDERED and driven, because a menu that cannot be
 *     opened with a keyboard is a capability removed from anyone not using a
 *     mouse, and moving Customize and Export behind it is exactly the change
 *     that could do that;
 *   · the toolbar's wiring is pinned against source, because AssetTab needs a
 *     live Supabase client, auth and organization context to mount.
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { Download, Settings2 } from 'lucide-react'
import { ResearchToolbarMenu } from '../ResearchToolbarMenu'

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8')
const TAB = read('src/components/tabs/AssetTab.tsx')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '')

const setup = (over: Partial<React.ComponentProps<typeof ResearchToolbarMenu>> = {}) => {
  const customize = vi.fn()
  const exportCase = vi.fn()
  render(
    <ResearchToolbarMenu
      items={[
        { key: 'customize', label: 'Customize layout', icon: Settings2, onSelect: customize },
        { key: 'export', label: 'Export investment case', icon: Download, onSelect: exportCase },
      ]}
      {...over}
    />
  )
  return { customize, exportCase }
}

describe('the overflow menu keeps its actions reachable', () => {
  it('hides them until asked, so the bar carries one control instead of two', async () => {
    setup()
    expect(screen.queryByTestId('research-more-menu')).not.toBeInTheDocument()
    expect(screen.getByTestId('research-more-trigger')).toBeInTheDocument()
  })

  it('spells the actions out, rather than leaving them as icons with tooltips', async () => {
    const user = userEvent.setup()
    setup()
    await user.click(screen.getByTestId('research-more-trigger'))
    expect(screen.getByText('Customize layout')).toBeInTheDocument()
    expect(screen.getByText('Export investment case')).toBeInTheDocument()
  })

  it('runs the action and closes', async () => {
    const user = userEvent.setup()
    const { exportCase } = setup()
    await user.click(screen.getByTestId('research-more-trigger'))
    await user.click(screen.getByTestId('research-more-export'))
    expect(exportCase).toHaveBeenCalledTimes(1)
    expect(screen.queryByTestId('research-more-menu')).not.toBeInTheDocument()
  })

  it('omits an unavailable action instead of showing it disabled', async () => {
    const user = userEvent.setup()
    setup({
      items: [
        { key: 'customize', label: 'Customize layout', icon: Settings2, onSelect: vi.fn(), available: false },
        { key: 'export', label: 'Export investment case', icon: Download, onSelect: vi.fn() },
      ],
    })
    await user.click(screen.getByTestId('research-more-trigger'))
    expect(screen.queryByTestId('research-more-customize')).not.toBeInTheDocument()
    expect(screen.getByTestId('research-more-export')).toBeInTheDocument()
  })

  it('renders nothing at all when no action is available', () => {
    setup({ items: [{ key: 'customize', label: 'x', icon: Settings2, onSelect: vi.fn(), available: false }] })
    expect(screen.queryByTestId('research-more-trigger')).not.toBeInTheDocument()
  })
})

describe('keyboard', () => {
  it('focuses the first item on open', async () => {
    const user = userEvent.setup()
    setup()
    await user.click(screen.getByTestId('research-more-trigger'))
    expect(screen.getByTestId('research-more-customize')).toHaveFocus()
  })

  it('moves between items with the arrow keys and wraps', async () => {
    const user = userEvent.setup()
    setup()
    await user.click(screen.getByTestId('research-more-trigger'))
    await user.keyboard('{ArrowDown}')
    expect(screen.getByTestId('research-more-export')).toHaveFocus()
    await user.keyboard('{ArrowDown}')
    expect(screen.getByTestId('research-more-customize')).toHaveFocus()
    await user.keyboard('{ArrowUp}')
    expect(screen.getByTestId('research-more-export')).toHaveFocus()
  })

  it('Escape closes and returns focus to the trigger', async () => {
    const user = userEvent.setup()
    const { exportCase } = setup()
    await user.click(screen.getByTestId('research-more-trigger'))
    await user.keyboard('{Escape}')
    expect(screen.queryByTestId('research-more-menu')).not.toBeInTheDocument()
    expect(screen.getByTestId('research-more-trigger')).toHaveFocus()
    expect(exportCase).not.toHaveBeenCalled()
  })

  it('is announced as a menu', async () => {
    const user = userEvent.setup()
    setup()
    const trigger = screen.getByTestId('research-more-trigger')
    expect(trigger).toHaveAttribute('aria-haspopup', 'menu')
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
    await user.click(trigger)
    expect(trigger).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('menu', { name: 'More research actions' })).toBeInTheDocument()
    expect(screen.getAllByRole('menuitem')).toHaveLength(2)
  })
})

describe('the toolbar wiring', () => {
  it('renames the first view mode to Investment Case', () => {
    expect(TAB).toMatch(/<span className="hidden xl:inline">Investment Case<\/span>/)
    expect(TAB).toMatch(/title="Investment Case"/)
    expect(TAB).not.toMatch(/All sections/)
  })

  it('keeps all four view modes as visible, differentiated controls', () => {
    // The modes are the primary navigation on this bar; collapsing them into a
    // dropdown would be a reduction in discoverability, not in clutter.
    for (const mode of ['all', 'summary', 'history', 'references']) {
      expect(TAB).toMatch(new RegExp(`goToThesisMode\\('${mode}'\\)`))
    }
    expect(TAB).toMatch(/thesisViewMode === 'all'/)
  })

  it('moves the layout and export actions off the bar and into the menu', () => {
    /*
     * The labels moved, the rule did not.
     *
     * This asserted `label: 'Customize layout'`, which no longer exists: the
     * one entry became two once arranging a layout stopped being the same act
     * as choosing which fields appear — "Customize fields" picks the fields,
     * "Arrange layout" positions them. Pinning the old string made the test
     * fail for a rename while saying nothing about the behaviour it guards,
     * which is that none of these are bare icon buttons on the bar.
     *
     * Asserted by key as well as label, so the next rename fails on the label
     * line alone instead of on whether the action exists at all.
     */
    expect(TAB).toMatch(/<ResearchToolbarMenu/)
    for (const key of ['customize', 'layout', 'export']) {
      expect(TAB).toMatch(new RegExp(`key: '${key}'`))
    }
    expect(TAB).toMatch(/label: 'Customize fields'/)
    expect(TAB).toMatch(/label: 'Arrange layout'/)
    expect(TAB).toMatch(/label: 'Export investment case'/)
    // The old bare icon buttons are gone.
    expect(TAB).not.toMatch(/title="Customize asset page layout"/)
    expect(TAB).not.toMatch(/title="Export investment case as PDF"/)
  })

  it('offers Customize only in the reader\'s own view', () => {
    const at = TAB.indexOf("key: 'customize'")
    expect(TAB.slice(at, at + 260)).toMatch(/available: researchViewFilter === user\?\.id/)
  })

  it('keeps the audience picker and its staged-until-save behaviour', () => {
    expect(TAB).toMatch(/<AudiencePicker/)
    expect(TAB).toMatch(/onApply=\{handleAudienceApply\}/)
    const PICKER = read('src/components/contributions/AudiencePicker.tsx')
    expect(PICKER).toMatch(/Applies to your research when you save the section\./)
  })

  /** The toolbar itself, not the imports or the hook definitions that share
   *  these identifiers earlier in a 4,000-line file. */
  const BAR = TAB.slice(TAB.indexOf('<AudiencePicker'), TAB.indexOf('<ResearchToolbarMenu'))

  it('keeps view-checks on the research bar, beside the audience they qualify', () => {
    expect(TAB).toMatch(/<ViewWarningIndicator warnings=\{viewWarnings\} \/>/)
    // Inside the bar, the audience comes first and its warning sits next to it.
    expect(BAR).toMatch(/<ViewWarningIndicator/)
  })

  it('puts the read modes after the contextual status, not before it', () => {
    expect(BAR.indexOf('ViewWarningIndicator')).toBeLessThan(BAR.indexOf("goToThesisMode('all')"))
  })

  it('persists the view mode across assets, unchanged by this lane', () => {
    // Sub-page and mode continuity is approved behaviour and must survive.
    expect(TAB).toMatch(/thesisViewMode,/)
    expect(TAB).toMatch(/savedState\?\.thesisViewMode \|\| 'all'/)
  })

  it('leaves exactly one divider in the bar, where two used to sit', () => {
    // One boundary: contextual status about this view, then how to read it.
    const dividers = BAR.match(/h-5 w-px bg-gray-200/g) ?? []
    expect(dividers).toHaveLength(1)
  })
})
