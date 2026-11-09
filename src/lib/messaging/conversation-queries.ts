/**
 * The two reads behind the direct-messaging panel.
 *
 * They live here, out of the component, because what matters about them is the
 * NUMBER of round trips they make and how they fold the results together, and
 * neither can be tested against a component that needs auth, an organization
 * context, a router and a live Supabase client to mount.
 *
 * The header's unread-badge check was moved out for the same reason, into
 * `unread-direct-messages.ts`, but that change depends on a
 * `has_unread_direct_messages` RPC that is NOT applied to production, so it is
 * deliberately not part of this release. Do not add a reference to that file
 * here until its migration is applied and reconciled.
 *
 * ── What was wrong with them ─────────────────────────────────────────────
 *
 * Both were loops. The conversation list made 2 + 3N queries for N
 * conversations, on a 10s timer: a last message, the reader's own
 * `last_read_at`, and an unread count, each per conversation. The message list
 * made 1 + R queries for R replies, on a 2s timer, so the cost of having a
 * conversation open grew with the length of the conversation.
 *
 * Now: 2 + 2N for the list, and exactly 2 for the messages.
 *
 * The remaining 2N is deliberate and is NOT a further batch waiting to be
 * done. Both halves of it return a count or a single newest row per
 * conversation; replacing them with one query over all conversations would
 * mean fetching every message's timestamp and counting on the client, which
 * trades a small, bounded response for an unbounded one. Egress is one of the
 * things being brought down here, so that is not an improvement.
 */
import { supabase as defaultClient } from '../supabase'

type Client = Pick<typeof defaultClient, 'from'>

interface ParticipantRow {
  user_id: string
  is_admin?: boolean
  last_read_at: string | null
  user?: unknown
}

interface ConversationRow {
  id: string
  conversation_participants?: ParticipantRow[]
  [key: string]: unknown
}

interface MessageRow {
  id: string
  reply_to: string | null
  [key: string]: unknown
}

interface RepliedRow {
  id: string
  content: string
  user_id: string
  user?: unknown
}

/**
 * Every conversation the user takes part in, each with its newest message, the
 * user's own read position, and the number of messages from other people since
 * that position.
 */
export async function readConversationList(
  userId: string,
  client: Client = defaultClient
): Promise<unknown[]> {
  if (!userId) return []

  // First get conversation IDs where user is a participant
  const { data: userConversations, error: participantError } = await client
    .from('conversation_participants')
    .select('conversation_id')
    .eq('user_id', userId)

  if (participantError) throw participantError
  if (!userConversations || userConversations.length === 0) return []

  const conversationIds = userConversations.map((p: { conversation_id: string }) => p.conversation_id)

  /*
   * The participant rows carry `last_read_at` now. That one added column is
   * what removes a query per conversation: the row was already being fetched
   * here for the other participants' names.
   */
  const { data, error } = await client
    .from('conversations')
    .select(`
      *,
      conversation_participants(
        user_id,
        is_admin,
        last_read_at,
        user:users(id, email, first_name, last_name)
      )
    `)
    .in('id', conversationIds)
    .order('last_message_at', { ascending: false })

  if (error) throw error

  return await Promise.all(
    ((data || []) as ConversationRow[]).map(async (conv) => {
      const { data: lastMessage } = await client
        .from('conversation_messages')
        .select('content, user_id, created_at')
        .eq('conversation_id', conv.id)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()

      /*
       * The reader's own read position, from the rows already fetched above.
       *
       * The query this replaces was commented "fetch fresh to avoid stale
       * data", and nothing is lost: both read the same row in the same refresh
       * of the same query, so the value is exactly as fresh as the
       * conversation list it is displayed beside.
       *
       * The `user_id` match is load-bearing. These rows are every participant
       * of the conversation, so taking the first one would show the reader
       * somebody else's read position and, through the unread count below,
       * somebody else's badge.
       */
      const myParticipantRow = (conv.conversation_participants || []).find(
        (p) => p.user_id === userId
      )
      const lastReadAt = myParticipantRow?.last_read_at

      // Count unread messages (messages created after last_read_at)
      let unreadCount = 0
      if (lastReadAt) {
        const { count } = await client
          .from('conversation_messages')
          .select('*', { count: 'exact', head: true })
          .eq('conversation_id', conv.id)
          .neq('user_id', userId) // Don't count own messages
          .gt('created_at', lastReadAt)

        unreadCount = count || 0
      } else {
        // If never read, count all messages from others
        const { count } = await client
          .from('conversation_messages')
          .select('*', { count: 'exact', head: true })
          .eq('conversation_id', conv.id)
          .neq('user_id', userId)

        unreadCount = count || 0
      }

      return {
        ...conv,
        last_message: lastMessage,
        participants: conv.conversation_participants,
        unread_count: unreadCount,
      }
    })
  )
}

/** Every message in one conversation, with the messages they quote attached. */
export async function readConversationMessages(
  conversationId: string,
  client: Client = defaultClient
): Promise<unknown[]> {
  if (!conversationId) return []

  const { data: messagesData, error: messagesErr } = await client
    .from('conversation_messages')
    .select(`
      *,
      user:users(id, email, first_name, last_name)
    `)
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: true })

  if (messagesErr) {
    console.error('Error fetching messages:', messagesErr)
    throw messagesErr
  }

  const messages = (messagesData || []) as MessageRow[]

  /*
   * The quoted messages, in one query rather than one per reply.
   *
   * This was the worst-scaling query in the panel: one per message carrying a
   * `reply_to`, on every tick of a 2s timer, so the per-second cost grew with
   * the length of the conversation. A thread with ten replies cost eleven
   * queries per tick; this costs two.
   *
   * Behaviour is unchanged in both directions. A `reply_to` pointing at a
   * message the reader cannot see, or at a deleted one, is simply absent from
   * the result, which is what `maybeSingle()` returned as null. Set membership
   * also drops the duplicates the loop refetched when two messages quoted the
   * same one.
   */
  const replyIds = Array.from(
    new Set(messages.map((m) => m.reply_to).filter((id): id is string => !!id))
  )

  let repliedById = new Map<string, RepliedRow>()
  if (replyIds.length > 0) {
    const { data: repliedMsgs, error: repliedErr } = await client
      .from('conversation_messages')
      .select(`
        id,
        content,
        user_id,
        user:users(id, email, first_name, last_name)
      `)
      .in('id', replyIds)

    if (repliedErr) {
      /* A quoted message failing to load must not blank the conversation. The
         loop this replaces swallowed the same failure, per message. */
      console.error('Error fetching replied-to messages:', repliedErr)
    } else {
      repliedById = new Map(((repliedMsgs || []) as RepliedRow[]).map((m) => [m.id, m]))
    }
  }

  return messages.map((message) =>
    message.reply_to
      ? { ...message, replied_message: repliedById.get(message.reply_to) ?? null }
      : message
  )
}
