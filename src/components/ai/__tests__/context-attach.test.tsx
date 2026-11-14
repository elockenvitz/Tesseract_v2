/**
 * Add Context: the picker you can navigate, and a chip that cannot lie.
 *
 * ── The two defects ─────────────────────────────────────────────────────
 *
 * 1. The picker was a flat list of six rows whose only type signal was a
 *    12px icon, reachable by mouse alone. An asset called "Growth" and a
 *    theme called "Growth" were indistinguishable, so attaching the wrong
 *    one was silent -- and the conversation then drew its context from an
 *    object the reader had not meant to pick.
 *
 * 2. A chip asserted the client's own tag write and nothing else. It said
 *    "Large Cap Growth" while `ai-chat` had failed to read that portfolio,
 *    so the answer beside it was built from no portfolio with nothing on
 *    screen to distinguish that from an answer that used it.
 *
 * The second is the one that matters, and it is why `retrieval` is a
 * separate prop from `referenceStatus` rather than folded into it: the
 * failure case had `referenceStatus === 'open'` -- the reader could open the
 * portfolio perfectly well -- and a server that could not read it.
 *
 * `useEntitySearch` is stubbed, because it reads four tables through the
 * caller's RLS and this suite is about the control, not the search.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AiContextAttach } from '../AiContextAttach'
import type { TagRef } from '../../../hooks/useAI'

let searchResults: Array<{ type: string; id: string; title: string; subtitle?: string }> = []
let searchLoading = false
const searchCalls: Array<{ query: string; enabled: boolean; limit?: number }> = []

vi.mock('../../../hooks/useEntitySearch', () => ({
  useEntitySearch: (args: { query: string; enabled: boolean; limit?: number }) => {
    searchCalls.push({ query: args.query, enabled: args.enabled, limit: args.limit })
    return { results: args.enabled ? searchResults : [], isLoading: args.enabled && searchLoading }
  },
}))

const LCG = 'a2693ece-cdb7-4f17-a292-7c4a55df8c68'

/* One name across three kinds, which is the collision the icons could not
   resolve. */
const AMBIGUOUS = [
  { type: 'asset', id: 'a-grow', title: 'Growth Co', subtitle: 'GRW' },
  { type: 'portfolio', id: LCG, title: 'Large Cap Growth' },
  { type: 'theme', id: 't-grow', title: 'Secular Growth' },
  { type: 'note', id: 'n-grow', title: 'Growth notes' },
]

beforeEach(() => {
  searchResults = []
  searchLoading = false
  searchCalls.length = 0
})

function setup(props: Partial<React.ComponentProps<typeof AiContextAttach>> = {}) {
  const onAttach = vi.fn()
  const onDetach = vi.fn()
  const utils = render(
    <AiContextAttach
      attached={props.attached ?? []}
      onAttach={onAttach}
      onDetach={onDetach}
      {...props}
    />,
  )
  return { ...utils, onAttach, onDetach, user: userEvent.setup() }
}

const openPicker = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.click(screen.getByTestId('ai-context-add'))
  return screen.getByTestId('ai-context-search')
}

describe('the picker says what kind of thing each row is', () => {
  it('groups the results under named headings', async () => {
    searchResults = AMBIGUOUS
    const { user } = setup()
    await user.type(await openPicker(user), 'growth')

    const headings = [...screen.getByTestId('ai-context-results')
      .querySelectorAll('[data-slot="ai-context-group"]')]
    expect(headings.map(h => h.textContent)).toEqual(['Assets', 'Portfolios', 'Themes', 'Notes'])
  })

  it('shows only the headings that have results', async () => {
    searchResults = [AMBIGUOUS[1]]
    const { user } = setup()
    await user.type(await openPicker(user), 'growth')

    const headings = [...screen.getByTestId('ai-context-results')
      .querySelectorAll('[data-slot="ai-context-group"]')]
    expect(headings.map(h => h.textContent)).toEqual(['Portfolios'])
  })

  it('keeps the kinds in a fixed order rather than by relevance', async () => {
    /* A list whose sections reorder between keystrokes cannot be navigated:
       the row under the cursor changes meaning as the reader types. */
    searchResults = [AMBIGUOUS[3], AMBIGUOUS[2], AMBIGUOUS[1], AMBIGUOUS[0]]
    const { user } = setup()
    await user.type(await openPicker(user), 'growth')

    const headings = [...screen.getByTestId('ai-context-results')
      .querySelectorAll('[data-slot="ai-context-group"]')]
    expect(headings.map(h => h.textContent)).toEqual(['Assets', 'Portfolios', 'Themes', 'Notes'])
  })

  it('asks for more than six candidates', async () => {
    /* Six across four kinds is one or two of each, so a grouped list could
       not show that other portfolios matched -- it showed one and looked
       complete. */
    const { user } = setup()
    await user.type(await openPicker(user), 'growth')
    const enabled = searchCalls.filter(c => c.enabled)
    expect(enabled.length).toBeGreaterThan(0)
    expect(enabled[enabled.length - 1].limit).toBeGreaterThan(6)
  })
})

