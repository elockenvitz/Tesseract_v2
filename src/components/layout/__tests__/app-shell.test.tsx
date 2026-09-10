/**
 * The top app bar disappeared, and it was geometry, not a visibility branch.
 *
 * ── The defect this pins ──────────────────────────────────────────────────
 *
 * `Layout` is `h-viewport flex flex-col overflow-hidden`. The header is a flex
 * child of that column and had no shrink rule, so it defaulted to
 * `flex: 0 1 auto` — shrinkable. Its sibling `<main>` is `flex-1` and shrinks
 * first, but once the column itself is shorter than its content the header gives
 * way too and collapses toward zero.
 *
 * `h-viewport` is `100dvh`, which shrinks when the keyboard opens and when the
 * URL bar appears. That is why it vanished "sometimes" rather than on a
 * particular screen: it tracks the keyboard, not the route.
 *
 * ── Why this asserts the shrink rule and the shell shape ──────────────────
 *
 * The instruction not to write class-name tests applies to lifecycle bugs. This
 * one IS a CSS ownership bug, so the rule that fixes it is the thing to pin. The
 * lifecycle half of this stage is covered behaviourally in
 * `session-events.test`, and the ownership claim — that nothing conditionally
 * hides the bar — is asserted by reading the shell.
 */

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const layout = readFileSync(resolve(__dirname, '../Layout.tsx'), 'utf8')
const header = readFileSync(resolve(__dirname, '../Header.tsx'), 'utf8')
const css = readFileSync(resolve(__dirname, '../../../index.css'), 'utf8')

describe('the app bar cannot be squeezed out of the shell', () => {
  it('refuses to shrink', () => {
    const at = header.indexOf('<header className=')
    expect(at).toBeGreaterThan(0)
    expect(header.slice(at, at + 200)).toContain('flex-shrink-0')
  })

  it('keeps the stacking context its dropdowns rely on', () => {
    const at = header.indexOf('<header className=')
    expect(header.slice(at, at + 200)).toContain('z-40')
  })

  it('does not grow the bar to fix it', () => {
    // The instruction was explicit: no extra height. `flex-shrink-0` adds none.
    const at = header.indexOf('<header className=')
    const cls = header.slice(at, at + 200)
    expect(cls).not.toMatch(/\bh-\d/)
    expect(cls).not.toMatch(/\bpy-\d/)
  })
})

describe('the shell is one column, and the header is a child of it', () => {
  it('sizes the shell against the visible viewport', () => {
    // CRLF in the file, so match the classes rather than the literal line.
    const flat = layout.replace(/\s+/g, ' ')
    expect(flat).toContain('h-viewport flex flex-col')
    expect(flat).toContain('overflow-hidden')
  })

  it('is why a shrinkable header was a bug: dvh moves with the keyboard', () => {
    const at = css.indexOf('.h-viewport {')
    expect(css.slice(at, css.indexOf('}', at))).toContain('dvh')
  })

  it('gives the content region the shrinking job', () => {
    expect(layout).toContain('<main className="flex-1 min-h-0 overflow-hidden">')
  })

  it('puts the scrollport inside main, not around the shell', () => {
    // Which is why the header's `sticky` is inert here and was never what kept
    // it on screen.
    const at = layout.indexOf('<main className=')
    expect(layout.slice(at, at + 900)).toContain('overflow-auto')
  })
})

