/**
 * The pane shows ONE active context, and the controls on it are real.
 *
 * `active-context.test.ts` proves the model. This proves the pane obeys it,
 * which is a separate claim and the one that was false: the model could be
 * perfect and the component could still render a second band beside it from
 * the engagement target, which is exactly the shape the defect had.
 *
 * Four things are asserted, each a sentence from the brief:
 *
 *   - there is one context row, not two competing ones
 *   - removing is wired to the thing that changes the request
 *   - clearing is wired to the thing that deletes the rows
 *   - opening from an asset with nothing wrong leaves the composer empty
 *
 * `useAI` and `useAIConfig` are mocked because both construct a Supabase
 * client at import time; the mock is mutable so one suite can render the
 * states a reader actually walks through.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, fireEvent } from '@testing-library/react'
import type { EngagementTarget } from '../../../lib/engagement'

type Tag = { type: string; id: string; label?: string }

const hook: {
  tags: Tag[]
  removeTag: ReturnType<typeof vi.fn>
  clearContext: ReturnType<typeof vi.fn>
  /** Whether the tagged object resolves, which is what makes a chip a link. */
  resolved: boolean
} = { tags: [], removeTag: vi.fn(), clearContext: vi.fn(), resolved: false }

vi.mock('../../../hooks/useTemplates', () => ({
  useTemplates: () => ({ templates: [], getByShortcut: () => undefined }),
}))

vi.mock('../../../hooks/ai/useAiArtifacts', () => ({
  useAiArtifacts: () => ({
    available: false, artifacts: [], isLoading: false, organizationId: null,
    keep: async () => null, rename: async () => undefined, remove: async () => undefined,
    lastError: null,
  }),
}))

vi.mock('../../../hooks/ai/useAIFolders', () => ({
  useAIFolders: () => ({
    folders: [], archivedFolders: [], isLoading: false, organizationId: null,
    canManage: false, createFolder: async () => null, renameFolder: async () => undefined,
    setFolderArchived: async () => undefined, deleteFolder: async () => undefined,
    lastError: null,
  }),
}))

/*
 * The reference resolver reads each tagged object through the caller's RLS.
 *
 * Steppable, because a chip is a LINK only for a reference that resolved, and
 * the follow-a-reference cases below need a real link to press. Unresolved by
 * default so the context cases are not quietly asserting against a button.
 */
vi.mock('../../../hooks/ai/useReferenceTargets', () => ({
  useReferenceTargets: () => ({
    targets: hook.resolved
      ? new Map([['asset:a1', {
          type: 'asset', id: 'a1', label: 'CEG', symbol: 'CEG', companyName: null,
        }]])
      : new Map(),
    isLoading: false,
  }),
}))

vi.mock('../../../hooks/useAI', () => ({
  useAI: () => ({
    messages: [],
    tags: hook.tags,
    tagLabels: { 'asset:a1': 'CEG', 'portfolio:p1': 'Growth Composite' },
    isConfigured: true,
    isConfigResolving: false,
    configMode: 'byok',
    conversationId: 'c1',
    isRestoringConversation: false,
    contextManifest: [],
    sendMessage: vi.fn(),
    clearConversation: vi.fn(),
    isLoading: false,
    error: null,
    status: null,
    cancelGeneration: vi.fn(),
    conversations: [{ id: 'c1', title: 'CEG valuation' }],
    isLoadingList: false,
    selectConversation: vi.fn(),
    newConversation: vi.fn(),
    setTags: vi.fn(),
    addTag: vi.fn(),
    removeTag: hook.removeTag,
    clearContext: hook.clearContext,
    renameConversation: vi.fn(),
    archiveConversation: vi.fn(),
    togglePin: vi.fn(),
    deleteConversation: vi.fn(),
    moveConversationToFolder: vi.fn(),
    loadArchived: async () => [],
    unarchiveConversation: vi.fn(),
  }),
  useAISuggestions: () => ['What has changed on CEG?'],
}))

vi.mock('../../../hooks/ai/useGroundedPrompts', () => ({
  useGroundedPromptFacts: () => ({ data: {}, isLoading: false, isSettling: false }),
  groundedPromptsKey: (id: string | null) => ['ai-grounded-prompt-facts', id],
}))

vi.mock('../../../hooks/useAIConfig', () => ({
  useAIConfig: () => ({
    effectiveConfig: { provider: 'anthropic', model: 'm', isConfigured: true, mode: 'byok' },
    updateUserPrefs: vi.fn(),
  }),
  AI_PROVIDERS: [{ id: 'anthropic', name: 'Anthropic', color: 'from-orange-400 to-orange-600' }],
  AI_MODELS: { anthropic: [{ id: 'm', name: 'Model', description: 'd' }] },
}))

