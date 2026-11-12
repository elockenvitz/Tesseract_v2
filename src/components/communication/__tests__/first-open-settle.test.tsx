/**
 * The pane must not offer questions before it knows whether it has a thread.
 *
 * `restore-gate.test.ts` proves the condition. This proves the pane obeys it:
 * the gate could be computed perfectly and the component could still paint the
 * empty state next to it, which is exactly the shape the bug had before the
 * gate existed.
 *
 * `useAI` and `useAIConfig` are mocked because both construct a Supabase
 * client at import time. The mock is mutable so one render can be stepped
 * through the arrival sequence a real open goes through.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import type { AiRenderableMessage } from '../../../lib/ai/presentation'

/** What the hook would be returning at this moment. Mutated per frame. */
const hook: {
  messages: AiRenderableMessage[]
  isRestoringConversation: boolean
  conversationId: string | null
  /** Whether the grounded-prompt facts are still in flight. */
  isLoadingPromptFacts: boolean
} = {
  messages: [],
  isRestoringConversation: true,
  conversationId: null,
  isLoadingPromptFacts: false,
}

vi.mock('../../../hooks/useAI', () => ({
  useAI: () => ({
    messages: hook.messages,
    tags: [{ type: 'asset', id: 'a1' }],
    tagLabels: { 'asset:a1': 'AAPL' },
    isConfigured: true,
    configMode: 'byok',
    conversationId: hook.conversationId,
    isRestoringConversation: hook.isRestoringConversation,
    sendMessage: vi.fn(),
    clearConversation: vi.fn(),
    isLoading: false,
    error: null,
    status: null,
    cancelGeneration: vi.fn(),
    conversations: [],
    isLoadingList: false,
    selectConversation: vi.fn(),
    newConversation: vi.fn(),
    setTags: vi.fn(),
    renameConversation: vi.fn(),
    archiveConversation: vi.fn(),
    togglePin: vi.fn(),
    deleteConversation: vi.fn(),
  }),
  useAISuggestions: () => [
    'What has the team decided about AAPL, and what evidence supports it?',
  ],
}))

/*
 * The grounded-prompt facts. Mocked for the same reason as `useAI` -- the
 * hook opens a react-query against the browser's Supabase client -- and
 * steppable, because its `isLoading` is now part of the settle gate: the
 * questions must not paint ungrounded and then re-rank once the counts land.
 */
vi.mock('../../../hooks/ai/useGroundedPrompts', () => ({
  useGroundedPromptFacts: () => ({
    data: hook.isLoadingPromptFacts
      ? undefined
      : {
          pendingDecisions: { count: 4, longestWaitingDays: 9, yoursToAnswer: 2 },
          pipeline: { readyToRecommend: 0, stalled: null, liveTotal: 3 },
          work: { overdueRequirements: 0, openRequirements: 0, busiestSymbol: null },
          lists: { flaggedCount: 0, flaggedListName: null },
          coverage: { assetCount: 12 },
          recentDecisions: { count: 0, windowDays: 14 },
        },
    isLoading: hook.isLoadingPromptFacts,
  }),
  groundedPromptsKey: (id: string | null) => ['ai-grounded-prompt-facts', id],
}))

vi.mock('../../../hooks/useAIConfig', () => ({
  useAIConfig: () => ({
    effectiveConfig: { provider: 'anthropic', model: 'claude-sonnet-4-6', isConfigured: true, mode: 'byok' },
    updateUserPrefs: vi.fn(),
  }),
  AI_PROVIDERS: [{ id: 'anthropic', name: 'Anthropic', color: 'from-orange-400 to-orange-600' }],
  AI_MODELS: {
    anthropic: [{ id: 'claude-sonnet-4-6', name: 'Claude Sonnet 4.6', description: 'Balanced', recommended: true }],
  },
}))

import { AISection } from '../AISection'

const restored: AiRenderableMessage[] = [
  {
    id: 'm1', role: 'user', content: 'Where did we land on AAPL?',
    timestamp: new Date('2026-11-11T12:00:00Z'),
  },
  {
    id: 'm2', role: 'assistant', content: 'The PM ruling is still pending.',
    timestamp: new Date('2026-11-11T12:00:04Z'), model: 'claude-sonnet-4-6',
  },
]

