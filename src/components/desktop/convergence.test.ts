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

const WORKSPACES = [
  'components/ideas-v2/IdeasWorkspace.tsx',
  'components/research-v2/ResearchWorkspace.tsx',
  'components/portfolio-v2/PortfolioWorkspace.tsx',
  'components/decisions-v2/DecisionsWorkspace.tsx',
]

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

describe('one entry grammar for the four object workspaces', () => {
  it('opens straight into the split workspace, deterministically', () => {
    for (const f of WORKSPACES) {
      expect(src(f)).toMatch(/\?\?\s*(ranked|rows)\[0\]\s*\?\?\s*null/)
    }
  })

  it('shares one navigator shell', () => {
    for (const f of WORKSPACES) {
      expect(src(f)).toContain("from '../desktop/DesktopNavigator'")
      expect(src(f)).toContain('<DesktopNavigator')
    }
  })

  it('has no per-row call to action left in an index', () => {
    // Strip comments first: these files explain WHY the buttons went, and the
    // explanation must not read as the button coming back.
    const code = (f: string) =>
      src(f).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
    for (const f of WORKSPACES) {
      const body = code(f)
      expect(body).not.toContain('Revisit this decision')
      expect(body).not.toContain('Full scan')
      expect(body).not.toContain('Full book')
      expect(body).not.toContain('All decisions')
    }
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
    expect(header).toContain('Dashboard (legacy)')
    expect(src('pages/DashboardPage.tsx')).toContain("title: 'Dashboard (legacy)'")
    // Still reachable — demoted, not removed.
    expect(header).toContain("type: 'dashboard'")
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
  it('Ideas routes to Research through the typed seam', () => {
    const body = src('components/ideas-v2/IdeaDetail.tsx')
    expect(body).toContain('researchTabFor')
    expect(body).toContain('openResearch')
    expect(body).toContain("origin: 'ideas'")
    expect(body).not.toContain('setTimeout')
  })

  it('Research routes to Ideas only when a live idea exists', () => {
    const body = src('components/research-v2/ResearchDetail.tsx')
    expect(body).toContain('ideasTabFor')
    expect(body).toContain('openIdea')
    expect(body).toContain("origin: 'research'")
    expect(body).toContain('detail?.liveIdea &&')
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