import { AISection } from '../AISection'

const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })
const wrap = (node: ReactNode) => <QueryClientProvider client={client}>{node}</QueryClientProvider>

/** The CEG tile's engagement: a real event, with a question about it. */
const BREACH: EngagementTarget = {
  objectType: 'asset',
  objectId: 'a1',
  label: 'CEG',
  symbol: 'CEG',
  issue: {
    title: 'CEG is trading below every case you modelled',
    detail: 'Spot cleared the bear case on 24 August.',
    reason: 'valuationBreach',
  },
  seedPrompt: 'Which assumptions would need to change here?',
}

/** "Ask ACT AI" from the workspace: a seed, but no event. */
const PLAIN_ASK: EngagementTarget = {
  objectType: 'asset',
  objectId: 'a1',
  label: 'CEG',
  symbol: 'CEG',
  origin: { surface: 'asset-workspace-actions' },
  seedPrompt: 'What is our current view of CEG, and what has changed since the case was written?',
}

function renderPane(target: EngagementTarget | null) {
  return render(wrap(
    <AISection
      isOpen
      onToggle={() => {}}
      isFullscreen={false}
      onToggleFullscreen={() => {}}
      mode="compact"
      onToggleMode={() => {}}
      initialTags={[{ type: 'asset', id: 'a1' }]}
      currentSubject={{ type: 'asset', id: 'a1', label: 'CEG' }}
      engagementTarget={target}
    />,
  ))
}

beforeEach(() => {
  hook.tags = [{ type: 'asset', id: 'a1', label: 'CEG' }]
  hook.removeTag = vi.fn()
  hook.clearContext = vi.fn()
  hook.resolved = false
  HTMLElement.prototype.scrollIntoView = vi.fn()
})

describe('there is one context row', () => {
  it('renders the writing row and no second display beside it', () => {
    renderPane(BREACH)

    expect(screen.getByTestId('ai-context-attach')).toBeTruthy()
    /* The two bands that used to draw context from inputs the request does
       not read. Their test ids are asserted absent by name, because a
       reinstated import is how the second list comes back. */
    expect(screen.queryByTestId('ai-context-chips')).toBeNull()
    expect(screen.queryByTestId('engagement-context-header')).toBeNull()
  })

  it('never claims to list what was already supplied to the model', () => {
    renderPane(BREACH)

    /*
     * The heading `EngagementContextHeader` drew over its chips. It was a
     * claim about the request built from something the request ignores, and
     * it is the sentence a reader trusted while detaching the object it
     * named.
     */
    expect(screen.queryByText(/already supplied/i)).toBeNull()
  })

  it('does not render the producer key the chip row showed as a value', () => {
    renderPane(BREACH)

    expect(screen.queryByText(/valuationBreach/)).toBeNull()
    expect(screen.queryByText(/Raised by/i)).toBeNull()
  })

  it('names the asset exactly once', () => {
    /* `symbol` and `label` are both "CEG" for an asset with no company name,
       and the old header printed both, adjacent. */
    renderPane(BREACH)

    expect(screen.getAllByText('CEG')).toHaveLength(1)
  })
})

describe('the controls change the request, not just the row', () => {
  it('detaches through the handler that deletes the tag row', () => {
    renderPane(BREACH)

    fireEvent.click(screen.getByLabelText('Remove CEG from this conversation'))

    expect(hook.removeTag).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'asset', id: 'a1' }),
    )
  })

  it('offers Clear all once there is more than one object, and wires it', () => {
    hook.tags = [
      { type: 'asset', id: 'a1', label: 'CEG' },
      { type: 'portfolio', id: 'p1', label: 'Growth Composite' },
    ]
    renderPane(BREACH)

    fireEvent.click(screen.getByTestId('ai-context-clear-all'))

    expect(hook.clearContext).toHaveBeenCalled()
  })

  it('does not offer Clear all for a single chip, whose own X is already that', () => {
    renderPane(BREACH)

    expect(screen.queryByTestId('ai-context-clear-all')).toBeNull()
  })

  it('summarises what the next message carries, for a reader who cannot see chips', () => {
    renderPane(BREACH)

    expect(screen.getByTestId('ai-context-summary').textContent)
      .toBe('ACT AI can use CEG.')
  })
})

describe('why the reader is here, said once and dismissible', () => {
  it('shows the surface words', () => {
    renderPane(BREACH)

    expect(screen.getByTestId('ai-entry-orientation')).toBeTruthy()
    expect(screen.getByText('CEG is trading below every case you modelled')).toBeTruthy()
    expect(screen.getByText('Spot cleared the bear case on 24 August.')).toBeTruthy()
  })

  it('closes, and closing detaches nothing', () => {
    renderPane(BREACH)

    fireEvent.click(screen.getByTestId('ai-orientation-dismiss'))

    expect(screen.queryByTestId('ai-entry-orientation')).toBeNull()
    expect(screen.getByTestId('ai-context-attach')).toBeTruthy()
    expect(hook.removeTag).not.toHaveBeenCalled()
    expect(hook.clearContext).not.toHaveBeenCalled()
  })
})

