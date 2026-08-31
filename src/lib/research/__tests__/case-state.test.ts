import { describe, expect, it } from 'vitest'

import {
  CORE_SECTIONS,
  RESEARCH_FRAMING_BASE,
  caseCoverageFrom,
  coreRowsFrom,
  framingWantsPrice,
  researchCopy,
  researchIssueFor,
  researchReason,
  researchSignalTypeFor,
  reviewClocks,
  type CoreContributionRow,
  type EvidenceArrival,
} from '../case-state'

/**
 * The Research family's rule, asserted where it is reachable.
 *
 * Almost everything here is a claim the OLD implementation got wrong, and each
 * case names the production asset that proved it. The old rule anchored on any
 * research touch at all, so a note arriving reset the review clock: the first
 * three blocks exist because that single mistake made every downstream question
 * unanswerable.
 */

const DAY = 86_400_000
const NOW = new Date('2026-08-31T00:00:00.000Z').getTime()
const ago = (days: number) => new Date(NOW - days * DAY).toISOString()

const core = (
  section: string, days: number, hasContent = true,
): CoreContributionRow => ({ section, hasContent, updated_at: ago(days) })

const ev = (days: number, over: Partial<EvidenceArrival> = {}): EvidenceArrival => ({
  id: `e-${days}`,
  at: ago(days),
  kind: 'note',
  ...over,
})

const issue = (input: {
  rows?: CoreContributionRow[]
  evidence?: EvidenceArrival[]
  movePct?: number | null
  /** Days ago a completed "reviewed, unchanged" judgment was recorded. */
  reviewedDaysAgo?: number | null
}) => {
  const coverage = caseCoverageFrom(input.rows ?? [])
  const clocks = reviewClocks(
    coverage,
    input.reviewedDaysAgo != null ? ago(input.reviewedDaysAgo) : null,
  )
  return researchIssueFor({
    clocks,
    coverage,
    evidence: input.evidence ?? [],
    movePct: input.movePct ?? null,
    now: NOW,
  })
}

// ── 1–4. The review anchor ──────────────────────────────────────────────────

describe('review anchor', () => {
  it('is the newest save across non-empty CORE sections only', () => {
    const c = caseCoverageFrom([core('thesis', 300), core('risks_to_thesis', 100)])
    expect(c.caseWrittenAt).toBe(ago(100))
    expect(c.present).toEqual(['thesis', 'risks_to_thesis'])
    expect(c.missing).toEqual(['where_different'])
  })

  it('business_model does not advance it', () => {
    // The canonical desktop rule, and the one the old mobile implementation
    // ignored: it took the newest contribution in ANY section, so writing up a
    // business model reset the clock on a thesis nobody had revisited.
    const c = caseCoverageFrom([core('thesis', 300), core('business_model', 1)])
    expect(c.caseWrittenAt).toBe(ago(300))
    expect(c.present).toEqual(['thesis'])
  })

  it('a blank core section is not a written one', () => {
    // A row exists but says nothing. Counting it would report a case that is
    // not there and date it from an empty save.
    const c = caseCoverageFrom([core('thesis', 300), core('risks_to_thesis', 2, false)])
    expect(c.caseWrittenAt).toBe(ago(300))
    expect(c.present).toEqual(['thesis'])
  })

  it('takes the newest across authors, because the CASE was reviewed', () => {
    // TSLA in production: two contributors on one case. A colleague's edit
    // advances the clock for everyone, which is correct — the case was revised.
    const c = caseCoverageFrom([core('thesis', 400), core('thesis', 60)])
    expect(c.caseWrittenAt).toBe(ago(60))
  })

  it('is null when nothing is written, and no anchored framing can then fire', () => {
    const c = caseCoverageFrom([core('business_model', 5)])
    expect(c.caseWrittenAt).toBeNull()
    // Even with two evidence items and a 40% move, an unwritten case cannot
    // produce an evidence or price framing: there is nothing to measure from.
    const r = issue({ rows: [core('business_model', 5)], evidence: [ev(1), ev(2)], movePct: 40 })
    expect(r?.framing).toBe('no_case')
  })

  it('a note arriving does not advance it', () => {
    // The defect in one line. Under the old rule this asset looked reviewed
    // yesterday; the case was actually written 200 days ago and has an
    // unanswered arrival sitting against it.
    const r = issue({ rows: [core('thesis', 200), core('where_different', 200), core('risks_to_thesis', 200)], evidence: [ev(1)] })
    expect(r?.daysSinceReview).toBe(200)
    expect(r?.framing).toBe('new_evidence')
  })

  it('a quick thought arriving does not advance it either', () => {
    const r = issue({
      rows: CORE_SECTIONS.map(s => core(s, 200)),
      evidence: [ev(3, { kind: 'thought' })],
    })
    expect(r?.daysSinceReview).toBe(200)
    expect(r?.framing).toBe('new_evidence')
  })
})

