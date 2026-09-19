/**
 * The remaining pilot transition defects, each pinned by the thing that was
 * actually wrong rather than by the shape of the fix.
 *
 *   capture        ⌘/Ctrl-Enter called `mutate()` directly while the button
 *                  was disabled, so two quick presses created two trade ideas —
 *                  and for a pilot the second is a second candidate for the
 *                  tutorial idea the whole mission is about.
 *
 *   execute        the confirm modal closed on the click, so its own
 *                  `disabled={isPending}` guarded nothing and the most
 *                  consequential action in the product had no in-flight state.
 *
 *   Pipeline       the mission has always sent `focusIdeaId` and the page was
 *                  rendered with no props at all, so a pilot landed on a full
 *                  board with no indication which card was theirs.
 *
 *   Trade Book     the basics banner read only browser-local step flags, so a
 *                  pilot who finished them on a laptop was asked to do all
 *                  three again on a phone.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, it, expect } from 'vitest'

const src = (p: string) => readFileSync(path.join(process.cwd(), 'src', p), 'utf8')

describe('capture cannot be submitted twice', () => {
  const capture = src('components/thoughts/QuickTradeIdeaCapture.tsx')

  it('guards in handleSubmit, where both paths meet', () => {
    const fn = capture.slice(capture.indexOf('const handleSubmit = ()'))
    const body = fn.slice(0, fn.indexOf('\n  }'))
    expect(body).toContain('if (createTradeIdea.isPending) return')
    // Before the validity checks, so a pending submit is refused outright.
    expect(body.indexOf('createTradeIdea.isPending'))
      .toBeLessThan(body.indexOf('createTradeIdea.mutate()'))
  })

  it('leaves no path to the mutation that skips it', () => {
    // Exactly one call site, inside handleSubmit.
    expect(capture.match(/createTradeIdea\.mutate\(\)/g)).toHaveLength(1)
    const keys = capture.slice(capture.indexOf('const handleKeyDown'))
    expect(keys.slice(0, 300)).toContain('handleSubmit()')
  })
})

describe('single execute shows that it is working', () => {
  const page = src('pages/SimulationPage.tsx')
  const modal = page.slice(page.indexOf('{confirmExecuteIdea && (() => {'))

  it('does not close the modal on the click', () => {
    expect(modal).not.toContain('executeTradeM.mutate(confirmExecuteIdea); setConfirmExecuteIdea(null)')
    expect(modal).toContain('onClick={() => executeTradeM.mutate(confirmExecuteIdea)}')
  })

  it('closes when the commit settles instead', () => {
    const mutation = page.slice(page.indexOf('const executeTradeM = useMutation({'))
    expect(mutation.slice(0, mutation.indexOf('// ── PM Action: Bulk'))).toContain('onSettled: () => {')
  })

  it('says what is happening, without moving the buttons', () => {
    expect(modal).toContain("executeTradeM.isPending ? 'Executing…' : 'Execute Trade'")
    // Both halves stay flex-1, so the longer label cannot shift them.
    expect(modal.match(/flex-1 px-4 py-2 text-sm/g)?.length).toBeGreaterThanOrEqual(2)
  })
})

describe('Pipeline brings the arriving idea into view', () => {
  const page = src('pages/TradeQueuePage.tsx')

  it('consumes the id the mission has always sent', () => {
    expect(page).toContain('focusIdeaId')
    // Coalesced with `selectedTradeId`, which ~11 other producers send for the
    // same purpose. Both spellings reach the same focus mechanism.
    expect(src('pages/DashboardPage.tsx'))
      .toContain('focusIdeaId={activeTab.data?.focusIdeaId ?? activeTab.data?.selectedTradeId ?? null}')
  })

  it('finds the card by an anchor the card actually carries', () => {
    expect(page).toContain('data-queue-item-id={item.id}')
    expect(page).toContain('[data-queue-item-id="${focusIdeaId}"]')
  })

  /* Not a filter and not a selection — the board is untouched. */
  it('does not filter or select anything', () => {
    const effect = page.slice(page.indexOf('const focusAppliedRef'))
    const body = effect.slice(0, effect.indexOf('}, [focusIdeaId, tradeItems])'))
    expect(body).toContain('scrollIntoView')
    expect(body).not.toContain('setFilter')
    expect(body).not.toContain('setSelected')
  })

  it('waits for the card rather than guessing at a delay', () => {
    const effect = page.slice(page.indexOf('const focusAppliedRef'))
    expect(effect.slice(0, 900)).toContain('tradeItems.some(i => i.id === focusIdeaId)')
  })

  it('is spent after it has been applied, so later visits are ordinary', () => {
    const effect = page.slice(page.indexOf('const focusAppliedRef'))
    const body = effect.slice(0, effect.indexOf('}, [focusIdeaId, tradeItems])'))
    expect(body.indexOf('onFocusConsumed?.()')).toBeGreaterThan(body.indexOf('scrollIntoView'))
    expect(src('pages/DashboardPage.tsx')).toContain('delete data.focusIdeaId')
  })
})

describe('Trade Book basics do not ask twice', () => {
  it('retire on the durable mark, not only the browser-local flag', () => {
    expect(src('hooks/usePilotTradeBookSteps.ts')).toContain('dismissed: dismissed || stageMarked')
  })

  /* What must survive a second device already does: the roll-up is the
     server-backed key mission stage 4 and the Outcomes unlock both read. */
  it('still writes the server-backed roll-up the mission reads', () => {
    const hook = src('hooks/usePilotTradeBookSteps.ts')
    expect(hook).toContain("mark('tradebook_basics_completed')")
    expect(hook).toContain('tradeBookBasicsKey(orgId ?? null)')
  })
})
