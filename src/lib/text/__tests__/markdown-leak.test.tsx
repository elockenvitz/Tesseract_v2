/**
 * Research prose must not reach a reader as Markdown source.
 *
 * ── The defect ──────────────────────────────────────────────────────────
 *
 * Every stored research field in this app is Markdown. The Asset Workspace
 * renders it (`SmartInputRenderer`). The POINTER surfaces -- list rails,
 * clamped case columns, the requirement workspace, the contribution timeline
 * -- deliberately print a plain string instead, and they were printing the
 * STORED string. A thesis written as
 *
 *     - **iPhone weakness** -> core demand slows, services can't offset
 *
 * reached the reader as those exact characters, asterisks and hyphen
 * included. Reported from the authenticated app against real AAPL content.
 *
 * `ourViewPlainText` had already fixed exactly this inside `OurViewSummary`,
 * and could not be reused: it lived in a component module. That is why one
 * surface was right and six were wrong.
 *
 * ── What this suite is ──────────────────────────────────────────────────
 *
 * Two halves, and the second is the one that matters.
 *
 * 1. Behaviour of the two helpers, including the cases that previously
 *    leaked and the plain-text inputs they must leave alone.
 *
 * 2. A source check over the surfaces that print research as a string,
 *    asserting each one passes it through a flattener first.
 *
 * The source check is deliberate, and it is the kind of test this codebase
 * normally rejects. The justification is that the defect is INVISIBLE to a
 * render test: `{s.content}` and `{richTextToPlain(s.content)}` produce
 * identical output for every fixture that has no Markdown in it, and the
 * fixtures in those suites are plain prose. A behavioural test only catches
 * this if someone remembers to write a Markdown-bearing fixture for each of
 * six surfaces, which is the thing that did not happen. The first half below
 * covers the behaviour; this half covers the wiring.
 *
 * Non-vacuity: reverting any one site to the bare field makes the case for
 * that site fail, which was checked by injection, not assumed.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { richTextToPlain, richTextToPlainBlock } from '../rich-text-plain'
import { ourViewPlainText } from '../../../components/asset/OurViewSummary'

/* The real stored AAPL content, from `asset_contributions` in production.
   This is the string that was appearing on screen with its markers. */
const RISKS = [
  "- **iPhone weakness** → core demand slows, services can't offset",
  '- **Regulation** → App Store economics pressured',
  '- **Ecosystem weakening** → lower switching costs than assumed',
].join('\n')

describe('richTextToPlain -- one line, no markers', () => {
  it('drops the bullet markers and the bold markers', () => {
    const out = richTextToPlain(RISKS)
    expect(out).not.toContain('**')
    expect(out).not.toMatch(/(^|\s)-\s/)
    expect(out).toContain('iPhone weakness')
    expect(out).toContain('Regulation')
  })

  it('keeps every word, in order', () => {
    const out = richTextToPlain(RISKS)
    expect(out.indexOf('iPhone weakness')).toBeLessThan(out.indexOf('Regulation'))
    expect(out.indexOf('Regulation')).toBeLessThan(out.indexOf('Ecosystem weakening'))
  })

  it('collapses to a single line, because a clamped pointer has no use for breaks', () => {
    expect(richTextToPlain(RISKS)).not.toContain('\n')
  })

  it('leaves prose that merely looks like markup alone', () => {
    /* The reason this is a flattener and not a parser: a number with a
       percent and an asterisk footnote is not emphasis. */
    expect(richTextToPlain('Up 5% * see note')).toBe('Up 5% * see note')
    expect(richTextToPlain('P/E of 28x vs 24x')).toBe('P/E of 28x vs 24x')
  })

  it('handles an empty or absent field without throwing', () => {
    expect(richTextToPlain(null)).toBe('')
    expect(richTextToPlain(undefined)).toBe('')
    expect(richTextToPlain('   ')).toBe('')
  })

  it('strips HTML as well, because some stored fields carry both', () => {
    expect(richTextToPlain('<p>Services <strong>mix</strong></p>')).toBe('Services mix')
  })

  it('keeps a link label and discards its URL', () => {
    expect(richTextToPlain('See [the 10-K](https://example.com/x) on this'))
      .toBe('See the 10-K on this')
  })
})

describe('richTextToPlainBlock -- markers gone, shape kept', () => {
  it('keeps one line per bullet', () => {
    const out = richTextToPlainBlock(RISKS)
    expect(out.split('\n')).toHaveLength(3)
  })

  it('marks the bullets, because three clamped risks must still read as three', () => {
    const lines = richTextToPlainBlock(RISKS).split('\n')
    expect(lines.every(l => l.startsWith('• '))).toBe(true)
    expect(lines[0]).toBe('• iPhone weakness → core demand slows, services can\'t offset')
  })

  it('removes the emphasis markers', () => {
    expect(richTextToPlainBlock(RISKS)).not.toContain('**')
  })

  it('strips a heading to its words and leaves it on its own line', () => {
    const out = richTextToPlainBlock('## Where we differ\n\nThe street models hardware.')
    expect(out).toBe('Where we differ\n\nThe street models hardware.')
  })

  it('collapses a run of blank lines to one', () => {
    expect(richTextToPlainBlock('One\n\n\n\n\nTwo')).toBe('One\n\nTwo')
  })

  it('drops a horizontal rule rather than printing dashes', () => {
    expect(richTextToPlainBlock('Above\n\n---\n\nBelow')).toBe('Above\n\nBelow')
  })

  it('keeps an ordered list numbered', () => {
    expect(richTextToPlainBlock('1. First\n2. Second')).toBe('1. First\n2. Second')
  })

  it('turns block-level HTML into breaks instead of melting it into one line', () => {
    expect(richTextToPlainBlock('<p>One</p><p>Two</p>')).toBe('One\nTwo')
  })

  it('has no trailing blank lines', () => {
    expect(richTextToPlainBlock('Body\n\n\n')).toBe('Body')
  })
})

