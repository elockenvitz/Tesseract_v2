/**
 * Does the signed-in user have an unread direct message?
 *
 * ── Why this is not inline in Header.tsx any more ─────────────────────────
 *
 * It was, as a loop: one query for the caller's rows in
 * `conversation_participants`, then one `count` query per conversation. The
 * header is mounted on every page, so it ran continuously for every signed-in
 * user. Measured over the 169 days of current statistics, to 2026-11-06
 * 02:40:56Z:
 *
 *   conversation_messages count   1,308,978 calls   2,464.20 s
 *   conversation_participants       245,884 calls      68.07 s
 *
 * 1,554,862 queries and 42 minutes of database time to keep one boolean
 * accurate, over a table holding 123 rows. The ratio of 5.32 count queries per
 * participant query is the loop, measured.
 *
 * It lives here rather than in the component so the logic can be tested
 * against a stub client instead of asserted against source text. The rule
 * being tested -- "a message from someone else, newer than my last_read_at" --
 * is worth testing for real.
 *
 * ── Two paths, on purpose ────────────────────────────────────────────────
 *
 * The fast path is the `has_unread_direct_messages` RPC: one round trip,
 * short-circuiting on the first unread row, and bounded as the table grows.
 *
 * The fallback exists because the client and the migration deploy separately.
 * If this ships before `20261106023000_has_unread_direct_messages.sql` is
 * applied, PostgREST answers PGRST202 and the badge would silently read false
 * forever -- a broken feature with no error. So that one error code switches
 * to a two-query client path returning the same boolean, latched in a module
 * flag so the RPC is not retried on every poll.
 *
 * The fallback is removable once the migration is applied in production. It is
 * not dead code before that.
 */
import { supabase as defaultClient } from '../supabase'

/**
 * The epoch the client has always used for "never read".
 *
 * `-infinity` would be marginally safer, since it could not hide a message
 * dated before 1970, but `conv.last_read_at || '1970-01-01'` is what the
 * replaced code sent and this must not change which rows count. The RPC uses
 * the same value.
 */
const NEVER_READ = '1970-01-01T00:00:00Z'

/** PostgREST's code for "could not find the function in the schema cache". */
const FUNCTION_MISSING = 'PGRST202'

type Client = Pick<typeof defaultClient, 'rpc' | 'from'>

let rpcUnavailable = false

/** Test seam. Resets the latch set when the RPC is found to be missing. */
export function resetUnreadRpcAvailability() {
  rpcUnavailable = false
}

/**
 * The two-query path.
 *
 * Deliberately has NO `.limit()`. The question is "is anything unread
 * anywhere", and a limit over messages ordered across all conversations can
 * be filled entirely by one already-read conversation, hiding an unread
 * message in another. A limit here would make the boolean wrong, not just
 * approximate.
 *
 * `.neq('user_id', userId)` and the `created_at` null guard reproduce the
 * server-side behaviour of the queries this replaces: PostgREST emits
 * `user_id <> $1`, which is NULL and therefore excluded for an authorless
 * message, and `NULL > x` is likewise NULL.
 */
async function readViaQueries(client: Client, userId: string): Promise<boolean> {
  const { data: participants, error: participantsError } = await client
    .from('conversation_participants')
    .select('conversation_id, last_read_at')
    .eq('user_id', userId)

  if (participantsError) {
    console.error('Error fetching user conversations for notification:', participantsError)
    return false
  }
  if (!participants || participants.length === 0) return false

  const conversationIds = participants
    .map((p: { conversation_id: string | null }) => p.conversation_id)
    .filter((id: string | null): id is string => !!id)
  if (conversationIds.length === 0) return false

  const { data: messages, error: messagesError } = await client
    .from('conversation_messages')
    .select('conversation_id, created_at')
    .in('conversation_id', conversationIds)
    .neq('user_id', userId)

  if (messagesError) {
    console.error('Error fetching messages for notification:', messagesError)
    return false
  }
  if (!messages || messages.length === 0) return false

  const lastReadByConversation = new Map<string, string | null>(
    participants.map((p: { conversation_id: string | null; last_read_at: string | null }) => [
      p.conversation_id as string,
      p.last_read_at,
    ])
  )

  return messages.some((m: { conversation_id: string | null; created_at: string | null }) => {
    if (!m.created_at || !m.conversation_id) return false
    const lastRead = lastReadByConversation.get(m.conversation_id) || NEVER_READ
    return new Date(m.created_at).getTime() > new Date(lastRead).getTime()
  })
}

export async function readUnreadDirectMessages(
  userId: string,
  client: Client = defaultClient
): Promise<boolean> {
  if (!userId) return false

  if (!rpcUnavailable) {
    const { data, error } = await client.rpc('has_unread_direct_messages')
    if (!error) return !!data

    if (error.code !== FUNCTION_MISSING) {
      /* A real failure: permissions, network, a timeout. Report false rather
         than falling back, so one broken call does not quietly double the
         query count on every subsequent poll. */
      console.error('Error checking unread direct messages:', error)
      return false
    }

    /* The migration has not been applied here yet. Latch, so this is one
       wasted call per page load rather than one per poll. */
    rpcUnavailable = true
  }

  return readViaQueries(client, userId)
}
