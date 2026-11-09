/**
 * The compact stage rail, and the rule that swaps it in.
 *
 * ── What this guards ────────────────────────────────────────────────────
 *
 * Shrinking a navigation control is easy to do by dropping what it was
 * carrying. The chevron rail carried five things — the stage's position,
 * its name, how much of it is done, its status, and which stage is CURRENT
 * even while you look at another one — and the strip that replaces it on
 * the requirement surface has to carry all five in about a third of the
 * height. Each is asserted here, so a later tidy-up that quietly drops the
 * current marker or the counts fails rather than merely looking neater.
 *
 * The second group pins the swap itself against the source: full rail while
 * choosing, strip while working, and never both. Without it the "reduce the
 * rail" change could regress into rendering both and the page would simply
 * get taller.
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { StageRail, type StageRailItem } from '../StageRail'

const STAGES: StageRailItem[] = [
  { id: 'momentum', label: 'Momentum Check', status: 'completed', done: 4, total: 4 },
  { id: 'catalyst', label: 'Catalyst Check', status: 'current', done: 1, total: 3 },
  { id: 'done', label: 'Completed', status: 'future', done: 0, total: 0 },
]

const setup = (over: Partial<React.ComponentProps<typeof StageRail>> = {}) => {
  const onSelect = vi.fn()
  render(<StageRail stages={STAGES} selectedId="momentum" onSelect={onSelect} {...over} />)
  return { onSelect }
}

describe('the strip carries everything the chevrons carried', () => {
  it('names every stage, none dropped into an overflow menu', () => {
    setup()
    for (const s of STAGES) expect(screen.getByTestId(`stage-chip-${s.id}`)).toBeInTheDocument()
  })

  it('states how much of each stage is done', () => {
    setup()
    expect(screen.getByTestId('stage-chip-catalyst')).toHaveTextContent('1/3')
    expect(screen.getByTestId('stage-chip-momentum')).toHaveTextContent('4/4')
  })

  it('says nothing rather than 0/0 for a stage with no requirements', () => {
    setup()
    expect(screen.getByTestId('stage-chip-done')).not.toHaveTextContent('0/0')
  })

  it('numbers the stages, and ticks the finished one instead', () => {
    setup()
    /* Position is how a reader places themselves; the tick replaces the
       number only once there is nothing left in that stage. */
    expect(screen.getByTestId('stage-chip-catalyst')).toHaveTextContent('2')
    expect(screen.getByTestId('stage-chip-momentum')).not.toHaveTextContent('1')
  })

  /** THE one most easily lost in a tidy-up. */
  it('marks the CURRENT stage while a different one is being viewed', () => {
    setup({ selectedId: 'momentum' })
    expect(screen.getByTestId('stage-chip-current-catalyst')).toBeInTheDocument()
  })

  it('does not double-mark the current stage when it is the one viewed', () => {
    setup({ selectedId: 'catalyst' })
    expect(screen.queryByTestId('stage-chip-current-catalyst')).toBeNull()
  })

  it('tells assistive technology which stage is open', () => {
    setup({ selectedId: 'catalyst' })
    expect(screen.getByTestId('stage-chip-catalyst')).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByTestId('stage-chip-momentum')).toHaveAttribute('aria-selected', 'false')
  })

  it('still switches stage on a click, with its index', async () => {
    const { onSelect } = setup()
    await userEvent.click(screen.getByTestId('stage-chip-catalyst'))
    expect(onSelect).toHaveBeenCalledWith('catalyst', 1)
  })

  it('renders nothing at all for a process with no stages', () => {
    const { container } = render(<StageRail stages={[]} selectedId={null} onSelect={vi.fn()} />)
    expect(container.firstChild).toBeNull()
  })
})

describe('full while choosing, strip while working', () => {
  const code = (s: string) =>
    s.replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/\/\*[\s\S]*?\*\//g, '')
      .split('\n').map(l => l.replace(/\/\/.*$/, '')).join('\n')
  const TIMELINE = code(
    readFileSync(path.join(process.cwd(), 'src/components/ui/InvestmentTimeline.tsx'), 'utf8'),
  )

  /*
   * The rule changed from "two sizes" to ONE rail. The chevrons are
   * deleted — not hidden — so there is no longer a second presentation to
   * keep in agreement, and the rail renders in every state at every width.
   */
  it('is the only stage navigation, in every state', () => {
    expect(TIMELINE).toMatch(/<StageRail/)
    expect(TIMELINE).not.toMatch(/\{selectedRequirement && \([\s\S]{0,400}<StageRail/)
  })

  it('leaves no chevron behind', () => {
    expect(TIMELINE).not.toMatch(/clipPath/)
    expect(TIMELINE).not.toMatch(/Desktop Chevron Timeline/)
  })

  it('feeds the strip the rail\'s own status and counts, not a second derivation', () => {
    expect(TIMELINE).toMatch(/status: getStageStatus\(index\)/)
    expect(TIMELINE).toMatch(/done: items\.filter\(i => isItemDone\(i\)\)\.length/)
  })

  it('routes the strip through the chevrons\' own click handler', () => {
    expect(TIMELINE).toMatch(/if \(stage\) handleStageClick\(stage, index\)/)
  })

  it('stops repeating the stage description entirely', () => {
    /*
     * It was a 12px grey line above both surfaces that quote it: the stage
     * overview sets it as the objective in 17px, and the requirement
     * workspace sets it under the requirement it serves. A third copy.
     */
    expect(TIMELINE).not.toMatch(/if \(!description \|\| selectedRequirement\) return/)
    expect(TIMELINE).not.toMatch(/\{assetSymbol && <span className="text-gray-400">\{assetSymbol\} · <\/span>\}/)
  })
})
