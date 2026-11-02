import { describe, it, expect, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { BackToSection } from '../../desktop/BackToSection'

/**
 * The way out of the asset workspace.
 *
 * ── What this file used to assert, and why it changed ─────────────────────
 *
 * It pinned the back control INSIDE `IdeasWorkPane`: two cases for the pane's
 * two states, one that the pane drew no second dismiss icon beside it, and
 * two that read each host's `backTo` prop.
 *
 * That placement was wrong and the control moved. Pressing it does not close
 * the pane so much as give the SECTION its full width back, and the section
 * is the column on the LEFT -- so a control over the pane points away from
 * where the press lands, and reads as "dismiss this panel". It now sits above
 * the browse column, over the list it is about to widen.
 *
 * Everything the old file was protecting survives, re-aimed at where the
 * control lives now:
 *
 *   it exists, and pressing it goes back        -> the component's own cases
 *   its label is the HOST'S, not a constant     -> the host cases, unchanged
 *                                                  in intent, re-pointed at
 *                                                  the band
 *   one exit, not a back control and an X       -> `the pane draws no exit`
 *   it survives in BOTH states of the pane      -> now automatic, because the
 *                                                  band is outside the pane
 *                                                  and does not know whether
 *                                                  anything is selected; the
 *                                                  case that used to prove it
 *                                                  is replaced by the one
 *                                                  below that proves the band
 *                                                  is keyed on `splitOpen`
 *                                                  alone
 *
 * The second of those is still the one that rots. A hard-coded "Back to
 * Ideas" passes every test that only asserts a back control exists, and then
 * tells a reader who came from Explore that they are going somewhere they are
 * not.
 */

describe('the back control', () => {
  it('says where it goes, and goes there', async () => {
    const onBack = vi.fn()
    render(<BackToSection backTo="Explore" onBack={onBack} />)
    /* The section's name is in the VISIBLE text. A reader deciding whether to
       press this is looking at it, not querying its accessible name. */
    await userEvent.click(screen.getByText(/Back to Explore/))
    expect(onBack).toHaveBeenCalledTimes(1)
  })

  it('says a different section when it is given one', () => {
    render(<BackToSection backTo="Portfolio" onBack={vi.fn()} />)
    expect(screen.getByText(/Back to Portfolio/)).toBeTruthy()
    /* Together with the case above: a component that always said one section
       would pass either alone. */
    expect(screen.queryByText(/Back to Explore/)).toBeNull()
  })
})

const src = (f: string) => readFileSync(join(process.cwd(), 'src/components', f), 'utf8')

/**
 * Both shells, read as source.
 *
 * A rendered assertion would need each shell's whole provider stack for a
 * question about one attribute, and the thing most likely to go wrong is not
 * whether a button appears -- it is WHAT IT SAYS, which the typecheck cannot
 * see. `backTo` is a required prop, so a shell that forgets it fails the
 * typecheck; a shell that passes a CONSTANT compiles, renders, and lies.
 */
describe('the shells put it over the column, labelled with their own lens', () => {
  const shells = [
    { file: 'ideas-app/IdeasApp.tsx', state: 'mode', table: 'MODES' },
    { file: 'dashboard-next/DashboardNext.tsx', state: 'lens', table: 'LENSES' },
  ]

  it.each(shells)('$file derives the label from its own lens state', ({ file, state, table }) => {
    const prop = src(file).match(/backTo=\{[^}]*\}/)?.[0]
    expect(prop, `${file} must render BackToSection and pass backTo`).toBeTruthy()
    /* Derived, not spelled: the expression has to read the lens state ... */
    expect(prop).toContain(state)
    /* ... and take the label from the same table the bar's buttons read, so
       renaming a lens renames it in both places at once. */
    expect(prop).toContain(table)
  })

  it.each(shells)('$file does not hard-code a section name', ({ file }) => {
    const prop = src(file).match(/backTo=\{[^}]*\}/)?.[0] ?? ''
    /* A fallback string is allowed -- `.find()` is typed as optional and the
       lens is always in the table -- but a lens NAME as the whole value is
       the defect. */
    expect(prop).not.toMatch(/^backTo=\{?['"](Ideas|Explore|Portfolio)['"]\}?$/)
  })

  it.each(shells)('$file draws it over the browse column, not the work pane', ({ file }) => {
    const body = src(file)
    const back = body.indexOf('<BackToSection')
    const pane = body.indexOf('<IdeasWorkPane')
    expect(back, `${file} must render BackToSection`).toBeGreaterThan(-1)
    expect(pane, `${file} must render IdeasWorkPane`).toBeGreaterThan(-1)
    /*
     * Source order is the proxy for screen order here, and it holds because
     * both shells lay the row out left to right with the browse column first.
     * The defect this catches is the control drifting back inside the pane's
     * subtree, which is where it started.
     */
    expect(back).toBeLessThan(pane)
  })

  it.each(shells)('$file shows it only while the workspace is open', ({ file }) => {
    const body = src(file)
    const at = body.indexOf('<BackToSection')
    /* The 200 characters before the control: its guard. Drawn unconditionally
       it would be a permanent "Back to Ideas" above a full-width feed that is
       already the thing it goes back to. */
    expect(body.slice(Math.max(0, at - 200), at)).toContain('splitOpen')
  })
})

describe('the work pane draws no exit of its own', () => {
  it('has no back control and no dismiss icon in its source', () => {
    const pane = src('ideas-app/IdeasWorkPane.tsx')
    /*
     * Two controls for one action, one of which does not say what it does,
     * is worse than either alone -- and that is exactly what shipped before
     * the labelled control replaced the X. Both spellings are banned.
     */
    expect(pane).not.toContain('<BackToSection')
    expect(pane).not.toContain('Close workspace')
  })
})
