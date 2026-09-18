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

/*
 * ── The rule this describe used to state, and why it narrowed ────────────
 *
 * It said no price path may be graded by direction, anywhere. The reasoning
 * was sound for what it was protecting: a red line under a decision reads as
 * "bad decision", and post-decision drift is evidence, not a verdict.
 *
 * That argument is about the DECISION. It is not about the price. Up and down
 * are facts about a line, a desk reads them instantly, and in review the
 * uniformly grey chart was read as "no signal" rather than as neutrality --
 * so the product owner called it, and the price line is now graded.
 *
 * The protection survives where it was actually needed. The objects that
 * render a JUDGEMENT on a decision -- the lifecycle path, and the detail
 * pane's since-the-decision chart -- stay on one neutral ink, and these
 * cases hold them there.
 */
describe('a decision is never graded, though its price may be', () => {
  /** The objects that depict the decision itself, not the market. */
  const NEVER_GRADED = [
    ['components/decisions-v2/DecisionVisual.tsx', 'export function PriceSinceDecision'],
    ['components/decisions-v2/DecisionVisual.tsx', 'export function DecisionPath'],
  ] as const

  it('keeps the decision objects on one ink regardless of direction', () => {
    for (const [file, marker] of NEVER_GRADED) {
      const body = src(file)
      const start = body.indexOf(marker)
      expect(start, `${marker} not found in ${file}`).toBeGreaterThan(-1)
      // To the next top-level export, so one component's ink is examined.
      const rest = body.slice(start + marker.length)
      const end = rest.indexOf('\nexport function ')
      const fn = end === -1 ? rest : rest.slice(0, end)

      // The pattern that grades: a ternary on direction picking a hue.
      expect(fn).not.toMatch(/up \? 'stroke-emerald/)
      expect(fn).not.toMatch(/up \? 'fill-emerald/)
      expect(fn).not.toMatch(/up \? 'text-emerald/)
      expect(fn).not.toMatch(/up \? 'bg-emerald/)
    }
  })

  it('never grades with the severity palette, on any visual surface', () => {
    /*
     * Direction and condition are different axes and must stay different.
     * A price line may say which way it went; it may never borrow the ink
     * that means "this framework is broken", because a fall is not a break.
     * Rose and amber stay reserved for condition on every visual module.
     */
    for (const f of VISUALS) {
      const body = src(f)
      expect(body).not.toMatch(/up \? 'stroke-amber/)
      expect(body).not.toMatch(/up \? 'text-amber/)
      // Down may be rose, but only paired with emerald as a direction pair --
      // never rose alone standing in for "bad".
      const roseAlone = /(?<!emerald[^\n]*)\bdown \? 'stroke-rose/
      expect(body).not.toMatch(roseAlone)
    }
  })

  it('grades the price line by direction, and says so in one place', () => {
    // The tile chart and the small-tile sparkline both grade, and both derive
    // it from the same `up` the percentage's sign comes from -- so the hue
    // and the number can never disagree about which way the price went.
    /* The tile chart moved out of the Decisions lens into the shared shell,
       so Portfolio and Research mount the same object rather than a sparkline
       reduction of it. The grading rule follows the drawing. */
    const chart = src('components/desktop/TilePriceChart.tsx')
    const spark = src('components/desktop/DesktopTile.tsx')
    for (const body of [chart, spark]) {
      expect(body).toMatch(/const up = [^\n]*>= 0/)
      expect(body).toMatch(/up \? 'stroke-emerald/)
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
    /*
     * ── No call to action AT REST ───────────────────────────────────────
     *
     * This used to assert the shell offered no footer slot at all, so a
     * surface could not add one back. That did not hold: Decisions added one
     * anyway, with `<button>`s nested inside the shell's own `<button>` --
     * invalid HTML, and unreachable by keyboard. A rule a surface can break
     * by accident is not a rule, it is a trap.
     *
     * So the shell now owns an `actions` slot, and the constraint moved to
     * where it belongs: the resting state. `TileShelf` renders the object's
     * standing context at rest and reveals the verbs only on hover or
     * keyboard focus, in height reserved either way -- so a gallery still
     * reads as a field of objects rather than a wall of buttons, and the
     * verbs are real accessible buttons when reached for.
     */
    const shell = code('components/desktop/DesktopTile.tsx')
    expect(shell).toMatch(/function TileShelf/)
    // Reveal is opacity only, inside reserved height: no layout shift, and
    // nothing appears that was not already occupying its space.
    expect(shell).toMatch(/group-hover:/)
    expect(shell).toMatch(/group-focus-within:/)
    // The shell is not itself a button any more, which is what made nesting
    // one inside it invalid in the first place.
    expect(shell).toMatch(/role="group"/)
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
    /*
     * Code, not prose. The tile carries a comment explaining why the generated
     * summary was removed, and a rule that cannot tell an explanation of a
     * defect from the defect forces the next person to delete the reasoning in
     * order to make the suite pass.
     */
    const body = src('components/decisions-v2/DecisionsWorkspace.tsx')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '')
    const start = body.indexOf('function DecisionTile')
    /*
     * `function TileShape` was the old end anchor and has not existed in this
     * file for some time. `indexOf` returned -1, `slice(start, -1)` ran to the
     * end of the file, and the assertion was quietly examining every component
     * below the tile as well -- so it failed on code it was never about.
     *
     * A missing anchor must fail loudly, not silently widen the subject.
     */
    const endMarker = 'function Loading('
    const end = body.indexOf(endMarker)
    expect(start, 'DecisionTile not found').toBeGreaterThan(-1)
    expect(end, `${endMarker} not found — fix this anchor`).toBeGreaterThan(start)

    const tile = body.slice(start, end)
    expect(tile).not.toContain('summaryOf')
    // The outcome word reaches the tile only through the deduplicating
    // eyebrow, never printed a second time beside it.
    expect(tile).not.toContain('OUTCOME_LABEL[')
  })

  it('differentiates the three research states structurally, not by wording', () => {
    const body = src('components/research-v2/ResearchWorkspace.tsx')
    const tile = body.slice(body.indexOf('function SubjectTile'))
    // Arrival leads with a count, absence names the missing sections, and
    // everything else keeps the sentence.
    expect(tile).toMatch(/state === 'evidence-since-review' \?/)
    expect(tile).toContain('<TileLead')
    // A thesis partly written is the same absence, drawn with what exists.
    expect(tile).toMatch(/state === 'no-thesis' \|\| state === 'incomplete-thesis' \?/)
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
    //
    // The dispatch is keyed on a `kind` parameter rather than on `d.visual`
    // directly: the featured density draws a second primitive beside the
    // first, so the same branch has to serve both slots. The rule this guards
    // is unchanged -- one primitive per kind, and each requiring its own data.
    expect(ideas).toContain("kind === 'range' ? <RangeChart")
    expect(ideas).toContain("kind === 'target' ? <TargetBar")
    expect(ideas).toContain('<SizingBar held={exposure!.pct} proposed={idea.proposedWeight!}')
    // An idea with no framework draws nothing at all -- not an empty chart
    // wrapper, not a placeholder. An early-stage belief is not a broken
    // late-stage one, and reserving a slot it can never fill says it is.
    // Every card now carries a visual, so the honesty rule moved: the choice
    // is made from the data the idea actually has, and the fallback draws
    // lifecycle and elapsed time rather than a fabricated chart.
    // Guarded for generated coverage prompts, which draw nothing at all; the
    // selection rule inside the literal is what this pins.
    const pick = ideas.slice(
      ideas.indexOf('const available = (g ? [] : ['), ideas.indexOf(']).filter(Boolean)'))
    expect(pick).toContain("weightPct != null && idea.proposedWeight != null ? 'sizing'")
    expect(pick).toContain("frame?.target != null && spot != null ? 'target'")
    // The fallback is an investment fact, not a workflow one: stage is nowhere
    // in the selection, and the last resort reads elapsed time.
    expect(pick).not.toMatch(/maturity|stage/)
    expect(pick).toContain("anchor && spot != null ? 'since'")
    expect(pick).toContain("weightPct != null ? 'exposure'")
    expect(pick).toContain("(frame?.casesNamed ?? 0) > 0 ? 'cases'")
    // `gap` is the statement that there is nothing to draw, so it is the
    // fallback rather than a member of the list -- it can be the only thing on
    // a card and never the second thing beside a real primitive.
    expect(pick).not.toContain("'gap'")
    expect(ideas).toContain("available[0] ?? 'gap'")
    // Age is metadata now: nothing draws it, and the terminal visual reads
    // what is on the record instead of how old the record is.
    expect(src('components/ideas-v2/IdeaVisuals.tsx'))
      .not.toMatch(/AgeBar|ExposureBar[^R]/)
    expect(ideas).not.toMatch(/sparkline|donut|progress-ring/i)
    // A range exists only when all three rungs and a price do.
    expect(ideas).toContain('bear != null && bull != null && spot != null')
    // Every figure a visual prints is read from the frame, never generated.
    expect(src('components/ideas-v2/IdeaVisuals.tsx')).not.toMatch(/Math\.random/)
    // Stage is metadata and wears a pill. It is never drawn: a segmented fill
    // states a completion percentage the data does not assert, and a station
    // track spends the card's one visual slot on which queue an idea is in
    // rather than on anything about the position.
    const visuals = src('components/ideas-v2/IdeaVisuals.tsx')
    expect(visuals).toContain('export function StagePill')
    expect(visuals).not.toMatch(/DecisionState|MaturityTrack|STATIONS|CaseMap/)
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
      // Keyed by id: its title names the thesis date and changes with it.
      .toMatch(/<DesktopModule\s+id="new-since-review"/)
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
    /*
     * `today` mounts the shell on its own lens. Asserted as a mount rather
     * than as the exact next line: a pilot now gets the same shell with the
     * Get Started checklist and the first-session coverage prompt layered
     * above it, so the case arm is a branch and the adjacency no longer holds.
     * What matters is that both arms end at this shell and this lens.
     */
    const todayArm = page.slice(page.indexOf("case 'today':"), page.indexOf("case 'ideas':"))
    /*
     * One mount, on the arm that is not the pilot first run. An incomplete
     * pilot gets the mission INSTEAD of the Dashboard rather than on top of
     * it — layering meant the lens bar and every lens query sat under the
     * guidance — and `effectiveIsPilot` is already `hasGraduated ? false :
     * isPilot`, so the shell returns the moment the mission completes.
     */
    expect(todayArm.match(/<DashboardShell initialLens="today" \/>/g)).toHaveLength(1)
    expect(todayArm).toContain('pilotMode.effectiveIsPilot')
    expect(todayArm).toContain('PilotWelcomeBanner')
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

  it('keeps the order authoritative in Decisions', () => {
    const body = src('components/decisions-v2/DecisionsWorkspace.tsx')
    /*
     * The rule is unchanged and its basis moved. Size follows POSITION in the
     * list and nothing else, so the largest card is always the first and
     * nothing is reordered to make the page work; `sizeByRank` would let a
     * record's contents move it up the page.
     *
     * What the list is ordered BY is now the work rather than the date --
     * longest-waiting first -- because the lens lists what still wants
     * something rather than what happened last. `compareWork` is that order.
     */
    expect(body).toContain('sizeByRecency(i)')
    expect(body).toContain('flow="chronological"')
    /*
     * The ordering moved into the classifier. `compareWork` was the workspace's
     * own comparator; it is now `compareSituations`, applied by `selectForLens`
     * over `classifySituations` -- one place that decides both which records
     * make the lens and what order they come in, rather than a sort here and a
     * membership rule there. The invariant is unchanged: the lens lists what
     * still wants something, longest-waiting first.
     */
    expect(body).toContain('selectForLens(classifySituations(')
    expect(src('lib/desktop-decisions/classes.ts')).toContain('export function compareSituations')
    expect(body).not.toMatch(/sizeByRank/)
    const fn = src('components/desktop/DesktopTile.tsx')
    const band = fn.slice(fn.indexOf('export function sizeByRecency'))
    // Index alone. No rationale, no outcome, no sizing reaches it.
    expect(band.slice(0, band.indexOf('\n}'))).not.toMatch(/reason|outcome|status|note/)
  })

  it('lets a hero earn its space with a number when it has no chart', () => {
    const shell = src('components/desktop/DesktopTile.tsx')
    expect(shell).toContain('export function TileHeroNumber')

    /*
     * Portfolio no longer LEADS with the weight.
     *
     * It did, because the tile had no other object worth the space. Now every
     * position tile draws its price, so the hero earns its space with the
     * chart and the weight moved to the corner -- stated once, as a control
     * that opens the dollars, the shares and the active weight behind it.
     *
     * The rule underneath is unchanged and is what these assert: the weight
     * is said ONCE on a card, and it is not a numeral competing with the
     * ticker for the top of the tile.
     */
    const pw = src('components/portfolio-v2/PortfolioWorkspace.tsx')
    expect(pw).toContain('<WeightChip')
    expect(pw).not.toContain('<TileHeroNumber')
    // One statement of it per card: no second figure in the body.
    expect(pw).not.toContain('<WeightFigure')

    // Research still leads with the object -- the note that arrived, or the
    // age -- never a numeral for its own sake.
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

  it('offers no route to the pre-Today dashboard', () => {
    // Demotion was the previous stage: named as legacy, kept in the More
    // group. The surface behind it is retired now, so the entries are gone
    // and there is nothing to name.
    expect(header).not.toContain('Dashboard (legacy)')
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

  it('keeps the dashboard type routable, with no desktop surface on it', () => {
    /*
     * The TYPE survives because a saved session or a deep link can still
     * carry it, and because the pilot action dashboard is still hosted there
     * pending a separate decision about the pilot programme. What is gone is
     * the non-pilot desktop workbench and every way of asking for it.
     */
    expect(page).toContain("activeTab.type === 'dashboard'")
    expect(page).toContain('renderDashboardContent')

    /*
     * Every desktop surface that once lived on this type, by the components
     * only it rendered. The non-pilot workbench went first; `PilotActionDashboard`
     * followed once it was proved to own no access control, no setup state, no
     * walkthrough and no telemetry of its own.
     */
    for (const gone of [
      'DashboardFilters', 'DecisionSystem', 'ResearchWorkbench',
      'PortfolioWorkbench', 'PortfolioGrid', 'PilotActionDashboard',
    ]) expect(page).not.toContain(gone)

    // And no way in: the launcher's More group no longer offers it.
    const header = src('components/layout/Header.tsx')
    const more = header.slice(header.indexOf('>More<'))
    expect(more).not.toContain("type: 'dashboard'")
  })

  it('sends a legacy dashboard descriptor to the canonical Dashboard', () => {
    const aliases = src('lib/tabs/legacy-tab-aliases.ts')
    expect(aliases).toMatch(/'dashboard': \{ type: 'today', id: 'today'/)
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

  it('draws one card across every lens, and it is the Ideas card', () => {
    /*
     * ── The complaint this pins ──────────────────────────────────────────
     *
     * Ideas dropped its drop shadow and its large radius, and that was the
     * single most-noticed change made to it: a shadow under every tile makes
     * a field read as a stack of floating panels rather than one instrument,
     * and a large radius reads friendly where this surface is meant to read
     * precise. The other four lenses kept `rounded-xl` and `shadow-sm`, so
     * they went on looking like a different product one tab away -- reported
     * as "the other lenses don't look any different".
     *
     * A hairline and the page's own ground do the work, and hover moves the
     * border colour rather than lifting the card off the page.
     */
    // Comments stripped: this file explains the shadow it removed, and a
    // guard that reads its own prose would fail on the explanation.
    const code = (f: string) => src(f).replace(/\/\*[\s\S]*?\*\//g, '')
    for (const f of ['components/desktop/DesktopTile.tsx', 'components/today/TodayTile.tsx']) {
      expect(code(f)).toContain('rounded-[3px]')
      expect(code(f)).not.toContain('shadow-sm')
      expect(code(f)).not.toContain('hover:shadow-md')
    }

    /*
     * And the eyebrow is a line ON the card, not a header above it.
     *
     * Both tiles carried a separate top row with its own rule and its own
     * padding -- Today's was tinted as well -- which reads as a filed record
     * with a title bar whatever colour it is. That is what made these lenses
     * look like a queue beside Ideas' field of objects. Ideas puts the same
     * words on the same ground as the ticker, directly above it.
     */
    expect(code('components/desktop/DesktopTile.tsx'))
      .not.toContain("'flex flex-wrap items-center gap-1.5 border-b border-gray-200/70")
    expect(code('components/today/TodayTile.tsx')).not.toContain('bg-gray-50/80 px-3.5 py-2')

    /*
     * Rank and state are ink, not filled chips. A gallery of rounded filled
     * pills reads as tagged records; Ideas draws `SELL | DECIDING` as ink on
     * the card's own ground and every lens now does the same.
     */
    expect(code('components/today/TodayTile.tsx')).toContain('TONE_INK')
    expect(code('components/today/TodayTile.tsx')).not.toContain('TONE_PILL')
  })

  it('sizes a tile to its contents, and never to a floor', () => {
    /*
     * `gridAutoRows: minmax(168px, auto)` is a FLOOR, and it applied to every
     * lens that uses this gallery. A compact tile carrying a ticker and one
     * figure got 168px and left about a hundred of them blank; a hero
     * spanning two rows was guaranteed 336px whether or not it had that much
     * to say. Measured across Portfolio, Research and Decisions that was the
     * largest single quantity of white on each page, and no amount of
     * restyling the contents fixes a card taller than its contents by
     * construction.
     */
    expect(src('components/desktop/DesktopTile.tsx'))
      .toContain("gridAutoRows: 'minmax(88px, auto)'")

    /*
     * And the hero figure is subordinate to the ticker it describes.
     *
     * It was 44px in amber -- the largest and loudest thing on the page,
     * bigger than the object it was about. The Ideas system file names it:
     * a card that leads with a percentage instead of a name is a statistic,
     * not an investment object. The tone survives only for a genuine break,
     * where the number IS the finding; a thesis due for review is a fact
     * about the calendar, and painting its weight amber claims the position
     * is wrong when nobody has said so.
     */
    /*
     * The size is a `scale` prop now rather than a literal in one class
     * string: Portfolio was saying the same fact four different ways below
     * `large`, so the primitive grew the sizes instead of each lens
     * hand-rolling its own. The RULES are what matter and they are unchanged.
     */
    const hero = src('components/desktop/DesktopTile.tsx')
    // Hero is 30px, and 44px -- louder than the ticker -- never comes back.
    expect(hero).toMatch(/scale === 'hero' \? 'text-\[30px\]'/)
    expect(hero).not.toMatch(/text-\[44px\]/)
    expect(hero).toContain("font-mono font-semibold leading-[0.95]")
    // Only a genuine break inks it. A due review is a calendar fact.
    expect(hero).not.toMatch(/tone === 'review' \? 'text-amber/)
    expect(src('components/portfolio-v2/PortfolioWorkspace.tsx'))
      .not.toMatch(/tone === 'review' \? 'text-amber-700 dark:text-amber-500'\s*\n?\s*:\s*'text-gray-900/)
  })

  it('never draws a meter where it can draw the population', () => {
    /*
     * `TileBar` filled to `pct / max`, where max is the largest holding on
     * screen. For that largest holding -- the one a reader is most likely
     * looking at -- it is 100% full every time, saying nothing. Same defect
     * as the Ideas exposure bar, same fix: draw the set, ink the one you are
     * on.
     */
    const tile = src('components/desktop/DesktopTile.tsx')
    expect(tile).toContain('data-testid="tile-population"')
    expect(tile).toContain("const bars = (population?.length ?? 0) >= 10")
    // Rounded pill fills go with it: a fat rounded bar reads as progress
    // toward a limit, and there is no policy or constraint table anywhere in
    // this schema for it to be a fraction of.
    expect(tile).not.toContain('rounded-full bg-gray-200')

    /*
     * Positions only. Cash is not one.
     *
     * The first version filtered on `w > 0`, which let a 57.5% cash line into
     * the distribution: it became the ceiling and all twenty-two real
     * holdings drew as indistinguishable slivers. The lens already knows the
     * difference, which is why this looked broken rather than merely wrong.
     */
    expect(src('components/portfolio-v2/PortfolioWorkspace.tsx'))
      .toContain('.filter(r => !r.position.isCash && r.position.weightPct > 0)')
  })

  it('gives Decisions the visual its own record supports', () => {
    /*
     * Decisions has no price series and no returns, so the price chart every
     * other lens carries would be an invented fact. For two rounds that was
     * read as "nothing applies" and the cards stayed as prose above two
     * hundred pixels of nothing.
     *
     * But a decision has a size and a duration. `baselineWeight` to
     * `sizingWeight` IS the decision -- trimming NVDA from 7.4 to 5.0 is a
     * different object from adding 0.2 -- and how long a request sat before
     * anyone answered is the first thing that happened next, which is the
     * question this lens asks.
     */
    expect(src('components/decisions-v2/DecisionVisual.tsx')).toContain('export function DecisionSize')
    expect(src('components/decisions-v2/DecisionsWorkspace.tsx')).toContain('<DecisionSize')

    /*
     * And the outcome is ink, not a filled chip -- the treatment Ideas
     * removed and Today lost with it. Two of the five variants were carrying
     * a background AND a border AND a dashed border to say what the word
     * already said. The distinctions survive in `OUTCOME_INK`, because
     * telling them apart is the point of this lens.
     */
    expect(src('components/decisions-v2/DecisionVisual.tsx')).toContain('export const OUTCOME_INK')
    /*
     * Indexed by the outcome directly now. `OutcomeChip` held a local `kind`
     * and was deleted when the eyebrow started deduplicating its labels -- the
     * outcome word is dropped entirely when the reason already says it, which
     * a component that always rendered could not do. The ink is unchanged.
     */
    expect(src('components/decisions-v2/DecisionsWorkspace.tsx'))
      .toContain('OUTCOME_INK[outcomeOf(d.status)]')
  })

  it('states the book against its index without inventing a return', () => {
    /*
     * "How are we doing against the benchmark, and what is driving it" is the
     * first question anybody asks about a fund, and Portfolio opened with a
     * list ordered by weight -- a fact about the book rather than about any
     * decision. Owning 5.8% of Microsoft is a big position and a small bet,
     * and the page drew the 5.8 and hid the bet.
     */
    const panel = src('components/portfolio-v2/ActiveWeights.tsx')
    expect(panel).toContain('Against the benchmark')
    expect(panel).toContain('active share')

    /*
     * ── The line it must never draw ──────────────────────────────────────
     *
     * NOT "the fund returned 4.2% against the benchmark's 3.1%".
     * `portfolio_benchmark_weights` holds weights, not an index level, and
     * there is no return series for one anywhere in this schema -- so a
     * performance chart would require inventing one of those two numbers. A
     * chart that looks like attribution and is actually a guess is worse than
     * no chart, in a tool people size positions with.
     */
    const hook = src('hooks/useDesktopPortfolio.ts')
    expect(hook).toContain('What it does NOT hold is a benchmark return series')
    expect(hook).toContain('latestBenchmarkRows')

    /*
     * Both halves of the decision. A manager who owns none of the largest
     * constituent has taken a position on it exactly as much as one who
     * doubled it, and a list that only knows what you own can never say so.
     */
    expect(hook).toContain('The names the index holds and the book does not')

    /*
     * Interactive, and a way in: pointing names the bar, clicking opens the
     * position. The zero line is INSIDE the plot and takes no pointer events
     * -- as a sibling riding up over the bars it intercepted every one of
     * them, and the strip looked interactive while being inert.
     */
    expect(panel).toContain('onClick={() => onOpen(r.assetId)}')
    expect(panel).toContain('pointer-events-none absolute inset-x-0 top-1/2')

    /*
     * Five each end, and nothing in between.
     *
     * It drew every active position -- thirty bars on a book this size -- so
     * the strip was a full distribution whose middle twenty were rounding
     * rather than intent, carrying no decision anybody made and no name a
     * reader could act on. Ten bars leave room to LABEL each one, which is
     * the change that matters: the strip stops being a shape you must hover
     * to read and becomes a list you can read at a glance.
     *
     * Both ends are taken separately. Slicing the head alone gives ten
     * overweights on a long-only book and answers half the question.
     */
    expect(panel).toContain('const over = rows.filter(r => r.activePct > 0).slice(0, 5)')
    expect(panel).toContain('const under = rows.filter(r => r.activePct < 0).slice(0, 5).reverse()')
    expect(panel).toContain('{r.symbol ?? ')
  })

  it('says what the book did, and refuses to guess the index', () => {
    /*
     * A portfolio lens that cannot say what the fund did on its last day, and
     * which names were responsible, is a list of holdings -- and this one was.
     */
    const panel = src('components/portfolio-v2/DayPanel.tsx')
    expect(panel).toContain('Added most')
    expect(panel).toContain('Cost most')

    /*
     * The benchmark figure appears only when enough of the index could be
     * priced to compute one. An index file of 483 constituents against a
     * price cache covering the names this desk follows is not full coverage,
     * and a return computed over 60% of an index and printed as "the
     * benchmark" is a fabrication with a decimal point on it. The floor is
     * enforced in the hook and the gap is STATED, not blanked -- a blank
     * where a benchmark should be reads as a bug.
     */
    const hook = src('hooks/useDayPerformance.ts')
    expect(hook).toContain('const BENCH_COVERAGE_FLOOR = 0.8')
    expect(hook).toContain('coverage >= BENCH_COVERAGE_FLOOR ? benchPct : null')
    expect(panel).toContain('data-testid="bench-unpriced"')

    // Never "today". There is no intraday series in this schema; this is the
    // last close against the one before it, and the label says so.
    expect(panel).toContain('close {day.asOf')
    expect(hook).toContain('Not intraday')

    /*
     * A name the book does not hold contributed nothing to the book's day,
     * however far it moved. "What moved US" is the question.
     */
    expect(hook).toContain('if (a.weightPct > 0) {')
  })

  it('lets every lens be pointed at, not only Ideas', () => {
    /*
     * Ideas' primitives answer when a reader points at them; the other four
     * lenses drew pictures that answered nothing. A ladder IS a price axis and
     * a timeline IS a date axis -- every x on each of them is a value the
     * reader would otherwise compute by hand.
     *
     * Same contract as Ideas throughout: one piece of local state, a
     * crosshair, a zero-width guard because a rect measured before layout is
     * real and dividing by it prints "NaN", and a caption that swaps in place
     * so inspecting a chart never moves the chart.
     */
    const tile = src('components/desktop/DesktopTile.tsx')
    for (const probe of ['data-testid="tile-scale"', 'data-testid="tile-timeline"']) {
      expect(tile).toContain(probe)
    }
    expect(tile.match(/if \(r\.width <= 0\) return/g)?.length).toBeGreaterThanOrEqual(2)

    /*
     * Decisions states the size of the change on hover -- both ends were
     * labelled and the distance between them, the one number a reader was
     * doing arithmetic to get, was left to them.
     */
    const dv = src('components/decisions-v2/DecisionVisual.tsx')
    expect(dv).toContain("${delta >= 0 ? '+' : ''}${delta.toFixed(1)}% of the book")

    /*
     * ── One object per card, not two threads ─────────────────────────────
     *
     * An awaiting card drew the wait as a full-width rule and the size as a
     * second full-width rule directly beneath it: two hairlines of near
     * identical shape meaning different things, neither with enough ink to
     * read at a glance. The size visual carries the wait in its caption, and
     * the lifecycle is kept for records that actually have one.
     */
    /*
     * The lifecycle is the fallback, not the lead. A request that named no
     * size has no quantity to draw, but the wait is a fact and it is the
     * whole complaint on a card nobody has answered.
     */
    /*
     * The caption this asserted no longer exists anywhere in the lens, and had
     * not for several passes -- the assertion was stale, not protective.
     *
     * What it was defending is real and still holds: an unanswered request
     * whose size is unknown must still show the WAIT, because the wait is the
     * whole complaint on a card nobody has answered. That now lives in the
     * lifecycle fallback rather than in a sentence, so it is asserted
     * structurally.
     */
    const dws = src('components/decisions-v2/DecisionsWorkspace.tsx')
    expect(dws).toContain('drawsPath')
    expect(dws).toContain('pathHasIntervals')

    // A real axis with the book's own scale on it: a weight bar with no ticks
    // is a proportion of something the reader has to guess.
    expect(dv).toContain('const step = max > 12 ? 5 : max > 5 ? 2 : 1')
    // And the figures anchor outward from the span, clamped at the edges --
    // a position at 0% of the book pushed its label off the axis entirely.
    expect(dv).toContain("const dir = at < 8 ? 'right' : at > 92 ? 'left' : outward")
  })

  it('drops the desk shorthand and draws the ladder as an axis', () => {
    /*
     * "Spot" is desk shorthand for the current price. It was the caption, it
     * was in the note three times, and it was the boldest word on the card --
     * over the mark itself, in caps. It says nothing "price now" does not,
     * and the one thing it adds is the impression you need the vocabulary to
     * belong here. The framework's own words -- bear, base, bull -- stay:
     * those are the desk's names for its own cases.
     */
    const enrich = src('lib/today/enrich.ts')
    expect(enrich).toContain("caption: 'Price against the framework'")
    const visual = src('components/today/TodayVisual.tsx')
    expect(visual).not.toContain('>SPOT<')

    /*
     * And the band is an axis that answers when pointed at. Every x on a
     * ladder is a price; "what would a 12% drawdown put me at, and is that
     * still inside what we underwrote" needed arithmetic.
     */
    expect(visual).toContain('data-testid="scenario-band"')
    expect(visual).toContain('data-testid="scenario-scrub"')
    // Bear to bull, because that is what the axis IS. The old gradient ran
    // through blue in the middle and said nothing about its own ends.
    expect(visual).toContain('from-rose-500/[0.16] via-slate-400/[0.10] to-emerald-500/[0.16]')
  })

  it('never renders chart labels as stretched SVG text', () => {
    /*
     * The anchor label was `<text>` inside a plot with
     * `preserveAspectRatio="none"`, which scales x far more than y -- so
     * "LAST REVIEW" came out horizontally smeared, by a different amount at
     * every card width. Same defect that drew the Ideas end-markers as flat
     * ellipses, same fix: position it outside the stretched coordinate
     * system.
     */
    // Comments stripped: this file explains the <text> it removed, and a
    // guard that reads its own prose fails on the explanation.
    const visual = src('components/today/TodayVisual.tsx')
      .replace(/\/\*[\s\S]*?\*\//g, '')
    expect(visual).not.toContain('<text')
    // The label names the window's own anchor; its fallback never assumes a review.
    expect(visual).toContain("{(r.anchorLabel ?? 'Start').toLowerCase()}")
  })

  it('draws the one fact a stale card has, rather than nothing', () => {
    /*
     * `visualFor` suppresses the aging visual where the age is already a
     * metric, and says "fall through to no visual and let enrichment offer a
     * real one" -- right whenever enrichment CAN. For a name with no price
     * history it cannot, and the fall-through landed on nothing: a written
     * case nobody had revisited in eleven months rendered as a ticker, a
     * sentence and two hundred pixels of white.
     *
     * The duplication that rule avoids is a NUMBER. The strip states the
     * count; the line states the duration against a review cycle, which is
     * the thing a reader cannot do in their head and the whole finding on a
     * card whose complaint is that nobody has looked.
     */
    const enrich = src('lib/today/enrich.ts')
    expect(enrich).toContain('function ageVisual')
    expect(enrich).toContain('if (!e) return aged ? { ...item, visual: aged } : item')

    // Scaled to a year, not to the longest item on the page: a review cycle
    // is what a reader measures against, and a floating scale would make
    // eighteen months look like twelve.
    const visual = src('components/today/TodayVisual.tsx')
    expect(visual).toContain('const YEAR = 365')
    expect(visual).toContain('data-testid="aging-track"')
  })

  it('gives Decisions two visuals, and picks by what the record holds', () => {
    /*
     * A decision has a SIZE and it has a LIFE, and they are different shapes:
     * one distance on one axis, against a sequence with gaps in it. Drawing
     * only the first made every card in this lens the same picture.
     *
     * Every mark on the path is a stored timestamp. The LENGTHS between them
     * are the finding: a decision taken in a day and executed three weeks
     * later is a different failure from one that sat unanswered for three
     * weeks and then filled immediately, and the record has always known
     * which happened.
     */
    const vis = src('components/decisions-v2/DecisionVisual.tsx')
    expect(vis).toContain('export function DecisionPath')
    expect(vis).toContain('export function DecisionSize')

    // Chosen by the record, not by the layout: a request nobody has answered
    // is about the wait, a resolved one with a size is about the size.
    /*
     * And the visual follows the JOB, not the record's shape. A decision
     * nobody has answered is about the wait and the size asked for -- both
     * quantities. One taken with no reason written is about an ABSENCE, which
     * has no magnitude: drawing it as a bar of any length would be a lie
     * about it, so it gets the shape of the record with the empty slot as the
     * finding.
     */
    const ws = src('components/decisions-v2/DecisionsWorkspace.tsx')
    /*
     * ── Every card gets one, at every size ───────────────────────────────
     *
     * Two gates suppressed most of them, and both looked reasonable because
     * the fixture happened to dodge them. `DecisionSize` required a baseline
     * weight, which comes from `submission_snapshot` and plenty of real
     * records do not carry -- so most cards drew nothing. And every visual
     * was gated on `size !== 'compact'`, which is every card from the fourth
     * onward. Between them, a real queue of any length was a wall of prose.
     *
     * Neither gate protected anything. A request with no baseline still has
     * a size worth drawing, it just has no CHANGE, and the caption says which
     * it is showing. A compact tile still has room for an axis, it just
     * cannot carry ticks and both end labels.
     */
    /*
     * Still a ladder, and still ungated on baseline or density -- it simply
     * has a rung above it now (the price column at hero and large), so the
     * explain branch is a continuation rather than the opening `{`.
     */
    expect(ws).toContain("work === 'explain' ? (")
    /*
     * One deliberate density gate, which is the opposite of the two this case
     * removed. Those suppressed a visual that had something to draw. This one
     * chooses BETWEEN visuals on the smallest tile, where there is room for
     * exactly one: the share-of-book bar is the object this product draws most
     * -- every lens has one -- so at compact the price takes the slot, being
     * the one object that differs from the tile above.
     */
    expect(ws).toContain("outcome === 'open' && size !== 'compact'")
    expect(ws).toContain('drawsSpark')
    const visual = src('components/decisions-v2/DecisionVisual.tsx')
    expect(visual).toContain('const known = from != null')
    expect(visual).toContain('compact?: boolean')
    expect(src('components/decisions-v2/DecisionVisual.tsx')).toContain('export function RecordGaps')

    /*
     * A leg with no timestamp is drawn open, never estimated: an accepted
     * decision that was never executed ends at a hollow mark on today, which
     * is the true statement about it.
     */
    expect(vis).toContain("border-[2px] border-dashed border-slate-300")
  })

  it('does not make the reader wait on the index to see their own day', () => {
    /*
     * `active` needs the benchmark file, and its unheld half then needs a
     * second query for symbols. Keying the price query on `active` put it
     * third in a chain -- book, benchmark, names, prices -- so what the FUND
     * did and which of its names drove it, neither of which involves a
     * benchmark, arrived last and landed as new height in the header. That is
     * the hitch a reader sees.
     */
    const hook = src('hooks/useDayPerformance.ts')
    expect(hook).toContain('Priced off the BOOK, not off the active rows')
    expect(hook).toContain('const basis: ActiveWeight[] = active.length')
    // And the cache key is the symbols, not their count: two different sets
    // of the same size would otherwise share one entry.
    expect(hook).toContain("symbols.join('|')")

    // The header reserves the space those panels will occupy, so two late
    // arrivals are two fades rather than two jumps.
    expect(src('components/portfolio-v2/PortfolioWorkspace.tsx'))
      .toContain('data-testid="book-header-panels"')
  })

  it('loads through one placeholder shaped like the page', () => {
    /*
     * ── The hitch, finally measured ──────────────────────────────────────
     *
     * Two earlier passes went after the query waterfall and reserved space in
     * the header, and the reader kept reporting it. The actual cause was
     * simpler and neither pass could see it, because the harness stubs were
     * synchronous and only ever showed the settled page.
     *
     * With latency added: the placeholder drew six cards starting at the top
     * of the page, and the loaded lens has ~364px of header above its grid.
     * So the grid appeared at y=68 and then moved to y=432. The whole surface
     * jumped a third of the viewport on every load.
     *
     * Measured after: the tile row lands within 5px of where the placeholder
     * put it.
     *
     * The list, the book and the frames also used to hand over to three
     * different layouts in sequence -- a spinner, a grid of boxes, the page.
     * One placeholder stands for all three waits now, so the last handover is
     * the only visible change.
     */
    const body = src('components/portfolio-v2/PortfolioWorkspace.tsx')
    expect(body).toContain('data-testid="portfolio-skeleton"')
    /*
     * The placeholder reserves the header it knows is coming, and the
     * reservation follows the LAYOUT rather than being one number.
     *
     * A flat 210px was the height of ONE row of two panels. Below xl they
     * stack, so it reserved half of what two need and the grid dropped ~200px
     * when the second landed; above xl it was 15px short of the day panel and
     * the grid still stepped by that. Both were measured, not estimated, and
     * the second only after the first attempt had been declared done.
     */
    expect(body).toContain('min-h-[400px]')
    expect(body).toContain('xl:min-h-[200px]')
    // And stands in for the list wait too, rather than a separate spinner.
    expect(body).toContain('if (listLoading) {')
    expect(body).not.toContain('function Loading()')

    /*
     * A book that has not been read yet is loading, not empty. "This book has
     * no holdings on record" is a claim about a book that HAS been read, and
     * falling through to it while one is in flight is the same class of
     * mistake told in words instead of pixels.
     */
    expect(body).toContain('if (bookLoading || framesPending || !book) {')

    /*
     * And the panels carry no top margin of their own. A margin inside the
     * reserved row is height the row does not know about -- it was exactly
     * the 15px the grid kept stepping by.
     */
    expect(src('components/portfolio-v2/DayPanel.tsx'))
      .toContain('<section data-testid="day-panel">')
    expect(src('components/portfolio-v2/ActiveWeights.tsx'))
      .toContain('<section data-testid="active-weights">')
  })
})
