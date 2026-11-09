import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'

/**
 * UX2 Phase 1 — foundation (header, collapse, perspective, attention popover,
 * Ask AI relocation, scoped tokens).
 *
 * AssetTab is ~5,000 lines and cannot be mounted affordably, so — like the
 * other AssetTab suites — these pin the wiring against comment-stripped source.
 * Each assertion targets a specific, behaviour-bearing line so it fails if the
 * foundation is reverted. The attention RESOLVER and signal rendering keep their
 * own behavioural coverage in the attention suites; here we only prove the
 * popover reuses them rather than forking a second path.
 */

const SRC = resolve(__dirname, '../../..')
const codeOf = (s: string) =>
  s.split('\n').map(l => l.replace(/\/\/.*$/, '')).join('\n').replace(/\/\*[\s\S]*?\*\//g, '')

const ASSET_TAB = codeOf(readFileSync(resolve(SRC, 'components/tabs/AssetTab.tsx'), 'utf8'))
const BAND = codeOf(readFileSync(resolve(SRC, 'components/asset/AssetAttentionBand.tsx'), 'utf8'))
const STRIP = codeOf(readFileSync(resolve(SRC, 'components/asset/AssetContextStrip.tsx'), 'utf8'))
const HEADER = codeOf(readFileSync(resolve(SRC, 'components/asset/AssetWorkspaceHeader.tsx'), 'utf8'))
const VWI = codeOf(readFileSync(resolve(SRC, 'components/outcomes/ViewWarningIndicator.tsx'), 'utf8'))

describe('UX2 P1: perspective — My Research is the fresh-visit default', () => {
  it('a persisted perspective is NOT restored on init (no stale-Firm override)', () => {
    // The three init seeds must not read a saved researchViewFilter any more.
    expect(ASSET_TAB).not.toMatch(/savedState\?\.researchViewFilter/)
  })

  it('the default resolver lands on the reader\'s own view, even with no case', () => {
    // Was gated on `researchAnalysts.some(a => a.id === user.id)` (i.e. only if
    // they had written). Now any signed-in user defaults to My Research.
    expect(ASSET_TAB).toMatch(/if \(user\?\.id\) \{[\s\S]{0,80}setResearchViewFilter\(user\.id\)/)
    expect(ASSET_TAB).not.toMatch(/const mine = user\?\.id && researchAnalysts\.some/)
  })

  // Re-pointed from 'Organization' to 'Firm'. Phase 1 named this pill
  // "Organization (firm valuation)", which described what the pane held at the
  // time: only numbers. The pane has since taken the words back (the
  // attributed per-field record, and now the synthesis that used to be its own
  // read mode), so the label names WHOSE view it is instead. "Firm" is also
  // the product's existing word for this scope -- visibility is
  // team | division | firm -- and "Team" would have named the narrowest of the
  // three while showing the widest.
  it('offers explicit My Research and Firm perspectives', () => {
    expect(ASSET_TAB).toContain('>My Research<') // the pill
    expect(ASSET_TAB).toMatch(/chooseResearchView\(user\.id\)/)
    expect(ASSET_TAB).toMatch(/<Users className="w-3\.5 h-3\.5" \/>\s*Firm\s*<\/button>/)
    // self is not duplicated as an analyst pill
    expect(ASSET_TAB).toMatch(/researchAnalysts\.filter\(a => a\.id !== user\?\.id\)/)
  })

  it('the Firm perspective is read-only with a clearly-visible Edit my research action', () => {
    expect(ASSET_TAB).toContain('Edit my research')
    expect(ASSET_TAB).toMatch(/Read-only firm view/)
    // The banner now names all three layers, because the middle one is
    // generated and a reader must not take it for the computed numbers above
    // it or for somebody's authored view below it.
    expect(ASSET_TAB).toMatch(/aggregated valuation, a generated synthesis, and each analyst's own research/)
    expect(ASSET_TAB).toMatch(/Not a firm-authored conclusion/)
  })
})

describe('UX2 P1: attention — one resolver, shown as a header popover', () => {
  it('the popover variant reuses the same hook and AttentionBand (no 2nd path)', () => {
    expect(BAND).toMatch(/variant\s*=\s*'inline'/) // opt-in; default keeps callers
    expect(BAND).toContain("variant === 'popover'")
    // the popover renders the SAME AttentionBand over the resolver's signals
    expect(BAND).toMatch(/<AttentionBand state=\{state\} signals=\{signals\}/)
  })

  it('the ⚡ count is signals.length and selecting closes then navigates', () => {
    expect(BAND).toMatch(/const n = signals\.length/)
    expect(BAND).toMatch(/onOpen=\{\(d, f\) => \{ setOpen\(false\); onFocus\(d, f\) \}\}/)
  })

  it('AssetTab no longer renders a persistent in-body attention band', () => {
    expect(ASSET_TAB).not.toContain('<AssetAttentionBand')
    // and the header mounts the popover variant
    expect(HEADER).toContain('variant="popover"')
  })

  it('the ⚡ is the single attention affordance — the view-warnings badge is distinct', () => {
    // UX2 P1 closure: ViewWarningIndicator is integrity/consistency checks, not
    // asset-level attention. It must NOT use the ⚡ bolt or claim "Attention",
    // so the header ⚡ is the one recognizable attention entry point.
    expect(VWI).not.toContain('Zap')
    expect(VWI).toContain('View checks') // the badge/popover no longer says "Attention"
    // still a real, functioning warnings surface (not removed)
    expect(VWI).toContain('AlertTriangle')
  })
})

describe('UX2 P1 closure: the inert legacy header is gone', () => {
  it('no false-gated legacy header block remains', () => {
    expect(ASSET_TAB).not.toContain('LEGACY header block')
    expect(ASSET_TAB).not.toMatch(/\{false && \(/)
    // and the symbols only that block used are no longer imported
    expect(ASSET_TAB).not.toMatch(/import \{ StockQuote \}/)
    expect(ASSET_TAB).not.toMatch(/import \{ CoverageDisplay \}/)
  })
})

describe('UX2 P1: header — one navy band, collapsible, Ask AI relocated', () => {
  it('AssetTab mounts the new workspace header and drops the arrival bar', () => {
    expect(ASSET_TAB).toContain('<AssetWorkspaceHeader')
    expect(ASSET_TAB).not.toContain('<AssetArrivalBar')
    expect(ASSET_TAB).not.toMatch(/function AssetArrivalBar/)
  })

  it('collapse state is wired and persisted (per-viewer convenience)', () => {
    expect(ASSET_TAB).toContain('headerCollapsed')
    expect(ASSET_TAB).toContain('toggleHeaderCollapsed')
    expect(ASSET_TAB).toMatch(/collapsed=\{headerCollapsed\}/)
    expect(ASSET_TAB).toContain('ux2-asset-header-collapsed')
  })

  it('the header relocates Ask AI (same engagement target) into the band', () => {
    expect(HEADER).toContain('askAI(askTarget)')
    expect(HEADER).toMatch(/objectType: 'asset'/)
    // collapsed hides the strip, keeping identity + actions + (page) tabs
    expect(HEADER).toMatch(/!collapsed && \(/)
  })
})

describe('UX2 P1: scoped tokens do not touch the global theme', () => {
  it('ships a scoped stylesheet imported by AssetTab under a .ux2-scope root', () => {
    expect(existsSync(resolve(SRC, 'components/asset/asset-ux2.css'))).toBe(true)
    const css = readFileSync(resolve(SRC, 'components/asset/asset-ux2.css'), 'utf8')
    expect(css).toContain('.ux2-scope')
    expect(css).toContain('--ux2-band')
    expect(ASSET_TAB).toContain("import '../asset/asset-ux2.css'")
    expect(ASSET_TAB).toMatch(/className="asset-ux2 ux2-scope/)
  })

  it('does not edit the global tailwind primary or index.css', () => {
    const tw = readFileSync(resolve(SRC, '../tailwind.config.js'), 'utf8')
    // primary stays the app blue (#2563eb at 600); tokens are scoped, not global
    expect(tw).toContain("600: '#2563eb'")
  })

  it('the context strip has a band variant, default unchanged', () => {
    expect(STRIP).toMatch(/variant\s*=\s*'default'/)
    expect(STRIP).toContain("variant === 'band'")
    // Band is now a compact inline row (thin dividers, no boxed tiles); the
    // default variant keeps its tiled grid.
    // Rewritten, not deleted: the strip's dividers moved off --ux2-band-line
    // onto their own --ux2-strip-line. They shared the band's bottom hairline
    // at 8% alpha — about 1.1:1 on white, invisible — and once the cells
    // spread across the row they became the only cue that these are five
    // separate facts. The band hairline itself is unchanged and still meant to
    // be barely there, which is why this is a second token rather than a
    // darker first one.
    expect(STRIP).toContain('divide-x divide-[color:var(--ux2-strip-line)]')
  })
})
