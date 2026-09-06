/**
 * Ask AI from a part of an object asks about that part.
 *
 * The rule this pins is the one the brief was most explicit about: the
 * sub-object refines the question and never replaces the object. `objectId`
 * is untouched by every path here, so two findings about one ticker stay two
 * findings.
 */
import { describe, it, expect } from 'vitest'
import { withIntent } from '../engagement-intent'
import type { EngagementTarget } from '../../engagement'

const target: EngagementTarget = {
  objectType: 'asset', objectId: 'a-dash', label: 'DASH', symbol: 'DASH',
  issue: { title: 'Rating change with no follow-up', reason: 'RATING_NO_FOLLOWUP' },
  seedPrompt: 'General question about DASH.',
  contextChips: [{ label: 'Portfolio', value: 'Global Equity' }],
}

describe('withIntent', () => {
  it('leaves an overview engagement exactly as it was', () => {
    expect(withIntent(target, 'overview')).toBe(target)
  })

  it('never touches the identity of the object', () => {
    for (const intent of ['claim', 'framework', 'price', 'book'] as const) {
      const out = withIntent(target, intent)
      expect(out.objectId).toBe('a-dash')
      expect(out.objectType).toBe('asset')
      // The registry keys primary actions off the reason; changing it per
      // sub-object would silently unregister every verb.
      expect(out.issue?.reason).toBe('RATING_NO_FOLLOWUP')
    }
  })

  it('asks about the part the reader reached for', () => {
    expect(withIntent(target, 'framework').seedPrompt).toMatch(/cases we wrote/i)
    expect(withIntent(target, 'claim').seedPrompt).toMatch(/written case/i)
    // Not a string like "DASH framework": the question names the object and
    // the part, and the target still carries both structurally.
    expect(withIntent(target, 'framework').seedPrompt).toContain('DASH')
  })

  it('tells the pane which part it was given, above the context it had', () => {
    const out = withIntent(target, 'price')
    expect(out.contextChips?.[0]).toEqual({ label: 'Focus', value: 'Price history' })
    // The context it already carried is kept, not replaced.
    expect(out.contextChips).toContainEqual({ label: 'Portfolio', value: 'Global Equity' })
  })
})
