/**
 * The written case is rendered, not printed.
 *
 * ── The defect ───────────────────────────────────────────────────────────
 *
 * The Dashboard's asset work pane interpolated `sec.content` straight into a
 * `<p>` with `whitespace-pre-line`. A reader whose risks section was stored
 * as Markdown -- which is how the thesis editor saves it -- saw this:
 *
 *     - **iPhone weakness** → core demand slows, services can't offset
 *
 * asterisks and all, as one pre-wrapped block. `whitespace-pre-line` is a
 * CSS property doing a renderer's job: it preserves the newlines and knows
 * nothing about the emphasis or the list.
 *
 * An earlier pass fixed five OTHER surfaces and taught `SmartInputRenderer`
 * headings, quotes, rules and strikethrough. It never touched this pane, so
 * the canonical Asset page rendered a case correctly while the Dashboard
 * pane printed its source. That asymmetry is what this suite pins.
 *
 * ── Why the fixtures are verbatim ────────────────────────────────────────
 *
 * Every content string below is copied out of `asset_contributions` in
 * production for AAPL, byte for byte -- the arrows, the curly apostrophes,
 * the bullets that follow a plain lead-in line with no blank line between
 * them. A fixture written by hand would have been tidier than the real
 * corpus and would have tested a tidier renderer than the one that has to
 * run. The four phrases the reported screenshot showed as literal source
 * (`iPhone weakness`, `Regulation`, `Innovation risk`, `Per-user
 * monetization`) are all in these two rows.
 *
 * ── What is asserted against the DOM rather than the layout ──────────────
 *
 * Reading size and the prose measure are asserted as classes on rendered
 * elements. jsdom computes no layout, so there is no width or font size to
 * read back; the class on the element the renderer actually produced is the
 * strongest observable available here, and it is still rendered output
 * rather than a grep of the source. The visual claim itself belongs to the
 * browser pass, and this suite does not make it.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import type { AssetWorkspaceData } from '../../../hooks/useAssetWorkspace'

const DAY = 86_400_000
const daysAgo = (n: number) => new Date(Date.now() - n * DAY).toISOString()

/* ----------------------------------------------- production content, verbatim */

/** `asset_contributions.content`, AAPL / risks_to_thesis. */
const RISKS = [
  '- **iPhone weakness** → core demand slows, services can’t offset',
  '- **Regulation** → App Store economics pressured',
  '- **Ecosystem weakening** → lower switching costs than assumed',
  '- **Innovation risk** → no new growth driver',
  '- **China exposure** → demand + supply chain risk',
].join('\n')

/**
 * `asset_contributions.content`, AAPL / where_different.
 *
 * The interesting shape in the corpus: lead-in sentences and bullets with no
 * blank line between them, so the renderer has to open and close a list in
 * the middle of running prose.
 */
const WHERE_DIFFERENT = [
  'The differentiated view is that Apple is **not a maturing hardware company with slowing growth**, but rather an **ecosystem-driven cash flow engine still early in monetizing its installed base**.',
  'Where others see:',
  '- iPhone saturation and cyclical replacement risk',
  'The variant view is:',
  '- **Per-user monetization (services, payments, subscriptions)** can continue to compound even with flat device units',
  '- The ecosystem is **more durable and defensible** than assumed, with switching costs underappreciated',
  'The market may be **undervaluing Apple’s transition toward a higher-margin, recurring revenue model**.',
].join('\n')

/* --------------------------------------------------------------------- harness */

const BASE: AssetWorkspaceData = {
  sections: [], evidence: [], caseWrittenAt: null, coreSections: [],
  history: [], spot: null, ladder: null, target: null,
  positions: [], liveIdeas: [], decisions: [],
}

let data: AssetWorkspaceData = BASE

vi.mock('../../../hooks/useAssetWorkspace', async importOriginal => {
  const actual = await importOriginal<typeof import('../../../hooks/useAssetWorkspace')>()
  return { ...actual, useAssetWorkspace: () => ({ data, isLoading: false, error: null }) }
})

/*
 * The canonical thesis editor, stubbed. It is the real component on the real
 * page; here it would pull the whole contribution stack and a Supabase client
 * into a suite about how five lines of stored text are drawn.
 *
 * `SmartInputRenderer` is deliberately NOT mocked. It is the subject: the
 * point of the fix is that this pane consumes the shared renderer, and a
 * mocked renderer would make every case below pass against a pane that still
 * printed its source.
 */
vi.mock('../../contributions', () => ({
  ThesisContainer: ({ assetId }: { assetId: string }) =>
    <div data-testid="real-thesis-editor" data-asset={assetId} />,
}))

vi.mock('../../../hooks/useThesisReview', () => ({
  useThesisReviews: () => new Map<string, string>(),
  useRecordThesisReview: () => ({ record: vi.fn(), isPending: false, pendingOutcome: null }),
  useCurrentThesisConclusion: () => ({ current: null }),
}))