describe('the OurViewSummary alias still works', () => {
  /* It is re-exported rather than reimplemented. Its own suite
     (`our-view-summary.test.ts`) is the oldest caller of this behaviour and
     must keep passing against the moved implementation. */
  it('is the same function', () => {
    expect(ourViewPlainText(RISKS)).toBe(richTextToPlain(RISKS))
  })
})

/* ──────────────────────────────────────────────────────────────────────────
   The wiring check.

   Each entry is a surface that prints research as a string, the expression
   it must not print raw, and a word from its surrounding code so a failure
   names the place rather than the file.
   ────────────────────────────────────────────────────────────────────────── */

const ROOT = join(__dirname, '..', '..', '..')

interface Site {
  /** Module, relative to `src/`. */
  file: string
  /** The field expression, exactly as it appears in the JSX. */
  field: string
  /** What the surface is, for the failure message. */
  what: string
}

const SITES: readonly Site[] = [
  { file: 'components/lists/ListModeViews.tsx', field: 'p.leadCase.content', what: 'the list case rail and case column' },
  { file: 'components/lists/ListModeViews.tsx', field: 'p.idea.rationale', what: 'the list idea rationale' },
  { file: 'components/lists/ListModeViews.tsx', field: 'item.content', what: 'the list note preview' },
  { file: 'components/asset/work/RequirementWorkspace.tsx', field: 's.content', what: 'the requirement section pointer' },
  { file: 'components/contributions/EvolutionTimeline.tsx', field: 'event.content', what: 'the contribution timeline' },
  /* Found by this guard, not by reading: the expanded before/after diff is a
     SECOND pair of interpolations in the same file, below the preview. */
  { file: 'components/contributions/EvolutionTimeline.tsx', field: 'event.previousContent', what: 'the timeline before/after diff' },
  { file: 'components/lists/ListModeViews.tsx', field: 'lead.row?.content', what: 'the Overview "What we believe" band' },
  { file: 'components/contributions/ThesisHistoryView.tsx', field: 'event.content', what: 'the thesis history addition' },
]

/** `{expr}` as a JSX child, with nothing wrapped around it. */
const bareInterpolation = (field: string) =>
  new RegExp(`\\{\\s*${field.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&')}\\s*\\}`)

const read = (file: string) => readFileSync(join(ROOT, file), 'utf8')

describe('no surface prints stored research as Markdown source', () => {
  for (const site of SITES) {
    it(`${site.what} flattens ${site.field}`, () => {
      const src = read(site.file)

      /* The field must appear -- otherwise the surface was renamed and this
         case is silently passing against nothing. */
      expect(src, `${site.field} is gone from ${site.file}; update this guard`)
        .toContain(site.field)

      expect(
        bareInterpolation(site.field).test(src),
        `${site.file} interpolates {${site.field}} straight into JSX. ` +
        `${site.what} will print Markdown markers. Wrap it in ` +
        `richTextToPlain (one-line pointers) or richTextToPlainBlock ` +
        `(pre-wrap reading boxes).`,
      ).toBe(false)
    })
  }

  it('each of those files imports a flattener', () => {
    for (const file of new Set(SITES.map(s => s.file))) {
      expect(read(file), `${file} must import from lib/text/rich-text-plain`)
        .toMatch(/from '[^']*lib\/text\/rich-text-plain'/)
    }
  })

  it('the research page renders its sections rather than flattening them', () => {
    /* ResearchDetail is the firm's research READING page, at an 80ch
       measure. A pointer flattens; a reading surface renders. It was a `<p>`
       holding the stored string, which is why a section written with bullets
       and bold runs read as source there. */
    const src = read('components/research-v2/ResearchDetail.tsx')
    expect(src).toMatch(/<SmartInputRenderer content=\{sec\.content\} density="reading" \/>/)
    expect(src).toMatch(/<SmartInputRenderer content=\{sec\.supportingDetail\} \/>/)
    /* `whitespace-pre-line` must not come back around the renderer: the
       renderer emits real paragraphs and lists, and preserving the source
       newlines on top of them double-spaces the page. */
    expect(src).not.toMatch(/whitespace-pre-line[^"]*"[\s\S]{0,120}sec\.content/)
  })

  it('the Asset Workspace renders its case rather than flattening it', () => {
    /* The inverse assertion, and the reason this suite is not simply "strip
       everywhere". The workspace is a reading surface: it must keep going
       through the renderer, so a future "fix" that flattens it there fails
       here. This was verified against the renderer's real output -- the AAPL
       risks produce three `<strong>` elements and no literal asterisks. */
    const src = read('components/asset-v2/AssetWorkspace.tsx')
    expect(src).toContain('SmartInputRenderer')
    expect(src).toMatch(/density="reading"/)
    expect(src).not.toMatch(/richTextToPlain/)
  })
})
