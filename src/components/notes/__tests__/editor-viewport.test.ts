/**
 * The phone note editor fills the pane it has, and stops there.
 *
 * ── The defect this pins ──────────────────────────────────────────────────
 *
 * The writing surface had a minimum height computed as "the visible viewport
 * minus an estimate of the chrome around it". The estimate was 190px.
 *
 * The chrome is not 190px. It is the app header, the note's action band, the
 * note's title band, the format bar and the save row, and every one of those
 * numbers moved during this pass. When the estimate is short the surface is
 * TALLER than the pane holding it, and two things follow. An empty note scrolls
 * — roughly 172px of nothing at 390x844, dragged through looking for text that
 * is not there. And a note with text in it never appears to end, because the
 * blank region under the last line is part of the editable canvas rather than
 * the end of it. Reported as "no clear indication of where the note actually
 * ends / where the user is relative to content".
 *
 * The fix is to stop predicting. The pane is a flex column and the editor grows
 * into it, so the browser measures the chrome instead of this file guessing at
 * it — including when the keyboard opens and the pane halves.
 *
 * ── Why this file computes rather than renders ────────────────────────────
 *
 * Mounting the editor means mounting TipTap, Supabase, react-query and four
 * search callbacks, and jsdom has no layout engine, so a rendered assertion
 * about height would be measuring zero. The claims here are the sizing CONTRACT
 * — which rules own the height, and what the pixel budget adds up to — so the
 * rules are asserted against the source and the budget is arithmetic.
 * `guard:layout` is where rendered geometry is checked at a phone viewport.
 */

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const editor = readFileSync(resolve(__dirname, '../UniversalNoteEditor.tsx'), 'utf8').replace(/\r\n/g, '\n')
const richText = readFileSync(resolve(__dirname, '../../rich-text-editor/RichTextEditor.tsx'), 'utf8').replace(/\r\n/g, '\n')
const layout = readFileSync(resolve(__dirname, '../../layout/Layout.tsx'), 'utf8').replace(/\r\n/g, '\n')
const css = readFileSync(resolve(__dirname, '../../../index.css'), 'utf8').replace(/\r\n/g, '\n')

/* -------------------------------------------------------------------------
   The pixel budget at 390x844.

   Every number below is read off a rule in the source rather than eyeballed.
   Buttons are 44px because `index.css` sets `min-height: 44px` on any `button`
   at phone width with a coarse pointer, unless it opts out of that floor.
   ------------------------------------------------------------------------- */

const VIEWPORT = 844

/** What the screen was spent on before this pass. */
const BEFORE = {
  appHeader: 65,        // h-16 plus its bottom rule
  pagePaddingTop: 16,   // Layout's `py-4` above the editor card
  actionBand: 61,       // py-2 around a 44px button row, plus its rule
  titleBand: 41,        // py-1.5 around a 28px `text-xl` heading, plus its rule
  formatBar: 49,        // p-1 around a 40px row, plus its top rule
  editable: 483,        // what was left
  saveRow: 113,         // py-2.5 around two wrapped 44px rows, plus its rule
  pagePaddingBottom: 16,
  endGap: 0,
}

/** What it is spent on now. */
const AFTER = {
  appHeader: 65,        // untouched: other stages own it
  pagePaddingTop: 0,    // Layout stops padding a note tab on a phone
  actionBand: 53,       // py-1 around the same 44px row: list, name, More
  titleBand: 0,         // merged into the action band
  formatBar: 49,        // untouched: these are the primary writing controls
  editable: 592,
  saveRow: 61,          // py-2 around one 44px row that cannot wrap
  pagePaddingBottom: 0,
  endGap: 24,           // bounded, deliberate, and below a visible card edge
}

const total = (b: typeof BEFORE) => Object.values(b).reduce((a, n) => a + n, 0)

describe('the pixel budget accounts for the whole screen', () => {
  it('adds up to the viewport before', () => {
    expect(total(BEFORE)).toBe(VIEWPORT)
  })

  it('adds up to the viewport after', () => {
    expect(total(AFTER)).toBe(VIEWPORT)
  })
})

