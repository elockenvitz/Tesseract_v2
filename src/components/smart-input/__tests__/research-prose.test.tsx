/**
 * Stored research reads as prose, not as its own markup.
 *
 * The reported defect: a saved case written in Markdown rendered its
 * markers. `**Services mix**` appeared on screen with the asterisks, and
 * `## Bull case` with the hashes, because the renderer knew about lists and
 * emphasis and nothing else, and three surfaces did not use it at all --
 * they interpolated the stored string straight into a div.
 *
 * ── What these tests hold to ─────────────────────────────────────────────
 *
 * Rendered, not escaped: headings, emphasis, lists, quotes, rules and code
 * become elements, and their markers do not survive into the text.
 *
 * Nothing is executed. The renderer emits React elements whose children are
 * strings, so a case containing a tag is shown as those characters. This is
 * asserted, because the easy way to "support Markdown" is `rehype-raw`, and
 * that would make every stored research row an injection site.
 *
 * Plain text still works. Most of the corpus predates anyone writing
 * Markdown into it, and a paragraph with an asterisk in it is not a list.
 *
 * The stored string is never touched. These tests render; nothing here
 * writes, and the component takes `content` and returns elements.
 */
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { SmartInputRenderer } from '../SmartInputRenderer'

const read = () => screen.getByTestId('host').textContent ?? ''

function show(content: string) {
  return render(<div data-testid="host"><SmartInputRenderer content={content} /></div>)
}

describe('research written in Markdown', () => {
  it('renders bold and italic as emphasis, with no markers left in the text', () => {
    const { container } = show('**Services mix** is under-modelled, and *materially* so.')

    expect(container.querySelector('strong')).toHaveTextContent('Services mix')
    expect(container.querySelector('em')).toHaveTextContent('materially')
    expect(read()).toBe('Services mix is under-modelled, and materially so.')
    expect(read()).not.toContain('*')
  })

  it('renders headings as headings rather than as hashes', () => {
    show('## Bull case\nServices reaches 30% of revenue.\n### What would break it\nA services antitrust ruling.')

    /* Level four and five: the page around this already owns h1 to h3, and a
       heading inside a stored case is a heading within a section. Matched by
       closest(), since the heading's text sits in a span -- the inline pass
       wraps the run it did not format. */
    expect(screen.getByText('Bull case').closest('h4')).not.toBeNull()
    expect(screen.getByText('What would break it').closest('h5')).not.toBeNull()
    expect(read()).not.toContain('#')
    expect(read()).toContain('Services reaches 30% of revenue.')
  })

  it('renders every heading level without leaking a marker', () => {
    const { container } = show(['# One', '## Two', '### Three', '#### Four', '##### Five', '###### Six'].join('\n'))

    const headings = Array.from(container.querySelectorAll('h4, h5, h6'))
    expect(headings).toHaveLength(6)
    expect(headings.map(h => h.textContent)).toEqual(['One', 'Two', 'Three', 'Four', 'Five', 'Six'])
    expect(read()).not.toContain('#')
  })

  it('keeps emphasis inside a heading', () => {
    const { container } = show('## The **services** case')
    const heading = container.querySelector('h4')!
    expect(heading.querySelector('strong')).toHaveTextContent('services')
    expect(heading.textContent).toBe('The services case')
  })

  it('renders bullet and numbered lists as lists', () => {
    const { container } = show('Risks:\n- China exposure\n- Regulatory\n\n1. Watch the services line\n2. Watch the buyback')

    const bullets = Array.from(container.querySelectorAll('ul li')).map(li => li.textContent)
    expect(bullets).toEqual(['China exposure', 'Regulatory'])
    const numbered = Array.from(container.querySelectorAll('ol li')).map(li => li.textContent)
    expect(numbered).toEqual(['Watch the services line', 'Watch the buyback'])
  })

  it('renders a quoted line as a quote and a rule as a rule', () => {
    const { container } = show('> Management guided to a services deceleration.\n\n---\n\nOur read differs.')

    expect(container.querySelector('blockquote'))
      .toHaveTextContent('Management guided to a services deceleration.')
    expect(container.querySelector('hr')).toBeInTheDocument()
    expect(read()).not.toContain('>')
    expect(read()).not.toContain('---')
  })

  it('renders a code span without formatting what is inside it', () => {
    const { container } = show('The field is `gross_margin_**pct**`.')

    const code = container.querySelector('code')!
    /* The asterisks are DATA here. A renderer that formatted inside
       backticks would quietly rewrite a field name. */
    expect(code).toHaveTextContent('gross_margin_**pct**')
    expect(code.querySelector('strong')).toBeNull()
  })

  it('resolves mixed markers in reading order', () => {
    const { container } = show('**first** then *second* then `third`')
    const order = Array.from(container.querySelectorAll('strong, em, code')).map(n => n.tagName)
    expect(order).toEqual(['STRONG', 'EM', 'CODE'])
  })
})

describe('research that is not Markdown', () => {
  it('keeps plain paragraphs and their breaks', () => {
    const { container } = show('First paragraph.\n\nSecond paragraph.')
    const paragraphs = Array.from(container.querySelectorAll('p')).map(p => p.textContent)
    expect(paragraphs).toEqual(['First paragraph.', 'Second paragraph.'])
  })

  it('leaves a lone asterisk alone', () => {
    show('Margins improved * see footnote 4 * for the basis.')
    expect(read()).toBe('Margins improved * see footnote 4 * for the basis.')
  })

  it('leaves an unclosed marker as written rather than guessing', () => {
    show('The **services case is unfinished')
    expect(read()).toBe('The **services case is unfinished')
  })
})

describe('research that contains markup', () => {
  /**
   * The safety property, asserted rather than assumed.
   *
   * `rehype-raw` is one line away at all times and would turn every stored
   * research row into an injection site. These cases fail the moment it is
   * added.
   */
  it('shows a script tag as text and does not add one to the document', () => {
    const { container } = show('Risk: <script>window.__pwned = 1</script> is in the filing.')

    expect(container.querySelector('script')).toBeNull()
    expect(read()).toContain('<script>window.__pwned = 1</script>')
    expect((window as unknown as { __pwned?: number }).__pwned).toBeUndefined()
  })

  it('shows an image handler as text and creates no element', () => {
    const { container } = show('<img src=x onerror="window.__pwned = 1">')

    expect(container.querySelector('img')).toBeNull()
    expect(read()).toContain('<img src=x onerror="window.__pwned = 1">')
  })

  it('does not turn a bare URL into a link', () => {
    /* Not a safety hole, a provenance one: a link the author did not write
       is a destination the firm did not choose. */
    const { container } = show('See https://example.com/filing for the basis.')
    expect(container.querySelector('a')).toBeNull()
    expect(read()).toContain('https://example.com/filing')
  })
})
