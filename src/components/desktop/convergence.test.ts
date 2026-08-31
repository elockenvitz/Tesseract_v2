/**
 * Cross-surface convergence invariants.
 *
 * These are the rules that only break when two workspaces drift apart, which
 * is exactly what no single-surface suite can see. They are source-level and
 * cheap because the failures they catch are silent: a colour that means one
 * thing on one screen and another on the next, a count nobody can interpret,
 * an intermediate grid quietly reappearing.
 */

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const src = (p: string) => readFileSync(join(process.cwd(), 'src', p), 'utf8')

const VISUALS = [
  'components/today/TodayVisual.tsx',
  'components/ideas-v2/IdeaVisual.tsx',
  'components/research-v2/ResearchVisual.tsx',
  'components/decisions-v2/DecisionVisual.tsx',
]

const AI_SURFACES = [
  'components/today/TodayTile.tsx',
  'components/ideas-v2/IdeasWorkspace.tsx',
  'components/ideas-v2/IdeaDetail.tsx',
  'components/research-v2/ResearchWorkspace.tsx',
  'components/research-v2/ResearchDetail.tsx',
  'components/portfolio-v2/PortfolioWorkspace.tsx',
  'components/portfolio-v2/PositionDetail.tsx',
  'components/decisions-v2/DecisionsWorkspace.tsx',
  'components/decisions-v2/DecisionDetail.tsx',
]

/**
 * Surfaces that still hold their deep object in the same tab.
 *
 * Research and Portfolio left this list in Stage 2D2: they are lenses now, and
 * their deep object is the asset, which opens in its own tab. See LENSES.
 */
const WORKSPACES = [
  'components/ideas-v2/IdeasWorkspace.tsx',
  'components/decisions-v2/DecisionsWorkspace.tsx',
]

/** Browse-only surfaces. Their job is to find an object, never to work on it. */
const LENSES = [
  'components/research-v2/ResearchWorkspace.tsx',
  'components/portfolio-v2/PortfolioWorkspace.tsx',
]

const ALL_BROWSE = [...WORKSPACES, ...LENSES]

/**
 * Deep surfaces a reader can actually reach.
 *
 * ResearchDetail and PositionDetail are still on disk for rollback safety but
 * nothing routes into them any more, so they are not held to the contract --
 * the asset workspace that replaced them is.
 */
const DETAILS = [
  'components/ideas-v2/IdeaDetail.tsx',
  'components/asset-v2/AssetWorkspace.tsx',
  'components/decisions-v2/DecisionDetail.tsx',
]

