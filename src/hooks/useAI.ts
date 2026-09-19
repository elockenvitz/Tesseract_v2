import { useState, useCallback, useEffect, useMemo, useRef } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { useAuth } from './useAuth'
import { useAIConfig } from './useAIConfig'
import {
  resolveResponsePolicy,
  parseAiResponse,
  boundHistory,
  consumeAiStream,
  createMarks,
  deriveLatency,
  statusLabel,
  createRequestContext,
  createInFlight,
  cancelInFlight,
  shouldApplyToView,
  type AiAction,
  type AiEvidence,
  type AiObjectRef,
  type AiObjectType,
  type AiInFlightRequest,
  type AiLatency,
  type RejectedAiAction,
  type ViewState,
} from '../lib/ai'

// ─── Types ─────────────────────────────────────────────────────────────────

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  timestamp: Date
  // Model that produced this assistant message. Captured from the edge
  // function response so the UI can attribute each message — important
  // when users switch models mid-conversation. Null on user messages.
  model?: string | null
  // Source citations (Anthropic only). Each entry points back to a
  // context document the model drew from.
  citations?: MessageCitation[]
  // Research tools the model invoked while answering (Anthropic only).
  tool_calls?: MessageToolCall[]
  // ─── AI System V2 ───────────────────────────────────────────────────────
  // Validated Tesseract actions the model recommended. Already checked
  // against the catalogue and against this conversation's own context, so
  // the pane can render them as buttons without inspecting anything.
  // Absent on every message produced before V2, and on any response where
  // the model recommended nothing — which is a normal answer.
  actions?: AiAction[]
  // The few facts the answer rests on, each pointing at a context document.
  evidence?: AiEvidence[]
  // The longer treatment, present only when the user asked for depth.
  analysis?: string
  // Recommendations that were dropped, and why. Diagnostic only — never
  // rendered as an action. Not persisted.
  rejected?: RejectedAiAction[]
  // ─── Stage 2 ────────────────────────────────────────────────────────────
  // True while prose is still arriving. The bubble exists from the moment the
  // question is sent, so the reader sees where the answer will appear.
  streaming?: boolean
  // The stream ended without a terminal `final` event — a dropped connection
  // or a killed function. The prose that arrived is kept and no actions are
  // derived from it.
  truncated?: boolean
}

/** Server-reported phase timings for one request. Diagnostic. */
export interface AiTimings {
  auth?: number
  attribution?: number
  preflight?: number
  context?: number
  model?: number
  total?: number
  context_chars?: number
  prompt_chars?: number
  history_chars?: number
  output_chars?: number
  context_documents?: number
  context_dropped?: number
}

export interface MessageCitation {
  document_title: string
  cited_text:     string
}

// Surfaced from Anthropic tool use — each entry is a research lookup the
// model performed while answering. Lets the UI show a "Research" trail.
export interface MessageToolCall {
  name:  string
  input: Record<string, unknown>
  result_summary?: string
}

// Tag reference — a conversation can carry many of these. Drives both
// the data the AI sees and how the conversation list groups/filters.
// `label` is an optional display-name hint the parent can pass so the
// UI doesn't flash from "asset" → "AAPL" when the label-resolver query
// completes a beat later. Not persisted to DB.
export type TagType = 'asset' | 'portfolio' | 'theme' | 'note'
export interface TagRef {
  type:   TagType
  id:     string
  label?: string
}

export interface AIConversation {
  id: string
  user_id: string
  // Old single-context fields — kept for migration; not used by the UI.
  context_type: string | null
  context_id:   string | null
  title: string | null
  messages: ChatMessage[]
  is_archived: boolean
  is_pinned: boolean
  last_message_at: string | null
  created_at: string
  updated_at: string
  // Populated client-side from a separate query against ai_conversation_tags.
  tags?: TagRef[]
}

/**
 * A conversation as the SIDEBAR knows it — everything except the transcript.
 *
 * ── Why this type exists ──────────────────────────────────────────────────
 *
 * The list query used to be `select('*')` with `.limit(200)`, and `*` includes
 * `messages`: a single jsonb column holding every turn of the thread. So
 * opening the AI panel downloaded up to two hundred complete transcripts to
 * render a list of titles and dates, and that payload grew every time anybody
 * asked the model anything. The most expensive query in the feature was the
 * one that displays the least.
 *
 * Omitting the column is not enough on its own — three call sites read
 * `messages` off a row that came from this list, and any of them would have
 * silently started showing an empty thread. They now go through
 * `fetchConversationMessages`. This type is what stops a fourth from being
 * written: a summary has no `messages` to read, so the mistake is a type
 * error rather than a blank panel.
 *
 * It does NOT bound how large one transcript can get. See the note on
 * `fetchConversationMessages`.
 */
