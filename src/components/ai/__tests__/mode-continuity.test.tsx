/**
 * Switching between compact and research must not cost the reader the
 * investigation.
 *
 * ── Why this test is worth its mocks ─────────────────────────────────────
 *
 * The mode changes the pane's layout classes, and the obvious way to write
 * that is a branch that returns a different tree per mode — the pane already
 * has one of those for the conversation list, which unmounts the chat on
 * purpose. Do the same for the mode and the thread is remounted on every
 * expand: the messages come back from the hook, so the bug does not look like
 * data loss, but the composer draft, the scroll position and any open evidence
 * rail are gone. That is invisible to an assertion on text.
 *
 * So this asserts NODE IDENTITY across the flip. If React remounted the
 * subtree, the DOM node holding the reply is a different object, and no amount
 * of identical text can hide it.
 *
 * `useAI` and `useAIConfig` are mocked because both build a Supabase client at
 * import time. The mock holds the conversation, which is the point: the
 * component must preserve what the hook already had.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { AiRenderableMessage } from '../../../lib/ai/presentation'
/* The composer names what you are talking to, so the placeholder is branding
   and lives in one place. Asserting the literal here is how this test broke
   when the assistant was renamed to ACT AI. */
import { ACT_AI_PLACEHOLDER } from '../../../lib/ai/brand'

const messages: AiRenderableMessage[] = [
  {
    id: 'm1', role: 'user', content: 'What has the team decided about AAPL?',
    timestamp: new Date('2026-11-11T12:00:00Z'),
  },
  {
    id: 'm2', role: 'assistant',
    content: 'The PM ruling is pending.',
    timestamp: new Date('2026-11-11T12:00:03Z'),
    model: 'claude-sonnet-4-6',
    tool_calls: [{
      name: 'get_decisions', input: { symbol: 'AAPL' }, status: 'ok', result_count: 1,
      sources: [{
        kind: 'decision_request', id: 'd1', asset_id: 'a1', symbol: 'AAPL',
        title: 'AAPL PM ruling: pending', timestamp: '2026-10-02T00:00:00Z',
      }],
    }],
  },
]

const sendMessage = vi.fn()
const selectConversation = vi.fn()

/*
 * The pane gained a second data hook when conversations gained folders.
 *
 * Still stubbed rather than left to the provider below: `useAIFolders` reads
 * the org from a membership query, and folders are not the subject here --
 * the rail has its own suite. The provider exists for the hooks this suite
 * does NOT name, so growing a third data path does not break it.
 */
/*
 * The dot menu reads the reader's own templates, and `useTemplates` resolves
 * its org through `useOrganization`, which THROWS outside its provider rather
 * than returning null. Production always has one (`App.tsx` wraps the routes),
 * so this is the harness catching up with the tree, not a guard against a
 * real configuration. Stubbed rather than provided for the reason above: the
 * templates are not the subject here.
 */
vi.mock('../../../hooks/useTemplates', () => ({
  useTemplates: () => ({ templates: [], getByShortcut: () => undefined }),
}))

/* Mocked for the same reason `useAIFolders` is: it reads the session, and
   this suite's supabase stub has no `auth`. Off, which is its real state in
   every environment today -- the artifacts table is not applied. */
vi.mock('../../../hooks/ai/useAiArtifacts', () => ({
  useAiArtifacts: () => ({
    available: false, artifacts: [], isLoading: false, organizationId: null,
    keep: async () => null, rename: async () => undefined, remove: async () => undefined,
    lastError: null,
  }),
}))

vi.mock('../../../hooks/ai/useAIFolders', () => ({
  useAIFolders: () => ({
    folders: [],
    archivedFolders: [],
    isLoading: false,
    organizationId: null,
    canManage: false,
    createFolder: async () => null,
    renameFolder: async () => undefined,
    setFolderArchived: async () => undefined,
    deleteFolder: async () => undefined,
    lastError: null,
  }),
}))

vi.mock('../../../hooks/useAI', () => ({
  useAI: () => ({
    messages,
    tags: [{ type: 'asset', id: 'a1' }],
    tagLabels: { 'asset:a1': 'AAPL' },
    isConfigured: true,
    configMode: 'byok',
    conversationId: 'c1',
    sendMessage,
    clearConversation: vi.fn(),
    isLoading: false,
    error: null,
    status: null,
    cancelGeneration: vi.fn(),
    conversations: [{ id: 'c1', title: 'AAPL decisions', updated_at: '2026-11-11T12:00:03Z', tags: [] }],
    isLoadingList: false,
    selectConversation,
    newConversation: vi.fn(),
    setTags: vi.fn(),
    renameConversation: vi.fn(),
    archiveConversation: vi.fn(),
    togglePin: vi.fn(),
    deleteConversation: vi.fn(),
  }),
  /* Stubbed, not reimplemented: with a thread loaded the prompts are not
     rendered at all, and their content is tested against the pure function in
     `lib/ai/__tests__/suggested-prompts.test.ts`. */
  useAISuggestions: () => ['Analyze AAPL for blind spots'],
}))

/*
 * The grounded-prompt facts. This suite is about mode continuity and has no
 * opinion about the suggestions, so the facts are empty and settled: the pane
 * then falls through to the fallback questions, and nothing here is held
 * waiting on a query that will never resolve.
 */
