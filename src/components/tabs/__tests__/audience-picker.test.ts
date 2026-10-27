/**
 * How AssetTab wires the audience picker.
 *
 * The picker's own behaviour — drafts, Apply, Cancel, reach, failed saves —
 * is tested by rendering it, in
 * `src/components/contributions/__tests__/audience-picker.test.tsx`. These
 * assertions pin only what cannot be reached from there: that AssetTab
 * delegates rather than hand-rolling a second control, that it feeds the
 * picker EFFECTIVE reach, and that committing a draft cannot trip the
 * target-wiping effect this file has been bitten by before.
 *
 * AssetTab cannot be mounted here — it needs a live Supabase client, auth and
 * organization context — so these are pinned against source, as this repo
 * already does elsewhere for this file.
 */

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const TAB = readFileSync(join(process.cwd(), 'src/components/tabs/AssetTab.tsx'), 'utf8')
  // Comments explain the invariants; they must not be able to satisfy them.
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '')

describe('AssetTab delegates the audience control', () => {
  it('renders AudiencePicker instead of its own dropdown', () => {
    expect(TAB).toMatch(/<AudiencePicker/)
    expect(TAB).toMatch(/from '\.\.\/contributions\/AudiencePicker'/)
  })

  it('leaves no second picker behind', () => {
    // The old control was a two-step menu driven by these. Any of them
    // surviving means two controls can disagree about the same audience.
    expect(TAB).not.toMatch(/showVisibilityDropdown/)
    expect(TAB).not.toMatch(/visibilityStep/)
    expect(TAB).not.toMatch(/handleVisibilitySelect/)
    expect(TAB).not.toMatch(/handleTargetsConfirm/)
  })

  it('shows it only in the author\'s own view', () => {
    // Someone reading a colleague's research must not be offered a control
    // over who can see it.
    const at = TAB.indexOf('<AudiencePicker')
    expect(TAB.slice(Math.max(0, at - 200), at)).toMatch(/researchViewFilter === user\?\.id/)
  })
})

describe('the picker is fed effective reach', () => {
  it('passes the rolled-up counts, not a per-node tally', () => {
    expect(TAB).toMatch(/effectiveMemberCounts\(/)
    expect(TAB).not.toMatch(/memberCounts\.set\(m\.node_id/)
    const at = TAB.indexOf('<AudiencePicker')
    const props = TAB.slice(at, at + 600)
    expect(props).toMatch(/memberCounts=\{userOrgContext\?\.memberCounts/)
  })

  it('passes nodeById so a stored target resolves to a name, not a bare id', () => {
    const at = TAB.indexOf('<AudiencePicker')
    expect(TAB.slice(at, at + 600)).toMatch(/nodeById=\{userOrgContext\?\.nodeById/)
  })

  it('passes the saved audience, falling back to the live selection before it loads', () => {
    const at = TAB.indexOf('<AudiencePicker')
    expect(TAB.slice(at, at + 600)).toMatch(/saved=\{savedAudience \?\? \{ visibility: sharedThesisVisibility/)
  })

  it('tells the picker when the org context has not arrived', () => {
    const at = TAB.indexOf('<AudiencePicker')
    expect(TAB.slice(at, at + 600)).toMatch(/isLoading=\{!userOrgContext\}/)
  })
})

describe('committing a draft cannot wipe the targets it just set', () => {
  /*
   * The level-change effect clears targetIds whenever the level changes and
   * the rehydration ref does not match. Setting the level and the ids in the
   * same handler batches them, the effect then sees a level change, and the
   * ids are gone — which once saved `targetIds: []` and destroyed a
   * restriction while the badge still showed a lock.
   */
  it('sets the rehydration ref to the incoming level BEFORE the state', () => {
    const at = TAB.indexOf('const handleAudienceApply')
    expect(at).toBeGreaterThan(-1)
    const body = TAB.slice(at, at + 700)
    const ref = body.indexOf('rehydratedVisibilityRef.current = next.visibility')
    const setLevel = body.indexOf('setSharedThesisVisibility(next.visibility)')
    expect(ref).toBeGreaterThan(-1)
    expect(setLevel).toBeGreaterThan(-1)
    expect(ref).toBeLessThan(setLevel)
    // Clearing the ref here would re-arm the effect against this very call.
    expect(body).not.toMatch(/rehydratedVisibilityRef\.current = null/)
  })

  it('commits both halves of the selection', () => {
    const at = TAB.indexOf('const handleAudienceApply')
    const body = TAB.slice(at, at + 700)
    expect(body).toMatch(/setSharedThesisVisibility\(next\.visibility\)/)
    expect(body).toMatch(/setSharedThesisTargetIds\(next\.targetIds\)/)
  })
})

describe('the save path is untouched', () => {
  it('still hands the shared audience to both case renders', () => {
    // set_contribution_audience remains the only write path; the picker
    // stages, ContributionSection saves.
    expect(TAB.match(/sharedVisibility=\{sharedThesisVisibility\}/g)?.length).toBe(2)
    expect(TAB.match(/sharedTargetIds=\{sharedThesisTargetIds\}/g)?.length).toBe(2)
  })

  it('does not call the audience RPC from the page itself', () => {
    expect(TAB).not.toMatch(/set_contribution_audience/)
  })
})
