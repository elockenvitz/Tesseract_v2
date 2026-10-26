/**
 * Per-field width in the Research layout.
 *
 * ── Why this file is still called field-width ───────────────────────────
 *
 * It pins the same preference through its third shape. It began as a
 * "Full"/"Half" button at the end of each customizer row, became a modal
 * that drew the fields as blocks, and is now spans dragged on the page
 * itself. The VALUE moved too — `width: 'full' | 'half'` became
 * `span: 1..12` — and the assertions below moved with it. They are
 * rewritten rather than deleted because the rules they protect did not
 * change: a layout saved before the change must draw as it did, a width
 * must never be guessed, and a save must not drop it.
 *
 * The risk is a silent one throughout. Width lives in
 * `user_asset_page_layouts.field_config`, a jsonb column written by every
 * version of this app. A missing value must resolve to the old behaviour
 * — a full row — and must never be inferred from the field's type.
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
const CANVAS = strip(read('src/components/research/ResearchArrangeCanvas.tsx'))

describe('a field carries its own width', () => {
  it('defaults to a full row, so layouts saved before spans are unchanged', () => {
    /* Four sources in order, ending in FULL_SPAN. The two `width` steps
       are the legacy ones: a layout that stored 'half' must still draw at
       six twelfths, which is what it drew before spans existed. */
    expect(RESOLVER).toMatch(/\?\? FULL_SPAN,/)
    expect(RESOLVER).toMatch(/asSpan\(assetOverride\?\.span\)/)
    expect(RESOLVER).toMatch(/asSpan\(layoutConfig\?\.span\)/)
    expect(RESOLVER).toMatch(/assetOverride\?\.width \? spanFromWidth\(assetOverride\.width\) : null/)
    expect(RESOLVER).toMatch(/layoutConfig\?\.width \? spanFromWidth\(layoutConfig\.width\) : null/)
  })

  it('prefers the per-asset span over the layout, and a span over a width', () => {
    /* Order is the whole contract. A page arranged for THIS asset must
       beat the template, and a span written today must beat a width
       written before — reverse either and a reader's arrangement is
       silently overruled by a value they thought they had replaced. */
    const at = RESOLVER.indexOf('asSpan(assetOverride?.span)')
    const window = RESOLVER.slice(at, at + 300)
    expect(window.indexOf('asSpan(layoutConfig?.span)'))
      .toBeGreaterThan(window.indexOf('asSpan(assetOverride?.span)'))
    expect(window.indexOf('spanFromWidth(assetOverride.width)'))
      .toBeGreaterThan(window.indexOf('asSpan(layoutConfig?.span)'))
  })

  it('never infers a width from the field type', () => {
    /* A rating is usually short and a thesis usually long, but guessing
       would silently re-lay-out every existing reader's page. */
    expect(RESOLVER).not.toMatch(/field_type[\s\S]{0,80}(FULL_SPAN|asSpan|spanFromWidth)/)
  })

  it('keeps reading the legacy two-value width', () => {
    /* Deleting this type would not be a cleanup: it is what thousands of
       rows of jsonb already say, and the resolver falls back to it. */
    expect(RESOLVER).toMatch(/export type FieldWidth = 'full' \| 'half'/)
    expect(RESOLVER).toMatch(/export function spanFromWidth/)
  })
})

