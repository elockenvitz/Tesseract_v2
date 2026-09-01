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
 * The five Dashboard lenses' object surfaces.
 *
 * Each browses a field of objects and opens a FOCUSED workspace for one --
 * scoped to the reason the tile appeared, never a copy of the deep product.
 */
const WORKSPACES = [
  'components/ideas-v2/IdeasWorkspace.tsx',
  'components/research-v2/ResearchWorkspace.tsx',
  'components/portfolio-v2/PortfolioWorkspace.tsx',
  'components/decisions-v2/DecisionsWorkspace.tsx',
]


const ALL_BROWSE = WORKSPACES

/**
 * Deep surfaces inside a lens tab that a reader can actually reach.
 *
 * ResearchDetail and PositionDetail are on disk but nothing routes into them.
 * Asset work happens on the existing Asset page, which predates this grammar
 * and is not held to it -- that page's own convergence is a later pass.
 */
const DETAILS = [
  'components/ideas-v2/IdeaDetail.tsx',
  'components/research-v2/ResearchDetail.tsx',
  'components/portfolio-v2/PositionDetail.tsx',
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
    expect(src('lib/desktop-research/model.ts')).toContain("'No thesis on file'")
    expect(src('lib/desktop-portfolio/model.ts')).toContain("'No thesis on file'")
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
      // Selection belongs to the Dashboard deck now, so the lens reads it
      // rather than holding it -- which is what lets a card opened from Today
      // expand into a research workspace while Back still says Today.
      expect(src(f)).toContain('focusObjectId')
    }
  })

  it('renders the field or the expanded card, never both', () => {
    // A lens draws one or the other. The deck keeps the browse layer alive
    // underneath -- that is the shell's job, not the lens's.
    for (const f of WORKSPACES) {
      expect(src(f)).not.toContain('<DesktopWorkspace')
      expect(src(f)).toContain('openDashboardFocus({')
    }
  })

  it('shares one gallery shell, and the band that rationed it is gone', () => {
    // Ideas left the shared grid in Stage 3G: its slot map is its own, because
    // its question is its own. The shared shell still serves the other three,
    // and the retired scan band is gone from all of them.
    for (const f of ALL_BROWSE) {
      expect(src(f)).not.toContain('DesktopScanBand')
    }
    for (const f of ALL_BROWSE.filter(f => !f.includes('ideas-v2'))) {
      expect(src(f)).toContain("from '../desktop/DesktopTile'")
      expect(src(f)).toContain('<DesktopGallery')
      expect(src(f)).toContain('<DesktopTile')
    }
    expect(src('components/desktop/DesktopTile.tsx')).not.toContain('DesktopScanBand')
  })

  it('names the way back for the deck, not for the workspace', () => {
    // The deck owns Back, and every lens supplies the label for the deck it
    // is handing over -- which is why a card opened from Today says Today.
    for (const f of WORKSPACES) {
      expect(src(f)).toMatch(/backLabel:/)
    }
    // "Portfolio" is not a place. A reader returns to a named book.
    expect(src('components/portfolio-v2/PortfolioWorkspace.tsx'))
      .toContain("backLabel: portfolio?.name ?? 'Portfolio'")
    expect(src('components/dashboard/WorkDeck.tsx')).toContain('workspace-back')
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
    expect(src('components/portfolio-v2/PortfolioWorkspace.tsx'))
      .toContain('usePositionDetail(selected?.position ?? null)')
    // Research refuses to fetch for an object it could not find.
    expect(src('components/research-v2/ResearchWorkspace.tsx'))
      .toContain('useResearchDetail(requested)')
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
    // A twelve-column editorial grid across the page, not a fixed column.
    expect(shell).toMatch(/md:grid-cols-6 xl:grid-cols-9 2xl:grid-cols-12/)
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
      // A tile is a choice, not a workspace in miniature. The shell renders
      // the button; nothing inside a tile body may be independently clickable.
      const tile = body.slice(body.search(/^function \w*Tile\(/m))
      const end = tile.search(/^\/\* -|^const \w+ =|^function (?!\w*Tile)/m)
      const scoped = end === -1 ? tile : tile.slice(0, end)
      expect(scoped).not.toContain('<button')
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

  it('reads condition as ink, not as a tinted band on every card', () => {
    const shell = src('components/desktop/DesktopTile.tsx')
    // Fifteen review-due names used to render as fifteen tinted strips, which
    // is an alert queue. The label carries the colour now.
    expect(shell).toContain('const STATE_INK')
    expect(shell).not.toContain('EYEBROW_BAND')
    // A genuine break still gets a tint, because being loud is the point there.
    expect(shell).toMatch(/tone === 'critical' && 'bg-rose-50/)
    expect(shell).not.toMatch(/review: 'border-amber-200\/80 bg-amber-50/)
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
    // The missing structure, drawn: three named parts and what is behind each.
    expect(tile).toContain('<MissingThesis')
    // Never a completion score: the question is whether the case argues, not
    // whether a form is filled in.
    expect(tile).not.toMatch(/coreSectionCount\s*\/|% complete/)
  })

  it('never draws a visual the data has not earned', () => {
    const ideas = src('components/ideas-v2/IdeaCard.tsx')
    // Range, then a stated target, then the sizing question, then nothing --
    // and "nothing" says so rather than being decorated.
    expect(ideas).toContain("d.visual === 'range' ? <RangeChart")
    expect(ideas).toContain("d.visual === 'target' ? <TargetBar")
    expect(ideas).toContain('<SizingBar held={weightPct!} proposed={idea.proposedWeight!}')
    // An idea with no framework draws nothing at all -- not an empty chart
    // wrapper, not a placeholder. An early-stage belief is not a broken
    // late-stage one, and reserving a slot it can never fill says it is.
    // Every card now carries a visual, so the honesty rule moved: the choice
    // is made from the data the idea actually has, and the fallback draws
    // lifecycle and elapsed time rather than a fabricated chart.
    const pick = ideas.slice(ideas.indexOf('visual: (range'), ideas.indexOf('next:'))
    expect(pick).toContain("weightPct != null && idea.proposedWeight != null ? 'sizing'")
    expect(pick).toContain("frame?.target != null && spot != null ? 'target'")
    const visuals = src('components/ideas-v2/IdeaVisuals.tsx')
    const fallback = visuals.slice(visuals.indexOf('export function DecisionState'))
    expect(fallback).not.toMatch(/spot|target|bear|bull|weight|price/i)
    expect(ideas).not.toMatch(/sparkline|donut|progress-ring/i)
    // A range exists only when all three rungs and a price do.
    expect(ideas).toContain('bear != null && bull != null && spot != null')
    // Every figure a visual prints is read from the frame, never generated.
    expect(src('components/ideas-v2/IdeaVisuals.tsx')).not.toMatch(/Math\.random/)
    // Maturity is a position among four, never a fill up to one. A cumulative
    // track reads as loading or completion and states a percentage the data
    // does not assert: decision-ready is the start of the work, not 100% of it.
    const maturity = src('components/ideas-v2/IdeaVisuals.tsx')
    expect(maturity).toContain('i === at')
    expect(maturity).not.toMatch(/i > at|i >= at|i < at|i <= at/)
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
      ['components/research-v2/ResearchDetail.tsx', 'The case'],
      ['components/portfolio-v2/PositionDetail.tsx', 'The case'],
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
      'components/research-v2/ResearchDetail.tsx',
      'components/portfolio-v2/PositionDetail.tsx',
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
    expect(src('components/portfolio-v2/PositionDetail.tsx'))
      .toMatch(/<DesktopModule\s+title="Framework"/)
    expect(src('components/ideas-v2/IdeaDetail.tsx'))
      .toMatch(/<DesktopModule\s+title="Decision"/)
    expect(src('components/research-v2/ResearchDetail.tsx'))
      .toMatch(/title="New since review"/)
  })

  it('emits the anchor its own scroll target looks for', () => {
    // IdeaDetail scrolls to [data-module="decision"], which matched nothing
    // because the attribute was never rendered: the button silently did
    // nothing at all.
    expect(src('components/desktop/DesktopModule.tsx')).toContain('data-module={moduleKey}')
    expect(src('components/ideas-v2/IdeaDetail.tsx')).toContain('moduleKey="decision"')
  })
})

describe('the Dashboard sits above the product, never replaces it', () => {
  it('renders the existing Asset page for every asset tab', () => {
    const shell = src('pages/DashboardPage.tsx')
    const at = shell.indexOf("case 'asset':")
    expect(shell.slice(at, at + 1200)).toContain('<AssetTab')
    expect(shell).not.toContain('AssetWorkspacePane')
  })

  it('keeps the replacement asset workspace parked', () => {
    const importers = [
      'pages/DashboardPage.tsx',
      'components/dashboard/DashboardShell.tsx',
      'components/research-v2/ResearchWorkspace.tsx',
      'components/portfolio-v2/PortfolioWorkspace.tsx',
    ].filter(f => src(f).includes('asset-v2/AssetWorkspace'))
    expect(importers).toEqual([])
  })

  it('mounts no thesis editor anywhere in the Dashboard', () => {
    // Research's focused workspace used to mount the Asset page's own editor.
    // That is the Dashboard rebuilding the product it sits above; the workspace
    // names the verb and the Asset page performs it.
    for (const f of [...WORKSPACES, ...DETAILS]) {
      expect(src(f)).not.toContain('<ThesisContainer')
    }
  })

  it('gives every focused workspace an explicit way into the deep product', () => {
    for (const f of DETAILS) {
      expect(src(f)).toContain('<DeepLinks>')
      expect(src(f)).toContain('label="Open full asset"')
    }
  })

  it('does not make the deep link the only thing a workspace does', () => {
    // A workspace whose sole content is a link out has no reason to exist.
    for (const f of DETAILS) {
      const body = src(f)
      expect(body).toMatch(/askAI\(/)
      expect(body.match(/<DesktopSection|<DesktopModule/g)?.length ?? 0).toBeGreaterThan(2)
    }
  })

  it('routes a lens handoff through the one asset contract', () => {
    for (const f of ['components/research-v2/ResearchDetail.tsx', 'components/portfolio-v2/PositionDetail.tsx']) {
      expect(src(f)).toContain("from '../../lib/desktop-asset'")
      expect(src(f)).toContain('openAsset({')
    }
  })

  it('reads one definition of weight', () => {
    expect(src('hooks/useAssetWorkspace.ts')).toContain("from '../lib/portfolio/holdings'")
    expect(src('components/tabs/AssetTab.tsx')).toContain('currentRows(')
  })
})

describe('a Dashboard action stays in the Dashboard', () => {
  it('gives Today a focus seam instead of a tab descriptor', () => {
    const today = src('components/today/TodayPage.tsx')
    expect(today).toContain('openDashboardFocus({')
    // The two things that used to take the reader out of the Dashboard.
    expect(today).not.toContain('researchTabFor')
    expect(today).not.toContain('openResearch(')
  })

  it('leaves the shared dispatcher untouched', () => {
    // It also serves the Asset page, the old Dashboard and the Action Center.
    // Today reads it and falls through to it; it is never modified.
    const today = src('components/today/TodayPage.tsx')
    expect(today).toContain('dispatchDecisionAction(item.primary.actionKey, payload)')
    const dispatcher = src('engine/decisionEngine/dispatchDecisionAction.ts')
    expect(dispatcher).not.toContain('openDashboardFocus')
    expect(dispatcher).not.toContain('dashboard-focus')
  })

  it('never builds a tab from a focus request', () => {
    const seam = src('lib/dashboard/focus.ts')
    // One dispatch. Producing a tab descriptor here is precisely the mistake
    // this seam replaces.
    expect(seam).not.toContain('decision-engine-action')
    expect(seam).not.toMatch(/type: '(asset|research-v2|ideas-v2)'/)
  })

  it('keeps a lens tile inside the tab', () => {
    // A tile expands a card in the deck. None of them asks the shell for a
    // tab, and none of them reaches for the deep asset seam.
    for (const f of WORKSPACES) {
      const body = src(f)
      expect(body).toContain('openDashboardFocus({')
      expect(body).not.toMatch(/onOpen=\{\(\) => openAsset\(/)
    }
  })

  it('reserves the deep handoff for an explicit click', () => {
    // openAsset survives, and is reached only from a DeepLink or a named
    // authoring verb -- never from a tile.
    for (const f of ['components/research-v2/ResearchDetail.tsx', 'components/portfolio-v2/PositionDetail.tsx']) {
      expect(src(f)).toContain('openAsset({')
      expect(src(f)).toContain('<DeepLinks>')
    }
  })

  it('keeps the deck alive underneath rather than remounting it', () => {
    // Unmounting the browse layer would throw away the book selection, the
    // filter and the scroll position, and Back would land the reader at the
    // top of a deck they had scrolled halfway down.
    const shell = src('components/dashboard/DashboardShell.tsx')
    expect(shell).toContain('dashboard-browse')
    expect(shell).toContain("'invisible pointer-events-none'")
    // `display: none` resets scrollTop, so it is never used for this.
    expect(shell).not.toMatch(/deck && 'hidden'/)
  })

  it('hands the surrounding work over with the request', () => {
    // The rail is built from the population the lens already loaded. Four
    // scans to render one workspace is the cost this avoids.
    for (const f of WORKSPACES) {
      expect(src(f)).toContain('toRailCard')
    }
    expect(src('components/today/TodayPage.tsx')).toContain('enriched.map(toRailCard)')
    // The WHOLE population travels; the deck windows it. A window pruned once
    // at open time would permanently drop the card the reader came from.
    expect(src('components/dashboard/WorkDeck.tsx')).toContain('railAround(rail, activeId)')
  })

  it('does not loop the rail back to the head of the list', () => {
    // Wrapping from rank #15 to rank #1 told a reader that #15 is followed
    // by #1. The rail is a neighbourhood, not a carousel.
    const seam = src('lib/dashboard/focus.ts')
    const fn = seam.slice(seam.indexOf('export function railAround'))
    expect(fn).toContain('const after = cards.slice(at + 1)')
    expect(fn).toContain('const before = cards.slice(')
    expect(fn).not.toMatch(/\.\.\.all\.slice\(0, at\)/)
  })

  it('puts the rail on the left, and keeps it at laptop width', () => {
    const deck = src('components/dashboard/WorkDeck.tsx')
    expect(deck.indexOf('data-testid="work-rail"'))
      .toBeLessThan(deck.indexOf('data-testid="work-surface"'))
    // Core to the interaction, not decoration: it narrows rather than hides.
    expect(deck).toContain('lg:block')
    expect(deck).not.toContain('2xl:block')
  })

  it('never shows the expanded card as a peer, and lets the last one back', () => {
    // `railAround` excludes whatever is active right now, from the full
    // population -- so rotating away from JNJ puts JNJ back in the rail.
    const deck = src('components/dashboard/WorkDeck.tsx')
    expect(deck).toContain('railAround(rail, activeId)')
    const fn = src('lib/dashboard/focus.ts')
    expect(fn).toContain('cards.filter(c => c.id !== activeId)')
  })

  it('keeps the origin fixed while rotating', () => {
    const shell = src('components/dashboard/DashboardShell.tsx')
    const rotate = shell.slice(shell.indexOf('const rotate ='), shell.indexOf('/** Choosing a lens'))
    // The rotation spreads the ORIGINAL target, so originLens survives it.
    expect(rotate).toContain('...d.target')
    expect(rotate).not.toContain('originLens:')
  })
})

describe('one Dashboard, five lenses', () => {
  it('offers all five lenses from one shell', () => {
    const shell = src('components/dashboard/DashboardShell.tsx')
    for (const id of ['today', 'ideas', 'research', 'portfolio', 'decisions']) {
      expect(shell).toContain(`id: '${id}'`)
    }
  })

  it('keeps saved v2 sessions renderable, without migrating them', () => {
    // A session saved last week still holds `ideas-v2` etc. Each mounts the
    // same shell on its own lens, so nothing is rewritten on load and the
    // irreversible collapse stays a separate decision.
    const page = src('pages/DashboardPage.tsx')
    for (const t of ['ideas-v2', 'research-v2', 'portfolio-v2', 'decisions-v2']) {
      expect(page).toContain(`case '${t}':`)
    }
    expect(page).toMatch(/case 'today':\s*\n\s*return <DashboardShell initialLens="today" \/>/)
    const tabs = src('components/layout/TabManager.tsx')
    for (const t of ['ideas-v2', 'research-v2', 'portfolio-v2', 'decisions-v2']) {
      expect(tabs).toContain(t)
    }
  })

  it('mounts one lens at a time', () => {
    // Four scans against production to render one is the cost of keeping them
    // all alive, and a hidden lens holding a stale book is worse than a
    // remount against a cached query.
    const shell = src('components/dashboard/DashboardShell.tsx')
    // One browse lens, plus at most one expanded workspace. Never four.
    expect(shell).toContain("if (l === 'today') return <TodayPage />")
    expect(shell).toContain('renderLens(browseLens, null)')
    // The browse layer is made inert, not duplicated: exactly one lens is
    // rendered for browsing and at most one more for the expanded card.
    expect((shell.match(/renderLens\(/g) ?? []).length).toBe(2)
  })
})

describe('size is importance, colour is condition', () => {
  it('derives size from rank, never from severity or richness', () => {
    const shell = src('components/desktop/DesktopTile.tsx')
    const fn = shell.slice(shell.indexOf('export function sizeByRank'))
    expect(fn).toMatch(/index === 0\) return 'hero'/)
    // Nothing about tone, gap, ladder or evidence reaches the sizing rule.
    const body = fn.slice(0, fn.indexOf('\n}'))
    expect(body).not.toMatch(/tone|critical|ladder|chart/)
  })

  it('never demotes the top-ranked object for being sparse', () => {
    for (const f of [
      'components/research-v2/ResearchWorkspace.tsx',
      'components/portfolio-v2/PortfolioWorkspace.tsx',
    ]) {
      // Size comes from the index alone, in the order the ranking produced.
      expect(src(f)).toMatch(/size=\{sizeByRank\(i, /)
    }
    // Ideas uses a density map, on the same rule: the index, and nothing
    // about tone, stance, book or how much the card has to draw.
    expect(src('components/ideas-v2/IdeasWorkspace.tsx')).toContain('density={densityForRank(rank)}')
    const card = src('components/ideas-v2/IdeaCard.tsx')
    const fn = card.slice(card.indexOf('export function densityForRank'))
    expect(fn.split('\n}')[0]).not.toMatch(/tone|ladder|thesis|direction|conviction/)
  })

  it('places by rank order, never by dense backfill', () => {
    // `dense` fills earlier gaps with later items, which would put rank #7
    // above rank #4 the moment a row did not divide evenly.
    const shell = src('components/desktop/DesktopTile.tsx')
    expect(shell).toContain("gridAutoFlow: 'row'")
    expect(shell).not.toContain('grid-flow-dense')
    // Ideas is one twelve-column grid in rank order, on the same rule.
    expect(src('components/ideas-v2/IdeasWorkspace.tsx')).not.toContain('grid-flow-dense')
  })

  it('keeps chronology authoritative in Decisions', () => {
    const body = src('components/decisions-v2/DecisionsWorkspace.tsx')
    // Size is recency, so the largest card is always the newest and always
    // first -- nothing is reordered to make the page work. Never `sizeByRank`,
    // which would let a record's contents move it up the page.
    expect(body).toContain('sizeByRecency(i)')
    expect(body).toContain('flow="chronological"')
    expect(body).toContain('compareDecisions')
    expect(body).not.toMatch(/sizeByRank/)
    const fn = src('components/desktop/DesktopTile.tsx')
    const band = fn.slice(fn.indexOf('export function sizeByRecency'))
    // Index alone. No rationale, no outcome, no sizing reaches it.
    expect(band.slice(0, band.indexOf('\n}'))).not.toMatch(/reason|outcome|status|note/)
  })

  it('lets a hero earn its space with a number when it has no chart', () => {
    const shell = src('components/desktop/DesktopTile.tsx')
    expect(shell).toContain('export function TileHeroNumber')
    // Portfolio's hero leads with weight. Research leads with the note that
    // arrived, or with the age -- the object, never a numeral for its own sake.
    expect(src('components/portfolio-v2/PortfolioWorkspace.tsx')).toContain('<TileHeroNumber')
    expect(src('components/research-v2/ResearchWorkspace.tsx')).toContain('newestEvidenceTitle')
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
    expect(body).toContain('Start here')
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
    expect(ws).toContain('const missing = !!activeId && !requested')
    expect(ws).toContain('NothingOnRecord')
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
