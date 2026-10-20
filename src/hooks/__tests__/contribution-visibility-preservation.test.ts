/**
 * Saving prose must not change who can read it.
 *
 * ── Why these are source-pinned ──────────────────────────────────────────
 *
 * The defect was not a wrong value — it was a DEFAULT. `saveContribution` and
 * `publishDraft` declared `visibility = 'firm'` and `targetIds = []`, so any
 * caller that saved content without restating the visibility published
 * restricted research to the whole organization and deleted the audience rows
 * that recorded who it had been shared with. Nothing threw, nothing logged,
 * and the badge still showed a lock.
 *
 * `useContributions` cannot be mounted here (it needs a live Supabase client,
 * an auth session and an organization context), and mocking the client would
 * only prove that a mock received whatever the test told it to expect. So the
 * invariants are asserted against the source itself, the same way this repo
 * guards AssetTab and ContributionSection.
 *
 * The authorization half of this defect is NOT testable from here at all. It
 * lives in RLS, and it is covered by
 * `supabase/tests/contribution-visibility-security.sql`, which runs against
 * real database roles.
 */

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const read = (p: string) =>
  readFileSync(join(process.cwd(), p), 'utf8')
    // Comments explain the invariants; they must not be able to satisfy them.
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')

const HOOK    = read('src/hooks/useContributions.ts')
const SECTION = read('src/components/contributions/ContributionSection.tsx')
const TAB     = read('src/components/tabs/AssetTab.tsx')

/** The body of a named mutation, up to the next `const <name> = useMutation`. */
function mutationBody(src: string, name: string): string {
  const start = src.indexOf(`const ${name} = useMutation`)
  expect(start, `${name} not found`).toBeGreaterThan(-1)
  const rest = src.slice(start + 1)
  const next = rest.search(/const \w+ = useMutation/)
  return next === -1 ? rest : rest.slice(0, next)
}

describe('the defaults that caused the leak are gone', () => {
  it('saveContribution no longer defaults visibility to firm or targets to empty', () => {
    const body = mutationBody(HOOK, 'saveContribution')
    expect(body).not.toMatch(/visibility\s*=\s*'firm'/)
    expect(body).not.toMatch(/targetIds\s*=\s*\[\]/)
  })

  it('publishDraft no longer defaults visibility to firm or targets to empty', () => {
    const body = mutationBody(HOOK, 'publishDraft')
    expect(body).not.toMatch(/visibility\s*=\s*'firm'/)
    expect(body).not.toMatch(/targetIds\s*=\s*\[\]/)
  })

  it('neither path treats an absent visibility as a visibility change', () => {
    for (const name of ['saveContribution', 'publishDraft']) {
      const body = mutationBody(HOOK, name)
      expect(body, name).toMatch(/isVisibilityChange\s*=\s*visibility\s*!==\s*undefined/)
    }
  })
})

