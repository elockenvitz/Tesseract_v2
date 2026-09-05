import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { act } from 'react'

import { FeedSlot } from '../FeedSlot'

/**
 * A fake IntersectionObserver, because jsdom has none and the whole point of
 * this component is what it does when one reports a slot as distant.
 */
let observers: { cb: (e: any[]) => void; el: Element | null }[] = []

function installObserver() {
  observers = []
  ;(globalThis as any).IntersectionObserver = class {
    cb: (e: any[]) => void
    constructor(cb: (e: any[]) => void) {
      this.cb = cb
      observers.push({ cb, el: null })
    }
    observe(el: Element) { observers[observers.length - 1].el = el }
    disconnect() {}
    unobserve() {}
  }
}

function report(isIntersecting: boolean) {
  act(() => { for (const o of observers) o.cb([{ isIntersecting, target: o.el }]) })
}

afterEach(() => { delete (globalThis as any).IntersectionObserver })

describe('FeedSlot', () => {
  it('renders the first screens without waiting for an observer', () => {
    /**
     * A cold load is exactly when the reader is watching. Waiting for an
     * observer callback would paint an empty feed for a frame.
     */
    installObserver()
    render(<FeedSlot requirement={null} container={{ width: 390, height: 600 }} root={document.body} initiallyNear render={() => <div>card</div>} />)
    expect(screen.getByText('card')).toBeTruthy()
  })

  it('does not compose a distant card at all', () => {
    /**
     * `render` is a function, not a node, so the lookups and derivations the
     * feed performs per entry are skipped too — not merely their mounting.
     * That is most of the saving.
     */
    installObserver()
    const compose = vi.fn(() => <div>card</div>)
    render(<FeedSlot requirement={null} container={{ width: 390, height: 600 }} root={document.body} initiallyNear={false} render={compose} />)
    expect(compose).not.toHaveBeenCalled()
    expect(screen.queryByText('card')).toBeNull()
  })

  it('mounts when the reader approaches and releases when they leave', () => {
    installObserver()
    render(<FeedSlot requirement={null} container={{ width: 390, height: 600 }} root={document.body} initiallyNear={false} render={() => <div>card</div>} />)
    report(true)
    expect(screen.getByText('card')).toBeTruthy()
    report(false)
    expect(screen.queryByText('card')).toBeNull()
  })

  it('holds the same box whether or not its card is mounted', () => {
    /**
     * The invariant that makes this safe on a snap scroller. Every tile is
     * exactly one scroller height, so a collapsed slot occupies precisely the
     * box its card would have and no scroll offset moves. A virtual list with
     * estimated heights would shift the snap points under the reader.
     *
     * The height is now an inline pixel value from `resolveTile`, not an
     * `h-full` class, so what has to match between the two states is that
     * value. It is still load-bearing in the mounted state for the same reason
     * the class was: cards say `h-full` expecting a parent with a definite
     * height, and a wrapper of auto height would collapse every one of them to
     * its content.
     */
    installObserver()
    const { container } = render(
      <FeedSlot requirement={null} container={{ width: 390, height: 600 }} root={document.body} initiallyNear render={() => <div>card</div>} />,
    )
    const slot = container.firstElementChild as HTMLElement
    const mountedClass = slot.className
    const mountedHeight = slot.style.height
    const mountedResolved = slot.getAttribute('data-slot-resolved')
    report(false)
    // The same box, by the value that now decides it.
    expect(slot.className).toBe(mountedClass)
    expect(slot.style.height).toBe(mountedHeight)
    expect(slot.getAttribute('data-slot-resolved')).toBe(mountedResolved)
    expect(mountedHeight).toBeTruthy()
    // And it still stops the scroller where the card would have.
    expect(mountedClass).toContain('snap-start')
    expect(mountedClass).toContain('snap-always')
  })

  it('mounts everything when the browser has no observer', () => {
    // A rendering optimisation, not a feature. Without the API the right
    // failure is the old behaviour: correct, just slower.
    render(<FeedSlot requirement={null} container={{ width: 390, height: 600 }} root={document.body} initiallyNear={false} render={() => <div>card</div>} />)
    expect(screen.getByText('card')).toBeTruthy()
  })

  it('waits for a scroller before observing anything', () => {
    // The root arrives from a ref callback, so it is null on the first render.
    installObserver()
    render(<FeedSlot requirement={null} container={{ width: 390, height: 600 }} root={null} initiallyNear={false} render={() => <div>card</div>} />)
    expect(observers).toHaveLength(0)
  })
})