describe('the page draws what the layout says', () => {
  it('lays sections out on twelve columns', () => {
    /* Two columns could only say "a row" or "half a row". Twelve is what
       makes a quarter, a third and two thirds expressible at all. */
    expect(TAB).toMatch(/grid grid-cols-1 gap-3 border-t border-gray-100 px-5 py-2 xl:grid-cols-12/)
  })

  it('gives each field the span it was arranged at', () => {
    expect(TAB).toMatch(/className=\{`min-w-0 \$\{SPAN_CLASS\[field\.span\]\}`\}/)
  })

  it('takes the class from the lookup rather than building it', () => {
    /* `` `xl:col-span-${span}` `` is never seen by Tailwind's scanner, so
       the rule is never emitted and the field collapses to one column —
       in a production build only, because the dev server's JIT usually
       has the class from elsewhere. SPAN_CLASS writes all twelve out. */
    /* Not anchored on a backtick: `` `min-w-0 xl:col-span-${n}` `` is the
       same bug with a prefix, and an assertion that only caught the
       backtick form passed on it. */
    expect(TAB).not.toMatch(/col-span-\$\{/)
    expect(TAB).toMatch(/import \{ SPAN_CLASS \} from '\.\.\/\.\.\/lib\/research\/field-span'/)
  })
})

/*
 * ── Where width is set, and why these moved twice ─────────────────────
 *
 * Width was a "Full" / "Half" button at the end of each customizer row,
 * and these tests pinned that button's draft path. It became
 * `ResearchLayoutEditor`, a modal that drew the fields as the grid they
 * form. It is now `ResearchArrangeCanvas`, which is not a modal at all —
 * the Research body becomes its own tiles, in place, and the reader drags
 * them. The modal is deleted: it floated above the page, so you had to
 * close it to see what you had done.
 *
 * The rules did not change and are re-pinned below against their new home:
 * a width change must not flip visibility, the value must survive a save,
 * and an unsaved change must be visible before it is written. The one the
 * first arrangement got wrong — the per-asset save dropped the width from
 * its payload, so the button persisted nothing — is pinned twice now,
 * because the same omission is available to every writer of that payload.
 */
describe('the customizer reports the width but no longer sets it', () => {
  it('has no second width control', () => {
    /* Two places to set one value is how they drift. */
    expect(CUSTOMIZER).not.toMatch(/const handleSetFieldWidth/)
    expect(CUSTOMIZER).not.toMatch(/onSetFieldWidth/)
    expect(CUSTOMIZER).not.toMatch(/const handleSetFieldSpan/)
  })

  it('still shows what the layout says', () => {
    expect(CUSTOMIZER).toMatch(/data-testid=\{`field-span-\$\{field\.field_id\}`\}/)
  })

  it('says nothing on a full-width field', () => {
    /* Full width is the default, so labelling it would put the same word
       on every row and tell the reader nothing. */
    expect(CUSTOMIZER).toMatch(/field\.is_visible && field\.span !== FULL_SPAN/)
  })

  it('carries the span when a layout is copied to a template', () => {
    /* Omitting it would reset every field to full width the next time
       that template was loaded. */
    expect(CUSTOMIZER).toMatch(/span: f\.span \?\? FULL_SPAN/)
  })

  it('sends the span when saving per-asset overrides', () => {
    /* THE BUG, in its original form: the draft held the width and the RPC
       payload was built without it, so changing a width and pressing Save
       persisted nothing. `save_asset_layout_customization` REPLACES the
       `field_overrides` array it is handed, so an omitted span here is
       not merely unsaved — it deletes the span already stored. Both keys
       travel, because a field arranged before spans existed has only the
       legacy one. */
    const at = CUSTOMIZER.indexOf('fieldOverrides.push({')
    expect(at).toBeGreaterThan(-1)
    const payload = CUSTOMIZER.slice(at, at + 400)
    expect(payload).toMatch(/span: override\.span/)
    expect(payload).toMatch(/width: override\.width/)
  })

  it('keeps the span when a field is hidden and shown again', () => {
    /* `handleRemoveFieldFromSection` rebuilt the override from
       `section_id` and `display_order`, dropping the span — so hiding an
       arranged field returned it to full width, permanently, because of
       the replace-all rule above. Spreading `existing` is the fix, and
       the reason this asserts the spread rather than the keys. */
    const at = CUSTOMIZER.indexOf('const handleRemoveFieldFromSection')
    expect(at).toBeGreaterThan(-1)
    const body = CUSTOMIZER.slice(at, at + 900)
    expect(body).toMatch(/\.\.\.existing,/)
    expect(body).not.toMatch(/section_id: existing\?\.section_id,\s*display_order: existing\?\.display_order\s*\}\)/)
  })

  it('shows the unsaved span before it is written', () => {
    expect(CUSTOMIZER).toMatch(/asSpan\(draftOverride\?\.span\)/)
  })

  it('resolves its preview in the same order as the resolver', () => {
    /* This is a SECOND resolution of the same four sources, for the row
       label only. If it disagreed with `layout-resolver`, the customizer
       would report a width the page does not draw. */
    const at = CUSTOMIZER.indexOf('asSpan(draftOverride?.span)')
    const window = CUSTOMIZER.slice(at, at + 320)
    expect(window).toMatch(/asSpan\(config\.span\)/)
    expect(window).toMatch(/spanFromWidth\(draftOverride\.width\)/)
    expect(window).toMatch(/spanFromWidth\(config\.width\)/)
    expect(window).toMatch(/\?\? FULL_SPAN/)
  })
})

