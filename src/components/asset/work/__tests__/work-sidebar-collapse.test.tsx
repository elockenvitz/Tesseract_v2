/**
 * The Work sidebar is gone, and must not come back by accident.
 *
 * ── What this file used to be ───────────────────────────────────────────
 *
 * Five tests over the sidebar's collapse behaviour: that collapsing
 * dropped the 296px grid track rather than emptying it, that both grid
 * children kept their slots across the toggle, that the expand control
 * appeared only while the sidebar was away, that the preference was
 * per-viewer rather than per-asset, and that a blocked `localStorage`
 * could not take the page down.
 *
 * Every one of those was true and none of them matters now. The sidebar
 * and the Work overview were two full navigators listing the same
 * things — processes, ideas, investigations, lists, themes, portfolios,
 * projects — with no answer to which one a reader was meant to use. The
 * overview won; the sidebar, its collapse state, its localStorage key and
 * its three scattered expand controls were removed.
 *
 * The tests are replaced rather than deleted because "put a navigator
 * back beside the surface" is the obvious next suggestion, and the
 * duplication is the thing that made Work confusing in the first place.
 * The behaviours the old file protected now live in
 * `work-integration.test.ts`, asserted against the overview.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8')
const strip = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/^\s*\/\/.*$/gm, '')

const TAB = strip(read('src/components/tabs/AssetTab.tsx'))
const OVERVIEW = strip(read('src/components/asset/work/AssetWorkOverview.tsx'))

describe('Work has one navigator', () => {
  it('does not mount a sidebar beside the working surface', () => {
    expect(TAB).not.toMatch(/<AssetWorkSidebar/)
    expect(TAB).not.toMatch(/<WorkNavigator/)
  })

  it('keeps no collapse state, control or stored preference for one', () => {
    expect(TAB).not.toMatch(/workSidebarCollapsed|toggleWorkSidebar|WorkSidebarToggle/)
    expect(TAB).not.toMatch(/work-sidebar-collapsed/)
  })

  it('gives the surface the full width instead of a 296px track', () => {
    expect(TAB).not.toMatch(/xl:grid-cols-\[296px_minmax\(0,1fr\)\]/)
  })

  it('still reaches everything the sidebar listed, from the overview', () => {
    /*
     * The point of removing it: nothing became unreachable. Processes,
     * research, lists and portfolios, ideas and investigations, and
     * projects are all sections of the overview.
     */
    for (const id of [
      'work-overview-processes',
      'work-overview-research',
      'work-overview-ideas',
      'work-overview-projects',
    ]) {
      expect(OVERVIEW).toContain(`data-testid="${id}"`)
    }
    /* Portfolios, lists and themes are three sections now, rendered from
       one component — they were a single mixed column with a grey LIST /
       PORTFOLIO word at the end of each row to tell them apart. */
    expect(OVERVIEW).toContain('data-testid={`work-overview-${kind}s`}')
    for (const kind of ['portfolio', 'list', 'theme']) {
      expect(OVERVIEW).toContain(`kind="${kind}"`)
    }
  })

  it('carries the three "Add to" dialogs and the idea filter it inherited', () => {
    expect(TAB).toMatch(/<AddToListButton/)
    expect(TAB).toMatch(/<AddToThemeButton/)
    expect(TAB).toMatch(/<AddToProjectButton/)
    expect(TAB).toMatch(/data-testid=\{`overview-idea-filter-\$\{o\.key\}`\}/)
  })

  it('keeps the cross-asset Lists, Themes and Portfolios apps one click away', () => {
    expect(OVERVIEW).toContain('data-testid={`work-overview-all-${kind}`}')
    expect(TAB).toMatch(/type: 'lists'/)
    expect(TAB).toMatch(/type: 'themes-list'/)
    expect(TAB).toMatch(/type: 'portfolios-list'/)
  })
})
