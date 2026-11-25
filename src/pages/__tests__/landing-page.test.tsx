import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

/**
 * The public landing page, and the claims it is not allowed to make.
 *
 * ── THE RULE CHANGED DIRECTION. READ THIS BEFORE EDITING ─────────────────
 *
 * This suite used to REQUIRE status confessions on the page: a "Planned"
 * badge, a "Not yet built" column, "early-stage", "pre-release", and a note
 * saying no screenshots existed. Nine cases asserted that language was
 * present.
 *
 * The founder removed all of it by instruction: the page describes what the
 * product does and says nothing about what is unfinished.
 *
 * Those nine cases were NOT deleted. Each one was INVERTED, because
 * deleting a gate leaves the rule unenforced, and the rule has not gone
 * away, it has reversed. `describe('no status confessions on the page')`
 * below is the same requirement pointed the other way, and it is a strictly
 * larger net than the tests it replaces: it denies a whole vocabulary of
 * roadmap language rather than checking for four specific strings.
 *
 * ── WHAT THE PAGE STILL MAY NOT DO, AND THIS IS THE IMPORTANT PART ───────
 *
 * Removing the disclaimers is not permission to claim the things they
 * qualified. The honest way to comply was to DELETE those capabilities from
 * the page, not reword them, and that is what happened: platform-provisioned
 * AI, proactive surfacing of prior decisions and firm-level pattern analysis
 * are gone. `does not claim the capabilities whose disclaimers were removed`
 * is the case that holds that line, and it is the single most important test
 * in this file. If a future edit adds "platform-provisioned AI" back as a
 * feature, that test fails, which is the entire point.
 *
 * The permanent prohibitions are unchanged: no invented customers, logos,
 * statistics, testimonials, metrics, valuations or performance figures, and
 * nothing that can be mistaken for a capture of a real tenant.
 *
 * These cases are deliberately about RENDERED TEXT rather than source
 * shape, because the failure mode is what a visitor reads, and a source
 * regex has passed here before while the thing it described was dead
 * (PR #319).
 */

/**
 * Render the page under one contact configuration.
 *
 * Both variables are read at module scope, so the module has to be
 * re-evaluated per branch rather than imported once at the top.
 */
async function renderLanding(opts: { url?: string; email?: string } = {}) {
  vi.stubEnv('VITE_ACCESS_REQUEST_URL', opts.url ?? '')
  vi.stubEnv('VITE_ACCESS_REQUEST_EMAIL', opts.email ?? '')
  vi.resetModules()
  const { LandingPage } = await import('../LandingPage')
  render(<MemoryRouter><LandingPage /></MemoryRouter>)
}

/** The common case: a mailbox configured, which most cases do not care about. */
const renderConfigured = () => renderLanding({ email: 'demo@example.test' })

const pageText = () => document.body.textContent ?? ''

beforeEach(() => { vi.resetModules() })
afterEach(() => { cleanup(); vi.unstubAllEnvs() })

describe('the positioning a visitor reads in the first screen', () => {
  it('leads with the headline the product is positioned on', async () => {
    await renderConfigured()
    expect(screen.getByRole('heading', { level: 1 }).textContent)
      .toContain('Every investment decision has a story')
    expect(screen.getByRole('heading', { level: 1 }).textContent)
      .toContain('Make sure your firm remembers it')
  })

  /*
   * CATEGORY POSITIONING IS NOT A STATUS CONFESSION, and this test is the
   * reason the distinction has to be written down somewhere.
   *
   * "Not a market-data terminal" says which category the product is in. A
   * PM who learns that at minute forty of a demo has spent forty minutes
   * answering the wrong question, so it stays, above the fold.
   *
   * "Early-stage with a working core workflow", which this test used to
   * require in the same breath, says the product is unfinished. That was
   * removed, and `no status confessions on the page` now forbids it.
   */
  it('says which category it is in, on the hero rather than in a footnote', async () => {
    await renderConfigured()
    const hero = document.getElementById('top')
    expect(hero?.textContent).toMatch(/not a market-data terminal/i)
    expect(hero?.textContent).toMatch(/execution system/i)
    expect(hero?.textContent).toMatch(/why\s+you did what you did/i)
  })

  it('offers both calls to action named in the brief', async () => {
    await renderConfigured()
    expect(screen.getAllByText(/request a demo/i).length).toBeGreaterThan(0)
    expect(screen.getByText(/explore the platform/i)).toBeTruthy()
  })
})

