/**
 * The Create Process wizard at phone width.
 *
 * The wizard is a modal inside a 390px viewport: `p-2` backdrop and `p-4`
 * content leave roughly 326px of usable width. Four form grids were pinned to
 * two or three columns with no responsive prefix, the five-step rail needed
 * ~344px, and three control clusters were revealed only on hover — which on a
 * phone means never.
 *
 * jsdom has no layout engine, so nothing here can measure a pixel. These
 * assert the two things that are observable: that a control is present and
 * operable, and that the responsive contract keeping it on screen is actually
 * declared. Where a claim is about the whole file rather than one element it
 * is asserted against the source, as a ratchet against reintroduction.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent, within } from '@testing-library/react'

const USERS = [
  { id: 'u-2', email: 'rk@example.com', name: 'Rosa Klebb' },
  { id: 'u-3', email: 'jb@example.com', name: 'Jim Brand' },
]

const EMPTY: never[] = []
const NOOP = () => {}
const QUERY_CLIENT = {
  invalidateQueries: NOOP, setQueryData: NOOP, getQueryData: () => undefined,
  prefetchQuery: async () => {}, cancelQueries: async () => {}, removeQueries: NOOP,
}

// Cached by key and returned by identity — a fresh array per call re-renders
// this component forever.
const queryResults = new Map<string, unknown>()
vi.mock('@tanstack/react-query', () => ({
  useQuery: (opts: any) => {
    const key = JSON.stringify(opts?.queryKey ?? [])
    if (!queryResults.has(key)) {
      const data = key.includes('users-search') ? USERS : EMPTY
      queryResults.set(key, { data, isLoading: false, isError: false, error: null, refetch: NOOP })
    }
    return queryResults.get(key)
  },
  useQueryClient: () => QUERY_CLIENT,
}))

vi.mock('../../../lib/supabase', () => ({
  supabase: { from: () => ({}), rpc: async () => ({ data: null, error: null }) },
}))
vi.mock('../../../lib/market-data/supabase-asset-source', () => ({ assetAccess: {} }))
vi.mock('../../../hooks/useAuth', () => ({
  useAuth: () => ({ user: { id: 'u-1', email: 'me@example.com', first_name: 'Ada', last_name: 'L' } }),
}))
vi.mock('../../../contexts/OrganizationContext', () => ({
  useOrganization: () => ({ currentOrgId: 'org-1' }),
}))
vi.mock('../modals/AddRuleModal', () => ({ AddRuleModal: () => null }))
vi.mock('../modals/AddAssetPopulationRuleModal', () => ({ AddAssetPopulationRuleModal: () => null }))
vi.mock('../modals/AddBranchEndingRuleModal', () => ({ AddBranchEndingRuleModal: () => null }))

import { CreateWorkflowWizard } from '../CreateWorkflowWizard'

const SOURCE = readFileSync(
  path.join(process.cwd(), 'src/components/workflow/CreateWorkflowWizard.tsx'),
  'utf8',
)

const slot = (name: string) => document.querySelector(`[data-slot="${name}"]`) as HTMLElement | null

function open() {
  return render(<CreateWorkflowWizard onClose={NOOP} onComplete={NOOP} />)
}

/** Fill the name and advance to the Access step, where the team panels live. */
function goToAccessStep() {
  open()
  fireEvent.change(
    screen.getByPlaceholderText('e.g., Quarterly Earnings Review'),
    { target: { value: 'Quarterly Review' } },
  )
  fireEvent.click(screen.getByRole('button', { name: /Continue to Access/ }))
}

describe('wizard form grids', () => {
  beforeEach(() => queryResults.clear())
  afterEach(cleanup)

  it('stacks the scope options into one column on a phone', () => {
    open()
    const cls = slot('wizard-scope-options')!.className
    expect(cls).toContain('grid-cols-1')
    expect(cls).toContain('sm:grid-cols-3')
  })

  it('keeps the two-up range bounds deliberately two-up', () => {
    // Min/Max is the one pair that reads better side by side. Asserted so a
    // blanket "stack everything" sweep does not quietly undo the judgement.
    expect(SOURCE).toMatch(/data-slot="wizard-range-bounds"[\s\S]{0,120}grid-cols-2/)
  })

  it('leaves no unprefixed multi-column grid in the wizard', () => {
    /*
      Every `grid-cols-N` for N > 1 must either be responsive (a `sm:` /
      `md:` / `lg:` prefix somewhere in the same class list) or be the
      range-bounds pair that is deliberately fixed.
    */
    const offenders = (SOURCE.match(/className="[^"]*\bgrid-cols-[2-9][^"]*"/g) ?? [])
      .filter(cls => !/(sm|md|lg):grid-cols-/.test(cls))
    expect(offenders).toEqual(['className="grid grid-cols-2 gap-3"'])
  })

  it('stacks the role permission columns', () => {
    goToAccessStep()
    const cls = slot('wizard-role-permissions')!.className
    expect(cls).toContain('grid-cols-1')
    expect(cls).toContain('sm:grid-cols-2')
  })

  it('stacks the stage timing pair', () => {
    expect(SOURCE).toMatch(/data-slot="wizard-stage-timing"[\s\S]{0,160}grid-cols-1 gap-3 sm:grid-cols-2/)
  })
})