// ── 5–6. Evidence since review ──────────────────────────────────────────────

describe('evidence since review', () => {
  const written = CORE_SECTIONS.map(s => core(s, 100))

  it('counts only arrivals strictly after the anchor', () => {
    const r = issue({ rows: written, evidence: [ev(300), ev(150), ev(40), ev(10)] })
    expect(r?.framing).toBe('new_evidence')
    // Two of the four arrived after day 100, oldest first.
    expect(r?.evidence?.map(e => e.at)).toEqual([ago(40), ago(10)])
  })

  it('an arrival at the same instant as the anchor is not "since"', () => {
    // The note somebody filed while writing the case is part of writing it.
    const r = issue({ rows: written, evidence: [ev(100)] })
    expect(r?.framing).not.toBe('new_evidence')
  })

  it('cannot be manufactured from a note edit', () => {
    /**
     * The backfill guard, stated as a rule rather than as a query detail.
     *
     * 18 of 22 live notes in production share one `updated_at` from the
     * organization_id migration. Only `created_at` reaches this function, so a
     * note created before the case and "edited" (backfilled) yesterday is not
     * evidence — and there is no field here through which it could become some.
     */
    const r = issue({ rows: written, evidence: [ev(300)] })
    expect(r?.framing).not.toBe('new_evidence')
    expect(Object.keys(ev(300))).not.toContain('updatedAt')
  })

  it('never asserts what the evidence means', () => {
    /**
     * The copy states the arrival and stops.
     *
     * The disclaimer — "nothing records whether this supports or challenges the
     * thesis" — is still said, once, in the Evidence pane beside the thing it
     * is about (asserted in `research-panes.test.tsx`). It used to live here as
     * well, which meant a reader paging Evidence → Price → Case → Respond met
     * the same paragraph under every one of them.
     */
    const r = issue({ rows: written, evidence: [ev(5), ev(2)] })!
    const copy = researchCopy({ symbol: 'AMZN', issue: r })
    expect(copy.headline).not.toMatch(/support|challenge|contradict|confirm|refute/i)
    expect(copy.body).not.toMatch(/support|challenge|contradict|confirm|refute/i)
    expect(copy.body).toContain('2 items arrived after')
  })
})

// ── 7. The stale threshold ──────────────────────────────────────────────────

describe('stale threshold', () => {
  const complete = (days: number) => CORE_SECTIONS.map(s => core(s, days))

  it('is 90 days for a complete, quiet case', () => {
    expect(issue({ rows: complete(90) })?.framing).toBe('long_silence')
    expect(issue({ rows: complete(89) })).toBeNull()
  })

  it('is absolute, not relative to anything else in the book', () => {
    // Every anchored case in production is over 149 days old. That is a true
    // statement about the book, and the rule does not rescale to make some of
    // them look healthy.
    expect(issue({ rows: complete(149) })?.framing).toBe('long_silence')
    expect(issue({ rows: complete(316) })?.framing).toBe('long_silence')
  })

  it('does not gate the two event framings', () => {
    // Evidence and a material move are reasons in their own right, and neither
    // waits three months to be worth saying.
    expect(issue({ rows: complete(10), evidence: [ev(2)] })?.framing).toBe('new_evidence')
    expect(issue({ rows: complete(10), movePct: 22 })?.framing).toBe('price_move')
  })

  it('never fires on size alone', () => {
    // The old rule had a size-alone path at 5% and 90 days. Weight does not
    // reach this function at all now: it is importance, and importance is the
    // ranker's business.
    expect(issue({ rows: complete(89), movePct: 3 })).toBeNull()
  })
})

// ── 9. Material move ────────────────────────────────────────────────────────

describe('material move', () => {
  const written = CORE_SECTIONS.map(s => core(s, 150))

  it('holds the line at 15% in both directions', () => {
    expect(issue({ rows: written, movePct: 15 })?.framing).toBe('price_move')
    expect(issue({ rows: written, movePct: -15 })?.framing).toBe('price_move')
    // 14.9% is LLY in production (+14.3%): a real move, below the bar.
    expect(issue({ rows: written, movePct: 14.9 })?.framing).toBe('long_silence')
  })

  it('carries the sign rather than the absolute value', () => {
    // NKE is −30.5%. A card that showed "30.5%" would read as a rally.
    expect(issue({ rows: written, movePct: -30.5 })?.movePct).toBe(-30.5)
  })

  it('treats a missing baseline as no claim, never as a flat move', () => {
    /**
     * COIN and TGT are both anchored and have zero cached closes. If null were
     * coerced to 0 they would still be reachable here, and a card could later
     * claim "moved 0%" as a finding off a baseline that does not exist.
     */
    const r = issue({ rows: written, movePct: null })
    expect(r?.framing).toBe('long_silence')
    expect(r?.movePct).toBeUndefined()
  })
})

