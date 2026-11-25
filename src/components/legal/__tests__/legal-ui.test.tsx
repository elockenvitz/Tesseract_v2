import { describe, it, expect, vi, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { LegalFooter } from '../LegalFooter'
import { ContextualDisclosure } from '../ContextualDisclosure'
import { TermsAcceptance } from '../TermsAcceptance'
import { LEGAL_DOCUMENTS, documentsRequiringAcceptance } from '../../../legal/documents'

/**
 * The legal UI, as a signed-out visitor and a signed-in user actually see it.
 *
 * `document` here is a jsdom document that this file RENDERS INTO. That
 * distinction has been got wrong four times in this repository's landing-page
 * suite, where assertions were written against an empty jsdom document and
 * passed by asserting nothing. Every test below renders first.
 */

const wrap = (ui: React.ReactNode) => render(<MemoryRouter>{ui}</MemoryRouter>)

afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

describe('the legal footer', () => {
  it('links every document in the registry, with no link left out', () => {
    /*
     * Generated from LEGAL_DOCUMENTS rather than listed, so a document added
     * to the registry appears here without anyone remembering. This asserts
     * the count as well as the hrefs: a map that silently dropped an entry
     * would otherwise pass every individual href check.
     */
    wrap(<LegalFooter />)
    const links = screen.getByRole('navigation', { name: 'Legal' }).querySelectorAll('a')
    expect(links.length, 'one link per registered document').toBe(LEGAL_DOCUMENTS.length)
    for (const doc of LEGAL_DOCUMENTS) {
      const link = [...links].find(a => a.getAttribute('href') === `/legal/${doc.id}`)
      expect(link, `no footer link for ${doc.id}`).toBeTruthy()
      expect(link?.textContent?.trim(), `${doc.id}'s label is empty`).toBeTruthy()
    }
  })

  it('states that Tesseract is not an investment adviser, in the footer itself', () => {
    /*
     * The one disclosure that must not require a click. "It was in the terms"
     * is a weak answer to "I thought this was advice", and the footer is the
     * only part of a page a visitor reliably sees.
     * INJECTION: deleting the sentence from the component failed here.
     */
    wrap(<LegalFooter />)
    const text = screen.getByTestId('legal-footer-disclosure').textContent ?? ''
    expect(text).toMatch(/not an investment adviser/i)
    expect(text).toMatch(/no investment advice|gives no investment advice/i)
    expect(text).toMatch(/places no orders/i)
  })

  it('keeps the links when compact drops the disclosure line', () => {
    // Compact must never be a way to lose the links; it exists to drop prose.
    wrap(<LegalFooter compact />)
    expect(screen.queryByTestId('legal-footer-disclosure')).toBeNull()
    expect(
      screen.getByRole('navigation', { name: 'Legal' }).querySelectorAll('a').length,
    ).toBe(LEGAL_DOCUMENTS.length)
  })

  it('uses no em dash', () => {
    // Standing rule for user-visible copy, tooltips included -- and the
    // `title` attributes here are tooltips.
    wrap(<LegalFooter />)
    const footer = screen.getByTestId('legal-footer')
    expect(footer.textContent ?? '').not.toContain('—')
    for (const a of footer.querySelectorAll('a')) {
      expect(a.getAttribute('title') ?? '').not.toContain('—')
    }
  })
})

describe('the contextual disclosures', () => {
  it('says AI output is not a recommendation, not merely that it may be wrong', () => {
    /*
     * Inaccuracy is a quality statement. "Not a recommendation" is the one
     * that matters, and a disclosure trimmed to the first half would read as
     * complete.
     */
    wrap(<ContextualDisclosure kind="ai" />)
    const text = screen.getByTestId('disclosure-ai').textContent ?? ''
    expect(text).toMatch(/incomplete or wrong/i)
    expect(text, 'the "not a recommendation" half is missing').toMatch(/not a recommendation/i)
  })

  it('says market data is delayed and not for trading or valuation', () => {
    wrap(<ContextualDisclosure kind="market-data" />)
    const text = screen.getByTestId('disclosure-market-data').textContent ?? ''
    expect(text).toMatch(/delayed/i)
    expect(text).toMatch(/not for trading or valuation/i)
  })

  it('keeps the full wording in the inline variant', () => {
    /*
     * The failure this prevents: a "compact" disclosure that drops the clause
     * carrying the legal weight. Inline may drop the icon and the link; it may
     * not shorten the sentence.
     */
    /*
     * Scoped to each render's own container, not to `screen`.
     *
     * Two renders in one test share one jsdom document, so a `screen` or
     * render-bound `getByTestId` sees BOTH variants and throws "found multiple
     * elements". This test failed that way first time -- a bug in the test,
     * not in the component, and the same family as asserting against a
     * document you did not render into.
     */
    const full =
      render(<MemoryRouter><ContextualDisclosure kind="ai" /></MemoryRouter>)
        .container.querySelector('[data-testid="disclosure-ai"]')?.textContent ?? ''
    const inline =
      render(<MemoryRouter><ContextualDisclosure kind="ai" inline /></MemoryRouter>)
        .container.querySelector('[data-testid="disclosure-ai"]')?.textContent ?? ''
    expect(full, 'the full variant rendered nothing').toBeTruthy()
    expect(inline).toMatch(/not a recommendation/i)
    // The full variant adds only the "Disclosures" link, and only once
    // publication is on, so with the gate off the two are identical.
    expect(inline).toBe(full)
  })

  it('does not link to the disclosures page while publication is off', () => {
    /*
     * A link to a page reading "in preparation" is worse than no link: it
     * draws a reader to a dead end at the moment they wanted the detail. The
     * disclosure TEXT is always shown, because it is true today with no
     * document behind it.
     */
    wrap(<ContextualDisclosure kind="ai" />)
    const el = screen.getByTestId('disclosure-ai')
    expect(el.querySelectorAll('a').length, 'the gate is off, so there should be no link').toBe(0)
    expect(el.textContent).toMatch(/not a recommendation/i)
  })

  it('uses no em dash', () => {
    for (const kind of ['ai', 'market-data'] as const) {
      const { getByTestId } = render(
        <MemoryRouter><ContextualDisclosure kind={kind} /></MemoryRouter>,
      )
      expect(getByTestId(`disclosure-${kind}`).textContent ?? '').not.toContain('—')
    }
  })
})

describe('the terms acceptance control, which is gated off', () => {
  it('renders NOTHING in the shipped configuration', () => {
    /*
     * The state the repository is actually in. Showing this control today
     * would create a record saying users accepted a document no lawyer has
     * read, and a record of consent to a draft is worse than no record
     * because it looks like consent.
     *
     * Asserts the container is absent rather than that a checkbox is absent:
     * a greyed-out box would satisfy the weaker assertion while still telling
     * a user that terms exist and something is broken.
     */
    const { container } = wrap(
      <TermsAcceptance organizationId={null} onAcceptedChange={() => {}} />,
    )
    expect(screen.queryByTestId('terms-acceptance')).toBeNull()
    expect(screen.queryByRole('checkbox')).toBeNull()
    expect(container.textContent).toBe('')
  })

  it('never reports acceptance while it is gated off', () => {
    /*
     * The parent gates its submit on this callback. A component that
     * reported `true` on mount would open the signup flow with no record
     * written, which is the precise failure mode the gate exists to prevent.
     */
    const onAcceptedChange = vi.fn()
    wrap(<TermsAcceptance organizationId={null} onAcceptedChange={onAcceptedChange} />)
    expect(onAcceptedChange).not.toHaveBeenCalled()
  })

  it('asks for acceptance of exactly the two documents that create obligations', () => {
    // Not a render test: the registry drives what the control would ask for,
    // and the privacy policy must not be in it. A notice behind an "I agree"
    // misrepresents a disclosure as a contract.
    const ids = documentsRequiringAcceptance().map(d => d.id)
    expect(ids).toHaveLength(2)
    expect(ids).not.toContain('privacy-policy')
  })

  it('has no defaultChecked anywhere in its source', () => {
    /*
     * A source-text assertion, used deliberately and narrowly.
     *
     * The behavioural test cannot reach the checkbox: the gate is off, so
     * nothing renders, and that will remain true until counsel approves the
     * documents. A pre-ticked box is the single most common reason a clickwrap
     * is held unenforceable, so the property is worth guarding NOW rather than
     * when the gate opens -- and this is the only way to guard it today.
     *
     * The weakness is stated rather than hidden: this asserts source text, not
     * behaviour, and it must be replaced by a real interaction test the moment
     * the gate can be opened in a test. The gate's own truth table in
     * src/legal/__tests__/gates.test.ts proves the gate can open, so that
     * replacement is a known, reachable follow-up and not a hope.
     */
    const src = readFileSync(resolve(__dirname, '../TermsAcceptance.tsx'), 'utf8')
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
    expect(code, 'a pre-ticked acceptance box is not an affirmative act')
      .not.toMatch(/defaultChecked/)
    expect(code, 'useState(true) would pre-tick the box').not.toMatch(/useState\(true\)/)
  })
})
