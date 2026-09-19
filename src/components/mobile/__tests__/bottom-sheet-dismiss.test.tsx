/**
 * A bottom sheet's own close button has to close it.
 *
 * ── The defect this pins ──────────────────────────────────────────────────
 *
 * Reported against the Coverage Gap → Update Thesis drawer: "the X button does
 * not work". `onClose` was wired correctly and simply never ran, and the cause
 * was two layers below the thesis drawer.
 *
 * The close button lives INSIDE the sheet's drag row, and that row calls
 * `setPointerCapture` on `pointerdown` so a drag that leaves the row keeps
 * being tracked. Pointer capture retargets every later pointer event to the
 * capturing element — `pointerup` included — and a browser only fires `click`
 * when down and up land on the same node. So the X received the press, the div
 * received the release, and no `click` was ever synthesised.
 *
 * It affected EVERY bottom sheet in the app. It was reported against the thesis
 * drawer because that one is near-full height over a keyboard-heavy editor,
 * where the X is the only exit anyone reaches for: elsewhere the backdrop, the
 * back gesture or a drag down got people out and the dead button went unnoticed.
 *
 * ── Why the guard is "is the target a button" ──────────────────────────────
 *
 * A press on a control inside the drag row is a press, not a drag. Excluding
 * buttons is narrower than excluding the header, so the row is still draggable
 * by its handle, its title and its padding — which is what a sheet is dragged
 * by — while every control it hosts keeps its own click.
 */

import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { BottomSheet } from '../BottomSheet'

const sheet = readFileSync(resolve(__dirname, '../BottomSheet.tsx'), 'utf8')

afterEach(cleanup)

/**
 * jsdom implements neither `setPointerCapture` nor pointer-event retargeting,
 * so the bug itself cannot be reproduced here — a `click` fires in jsdom either
 * way. What IS assertable is that the press on a control never starts a drag,
 * which is the condition the browser needed. The retargeting half is asserted
 * against the source, and the whole gesture is covered in `guard:layout`.
 */
function stubPointerCapture() {
  const el = HTMLElement.prototype as any
  el.setPointerCapture ??= vi.fn()
  el.releasePointerCapture ??= vi.fn()
  el.hasPointerCapture ??= () => false
}
stubPointerCapture()

describe('the close button closes the sheet', () => {
  it('runs onClose', () => {
    const onClose = vi.fn()
    render(<BottomSheet open onClose={onClose} title="Update thesis"><p>body</p></BottomSheet>)

    fireEvent.click(screen.getByLabelText('Close'))

    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('runs it once, not once per gesture phase', () => {
    // A press, a release and the click the browser derives from them are one
    // dismissal, not three.
    const onClose = vi.fn()
    render(<BottomSheet open onClose={onClose} title="Update thesis"><p>body</p></BottomSheet>)
    const x = screen.getByLabelText('Close')

    fireEvent.pointerDown(x, { pointerId: 1, clientY: 100 })
    fireEvent.pointerUp(x, { pointerId: 1, clientY: 100 })
    fireEvent.click(x)

    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('does not reopen itself afterwards', () => {
    // The sheet is controlled, so a dismissal that left internal state saying
    // "open" would fight the parent on the next render.
    const onClose = vi.fn()
    const { rerender } = render(
      <BottomSheet open onClose={onClose} title="Update thesis"><p>body</p></BottomSheet>,
    )

    fireEvent.click(screen.getByLabelText('Close'))
    rerender(<BottomSheet open={false} onClose={onClose} title="Update thesis"><p>body</p></BottomSheet>)

    expect(onClose).toHaveBeenCalledTimes(1)
  })
})

describe('a press on a control in the drag row is not a drag', () => {
  it('starts no drag from the close button', () => {
    const onClose = vi.fn()
    render(<BottomSheet open onClose={onClose} title="Update thesis"><p>body</p></BottomSheet>)
    const x = screen.getByLabelText('Close')

    fireEvent.pointerDown(x, { pointerId: 1, clientY: 100 })
    // Far enough that, had a drag begun, this would have dismissed the sheet.
    fireEvent.pointerMove(x, { pointerId: 1, clientY: 400 })
    fireEvent.pointerUp(x, { pointerId: 1, clientY: 400 })

    expect(onClose).not.toHaveBeenCalled()
  })

  it('leaves the row draggable by everything that is not a control', () => {
    // The guard is `closest('button')`, not "anywhere in the header", so the
    // handle, the title and the padding still drag.
    expect(sheet).toContain("if ((event.target as HTMLElement | null)?.closest('button')) return")
    expect(sheet).not.toContain("closest('[data-sheet-header]')")
  })

  it('keeps the capture that made a drag outside the row work', () => {
    // The fix is a guard before the capture, not the removal of the capture.
    expect(sheet).toContain('event.currentTarget.setPointerCapture(event.pointerId)')
  })

  it('checks the target before capturing, not after', () => {
    const body = sheet.slice(sheet.indexOf('const onPointerDown ='))
    const guard = body.indexOf("closest('button')")
    const capture = body.indexOf('setPointerCapture')

    expect(guard).toBeGreaterThan(0)
    expect(guard).toBeLessThan(capture)
  })
})

describe('the other ways out still work', () => {
  it('closes on the backdrop', () => {
    const onClose = vi.fn()
    const { container } = render(
      <BottomSheet open onClose={onClose} title="Update thesis"><p>body</p></BottomSheet>,
    )
    const backdrop = document.querySelector('[aria-hidden="true"]')

    expect(container).toBeTruthy()
    fireEvent.click(backdrop!)

    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('leaves controls in the body alone', () => {
    const onClose = vi.fn()
    const onAct = vi.fn()
    render(
      <BottomSheet open onClose={onClose} title="Note actions">
        <button type="button" onClick={onAct}>Export as PDF</button>
      </BottomSheet>,
    )

    fireEvent.click(screen.getByText('Export as PDF'))

    expect(onAct).toHaveBeenCalledTimes(1)
    expect(onClose).not.toHaveBeenCalled()
  })

  it('does not close while a commit is in flight', () => {
    const onClose = vi.fn()
    render(
      <BottomSheet open onClose={onClose} title="Update thesis" dismissible={false}>
        <p>body</p>
      </BottomSheet>,
    )

    fireEvent.pointerDown(document.body, { pointerId: 1, clientY: 100 })

    expect(onClose).not.toHaveBeenCalled()
  })
})
