/**
 * "Since you last looked" gets something true to compare against.
 *
 * `attention_user_state.last_viewed_at` has existed for a long time and has
 * never been written -- zero rows carry one. So every "new since" in the
 * product measures against the wrong thing: Research counts notes newer than
 * the THESIS date, which means a note you read yesterday still reads as new,
 * and goes on reading as new until somebody edits the thesis.
 *
 * Two properties matter and both are easy to get quietly wrong: the cursor
 * must only move on a REAL view, and the prior value must be readable before
 * it moves. Advancing first would answer every "what changed since you last
 * looked" with "nothing".
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, it, expect } from 'vitest'
import { objectViewKey, VIEW_NAMESPACE, toAttentionKey } from '../keys'

const src = (p: string) => readFileSync(path.join(process.cwd(), 'src', p), 'utf8')

describe('the cursor key', () => {
  it('is scoped by org, subject type and subject', () => {
    expect(objectViewKey('org-1', 'asset', 'a-1')).toBe('view:org-1:asset:a-1')
  })

  /* The same analyst can hold the same asset in two pilot orgs. The table has
     no organization_id column, so the org has to be in the key or the two
     workspaces share one cursor. */
  it('separates the same object in two orgs', () => {
    expect(objectViewKey('org-1', 'asset', 'a-1'))
      .not.toBe(objectViewKey('org-2', 'asset', 'a-1'))
  })

  it('separates an idea from an asset with the same id', () => {
    expect(objectViewKey('org-1', 'idea', 'x'))
      .not.toBe(objectViewKey('org-1', 'asset', 'x'))
  })

  /* A shared row would merge two workspaces, which is worse than no answer. */
  it('refuses to produce a key without an org or a subject', () => {
    expect(objectViewKey(null, 'asset', 'a-1')).toBeNull()
    expect(objectViewKey('org-1', 'asset', null)).toBeNull()
    expect(objectViewKey('org-1', 'asset', '   ')).toBeNull()
  })

  /* A view and a disposition are different questions about different
     subjects. Sharing a key would let opening an asset mark a finding seen. */
  it('cannot collide with a disposition key', () => {
    const view = objectViewKey('org-1', 'asset', 'a-1')!
    expect(view.startsWith(VIEW_NAMESPACE)).toBe(true)
    expect(toAttentionKey('attention', 'a-1')).not.toBe(view)
    expect(toAttentionKey('decision', 'a-1')).not.toBe(view)
  })
})

describe('the cursor is read before it is advanced', () => {
  const hook = src('hooks/useObjectViewCursor.ts')

  /* The whole point. Reading after the upsert would compare now against now. */
  it('fetches the prior value ahead of the write', () => {
    const effect = hook.slice(hook.indexOf('void (async () => {'))
    const body = effect.slice(0, effect.indexOf('queryClient.invalidateQueries'))
    expect(body.indexOf('fetchViewCursor')).toBeLessThan(body.indexOf('.upsert('))
  })

  it('exposes the prior value, and says when it is known', () => {
    expect(hook).toContain('previous: string | null')
    expect(hook).toContain('ready: boolean')
    expect(hook).toContain('setCursor({ previous, ready: true })')
  })

  /* A first-ever view is "everything is new", not "nothing is new" -- `ready`
     is what lets a caller tell those apart from a not-yet-loaded null. */
  it('starts not-ready rather than claiming never-viewed', () => {
    expect(hook).toContain('useState<ObjectViewCursor>({ previous: null, ready: false })')
  })

  it('writes the cursor to the existing column', () => {
    expect(hook).toContain('last_viewed_at: now')
    expect(hook).toContain("from('attention_user_state')")
    expect(hook).toContain("onConflict: 'user_id,attention_id'")
  })

  /* A failed cursor write costs one stale comparison. Breaking the detail the
     reader came for would cost them the visit. */
  it('does not break the detail when the write fails', () => {
    expect(hook).toContain('console.warn')
    const after = hook.slice(hook.indexOf('[ViewCursor]'))
    expect(after.slice(0, 200)).not.toContain('throw')
  })

  /* A cursor answers "what is the latest". An append-only view log would be
     the noisiest table in the product and answer it more slowly. */
  it('creates no view event', () => {
    // The comment block explains why there is no event, so assert against the
    // code rather than the prose that discusses it.
    expect(hook).not.toContain("from('memory_events')")
    expect(hook).not.toContain("event_type:")
  })
})

describe('only a real detail open counts', () => {
  /* A re-render is not a second visit; a repeat OPEN is, because the pane
     remounts and the ref is fresh. */
  it('records once per mounted object, not once per render', () => {
    const hook = src('hooks/useObjectViewCursor.ts')
    expect(hook).toContain('recordedRef.current === key')
    expect(hook).toContain('recordedRef.current = key')
  })

  it.each([
    ['Research detail', 'components/research-v2/ResearchDetail.tsx', "useRecordObjectView('asset'"],
    ['Ideas detail', 'components/ideas-v2/IdeaDetail.tsx', "useRecordObjectView('idea'"],
  ])('is mounted in the %s pane', (_name, file, call) => {
    expect(src(file)).toContain(call)
  })

  /* The galleries render tiles. If the hook appeared there, every scroll past
     a card would count as having looked at it. */
  it.each([
    ['Research gallery', 'components/research-v2/ResearchWorkspace.tsx'],
    ['Ideas gallery', 'components/ideas-v2/IdeasWorkspace.tsx'],
    ['the idea tile', 'components/ideas-v2/IdeaCard.tsx'],
    ['Today', 'components/today/TodayPage.tsx'],
  ])('is not mounted in %s', (_name, file) => {
    expect(src(file)).not.toContain('useRecordObjectView')
  })
})
