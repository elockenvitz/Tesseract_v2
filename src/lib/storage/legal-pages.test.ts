import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'

/**
 * The published legal pages are the ones a regulator or a customer's counsel
 * actually reads. Two things can silently break them, and neither shows up in
 * a normal test run:
 *
 *   - the Netlify catch-all swallowing /privacy, so the policy 404s into the
 *     app shell while everyone assumes it is posted
 *   - shipping with the [PLACEHOLDER] markers still in the text
 *
 * The placeholder check is reported, not enforced, because the blanks are
 * facts only the operator has (legal entity, contact address, jurisdiction).
 * Failing the build over them would block every unrelated deploy.
 */
const root = resolve(__dirname, '../../..')
const read = (p: string) => readFileSync(resolve(root, p), 'utf8')

describe('published legal pages', () => {
  it('exist as static files, reachable without signing in', () => {
    expect(existsSync(resolve(root, 'public/legal/privacy.html'))).toBe(true)
    expect(existsSync(resolve(root, 'public/legal/terms.html'))).toBe(true)
  })

  it('are routed ahead of the SPA catch-all', () => {
    const redirects = read('public/_redirects')
    const privacyAt = redirects.indexOf('/privacy')
    const catchAllAt = redirects.indexOf('/*')
    expect(privacyAt).toBeGreaterThan(-1)
    expect(catchAllAt).toBeGreaterThan(-1)
    // Netlify takes the first match; below the catch-all these never fire.
    expect(privacyAt).toBeLessThan(catchAllAt)
    expect(redirects).toContain('/terms')
  })

  it('states the things that must not be omitted', () => {
    const privacy = read('public/legal/privacy.html')
    // Each of these is a disclosure the inventory identified as required and
    // easy to lose in an edit: session replay, the AI recipients, and the
    // deletion split.
    expect(privacy).toMatch(/session/i)
    expect(privacy).toMatch(/Sentry/)
    expect(privacy).toMatch(/Anthropic/)
    expect(privacy).toMatch(/Perplexity/)
    expect(privacy).toMatch(/Former user/)
  })

  it('reports any placeholders still awaiting the operator', () => {
    const remaining: string[] = []
    for (const f of ['public/legal/privacy.html', 'public/legal/terms.html']) {
      for (const m of read(f).matchAll(/\[([A-Z0-9][^\]]{2,60})\]/g)) {
        remaining.push(`${f}: [${m[1]}]`)
      }
    }
    if (remaining.length) {
      console.warn(
        `\n  ${remaining.length} placeholder(s) still in the published legal pages — ` +
        `these render highlighted in yellow on the live site:\n` +
        [...new Set(remaining)].map(r => `    ${r}`).join('\n') + '\n'
      )
    }
    // Deliberately not an assertion — see the note at the top of this file.
    expect(Array.isArray(remaining)).toBe(true)
  })
})
