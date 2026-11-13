/**
 * Following a reference, in the pane that draws it.
 *
 * ── What only this can be wrong about ─────────────────────────────────────
 *
 * Three pieces were each tested on their own and the join between them was
 * not: `reference-targets` knows the descriptors, `useReferenceTargets` knows
 * how to read the objects, and `AiContextAttach` knows how to draw three
 * states. The join is three lines in `AISection`, and three lines is exactly
 * the size of mistake that ships -- a status function that always says
 * "open", or an opener that is handed the tag instead of the resolved object
 * and silently does nothing.
 *
 * So this renders the real pane with the real resolver, fakes only the
 * database at the client boundary, and watches the shell's own tab channel.
 * A reader pressing a chip is reproduced, not described.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, cleanup, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

/** table -> rows the fake returns. Set per case. */
let rows: Record<string, Record<string, unknown>[]> = {}

vi.mock('../../../lib/supabase', () => ({
  supabase: {
    from(table: string) {
      const result = () => ({ data: rows[table] ?? [], error: null })
      const builder: Record<string, unknown> = {
        select: () => builder,
        in: () => builder,
        neq: () => builder,
        eq: () => builder,
        or: () => builder,
        order: () => builder,
        limit: () => builder,
        then: (resolve: (v: unknown) => unknown) => Promise.resolve(result()).then(resolve),
      }
      return builder
    },
  },
}))

vi.mock('../../../hooks/ai/useAIFolders', () => ({
  useAIFolders: () => ({
    folders: [], archivedFolders: [], isLoading: false, organizationId: null,
    canManage: false, createFolder: async () => null, renameFolder: async () => undefined,
    setFolderArchived: async () => undefined, deleteFolder: async () => undefined, lastError: null,
  }),
}))

/** The references on the conversation. Set per case, before render. */
let tags: { type: string; id: string }[] = []

vi.mock('../../../hooks/useAI', () => ({
  useAI: () => ({
    messages: [],
    tags,
    tagLabels: {
      'asset:a-aapl': 'AAPL',
      'portfolio:p-core': 'Core Equity',
      'theme:t-ai': 'AI infrastructure',
      'note:n-1': 'Channel checks',
    },
    isConfigured: true,
    configMode: 'byok',
    conversationId: 'c1',
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
    addTag: vi.fn(),
    removeTag: vi.fn(),
    renameConversation: vi.fn(),
    archiveConversation: vi.fn(),
    togglePin: vi.fn(),
    deleteConversation: vi.fn(),
  }),
  useAISuggestions: () => [],
}))

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

const wrap = (node: ReactNode) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })}>
    {node}
  </QueryClientProvider>
)

let opened: Record<string, unknown>[] = []
const record = (e: Event) => opened.push((e as CustomEvent).detail as Record<string, unknown>)

function renderPane() {
  render(wrap(
    <AISection
      isOpen
      onToggle={() => {}}
      isFullscreen={false}
      onToggleFullscreen={() => {}}
      mode="compact"
      onToggleMode={() => {}}
      currentSubject={null}
    />,
  ))
}

/** The chip, once the resolver has finished with it. */
const chip = async (label: string) => {
  await waitFor(() => {
    const el = [...document.querySelectorAll('[data-slot="ai-context-chip"]')]
      .find(c => c.textContent?.includes(label))
    expect(el).toBeTruthy()
    expect(el!.getAttribute('data-reference-status')).not.toBe('checking')
  })
  return [...document.querySelectorAll('[data-slot="ai-context-chip"]')]
    .find(c => c.textContent?.includes(label))!
}

const press = async (user: ReturnType<typeof userEvent.setup>, label: string) => {
  await chip(label)
  await user.click(screen.getByRole('button', { name: label }))
}

beforeEach(() => {
  rows = {}
  tags = []
  opened = []
  window.addEventListener('decision-engine-action', record)
  HTMLElement.prototype.scrollIntoView = vi.fn()
})
afterEach(() => {
  window.removeEventListener('decision-engine-action', record)
  cleanup()
})

