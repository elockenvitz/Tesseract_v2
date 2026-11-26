import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

/**
 * That the contextual disclosures are actually RENDERED somewhere.
 *
 * ── Why this file exists ─────────────────────────────────────────────────
 *
 * `ContextualDisclosure` had a full component test suite, proving its
 * wording, its two variants and its link suppression -- and it was rendered
 * nowhere. Every one of those tests passed against a component with zero call
 * sites. That is the shape of the defect this repository keeps rediscovering:
 * a thing is tested, so it is assumed to be in use.
 *
 * ── Why this is a source-text assertion, with its weakness stated ───────
 *
 * The honest version of this test would mount `AISection` and `ChartContainer`
 * and query for the disclosure. Neither is mountable in a unit test without
 * substantial scaffolding: `AISection` is a 1,700-line pane needing an auth
 * session, an organization context, a query client and a conversation; and
 * `ChartContainer` calls `createChart` from lightweight-charts, which needs a
 * real layout box.
 *
 * So this asserts on the source. The weakness is specific and worth naming: a
 * source regex cannot tell a rendered component from one inside a comment or
 * behind a condition that is never true. It would pass if someone wrapped the
 * call in `{false && ...}`.
 *
 * It is still worth having, because the failure it catches is the one that
 * actually happened -- the call site being absent entirely -- and it fails
 * loudly if someone deletes the line. Replace it the moment either surface
 * gains a mountable test harness; that is a concrete condition, not an
 * aspiration.
 */

const root = resolve(__dirname, '../../../..')
const read = (p: string) => readFileSync(resolve(root, p), 'utf8')

/** Strip block and line comments, so a mention in prose does not count. */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
}

const SURFACES = [
  {
    file: 'src/components/communication/AISection.tsx',
    kind: 'ai',
    why: 'the AI pane is where model output is read',
  },
  {
    file: 'src/components/charting/core/ChartContainer.tsx',
    kind: 'market-data',
    why: 'every chart mounts this component, so every price surface is covered',
  },
] as const

describe('contextual disclosures are placed at their real call sites', () => {
  for (const surface of SURFACES) {
    it(`renders the ${surface.kind} disclosure (${surface.why})`, () => {
      const src = stripComments(read(surface.file))

      expect(src, `${surface.file} does not import ContextualDisclosure`)
        .toMatch(/import\s*\{[^}]*ContextualDisclosure[^}]*\}\s*from/)

      const rendered = new RegExp(`<ContextualDisclosure[^>]*kind=["']${surface.kind}["']`)
      expect(src, `${surface.file} imports ContextualDisclosure but never renders kind="${surface.kind}"`)
        .toMatch(rendered)
    })
  }

  it('is not satisfied by the import alone', () => {
    /*
     * The injection, run against a string rather than the repository, because
     * the thing being proven is that this suite distinguishes "imported" from
     * "rendered" -- and an import with no render is exactly the state the
     * component was in before this change.
     */
    const importOnly = `
      import { ContextualDisclosure } from '../legal/ContextualDisclosure'
      export function Pane() { return <div /> }
    `
    const src = stripComments(importOnly)
    expect(src).toMatch(/import\s*\{[^}]*ContextualDisclosure[^}]*\}\s*from/)
    expect(src).not.toMatch(/<ContextualDisclosure[^>]*kind=["']ai["']/)
  })

  it('does not count a disclosure that appears only in a comment', () => {
    /*
     * The second injection, and the one that proves `stripComments` is doing
     * work. Both files above carry long comments ABOUT the disclosure, next to
     * the call. Without the strip, a test asserting on raw source would pass
     * on the comment alone -- which is the viewport-sizing gate's weakness,
     * recorded here as a thing this suite does not share.
     */
    const commentOnly = `
      import { ContextualDisclosure } from '../legal/ContextualDisclosure'
      /* We should render <ContextualDisclosure kind="ai" /> here one day. */
      export function Pane() { return <div /> }
    `
    expect(commentOnly, 'raw source contains the tag').toMatch(
      /<ContextualDisclosure[^>]*kind=["']ai["']/,
    )
    expect(
      stripComments(commentOnly),
      'after stripping comments it must NOT count as rendered',
    ).not.toMatch(/<ContextualDisclosure[^>]*kind=["']ai["']/)
  })
})
