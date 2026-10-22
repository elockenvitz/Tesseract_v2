/**
 * The Work pane, mounted on the real Decisions tab.
 *
 * AssetTab needs a live Supabase client, auth and organization context to
 * mount, so the wiring is pinned against source. The pane's own behaviour is
 * tested by rendering it in
 * src/components/asset/work/__tests__/AssetWorkPane.test.tsx.
 *
 * What matters here is what the integration must NOT do: fetch twice, invent
 * authorization, invent a route, or quietly remove the surfaces it sits above.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8')
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

const TAB  = strip(read('src/components/tabs/AssetTab.tsx'))
const HOOK = strip(read('src/hooks/useAssetWorkAttention.ts'))
const PANE = strip(read('src/components/asset/work/AssetWorkPane.tsx'))

describe('it is mounted above Open Items, and removes nothing', () => {
  it('renders the pane on the Decisions tab', () => {
    expect(TAB).toMatch(/<AssetWorkPane/)
  })

  it('sits above Open Items', () => {
    expect(TAB.indexOf('<AssetWorkPane')).toBeLessThan(TAB.indexOf('id="decisions-open-items"'))
  })

  it('keeps Open Items with its canonical filters', () => {
    expect(TAB).toMatch(/id="decisions-open-items"/)
    expect(TAB).toMatch(/toIdeaStage\(item\.stage\) === openItemsFilter/)
  })

  it('keeps the Decision Timeline, the capital bar and Current Exposure', () => {
    expect(TAB).toMatch(/<DecisionTimeline/)
    expect(TAB).toMatch(/label: 'Last Action'/)
    expect(TAB).toMatch(/Current Exposure/)
  })

  it('keeps the Process destination reachable under its real key', () => {
    /*
     * The tab was labelled "Process"; its sub-page key is 'workflow'. Handing
     * off to 'process' set a sub-page nothing renders — a blank page, which
     * is exactly the kind of mismatch a label/key divergence produces.
     *
     * Process is a SECTION of Work now, so the guard is `activeMode`, but
     * 'workflow' is still the destination a notification deep-link sets and
     * 'process' is still not a key.
     */
    expect(TAB).toMatch(/setActiveSubPage\('workflow'\)/)
    expect(TAB).not.toMatch(/setActiveSubPage\('process'\)/)
    expect(TAB).not.toMatch(/activeMode === 'process'/)
  })
})

