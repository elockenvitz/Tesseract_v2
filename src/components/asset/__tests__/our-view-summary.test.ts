/**
 * Our View must report the firm's research, never author it.
 *
 * These tests are mostly about what the component is NOT allowed to do. The
 * surface it replaced was safe by accident — it rendered everyone's prose
 * verbatim because it rendered ALL of it. A summary has to choose, and every
 * one of those choices is a chance to put words in a named analyst's mouth or
 * to invent a firm position out of one person's opinion.
 */

import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import {
  ourViewAge,
  ourViewExcerpt,
  ourViewPlainText,
  contributorName,
  hasLiveProse,
} from '../OurViewSummary'
import type { Contribution } from '../../../hooks/useContributions'

const contribution = (over: Partial<Contribution> = {}): Contribution => ({
  id: 'c1',
  asset_id: 'a1',
  section: 'thesis',
  content: 'Share gains are durable because switching costs rose. More detail follows.',
  supporting_detail: null,
  attachments: null,
  created_by: 'u1',
  team_id: null,
  visibility: 'team',
  is_pinned: false,
  is_archived: false,
  pinned_by: null,
  pinned_at: null,
  archived_by: null,
  archived_at: null,
  sort_order: 0,
  created_at: '2026-10-01T00:00:00Z',
  updated_at: '2026-10-01T00:00:00Z',
  ...over,
} as Contribution)

describe('excerpts are verbatim', () => {
  it('returns short prose whole', () => {
    const text = 'Share gains are durable because switching costs rose. Then more.'
    expect(ourViewExcerpt(text)).toBe(text)
  })

  it('fills the budget with whole sentences rather than stopping at the first', () => {
    /*
     * Rendering the first draft is what produced this test. It clipped at the
     * opening full stop, and analysts routinely open with a one-line position
     * and put the actual claim in the sentence after it — so every entry in
     * the summary had dropped its own point.
     */
    const text = 'Consensus treats the take-rate as policy. '
      + 'We treat it as a contract term, which is why our 2028 estimate is 11% above the street. '
      + 'The third sentence is surplus to the budget and must not appear.'
    const out = ourViewExcerpt(text, 150)
    expect(out).toContain('11% above the street')
    expect(out).not.toContain('surplus to the budget')
    expect(out.endsWith('street.')).toBe(true)
  })

  it('stops on a sentence boundary, not mid-sentence, when it can', () => {
    const text = 'One. Two. ' + 'x'.repeat(300)
    expect(ourViewExcerpt(text, 40)).toBe('One. Two.')
  })

  it('clips a single over-long sentence rather than dropping it', () => {
    // No boundary inside the budget — one sentence must still produce text.
    const text = `${'word '.repeat(80)}end.`
    const out = ourViewExcerpt(text, 60)
    expect(out.length).toBeGreaterThan(0)
    expect(out.endsWith('…')).toBe(true)
  })

  it('never introduces a word that was not in the source', () => {
    /*
     * The guarantee that makes attribution honest: whatever comes out is a
     * contiguous prefix of what the analyst wrote, modulo whitespace and the
     * ellipsis. If a future change paraphrases, this fails.
     */
    const text = 'Margins compress through 2027 as the mix shifts toward hardware, which '
      + 'the street models as flat, and we think that is the central error in the name today.'
    const out = ourViewExcerpt(text, 60).replace(/…$/, '')
    expect(text.startsWith(out)).toBe(true)
  })

  it('strips rich-text markup rather than showing tags', () => {
    expect(ourViewExcerpt('<p><strong>Buy</strong>&nbsp;on the pullback.</p>'))
      .toBe('Buy on the pullback.')
  })

  it('clips on a word boundary and marks the clip', () => {
    const out = ourViewExcerpt('a'.repeat(10) + ' ' + 'b'.repeat(400), 40)
    expect(out.endsWith('…')).toBe(true)
    expect(out.length).toBeLessThanOrEqual(42)
  })

  it('treats an empty or markup-only body as no prose', () => {
    expect(ourViewExcerpt('<p></p>')).toBe('')
    expect(ourViewExcerpt(null)).toBe('')
    expect(hasLiveProse(contribution({ content: '<p>&nbsp;</p>' }))).toBe(false)
  })

  it('excludes archived contributions from the firm view', () => {
    expect(hasLiveProse(contribution({ is_archived: true }))).toBe(false)
    expect(hasLiveProse(contribution())).toBe(true)
  })
})