describe('wizard progress stepper', () => {
  beforeEach(() => queryResults.clear())
  afterEach(cleanup)

  it('names the current step on a phone, where the rail labels are hidden', () => {
    open()
    const caption = slot('wizard-step-caption')!
    expect(caption.className).toContain('sm:hidden')
    expect(caption.textContent).toContain('Step 1 of 5')
    expect(caption.textContent).toContain('Foundation')
  })

  it('advances the caption with the step', () => {
    goToAccessStep()
    const caption = slot('wizard-step-caption')!
    expect(caption.textContent).toContain('Step 2 of 5')
    expect(caption.textContent).toContain('Access')
  })

  it('buys width from the gutters rather than shrinking the step markers', () => {
    open()
    const stepper = slot('wizard-stepper')!
    // The circle is untouched at 32px — no scaling down to fit.
    for (const circle of Array.from(stepper.querySelectorAll('div.rounded-full'))) {
      expect(circle.className).toContain('w-8')
      expect(circle.className).toContain('h-8')
    }
    // The padding is what gives: tighter below sm, original at sm.
    for (const button of Array.from(stepper.querySelectorAll('button'))) {
      expect(button.className).toContain('px-2')
      expect(button.className).toContain('sm:px-3')
    }
  })

  it('keeps every step present and its state readable', () => {
    goToAccessStep()
    const stepper = slot('wizard-stepper')!
    expect(stepper.querySelectorAll('button')).toHaveLength(5)
    // Step 1 completed (green), step 2 active (blue).
    expect(stepper.innerHTML).toContain('bg-green-600')
    expect(stepper.innerHTML).toContain('bg-blue-600')
  })

  it('reclaims width from the modal shell without changing desktop', () => {
    open()
    expect(slot('wizard-content')!.className).toContain('p-4')
    expect(slot('wizard-content')!.className).toContain('sm:p-6')
    expect(SOURCE).toContain('z-50 p-2 sm:p-4')
  })
})

describe('wizard content panes', () => {
  beforeEach(() => queryResults.clear())
  afterEach(cleanup)

  it('keeps the fixed-height team panes scrollable, so content is reachable rather than clipped', () => {
    goToAccessStep()
    /*
      These two heights are list viewports, not content boxes: every row is a
      single line with `truncate`, so nothing inside can grow by wrapping and
      the height cannot clip text. What matters is that overflow is reachable
      — bounded scrolling, which the panes must keep.
    */
    for (const height of ['h-[132px]', 'h-[168px]']) {
      const pane = document.querySelector(`.${CSS.escape(height)}`)
      expect(pane, `${height} pane should exist`).not.toBeNull()
      expect(pane!.className).toContain('overflow-y-auto')
    }
  })

  it('lets the available-users search shrink instead of widening the row', () => {
    goToAccessStep()
    const wrapper = slot('wizard-user-search')!

    // `flex-1` without `min-w-0` cannot go below the input's intrinsic width,
    // which is what pushed this row past the viewport.
    expect(wrapper.className).toContain('min-w-0')
    expect(wrapper.className).toContain('flex-1')

    // The fixed chrome it has to make room for is still fixed — if this ever
    // became shrinkable the min-w-0 above would be masking, not fixing.
    const role = screen.getByLabelText('Default role for new members')
    expect(role.parentElement!.className).toContain('flex-shrink-0')
  })

  it('keeps pane rows single-line, which is why a fixed height is safe here', () => {
    goToAccessStep()
    const pane = document.querySelector('.h-\\[168px\\]')!
    const names = pane.querySelectorAll('span.truncate')
    expect(names.length).toBeGreaterThan(0)
  })
})

describe('wizard destructive controls without hover', () => {
  beforeEach(() => queryResults.clear())
  afterEach(cleanup)

  it('shows the remove control for a team member without any hover', () => {
    goToAccessStep()

    // Add a user from the available list.
    fireEvent.click(screen.getByText('Rosa Klebb'))

    const remove = screen.getByRole('button', { name: 'Remove Rosa Klebb' })
    // Visible outright below sm; hover-revealed only from sm up.
    expect(remove.className).toContain('opacity-100')
    expect(remove.className).toContain('sm:opacity-0')
    expect(remove.className).toContain('sm:group-hover:opacity-100')
    // And a real tap target on a phone.
    expect(remove.className).toContain('max-sm:min-h-[44px]')
  })

  it('actually removes the member when that control is used', () => {
    goToAccessStep()
    fireEvent.click(screen.getByText('Rosa Klebb'))
    fireEvent.click(screen.getByRole('button', { name: 'Remove Rosa Klebb' }))

    expect(screen.queryByRole('button', { name: 'Remove Rosa Klebb' })).toBeNull()
  })

  it('leaves no hover-only reveal anywhere in the wizard', () => {
    // The ratchet. `opacity-0 group-hover:opacity-100` with no `sm:` guard is
    // the exact pattern that was unreachable on touch; the global rule in
    // index.css does not cover this component's cases and is not ours to change.
    const offenders = (SOURCE.match(/className="[^"]*opacity-0 group-hover:opacity-100[^"]*"/g) ?? [])
    expect(offenders).toEqual([])
  })

  it('does not expose any extra action alongside the restored ones', () => {
    goToAccessStep()
    fireEvent.click(screen.getByText('Rosa Klebb'))

    const row = screen.getByRole('button', { name: 'Remove Rosa Klebb' }).parentElement!
    // Exactly the role badge toggle and the remove button — nothing added.
    expect(within(row).getAllByRole('button')).toHaveLength(2)
  })
})