vi.mock('../../../hooks/ai/useGroundedPrompts', () => ({
  useGroundedPromptFacts: () => ({ data: undefined, isLoading: false, isSettling: false }),
  groundedPromptsKey: (id: string | null, orgId?: string | null) =>
    ['ai-grounded-prompt-facts', id, orgId ?? null],
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

import { AISection } from '../../communication/AISection'

const subject = { type: 'asset', id: 'a1', label: 'AAPL - Apple Inc.' }

/*
 * A real query client, not another stub.
 *
 * The pane reaches react-query through more hooks every time it grows one --
 * the conversation list, the folders, and now the attach control's entity
 * search. Stubbing each new one in turn is how this suite kept failing for a
 * reason that had nothing to do with mode continuity. Nothing here hits the
 * network: the hooks that matter are mocked, and the attach search is
 * disabled until someone types two characters.
 *
 * Every render AND rerender goes through `wrap`, with the same provider
 * element in the same position, so the node-identity assertion below still
 * measures the pane rather than the wrapper.
 */
const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })
const wrap = (node: ReactNode) => <QueryClientProvider client={client}>{node}</QueryClientProvider>

function renderPane(mode: 'compact' | 'research') {
  return render(wrap(
    <AISection
      isOpen
      onToggle={() => {}}
      isFullscreen={mode === 'research'}
      onToggleFullscreen={() => {}}
      mode={mode}
      onToggleMode={() => {}}
      currentSubject={subject}
    />,
  ))
}

beforeEach(() => {
  sendMessage.mockClear()
  selectConversation.mockClear()
  /* jsdom has no layout, so it has no `scrollIntoView`. The pane calls it on
     every message change; without this the first effect throws and every
     assertion below fails for the wrong reason. */
  HTMLElement.prototype.scrollIntoView = vi.fn()
})

describe('compact ↔ research', () => {
  it('keeps the very same message nodes across the flip', () => {
    const view = renderPane('compact')
    const before = screen.getByText('The PM ruling is pending.')

    view.rerender(wrap(
      <AISection
        isOpen onToggle={() => {}} isFullscreen onToggleFullscreen={() => {}}
        mode="research" onToggleMode={() => {}} currentSubject={subject}
      />,
    ))

    const after = screen.getByText('The PM ruling is pending.')
    /* Identity, not equality: a remount returns the same words in a new node
       and would take the draft, the scroll and the open rail with it. */
    expect(after).toBe(before)
  })

  it('keeps an unsent draft across the flip', async () => {
    const user = userEvent.setup()
    const view = renderPane('compact')
    await user.type(screen.getByPlaceholderText(ACT_AI_PLACEHOLDER), 'and what about the risks')

    view.rerender(wrap(
      <AISection
        isOpen onToggle={() => {}} isFullscreen onToggleFullscreen={() => {}}
        mode="research" onToggleMode={() => {}} currentSubject={subject}
      />,
    ))

    expect((screen.getByPlaceholderText(ACT_AI_PLACEHOLDER) as HTMLTextAreaElement).value)
      .toBe('and what about the risks')
    expect(sendMessage).not.toHaveBeenCalled()
  })

  it('does not re-select or reload the conversation on a mode change', () => {
    const view = renderPane('compact')
    view.rerender(wrap(
      <AISection
        isOpen onToggle={() => {}} isFullscreen onToggleFullscreen={() => {}}
        mode="research" onToggleMode={() => {}} currentSubject={subject}
      />,
    ))
    expect(selectConversation).not.toHaveBeenCalled()
  })

  it('names the active asset in both modes', () => {
    const compact = renderPane('compact')
    expect(compact.getByTestId('ai-context-chips').textContent).toContain('AAPL')
    compact.unmount()

    const research = renderPane('research')
    expect(research.getByTestId('ai-context-chips').textContent).toContain('AAPL')
  })

  it('offers the source as a live link in both modes', async () => {
    const user = userEvent.setup()
    /* Compact folds the rail away, so the trail has to be opened first;
       research opens it. Either way the SAME SourceRef is the thing that
       navigates — there is one trail component, not one per mode. */
    const research = renderPane('research')
    expect(research.getByTitle('Open AAPL PM ruling: pending')).toBeTruthy()
    research.unmount()

    const compact = renderPane('compact')
    expect(compact.queryByTitle('Open AAPL PM ruling: pending')).toBeNull()
    /* "Show sources", not "Show research": one evidence section now, led by
       the records rather than by the lookups that found them. */
    await user.click(compact.getByTitle('Show sources'))
    expect(compact.getByTitle('Open AAPL PM ruling: pending')).toBeTruthy()
  })

  it('shows the conversation list beside the thread only in research mode', () => {
    const research = renderPane('research')
    expect(research.getByText('AAPL decisions')).toBeTruthy()
    expect(research.getByText('The PM ruling is pending.')).toBeTruthy()
    research.unmount()

    const compact = renderPane('compact')
    expect(compact.queryByText('AAPL decisions')).toBeNull()
  })

  it('switches mode through the pane callback rather than its own state', async () => {
    const user = userEvent.setup()
    const onToggleMode = vi.fn()
    render(wrap(
      <AISection
        isOpen onToggle={() => {}} isFullscreen={false} onToggleFullscreen={() => {}}
        mode="compact" onToggleMode={onToggleMode} currentSubject={subject}
      />,
    ))
    await user.click(screen.getByTestId('ai-mode-toggle'))
    expect(onToggleMode).toHaveBeenCalledTimes(1)
    /* Still compact: the pane owns the width, so the mode cannot change
       without the parent. One source of truth. */
    expect(screen.getByTestId('ai-mode-toggle').getAttribute('aria-pressed')).toBe('false')
  })

  it('offers no mode control where there is nothing to switch to', () => {
    render(wrap(
      <AISection
        isOpen onToggle={() => {}} isFullscreen={false} onToggleFullscreen={() => {}}
        mode="compact" currentSubject={subject}
      />,
    ))
    expect(screen.queryByTestId('ai-mode-toggle')).toBeNull()
  })
})