// ── 11–13. Precedence: one card per case ────────────────────────────────────

describe('precedence', () => {
  it('new evidence beats a material move', () => {
    // AMZN: 2 arrivals AND +20.7%. One card, and it leads with the arrivals.
    const r = issue({ rows: CORE_SECTIONS.map(s => core(s, 283)), evidence: [ev(200), ev(150)], movePct: 20.7 })
    expect(r?.framing).toBe('new_evidence')
    expect(r?.evidence).toHaveLength(2)
  })

  it('a material move beats a plain long silence', () => {
    // AAPL: 149 days, no arrivals, +24.9%. The move is the reason, not the age.
    expect(issue({ rows: CORE_SECTIONS.map(s => core(s, 149)), movePct: 24.9 })?.framing).toBe('price_move')
  })

  it('a material move beats an incomplete case', () => {
    /**
     * NKE, and the case the brief calls out by name: 1 of 3 sections written
     * AND −30.5% since the anchor. Emitting both a thin-case card and a stale
     * card would put two tiles about one name in the feed. The move is the
     * better explanation of why to open it TODAY; the blank sections will still
     * be blank tomorrow.
     */
    const r = issue({ rows: [core('thesis', 177)], movePct: -30.5 })
    expect(r?.framing).toBe('price_move')
    // The structure is still carried, so the card can say what is missing.
    expect(r?.missing).toEqual(['where_different', 'risks_to_thesis'])
  })

  it('an incomplete case beats a long silence', () => {
    // WMT: 1 of 3, 316 days, −4.3%. Half a case is a better claim than age.
    expect(issue({ rows: [core('thesis', 316)], movePct: -4.3 })?.framing).toBe('incomplete_case')
  })

  it('produces exactly one framing for any input', () => {
    // Everything true at once. Still one answer.
    const r = issue({ rows: [core('thesis', 400)], evidence: [ev(10), ev(5)], movePct: 60 })
    expect(r?.framing).toBe('new_evidence')
  })

  it('says nothing about a complete case written last week', () => {
    // The common and correct output. A feed that always has something to say
    // about every name is a feed nobody reads.
    expect(issue({ rows: CORE_SECTIONS.map(s => core(s, 7)), movePct: 4 })).toBeNull()
  })
})

// ── 14. Absent and incomplete cases ─────────────────────────────────────────

describe('absent and incomplete cases', () => {
  it('no core section at all is no_case, held or not', () => {
    expect(issue({ rows: [] })?.framing).toBe('no_case')
    expect(issue({ rows: [] })?.present).toEqual([])
    expect(issue({ rows: [] })?.missing).toEqual([...CORE_SECTIONS])
  })

  it('one or two sections is incomplete_case', () => {
    expect(issue({ rows: [core('thesis', 5)] })?.framing).toBe('incomplete_case')
    expect(issue({ rows: [core('thesis', 5), core('risks_to_thesis', 5)] })?.framing).toBe('incomplete_case')
  })

  it('both map to no_research, and neither gets a type of its own', () => {
    expect(researchSignalTypeFor('no_case')).toBe('no_research')
    expect(researchSignalTypeFor('incomplete_case')).toBe('no_research')
    expect(researchSignalTypeFor('new_evidence')).toBe('research_stale')
    expect(researchSignalTypeFor('price_move')).toBe('research_stale')
    expect(researchSignalTypeFor('long_silence')).toBe('research_stale')
  })

  it('neither offers a chart, because the finding is structural', () => {
    expect(framingWantsPrice('no_case')).toBe(false)
    expect(framingWantsPrice('incomplete_case')).toBe(false)
    expect(framingWantsPrice('price_move')).toBe(true)
    expect(framingWantsPrice('new_evidence')).toBe(true)
    expect(framingWantsPrice('long_silence')).toBe(true)
  })
})

// ── 10. Exposure copy ───────────────────────────────────────────────────────

