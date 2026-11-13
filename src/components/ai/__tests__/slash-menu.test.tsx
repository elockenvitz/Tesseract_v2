/**
 * The Slash Command menu, drawn, and the real pane consuming it.
 *
 * The classification and the parsing have their own suite in
 * `lib/ai/__tests__/slash-commands.test.ts`, including the guard that reads
 * the editor's registry and the twelve kinds of prose that must not trigger.
 * What only a rendered test can be wrong about is the join: whether the pane
 * mounts the menu at all, whether choosing a row actually reaches the
 * composer, whether the KEYBOARD reaches it, and whether a command that
 * cannot work here is NAMED rather than silently dropped.
 *
 * The last one is the point. "Do not claim editor-only commands work in
 * chat" is satisfied by telling the reader which editor they work in, and
 * that is a sentence on screen or it is nothing.
 *
 * The keyboard cases are the new ones, and they cross a seam: the menu
 * renders the list, the COMPOSER owns the keystrokes, because the reader's
 * focus never leaves the textarea while the menu is open. Two components
 * both acting on Enter is how choosing a command also sends the message, so
 * there is a case for exactly that.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, cleanup } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'

/* ─────────────────────────────── the menu alone ─────────────────────────── */

import { AiSlashMenu } from '../AiSlashMenu'

import type { SlashReading } from '../../../lib/ai/slash-market-data'

/**
 * A figure as the hook actually returns one.
 *
 * Built out rather than loosely cast: the provenance line is assembled from
 * `source` and `effectiveAt`, so a fixture missing either would make the
 * assertions below pass against a component that never reads them.
 */
const LRCX_CLOSE: SlashReading = {
  state: 'ok',
  id: 'price',
  symbol: 'LRCX',
  observed: {
    value: 712.34,
    source: { provider: 'yahoo', feed: 'chart_v8', via: 'cache' },
    observedAt: '2026-11-12T22:03:00.000Z',
    effectiveAt: '2026-11-12',
    adjustment: 'unknown',
    currency: 'USD',
  },
  verdict: {
    state: 'fresh',
    dataClass: 'daily_close',
    basis: 'calendar',
    ageMs: 0,
    ageDays: 0,
    observationAgeMs: 0,
    reason: null,
  },
  label: 'Last close',
}

/** The menu with a composer behind it, as the pane wires the pair. */
function Harness({
  initial = '',
  templates = {} as Record<string, string>,
  reading = null as SlashReading | null,
}) {
  const [value, setValue] = useState(initial)
  return (
    <>
      <AiSlashMenu
        value={value}
        onPick={setValue}
        templateBody={s => templates[s] ?? null}
        reading={reading}
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
    expect(screen.queryByTestId('ai-slash-menu')).toBeNull()
    expect(screen.queryByTestId('ai-slash-ready')).toBeNull()
  })

  it('stays shut for a slash inside a sentence', () => {
    render(<Harness initial="Remind me what the /price command does" />)
    expect(screen.queryByTestId('ai-slash-menu')).toBeNull()
  })

  it('stays shut for a date, a ratio and a URL', () => {
    /* The three the brief names, as the reader would actually type them.
       The parsing suite covers twelve; these prove the MENU honours it. */
    for (const prose of ['2026/11/13 close', 'P/E of 28x', 'https://x.com/price']) {
      const { unmount } = render(<Harness initial={prose} />)
      expect(screen.queryByTestId('ai-slash-menu'), prose).toBeNull()
      expect(screen.queryByTestId('ai-slash-ready'), prose).toBeNull()
      expect(screen.queryByTestId('ai-slash-none'), prose).toBeNull()
      unmount()
    }
  })

  it('stays shut for the old dot trigger', () => {
    /* Not a compatibility path. A reader who types the old form gets prose,
       and the menu says nothing -- including "no such command", which would
       be a hint that the dot still means something. */
    for (const old of ['.', '.price.LRCX', '.help']) {
      const { unmount } = render(<Harness initial={old} />)
      expect(screen.queryByTestId('ai-slash-menu'), old).toBeNull()
      expect(screen.queryByTestId('ai-slash-ready'), old).toBeNull()
      expect(screen.queryByTestId('ai-slash-none'), old).toBeNull()
      unmount()
    }
  })

  it('opens on a bare slash and lists what works here', () => {
    render(<Harness initial="/" />)
    const menu = screen.getByTestId('ai-slash-menu')
    expect(menu.textContent).toContain('/price')
    expect(menu.textContent).toContain('/help')
  })

  it('offers nothing it would then refuse', () => {
    render(<Harness initial="/" />)
    const menu = screen.getByTestId('ai-slash-menu')
    for (const declined of ['/chart', '/screenshot', '/private', '/task']) {
      expect(menu.textContent, declined).not.toContain(declined)
    }
  })

  it('narrows as the command is typed', () => {
    render(<Harness initial="/pr" />)
    const menu = screen.getByTestId('ai-slash-menu')
    expect(menu.textContent).toContain('/price')
    expect(menu.textContent).not.toContain('/help')
  })
})

