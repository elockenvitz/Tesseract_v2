import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { render, screen } from '@testing-library/react'
import { act } from 'react'
import { DesktopGallery, DesktopTile } from '../DesktopTile'

/**
 * The reader's place survives the column changing shape.
 *
 * ── The defect ───────────────────────────────────────────────────────────
 *
 * The scroll host is never unmounted, so `scrollTop` survives a workspace
 * opening, and the surface was written on the belief that this was enough:
 * "the grid re-flows in place and the reader's scroll does not move."
 *
 * The NUMBER does not move. The content under it does. A track-count change
 * rewrites the mapping from scroll offset to content, so the same offset is
 * a different part of the field.
 *
 * MEASURED on Explore at 1920 with 145 tiles, pressing Back from a workspace:
 *
 *     scroll height   37,095 -> 11,856
 *     scrollTop       11,246 -> 11,032
 *     layout shift    0.826   (0.25 is already "poor")
 *
 * Thirty per cent down a 37,000px field is the BOTTOM of an 11,856px one, so
 * the reader was thrown about eighty-five tiles and the cards appeared to
 * jump. That is what was reported as hitching.
 *
 * The only thing that can survive a track-count change is a TILE, so the
 * gallery keeps the first one crossing the top of the viewport, with its
 * offset inside it, and puts that tile back in that place afterwards.
 *
 * ── Why these cases drive the observers by hand ──────────────────────────
 *
 * jsdom has no layout: every box measures 0 and no `ResizeObserver` ever
 * fires, so a plain render would exercise a gallery that never resized and
 * pass against a component with none of this in it. Both are stubbed, which
 * makes the ARITHMETIC and the ORDERING -- the two things that were actually
 * wrong -- real subjects rather than source greps.
 */

type Rect = { top: number; height: number }

let ros: Array<(w: number) => void> = []
let frames: FrameRequestCallback[] = []
/**
 * Where each tile sits in the FIELD, by `data-key`.
 *
 * Document space, not viewport space, so that scrolling the host moves the
 * tiles exactly as a browser would. A map of fixed viewport rects cannot
 * model this surface at all: the restore writes `scrollTop` and then measures
 * again, so rects that ignore `scrollTop` make a correct restore look like a
 * compounding one.
 */
let rects = new Map<string, Rect>()
let host: HTMLElement

const flush = (n = 6) => {
  for (let i = 0; i < n; i++) {
    const due = frames
    frames = []
    due.forEach(cb => cb(performance.now()))
  }
}

beforeEach(() => {
  ros = []
  frames = []
  rects = new Map()
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => { frames.push(cb); return frames.length })
  vi.stubGlobal('cancelAnimationFrame', () => {})
  class RO {
    constructor(private cb: ResizeObserverCallback) { ros.push(w => this.fire(w)) }
    fire(width: number) {
      this.cb([{ contentRect: { width } } as ResizeObserverEntry], this as unknown as ResizeObserver)
    }
    observe() {}
    disconnect() {}
    unobserve() {}
  }
  vi.stubGlobal('ResizeObserver', RO)
  /* One rect source for the whole tree, so a case moves the field by
     rewriting the map rather than by stubbing each element. The host is the
     scrollport and sits at 0; a tile is its field position less the scroll. */
  Element.prototype.getBoundingClientRect = function (this: Element) {
    const el = this as HTMLElement
    const make = (top: number, height: number) =>
      ({ x: 0, y: top, top, bottom: top + height, left: 0, right: 0, width: 400, height, toJSON: () => ({}) }) as DOMRect
    if (el.classList.contains('gallery-host')) return make(0, 600)
    const r = (el.dataset?.key && rects.get(el.dataset.key)) || { top: 0, height: 0 }
    return make(r.top - (host?.scrollTop ?? 0), r.height)
  }
})
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })

/** A field of plain cells: the anchor only ever reads their rects. */
function Field({ selected }: { selected?: boolean } = {}) {
  return (
    <div className="gallery-host" data-testid="host" style={{ overflowY: 'auto' }}>
      <DesktopGallery title="Explore" region>
        {[0, 1, 2, 3].map(i => (
          <div
            key={i}
            data-key={`t${i}`}
            data-size="compact"
            data-selected={selected && i === 3 ? 'true' : undefined}
          />
        ))}
      </DesktopGallery>
    </div>
  )
}

/**
 * The reader sits at 1000, 30px into `t0`.
 *
 * Wide: short rows close together. Narrow: every tile its own row, so the
 * same tile is much further down the field -- which is the whole reason the
 * offset cannot be preserved by preserving `scrollTop`.
 */
const SCROLLED = 1000
const wide = () => { for (const i of [0, 1, 2, 3]) rects.set(`t${i}`, { top: 970 + i * 100, height: 100 }) }
const narrow = () => { for (const i of [0, 1, 2, 3]) rects.set(`t${i}`, { top: 1500 + i * 500, height: 300 }) }
/** Where `t0` is on screen right now. */
const offsetOfT0 = () =>
  document.querySelector('[data-key="t0"]')!.getBoundingClientRect().top - host.getBoundingClientRect().top

