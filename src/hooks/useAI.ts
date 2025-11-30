import { useState, useCallback } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { useAuth } from './useAuth'
import { useAIConfig } from './useAIConfig'

// Types
export interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  timestamp: Date
}

export interface AIContext {
  type: 'asset' | 'theme' | 'portfolio' | 'note' | null
  id: string | null
  title?: string
}

export interface AIConversation {
  id: string
  user_id: string
  context_type: string | null
  context_id: string | null
  title: string | null
  messages: ChatMessage[]
  created_at: string
  updated_at: string
}

interface SendMessageParams {
  message: string
  context?: AIContext
}

export function useAI(initialContext?: AIContext) {
  const { user } = useAuth()
  const { effectiveConfig } = useAIConfig()
  const queryClient = useQueryClient()

  // Local state for current conversation
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [context, setContext] = useState<AIContext>(initialContext || { type: null, id: null })
  const [conversationId, setConversationId] = useState<string | null>(null)

  // Fetch existing conversation for context
  const { data: existingConversation } = useQuery({
    queryKey: ['ai-conversation', user?.id, context.type, context.id],
    queryFn: async () => {
      if (!user?.id || !context.type || !context.id) return null

      const { data, error } = await supabase
        .from('ai_conversations')
        .select('*')
        .eq('user_id', user.id)
        .eq('context_type', context.type)
        .eq('context_id', context.id)
        .single()

      if (error && error.code !== 'PGRST116') throw error
      return data as AIConversation | null
    },
    enabled: !!user?.id && !!context.type && !!context.id,
  })

  // Load existing messages when conversation is found
  const loadConversation = useCallback((conversation: AIConversation | null) => {
    if (conversation) {
      setConversationId(conversation.id)
      setMessages(conversation.messages || [])
    } else {
      setConversationId(null)
      setMessages([])
    }
  }, [])

  // Send message mutation
  const sendMessageMutation = useMutation({
    mutationFn: async ({ message, context: msgContext }: SendMessageParams) => {
      if (!user) throw new Error('Not authenticated')
      if (!effectiveConfig.isConfigured) {
        throw new Error('AI not configured. Please set up AI in Settings.')
      }

      const activeContext = msgContext || context

      // Get the session for auth header
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) throw new Error('No session')

      // Call edge function
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
            conversationHistory: messages.map(m => ({
              role: m.role,
              content: m.content,
            })),
            context: activeContext.type ? {
              type: activeContext.type,
              id: activeContext.id,
              includeThesis: effectiveConfig.includeThesis,
              includeOutcomes: effectiveConfig.includeOutcomes,
              includeNotes: effectiveConfig.includeNotes,
              includeDiscussions: effectiveConfig.includeDiscussions,
            } : undefined,
          }),
        }
      )

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error || 'Failed to get AI response')
      }

      const data = await response.json()
      return data.response as string
    },
    onMutate: async ({ message }) => {
      // Optimistically add user message
      const userMessage: ChatMessage = {
        id: `user-${Date.now()}`,
        role: 'user',
        content: message,
        timestamp: new Date(),
      }
      setMessages(prev => [...prev, userMessage])
    },
    onSuccess: async (response) => {
      // Add assistant message
      const assistantMessage: ChatMessage = {
        id: `assistant-${Date.now()}`,
        role: 'assistant',
        content: response,
        timestamp: new Date(),
      }
      setMessages(prev => [...prev, assistantMessage])

      // Save conversation to database
      await saveConversation()
    },
    onError: (error) => {
      // Remove the optimistically added user message on error
      setMessages(prev => prev.slice(0, -1))
      console.error('AI Error:', error)
    },
  })

  // Save conversation to database
  const saveConversation = useCallback(async () => {
    if (!user?.id) return

    const conversationData = {
      user_id: user.id,
      context_type: context.type,
      context_id: context.id,
      messages: messages,
      updated_at: new Date().toISOString(),
    }

    if (conversationId) {
      // Update existing
      await supabase
        .from('ai_conversations')
        .update(conversationData)
        .eq('id', conversationId)
    } else if (context.type && context.id) {
      // Create new (only for context-aware conversations)
      const { data } = await supabase
        .from('ai_conversations')
        .upsert({
          ...conversationData,
          created_at: new Date().toISOString(),
        }, {
          onConflict: 'user_id,context_type,context_id',
        })
        .select()
        .single()

      if (data) {
        setConversationId(data.id)
      }
    }

    // Invalidate queries
    queryClient.invalidateQueries({ queryKey: ['ai-conversation'] })
  }, [user?.id, context, messages, conversationId, queryClient])

  // Clear conversation
  const clearConversation = useCallback(async () => {
    setMessages([])

    if (conversationId) {
      await supabase
        .from('ai_conversations')
        .delete()
        .eq('id', conversationId)

      setConversationId(null)
      queryClient.invalidateQueries({ queryKey: ['ai-conversation'] })
    }
  }, [conversationId, queryClient])

  // Update context
  const updateContext = useCallback((newContext: AIContext) => {
    setContext(newContext)
    setMessages([]) // Clear messages when context changes
    setConversationId(null)
  }, [])

  // Clear context (switch to general chat)
  const clearContext = useCallback(() => {
    setContext({ type: null, id: null })
    setMessages([])
    setConversationId(null)
  }, [])

  return {
    // State
    messages,
    context,
    conversationId,
    isConfigured: effectiveConfig.isConfigured,
    configMode: effectiveConfig.mode,

    // Actions
    sendMessage: (message: string) => sendMessageMutation.mutate({ message }),
    sendMessageAsync: (message: string) => sendMessageMutation.mutateAsync({ message }),
    clearConversation,
    updateContext,
    clearContext,
    loadConversation,

    // Loading states
    isLoading: sendMessageMutation.isPending,
    error: sendMessageMutation.error,

    // Existing conversation
    existingConversation,
  }
}

// Hook for suggested prompts based on context
export function useAISuggestions(context: AIContext) {
  const suggestions = (() => {
    if (!context.type) {
      return [
        'What sectors are showing momentum?',
        'Explain the current market environment',
        'What should I be watching this week?',
      ]
    }

    switch (context.type) {
      case 'asset':
        return [
          'Analyze my thesis for blind spots',
          'Suggest outcome scenarios',
          'What are the key risks?',
          'Summarize my notes',
        ]
      case 'theme':
        return [
          'Which assets have the most exposure?',
          'What are the key drivers?',
          'Suggest assets to add to this theme',
        ]
      case 'portfolio':
        return [
          'Analyze my sector allocation',
          'What are my concentration risks?',
          'Suggest rebalancing actions',
        ]
      default:
        return []
    }
  })()

  return suggestions
}
