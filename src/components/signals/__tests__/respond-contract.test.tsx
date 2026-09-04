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

  it('empties the text and surrenders the box, without moving the footer', () => {
    /**
     * The rule this protects has not changed; the mechanism has, and the old
     * mechanism was paying for it with a clipped note.
     *
     * The region used to keep a fixed `h-[3em]` while answering, so that
     * nothing below it moved when Respond opened — a control shifting under a
     * thumb already reaching for it. Right instinct. But it meant 48px held
     * open to show nothing, directly above a response that was being cut off
     * at the band's edge for want of 20: the note field on Case vs Price,
     * reported from the running app.
     *
     * Collapsing the box costs the footer nothing, which is the part that had
     * to be checked rather than assumed. The band carries `grow-[999]`, so it
     * is first in line for the room; the tray sits outside that column. Both
     * measured in the running app at 400x700 — the Actions bar sits at y=636
     * at rest and y=636 mid-response.
     */
    expect(src).toContain("{respondActive ? '' : card.body}")
    expect(src).toContain("respondActive ? 'h-0 overflow-hidden' : 'h-[3em] overflow-hidden'")
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
    expect(src).toContain('[justify-content:safe_center]')
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
