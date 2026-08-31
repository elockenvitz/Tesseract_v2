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

  it('mounts the Asset page editor rather than a second one', () => {
    const detail = src('components/research-v2/ResearchDetail.tsx')
    expect(detail).toContain("from '../contributions'")
    expect(detail).toContain('<ThesisContainer')
    // No forked form, validation or draft handling: Research never calls the
    // mutation hook itself, and never renders an input of its own.
    expect(detail).not.toMatch(/useContributions\s*\(/)
    expect(detail).not.toMatch(/from '\.\.\/\.\.\/hooks\/useContributions'/)
    expect(detail).not.toMatch(/<textarea|<input/)
  })
})
