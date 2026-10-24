/**
 * Per-field width in the Research layout.
 *
 * The customizer could say which fields appear and in what order but not
 * how the page is laid out, so a one-line rating and a multi-paragraph
 * thesis each took a full row of a 1,900px page.
 *
 * The risk being tested is a silent one: width lives in
 * `user_asset_page_layouts.field_config`, a jsonb column that every
 * layout saved before this feature wrote without it. A missing value
 * must resolve to the old behaviour — full width — and must never be
 * guessed from the field's type.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8')
const strip = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/^\s*\/\/.*$/gm, '')

const RESOLVER = strip(read('src/lib/research/layout-resolver.ts'))
const TAB = strip(read('src/components/tabs/AssetTab.tsx'))
const CUSTOMIZER = strip(read('src/components/research/AssetPageFieldCustomizer.tsx'))
const EDITOR = strip(read('src/components/research/ResearchLayoutEditor.tsx'))

describe('a field carries its own width', () => {
  it('defaults to full, so layouts saved before widths are unchanged', () => {
    expect(RESOLVER).toMatch(/width: assetOverride\?\.width \?\? layoutConfig\?\.width \?\? 'full'/)
  })

  it('never infers a width from the field type', () => {
    /* A rating is usually short and a thesis usually long, but guessing
       would silently re-lay-out every existing reader's page. */
    expect(RESOLVER).not.toMatch(/field_type[\s\S]{0,80}'half'/)
  })

  it('offers only the two widths the grid can draw', () => {
    expect(RESOLVER).toMatch(/export type FieldWidth = 'full' \| 'half'/)
  })
})

describe('the page draws what the layout says', () => {
  it('lays sections out as a two-column grid', () => {
    expect(TAB).toMatch(/grid grid-cols-1 gap-3 border-t border-gray-100 px-5 py-2 xl:grid-cols-2/)
  })

  it('spans a full-width field across both columns', () => {
    expect(TAB).toMatch(/field\.width === 'half' \? 'min-w-0' : 'min-w-0 xl:col-span-2'/)
  })
})

/*
 * ── Where width is set, and why these moved ───────────────────────────
 *
 * Width used to be a "Full" / "Half" button at the end of each row in the
 * field customizer, and these tests pinned that button's draft path. It is
 * now set in `ResearchLayoutEditor`, which draws the fields as the grid
 * they form, because a reader asked to change the page's layout could not
 * tell that a word at the end of a list row was the control and could not
 * see the page it produced without closing the modal.
 *
 * The rules did not change and are re-pinned below against their new home:
 * a width change must not flip visibility, the value must survive a save,
 * and an unsaved change must be visible before it is written. What is new
 * is the one the old arrangement got wrong — the per-asset save dropped
 * `width` from its payload, so the button persisted nothing at all.
 */
describe('the customizer reports the width but no longer sets it', () => {
  it('has no second width control', () => {
    /* Two places to set one value is how they drift. */
    expect(CUSTOMIZER).not.toMatch(/const handleSetFieldWidth/)
    expect(CUSTOMIZER).not.toMatch(/onSetFieldWidth/)
  })

  it('still shows what the layout says', () => {
    expect(CUSTOMIZER).toMatch(/data-testid=\{`field-width-\$\{field\.field_id\}`\}/)
  })

  it('carries the width when a layout is copied to a template', () => {
    /* Omitting it there would reset every field to full width the next
       time that template was loaded. */
    expect(CUSTOMIZER).toMatch(/width: f\.width \?\? 'full'/)
  })

  it('sends the width when saving per-asset overrides', () => {
    /* THE BUG. `handleSetFieldWidth` wrote `width` into the draft and
       `handleSaveChanges` built the RPC payload without it, so changing a
       width and pressing Save persisted nothing — the control looked live
       and did nothing. `save_asset_layout_customization` stores
       `field_overrides` as opaque jsonb, so the value round trips as soon
       as it is sent. */
    const at = CUSTOMIZER.indexOf('fieldOverrides.push({')
    expect(at).toBeGreaterThan(-1)
    expect(CUSTOMIZER.slice(at, at + 400)).toMatch(/width: override\.width/)
  })

  it('shows the unsaved width before it is written', () => {
    expect(CUSTOMIZER).toMatch(/width: draftOverride\?\.width \?\? config\.width \?\? 'full'/)
  })
})