describe('all four kinds of reference go somewhere', () => {
  it('opens the canonical asset page', async () => {
    const user = userEvent.setup()
    tags = [{ type: 'asset', id: 'a-aapl' }]
    rows.assets = [{ id: 'a-aapl', symbol: 'AAPL', company_name: 'Apple Inc.' }]
    renderPane()

    await press(user, 'AAPL')

    const tab = opened.find(t => t.type === 'asset')!
    expect(tab.id).toBe('a-aapl')
    /* From the row that was read, not from the chip's cached label: the tab
       title and the company name are fields only the resolved asset has. */
    expect(tab.title).toBe('AAPL')
    expect((tab.data as Record<string, unknown>).company_name).toBe('Apple Inc.')
    /* Stamped by `openAsset`, which is how the arrival is consumed once
       rather than replayed on every remount. */
    expect((tab.data as Record<string, unknown>).focusRequestId).toBeTruthy()
  })

  it('opens the portfolio', async () => {
    const user = userEvent.setup()
    tags = [{ type: 'portfolio', id: 'p-core' }]
    rows.portfolios = [{ id: 'p-core', name: 'Core Equity', benchmark: 'SPY' }]
    renderPane()

    await press(user, 'Core Equity')

    const tab = opened.find(t => t.type === 'portfolio')!
    expect(tab.id).toBe('p-core')
    expect(tab.data).toMatchObject({ id: 'p-core', name: 'Core Equity' })
  })

  it('opens the theme', async () => {
    const user = userEvent.setup()
    tags = [{ type: 'theme', id: 't-ai' }]
    rows.org_themes_v = [{ id: 't-ai', name: 'AI infrastructure' }]
    renderPane()

    await press(user, 'AI infrastructure')

    const tab = opened.find(t => t.type === 'theme')!
    expect(tab.id).toBe('t-ai')
    expect(tab.data).toMatchObject({ id: 't-ai', name: 'AI infrastructure' })
  })

  it('opens the note, in the tab its entity shares', async () => {
    const user = userEvent.setup()
    tags = [{ type: 'note', id: 'n-1' }]
    rows.asset_notes = [{
      id: 'n-1', title: 'Channel checks', asset_id: 'a-aapl',
      assets: { id: 'a-aapl', symbol: 'AAPL' },
    }]
    renderPane()

    await press(user, 'Channel checks')

    const tab = opened.find(t => t.type === 'note')!
    expect(tab.id).toBe('note-asset-a-aapl')
    expect((tab.data as Record<string, unknown>).id).toBe('n-1')
  })
})

describe('a reference the reader can no longer reach', () => {
  it('is not a link', async () => {
    tags = [{ type: 'portfolio', id: 'p-lost' }]
    rows.portfolios = []
    renderPane()

    const el = await chip('p-lost')
    expect(el.getAttribute('data-reference-status')).toBe('gone')
  })

  it('says so rather than disappearing, because the thread was about it', async () => {
    tags = [{ type: 'portfolio', id: 'p-lost' }]
    rows.portfolios = []
    renderPane()

    const el = await chip('p-lost')
    expect(el.getAttribute('title')).toContain('no longer available to you')
  })

  it('opens nothing when the chip is pressed, because there is no control to press', async () => {
    tags = [{ type: 'portfolio', id: 'p-lost' }]
    rows.portfolios = []
    renderPane()

    await chip('p-lost')
    expect(screen.queryByRole('button', { name: 'p-lost' })).not.toBeInTheDocument()
    expect(opened.filter(t => t.type === 'portfolio')).toEqual([])
  })

  it('does not take a sibling resolving as evidence for it', async () => {
    tags = [{ type: 'asset', id: 'a-aapl' }, { type: 'portfolio', id: 'p-lost' }]
    rows.assets = [{ id: 'a-aapl', symbol: 'AAPL' }]
    rows.portfolios = []
    renderPane()

    expect((await chip('AAPL')).getAttribute('data-reference-status')).toBe('open')
    expect((await chip('p-lost')).getAttribute('data-reference-status')).toBe('gone')
  })
})
