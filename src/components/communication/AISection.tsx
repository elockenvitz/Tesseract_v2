import { useState, useRef, useEffect, useMemo } from 'react'
import { EngagementContextHeader } from './EngagementContextHeader'
import type { EngagementTarget } from '../../lib/engagement'
import {
  Bot,
  Send,
  Settings,
  Loader2,
  Sparkles,
  ChevronDown,
  PanelLeftOpen,
  PanelLeftClose,
  ArrowLeft,
  Maximize2,
  Minimize2,
} from 'lucide-react'
import { useAI, useAISuggestions, type TagRef } from '../../hooks/useAI'
import { useAIConfig, AI_MODELS, AI_PROVIDERS, type AIProvider } from '../../hooks/useAIConfig'
import { Button } from '../ui/Button'
import { clsx } from 'clsx'
/*
 * The presentation layer, shared with the contextual asset briefing.
 *
 * The message bubble, the research trail, the citations footer and the three
 * non-answer states used to be module-local functions in this file. They are
 * in `components/ai` now for one reason: a second surface has to say the same
 * things in the same words, and a copied research trail is how "the lookup
 * failed" starts rendering as "no records found" on one surface and not the
 * other.
 */
import { AiMessage, AiThinking, AiErrorNotice, AiPrompts, AiContextChips } from '../ai'
import { AIConversationList } from './AIConversationList'
import { AISuggestedActions } from './AISuggestedActions'
import type { AiAction } from '../../lib/ai'
/*
 * The two shapes this pane takes, and the layout each implies.
 *
 * Derived from the pane the reader is already in rather than stored here: a
 * second, independent mode switch is how a 384px rail ends up claiming to be
 * in research mode. See `lib/ai/chat-modes`.
 */
import { chatLayout, modeToggleLabel, type AiChatMode } from '../../lib/ai/chat-modes'
import { ACT_AI_PLACEHOLDER } from '../../lib/ai/brand'
/* Questions grounded in the reader's own open work, and the merge that puts
   them ahead of the questions derived from the conversation's bindings. */
import { candidatePrompts, mergePrompts } from '../../lib/ai/prompt-candidates'
import { useGroundedPromptFacts } from '../../hooks/ai/useGroundedPrompts'

/** How many questions each layout has room for. Matches `chatLayout`. */
const LIMIT_FOR: Record<AiChatMode, number> = { compact: 4, research: 6 }
import {
  conversationContextState, describeSendTarget, shortSubjectLabel,
  subjectsAgree, subjectTag,
} from '../../lib/ai/conversation-context'

interface AISectionProps {
  isOpen: boolean
  onToggle: () => void
  isFullscreen: boolean
  onToggleFullscreen: () => void
  // Tags pre-applied to NEW conversations created in this panel session.
  // Replaces the old `context` prop; opening AI from the AAPL page passes
  // `[{type:'asset', id:aapl_id}]` so new threads start tagged with AAPL.
  initialTags?: TagRef[]
  /**
   * The object and issue this panel was opened about, when it was opened
   * from the engagement seam rather than from a tab.
   *
   * Additive and inert when absent: with no target this component behaves
   * exactly as it did before. It never changes what is SENT to the model —
   * context is still assembled server-side from the conversation's tags by
   * the ai-chat function. It shows the user what was bound, and it offers
   * the surface's suggested question in the composer for the user to send,
   * edit or ignore.
   */
  engagementTarget?: EngagementTarget | null
  /**
   * The object the reader is currently looking at, from the active tab.
   *
   *
   * Distinct from `engagementTarget`, which is a request that was true when
   * it was dispatched and is never cleared. This is what the open
   * conversation is compared against, because it is the only one of the two
   * that follows the reader.
   */
  currentSubject?: { type: string; id: string; label?: string | null } | null
  onOpenSettings?: () => void
  /**
   * Compact rail or full-width research pane.
   *
   * Optional and derived from `isFullscreen` when absent, so every existing
   * caller keeps the behaviour it had. The parent passes it explicitly
   * because only the parent knows whether this is a phone sheet, where
   * "fullscreen" is meaningless and the control is not even rendered.
   */
  mode?: AiChatMode
  /**
   * Switch modes. Rendered as a labelled control inside the pane only when
   * supplied — on a phone there is nothing to switch to.
   *
   * It must be the SAME callback that drives the pane's own width
   * (`onToggleFullscreen`), not a second piece of state.
   */
  onToggleMode?: () => void
}

