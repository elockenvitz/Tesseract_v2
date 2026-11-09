import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { attentionPool, workAttention } from '../attention-pool'
import { attentionToExplore } from '../../mobile/explore-adapters'
import { categoryForType } from '../content-registry'
import type { AttentionItem, AttentionResponse } from '../../../types/attention'

/**
 * Workflow reaches a desktop Explore field.
 *
 * ── The gap ───────────────────────────────────────────────────────────────
 *
 * `attentionToExplore` is the ONLY producer that emits the Workflow category,
 * and `useDesktopExplore` never called it -- so Workflow was a declared
 * member of the taxonomy, with its own filter row and its own colour, that no
 * desktop tile could ever belong to.
 *
 * Wiring it needed the eligibility rule, which lived as three lines inside a
 * 7000-line mobile component. Copying it would have been how two surfaces
 * come to disagree about which work is still outstanding, so it moved to
 * `attention-pool` and mobile now imports the same function.
 */

const SRC = resolve(__dirname, '../../../')
const src = (p: string) => readFileSync(resolve(SRC, p), 'utf8')

const row = (over: Partial<AttentionItem>): AttentionItem => ({
  attention_id: 'a1', source_type: 'project', source_id: 's1', source_url: '/x',
  attention_type: 'action_required', reason_code: 'overdue',
  reason_text: 'This project passed its date',
  title: 'Q3 sector review', tags: [], icon_key: 'folder',
  audience: 'owner', participant_user_ids: [],
  created_at: '2026-09-01T00:00:00Z', updated_at: '2026-09-01T00:00:00Z',
  last_activity_at: '2026-09-01T00:00:00Z', due_at: '2026-10-05T00:00:00Z',
  status: 'open', severity: 'medium', score: 10, context: {},
  ...over,
} as AttentionItem)

const sections = (over: Partial<AttentionResponse['sections']> = {}) => ({
  informational: [], action_required: [], decision_required: [], alignment: [],
  ...over,
})

describe('the pool decides what is eligible, and nothing else', () => {
  it('takes all four sections, most urgent first', () => {
    const pool = attentionPool(sections({
      informational: [row({ attention_id: 'i' })],
      action_required: [row({ attention_id: 'act' })],
      decision_required: [row({ attention_id: 'dec' })],
      alignment: [row({ attention_id: 'ali' })],
    }))
    // THE case for the order: a consumer that truncates keeps the right half.
    expect(pool.map(a => a.attention_id)).toEqual(['dec', 'act', 'ali', 'i'])
  })

  /** THE case for the status filter: finished work must not be asked for. */
  it('drops resolved and dismissed rows', () => {
    const pool = attentionPool(sections({
      action_required: [
        row({ attention_id: 'open', status: 'open' }),
        row({ attention_id: 'done', status: 'resolved' }),
        row({ attention_id: 'gone', status: 'dismissed' }),
      ],
    }))
    expect(pool.map(a => a.attention_id)).toEqual(['open'])
  })

  it('survives a response that has not arrived', () => {
    expect(attentionPool(undefined)).toEqual([])
    expect(attentionPool(null)).toEqual([])
  })
})

describe('desktop takes the work half, not the trade half', () => {
  const mixed = [
    row({ attention_id: 'proj', source_type: 'project' }),
    row({ attention_id: 'trade', source_type: 'trade_queue_item' }),
    row({ attention_id: 'cov', source_type: 'coverage_change' }),
  ]

  /**
   * THE case. Desktop builds recommendation cards itself through
   * `buildRecommendationCard`, so the attention copy of the same proposal
   * would be the same decision twice from two producers with two ids --
   * which `dedupeExplore` cannot collapse, because they are different rows.
   */
  it('excludes trade-queue rows, which desktop already builds', () => {
    expect(workAttention(mixed).map(a => a.attention_id)).toEqual(['proj', 'cov'])
  })

  it('keeps every other source, which is work with a deadline', () => {
    for (const t of ['project', 'project_deliverable', 'coverage_change', 'task', 'workflow_item'] as const) {
      expect(workAttention([row({ source_type: t })])).toHaveLength(1)
    }
  })

  it('still runs the decision scan it is deferring to', () => {
    // Not an assertion about this module: the exclusion is only correct while
    // desktop really does produce recommendations of its own.
    expect(src('hooks/useDesktopAttentionFeed.ts')).toContain('buildRecommendationCard')
  })
})

describe('the rows become Workflow tiles that say something', () => {
  it('files them under Workflow, per the registry', () => {
    const items = attentionToExplore(
      workAttention(attentionPool(sections({ action_required: [row({})] }))),
      Date.parse('2026-10-07T00:00:00Z'),
    )
    expect(items).toHaveLength(1)
    expect(items[0].category).toBe(categoryForType('project_overdue'))
    expect(items[0].category).toBe('workflow')
  })

  /**
   * THE case for the context fix. The adapter read `a.summary`, and
   * `AttentionItem` has no such field -- it carries `subtitle`, `preview` and
   * `reason_text` -- so every workflow tile was a headline and nothing else.
   */
  it('reads the second line off a field the row actually has', () => {
    const [item] = attentionToExplore([row({ subtitle: 'Three names still unwritten' })])
    expect(item.context).toBe('Three names still unwritten')
  })

  it('falls back through preview, then the system reason', () => {
    const [byPreview] = attentionToExplore([row({ preview: 'Draft is half done' })])
    expect(byPreview.context).toBe('Draft is half done')
    const [byReason] = attentionToExplore([row({})])
    expect(byReason.context).toBe('This project passed its date')
  })

  it('says nothing rather than repeating the headline', () => {
    const [item] = attentionToExplore([row({
      subtitle: 'Q3 sector review', preview: '', reason_text: '',
    })])
    expect(item.context).toBeUndefined()
  })

  it('still names the deadline, which is what makes it worth a cell', () => {
    const [item] = attentionToExplore(
      [row({ due_at: '2026-10-05T00:00:00Z' })],
      Date.parse('2026-10-07T00:00:00Z'),
    )
    expect(item.metric).toEqual({ value: '2d', label: 'overdue', direction: 'bad' })
  })
})

describe('both shells read the one rule', () => {
  it('mobile imports it rather than keeping its own copy', () => {
    const mobile = src('components/mobile/MobileDashboard.tsx')
    expect(mobile).toContain("from '../../lib/signals/attention-pool'")
    // The copy is gone, not merely unused. A second concatenation of the four
    // sections in this file is the drift the module exists to prevent.
    expect(mobile).not.toContain('sections?.decision_required')
  })

  it('the desktop pool reaches the queue and hands it on', () => {
    expect(src('hooks/useDesktopCandidates.ts')).toContain('useAttention')
    expect(src('hooks/useDesktopCandidates.ts')).toContain('workAttention(attentionPool(')
    expect(src('hooks/useDesktopExplore.ts')).toContain('attentionToExplore(pool.attention')
  })
})
