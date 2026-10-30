/**
 * No em dash reaches a user.
 *
 * A standing product-voice rule: the em dash (U+2014) never appears in a
 * string a reader can see. Labels, headings, body text, empty states, button
 * text, and `title` tooltips all count. Use a comma, a colon, a semicolon or
 * a full stop, or rewrite the sentence.
 *
 * ── Why this is a test and not a note ────────────────────────────────────
 *
 * Because the violations arrive one at a time, in copy written while
 * thinking about something else, and nobody re-reads a tooltip. Four of them
 * shipped on this surface in a single afternoon. A note would have caught
 * none of them.
 *
 * ── What it checks, and what it deliberately does not ────────────────────
 *
 * Code COMMENTS are exempt and are stripped before the check. They are
 * written for whoever maintains this file, not for a reader of the product,
 * and this repository uses the em dash heavily in them.
 *
 * The scope is the Asset Page Overview surface, which is where the rule was
 * set. Widening it to the whole repo is a separate, larger change: a repo
 * sweep would have to triage several hundred existing strings, and a gate
 * that fails on arrival is a gate somebody switches off. Adding a file here
 * is one line.
 */

import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

const SRC = path.resolve(__dirname, '../../..')

/** Every file whose user-facing copy is held to the rule. */
const GOVERNED = [
  'components/asset/InvestmentSnapshot.tsx',
  'components/asset/DecisionMemorySummary.tsx',
  'components/asset/SnapshotBlocks.tsx',
  'components/asset/AssetContextStrip.tsx',
  /*
   * Not a component, but it BUILDS copy: every decision-timeline event
   * title is assembled here, and those titles now render on the Overview.
   * They were "Trim — -221 shs" and "Decision reviewed — good"; they are
   * "Trim: -221 shs" and "Decision reviewed: good".
   */
  'hooks/useAssetDecisionTimeline.ts',
]

const EM_DASH = '—'

/**
 * The one exemption: the em dash standing ALONE as the empty-value glyph.
 *
 * `{value ?? '—'}` in a fact row, and the strip's `<div>—</div>` where a
 * name has no rating, are not sentences with a dash in them. They are the
 * conventional typographic mark for "this cell has no value", the same way a
 * table prints one, and the rule that produced this file is about how copy
 * READS. Changing them would alter the look of every empty cell on the
 * surface, which is a separate decision and not one a lint should make.
 *
 * It is deliberately narrow. The dash must be the WHOLE of a quoted string
 * (`'—'`) or the whole of a JSX text node (`>—<`). `'— none'`, `'no rating
 * —'` and `>Target — $180<` all still fail, which is the point: the moment
 * the glyph has words next to it, it is punctuation again.
 */
const PLACEHOLDER = /(['"`])—\1|>\s*—\s*</g

/**
 * Strip comments, which are exempt.
 *
 * Line comments first, then block comments. The order matters: a `//` inside
 * a block comment is harmless, but stripping blocks first would leave the
 * fragments of a line comment that followed one on the same line.
 */
function withoutComments(source: string): string {
  return source
    .split('\n')
    .map(l => l.replace(/\/\/.*$/, ''))
    .join('\n')
    .replace(/\/\*[\s\S]*?\*\//g, '')
}

describe('no em dash reaches a user', () => {
  for (const rel of GOVERNED) {
    it(`${rel} has none outside its comments`, () => {
      const code = withoutComments(fs.readFileSync(path.join(SRC, rel), 'utf8'))
      const offending = code
        .split('\n')
        .map((line, i) => ({ line: line.trim(), n: i + 1 }))
        .filter(({ line }) => line.replace(PLACEHOLDER, '').includes(EM_DASH))
      expect(offending).toEqual([])
    })
  }

  it('does not let the exemption swallow a real sentence', () => {
    /*
     * The exemption is the part of this gate most likely to rot: widen the
     * pattern by one character and every violation becomes a placeholder.
     * These are the shapes it must keep rejecting.
     */
    const strip = (s: string) => s.replace(PLACEHOLDER, '')
    for (const bad of [
      `title="Target ${EM_DASH} $180.00"`,
      `<span>Price target expired ${EM_DASH} $180.00</span>`,
      `'${EM_DASH} no rationale recorded'`,
      `\`written ${EM_DASH} 11 months ago\``,
    ]) {
      expect(strip(bad)).toContain(EM_DASH)
    }
    // And it must keep accepting the two real placeholder shapes.
    for (const ok of [`{value ?? '${EM_DASH}'}`, `<div className={C}>${EM_DASH}</div>`]) {
      expect(strip(ok)).not.toContain(EM_DASH)
    }
  })

  it('is checking something — the stripper does not eat the code', () => {
    // A stripper that returned '' would pass every case above forever.
    const code = withoutComments(
      fs.readFileSync(path.join(SRC, 'components/asset/DecisionMemorySummary.tsx'), 'utf8'),
    )
    expect(code).toContain('decisionMemoryHeadline')
    expect(code).toContain('decision-memory-recent')
    // And it really does remove them, so a passing file is not just a file
    // whose comments happen to be where the dashes are.
    expect(code).not.toContain('the engineering vocabulary')
  })
})
