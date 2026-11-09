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
  /*
   * These replace four assertions that pinned the old shape — a conditional
   * spread of visibility/team_id into the UPDATE, and a gated delete/insert of
   * target rows. That shape is gone: the fields are pinned by a trigger and
   * the target table's write grants are revoked, so the client cannot perform
   * those writes at all. The invariant is unchanged and the guard moves with
   * it.
   */
  it('neither content path writes visibility or team_id on an UPDATE', () => {
    for (const name of ['saveContribution', 'publishDraft']) {
      const body = mutationBody(HOOK, name)
      const from = body.indexOf('.update({')
      const to = body.indexOf('.select(', from)
      expect(from, `${name}: no update found`).toBeGreaterThan(-1)
      expect(body.slice(from, to), name).not.toMatch(/\bvisibility\b|\bteam_id\b/)
    }
  })

  it('neither content path writes contribution_visibility_targets directly', () => {
    for (const name of ['saveContribution', 'publishDraft']) {
      expect(mutationBody(HOOK, name), name)
        .not.toMatch(/from\('contribution_visibility_targets'\)/)
    }
  })

  it('the audience is changed only through the RPC, and only on an explicit change', () => {
    for (const name of ['saveContribution', 'publishDraft']) {
      const body = mutationBody(HOOK, name)
      const call = body.indexOf('setContributionAudience(')
      expect(call, `${name}: audience is never set`).toBeGreaterThan(-1)
      const gate = body.lastIndexOf('if (isVisibilityChange)', call)
      const insertGate = body.lastIndexOf("if (visibility && visibility !== 'firm')", call)
      expect(Math.max(gate, insertGate), `${name}: audience set outside an explicit change`)
        .toBeGreaterThan(-1)
    }
  })

  it('the audience call runs AFTER the content write, so a refusal cannot discard prose', () => {
    const body = mutationBody(HOOK, 'saveContribution')
    expect(body.indexOf('.update({')).toBeLessThan(body.indexOf('setContributionAudience('))
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

  it('AssetTab points the guard at the level it is committing', () => {
    /*
     * This used to assert the guard was set to null inside
     * handleVisibilitySelect, which no longer exists — the level is now chosen
     * inside AudiencePicker and committed in one call.
     *
     * The invariant survives the move and inverts: the guard must name the
     * INCOMING level, so the level-change effect bails instead of clearing the
     * ids being committed alongside it. Setting null here would re-arm the
     * effect against this very call and wipe them.
     */
    const at = TAB.indexOf('const handleAudienceApply')
    expect(at).toBeGreaterThan(-1)
    const body = TAB.slice(at, at + 900)
    expect(body).toMatch(/rehydratedVisibilityRef\.current = next\.visibility/)
    expect(body).not.toMatch(/rehydratedVisibilityRef\.current = null/)
  })

  it('AudiencePicker does not carry one scope\'s ids into another', () => {
    // The other half of the same rule, now that the scope is chosen in the
    // picker: switching scope restores the saved ids for that scope, or none.
    const PICKER = readFileSync(
      join(process.cwd(), 'src/components/contributions/AudiencePicker.tsx'), 'utf8')
    const at = PICKER.indexOf('const chooseScope')
    expect(at).toBeGreaterThan(-1)
    expect(PICKER.slice(at, at + 400)).toMatch(/saved\?\.visibility === next \? saved\.targetIds : \[\]/)
  })

  it('AssetTab clears the guard when the asset changes', () => {
    const at = TAB.indexOf('setHasInitializedVisibility(false)')
    expect(at).toBeGreaterThan(-1)
    expect(TAB.slice(at, at + 260)).toMatch(/rehydratedVisibilityRef\.current = null/)
  })
})