describe('choosing a command puts text in the box and sends nothing', () => {
  it('leaves a data command ready for its ticker', async () => {
    const user = userEvent.setup()
    render(<Harness initial="/pr" />)

    await user.click(screen.getByTestId('ai-slash-option-price'))

    /* `/price.` rather than a question with a placeholder in it: a box
       containing "the price of {SYMBOL}?" invites sending it. The separator
       stays a dot, because the id's namespace is a dot. */
    expect(box().value).toBe('/price.')
    expect(screen.getByTestId('ai-slash-needs-symbol').textContent).toContain('needs a ticker')
  })

  it('shows the stored figure rather than a question to send', async () => {
    /*
     * The 2.3 correction, on screen. This used to put "What is the current
     * price of LRCX?" in the box; the figure now comes from the store, and
     * what the row inserts is the figure WITH its source.
     */
    const user = userEvent.setup()
    render(<Harness initial="/price.LRCX" reading={LRCX_CLOSE} />)

    const panel = screen.getByTestId('ai-slash-reading')
    expect(panel.textContent).toContain('$712.34')
    expect(panel.textContent).not.toContain('?')

    await user.click(screen.getByTestId('ai-slash-reading-row'))
    expect(box().value).toContain('$712.34')
    expect(box().value).toContain('yahoo')
    expect(box().value).toContain('2026-11-12')
  })

  it('accepts a space before the ticker as well', async () => {
    const user = userEvent.setup()
    render(<Harness initial="/price LRCX" reading={LRCX_CLOSE} />)
    await user.click(screen.getByTestId('ai-slash-reading-row'))
    expect(box().value).toContain('$712.34')
  })

  it('never puts the figure in the box without its source', async () => {
    /*
     * The provenance rule, as the defect it prevents: a number inserted
     * alone would be quoted into a message, and then into a note, with
     * nothing saying where it came from or what day it was true.
     */
    const user = userEvent.setup()
    render(<Harness initial="/price.LRCX" reading={LRCX_CLOSE} />)
    await user.click(screen.getByTestId('ai-slash-reading-row'))
    expect(box().value).not.toBe('$712.34')
    expect(box().value).toMatch(/yahoo.*2026-11-12/)
  })

  it('says it is looking, and offers nothing to press, until the figure lands', () => {
    /* A row during the read would insert a placeholder the reader sends. */
    render(<Harness initial="/price.LRCX" reading={{ state: 'loading', id: 'price', symbol: 'LRCX' }} />)
    expect(screen.getByTestId('ai-slash-reading').textContent).toContain('Looking up LRCX')
    expect(screen.queryByTestId('ai-slash-reading-row')).toBeNull()
  })

  it('gives the readers own reason when nothing is stored', () => {
    render(
      <Harness
        initial="/price.ZZZZ"
        reading={{
          state: 'empty', id: 'price', symbol: 'ZZZZ',
          detail: 'No instrument called ZZZZ is in your universe.',
        }}
      />,
    )
    /* Verbatim, never "something went wrong" -- the two are different
       findings and only one is about the data. */
    expect(screen.getByTestId('ai-slash-reading-detail').textContent)
      .toBe('No instrument called ZZZZ is in your universe.')
    expect(screen.queryByTestId('ai-slash-reading-row')).toBeNull()
  })

  it('names the missing input for a figure the store does not hold', async () => {
    const user = userEvent.setup()
    render(<Harness initial="/pe.LRCX" />)

    const panel = screen.getByTestId('ai-slash-data-blocked')
    expect(panel.textContent).toMatch(/earnings/i)

    /* The model lookup is still reachable, labelled as what it is. */
    await user.click(screen.getByTestId('ai-slash-data-fallback'))
    expect(box().value).toMatch(/P\/E ratio for LRCX/)
  })

  it('answers /help itself instead of composing a question about itself', () => {
    render(<Harness initial="/help" />)
    const panel = screen.getByTestId('ai-slash-help')
    expect(panel.textContent).toContain('/price')
    expect(panel.textContent).not.toContain('?')
    /* Nothing to press: there is nothing to send. */
    expect(panel.querySelector('button')).toBeNull()
  })

  it('expands one of the readers own templates', async () => {
    const user = userEvent.setup()
    render(<Harness initial="/template.bear" templates={{ bear: 'Bear case:\n- ' }} />)

    await user.click(screen.getByTestId('ai-slash-ready').querySelector('button')!)
    expect(box().value).toBe('Bear case:\n- ')
  })

  it('inserts the template body rather than a question about it', async () => {
    /* Named in the brief. A text-template command must insert the actual
       predefined template, not ask the AI to describe it. */
    const body = '## Bear case\n\n- Volume risk\n- Multiple compression'
    const user = userEvent.setup()
    render(<Harness initial="/template.bear" templates={{ bear: body }} />)
    await user.click(screen.getByTestId('ai-slash-ready').querySelector('button')!)
    expect(box().value).toBe(body)
  })

  it('says so when the shortcut is not one of theirs', () => {
    render(<Harness initial="/template.nope" />)
    expect(screen.getByTestId('ai-slash-none').textContent).toContain('/template.nope')
  })
})

