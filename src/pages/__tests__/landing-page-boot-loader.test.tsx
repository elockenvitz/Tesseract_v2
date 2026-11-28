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

    /*
     * The page renders...
     *
     * This probed for "Make sure your firm remembers it", the old
     * headline, and broke when the hero was repositioned. The behaviour
     * under test is the OVERLAY FADING, not any particular sentence, so
     * the probe is now the h1 itself: it asserts that the page mounted
     * with a heading, without pinning this suite to copy it has no
     * opinion about. The landing-page suite owns what the h1 must say.
     */
    expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument()

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

/**
 * The nav mark must be the LOGO, not the LOADER.
 *
 * `TesseractLoader` is a loading indicator: it renders the mark plus the
 * word "Loading..." and turns continuously at 4.5s. The first version of
 * this page mounted it as the brand mark in the navigation bar, so the page
 * permanently displayed the text "Loading..." under the nav and carried a
 * logo that never stopped moving. Reported from a real browser.
 *
 * `TesseractLogo` is the same geometry configured as a logo: still at rest
 * (`data-animating="false"`), turning only under a pointer, with
 * `showNodes={false}` and a lighter stroke, which is the pairing its own
 * comments say keeps a small mark from reading as a blob.
 */
describe('the brand mark is a logo, not a loading indicator', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
  })

  it('mounts no loading indicator anywhere on the page', () => {
    render(
      <MemoryRouter>
        <LandingPage />
      </MemoryRouter>,
    )
    expect(document.querySelectorAll('[data-testid="tesseract-loader"]')).toHaveLength(0)
  })

  it('renders the word "Loading" nowhere in the page chrome', () => {
    render(
      <MemoryRouter>
        <LandingPage />
      </MemoryRouter>,
    )
    // The boot overlay lives outside #root and is not rendered by this page,
    // so anything matching here came from the page itself.
    expect(screen.queryByText(/^loading/i)).toBeNull()
  })

  /*
   * Scoped to the NAV on purpose.
   *
   * An unscoped `querySelectorAll('[data-testid="tesseract-logo"]')` passed
   * while the nav still mounted the loader, because the footer's logo
   * satisfied it on its own. A gate that any one call site can satisfy does
   * not cover the call site that broke.
   */
  it('puts a still logo in the navigation bar, not a spinner', () => {
    render(
      <MemoryRouter>
        <LandingPage />
      </MemoryRouter>,
    )
    const nav = document.querySelector('nav[aria-label="Main"]')
    expect(nav).not.toBeNull()
    const navMark = nav?.querySelector('[data-testid="tesseract-logo"]')
    expect(navMark, 'the nav must carry the logo mark').not.toBeNull()
    expect(navMark?.getAttribute('data-animating')).toBe('false')
    expect(nav?.querySelectorAll('[data-testid="tesseract-loader"]')).toHaveLength(0)
  })

  it('holds every mark on the page still until a pointer is over it', () => {
    render(
      <MemoryRouter>
        <LandingPage />
      </MemoryRouter>,
    )
    const marks = document.querySelectorAll('[data-testid="tesseract-logo"]')
    expect(marks.length).toBeGreaterThan(0)
    for (const mark of marks) {
      expect(mark.getAttribute('data-animating')).toBe('false')
    }
  })
})