describe('attribution', () => {
  it('prefers a full name, falls back to first+last', () => {
    expect(contributorName({ user: { id: 'u', first_name: 'Ada', last_name: 'L', full_name: 'Ada Lovelace' } } as any))
      .toBe('Ada Lovelace')
    expect(contributorName({ user: { id: 'u', first_name: 'Ada', last_name: 'Lovelace' } } as any))
      .toBe('Ada Lovelace')
  })

  it('says "Unknown analyst" rather than guessing', () => {
    /*
     * A blank byline on an excerpt would read as the firm speaking. Naming the
     * gap is the honest failure.
     */
    expect(contributorName({ user: null } as any)).toBe('Unknown analyst')
    expect(contributorName({} as any)).toBe('Unknown analyst')
  })
})

describe('freshness', () => {
  const now = Date.parse('2026-10-11T12:00:00Z')

  it('reports relative age', () => {
    expect(ourViewAge('2026-10-11T08:00:00Z', now)?.text).toBe('today')
    expect(ourViewAge('2026-10-10T08:00:00Z', now)?.text).toBe('yesterday')
    expect(ourViewAge('2026-09-21T12:00:00Z', now)?.text).toBe('20d ago')
  })

  it('flags research older than six months as possibly stale', () => {
    expect(ourViewAge('2026-09-21T12:00:00Z', now)?.stale).toBe(false)
    expect(ourViewAge('2026-02-11T12:00:00Z', now)?.stale).toBe(true)
    expect(ourViewAge('2023-02-11T12:00:00Z', now)?.stale).toBe(true)
  })

  it('returns null for a missing or unparseable date instead of inventing one', () => {
    expect(ourViewAge(null)).toBeNull()
    expect(ourViewAge('not a date')).toBeNull()
  })
})

/*
 * ── Source-level guards ──────────────────────────────────────────────────
 *
 * The directive these changes answer is explicit: no fabricated consensus, no
 * model-authored conclusions, no parallel research vocabulary. Those are
 * properties of the whole component, not of one function, so they are asserted
 * against the source — the same technique the embeds test uses, with comments
 * stripped so the file's own explanation of the rule cannot satisfy it.
 */
const SRC = fs.readFileSync(path.resolve(__dirname, '../OurViewSummary.tsx'), 'utf8')
const CODE = SRC
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, '')
  .replace(/^[ \t]*\/\/.*$/gm, '')

