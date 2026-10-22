/**
 * Resuming a CoAnalyst conversation from the Asset page.
 *
 * AISection needs a live Supabase client, auth, organization context and an
 * AI config to mount, so the wiring is pinned against source. What matters is
 * what the resume path must NOT do: create a conversation, discard an open
 * one, fetch transcripts the surface does not show, or reach a thread the
 * reader does not own.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8')
const strip = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/^\s*\/\/.*$/gm, '')

const AI = strip(read('src/components/communication/AISection.tsx'))
const TAB = strip(read('src/components/tabs/AssetTab.tsx'))
const HOOK = strip(read('src/hooks/ai/useAssetConversations.ts'))
const TYPES = strip(read('src/lib/engagement/types.ts'))

describe('the request travels on the existing seam', () => {
  it('carries the conversation id on the engagement target', () => {
    // Not a second route into CoAnalyst: the same `askAI` the header uses.
    expect(TYPES).toMatch(/conversationId\?: string/)
    expect(TAB).toMatch(/askAI\(\{ \.\.\.assetEngagementTarget, conversationId \}\)/)
  })

  it('starts a new thread with no id, rather than a different mechanism', () => {
    expect(TAB).toMatch(/onAskCoAnalyst=\{\(\) => askAI\(assetEngagementTarget\)\}/)
  })

  it('keeps the asset bound, so a resumed thread still has its context', () => {
    expect(TAB).toMatch(/objectType: 'asset' as const/)
    expect(TAB).toMatch(/assetId: asset\.id/)
  })
})

describe('the pane selects, and never creates', () => {
  it('calls selectConversation, not newConversation or sendMessage', () => {
    const at = AI.indexOf('requestedConversationId')
    expect(at).toBeGreaterThan(-1)
    const body = AI.slice(at, at + 500)
    expect(body).toMatch(/selectConversation\(requestedConversationId\)/)
    expect(body).not.toMatch(/newConversation\(/)
    expect(body).not.toMatch(/sendMessage\(/)
  })

  it('does nothing when that thread is already open', () => {
    /*
     * The guard that makes re-opening safe. Without it, asking for the
     * conversation already on screen would re-fetch it and replace the
     * message list — discarding a reply in progress.
     */
    expect(AI).toMatch(/if \(requestedConversationId === conversationId\) return/)
  })

  it('does nothing when no conversation was requested', () => {
    // Opening Ask AI from the header must not disturb the current thread.
    expect(AI).toMatch(/if \(!requestedConversationId\) return/)
  })

  it('re-runs on each request, so the same thread can be reopened', () => {
    /*
     * Keyed on the target object — each dispatch carries a fresh one —
     * rather than on the bare id string. Going to a thread, switching away
     * by hand, and asking for it again must work the second time, and this
     * codebase has produced that exact dead-second-click twice already.
     */
    const at = AI.indexOf('requestedConversationId')
    expect(AI.slice(at, at + 600)).toMatch(/\}, \[engagementTarget\]\)/)
  })
})

describe('privacy', () => {
  it('filters on the owner as well as relying on RLS', () => {
    expect(HOOK).toMatch(/\.eq\('user_id', user!\.id\)/)
    expect(HOOK).toMatch(/shapeAssetConversations\(.*user\?\.id\)/s)
  })

  it('never selects message content', () => {
    // The transcript is the private part and nothing on this surface shows
    // it. Fetching it to render a title would ship every word to the client
    // to display none of them.
    const at = HOOK.indexOf('.select(')
    const select = HOOK.slice(at, HOOK.indexOf(')', at))
    expect(select).not.toMatch(/messages/)
    expect(select).toMatch(/title/)
    expect(select).toMatch(/last_message_at/)
  })

  it('reads only asset tags, and only this asset\'s', () => {
    expect(HOOK).toMatch(/\.eq\('ai_conversation_tags\.tag_type', 'asset'\)/)
    expect(HOOK).toMatch(/\.eq\('ai_conversation_tags\.tag_id', assetId!\)/)
  })

  it('introduces no sharing of any kind', () => {
    for (const forbidden of [
      'organization_id', 'org_id', 'shared', 'collaborat', 'team', 'is_public',
    ]) {
      expect(HOOK.toLowerCase()).not.toContain(forbidden)
    }
  })

  it('issues nothing outside the Work mode', () => {
    expect(TAB).toMatch(/useAssetConversations\(asset\.id, activeMode === 'work'\)/)
  })
})

describe('no private content leaks into shared research', () => {
  it('writes no conversation pointer into contributions or evidence', () => {
    /*
     * `asset_contributions` — which carries section evidence — is readable
     * by the organization, while `ai_conversations` is `user_id =
     * auth.uid()`. A pointer stored there would show every colleague the
     * title of a private thread and an id none of them can open. Capture is
     * deferred for that reason, not because of a missing column.
     */
    expect(HOOK).not.toMatch(/asset_contributions/)
    expect(HOOK).not.toMatch(/attachments/)
    const at = TAB.indexOf('assetEngagementTarget')
    expect(TAB.slice(at, at + 1200)).not.toMatch(/saveSectionReferences|attachments/)
  })
})
