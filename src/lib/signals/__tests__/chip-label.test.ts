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

  it('cuts at a word boundary in the source, not mid-word', () => {
    const source = 'Review the quarterly margin bridge before Thursday'
    const r = buildAttentionCard(attention({ next_action: source }))
    if (!r.ok) throw new Error(r.reason)
    const chip = r.card.context.find(c => c.label.endsWith('…'))
    expect(chip, 'expected a truncated chip').toBeTruthy()

    /**
     * The honest test of "ends on a word": the kept text must be a prefix of
     * the source, and the source must continue with a space.
     *
     * An earlier version asserted the label did not end in one or two lowercase
     * letters, which fails on "quarterly…" — a complete word that happens to
     * end in "ly". That tested spelling, not truncation.
     */
    const kept = chip!.label.slice(0, -1)
    expect(source.startsWith(kept)).toBe(true)
    expect(source[kept.length]).toBe(' ')
  })

  it('leaves short labels alone', () => {
    const r = buildAttentionCard(attention({ next_action: 'Review', tags: ['urgent'] }))
    if (!r.ok) throw new Error(r.reason)
    const labels = r.card.context.map(c => c.label)
    expect(labels).toContain('Review')
    expect(labels.some(l => l.includes('…'))).toBe(false)
  })
})
