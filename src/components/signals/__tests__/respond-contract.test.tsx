import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fireEvent, render } from '@testing-library/react'

import { VerdictBar } from '../VerdictBar'
import { ScenarioRespond } from '../ScenarioRespond'

/**
 * One response grammar, on every card.
 *
 * ── The ordering this pins ────────────────────────────────────────────────
 *
 * `SignalCardView` renders the supporting description and the sticky action
 * bar beneath the band, so a commit button INSIDE the response pane can never
 * be the bottom-most control. On the families that kept one, the reader met
 * "choose, explain, submit", then a sentence about the issue, then
 * `Actions | Set a target` — the submit in the middle of the tile, with two
 * completion-shaped layers for one completion.
 *
 * `externalCommit` was the answer and it was opt-in: three families took it and
 * the rest did not. The contract is now the same everywhere the shared
 * `verdictPane` is used — the commit is the card's footer, which is the only
 * place it can genuinely be last — and the description gets out of the way
 * while the reader is answering.
 *
 *   question → choices → note → SUBMIT (footer)
 */

const OPTIONS = [
  { key: 'a', label: 'Priced in', tone: 'affirm' as const, disposition: 'settled' as const, note: 'n' },
  { key: 'b', label: 'Needs work', tone: 'neutral' as const, disposition: 'flagged' as const, note: 'n' },
  { key: 'c', label: 'Not mine', tone: 'negate' as const, disposition: 'rejected' as const, note: 'n' },
  { key: 'd', label: 'Later', tone: 'neutral' as const, disposition: 'flagged' as const, note: 'n' },
]

const noop = () => {}

describe('the shared bar gives up its commit when the footer has one', () => {
  it('renders no commit control under externalCommit', () => {
    const { container } = render(
      <VerdictBar question="Does the size match the view?" options={OPTIONS}
        externalCommit onPick={noop} onRespond={async () => true} />,
    )
    // Whatever the label, nothing in the pane may complete the action: the
    // footer does, and only the footer can be last.
    expect(container.textContent).not.toMatch(/Write it down|Apply|Submit response/)
  })

  it('still keeps its own commit for a surface with no footer', () => {
    // The flag is opt-in and the bar stays usable standalone — target review
    // and the pair verdict have no footer override to fall back on.
    const { container } = render(
      <VerdictBar question="Does the size match the view?" options={OPTIONS}
        onRespond={async () => true} />,
    )
    fireEvent.click(container.querySelector('[data-verdict="a"]')!)
    expect(container.textContent).toMatch(/Write it down|Apply/)
  })

  it('reports the selection outward, which is what the footer commits', () => {
    const picked: (string | null)[] = []
    const { container } = render(
      <VerdictBar question="q" options={OPTIONS} externalCommit
        onPick={o => picked.push(o?.key ?? null)} onRespond={async () => true} />,
    )
    fireEvent.click(container.querySelector('[data-verdict="b"]')!)
    expect(picked).toEqual(['b'])
    // And a second tap clears it, so the footer stops offering to submit
    // something the reader did not mean.
    fireEvent.click(container.querySelector('[data-verdict="b"]')!)
    expect(picked).toEqual(['b', null])
  })
})

describe('the answer geometry is one contract, not one per family', () => {
  it('lays four options out as a 2x2 of touch-sized targets', () => {
    const { container } = render(
      <VerdictBar question="q" options={OPTIONS} externalCommit onPick={noop}
        onRespond={async () => true} />,
    )
    const grid = container.querySelector('[role="radiogroup"]')!
    expect(grid.className).toContain('grid-cols-2')
    const buttons = [...grid.querySelectorAll('[role="radio"]')]
    expect(buttons).toHaveLength(4)
    // Same height, same radius, same alignment, on every option.
    for (const b of buttons) {
      expect(b.className).toContain('min-h-[44px]')
      expect(b.className).toContain('rounded-xl')
      expect(b.className).toContain('text-center')
    }
  })

  it('derives three from the same component rather than custom markup', () => {
    const { container } = render(
      <VerdictBar question="q" options={OPTIONS.slice(0, 3)} externalCommit
        onPick={noop} onRespond={async () => true} />,
    )
    // Three in a row, because a 2x2 with a hole in it reads as a fault.
    expect(container.querySelector('[role="radiogroup"]')!.className)
      .toContain('grid-cols-3')
  })

  it('is the same geometry the scenario pane uses', () => {
    const { container } = render(
      <ScenarioRespond question="Has the investment view changed?" selected={null}
        onSelect={noop} note="" onNoteChange={noop} />,
    )
    const grid = container.querySelector('[data-testid="scenario-respond-options"]')!
    expect(grid.className).toContain('grid-cols-2')
    for (const b of grid.querySelectorAll('button')) {
      expect(b.className).toContain('min-h-[44px]')
      expect(b.className).toContain('rounded-xl')
    }
  })
})