describe('the picker can be driven from the keyboard', () => {
  it('selects the first result without any key being pressed', async () => {
    searchResults = AMBIGUOUS
    const { user } = setup()
    await user.type(await openPicker(user), 'growth')
    expect(screen.getByRole('option', { selected: true })).toHaveTextContent('Growth Co')
  })

  it('moves down across group boundaries', async () => {
    searchResults = AMBIGUOUS
    const { user } = setup()
    await user.type(await openPicker(user), 'growth')
    await user.keyboard('{ArrowDown}')
    /* Asset -> Portfolio. A per-group cursor would have stopped here. */
    expect(screen.getByRole('option', { selected: true })).toHaveTextContent('Large Cap Growth')
  })

  it('wraps from the last row to the first', async () => {
    searchResults = AMBIGUOUS
    const { user } = setup()
    await user.type(await openPicker(user), 'growth')
    await user.keyboard('{ArrowUp}')
    expect(screen.getByRole('option', { selected: true })).toHaveTextContent('Growth notes')
  })

  it('attaches the selected row on Enter', async () => {
    searchResults = AMBIGUOUS
    const { user, onAttach } = setup()
    await user.type(await openPicker(user), 'growth')
    await user.keyboard('{ArrowDown}{Enter}')
    expect(onAttach).toHaveBeenCalledWith({ type: 'portfolio', id: LCG, label: 'Large Cap Growth' })
  })

  it('does not attach an object that is already there', async () => {
    searchResults = AMBIGUOUS
    const attached: TagRef[] = [{ type: 'portfolio', id: LCG, label: 'Large Cap Growth' }]
    const { user, onAttach } = setup({ attached })
    await user.type(await openPicker(user), 'growth')
    await user.keyboard('{ArrowDown}{Enter}')
    expect(onAttach).not.toHaveBeenCalled()
  })

  it('closes on Escape and attaches nothing', async () => {
    searchResults = AMBIGUOUS
    const { user, onAttach } = setup()
    await user.type(await openPicker(user), 'growth')
    await user.keyboard('{Escape}')
    expect(screen.queryByTestId('ai-context-results')).toBeNull()
    expect(screen.getByTestId('ai-context-add')).toBeInTheDocument()
    expect(onAttach).not.toHaveBeenCalled()
  })

  it('points the input at the selected row for a screen reader', async () => {
    searchResults = AMBIGUOUS
    const { user } = setup()
    const input = await openPicker(user)
    await user.type(input, 'growth')
    const active = input.getAttribute('aria-activedescendant')
    expect(active).toBeTruthy()
    expect(document.getElementById(active!)).toHaveTextContent('Growth Co')
  })

  it('resets the cursor when the results change', async () => {
    searchResults = AMBIGUOUS
    const { user } = setup()
    const input = await openPicker(user)
    await user.type(input, 'growth')
    await user.keyboard('{ArrowDown}{ArrowDown}')
    expect(screen.getByRole('option', { selected: true })).toHaveTextContent('Secular Growth')

    /* A narrower query returns one row; a kept index would point at nothing
       or at whatever now occupies position two. */
    searchResults = [AMBIGUOUS[1]]
    await user.type(input, 'x')
    expect(screen.getByRole('option', { selected: true })).toHaveTextContent('Large Cap Growth')
  })
})

describe('the picker says which state it is in', () => {
  it('says to keep typing rather than showing an empty result list', async () => {
    const { user } = setup()
    await user.type(await openPicker(user), 'g')
    expect(screen.getByTestId('ai-context-minlength')).toBeInTheDocument()
    expect(screen.queryByTestId('ai-context-results')).toBeNull()
  })

  it('does not search on one character', async () => {
    const { user } = setup()
    await user.type(await openPicker(user), 'g')
    expect(searchCalls.every(c => !c.enabled)).toBe(true)
  })

  it('says it is searching', async () => {
    searchLoading = true
    const { user } = setup()
    await user.type(await openPicker(user), 'growth')
    expect(screen.getByTestId('ai-context-results')).toHaveTextContent(/searching/i)
  })

  it('distinguishes nothing-matched from nothing-visible-to-you', async () => {
    searchResults = []
    const { user } = setup()
    await user.type(await openPicker(user), 'growth')
    expect(screen.getByTestId('ai-context-results'))
      .toHaveTextContent(/nothing you can open matches that/i)
  })
})