describe('a price path is never graded', () => {
  it('draws one ink regardless of direction, on every surface', () => {
    for (const f of VISUALS) {
      const body = src(f)
      // The pattern that graded returns: a ternary on direction picking a hue.
      expect(body).not.toMatch(/up \? 'stroke-emerald/)
      expect(body).not.toMatch(/up \? 'fill-emerald/)
      expect(body).not.toMatch(/up \? 'text-emerald/)
      expect(body).not.toMatch(/up \? 'bg-emerald/)
    }
  })

  it('keeps genuine framework breaks critical', () => {
    // Spot outside the case written for it IS broken, and stays rose.
    const scale = src('components/portfolio-v2/PortfolioVisual.tsx')
    expect(scale).toMatch(/rose/)
    expect(scale).toContain('outside')
  })
})

describe('severity means one thing across surfaces', () => {
  it('calls a missing core thesis review, not critical, in both places', () => {
    expect(src('components/research-v2/ResearchWorkspace.tsx'))
      .toMatch(/'no-thesis':\s*'review'/)
    const pf = src('lib/desktop-portfolio/model.ts')
    const tone = pf.slice(pf.indexOf('export function toneForGap'), pf.indexOf('MATERIAL_PCT'))
    expect(tone).toContain("case 'no-framework':")
    expect(tone).toContain("return 'review'")
  })

  it('uses one label for that condition', () => {
    expect(src('lib/desktop-research/model.ts')).toContain("'Core thesis not written'")
    expect(src('lib/desktop-portfolio/model.ts')).toContain("'Core thesis not written'")
    for (const f of ['lib/desktop-portfolio/model.ts', 'lib/desktop-research/model.ts']) {
      expect(src(f)).not.toContain("'No written thesis'")
      expect(src(f)).not.toContain("'No thesis written'")
    }
  })

  it('does not colour trade direction as severity', () => {
    const chrome = src('components/ideas-v2/IdeaChrome.tsx')
    const style = chrome.slice(
      chrome.indexOf('const DIRECTION_STYLE'),
      chrome.indexOf('export function DirectionPill'),
    )
    expect(style).not.toMatch(/emerald|rose|amber/)
  })
})

describe('Ask AI is an action, not a metric', () => {
  it('renders no context-chip count on any canonical surface', () => {
    for (const f of AI_SURFACES) {
      expect(src(f)).not.toMatch(/contextChips\?\.length/)
    }
  })
})

describe('browse, then engage: one mode at a time', () => {
  it('lands in browse and never auto-opens an object', () => {
    // A ranking says what is worth looking at first. It does not say the
    // reader has chosen it. Opening the head of the list on arrival made
    // that claim on their behalf, and Stage 1.1 already showed what a
    // silently-substituted object costs.
    for (const f of ALL_BROWSE) {
      expect(src(f)).not.toMatch(/\?\?\s*(ranked|rows)\[0\]/)
    }
    for (const f of WORKSPACES) {
      expect(src(f)).toMatch(/const mode: WorkspaceMode = /)
    }
  })

  it('renders browse or detail, never both', () => {
    // Not a modal, not a drawer, not a collapsed rail: the other mode is
    // genuinely unmounted, so it competes for neither layout nor attention.
    for (const f of WORKSPACES) {
      expect(src(f)).toMatch(/mode === 'browse' \? \(/)
      expect(src(f)).toContain('<DesktopWorkspace')
    }
  })

  it('shares one gallery shell, and the band that rationed it is gone', () => {
    for (const f of ALL_BROWSE) {
      expect(src(f)).toContain("from '../desktop/DesktopTile'")
      expect(src(f)).toContain('<DesktopGallery')
      expect(src(f)).toContain('<DesktopTile')
      expect(src(f)).not.toContain('DesktopScanBand')
    }
    expect(src('components/desktop/DesktopTile.tsx')).not.toContain('DesktopScanBand')
  })

  it('offers one return affordance, named for its destination', () => {
    for (const f of WORKSPACES) {
      expect(src(f)).toMatch(/backLabel=/)
    }
    // A lens has nothing to return FROM: choosing an object opens a tab of its
    // own, and this one stays exactly where the reader left it.
    for (const f of LENSES) {
      expect(src(f)).not.toContain('DesktopWorkspace')
      expect(src(f)).not.toMatch(/backLabel=/)
    }
  })

  it('fetches nothing deep while browsing', () => {
    // The detail hooks are all null-gated on the selection, so the gallery
    // costs one query no matter how long the reader stays in it.
    for (const [f, call] of [
      ['components/ideas-v2/IdeasWorkspace.tsx', 'useIdeaDetail(selected)'],
      ['components/decisions-v2/DecisionsWorkspace.tsx', 'useDecisionDetail(selected)'],
    ] as const) {
      expect(src(f)).toContain(call)
    }
    // A lens reads nothing deep at all: it has no detail to feed.
    for (const f of LENSES) {
      expect(src(f)).not.toMatch(/useResearchDetail|usePositionDetail/)
    }
  })

  it('has retired the left-rail navigator entirely', () => {
    // A 252px column could not carry a weight bar, a framework scale or a
    // price path, so the scan carried no investment content. Gone, not kept
    // alongside.
    for (const f of ALL_BROWSE) {
      expect(src(f)).not.toContain('DesktopNavigator')
      expect(src(f)).not.toContain('DesktopNavRow')
    }
    expect(() => src('components/desktop/DesktopNavigator.tsx')).toThrow()
  })

  it('gives the gallery the whole canvas, uncapped', () => {
    const shell = src('components/desktop/DesktopTile.tsx')
    // A responsive grid across the page, not a fixed narrow column.
    expect(shell).toMatch(/md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4/)
    expect(shell).not.toMatch(/w-\[2[0-9]%\]/)
    // Stage 2A capped the band at 340px because a workspace sat under it.
    // Nothing sits under it now.
    expect(shell).not.toMatch(/max-h-\[/)
  })

  it('scrolls once per mode, and returns the reader where they were', () => {
    const shell = src('components/desktop/DesktopWorkspace.tsx')
    expect(shell).toContain('browseScroll')
    // One scroll container. A band scroll inside a page scroll was the thing
    // that made the stacked version hard to move around in.
    expect(shell.match(/overflow-y-auto/g) ?? []).toHaveLength(1)
  })

  it('has no per-tile call to action', () => {
    // Strip comments first: these files explain WHY the buttons went, and the
    // explanation must not read as the button coming back.
    const code = (f: string) =>
      src(f).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
    for (const f of ALL_BROWSE) {
      // A tile is a choice, not a workspace in miniature: nothing inside one
      // may be independently clickable, or opening becomes ambiguous.
      const body = code(f)
      const tile = body.slice(body.search(/^function \w*Tile\(/m))
      const end = tile.search(/^\/\* -/m)
      expect(end === -1 ? tile : tile.slice(0, end)).not.toContain('<button')
      expect(body).not.toContain('Revisit this decision')
      expect(body).not.toContain('Full scan')
      expect(body).not.toContain('Full book')
    }
    // The shell offers no footer slot, so a surface cannot add one back, and
    // no selected ring, because nothing remains for a tile to stay tied to.
    const shell = code('components/desktop/DesktopTile.tsx')
    expect(shell).not.toMatch(/footer\s*[?:]|actions\s*\?:/)
    expect(shell).not.toMatch(/selected\s*\?:/)
  })
})

describe('visual hierarchy encodes meaning, not chrome', () => {
  it('gives every gallery one state badge, from the shared shell', () => {
    // Four workspaces were each hand-rolling the same rounded-full span with
    // the same four class strings, which is how a heading weight changes in
    // one gallery and the others quietly disagree.
    for (const f of [
      'components/research-v2/ResearchWorkspace.tsx',
      'components/portfolio-v2/PortfolioWorkspace.tsx',
    ]) {
      expect(src(f)).toContain('<TileState')
      expect(src(f)).not.toContain('TONE_PILL[tone]')
    }
  })

  it('tints the eyebrow of a tile, never the ground its text sits on', () => {
    const shell = src('components/desktop/DesktopTile.tsx')
    const band = shell.slice(shell.indexOf('const EYEBROW_BAND'))
    // Colour above the text, never behind it: a rose card is harder to read in
    // order to say what the badge already said.
    expect(band).toMatch(/critical: 'border-rose/)
    const body = shell.slice(shell.indexOf('export function DesktopTile'), shell.indexOf('const EYEBROW_BAND'))
    expect(body).toMatch(/bg-white/)
    expect(body).not.toMatch(/bg-rose-50'|bg-amber-50'/)
  })

  it('reserves the loudest tile for a genuine framework break', () => {
    // Only Portfolio passes a tone that can reach `critical`, and only from
    // `toneForGap` -- where above-bull and below-bear are the sole criticals.
    const pf = src('components/portfolio-v2/PortfolioWorkspace.tsx')
    expect(pf).toMatch(/tone=\{tone\}/)
    expect(src('components/decisions-v2/DecisionsWorkspace.tsx'))
      .toMatch(/tone=\{outcome === 'open' \? 'review' : 'neutral'\}/)
    // An outstanding decision is work, not a break, in Ideas as everywhere.
    expect(src('components/ideas-v2/IdeasWorkspace.tsx')).not.toMatch(/'critical'/)
  })

  it('says each fact on a decision tile once', () => {
    // The tile used to print ACCEPTED, TRIM, MNST, then "Eric accepted a trim
    // in MNST at 2.0%", then the book, then Eric again -- six lines carrying
    // three facts, with the largest of them adding nothing.
    const body = src('components/decisions-v2/DecisionsWorkspace.tsx')
    const tile = body.slice(body.indexOf('function DecisionTile'), body.indexOf('function TileShape'))
    expect(tile).not.toContain('summaryOf')
    expect(tile).not.toContain('OUTCOME_LABEL')
  })

  it('differentiates the three research states structurally, not by wording', () => {
    const body = src('components/research-v2/ResearchWorkspace.tsx')
    const tile = body.slice(body.indexOf('function SubjectTile'))
    // Arrival leads with a count, absence names the missing sections, and
    // everything else keeps the sentence.
    expect(tile).toMatch(/state === 'evidence-since-review' \?/)
    expect(tile).toContain('<TileLead')
    expect(tile).toMatch(/state === 'no-thesis' \?/)
    expect(tile).toContain('<TileSections')
    // Never a completion score: the question is whether the case argues, not
    // whether a form is filled in.
    expect(tile).not.toMatch(/coreSectionCount\s*\/|% complete/)
  })

  it('never draws a visual the data has not earned', () => {
    const ideas = src('components/ideas-v2/IdeasWorkspace.tsx')
    const tile = ideas.slice(ideas.indexOf('function IdeaTile'))
    // Ladder, then target, then position, then nothing at all -- the fallback
    // is an absent visual, not a decorative one.
    expect(tile).toMatch(/bear != null && bull != null && spot != null \?/)
    expect(tile).toMatch(/weightPct != null \?[\s\S]{0,220}: null/)
  })
})

describe('a detail page is not five white rectangles', () => {
  it('offers an unboxed section for prose, and uses it', () => {
    expect(src('components/desktop/DesktopModule.tsx')).toContain('export function DesktopSection')
    for (const f of DETAILS) {
      expect(src(f)).toContain('<DesktopSection')
    }
  })

  it('sets the written case in the lead type, unboxed', () => {
    // The thesis, the case and the stated reason are the objects these pages
    // exist for. A border around them made each a panel among panels.
    for (const [f, title] of [
      ['components/ideas-v2/IdeaDetail.tsx', 'The claim'],
      ['components/asset-v2/AssetWorkspace.tsx', 'The case'],
      ['components/decisions-v2/DecisionDetail.tsx', 'Why we decided'],
    ] as const) {
      const body = src(f)
      const at = body.indexOf(`title="${title}"`)
      expect(at).toBeGreaterThan(-1)
      // The section opening tag sits just above the title, and it is a
      // section with `lead`, not a module.
      const open = body.slice(Math.max(0, at - 220), at + 260)
      expect(open).toContain('DesktopSection')
      expect(open).toMatch(/\blead\b/)
    }
  })

  it('flows detail content into a lead and a context column', () => {
    // Half-width modules auto-placed into a two-column grid stack down the
    // left and leave the right empty whenever the data is sparse, which is
    // what left these pages using a quarter of the canvas they were given.
    for (const f of [
      'components/ideas-v2/IdeaDetail.tsx',
      'components/asset-v2/AssetWorkspace.tsx',
    ]) {
      expect(src(f)).toContain('<DesktopColumns')
      expect(src(f)).not.toMatch(/grid grid-cols-1 gap-3\.5 px-6 pt-4 xl:grid-cols-2/)
    }
    const shell = src('components/desktop/DesktopModule.tsx')
    // One column when there is no context to put beside it, so a sparse page
    // does not render an empty gutter.
    expect(shell).toMatch(/if \(!context\)/)
  })

  it('keeps a box for what a box is for', () => {
    // Charts and bounded interactions stay boxed. This is the counter-check on
    // the rule above: unboxing everything is the same mistake inverted.
    expect(src('components/asset-v2/AssetWorkspace.tsx'))
      .toMatch(/<DesktopModule key="framework" title="Framework"/)
    expect(src('components/ideas-v2/IdeaDetail.tsx'))
      .toMatch(/<DesktopModule\s+title="Decision"/)
    expect(src('components/asset-v2/AssetWorkspace.tsx'))
      .toMatch(/title="New since the case was written"/)
  })

  it('emits the anchor its own scroll target looks for', () => {
    // IdeaDetail scrolls to [data-module="decision"], which matched nothing
    // because the attribute was never rendered: the button silently did
    // nothing at all.
    expect(src('components/desktop/DesktopModule.tsx')).toContain('data-module={moduleKey}')
    expect(src('components/ideas-v2/IdeaDetail.tsx')).toContain('moduleKey="decision"')
  })
})

describe('one canonical place to do asset work', () => {
  it('routes both lenses through the one open contract', () => {
    for (const f of LENSES) {
      expect(src(f)).toContain("from '../../lib/desktop-asset'")
      expect(src(f)).toContain('openAsset({')
    }
  })

  it('keeps the lenses out of the deep surfaces they used to be', () => {
    // Not deleted -- unreachable. Parity and rollback safety come first, and
    // an import is the only thing that could put a reader back in one.
    expect(src('components/research-v2/ResearchWorkspace.tsx'))
      .not.toContain("from './ResearchDetail'")
    expect(src('components/portfolio-v2/PortfolioWorkspace.tsx'))
      .not.toContain("from './PositionDetail'")
    // And the shell still renders neither.
    const shell = src('pages/DashboardPage.tsx')
    expect(shell).not.toContain('ResearchDetail')
    expect(shell).not.toContain('PositionDetailPane')
  })

  it('mounts one thesis editor, in one place', () => {
    // Research detail used to mount the Asset page's own editor, which is as
    // close to a proof of duplication as code gets. One reachable mount now.
    const mounts = [
      'components/asset-v2/AssetWorkspace.tsx',
      'components/research-v2/ResearchWorkspace.tsx',
      'components/portfolio-v2/PortfolioWorkspace.tsx',
      'components/ideas-v2/IdeaDetail.tsx',
      'components/decisions-v2/DecisionDetail.tsx',
    ].filter(f => src(f).includes('<ThesisContainer'))
    expect(mounts).toEqual(['components/asset-v2/AssetWorkspace.tsx'])
  })

  it('gives the asset workspace the engagement seam the Asset page never had', () => {
    const body = src('components/asset-v2/AssetWorkspace.tsx')
    expect(body).toContain("from '../../lib/engagement'")
    expect(body).toMatch(/askAI\(target\)/)
    expect(body).toMatch(/discuss\(target\)/)
  })

  it('hands off to Ideas and Decisions rather than absorbing them', () => {
    const body = src('components/asset-v2/AssetWorkspace.tsx')
    // An idea is its own object, and Decision Memory is its own workspace.
    expect(body).toContain('ideasTabFor')
    expect(body).not.toContain('DecisionModule')
    expect(body).not.toContain('useIdeaDecision')
  })

  it('never ranks other assets from a page about one', () => {
    const body = src('components/asset-v2/AssetWorkspace.tsx')
    expect(body).not.toContain('DesktopGallery')
    expect(body).not.toContain('DesktopTile')
  })

  it('reads one definition of weight', () => {
    expect(src('hooks/useAssetWorkspace.ts')).toContain("from '../lib/portfolio/holdings'")
    // The legacy page's second definition is gone; see holdings-parity.test.
    expect(src('components/tabs/AssetTab.tsx')).toContain('currentRows(')
  })
})

describe('one module primitive', () => {
  it('is shared by all four selected workspaces', () => {
    for (const f of DETAILS) {
      const body = src(f)
      expect(body).toContain("from '../desktop/DesktopModule'")
      expect(body).not.toMatch(/^function Module\(\{/m)
      expect(body).not.toMatch(/^function Stat\(\{/m)
    }
  })

  it('owns chrome only, never investment meaning', () => {
    const body = src('components/desktop/DesktopModule.tsx')
    const code = body.slice(body.indexOf('import'))
    expect(code).not.toMatch(/supabase|useQuery/)
  })
})

describe('the launcher names the product, not the build', () => {
  const header = src('components/layout/Header.tsx')

  it('shows the five canonical names', () => {
    for (const label of [
      "title: 'Dashboard'", "title: 'Ideas'", "title: 'Research'",
      "title: 'Portfolio'", "title: 'Decisions'",
    ]) {
      expect(header).toContain(label)
    }
  })

  it('no longer shows build-stage labels', () => {
    expect(header).not.toContain("title: 'Ideas V2'")
    expect(header).not.toContain("title: 'Book'")
  })

  it('demotes the pre-Today dashboard rather than deleting it', () => {
    // Named as legacy where a user meets it, and still reachable.
    expect(header).toContain('Dashboard (legacy)')
    expect(header).toContain("type: 'dashboard'")
    // It is no longer manufactured as a default tab anywhere.
    expect(src('pages/DashboardPage.tsx')).not.toContain("title: 'Dashboard (legacy)'")
  })
})

describe('the shared holdings derivation survived', () => {
  it('is still the one source of weight', () => {
    expect(src('lib/portfolio/holdings.ts')).toContain('marketValue / totalValue')
    for (const f of [
      'hooks/useDesktopResearch.ts', 'hooks/useDesktopIdeas.ts', 'hooks/useDesktopPortfolio.ts',
    ]) {
      expect(src(f)).toMatch(/from '\.\.\/lib\/portfolio\/holdings'/)
    }
  })
})

describe('Ideas and Research can reach each other', () => {
  it('Ideas routes to the asset, not through the Research lens', () => {
    // The evidence belongs to the asset. Routing via the lens would drop the
    // reader in a gallery they did not ask for on the way to one object.
    const body = src('components/ideas-v2/IdeaDetail.tsx')
    expect(body).toContain('openAsset({')
    expect(body).toContain("origin: 'ideas'")
    expect(body).not.toContain('researchTabFor')
    expect(body).not.toContain('setTimeout')
  })

  it('the asset routes to Ideas only when a live idea exists', () => {
    const body = src('components/asset-v2/AssetWorkspace.tsx')
    expect(body).toContain('ideasTabFor')
    expect(body).toContain('data.liveIdeas.length > 0')
    expect(body).not.toContain('setTimeout')
  })

  it('reads liveness from outcome and status, never from stage', () => {
    const hook = src('hooks/useDesktopResearch.ts')
    expect(hook).toContain('TERMINAL_STATUS')
    expect(hook).toContain('q.outcome == null')
  })

  it('does not add the parked position or decision seams', () => {
    for (const f of [...WORKSPACES, ...DETAILS]) {
      expect(src(f)).not.toMatch(/openPosition|openDecision/)
    }
  })
})

describe('rankings were not touched', () => {
  it('keeps every comparator where it was', () => {
    expect(src('lib/desktop-ideas/rank.ts')).toContain('export function compareIdeas')
    expect(src('lib/desktop-research/model.ts')).toContain('export function compareSubjects')
    expect(src('lib/desktop-portfolio/model.ts')).toContain('export function comparePositions')
    expect(src('lib/desktop-decisions/model.ts')).toContain('export function compareDecisions')
  })

  it('does not let severity reach a comparator', () => {
    const pf = src('lib/desktop-portfolio/model.ts')
    expect(pf.slice(pf.indexOf('export function tierOf'))).not.toContain('toneForGap')
  })
})

describe('Today stays deliberately different', () => {
  it('is not a split navigator workspace', () => {
    const body = src('components/today/TodayPage.tsx')
    expect(body).not.toContain('DesktopNavigator')
    expect(body).toContain('Featured')
  })
})

describe('the canonical Dashboard is where a session begins', () => {
  const page = src('pages/DashboardPage.tsx')

  it('defines one landing descriptor, pointing at the canonical surface', () => {
    expect(page).toMatch(/const CANONICAL_HOME = \{ id: 'today', title: 'Dashboard', type: 'today'/)
  })

  it('opens a fresh session there, not on the legacy dashboard', () => {
    // Every default construction now derives from the one descriptor.
    expect(page).not.toMatch(/tabs: \[\{ id: 'dashboard'/)
    expect(page).not.toMatch(/setActiveTabId\('dashboard'\)/)
    expect(page).not.toContain("title: 'Dashboard (legacy)'")
  })

  it('keeps the legacy dashboard built and routable', () => {
    // Demoted, not deleted: the tab type still renders its own content.
    expect(page).toContain("activeTab.type === 'dashboard'")
    expect(page).toContain('renderDashboardContent')
    // And the launcher offers it, named as legacy, in the MORE group --
    // which is now the ONLY way back to it, since it is no longer injected
    // into every session.
    const header = src('components/layout/Header.tsx')
    const more = header.slice(header.indexOf('>More<'))
    expect(more).toContain("title: 'Dashboard (legacy)'")
    expect(more).toContain("type: 'dashboard'")
  })

  it('does not force the Dashboard over a legitimately persisted tab', () => {
    // Only the pilot rule re-anchors the active tab; everyone else keeps
    // whatever they were last on.
    const restore = page.slice(page.indexOf('const savedState'), page.indexOf('// Default state'))
    expect(restore).toContain('let activeTabId = savedState.activeTabId')
    expect(restore).toMatch(/if \(isPilotHint\) \{\s*\n\s*activeTabId = CANONICAL_HOME\.id/)
  })

  it('adds the home tab to a restored session without removing any', () => {
    const restore = page.slice(page.indexOf('const savedState'), page.indexOf('// Default state'))
    expect(restore).toContain('dedupedTabs.unshift({ ...CANONICAL_HOME, isActive: false })')
    // Nothing in the restore path drops a saved tab.
    expect(restore).not.toMatch(/dedupedTabs\s*=\s*\[\]/)
  })

  it('leaves exactly one Dashboard in the primary group', () => {
    const header = src('components/layout/Header.tsx')
    const decisionOs = header.slice(header.indexOf('Decision OS'), header.indexOf('>More<'))
    expect((decisionOs.match(/title: 'Dashboard'/g) ?? []).length).toBe(1)
    expect(decisionOs).not.toContain("type: 'dashboard'")
  })
})

describe('a handoff never promises what is not there', () => {
  it('shares one eligibility predicate with the Research population', () => {
    const hook = src('hooks/useDesktopResearch.ts')
    expect(hook).toContain('export function useHasResearch')
    // Reads the same scan, so it cannot drift from what Research renders.
    expect(hook.slice(hook.indexOf('export function useHasResearch')))
      .toContain('useResearchScan()')
  })

  it('gates the Ideas handoff on that predicate, not on an asset id', () => {
    const body = src('components/ideas-v2/IdeaDetail.tsx')
    expect(body).toContain('useHasResearch(idea.assetId)')
    // Withheld unless genuinely true — `undefined` while loading shows nothing.
    expect(body).toContain('hasResearch === true && idea.assetId &&')
  })

  it('invents no research-creation action', () => {
    const body = src('components/ideas-v2/IdeaDetail.tsx')
    for (const invented of ['Start research', 'Create case', 'Write thesis']) {
      expect(body).not.toContain(invented)
    }
  })

  it('never substitutes another subject for the one that was requested', () => {
    // Research lists names with a case or recorded evidence. A request for a
    // name it has neither for must open THAT asset -- which the asset
    // workspace can say something honest about from its own read -- and never
    // fall through to whatever the ranking put first.
    const ws = src('components/research-v2/ResearchWorkspace.tsx')
    expect(ws).not.toMatch(/\?\?\s*ranked\[0\]/)
    expect(ws).toContain('const found = ranked.find(s => s.assetId === assetId)')
    expect(ws).toMatch(/if \(found\) return open\(found/)
  })

  it('keeps asset → Ideas gated on a live, non-terminal idea', () => {
    // The gate moved with the handoff: an executed idea still reads
    // 'deciding', so stage can never be what decides liveness.
    expect(src('hooks/useAssetWorkspace.ts')).toContain('r.outcome == null')
    expect(src('hooks/useAssetWorkspace.ts')).toContain('TERMINAL_STATUS.has')
    const hook = src('hooks/useDesktopResearch.ts')
    expect(hook).toContain('q.outcome == null')
    expect(hook).toContain('TERMINAL_STATUS.has')
  })
})
