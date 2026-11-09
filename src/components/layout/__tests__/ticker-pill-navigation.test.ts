/**
 * A ticker pill in the AI pane has to go somewhere.
 *
 * ── The defect ───────────────────────────────────────────────────────────
 *
 * `AISection` renders every $TICKER the model mentions as a pill and
 * dispatches `open-asset-by-symbol` when one is clicked. Nothing anywhere in
 * the app listened for that event. Its own comment admitted it: "Until that
 * listener is wired, the pill renders but clicks are a no-op -- visual win
 * first, navigation later."
 *
 * So the pane offered a control that looked exactly like a link, highlighted
 * on hover, and did nothing. A dispatch with no subscriber fails silently by
 * construction: no error, no console warning, nothing for a test that mounts
 * the pane to observe.
 *
 * ── Why these read the source ────────────────────────────────────────────
 *
 * The listener lives in `Layout`, which mounts the whole app shell (header,
 * tab manager, comm pane, notification pane, org context, media queries) and
 * cannot be rendered affordably in a unit test. The claim here is about a
 * wiring seam rather than a rendered output, so both halves are pinned
 * against source: the dispatcher names the event, and a listener for that
 * exact name exists and opens a tab.
 *
 * The pairing is the point. Either half alone is satisfiable while the pill
 * stays dead, which is exactly how it stayed dead.
 */

import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, it, expect } from 'vitest'

const src = (p: string) => readFileSync(path.join(process.cwd(), 'src', p), 'utf8')

const EVENT = 'open-asset-by-symbol'
const layout = src('components/layout/Layout.tsx')
const aiSection = src('components/communication/AISection.tsx')

/**
 * The whole effect: the async resolver plus the sync listener wrapped around
 * it, up to the registration.
 *
 * Sliced rather than matched against the whole 1,000-line file so a
 * `.from('assets')` or an `onSearchResult` belonging to some other seam here
 * cannot satisfy a claim about this one.
 */
const handler = () => {
  const from = layout.indexOf('const openAsset = async')
  const to = layout.indexOf(`window.addEventListener('${EVENT}'`)
  expect(from, 'no openAsset resolver in Layout').toBeGreaterThan(-1)
  expect(to, `no ${EVENT} registration in Layout`).toBeGreaterThan(from)
  return layout.slice(from, to)
}

describe('the AI pane\'s ticker pills open the asset', () => {
  it('still dispatches the event the pill was built on', () => {
    expect(aiSection).toContain(`new CustomEvent('${EVENT}'`)
    // The payload is a bare symbol, which is all the pane has.
    expect(aiSection).toMatch(/new CustomEvent\('open-asset-by-symbol', \{ detail: \{ symbol \} \}\)/)
  })

  it('has a listener for it, which is what was missing', () => {
    expect(layout, `nothing listens for ${EVENT}`)
      .toContain(`window.addEventListener('${EVENT}'`)
    // Registered and torn down, so remounting the shell does not stack
    // handlers that each open their own tab for one click.
    expect(layout).toContain(`window.removeEventListener('${EVENT}'`)
  })

  it('resolves the symbol to an asset, because a tab needs the id', () => {
    const h = handler()
    expect(h).toMatch(/\.from\('assets'\)/)
    // Case-insensitive: a model writes "$aapl" as readily as "$AAPL".
    expect(h).toMatch(/\.ilike\('symbol', symbol\)/)
    // Only the columns the tab needs. `assets` has restricted columns of its
    // own (see src/lib/security/__tests__/assets-restricted-columns.test.ts),
    // so a `select('*')` here would widen what this path reads.
    expect(h).toMatch(/\.select\('id, symbol, company_name, sector'\)/)
    expect(h).not.toMatch(/\.select\('\*'\)/)
    // And it opens the tab through the same seam the global search uses,
    // rather than a second way of creating one.
    expect(h).toMatch(/onSearchResult\?\.\(\{/)
    expect(h).toMatch(/type: 'asset'/)
  })

  it('switches to an open tab instead of opening a second one', () => {
    const h = handler()
    /* Matched on the tab's SYMBOL, which is what this event carries. Matching
       on id would never hit, because resolving the id is the step the early
       return exists to skip. */
    expect(h).toMatch(/tabs\.find\(/)
    expect(h).toMatch(/t\.type === 'asset'/)
    expect(h).toMatch(/\.toUpperCase\(\) === symbol\.toUpperCase\(\)/)
    expect(h).toMatch(/onTabChange\(open\.id\)/)
  })

  it('says nothing when the symbol resolves to nothing', () => {
    const h = handler()
    /* A model can invent a ticker. An error toast for a plausible-looking
       hallucination blames the reader for the model's guess, so both the empty
       detail and the unresolved symbol return quietly. */
    expect(h).toMatch(/if \(!symbol\) return/)
    expect(h).toMatch(/if \(!found\) return/)
  })

  it('registers a sync listener, so no async handler is cast to EventListener', () => {
    /*
     * The first draft was `async (event: CustomEvent)` registered with
     * `as EventListener`, which is two type errors TypeScript is right about:
     * a CustomEvent handler is not an EventListener, and the promise it
     * returns is discarded. A sync wrapper that `void`s the async work says
     * the same thing without a cast, and `guard:types` holds at its ceiling.
     */
    expect(layout).toMatch(/const handleOpenAssetBySymbol = \(event: Event\) =>/)
    expect(layout).toMatch(/void openAsset\(symbol\)/)
    expect(layout).toContain(`window.addEventListener('${EVENT}', handleOpenAssetBySymbol)`)
    expect(layout).not.toMatch(/handleOpenAssetBySymbol as EventListener/)
  })
})
