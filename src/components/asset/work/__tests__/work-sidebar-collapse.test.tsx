/**
 * Hiding the Work sidebar.
 *
 * Two rules are worth pinning, and both were deliberate choices rather
 * than incidental behaviour:
 *
 * 1. The sidebar renders nothing when hidden — the CALLER keeps rendering
 *    it. If the caller dropped the element instead, the working surface
 *    would move from the grid's second slot to its first, React would see a
 *    different element type at that position, and the whole surface would
 *    be rebuilt: selected requirement gone, open editor closed, unsent
 *    draft discarded. That is the failure this shape exists to avoid.
 *
 * 2. Focus crosses the toggle. Collapsing removes the button that was just
 *    pressed, and a browser left alone drops focus to `body`.
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { AssetWorkSidebar, type AssetWorkSidebarProps } from '../AssetWorkSidebar'
import {
  WorkSidebarToggle,
  WORK_SIDEBAR_COLLAPSE_ID,
  WORK_SIDEBAR_EXPAND_ID,
  WORK_SIDEBAR_REGION_ID,
} from '../WorkSidebarToggle'

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8')
const strip = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/^\s*\/\/.*$/gm, '')
const TAB = strip(read('src/components/tabs/AssetTab.tsx'))

const sidebar = (over: Partial<AssetWorkSidebarProps> = {}) =>
  render(
    <AssetWorkSidebar
      workSlot={<div data-testid="work-slot">work</div>}
      collapsed={{}}
      onToggleSection={vi.fn()}
      {...over}
    />,
  )

describe('the control', () => {
  it('names what it will do, in both directions', () => {
    const { unmount } = render(<WorkSidebarToggle direction="collapse" onToggle={vi.fn()} />)
    expect(screen.getByRole('button', { name: 'Collapse Work sidebar' })).toHaveAttribute('title', 'Collapse Work sidebar')
    unmount()
    render(<WorkSidebarToggle direction="expand" onToggle={vi.fn()} />)
    expect(screen.getByRole('button', { name: 'Expand Work sidebar' })).toBeInTheDocument()
  })

  it('reports the sidebar state it governs', () => {
    const { unmount } = render(<WorkSidebarToggle direction="collapse" onToggle={vi.fn()} />)
    const collapse = screen.getByTestId('work-sidebar-collapse')
    expect(collapse).toHaveAttribute('aria-expanded', 'true')
    expect(collapse).toHaveAttribute('aria-controls', WORK_SIDEBAR_REGION_ID)
    expect(collapse).toHaveAttribute('id', WORK_SIDEBAR_COLLAPSE_ID)
    unmount()
    render(<WorkSidebarToggle direction="expand" onToggle={vi.fn()} />)
    const expand = screen.getByTestId('work-sidebar-expand')
    expect(expand).toHaveAttribute('aria-expanded', 'false')
    expect(expand).toHaveAttribute('id', WORK_SIDEBAR_EXPAND_ID)
  })

  it('toggles once per click', async () => {
    const onToggle = vi.fn()
    render(<WorkSidebarToggle direction="collapse" onToggle={onToggle} />)
    const user = userEvent.setup()
    await user.click(screen.getByTestId('work-sidebar-collapse'))
    await user.click(screen.getByTestId('work-sidebar-collapse'))
    expect(onToggle).toHaveBeenCalledTimes(2)
  })

  it('is reachable and operable from the keyboard', async () => {
    const onToggle = vi.fn()
    render(<WorkSidebarToggle direction="collapse" onToggle={onToggle} />)
    const user = userEvent.setup()
    await user.tab()
    expect(screen.getByTestId('work-sidebar-collapse')).toHaveFocus()
    await user.keyboard('{Enter}')
    expect(onToggle).toHaveBeenCalled()
  })

  it('hands focus to its counterpart rather than dropping it', async () => {
    // The counterpart stands in for the one the real layout renders.
    const onToggle = vi.fn()
    render(
      <>
        <WorkSidebarToggle direction="collapse" onToggle={onToggle} />
        <button id={WORK_SIDEBAR_EXPAND_ID}>expand</button>
      </>,
    )
    const user = userEvent.setup()
    await user.click(screen.getByTestId('work-sidebar-collapse'))
    await vi.waitFor(() => expect(document.getElementById(WORK_SIDEBAR_EXPAND_ID)).toHaveFocus())
  })
})

describe('the sidebar when hidden', () => {
  it('renders nothing at all — no node, so no column and no gutter', () => {
    const { container } = sidebar({ hidden: true, onCollapse: vi.fn() })
    expect(container).toBeEmptyDOMElement()
    expect(screen.queryByTestId('asset-work-sidebar')).not.toBeInTheDocument()
    expect(screen.queryByTestId('work-slot')).not.toBeInTheDocument()
  })

  it('renders its content and the collapse control when shown', () => {
    sidebar({ onCollapse: vi.fn() })
    expect(screen.getByTestId('asset-work-sidebar')).toBeInTheDocument()
    expect(screen.getByTestId('work-slot')).toBeInTheDocument()
    expect(screen.getByTestId('work-sidebar-collapse')).toBeInTheDocument()
  })

  it('carries the region id the control points at', () => {
    sidebar({ onCollapse: vi.fn() })
    expect(screen.getByTestId('asset-work-sidebar')).toHaveAttribute('id', WORK_SIDEBAR_REGION_ID)
  })

  it('omits the control when no handler is given, so nothing dangles', () => {
    sidebar()
    expect(screen.queryByTestId('work-sidebar-collapse')).not.toBeInTheDocument()
  })

  it('reports the collapse through the handler and writes nothing itself', async () => {
    const onCollapse = vi.fn()
    sidebar({ onCollapse })
    const user = userEvent.setup()
    await user.click(screen.getByTestId('work-sidebar-collapse'))
    expect(onCollapse).toHaveBeenCalledTimes(1)
    // Visibility is the caller's state. The sidebar does not hide itself,
    // or the preference could not outlive the component.
    expect(screen.getByTestId('asset-work-sidebar')).toBeInTheDocument()
  })
})

describe('the layout and the preference, pinned against AssetTab', () => {
  it('drops the sidebar track when collapsed instead of emptying it', () => {
    expect(TAB).toMatch(/workSidebarCollapsed\s*\?\s*'grid grid-cols-1 items-start gap-5'\s*:\s*'grid grid-cols-1 items-start gap-5 xl:grid-cols-\[296px_minmax\(0,1fr\)\]'/)
  })

  it('keeps both grid children in their slots across the toggle', () => {
    // Without the keys, removing the sidebar shifts the surface into slot
    // one and React rebuilds it.
    expect(TAB).toMatch(/key="work-sidebar"/)
    expect(TAB).toMatch(/key="work-surface"/)
    expect(TAB).toMatch(/hidden=\{workSidebarCollapsed\}/)
  })

  it('offers the way back only while the sidebar is away', () => {
    expect(TAB).toMatch(/\{workSidebarCollapsed && \([\s\S]{0,200}direction="expand"/)
  })

  it('remembers the preference per viewer, not per asset or per process', () => {
    expect(TAB).toMatch(/tesseract:work-sidebar-collapsed:\$\{user\?\.id \?\? 'anon'\}/)
    // localStorage, so it survives a reload, an asset change and a mode
    // change. The tab state would not: it is per-asset and per-session.
    expect(TAB).toMatch(/localStorage\.setItem\(workSidebarPrefKey/)
    expect(TAB).not.toMatch(/work-sidebar-collapsed[^\n]*asset\.id/)
  })

  it('never lets a blocked store take the page down', () => {
    const at = TAB.indexOf('workSidebarPrefKey')
    const body = TAB.slice(at, at + 700)
    expect((body.match(/catch/g) ?? []).length).toBeGreaterThanOrEqual(2)
  })
})
