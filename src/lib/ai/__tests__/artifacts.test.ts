/**
 * Keeping an answer: what is offered, what is refused, and what the reader is
 * told before anything opens.
 *
 * ── The properties worth pinning ──────────────────────────────────────────
 *
 * 1. The body is passed through unchanged. A draft that differs from the
 *    answer it came from is a third version of the text, and the reader
 *    approved the one they saw.
 * 2. Every promotion carries provenance. The quick-thought form writes it to
 *    the record's `source_title`, and the prefill parser refuses a draft
 *    without one, so this is where the words are composed.
 * 3. The caveat is in the confirmation, always. An AI-written paragraph
 *    entering the research corpus is the moment to say it is not a decision
 *    and not an audit record.
 * 4. A streaming or empty answer cannot be kept at all.
 */
import { describe, it, expect } from 'vitest'
import {
  ARTIFACT_PROMOTIONS,
  artifactPromotion,
  buildArtifactPromotion,
  promotable,
  promotionConfirmation,
} from '../artifacts'

const answer = {
  role: 'assistant' as const,
  content: 'The target was set in March and the mark is 11% through it.',
  streaming: false,
}

const thought = artifactPromotion('thought')!

describe('what can be kept', () => {
  it('offers only kinds the quick-thought form has', () => {
    /* Three, because the form has three `idea_type` values. A trade idea and
       a recommendation are absent on purpose: neither form accepts initial
       content, so offering them would open an empty form after a dialog that
       promised a draft. */
    expect(ARTIFACT_PROMOTIONS.map(p => p.id)).toEqual(['thought', 'research_idea', 'thesis'])
    expect(ARTIFACT_PROMOTIONS.map(p => p.ideaType)).toEqual(['thought', 'research_idea', 'thesis'])
  })

  it('names no kind twice and nothing the form cannot store', () => {
    const ids = new Set(ARTIFACT_PROMOTIONS.map(p => p.id))
    expect(ids.size).toBe(ARTIFACT_PROMOTIONS.length)
    expect(artifactPromotion('trade_idea')).toBeUndefined()
    expect(artifactPromotion('recommendation')).toBeUndefined()
  })
})

describe('what cannot be kept', () => {
  it('refuses an answer still arriving', () => {
    /* Half a sentence promoted into a thesis draft is worse than no draft,
       and the reader has not read the end of it yet. */
    expect(promotable({ ...answer, streaming: true })).toEqual({ ok: false, reason: 'streaming' })
  })

  it('refuses an answer with nothing in it', () => {
    expect(promotable({ ...answer, content: '   ' })).toEqual({ ok: false, reason: 'empty' })
  })

  it('refuses the readers own turn, which the capture form already is', () => {
    expect(promotable({ ...answer, role: 'user' })).toEqual({ ok: false, reason: 'not_an_answer' })
  })

  it('builds nothing from a turn it refused', () => {
    for (const bad of [
      { ...answer, streaming: true },
      { ...answer, content: '' },
      { ...answer, role: 'user' as const },
    ]) {
      expect(buildArtifactPromotion({ message: bad, promotion: thought })).toBeNull()
    }
  })
})

describe('the capture request', () => {
  it('opens the quick-thought form with the answer, byte for byte', () => {
    const request = buildArtifactPromotion({
      message: answer, promotion: thought, conversationTitle: 'AAPL decisions',
    })!
    expect(request.captureType).toBe('idea')
    expect(request.prefill!.text).toBe(answer.content)
  })

  it('writes the provenance the record will carry', () => {
    const request = buildArtifactPromotion({
      message: answer, promotion: thought, conversationTitle: '  AAPL   decisions ',
    })!
    expect(request.prefill!.sourceTitle).toBe('ACT AI answer, AAPL decisions')
  })

  it('still says who wrote it when the thread has no title yet', () => {
    const request = buildArtifactPromotion({ message: answer, promotion: thought })!
    expect(request.prefill!.sourceTitle).toBe('ACT AI answer')
  })

  it('files it against the asset the pane was open on', () => {
    const request = buildArtifactPromotion({
      message: answer,
      promotion: thought,
      subject: { type: 'asset', id: 'a-aapl', label: 'AAPL' },
    })!
    expect(request.contextType).toBe('asset')
    expect(request.contextId).toBe('a-aapl')
    expect(request.contextTitle).toBe('AAPL')
    expect(request.prefill!.assetId).toBe('a-aapl')
  })

  it('files it against nothing when the subject is not an asset', () => {
    /* `asset_id` on the record is an asset. A theme or a portfolio in that
       column would be a foreign key pointing at the wrong table. */
    const request = buildArtifactPromotion({
      message: answer,
      promotion: thought,
      subject: { type: 'theme', id: 't-1', label: 'Power and cooling' },
    })!
    expect(request.contextType).toBeUndefined()
    expect(request.prefill!.assetId).toBeUndefined()
  })

  it('carries the kind the reader chose', () => {
    const request = buildArtifactPromotion({
      message: answer, promotion: artifactPromotion('thesis')!,
    })!
    expect(request.prefill!.ideaType).toBe('thesis')
  })
})

describe('what the reader is told', () => {
  it('says nothing is saved yet', () => {
    const { lines } = promotionConfirmation(thought)
    expect(lines.join(' ')).toContain('Nothing is saved until you save it')
  })

  it('always says a model wrote it, and that it is not a decision record', () => {
    for (const promotion of ARTIFACT_PROMOTIONS) {
      const text = promotionConfirmation(promotion).lines.join(' ')
      expect(text).toContain('ACT AI wrote it')
      expect(text).toContain('not a decision or an audit record')
    }
  })

  it('keeps the caveat last, where the reader leaves off', () => {
    const { lines } = promotionConfirmation(thought, { subjectLabel: 'AAPL', truncated: true })
    expect(lines[lines.length - 1]).toContain('not a decision or an audit record')
  })

  it('names what it will be filed against', () => {
    expect(promotionConfirmation(thought, { subjectLabel: 'AAPL' }).lines.join(' '))
      .toContain('filed against AAPL')
  })

  it('warns that a cut-off answer ends mid thought', () => {
    /* A truncated answer can still be kept -- the reader may want the part
       that arrived -- but not without being told what they are keeping. */
    expect(promotionConfirmation(thought, { truncated: true }).lines.join(' '))
      .toContain('cut short')
    expect(promotionConfirmation(thought, { truncated: false }).lines.join(' '))
      .not.toContain('cut short')
  })

  it('leads with the kind, and offers a button that describes the next screen', () => {
    const confirmation = promotionConfirmation(artifactPromotion('research_idea')!)
    expect(confirmation.title).toBe('Keep as a research note')
    expect(confirmation.confirmLabel).toBe('Open the draft')
  })
})