vi.mock('../../../lib/desktop-asset', async importOriginal => {
  const actual = await importOriginal<typeof import('../../../lib/desktop-asset')>()
  return { ...actual, openAsset: () => true }
})

import { AssetWorkspacePane } from '../AssetWorkspace'

const asset = { id: 'a-1', symbol: 'AAPL', company_name: 'Apple Inc.' }

const section = (over: Record<string, unknown> = {}) => ({
  section: 'thesis', content: 'Services mix is under-modelled.',
  supportingDetail: null, updatedAt: daysAgo(30), authorName: 'John Park', ...over,
}) as AssetWorkspaceData['sections'][number]

/** The rendered case body for a section, by its eyebrow label. */
function caseBody(label: string): HTMLElement {
  const eyebrow = screen.getByText(label)
  const block = eyebrow.parentElement?.querySelector('.smart-input-rendered')
  if (!(block instanceof HTMLElement)) throw new Error(`no rendered case body under "${label}"`)
  return block
}

const scrolled: string[] = []
Object.defineProperty(Element.prototype, 'scrollIntoView', {
  configurable: true, writable: true,
  value: function (this: Element) { scrolled.push(this.id) },
})

beforeEach(() => {
  data = { ...BASE }
  scrolled.length = 0
})

/* ----------------------------------------------------------------- emphasis */

describe('stored Markdown reaches the reader as formatting', () => {
  it('renders the four phrases the screenshot showed as source', () => {
    data = {
      ...BASE,
      sections: [
        section({ section: 'risks_to_thesis', content: RISKS }),
        section({ section: 'where_different', content: WHERE_DIFFERENT }),
      ],
      coreSections: ['risks_to_thesis', 'where_different'],
      caseWrittenAt: daysAgo(30),
    }
    render(<AssetWorkspacePane asset={asset} />)

    for (const phrase of [
      'iPhone weakness',
      'Regulation',
      'Innovation risk',
      'Per-user monetization (services, payments, subscriptions)',
    ]) {
      const el = screen.getByText(phrase)
      expect(el.tagName).toBe('STRONG')
    }
  })

  it('leaves no asterisks on the page', () => {
    data = {
      ...BASE,
      sections: [section({ section: 'risks_to_thesis', content: RISKS })],
      coreSections: ['risks_to_thesis'],
      caseWrittenAt: daysAgo(30),
    }
    render(<AssetWorkspacePane asset={asset} />)

    /*
     * The defect's own signature. `**iPhone weakness**` as text and
     * `iPhone weakness` in a `<strong>` are both "the words are present",
     * so the emphasis case above would pass on a surface that printed the
     * source INSIDE a bold run. Only the absence of the markers separates
     * the two.
     */
    expect(caseBody('Risks to thesis').textContent).not.toContain('**')
  })

  it('keeps the text itself intact, arrows and apostrophes included', () => {
    data = {
      ...BASE,
      sections: [section({ section: 'risks_to_thesis', content: RISKS })],
      coreSections: ['risks_to_thesis'],
      caseWrittenAt: daysAgo(30),
    }
    render(<AssetWorkspacePane asset={asset} />)

    const text = caseBody('Risks to thesis').textContent ?? ''
    expect(text).toContain('→ core demand slows, services can’t offset')
    expect(text).toContain('→ demand + supply chain risk')
  })
})

/* -------------------------------------------------------------------- lists */

describe('a list of risks is a list', () => {
  it('draws five list items, not one pre-wrapped block', () => {
    data = {
      ...BASE,
      sections: [section({ section: 'risks_to_thesis', content: RISKS })],
      coreSections: ['risks_to_thesis'],
      caseWrittenAt: daysAgo(30),
    }
    render(<AssetWorkspacePane asset={asset} />)

    const body = caseBody('Risks to thesis')
    expect(body.querySelectorAll('ul')).toHaveLength(1)
    expect(body.querySelectorAll('li')).toHaveLength(5)
    /* The property that was standing in for a renderer. */
    expect(body.querySelector('.whitespace-pre-line')).toBeNull()
  })

  it('opens and closes a list around a lead-in line, as the corpus writes it', () => {
    data = {
      ...BASE,
      sections: [section({ section: 'where_different', content: WHERE_DIFFERENT })],
      coreSections: ['where_different'],
      caseWrittenAt: daysAgo(30),
    }
    render(<AssetWorkspacePane asset={asset} />)

    const body = caseBody('Where we differ')
    /* Two bullet runs, separated by "The variant view is:". */
    expect(body.querySelectorAll('ul')).toHaveLength(2)
    expect(body.querySelectorAll('li')).toHaveLength(3)
    /* The lead-in lines stay prose rather than being swallowed into a list. */
    const paragraphs = [...body.querySelectorAll('p')].map(p => p.textContent)
    expect(paragraphs).toContain('Where others see:')
    expect(paragraphs).toContain('The variant view is:')
  })
})

