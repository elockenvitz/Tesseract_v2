/**
 * What only the direct-messaging component decides.
 *
 * The reads themselves are tested for real in
 * `src/lib/messaging/__tests__/conversation-queries.test.ts`. Left here are the
 * two things that live in the component: that it goes through that seam rather
 * than carrying the loops again, and the poll cadence.
 *
 * Source is read rather than rendered because this component needs auth, an
 * organization context, a smart-input stack and a live Supabase client to
 * mount, and none of that is what these assertions are about.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8')
const strip = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/^\s*\/\/.*$/gm, '')

const DM = strip(read('src/components/communication/DirectMessaging.tsx'))

/** One useQuery declaration, so a neighbouring query cannot satisfy these. */
const block = (key: string) => {
  const at = DM.indexOf(`queryKey: ['${key}'`)
  if (at < 0) return ''
  return DM.slice(at, DM.indexOf('\n  })', at) + 5)
}

const conversationsBlock = block('conversations')
const messagesBlock = block('conversation-messages')

describe('both reads go through the messaging seam', () => {
  it('imports them rather than querying inline', () => {
    expect(DM).toContain("from '../../lib/messaging/conversation-queries'")
    expect(conversationsBlock).toContain('readConversationList(user!.id)')
    expect(messagesBlock).toContain('readConversationMessages(selectedConversationId!)')
  })

  it('no longer loops over conversations in the component', () => {
    /* The defect, not a style preference: a last message, a read position and
       an unread count per conversation, on a 10s timer. */
    expect(conversationsBlock, 'the per-conversation loop is back').not.toMatch(/Promise\.all/)
    expect(conversationsBlock).not.toMatch(/count: 'exact'/)
    expect(conversationsBlock).not.toMatch(/\.from\('conversation_participants'\)/)
  })

  it('no longer fetches quoted messages one at a time', () => {
    expect(messagesBlock, 'the per-reply loop is back').not.toMatch(/Promise\.all/)
    expect(messagesBlock).not.toMatch(/reply_to\b/)
    expect(messagesBlock).not.toMatch(/maybeSingle/)
  })
})

describe('the open conversation stays responsive', () => {
  it('polls often enough to feel like a conversation', () => {
    /* 3s, and this is the one surface where a delay is felt directly: someone
       is reading while another person types. The saving came from the reply
       batch, not from slowing this down. Anything much slower is a worse chat. */
    expect(messagesBlock).toContain('refetchInterval: 3000')
  })

  it('does not poll the open conversation slowly', () => {
    const interval = messagesBlock.match(/refetchInterval: (\d+)/)
    expect(interval, 'the message poll lost its interval').not.toBeNull()
    expect(
      Number(interval![1]),
      'the open conversation is now polling slower than a chat tolerates'
    ).toBeLessThanOrEqual(4000)
  })

  it('catches the reader up when they return to the tab', () => {
    /* TanStack pauses the interval while the tab is in the background, so
       without this a reader coming back waits out a full tick. */
    expect(messagesBlock).toContain('refetchOnWindowFocus: true')
  })

  it('keeps the conversation list on its own slower timer, only when open', () => {
    expect(conversationsBlock).toContain('refetchInterval: isOpen ? 10000 : false')
  })
})
