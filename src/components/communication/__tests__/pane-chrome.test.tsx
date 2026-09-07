/**
 * How much of a phone screen the communication pane spends on saying what it is.
 *
 * ── The defect this pins ──────────────────────────────────────────────────
 *
 * Every view in this pane — AI, direct messages, notifications, Quick Ideas,
 * Discuss — renders under one shared header, and several add a bar of their own
 * beneath it. That header was `p-4` around an 18px heading, roughly 60px, on a
 * sheet that already begins 64px down the screen. On a 360x700 phone that is a
 * tenth of the viewport gone before the view has drawn anything, to restate a
 * title the reader tapped to get here.
 *
 * The band is not removed. Orientation is what it is for, and a pane with no
 * name is a worse trade than a slightly shorter one. It is made compact on a
 * phone and left exactly as it was on the desktop rail, where vertical room is
 * not contested.
 *
 * Asserted through the classes the header actually renders, because the claim
 * is about geometry and jsdom measures nothing.
 */

import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

vi.mock('../AISection', () => ({ AISection: () => <div>ai</div> }))
vi.mock('../DirectMessaging', () => ({ DirectMessaging: () => <div>dm</div> }))
vi.mock('../ThoughtsSection', () => ({ ThoughtsSection: () => <div>thoughts</div> }))
vi.mock('../EngagementThread', () => ({ EngagementThread: () => <div>discuss</div> }))
vi.mock('../../notifications/NotificationPane', () => ({
  NotificationPane: () => <div>notifications</div>,
}))
vi.mock('../../../hooks/useDismissOnBack', () => ({ useDismissOnBack: () => {} }))

import { CommunicationPane } from '../CommunicationPane'

type View = 'notifications' | 'ai' | 'direct-messages' | 'thoughts' | 'discuss'

function view(isMobile: boolean, v: View = 'notifications') {
  document.body.innerHTML = ''
  const r = render(
    <CommunicationPane
      isMobile={isMobile}
      isOpen
      onToggle={() => {}}
      isFullscreen={false}
      onToggleFullscreen={() => {}}
      view={v}
      onViewChange={() => {}}
    />,
  )
  const heading = r.container.querySelector('h3') as HTMLElement
  return { ...r, heading, band: heading.parentElement!.parentElement! }
}

const VIEWS: View[] = ['notifications', 'ai', 'direct-messages', 'thoughts', 'discuss']

describe('the phone header is a band, not a header', () => {
  it('drops the 16px block padding for a compact row', () => {
    const { band } = view(true)

    expect(band.className).toContain('px-3')
    expect(band.className).toContain('py-2')
    expect(band.className).not.toMatch(/\bp-4\b/)
  })

  it('sizes the title for a band rather than for a page', () => {
    const { heading } = view(true)

    expect(heading.className).toContain('text-sm')
    expect(heading.className).not.toContain('text-lg')
  })

  it('lets a long title truncate instead of wrapping the band to two lines', () => {
    const { heading } = view(true)

    expect(heading.className).toContain('truncate')
  })
})

describe('orientation survives the compaction', () => {
  it.each(VIEWS)('still names the pane on %s', v => {
    const { heading } = view(true, v)

    expect(heading.textContent?.trim().length).toBeGreaterThan(0)
  })

  it('still carries an icon beside the name', () => {
    const { heading } = view(true)

    expect(heading.parentElement!.children.length).toBeGreaterThan(1)
  })
})

describe('the close control is reachable with a thumb', () => {
  it('is a 36px box on a phone, not a 24px one', () => {
    view(true)
    const close = screen.getByLabelText('Close panel')

    expect(close.className).toContain('h-9')
    expect(close.className).toContain('w-9')
  })

  it('opts out of the global minimum deliberately, rather than by accident', () => {
    view(true)

    expect(screen.getByLabelText('Close panel').className).toContain('no-touch-target')
  })

  it('does not grow the band it sits in', () => {
    view(true)

    // Negative block margin: a real target inside a compact row.
    expect(screen.getByLabelText('Close panel').className).toContain('-my-1')
  })
})

describe('the desktop rail is untouched', () => {
  it('keeps its block padding', () => {
    const { band } = view(false)

    expect(band.className).toMatch(/\bp-4\b/)
    expect(band.className).not.toContain('px-3')
  })

  it('keeps its full-size title', () => {
    const { heading } = view(false)

    expect(heading.className).toContain('text-lg')
  })

  it('keeps the small close control it always had', () => {
    view(false)

    expect(screen.getByLabelText('Close panel').className).toContain('p-1')
  })

  it('still offers fullscreen, which a phone has nothing to toggle', () => {
    view(false)
    expect(screen.queryByTitle('Fullscreen')).toBeTruthy()

    view(true)
    expect(screen.queryByTitle('Fullscreen')).toBeNull()
  })
})