export type AIConversationSummary = Omit<AIConversation, 'messages'>

/**
 * The columns the sidebar actually renders, named rather than starred.
 *
 * `context_type` and `context_id` are dead for the UI but are on the type and
 * cheap; they stay so the summary is a real `Omit` of the row rather than a
 * second, subtly different shape.
 */
const CONVERSATION_SUMMARY_COLUMNS =
  'id, user_id, context_type, context_id, title, is_archived, is_pinned, last_message_at, created_at, updated_at'

// ─── Helpers ───────────────────────────────────────────────────────────────

function tagKey(t: TagRef): string {
  return `${t.type}:${t.id}`
}

// Initial title — placeholder while AI-generated title is in flight.
function deriveTitleFromMessage(message: string): string {
  const trimmed = message.trim().replace(/\s+/g, ' ')
  if (trimmed.length <= 60) return trimmed
  return trimmed.slice(0, 57).trimEnd() + '…'
}

// Generate a 3-6 word title via Haiku — adds ~$0.0003 per new conversation.
async function generateConversationTitle(
  userMsg: string,
  assistantMsg: string,
  accessToken: string,
): Promise<string | null> {
  try {
    const prompt =
      `Generate a concise title (3-6 words) summarizing this exchange. ` +
      `Output only the title — no quotes, no explanation, no punctuation at the end.\n\n` +
      `USER: ${userMsg.slice(0, 500)}\n\n` +
      `ASSISTANT: ${assistantMsg.slice(0, 800)}`

    const res = await fetch(
      `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/ai-chat`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${accessToken}`,
        },
        body: JSON.stringify({ message: prompt, purpose: 'snippet' }),
      },
    )
    if (!res.ok) return null
    const data = await res.json()
    let title = String(data.response || '').trim()
    title = title.replace(/^["'`]+|["'`]+$/g, '').replace(/[.!?]+$/, '').trim()
    if (!title || title.length > 80) return null
    return title
  } catch {
    return null
  }
}

/**
 * The transcript of one conversation, fetched only when it is about to be read.
 *
 * ── Why a transcript is never carried on a list row ───────────────────────
 *
 * One round trip for the thread the reader opened, instead of two hundred
 * transcripts fetched on the chance that one of them is opened. The three
 * call sites that used to read `messages` off a cached list row now come
 * through here, and `AIConversationSummary` makes a fourth impossible to
 * write by accident.
 *
 * ── What this does NOT fix ────────────────────────────────────────────────
 *
 * One long thread is still one unbounded jsonb value: `saveConversation`
 * rewrites the whole array on every turn, so a hundred-turn conversation
 * re-uploads ninety-nine turns to append the hundredth, and this function
 * downloads all of it to open the thread. That is the write half, and it
 * cannot be bounded from here.
 *
 * Truncating on write would delete the reader's own transcript, which is not
 * ours to drop — the sidebar reads it back and a research thread is a record.
 * The honest fix is `ai_conversation_messages`, one row per turn, appended
 * rather than rewritten, and that is a migration plus a backfill of every
 * existing jsonb array. Drafted, not applied — see
 * docs/tickets/ai-conversation-transcript-storage.md.
 *
 * Until then this function is where the cost is paid, and it is paid once
 * per thread opened rather than on every panel render.
 */
async function fetchConversationMessages(id: string): Promise<ChatMessage[]> {
  const { data, error } = await supabase
    .from('ai_conversations')
    .select('messages')
    .eq('id', id)
    .single()
  if (error) throw error
  const raw = (data as { messages?: unknown } | null)?.messages
  return Array.isArray(raw) ? raw.map(rehydrateMessage) : []
}

function rehydrateMessage(m: any): ChatMessage {
  return {
    id: String(m.id),
    role: m.role,
    content: String(m.content || ''),
    timestamp: m.timestamp ? new Date(m.timestamp) : new Date(),
    model: m.model ?? null,
    citations:  Array.isArray(m.citations)  ? m.citations  : undefined,
    tool_calls: Array.isArray(m.tool_calls) ? m.tool_calls : undefined,
    // Persisted actions are re-validated on use, not on load: the objects a
    // stored action names may since have been deleted or become invisible to
    // this reader. Loading them here only restores what the pane will show.
    actions:    Array.isArray(m.actions)    ? m.actions    : undefined,
    evidence:   Array.isArray(m.evidence)   ? m.evidence   : undefined,
    analysis:   typeof m.analysis === 'string' ? m.analysis : undefined,
  }
}

// ─── Hook ──────────────────────────────────────────────────────────────────

export function useAI(initialTags: TagRef[] = []) {
  const { user } = useAuth()
  const { effectiveConfig } = useAIConfig()
  const queryClient = useQueryClient()

  // Tags own the "what is this conversation about" — replaces the old
  // single context_type/context_id pair. Multiple tags allowed.
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [tags, setTagsState] = useState<TagRef[]>(initialTags)
  const [conversationId, setConversationId] = useState<string | null>(null)
  // Track the parent's `initialTags` as state (not a ref) so changes
  // re-trigger the auto-load effect. The previous ref-based version
  // captured the prop ONCE on mount, so navigating from AMZN → AAPL
  // never updated the panel — stale tags + stale conversation.
  const [initialTagsKey, setInitialTagsKey] = useState(
    initialTags.map(tagKey).sort().join('|'),
  )

  // Detect parent prop changes (user navigated to a different asset/etc.)
  // and reset the panel: clear the current conversation + adopt the new
  // tags. The auto-load effect below then surfaces the most recent
  // matching conversation, or leaves a blank canvas.
  useEffect(() => {
    const newKey = initialTags.map(tagKey).sort().join('|')
    if (newKey === initialTagsKey) return
    setInitialTagsKey(newKey)
    setConversationId(null)
    setMessages([])
    setTagsState(initialTags)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialTags])

  // ─── Conversations list ────────────────────────────────────────────────
  const { data: conversations = [], isLoading: isLoadingList } = useQuery<AIConversationSummary[]>({
    queryKey: ['ai-conversations', user?.id],
    queryFn: async () => {
      if (!user?.id) return []
      const { data, error } = await supabase
        .from('ai_conversations')
        .select(CONVERSATION_SUMMARY_COLUMNS)
        .eq('user_id', user.id)
        .eq('is_archived', false)
        .order('is_pinned', { ascending: false })
        .order('last_message_at', { ascending: false, nullsFirst: false })
        .limit(200)
      if (error) throw error
      return (data || []) as unknown as AIConversationSummary[]
    },
    enabled: !!user?.id,
    staleTime: 30_000,
  })

  // ─── Tags per conversation ─────────────────────────────────────────────
  // One query that returns ALL tags for the user's conversations; grouped
  // client-side into a Map for the sidebar to render.
  const conversationIdKey = useMemo(
    () => conversations.map(c => c.id).join('|'),
    [conversations],
  )
  const { data: tagsByConvId } = useQuery<Map<string, TagRef[]>>({
    queryKey: ['ai-conversation-tags', conversationIdKey],
    queryFn: async () => {
      const ids = conversationIdKey.split('|').filter(Boolean)
      const map = new Map<string, TagRef[]>()
      if (ids.length === 0) return map
      const { data } = await supabase
        .from('ai_conversation_tags')
        .select('conversation_id, tag_type, tag_id')
        .in('conversation_id', ids)
      for (const row of (data || []) as any[]) {
        const arr = map.get(row.conversation_id) || []
        arr.push({ type: row.tag_type as TagType, id: row.tag_id })
        map.set(row.conversation_id, arr)
      }
      return map
    },
    enabled: conversationIdKey.length > 0,
    staleTime: 30_000,
  })

  // Decorate conversations with their tags so the list can render chips.
  const conversationsWithTags = useMemo(() => {
    if (!tagsByConvId) return conversations
    return conversations.map(c => ({ ...c, tags: tagsByConvId.get(c.id) || [] }))
  }, [conversations, tagsByConvId])

  // ─── Tag display labels ────────────────────────────────────────────────
  // Resolve every unique (type, id) referenced by either a conversation
  // tag or the current selection — used for chip labels everywhere.
  const allTagRefsKey = useMemo(() => {
    const s = new Set<string>()
    if (tagsByConvId) {
      for (const arr of tagsByConvId.values()) for (const t of arr) s.add(tagKey(t))
    }
    for (const t of tags) s.add(tagKey(t))
    return [...s].sort().join('|')
  }, [tagsByConvId, tags])

  const { data: tagLabels } = useQuery<Record<string, string>>({
    queryKey: ['ai-tag-labels', allTagRefsKey],
    queryFn: async () => {
      const out: Record<string, string> = {}
      const byKind: Record<TagType, string[]> = { asset: [], portfolio: [], theme: [], note: [] }
      for (const key of allTagRefsKey.split('|').filter(Boolean)) {
        const sep = key.indexOf(':')
        if (sep < 0) continue
        const type = key.slice(0, sep) as TagType
        const id   = key.slice(sep + 1)
        if (type in byKind) byKind[type].push(id)
      }
      if (byKind.asset.length) {
        const { data } = await supabase
          .from('assets').select('id, symbol, company_name').in('id', byKind.asset)
        for (const a of data || []) {
          out[`asset:${a.id}`] = (a as any).symbol || (a as any).company_name || (a as any).id.slice(0, 8)
        }
      }
      if (byKind.portfolio.length) {
        const { data } = await supabase
          .from('portfolios').select('id, name').in('id', byKind.portfolio)
        for (const p of data || []) out[`portfolio:${(p as any).id}`] = (p as any).name || (p as any).id.slice(0, 8)
      }
      if (byKind.theme.length) {
        const { data } = await supabase
          .from('themes').select('id, name').in('id', byKind.theme)
        for (const t of data || []) out[`theme:${(t as any).id}`] = (t as any).name || (t as any).id.slice(0, 8)
      }
      return out
    },
    enabled: allTagRefsKey.length > 0,
    staleTime: 5 * 60 * 1000,
  })

  // Seed labels from initialTags so the first render has display names for
  // whatever the parent launched the panel with — no flash from "asset" →
  // "AMZN" while the resolver query loads. The query result merges in.
  const seededTagLabels = useMemo(() => {
    const out: Record<string, string> = {}
    for (const t of initialTags) {
      if (t.label) out[tagKey(t)] = t.label
    }
    for (const t of tags) {
      if (t.label) out[tagKey(t)] = t.label
    }
    return { ...out, ...(tagLabels || {}) }
  }, [initialTags, tags, tagLabels])

  // ─── Tag mutations ─────────────────────────────────────────────────────
  // Local state updates immediately. If a conversation is loaded, the
  // change is also persisted to ai_conversation_tags so it survives reload.
  const persistTagAdd = useCallback(async (tag: TagRef) => {
    if (!conversationId) return
    await supabase.from('ai_conversation_tags').upsert(
      { conversation_id: conversationId, tag_type: tag.type, tag_id: tag.id },
      { onConflict: 'conversation_id,tag_type,tag_id' },
    )
    queryClient.invalidateQueries({ queryKey: ['ai-conversation-tags'] })
  }, [conversationId, queryClient])

  const persistTagRemove = useCallback(async (tag: TagRef) => {
    if (!conversationId) return
    await supabase.from('ai_conversation_tags').delete()
      .eq('conversation_id', conversationId)
      .eq('tag_type', tag.type)
      .eq('tag_id', tag.id)
    queryClient.invalidateQueries({ queryKey: ['ai-conversation-tags'] })
  }, [conversationId, queryClient])

  const addTag = useCallback((tag: TagRef) => {
    setTagsState(prev => {
      if (prev.find(t => t.type === tag.type && t.id === tag.id)) return prev
      return [...prev, tag]
    })
    persistTagAdd(tag).catch(console.error)
  }, [persistTagAdd])

  const removeTag = useCallback((tag: TagRef) => {
    setTagsState(prev => prev.filter(t => !(t.type === tag.type && t.id === tag.id)))
    persistTagRemove(tag).catch(console.error)
  }, [persistTagRemove])

  const setTags = useCallback((next: TagRef[]) => {
    setTagsState(next)
    // No bulk persist — caller can use addTag/removeTag for that. setTags
    // is for the new-conversation reset case where there's no convo yet.
  }, [])

  // ─── Conversation actions ──────────────────────────────────────────────
  const selectConversation = useCallback(async (id: string) => {
    // The sidebar row is enough to name the thread and its tags; the
    // transcript is never on it. Two paths differing only in whether the tags
    // are already cached, so the id-fetch below stays the one that also
    // resolves tags for a conversation the list has not loaded.
    const found = conversationsWithTags.find(c => c.id === id)
    if (found) {
      setConversationId(found.id)
      setTagsState(found.tags || [])
      setMessages(await fetchConversationMessages(id))
      return
    }
    setConversationId(id)
    setMessages(await fetchConversationMessages(id))
    const { data: tagRows } = await supabase
      .from('ai_conversation_tags')
      .select('tag_type, tag_id').eq('conversation_id', id)
    setTagsState(((tagRows as any[]) || []).map(r => ({ type: r.tag_type as TagType, id: r.tag_id })))
  }, [conversationsWithTags])

  const newConversation = useCallback(() => {
    setConversationId(null)
    setMessages([])
    // Reset to whatever the parent suggested (e.g. AAPL when launched
    // from the AAPL page) — gives users a sensible starting point on
    // every new thread without re-typing tags.
    setTagsState(initialTags)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialTagsKey])

  // ─── Send message ──────────────────────────────────────────────────────
  //
  // Not a react-query mutation any more. A mutation's callbacks fire against
  // whatever the hook's state is when the promise settles, which is exactly
  // the bug this rewrite closes: a reader who asked about AMZN and then opened
  // MSFT had `tags`, `conversationId` and the action allowlist all pointing at
  // MSFT by the time AMZN's answer arrived. Everything the response needs is
  // now frozen into an `AiRequestContext` at submit time and travels with it.
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<Error | null>(null)
  const [status, setStatus] = useState<string | null>(null)
  const [latency, setLatency] = useState<AiLatency | null>(null)
  const inFlightRef = useRef<AiInFlightRequest | null>(null)

  // A ref mirror of the state the completion path must compare against.
  // Reading React state inside an async continuation gives the value from the
  // render that started the request, which is the stale read we are removing.
  const viewRef = useRef<ViewState>({ conversationId: null, tags: [] })
  viewRef.current = { conversationId, tags }

  /** Stop the in-flight request, if any. Safe to call at any time. */
  const cancelGeneration = useCallback((): boolean => {
    const cancelled = cancelInFlight(inFlightRef.current)
    if (cancelled) {
      inFlightRef.current = null
      setIsLoading(false)
      setStatus(null)
    }
    return cancelled
  }, [])

  // Abort on unmount. A request nobody will read is a request nobody should
  // pay for, and its completion must not write into a torn-down component.
  useEffect(() => () => { cancelInFlight(inFlightRef.current) }, [])

  const sendMessage = useCallback(async (message: string): Promise<void> => {
    if (!user) { setError(new Error('Not authenticated')); return }
    if (!effectiveConfig.isConfigured) {
      setError(new Error('AI not configured. Please set up AI in Settings.')); return
    }
    if (!message.trim()) return

    // A second question supersedes the first. The reader asked for something
    // else; finishing the abandoned answer helps nobody and costs tokens.
    cancelInFlight(inFlightRef.current)

    const safeMessages = Array.isArray(messages) ? messages : []
    const safeTags     = Array.isArray(tags)     ? tags     : []

    const policy = resolveResponsePolicy({ message, purpose: 'chat' })
    const allowlist: AiObjectRef[] = safeTags
      .filter((t): t is TagRef & { type: AiObjectType } => t.type !== 'note')
      .map(t => ({ type: t.type, id: t.id, label: t.label }))

    const context = createRequestContext({
      conversationId, tags: safeTags, allowlist, policy, message,
    })
    const request = createInFlight(context)
    inFlightRef.current = request

    const marks = createMarks()
    setIsLoading(true)
    setError(null)
    setLatency(null)
    setStatus(null)

    // The user's message and an empty assistant bubble go up together, so the
    // reader sees where the answer will appear before it starts arriving.
    const userMessage: ChatMessage = {
      id: `user-${context.requestId}`, role: 'user', content: message, timestamp: new Date(),
    }
    const assistantId = `assistant-${context.requestId}`
    setMessages(prev => [
      ...prev,
      userMessage,
      { id: assistantId, role: 'assistant', content: '', timestamp: new Date(), streaming: true },
    ])

    /** Only touch the view when the reader is still looking at this thread. */
    const applyToView = (fn: (prev: ChatMessage[]) => ChatMessage[]) => {
      if (!shouldApplyToView(context, viewRef.current)) return
      setMessages(fn)
    }

    let streamed = false
    let serverTimings: Record<string, number> | null = null

    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) throw new Error('No session')

      const bounded = boundHistory(safeMessages.map(m => ({ role: m.role, content: m.content })))

      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/ai-chat`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${session.access_token}`,
          },
          signal: request.controller.signal,
          body: JSON.stringify({
            message,
            purpose: 'chat',
            stream: true,
            verbosity: policy.verbosity,
            structured: true,
            maxActions: policy.maxActions,
            maxEvidence: policy.maxEvidence,
            conversationHistory: bounded.messages,
            tags: safeTags.map(t => ({ type: t.type, id: t.id })),
          }),
        },
      )

      // Config and rate-limit failures are still status codes, not stream
      // frames, so this check is unchanged from the non-streaming path.
      if (!response.ok) {
        const err = await response.json().catch(() => ({}))
        throw new Error(err.error || `Failed to get AI response (HTTP ${response.status})`)
      }

      const outcome = await consumeAiStream(response, {
        onText: (delta) => {
          applyToView(prev => prev.map(m =>
            m.id === assistantId ? { ...m, content: m.content + delta } : m))
        },
        onStatus: (event) => {
          if (shouldApplyToView(context, viewRef.current)) setStatus(statusLabel(event))
        },
        onMeta: (event) => { streamed = true; serverTimings = event.timings },
      }, marks)

      if (request.status === 'cancelled') return

      serverTimings = outcome.final?.timings ?? serverTimings

      if (outcome.error) throw new Error(outcome.error.message)
      if (outcome.truncated && !outcome.visible.trim()) {
        throw new Error('The AI response was interrupted before it started.')
      }

      // The envelope is parsed here, against THIS request's frozen allowlist —
      // never against whatever the pane is bound to now. A truncated stream
      // has no `final`, so it keeps its prose and derives no actions at all.
      const envelope = outcome.truncated
        ? { answer: outcome.visible.trim(), evidence: [] as AiEvidence[], actions: [] as AiAction[], rejected: [] as RejectedAiAction[], analysis: undefined }
        : parseAiResponse(outcome.raw, { allowlist: context.allowlist, policy: context.policy })

      const finalMessage: ChatMessage = {
        id: assistantId,
        role: 'assistant',
        content: envelope.answer,
        timestamp: new Date(),
        model: outcome.final?.model ?? null,
        citations:  outcome.final?.citations?.length  ? outcome.final.citations  : undefined,
        tool_calls: outcome.final?.tool_calls?.length ? outcome.final.tool_calls : undefined,
        actions:    envelope.actions.length  > 0 ? envelope.actions  : undefined,
        evidence:   envelope.evidence.length > 0 ? envelope.evidence : undefined,
        analysis:   envelope.analysis,
        rejected:   envelope.rejected.length > 0 ? envelope.rejected : undefined,
        truncated:  outcome.truncated || undefined,
      }

      // Build the thread to persist from the frozen history plus this
      // exchange, rather than from current state — state may now belong to a
      // different conversation entirely.
      const persisted: ChatMessage[] = [...safeMessages, userMessage, finalMessage]
      applyToView(prev => prev.map(m => (m.id === assistantId ? finalMessage : m)))

      const { conversationId: newId, isNew } = await persistConversation(
        persisted, context.message, context.tags as TagRef[], context.conversationId,
      )

      // Adopt the new thread's id only if the reader is still on it. A reader
      // who navigated away gets the answer in their conversation list, and the
      // pane they moved to keeps its own identity.
      if (isNew && newId && shouldApplyToView(context, viewRef.current)) {
        setConversationId(newId)
      }

      if (isNew && newId) {
        const { data: { session: s2 } } = await supabase.auth.getSession()
        if (s2) {
          generateConversationTitle(context.message, envelope.answer, s2.access_token)
            .then(title => {
              if (title) {
                supabase.from('ai_conversations').update({ title }).eq('id', newId)
                  .then(() => queryClient.invalidateQueries({ queryKey: ['ai-conversations'] }))
              }
            }).catch(console.error)
        }
      }

      request.status = 'done'
      setLatency(deriveLatency(marks, serverTimings, streamed))
    } catch (e) {
      // An abort is the reader's own decision, not a failure to report.
      const aborted = request.status === 'cancelled'
        || (e instanceof DOMException && e.name === 'AbortError')
      if (!aborted) {
        request.status = 'error'
        setError(e instanceof Error ? e : new Error('The AI request failed.'))
      }
      // Remove the placeholder pair only from the view it was added to.
      applyToView(prev => prev.filter(m => m.id !== assistantId && m.id !== userMessage.id))
    } finally {
      if (inFlightRef.current === request) {
        inFlightRef.current = null
        setIsLoading(false)
        setStatus(null)
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, effectiveConfig.isConfigured, messages, tags, conversationId, queryClient])

  // ─── Persist ───────────────────────────────────────────────────────────
  const persistConversation = useCallback(async (
    nextMessages: ChatMessage[],
    firstUserMessageOnCreate: string,
    snapshotTags: TagRef[],
    // The conversation the REQUEST belonged to, not the one the pane is
    // showing now. Reading the live `conversationId` here would write AMZN's
    // answer into whichever thread the reader happened to open while it ran.
    targetConversationId: string | null,
  ): Promise<{ conversationId: string | null; isNew: boolean }> => {
    if (!user?.id) return { conversationId: null, isNew: false }

    const nowIso = new Date().toISOString()
    if (targetConversationId) {
      const { error } = await supabase
        .from('ai_conversations')
        .update({
          messages: nextMessages,
          last_message_at: nowIso,
          updated_at: nowIso,
        })
        .eq('id', targetConversationId)
      if (error) console.error('Failed to update conversation:', error)
      queryClient.invalidateQueries({ queryKey: ['ai-conversations'] })
      return { conversationId: targetConversationId, isNew: false }
    } else {
      const { data, error } = await supabase
        .from('ai_conversations')
        .insert({
          user_id: user.id,
          title: deriveTitleFromMessage(firstUserMessageOnCreate),
          messages: nextMessages,
          last_message_at: nowIso,
        })
        // Only the id. A bare `.select()` echoes the whole row back, and the
        // largest thing in that row is the `messages` array we just uploaded —
        // so creating a conversation paid for the transcript twice, once up
        // and once down, for a value the caller already has in hand.
        .select('id')
        .single()
      if (error) {
        console.error('Failed to create conversation:', error)
        return { conversationId: null, isNew: false }
      }
      // Whether the pane adopts this id is the CALLER's decision — only it
      // knows whether the reader is still looking at the thread this answer
      // created. Adopting it here would repoint a pane the reader had already
      // navigated away from.
      // Insert tag rows for any tags currently set on the conversation.
      if (snapshotTags.length > 0) {
        await supabase.from('ai_conversation_tags').insert(
          snapshotTags.map(t => ({
            conversation_id: data.id,
            tag_type: t.type,
            tag_id: t.id,
          })),
        ).then(({ error: tagErr }) => {
          if (tagErr) console.error('Failed to insert tags:', tagErr)
        })
        queryClient.invalidateQueries({ queryKey: ['ai-conversation-tags'] })
      }
      queryClient.invalidateQueries({ queryKey: ['ai-conversations'] })
      return { conversationId: data.id, isNew: true }
    }
  }, [user?.id, queryClient])

  // ─── Conversation list mutations ───────────────────────────────────────
  const renameConversationMutation = useMutation({
    mutationFn: async ({ id, title }: { id: string; title: string }) => {
      const { error } = await supabase
        .from('ai_conversations').update({ title: title.trim() || null }).eq('id', id)
      if (error) throw error
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['ai-conversations'] }),
  })

  const archiveConversationMutation = useMutation({
    mutationFn: async ({ id, archived = true }: { id: string; archived?: boolean }) => {
      const { error } = await supabase
        .from('ai_conversations').update({ is_archived: archived }).eq('id', id)
      if (error) throw error
    },
    onSuccess: (_, vars) => {
      if (vars.id === conversationId && vars.archived !== false) {
        setConversationId(null)
        setMessages([])
      }
      queryClient.invalidateQueries({ queryKey: ['ai-conversations'] })
    },
  })

  const togglePinMutation = useMutation({
    mutationFn: async ({ id, pinned }: { id: string; pinned: boolean }) => {
      const { error } = await supabase
        .from('ai_conversations').update({ is_pinned: pinned }).eq('id', id)
      if (error) throw error
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['ai-conversations'] }),
  })

  const deleteConversationMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('ai_conversations').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: (_, id) => {
      if (id === conversationId) {
        setConversationId(null)
        setMessages([])
      }
      queryClient.invalidateQueries({ queryKey: ['ai-conversations'] })
    },
  })

  // ─── Auto-load most recent conversation that overlaps initialTags ─────
  // When a parent opens the AI panel from an asset/portfolio page, find
  // the most recent conversation whose tags include that object and load
  // it. Re-fires when the parent navigates to a different page (the
  // initialTagsKey state above) or when the conversation list grows.
  useEffect(() => {
    if (!user?.id || conversationId) return
    if (initialTags.length === 0 || conversationsWithTags.length === 0) return

    const initialKeys = new Set(initialTags.map(tagKey))
    const candidates = conversationsWithTags
      .filter(c => (c.tags || []).some(t => initialKeys.has(tagKey(t))))
      .sort((a, b) => (b.last_message_at || b.updated_at || '').localeCompare(a.last_message_at || a.updated_at || ''))

    if (candidates[0]) {
      const picked = candidates[0]
      setConversationId(picked.id)
      setTagsState(picked.tags || initialTags)
      // The transcript is fetched rather than read off the list row. This
      // effect re-fires whenever the parent navigates, so a slow fetch for
      // AAPL must not land in a pane the reader has since pointed at MSFT —
      // `cancelled` is the same guard the send path uses for the same reason.
      let cancelled = false
      fetchConversationMessages(picked.id)
        .then(loaded => { if (!cancelled) setMessages(loaded) })
        .catch(console.error)
      return () => { cancelled = true }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, initialTagsKey, conversationsWithTags.length])

  return {
    // State
    messages,
    tags,
    conversationId,
    isConfigured: effectiveConfig.isConfigured,
    configMode: effectiveConfig.mode,

    // Send
    // Fire-and-forget and awaitable are the same function now; the async
    // shape is kept so existing callers of either name keep working.
    sendMessage:      (m: string) => { void sendMessage(m) },
    sendMessageAsync: sendMessage,
    isLoading,
    error,
    // ─── Stage 2 ──────────────────────────────────────────────────────────
    /** Grounded activity text while the model works. Null when idle. */
    status,
    /** Stop the in-flight answer. Returns false when nothing was running. */
    cancelGeneration,
    /** Measured latency for the last completed request. TTFU is the one. */
    latency,

    // Tag actions
    addTag,
    removeTag,
    setTags,
    tagLabels: seededTagLabels,

    // Conversation list + selection
    conversations: conversationsWithTags,
    isLoadingList,
    selectConversation,
    newConversation,
    renameConversation: (id: string, title: string) => renameConversationMutation.mutate({ id, title }),
    archiveConversation: (id: string) => archiveConversationMutation.mutate({ id }),
    unarchiveConversation: (id: string) => archiveConversationMutation.mutate({ id, archived: false }),
    togglePin: (id: string, pinned: boolean) => togglePinMutation.mutate({ id, pinned }),
    deleteConversation: (id: string) => deleteConversationMutation.mutate(id),

    // Back-compat alias for the old "trash" handler.
    clearConversation: () => {
      if (conversationId) deleteConversationMutation.mutate(conversationId)
      else { setMessages([]); setConversationId(null) }
    },
  }
}

