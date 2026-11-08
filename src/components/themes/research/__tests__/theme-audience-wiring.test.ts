/**
 * How the Theme page wires the audience control.
 *
 * ── What these guard ──────────────────────────────────────────────────────
 *
 * The theme page had its own two-level visibility select, `Org only` /
 * `Shared`, and both options meant the same thing: production's SELECT policy
 * was `... AND (visibility = 'shared' OR organization_id = current_org_id())`,
 * and every row's org IS the reader's org, so the column restricted nothing.
 * The control promised a restriction the database did not have.
 *
 * It now uses the asset page's `AudiencePicker` -- the same component, not a
 * theme-shaped copy -- over the same five levels, backed by
 * `set_theme_contribution_audience`. These assertions pin the parts of that
 * wiring that are silent when they break:
 *
 *   - a direct `visibility` write is REVERTED by the pin trigger, so putting
 *     it in an UPDATE patch reports success and changes nothing;
 *   - a content save that restates the audience can DESTROY one, so absence
 *     has to mean "preserve";
 *   - setting the level and the target ids in one handler lets the
 *     level-change effect wipe the ids in the same render, which once saved
 *     `targetIds: []` and deleted a restriction while the badge showed a lock.
 *
 * Neither page can be mounted here (both need a live Supabase client, auth and
 * organization context), so these are pinned against source, as this repo
 * already does for the asset page's half of the same control in
 * `src/components/tabs/__tests__/audience-picker.test.ts`.
 */

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

// Comments explain the invariants; they must not be able to satisfy them.
const strip = (s: string) => s
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '')

const read = (p: string) => strip(readFileSync(join(process.cwd(), p), 'utf8'))

const TAB     = read('src/components/themes/research/ThemeResearchTab.tsx')
const SECTION = read('src/components/themes/research/ThemeContributionSection.tsx')
const HOOK    = read('src/hooks/useThemeResearch.ts')
const REACH   = read('src/lib/contributions/audience-reach.ts')
const PICKER  = read('src/components/contributions/AudiencePicker.tsx')

