/**
 * Two analysts, one idea, one portfolio.
 *
 * ── Why this case exists ─────────────────────────────────────────────────
 *
 * The partial unique index on `decision_requests` is
 * (trade_queue_item_id, portfolio_id, requested_by) — per REQUESTER, not per
 * (idea, portfolio). Two analysts holding different views of the same name in
 * the same book is therefore a legitimate, representable state, and the PM is
 * meant to choose between them.
 *
 * It had no test coverage at any level, and three things were wrong:
 *
 *   1. Competing proposals on the same PAIR produced two groups whose
 *      `tradeId` was both `pair_id`. The rendered card key and the collapse
 *      key were `tradeId`, so React saw duplicate sibling keys and one
 *      collapse toggle drove both cards.
 *
 *   2. A singleton group borrowed a thesis from any sibling request that had
 *      one. For competing analysts the "sibling" is the OTHER analyst, so the
 *      card printed B's thesis under A's name and sizing — a claim no reader
 *      could attribute.
 *
 *   3. `reasoningFallbackNote` was computed for every group and rendered
 *      nowhere, so a request with no captured reasoning showed a blank where
 *      a thesis belongs and the reader filled in the silence.
 *
 * These are source assertions against `DecisionInbox.tsx`. The grouping code
 * is a closure inside a 2,500-line component with no exported seam; extracting
 * one is the E2 restructure, not this fix. Comments are stripped first, so the
 * prose above each change cannot satisfy a check.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const INBOX = resolve(__dirname, '../DecisionInbox.tsx')
const RAW = readFileSync(INBOX, 'utf8')

/** Executable source only. Rationale comments must not satisfy an assertion. */
const codeOf = (s: string) =>
  s
    .split('\n')
    .map((l) => l.replace(/\/\/.*$/, ''))
    .join('\n')
    .replace(/\/\*[\s\S]*?\*\//g, '')

const SRC = codeOf(RAW)

describe('comment stripping works, so prose cannot pass these tests', () => {
  it('removes both comment forms', () => {
    expect(RAW).toContain('competing')
    expect(codeOf('// competing\nconst a = 1')).not.toContain('competing')
    expect(codeOf('/* competing */\nconst a = 1')).not.toContain('competing')
  })

  it('leaves executable source intact', () => {
    expect(codeOf('const a = 1 // note')).toContain('const a = 1')
  })
})

describe('a group is identified by groupKey, never by tradeId', () => {
  it('IdeaGroup carries the unique groupKey', () => {
    expect(SRC).toMatch(/interface IdeaGroup \{[\s\S]*?groupKey: string/)
  })

  it('the group is constructed with it', () => {
    expect(SRC).toMatch(/const group: IdeaGroup = \{\s*groupKey,/)
  })

  it('the rendered card is keyed on groupKey', () => {
    expect(SRC).toContain('key={group.groupKey}')
    // The collision: two competing proposals on one pair share tradeId.
    expect(SRC).not.toContain('key={group.tradeId}')
  })

  it('collapse state is keyed on groupKey, so one toggle drives one card', () => {
    expect(SRC).toContain('collapsedGroups.has(group.groupKey)')
    expect(SRC).toContain('toggleGroup(group.groupKey)')
    expect(SRC).not.toContain('collapsedGroups.has(group.tradeId)')
    expect(SRC).not.toContain('toggleGroup(group.tradeId)')
  })

  it('tradeId still exists, for navigation', () => {
    // Deliberately kept: onIdeaClick opens the idea, which is a tradeId
    // concern. Identity and navigation are different jobs.
    expect(SRC).toMatch(/interface IdeaGroup \{[\s\S]*?tradeId: string/)
  })
})

describe('a thesis is never borrowed across competing analysts', () => {
  it('the upgrade is gated on isPair', () => {
    expect(SRC).toMatch(
      /if \(isPair && !group\.thesisText && \(r as any\)\.proposal_version\?\.thesis_text\)/,
    )
  })

  it('the ungated form is gone', () => {
    // This is the exact line that cross-contaminated singleton groups.
    expect(SRC).not.toMatch(
      /if \(!group\.thesisText && \(r as any\)\.proposal_version\?\.thesis_text\)/,
    )
  })

  it('still never reads the idea\'s CURRENT thesis as a fallback', () => {
    // The older defect, already fixed, pinned so it cannot come back: a
    // resolved decision must not re-narrate itself when the idea is edited.
    expect(SRC).not.toContain('rtqi.thesis_text')
    expect(SRC).not.toContain('rtqi?.thesis_text')
  })
})

describe('every request tile says whose reasoning it is showing', () => {
  it('renders the not-captured note per row rather than a blank', () => {
    expect(SRC).toContain('history.reasoningUnavailable')
    expect(SRC).toContain('reasoningFallbackNote(history)')
  })

  it('renders the row\'s own frozen thesis, not the card header\'s', () => {
    expect(SRC).toContain('history.thesisText.captured')
    expect(SRC).toContain('history.thesisText.value')
  })

  it('names the record each row is quoting', () => {
    // version / pre-versioning / neither carry very different weight for a
    // PM and looked identical before.
    expect(SRC).toContain("history.source === 'version'")
    expect(SRC).toContain('history.versionNumber')
    expect(SRC).toContain("history.source === 'snapshot'")
  })

  it('resolves that provenance from the request, not from the group seed', () => {
    // The seed leg is "first pending, else requests[0]" — one of the two
    // competing requests. A per-row surface must resolve per row.
    expect(SRC).toMatch(
      /const history = resolveHistoricalRecommendation\(\s*request as never/,
    )
  })
})

describe('the grouping invariants that make competing requests survive', () => {
  it('groups are keyed per requester-agnostic idea, and both requests are kept', () => {
    // getGroupInfo returns tqi:<id> for singletons, so two competing
    // requests land in ONE group and both stay in `requests`.
    expect(SRC).toMatch(/groupKey: `tqi:\$\{/)
  })

  it('a pair group is keyed on the proposal, which is what separates competitors', () => {
    expect(SRC).toMatch(/groupKey: `proposal:\$\{/)
  })

  it('rows within a group are keyed per request', () => {
    // Two tiles for two competing requests; neither may replace the other.
    expect(SRC).toContain('key={req.id}')
  })
})