describe('a content save cannot touch the audience', () => {
  it('saveContribution writes visibility and team_id only on an explicit change', () => {
    const body = mutationBody(HOOK, 'saveContribution')
    // Every write of either column is inside the isVisibilityChange branch.
    expect(body).toMatch(/isVisibilityChange\s*\?\s*\{[\s\S]*?visibility,[\s\S]*?team_id:/)
    // The UPDATE payload reaches `visibility` only through that conditional
    // spread — the one before `.eq('id', existing.id)`.
    const update = body.slice(body.indexOf('.update({'), body.indexOf(".eq('id', existing.id)"))
    expect(update).toMatch(/\.\.\.\(isVisibilityChange \?/)
    expect(update.replace(/\.\.\.\(isVisibilityChange \?[\s\S]*?\} : \{\}\)/, ''))
      .not.toMatch(/\bvisibility\b|\bteam_id\b/)
  })

  it('publishDraft writes visibility and team_id only on an explicit change', () => {
    const body = mutationBody(HOOK, 'publishDraft')
    expect(body).toMatch(/isVisibilityChange\s*\?\s*\{[\s\S]*?visibility,[\s\S]*?team_id:/)
  })

  it('the delete/insert of target rows is gated on an explicit change in both paths', () => {
    for (const name of ['saveContribution', 'publishDraft']) {
      const body = mutationBody(HOOK, name)
      const del = body.indexOf("from('contribution_visibility_targets')")
      expect(del, `${name}: no target write found`).toBeGreaterThan(-1)
      const gate = body.lastIndexOf('if (isVisibilityChange)', del)
      expect(gate, `${name}: target rows replaced outside a visibility change`).toBeGreaterThan(-1)
    }
  })
})

describe('a restricted visibility must name an audience', () => {
  it('the guard exists and refuses non-firm with zero targets', () => {
    expect(HOOK).toMatch(/function assertVisibilityNamesAnAudience/)
    expect(HOOK).toMatch(/visibility\s*!==\s*'firm'\s*&&\s*targetIds\.length\s*===\s*0/)
  })

  it('is applied on all three write paths — save, publish, and explicit change', () => {
    for (const name of ['saveContribution', 'publishDraft', 'updateVisibility']) {
      expect(mutationBody(HOOK, name), name)
        .toMatch(/assertVisibilityNamesAnAudience\(/)
    }
  })
})

describe('the editor cannot submit an audience it never loaded', () => {
  /*
   * ContributionSection holds NO local target state. It has no control that
   * selects targets, so the only thing such state could contain at save time
   * is the empty array it was initialised with — which is precisely what
   * deleted the audience. The audience is owned by the AssetTab host and
   * arrives as `sharedTargetIds`.
   */
  it('ContributionSection declares no local target-id state', () => {
    expect(SECTION).not.toMatch(/useState<string\[\]>\(\[\]\)[\s\S]{0,40}selectedTargetIds/)
    expect(SECTION).not.toMatch(/\bselectedTargetIds\b/)
    expect(SECTION).not.toMatch(/\bsetSelectedTargetIds\b/)
  })

  it('ContributionSection sends no visibility on a content save unless the parent owns it', () => {
    expect(SECTION).toMatch(/const visibilityArgs = \(\)/)
    expect(SECTION).toMatch(/hideVisibility && sharedVisibility\s*\n?\s*\?\s*\{ visibility: sharedVisibility/)
    // The old unconditional pass-through is gone from both content paths.
    expect(SECTION).not.toMatch(/visibility:\s*visibilityToUse/)
    expect(SECTION).not.toMatch(/targetIds:\s*targetIdsToUse/)
  })

  it('both content paths spread visibilityArgs rather than naming visibility', () => {
    for (const call of ['saveContribution.mutateAsync', 'publishDraft.mutateAsync']) {
      const at = SECTION.indexOf(call)
      expect(at, call).toBeGreaterThan(-1)
      expect(SECTION.slice(at, at + 220), call).toMatch(/\.\.\.visibilityArgs\(\)/)
    }
  })
})

describe('rehydration is not undone by the level-change reset', () => {
  /*
   * The subtle half. Both hosts clear the target list when the visibility
   * level changes — correctly, since a team id is not a department id. But
   * loading a saved contribution ALSO changes the level, so the reset fired in
   * the same render cycle and wiped the audience that had just been read off
   * the row. AssetTab rehydrated correctly and still saved `targetIds: []`.
   */
  it('AssetTab guards the reset with the rehydrated level', () => {
    expect(TAB).toMatch(/rehydratedVisibilityRef\.current = savedVisibility/)
    expect(TAB).toMatch(
      /if \(rehydratedVisibilityRef\.current === sharedThesisVisibility\) return\s*\n\s*setSharedThesisTargetIds\(\[\]\)/
    )
  })

  it('AssetTab releases the guard once the user changes level themselves', () => {
    // Otherwise returning to the saved level would keep the other level's ids.
    const at = TAB.indexOf('const handleVisibilitySelect')
    expect(at).toBeGreaterThan(-1)
    expect(TAB.slice(at, at + 900)).toMatch(/rehydratedVisibilityRef\.current = null/)
  })

  it('AssetTab clears the guard when the asset changes', () => {
    const at = TAB.indexOf('setHasInitializedVisibility(false)')
    expect(at).toBeGreaterThan(-1)
    expect(TAB.slice(at, at + 260)).toMatch(/rehydratedVisibilityRef\.current = null/)
  })
})

describe('a restricted level with nothing to select is not applied', () => {
  it('AssetTab refuses the level instead of storing an empty audience', () => {
    const at = TAB.indexOf('const handleVisibilitySelect')
    const body = TAB.slice(at, at + 1200)
    // The old form set the level anyway when there was nothing to pick.
    expect(body).not.toMatch(/newVisibility === 'firm' \|\| targets\.length === 0/)
    expect(body).toMatch(/if \(targets\.length === 0\) return/)
  })
})

/**
 * The five shapes the brief named, mapped to where each is actually proven.
 *
 * Shared with ONE team, MULTIPLE teams, a DEPARTMENT, a DIVISION and NO
 * targets differ only in the contents of `visibility_targets` and the node
 * type behind each id. Nothing in the preservation logic branches on the node
 * type or the count — which is the point, and is what these assertions pin:
 * the audience is carried through untouched whatever it holds, and the one
 * shape that cannot be stored (none) is refused.
 *
 * Whether each shape then grants the right READERS is an authorization
 * question, not a preservation one, and is asserted per shape against real
 * database roles in supabase/tests/contribution-visibility-security.sql.
 */
describe('all five target shapes are carried through unbranched', () => {
  it('no write path branches on node_type or on the number of targets, except team_id', () => {
    for (const name of ['saveContribution', 'publishDraft']) {
      const body = mutationBody(HOOK, name)
      expect(body, name).not.toMatch(/node_type/)
      /*
       * The only count-dependent expressions left are the `team_id`
       * denormalisation (`length === 1`) and the `length > 0` guards on the
       * target insert — neither of which inspects WHICH nodes are targeted.
       * saveContribution has four (update + insert branches); publishDraft has
       * two. Nothing branches on one-vs-many for the audience itself.
       */
      const counts = body.match(/targetIds\s*\?\?\s*\[\]\)\.length/g) ?? []
      expect(counts.length, `${name}: unexpected count-dependent logic`).toBeLessThanOrEqual(4)
      for (const c of body.match(/targetIds\s*\?\?\s*\[\]\)\.length\s*[=><!]+\s*\d/g) ?? []) {
        expect(c, `${name}: count compared to something other than 1 or 0`)
          .toMatch(/(===\s*1|>\s*0)/)
      }
    }
  })

  it('the audience is written as the whole array, not a single id', () => {
    for (const name of ['saveContribution', 'publishDraft']) {
      expect(mutationBody(HOOK, name), name)
        .toMatch(/\(targetIds \?\? \[\]\)\.map\(nodeId => \(\{/)
    }
  })
})
