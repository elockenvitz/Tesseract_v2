/**
 * The mode is derived, and the two layouts differ where it matters.
 *
 * The assertions that earn their place are the ones about the phone and about
 * the reading measure: a sheet that reported `research` would render an inline
 * conversation sidebar into 390px, and a research column with no ceiling is
 * 200-character lines on a wide monitor, which is worse than the rail it
 * replaced.
 */
import { describe, it, expect } from 'vitest'
import { chatModeFor, chatLayout, modeToggleLabel } from '../chat-modes'

describe('chatModeFor', () => {
  it('is compact on the rail and research when the pane is full width', () => {
    expect(chatModeFor({ isFullscreen: false })).toBe('compact')
    expect(chatModeFor({ isFullscreen: true })).toBe('research')
  })

  it('stays compact on a phone however the rail state reads', () => {
    /* The sheet is already edge to edge and has no room for the inline
       conversation list, which research mode renders. */
    expect(chatModeFor({ isFullscreen: true, isMobile: true })).toBe('compact')
    expect(chatModeFor({ isFullscreen: false, isMobile: true })).toBe('compact')
  })

  it('treats absent inputs as the rail', () => {
    expect(chatModeFor({})).toBe('compact')
    expect(chatModeFor({ isFullscreen: null, isMobile: null })).toBe('compact')
  })
})

describe('chatLayout', () => {
  it('gives research a bounded, centred reading column', () => {
    const research = chatLayout('research')
    expect(research.column).toContain('max-w-3xl')
    expect(research.column).toContain('mx-auto')
  })

  it('does not try to centre anything in the compact rail', () => {
    expect(chatLayout('compact').column).toBe('w-full')
  })

  it('lets a research reply use the whole column, and keeps the rail inset', () => {
    /* A six-column weight table inside `max-w-[85%]` scrolls while 15% of a
       1600px pane sits empty beside it. */
    expect(chatLayout('research').assistantBubble).toContain('max-w-none')
    expect(chatLayout('compact').assistantBubble).toBe('max-w-[85%]')
  })

  it('keeps the reader own turn inset in both modes, so the two never blur', () => {
    expect(chatLayout('compact').userBubble).toContain('max-w')
    expect(chatLayout('research').userBubble).toContain('max-w')
    expect(chatLayout('research').userBubble).not.toContain('max-w-none')
  })

  it('opens the evidence rail only where there is room to read it', () => {
    expect(chatLayout('research').evidenceOpen).toBe(true)
    expect(chatLayout('compact').evidenceOpen).toBe(false)
  })

  it('shows the inline conversation list only in research mode', () => {
    expect(chatLayout('research').showInlineSidebar).toBe(true)
    expect(chatLayout('compact').showInlineSidebar).toBe(false)
  })

  it('fits two prompt columns only where two fit', () => {
    expect(chatLayout('research').promptColumns).toBe(2)
    expect(chatLayout('compact').promptColumns).toBe(1)
  })
})

describe('modeToggleLabel', () => {
  it('names what the control does next, not what the window does', () => {
    expect(modeToggleLabel('compact')).toBe('Expand to research mode')
    expect(modeToggleLabel('research')).toBe('Back to compact view')
  })
})
