/**
 * A tab type that renders a supported page must not be told it is desktop-only.
 *
 * ── The defect this pins ──────────────────────────────────────────────────
 *
 * Unregistered types default to `desktop-only`, on purpose — a new surface
 * added without a mobile decision should show an honest card rather than a
 * desktop layout squeezed into 390px. The cost of that default is that a
 * DETAIL type is easy to forget, and several were.
 *
 * DashboardPage renders `workflow`, `workflow-template`, `notebook`,
 * `calendar-event`, `allocation-period`, `prioritizer`, `model-template` and
 * `text-template` through the SAME component as a list type that is already
 * registered as usable on a phone. So the list opened, you tapped a row, and
 * the identical page came back as "this is desktop only" — the registry
 * contradicting itself one navigation step apart.
 *
 * The pairs below are the claim: these types render the same surface, so they
 * carry the same support level. If a route is ever repointed at a genuinely
 * different component, this test is where that shows up.
 */

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import {
  MOBILE_SURFACES,
  getMobileSupport,
  isDesktopOnly,
} from '../mobile-surfaces'

/** detail type → the registered list type it renders the same page as. */
const SAME_SURFACE_AS: Array<[detail: string, list: string]> = [
  ['prioritizer', 'priorities'],
  ['notebook', 'notes-list'],
  ['calendar-event', 'calendar'],
  ['workflow', 'workflows'],
  ['workflow-template', 'workflows'],
  ['model-template', 'templates'],
  ['text-template', 'templates'],
  ['allocation-period', 'asset-allocation'],
]

describe('detail types inherit the support level of the page they render', () => {
  it.each(SAME_SURFACE_AS)('%s matches %s', (detail, list) => {
    expect(getMobileSupport(detail)).toBe(getMobileSupport(list))
  })

  it.each(SAME_SURFACE_AS)('%s no longer dead-ends on a phone', detail => {
    expect(isDesktopOnly(detail)).toBe(false)
  })
})

describe('the registry describes real tab types', () => {
  const dashboard = readFileSync(
    resolve(__dirname, '../../../pages/DashboardPage.tsx'),
    'utf8',
  )

  it('names a type DashboardPage actually renders, for every entry', () => {
    // A registered type that no route renders is a support promise about
    // nothing — and, worse, hides the type that IS rendered behind it.
    const unrouted = MOBILE_SURFACES
      .map(s => s.type)
      .filter(type => !dashboard.includes(`'${type}'`))

    expect(unrouted).toEqual([])
  })

  it('registers each type exactly once', () => {
    const types = MOBILE_SURFACES.map(s => s.type)
    expect(types).toHaveLength(new Set(types).size)
  })
})
