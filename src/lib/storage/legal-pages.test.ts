import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'

/**
 * The legal pages are drafted but deliberately NOT published — Tesseract is
 * pre-release, with no legal entity to name in them. See
 * docs/legal/LAUNCH-CHECKLIST.md. They live in docs/legal/site/ so that
 * nothing is served, and move to public/legal/ at launch.
 *
 * What is guarded here is the content, so the disclosures do not quietly rot
 * between now and then. The routing assertions are commented rather than
 * deleted: they are the thing to re-enable on the day, and a deleted test is
 * a test nobody remembers existed.
 */
const root = resolve(__dirname, '../../..')
const read = (p: string) => readFileSync(resolve(root, p), 'utf8')

describe('legal pages (drafted, unpublished)', () => {
  it('exist, staged out of the served directory', () => {
    expect(existsSync(resolve(root, 'docs/legal/site/privacy.html'))).toBe(true)
    expect(existsSync(resolve(root, 'docs/legal/site/terms.html'))).toBe(true)
  })

  it('are not being served yet', () => {
    // Publishing a policy that names an entity which does not exist is a false
    // statement, which is worse than a missing document.
    expect(existsSync(resolve(root, 'public/legal/privacy.html'))).toBe(false)
    const redirects = read('public/_redirects')
    const active = redirects.split(/\r?\n/).filter(l => l.trim() && !l.trim().startsWith('#'))
    expect(active.some(l => l.includes('/privacy'))).toBe(false)
  })

  // Re-enable at launch, together with the placeholder assertion below:
  //
  // it('are routed ahead of the SPA catch-all', () => {
  //   const redirects = read('public/_redirects')
  //   expect(redirects.indexOf('/privacy')).toBeLessThan(redirects.indexOf('/*'))
  // })

  it('states the things that must not be omitted', () => {
    const privacy = read('docs/legal/site/privacy.html')
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
    for (const f of ['docs/legal/site/privacy.html', 'docs/legal/site/terms.html']) {
      for (const m of read(f).matchAll(/\[([A-Z0-9][^\]]{2,60})\]/g)) {
        remaining.push(`${f}: [${m[1]}]`)
      }
    }
    if (remaining.length) {
      console.warn(
        `\n  ${remaining.length} placeholder(s) awaiting facts only the operator has — ` +
        `all must be filled before these pages are published:\n` +
        [...new Set(remaining)].map(r => `    ${r}`).join('\n') + '\n'
      )
    }
    // Deliberately not an assertion — see the note at the top of this file.
    expect(Array.isArray(remaining)).toBe(true)
  })
})