describe('no fabricated firm position', () => {
  it('does not compute an average, consensus or majority rating', () => {
    /*
     * Rating and valuation belong to PriceTargetsSummary and
     * FirmConsensusPanel. A second implementation here would drift from them.
     *
     * Substring, not `\bword\b`: the first version of this assertion used word
     * boundaries, and an injected `injectedConsensus` / `injectedAverage` pair
     * sailed straight through it — camelCase puts no boundary before the
     * capital. A gate that only catches the lowercase spelling of a mistake
     * nobody makes in lowercase is decoration.
     */
    for (const banned of ['consensus', 'average', 'majority', 'aggregate']) {
      expect(CODE.toLowerCase()).not.toContain(banned)
    }
  })

  it('does not call an AI or summarisation hook', () => {
    expect(CODE).not.toMatch(/useUnifiedThesisAnalysis|generateSummary|invoke\(|anthropic|openai/i)
  })

  it('counts contributors rather than asserting the firm thinks something', () => {
    expect(CODE).toMatch(/contributor/)
    expect(SRC).toContain("'contributor' : 'contributors'")
  })

  it('shows several views separately instead of merging them', () => {
    expect(SRC).toContain('views')
    expect(SRC).toContain('our-view-multiple-')
  })
})

describe('no second research vocabulary', () => {
  it('takes its sections from the caller, never a hardcoded list', () => {
    /*
     * The first draft of this component DID hardcode five section slugs. The
     * asset page is template-driven: an org picks its own fields, renames
     * them, and reorders them, and several template slugs alias one
     * contribution section. A list in here would have disagreed with the org's
     * template the first time someone added a field.
     */
    expect(CODE).toMatch(/fields:\s*OurViewField\[\]/)
    for (const slug of ['where_different', 'risks_to_thesis', 'business_model', 'key_catalysts']) {
      expect(CODE).not.toContain(`'${slug}'`)
    }
  })

  it('resolves prose through every alias of a section key', () => {
    // `key-risks` and `risks-to-thesis` are one field stored two ways; reading
    // only the first would hide half the firm's risk work.
    expect(CODE).toMatch(/sectionKeys/)
    expect(CODE).toMatch(/keys\.has\(c\.section\)/)
  })
})

describe('the aggregated document was replaced, not duplicated', () => {
  const TAB = fs.readFileSync(
    path.resolve(__dirname, '../../tabs/AssetTab.tsx'), 'utf8')
  const TAB_CODE = TAB
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, '')
    .replace(/^[ \t]*\/\/.*$/gm, '')

  it('renders the summary on the Snapshot, not inside Research', () => {
    /*
     * It began in the Research tab's aggregated pane. It moved: Research is
     * one analyst's document, and who ELSE has written is a fact about the
     * organisation. The tab still derives the FIELD list from the org's
     * template and passes it down, so the two surfaces cannot disagree about
     * which sections exist.
     */
    expect(TAB_CODE).not.toContain('<OurViewSummary')
    expect(TAB_CODE).toContain('contributionFields={ourViewFields}')
    expect(TAB_CODE).toContain('contributions={allAssetContributions}')

    const SNAP = fs.readFileSync(
      path.resolve(__dirname, '../InvestmentSnapshot.tsx'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, '')
    expect(SNAP).toContain('<OurViewSummary')
    expect(SNAP).toContain('fields={contributionFields}')
  })

  it('leaves Research a route to the contributors it no longer shows', () => {
    // Removing the pane without saying where it went would simply lose it.
    expect(TAB_CODE).toContain("setActiveSubPage('snapshot')")
  })

  it('derives the summarised fields from the org template', () => {
    expect(TAB_CODE).toContain('contributionSectionsForSlug(field.field_slug)')
    expect(TAB_CODE).toMatch(/for \(const section of displayedFieldsBySection\)/)
  })

  it('keeps the individual view rendering full editable sections', () => {
    /*
     * The whole point of the change is that the DOCUMENT survives. If
     * ContributionSection stopped being rendered anywhere, Our View would have
     * destroyed the research rather than summarised it.
     */
    expect(TAB_CODE).toContain('<ContributionSection')
  })

  it('still composes the existing valuation and rating surfaces', () => {
    expect(TAB_CODE).toContain('<PriceTargetsSummary')
    expect(TAB_CODE).toContain('<FirmConsensusPanel')
  })

  it('shares one non-prose field-type list with the document', () => {
    // Two copies would let the summary silently claim coverage of a field the
    // document renders through a dedicated component.
    expect(TAB_CODE).toContain('NON_PROSE_FIELD_TYPES')
    expect((TAB_CODE.match(/'price_target', 'key_references'/g) || []).length).toBe(1)
  })
})

describe('excerpts are plain text, not raw Markdown', () => {
  /*
   * Reported from the authenticated app: Snapshot excerpts showed literal
   * `**bold**` and `## heading`. The helper stripped HTML only, and
   * contributions are Markdown — every other surface renders them through
   * `ReactMarkdown`.
   */
  const cases: [string, string][] = [
    ['**Services** mix is mispriced.', 'Services mix is mispriced.'],
    ['__Services__ mix is mispriced.', 'Services mix is mispriced.'],
    ['*Services* mix is mispriced.', 'Services mix is mispriced.'],
    ['***Services*** mix is mispriced.', 'Services mix is mispriced.'],
    ['~~Old view~~ New view.', 'Old view New view.'],
    ['## Investment thesis\nServices mix is mispriced.', 'Investment thesis Services mix is mispriced.'],
    ['> We differ on the take-rate.', 'We differ on the take-rate.'],
    ['- Attach rate rising\n- Mix shifting', 'Attach rate rising Mix shifting'],
    ['1. Attach rate rising\n2. Mix shifting', 'Attach rate rising Mix shifting'],
    ['See [the filing](https://x.com/a) for detail.', 'See the filing for detail.'],
    ['![chart](https://x.com/c.png) Services mix.', 'Services mix.'],
    ['Margin is `42%` today.', 'Margin is 42% today.'],
    ['Mixed <b>HTML</b> and **Markdown**.', 'Mixed HTML and Markdown.'],
  ]

  for (const [raw, want] of cases) {
    it(`strips: ${raw.slice(0, 32).replace(/\n/g, ' ')}`, () => {
      expect(ourViewPlainText(raw)).toBe(want)
    })
  }

  it('leaves ordinary prose untouched', () => {
    // Over-stripping is the other failure: an asterisk or underscore inside a
    // sentence is not emphasis, and a footnote marker is not a list.
    const plain = 'Margins compress 4-6% as mix shifts; the street models flat.'
    expect(ourViewPlainText(plain)).toBe(plain)
  })

  it('does not mangle a stray asterisk', () => {
    expect(ourViewPlainText('Up 5% * see note')).toBe('Up 5% * see note')
  })

  it('reaches the excerpt, not just the plain-text helper', () => {
    expect(ourViewExcerpt('**Services** mix is mispriced. More follows.'))
      .toBe('Services mix is mispriced. More follows.')
  })
})
