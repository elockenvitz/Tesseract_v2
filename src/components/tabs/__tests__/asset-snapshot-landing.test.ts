/**
 * Where an asset opens, and whose intent decides it.
 *
 * ── The defect class this exists to prevent ──────────────────────────────
 *
 * Making the Snapshot the default landing is one line. Making it the default
 * landing WITHOUT discarding the sender's intent is the whole job: Research,
 * Ideas and Decisions all hand the reader over with an explicit `focus`, and
 * a new default that overrides it silently redirects a reader who was sent
 * somewhere specific to answer a specific question.
 *
 * That failure is invisible in a screenshot — the page looks right, it is
 * simply the wrong page — so it is asserted on the source of the one effect
 * that resolves arrival focus, rather than left to a mounted-component test
 * of a 4,500-line file that cannot be stood up here.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'

const src = (p: string) => readFileSync(path.join(process.cwd(), 'src', p), 'utf8')
/** Comment-stripped: a rule described in prose is not a rule. */
const code = (s: string) =>
  s.split('\n').map(l => l.replace(/\/\/.*$/, '')).join('\n').replace(/\/\*[\s\S]*?\*\//g, '')

const TAB = code(src('components/tabs/AssetTab.tsx'))

describe('the Snapshot is the default landing', () => {
  it('is a real sub-page in the union, not a special case', () => {
    expect(TAB).toMatch(/useState<'snapshot' \| 'research' \| 'workflow' \| 'decisions' \| 'lists'>/)
  })

  it('is what an asset opens on when nothing else is asked for', () => {
    expect(TAB).toMatch(/savedState\?\.activeSubPage \|\| 'snapshot'/)
  })

  it('still lets a saved sub-page win, so a tab reopens where it was left', () => {
    // The default answers "where does an asset open", not "where must you be".
    expect(TAB).toMatch(/TabStateManager\.loadTabState\(asset\.id\)[\s\S]{0,120}activeSubPage \|\| 'snapshot'/)
  })

  it('renders the Snapshot for that sub-page, and passes the already-fetched coverage', () => {
    expect(TAB).toMatch(/activeSubPage === 'snapshot' &&[\s\S]{0,400}<InvestmentSnapshot/)
    // A second coverage read for data the page already holds would be the
    // "collection of widgets" failure expressed as queries.
    expect(TAB).toMatch(/<InvestmentSnapshot[\s\S]{0,400}coverage=\{coverage \|\| \[\]\}/)
    expect(TAB).toMatch(/<InvestmentSnapshot[\s\S]{0,400}currentQuote=\{currentQuote\}/)
  })

  it('offers it in the tab bar', () => {
    expect(TAB).toMatch(/setActiveSubPage\('snapshot'\)/)
    expect(TAB).toMatch(/<span>Snapshot<\/span>/)
  })
})

describe('an explicit arrival focus still wins', () => {
  /** The one effect that maps `openAsset({ focus })` onto a sub-page. */
  const effect = TAB.match(/if \(asset\.focus === 'research'\)[\s\S]{0,400}?\}, \[asset\.focus, asset\.id\]\)/)?.[0] ?? ''

  it('exists', () => {
    expect(effect, 'the arrival-focus effect was renamed or removed').not.toBe('')
  })

  it('keeps research and decisions landing where their senders meant', () => {
    // ResearchDetail, ResearchWorkspace, IdeaDetail and DecisionDetail all
    // send `focus: 'research'`; DecisionDetail also sends 'decisions'.
    expect(effect).toMatch(/asset\.focus === 'research'\) setActiveSubPage\('research'\)/)
    expect(effect).toMatch(/asset\.focus === 'decisions'\) setActiveSubPage\('decisions'\)/)
  })

  it('gives overview and position the Snapshot, which is what they always meant', () => {
    // Both were no-ops before this page existed: `lib/ai/actions.ts` sends
    // 'overview' and PositionDetail sends 'position', and each landed the
    // reader on whatever sub-page they happened to use last.
    expect(effect).toMatch(/'overview'[\s\S]{0,60}setActiveSubPage\('snapshot'\)/)
    expect(effect).toMatch(/'position'[\s\S]{0,60}setActiveSubPage\('snapshot'\)/)
  })

  it('does not guess a home for framework', () => {
    // The framework lives inside Research's outcomes and has no sub-page.
    // Guessing one is worse than leaving the reader's saved page alone.
    expect(effect).not.toMatch(/'framework'/)
  })
})

describe('the replacement asset workspace stays parked', () => {
  it('is not what the Snapshot mounted', () => {
    // `asset-v2/AssetWorkspace` is explicitly experimental and guarded by
    // convergence.test.ts. The Snapshot reuses its canonical READ and the
    // shared layout primitives; it does not quietly un-park the component.
    expect(TAB).not.toContain('AssetWorkspacePane')
    expect(code(src('components/asset/InvestmentSnapshot.tsx'))).not.toContain('asset-v2')
  })
})