/* --------------------------------------------------------- size and measure */

describe('the case is sized and measured as the page content it is', () => {
  it('renders the case at reading size, not at message size', () => {
    data = {
      ...BASE,
      sections: [section({ section: 'risks_to_thesis', content: RISKS })],
      coreSections: ['risks_to_thesis'],
      caseWrittenAt: daysAgo(30),
    }
    render(<AssetWorkspacePane asset={asset} />)

    const list = caseBody('Risks to thesis').querySelector('ul')
    /*
     * `reading` density. The shared renderer's default is a 14px grey body
     * chosen for message bubbles and contribution cards; adopting it here
     * would have traded one defect for a quieter one, since this text is the
     * section's whole content.
     */
    expect(list?.className).toContain('text-[15px]')
    expect(list?.className).not.toContain('text-sm')
  })

  it('measures the body and its supporting detail the same', () => {
    data = {
      ...BASE,
      sections: [section({
        section: 'risks_to_thesis',
        content: RISKS,
        supportingDetail: 'Sized **smaller**, measured the same.',
      })],
      coreSections: ['risks_to_thesis'],
      caseWrittenAt: daysAgo(30),
    }
    render(<AssetWorkspacePane asset={asset} />)

    /* The measure is set on the column each renderer root sits in. Read off
       the parent of every rendered block, rather than by selecting on the
       class, so the assertion does not depend on how Tailwind spells it. */
    const columns = [...document.querySelectorAll('.smart-input-rendered')]
      .map(el => el.parentElement?.className.match(/max-w-\[\d+ch\]/)?.[0])
      .filter((m): m is string => Boolean(m))

    expect(columns).toHaveLength(2)
    expect(new Set(columns).size).toBe(1)
    /* 90ch, not the 74ch that read as a narrow strip inside a 140ch column. */
    expect(columns[0]).toBe('max-w-[90ch]')
  })

  it('renders the supporting detail through the renderer too', () => {
    data = {
      ...BASE,
      sections: [section({
        section: 'risks_to_thesis',
        content: RISKS,
        supportingDetail: 'Sized **smaller**, measured the same.',
      })],
      coreSections: ['risks_to_thesis'],
      caseWrittenAt: daysAgo(30),
    }
    render(<AssetWorkspacePane asset={asset} />)

    expect(screen.getByText('smaller').tagName).toBe('STRONG')
  })
})

/* ------------------------------------------------------------ absent content */

describe('nothing is invented for a section with no text', () => {
  it('still says the section is empty', () => {
    data = {
      ...BASE,
      sections: [section({ section: 'risks_to_thesis', content: '' })],
      coreSections: ['risks_to_thesis'],
      caseWrittenAt: daysAgo(30),
    }
    render(<AssetWorkspacePane asset={asset} />)

    expect(screen.getByText('Empty.')).toBeInTheDocument()
  })
})

/* -------------------------------------------------------------- supporting */

describe('the supporting sections on record render the same way', () => {
  it('formats a peripheral section without losing its label', async () => {
    const user = (await import('@testing-library/user-event')).default.setup()
    data = {
      ...BASE,
      sections: [
        section({ section: 'thesis', content: 'Core.' }),
        /* `key_catalysts` is outside CORE_SECTIONS, which is what makes it
           peripheral -- the pane derives that from the canonical list, not
           from the `coreSections` field. */
        section({ section: 'key_catalysts', content: 'Share shift is **structural**, not cyclical.' }),
      ],
      coreSections: ['thesis'],
      caseWrittenAt: daysAgo(30),
    }
    render(<AssetWorkspacePane asset={asset} />)
    await user.click(screen.getByRole('button', { name: /Edit/ }))

    /* The row stays "Label: text" on one line, and the emphasis is real. */
    expect(screen.getByText('Key catalysts:')).toBeInTheDocument()
    expect(screen.getByText('structural').tagName).toBe('STRONG')
  })
})

/* ---------------------------------------------------------------- security */

describe('stored text is never interpreted as markup', () => {
  it('shows HTML in a case as the characters that were typed', () => {
    data = {
      ...BASE,
      sections: [section({
        section: 'risks_to_thesis',
        content: 'Watch <script>alert(1)</script> and <img onerror="x"> closely.',
      })],
      coreSections: ['risks_to_thesis'],
      caseWrittenAt: daysAgo(30),
    }
    render(<AssetWorkspacePane asset={asset} />)

    const body = caseBody('Risks to thesis')
    expect(body.querySelector('script')).toBeNull()
    expect(body.querySelector('img')).toBeNull()
    expect(body.textContent).toContain('<script>alert(1)</script>')
  })
})