/** Mounts the field, scrolls the reader to `SCROLLED`, and captures. */
function seated(props: { selected?: boolean } = {}) {
  wide()
  render(<Field {...props} />)
  host = screen.getByTestId('host')
  host.scrollTop = SCROLLED
  /* The reader scrolls: this is the only thing that captures an anchor. */
  act(() => { host.dispatchEvent(new Event('scroll')); flush() })
  return host
}

describe('the field keeps its place when the track count changes', () => {
  it('puts the tile the reader was on back where it was', () => {
    seated()
    expect(offsetOfT0()).toBe(-30)

    /* The column narrows, and the field moves under the old offset. */
    narrow()
    act(() => { ros.forEach(fire => fire(300)); flush() })

    /* The subject, stated as the reader sees it: the same tile, in the same
       place. The scrollTop that achieves it is 530 further down, and is
       deliberately not what this asserts. */
    expect(offsetOfT0()).toBe(-30)
    expect(host.scrollTop).toBe(1530)
  })

  it('leaves the scroll alone when nothing moved', () => {
    seated()
    /* Same width reported twice: not a track-count change, not our business. */
    act(() => { ros.forEach(fire => fire(300)); flush() })
    act(() => { ros.forEach(fire => fire(300)); flush() })
    expect(host.scrollTop).toBe(SCROLLED)
  })

  /*
   * The reflow fires a `scroll` event of its own, and the latch that ignores
   * it is load-bearing. MEASURED with the latch removed, closing from three
   * places in a 145-tile field: the anchor landed 719, 320 and 379 pixels
   * off. (An earlier single trial came back clean, which is why every live
   * check of this runs from three positions.)
   *
   * A column does not settle in one resize -- the shell reflows, the tiles
   * then redraw at a different scale and reflow it again -- so the stray
   * scroll from the first round lands while the second is still coming, and
   * the anchor captured from the half-finished layout is what the second
   * round then restores. That is the shape below: two resizes, a scroll
   * between them, and a middle state where the original anchor is not the
   * tile a fresh capture would pick.
   */
  it('ignores the scroll the reflow itself causes, across both of its rounds', () => {
    seated()

    /* Mid-reflow: `t0` is skipped -- height 0, which is what
       `content-visibility` leaves behind -- so a capture taken here latches
       onto `t1` instead, and `t1` is about to move further than `t0` does. */
    rects.set('t0', { top: 1200, height: 0 })
    for (const i of [1, 2, 3]) rects.set(`t${i}`, { top: 1200 + i * 300, height: 300 })
    act(() => {
      ros.forEach(fire => fire(300))
      host.dispatchEvent(new Event('scroll'))
      flush(1)
    })

    /* The second round, with the field finally laid out. */
    narrow()
    act(() => { ros.forEach(fire => fire(290)); flush() })

    /* Still `t0`, still at -30. Re-capturing `t1` in the middle restores the
       wrong tile and leaves the field 200px out. */
    expect(offsetOfT0()).toBe(-30)
  })

  /*
   * Opening a tile is the one width change where the reader named something,
   * and `IdeasExploreBrowse` already scrolls that tile into the rail -- for
   * exactly the reason this anchor exists. Restoring here would drag them off
   * the thing they just opened.
   */
  it('stands aside when a tile is chosen, which is what opening one is', () => {
    seated({ selected: true })
    narrow()
    act(() => { ros.forEach(fire => fire(300)); flush() })
    expect(host.scrollTop).toBe(SCROLLED)
  })
})

/**
 * And the span classes the container query already overrides.
 *
 * `.gallery-region > [data-size]` is a class plus an attribute, so it
 * outspecifies every `md:`/`xl:`/`2xl:col-span-*` utility. VERIFIED in the
 * running app: a medium tile carrying `xl:col-span-4` at a 1841px viewport
 * computes `span 3 / span 3`, the container query's answer.
 *
 * Dead, and not free: every tile rewrote one on each `narrow` flip, MEASURED
 * at 51 of 540 mutations in a single open across 145 tiles.
 */
describe('a region tile leaves the span to the container query', () => {
  const tile = (region: boolean) => {
    const { container } = render(
      <DesktopGallery title="Explore" region={region}>
        <DesktopTile size="medium" onOpen={() => {}} eyebrow={<span>E</span>}>
          <span>body</span>
        </DesktopTile>
      </DesktopGallery>,
    )
    return container.querySelector('[data-testid="desktop-tile"]')!
  }

  it('emits no breakpoint span inside a region', () => {
    const t = tile(true)
    expect(t.className).not.toMatch(/col-span/)
    /* Non-vacuity: the attribute the CSS actually selects on is still there,
       so this is a span expressed differently, not a span removed. */
    expect(t).toHaveAttribute('data-size', 'medium')
  })

  it('still emits one outside a region, where the window IS the width', () => {
    expect(tile(false).className).toMatch(/md:col-span-3/)
  })

  it('has a stylesheet rule that outranks the utilities it replaces', () => {
    const css = readFileSync(join(process.cwd(), 'src/index.css'), 'utf8')
    /* The region branch is only safe because this exists. If the selector is
       ever weakened to a bare class, the utilities win again and a region
       tile loses its span entirely. */
    expect(css).toMatch(/\.gallery-region > \[data-size\]\s*\{[^}]*grid-column/)
    expect(css).toMatch(/\.gallery-region > \[data-size='medium'\]/)
  })
})
