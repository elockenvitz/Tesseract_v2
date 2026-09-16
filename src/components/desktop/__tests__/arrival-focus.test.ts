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
