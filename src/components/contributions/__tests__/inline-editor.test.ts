import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

/**
 * UX1c-2 — inline Investment Case editing + unsaved-work safety.
 *
 * ContributionSection carries ~15 hooks (Supabase queries, mutations, an org-
 * chart walk) and cannot be mounted affordably, so — like the other AssetTab
 * reading tests — these pin the behaviour against comment-stripped source. What
 * must hold: the inline path does NOT take over the viewport, Cancel never
 * silently discards dirty work, and the persistence path is byte-for-byte the
 * one that already shipped. Non-inline callers keep the exact previous editor.
 */

const SRC = resolve(__dirname, '../../..')
const codeOf = (s: string) =>
  s.split('\n').map(l => l.replace(/\/\/.*$/, '')).join('\n').replace(/\/\*[\s\S]*?\*\//g, '')

const CONTRIB = codeOf(readFileSync(resolve(SRC, 'components/contributions/ContributionSection.tsx'), 'utf8'))
const ASSET_TAB = codeOf(readFileSync(resolve(SRC, 'components/tabs/AssetTab.tsx'), 'utf8'))

describe('UX1c-2: inline editor expands in place, no viewport takeover', () => {
  it('skips the full-screen expand/scroll-lock effect when inline', () => {
    // The takeover effect animates the card to the scroll height and locks the
    // page scroll; inline must bail out of it before any of that runs.
    expect(CONTRIB).toContain('if (inline || overlay) return')
  })

  it('bounds the inline editor height instead of filling the viewport', () => {
    expect(CONTRIB).toContain('max-h-[55vh]')
    // the full-screen path (flex-1 fill) is still present for non-inline callers
    expect(CONTRIB).toContain('flex-1 min-h-0 flex flex-col overflow-hidden')
  })

  it('is opt-in: default OFF so other ContributionSection callers are unchanged', () => {
    expect(CONTRIB).toMatch(/inlineEditor\s*=\s*false/)
    expect(CONTRIB).toMatch(/inline\s*=\s*false/) // EditingPane prop default
  })

  it('AssetTab turns it on for both case section renders', () => {
    expect((ASSET_TAB.match(/inlineEditor/g) ?? []).length).toBeGreaterThanOrEqual(2)
  })
})

describe('UX1c-2: unsaved work is never silently discarded', () => {
  it('Cancel while dirty asks before discarding (inline only)', () => {
    expect(CONTRIB).toMatch(/if \(guardedEditor && isDirty\)/)
    expect(CONTRIB).toContain('setShowCancelConfirm(true)')
  })

  it('tracks dirtiness against the content the editor opened with', () => {
    expect(CONTRIB).toContain('editBaselineRef')
    expect(CONTRIB).toMatch(/const isDirty = isEditing && editContent\.trim\(\) !==/)
  })

  it('warns on page unload while editing dirty (inline only)', () => {
    expect(CONTRIB).toContain("addEventListener('beforeunload'")
    // gated behind the inline flag, not fired for every section
    expect(CONTRIB).toMatch(/if \(!guardedEditor\) return[\s\S]{0,400}addEventListener\('beforeunload'/)
  })

  it('shows a confirm dialog for the cancel case', () => {
    expect(CONTRIB).toMatch(/isOpen=\{showCancelConfirm\}/)
  })
})

describe('UX1c-2: persistence and permissions are unchanged', () => {
  it('still saves / drafts / publishes / discards through the same mutations', () => {
    expect(CONTRIB).toContain('saveContribution.mutateAsync')
    expect(CONTRIB).toContain('saveDraft.mutateAsync')
    expect(CONTRIB).toContain('publishDraft.mutateAsync')
    expect(CONTRIB).toContain('discardDraft.mutateAsync')
  })

  it('inline and full-screen run the SAME action handler (no second save path)', () => {
    // The only difference is the collapse animation, not what the button does.
    expect(CONTRIB).toContain('const run = (action: () => void) => (inline || overlay ? action() : collapseAndRun(action))')
  })

  it('does not add a second editor implementation', () => {
    // One editor component; inline is a layout branch inside it.
    expect((CONTRIB.match(/function EditingPane/g) ?? []).length).toBe(1)
  })
})
