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

  it('offers explicit My Research and Organization perspectives', () => {
    expect(ASSET_TAB).toContain('>My Research<') // the pill
    expect(ASSET_TAB).toMatch(/chooseResearchView\(user\.id\)/)
    expect(ASSET_TAB).toContain('Organization')
    // self is not duplicated as an analyst pill
    expect(ASSET_TAB).toMatch(/researchAnalysts\.filter\(a => a\.id !== user\?\.id\)/)
  })

  it('Organization is read-only with a clearly-visible Edit my research action', () => {
    expect(ASSET_TAB).toContain('Edit my research')
    expect(ASSET_TAB).toMatch(/Read-only firm view/)
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

  it('the context strip gained a band variant (navy cells), default unchanged', () => {
    expect(STRIP).toMatch(/variant\s*=\s*'default'/)
    expect(STRIP).toContain("variant === 'band'")
    expect(STRIP).toContain('ux2-strip-cell')
  })
})
