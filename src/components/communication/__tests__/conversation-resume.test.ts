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
    /* The call site moved from the orientation band to the Work navigator
       when the band was replaced; the seam it goes through is unchanged. */
    /* The id is destructured now: the call moved into a named
       `openConversationPane(conversationId)` callback, so the value arrives as
       a parameter rather than being reached for off `item`. Same seam, same
       spread, one less thing the call site has to know. */
    expect(TAB).toMatch(/const openConversationPane = React\.useCallback\(\(conversationId: string\)/)
    expect(TAB).toMatch(/askAI\(\{ \.\.\.assetEngagementTarget, conversationId \}\)/)
  })

  it('launches the pane without taking the working surface', () => {
    /* A conversation is an investigation, not the thing being worked on, so
       picking one opens the existing pane and leaves the selected process or
       idea exactly where it was. */
    /*
     * The condition moved from the kind to a flag, and the component it was
     * read in is no longer mounted.
     *
     * This matched `if (item.kind === 'conversation')` in AssetTab and
     * `item.launchesPane` in WorkNavigator. The branch is now keyed on
     * `launchesPane`, which `work-items` sets on conversation items, and
     * WorkNavigator is not rendered any more — another test in this repo
     * asserts `AssetTab` does NOT contain `<WorkNavigator`, so reading it here
     * was checking a file the product does not run.
     *
     * The rule is the early `return`: picking a conversation opens the pane
     * and does not become the selected work.
     */
    const at = TAB.indexOf('if (item.launchesPane)')
    expect(at).toBeGreaterThan(-1)
    expect(TAB.slice(at, at + 200)).toMatch(/openConversationPane\(item\.id\); return/)
    // And the flag is set where the item is built, not guessed at the call site.
    const ITEMS = strip(read('src/lib/asset-work/work-items.ts'))
    expect(ITEMS).toMatch(/kind: 'conversation'[\s\S]{0,200}launchesPane: true/)
    // A pane-launching item is never a selectable piece of work.
    expect(ITEMS).toMatch(/filter\(i => !i\.launchesPane\)/)
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

describe('the pane cannot claim a subject the open conversation does not have', () => {
  const PANE = strip(read('src/components/communication/CommunicationPane.tsx'))

  it('compares the open conversation against the ACTIVE TAB, not the target', () => {
    /*
     * `engagementTarget` is a request that was true when dispatched and is
     * never cleared by Layout, so after resuming AAPL's thread and walking
     * to MSFT it still said AAPL. Only the tab follows the reader.
     */
    /*
     * And not from `contextType`/`contextId` either: those are the
     * `commPaneContext` OVERRIDE when one is set, which the engagement also
     * writes and also never clears. Layout passes the raw tab context.
     */
    const LAYOUT = strip(read('src/components/layout/Layout.tsx'))
    expect(LAYOUT).toMatch(/tabSubject=\{tabContext\.contextType && tabContext\.contextId/)
    expect(LAYOUT).toMatch(/type: tabContext\.contextType/)
    expect(PANE).toMatch(/currentSubject=\{tabSubject\}/)
    expect(AI).toMatch(/conversationContextState\(\{/)
    expect(AI).toMatch(/conversationTags: tags/)
    expect(AI).toMatch(/currentSubject,/)
  })

  it('hides the bound-object header on both ways of lying', () => {
    /*
     * Two separate falsehoods, both measured:
     *  - a FOREIGN thread open: it announced "context already supplied:
     *    Asset AAPL" over a thread the reader had walked away from;
     *  - no thread at all: the state is `empty`, not foreign, and it STILL
     *    announced AAPL on an MSFT page, because the target is frozen.
     */
    /*
     * The band itself is gone. `EngagementContextHeader` drew a second
     * context list from the engagement target, which the request does not
     * read, and `AiEntryOrientation` replaced it — so the condition is now
     * keyed on `context.event`, which carries the same two suppressions
     * inside `lib/ai/active-context` plus a third the old band had none of
     * (the reader can dismiss it).
     *
     * Both falsehoods are now pinned BEHAVIOURALLY, by mounting the pane, in
     * `active-context-pane.test.tsx` — "goes quiet once the reader has walked
     * to another object" there, and in `active-context.test.ts` for the rule
     * on its own. This file pins wiring against source because the pane
     * needed a live Supabase client to mount; that is no longer true for
     * this particular claim, so the stronger test is the one that renders.
     * What is left here is the guard that the suppression is still WIRED,
     * which source text is the right tool for.
     */
    expect(AI).toMatch(/context\.event && contextState !== 'foreign' && headerDescribesHere && \(/)
    expect(AI).toMatch(/const headerDescribesHere = subjectsAgree\(targetSubject, currentSubject\)/)
  })

  it('says which conversation a message would join, and offers the other', () => {
    expect(AI).toMatch(/contextState === 'foreign' && \(/)
    expect(AI).toMatch(/describeSendTarget\(contextState, openConversationTitle\)/)
    expect(AI).toMatch(/data-testid="ai-start-here"/)
    expect(AI).toMatch(/onClick=\{startHere\}/)
  })

  it('starts the new thread tagged to the page, not to the stale target', () => {
    /*
     * `newConversation()` resets to `initialTags`, which derive from the
     * SAME frozen target — so a button reading "Start one about MSFT"
     * started a thread tagged AAPL. Verified in the browser: the pane's
     * suggestions read MSFT only after the tag is set explicitly.
     */
    const at = AI.indexOf('const startHere')
    const body = AI.slice(at, at + 300)
    expect(body).toMatch(/newConversation\(\)/)
    expect(body).toMatch(/subjectTag\(currentSubject\)/)
    expect(body).toMatch(/setTags\(\[tag as TagRef\]\)/)
    // Local state only — no row until the user sends.
    expect(body).not.toMatch(/supabase|mutate|insert/)
  })

  it('moves, retags and clears nothing', () => {
    /*
     * A thread that spans companies is an investigation, not a mistake.
     * Continuing stays available; only the silence is removed. The remedy
     * offered is `newConversation`, which resets local state to the current
     * page's tags and writes no row until something is sent.
     */
    const at = AI.indexOf("contextState === 'foreign' && (")
    const block = AI.slice(at, at + 1400)
    expect(block).not.toMatch(/addTag\(|removeTag\(/)
    expect(block).not.toMatch(/supabase/)
    expect(block).not.toMatch(/archiveConversation|deleteConversation|renameConversation/)
    expect(block).not.toMatch(/selectConversation\(/)
  })

  it('leaves the resume path untouched', () => {
    // Step D behaviour: explicit selection still loads that exact thread.
    expect(AI).toMatch(/selectConversation\(requestedConversationId\)/)
    expect(AI).toMatch(/if \(requestedConversationId === conversationId\) return/)
  })
})
