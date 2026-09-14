/**
 * The pilot's locked Trade Book and Outcomes.
 *
 * On a phone they are a compact locked state rather than the desktop's
 * documentation page: no "Pilot preview" pill, a one-line description, a lock
 * card with a short title and one or two sentences, one full-width CTA, and
 * three one-line summary rows instead of six feature cards. Desktop renders the
 * preview it always did.
 *
 * The phone is selected by the real `useIsMobile`, driven through matchMedia.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, cleanup, within } from '@testing-library/react'

vi.mock('../../../hooks/usePilotMode', () => ({
  usePilotMode: () => ({ isLoading: false, isPilot: true, hasCommittedTutorialTrade: false }),
}))
vi.mock('../../../hooks/usePilotProgress', () => ({
  usePilotProgress: () => ({ hasUnlockedTradeBook: false, hasUnlockedOutcomes: false, mark: vi.fn() }),
}))

import { PilotTradeBookPreview } from '../PilotTradeBookPreview'
import { PilotOutcomesPreview } from '../PilotOutcomesPreview'

function setViewport(width: number) {
  window.matchMedia = ((query: string) => {
    const max = /max-width:\s*(\d+)px/.exec(query)
    const min = /min-width:\s*(\d+)px/.exec(query)
    const matches = (!max || width <= Number(max[1])) && (!min || width >= Number(min[1]))
    return { matches, media: query, onchange: null, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => false }
  }) as unknown as typeof window.matchMedia
}

afterEach(cleanup)

const words = (s: string) => s.trim().split(/\s+/).length

describe.each([
  ['Trade Book', PilotTradeBookPreview, ['Decision rationale', 'Sizing', 'Portfolio context'], /pilot idea/],
  ['Outcomes', PilotOutcomesPreview, ['Thesis preservation', 'Price targets', 'Post-mortems'], /pilot idea/],
])('%s locked state on a phone', (surface, Preview, rows, lineage) => {
  const mount = () => {
    setViewport(390)
    const onGoToTradeLab = vi.fn()
    const { container } = render(<Preview onGoToTradeLab={onGoToTradeLab} />)
    return { root: container.querySelector('[data-slot="pilot-locked-phone"]') as HTMLElement, onGoToTradeLab, container }
  }

  it('is the compact state, not the desktop preview, and scrolls itself', () => {
    const { root, container } = mount()
    expect(root).not.toBeNull()
    expect(container.querySelector('[data-slot="pilot-locked-preview"]')).toBeNull()
    expect(root.className).toContain('h-full')
    expect(root.className).toContain('overflow-y-auto')
  })

  it('has no Pilot preview pill', () => {
    expect(mount().root.textContent).not.toContain('Pilot preview')
  })

  it('leads with the surface, a one-line description, and a short lock title that names the pilot idea', () => {
    const { root } = mount()
    expect(within(root).getByRole('heading', { level: 1 }).textContent).toBe(surface)
    const description = root.querySelector('h1')!.parentElement!.nextElementSibling as HTMLElement
    expect(words(description.textContent!)).toBeLessThanOrEqual(10)
    const lockTitle = within(root).getByRole('heading', { level: 2 }).textContent!
    expect(lockTitle).toMatch(lineage)
    expect(words(lockTitle)).toBeLessThanOrEqual(9)
  })

  it('explains the lock in at most two sentences', () => {
    const card = mount().root.querySelector('[data-slot="pilot-locked-card"]') as HTMLElement
    const body = card.querySelector('p')!.textContent!
    expect(body.split(/[.;]\s/).filter(Boolean).length).toBeLessThanOrEqual(2)
    expect(words(body)).toBeLessThanOrEqual(22)
  })

  it('offers one full-width CTA that goes to Trade Lab', () => {
    const { root, onGoToTradeLab } = mount()
    const ctas = root.querySelectorAll('[data-slot="pilot-locked-cta"]')
    expect(ctas).toHaveLength(1)
    const cta = ctas[0] as HTMLButtonElement
    expect(cta.className).toContain('w-full')
    expect(cta.className).toContain('h-11')
    cta.click()
    expect(onGoToTradeLab).toHaveBeenCalledTimes(1)
  })

  it('summarises value in three one-line rows', () => {
    const list = mount().root.querySelector('[data-slot="pilot-locked-items"]') as HTMLElement
    const items = Array.from(list.querySelectorAll('li'))
    expect(items.map(li => li.querySelector('.text-sm')!.textContent)).toEqual(rows)
    for (const li of items) {
      expect(li.querySelector('svg')).not.toBeNull()
      expect(words(li.querySelector('.text-xs')!.textContent!)).toBeLessThanOrEqual(8)
    }
  })

  it('keeps the primary message above the summary rows', () => {
    const { root } = mount()
    const card = root.querySelector('[data-slot="pilot-locked-card"]')!
    const list = root.querySelector('[data-slot="pilot-locked-items"]')!
    expect(card.compareDocumentPosition(list) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })
})

describe.each([
  ['Trade Book', PilotTradeBookPreview, "This opens after you commit the idea you're working through in the pilot"],
  ['Outcomes', PilotOutcomesPreview, 'This opens after your pilot idea is committed and reaches Trade Book'],
])('%s preview on desktop is unchanged', (_surface, Preview, lockTitle) => {
  const mount = () => {
    setViewport(1440)
    return render(<Preview onGoToTradeLab={vi.fn()} />).container
  }

  it('renders the original preview, not the phone state', () => {
    const c = mount()
    expect(c.querySelector('[data-slot="pilot-locked-phone"]')).toBeNull()
    const root = c.querySelector('[data-slot="pilot-locked-preview"]') as HTMLElement
    expect(root.className).toBe('p-8 max-w-4xl mx-auto space-y-6')
    expect((c.querySelector('[data-slot="pilot-preview-cards"]') as HTMLElement).className).toBe('grid grid-cols-3 gap-3')
    expect(c.textContent).toContain('Pilot preview')
    expect(c.querySelectorAll('[data-slot="pilot-preview-cards"] > div')).toHaveLength(6)
  })

  it('keeps the pilot-idea lock copy', () => {
    expect(mount().textContent).toContain(lockTitle)
  })
})
