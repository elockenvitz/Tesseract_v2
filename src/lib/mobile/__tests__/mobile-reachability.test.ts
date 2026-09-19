/**
 * Anything a phone can be handed, a phone can open.
 *
 * ── The defect this pins ──────────────────────────────────────────────────
 *
 * `MobileSearchOverlay` is the phone's primary way of getting anywhere: the
 * drawer's first row is a search field, and BlankTab offers the same overlay.
 * Whatever it returns goes straight to `handleSearchResult`, which opens a tab
 * of that type. Unregistered types default to desktop-only, on purpose, so
 * every search result type that has no registry entry becomes a dead end one
 * tap after a successful search.
 *
 * Three were: `user`, `team` and `model-file`. Searching a colleague's name on
 * a phone found them, and opening the result said the surface was desktop
 * only — for a page that is a stack of cards.
 *
 * The page shortcuts had a second problem. `handleSearchResult` opens a tab
 * whose id is the shortcut's id and activates an existing tab with that id, so
 * the home shortcut pointing at the legacy `dashboard` built a SECOND home
 * beside the canonical one. On a phone both render the ideas feed, so
 * searching "home" left two tabs called Ideas and landed on the wrong one.
 *
 * These read the search source rather than a hand-copied list, so a new result
 * type forces a mobile decision instead of silently defaulting to a dead end.
 */

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { getMobileSupport, isDesktopOnly } from '../mobile-surfaces'
import { STATIC_PAGES } from '../../../hooks/useObjectSearch'
import { CANONICAL_HOME_TAB, LEGACY_DASHBOARD_ID } from '../../tabStateManager'

const searchSource = readFileSync(
  resolve(__dirname, '../../../hooks/useObjectSearch.ts'),
  'utf8',
)

/**
 * The types the search hook actually emits, read off its own source. `page` is
 * excluded: it is resolved into a real tab type before navigation, and the
 * shortcuts it resolves to are covered separately below.
 */
const EMITTED_TYPES = [
  ...new Set(
    Array.from(searchSource.matchAll(/type: '([a-z-]+)' as const/g)).map(m => m[1]),
  ),
].filter(t => t !== 'page').sort()

describe('every object search can return is reachable on a phone', () => {
  it('emits a set of types worth checking', () => {
    // Guards the regex: if the source stops matching, the suite below would
    // pass by testing nothing at all.
    expect(EMITTED_TYPES.length).toBeGreaterThan(5)
    expect(EMITTED_TYPES).toContain('asset')
  })

  it.each(EMITTED_TYPES)('opens %s rather than a desktop-only card', type => {
    expect(isDesktopOnly(type)).toBe(false)
  })
})

describe('every page shortcut resolves to a real mobile surface', () => {
  const shortcuts = STATIC_PAGES.map(p => p.id)

  it('lists shortcuts', () => {
    expect(shortcuts.length).toBeGreaterThan(5)
  })

  it.each(shortcuts)('%s is registered and usable on a phone', id => {
    expect(getMobileSupport(id)).not.toBe('desktop-only')
  })
})

describe('the home shortcut is the canonical home', () => {
  const home = STATIC_PAGES.find(p =>
    (p.keywords as readonly string[] | undefined)?.includes('home'),
  )

  it('exists', () => {
    expect(home).toBeTruthy()
  })

  it('points at the canonical home tab, so search activates it', () => {
    expect(home?.id).toBe(CANONICAL_HOME_TAB.id)
  })

  it('never points at the legacy id, which would open a second home', () => {
    // handleSearchResult opens a tab whose id is this one. The legacy id is a
    // different tab, so it appeared alongside the real home rather than
    // activating it — two tabs called Ideas, landing on the wrong one.
    expect(STATIC_PAGES.map(p => p.id)).not.toContain(LEGACY_DASHBOARD_ID)
  })
})
