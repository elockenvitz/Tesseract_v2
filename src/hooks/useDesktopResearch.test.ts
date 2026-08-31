/**
 * The refresh contract between the shared mutation path and Research.
 *
 * Research does not own a write. It reads `asset_contributions` and derives
 * the review anchor from it, so the only way a save shows up here is if
 * `useContributions` invalidates Research's cache. Both sides agree on one
 * prefix, and a rename on either side silently breaks the loop -- the save
 * succeeds, the tile keeps saying "not reviewed", and nothing errors.
 *
 * These assertions are cheap precisely because that failure is silent.
 */

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const RESEARCH_PREFIX = 'desktop-research'
const src = (p: string) => readFileSync(join(process.cwd(), 'src', p), 'utf8')

describe('a save through the existing path refreshes Research', () => {
  const contributions = src('hooks/useContributions.ts')
  const research = src('hooks/useDesktopResearch.ts')

  it('reads every Research query under one prefix', () => {
    const keys = [...research.matchAll(/queryKey:\s*\[([^\]]+)\]/g)].map(m => m[1])
    expect(keys.length).toBeGreaterThanOrEqual(3)
    for (const key of keys) expect(key).toContain(`'${RESEARCH_PREFIX}'`)
  })

  it('invalidates that prefix when a contribution is saved', () => {
    const save = contributions.slice(
      contributions.indexOf('const saveContribution'),
      contributions.indexOf('const deleteContribution'),
    )
    expect(save).toContain(`queryKey: ['${RESEARCH_PREFIX}']`)
  })

  it('invalidates it when a draft is published too', () => {
    const publish = contributions.slice(
      contributions.indexOf('const publishDraft'),
      contributions.indexOf('const discardDraft'),
    )
    expect(publish).toContain(`queryKey: ['${RESEARCH_PREFIX}']`)
  })

  it('still writes through useContributions and nowhere else', () => {
    // Research reads asset_contributions; it must never update or insert it.
    for (const file of ['hooks/useDesktopResearch.ts',
                        'components/research-v2/ResearchDetail.tsx',
                        'components/research-v2/ResearchWorkspace.tsx']) {
      const body = src(file)
      expect(body).not.toMatch(/\.update\(|\.insert\(|\.upsert\(|\.delete\(/)
    }
  })

  it('sends authoring to the Asset page rather than editing in the Dashboard', () => {
    // Stage 3A moved this boundary. Research's focused workspace used to mount
    // the Asset page's own editor in place, which is the Dashboard rebuilding
    // the product it sits above. It now names the verb and hands off, so there
    // is still exactly one thesis editor -- just not here.
    const detail = src('components/research-v2/ResearchDetail.tsx')
    expect(detail).not.toContain('<ThesisContainer')
    expect(detail).toContain('openAsset({')
    // And no forked form, validation or draft handling either way.
    expect(detail).not.toMatch(/useContributions\s*\(/)
    expect(detail).not.toMatch(/from '\.\.\/\.\.\/hooks\/useContributions'/)
    expect(detail).not.toMatch(/<textarea|<input/)
  })
})

/**
 * The weight column that never existed.
 *
 * Research, Ideas and Portfolio all wanted "what does this name weigh". Two of
 * them asked `portfolio_holdings` for a `weight` column, and one also asked for
 * `market_value`. Neither exists -- the table carries shares, price, cost and
 * date -- so the select failed, the query returned nothing, and every tile
 * simply rendered without a weight. Nothing errored, which is why it survived
 * two stages.
 *
 * These assertions are cheap and the failure they catch is invisible.
 */
describe('weight is derived, and nobody asks for a column that is not there', () => {
  const files = [
    'hooks/useDesktopResearch.ts',
    'hooks/useDesktopIdeas.ts',
    'hooks/useDesktopPortfolio.ts',
  ]

  it('never selects weight or market_value from portfolio_holdings', () => {
    for (const f of files) {
      const body = src(f)
      for (const stmt of body.match(/from\('portfolio_holdings'\)[\s\S]{0,220}/g) ?? []) {
        expect(stmt).not.toMatch(/select\([^)]*\bweight\b/)
        expect(stmt).not.toMatch(/select\([^)]*\bmarket_value\b/)
      }
    }
  })

  it('routes every derivation through the one shared module', () => {
    for (const f of files) {
      expect(src(f)).toMatch(/from '\.\.\/lib\/portfolio\/holdings'/)
    }
  })

  it('keeps the derivation itself free of a stored-weight shortcut', () => {
    const holdings = src('lib/portfolio/holdings.ts')
    expect(holdings).toContain('marketValue / totalValue')
    expect(holdings).not.toMatch(/row\.weight|r\.weight_pct/)
  })
})
