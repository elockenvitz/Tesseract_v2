import { describe, it, expect, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { IdeasWorkPane } from '../IdeasWorkPane'
import type { IdeasSelection } from '../../../lib/desktop-ideas/selection'

/**
 * The way out of the asset workspace.
 *
 * ── What was wrong ────────────────────────────────────────────────────────
 *
 * The pane's only exit was an unlabelled 16px icon in the top-right corner.
 * That is the convention for dismissing a dialog, and this pane is not a
 * dialog -- the reader walked into it from a named section and the way back
 * has to say which section that is. Two things are guarded here:
 *
 *   it exists, in both states, and pressing it goes back
 *   its label is the HOST'S, not a constant this component chose
 *
 * The second is the one that rots. A hard-coded "Back to Ideas" passes every
 * test that only asserts a back control exists, and then tells a reader who
 * came from Explore that they are going somewhere they are not.
 *
 * ── Why the empty state is its own case ───────────────────────────────────
 *
 * The pane is reachable with no selection: a lens change can invalidate what
 * was open and leave the region mounted and empty. The exit used to be drawn
 * by the header that only a selected item renders, so the empty state had a
 * separate absolutely-positioned copy -- two controls to keep in step. There
 * is one now, and this file holds the two states to the same assertion so a
 * future header rewrite cannot quietly leave the empty state without a door.
 */

/* The work surfaces are not what this file is about. Each has its own suite,
   each wants its own providers, and the header above them is the subject. */
vi.mock('../../asset-v2/AssetWorkspace', () => ({
  AssetWorkspacePane: () => <div data-testid="asset-workspace" />,
}))
vi.mock('../../ideas/QuickThoughtDetailPanel', () => ({
  QuickThoughtDetailPanel: () => null,
}))
vi.mock('../../thoughts/PromptDetailView', () => ({ PromptDetailView: () => null }))
vi.mock('../../ideas-v2/IdeaDetail', () => ({ IdeaDetail: () => null }))
vi.mock('../../../hooks/useTradeIdeaWorkspace', () => ({
  useTradeIdeaWorkspace: () => ({ idea: null, detail: null, exposure: null }),
}))

const SELECTION: IdeasSelection = {
  key: 'stale_target:AAPL',
  family: 'stale_target',
  origin: 'ideas',
  assetId: 'asset-1',
  symbol: 'AAPL',
  why: { headline: 'Target expired 42 days ago', reason: 'Nobody has revisited it' },
} as IdeasSelection

describe('the asset workspace names the way back', () => {
  it('goes back to the section the host named, with a selection open', async () => {
    const onClose = vi.fn()
    render(
      <IdeasWorkPane selection={SELECTION} entry={null} backTo="Explore" onClose={onClose} />,
    )
    /* The section's name is in the VISIBLE text. A reader deciding whether to
       press this is looking at it, not querying its accessible name. */
    const back = screen.getByText(/Back to Explore/)
    await userEvent.click(back)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('says a different section when the host is in a different one', () => {
    render(
      <IdeasWorkPane selection={SELECTION} entry={null} backTo="Ideas" onClose={vi.fn()} />,
    )
    expect(screen.getByText(/Back to Ideas/)).toBeTruthy()
    /* The failure this catches is a constant: a component that always says
       "Ideas" passes the case above and this one, so the two cases together
       are what make the label the host's. */
    expect(screen.queryByText(/Back to Explore/)).toBeNull()
  })

  it('keeps the way back when there is nothing selected', async () => {
    const onClose = vi.fn()
    render(
      <IdeasWorkPane selection={null} entry={null} backTo="Portfolio" onClose={onClose} />,
    )
    await userEvent.click(screen.getByText(/Back to Portfolio/))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('draws one exit, not a back control and a dismiss icon beside it', () => {
    render(
      <IdeasWorkPane selection={SELECTION} entry={null} backTo="Ideas" onClose={vi.fn()} />,
    )
    /* The old icon was `aria-label="Close workspace"`. Leaving it in place
       beside the new control would give the reader two ways to do one thing,
       one of which does not say what it does. */
    expect(screen.queryByLabelText('Close workspace')).toBeNull()
  })
})

/**
 * Both hosts, read as source.
 *
 * `backTo` is a required prop, so a host that forgets it fails the typecheck
 * rather than this file. What the typecheck cannot see is a host passing a
 * CONSTANT -- `backTo="Ideas"` compiles, renders, and lies to every reader who
 * came from Explore. So these two cases assert the value is derived from the
 * host's own lens state.
 */
const src = (f: string) => readFileSync(join(process.cwd(), 'src/components', f), 'utf8')

describe('the hosts pass the lens they are standing in', () => {
  const hosts = [
    { file: 'ideas-app/IdeasApp.tsx', state: 'mode', table: 'MODES' },
    { file: 'dashboard-next/DashboardNext.tsx', state: 'lens', table: 'LENSES' },
  ]

  it.each(hosts)('$file derives the label from its own lens state', ({ file, state, table }) => {
    const prop = src(file).match(/backTo=\{[^}]*\}/)?.[0]
    expect(prop, `${file} renders IdeasWorkPane and must pass backTo`).toBeTruthy()
    /* Derived, not spelled: the expression has to read the lens state ... */
    expect(prop).toContain(state)
    /* ... and take the label from the same table the bar's buttons read, so
       renaming a lens in one place renames it in both. */
    expect(prop).toContain(table)
  })

  it.each(hosts)('$file does not hard-code a section name', ({ file }) => {
    const prop = src(file).match(/backTo=\{[^}]*\}/)?.[0] ?? ''
    /* A fallback string is allowed -- `.find()` is typed as optional and the
       lens is always in the table -- but a lens NAME as the whole value is
       the defect. */
    expect(prop).not.toMatch(/^backTo=\{?['"](Ideas|Explore|Portfolio)['"]\}?$/)
  })
})