export function AISection({
  isOpen,
  onToggle,
  isFullscreen,
  onToggleFullscreen,
  initialTags = [],
  engagementTarget = null,
  currentSubject = null,
  onOpenSettings,
  mode: modeProp,
  onToggleMode,
}: AISectionProps) {
  /* One source of truth for the width: the pane's own fullscreen state. */
  const mode: AiChatMode = modeProp ?? (isFullscreen ? 'research' : 'compact')
  const layout = chatLayout(mode)
  const {
    messages,
    tags,
    isConfigured,
    isConfigResolving,
    configMode,
    conversationId,
    /* Whether this pane yet knows what it is showing. See the thread area. */
    isRestoringConversation,
    sendMessage,
    clearConversation,
    isLoading,
    error,
    // Stage 2: grounded activity text and the stop control.
    status,
    cancelGeneration,
    // Tag labels are still used for read-only display (e.g. "About: AAPL"
    // hint in the header) — but the user no longer adds or removes tags
    // directly. They're inferred from whatever page launched the panel.
    tagLabels,
    // Multi-conversation: list + actions
    conversations,
    isLoadingList,
    selectConversation,
    newConversation,
    setTags,
    renameConversation,
    archiveConversation,
    togglePin,
    deleteConversation,
  } = useAI(initialTags)

  const { effectiveConfig, updateUserPrefs } = useAIConfig()
  /*
   * The questions offered on an empty thread.
   *
   * `tags` is the open conversation's own binding, so the suggestions follow
   * the thread rather than the last engagement. The target contributes only
   * what it alone knows — the ticker, the portfolio name, and the issue that
   * raised this — and `suggestedPrompts` names nothing it was not given.
   */
  /*
   * ...and only while the target still describes where the reader is. It is
   * never cleared, so after walking from AAPL to MSFT its ticker would
   * otherwise seed a question about AAPL on an MSFT thread. Same rule, and
   * the same helper, as the bound-object header below.
   */
  const targetStillCurrent = subjectsAgree(
    engagementTarget
      ? { type: engagementTarget.objectType, id: engagementTarget.objectId }
      : null,
    currentSubject,
  )
  const suggestions = useAISuggestions(tags, tagLabels, {
    target: engagementTarget && targetStillCurrent
      ? {
          symbol: engagementTarget.symbol ?? null,
          portfolioName: engagementTarget.portfolioName ?? null,
          issue: engagementTarget.issue ?? null,
        }
      : null,
    mode,
  })

  /*
   * ── The grounded half ──────────────────────────────────────────────────
   *
   * The questions above are derived from what this conversation is BOUND to.
   * These come from what the reader actually has open: recommendations
   * waiting on them, requirements past their date, ideas that have stopped
   * moving. Each carries the records that justify it, so the panel can say
   * why it is offering a question rather than just offering one.
   *
   * Fetched once per minute and cached, never recomputed per render: the old
   * list was rebuilt on every keystroke, and a re-ranked button under a
   * moving cursor is how a reader presses a question they did not read.
   *
   * Gated on the pane being open. An unopened pane reads nothing.
   */
  /*
   * `isSettling`, not `isLoading`. A disabled React Query reports
   * `isLoading: false` -- and this query is disabled until the user AND the
   * active organization are known, neither of which is true on the first
   * paint. Gating on `isLoading` let the generic questions paint and then be
   * replaced, which is the flash the gate exists to prevent.
   */
  const { data: promptFacts, isSettling: isLoadingPromptFacts } =
    useGroundedPromptFacts(isOpen)

  const groundedSuggestions = useMemo(() => {
    const grounded = candidatePrompts({
      ...(promptFacts ?? {}),
      subject: currentSubject
        ? {
            /* "AAPL" from "AAPL - Apple Inc.", the same trim the header
               uses, so a question names the ticker rather than the row. */
            label: shortSubjectLabel(currentSubject.label) ?? null,
            kind: currentSubject.type === 'asset' ? 'asset'
              : currentSubject.type === 'portfolio' ? 'portfolio'
              : currentSubject.type === 'theme' ? 'theme'
              : 'other',
          }
        : null,
      limit: LIMIT_FOR[mode],
    })
    /* Grounded first, the bound-context questions to fill, generic last. */
    return mergePrompts(grounded, suggestions, LIMIT_FOR[mode])
  }, [promptFacts, currentSubject, suggestions, mode])

  const [input, setInput] = useState('')

  /**
   * Place the surface's suggested question in the composer.
   *
   * Placed, never sent. Stage D1 lets the model analyse and propose; a
   * question the user did not choose to send is neither, and auto-sending
   * would also spend their tokens on a prompt they never read.
   *
   * Keyed on the seed itself rather than on the target, so re-opening the
   * panel for the same item does not clobber a reply the user has started
   * typing. Anything already in the box wins.
   */
  const seedPrompt = engagementTarget?.seedPrompt ?? null
  const seededRef = useRef<string | null>(null)
  useEffect(() => {
    if (!seedPrompt || seededRef.current === seedPrompt) return
    seededRef.current = seedPrompt
    setInput(prev => (prev.trim() ? prev : seedPrompt))
  }, [seedPrompt])

  /**
   * Resume the conversation the surface asked for.
   *
   * SELECTS, never creates: `selectConversation` loads an existing thread's
   * messages and tags and does not write. The guard on `conversationId` is
   * what makes re-opening the same thread safe — the request is already
   * satisfied, so nothing is re-fetched and an in-progress reply is not
   * discarded. A request for a different thread is honoured, which is
   * exactly what clicking another row in the sidebar already does.
   *
   * Keyed on the target object rather than on the id string, because each
   * engagement dispatch carries a fresh target: asking for a thread,
   * switching away by hand, then asking for the same thread again must work
   * the second time, and a dep on the bare id would make that a no-op.
   */
  /*
   * ── Does the open thread belong to where the reader is standing? ────────
   *
   * `tags` is the OPEN conversation's own tag set — `selectConversation`
   * loads it with the thread — so this compares the conversation against the
   * active tab, never against the engagement target, which does not follow
   * navigation and is exactly what made the pane claim AAPL on an MSFT page.
   */
  const contextState = conversationContextState({
    conversationId,
    conversationTags: tags,
    currentSubject,
  })
  const openConversationTitle =
    conversations.find(c => c.id === conversationId)?.title ?? null
  const subjectName = shortSubjectLabel(currentSubject?.label)

  /*
   * Does the bound-object header still describe where the reader is?
   *
   * `engagementTarget` is frozen at the last engagement, so after walking
   * from AAPL to MSFT it still announces "context already supplied: Asset
   * AAPL". With no conversation open that is not a FOREIGN thread — there is
   * no thread — but it is still a false claim about the page, so the header
   * is suppressed whenever the two disagree.
   */
  const targetSubject = engagementTarget
    ? {
        type: engagementTarget.objectType,
        id: engagementTarget.objectId,
      }
    : null
  const headerDescribesHere = subjectsAgree(targetSubject, currentSubject)

  /**
   * Begin an investigation in the CURRENT page's context.
   *
   * `newConversation()` resets to `initialTags`, and those are derived from
   * the same stale target — so on its own it would have started a thread
   * tagged AAPL from a button labelled "Start one about MSFT". The tag for
   * where the reader actually is, is set explicitly after the reset.
   *
   * Still no write: both calls are local state. The row is created when the
   * user sends something, which is the only point at which they have said
   * anything to record.
   */
  const startHere = () => {
    newConversation()
    const tag = subjectTag(currentSubject)
    if (tag) setTags([tag as TagRef])
  }

  const requestedConversationId = engagementTarget?.conversationId ?? null
  useEffect(() => {
    if (!requestedConversationId) return
    if (requestedConversationId === conversationId) return
    void selectConversation(requestedConversationId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engagementTarget])
  const [showModelSelector, setShowModelSelector] = useState(false)
  // Sidebar visibility — separate state for inline (fullscreen) vs screen
  // (compact). In fullscreen the sidebar lives alongside chat and the
  // toggle hides/shows it. In compact the AI pane is too narrow for both,
  // so the conversation list takes over the whole pane like a screen
  // switch — the user navigates back via the same toggle.
  const [showConversationList, setShowConversationList] = useState(() => {
    if (typeof window === 'undefined') return true
    return localStorage.getItem('ai-panel.show-conversations') !== '0'
  })
  useEffect(() => {
    try {
      localStorage.setItem('ai-panel.show-conversations', showConversationList ? '1' : '0')
    } catch { /* ignore */ }
  }, [showConversationList])

  // In compact (right-pane) mode the conversation list is its own screen.
  // When the user picks a conversation, snap back to chat automatically —
  // they almost always want to read it, not stare at the list.
  const [showListAsScreen, setShowListAsScreen] = useState(false)
  /* Research mode has the width for the list beside the thread; compact does
     not, and hands the whole pane over to it instead. */
  const isInlineSidebar = layout.showInlineSidebar
  const handleSelectConversationFromList = (id: string) => {
    selectConversation(id)
    if (!isInlineSidebar) setShowListAsScreen(false)
  }
  const handleNewConversationFromList = () => {
    newConversation()
    if (!isInlineSidebar) setShowListAsScreen(false)
  }

  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const modelSelectorRef = useRef<HTMLDivElement>(null)

  // Current model — effectiveConfig already resolves: user pref →
  // org default → fallback (see useAIConfig).
  const currentProvider = (effectiveConfig.provider || 'anthropic') as AIProvider
  const currentModel = effectiveConfig.model || AI_MODELS[currentProvider]?.[0]?.id

  const currentModelInfo = AI_MODELS[currentProvider]?.find(m => m.id === currentModel)
  const currentProviderInfo = AI_PROVIDERS.find(p => p.id === currentProvider)

  // Per-user pref: any user can pick a model within the org's configured
  // provider. Cost still flows to the org's BYOK key. Disabled for
  // platform mode (the platform key choice is set globally).
  const canChangeModel = effectiveConfig.isConfigured && effectiveConfig.mode !== 'platform'

  // Close model selector when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (modelSelectorRef.current && !modelSelectorRef.current.contains(event.target as Node)) {
        setShowModelSelector(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const handleModelChange = (model: string) => {
    if (!canChangeModel) return
    updateUserPrefs({ preferred_model: model })
    setShowModelSelector(false)
  }

  // initialTags is the only "incoming" signal now. The hook handles
  // auto-loading the most recent conversation that overlaps initialTags
  // — no parent-context-sync effect needed here.

  // Scroll to bottom when messages change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  // Auto-resize textarea
  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value)
    e.target.style.height = 'auto'
    e.target.style.height = `${Math.min(e.target.scrollHeight, 120)}px`
  }

  /*
   * What was last sent, so a failed turn can be sent again.
   *
   * The hook POPS the message that failed, so after an error the text is gone
   * from the thread as well as from the composer: the reader's only move was
   * to retype what they had just typed. A ref rather than state because it is
   * never rendered and must not re-render the pane on every send.
   */
  const lastSentRef = useRef<string | null>(null)

  const send = (text: string) => {
    lastSentRef.current = text
    sendMessage(text)
  }

  const handleSend = () => {
    if (!input.trim() || isLoading) return
    send(input.trim())
    setInput('')
    if (inputRef.current) {
      inputRef.current.style.height = 'auto'
    }
  }

  /* Offered only while we still hold the exact text. A Retry that sends
     something else, or nothing, would be worse than no Retry. */
  const retryLastSend = lastSentRef.current && !isLoading
    ? () => send(lastSentRef.current as string)
    : undefined

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  // When the AI mentions a $TICKER in its response, dispatch a CustomEvent
  // (same pattern as `open-shared-simulation` elsewhere). Any dashboard
  // listener can pick this up and open the asset tab. Until that listener
  // is wired, the pill renders but clicks are a no-op — visual win first,
  // navigation later.
  const handleTickerClick = (symbol: string) => {
    window.dispatchEvent(new CustomEvent('open-asset-by-symbol', { detail: { symbol } }))
  }

  const handleSuggestionClick = (suggestion: string) => {
    send(suggestion)
  }

  /*
   * The model's display name, from the catalogue.
   *
   * Falls back to the raw id for a model logged before the catalogue knew
   * about it — a stale label is worse than an honest identifier.
   */
  const modelLabelFor = (model?: string | null): string | null => {
    if (!model) return null
    for (const list of Object.values(AI_MODELS)) {
      const found = list.find(m => m.id === model)
      if (found) return found.name
    }
    return model
  }

  /*
   * ── Not configured, once we actually know that ──────────────────────────
   *
   * `isConfigured` is resolved from three queries, and until they land every
   * input is undefined and the resolver falls through to `false`. That false
   * is a DEFAULT, not a verdict, and rendering this whole screen on it is
   * what put a flash of "AI Assistant Not Configured" in front of every
   * reader who opened the pane.
   *
   * Nothing is rendered in its place. The pane's chrome is drawn by the
   * caller and this branch replaces the entire body, so a spinner here would
   * be a second full-pane state on the way to the first -- two flashes rather
   * than none. The resolve is three cached queries; the thread area's own
   * settle gate covers the rest.
   */
  /*
   * Not configured, once we actually know that -- and otherwise the real pane.
   *
   * `isConfigured` resolves from three queries and falls through to `false`
   * while they are in flight, so that false is a DEFAULT, not a verdict.
   * Rendering this screen on it told every reader their AI was not set up.
   *
   * The first fix returned an empty div for the resolving window, which
   * traded a wrong screen for a blank pane -- correct and worse. The pane's
   * chrome does not depend on the configuration at all: the header, the
   * context chips and the composer can paint immediately and be right. So
   * resolving now falls THROUGH to the real pane, and only the thread area
   * waits, which is the one region whose content is actually unknown.
   *
   * One transition, and the pane never looks broken or absent on the way to
   * it.
   */
  if (!isConfigured && !isConfigResolving) {
    return (
      <div className="flex flex-col h-full">
        <div className="flex-1 flex items-center justify-center p-6">
          <div className="text-center max-w-sm">
            <div className="w-16 h-16 bg-gradient-to-br from-primary-100 to-purple-100 dark:from-primary-900/30 dark:to-purple-900/30 rounded-full flex items-center justify-center mx-auto mb-4">
              <Bot className="h-8 w-8 text-primary-500" />
            </div>
            <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-2">
              AI Assistant Not Configured
            </h3>
            <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
              Connect your AI provider to unlock intelligent analysis of your investment research.
            </p>

            <div className="space-y-2 text-left bg-gray-50 dark:bg-gray-800 rounded-lg p-4 mb-4">
              <div className="flex items-center space-x-2 text-sm text-gray-700 dark:text-gray-300">
                <Sparkles className="h-4 w-4 text-primary-500" />
                <span>Analyze your thesis for blind spots</span>
              </div>
              <div className="flex items-center space-x-2 text-sm text-gray-700 dark:text-gray-300">
                <Sparkles className="h-4 w-4 text-primary-500" />
                <span>Generate outcome scenarios</span>
              </div>
              <div className="flex items-center space-x-2 text-sm text-gray-700 dark:text-gray-300">
                <Sparkles className="h-4 w-4 text-primary-500" />
                <span>Summarize notes and discussions</span>
              </div>
              <div className="flex items-center space-x-2 text-sm text-gray-700 dark:text-gray-300">
                <Sparkles className="h-4 w-4 text-primary-500" />
                <span>Answer research questions</span>
              </div>
            </div>

            <Button
              variant="primary"
              onClick={onOpenSettings}
              className="w-full"
            >
              <Settings className="h-4 w-4 mr-2" />
              Configure in Settings
            </Button>

            <p className="text-xs text-gray-500 dark:text-gray-400 mt-3">
              You'll need an API key from Anthropic, OpenAI, Google, or Perplexity. Typical usage costs $5-20/month.
            </p>
          </div>
        </div>
      </div>
    )
  }

  // Compact-mode "screen": when the user opens the conversation list and
  // we don't have room for the inline sidebar, render the list full-pane
  // and stop rendering the chat surface entirely. Done as an early return
  // so the chat tree (with its own scroll/focus state) doesn't stay
  // mounted under it.
  if (!isInlineSidebar && showListAsScreen) {
    return (
      <div className="flex flex-col h-full">
        <div className="px-4 py-2 border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50 flex items-center justify-between">
          <button
            onClick={() => setShowListAsScreen(false)}
            className="text-sm text-gray-700 hover:text-gray-900 dark:text-gray-300 dark:hover:text-gray-100 inline-flex items-center gap-1.5 font-medium"
            title="Back to chat"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to chat
          </button>
          <span className="text-sm font-medium text-gray-900 dark:text-white">Conversations</span>
        </div>
        <div className="flex-1 min-h-0">
          <AIConversationList
            conversations={conversations}
            activeConversationId={conversationId}
            tagLabels={tagLabels}
            onSelect={handleSelectConversationFromList}
            onNewConversation={handleNewConversationFromList}
            onRename={renameConversation}
            onArchive={archiveConversation}
            onTogglePin={togglePin}
            onDelete={deleteConversation}
            isLoading={isLoadingList}
            fullWidth
          />
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-full">
      {/* Inline sidebar — only shown in fullscreen, where there's room.
          Compact mode uses the screen-takeover branch above. */}
      {isInlineSidebar && showConversationList && (
        <AIConversationList
          conversations={conversations}
          activeConversationId={conversationId}
          tagLabels={tagLabels}
          onSelect={selectConversation}
          onNewConversation={newConversation}
          onRename={renameConversation}
          onArchive={archiveConversation}
          onTogglePin={togglePin}
          onDelete={deleteConversation}
          isLoading={isLoadingList}
        />
      )}

      {/* Main pane */}
      <div className="flex flex-col flex-1 min-w-0 h-full">
      {/*
        The bound-object header, but NOT while it would be lying.

        It renders the engagement target, which is never cleared. With a
        conversation open that the current page is not part of, it announced
        "context already supplied: Asset AAPL" over a thread the reader had
        walked away from. In that one state the banner below says what is
        actually open instead.
      */}
      {engagementTarget && contextState !== 'foreign' && headerDescribesHere && (
        <EngagementContextHeader target={engagementTarget} mode="ai" />
      )}

      {/*
        Continuing and beginning, as two visible choices.

        A conversation that spans companies is a legitimate investigation,
        not a mistake, so continuing stays available and nothing is moved,
        re-tagged or cleared. What changes is that it is no longer silent:
        the reader is told which thread a message would join, and offered the
        other option by name.

        `newConversation` only resets local state to the current page's tags;
        no row is written until something is sent.
      */}
      {contextState === 'foreign' && (
        <div
          data-testid="ai-context-mismatch"
          className="flex-shrink-0 flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-amber-200 bg-amber-50 px-3 py-2 dark:border-amber-400/30 dark:bg-amber-500/[0.08]"
        >
          <span className="text-[11px] text-amber-800 dark:text-amber-300">
            {describeSendTarget(contextState, openConversationTitle)}
            {subjectName ? ` Not about ${subjectName}.` : ''}
          </span>
          <button
            type="button"
            data-testid="ai-start-here"
            onClick={startHere}
            className="ml-auto rounded bg-amber-600 px-2 py-0.5 text-[11px] font-semibold text-white hover:bg-amber-700"
          >
            {subjectName ? `Start one about ${subjectName}` : 'Start a new conversation'}
          </button>
        </div>
      )}
      {/* The pane's own controls: conversations, and the mode this is in. */}
      <div className="flex items-center gap-1 px-2 py-1.5 border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50">
        <button
          onClick={() => {
            if (isInlineSidebar) setShowConversationList(v => !v)
            else                 setShowListAsScreen(true)
          }}
          className="p-1 rounded text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-700"
          title={
            isInlineSidebar
              ? (showConversationList ? 'Hide conversations' : 'Show conversations')
              : 'Open conversations'
          }
        >
          {isInlineSidebar && showConversationList
            ? <PanelLeftClose className="h-4 w-4" />
            : <PanelLeftOpen  className="h-4 w-4" />}
        </button>

        {/*
          The mode, named rather than implied.

          The width control already existed in the pane's outer chrome as an
          unlabelled Maximize icon, which is why nobody found the research
          layout: "fullscreen" describes the window, not what the pane becomes.
          Same callback, same single piece of state — this one says what it is
          for. Absent on a phone, where the sheet is already edge to edge.
        */}
        {onToggleMode && (
          <button
            type="button"
            data-testid="ai-mode-toggle"
            onClick={onToggleMode}
            aria-pressed={mode === 'research'}
            className={clsx(
              'ml-auto inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-medium',
              mode === 'research'
                ? 'bg-primary-50 text-primary-700 dark:bg-primary-900/30 dark:text-primary-300'
                : 'text-gray-500 hover:bg-gray-200 hover:text-gray-800 dark:text-gray-400 dark:hover:bg-gray-700 dark:hover:text-gray-200',
            )}
            title={modeToggleLabel(mode)}
          >
            {mode === 'research'
              ? <Minimize2 className="h-3.5 w-3.5" />
              : <Maximize2 className="h-3.5 w-3.5" />}
            {mode === 'research' ? 'Research mode' : 'Expand'}
          </button>
        )}
      </div>

      {/*
        What this conversation is about.

        Display only: the model's context is assembled server-side from the
        conversation's tags. On the rail, with the thread scrolled, this is the
        only thing on screen that answers "which company am I asking about".
      */}
      <AiContextChips
        subject={currentSubject}
        target={engagementTarget}
        mode={mode}
      />

      {/*
        Messages.

        The scrollport is the pane; the COLUMN inside it is the reading
        measure. Research mode centres a 48rem column rather than stretching a
        thread across a 1600px monitor, where prose runs to about 200
        characters a line and a reply becomes unreadable at exactly the moment
        the reader asked for more room.
      */}
      <div className={clsx('flex-1 overflow-y-auto', layout.threadPad)}>
        {/* `min-h-full` so the empty state's own centring still has a box to
            centre inside once the column, rather than the scrollport, is the
            prompts' parent. */}
        <div className={clsx(layout.column, layout.threadGap, 'flex min-h-full flex-col')}>
        {/* The grounded facts join the same gate: questions paint once,
            already grounded, rather than appearing generic and re-ranking a
            moment later. One transition, which is the whole point of the
            gate. A failed fetch still resolves, so this cannot hang. */}
        {(isRestoringConversation || isLoadingPromptFacts || isConfigResolving) ? (
          /*
            Not known yet, so nothing claimed.

            Opening the panel on an asset used to paint the empty state first,
            then rewrite its prompts once the tag labels landed, then replace
            the whole screen with the restored thread. Each paint was honest
            about what was known at the time, which is exactly the problem:
            "we have not looked yet" and "there is nothing here" rendered the
            same.

            An empty column rather than a skeleton or a spinner. The header,
            the context chips and the composer are already painted, so the
            pane reads as open and working, and a placeholder that survives
            300ms is the flash this change exists to remove. No timer, no
            minimum duration: the gate is the data landing.
          */
          <div data-testid="ai-thread-settling" className="flex-1" aria-busy="true" />
        ) : messages.length === 0 ? (
          /* An empty thread. The prompts carry the explanation; if the prior
             message failed and got popped, the error rides above them so it
             does not just look as though nothing happened. */
          <AiPrompts
            suggestions={groundedSuggestions}
            onPick={handleSuggestionClick}
            header={<AiErrorNotice error={error} onRetry={retryLastSend} />}
            columns={layout.promptColumns}
          />
        ) : (
          <>
            {messages.map((message) => (
              <AiMessage
                key={message.id}
                message={message}
                modelLabel={modelLabelFor(message.model)}
                onTickerClick={handleTickerClick}
                /* The bubble's ceiling, and whether the evidence rail starts
                   open. Research mode is where sources get checked. */
                mode={mode}
                /* Structured recommendations arrive already validated against
                   the action catalogue and against this conversation's own
                   context. The pane never reads the prose to find them, and
                   the presentation layer never renders an action of its own. */
                footer={message.actions && message.actions.length > 0
                  ? <AISuggestedActions actions={message.actions} />
                  : null}
              />
            ))}

            {/* Loading indicator */}
            {/* Only while the answer has not started arriving. Once prose is
                streaming into the bubble above, a second spinner underneath it
                says nothing the reader cannot already see. The label is a
                grounded activity from the stream, never model text. */}
            {isLoading && !messages.some(m => m.streaming && m.content) && (
              <AiThinking status={status} onStop={cancelGeneration} />
            )}

            {/* Error message */}
            {error && (
              <div className="flex justify-center">
                <AiErrorNotice error={error} onRetry={retryLastSend} className="max-w-[85%]" />
              </div>
            )}

            <div ref={messagesEndRef} />
          </>
        )}
        </div>
      </div>

      {/* Input */}
      <div className={clsx('border-t border-gray-200 dark:border-gray-700', mode === 'research' ? 'px-6 py-4' : 'p-4')}>
        <div className={layout.column}>
        <div className="flex items-end space-x-2">
          <div className="flex-1 relative">
            <textarea
              ref={inputRef}
              value={input}
              onChange={handleInputChange}
              onKeyDown={handleKeyDown}
              placeholder={ACT_AI_PLACEHOLDER}
              className="w-full px-4 py-3 pr-12 border border-gray-300 dark:border-gray-600 rounded-lg resize-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500 dark:bg-gray-800 dark:text-white"
              rows={1}
              disabled={isLoading}
            />
          </div>
          <Button
            variant="primary"
            onClick={handleSend}
            disabled={!input.trim() || isLoading}
            className="h-12 w-12 p-0 flex items-center justify-center"
          >
            {isLoading ? (
              <Loader2 className="h-5 w-5 animate-spin" />
            ) : (
              <Send className="h-5 w-5" />
            )}
          </Button>
        </div>

        {/* Model selector and settings */}
        <div className="mt-2 flex items-center justify-between text-xs text-gray-500 dark:text-gray-400">
          <div className="relative" ref={modelSelectorRef}>
            <button
              onClick={() => canChangeModel && setShowModelSelector(!showModelSelector)}
              className="flex items-center space-x-1 hover:text-gray-700 dark:hover:text-gray-300 transition-colors"
              disabled={!canChangeModel}
              title={
                !canChangeModel && effectiveConfig.mode === 'byok'
                  ? 'Model is set by your organization admin'
                  : undefined
              }
            >
              <div className={clsx(
                'w-3 h-3 rounded-sm bg-gradient-to-br',
                currentProviderInfo?.color || 'from-gray-400 to-gray-600'
              )} />
              <span className="font-medium">{currentModelInfo?.name || currentModel}</span>
              {canChangeModel && <ChevronDown className="h-3 w-3" />}
            </button>

            {/* Model Selector Dropdown */}
            {showModelSelector && canChangeModel && (
              <div className="absolute bottom-full left-0 mb-2 w-72 max-h-80 overflow-y-auto bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg z-50">
                {/* Only show models for the org's configured provider — if
                    Anthropic is the BYOK key, an Opus pick is fine but a
                    GPT-4o pick would 401. Today's schema supports one
                    provider per org; if/when we move to multi-provider
                    keys, expand this list to the org's enabled providers. */}
                {(() => {
                  const provider = AI_PROVIDERS.find(p => p.id === currentProvider)
                  if (!provider) return null
                  const models = AI_MODELS[provider.id] || []
                  return (
                    <div>
                      <div className="px-3 py-2 bg-gray-50 dark:bg-gray-700/50 border-b border-gray-200 dark:border-gray-700">
                        <div className="flex items-center space-x-2">
                          <div className={clsx('w-4 h-4 rounded bg-gradient-to-br', provider.color)} />
                          <span className="font-medium text-gray-900 dark:text-white text-sm">{provider.name}</span>
                        </div>
                      </div>
                      <div className="py-1">
                        {models.length === 0 ? (
                          <div className="px-3 py-2 text-xs text-gray-400 italic">No models configured.</div>
                        ) : models.map((model) => (
                          <button
                            key={model.id}
                            onClick={() => handleModelChange(model.id)}
                            className={clsx(
                              'w-full text-left px-3 py-2 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors',
                              currentModel === model.id && 'bg-primary-50 dark:bg-primary-900/20'
                            )}
                          >
                            <div className="flex items-center justify-between">
                              <span className={clsx(
                                'text-sm',
                                currentModel === model.id ? 'text-primary-600 dark:text-primary-400 font-medium' : 'text-gray-700 dark:text-gray-300'
                              )}>
                                {model.name}
                              </span>
                              {model.recommended && (
                                <span className="px-1.5 py-0.5 text-[10px] bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400 rounded">
                                  Best
                                </span>
                              )}
                            </div>
                            <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-0.5">{model.description}</p>
                          </button>
                        ))}
                      </div>
                    </div>
                  )
                })()}
              </div>
            )}
          </div>
          <button
            onClick={onOpenSettings}
            className="hover:text-primary-600 dark:hover:text-primary-400 flex items-center space-x-1"
          >
            <Settings className="h-3 w-3" />
            <span>Settings</span>
          </button>
        </div>
        </div> {/* reading column */}
      </div>
      </div> {/* main pane */}
    </div>
  )
}

