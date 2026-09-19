/**
 * The canonical desktop tile grammar: one visual, and verbs only on reach.
 *
 * ── What this replaces ───────────────────────────────────────────────────
 *
 * `DesktopTile` was a real `<button>`, and its header said that was why no
 * footer slot existed: a nested `<button>` is invalid HTML and unreachable by
 * keyboard. Decisions added one anyway -- two `TileAction` buttons inside the
 * shell's own button -- so the only way to review an outcome from that lens
 * was with a mouse. A rule a surface can break by accident is a trap, not a
 * rule.
 *
 * So the shell is now the `role="group"` + portal-click contract that Today
 * and Ideas each arrived at independently, and the verbs live on a shelf of
 * RESERVED height that cross-fades with the object's standing context.
 *
 * What is asserted here is the part a screenshot cannot show: that revealing
 * the actions moves nothing, that they are real focusable buttons, and that
 * no interactive element is nested inside another.
 */
import { render, screen, within } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import {
  DesktopTile, TileVisualSlot, TileAction, TileIdentity, type TileSize,
} from '../DesktopTile'

// JSX children win over a spread `children` prop, so the body is passed
// explicitly rather than hard-coded inside the element.
const tile = (over: Partial<Parameters<typeof DesktopTile>[0]> = {}) => (
  <DesktopTile
    size="hero"
    onOpen={() => {}}
    eyebrow={<span>state</span>}
    {...over}
    children={over.children ?? <TileIdentity symbol="MSFT" name="Microsoft" />}
  />
)

describe('the shell is a group, not a button', () => {
  it('renders no nested interactive element when it carries actions', () => {
    render(tile({ actions: <TileAction label="Review" onClick={() => {}} testId="act" /> }))
    const shell = screen.getByTestId('desktop-tile')
    expect(shell.tagName).toBe('DIV')
    expect(shell).toHaveAttribute('role', 'group')
    // The whole bug: a button inside a button.
    expect(shell.closest('button')).toBeNull()
    expect(within(shell).getByTestId('act').closest('button'))
      .toBe(within(shell).getByTestId('act'))
  })

  it('stays openable by keyboard, which the button gave us free', () => {
    const onOpen = vi.fn()
    render(tile({ onOpen }))
    const shell = screen.getByTestId('desktop-tile')
    expect(shell).toHaveAttribute('tabindex', '0')
    shell.focus()
    expect(shell).toHaveFocus()
  })

  /* A press on a verb is not also a decision to leave the gallery. */
  it('does not open the tile when an action is pressed', () => {
    const onOpen = vi.fn()
    const onAct = vi.fn()
    render(tile({ onOpen, actions: <TileAction label="Review" onClick={onAct} testId="act" /> }))
    screen.getByTestId('act').click()
    expect(onAct).toHaveBeenCalledTimes(1)
    expect(onOpen).not.toHaveBeenCalled()
  })
})

describe('the shelf reveals without moving anything', () => {
  it('reserves its height whether the actions are showing or not', () => {
    render(tile({
      context: <span>Review in Outcomes</span>,
      actions: <TileAction label="Review" onClick={() => {}} testId="act" />,
    }))
    const shelf = screen.getByTestId('tile-shelf')
    // Height is on the rail itself, not on either layer, so the layers can be
    // absolutely positioned and cross-fade in place.
    expect(shelf.className).toMatch(/h-\[\d+px\]/)
    for (const id of ['tile-shelf-context', 'tile-shelf-actions']) {
      expect(screen.getByTestId(id).className).toContain('absolute')
    }
  })

  it('cross-fades: context at rest, actions on hover AND on keyboard focus', () => {
    render(tile({
      context: <span>Review in Outcomes</span>,
      actions: <TileAction label="Review" onClick={() => {}} testId="act" />,
    }))
    const ctx = screen.getByTestId('tile-shelf-context')
    const acts = screen.getByTestId('tile-shelf-actions')

    expect(ctx.className).toContain('opacity-100')
    expect(ctx.className).toContain('group-hover:opacity-0')
    expect(acts.className).toContain('opacity-0')
    expect(acts.className).toContain('group-hover:opacity-100')
    /* Without focus-within the verbs are reachable by Tab and invisible while
       focused, which is worse than not having them. */
    expect(ctx.className).toContain('group-focus-within:opacity-0')
    expect(acts.className).toContain('group-focus-within:opacity-100')
    // Only opacity transitions: nothing that could reflow.
    expect(acts.className).toContain('transition-opacity')
  })

  it('renders no shelf at all for a tile with neither context nor actions', () => {
    render(tile())
    expect(screen.queryByTestId('tile-shelf')).not.toBeInTheDocument()
  })

  it('keeps the resting layer opaque when there are no actions to reveal', () => {
    render(tile({ context: <span>standing context</span> }))
    const ctx = screen.getByTestId('tile-shelf-context')
    expect(ctx.className).not.toContain('group-hover:opacity-0')
  })
})

describe('the visual slot is one reserved region, not a free-height one', () => {
  it.each<[TileSize, string]>([
    ['hero', 'h-16'],
    ['large', 'h-12'],
    ['medium', 'h-9'],
  ])('%s reserves %s', (size, h) => {
    render(tile({ size, children: <TileVisualSlot size={size}><span>viz</span></TileVisualSlot> }))
    const slot = screen.getByTestId('tile-visual-slot')
    expect(slot.className).toContain(h)
    expect(slot).toHaveAttribute('data-size', size)
  })

  /* An axis with no room for a label is decoration. */
  it('draws nothing at compact', () => {
    render(tile({ size: 'compact', children: <TileVisualSlot size="compact"><span>viz</span></TileVisualSlot> }))
    expect(screen.queryByTestId('tile-visual-slot')).not.toBeInTheDocument()
  })

  it('draws nothing when the caller has no object to put in it', () => {
    render(tile({ children: <TileVisualSlot size="hero">{null}</TileVisualSlot> }))
    expect(screen.queryByTestId('tile-visual-slot')).not.toBeInTheDocument()
  })

  /* A scrub across the object is a read, not a decision to leave. */
  it('is exempt from the portal click', () => {
    render(tile({ children: <TileVisualSlot size="hero"><span>viz</span></TileVisualSlot> }))
    expect(screen.getByTestId('tile-visual-slot')).toHaveAttribute('data-no-portal')
  })
})
