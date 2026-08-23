#!/usr/bin/env node
/**
 * Nothing the gallery can reach may import Supabase.
 *
 * ── Why this exists ───────────────────────────────────────────────────────
 *
 * `src/lib/supabase.ts` THROWS at module load when its environment variables
 * are absent, and the gallery is a separate Vite entry with no environment at
 * all. So a single import anywhere in its reachable graph does not degrade the
 * page — it kills it before React mounts.
 *
 * That failure is invisible in the worst way. The page is blank, so every
 * layout test waits its full 30-second timeout for an element that will never
 * appear, and a suite that runs in 27 seconds instead takes an hour and
 * reports timeouts rather than the actual cause. It has happened three times:
 *
 *   - `useDerivedInsights` pulled in for one pure mapping function
 *   - `TileSparkline` pulled in by `MobileExplore` for a chart
 *   - `stale-signal` extracted from a hook precisely to avoid this, and then
 *     re-imported through the hook again
 *
 * Every one was a one-line import that reads as obviously harmless, and none
 * of them is visible to TypeScript: the types are fine, the module graph is
 * the problem.
 *
 * ── What it does ──────────────────────────────────────────────────────────
 *
 * Walks the import graph from each gallery entry and fails on the first
 * module that reaches Supabase, printing the CHAIN rather than the file. The
 * offender is never the interesting part — the interesting part is which
 * innocuous-looking import dragged it in, and that is what the chain shows.
 *
 * Static, not a build: no bundler, no execution, so it runs in a second and
 * cannot be defeated by a module that only throws at runtime.
 */

import { readFileSync, existsSync } from 'node:fs'
import { dirname, resolve, relative } from 'node:path'

const ROOT = resolve(import.meta.dirname, '..')

/** Everything the gallery bundle starts from. */
const ENTRIES = ['gallery/main.tsx']

/**
 * The module that must stay unreachable.
 *
 * Matched by resolved path rather than by specifier, so `../../lib/supabase`,
 * `@/lib/supabase` and any future alias all land on the same file.
 */
const FORBIDDEN = resolve(ROOT, 'src/lib/supabase.ts')

const EXTS = ['.ts', '.tsx', '.js', '.jsx', '.mjs']

/** Resolve a relative specifier to a file on disk, or null for a bare import. */
function resolveSpecifier(spec, fromFile) {
  // Bare specifiers are node_modules. They cannot reach our source.
  if (!spec.startsWith('.')) return null
  const base = resolve(dirname(fromFile), spec)
  if (existsSync(base) && !base.endsWith('/')) {
    // An exact hit only counts when it is a file, not a directory.
    try { if (readFileSync(base) instanceof Buffer && /\.\w+$/.test(base)) return base } catch { /* dir */ }
  }
  for (const ext of EXTS) {
    const withExt = base + ext
    if (existsSync(withExt)) return withExt
  }
  for (const ext of EXTS) {
    const asIndex = resolve(base, `index${ext}`)
    if (existsSync(asIndex)) return asIndex
  }
  return null
}

/**
 * Every specifier a file imports.
 *
 * Covers static imports, side-effect imports, re-exports and dynamic
 * `import()`. Re-exports matter as much as imports: `export { x } from './y'`
 * loads `y` exactly the same way, and that is how the hook came back the third
 * time.
 */
function specifiersIn(source) {
  const out = []
  /**
   * `import type` is skipped, and that distinction is the whole accuracy of
   * this check.
   *
   * A type-only import is erased by the compiler, so it never loads the module
   * and cannot trip the throw. Counting them flags `legacy-kinds.ts`, which
   * imports the `DerivedInsight` TYPE from a hook — correct, harmless, and
   * exactly the false positive that gets a guard disabled within a week.
   *
   * Only the explicit `import type` / `export type` forms are skipped. An
   * inline `import { type Foo, bar }` still loads the module for `bar`, and a
   * bundler may emit the import even when every binding is inline-typed, so
   * those stay in.
   */
  const patterns = [
    /\bimport\s+(?!type\s)[^'"]*?from\s*['"]([^'"]+)['"]/g,
    /\bimport\s*['"]([^'"]+)['"]/g,
    /\bexport\s+(?!type\s)[^'"]*?from\s*['"]([^'"]+)['"]/g,
    /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  ]
  for (const re of patterns) {
    let m
    while ((m = re.exec(source))) out.push(m[1])
  }
  return out
}

const rel = f => relative(ROOT, f).replace(/\\/g, '/')

/** Breadth-first, so the chain reported is the SHORTEST route to the offender. */
function findChain(entry) {
  const start = resolve(ROOT, entry)
  if (!existsSync(start)) {
    console.error(`gallery-purity: entry not found: ${entry}`)
    process.exit(2)
  }
  const seen = new Set([start])
  const queue = [[start]]

  while (queue.length) {
    const chain = queue.shift()
    const file = chain[chain.length - 1]

    let source
    try { source = readFileSync(file, 'utf8') } catch { continue }

    for (const spec of specifiersIn(source)) {
      const target = resolveSpecifier(spec, file)
      if (!target) continue
      if (target === FORBIDDEN) return [...chain, target]
      if (seen.has(target)) continue
      seen.add(target)
      queue.push([...chain, target])
    }
  }
  return null
}

let failed = false
let checked = 0

for (const entry of ENTRIES) {
  const chain = findChain(entry)
  checked++
  if (chain) {
    failed = true
    console.error(`\ngallery-purity: ${entry} can reach src/lib/supabase.ts\n`)
    chain.forEach((f, i) => {
      console.error(`  ${'  '.repeat(i)}${i === 0 ? '' : '└─ '}${rel(f)}`)
    })
    console.error(`
  The gallery has no Supabase environment, and lib/supabase throws at module
  load without one — so this does not degrade the page, it kills it before
  React mounts. Every layout test then waits its full timeout for an element
  that never appears.

  Fix the link second from the bottom, not the bottom one. Either move the
  pure part into a module with no Supabase dependency, or pass it in as a prop
  so the gallery can inject a fixture version.
`)
  }
}

if (failed) process.exit(1)

// Proof of work: an exit code is not evidence a check ran. See handoff.md §4.
console.log(`gallery-purity: ${checked} entr${checked === 1 ? 'y' : 'ies'} clean — no path to src/lib/supabase.ts`)
