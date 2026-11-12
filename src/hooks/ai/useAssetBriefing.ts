/**
 * The briefing, fetched through the one AI backend there is.
 *
 * ── Why a raw fetch to the same function ─────────────────────────────────
 *
 * `ai-chat` already assembles the caller-scoped context, runs the research
 * tools, and returns prose plus the tool calls behind it. A briefing is one
 * assistant turn with a research trail, which is precisely what that function
 * produces, so this sends it a question and renders the answer through the
 * same components the chat pane uses.
 *
 * What it deliberately is NOT: a second AI backend, a second conversation
 * engine, or a second copy of the three-status rule. Those would each be a
 * place for the briefing to start saying something the pane does not.
 *
 * `purpose: 'analysis'` rather than `'chat'`, which the response policy maps
 * to standard verbosity. A briefing is read, not conversed with, so brief is
 * too short and deep is an essay nobody asked for.
 *
 * ── Why nothing happens until the reader asks ────────────────────────────
 *
 * A briefing costs a model call and several seconds of tool lookups. Running
 * one on every asset page open would spend that on every reader who was
 * passing through, and would put a spinner on a page that currently paints
 * immediately. So `enabled` is false until the reader presses the button, and
 * the result is then cached under a key that includes the signals, so
 * reopening the asset shows the briefing again without paying twice.
 *
 * ── Permission scope ────────────────────────────────────────────────────
 *
 * RLS posture: nothing new. The request carries the reader's own session
 * token and `ai-chat` builds a caller-scoped client from it, so every
 * retrieval inside the briefing is bounded exactly as the chat pane's is, and
 * each tool result carries its own visibility declaration. No table is read
 * here directly and no policy is involved in this file.
 */
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import {
  briefingKey,
  briefingQuestion,
  type BriefingContext,
  type BriefingRequestInput,
} from '../../lib/ai/briefing'
import type { AiRenderableMessage, MessageToolCall } from '../../lib/ai/presentation'

export interface AssetBriefing {
  /** The answer, as the shared presentation layer renders it. */
  message: AiRenderableMessage
  /** What it looked up, for the research trail. */
  toolCalls: MessageToolCall[]
}

export interface UseAssetBriefingInput extends BriefingRequestInput {
  assetId: string
  /** False until the reader asks. Nothing is fetched before that. */
  enabled: boolean
}

/**
 * How long a briefing stays fresh.
 *
 * Long, because the key already changes when the signals do. Within one
 * sitting the briefing should be the thing the reader read a minute ago, not
 * a slightly different one each time they switch modes and come back.
 */
const STALE_MS = 10 * 60_000

export function useAssetBriefing(input: UseAssetBriefingInput) {
  const { assetId, context, enabled, signals } = input

  return useQuery<AssetBriefing>({
    queryKey: briefingKey({ assetId, context, signals }),
    enabled: enabled && Boolean(assetId),
    staleTime: STALE_MS,
    gcTime: 30 * 60_000,
    /* Not retried. A failed briefing shows its error with a Retry the reader
       presses, because a silent second model call is money they did not
       agree to spend. */
    retry: false,
    refetchOnWindowFocus: false,
    queryFn: async (): Promise<AssetBriefing> => {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session?.access_token) throw new Error('Not signed in')

      const res = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/ai-chat`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({
            message: briefingQuestion(input),
            purpose: 'analysis',
            /* A briefing has no history. It is the first and only turn, and
               sending an unrelated thread would change the answer. */
            conversationHistory: [],
            /* The subject, so the function assembles this asset's context
               rather than making the model search for it by name. */
            tags: [{ type: 'asset', id: assetId }],
          }),
        },
      )

      if (!res.ok) {
        /* The function's own message where it gave one. A status code is not
           something to show a portfolio manager. */
        let detail = `The briefing could not be generated (${res.status}).`
        try {
          const body = await res.json()
          if (typeof body?.error === 'string' && body.error) detail = body.error
        } catch {
          /* A non-JSON error body. The status-based sentence stands. */
        }
        throw new Error(detail)
      }

      const body = await res.json()
      const text = typeof body?.response === 'string' ? body.response : ''
      if (!text.trim()) {
        /* An empty answer is a failure, not a briefing that found nothing.
           The latter is prose saying so, which the question explicitly
           permits. */
        throw new Error('The briefing came back empty.')
      }

      const toolCalls: MessageToolCall[] = Array.isArray(body?.tool_calls) ? body.tool_calls : []

      return {
        message: {
          id: `briefing:${assetId}:${context}`,
          role: 'assistant',
          content: text,
          timestamp: new Date(),
          model: typeof body?.model === 'string' ? body.model : null,
          tool_calls: toolCalls,
          citations: Array.isArray(body?.citations) ? body.citations : undefined,
        },
        toolCalls,
      }
    },
  })
}

/** Re-exported so a surface needs one import to render a briefing. */
export type { BriefingContext }
