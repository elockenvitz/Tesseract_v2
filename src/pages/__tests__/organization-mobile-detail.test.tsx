/**
 * Organization on a phone: one tap must open exactly one detail surface.
 *
 * The Coverage overview's team row opens node detail, and the team *name*
 * inside that row is a button that opens coverage detail. The inner button
 * did not stop propagation, so a single tap ran both handlers: coverage
 * detail appeared on top and node detail opened underneath it. Closing the
 * first revealed the second — a detail surface the reader never asked for,
 * from a tap they made once.
 *
 * These assert the rule rather than the symptom: after one tap, exactly one
 * of the two detail states is live.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, it, expect } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'

const SOURCE = readFileSync(
  path.join(process.cwd(), 'src/pages/OrganizationPage.tsx'),
  'utf8',
)

describe('Coverage team row — one tap, one surface', () => {
  it('stops the team-name tap from also reaching the row behind it', () => {
    /*
      A source assertion, deliberately. Rendering OrganizationPage means
      standing up 29 queries and contexts plus a computed org graph; that
      harness is worth building, but it is not what makes this fix correct.
      What makes it correct is that the inner handler stops the event before
      the row's handler can run, and that is what this pins.
    */
    // From the button to the first state call it makes, whichever branch
    // that is — the phone opens the node sheet on its Coverage tab, desktop
    // opens TeamCoveragePanel. Both are downstream of the same stop.
    const handler = SOURCE.match(
      /data-slot="coverage-team-name"[\s\S]{0,2500}?set(?:ModalNodeId|ViewingTeamCoverage)\(/,
    )?.[0]

    expect(handler, 'coverage team-name button should exist').toBeTruthy()
    expect(handler).toMatch(/e\.stopPropagation\(\)/)
    // And the stop has to come first — after the state call it would not
    // prevent the row handler, it would just look like it did.
    expect(handler!.indexOf('stopPropagation')).toBeLessThan(
      handler!.search(/set(?:ModalNodeId|ViewingTeamCoverage)\(/),
    )
  })

  it('routes the phone to the one node destination instead of a parallel panel', () => {
    // Coverage opens the same sheet Structure opens, on its Coverage tab —
    // not a second surface showing the same team's coverage.
    const handler = SOURCE.match(
      /data-slot="coverage-team-name"[\s\S]{0,2500}?setViewingTeamCoverage\(/,
    )?.[0]
    expect(handler).toMatch(/isMobile/)
    expect(handler).toMatch(/setModalManageTab\('coverage'\)/)
    expect(handler).toMatch(/setModalNodeId\(/)
  })
})

describe('team destination — entry intent and remount', () => {
  it('keys the sheet on the entry intent, not just the node', () => {
    /*
      `initialPage` / `initialManageTab` are read in useState initialisers,
      and the modal resets itself to profile/details whenever the node id
      changes. Passing the props alone therefore does nothing visible — the
      key is what makes them mean anything.
    */
    expect(SOURCE).toMatch(/key=\{`\$\{modalNodeId\}:\$\{modalInitialPage\}:\$\{modalManageTab\}`\}/)
    expect(SOURCE).toMatch(/initialManageTab=\{modalManageTab\}/)
  })

  it('keys on the requested tab, never the sheet\'s live one', () => {
    /*
      The sheet owns `manageTab` internally once open. If the key tracked
      that, every tab switch would remount and throw away in-progress edits.
      The page must not know about the live tab at all — it only ever sets
      the *requested* one, and only when opening.
    */
    expect(SOURCE).not.toMatch(/\bmanageTab\b(?!\s*=)/)
    expect(SOURCE).toMatch(/key=\{`[^`]*\$\{modalManageTab\}`\}/)
  })

  it('sets the Back context at every entry, so it can never be stale', () => {
    /*
      Counting call sites would just encode today's number — there were two,
      then three, and the assertion broke without anything being wrong. The
      invariant is that opening the sheet and recording where you came from
      happen together: every `setModalInitialPage` is an entry, and every
      entry must set the flag.
    */
    const entries = (SOURCE.match(/setModalInitialPage\(/g) ?? []).length
    const flagged = (SOURCE.match(/setCameFromCoverage\(/g) ?? []).length
    expect(entries).toBeGreaterThan(0)
    expect(flagged).toBe(entries)
    expect(SOURCE).toMatch(/backLabel=\{isMobile \? \(cameFromCoverage \? 'Coverage' : 'Structure'\) : undefined\}/)
  })
})

/*
  The propagation contract itself, demonstrated against real DOM.

  This does not import the page — it pins the behaviour the fix relies on, so
  that if a future refactor moves the button out of the row or drops the
  handler shape, the assumption above is still being stated somewhere
  executable rather than only in a comment.
*/
describe('nested-button propagation contract', () => {
  it('a child button that stops propagation does not trigger its row', () => {
    const fired: string[] = []
    render(
      <table>
        <tbody>
          <tr onClick={() => fired.push('row')}>
            <td>
              <button onClick={(e) => { e.stopPropagation(); fired.push('name') }}>
                Growth Team
              </button>
            </td>
          </tr>
        </tbody>
      </table>,
    )

    fireEvent.click(screen.getByText('Growth Team'))
    expect(fired).toEqual(['name'])
    cleanup()
  })

  it('and without the stop, both fire — which is the bug this guards', () => {
    const fired: string[] = []
    render(
      <table>
        <tbody>
          <tr onClick={() => fired.push('row')}>
            <td>
              <button onClick={() => fired.push('name')}>Growth Team</button>
            </td>
          </tr>
        </tbody>
      </table>,
    )

    fireEvent.click(screen.getByText('Growth Team'))
    expect(fired).toEqual(['name', 'row'])
    cleanup()
  })
})
