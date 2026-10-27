/**
 * The operating model, pinned against source.
 *
 * `AssetTab`, `InvestmentTimeline` and `AssetRunDetailPanel` all need
 * Supabase, auth and organization context to mount, so the structural
 * rules live here. Each is a rule that was broken at least once while
 * building this, several of them against production data.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8')
const strip = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/^\s*\/\/.*$/gm, '')

const TAB = strip(read('src/components/tabs/AssetTab.tsx'))
const HOOK = strip(read('src/components/asset/work/useProcessReport.ts'))
const RUN = strip(read('src/components/workflow/views/AssetRunDetailPanel.tsx'))
const OVERVIEW = strip(read('src/components/asset/work/AssetWorkOverview.tsx'))
const REPORT = strip(read('src/components/asset/work/ProcessReport.tsx'))

describe('Work opens on the overview, not on something chosen for you', () => {
  it('renders the overview when nothing is selected', () => {
    expect(TAB).toMatch(/!contextual && !selectedWorkItem && !workIsResolving && \(/)
    expect(TAB).toMatch(/<AssetWorkOverview/)
  })

  it('no longer shows the dashed "no active work" box as the entry state', () => {
    expect(TAB).not.toMatch(/No active work on this asset/)
  })

  it('offers a labelled way back from every focused workspace', () => {
    /* Both the Process header and the Idea surface, not just the first. */
    expect((TAB.match(/<WorkOverviewReturn/g) ?? []).length).toBeGreaterThanOrEqual(2)
    expect(TAB).toMatch(/setWorkItemKey\(WORK_OVERVIEW_KEY\)/)
  })

  it('states a vanished selection rather than silently swapping one in', () => {
    expect(TAB).toMatch(/recoveredFrom=\{workSelection\.recovered\}/)
    expect(OVERVIEW).toMatch(/data-testid="work-overview-recovered"/)
  })

  it('ranks without inventing a score', () => {
    expect(OVERVIEW).not.toMatch(/score|urgency|priorityRank/i)
    /* The reason is a sentence that arrives with the data. */
    expect(OVERVIEW).toMatch(/\{resume\.reason\}/)
  })
})

