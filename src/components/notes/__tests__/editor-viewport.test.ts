/**
 * The writing area is sized against the viewport the phone can actually see.
 *
 * ── The defect this pins ──────────────────────────────────────────────────
 *
 * `UniversalNoteEditor` gave its editable region a minimum height of
 * `calc(100vh - 300px)`, inside a `flex-1 overflow-y-auto` pane.
 *
 * Two things go wrong on a phone, and they compound. `100vh` includes the strip
 * behind the URL bar, so the minimum is already taller than the screen. Then
 * the keyboard opens: the visible area roughly halves and `100vh` does not move
 * at all. The pane ends up holding a writing surface about twice the height of
 * what can be seen, nearly all of it empty, so the caret scrolls out of view
 * and the reader drags through blank space looking for their own text.
 *
 * ── Why this file computes rather than renders ────────────────────────────
 *
 * Mounting the editor means mounting TipTap, Supabase, react-query and four
 * search callbacks. The claim here is arithmetic — which number the minimum is
 * derived from — so the sizing rule is reproduced and the source asserted to
 * match it. `viewport-sizing.test` is what stops a bare `vh` coming back
 * anywhere, including as a prop.
 */

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const editor = readFileSync(resolve(__dirname, '../UniversalNoteEditor.tsx'), 'utf8')

/** The rule the component applies, verbatim. */
const minHeightFor = (isMobile: boolean, viewportHeight: number) =>
  isMobile ? `${Math.max(160, viewportHeight - 190)}px` : 'calc(100dvh - 300px)'

/** `visualViewport.height` on the phones in the test matrix. */
const PHONES: [string, number][] = [
  ['390x844', 844],
  ['360x700', 700],
  ['320 wide, short', 568],
]
/** The same phones with a keyboard open, which takes roughly 40% of the screen. */
const WITH_KEYBOARD: [string, number][] = PHONES.map(([n, h]) => [n, Math.round(h * 0.6)])

describe('the minimum never exceeds what the reader can see', () => {
  it.each(PHONES)('fits inside %s', (_name, height) => {
    const min = parseInt(minHeightFor(true, height), 10)

    expect(min).toBeLessThan(height)
  })

  it.each(WITH_KEYBOARD)('fits inside %s with the keyboard open', (_name, height) => {
    const min = parseInt(minHeightFor(true, height), 10)

    // This is the case the old rule failed hardest: `100vh - 300px` against a
    // 390x844 phone is 544px of minimum inside about 506px of visible area.
    expect(min).toBeLessThan(height)
  })

  it('shrinks as the keyboard takes the screen, which a vh value cannot', () => {
    const open = parseInt(minHeightFor(true, 506), 10)
    const closed = parseInt(minHeightFor(true, 844), 10)

    expect(open).toBeLessThan(closed)
  })

  it('still leaves a usable surface on the shortest screen', () => {
    // A floor, so the editable region never collapses to a sliver on a very
    // short viewport or before `visualViewport` has reported anything.
    expect(parseInt(minHeightFor(true, 0), 10)).toBe(160)
    expect(parseInt(minHeightFor(true, 200), 10)).toBe(160)
  })
})

describe('desktop is untouched', () => {
  it('keeps a calc string rather than a measured pixel height', () => {
    expect(minHeightFor(false, 844)).toContain('calc(')
    expect(minHeightFor(false, 844)).toContain('300px')
  })

  it('does not vary with the viewport, as it never did', () => {
    expect(minHeightFor(false, 700)).toBe(minHeightFor(false, 1400))
  })
})

describe('the shipped editor applies this rule', () => {
  it('derives the mobile minimum from the visual viewport', () => {
    expect(editor).toContain('const viewportHeight = useViewportHeight()')
    expect(editor).toContain('`${Math.max(160, viewportHeight - 190)}px`')
  })

  it('passes the derived value rather than a literal', () => {
    expect(editor).toContain('minHeight={editorMinHeight}')
    expect(editor).not.toContain('minHeight="calc(100vh - 300px)"')
  })

  it('reads the viewport that tracks the URL bar and the keyboard', () => {
    // `useViewportHeight` listens to visualViewport resize and scroll. An
    // innerHeight reading would miss the keyboard entirely.
    expect(editor).toContain("import { useIsMobile, useViewportHeight } from '../../hooks/useMediaQuery'")
  })
})

describe('the save row cannot be squeezed out', () => {
  it('is held at its natural height beneath the scrolling editor', () => {
    // It sits outside the scroll area already, but without this it can still
    // give way to a tall editor or an open keyboard — and it carries Save.
    const at = editor.indexOf('border-t border-gray-200 bg-white')
    const row = editor.slice(editor.lastIndexOf('<div', at), at)

    expect(row).toContain('flex-shrink-0')
  })
})
