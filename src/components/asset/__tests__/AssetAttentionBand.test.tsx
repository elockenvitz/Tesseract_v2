/**
 * AssetAttentionBand — the one connected attention surface.
 *
 * Restraint (top-N + expander), explicit loading/empty, and that clicking a
 * signal routes with its precise focus. Signal content/dedup is the resolver's
 * job (tested in context.test.ts); here we test the surface.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const hook = vi.hoisted(() => ({ value: { signals: [] as any[], state: 'unowned', isLoading: false, ready: true } }))
vi.mock('../../../hooks/useAssetAttentionSignals', () => ({
  useAssetAttentionSignals: () => hook.value,
}))

import { AssetAttentionBand } from '../AssetAttentionBand'

const sig = (id: string, extra: any = {}) => ({
  id, kind: 'pending', headline: `Signal ${id}`, destination: 'decisions',
  evidence: [{ label: 'Request: buy', table: 'decision_requests', id }], weight: 100, ...extra,
})

beforeEach(() => { hook.value = { signals: [], state: 'unowned', isLoading: false, ready: true } })

function renderBand(onFocus = vi.fn()) {
  render(<AssetAttentionBand assetId="a1" symbol="LLY" coveringUserIds={[]} onFocus={onFocus} />)
  return onFocus
}

describe('AssetAttentionBand', () => {
  it('shows a restrained placeholder while loading, asserting nothing', () => {
    hook.value = { signals: [], state: 'unowned', isLoading: true, ready: false }
    renderBand()
    expect(screen.getByTestId('attention-band-loading')).toBeInTheDocument()
    expect(screen.queryByTestId('attention-band')).not.toBeInTheDocument()
  })

  it('renders nothing when there are no signals (no all-clear)', () => {
    hook.value = { signals: [], state: 'position-monitored', isLoading: false, ready: true }
    const { container } = render(<AssetAttentionBand assetId="a1" symbol="LLY" coveringUserIds={[]} onFocus={vi.fn()} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('caps to the top few and expands the rest on request', async () => {
    hook.value = { signals: [sig('s1'), sig('s2'), sig('s3'), sig('s4'), sig('s5')], state: 'decision-pending', isLoading: false, ready: true }
    renderBand()
    // top 3 shown, 2 hidden
    expect(screen.getByText('Signal s1')).toBeInTheDocument()
    expect(screen.queryByText('Signal s4')).not.toBeInTheDocument()
    expect(screen.getByTestId('attention-expand')).toHaveTextContent('2 more')
    await userEvent.click(screen.getByTestId('attention-expand'))
    expect(screen.getByText('Signal s4')).toBeInTheDocument()
    expect(screen.getByTestId('attention-expand')).toHaveTextContent('Show fewer')
  })

  it('routes a clicked signal with its precise destination and focus', async () => {
    const focus = { kind: 'research-section', anchor: 'thesis' }
    hook.value = { signals: [sig('s1', { destination: 'research', focus })], state: 'position-monitored', isLoading: false, ready: true }
    const onFocus = renderBand()
    await userEvent.click(screen.getByText('Signal s1'))
    expect(onFocus).toHaveBeenCalledWith('research', focus)
  })
})

describe('AssetAttentionBand — collapsible (compact pill)', () => {
  function renderCollapsible(onFocus = vi.fn()) {
    render(<AssetAttentionBand assetId="a1" symbol="LLY" coveringUserIds={[]} onFocus={onFocus} collapsible />)
    return onFocus
  }

  it('starts as a one-line pill naming the count and the top signal, band hidden', () => {
    hook.value = { signals: [sig('s1'), sig('s2')], state: 'decision-pending', isLoading: false, ready: true }
    renderCollapsible()
    expect(screen.getByTestId('attention-pill')).toHaveTextContent('2 need attention')
    expect(screen.getByTestId('attention-pill')).toHaveTextContent('Signal s1') // resolver's top item
    expect(screen.queryByTestId('asset-attention-band')).not.toBeInTheDocument()
  })

  it('expands to the full band and still routes a signal with its precise focus', async () => {
    const focus = { kind: 'research-section', anchor: 'thesis' }
    hook.value = { signals: [sig('s1', { destination: 'research', focus })], state: 'position-monitored', isLoading: false, ready: true }
    const onFocus = renderCollapsible()
    await userEvent.click(screen.getByTestId('attention-pill'))
    expect(screen.getByTestId('asset-attention-band')).toBeInTheDocument()
    await userEvent.click(screen.getByText('Signal s1'))
    expect(onFocus).toHaveBeenCalledWith('research', focus) // deep-link unchanged
  })

  it('collapses back to the pill on Hide', async () => {
    hook.value = { signals: [sig('s1')], state: 'decision-pending', isLoading: false, ready: true }
    renderCollapsible()
    await userEvent.click(screen.getByTestId('attention-pill'))
    expect(screen.getByTestId('asset-attention-band')).toBeInTheDocument()
    await userEvent.click(screen.getByTestId('attention-collapse'))
    expect(screen.getByTestId('attention-pill')).toBeInTheDocument()
    expect(screen.queryByTestId('asset-attention-band')).not.toBeInTheDocument()
  })
})