describe('the Theme page delegates to the asset page\'s audience control', () => {
  it('renders AudiencePicker rather than its own', () => {
    expect(TAB).toMatch(/<AudiencePicker/)
    expect(TAB).toMatch(/from '\.\.\/\.\.\/contributions\/AudiencePicker'/)
  })

  it('leaves no second control behind', () => {
    // The old per-field select. Either option surviving means a control that
    // offers a restriction nothing enforces.
    expect(SECTION, 'the org/shared select is back')
      .not.toMatch(/<option value="org"/)
    expect(SECTION).not.toMatch(/<option value="shared"/)
    expect(SECTION).not.toMatch(/setVisibility/)
  })

  it('shows it only in the author\'s own view', () => {
    // Someone reading a colleague's research must not be offered a control
    // over who can see it.
    const at = TAB.indexOf('<AudiencePicker')
    expect(at).toBeGreaterThan(-1)
    expect(TAB.slice(Math.max(0, at - 300), at)).toMatch(/viewFilter === user\?\.id/)
  })

  it('feeds it from the shared org-chart hook, not a second query', () => {
    expect(TAB).toMatch(/useOrgAudienceContext\(\)/)
    expect(TAB, 'the theme page grew its own copy of the org-chart query')
      .not.toMatch(/queryKey: \['user-org-context'/)
  })
})

describe('the vocabulary is the one the database enforces', () => {
  it('is declared once, beside the constraint it mirrors', () => {
    expect(REACH).toMatch(/export type AudienceVisibility =[\s\S]{0,120}'portfolio'/)
    // Not redeclared in either consumer; both alias it.
    expect(PICKER).not.toMatch(/export type AudienceVisibility = '/)
    expect(HOOK).not.toMatch(/export type ThemeContributionVisibility = '/)
    expect(HOOK).toMatch(/ThemeContributionVisibility = AudienceVisibility/)
  })

  it('has no trace of the inert two-level vocabulary', () => {
    /* These are the words the old CHECK admitted. The new one rejects them,
       so a surviving literal is a write the database refuses with 23514. */
    for (const src of [HOOK, SECTION, TAB]) {
      expect(src).not.toMatch(/visibility[^\n]{0,40}'org'/)
      expect(src).not.toMatch(/visibility[^\n]{0,40}'shared'/)
      expect(src).not.toMatch(/\?\? 'org'/)
    }
  })

  it('defaults a brand-new contribution to firm', () => {
    // The reach the six pre-existing rows already had under 'org'. A default
    // of 'team' would restrict to a group the insert never named.
    expect(HOOK).toMatch(/visibility: input\.visibility \?\? 'firm'/)
  })
})

describe('an audience can only be changed through the RPC', () => {
  it('calls set_theme_contribution_audience, and only it', () => {
    expect(HOOK).toMatch(/\.rpc\('set_theme_contribution_audience'/)
    expect(
      HOOK.match(/\.rpc\('set_theme_contribution_audience'/g)?.length,
      'more than one call site for the audience write'
    ).toBe(1)
  })

  it('never puts visibility in an UPDATE patch', () => {
    /* The `a_pin_audience` trigger silently RESTORES the old value, so this
       write would report success and change nothing -- the UI then shows a
       restriction the database does not have. */
    expect(HOOK, 'visibility is being written directly; the trigger reverts it')
      .not.toMatch(/patch\.visibility/)
  })

  it('treats an absent level as PRESERVE, not as firm', () => {
    // A prose edit is not a visibility decision. Defaulting here is what
    // destroys an audience on an ordinary content save.
    expect(HOOK).toMatch(/const isVisibilityChange = input\.visibility !== undefined/)
    expect(HOOK).toMatch(/if \(isVisibilityChange\)/)
  })

  it('refuses a restricted audience that names nobody, before the round trip', () => {
    expect(HOOK).toMatch(/assertVisibilityNamesAnAudience\(/)
    // And the rule lives with the vocabulary, not in one subject's hook.
    expect(REACH).toMatch(/export function assertVisibilityNamesAnAudience/)
  })

  it('installs the audience AFTER the content write', () => {
    /* So a refused audience change cannot discard the prose just typed. The
       two are deliberately not atomic: losing an edit to a rejected
       visibility choice is the worse failure. */
    const body = HOOK.slice(HOOK.indexOf('const upsertContribution'))
    const update = body.indexOf('.update(patch)')
    const rpc = body.indexOf('setThemeContributionAudience(')
    expect(update).toBeGreaterThan(-1)
    expect(rpc).toBeGreaterThan(-1)
    expect(rpc).toBeGreaterThan(update)
  })
})

describe('committing a draft cannot wipe the targets it just set', () => {
  /*
   * The level-change effect clears targetIds whenever the level changes and
   * the rehydration ref does not match. Setting the level and the ids in the
   * same handler batches them, the effect then sees a level change, and the
   * ids are gone -- which on the asset page once saved `targetIds: []` and
   * destroyed a restriction while the badge still showed a lock.
   */
  it('sets the rehydration ref to the incoming level BEFORE the state', () => {
    const at = TAB.indexOf('const handleAudienceApply')
    expect(at).toBeGreaterThan(-1)
    const body = TAB.slice(at, at + 900)
    const ref = body.indexOf('rehydratedVisibilityRef.current = next.visibility')
    const setLevel = body.indexOf('setSharedVisibility(next.visibility)')
    expect(ref).toBeGreaterThan(-1)
    expect(setLevel).toBeGreaterThan(-1)
    expect(ref).toBeLessThan(setLevel)
  })

  it('sets the ref before the state on REHYDRATION too', () => {
    // The load path has the same hazard: it restores a level and its ids
    // together, and the effect would wipe the ids in the same render.
    const at = TAB.indexOf('rehydratedVisibilityRef.current = level')
    expect(at).toBeGreaterThan(-1)
    expect(at).toBeLessThan(TAB.indexOf('setSharedVisibility(level)'))
  })

  it('commits both halves of the selection', () => {
    const body = TAB.slice(TAB.indexOf('const handleAudienceApply'), TAB.indexOf('const handleAudienceApply') + 900)
    expect(body).toMatch(/setSharedVisibility\(next\.visibility\)/)
    expect(body).toMatch(/setSharedTargetIds\(next\.targetIds\)/)
  })

  it('does not report a refused audience as saved', () => {
    /*
     * `savedAudience` is what the footer states is stored, so it must be
     * written only after the server has confirmed. It sits AFTER the await,
     * so a rejection skips it, and nothing catches that rejection here --
     * AudiencePicker does, and shows the server's own words with the draft
     * intact.
     *
     * This assertion used to pin a `catch (e) { throw e }` wrapper. That was
     * pinning the MECHANISM, and the mechanism was a no-op eslint rightly
     * rejected (no-useless-catch). The claim is the ordering, so that is what
     * it now asserts.
     */
    const at = TAB.indexOf('const handleAudienceApply')
    const body = TAB.slice(at, at + 1400)
    const awaited = body.indexOf('await updateVisibility(')
    const save = body.indexOf('setSavedAudience(')
    expect(awaited).toBeGreaterThan(-1)
    expect(save).toBeGreaterThan(-1)
    expect(save, 'the audience is reported as saved before the server confirms')
      .toBeGreaterThan(awaited)
    expect(body, 'a catch here would swallow the refusal the picker needs')
      .not.toMatch(/catch/)
  })

  it('does not report an UNWRITTEN audience as saved either', () => {
    /* Found in the running app: an author who opens the picker before writing
       anything has no row to update, so the write is a no-op. Reporting that
       as saved would read "Saved: Growth Team" with nothing in the database --
       the same class of lie as a refused change looking saved. */
    const at = TAB.indexOf('const handleAudienceApply')
    const body = TAB.slice(at, at + 1400)
    expect(body).toMatch(/const written = await updateVisibility\(/)
    expect(body).toMatch(/if \(written\.length > 0\)/)
    const guard = body.indexOf('written.length > 0')
    expect(guard).toBeLessThan(body.indexOf('setSavedAudience('))
  })
})

describe('what a reader is told', () => {
  it('names the saved audience rather than labelling it "Shared"', () => {
    expect(SECTION).toMatch(/describeAudience\(/)
    expect(SECTION, 'the badge is back to naming a reach twice')
      .not.toMatch(/> Shared$/m)
  })

  it('flags a restricted contribution that names no group', () => {
    // The server refuses to create this, so seeing it means a row predates
    // the restriction and only its author can read it.
    expect(SECTION).toMatch(/targetIds\.length === 0/)
    expect(SECTION).toMatch(/Only you/)
  })

  it('shows a refused save in place instead of only logging it', () => {
    const at = SECTION.indexOf('const commitEdit')
    const body = SECTION.slice(at, at + 1200)
    expect(body).toMatch(/setSaveError\(/)
    expect(SECTION).toMatch(/role="alert"/)
    // The editor must stay open so the prose survives a refusal.
    const catchAt = body.indexOf('catch')
    expect(body.slice(catchAt)).not.toMatch(/setIsEditing\(false\)/)
  })

  it('states the audience a save will be written under', () => {
    expect(SECTION).toMatch(/Visible to \$\{audience\}/)
    // And says so honestly when the page has not resolved one: `undefined`
    // visibility preserves what is stored rather than publishing to firm.
    expect(SECTION).toMatch(/Audience unchanged/)
    expect(SECTION).toMatch(/\.\.\.\(sharedVisibility/)
  })
})
