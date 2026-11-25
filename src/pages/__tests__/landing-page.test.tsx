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

  /*
   * Five stages, not four.
   *
   * This asserted Research, Recommend, Decide, Review and passed, which is
   * how the page shipped with an incomplete lifecycle: it went from a PM
   * saying yes straight to grading the outcome. EXECUTE was missing, and it
   * is the stage that makes the chain real, because `accepted_trades` is
   * the only object in this system representing a committed trade and it
   * carries whether the fill was assumed or confirmed.
   */
  it('states the five lifecycle stages as the central story', async () => {
    await renderLanding('demo@example.test')
    for (const stage of ['Research', 'Recommend', 'Decide', 'Execute', 'Review']) {
      expect(screen.getByRole('heading', { name: stage, level: 3 }), stage).toBeTruthy()
    }
  })

  /*
   * The loop is the argument. A lifecycle drawn as a line that stops
   * describes a filing system; the product's claim is that the review feeds
   * the next decision. If the return leg is ever dropped, this fails.
   */
  it('closes the loop back to research rather than ending at review', async () => {
    await renderLanding('demo@example.test')
    expect(pageText()).toMatch(/the review returns to the note/i)
  })

  /*
   * The linkage, shown rather than only asserted. Every version of this
   * page claimed "typed records that point at the one before" in prose and
   * then showed nothing. These are the reference fields the diagram draws.
   */
  it('shows how each record references the one before it', async () => {
    await renderLanding('demo@example.test')
    const t = pageText()
    expect(t).toMatch(/version pinned at submission/i)
    expect(t).toMatch(/references the frozen version/i)
    expect(t).toMatch(/authorized by the decision/i)
    expect(t).toMatch(/graded against the original case/i)
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
  /*
   * REPLACES 'marks every product frame as a pending capture'.
   *
   * That test required at least six <figure> elements, each repeating
   * "capture pending" and "placeholder, not a rendering". It was describing
   * a FORM: one placeholder panel per product surface. Six bordered boxes
   * drawn around nothing, each announcing that it contains nothing, read as
   * an unfinished page no matter how it was styled, so the form was
   * replaced with a dense surface index and a single section-level
   * disclosure.
   *
   * The requirement was never "six figures". It was: nothing on this page
   * may be mistaken for a screenshot of the product. These three
   * assertions hold that line, and two of them are stricter than what they
   * replace, because the old test said nothing about the page as a whole
   * and nothing about figures added later:
   *
   *   1. The page states the position in its own words, once, visibly.
   *   2. ANY figure on the page must declare it is not a screenshot. The
   *      record-shape diagram is the only one today; the next one added has
   *      to label itself or this fails.
   *   3. Every product surface is still named, so the index cannot quietly
   *      shrink.
   *
   * The hard zero on <img> is the test below and is the real backstop.
   * When captures are finally safe to take, THAT test is the one that must
   * be changed deliberately, and `docs/commercial/demo-checklist.md` says
   * which captures are blocked and why.
   */
  it('states plainly that no screenshots appear on the page', async () => {
    await renderLanding('demo@example.test')
    const t = pageText()
    expect(t).toMatch(/no product screenshots appear on this page/i)
    expect(t).toMatch(/captures are pending rather than mocked up/i)
    expect(t).toMatch(/nothing above is a\s+rendering of a feature/i)
  })

  it('requires every figure to declare it is not a screenshot', async () => {
    await renderLanding('demo@example.test')
    const figures = screen.getAllByRole('figure')
    expect(figures.length).toBeGreaterThan(0)
    for (const f of figures) {
      expect(
        f.textContent,
        `figure "${f.textContent?.slice(0, 40)}" must say it is not a capture`,
      ).toMatch(/not a screenshot|capture pending|placeholder, not a rendering/i)
    }
  })

  it('still names every product surface', async () => {
    await renderLanding('demo@example.test')
    for (const surface of [
      'Asset workspace',
      'Idea pipeline',
      'Recommendation and frozen reasoning',
      'Decision inbox',
      'Historical decision record',
      'Outcome review',
    ]) {
      expect(screen.getByRole('heading', { name: surface }), surface).toBeTruthy()
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

  /*
   * REPLACES 'discloses the three dependencies up front'.
   *
   * That test pinned a three-bullet panel headed "What we are honest about
   * up front" inside the design-partner section. The panel was removed as a
   * product decision: the section whose job is to convert was the densest on
   * the page and led with caveats.
   *
   * This is NOT the test weakened to go green. The disclosures are still
   * required, and this version is stricter than the old one, because it
   * checks WHERE each one lands rather than only that the words appear
   * somewhere in the document:
   *
   *   - scope, in the hero, above the fold
   *   - the provider-key dependency, in the ACT AI not-yet-built column
   *   - pre-release, in the footer
   *
   * ONE DISCLOSURE DID LEAVE THE PAGE and is deliberately not asserted
   * here: "Commercial market-data licensing for external users is not yet in
   * place." The hero's "not a market-data terminal" is a statement about
   * product category, not about licensing, so it does not replace it. That
   * is a judgement the founder made knowingly. If it should return, its home
   * is the pilot conversation or the design-partner brief in
   * docs/commercial, not a panel on the conversion path.
   */
  it('keeps each scope disclosure in the place a reader meets it', async () => {
    await renderLanding('demo@example.test')

    // 1. Scope, in the hero.
    const hero = document.getElementById('top')
    expect(hero?.textContent).toMatch(/early-stage/i)
    expect(hero?.textContent).toMatch(/not a market-data terminal/i)

    // 2. The provider-key dependency, where the AI claim is made.
    const actAi = document.getElementById('act-ai')
    expect(actAi?.textContent).toMatch(/not yet built/i)
    expect(actAi?.textContent).toMatch(/key your firm supplies/i)

    // 3. Pre-release, in the footer.
    expect(document.querySelector('footer')?.textContent).toMatch(/pre-release/i)
  })

  it('never claims market-data coverage it does not have', async () => {
    await renderLanding('demo@example.test')
    const t = pageText()
    expect(t).not.toMatch(/real-?time (market )?data|full market coverage/i)
    expect(t).not.toMatch(/licensed (market )?data|data included/i)
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
