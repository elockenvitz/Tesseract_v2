/**
 * The Up Next rail.
 *
 * A rail is one step away from being the left-rail navigator this product
 * already retired. These tests are the guardrails on that: bounded, in the
 * lens's own order, never the population, and never a replacement for Back.
 */

import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { FocusCanvas, upNextFrom, type UpNextItem } from './UpNext'

const row = (id: string): UpNextItem => ({ id, symbol: id.toUpperCase(), reason: 'Stale' })
const all = ['a', 'b', 'c', 'd', 'e', 'f', 'g'].map(row)
const toItem = (i: UpNextItem) => i

describe('what appears in the rail', () => {
  it('excludes the object being read', () => {
    const next = upNextFrom(all, 'c', toItem)
    expect(next.map(i => i.id)).not.toContain('c')
  })

  it('is bounded — a glance, not a list', () => {
    expect(upNextFrom(all, 'a', toItem)).toHaveLength(4)
    expect(upNextFrom(all, 'a', toItem, 2)).toHaveLength(2)
  })

  it('follows the lens order, and never re-ranks it', () => {
    // Whatever the lens ranked -- or, for Decisions, whatever the chronology
    // says -- is what appears. The rail must not imply a priority the surface
    // itself does not hold.
    expect(upNextFrom(all, 'b', toItem).map(i => i.id)).toEqual(['c', 'd', 'e', 'f'])
  })

  it('wraps to the start rather than running out at the end', () => {
    const next = upNextFrom(all, 'f', toItem)
    expect(next.map(i => i.id)).toEqual(['g', 'a', 'b', 'c'])
  })

  it('shows the head of the list when nothing is selected', () => {
    expect(upNextFrom(all, null, toItem).map(i => i.id)).toEqual(['a', 'b', 'c', 'd'])
  })

  it('has nothing to show for a population of one', () => {
    expect(upNextFrom([row('only')], 'only', toItem)).toHaveLength(0)
  })
})

describe('the rail beside the work', () => {
  it('renders the workspace, and the rail beside it', () => {
    render(
      <FocusCanvas upNext={upNextFrom(all, 'a', toItem)} onOpen={vi.fn()}>
        <div data-testid="workspace" />
      </FocusCanvas>,
    )
    expect(screen.getByTestId('workspace')).toBeInTheDocument()
    expect(screen.getAllByTestId('up-next-item')).toHaveLength(4)
  })

  it('is absent below a wide viewport, not crushed into one', () => {
    // At 1440 the work surface takes the whole width: a 236px column costs the
    // workspace more than the rail gives back. Tailwind's `2xl:block` on a
    // `hidden` aside is the mechanism, so the class is the contract.
    render(
      <FocusCanvas upNext={upNextFrom(all, 'a', toItem)} onOpen={vi.fn()}>
        <div />
      </FocusCanvas>,
    )
    const rail = screen.getByTestId('up-next')
    expect(rail.className).toContain('hidden')
    expect(rail.className).toContain('2xl:block')
  })

  it('renders no rail at all when there is nothing next', () => {
    render(<FocusCanvas upNext={[]} onOpen={vi.fn()}><div /></FocusCanvas>)
    expect(screen.queryByTestId('up-next')).not.toBeInTheDocument()
  })

  it('swaps the focus in place rather than opening anything', async () => {
    const user = userEvent.setup()
    const onOpen = vi.fn()
    const tabs: Event[] = []
    const capture = (e: Event) => tabs.push(e)
    window.addEventListener('decision-engine-action', capture)

    render(
      <FocusCanvas upNext={upNextFrom(all, 'a', toItem)} onOpen={onOpen}>
        <div />
      </FocusCanvas>,
    )
    await user.click(screen.getAllByTestId('up-next-item')[0])
    window.removeEventListener('decision-engine-action', capture)

    expect(onOpen).toHaveBeenCalledWith('b')
    expect(tabs).toHaveLength(0)
  })

  it('is reachable by keyboard, and names itself', async () => {
    const user = userEvent.setup()
    const onOpen = vi.fn()
    render(
      <FocusCanvas upNext={upNextFrom(all, 'a', toItem)} onOpen={onOpen} label="Nearby">
        <button type="button">first</button>
      </FocusCanvas>,
    )
    expect(screen.getByRole('complementary', { name: 'Nearby' })).toBeInTheDocument()

    await user.tab()
    await user.tab()
    await user.keyboard('{Enter}')
    expect(onOpen).toHaveBeenCalledWith('b')
  })
})
