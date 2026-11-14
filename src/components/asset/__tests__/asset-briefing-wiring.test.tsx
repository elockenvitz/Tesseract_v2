/**
 * The briefing is bound to the page's own view of the asset.
 *
 * ── What is being protected ──────────────────────────────────────────────
 *
 * Three things, each a way the feature could look right and be wrong.
 *
 * It must read the SAME resolver the attention band reads. A briefing that
 * derived its own view would eventually describe a different asset from the
 * band two inches above it, and a reader cannot adjudicate between two parts
 * of one screen.
 *
 * It must not spend a model call on arrival. A briefing costs several seconds
 * of tool lookups, and running one because somebody opened a page they were
 * passing through spends their money and replaces an instant page with a
 * spinner.
 *
 * And the handoff must carry the FRAMING, not the briefing's prose. Pasting
 * the answer into the composer as if the reader had typed it would strip its
 * evidence trail and turn a sourced figure into an unsourced assertion the
 * model then builds on.
 *
 * The hooks are mocked because both reach a Supabase client at import.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { WorkspaceSignal, WorkspaceState } from '../../../lib/asset-workspace/context'

/** What the two hooks would be returning at this moment. Mutated per test. */
const world: {
  signals: WorkspaceSignal[]
  state: WorkspaceState
  signalsLoading: boolean
  briefing: { message: unknown; toolCalls: unknown[] } | undefined
  isLoading: boolean
  error: Error | null
  /** Every input the briefing hook was called with, in order. */
  calls: Array<Record<string, unknown>>
} = {
  signals: [],
  state: 'position-monitored',
  signalsLoading: false,
  briefing: undefined,
  isLoading: false,
  error: null,
  calls: [],
}

const signal = (over: Partial<WorkspaceSignal> = {}): WorkspaceSignal => ({
  id: 'pending-p1-buy',
  kind: 'pending',
  headline: 'A buy in Core Growth is waiting on a decision',
  destination: 'decisions',
  evidence: [{ label: 'Request: buy', table: 'decision_requests', id: 'dr1' }],
  weight: 110,
  ...over,
})

vi.mock('../../../hooks/useAssetAttentionSignals', () => ({
  useAssetAttentionSignals: () => ({
    signals: world.signals,
    state: world.state,
    isLoading: world.signalsLoading,
    ready: !world.signalsLoading,
  }),
}))

vi.mock('../../../hooks/ai/useAssetBriefing', () => ({
  useAssetBriefing: (input: Record<string, unknown>) => {
    world.calls.push(input)
    return {
      data: world.briefing,
      isLoading: world.isLoading,
      error: world.error,
      refetch: vi.fn(),
    }
  },
}))

/** Engagement requests the handoff dispatched. */
const asked: Array<Record<string, unknown>> = []
vi.mock('../../../lib/engagement', () => ({
  askAI: (target: Record<string, unknown>) => { asked.push(target); return true },
}))

import { AssetBriefingSection } from '../AssetBriefingSection'
import { BRIEFING_TITLE } from '../../../lib/ai/briefing'

const answer = {
  message: {
    id: 'briefing:a1:review', role: 'assistant' as const,
    content: 'Nothing material has changed since the case was written.',
    timestamp: new Date('2026-11-11T12:00:00Z'),
  },
  toolCalls: [],
}

function renderSection(assetId = 'a1') {
  return render(
    <AssetBriefingSection
      assetId={assetId}
      symbol="AAPL"
      companyName="Apple Inc."
      coveringUserIds={['u1']}
      spot={242.5}
    />,
  )
}

beforeEach(() => {
  world.signals = []
  world.state = 'position-monitored'
  world.signalsLoading = false
  world.briefing = undefined
  world.isLoading = false
  world.error = null
  world.calls = []
  asked.length = 0
})

describe('it says the situation the page says', () => {
  it('prepares a decision exactly when one is waiting', () => {
    world.state = 'decision-pending'
    world.signals = [signal()]
    renderSection()
    expect(screen.getByTestId('ai-briefing-context').textContent).toBe(BRIEFING_TITLE.decision)
  })

  it('reviews the asset in every other state', () => {
    world.state = 'research-active'
    renderSection()
    expect(screen.getByTestId('ai-briefing-context').textContent).toBe(BRIEFING_TITLE.review)
  })

  it('passes the band s own signals through to the question', () => {
    /* Not its own. The same objects, from the same hook, so the briefing is
       about what the band is already showing. */
    world.state = 'decision-pending'
    world.signals = [signal(), signal({ id: 'staleness-case-age', headline: 'The case was last written 7 months ago' })]
    renderSection()
    const last = world.calls[world.calls.length - 1]
    expect(last.signals).toBe(world.signals)
    expect(last.state).toBe('decision-pending')
    expect(last.context).toBe('decision')
  })
})

