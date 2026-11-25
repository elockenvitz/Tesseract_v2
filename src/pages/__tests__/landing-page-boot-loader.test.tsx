/**
 * The landing page must fade the static boot loader.
 *
 * `#tesseract-boot-loader` is painted by index.html OUTSIDE `#root`, at
 * `position: fixed`, `inset: 0`, `z-index: 2147483647`, with an opaque
 * background. React's mount deliberately does not tear it down. It stops
 * covering the page only when something calls `hideBootLoader()`, which adds
 * `.is-fading` — and `pointer-events: none` lives in that class, so until
 * then the overlay also swallows every click.
 *
 * `/` for a signed-out visitor renders this page, and this page is the only
 * thing that renders. `ProtectedRoute` never runs for a public route, so the
 * other caller of `hideBootLoader()` is absent. Without the call here, a cold
 * load of the landing page rendered the whole page correctly and then covered
 * it with "Loading…" forever.
 *
 * That is the SAME defect `AuthLayout` was fixed for, and its comment says
 * why it was put in the layout rather than the pages: so the next public
 * route could not reintroduce it. The landing page is not inside AuthLayout,
 * so it reintroduced it anyway.
 *
 * Observed in a real browser on 2026-11-24 at commit 9b833d1b: a 1905x945
 * opaque div over a fully rendered page. The existing landing-page suite
 * passed throughout, because jsdom has no index.html and therefore no
 * overlay to be covered by. This file supplies the overlay, which is the
 * only reason it can observe the failure at all.
 */
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it } from 'vitest'
import { LandingPage } from '../LandingPage'

const LOADER_ID = 'tesseract-boot-loader'

/** Rebuild the part of index.html that matters: the overlay, outside #root. */
function paintBootLoader() {
  const overlay = document.createElement('div')
  overlay.id = LOADER_ID
  const label = document.createElement('div')
  label.id = 'tesseract-boot-loader-label'
  label.textContent = 'Loading…'
  overlay.appendChild(label)
  document.body.appendChild(overlay)
  return overlay
}

describe('the landing page releases the boot loader', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
  })

  it('fades the overlay, so the rendered page is actually visible', () => {
    const overlay = paintBootLoader()

    // Precondition: the overlay starts covering the page.
    expect(overlay.classList.contains('is-fading')).toBe(false)

    render(
      <MemoryRouter>
        <LandingPage />
      </MemoryRouter>,
    )

    // The page renders...
    expect(
      screen.getByText(/Make sure your firm remembers it/i),
    ).toBeInTheDocument()

    // ...and is not buried under the overlay.
    expect(document.getElementById(LOADER_ID)?.classList.contains('is-fading')).toBe(true)
  })

  it('does not throw when the overlay is absent', () => {
    // index.html always paints it, but a test harness or an embedded render
    // may not, and the page must not depend on it existing.
    expect(() =>
      render(
        <MemoryRouter>
          <LandingPage />
        </MemoryRouter>,
      ),
    ).not.toThrow()
  })
})