describe('copy', () => {
  const complete = CORE_SECTIONS.map(s => core(s, 192))

  it('never prints 0.0% for an absent weight', () => {
    // 26 of 36 current production positions carry no weight at all.
    const r = issue({ rows: [], evidence: [] })!
    const copy = researchCopy({ symbol: 'MSFT', issue: r, portfolioName: 'Vision Fund 10K', weightPct: null, held: true })
    expect(copy.body).not.toMatch(/0\.0%/)
    expect(copy.body).toContain('held in Vision Fund 10K')
  })

  it('names the weight when there is a real one', () => {
    const r = issue({ rows: [], evidence: [] })!
    const copy = researchCopy({ symbol: 'MSFT', issue: r, portfolioName: 'Vision Fund 10K', weightPct: 5.1, held: true })
    expect(copy.body).toContain('5.1% of Vision Fund 10K')
  })

  it('claims no exposure at all for an unheld name', () => {
    // ORCL and the other covered-but-unheld names. Silence, not a zero.
    const r = issue({ rows: [], evidence: [] })!
    const copy = researchCopy({ symbol: 'ORCL', issue: r, portfolioName: null, weightPct: null, held: false })
    expect(copy.body).not.toMatch(/%|held/i)
  })

  it('says "written", never "looked" or "reviewed"', () => {
    /**
     * A section save is the event the product records. Nothing durable says
     * anybody READ a case and concluded it still held, so the copy must not
     * imply one — internal names may say `reviewAnchor`, the reader is told the
     * truth.
     */
    for (const r of [
      issue({ rows: complete, movePct: 24.9 })!,
      issue({ rows: complete })!,
      issue({ rows: complete, evidence: [ev(5)] })!,
    ]) {
      const copy = researchCopy({ symbol: 'AAPL', issue: r })
      expect(`${copy.headline} ${copy.body}`).not.toMatch(/last looked|you looked|last reviewed/i)
      expect(`${copy.headline} ${copy.body}`).toMatch(/written/i)
    }
  })

  it('does not dress a long silence up as an event', () => {
    // Nothing happened. "Moved" would send the reader hunting for news that
    // does not exist — the same fabrication the old size-alone copy avoided.
    const copy = researchCopy({ symbol: 'TSLA', issue: issue({ rows: complete })! })
    expect(copy.headline).not.toMatch(/moved|arrived|new/i)
    expect(copy.body).toContain('Nothing has happened to it')
  })

  it('names the change, and the sign, on a move', () => {
    const copy = researchCopy({ symbol: 'NKE', issue: issue({ rows: complete, movePct: -30.5 })! })
    expect(copy.headline).toContain('30.5%')
    expect(copy.body).toContain('down 30.5%')
  })

  it('explains itself with ingredients rather than a characterisation', () => {
    const r = issue({ rows: complete, evidence: [ev(5), ev(2)] })!
    const reason = researchReason(r, 'AMZN')
    expect(reason).toContain('2 evidence item')
    expect(reason).toContain('192 days')
  })
})

// ── 8. Framing strength ─────────────────────────────────────────────────────

describe('framing strength', () => {
  it('orders evidence above a move above a silence', () => {
    expect(RESEARCH_FRAMING_BASE.new_evidence).toBeGreaterThan(RESEARCH_FRAMING_BASE.price_move)
    expect(RESEARCH_FRAMING_BASE.price_move).toBeGreaterThan(RESEARCH_FRAMING_BASE.long_silence)
    expect(RESEARCH_FRAMING_BASE.no_case).toBeGreaterThan(RESEARCH_FRAMING_BASE.incomplete_case)
  })

  it('leaves the two pre-existing framings on the numbers they already had', () => {
    // `research_stale` and `no_research` carried 0.70 and 0.55 in the ranking
    // table. The framings that behaved this way before behave identically now,
    // so only the three new ones introduce new numbers.
    expect(RESEARCH_FRAMING_BASE.price_move).toBe(0.70)
    expect(RESEARCH_FRAMING_BASE.no_case).toBe(0.55)
  })

  it('stays inside the 0–1 range the base component expects', () => {
    for (const v of Object.values(RESEARCH_FRAMING_BASE)) {
      expect(v).toBeGreaterThan(0)
      expect(v).toBeLessThanOrEqual(1)
    }
  })
})

describe('coreRowsFrom', () => {
  it('treats whitespace-only prose as unwritten', () => {
    const rows = coreRowsFrom([
      { section: 'thesis', content: '   \n ', updated_at: ago(1) },
      { section: 'risks_to_thesis', content: 'Real risk.', updated_at: ago(2) },
    ])
    expect(caseCoverageFrom(rows).present).toEqual(['risks_to_thesis'])
  })
})