describe('the layout editor is the one place width is set', () => {
  it('draws the page the page draws', () => {
    /* A diagram that is not the grid would be a second renderer, free to
       disagree with the real one about what the layout looks like. */
    expect(EDITOR).toMatch(/grid grid-cols-2 gap-2/)
    expect(EDITOR).toMatch(/\(b\.width === 'full' \|\| !s\.arrangeable\) && 'col-span-2'/)
  })

  it('does not change visibility as a side effect of changing width', () => {
    /* The override row carries both, so writing one with a defaulted
       `is_visible` would hide or reveal the field. */
    expect(EDITOR).toMatch(/is_visible: existing\?\.is_visible \?\? visibilityOf\(fieldId\)/)
  })

  it('merges onto the saved overrides instead of replacing them', () => {
    /* `save_asset_layout_customization` writes the array it is handed and
       drops the rest. Sending only the changed fields would delete every
       visibility, section and order override the customizer had saved. */
    expect(EDITOR).toMatch(/for \(const o of assetFieldOverrides\) byId\.set\(o\.field_id, \{ \.\.\.o \}\)/)
  })

  it('passes the section overrides back rather than clearing them', () => {
    /* Same replace-all rule, and `[]` here would delete every renamed,
       hidden or reordered section. */
    expect(EDITOR).toMatch(/sectionOverrides: assetSectionOverrides/)
    expect(EDITOR).not.toMatch(/sectionOverrides: \[\]/)
  })

  it('cannot add, remove or reorder a field', () => {
    /* One verb. Those belong to the customizer, and a second implementation
       would be a second answer to what the layout is. */
    expect(EDITOR).not.toMatch(/addFieldToSection|removeFieldFromSection|reorderFieldsInSection/)
  })

  it('starts clean each time it opens', () => {
    /* Closing with unsaved widths and reopening showed them as saved, with
       the page behind saying otherwise. */
    expect(EDITOR).toMatch(/if \(isOpen\) \{ setDraft\(new Map\(\)\); setError\(null\) \}/)
  })

  it('does not offer a width the page will ignore', () => {
    /*
     * `AssetTab` renders most sections into the two-column grid, but
     * `forecasts` draws its fields as fixed tiles and `supporting_docs` is
     * lifted out to Key References. Measured on the running app: of the
     * eight fields the editor listed for AAPL, only the five in Thesis &
     * Risks and Catalysts & Events carry `data-field-width` at all.
     * Offering Rating or Price Targets a width would save a value nothing
     * reads, and the reader would be left wondering why the page ignored
     * them.
     */
    expect(EDITOR).toMatch(/SELF_ARRANGED_SECTIONS = new Set\(\['forecasts', 'supporting_docs'\]\)/)
    expect(EDITOR).toMatch(/arrangeable: !SELF_ARRANGED_SECTIONS\.has\(s\.section_slug\)/)
    expect(EDITOR).toMatch(/disabled=\{!s\.arrangeable\}/)
  })

  it('shows those fields rather than hiding them', () => {
    /* A reader looking for Price Targets should find it and be told why
       it cannot move, not conclude the editor lost it. */
    expect(EDITOR).toMatch(/the page arranges this section itself/)
    expect(EDITOR).not.toMatch(/\.filter\(s => s\.arrangeable\)/)
  })

  it('says a failed save failed', () => {
    /* The RPC raises CONFLICT when the layout changed in another tab;
       closing on that would look like success. */
    expect(EDITOR).toMatch(/data-testid="layout-editor-error"/)
    expect(EDITOR).toMatch(/catch \(e\)/)
  })
})