// ─── Suggested prompts ─────────────────────────────────────────────────────
// Suggestions adapt to whatever's tagged. Single object → object-specific
// prompts using its actual name (so users see "Analyze AAPL's thesis"
// rather than the generic "Analyze my thesis"). Multi-tag → comparison.
// No tags → generic market.
export function useAISuggestions(tags: TagRef[], tagLabels: Record<string, string> = {}) {
  if (tags.length === 0) {
    return [
      'What sectors are showing momentum?',
      'Explain the current market environment',
      'What should I be watching this week?',
    ]
  }
  const labelFor = (t: TagRef) => tagLabels[`${t.type}:${t.id}`] || t.type
  const onlyAssets = tags.every(t => t.type === 'asset')

  if (tags.length === 1) {
    const t = tags[0]
    const name = labelFor(t)
    if (t.type === 'asset') {
      return [
        `Analyze ${name}'s thesis for blind spots`,
        `Suggest bull/base/bear outcomes for ${name}`,
        `What are the key risks to the ${name} thesis?`,
        `Summarize the team's notes on ${name}`,
      ]
    }
    if (t.type === 'theme') {
      return [
        `Which assets have the most exposure to ${name}?`,
        `What are the key drivers of ${name}?`,
        `Suggest assets to add to ${name}`,
      ]
    }
    if (t.type === 'portfolio') {
      return [
        `Analyze ${name}'s sector allocation`,
        `What are ${name}'s concentration risks?`,
        `Suggest rebalancing actions for ${name}`,
      ]
    }
  }
  if (onlyAssets && tags.length > 1) {
    const names = tags.map(labelFor).join(' vs ')
    return [
      `Compare ${names} side by side`,
      `Which has the strongest thesis: ${names}?`,
      `How do the risks differ across ${names}?`,
    ]
  }
  return [
    `Synthesize what ${tags.map(labelFor).join(', ')} have in common`,
    `Highlight the biggest risks across ${tags.map(labelFor).join(', ')}`,
  ]
}