describe('the note sits between the answers and the commit', () => {
  it('never renders below a commit control', () => {
    // `answers → note → submit`. A note under the submit invites somebody to
    // type an explanation for a decision they have already recorded.
    const { container } = render(
      <ScenarioRespond question="q" selected={null} onSelect={noop}
        note="" onNoteChange={noop} />,
    )
    const kids = [...container.firstElementChild!.children]
      .map(k => (k as HTMLElement).dataset.testid ?? k.tagName)
    expect(kids.indexOf('scenario-respond-options'))
      .toBeLessThan(kids.length - 1)
    // And this pane has no commit of its own at all — the footer owns it.
    expect(container.textContent).not.toMatch(/Write it down|Apply|Submit/)
  })
})

describe('the description gets out of the way while answering', () => {
  const src = readFileSync(resolve(__dirname, '../SignalCardView.tsx'), 'utf8')

  it('treats an engaged and an inline response as the same moment', () => {
    /**
     * An engaged judgment takes the whole band; an inline one is a carousel
     * page. Both are the reader answering, and behaving differently in the two
     * would be the inconsistency this stage is about.
     */
    expect(src).toContain(
      'const respondActive = judgmentOpen || currentPaneId === JUDGMENT_PANE_ID',
    )
  })

  it('keeps the description on screen while the reader answers', () => {
    /**
     * This assertion has now been three different things, which is worth
     * recording because the middle two were both wrong.
     *
     * It began as "empties the text without collapsing the box": the region
     * held a fixed `h-[3em]` and blanked its sentence while Respond was open,
     * so the reader saw 48px of nothing where the finding had been. Then the
     * box was collapsed too, to buy room for a note field that was being
     * clipped above it. Then the reader said what neither version had asked:
     * "i dont see the text at the bottom of the tile for the description or
     * that info. i need to see that."
     *
     * The original instinct was backwards. The description is the reason the
     * question can be answered — "No stated upside is left on capital you are
     * still holding" is what makes "has the investment view changed?" a
     * question rather than a prompt. Hiding it at the moment of the decision
     * removes the evidence and keeps the ask.
     *
     * The room the response needs comes from `responseBandMinPx`, which
     * budgets what a response actually occupies. Both fit: verified in the
     * running app at 400x700 with the options, the consequence line, a
     * full-height note, the description, and the tray still at y=636.
     */
    expect(src).toContain('{card.body}')
    expect(src).not.toContain("{respondActive ? '' : card.body}")
    expect(src).toContain("!bodyIsPrimaryProse(card.type) && 'h-[3em] overflow-hidden'")
  })

  it('exposes the state, so the contract is checkable on a rendered card', () => {
    expect(src).toContain("data-respond-active={respondActive ? 'yes' : 'no'}")
  })
})

