/**
 * The Work shell, wired into the real tab.
 *
 * AssetTab needs a live Supabase client, auth and organization context to
 * mount, so the wiring is pinned against source. The navigator's own model is
 * tested in src/lib/asset-work/__tests__/work-items.test.ts.
 *
 * ── What replaced what ──────────────────────────────────────────────────
 *
 * This file used to pin `<AssetWorkPane .../>`, the orientation band. On a
 * 1920×945 window that band was 286px of a 661px viewport and the first
 * checklist row sat at y≈803 — the page described the work and kept the work
 * below the fold. It is gone; a context strip carries the lists and a
 * navigator of actual work items drives one surface.
 *
 * What these assertions protect is that NOTHING the band held was lost: the
 * attention split, the ideas, the process summary, the lists and the
 * conversations all still reach the reader, and none of them costs a second
 * query or a second authorization rule.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8')
const strip = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/^\s*\/\/.*$/gm, '')

const TAB  = strip(read('src/components/tabs/AssetTab.tsx'))
const HOOK = strip(read('src/hooks/useAssetWorkAttention.ts'))
const NAV  = strip(read('src/components/asset/work/WorkNavigator.tsx'))
const IDEA = strip(read('src/components/asset/work/IdeaWorkSurface.tsx'))
const SIDEBAR = strip(read('src/components/asset/work/AssetWorkSidebar.tsx'))

describe('the shell: a strip, a navigator and one surface', () => {
  it('mounts one sidebar and one surface', () => {
    /*
     * The strip is gone: list membership is a section of the sidebar now,
     * beside themes, portfolios and projects, rather than a horizontal band
     * in a third idiom above the work.
     */
    expect(TAB).toMatch(/<AssetWorkSidebar/)
    expect(TAB).toMatch(/<WorkNavigator/)
    expect(TAB).toMatch(/data-testid="work-surface"/)
    expect(TAB).not.toMatch(/<AssetContextStrip/)
  })

  it('no longer mounts the orientation band', () => {
    // 286px of a 661px viewport, describing work rather than offering it.
    expect(TAB).not.toMatch(/<AssetWorkPane/)
  })

  it('gives the surface the width and the navigator a fixed, narrow column', () => {
    // A 248px navigator beside a surface that takes the rest. Every element
    // used to run the full 1,841px, so a 25-character requirement was set
    // across 1,789 pixels.
    // 296px: the widest the sidebar can be before the centre's reading
    // measure stops fitting beside it at the narrow end of wide desktop.
    expect(TAB).toMatch(/xl:grid-cols-\[296px_minmax\(0,1fr\)\]/)
  })

  it('renders the process surface by mounting the real thing', () => {
    /*
     * `InvestmentTimeline` itself — the authoritative engine, stages,
     * checklist, assignments, deadlines and permissions. Not a summary that
     * links elsewhere, and not a second process model.
     */
    expect(TAB).toMatch(/selectedWorkItem\?\.kind === 'process' && \(/)
    expect(TAB).toMatch(/<InvestmentTimeline/)
    expect((TAB.match(/<InvestmentTimeline/g) ?? []).length).toBe(1)
  })

  it('renders the idea surface for an idea', () => {
    expect(TAB).toMatch(/selectedWorkItem\?\.kind === 'idea' && \(/)
    expect(TAB).toMatch(/<IdeaWorkSurface/)
  })

  it('no longer renders the duplicate Open Items section', () => {
    /*
     * It listed the same ideas the navigator lists, 1,092px down a 661px
     * viewport, and clicking one left the Asset page. Removed only once
     * every capability was reachable above: the rows, the stage filter,
     * idea creation, and opening an idea for editing.
     */
    expect(TAB).not.toMatch(/id="decisions-open-items"/)
    expect(TAB).not.toMatch(/Open Items/)
  })

  it('kept the stage filter, applied to ideas and not to processes', () => {
    // Filtering to "Researching" must not hide the running process, which
    // is the one thing the reader can always act on.
    expect(TAB).toMatch(/toIdeaStage\(i\.stage\) === openItemsFilter/)
    expect(TAB).toMatch(/ideas: filteredWorkIdeas\.map/)
    expect(TAB).toMatch(/processes: workProcesses/)
  })

  it('kept idea creation, through the same event', () => {
    expect(TAB).toMatch(/onNewIdea=\{\(\) => \{/)
    expect(TAB).toMatch(/type: 'new-trade-idea'/)
  })

  it('redirects the attention deep-link that used to scroll to the list', () => {
    // The section is gone; clearing the selection hands the choice to
    // `resolveSelection`, whose first preference is an item this reader can
    // act on — which is what an attention signal means.
    expect(TAB).not.toMatch(/scrollToSection\('decisions-open-items'\)/)
    const at = TAB.indexOf('if (t.openItems)')
    expect(at).toBeGreaterThan(-1)
    expect(TAB.slice(at, at + 700)).toMatch(/setWorkItemKey\(null\)/)
  })

  it('keeps the Decision Timeline, the capital bar and Current Exposure', () => {
    expect(TAB).toMatch(/<DecisionTimeline/)
    expect(TAB).toMatch(/label: 'Last Action'/)
    expect(TAB).toMatch(/Current Exposure/)
  })
})

describe('no duplicate fetching', () => {
  it('builds the navigator from the data Work already loads', () => {
    // No new query: the attention split, the ideas, the workflow rows and
    // the conversations are all reads the page was already making.
    expect(TAB).toMatch(/buildWorkItems\(\{/)
    expect(TAB).toMatch(/needsYourAction: workAttention\.needsYourAction/)
    expect(TAB).toMatch(/processes: workProcesses/)
    expect(TAB.match(/useAssetTradeIdeas\(/g) ?? []).toHaveLength(1)
    expect(TAB.match(/useAssetConversations\(/g) ?? []).toHaveLength(1)
    expect(NAV).not.toMatch(/useQuery|supabase/)
  })

  it('only runs the attention queries in the Work mode', () => {
    expect(TAB).toMatch(/useAssetWorkAttention\(asset\.id, activeMode === 'work'\)/)
  })

  it('shares the PM-portfolio cache key with the existing decision path', () => {
    expect(HOOK).toMatch(/queryKey: \['user-pm-portfolios', user\?\.id\]/)
    const THOUGHTS = read('src/components/communication/ThoughtsSection.tsx')
    expect(THOUGHTS).toMatch(/queryKey: \['user-pm-portfolios', user\?\.id\]/)
  })

  it('takes its process summary from the shared hook', () => {
    expect(TAB).toMatch(/useAssetProcessSummary\(\s*\n?\s*asset\.id, effectiveWorkflowId, activeMode === 'work'/)
  })

  it('the shared hook never re-declares a query InvestmentTimeline owns', () => {
    const SUMMARY = strip(read('src/hooks/useAssetProcessSummary.ts'))
    for (const owned of [
      'workflow-stages', 'asset-workflow-checklist', 'asset-workflow-progress',
      'workflow-checklist-templates',
    ]) {
      expect(SUMMARY).toMatch(new RegExp(`queryKey: \\['${owned}'`))
    }
    expect((SUMMARY.match(/queryFn: skipToken/g) ?? []).length).toBe(5)
    expect(SUMMARY).not.toMatch(/getQueryData/)
    expect((SUMMARY.match(/queryFn: async/g) ?? []).length).toBe(1)
  })
})

describe('one row per piece of work', () => {
  it('carries the idea id a decision request points at', () => {
    /*
     * The column was selected and then dropped in the mapping, so a request
     * and its idea could not be reconciled and the same BUY would have been
     * listed twice — once from `decision_requests`, once from the open items.
     */
    expect(HOOK).toMatch(/tradeQueueItemId: r\.trade_queue_item\?\.id \?\? null/)
    // The reconciliation itself is the model's, and is tested there.
    const MODEL = strip(read('src/lib/asset-work/work-items.ts'))
    expect(MODEL).toMatch(/yours\.set\(r\.tradeQueueItemId, r\)/)
    expect(MODEL).toMatch(/seenIdeas\.has\(idea\.id\)/)
  })
})

describe('authorization is the existing one', () => {
  it('reads portfolio_team with the pm and admin roles', () => {
    expect(HOOK).toMatch(/from\('portfolio_team'\)/)
    expect(HOOK).toMatch(/\.in\('role', \['pm', 'admin'\]\)/)
  })

  it('does not consult the other membership table', () => {
    expect(HOOK).not.toMatch(/portfolio_memberships/)
  })

  it('scopes requests to this asset through the trade queue item', () => {
    expect(HOOK).toMatch(/from\('decision_requests'\)/)
    expect(HOOK).toMatch(/trade_queue_items!inner/)
    expect(HOOK).toMatch(/\.eq\('trade_queue_item\.asset_id', assetId\)/)
  })

  it('derives the split from the shared pure function, not a local rule', () => {
    expect(HOOK).toMatch(/splitAttention\(rows, \{ userId: user\?\.id \?\? null, pmPortfolioIds \}\)/)
  })

  it('leaves the decision itself to DecisionModule', () => {
    /*
     * Which portfolio tracks exist, which await an answer, and whether there
     * is anything to decide at all. Second-guessing any of it would put two
     * answers to one authorization question on one screen.
     *
     * `supabase` used to be banned from this file outright, because the
     * surface was read-only and delegated everything. It now reads the
     * idea row it edits, so the ban narrowed to what it was actually
     * protecting: the DECISION's authorization, which still has exactly
     * one implementation.
     */
    expect(IDEA).toMatch(/<DecisionModule ideaId=\{idea\.id\} assetId=\{assetId\}/)
    expect(IDEA).not.toMatch(/canDecide|useIdeaDecision/)
  })

  it('never writes the fields that would decide, size or execute a trade', () => {
    /*
     * The line the editor must not cross. Writing `stage` or `outcome`
     * from the analyst's half would let editing a thesis accept a trade;
     * `moveTrade` and the decision mutations are the PM's, and are not
     * called here.
     */
    expect(IDEA).not.toMatch(/moveTrade|portfolioDecisionMutation|deferTrade/)
    expect(IDEA).not.toMatch(/from\('accepted_trades'\)|from\('trade_proposals'\)/)
    /*
     * Scoped to what is SAVED, not to the words appearing anywhere: the
     * row type legitimately declares `stage`, and the surface legitimately
     * reads it to render a chip. What it must never do is put `stage` or
     * `outcome` in an update payload.
     */
    for (const call of IDEA.match(/save\(\{[\s\S]*?\}\)/g) ?? []) {
      expect(call).not.toMatch(/\bstage\b|\boutcome\b|\bstatus\b/)
    }
    expect((IDEA.match(/save\(\{/g) ?? []).length).toBeGreaterThanOrEqual(4)
  })

  it('writes every field through the one audited mutation', () => {
    /* Not a second save path: same service, same ActionContext, same
       invalidation as the modal. */
    expect(IDEA).toMatch(/useTradeIdeaService\(\)/)
    expect(IDEA).toMatch(/updateTrade\(\{ tradeId: idea\.id, updates, uiSource: 'asset_work' \}\)/)
    /* The audit trail has to be able to tell this surface from the modal. */
    expect(IDEA).not.toMatch(/uiSource: 'modal'/)
  })

  it('asks the shared rule who may edit, rather than re-deriving it', () => {
    expect(IDEA).toMatch(/canEditIdea\(row, user\?\.id \?\? null\)/)
    expect(IDEA).not.toMatch(/created_by === user/)
  })
})

describe('the idea surface is not an approval form', () => {
  it('shows the analyst half as well as the decision half', () => {
    // `DecisionModule` alone would offer only approval, and the analyst who
    // wrote the idea would find no way to change it.
    expect(IDEA).toMatch(/data-testid="idea-analyst"/)
    expect(IDEA).toMatch(/data-testid="idea-decision"/)
  })

  it('edits the idea here and hands off only what it does not hold', () => {
    /*
     * This used to assert the opposite — that the surface linked out with
     * "Edit in the idea pipeline" and contained no editor at all. The
     * analyst now writes the idea's argument in place; the handoff
     * survives for what genuinely lives elsewhere (discussion,
     * counterviews, labs), which is why `openIdeaDetail` is still here.
     */
    expect(IDEA).toMatch(/openIdeaDetail\(idea\.id\)/)
    expect(IDEA).not.toMatch(/Edit in the idea pipeline/)
    for (const id of [
      'idea-field-rationale', 'idea-field-thesis',
      'idea-field-conviction', 'idea-field-sizing',
    ]) {
      expect(IDEA).toContain(`testId="${id}"`)
    }
  })

  it('sets the rationale at a readable measure', () => {
    expect(IDEA).toMatch(/max-w-\[68ch\]/)
  })

  it('renders the stage through the canonical model, never raw', () => {
    /* Prefers the freshly read row, falls back to the sidebar's copy, and
       in both cases goes through `stageLabel`. */
    expect(IDEA).toMatch(/stageLabel\(row\.stage \?\? idea\.stage!\)/)
    expect(IDEA).not.toMatch(/>\{idea\.stage\}</)
  })
})

describe('navigation handoffs are the existing ones', () => {
  it('opens a conversation through the existing engagement seam', () => {
    // The pane is where threads live, and the cross-asset context
    // protections from ac779006 live there too.
    expect(TAB).toMatch(/askAI\(\{ \.\.\.assetEngagementTarget, conversationId: item\.id \}\)/)
  })

  it('leaves the surface alone when a conversation is picked', () => {
    const at = TAB.indexOf("if (item.kind === 'conversation')")
    expect(at).toBeGreaterThan(-1)
    expect(TAB.slice(at, at + 200)).toMatch(/return/)
  })

  it('keeps the Process destination reachable under its real key', () => {
    expect(TAB).toMatch(/setActiveSubPage\('workflow'\)/)
    expect(TAB).not.toMatch(/setActiveSubPage\('process'\)/)
  })
})

describe('lists survive as context, with their Step B behaviour', () => {
  it('passes the permission-gated rows to the sidebar', () => {
    expect(TAB).toMatch(/<AssetWorkSidebar/)
    expect(TAB).toMatch(/canRemove: l\.canRemove/)
    expect(SIDEBAR).toMatch(/l\.canRemove && onRemoveFromList/)
  })

  it('distinguishes "not loaded" from "in no lists"', () => {
    expect(TAB).toMatch(/lists=\{listsLoading \? null : assetListMemberships\.map/)
    expect(SIDEBAR).toMatch(/lists !== null &&/)
  })

  it('reuses the existing Add control rather than a second dialog', () => {
    expect(TAB).toMatch(/addToListSlot=\{<AddToListButton assetId=\{asset\.id\}/)
    expect(SIDEBAR).not.toMatch(/supabase|useMutation|useQuery/)
  })

  it('hands the List tab a row whose ownership it can read', () => {
    expect(TAB).toMatch(/list_type: m\.listType/)
    expect(TAB).toMatch(/created_by: m\.createdBy/)
  })

  it('keeps the cross-asset Lists experience reachable', () => {
    expect(TAB).toMatch(/onOpenAllLists=/)
    expect(SIDEBAR).toMatch(/data-testid=\{`sidebar-all-\$\{id\}`\}/)
  })

  it('brings themes, portfolios and projects into the sidebar with their controls', () => {
    /*
     * They were full-width Cards 708px BELOW the working surface. Every
     * control came with them; the one that did not is `AddToQueueButton`,
     * labelled "New Trade Idea", which is not a portfolio relationship.
     */
    expect(TAB).toMatch(/addToThemeSlot=\{<AddToThemeButton/)
    expect(TAB).toMatch(/addToProjectSlot=\{<AddToProjectButton/)
    expect(TAB).toMatch(/projectsSlot=\{[\s\S]{0,120}<RelatedProjects/)
    expect(TAB).not.toMatch(/AddToQueueButton/)
    expect(TAB).not.toMatch(/id="work-memberships"/)
  })
})

describe('selection persists and recovers honestly', () => {
  it('saves only the key, beside the sub-page', () => {
    expect(TAB).toMatch(/activeWorkItem: workItemKey/)
    expect(TAB).toMatch(/savedState\?\.activeWorkItem \?\? null/)
  })

  it('declares the key above the effect that depends on it', () => {
    /*
     * A dependency array is evaluated every render, so declaring this below
     * the save effect threw "Cannot access 'workItemKey' before
     * initialization" and took the Asset page to the error boundary. Found
     * in the browser, not in review.
     */
    const decl = TAB.indexOf('const [workItemKey, setWorkItemKey]')
    const dep = TAB.indexOf('activeWorkItem: workItemKey')
    expect(decl).toBeGreaterThan(-1)
    expect(decl).toBeLessThan(dep)
  })

  it('says so when the saved item is gone', () => {
    // Swapping in different work while implying it is the piece the reader
    // left is worse than showing nothing.
    /*
     * Narrowed by one case, not relaxed. `resolveSelection` only knows
     * navigator items, so a contextual key — a list or a portfolio, which
     * now select in place — looks to it like a selection that vanished.
     * It has not: it is on screen. Reporting recovery there printed "the
     * item you were on is no longer available" directly above a list the
     * reader had just opened.
     */
    expect(TAB).toMatch(/recoveredFrom=\{!contextual && workSelection\.recovered\}/)
    expect(NAV).toMatch(/data-testid="work-nav-recovered"/)
    expect(NAV).toMatch(/The item you were on is no longer available\./)
  })
})
