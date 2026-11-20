import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

/**
 * The public landing page, and the claims it is not allowed to make.
 *
 * This page is the first thing a prospective PM or investor sees, and the
 * cost of overstating here is not a bug report: it is a demo that opens
 * with a correction. Tesseract has a working decision workflow and does NOT
 * have commercial market-data licensing, platform-provisioned AI, or a
 * production deployment with external users.
 *
 * So these cases are mostly refusals. They are deliberately about RENDERED
 * TEXT rather than source shape, because the failure mode is what a visitor
 * reads, and a source regex has passed here before while the thing it
 * described was dead (PR #319).
 */

async function renderLanding(email?: string) {
  if (email === undefined) vi.stubEnv('VITE_ACCESS_REQUEST_EMAIL', '')
  else vi.stubEnv('VITE_ACCESS_REQUEST_EMAIL', email)

  // The contact address is read at module scope, so the module has to be
  // re-evaluated for each branch rather than imported once at the top.
  vi.resetModules()
  const { LandingPage } = await import('../LandingPage')
  render(<MemoryRouter><LandingPage /></MemoryRouter>)
}

const pageText = () => document.body.textContent ?? ''

beforeEach(() => { vi.resetModules() })
afterEach(() => { cleanup(); vi.unstubAllEnvs() })

describe('the positioning a visitor reads in the first screen', () => {
  it('leads with the headline the product is positioned on', async () => {
    await renderLanding('demo@example.test')
    expect(screen.getByRole('heading', { level: 1 }).textContent)
      .toContain('Every investment decision has a story')
    expect(screen.getByRole('heading', { level: 1 }).textContent)
      .toContain('Make sure your firm remembers it')
  })

  it('says what Tesseract is not, on the hero rather than in a footnote', async () => {
    await renderLanding('demo@example.test')
    const t = pageText()
    // A PM who learns this at minute forty of a demo has spent forty
    // minutes answering the wrong question.
    expect(t).toMatch(/not a market-data terminal/i)
    expect(t).toMatch(/execution system/i)
    expect(t).toMatch(/early-stage/i)
  })

  it('offers both calls to action named in the brief', async () => {
    await renderLanding('demo@example.test')
    expect(screen.getAllByText(/request a demo/i).length).toBeGreaterThan(0)
    expect(screen.getByText(/explore the platform/i)).toBeTruthy()
  })

  it('states the four lifecycle stages as the central story', async () => {
    await renderLanding('demo@example.test')
    for (const stage of ['Research', 'Recommend', 'Decide', 'Review']) {
      expect(screen.getByRole('heading', { name: stage, level: 3 }), stage).toBeTruthy()
    }
  })
})

describe('no fabricated social proof, ever', () => {
  it('shows no customer names, logos, testimonials or counts', async () => {
    await renderLanding('demo@example.test')
    const t = pageText()
    // There are no customers. Anything in this shape would be invented.
    for (const pattern of [
      /trusted by/i,
      /customers? (say|love|trust)/i,
      /testimonial/i,
      /\bour clients\b/i,
      /used by \d/i,
      /\d+\s*(firms|funds|customers|clients|teams) (use|trust|rely)/i,
      /\$\d+\s*(billion|bn|trillion|million)\s*(in\s*)?(aum|assets)/i,
    ]) {
      expect(t, String(pattern)).not.toMatch(pattern)
    }
  })

  it('makes no performance claim', async () => {
    await renderLanding('demo@example.test')
    const t = pageText()
    for (const pattern of [
      /improve (your )?returns/i,
      /outperform/i,
      /\balpha generation\b/i,
      /\d+%\s*(better|more|higher|improvement)/i,
    ]) {
      expect(t, String(pattern)).not.toMatch(pattern)
    }
    // And says so explicitly rather than merely omitting it.
    expect(t).toMatch(/does not promise better returns/i)
  })

  it('does not present itself as a replacement for the incumbents', async () => {
    await renderLanding('demo@example.test')
    const t = pageText()
    expect(t).not.toMatch(/bloomberg|factset|capital iq/i)
  })
})

describe('product visuals are placeholders, and say so', () => {
  it('marks every product frame as a pending capture', async () => {
    await renderLanding('demo@example.test')
    const figures = screen.getAllByRole('figure')
    expect(figures.length).toBeGreaterThanOrEqual(6)
    for (const f of figures) {
      expect(f.textContent).toMatch(/capture pending/i)
      expect(f.textContent).toMatch(/placeholder, not a rendering/i)
    }
  })

  it('renders no images at all, so nothing can be mistaken for a screenshot', async () => {
    await renderLanding('demo@example.test')
    expect(document.querySelectorAll('img').length).toBe(0)
  })
})