describe('nothing is spent on arrival', () => {
  it('asks for no briefing until the reader presses', () => {
    renderSection()
    expect(world.calls.every(c => c.enabled === false)).toBe(true)
    expect(screen.getByTestId('ai-briefing-run')).toBeTruthy()
  })

  it('enables the fetch on the press, once', async () => {
    renderSection()
    await userEvent.click(screen.getByTestId('ai-briefing-run'))
    expect(world.calls[world.calls.length - 1].enabled).toBe(true)
  })

  it('holds the fetch until the signals have settled, even after the press', async () => {
    /*
     * The question names the flagged signals. Asking before they land buys a
     * briefing about an empty page and caches it under a key that no longer
     * matches what the reader is looking at.
     */
    world.signalsLoading = true
    world.signals = []
    const { rerender } = render(
      <AssetBriefingSection assetId="a1" symbol="AAPL" coveringUserIds={[]} />,
    )
    /* Loading with nothing asked renders nothing at all: a spinner on a page
       nobody has asked anything of is worse than silence. */
    expect(screen.queryByTestId('ai-briefing')).toBeNull()

    world.signalsLoading = false
    rerender(<AssetBriefingSection assetId="a1" symbol="AAPL" coveringUserIds={[]} />)
    await userEvent.click(screen.getByTestId('ai-briefing-run'))
    expect(world.calls[world.calls.length - 1].enabled).toBe(true)
  })

  it('forgets the press when the reader moves to another asset', async () => {
    /*
     * Per asset, not per mount. Without this, pressing on one name starts a
     * model call the moment the next name mounts in the same slot, on a page
     * the reader has only just arrived at.
     *
     * The press below is load-bearing: the asset page keeps this component
     * mounted and swaps its props, so without an actual press first the
     * assertion holds against a component that never resets anything.
     */
    const { rerender } = renderSection('a1')
    await userEvent.click(screen.getByTestId('ai-briefing-run'))
    expect(world.calls[world.calls.length - 1].enabled).toBe(true)
    world.calls = []
    rerender(
      <AssetBriefingSection
        assetId="a2" symbol="MSFT" companyName="Microsoft" coveringUserIds={['u1']} spot={1}
      />,
    )
    expect(world.calls.every(c => c.enabled === false)).toBe(true)
    expect(screen.getByTestId('ai-briefing-run')).toBeTruthy()
  })
})

describe('carrying it into the pane', () => {
  it('opens ACT AI against this asset, with the framing in the composer', async () => {
    world.state = 'decision-pending'
    world.signals = [signal()]
    world.briefing = answer
    renderSection()

    await userEvent.click(screen.getByTestId('ai-briefing-continue'))
    expect(asked).toHaveLength(1)
    expect(asked[0]).toMatchObject({
      objectType: 'asset', objectId: 'a1', symbol: 'AAPL', assetId: 'a1',
      origin: { surface: 'asset-briefing' },
    })
    expect(String(asked[0].seedPrompt)).toContain('AAPL')
    expect(String(asked[0].label)).toContain('Apple Inc.')
  })

  it('hands over the question and never the briefing s prose', async () => {
    world.briefing = answer
    renderSection()
    await userEvent.click(screen.getByTestId('ai-briefing-continue'))
    const seed = String(asked[0].seedPrompt)
    expect(seed).not.toContain('Nothing material has changed')
    expect(seed.endsWith('?')).toBe(true)
  })

  it('offers no handoff before there is a briefing to continue from', () => {
    renderSection()
    expect(screen.queryByTestId('ai-briefing-continue')).toBeNull()
  })
})

describe('while it works, and when it fails', () => {
  it('shows the working row only after the press', () => {
    world.isLoading = true
    renderSection()
    /* The hook reports loading, but nothing was asked, so there is nothing to
       be loading. React Query says `isLoading` on a disabled query. */
    expect(screen.queryByTestId('ai-thinking')).toBeNull()
    expect(screen.getByTestId('ai-briefing-run')).toBeTruthy()
  })

  it('shows the working row once asked', async () => {
    world.isLoading = true
    renderSection()
    await userEvent.click(screen.getByTestId('ai-briefing-run'))
    expect(screen.getByTestId('ai-thinking')).toBeTruthy()
  })

  it('surfaces a failure with a way back', () => {
    world.error = new Error('The provider is unreachable.')
    renderSection()
    expect(screen.getByTestId('ai-error')).toBeTruthy()
    expect(screen.getByText('The provider is unreachable.')).toBeTruthy()
  })
})
