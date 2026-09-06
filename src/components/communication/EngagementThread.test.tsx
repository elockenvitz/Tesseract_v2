/**
 * Focused tests for the pane's context binding.
 *
 * Covers the exit criteria that are about what the USER sees: the object and
 * the triggering issue are present without anyone re-typing them, and the
 * thread is bound to the right `messages` pair.
 *
 * `IdeaComments` is mocked because it is existing, already-shipping messaging
 * code — the point of this stage is that it was reused unchanged, so exercising
 * its Supabase queries here would test the wrong thing.
 */

import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import type { EngagementTarget } from '../../lib/engagement'

vi.mock('../ideas/social/IdeaComments', () => ({
  IdeaComments: ({ itemType, itemId }: { itemType: string; itemId: string }) => (
    <div data-testid="thread" data-context-type={itemType} data-context-id={itemId} />
  ),
}))

const { EngagementThread } = await import('./EngagementThread')
const { EngagementContextHeader } = await import('./EngagementContextHeader')

const AMZN: EngagementTarget = {
  objectType: 'asset',
  objectId: 'asset-amzn',
  label: 'AMZN — Amazon.com',
  symbol: 'AMZN',
  portfolioName: 'Growth Composite',
  issue: {
    title: 'Framework broken',
    detail: 'Spot cleared the bull case on 24 August and has held above it.',
    reason: 'thesisStale',
  },
}

describe('EngagementContextHeader', () => {
  it('shows the bound object and the issue that prompted it', () => {
    render(<EngagementContextHeader target={AMZN} mode="ai" />)
    // The symbol appears twice by design — once as the object's identity and
    // once as a supplied-context chip — so this asserts on both rather than
    // pretending one of them is the only one.
    expect(screen.getAllByText('AMZN')).toHaveLength(2)
    expect(screen.getByText('AMZN — Amazon.com')).toBeInTheDocument()
    expect(screen.getByText('Framework broken')).toBeInTheDocument()
    expect(screen.getByText(/Spot cleared the bull case/)).toBeInTheDocument()
  })

  it('names the context it supplied, so the binding is visible not claimed', () => {
    render(<EngagementContextHeader target={AMZN} mode="ai" />)
    expect(screen.getByText(/Context already supplied to the model/)).toBeInTheDocument()
    expect(screen.getByText('Growth Composite')).toBeInTheDocument()
    expect(screen.getByText('thesisStale')).toBeInTheDocument()
  })

  it('says where the context went, per mode', () => {
    const { rerender } = render(<EngagementContextHeader target={AMZN} mode="discuss" />)
    expect(screen.getByText(/supplied to the thread/)).toBeInTheDocument()
    rerender(<EngagementContextHeader target={AMZN} mode="ai" />)
    expect(screen.getByText(/supplied to the model/)).toBeInTheDocument()
  })

  it('renders an object with no issue without inventing one', () => {
    render(<EngagementContextHeader
      target={{ objectType: 'asset', objectId: 'a', label: 'AMZN', symbol: 'AMZN' }}
      mode="ai"
    />)
    expect(screen.queryByText('Framework broken')).not.toBeInTheDocument()
  })
})

describe('EngagementThread', () => {
  it('binds the thread to the target object, not to the active tab', () => {
    render(<EngagementThread target={AMZN} />)
    const thread = screen.getByTestId('thread')
    expect(thread).toHaveAttribute('data-context-type', 'asset')
    expect(thread).toHaveAttribute('data-context-id', 'asset-amzn')
  })

  it('carries the triggering issue in, so the thread is not context-free', () => {
    render(<EngagementThread target={AMZN} />)
    expect(screen.getByText('Framework broken')).toBeInTheDocument()
    expect(screen.getByText(/attached to AMZN — Amazon.com/)).toBeInTheDocument()
  })

  it('binds a trade idea to its own thread rather than to its asset', () => {
    render(<EngagementThread target={{
      objectType: 'trade_idea', objectId: 'ti-77', label: 'Add AMZN', assetId: 'asset-amzn',
    }} />)
    const thread = screen.getByTestId('thread')
    expect(thread).toHaveAttribute('data-context-type', 'trade_idea')
    expect(thread).toHaveAttribute('data-context-id', 'ti-77')
  })

  it('explains itself instead of opening a thread it cannot store', () => {
    render(<EngagementThread target={{
      objectType: 'research_note', objectId: 'n-1', label: 'Terminal multiple framework',
      assetId: 'asset-amzn',
    }} />)
    expect(screen.queryByTestId('thread')).not.toBeInTheDocument()
    expect(screen.getByText(/Discussion isn't available for this object yet/)).toBeInTheDocument()
    // and it still shows what it bound, rather than looking broken
    expect(screen.getByTestId('engagement-context-header')).toBeInTheDocument()
  })

  it('handles no target without throwing', () => {
    render(<EngagementThread target={null} />)
    expect(screen.getByText('No object selected')).toBeInTheDocument()
  })
})