describe('ACT AI is split into what runs and what does not', () => {
  it('labels current capabilities available and the rest planned', async () => {
    await renderLanding('demo@example.test')
    expect(screen.getAllByText(/available now/i).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/^planned$/i).length).toBeGreaterThan(0)
  })

  it('says platform-provisioned AI is not built and BYOK is what exists', async () => {
    await renderLanding('demo@example.test')
    const t = pageText()
    expect(t).toMatch(/platform-provisioned ai/i)
    expect(t).toMatch(/key (the firm|your firm) supplies/i)
  })

  it('does not claim the assistant manages portfolios or trades', async () => {
    await renderLanding('demo@example.test')
    const t = pageText()
    expect(t).toMatch(/does not manage\s+portfolios, place orders/i)
  })
})

describe('the design-partner section does not oversell access', () => {
  it('calls it an evaluation rather than production access', async () => {
    await renderLanding('demo@example.test')
    const t = pageText()
    expect(t).toMatch(/not an offer of unrestricted production access/i)
  })

  it('discloses the three dependencies up front', async () => {
    await renderLanding('demo@example.test')
    const t = pageText()
    expect(t).toMatch(/market-data licensing for external users is not yet/i)
    expect(t).toMatch(/platform-provisioned ai is not yet available/i)
    expect(t).toMatch(/pre-release platform/i)
  })

  it('promises no free data or unlimited AI', async () => {
    await renderLanding('demo@example.test')
    const t = pageText()
    expect(t).not.toMatch(/free (market )?data|unlimited ai|unlimited usage/i)
  })
})

describe('the contact route is honest about its own configuration', () => {
  it('links the configured address on both CTAs when one is set', async () => {
    await renderLanding('partners@example.test')
    const links = [...document.querySelectorAll('a[href^="mailto:"]')]
      .map(a => a.getAttribute('href') ?? '')
    expect(links.length).toBeGreaterThanOrEqual(2)
    for (const href of links) expect(href).toContain('partners@example.test')
    // Each inbound path carries its own subject, so the founder can tell a
    // demo request from a partnership enquiry without asking.
    expect(links.join(' ')).toContain('Tesseract%20demo%20request')
    expect(links.join(' ')).toContain('Tesseract%20design%20partnership')
  })

  /**
   * THE case. With no address configured the page must not invent one, and
   * must not render a button that silently does nothing.
   */
  it('renders no mailto and says so plainly when nothing is configured', async () => {
    await renderLanding(undefined)
    expect(document.querySelectorAll('a[href^="mailto:"]').length).toBe(0)
    const notice = screen.getByTestId('contact-unconfigured')
    expect(notice.textContent).toMatch(/contact route not configured/i)
    expect(notice.textContent).toContain('VITE_ACCESS_REQUEST_EMAIL')
  })

  it('never falls back to a guessed address', async () => {
    await renderLanding(undefined)
    const t = pageText()
    // The one hard-coded address in this codebase lives in
    // `AIConfigurationSection` and points at a domain that is not ours.
    expect(t).not.toContain('sales@tesseract.com')
    expect(t).not.toMatch(/@tesseract\.com/)
  })

  it('still routes the CTA somewhere useful with no address set', async () => {
    // The button is navigation, not a dead control: it goes to the section
    // that explains how to get in touch.
    await renderLanding(undefined)
    const ctas = screen.getAllByText(/request a demo/i)
      .map(el => el.closest('a')?.getAttribute('href'))
    expect(ctas.length).toBeGreaterThan(0)
    for (const href of ctas) expect(href).toBe('#partners')
  })
})

describe('the page is reachable and accessible by keyboard', () => {
  it('offers sign-in for someone who already has an account', async () => {
    await renderLanding('demo@example.test')
    const signIn = screen.getAllByText(/sign in/i).map(el => el.closest('a')?.getAttribute('href'))
    expect(signIn).toContain('/login')
  })

  it('uses one h1 and a single heading hierarchy under it', async () => {
    await renderLanding('demo@example.test')
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
    expect(screen.getAllByRole('heading', { level: 2 }).length).toBeGreaterThanOrEqual(6)
  })

  it('names its navigation landmark', async () => {
    await renderLanding('demo@example.test')
    expect(screen.getByRole('navigation', { name: /main/i })).toBeTruthy()
  })

  it('carries the pre-release disclaimer in the footer', async () => {
    await renderLanding('demo@example.test')
    const footer = document.querySelector('footer')
    expect(footer?.textContent).toMatch(/pre-release/i)
    expect(footer?.textContent).toMatch(/offer of securities/i)
    expect(footer?.textContent).toMatch(/performance representation/i)
  })
})