describe('no duplicate fetching', () => {
  it('feeds the pane from the openItems query the tab already runs', () => {
    expect(TAB).toMatch(/useAssetTradeIdeas\(\{ assetId: asset\.id \}\)/)
    expect(TAB).toMatch(/const workIdeas = React\.useMemo\(/)
    expect(TAB).toMatch(/openItems\.map\(/)
    // Not a second ideas query for the same rows.
    expect(TAB.match(/useAssetTradeIdeas\(/g) ?? []).toHaveLength(1)
  })

  it('only runs the attention queries in the Work mode', () => {
    expect(TAB).toMatch(/useAssetWorkAttention\(asset\.id, activeMode === 'work'\)/)
  })

  it('shares the PM-portfolio cache key with the existing decision path', () => {
    // Same key as ThoughtsSection, so the two share an entry rather than
    // racing to a different answer about who may decide.
    expect(HOOK).toMatch(/queryKey: \['user-pm-portfolios', user\?\.id\]/)
    const THOUGHTS = read('src/components/communication/ThoughtsSection.tsx')
    expect(THOUGHTS).toMatch(/queryKey: \['user-pm-portfolios', user\?\.id\]/)
  })

  it('names the running workflow without re-fetching checklist completion', () => {
    /*
     * null here must mean "this asset has no process", never "I did not
     * look" — passing null for the latter made the pane say "none running"
     * on an asset with a running process.
     */
    const at = TAB.indexOf('<AssetWorkPane')
    expect(TAB.slice(at, at + 900)).toMatch(/process=\{workProcessSummary\}/)
    // 'none' is the only thing that becomes null — never an unloaded state.
    expect(TAB).toMatch(/processSummary\.status === 'none'/)
    // "not loaded yet", never "0/4" — Process is on this surface now, so the
    // old "it is on the Process tab" named a place that no longer exists.
    expect(PANE).toMatch(/Checklist progress has not loaded yet\./)
    expect(PANE).not.toMatch(/Process tab/)
  })

  it('takes its process summary from the shared hook', () => {
    expect(TAB).toMatch(/useAssetProcessSummary\(\s*\n?\s*asset\.id, effectiveWorkflowId, activeMode === 'work'/)
  })

  it('the shared hook never re-declares a query InvestmentTimeline owns', () => {
    /*
     * A second queryFn on one key is a silent corruption: React Query keeps
     * one entry per key, and the stage shape is not even stable — a branch
     * reads stage_key/stage_label from workflow_template_versions, a root
     * workflow reads workflow_stages. The hook peeks the cache instead.
     */
    const HOOK = strip(read('src/hooks/useAssetProcessSummary.ts'))
    for (const owned of [
      'workflow-stages', 'asset-workflow-checklist', 'asset-workflow-progress',
      'workflow-checklist-templates',
    ]) {
      // Named, so it reads the entry — but with no queryFn of its own.
      expect(HOOK).toMatch(new RegExp(`queryKey: \\['${owned}'`))
    }
    /*
     * Five observers, one fetcher. Every query but `workflow-identity` is
     * `enabled: false` with no queryFn: it subscribes to the cache and never
     * issues a request. A plain `getQueryData` was the first attempt and is
     * NOT reactive — the band stayed blank while the stage rail beneath it
     * showed 0/4, because nothing re-rendered when the data landed.
     */
    expect((HOOK.match(/enabled: false/g) ?? []).length).toBe(5)
    expect(HOOK).not.toMatch(/getQueryData/)
    // Exactly one queryFn in the file: the workflow's name.
    expect((HOOK.match(/queryFn:/g) ?? []).length).toBe(1)
    expect(HOOK).toMatch(/queryKey: \['workflow-identity', workflowId\]/)
  })

  it('never asserts "no open stage" for a stage it simply has not fetched', () => {
    // An unknown is silence, not a negative.
    expect(PANE).not.toMatch(/'no open stage'/)
    expect(PANE).toMatch(/process\.openStageLabel\s*\n?\s*\?/)
  })
})

describe('authorization is the existing one', () => {
  it('reads portfolio_team with the pm and admin roles', () => {
    expect(HOOK).toMatch(/from\('portfolio_team'\)/)
    expect(HOOK).toMatch(/\.in\('role', \['pm', 'admin'\]\)/)
  })

  it('does not consult the other membership table', () => {
    // Known duplication; following the decision path is deliberate, so that
    // Work and the decide buttons never disagree.
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
})

describe('navigation handoffs are the existing ones', () => {
  it('opens the asset-filtered Ideas pipeline', () => {
    const at = TAB.indexOf('<AssetWorkPane')
    const block = TAB.slice(at, at + 1400)
    expect(block).toMatch(/type: 'trade-queue'/)
    expect(block).toMatch(/filterAssetId: asset\.id/)
  })

  it('labels it "Open in Ideas", because no per-idea route is verified', () => {
    expect(PANE).toMatch(/Open in Ideas/)
    expect(PANE).not.toMatch(/Open idea pipeline/)
  })

  it('invents no per-idea handler at the call site', () => {
    const at = TAB.indexOf('<AssetWorkPane')
    expect(TAB.slice(at, at + 1400)).not.toMatch(/onOpenIdea=/)
  })

  it('creates a new idea through the existing event', () => {
    const at = TAB.indexOf('<AssetWorkPane')
    expect(TAB.slice(at, at + 1400)).toMatch(/type: 'new-trade-idea'/)
  })

  it('reaches Process by scrolling, because Process is on this surface now', () => {
    // It used to switch sub-pages. The section is below the band, so the
    // handoff costs the reader nothing.
    const at = TAB.indexOf('<AssetWorkPane')
    expect(TAB.slice(at, at + 1800)).toMatch(/onOpenProcess=\{\(\) => focusWorkSection\(WORK_SECTION_ID\.workflow\)\}/)
  })
})

describe('research links are not inferred', () => {
  it('passes none until a real relationship can be proven', () => {
    const at = TAB.indexOf('<AssetWorkPane')
    expect(TAB.slice(at, at + 1400)).toMatch(/researchLinks=\{\[\]\}/)
  })

  it('the pane renders no research area when there are none', () => {
    expect(PANE).toMatch(/researchLinks\.length > 0 &&/)
  })
})

describe('loading', () => {
  it('waits for both the attention and the ideas queries', () => {
    const at = TAB.indexOf('<AssetWorkPane')
    expect(TAB.slice(at, at + 1400)).toMatch(/isLoading=\{workAttentionLoading \|\| openItemsLoading\}/)
  })
})
