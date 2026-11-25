import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { LEGAL_DOCUMENTS } from '../../legal/documents'
import { findUnresolvedPlaceholders } from '../../legal/entity'

/**
 * The legal pages: what used to be guarded here, and what replaced it.
 *
 * ── What this file used to assert ────────────────────────────────────────
 *
 * Two hand-written HTML pages lived in `docs/legal/site/`, staged OUT of the
 * served directory, and this suite guarded three things: that they existed,
 * that they were not being served, and that five disclosures had not rotted
 * out of them.
 *
 * ── Why it changed ───────────────────────────────────────────────────────
 *
 * Those pages were a SECOND copy of legal text. The markdown drafts in
 * `docs/legal/policies/` said overlapping things, and a reader had no way to
 * know which governed -- the exact divergence that makes legal documents
 * dangerous, because the copy someone happens to read is the one they rely on.
 *
 * So the HTML pair is retired and the markdown is the single source. Before
 * deleting them, all five guarded disclosures were confirmed present in
 * `privacy-policy-draft.md`: session replay, Sentry, Anthropic, Perplexity and
 * the former-user deletion split. The assertions below now point at the
 * markdown, so the same content is still guarded -- the subject moved, the
 * protection did not lapse.
 *
 * ── What still holds, and is the important part ──────────────────────────
 *
 * Nothing is served. The mechanism changed from "the files are in the wrong
 * directory" to "a script refuses to copy a draft, and the served directory is
 * gitignored", which is a stronger guarantee: the old arrangement depended on
 * nobody moving a file.
 */

const root = resolve(__dirname, '../../..')
const read = (p: string) => readFileSync(resolve(root, p), 'utf8')

