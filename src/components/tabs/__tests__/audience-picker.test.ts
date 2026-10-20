/**
 * The visibility picker must not promise an audience the policy won't deliver.
 *
 * The logic itself is pure and tested directly in
 * `src/lib/contributions/__tests__/audience-reach.test.ts`. What these
 * assertions pin is the WIRING — that AssetTab actually consults reachability
 * instead of a bare option count, and that it never rebuilds the audience from
 * a list the author did not see. AssetTab cannot be mounted here (it needs a
 * live Supabase client, auth and organization context), so the invariants are
 * pinned against source, as this repo already does elsewhere for this file.
 */

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const TAB = readFileSync(join(process.cwd(), 'src/components/tabs/AssetTab.tsx'), 'utf8')
  // Comments explain the invariants; they must not be able to satisfy them.
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '')

describe('reachability is read from direct membership', () => {
  it('counts direct members per node rather than assuming a node has any', () => {
    expect(TAB).toMatch(/from\('org_chart_node_members'\)[\s\S]{0,120}select\('node_id'\)/)
    expect(TAB).toMatch(/memberCounts\.set\(m\.node_id/)
  })

  it('feeds those counts into the shared reachability helper', () => {
    expect(TAB).toMatch(/buildAudienceOptions\(\{/)
    expect(TAB).toMatch(/memberCounts: userOrgContext\.memberCounts/)
  })
})

describe('a level that reaches nobody is not offered', () => {
  it('gates level selection on reachability, not on the number of options', () => {
    const at = TAB.indexOf('const handleVisibilitySelect')
    expect(at).toBeGreaterThan(-1)
    const body = TAB.slice(at, at + 1200)
    expect(body).toMatch(/if \(!isLevelSelectable\(options\)\) return/)
    // The old count-only test must be gone — it let an unreachable level through.
    expect(body).not.toMatch(/targets\.length === 0/)
  })

  it('disables the menu row and states the reason there', () => {
    expect(TAB).toMatch(/disabled=\{!selectable\}/)
    expect(TAB).toMatch(/emptyLevelReason\(/)
    expect(TAB).toMatch(/No one is a direct member\. Groups beneath it aren’t included\./)
  })

  it('never disables Firm, which always reaches the organization', () => {
    expect(TAB).toMatch(/option\.value === 'firm' \|\| isLevelSelectable\(options\)/)
  })
})

describe('an existing audience is shown, never silently rewritten', () => {
  it('keeps the saved audience separately from the live selection', () => {
    expect(TAB).toMatch(/setSavedAudience\(\{ visibility: savedVisibility, targetIds: savedIds \}\)/)
    expect(TAB).toMatch(/savedAudience\?\.visibility === visibility \? savedAudience\.targetIds : \[\]/)
  })

  it('lists the union of saved and live targets, so neither can be dropped', () => {
    expect(TAB).toMatch(/storedTargetIds = \[\.\.\.new Set\(\[\.\.\.savedForLevel, \.\.\.liveForLevel\]\)\]/)
  })

  it('resolves a stored target to its name rather than showing a bare id', () => {
    expect(TAB).toMatch(/storedNodes: storedTargetIds/)
    expect(TAB).toMatch(/userOrgContext\.nodeById\.get\(id\)/)
  })

  it('labels a target that is only present because it is already shared', () => {
    expect(TAB).toMatch(/target\.storedOnly &&/)
    expect(TAB).toMatch(/already shared/)
  })

  it('clears the saved audience when the asset changes', () => {
    const at = TAB.indexOf('setHasInitializedVisibility(false)')
    expect(TAB.slice(at, at + 300)).toMatch(/setSavedAudience\(null\)/)
  })
})

describe('an unreachable node that is already shared stays editable', () => {
  /*
   * The asymmetry is the point. Selecting an unreachable node would share with
   * nobody, so it is disabled. But one that is ALREADY in the audience must
   * stay clickable, or the author could never remove it — and a restriction
   * they cannot edit is one they cannot correct.
   */
  it('disables only the nodes that are neither reachable nor selected', () => {
    expect(TAB).toMatch(/disabled=\{!target\.reachable && !isSelected\}/)
  })

  it('explains an unreachable node in place', () => {
    expect(TAB).toMatch(/const reason = unreachableReason\(target\)/)
  })

  it('shows the member count for a reachable node, so reach is visible up front', () => {
    expect(TAB).toMatch(/\{target\.memberCount\} direct/)
  })
})

describe('the picker still cannot store an empty audience', () => {
  it('keeps Done disabled until something is selected', () => {
    const at = TAB.indexOf('handleTargetsConfirm()')
    expect(at).toBeGreaterThan(-1)
    expect(TAB.slice(at - 400, at + 400)).toMatch(/disabled=\{sharedThesisTargetIds\.length === 0\}/)
  })
})
