/**
 * No dialog is sized against a viewport the phone cannot see.
 *
 * ── The trap this closes for good ─────────────────────────────────────────
 *
 * On a phone `100vh` includes the strip behind the browser's URL bar, so a
 * container sized against it is taller than the screen. `index.css` has
 * documented that for `.h-viewport` since the shell was fixed — and thirty-six
 * dialogs across the product were still written as `max-h-[90vh]`, each one
 * putting its own bottom tenth, where the actions are, below the fold.
 *
 * It is the same bug thirty-six times because nothing stopped the thirty-seventh
 * from being written. This does.
 *
 * ── Why a lint and not thirty-six tests ───────────────────────────────────
 *
 * The failure is invisible in jsdom, invisible on a desktop browser, and only
 * appears on a real phone with the URL bar showing — which is to say, in manual
 * QA, weeks later. A source rule is the only instrument that catches it at the
 * moment it is introduced.
 *
 * The `dvh` fallback has to be written as a pair of declarations in one CSS
 * rule, so the `vh` fallback applies only where `dvh` is unsupported. Two
 * Tailwind arbitrary classes cannot express that — the winner would be decided
 * by stylesheet order — which is why the utilities exist at all.
 */

import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { resolve, join } from 'node:path'

const SRC = resolve(__dirname, '../../..')

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) {
      if (name === '__tests__' || name === 'node_modules') continue
      walk(p, out)
    } else if (name.endsWith('.tsx') || name.endsWith('.ts')) {
      out.push(p)
    }
  }
  return out
}

const FILES = walk(SRC)
const rel = (p: string) => p.slice(SRC.length + 1).replace(/\\/g, '/')

/** `max-h-[90vh]`, `h-[92vh]`, `min-h-[100vh]` and friends. */
const VH_CLASS = /\b(?:max-|min-)?h-\[\s*(?:\d+(?:\.\d+)?)vh\s*\]/g
/** `style={{ height: 'calc(100vh - 73px)' }}` and its relatives. */
const VH_STYLE = /(?:height|maxHeight|minHeight)\s*:\s*[`'"][^`'"]*\bvh\b/g

describe('the codebase is clean of viewport-height traps', () => {
  it('scans a meaningful number of files, or it is proving nothing', () => {
    expect(FILES.length).toBeGreaterThan(300)
  })

  it('sizes no container with a bare vh class', () => {
    const offenders = FILES
      .map(f => ({ file: rel(f), hits: readFileSync(f, 'utf8').match(VH_CLASS) ?? [] }))
      .filter(x => x.hits.length > 0)
      .map(x => `${x.file}: ${[...new Set(x.hits)].join(', ')}`)

    // Use `h-viewport`, `h-viewport-90`, `max-h-viewport-90` or
    // `max-h-viewport-95` from index.css, or add a sibling utility there in the
    // same one-rule-two-declarations form.
    expect(offenders).toEqual([])
  })

  it('sizes no container with a vh inline style', () => {
    const offenders = FILES
      .map(f => ({ file: rel(f), hits: readFileSync(f, 'utf8').match(VH_STYLE) ?? [] }))
      .filter(x => x.hits.length > 0)
      .map(x => `${x.file}: ${x.hits.join(', ')}`)

    expect(offenders).toEqual([])
  })
})

describe('the utilities the rule points at actually exist', () => {
  const css = readFileSync(resolve(SRC, 'index.css'), 'utf8')

  it.each(['h-viewport', 'h-viewport-90', 'max-h-viewport-90', 'max-h-viewport-95'])(
    '%s is defined',
    name => {
      expect(css).toContain(`.${name} {`)
    },
  )

  it('declares vh then dvh in one rule, so the fallback order is not left to chance', () => {
    for (const name of ['h-viewport-90', 'max-h-viewport-90', 'max-h-viewport-95']) {
      const at = css.indexOf(`.${name} {`)
      const rule = css.slice(at, css.indexOf('}', at))
      const vh = rule.indexOf('vh;')
      const dvh = rule.indexOf('dvh;')
      expect(vh).toBeGreaterThan(0)
      expect(dvh).toBeGreaterThan(vh)
    }
  })
})
