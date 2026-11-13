/**
 * The dot menu, drawn, and the real pane consuming it.
 *
 * The classification and the parsing have their own suite in
 * `lib/ai/__tests__/dot-commands.test.ts`, including the guard that reads the
 * editor's registry. What only a rendered test can be wrong about is the
 * join: whether the pane mounts the menu at all, whether choosing a row
 * actually reaches the composer, and whether a command that cannot work here
 * is NAMED rather than silently dropped.
 *
 * The last one is the point. "Do not claim editor-only commands work in
 * chat" is satisfied by telling the reader which editor they work in, and
 * that is a sentence on screen or it is nothing.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, cleanup } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'

/* ─────────────────────────────── the menu alone ─────────────────────────── */

import { AiDotMenu } from '../AiDotMenu'

/** The menu with a composer behind it, as the pane wires the pair. */
function Harness({ initial = '', templates = {} as Record<string, string> }) {
  const [value, setValue] = useState(initial)
  return (
    <>
      <AiDotMenu
        value={value}
        onPick={setValue}
        templateBody={s => templates[s] ?? null}
      />
      <textarea data-testid="box" value={value} onChange={e => setValue(e.target.value)} />
    </>
  )
}

const box = () => screen.getByTestId('box') as HTMLTextAreaElement

afterEach(cleanup)

describe('the menu appears only where a command can be', () => {
  it('stays shut for ordinary prose', () => {
    render(<Harness initial="What is the bear case for LRCX?" />)
    expect(screen.queryByTestId('ai-dot-menu')).toBeNull()
    expect(screen.queryByTestId('ai-dot-ready')).toBeNull()
  })

  it('stays shut for a dot inside a sentence', () => {
    render(<Harness initial="Remind me what the .price command does" />)
    expect(screen.queryByTestId('ai-dot-menu')).toBeNull()
  })

  it('opens on a bare dot and lists what works here', () => {
    render(<Harness initial="." />)
    const menu = screen.getByTestId('ai-dot-menu')
    expect(menu.textContent).toContain('.price')
    expect(menu.textContent).toContain('.help')
  })

  it('offers nothing it would then refuse', () => {
    render(<Harness initial="." />)
    const menu = screen.getByTestId('ai-dot-menu')
    for (const declined of ['.chart', '.screenshot', '.private', '.task']) {
      expect(menu.textContent, declined).not.toContain(declined)
    }
  })

  it('narrows as the command is typed', () => {
    render(<Harness initial=".pr" />)
    const menu = screen.getByTestId('ai-dot-menu')
    expect(menu.textContent).toContain('.price')
    expect(menu.textContent).not.toContain('.help')
  })
})

describe('choosing a command puts text in the box and sends nothing', () => {
  it('leaves a data command ready for its ticker', async () => {
    const user = userEvent.setup()
    render(<Harness initial=".pr" />)

    await user.click(screen.getByTestId('ai-dot-option-price'))

    /* `.price.` rather than a question with a placeholder in it: a box
       containing "the price of {SYMBOL}?" invites sending it. */
    expect(box().value).toBe('.price.')
    expect(screen.getByTestId('ai-dot-needs-symbol').textContent).toContain('needs a ticker')
  })

  it('turns the command plus a ticker into the question it means', async () => {
    const user = userEvent.setup()
    render(<Harness initial=".price.LRCX" />)

    await user.click(screen.getByTestId('ai-dot-ready').querySelector('button')!)

    expect(box().value).toBe('What is the current price of LRCX?')
  })

  it('puts no figure in the box', () => {
    render(<Harness initial=".price.LRCX" />)
    /* The provenance rule, visible: the expansion is a question, so the
       number the reader ends up seeing came from the model's own lookup. */
    const ready = screen.getByTestId('ai-dot-ready').textContent ?? ''
    expect(ready).toMatch(/\?/)
    expect(ready.replace(/LRCX/g, '')).not.toMatch(/\d/)
  })

  it('expands one of the readers own templates', async () => {
    const user = userEvent.setup()
    render(<Harness initial=".template.bear" templates={{ bear: 'Bear case:\n- ' }} />)

    await user.click(screen.getByTestId('ai-dot-ready').querySelector('button')!)
    expect(box().value).toBe('Bear case:\n- ')
  })

  it('says so when the shortcut is not one of theirs', () => {
    render(<Harness initial=".template.nope" />)
    expect(screen.getByTestId('ai-dot-none').textContent).toContain('.template.nope')
  })
})

