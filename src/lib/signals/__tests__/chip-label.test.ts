import { describe, expect, it } from 'vitest'
import { buildAttentionCard } from '../builders/legacy-kinds'

/**
 * A chip is a label, not a sentence.
 *
 * `next_action` and workflow tags are free text, so an overdue card could carry
 * a whole instruction as one chip. Reported from a phone: "the Review lines are
 * terrible and extend beyond the screen."
 */
const attention = (over: Record<string, unknown> = {}) => ({
  attention_id: 'a1',
  attention_type: 'action_required',
  title: 'Q3 sector review is overdue',
  reason_text: 'You own this deliverable.',
  created_at: new Date().toISOString(),
  ...over,
}) as any

describe('context chips', () => {
  it('caps a long next_action instead of letting it run off the row', () => {
    const r = buildAttentionCard(attention({
      next_action: 'Review the Q3 model and confirm the margin assumptions with the team',
    }))
    if (!r.ok) throw new Error(r.reason)
    for (const chip of r.card.context) {
      expect(chip.label.length, `chip too long: ${chip.label}`).toBeLessThanOrEqual(27)
    }
  })

  it('keeps a sentence off the chip row entirely', () => {
    /**
     * This used to assert that a long `next_action` was truncated at a word
     * boundary — and it was, correctly, and the result still read as broken.
     *
     * "Update thesis, rating, or research for this covered name" clipped to
     * "Update thesis, rating…" and sat among middot-separated labels, which
     * looks like a rendering fault rather than like a label. Truncating well
     * was solving the wrong problem: a chip is a LABEL, and that string is a
     * sentence.
     *
     * The full text is already in the body, where prose has room. So the rule
     * is no longer "cut it nicely" but "prose does not belong here at all".
     */
    const source = 'Review the quarterly margin bridge before Thursday'
    const r = buildAttentionCard(attention({ next_action: source }))
    if (!r.ok) throw new Error(r.reason)
    expect(r.card.context.some(c => c.label.includes('…'))).toBe(false)
    expect(r.card.context.some(c => c.label.startsWith('Review the'))).toBe(false)
  })

  it('still says the thing somewhere the reader can read it', () => {
    // Dropping it from the chip row must not lose it. The body is where the
    // sentence goes, and a card that quietly discards its next action would be
    // a worse outcome than the clipped chip.
    const source = 'Review the quarterly margin bridge before Thursday'
    const r = buildAttentionCard(attention({ next_action: source }))
    if (!r.ok) throw new Error(r.reason)
    expect(r.card.body).toContain('quarterly margin bridge')
  })

  it('leaves short labels alone', () => {
    const r = buildAttentionCard(attention({ next_action: 'Review', tags: ['urgent'] }))
    if (!r.ok) throw new Error(r.reason)
    const labels = r.card.context.map(c => c.label)
    expect(labels).toContain('Review')
    expect(labels.some(l => l.includes('…'))).toBe(false)
  })
})