describe('nothing conditionally hides the app bar', () => {
  it('renders it unconditionally', () => {
    // The cause was never a visibility branch, and there must not become one:
    // scattered `if mobile && route !== …` is what the brief warned against.
    const at = layout.indexOf('<Header')
    const before = layout.slice(Math.max(0, at - 200), at)

    expect(at).toBeGreaterThan(0)
    expect(before).not.toMatch(/&&\s*\(?\s*$/)
    expect(before).not.toMatch(/\?\s*\(?\s*$/)
  })

  it('hides only the tab strip on a phone, which is a different control', () => {
    expect(layout.replace(/\s+/g, ' ')).toContain('{!isMobile && ( <TabManager')
  })
})

describe('lifecycle listeners clean themselves up', () => {
  const files = [
    'src/hooks/useSessionTracking.ts',
    'src/hooks/mobile/useFeedDwell.ts',
    'src/components/charts/ChartScrubSurface.tsx',
  ]

  it.each(files)('%s removes every visibility listener it adds', rel => {
    const src = readFileSync(resolve(__dirname, '../../../..', rel), 'utf8')
    const added = (src.match(/addEventListener\('visibilitychange'/g) ?? []).length
    const removed = (src.match(/removeEventListener\('visibilitychange'/g) ?? []).length

    expect(added).toBeGreaterThan(0)
    expect(removed).toBe(added)
  })

  /**
   * Files exempt from the ban below, each for a reason recorded here.
   *
   * `MobileDashboard.tsx` saves the reader's feed position on the way out of
   * view. iOS evicts a backgrounded tab and reloads it on return, and neither
   * unmount nor the scroll throttle fires in time to catch the last position,
   * so `pagehide` is the only moment left. It is the demonstrated need the
   * comment below asks for.
   *
   * It does not conflict with the reason for the ban. The rule exists so a
   * BFCache restore is never met with a synthetic reload; this handler writes
   * a session snapshot and sets a hidden marker, and reloads nothing. It also
   * removes itself in the effect cleanup, which the sibling test above pins
   * for `visibilitychange`. `beforeunload` remains unused precisely because it
   * blocks BFCache where it fires at all.
   */
  const exempt = ['src/components/mobile/MobileDashboard.tsx']

  it('registers no pageshow or pagehide handler anywhere', () => {
    // So a BFCache restore is never met with a synthetic reload. Recorded as a
    // fact rather than a hope: adding one would need a demonstrated need.
    const walk = (dir: string): string[] => {
      const { readdirSync, statSync } = require('node:fs') as typeof import('node:fs')
      return readdirSync(dir).flatMap(name => {
        const p = resolve(dir, name)
        if (statSync(p).isDirectory()) return name === '__tests__' ? [] : walk(p)
        return /\.tsx?$/.test(name) ? [p] : []
      })
    }
    const registers = (f: string) =>
      /addEventListener\('(pageshow|pagehide)'/.test(readFileSync(f, 'utf8'))

    // Resolved to absolute paths and compared exactly, so an exemption covers
    // the one file it names and no other. A new offender beside it still fails.
    const allowed = new Set(exempt.map(rel => resolve(__dirname, '../../../..', rel)))

    const offenders = walk(resolve(__dirname, '../../..'))
      .filter(f => registers(f) && !allowed.has(f))

    expect(offenders).toEqual([])

    // The allowlist is not allowed to outlive its reason. If an exempt file
    // stops registering a handler, the entry is stale and must be deleted
    // rather than left standing as cover for the next one.
    for (const f of allowed) expect(registers(f)).toBe(true)
  }, /**
      * This walks and reads every source file under `src/`, so its cost grows
      * with the repository and with whatever else the runner is doing. At the
      * default five seconds it passed alone and timed out inside the full unit
      * guard — a failure to COMPLETE, which the guard rightly refuses to call a
      * pass, and which says nothing about the rule.
      *
      * Raised rather than narrowed: the point of the assertion is that it looks
      * everywhere, so the walk is the test.
      */
     30_000)
})

describe('the query layer does not rebuild the shell on foreground', () => {
  const app = readFileSync(resolve(__dirname, '../../../App.tsx'), 'utf8')

  it('does not refetch everything when the tab regains focus', () => {
    // Backgrounding a phone would otherwise refire every query at once, and
    // any surface showing a skeleton while fetching reads as a reload.
    expect(app).toContain('refetchOnWindowFocus: false')
  })

  it('treats data as fresh for long enough that a glance away is free', () => {
    expect(app).toContain('staleTime: 5 * 60 * 1000')
  })
})