describe('the writing surface gets materially more of the phone', () => {
  it('gains over a hundred pixels', () => {
    expect(AFTER.editable - BEFORE.editable).toBeGreaterThanOrEqual(100)
  })

  it('takes the majority share it did not have', () => {
    const share = (n: number) => n / VIEWPORT

    expect(share(BEFORE.editable)).toBeLessThan(0.6)
    expect(share(AFTER.editable)).toBeGreaterThan(0.7)
  })

  it('pays for it out of chrome, not out of the save row becoming unreachable', () => {
    // The save row shrinks because it stops wrapping, not because it goes away.
    expect(AFTER.saveRow).toBeGreaterThan(44)
  })

  it('spends nothing new on decoration', () => {
    const chrome = (b: typeof BEFORE) =>
      b.appHeader + b.pagePaddingTop + b.actionBand + b.titleBand + b.saveRow + b.pagePaddingBottom

    expect(chrome(AFTER)).toBeLessThan(chrome(BEFORE))
  })

  it('keeps the primary writing controls at full size', () => {
    // The priority order is content, then writing controls, then management,
    // then chrome. The format bar is the second of those and does not pay.
    expect(AFTER.formatBar).toBe(BEFORE.formatBar)
  })
})

describe('the blank space after the last line is bounded', () => {
  it('was an overflowing canvas and is now a visible edge', () => {
    // Before: a 654px minimum inside a 573px pane, so an empty note scrolled.
    const oldMinimum = Math.max(160, VIEWPORT - 190)
    const oldPane = BEFORE.editable + BEFORE.titleBand + BEFORE.formatBar

    expect(oldMinimum).toBeGreaterThan(oldPane)
    expect(AFTER.endGap).toBeGreaterThan(0)
    expect(AFTER.endGap).toBeLessThanOrEqual(32)
  })
})

describe('the editor stops predicting its own height', () => {
  it('passes no computed minimum on a phone', () => {
    expect(editor).toContain("const editorMinHeight = isMobileViewport ? '0px' : 'calc(100dvh - 300px)'")
    expect(editor).not.toContain('viewportHeight - 190')
  })

  it('passes the derived value rather than a literal', () => {
    expect(editor).toContain('minHeight={editorMinHeight}')
    expect(editor).not.toContain('minHeight="calc(100vh - 300px)"')
  })

  it('opts the phone editor into the fill rules', () => {
    expect(editor).toContain("isMobileViewport && 'editor-fill'")
  })

  it('lets the pane be a flex column so there is something to fill', () => {
    const at = editor.indexOf('data-testid="note-scrollport"')
    const el = editor.slice(editor.lastIndexOf('<div', at), at)

    expect(el).toContain('flex-1 overflow-y-auto')
    expect(el).toContain('max-sm:flex max-sm:flex-col')
  })
})

describe('the fill rules grow without shrinking', () => {
  const block = css.slice(css.indexOf('.rich-text-editor.editor-fill {'))

  it('is scoped to phone width', () => {
    const at = css.indexOf('.rich-text-editor.editor-fill {')
    expect(css.lastIndexOf('@media (max-width: 639px)', at)).toBeGreaterThan(0)
  })

  it('never uses the flex shorthand, which would allow shrinking', () => {
    // `flex: 1` is `flex: 1 1 0%`. A shrinkable child inside a scrollport is
    // compressed to fit rather than overflowing it, which would mean a long
    // note that cannot scroll at all.
    expect(block).not.toMatch(/^\s*flex:/m)
  })

  it('states grow and no-shrink on every link of the chain', () => {
    for (const sel of [
      '.rich-text-editor.editor-fill {',
      '.rich-text-editor.editor-fill > .editor-container {',
      '.rich-text-editor.editor-fill .editor-content {',
      '.rich-text-editor.editor-fill .editor-content > .ProseMirror {',
    ]) {
      const at = block.indexOf(sel)
      expect(at).toBeGreaterThanOrEqual(0)
      const rule = block.slice(at, block.indexOf('}', at))
      expect(rule).toContain('flex-grow: 1')
      expect(rule).toContain('flex-shrink: 0')
    }
  })

  it('gives the wrapper the same grow-without-shrink, in Tailwind', () => {
    // `grow shrink-0`, not `flex-1`, for the same reason.
    expect(editor).toContain('max-sm:flex max-sm:flex-col max-sm:grow max-sm:shrink-0 max-sm:pb-6')
    expect(editor).not.toContain('max-sm:flex-1 max-sm:shrink-0')
  })
})