describe('the decision lifecycle is complete and closes', () => {
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
    await renderConfigured()
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
    await renderConfigured()
    expect(pageText()).toMatch(/the review returns to the note/i)
  })

  /*
   * The linkage, shown rather than only asserted. Every version of this
   * page claimed "typed records that point at the one before" in prose and
   * then showed nothing. These are the reference fields the diagram draws.
   */
  it('shows how each record references the one before it', async () => {
    await renderConfigured()
    const t = pageText()
    expect(t).toMatch(/version pinned at submission/i)
    expect(t).toMatch(/references the frozen version/i)
    expect(t).toMatch(/authorized by the decision/i)
    expect(t).toMatch(/graded against the original case/i)
  })

  /*
   * Depth, which was the brief. A stage reduced back to a single sentence
   * is an assertion; a stage that names what it KEEPS and the consequence a
   * year later is an explanation. Five of each, one per stage.
   */
  it('explains what each stage keeps and why that matters later', async () => {
    await renderConfigured()
    const lifecycle = document.getElementById('lifecycle')
    const keeps = lifecycle?.querySelectorAll('dt') ?? []
    expect(keeps.length).toBe(10)
    expect(lifecycle?.textContent).toMatch(/immune to later editing|pinned as a version/i)
    expect(lifecycle?.textContent).toMatch(/rejections and deferrals as first-class records/i)
    expect(lifecycle?.textContent).toMatch(/judgement becomes separable from luck/i)
  })
})

/*
 * ── The capture layer, which the founder asked for by name ───────────────
 *
 * The lifecycle section explains what the FIRM gets. An analyst reading
 * only that has no idea what their own day looks like, and the record only
 * assembles itself if capture sits where an analyst already works. This
 * section answers "what am I doing all day".
 *
 * Everything asserted here is a surface that exists. If an aspirational
 * item is ever added to round the list out, it will fail the status-
 * confession suite or the capability suite, not this one, so this one only
 * checks the section is present and substantive.
 */
