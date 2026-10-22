/**
 * The requirement working surface, pinned against source.
 *
 * `InvestmentTimeline` needs a live Supabase client, auth and organization
 * context to mount, and both requirement cards open their own queries, so
 * the structural rules are asserted here rather than by rendering. Each one
 * below is a rule that was broken at least once while building this surface.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8')
const strip = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/^\s*\/\/.*$/gm, '')

const TL = strip(read('src/components/ui/InvestmentTimeline.tsx'))
const NAV = strip(read('src/components/workflow/RequirementsNavigator.tsx'))
const OP = strip(read('src/components/ui/checklist/OperationalItemCard.tsx'))
const DEC = strip(read('src/components/ui/checklist/DecisionItemCard.tsx'))
const TAB = strip(read('src/components/tabs/AssetTab.tsx'))

describe('the selected requirement is the working surface', () => {
  it('gives the rail a fixed column and the requirement the rest', () => {
    expect(TL).toMatch(/lg:grid-cols-\[280px_minmax\(0,1fr\)\]/)
  })

  it('renders the requirement through the existing cards, not a third one', () => {
    // A detail-only card would be a second place that writes notes,
    // attachments, comments and completion.
    expect(TL).toMatch(/layout: 'detail' as const/)
    expect(TL).toMatch(/<DecisionItemCard key=\{selected\.id\}/)
    expect(TL).toMatch(/<OperationalItemCard key=\{selected\.id\}/)
  })

  it('completes through the one existing toggle handler', () => {
    expect(TL).toMatch(/onToggleStatus=\{\(id\) => handleChecklistToggle\(showStageDetails, id\)\}/)
    expect((TL.match(/const handleChecklistToggle/g) ?? []).length).toBe(1)
  })
})

describe('the rail owns no data', () => {
  it('reads and writes nothing of its own', () => {
    // Indicators come from the row already in hand. One query per row to
    // decorate a list is how a 280px rail becomes forty requests.
    expect(NAV).not.toMatch(/supabase/)
    expect(NAV).not.toMatch(/useQuery/)
    expect(NAV).not.toMatch(/useMutation/)
  })
})

describe('both cards share one contract for two presentations', () => {
  for (const [name, src] of [['OperationalItemCard', OP], ['DecisionItemCard', DEC]] as const) {
    it(`${name} opens its body in the detail layout without being expanded`, () => {
      expect(src).toMatch(/layout\?: 'row' \| 'detail'/)
      expect(src).toMatch(/layout = 'row',/)
      expect(src).toMatch(/const detail = layout === 'detail'/)
      expect(src).toMatch(/const bodyOpen = detail \|\| isExpanded/)
      expect(src).toMatch(/\{bodyOpen && \(/)
      // The accordion guard must be gone: a body that still asks for
      // `isExpanded` alone renders an empty pane in the detail layout.
      expect(src).not.toMatch(/\{isExpanded && \(\s*<div className="border-t/)
    })

    it(`${name} titles the detail header and keeps its completion control`, () => {
      expect(src).toMatch(/data-testid="requirement-detail-title"/)
      expect(src).toMatch(/data-testid="requirement-detail-status"/)
    })
  }
})

describe('selection is reading, not writing', () => {
  it('never auto-selects a requirement for the reader', () => {
    // Defaulting to the first one tells them they had been working on it.
    expect(TL).toMatch(/useState<string \| null>\(\s*\(\) => viewingRequirementId \?\? null,\s*\)/)
    expect(TL).toMatch(/data-testid="requirement-none-selected"/)
  })

  it('does not treat an unloaded stage as a deleted requirement', () => {
    // `stageChecklists` is `{}` on first mount while the templates and
    // saved items are in flight. Recovering against it threw away the
    // selection restored from the reader's session, and then reported that
    // null upwards, erasing it from storage too.
    const at = TL.indexOf('if (!selectedRequirement || !showStageDetails) return')
    expect(at).toBeGreaterThan(-1)
    const body = TL.slice(at, at + 400)
    expect(body).toMatch(/if \(!stageItems\.length\) return/)
    expect(body).toMatch(/if \(!stageItems\.some\(i => i\.id === selectedRequirement\)\)/)
  })

  it('writes the selection to session state only, never to the database', () => {
    // The only consumer is the tab's own state. Nothing in the selection
    // path touches a table.
    expect(TL).toMatch(/onViewingRequirementChange\?\.\(selectedRequirement\)/)
    expect(TL).not.toMatch(/selectedRequirement[\s\S]{0,80}\.update\(/)
    expect(TL).not.toMatch(/viewing_requirement/)
  })
})

describe('the Asset tab remembers which requirement was open', () => {
  it('restores it, passes it down and saves it back', () => {
    expect(TAB).toMatch(/viewingRequirementId/)
    expect(TAB).toMatch(/savedState\?\.viewingRequirementId \|\| null/)
    expect(TAB).toMatch(/viewingRequirementId=\{viewingRequirementId\}/)
    expect(TAB).toMatch(/onViewingRequirementChange=\{setViewingRequirementId\}/)
    // In the saved payload, so a reload lands back on the same requirement.
    const at = TAB.indexOf('const stateToSave')
    expect(at).toBeGreaterThan(-1)
    expect(TAB.slice(at, at + 500)).toMatch(/viewingRequirementId/)
  })
})