describe('every family routed through the shared pane commits in the footer', () => {
  const dash = readFileSync(
    resolve(__dirname, '../../mobile/MobileDashboard.tsx'), 'utf8',
  )

  it('builds the response module in one place', () => {
    // Lens (no_target, crowding, conviction, breach) and the template family
    // both call it; the ordering is not re-decided per family.
    expect(dash).toContain('const verdictPane = useCallback(')
    // One definition, two call sites: the lens family and the template family.
    // Four inline `<VerdictBar>` call sites remain outside it — attention, the
    // ideas signal, and two template branches — and are the next migration.
    expect(dash.match(/verdictPane\(/g) ?? []).toHaveLength(2)
  })

  it('gives that pane the external commit', () => {
    const pane = dash.slice(
      dash.indexOf('const verdictPane = useCallback('),
      dash.indexOf('const verdictOverride = useCallback('),
    )
    expect(pane).toContain('externalCommit')
    expect(pane).toContain('onPick=')
    expect(pane).toContain('onCommentaryChange=')
  })

  it('resolves the footer commit from one helper', () => {
    // Not the same six lines beside every `renderCard`: the override is a
    // property of "this card is being answered", not of the family asking.
    expect(dash).toContain('const verdictOverride = useCallback(')
    expect(dash).toContain("label: ideaJudgmentSaving ? 'Saving…' : 'Submit response',")
  })

  it('submits against the question the pane actually asked', () => {
    // Two copies of a string is how a card records an answer to a question it
    // did not ask.
    expect(dash).toContain('const lensQuestion =')
    expect(dash).toContain('primaryOverride: verdictOverride(')
  })
})

describe('no feed tile can keep an internal commit', () => {
  const dash = readFileSync(
    resolve(__dirname, '../../mobile/MobileDashboard.tsx'), 'utf8',
  )
  const lines = dash.split(String.fromCharCode(10))

  /**
   * Every `<VerdictBar>` in the feed, with whether its props opt into the
   * footer commit within the element.
   *
   * A source guard rather than a render assertion, deliberately: the drift
   * this prevents is somebody adding a NEW family, and no rendered test can
   * fail for a card that does not exist yet. `externalCommit` was opt-in for
   * three stages and five families quietly kept their own button.
   */
  const sites = lines
    .map((l, i) => (l.includes('<VerdictBar') ? i : -1))
    .filter(i => i >= 0)
    .map(i => ({
      line: i + 1,
      body: lines.slice(i, i + 90).join(String.fromCharCode(10)),
    }))

  /**
   * The one surface that legitimately keeps its own commit.
   *
   * `ideaDetailFor` is a detail SHEET, not a feed tile: it has no
   * `SignalCardView` around it and therefore no footer to hand the commit to.
   * A bar with nowhere to delegate must still be able to complete.
   */
  const ALLOWED_STANDALONE = 1

  it('finds every response site', () => {
    // If this number moves, a family was added or removed and the rest of this
    // block should be read rather than trusted.
    expect(sites.length).toBeGreaterThanOrEqual(9)
  })

  it('leaves only the detail sheet committing inside itself', () => {
    const standalone = sites.filter(
      s => !s.body.includes('verdictWiring(') && !s.body.includes('externalCommit'),
    )
    expect(standalone).toHaveLength(ALLOWED_STANDALONE)
    // And it is the sheet, not a tile: sheets are rendered from `ideaDetailFor`.
    expect(standalone[0].body).toContain('ideaDetailFor')
  })

  it('gives every feed tile the footer commit', () => {
    for (const s of sites) {
      if (s.body.includes('ideaDetailFor')) continue
      expect(
        s.body.includes('verdictWiring(') || s.body.includes('externalCommit'),
        `VerdictBar at line ${s.line} still commits inside the pane`,
      ).toBe(true)
    }
  })

  it('submits against the question the pane asked, not a second copy', () => {
    // Every migrated family names its question once and passes the same value
    // to the pane and to the override.
    for (const q of ['attentionQuestion', 'signalQuestion', 'tplQuestion', 'newsQuestion', 'lensQuestion']) {
      expect(dash.match(new RegExp(q, 'g')) ?? [], q).not.toHaveLength(1)
    }
  })

  it('carries a family\'s own side effects onto the footer commit', () => {
    /**
     * Attention rows acknowledge or snooze the queue as well as recording a
     * judgment. Moving the commit without carrying that would have cleared the
     * feed and left the queue waiting — a silent regression a layout test
     * would never catch.
     */
    expect(dash).toContain('const attentionAfterCommit = (o: VerdictOption) => {')
    expect(dash).toContain('acknowledge(a.attention_id)')
    expect(dash).toContain('attentionAfterCommit,')
    expect(dash).toContain('after?: (option: VerdictOption) => void,')
    // And only after a successful write, for the same reason the local
    // disposition is.
    expect(dash).toContain('if (ok) {')
  })
})

describe('the bespoke panes conform without being rewritten', () => {
  it('leaves the target-review pane its own question and no commit', () => {
    const src = readFileSync(resolve(__dirname, '../TargetReview.tsx'), 'utf8')
    // Domain-specific contents stay; the interaction grammar is shared.
    expect(src).toContain('choose, then act in the footer')
    expect(src).not.toContain('Write it down')
    expect(src).not.toContain('externalCommit')
    expect(src).not.toMatch(/onRespond/)
  })

  it('leaves the scenario pane its own question and no commit', () => {
    const src = readFileSync(resolve(__dirname, '../ScenarioRespond.tsx'), 'utf8')
    expect(src).toContain('Deliberately NO save button of its own')
    /**
     * Top-packed, not centred.
     *
     * `safe center` was chosen so a short workflow sat in the middle of a tall
     * pane and a tall one fell back to `start` rather than overflowing both
     * ends. The fallback is the problem: it engages only once the content
     * ALREADY overflows, so at the sizes where the pane is a few pixels short
     * the workflow was still centred and the note field was cut at the bottom
     * with spare room sitting above it. Reported as exactly that — "move the
     * note optional box up a little bit, there is room above".
     *
     * A workflow reads top to bottom and its spare room belongs after it,
     * which is the rule `VerdictBar` already follows.
     */
    expect(src).toContain('justify-start')
    expect(src).not.toContain('safe_center')
  })
})

describe('a card whose only pane is the response', () => {
  it('knows the reader is answering without being told', () => {
    /**
     * `onActiveChange` fires when the carousel PAGES, and a card with one pane
     * never pages — `CardCarousel` returns early for a single pane. So a card
     * whose only pane IS the response reported no active pane at all, and both
     * the body suppression and the footer's commit stayed off on exactly the
     * card where the reader is unambiguously answering.
     *
     * Found by screenshotting it: the DOM read `data-respond-active="no"` on a
     * card showing nothing but a response form. Neither the unit tests nor the
     * source guard could have caught it, because both ends were correct.
     */
    const src = readFileSync(resolve(__dirname, '../SignalCardView.tsx'), 'utf8')
    expect(src).toContain('const currentPaneId = activePaneId ?? merged?.[0]?.id ?? null')
    expect(src).toContain('const respondActive = judgmentOpen || currentPaneId === JUDGMENT_PANE_ID')
  })
})
