/**
 * Which conversations reach the Asset page, and in what order.
 *
 * ── Why the ownership filter is tested even though RLS enforces it ──────
 *
 * `ai_conversations` is `user_id = auth.uid()` for ALL commands, so a row
 * belonging to someone else cannot arrive here through the normal path. That
 * is exactly why the client filter is worth pinning: it is the second lock,
 * it costs nothing, and the only way it ever matters is the case nobody will
 * be watching for — a policy regression. A test that only covered the happy
 * path would let someone delete the filter as dead code.
 *
 * There is no message-level entity index, so nothing here derives an excerpt,
 * a finding or a relevance score. Title and timestamps are carried, not
 * interpreted.
 */
import { describe, it, expect } from 'vitest'
import {
  shapeAssetConversations,
  UNTITLED_CONVERSATION,
  type AssetConversationRow,
} from '../asset-conversations'

const ME = 'user-me'
const THEM = 'user-them'

const row = (over: Partial<AssetConversationRow> = {}): AssetConversationRow => ({
  id: 'c1',
  title: 'Apple AI monetisation',
  last_message_at: '2026-04-27T20:25:46Z',
  updated_at: '2026-04-27T20:25:46Z',
  is_pinned: false,
  is_archived: false,
  user_id: ME,
  ...over,
})

describe('only the reader\'s own conversations', () => {
  it('keeps a row this reader owns', () => {
    expect(shapeAssetConversations([row()], ME)).toHaveLength(1)
  })

  it('drops a row owned by somebody else', () => {
    // RLS should make this unreachable. If it ever is reachable, rendering
    // another person's conversation title is the failure.
    expect(shapeAssetConversations([row({ user_id: THEM })], ME)).toHaveLength(0)
  })

  it('drops a row with no owner at all', () => {
    expect(shapeAssetConversations([row({ user_id: null })], ME)).toHaveLength(0)
  })

  it('returns nothing when there is no signed-in reader', () => {
    // Not "everything". An absent reader must not match an absent user_id.
    expect(shapeAssetConversations([row({ user_id: null })], null)).toHaveLength(0)
    expect(shapeAssetConversations([row()], undefined)).toHaveLength(0)
  })

  it('returns nothing for absent rows', () => {
    expect(shapeAssetConversations(null, ME)).toEqual([])
    expect(shapeAssetConversations(undefined, ME)).toEqual([])
  })
})

describe('archived threads stay out of the way', () => {
  it('drops an archived conversation', () => {
    expect(shapeAssetConversations([row({ is_archived: true })], ME)).toHaveLength(0)
  })

  it('keeps one whose archived flag is absent', () => {
    expect(shapeAssetConversations([row({ is_archived: null })], ME)).toHaveLength(1)
  })
})

describe('what each row carries', () => {
  it('carries the conversation\'s own title', () => {
    expect(shapeAssetConversations([row({ title: 'GLP-1 competition' })], ME)[0].title)
      .toBe('GLP-1 competition')
  })

  it('names an untitled conversation rather than rendering a blank row', () => {
    expect(shapeAssetConversations([row({ title: '   ' })], ME)[0].title)
      .toBe(UNTITLED_CONVERSATION)
    expect(shapeAssetConversations([row({ title: null })], ME)[0].title)
      .toBe(UNTITLED_CONVERSATION)
  })

  it('prefers last_message_at, which is when work actually happened', () => {
    // `updated_at` also moves on a rename or an archive, so it answers a
    // different question than "when did I last work on this".
    const shaped = shapeAssetConversations([row({
      last_message_at: '2026-04-27T20:25:46Z',
      updated_at: '2026-06-01T09:00:00Z',
    })], ME)
    expect(shaped[0].lastActivityAt).toBe('2026-04-27T20:25:46Z')
  })

  it('falls back to updated_at when no message time exists', () => {
    const shaped = shapeAssetConversations([row({
      last_message_at: null, updated_at: '2026-06-01T09:00:00Z',
    })], ME)
    expect(shaped[0].lastActivityAt).toBe('2026-06-01T09:00:00Z')
  })

  it('invents nothing about the content', () => {
    // An asset tag says the thread was opened with the company bound as
    // context. It is not evidence of what was discussed, and there is no
    // message-level index that could make it so.
    const shaped = shapeAssetConversations([row()], ME)
    expect(Object.keys(shaped[0]).sort()).toEqual(['id', 'isPinned', 'lastActivityAt', 'title'])
  })
})

describe('ordering', () => {
  it('puts pinned threads first', () => {
    const shaped = shapeAssetConversations([
      row({ id: 'old', is_pinned: false, last_message_at: '2026-06-01T00:00:00Z' }),
      row({ id: 'pin', is_pinned: true, last_message_at: '2020-01-01T00:00:00Z' }),
    ], ME)
    expect(shaped.map(c => c.id)).toEqual(['pin', 'old'])
  })

  it('orders the rest by most recent activity', () => {
    const shaped = shapeAssetConversations([
      row({ id: 'a', last_message_at: '2026-01-01T00:00:00Z' }),
      row({ id: 'c', last_message_at: '2026-06-01T00:00:00Z' }),
      row({ id: 'b', last_message_at: '2026-03-01T00:00:00Z' }),
    ], ME)
    expect(shaped.map(c => c.id)).toEqual(['c', 'b', 'a'])
  })

  it('sorts a thread with no usable timestamp last, rather than dropping it', () => {
    // A conversation the reader can still open is not improved by hiding it.
    const shaped = shapeAssetConversations([
      row({ id: 'none', last_message_at: null, updated_at: null }),
      row({ id: 'dated', last_message_at: '2026-01-01T00:00:00Z' }),
    ], ME)
    expect(shaped.map(c => c.id)).toEqual(['dated', 'none'])
  })

  it('does not let an unparseable timestamp outrank a real one', () => {
    const shaped = shapeAssetConversations([
      row({ id: 'junk', last_message_at: 'not-a-date', updated_at: null }),
      row({ id: 'real', last_message_at: '2020-01-01T00:00:00Z' }),
    ], ME)
    expect(shaped.map(c => c.id)).toEqual(['real', 'junk'])
  })
})
