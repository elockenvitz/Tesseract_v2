/**
 * A lens opens the object it was handed.
 *
 * Today, Portfolio, the asset strips and the decision engine all navigate to
 * Ideas and Research with the object on the tab payload -- `selectedIdeaId`,
 * `selectedAssetId` -- and both lenses read selection as
 * `focusObjectId ?? null`. `focusObjectId` is the in-lens deck, which is null
 * on an arrival, so every one of those hand-offs landed on a gallery with
 * nothing open. The reader asked for one idea and was shown all of them.
 *
 * Research lost more than the selection: `arrival` feeds `arrivedFor`, which
 * only renders inside the detail pane, so the `issue` string that travels four
 * layers to say WHY the reader was sent was never shown either.
 *
 * These pin the precedence and the one-shot rule, because both are easy to get
 * subtly wrong: honouring the payload forever re-opens the same object on every
 * later visit, and consuming it too early loses the hand-off whenever the scan
 * has not answered yet.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, it, expect } from 'vitest'

const src = (p: string) => readFileSync(path.join(process.cwd(), 'src', p), 'utf8')

describe.each([
  ['Ideas', 'components/ideas-v2/IdeasWorkspace.tsx', 'selectedIdeaId', 'selected'],
  ['Research', 'components/research-v2/ResearchWorkspace.tsx', 'selectedAssetId', 'requested'],
])('%s consumes its arrival', (_name, file, payloadProp, resolved) => {
  const page = src(file)

  it('falls back to the tab payload when no deck is open', () => {
    expect(page).toContain(`const activeId = focusObjectId ?? (arrivalConsumed ? null : ${payloadProp} ?? null)`)
  })

  /* The deck is a card the reader opened in this lens. It must beat a payload
     that may be weeks old and still sitting on the tab. */
  it('lets the deck win', () => {
    const line = page.slice(page.indexOf('const activeId ='))
    expect(line.slice(0, line.indexOf('\n'))).toMatch(/^const activeId = focusObjectId \?\?/)
  })

  /* Consuming on arrival would clear the id a render before the scan answers
     and the object exists. It is spent only once something actually opened. */
  it('is spent only after the object resolves, not on arrival', () => {
    expect(page).toContain(`if (!arrivalConsumed && !focusObjectId && ${resolved}) setArrivalConsumed(true)`)
  })

  /* Otherwise a second hand-off into an already-open tab would be ignored --
     the tab-reuse behaviour depends on it being honoured. */
  it('re-arms when a different object arrives', () => {
    expect(page).toContain(`lastArrivalRef.current !== ${payloadProp}`)
    expect(page).toContain('setArrivalConsumed(false)')
  })
})

/*
 * `selectedTradeId` has ~11 producers -- the dashboard attention items, the
 * asset strips, the prioritiser, the decision engine, the promote modal -- and
 * the Pipeline read none of them. It means exactly what `focusIdeaId` means, so
 * it is coalesced onto the existing mechanism rather than given a second one.
 */
describe('Pipeline consumes the payload its producers already send', () => {
  const dash = src('pages/DashboardPage.tsx')

  it('coalesces both payload names onto one focus prop', () => {
    expect(dash.match(/focusIdeaId=\{activeTab\.data\?\.focusIdeaId \?\? activeTab\.data\?\.selectedTradeId \?\? null\}/g))
      // Desktop board and phone board.
      .toHaveLength(2)
  })

  /* Clearing only one spelling would leave the other to win on the next visit
     and re-scroll to the same card forever. */
  it('clears both spellings when spent', () => {
    const consumed = dash.slice(dash.indexOf("if (t.type !== 'trade-queue') return t"))
    const body = consumed.slice(0, consumed.indexOf('}))'))
    expect(body).toContain('delete data.focusIdeaId')
    expect(body).toContain('delete data.selectedTradeId')
  })

  it('renders the phone board with the payload rather than no props', () => {
    expect(dash).not.toContain('<MobilePipeline />')
    expect(dash).toContain('<MobilePipeline')
  })
})

describe('the phone board brings the card into view', () => {
  const page = src('components/mobile/MobilePipeline.tsx')

  it('accepts the same payload the desktop board takes', () => {
    expect(page).toContain('focusIdeaId?: string | null')
    expect(page).toContain('onFocusConsumed?: () => void')
  })

  /* One stage at a time, so "into view" also means switching to the stage the
     card is in -- otherwise the scroll looks for a card not being drawn. */
  it('switches to the stage the card is actually in', () => {
    const effect = page.slice(page.indexOf('const focusAppliedRef'))
    const body = effect.slice(0, effect.indexOf('}, [focusIdeaId, rows])'))
    expect(body).toContain('setStage(match.stage as ResearchStage)')
    expect(body).toContain("setView('committed')")
    expect(body).toContain("setView('archived')")
  })

  /* Searching would hide every other card. That is a filter, not a focus. */
  it('does not filter the board to find it', () => {
    const effect = page.slice(page.indexOf('const focusAppliedRef'))
    const body = effect.slice(0, effect.indexOf('}, [focusIdeaId, rows])'))
    expect(body).not.toContain('setSearch')
  })

  it('finds a pair row by either leg', () => {
    expect(page).toContain('r.legs.some((l: { id?: string } | null) => l?.id === focusIdeaId)')
  })

  it('is spent after the flash, and the card carries an anchor', () => {
    expect(page).toContain('data-pipeline-row-id={row.id}')
    const effect = page.slice(page.indexOf('const focusAppliedRef'))
    const body = effect.slice(0, effect.indexOf('}, [focusIdeaId, rows])'))
    expect(body.indexOf('onFocusConsumed?.()')).toBeGreaterThan(body.indexOf('decision-recorded-flash'))
  })
})

describe('Research keeps the reason it was opened for', () => {
  const page = src('components/research-v2/ResearchWorkspace.tsx')

  it('still records issue and origin on every arrival', () => {
    expect(page).toContain('setArrival({ issue, origin })')
  })

  /* `arrivedFor` renders inside the detail pane. Before this change the pane
     never opened on a hand-off, so the string was carried and never shown. */
  it('passes it into the detail the arrival now opens', () => {
    expect(page).toContain('arrivedFor={arrival?.issue ?? null}')
  })
})