describe('a restricted level with nothing to select is not applied', () => {
  it('the picker refuses to apply a restricted audience naming nobody', () => {
    /*
     * The rule has not changed: a restricted contribution with no groups is
     * readable by its author alone while displaying as shared. What changed is
     * where it lives — the old form silently left the level unchanged inside
     * handleVisibilitySelect; the picker now disables Apply and says why, and
     * the server refuses it with 23514 regardless.
     *
     * Behaviour is covered by rendering in
     * src/components/contributions/__tests__/audience-picker.test.tsx
     * ('refuses to apply a restricted audience naming nobody'). This pins that
     * the guard exists at all, since a missing one is silent.
     */
    const PICKER = readFileSync(
      join(process.cwd(), 'src/components/contributions/AudiencePicker.tsx'), 'utf8')
    expect(PICKER).toMatch(/const emptyRestricted = draft\.visibility !== 'firm' && draft\.targetIds\.length === 0/)
    expect(PICKER).toMatch(/const canApply = dirty && !emptyRestricted/)
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

  it('the audience is passed as the whole array, not a single id', () => {
    for (const name of ['saveContribution', 'publishDraft']) {
      expect(mutationBody(HOOK, name), name)
        .toMatch(/setContributionAudience\([\w.]+, visibility, targetIds \?\? \[\]\)/)
    }
  })
})

describe('the audience RPC is the only write path, and it reports failure', () => {
  it('calls set_contribution_audience with the documented parameters', () => {
    expect(HOOK).toMatch(/supabase\.rpc\('set_contribution_audience'/)
    for (const p of ['p_contribution_id', 'p_visibility', 'p_node_ids']) {
      expect(HOOK, p).toContain(p)
    }
  })

  it('throws the server message instead of logging and continuing', () => {
    const at = HOOK.indexOf('async function setContributionAudience')
    const body = HOOK.slice(at, HOOK.indexOf('\n}', at))
    expect(body).toMatch(/throw new Error\(error\.message/)
    expect(body).not.toMatch(/console\.(error|warn)/)
  })

  it('updateVisibility no longer writes the row, the targets, or updated_at', () => {
    const body = mutationBody(HOOK, 'updateVisibility')
    expect(body).toMatch(/return setContributionAudience\(/)
    expect(body).not.toMatch(/\.update\(/)
    expect(body).not.toMatch(/from\('contribution_visibility_targets'\)/)
    // A7: the history trigger stamps updated_at on content/attachment changes.
    // An audience change is neither, so writing it by hand would contaminate
    // the "last written" clock — which is what this path used to do.
    expect(body).not.toMatch(/updated_at/)
  })

  it('updateVisibility no longer swallows its own errors', () => {
    const body = mutationBody(HOOK, 'updateVisibility')
    expect(body).not.toMatch(/onError/)
    expect(body).not.toMatch(/console\.error/)
  })

  it('no write path outside the RPC helper touches the target table', () => {
    // The declaration in the select() is a read, so count write verbs only.
    const writes = HOOK.match(/from\('contribution_visibility_targets'\)\s*\n?\s*\.(insert|update|delete)/g) ?? []
    expect(writes, 'direct target writes remain').toHaveLength(0)
  })
})

describe('the refusal reaches the person who made the choice', () => {
  it('ContributionSection shows the server message, not a generic retry prompt', () => {
    expect(SECTION).toMatch(/setVisibilityError\(/)
    expect(SECTION).toMatch(/error instanceof Error && error\.message/)
    // "Please try again" contradicts a deliberate refusal: retrying an
    // identical, rejected audience cannot succeed.
    expect(SECTION).not.toMatch(/Failed to save visibility change\. Please try again\./)
    expect(SECTION).not.toMatch(/alert\('Failed to save visibility/)
  })

  it('renders it as an alert inside the menu, so the selection survives', () => {
    expect(SECTION).toMatch(/role="alert"/)
    expect(SECTION).toMatch(/\{visibilityError\}/)
  })

  it('clears the message when the menu resets', () => {
    const at = SECTION.indexOf('const resetVisibilityChangeState')
    expect(SECTION.slice(at, at + 400)).toMatch(/setVisibilityError\(null\)/)
  })
})
