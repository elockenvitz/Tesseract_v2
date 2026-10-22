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

  it('changes status through the one named-transition handler', () => {
    // The cycling `handleChecklistToggle` is gone: a control now asks for
    // a specific transition and the handler decides whether it applies.
    expect(TL).toMatch(/onAction=\{\(id, action\) => applyRequirementAction\(showStageDetails, id, action\)\}/)
    expect((TL.match(/const applyRequirementAction/g) ?? []).length).toBe(1)
    expect(TL).not.toMatch(/const handleChecklistToggle/)
    // One place still owns the status write. The stage advance uses the
    // same mutation via `mutateAsync` to stamp requirements that were
    // already done, and reports its own failures — see the `previous`
    // guard in `onError`.
    expect((TL.match(/saveChecklistItemMutation\.mutate\(\{/g) ?? []).length).toBe(1)
    expect(TL).toMatch(/if \(!vars\.previous\) return/)
  })

  it('refuses a second click while the first write is in flight', () => {
    expect(TL).toMatch(/if \(requirementWritesInFlight\.current\.has\(inFlightKey\)\) return/)
    expect(TL).toMatch(/requirementWritesInFlight\.current\.add\(inFlightKey\)/)
    // Released on success AND failure, or one failed write wedges the row.
    expect(TL).toMatch(/onSettled:[\s\S]{0,200}requirementWritesInFlight\.current\.delete/)
  })

  it('puts an optimistic row back when the write is refused', () => {
    expect(TL).toMatch(/previous: \{/)
    expect(TL).toMatch(/item\.id === vars\.itemId \? \{ \.\.\.item, \.\.\.vars\.previous \}/)
  })

  it('refuses a transition that does not apply, rather than cycling', () => {
    expect(TL).toMatch(/resolveTransition\(currentStatus, action\)/)
    expect(TL).toMatch(/if \(!transition\.ok \|\| !transition\.to\)/)
  })

  it('no longer opens a browser dialog anywhere in the process surface', () => {
    for (const [name, src] of [['InvestmentTimeline', TL], ['OperationalItemCard', OP], ['DecisionItemCard', DEC]] as const) {
      expect(src, `${name} still calls alert()`).not.toMatch(/\balert\(/)
      expect(src, `${name} still calls confirm()`).not.toMatch(/\bconfirm\(/)
    }
  })

  it('confirms destructive requirement actions in the product dialog', () => {
    expect(OP).toMatch(/<ConfirmDialog/)
    expect(OP).toMatch(/pendingCommentDelete/)
    expect(DEC).toMatch(/pendingSignalDelete/)
    expect(DEC).toMatch(/pendingEvidenceDelete/)
    // The file dialog must not promise a deletion the product does not do.
    expect(DEC).toMatch(/The stored file itself is not deleted/)
  })

  it('offers a way back to unassigned', () => {
    expect(OP).toMatch(/data-testid="requirement-unassign"/)
    expect(OP).toMatch(/assignee_id: null/)
    // Clearing an assignment touches one column and nothing else.
    expect(OP).not.toMatch(/assignee_id: null[\s\S]{0,120}(notes|completed|status):/)
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

describe('the requirement reads as a workbench, not four thin rows', () => {
  it('states the requirement and its status once, in the header', () => {
    // The body carried a second "Completed by …" strip under the sections
    // while the header already said it.
    expect(OP).toMatch(/item\.completedAt && !detail/)
  })

  it('names the completion action instead of offering a bare circle', () => {
    // The words now come from one table, so the label and the transition
    // cannot disagree.
    expect(OP).toMatch(/\{ACTION_LABEL\[primary\]\}/)
    expect(OP).toMatch(/data-testid="requirement-detail-status"/)
    expect(OP).toMatch(/data-action=\{primary\}/)
    // And the secondary action is offered by name where it is legal.
    expect(OP).toMatch(/secondaryActions\(status\)\.map/)
    expect(OP).toMatch(/data-testid=\{`requirement-detail-action-\$\{a\}`\}/)
  })

  it('makes the notes the primary surface at a reading width', () => {
    expect(OP).toMatch(/Working notes/)
    expect((OP.match(/max-w-\[78ch\]/g) ?? []).length).toBeGreaterThanOrEqual(3)
    expect(DEC).toMatch(/max-w-\[78ch\]/)
  })

  it('makes the saved notes their own edit affordance', () => {
    // An "Edit" link above a paragraph is discoverable only if you look.
    const at = OP.indexOf('data-testid="requirement-notes-body"')
    expect(at).toBeGreaterThan(-1)
    expect(OP.slice(Math.max(0, at - 300), at)).toMatch(/onClick=\{\(\) => \{ if \(isEditable\) openNotesEditor\(\) \}\}/)
  })

  it('lets Enter be a new paragraph in the detail notes editor', () => {
    // A field that saves and closes on Enter cannot hold several
    // sentences, which is what this field is for.
    expect(OP).toMatch(/const save = detail\s*\?\s*e\.key === 'Enter' && \(e\.metaKey \|\| e\.ctrlKey\)\s*:\s*e\.key === 'Enter' && !e\.shiftKey/)
  })

  it('splits the supporting pair only where the pane is actually wide', () => {
    // `lg` split a ~725px pane into two 340px columns, narrower than the
    // single column they replaced.
    expect(OP).toMatch(/xl:grid-cols-2/)
    expect(OP).not.toMatch(/lg:grid-cols-2/)
  })

  it('keeps an empty requirement to one line and one action per area', () => {
    expect(OP).toMatch(/data-testid="requirement-notes-empty"/)
    expect(OP).toMatch(/No files attached\./)
    expect(OP).toMatch(/No discussion yet\./)
  })

  it('reports a failed upload instead of just stopping the spinner', () => {
    expect(OP).toMatch(/data-testid="requirement-upload-error"/)
    expect(OP).toMatch(/setUploadError\(err instanceof Error \? err\.message : 'Upload failed'\)/)
  })

  it('does not promise a deletion the product does not perform', () => {
    // `deleteFileM` drops the row and leaves the stored object. Reported
    // separately; the control must not call that "delete".
    expect(OP).toMatch(/Remove \$\{att\.file_name\} from this requirement/)
    expect(OP).toMatch(/title="Remove from this requirement"/)
  })

  it('opens its own queries without depending on the caller faking expansion', () => {
    expect(OP).not.toMatch(/enabled: !!item\.dbId && isExpanded/)
    expect(OP).toMatch(/enabled: !!item\.dbId && bodyOpen/)
    expect(OP).toMatch(/enabled: !!assetId && !!workflowId && bodyOpen/)
  })
})

describe('unsent text is not discarded when the requirement changes', () => {
  it('opens each editor from the kept draft', () => {
    expect(OP).toMatch(/useState\(\(\) => keptNotes !== null\)/)
    expect(OP).toMatch(/useState\(\(\) => keptNotes \?\? item\.notes \?\? ''\)/)
    expect(OP).toMatch(/useState\(\(\) => keptComment !== null\)/)
  })

  it('writes a draft when typing, never merely on opening an editor', () => {
    // Opening wrote a draft identical to the saved text, which reopened
    // the editor next visit and claimed unsaved work that did not exist.
    expect(OP).toMatch(/const openNotesEditor = \(\) => \{ setNotesDraft\(item\.notes \|\| ''\); setEditingNotes\(true\) \}/)
    expect(OP).toMatch(/onChange=\{e => editNotes\(e\.target\.value\)\}/)
    expect(OP).toMatch(/onChange=\{e => editComment\(e\.target\.value\)\}/)
  })

  it('shows the unsaved marker only when the text really differs', () => {
    expect(OP).toMatch(/const notesDirty = notesDraft !== \(item\.notes \?\? ''\)/)
    expect(OP).toMatch(/editingNotes && notesDirty/)
  })

  it('clears the draft once the text is saved, and only then', () => {
    expect(OP).toMatch(/if \('notes' in fields\) clearDraft\(notesDraftKey\)/)
    expect(OP).toMatch(/clearDraft\(commentDraftKey\)/)
  })

  it('keeps the draft when the editor is dismissed with Escape', () => {
    const at = OP.indexOf("if (e.key === 'Escape') setEditingNotes(false)")
    expect(at).toBeGreaterThan(-1)
    expect(OP).toMatch(/if \(e\.key === 'Escape'\) setAddingComment\(false\)/)
  })

  it('never sends a draft to the database', () => {
    const DRAFTS = strip(read('src/lib/asset-work/requirement-drafts.ts'))
    expect(DRAFTS).not.toMatch(/supabase/)
    expect(DRAFTS).toMatch(/sessionStorage/)
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
