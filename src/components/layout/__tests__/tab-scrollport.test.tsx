/**
 * The shared scrollport is the thing that remembers, and it is wired to it.
 *
 * ── Why `Layout` owns this at all ────────────────────────────────────────
 *
 * The Asset Page does not have a scroller. `asset` is not in
 * `FULL_WIDTH_TAB_TYPES`, so it renders into the single `overflow-auto` div
 * inside `Layout`'s `<main>`, shared by every non-full-width tab. That div
 * is NOT unmounted when the reader switches tabs -- which sounds like the
 * offset should survive, and is exactly why it does not: the next tab's
 * content is a different height, the browser clamps the offset to it, and
 * coming back the reader is near the top of a page they had read down.
 *
 * A page cannot remember a position in a scroller it does not own, so the
 * correction is here and not in `AssetTab`.
 *
 * ── Why this file reads the source ───────────────────────────────────────
 *
 * Stated plainly because the repository's standing preference is the
 * opposite. What the memory DOES is behaviour, and it is driven as behaviour
 * in `lib/ui/__tests__/scroll-memory.test.tsx`: a real scroller with a
 * modelled clamp, real remounts, real re-keying, including the drift this
 * fixes.
 *
 * What is left is the wiring -- whether that proven mechanism is attached to
 * the right element and keyed on the right identity. Rendering `Layout` to
 * ask would mean stubbing the header, the tab strip, auth, the org context,
 * notifications, the query client and the comm pane, and the result would
 * report which mocks were written. The questions below are each a single
 * structural fact, and each one is a way the wiring has actually been got
 * wrong: the ref on a wrapper that does not scroll, the handler left off, a
 * key derived from what the tab holds rather than which tab it is.
 *
 * The precedent is `app-shell.test.tsx` in this directory, which reads the
 * same file for the same reason.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const layout = readFileSync(resolve(__dirname, '../Layout.tsx'), 'utf8')

/** The one element the tab content renders into, as written. */
function scrollportTag(): string {
  const at = layout.indexOf('data-slot="tab-scrollport"')
  expect(at, 'the scrollport is not marked').toBeGreaterThan(0)
  const open = layout.lastIndexOf('<div', at)
  const close = layout.indexOf('>', layout.indexOf('clsx(', at))
  /* Opening tag only. `clsx(...)` spans lines and holds `>` inside no
     string, so the end is taken from after it. */
  return layout.slice(open, close + 1)
}

describe('the scroller the Asset Page borrows', () => {
  it('is the element that actually scrolls', () => {
    /* A ref on a wrapper whose child scrolls reads and writes an offset that
       is always zero, and the surface would look unfixed for a reason
       nothing points at. */
    expect(scrollportTag()).toContain('overflow-auto')
  })

  it('hands that element to the scroll memory', () => {
    expect(scrollportTag()).toContain('ref={scrollport}')
  })

  it('listens for the reader moving it', () => {
    /* Without this the restore has nothing to restore: an offset is only
       ever recorded from a scroll event. */
    expect(scrollportTag()).toContain('onScroll={onScrollportScroll}')
  })

  it('is the only shared scrollport, so the memory is on the right one', () => {
    const main = layout.slice(layout.indexOf('<main className='), layout.indexOf('</main>'))
    expect((main.match(/data-slot="tab-scrollport"/g) ?? [])).toHaveLength(1)
  })
})

describe('what the offset is remembered against', () => {
  it('is which tab the reader is on', () => {
    /* Two asset tabs are two places the reader has been. A key derived from
       the tab's TYPE or its asset would move each of them to the other's
       position, which is worse than losing the offset. */
    const at = layout.indexOf('useRememberedScroll<HTMLDivElement>(tabScroll')
    expect(at).toBeGreaterThan(0)
    expect(layout.slice(at, layout.indexOf(')', at))).toContain('activeTabId')
  })

  it('is bounded, so a long session does not accumulate', () => {
    const at = layout.indexOf('createScrollMemory(')
    expect(at).toBeGreaterThan(0)
    const limit = /createScrollMemory\((\d+)\)/.exec(layout.slice(at))?.[1]
    expect(Number(limit)).toBeGreaterThan(0)
    expect(Number(limit)).toBeLessThanOrEqual(50)
  })

  it('is held in memory only, and never written to storage', () => {
    /* An offset is meaningful only against the content that produced it. The
       same asset tomorrow is a different height, so a revived offset puts
       the reader somewhere arbitrary and calls it where they were. A reload
       starting at the top is correct. */
    const mem = readFileSync(resolve(__dirname, '../../../lib/ui/scroll-memory.ts'), 'utf8')
    expect(mem).not.toMatch(/localStorage|sessionStorage|indexedDB/)
  })
})