describe('the layout is arranged on the page, not above it', () => {
  it('is not a dialog', () => {
    /* The point of the change. A modal had to be closed to see its own
       effect, which is why the control it replaced was unfindable. */
    expect(CANVAS).not.toMatch(/createPortal/)
    expect(CANVAS).not.toMatch(/fixed inset-0/)
    expect(CANVAS).not.toMatch(/isOpen/)
  })

  it('replaces the sections rather than overlaying them', () => {
    expect(TAB).toMatch(/\) : arrangingLayout \? \(/)
    expect(TAB).toMatch(/<ResearchArrangeCanvas/)
    expect(TAB).not.toMatch(/ResearchLayoutEditor/)
  })

  it('draws the page the page draws', () => {
    /* A diagram that is not the grid would be a second renderer, free to
       disagree with the real one about what the layout looks like. */
    expect(CANVAS).toMatch(/grid grid-cols-12 gap-2/)
    expect(CANVAS).toMatch(/SPAN_CLASS_FLAT\[tile\.span\]/)
  })

  it('can be resized without a mouse', () => {
    /* A drag handle alone puts the whole feature out of reach of anyone
       on a keyboard, and there would be no other way to set a span. */
    expect(CANVAS).toMatch(/ArrowLeft/)
    expect(CANVAS).toMatch(/ArrowRight/)
    expect(CANVAS).toMatch(/stepSpan\(tile\.span/)
    expect(CANVAS).toMatch(/KeyboardSensor/)
  })

  it('measures a resize against the row, not the tile', () => {
    /* A span is a fraction of the ROW. Dividing by the tile's own width
       makes every drag relative to the width the tile already had, so it
       creeps toward whatever it was instead of landing where the pointer
       is. */
    expect(CANVAS).toMatch(/\(clientX - tileBox\.left\) \/ rowBox\.width/)
    expect(CANVAS).not.toMatch(/\/ tileBox\.width/)
  })

  it('does not change visibility as a side effect of changing width', () => {
    /* The override row carries both, so writing one with a defaulted
       `is_visible` would hide or reveal the field. */
    expect(CANVAS).toMatch(/is_visible: visibilityOf\(fieldId\)/)
  })

  it('merges onto the saved overrides instead of replacing them', () => {
    /* `save_asset_layout_customization` writes the array it is handed and
       drops the rest. Sending only the changed fields would delete every
       visibility, section and order override the customizer had saved. */
    expect(CANVAS).toMatch(/for \(const o of assetFieldOverrides\) byId\.set\(o\.field_id, \{ \.\.\.o \}\)/)
  })

  it('passes the section overrides back rather than clearing them', () => {
    /* Same replace-all rule, and `[]` here would delete every renamed,
       hidden or reordered section. */
    expect(CANVAS).toMatch(/sectionOverrides: assetSectionOverrides/)
    expect(CANVAS).not.toMatch(/sectionOverrides: \[\]/)
  })

  it('renumbers every field in a section it reorders', () => {
    /*
     * `display_order` is an absolute position, not a link to a neighbour.
     * Writing the moved field's new index while the others keep their old
     * ones puts two fields on the same number, and which one draws first
     * is then up to the sort's stability — the tile returns to where it
     * was, or does not, depending on the data.
     */
    expect(CANVAS).toMatch(/ids\.forEach\(\(fieldId, index\) => \{ touch\(fieldId\)\.display_order = index \}\)/)
  })

  it('cannot add, remove, hide or re-section a field', () => {
    /* Those belong to the customizer, and a second implementation would
       be a second answer to what the layout is. */
    expect(CANVAS).not.toMatch(/addFieldToSection|removeFieldFromSection|toggleAssetFieldVisibility|createSection/)
  })

  it('does not offer a width the page will ignore', () => {
    /*
     * `AssetTab` renders most sections into the twelve-column grid, but
     * `forecasts` draws its fields as fixed tiles and `supporting_docs` is
     * lifted out to Key References. Measured on the running app: of the
     * eight fields the editor listed for AAPL, only the five in Thesis &
     * Risks and Catalysts & Events carried a width attribute at all.
     * Offering Rating or Price Targets a span would save a value nothing
     * reads, and the reader would be left wondering why the page ignored
     * them.
     */
    expect(CANVAS).toMatch(/SELF_ARRANGED_SECTIONS = new Set\(\['forecasts', 'supporting_docs'\]\)/)
    expect(CANVAS).toMatch(/arrangeable: !SELF_ARRANGED_SECTIONS\.has\(s\.section_slug\)/)
    expect(CANVAS).toMatch(/s\.arrangeable \? \(/)
  })

  it('shows those fields rather than hiding them', () => {
    /* A reader looking for Price Targets should find it and be told why
       it cannot move, not conclude this screen lost it. */
    expect(CANVAS).toMatch(/the page arranges this section itself/)
    expect(CANVAS).not.toMatch(/\.filter\(s => s\.arrangeable\)/)
  })

  it('says a failed save failed', () => {
    /* The RPC raises CONFLICT when the layout changed in another tab;
       closing on that would look like success. */
    expect(CANVAS).toMatch(/data-testid="arrange-error"/)
    expect(CANVAS).toMatch(/catch \(e\)/)
  })

  it('does not leave arrange mode on a failed save', () => {
    /* `onClose` inside the try, after the await, is what makes this true:
       a throw skips it and the reader keeps their unsaved arrangement
       with the error in front of them. */
    const at = CANVAS.indexOf('await saveCustomization.mutateAsync')
    const catchAt = CANVAS.indexOf('} catch (e)', at)
    expect(at).toBeGreaterThan(-1)
    expect(catchAt).toBeGreaterThan(at)
    expect(CANVAS.slice(catchAt)).not.toMatch(/onClose\(\)/)
  })
})