describe('following a reference gets out of the way', () => {
  /*
   * The transition, which is the half that did not work.
   *
   * Pressing a reference in expanded research mode navigated the page
   * underneath and left expanded ACT AI over the top of it, so the reader saw
   * nothing change and had to close the pane by hand to see where they had
   * been sent. It is a mode change rather than a close, so the conversation
   * and an unsent draft survive -- `mode-continuity.test.tsx` pins that part.
   */
  function renderWithMode(mode: 'compact' | 'research', toggle: () => void) {
    return render(wrap(
      <AISection
        isOpen
        onToggle={() => {}}
        isFullscreen={mode === 'research'}
        onToggleFullscreen={() => {}}
        mode={mode}
        onToggleMode={toggle}
        initialTags={[{ type: 'asset', id: 'a1' }]}
        currentSubject={{ type: 'asset', id: 'a1', label: 'CEG' }}
        engagementTarget={null}
      />,
    ))
  }

  /** The chip, as a followable link. Resolved, so it renders as a button. */
  const followChip = () => screen.getByTestId('ai-context-attach')
    .querySelector<HTMLElement>('[data-slot="ai-context-open"]')!

  it('steps out of research mode when a reference is followed', () => {
    const toggle = vi.fn()
    hook.resolved = true
    renderWithMode('research', toggle)

    const link = followChip()
    expect(link, 'the chip did not render as a link, so nothing was followed').toBeTruthy()
    fireEvent.click(link)

    expect(toggle).toHaveBeenCalledTimes(1)
  })

  it('renames the toggle so the way back is findable', () => {
    /*
     * After the auto-collapse the control read "Expand", which is true and
     * useless: what the reader wants is the conversation they were in, and
     * nothing on screen said it was still open. Asserted across the mode
     * change, because that is when the word has to have changed.
     */
    const toggle = vi.fn()
    hook.resolved = true
    const view = renderWithMode('research', toggle)
    fireEvent.click(followChip())

    view.rerender(wrap(
      <AISection
        isOpen onToggle={() => {}} isFullscreen={false} onToggleFullscreen={() => {}}
        mode="compact" onToggleMode={toggle}
        initialTags={[{ type: 'asset', id: 'a1' }]}
        currentSubject={{ type: 'asset', id: 'a1', label: 'CEG' }}
      />,
    ))

    expect(screen.getByTestId('ai-mode-toggle').textContent).toContain('Back to ACT AI')
  })

  it('leaves the compact rail alone, where the destination is already visible', () => {
    /* Collapsing a 384px rail the reader can see past would be the same
       mistake in the other direction. */
    const toggle = vi.fn()
    hook.resolved = true
    renderWithMode('compact', toggle)

    fireEvent.click(followChip())

    expect(toggle).not.toHaveBeenCalled()
    expect(screen.getByTestId('ai-mode-toggle').textContent).toContain('Expand')
  })

  it('does not change what is attached by navigating', () => {
    /* Part VII's last line: navigation and active context are separate
       operations, so following a reference must not attach or detach. */
    const toggle = vi.fn()
    hook.resolved = true
    renderWithMode('research', toggle)

    fireEvent.click(followChip())

    expect(hook.clearContext).not.toHaveBeenCalled()
    expect(hook.removeTag).not.toHaveBeenCalled()
  })
})

describe('opening ACT AI is not asking a question', () => {
  it('leaves the composer empty when nothing raised this', () => {
    /*
     * Part III A. `PLAIN_ASK` is what the workspace's "Ask ACT AI" button
     * sends: a seed prompt and no issue. The reader pressed a button that
     * promised to open ACT AI, so the box is theirs.
     */
    renderPane(PLAIN_ASK)

    expect((screen.getByPlaceholderText('Ask ACT AI…') as HTMLTextAreaElement).value).toBe('')
    expect(screen.queryByTestId('ai-entry-orientation')).toBeNull()
  })

  it('offers the question when a named event raised this', () => {
    renderPane(BREACH)

    expect((screen.getByPlaceholderText('Ask ACT AI…') as HTMLTextAreaElement).value)
      .toBe('Which assumptions would need to change here?')
  })

  it('still shows the asset as context on a plain open', () => {
    /* Context without a question: the chip is there, the box is not filled. */
    renderPane(PLAIN_ASK)

    expect(screen.getByTestId('ai-context-summary').textContent).toBe('ACT AI can use CEG.')
  })
})
