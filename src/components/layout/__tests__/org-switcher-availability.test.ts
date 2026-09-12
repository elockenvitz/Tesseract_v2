/**
 * The workspace picker has to be there when the workspace is not.
 *
 * ── The defect ───────────────────────────────────────────────────────────
 *
 * The desktop switcher rendered inside `{currentOrg && (…)}`, and `currentOrg`
 * is `userOrgs.find(o => o.id === currentOrgId)`. So the moment the durable
 * current org stopped naming a workspace in the membership list — it was
 * deleted, the list is a beat behind a provisioning, or `healDecision` handed
 * back null because several remain and the reader has to choose — the whole
 * switcher disappeared. The one control that can fix a bad current org vanished
 * exactly when it was the only thing needed, and a newly provisioned org had
 * nowhere to be selected from.
 *
 * Both shells also required two or more organizations before the list would
 * open. That is right when one of them is already active and wrong when none
 * is: a single workspace nobody is in still has to be enterable.
 *
 * These read the source, because the claim is about a render condition and the
 * headers drag in the whole app shell to mount.
 */

import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, it, expect } from 'vitest'

const src = (p: string) => readFileSync(path.join(process.cwd(), 'src', p), 'utf8')

const header = src('components/layout/Header.tsx')
const drawer = src('components/mobile/MobileNavDrawer.tsx')

describe('the desktop switcher', () => {
  it('renders on the membership list, not on the resolved current org', () => {
    expect(header).toContain('{userOrgs.length > 0 && (')
    expect(header).not.toContain('{currentOrg && (')
  })

  it('opens when there is a choice, or when nothing is active', () => {
    expect(header).toContain('const canOpenOrgSwitcher = userOrgs.length > 1 || !currentOrg')
    expect(header).toContain('showOrgSwitcher && canOpenOrgSwitcher')
  })

  /**
   * A reader whose workspace is gone is in none, and it should say so — but
   * only once that is actually known. While the durable org is being verified
   * it is absent from the list without being gone, and claiming "Choose
   * workspace" there is a claim about something still in flight.
   */
  it('names the state when no workspace is active, and waits when unknown', () => {
    expect(header).toContain('const orgUnresolved = !currentOrg && !!currentOrgId')
    expect(header).toContain("orgUnresolved ? '…' : 'Choose workspace'")
  })

  /** Every read of the current org has to survive its absence now. */
  it('reads the current org optionally throughout', () => {
    expect(header).not.toMatch(/currentOrg\.(name|id|settings)/)
  })
})

describe('the phone drawer', () => {
  it('opens on the same rule', () => {
    expect(drawer).toContain('const canOpenOrgs = userOrgs.length > 1 || (userOrgs.length > 0 && !currentOrg)')
    expect(drawer).toContain('showOrgs && canOpenOrgs')
    expect(drawer).toContain('disabled={!canOpenOrgs}')
  })

  /** It said "Tesseract", which reads as a workspace rather than as none. */
  it('names the state when no workspace is active', () => {
    expect(drawer).toContain("'Choose workspace'")
  })
})

describe('the membership list stays fresh enough to pick from', () => {
  const ctx = src('contexts/OrganizationContext.tsx')

  /**
   * The Ops portal invalidates this key, which covers provisioning an org in
   * the same tab and not in another one — which is how it is actually done.
   */
  it('asks again when the tab is returned to', () => {
    const q = ctx.slice(ctx.indexOf("queryKey: ['user-organizations'"))
    const end = q.indexOf('})')
    expect(q.slice(0, end)).toContain('refetchOnWindowFocus: true')
  })

  it('no longer trusts a ten-minute-old answer', () => {
    expect(ctx).not.toContain('staleTime: 10 * 60 * 1000')
  })
})

/*
 * ── Landing somewhere, rather than being asked ─────────────────────────────
 *
 * "Choose workspace" was showing on an ordinary return to the product, because
 * the heal decision refused to pick whenever more than one organization
 * remained after the current one turned out to be gone. Refusing left
 * currentOrgId null, which is a reader who has workspaces being told they are
 * in none.
 */
describe('a reader with a workspace is put in one', () => {
  const heal = src('lib/org/current-org-heal.ts')

  it('takes the first available rather than asking', () => {
    expect(heal).toContain("return { kind: 'heal', target: remaining[0] }")
    expect(heal).not.toContain("kind: 'choose'")
  })

  /** A first session, or a column the database nulled with its organization. */
  it('adopts one when there was never a durable org', () => {
    expect(heal).toContain("? { kind: 'heal', target: cachedOrgIds[0] }")
  })

  /**
   * The guard that the original heal defect turned on: a cache that has not
   * loaded is not evidence that anything is wrong.
   */
  it('still decides nothing from a list that has not arrived', () => {
    expect(heal).toContain("if (isLoading) return { kind: 'none' }")
  })
})