function renderPane() {
  return render(
    <AISection
      isOpen
      onToggle={() => {}}
      isFullscreen={false}
      onToggleFullscreen={() => {}}
      mode="compact"
      onToggleMode={() => {}}
      initialTags={[{ type: 'asset', id: 'a1' }]}
      currentSubject={{ type: 'asset', id: 'a1', label: 'AAPL' }}
    />,
  )
}

beforeEach(() => {
  hook.messages = []
  hook.isRestoringConversation = true
  hook.conversationId = null
  hook.isLoadingPromptFacts = false
  /* jsdom has no layout, so no `scrollIntoView`. The pane calls it whenever
     the message list changes. */
  HTMLElement.prototype.scrollIntoView = vi.fn()
})

describe('first open', () => {
  it('offers no questions while the lookup is unfinished', () => {
    renderPane()
    expect(screen.queryByTestId('ai-prompts')).toBeNull()
    expect(screen.getByTestId('ai-thread-settling')).toBeTruthy()
  })

  it('still paints its chrome, so the pane does not read as broken', () => {
    /* The held frame is the THREAD only. The header, the context row and the
       composer are known from the first frame and should be there: an empty
       pane with no furniture looks like a failure to open. */
    renderPane()
    expect(screen.getByTestId('ai-context-chips')).toBeTruthy()
    expect(screen.getByTestId('ai-mode-toggle')).toBeTruthy()
    expect(screen.getByPlaceholderText('Ask ACT AI…')).toBeTruthy()
  })

  it('offers the questions once the lookup finished and found nothing', () => {
    hook.isRestoringConversation = false
    renderPane()
    expect(screen.getByTestId('ai-prompts')).toBeTruthy()
    expect(screen.queryByTestId('ai-thread-settling')).toBeNull()
  })

  it('goes from held straight to the restored thread, never through the prompts', () => {
    const { rerender } = renderPane()
    expect(screen.queryByTestId('ai-prompts')).toBeNull()

    /* The transcript lands. This is the frame that used to replace a screenful
       of suggested questions the reader had already started reading. */
    hook.messages = restored
    hook.conversationId = 'c1'
    hook.isRestoringConversation = false
    rerender(
      <AISection
        isOpen
        onToggle={() => {}}
        isFullscreen={false}
        onToggleFullscreen={() => {}}
        mode="compact"
        onToggleMode={() => {}}
        initialTags={[{ type: 'asset', id: 'a1' }]}
        currentSubject={{ type: 'asset', id: 'a1', label: 'AAPL' }}
      />,
    )

    expect(screen.getByText('The PM ruling is still pending.')).toBeTruthy()
    expect(screen.queryByTestId('ai-prompts')).toBeNull()
    expect(screen.queryByTestId('ai-thread-settling')).toBeNull()
  })

  it('offers no questions while the facts behind them are still in flight', () => {
    /* The second half of the same rule. Painting the generic fallbacks here
       and swapping them for grounded ones a moment later is the flicker the
       gate removes, just with a different source. */
    hook.isRestoringConversation = false
    hook.isLoadingPromptFacts = true
    renderPane()
    expect(screen.queryByTestId('ai-prompts')).toBeNull()
    expect(screen.getByTestId('ai-thread-settling')).toBeTruthy()
  })

  it('paints the questions already grounded in the reader s open work', () => {
    hook.isRestoringConversation = false
    renderPane()
    expect(screen.getByTestId('ai-prompts')).toBeTruthy()
    /* From the mocked facts: 4 open, 2 of them this reader's to answer. The
       numbers are the whole claim, so they are what is asserted. */
    expect(screen.getByText('2 recommendations are awaiting your ruling')).toBeTruthy()
    expect(screen.getByText('4 in your decision inbox, the longest for 9 days')).toBeTruthy()
    /* And nothing the records do not support. */
    expect(screen.queryByText(/overdue/i)).toBeNull()
  })

  it('names ACT AI rather than the old assistant name', () => {
    hook.isRestoringConversation = false
    renderPane()
    expect(screen.queryByText(/Co-?Analyst/i)).toBeNull()
  })
})
