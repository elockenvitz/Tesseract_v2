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
    // Height is on the rail itself, not on the layer inside it, so the
    // context can be absolutely positioned and the rail never collapses.
    expect(shelf.className).toMatch(/h-\[\d+px\]/)
    expect(screen.getByTestId('tile-shelf-context').className).toContain('absolute')
    // And the verbs are an overlay on the card, so revealing them adds no
    // height anywhere.
    expect(screen.getByTestId('tile-shelf-actions').className).toContain('absolute')
  })

  /*
   * REWRITTEN, and the reason kept.
   *
   * This asserted a CROSS-FADE: the context and the verbs were two layers in
   * the same bottom rail, one fading out as the other faded in. They are no
   * longer in the same place, so there is nothing to swap.
   *
   * The verbs moved to the top-right corner because that is where Today puts
   * them and Today is the lens people land on. Measured on one screen before
   * the move: Today's action row at (top 1, right 1), Ideas' at (top 375,
   * left 21) on a 418px card -- the same gesture, opposite corners, and the
   * reader has to learn it twice.
   *
   * What survives unchanged is the part that is not about position: the
   * reveal is opacity only, it answers the keyboard, and it keys on
   * `:focus-visible` rather than `:focus-within`.
   */
  it('reveals the verbs on hover AND on keyboard focus, without moving anything', () => {
    render(tile({
      context: <span>Review in Outcomes</span>,
      actions: <TileAction label="Review" onClick={() => {}} testId="act" />,
    }))
    const acts = screen.getByTestId('tile-shelf-actions')

    expect(acts.className).toContain('opacity-0')
    expect(acts.className).toContain('group-hover:opacity-100')
    /*
     * Without a focus reveal the verbs are reachable by Tab and invisible
     * while focused, which is worse than not having them.
     *
     * It must be `:focus-visible` and not `:focus-within`, though: the
     * latter matches a button focused by a MOUSE CLICK, and a clicked button
     * keeps focus until something else takes it -- so clicking any control
     * on a tile pinned that tile's row open with the pointer nowhere near it.
     */
    expect(acts.className).toContain('group-has-[:focus-visible]:opacity-100')
    expect(acts.className).not.toContain('group-focus-within:')
    // Only opacity transitions: nothing that could reflow.
    expect(acts.className).toContain('transition-opacity')
  })

  it('puts them in Today\'s corner, over a scrim', () => {
    render(tile({
      context: <span>Review in Outcomes</span>,
      actions: <TileAction label="Review" onClick={() => {}} testId="act" />,
    }))
    const acts = screen.getByTestId('tile-shelf-actions')
    expect(acts.className).toContain('right-0')
    expect(acts.className).toContain('top-0')
    expect(acts.className).toContain('justify-end')
    /* The scrim is what makes this legal over content: without it a verb
       sits on top of the ticker it is covering. */
    expect(acts.className).toContain('bg-gradient-to-b')
    /* Positioned against the CARD, so the card must establish the frame. */
    expect(screen.getByTestId('desktop-tile').className).toMatch(/(^|\s)relative(\s|$)/)
  })

  it('stops hiding the standing context, which no longer shares the strip', () => {
    render(tile({
      context: <span>Review in Outcomes</span>,
      actions: <TileAction label="Review" onClick={() => {}} testId="act" />,
    }))
    const ctx = screen.getByTestId('tile-shelf-context')
    expect(ctx.className).not.toContain('group-hover:opacity-0')
    expect(ctx.className).not.toContain('group-has-[:focus-visible]:opacity-0')
  })

  it('draws no shelf for a tile that has verbs but nothing standing to say', () => {
    /* The rail existed to reserve height for the swap. With the verbs gone
       from it, a shelf under a tile with no context is an empty 34px band. */
    render(tile({ actions: <TileAction label="Review" onClick={() => {}} testId="act" /> }))
    expect(screen.queryByTestId('tile-shelf')).not.toBeInTheDocument()
    expect(screen.getByTestId('tile-shelf-actions')).toBeInTheDocument()
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