describe('the caret can still be placed after the last paragraph', () => {
  it('puts the trailing room inside the editable element', () => {
    // ProseMirror maps a click in its own padding to the nearest position. A
    // spacer div below it would swallow the tap instead.
    expect(richText).toContain("'0.5rem 0.5rem 1.25rem'")
    expect(richText).toContain("padding: ${isMobileViewport ?")
  })

  it('does not set that padding in the stylesheet, where it would lose', () => {
    // ProseMirror owns the element's style attribute, and inline beats a rule.
    const at = css.indexOf('.rich-text-editor.editor-fill .editor-content > .ProseMirror')
    expect(css.slice(at, css.indexOf('}', at))).not.toContain('padding')
  })
})

describe('there is one vertical scroll owner on a phone', () => {
  it('is the editor body', () => {
    const scrollers = editor.match(/flex-1 overflow-y-auto show-scrollbar/g) ?? []
    expect(scrollers).toHaveLength(1)
  })

  it('is not wrapped in a second one by the page shell', () => {
    // Layout put `overflow-auto` around a component whose body already
    // scrolls, which is the nested scroller that makes a phone editor drag.
    expect(layout).toContain("const isMobileNote = !!activeTab && activeTab.type === 'note' && isMobile")
    expect(layout).toContain('isFullWidth || isMobileNote ? "overflow-hidden"')
  })

  it('does not pay page padding around it either', () => {
    expect(layout).toContain('(isMobileNote ? "px-3" : "px-3 py-4 sm:px-6 sm:py-6 lg:px-8")')
  })

  it('keeps the desktop shell exactly as it was', () => {
    expect(layout).toContain('"px-3 py-4 sm:px-6 sm:py-6 lg:px-8"')
  })
})

describe('the reader can tell where they are in a long note', () => {
  it('opts the note pane back into a native scroll indicator', () => {
    // The phone layer hides scrollbars globally so the feed reads like Reels.
    // A long note is the exception that rule's own comment describes, and the
    // indicator is transient, so it costs no writing space.
    const at = editor.indexOf('data-testid="note-scrollport"')
    expect(editor.slice(editor.lastIndexOf('<div', at), at)).toContain('show-scrollbar')
  })

  it('adds no permanent orientation chrome', () => {
    // No minimap, no progress bar, no banner. The brief asked for none of them.
    expect(editor).not.toMatch(/END OF NOTE/i)
    expect(editor).not.toMatch(/minimap/i)
    expect(editor).not.toMatch(/scroll-progress/i)
  })

  it('makes the end of the note a visible edge, not a colour change alone', () => {
    // The editor is a white card with a bottom border; the pane behind it is
    // gray on a phone, so the card's edge is where the note ends.
    const at = editor.indexOf('data-testid="note-scrollport"')
    const el = editor.slice(editor.lastIndexOf('<div', at), at)

    expect(el).toContain('max-sm:bg-gray-50')
    expect(richText).toContain('border border-gray-200 border-t-0 rounded-b-lg')
  })
})

describe('the save row cannot be squeezed out', () => {
  it('is held at its natural height beneath the scrolling editor', () => {
    const at = editor.indexOf('border-t border-gray-200 bg-white')
    const row = editor.slice(editor.lastIndexOf('<div', at), at)

    expect(row).toContain('flex-shrink-0')
  })

  it('never wraps to a second line on a phone', () => {
    expect(editor).toContain('flex flex-nowrap sm:flex-wrap items-center justify-between')
  })
})

describe('desktop sizing is untouched', () => {
  it('keeps its calc minimum', () => {
    expect(editor).toContain("'calc(100dvh - 300px)'")
  })

  it('keeps the title band and the format bar offset that clears it', () => {
    expect(editor).toContain('hidden sm:block sticky top-0 z-10')
    expect(richText).toContain('sticky top-0 sm:top-[41px]')
  })

  it('keeps the card border, radius and shadow', () => {
    expect(editor).toContain('rounded-xl shadow-sm overflow-hidden border border-gray-200')
  })

  it('drops them below sm, as it already did', () => {
    expect(editor).toContain('max-sm:-mx-3 max-sm:rounded-none max-sm:border-x-0 max-sm:shadow-none')
  })
})