describe('a command that belongs to the editor is named, not dropped', () => {
  it('tells the reader exactly why /chart cannot draw here', () => {
    render(<Harness initial="/chart.price.AAPL" />)
    const notice = screen.getByTestId('ai-slash-unavailable')
    expect(notice.textContent).toContain('/chart.price')
    /* The incompatibility, not the location: there is no live document in a
       chat message to insert a chart node into. */
    expect(notice.textContent).toMatch(/chat message is text/i)
    expect(notice.textContent).toMatch(/asset page/i)
  })

  it('draws no chart, and no empty box where one would go', () => {
    render(<Harness initial="/chart.price.AAPL" />)
    expect(screen.queryByTestId('ai-slash-ready')).toBeNull()
    expect(document.querySelector('svg')).toBeNull()
    expect(document.querySelector('canvas')).toBeNull()
  })

  it('explains /ai as redundant rather than broken', () => {
    render(<Harness initial="/ai" />)
    expect(screen.getByTestId('ai-slash-unavailable').textContent)
      .toContain('already talking to ACT AI')
  })

  it('says plainly when there is no such command', () => {
    render(<Harness initial="/nonsense" />)
    expect(screen.getByTestId('ai-slash-none').textContent).toContain('/nonsense')
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

const input = () => screen.getByTestId('ai-composer-input') as HTMLTextAreaElement

beforeEach(() => { sent.length = 0 })

describe('the real pane consumes the menu', () => {
  it('opens it when the reader types a slash into the composer', async () => {
    const user = userEvent.setup()
    renderPane()

    await user.type(input(), '/')
    expect(screen.getByTestId('ai-slash-menu')).toBeInTheDocument()
  })

  it('does not open it for a date typed into the composer', async () => {
    const user = userEvent.setup()
    renderPane()

    await user.type(input(), 'Close on 2026/11/13')
    expect(screen.queryByTestId('ai-slash-menu')).toBeNull()
  })

  it('carries a chosen command through to a real send', async () => {
    const user = userEvent.setup()
    renderPane()

    /*
     * `/pe` rather than `/price`, deliberately. `/price` no longer produces
     * anything to send -- it performs a read, and a read needs a database
     * this suite does not have. `/pe` is the command whose figure is NOT
     * stored, so its route is still composer text, and it is the one that
     * exercises the pane's send path end to end.
     */
    await user.type(input(), '/pe.LRCX')
    await user.click(screen.getByTestId('ai-slash-data-fallback'))
    await user.click(screen.getByTestId('ai-composer-send'))

    /*
     * A menu that filled the box but could not be sent would pass every
     * case above this one.
     */
    expect(sent).toEqual(['What is the P/E ratio for LRCX, and what is your source?'])
  })

  it('does not send a figure the pane could not read', async () => {
    /*
     * The pane has no database here, so the read fails. What must NOT happen
     * is the old fallback: quietly composing "What is the current price of
     * LRCX?" and letting the reader send it as though the command had
     * worked. Nothing to press, and nothing sent.
     */
    const user = userEvent.setup()
    renderPane()

    await user.type(input(), '/price.LRCX')
    expect(screen.getByTestId('ai-slash-reading')).toBeInTheDocument()
    expect(screen.queryByTestId('ai-slash-reading-row')).toBeNull()
    expect(input().value).toBe('/price.LRCX')
    expect(sent).toEqual([])
  })

  it('reads the readers own templates through the pane', async () => {
    const user = userEvent.setup()
    renderPane()

    await user.type(input(), '/template.bear')
    await user.click(screen.getByTestId('ai-slash-ready').querySelector('button')!)

    expect(input().value).toBe('Bear case:\n- ')
  })

  it('names an editor-only command inside the pane too', async () => {
    const user = userEvent.setup()
    renderPane()

    await user.type(input(), '/chart.price.AAPL')
    expect(screen.getByTestId('ai-slash-unavailable').textContent)
      .toMatch(/chat message is text/i)
    expect(sent).toEqual([])
  })
})

describe('the keyboard drives the menu without sending', () => {
  /*
   * The seam: the menu renders the rows, the composer owns the keys. These
   * are the cases that catch the two ways that goes wrong -- keys that do
   * nothing, and an Enter that both picks a row AND sends.
   */
  it('selects the first row as soon as the menu opens', async () => {
    const user = userEvent.setup()
    renderPane()
    await user.type(input(), '/')
    expect(screen.getByRole('option', { selected: true }).textContent).toContain('/price')
  })

  it('moves down the list with the arrow keys', async () => {
    const user = userEvent.setup()
    renderPane()
    await user.type(input(), '/')
    await user.keyboard('{ArrowDown}')
    expect(screen.getByRole('option', { selected: true }).textContent).toContain('/volume')
  })

  it('wraps from the last row to the first', async () => {
    const user = userEvent.setup()
    renderPane()
    await user.type(input(), '/')
    await user.keyboard('{ArrowUp}')
    expect(screen.getByRole('option', { selected: true }).textContent).toContain('/help')
  })

  it('leaves the arrow keys out of the text', async () => {
    const user = userEvent.setup()
    renderPane()
    await user.type(input(), '/')
    await user.keyboard('{ArrowDown}{ArrowDown}')
    expect(input().value).toBe('/')
  })

  it('picks the selected row on Enter and sends nothing', async () => {
    const user = userEvent.setup()
    renderPane()
    await user.type(input(), '/')
    await user.keyboard('{ArrowDown}{Enter}')

    /*
     * THE case. Enter chose `/volume` and must not also have sent the
     * message: two key listeners on one keystroke is exactly how a menu
     * selection spends tokens.
     */
    expect(input().value).toBe('/volume.')
    expect(sent).toEqual([])
  })

  it('sends on Enter once the command is complete', async () => {
    const user = userEvent.setup()
    renderPane()
    /* `/pe` again: the command with composer text to take. See the send case
       above for why `/price` has none here. */
    await user.type(input(), '/pe.LRCX')
    /* One row, and it is the fallback. Enter takes it. */
    await user.keyboard('{Enter}')
    expect(input().value).toBe('What is the P/E ratio for LRCX, and what is your source?')
    expect(sent).toEqual([])
    /* A second Enter, with no menu left to consume it, sends. */
    await user.keyboard('{Enter}')
    expect(sent).toEqual(['What is the P/E ratio for LRCX, and what is your source?'])
  })

  it('lets Enter send when the menu has nothing to select', async () => {
    const user = userEvent.setup()
    renderPane()
    /* "needs a ticker" is a statement, not a row. Enter must fall through
       rather than being swallowed by a menu with nothing in it. */
    await user.type(input(), '/price')
    expect(screen.getByTestId('ai-slash-needs-symbol')).toBeInTheDocument()
    await user.keyboard('{Enter}')
    expect(sent).toEqual(['/price'])
  })

  it('clears the command on Escape', async () => {
    const user = userEvent.setup()
    renderPane()
    await user.type(input(), '/pr')
    await user.keyboard('{Escape}')
    expect(input().value).toBe('')
    expect(screen.queryByTestId('ai-slash-menu')).toBeNull()
    expect(sent).toEqual([])
  })

  it('takes a row on Tab as well', async () => {
    const user = userEvent.setup()
    renderPane()
    await user.type(input(), '/')
    await user.keyboard('{Tab}')
    expect(input().value).toBe('/price.')
  })
})