describe('a chip reports what the SERVER resolved', () => {
  const tag: TagRef = { type: 'portfolio', id: LCG, label: 'Large Cap Growth' }

  it('marks an object the answer was built without', () => {
    /* The reported failure, exactly: the reader can open the portfolio, and
       the server could not read it. */
    setup({
      attached: [tag],
      referenceStatus: () => 'open',
      retrieval: () => 'unavailable',
    })
    const chip = document.querySelector('[data-slot="ai-context-chip"]')!
    expect(chip.getAttribute('data-retrieval')).toBe('unavailable')
    expect(chip.getAttribute('data-reference-status')).toBe('open')
    expect(chip.getAttribute('title')).toMatch(/could not be read for the last answer/i)
  })

  it('says nothing is wrong before anything has been asked', () => {
    /* `unknown` is the state of every chip before the first send. Drawing it
       as a problem would train the reader to ignore the real warning. */
    setup({ attached: [tag], retrieval: () => 'unknown' })
    const chip = document.querySelector('[data-slot="ai-context-chip"]')!
    expect(chip.getAttribute('data-retrieval')).toBe('unknown')
    expect(chip.getAttribute('title')).toMatch(/was added to this conversation/i)
    expect(chip.querySelector('.lucide-triangle-alert')).toBeNull()
  })

  it('does not warn about an object that was read and is simply bare', () => {
    /* `empty` is a finding, not a fault: the firm has written nothing on it.
       An answer saying so is correct, and a warning would say the system is
       broken when what it found is that the research is missing. */
    setup({ attached: [{ type: 'asset', id: 'a1', label: 'NVDA' }], retrieval: () => 'empty' })
    const chip = document.querySelector('[data-slot="ai-context-chip"]')!
    expect(chip.getAttribute('title')).toMatch(/nothing is recorded on it yet/i)
    expect(chip.className).not.toMatch(/amber/)
  })

  it('gives each failure its own sentence', () => {
    const titles = new Set<string>()
    for (const outcome of ['unavailable', 'unsupported', 'failed'] as const) {
      const { unmount } = setup({ attached: [tag], retrieval: () => outcome })
      titles.add(document.querySelector('[data-slot="ai-context-chip"]')!.getAttribute('title')!)
      unmount()
    }
    /* Three distinct sentences. Collapsing them into "context unavailable"
       is what made the original failure unreportable: re-attach, nothing and
       retry are three different things for the reader to do. */
    expect(titles.size).toBe(3)
  })

  it('tells the reader a failed read is worth retrying', () => {
    setup({ attached: [tag], retrieval: () => 'failed' })
    expect(document.querySelector('[data-slot="ai-context-chip"]')!.getAttribute('title'))
      .toMatch(/asking again may work/i)
  })

  it('lets a gap outrank the inherited styling', () => {
    /* Where the chip came from stops mattering once the object was not in
       the answer: the question is no longer "did I add this". */
    setup({
      attached: [tag],
      inheritedKeys: [`portfolio:${LCG}`],
      retrieval: () => 'failed',
    })
    const chip = document.querySelector('[data-slot="ai-context-chip"]')!
    expect(chip.getAttribute('data-attach-origin')).toBe('inherited')
    expect(chip.className).toMatch(/amber/)
    expect(chip.className).not.toMatch(/border-dashed/)
  })

  it('keeps the chip removable and openable while it is warning', () => {
    /* A warning that disables the controls leaves the reader with a problem
       and no way to act on it -- re-attaching is the fix for `unavailable`. */
    setup({
      attached: [tag],
      referenceStatus: () => 'open',
      retrieval: () => 'unavailable',
      onOpenObject: () => {},
    })
    const chip = document.querySelector('[data-slot="ai-context-chip"]')!
    expect(within(chip as HTMLElement).getByRole('button', { name: /remove/i })).toBeEnabled()
    expect(chip.querySelector('[data-slot="ai-context-open"]')).not.toBeNull()
  })

  it('defaults to claiming nothing when no retrieval prop is given', () => {
    setup({ attached: [tag] })
    expect(document.querySelector('[data-slot="ai-context-chip"]')!.getAttribute('data-retrieval'))
      .toBe('unknown')
  })
})