describe('a command that belongs to the editor is named, not dropped', () => {
  it('tells the reader where .chart works', () => {
    render(<Harness initial=".chart.price.AAPL" />)
    const notice = screen.getByTestId('ai-dot-unavailable')
    expect(notice.textContent).toContain('.chart.price')
    expect(notice.textContent).toContain('note or research editor')
  })

  it('draws no chart, and no empty box where one would go', () => {
    render(<Harness initial=".chart.price.AAPL" />)
    expect(screen.queryByTestId('ai-dot-ready')).toBeNull()
    expect(document.querySelector('svg')).toBeNull()
    expect(document.querySelector('canvas')).toBeNull()
  })

  it('explains .ai as redundant rather than broken', () => {
    render(<Harness initial=".ai" />)
    expect(screen.getByTestId('ai-dot-unavailable').textContent)
      .toContain('already talking to ACT AI')
  })

  it('says plainly when there is no such command', () => {
    render(<Harness initial=".nonsense" />)
    expect(screen.getByTestId('ai-dot-none').textContent).toContain('.nonsense')
  })
})

/* ───────────────────────── the pane that mounts it ──────────────────────── */

vi.mock('../../../lib/supabase', () => ({
  supabase: {
    from() {
      const builder: Record<string, unknown> = {
        select: () => builder,
        in: () => builder,
        neq: () => builder,
        eq: () => builder,
        or: () => builder,
        order: () => builder,
        limit: () => builder,
        then: (resolve: (v: unknown) => unknown) =>
          Promise.resolve({ data: [], error: null }).then(resolve),
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

vi.mock('../../../hooks/useTemplates', () => ({
  useTemplates: () => ({
    templates: [],
    getByShortcut: (s: string) =>
      s === 'bear' ? { id: 't1', name: 'Bear case', content: 'Bear case:\n- ', shortcut: 'bear' } : undefined,
  }),
}))

const sent: string[] = []

vi.mock('../../../hooks/useAI', () => ({
  useAI: () => ({
    messages: [], tags: [], tagLabels: {},
    isConfigured: true, configMode: 'byok', conversationId: 'c1',
    sendMessage: (text: string) => { sent.push(text) },
    clearConversation: vi.fn(), isLoading: false, error: null, status: null,
    cancelGeneration: vi.fn(), conversations: [], isLoadingList: false,
    selectConversation: vi.fn(), newConversation: vi.fn(), setTags: vi.fn(),
    addTag: vi.fn(), removeTag: vi.fn(), renameConversation: vi.fn(),
    archiveConversation: vi.fn(), togglePin: vi.fn(), deleteConversation: vi.fn(),
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
  <QueryClientProvider
    client={new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })}
  >
    {node}
  </QueryClientProvider>
)

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

beforeEach(() => { sent.length = 0 })

describe('the real pane consumes the menu', () => {
  it('opens it when the reader types a dot into the composer', async () => {
    const user = userEvent.setup()
    renderPane()

    await user.type(screen.getByTestId('ai-composer-input'), '.')
    expect(screen.getByTestId('ai-dot-menu')).toBeInTheDocument()
  })

  it('carries a chosen command through to a real send', async () => {
    const user = userEvent.setup()
    renderPane()

    await user.type(screen.getByTestId('ai-composer-input'), '.price.LRCX')
    await user.click(screen.getByTestId('ai-dot-ready').querySelector('button')!)
    await user.click(screen.getByTestId('ai-composer-send'))

    /*
     * End to end, through the pane's own send path: the command became a
     * question and the question reached the hook. A menu that filled the box
     * but could not be sent would pass every case above this one.
     */
    expect(sent).toEqual(['What is the current price of LRCX?'])
  })

  it('reads the readers own templates through the pane', async () => {
    const user = userEvent.setup()
    renderPane()

    await user.type(screen.getByTestId('ai-composer-input'), '.template.bear')
    await user.click(screen.getByTestId('ai-dot-ready').querySelector('button')!)

    expect((screen.getByTestId('ai-composer-input') as HTMLTextAreaElement).value)
      .toBe('Bear case:\n- ')
  })

  it('names an editor-only command inside the pane too', async () => {
    const user = userEvent.setup()
    renderPane()

    await user.type(screen.getByTestId('ai-composer-input'), '.chart.price.AAPL')
    expect(screen.getByTestId('ai-dot-unavailable').textContent)
      .toContain('note or research editor')
    expect(sent).toEqual([])
  })
})
