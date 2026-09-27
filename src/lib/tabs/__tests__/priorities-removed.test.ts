/**
 * The standalone Priorities app is gone.
 *
 * Deleting a surface is easy to do incompletely: the page goes, and a launcher
 * tile, a nav row or a palette entry stays behind pointing at nothing. This
 * reads the actual registries rather than trusting that the deletion was
 * thorough, so a re-introduction has to be deliberate.
 *
 * The other half — that a saved session still opens something — lives in
 * `legacy-tab-aliases.test.ts` beside the alias that does the work.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { MOBILE_SURFACES, getMobileNavSurfaces } from '../../mobile/mobile-surfaces'
import { LEGACY_TAB_ALIASES, canonicalTabTarget } from '../legacy-tab-aliases'

const RETIRED = ['priorities', 'prioritizer'] as const
const src = (rel: string) => readFileSync(resolve(process.cwd(), 'src', rel), 'utf8')

describe('the Priorities app is absent from every registry', () => {
  it('is not a registered mobile surface under either id', () => {
    for (const type of RETIRED) {
      expect(MOBILE_SURFACES.find(s => s.type === type)).toBeUndefined()
    }
  })

  it('has no mobile nav row', () => {
    const nav = getMobileNavSurfaces('core')
    for (const type of RETIRED) {
      expect(nav.some(s => s.type === type)).toBe(false)
    }
    // And nothing is left labelled with the old name.
    expect(nav.some(s => /priorit/i.test(s.title))).toBe(false)
  })

  it('has no desktop launcher entry', () => {
    // The "Go to" grid on every new tab.
    expect(src('components/tabs/BlankTab.tsx')).not.toMatch(/type: 'priorit/)
  })

  it('has no header nav entry', () => {
    expect(src('components/layout/Header.tsx')).not.toMatch(/type: 'priorit/)
  })

  it('has no command-palette entry', () => {
    expect(src('hooks/useObjectSearch.ts')).not.toMatch(/id: 'priorit/)
  })

  it('has no tab type, singleton entry or icon case', () => {
    const tabManager = src('components/layout/TabManager.tsx')
    expect(tabManager).not.toMatch(/'priorities'/)
    expect(tabManager).not.toMatch(/'prioritizer'/)
  })

  it('has no full-width layout entry', () => {
    expect(src('components/layout/Layout.tsx')).not.toMatch(/'priorit/)
  })

  it('has no render path left in the shell', () => {
    const dashboard = src('pages/DashboardPage.tsx')
    expect(dashboard).not.toMatch(/PrioritizerPage/)
    expect(dashboard).not.toMatch(/case 'priorit/)
  })

  it('has no pilot access gate for a surface that does not exist', () => {
    expect(src('lib/pilot/pilot-access.ts')).not.toMatch(/priorities/)
  })
})

describe('nothing can navigate to it', () => {
  it('rewrites every retired descriptor before it reaches the shell', () => {
    // `canonicalTabTarget` sits in front of the navigation funnel, so a
    // descriptor from a deep link, an event or a search result cannot arrive
    // at a render path that no longer exists.
    for (const type of RETIRED) {
      const out = canonicalTabTarget({ id: type, type, title: 'My Priorities' })
      expect(out.type).toBe('today')
      expect(out.id).toBe('today')
    }
  })

  it('keeps both retired ids aliased, not merely deleted', () => {
    for (const type of RETIRED) {
      expect(LEGACY_TAB_ALIASES[type]).toBeDefined()
    }
  })
})

describe('the shared attention system is untouched', () => {
  it('still exports the hook the page was built on', async () => {
    // Priorities was a shell over this; Today, the feed and the tile engine
    // read the same thing. Deleting the shell must not cascade.
    const mod = await import('../../../hooks/useAttention')
    expect(typeof mod.useAttention).toBe('function')
  })

  it('still exports the section component the page rendered', async () => {
    const mod = await import('../../../components/attention/AttentionSection')
    expect(mod.AttentionSection).toBeDefined()
  })

  it('keeps the attention type ranking used by the feed', async () => {
    const mod = await import('../../../types/attention')
    expect(mod.ATTENTION_TYPE_PRIORITY).toBeDefined()
    expect(Object.keys(mod.ATTENTION_TYPE_PRIORITY).length).toBeGreaterThan(0)
  })
})