describe('the research and capture section', () => {
  it('explains capture as part of the work rather than as documentation', async () => {
    await renderConfigured()
    const research = document.getElementById('research')
    expect(research, 'the research section must exist').not.toBeNull()
    expect(research?.textContent).toMatch(/document their decisions a second time/i)
    expect(research?.textContent).toMatch(/typed record rather than a document/i)
  })

  it('names the capture surfaces an analyst actually touches', async () => {
    await renderConfigured()
    const research = document.getElementById('research')
    const headings = [...(research?.querySelectorAll('h3') ?? [])].map(h => h.textContent ?? '')
    expect(headings.length).toBeGreaterThanOrEqual(6)
    expect(headings.join(' | ')).toMatch(/notes that belong to the name/i)
    expect(headings.join(' | ')).toMatch(/versions instead of overwrites/i)
  })

  /*
   * The visual brief was that a dark background alone is not interesting,
   * and the structural answer was to invert one band to near-white. That is
   * a layout decision, so it is asserted as one: the section carries its
   * own light background rather than relying on a `dark:` variant, which on
   * a signed-out page would be dead (`darkMode: 'class'`).
   */
  it('inverts to a light band, without depending on a theme class', async () => {
    await renderConfigured()
    const research = document.getElementById('research')
    const html = research?.outerHTML ?? ''
    expect(html).toMatch(/bg-\[#f7f8fa\]/)
    expect(html).toMatch(/text-slate-900/)
    expect(html, 'a dark: variant here would be dead on a public page').not.toMatch(/\bdark:/)
  })
})

/*
 * ── The inverted rule: no status confessions ──────────────────────────────
 *
 * REPLACES, by inversion, five cases that REQUIRED this language:
 *   'labels current capabilities available and the rest planned'
 *   'says platform-provisioned AI is not built and BYOK is what exists'
 *   'calls it an evaluation rather than production access'
 *   'keeps each scope disclosure in the place a reader meets it'
 *   'carries the pre-release disclaimer in the footer'  (partly; see below)
 *
 * The founder's instruction was that no reference to what is not built yet
 * appears on the page. A gate that merely stopped checking would leave that
 * unenforced and the language would drift back. This denies the vocabulary.
 *
 * `pre-release` is in the list, and the footer case below now asserts only
 * the legal line, which is a different thing: "nothing here is an offer of
 * securities, investment advice, or a performance representation" is a
 * necessary disclaimer about what the PAGE is, not a confession about what
 * the product is.
 */
describe('no status confessions on the page', () => {
  it('uses no roadmap, pre-release or unfinished-status language anywhere', async () => {
    await renderConfigured()
    const t = pageText()
    for (const pattern of [
      /not yet built/i,
      /\bnot built\b/i,
      /coming soon/i,
      /\bpre-?release\b/i,
      /early-?stage/i,
      /\broadmap\b/i,
      /\bplanned\b/i,
      /in development|under development/i,
      /\bwork in progress\b/i,
      /capture pending/i,
      /\bplaceholder\b/i,
      /\bprototype\b/i,
      /\bwe (are building|plan to|intend to|will soon)\b/i,
      /\bdoes not exist yet\b/i,
      /\bonce (we|it) (build|ship|launch)/i,
    ]) {
      expect(t, `status confession: ${String(pattern)}`).not.toMatch(pattern)
    }
  })

  /*
   * THE MOST IMPORTANT TEST IN THIS FILE.
   *
   * Removing a disclaimer is not permission to claim the thing it
   * qualified. These three capabilities were listed under "Not yet built"
   * and were DELETED from the page rather than reworded, which is the only
   * honest way to comply with "no reference to what isn't built".
   *
   * If a later edit reintroduces any of them as a feature, the page starts
   * claiming something that does not work, with no disclaimer left to catch
   * it. That is a materially worse failure than the one the instruction was
   * aimed at, and this is the gate that prevents it.
   */
  it('does not claim the capabilities whose disclaimers were removed', async () => {
    await renderConfigured()
    const t = pageText()
    for (const pattern of [
      /platform-provisioned/i,
      /we provision (the )?ai|ai is provisioned/i,
      /per-organization budgets?/i,
      /usage accounting/i,
      /proactively surfaces?|proactive surfacing/i,
      /surfaces a (prior|previous|similar) decision/i,
      /firm-level pattern analysis|pattern analysis across/i,
    ]) {
      expect(t, `claims a removed capability: ${String(pattern)}`).not.toMatch(pattern)
    }
  })

  /*
   * The configuration leak, which is what the founder actually saw on
   * screen: the page printed the string "VITE_ACCESS_REQUEST_EMAIL" to
   * every visitor, inside a panel headed "Contact route not configured".
   *
   * That is an internal deployment note on the public front door, and it is
   * the worst single thing that was on this page. Nothing about how the
   * site is configured may ever be rendered to a visitor again.
   */
  it('never shows a visitor anything about its own configuration', async () => {
    for (const opts of [{}, { email: 'demo@example.test' }, { url: 'https://example.test/f' }]) {
      cleanup()
      await renderLanding(opts)
      const t = pageText()
      for (const pattern of [
        /VITE_/,
        /import\.meta/,
        /not configured/i,
        /\benv(ironment)? variable\b/i,
        /\bnetlify\b/i,
        /\bdeployment\b/i,
        /\bset the\b.*\bto turn\b/i,
      ]) {
        expect(t, `${String(pattern)} leaked with ${JSON.stringify(opts)}`).not.toMatch(pattern)
      }
    }
  })
})

describe('no fabricated social proof, ever', () => {
  it('shows no customer names, logos, testimonials or counts', async () => {
    await renderConfigured()
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
    await renderConfigured()
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
    await renderConfigured()
    expect(pageText()).not.toMatch(/bloomberg|factset|capital iq/i)
  })

  it('never claims market-data coverage or free usage it does not have', async () => {
    await renderConfigured()
    const t = pageText()
    expect(t).not.toMatch(/real-?time (market )?data|full market coverage/i)
    expect(t).not.toMatch(/licensed (market )?data|data included/i)
    expect(t).not.toMatch(/free (market )?data|unlimited ai|unlimited usage/i)
  })
})

/*
 * ── Nothing may be mistaken for a capture of real data ───────────────────
 *
 * The page no longer TELLS a visitor that screenshots are absent, because
 * that was a status report. The underlying guarantee is unchanged and is
 * now carried entirely by structure rather than by a sentence:
 *
 *   - zero <img>, which is the real backstop
 *   - every figure is a labelled schema, with a figcaption
 *   - no figure contains a currency amount, a percentage or a ticker-shaped
 *     token, so the one diagram on the page cannot drift into looking like
 *     a rendering of a tenant's book
 *
 * The third assertion is new and is stricter than anything the previous
 * version had: the old test only checked that each figure repeated a
 * disclaimer, which a figure full of invented numbers would also have
 * passed.
 */
describe('nothing on the page imitates real data', () => {
  it('renders no images at all', async () => {
    await renderConfigured()
    expect(document.querySelectorAll('img').length).toBe(0)
  })

  it('labels every figure as a schema and puts no data in it', async () => {
    await renderConfigured()
    const figures = screen.getAllByRole('figure')
    expect(figures.length).toBeGreaterThan(0)
    for (const f of figures) {
      expect(f.querySelector('figcaption'), 'every figure needs a caption').not.toBeNull()
      const text = f.textContent ?? ''
      /*
       * NO DIGITS AND NO CURRENCY, which is blunt on purpose.
       *
       * The first version of this checked for a currency amount, a
       * percentage and a ticker-shaped token separately. The ticker pattern
       * `\b[A-Z]{2,5}\b` matched "PM" in "what the PM actually read", which
       * is a legitimate acronym, and loosening it to avoid that would have
       * let through anything short enough.
       *
       * A schema diagram has no numbers in it. Invented data essentially
       * always does. So the rule is simply that a figure carries no digit
       * and no currency symbol, which is unambiguous, has no false
       * positives on prose, and is strictly harder to satisfy than the
       * three patterns it replaces.
       *
       * If a figure ever legitimately needs a number, change this gate
       * deliberately and say why. Do not widen it to go green.
       */
      expect(text, 'a figure must contain no digits').not.toMatch(/\d/)
      expect(text, 'a figure must contain no currency symbol').not.toMatch(/[$£€¥]/)
    }
  })

  it('still names every product surface', async () => {
    await renderConfigured()
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
})

describe('the assistant is described by what it does', () => {
  it('states the three capabilities that exist today', async () => {
    await renderConfigured()
    const actAi = document.getElementById('act-ai')
    expect(actAi?.textContent).toMatch(/it knows where you are/i)
    expect(actAi?.textContent).toMatch(/reads the record, not the internet/i)
    expect(actAi?.textContent).toMatch(/cites what it used/i)
  })

  /*
   * BYOK is a FACT about how it runs, and it is stated as one. The previous
   * version said this inside a "Not yet built" column as the reason
   * platform-provisioned AI was missing, which turned a reasonable
   * architectural position (the firm keeps control of its own key and spend)
   * into an apology.
   */
  it('states the provider-key position as control, not as a gap', async () => {
    await renderConfigured()
    const actAi = document.getElementById('act-ai')
    expect(actAi?.textContent).toMatch(/own provider key/i)
    expect(actAi?.textContent).toMatch(/keeps control of which model/i)
  })

  it('does not claim the assistant manages portfolios or trades', async () => {
    await renderConfigured()
    expect(pageText()).toMatch(/does not\s+manage portfolios, place orders/i)
  })
})

/*
 * ── Where a request goes ─────────────────────────────────────────────────
 *
 * Three branches, in priority order: an external intake form, then a
 * mailbox, then `/login`. The founder chose the form route; the URL is not
 * set yet, so the live page is in the third branch, and the third branch is
 * the one that was visibly broken, so it gets the most coverage.
 */
describe('the contact route', () => {
  it('sends every CTA to the intake form when a form URL is set', async () => {
    await renderLanding({ url: 'https://tally.example.test/r/abc123' })
    const ctas = [...document.querySelectorAll('a[data-contact-mode]')]
    expect(ctas.length).toBeGreaterThanOrEqual(3)
    for (const a of ctas) {
      expect(a.getAttribute('data-contact-mode')).toBe('form')
      expect(a.getAttribute('href')).toBe('https://tally.example.test/r/abc123')
      // An external destination must not hijack the tab, and must not leak
      // the referrer of a page a prospect is browsing privately.
      expect(a.getAttribute('target')).toBe('_blank')
      expect(a.getAttribute('rel')).toBe('noreferrer')
    }
    expect(document.querySelectorAll('a[href^="mailto:"]').length).toBe(0)
  })

  it('prefers the form over a mailbox when both are set', async () => {
    await renderLanding({ url: 'https://tally.example.test/r/abc123', email: 'demo@example.test' })
    expect(document.querySelectorAll('a[href^="mailto:"]').length).toBe(0)
    expect(pageText()).not.toContain('demo@example.test')
  })

  it('links the configured mailbox with a per-path subject when only an email is set', async () => {
    await renderLanding({ email: 'partners@example.test' })
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
   * THE case, and the regression the founder reported.
   *
   * With nothing configured the page used to render a panel reading
   * "Contact route not configured. Set VITE_ACCESS_REQUEST_EMAIL ...", and
   * the hero button scrolled to that panel. So the visible result of
   * clicking "Request a demo" was an instruction to the site's own
   * operator.
   *
   * Now every CTA goes to `/login`, which is a real page with a real
   * access-request path on it, and the label changes to match the
   * destination so the button does not promise a demo form and deliver a
   * sign-in screen.
   */
  it('routes every CTA to a real working page when nothing is configured', async () => {
    await renderLanding()
    const ctas = [...document.querySelectorAll('a[data-contact-mode]')]
    expect(ctas.length).toBeGreaterThanOrEqual(3)
    for (const a of ctas) {
      expect(a.getAttribute('data-contact-mode')).toBe('signin')
      expect(a.getAttribute('href')).toBe('/login')
      expect(a.textContent).toMatch(/request access/i)
      // Not a dead control, and not a scroll to an apology.
      expect(a.getAttribute('href')).not.toBe('#partners')
    }
    expect(document.querySelectorAll('a[href^="mailto:"]').length).toBe(0)
    expect(screen.queryByTestId('contact-unconfigured')).toBeNull()
  })

  it('never falls back to a guessed address', async () => {
    await renderLanding()
    const t = pageText()
    // The one hard-coded address in this codebase lives in
    // `AIConfigurationSection` and points at a domain that is not ours.
    expect(t).not.toContain('sales@tesseract.com')
    expect(t).not.toMatch(/@tesseract\.com/)
    expect(document.body.innerHTML).not.toMatch(/mailto:/)
  })
})

describe('the page is reachable and accessible by keyboard', () => {
  it('offers sign-in for someone who already has an account', async () => {
    await renderConfigured()
    const signIn = screen.getAllByText(/sign in/i).map(el => el.closest('a')?.getAttribute('href'))
    expect(signIn).toContain('/login')
  })

  it('uses one h1 and a single heading hierarchy under it', async () => {
    await renderConfigured()
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
    expect(screen.getAllByRole('heading', { level: 2 }).length).toBeGreaterThanOrEqual(7)
  })

  it('names its navigation landmark', async () => {
    await renderConfigured()
    expect(screen.getByRole('navigation', { name: /main/i })).toBeTruthy()
  })

  /*
   * The footer keeps ONE line, and it is a legal disclaimer about what the
   * page is, not a confession about what the product is. "Pre-release."
   * used to open it and was removed; `no status confessions on the page`
   * now forbids it from returning.
   */
  it('carries the securities disclaimer, and nothing about release status', async () => {
    await renderConfigured()
    const footer = document.querySelector('footer')
    expect(footer?.textContent).toMatch(/offer of securities/i)
    expect(footer?.textContent).toMatch(/performance representation/i)
    expect(footer?.textContent).not.toMatch(/pre-?release/i)
  })
})