describe('legal pages (drafted, unpublished)', () => {
  it('no longer keeps a second, hand-written HTML copy of the policies', () => {
    /*
     * Asserted rather than just deleted. If someone restores these files the
     * divergence comes back silently, and the point of the single-source rule
     * is that there is no second place for a policy to say something else.
     */
    expect(existsSync(resolve(root, 'docs/legal/site/privacy.html'))).toBe(false)
    expect(existsSync(resolve(root, 'docs/legal/site/terms.html'))).toBe(false)
  })

  it('has exactly one source per document, and it is markdown under docs/legal', () => {
    for (const doc of LEGAL_DOCUMENTS) {
      expect(doc.source, `${doc.id} is not sourced from docs/legal`).toMatch(/^docs\/legal\/.*\.md$/)
      expect(existsSync(resolve(root, doc.source)), `${doc.source} is missing`).toBe(true)
    }
  })

  it('is not being served', () => {
    /*
     * Publishing a policy that names an entity which does not exist is a false
     * statement, worse than a missing document. Still true, and now enforced
     * by the publication gate rather than by file placement.
     *
     * `public/legal/` may exist locally after `npm run legal:publish --
     * --preview`, so its mere presence is NOT the assertion -- that would make
     * this test red for anyone reviewing the drafts. What must hold is that the
     * directory is gitignored, so a preview can never be committed and
     * therefore can never be deployed.
     */
    const ignore = read('.gitignore')
      .split(/\r?\n/)
      .filter(l => l.trim() && !l.trim().startsWith('#'))
    expect(ignore, 'public/legal/ must be gitignored').toContain('public/legal/')

    // And no redirect rule points at the retired HTML pages.
    const redirects = read('public/_redirects')
      .split(/\r?\n/)
      .filter(l => l.trim() && !l.trim().startsWith('#'))
    expect(redirects.some(l => /legal\/.*\.html/.test(l))).toBe(false)
  })

  it('aliases /privacy and /terms with a redirect, above the catch-all', () => {
    /*
     * Two properties, and the first is the one that is easy to get wrong.
     *
     * A 200 REWRITE to index.html would boot the SPA at the path `/privacy`,
     * which is matched by the `/*` route in App.tsx -- and that route is
     * wrapped in ProtectedRoute, so a signed-out visitor following a link to
     * /privacy would land on the login page. This was written as a rewrite
     * first; the status code is load-bearing.
     *
     * And placement: Netlify applies the FIRST match, so an alias below `/*`
     * never fires. The social-preview rule above it carries the same note for
     * the same reason.
     */
    const lines = read('public/_redirects')
      .split(/\r?\n/)
      .map(l => l.trim())
      .filter(l => l && !l.startsWith('#'))

    const catchAll = lines.findIndex(l => l.startsWith('/*'))
    expect(catchAll, 'the SPA catch-all is missing').toBeGreaterThan(-1)

    for (const [alias, target] of [
      ['/privacy', '/legal/privacy-policy'],
      ['/terms', '/legal/terms-of-use'],
    ]) {
      const i = lines.findIndex(l => l.startsWith(`${alias} `))
      expect(i, `no rule for ${alias}`).toBeGreaterThan(-1)
      expect(i, `${alias} must come before the catch-all or it never fires`)
        .toBeLessThan(catchAll)
      expect(lines[i], `${alias} must redirect to ${target}`).toContain(target)
      expect(lines[i], `${alias} must be a 301, not a 200 rewrite into the protected SPA`)
        .toMatch(/\s301\s*$/)
    }
  })

  it('routes /legal above the protected catch-all', () => {
    /*
     * Re-enabled, and pointed at the real mechanism. The old version of this
     * assertion was commented out awaiting launch; it can run now because the
     * routes exist today, gated at the CONTENT level rather than the route
     * level.
     *
     * What it catches: react-router takes the first matching route, and `/*` is
     * wrapped in ProtectedRoute. A /legal route placed below it would bounce a
     * signed-out visitor to the login page, and a privacy policy nobody can
     * read without an account is not a published privacy policy.
     */
    const app = read('src/App.tsx')
    const legalIndex = app.indexOf('path="/legal"')
    const legalDoc = app.indexOf('path="/legal/:documentId"')
    const catchAll = app.indexOf('path="/*"')

    expect(legalIndex, '/legal route is missing').toBeGreaterThan(-1)
    expect(legalDoc, '/legal/:documentId route is missing').toBeGreaterThan(-1)
    expect(catchAll, 'the protected catch-all is missing').toBeGreaterThan(-1)
    expect(legalIndex, '/legal must come before the protected /* catch-all').toBeLessThan(catchAll)
    expect(legalDoc, '/legal/:documentId must come before /*').toBeLessThan(catchAll)
  })

  it('states the things that must not be omitted', () => {
    /*
     * The same five disclosures the HTML version guarded, now read from the
     * markdown. Each was identified by DATA-INVENTORY.md as required and easy
     * to lose in an edit: session replay, the AI recipients, and the deletion
     * split between a user's own data and what survives them.
     */
    const privacy = read('docs/legal/policies/privacy-policy-draft.md')
    expect(privacy).toMatch(/session/i)
    expect(privacy).toMatch(/Sentry/)
    expect(privacy).toMatch(/Anthropic/)
    expect(privacy).toMatch(/Perplexity/)
    expect(privacy).toMatch(/Former user/i)
  })

  it('reports any placeholders still awaiting the operator', () => {
    /*
     * Uses the production scanner rather than a copy of its regex. The first
     * version of this test duplicated the pattern, and the duplicate went
     * stale within the hour: the shared one was tightened to stop matching
     * markdown link labels like [Website Terms of Use], and a copy here would
     * still be reporting them.
     */
    const remaining: string[] = []
    for (const doc of LEGAL_DOCUMENTS) {
      for (const p of findUnresolvedPlaceholders(read(doc.source))) {
        remaining.push(`${doc.source}: ${p.token}`)
      }
    }
    if (remaining.length) {
      console.warn(
        `\n  ${new Set(remaining).size} placeholder(s) awaiting facts only the operator has — ` +
        `all must be filled before these documents are published:\n` +
        [...new Set(remaining)].map(r => `    ${r}`).join('\n') + '\n'
      )
    }
    /*
     * Deliberately not an assertion. A commercial placeholder like
     * [LIABILITY CAP] is a negotiation's input, not a configuration gap, and
     * failing on it would make this suite red for a correct state.
     *
     * The HARD gate on entity placeholders is in scripts/publish-legal.mjs,
     * which refuses to publish while any entity detail is null, and is proven
     * to refuse in scripts/__tests__/publish-legal.test.mjs. This stays a
     * report, as it was.
     */
    expect(Array.isArray(remaining)).toBe(true)
  })
})