describe('the report is assembled from canonical rows', () => {
  it('scopes every read to the asset and the cycle', () => {
    /*
     * The one failure a historical record must not have. Drop the
     * workflow filter from any read and last quarter's report fills with
     * this quarter's findings.
     */
    const reads = HOOK.match(/\.from\('[a-z_]+'\)[\s\S]*?(?=\.from\('|$)/g) ?? []
    const scoped = reads.filter(r =>
      /workflow_id|template_version|\.eq\('id'/.test(r) ||
      /* Commentary is scoped TRANSITIVELY: its `in()` list is built from
         the item rows, which are themselves filtered to this asset and
         this workflow. Scoping it directly is impossible — the table has
         no workflow column — so this is the correct form, not a gap. */
      /\.in\('checklist_item_id', ids\)/.test(r))
    expect(scoped.length).toBe(reads.length)
    expect(HOOK).toMatch(/\.eq\('asset_id', assetId!\)/)
    /* And the list it is scoped by must come from the scoped query. */
    expect(HOOK).toMatch(/const ids = items\.map\(i => i\.id\)/)
  })

  it('reads the requirement label from the template, not the row', () => {
    /*
     * `asset_checklist_items.item_text` is NULL on real data — all five
     * AAPL rows, including the one holding a 452-character assessment.
     * Reading it alone renders the whole cycle as "Untitled requirement".
     */
    expect(HOOK).toMatch(/text: t\.item_text \?\? row\?\.item_text \?\? null/)
    expect(HOOK).toMatch(/from\('workflow_checklist_templates'\)/)
  })

  it('links requirements by the id the workspace actually selects by', () => {
    /*
     * The rail matches `item.id === selectedRequirement`, where `item.id`
     * is the TEMPLATE item id. Linking by the `asset_checklist_items` row
     * id would make every "open this requirement" match nothing.
     */
    expect(HOOK).toMatch(/requirementId: t\.item_id \?\? k/)
    expect(HOOK).not.toMatch(/requirementId: row\?\.id/)
  })

  it('joins attachments on the pair the table actually stores', () => {
    /* `asset_checklist_attachments` has no `checklist_item_id` column. */
    expect(HOOK).not.toMatch(/checklist_item_id, file_name/)
    expect(HOOK).toMatch(/\.select\('stage_id, item_id, file_name, uploaded_at'\)/)
  })

  it('keeps untouched requirements in the record', () => {
    /* They have no row at all; counting rows would make an unstarted
       cycle look finished. The template is the spine. */
    expect(HOOK).toMatch(/const row = itemByPair\.get\(k\) \?\? null/)
  })

  it('shows "done, nothing written" as its own outcome in the UI', () => {
    expect(REPORT).toMatch(/'done · nothing written'/)
    expect(REPORT).toMatch(/Marked done, with no written finding\./)
  })

  it('never renders a composed stage summary or verdict', () => {
    expect(REPORT).not.toMatch(/stage\.summary|report\.conclusion|\bverdict\b/)
  })
})

describe('the Process dashboard resolves into the asset workspace', () => {
  it('counts requirements against the template, not against rows', () => {
    expect(RUN).toMatch(/from\('workflow_checklist_templates'\)/)
    expect(RUN).toMatch(/\.eq\('workflow_id', branchId\)/)
  })

  it('deep-links with identifiers, never a label or an index', () => {
    expect(RUN).toMatch(/workflowId: branchId/)
    expect(RUN).toMatch(/stageId: target\?\.stageId \?\? null/)
    expect(RUN).toMatch(/requirementId: target\?\.itemId \?\? null/)
  })

  it('makes each click a new arrival so a second deep link is honoured', () => {
    /* Tab data is durable; a repeat without a fresh request id is treated
       as already consumed and ignored. */
    expect(RUN).toMatch(/focusRequestId: `run-\$\{branchId\}-\$\{target\?\.itemId \?\? 'any'\}-\$\{Date\.now\(\)\}`/)
  })

  it('writes no completion state of its own for requirements', () => {
    /* The dashboard READS the asset's rows. A second task engine would
       be a second answer to "is this done". */
    expect(RUN).not.toMatch(/from\('asset_checklist_items'\)[\s\S]{0,200}\.update\(/)
  })
})

describe('arriving from the dashboard applies once', () => {
  it('reads the destination through the one shared parser', () => {
    expect(TAB).toMatch(/destinationFromTabData\(asset\.data/)
  })

  it('guards the arrival and persists that it was consumed', () => {
    expect(TAB).toMatch(/shouldApplyArrival\(key, saved\?\.consumedWorkArrival \?\? null\)/)
    /* `saveTabState` REPLACES the record, so the main save effect has to
       carry this or every save re-arms the arrival. */
    const at = TAB.indexOf('const stateToSave')
    expect(at).toBeGreaterThan(-1)
    expect(TAB.slice(at, at + 900)).toMatch(/consumedWorkArrival: consumedArrival/)
  })

  it('sets stage and requirement from identifiers only', () => {
    expect(TAB).toMatch(/if \(workArrival\.stageId\) setViewingStageId\(workArrival\.stageId\)/)
    expect(TAB).toMatch(/if \(workArrival\.requirementId\) setViewingRequirementId\(workArrival\.requirementId\)/)
  })
})

describe('a finding written while working a requirement becomes a real note', () => {
  const REQ = strip(read('src/components/asset/work/RequirementWorkspace.tsx'))
  const NOTES = strip(read('src/hooks/useAssetResearchNotes.ts'))

  it('goes through the existing asset_notes seam, not a second write path', () => {
    /*
     * The requirement had no way to record a finding at all: the assessment
     * box is the requirement's own answer, and nothing in Work could create
     * something Research would later show. This adds the control and routes
     * it through `createArtifact`, which is the same insert Research uses —
     * so the note carries `organization_id` and the asset link exactly as a
     * note made in Research does.
     */
    expect(TAB).toMatch(/createArtifact: createResearchNote/)
    expect(TAB).toMatch(/onCreateNote=\{createNoteFromWork\}/)
    expect(REQ).toContain('data-testid="requirement-new-note"')
    // No second insert into asset_notes from the work surfaces.
    expect(REQ).not.toMatch(/from\('asset_notes'\)/)
  })

  it('costs no extra query, because the list is already loaded', () => {
    /*
     * `useAssetWorkspace` already returns the asset's notes as `evidence`.
     * Mounting the notes hook for its list as well would fetch them twice on
     * every asset page, so the hook takes an `enabled` flag and this caller
     * passes false — `createArtifact` needs no list.
     */
    expect(TAB).toMatch(/useAssetResearchNotes\(asset\.id, false\)/)
    expect(NOTES).toMatch(/enabled: !!assetId && !!currentOrgId && enabled/)
  })

  it('opens what it created, and survives a refused write', () => {
    // A note created and not opened is a blank row the reader must hunt for.
    expect(TAB).toMatch(/if \(id\) handleNoteClick\(id\)/)
    /*
     * `createArtifact` returns null when no organization is active rather
     * than writing an unowned row, so the id is checked rather than assumed.
     */
    expect(NOTES).toMatch(/if \(!assetId \|\| !user\?\.id \|\| !currentOrgId\) return null/)
  })
})
