import { useState, useCallback, useEffect, useMemo, useRef } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { useAuth } from './useAuth'
import { useAIConfig } from './useAIConfig'

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

interface SendMessageParams {
  message: string
}

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

function rehydrateMessage(m: any): ChatMessage {
  return {
    id: String(m.id),
    role: m.role,
    content: String(m.content || ''),
    timestamp: m.timestamp ? new Date(m.timestamp) : new Date(),
    model: m.model ?? null,
    citations:  Array.isArray(m.citations)  ? m.citations  : undefined,
    tool_calls: Array.isArray(m.tool_calls) ? m.tool_calls : undefined,
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
  const { data: conversations = [], isLoading: isLoadingList } = useQuery<AIConversation[]>({
    queryKey: ['ai-conversations', user?.id],
    queryFn: async () => {
      if (!user?.id) return []
      const { data, error } = await supabase
        .from('ai_conversations')
        .select('*')
        .eq('user_id', user.id)
        .eq('is_archived', false)
        .order('is_pinned', { ascending: false })
        .order('last_message_at', { ascending: false, nullsFirst: false })
        .limit(200)
      if (error) throw error
      return (data || []) as AIConversation[]
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
    const found = conversationsWithTags.find(c => c.id === id)
    if (found) {
      setConversationId(found.id)
      setMessages((found.messages || []).map(rehydrateMessage))
      setTagsState(found.tags || [])
      return
    }
    const { data, error } = await supabase
      .from('ai_conversations').select('*').eq('id', id).single()
    if (error) throw error
    setConversationId(id)
    setMessages(((data as any).messages || []).map(rehydrateMessage))
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
  const sendMessageMutation = useMutation({
    mutationFn: async ({ message }: SendMessageParams) => {
      if (!user) throw new Error('Not authenticated')
      if (!effectiveConfig.isConfigured) {
        throw new Error('AI not configured. Please set up AI in Settings.')
      }
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) throw new Error('No session')

      // Defensive: messages/tags come from React state and should always
      // be arrays, but guard against undefined-`.map` errors that'd surface
      // as opaque "Cannot read properties of undefined" failures.
      const safeMessages = Array.isArray(messages) ? messages : []
      const safeTags     = Array.isArray(tags)     ? tags     : []

      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/ai-chat`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({
            message,
            purpose: 'chat',
            conversationHistory: safeMessages.map(m => ({ role: m.role, content: m.content })),
            tags: safeTags.map(t => ({ type: t.type, id: t.id })),
          }),
        },
      )

      if (!response.ok) {
        const error = await response.json().catch(() => ({}))
        throw new Error(error.error || `Failed to get AI response (HTTP ${response.status})`)
      }
      const data = await response.json().catch(() => ({} as any))

      // Belt-and-suspenders: every field arrives as the expected type
      // (or its safe default) so downstream destructure + .length calls
      // can't crash. The earlier omission of `tool_calls` here was the
      // root cause of the "undefined .length" error users saw.
      return {
        response:   typeof data.response === 'string' ? data.response : '',
        model:      typeof data.model    === 'string' ? data.model    : null,
        citations:  Array.isArray(data.citations)  ? data.citations  : [],
        tool_calls: Array.isArray(data.tool_calls) ? data.tool_calls : [],
      }
    },
    onMutate: async ({ message }) => {
      const userMessage: ChatMessage = {
        id: `user-${Date.now()}`,
        role: 'user',
        content: message,
        timestamp: new Date(),
      }
      setMessages(prev => [...prev, userMessage])
    },
    onSuccess: async ({ response, model, citations, tool_calls }, vars) => {
      const assistantMessage: ChatMessage = {
        id: `assistant-${Date.now()}`,
        role: 'assistant',
        content: response,
        timestamp: new Date(),
        model,
        citations:  citations.length  > 0 ? citations  : undefined,
        tool_calls: tool_calls.length > 0 ? tool_calls : undefined,
      }
      // Functional updater: capture the actual current messages (which
      // already include the user message added in onMutate). Reading the
      // closure variable here was the source of an earlier persist bug
      // where only the user message landed in the DB.
      let nextMessages: ChatMessage[] = []
      setMessages(prev => {
        nextMessages = [...prev, assistantMessage]
        return nextMessages
      })
      const { conversationId: newId, isNew } = await persistConversation(
        nextMessages, vars.message, tags,
      )

      // Async title generation for new conversations.
      if (isNew && newId) {
        const { data: { session } } = await supabase.auth.getSession()
        if (session) {
          generateConversationTitle(vars.message, response, session.access_token)
            .then(title => {
              if (title) {
                supabase.from('ai_conversations').update({ title }).eq('id', newId)
                  .then(() => queryClient.invalidateQueries({ queryKey: ['ai-conversations'] }))
              }
            }).catch(console.error)
        }
      }
    },
    onError: () => {
      setMessages(prev => prev.slice(0, -1))
    },
  })

  // ─── Persist ───────────────────────────────────────────────────────────
  const persistConversation = useCallback(async (
    nextMessages: ChatMessage[],
    firstUserMessageOnCreate: string,
    snapshotTags: TagRef[],
  ): Promise<{ conversationId: string | null; isNew: boolean }> => {
    if (!user?.id) return { conversationId: null, isNew: false }

    const nowIso = new Date().toISOString()
    if (conversationId) {
      const { error } = await supabase
        .from('ai_conversations')
        .update({
          messages: nextMessages,
          last_message_at: nowIso,
          updated_at: nowIso,
        })
        .eq('id', conversationId)
      if (error) console.error('Failed to update conversation:', error)
      queryClient.invalidateQueries({ queryKey: ['ai-conversations'] })
      return { conversationId, isNew: false }
    } else {
      const { data, error } = await supabase
        .from('ai_conversations')
        .insert({
          user_id: user.id,
          title: deriveTitleFromMessage(firstUserMessageOnCreate),
          messages: nextMessages,
          last_message_at: nowIso,
        })
        .select()
        .single()
      if (error) {
        console.error('Failed to create conversation:', error)
        return { conversationId: null, isNew: false }
      }
      setConversationId(data.id)
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
  }, [user?.id, conversationId, queryClient])

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
      setConversationId(candidates[0].id)
      setMessages((candidates[0].messages || []).map(rehydrateMessage))
      setTagsState(candidates[0].tags || initialTags)
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
    sendMessage:      (m: string) => sendMessageMutation.mutate({ message: m }),
    sendMessageAsync: (m: string) => sendMessageMutation.mutateAsync({ message: m }),
    isLoading: sendMessageMutation.isPending,
    error: sendMessageMutation.error,

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
