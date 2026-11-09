/**
 * The in-flight meta line must never print the word "undefined".
 *
 * Found by looking at the rendered phone page during release validation: an
 * idea with no `updated_at` showed "No portfolio · undefined" to the reader.
 * `formatAsOf` was typed `(date: string)` and returned its argument back when
 * the value would not parse, so an `undefined` the type said could not exist
 * came straight through into the markup.
 *
 * Source-level, because the helper is module-private and the failure is a
 * rendering one: what matters is that the date part is conditional and that
 * the helper no longer echoes what it was given.
 */

import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

const SRC = fs.readFileSync(
  path.join(__dirname, '../MobileAssetPage.tsx'), 'utf8')
const CODE = SRC
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, '')
  .replace(/^[ \t]*\/\/.*$/gm, '')

describe('formatAsOf cannot leak a non-date', () => {
  it('admits the values callers actually pass', () => {
    expect(CODE).toMatch(/function formatAsOf\(date: string \| null \| undefined\)/)
  })

  it('returns nothing rather than echoing an unparseable value', () => {
    // `return date` was the bug: the argument came back out and was
    // interpolated into the page.
    const fn = CODE.slice(CODE.indexOf('function formatAsOf'))
      .slice(0, CODE.slice(CODE.indexOf('function formatAsOf')).indexOf('\n}') + 2)
    expect(fn).not.toMatch(/return date\b/)
    expect(fn).toContain("if (!date) return ''")
  })
})

describe('the meta line builds every part conditionally', () => {
  it('does not append the date unconditionally', () => {
    expect(CODE).not.toMatch(/\{` · \$\{formatAsOf\(idea\.updated_at\)\}`\}/)
    expect(CODE).toMatch(/idea\.updated_at && ` · \$\{formatAsOf\(idea\.updated_at\)\}`/)
  })

  it('guards every separator-prefixed interpolation', () => {
    /*
     * The class, not the instance: a `· ${…}` fragment appended without a
     * condition prints the separator and whatever the expression resolved to,
     * which is how "undefined" reached the page.
     *
     * Checked per line rather than with one regex over the file — the first
     * version of this assertion was a single pattern that also matched the
     * correctly guarded creator line, and failed a correct file.
     */
    const MARK = '` · ${'
    const unguarded: string[] = []
    for (let at = CODE.indexOf(MARK); at !== -1; at = CODE.indexOf(MARK, at + 1)) {
      /*
       * Look back to the `{` that opens the JSX expression, not to the start
       * of the line. The guard often sits on the line ABOVE the fragment —
       * the creator part wraps — and a per-line check reported that correct
       * code as unguarded.
       */
      const open = CODE.lastIndexOf('{', at)
      const expr = CODE.slice(open, at)
      if (!expr.includes('&&') && !expr.includes('?')) {
        unguarded.push(CODE.slice(open, at + 40).replace(/\s+/g, ' '))
      }
    }
    expect(unguarded, unguarded.join('\n')).toEqual([])
  })
})
