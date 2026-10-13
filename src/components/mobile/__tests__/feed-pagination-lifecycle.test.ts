/**
 * The feed's pagination must survive leaving the feed and coming back.
 *
 * ── The bug ──────────────────────────────────────────────────────────────
 *
 * Reported from pilot testing: open the mobile Ideas feed, go elsewhere in
 * Tesseract, come back, and scrolling no longer advances to the next tile.
 *
 * Explore and the feed are the two arms of one ternary in `MobileDashboard`
 * (`mode === 'explore' ? … : …`), so leaving the feed unmounts its subtree —
 * scroller, slots and the pagination sentinel — while the component itself
 * stays mounted and keeps all of its state and refs.
 *
 * The sentinel was attached with `useRef`. Writing to a ref does not render,
 * and the IntersectionObserver effect depended only on the values that decide
 * WHETHER to fetch, none of which change on a return. The effect never re-ran,
 * so the observer kept watching the detached node — which can never intersect
 * again — and `fetchNextPage()` / `setCycle(c => c + 1)` stopped firing for
 * the rest of the session.
 *
 * The feed was never "stuck". It had stopped GROWING, and from a thumb at the
 * bottom of the list those are the same thing.
 *
 * ── What is tested where ─────────────────────────────────────────────────
 *
 * The behaviour is proven in a real browser by
 * `desktop-harness/probe-feed-sentinel.mjs`, which runs the reported sequence
 * against both attachment styles and shows the bug reproducing on the shipped
 * one (8 -> 16 tiles, then frozen at 16) and not on the fix (8 -> 16 -> 24 ->
 * 32). That probe exercises a faithful miniature, because `MobileDashboard`
 * is 9,000 lines behind Supabase, a signed-in org and live holdings.
 *
 * This file is the other half: it pins the real component to the shape the
 * probe proved correct, so the file cannot drift back while the probe keeps
 * passing against its miniature.
 */

import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

const SRC = fs.readFileSync(
  path.resolve(__dirname, '../MobileDashboard.tsx'), 'utf8')

/** Comments stripped, so the explanation above the fix cannot satisfy a check. */
const CODE = SRC
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, '')
  .replace(/^[ \t]*\/\/.*$/gm, '')

/** The IntersectionObserver effect, from its `useEffect` to its dependency list. */
function sentinelEffect(): string {
  const at = CODE.indexOf('new IntersectionObserver')
  expect(at, 'the pagination observer should still exist').toBeGreaterThan(-1)
  const start = CODE.lastIndexOf('useEffect(', at)
  const end = CODE.indexOf('])', CODE.indexOf('observer.disconnect()', at))
  return CODE.slice(start, end + 2)
}

describe('the pagination sentinel survives a remount', () => {
  it('is attached through state, not a ref', () => {
    /*
     * The distinction IS the bug. A ref write does not render, so no effect
     * can learn that the element was replaced.
     */
    expect(CODE).toMatch(/const \[sentinel, setSentinel\] = useState<HTMLDivElement \| null>\(null\)/)
    expect(CODE).toContain('ref={setSentinel}')
    expect(CODE).not.toMatch(/sentinelRef/)
  })

  it('observes the element from state rather than reading a ref', () => {
    const effect = sentinelEffect()
    expect(effect).toContain('observer.observe(sentinel)')
    expect(effect).not.toMatch(/\.current/)
  })

  it('lists the element in the effect dependencies', () => {
    /*
     * Without this the effect cannot re-run when the feed remounts, which is
     * the entire failure. The other dependencies decide WHETHER to fetch;
     * this one decides whether the observer is attached to anything real.
     */
    const effect = sentinelEffect()
    const deps = effect.slice(effect.lastIndexOf('}, ['))
    expect(deps).toContain('sentinel')
  })

  it('still cleans up, so a remount cannot leave two observers', () => {
    expect(sentinelEffect()).toContain('observer.disconnect()')
  })
})

describe('the scroller keeps the pattern that already worked', () => {
  it('is attached through state as well', () => {
    // `attachScroller` -> `setScroller` is why position restoration survived
    // the same remount that killed pagination. It must not regress to a ref.
    expect(CODE).toMatch(/const \[scroller, setScroller\] = useState<HTMLDivElement \| null>\(null\)/)
    expect(CODE).toContain('ref={attachScroller}')
  })
})

describe('the end of a feed is still an end', () => {
  it('only cycles when there is a feed to cycle', () => {
    /*
     * The fix re-arms the observer; it must not make an empty or exhausted
     * feed grow. `setCycle` stays behind the "is there a feed at all" guard,
     * and `fetchNextPage` behind `hasNextPage`.
     */
    const effect = sentinelEffect()
    expect(effect).toMatch(/if \(hasNextPage && !isFetchingNextPage\)/)
    expect(effect).toMatch(/else if \(baseFeedEntries\.length > 0\)/)
    expect(effect).toContain('setCycle(c => c + 1)')
  })

  it('does not manufacture tiles anywhere in the observer', () => {
    // Guarding the instruction directly: no filler, no loosened eligibility.
    const effect = sentinelEffect()
    expect(effect).not.toMatch(/placeholder|filler|dummy|fake/i)
  })
})
