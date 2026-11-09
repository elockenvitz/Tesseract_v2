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
const CANVAS = strip(read('src/components/research/ResearchArrange.tsx'))
const SPANLIB = strip(read('src/lib/research/field-span.ts'))
/* The field grid's class list, shared with the Theme page's research body. */
const GRID = strip(read('src/components/research/ResearchSectionCard.tsx'))
const HOOK = strip(read('src/hooks/useUserAssetPagePreferences.ts'))
const MANAGER = strip(read('src/components/templates/ResearchFieldsManager.tsx'))
/* LayoutStatusChip.tsx is not read here any more: what it renders in
   each state is asserted by rendering it, in
   `src/components/research/__tests__/layout-status-chip.test.tsx`. */

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
  /*
   * REWRITTEN. The grid's class list moved out of `AssetTab.tsx` into
   * `components/research/ResearchSectionCard.tsx` as
   * `RESEARCH_FIELD_GRID_CLASS`, because the Theme page's research body now
   * lays its fields out in the same grid and a second copy of the class list
   * is a second thing to keep in step. Both assertions below read it where it
   * lives and additionally require that the Asset page still applies it, so
   * neither can pass with the grid gone from the page.
   */
  it('lays sections out on twelve columns', () => {
    /* Two columns could only say "a row" or "half a row". Twelve is what
       makes a quarter, a third and two thirds expressible at all. */
    expect(GRID).toMatch(/grid grid-cols-1 items-start gap-3 .*xl:grid-cols-12/)
    expect(TAB).toContain('className={RESEARCH_FIELD_GRID_CLASS}')
  })

  it('does not stretch a card to the height of the one beside it', () => {
    /* Grid's default `align-items: stretch` padded a short field with the
       height of the tallest field in its row — 140px of white under
       Business Model, measured, while the quarter-width Investment Thesis
       next to it truncated behind "Show more". A card is its own
       content's height.

       Anchored to the TWELVE-COLUMN grid, not to `items-start` alone: an
       unrelated single-column grid further down the file already carries
       that class, so the loose version of this assertion passed with the
       fix reverted. Found by injecting exactly that. */
    expect(GRID).toMatch(/grid grid-cols-1 items-start[^']*xl:grid-cols-12/)
    expect(TAB).toContain('className={RESEARCH_FIELD_GRID_CLASS}')
  })

  it('gives each field the span it was arranged at', () => {
    /* The span class lives on the one wrapper both branches render, so
       arrange mode and the page cannot disagree about a field's width. */
    expect(CANVAS).toMatch(/className=\{`min-w-0 \$\{SPAN_CLASS\[span\]\}`\}/)
    expect(CANVAS).toMatch(/SPAN_CLASS\[span\]/)
  })

  it('takes the class from the lookup rather than building it', () => {
    /* `` `xl:col-span-${span}` `` is never seen by Tailwind's scanner, so
       the rule is never emitted and the field collapses to one column —
       in a production build only, because the dev server's JIT usually
       has the class from elsewhere. SPAN_CLASS writes all twelve out.

       Not anchored on a backtick: `` `min-w-0 xl:col-span-${n}` `` is the
       same bug with a prefix, and an assertion that only caught the
       backtick form passed on it. */
    expect(CANVAS).not.toMatch(/col-span-\$\{/)
    expect(TAB).not.toMatch(/col-span-\$\{/)
    expect(CANVAS).toMatch(/SPAN_CLASS,/)
  })
})

/*
 * ── Where width is set, and why these moved twice ─────────────────────
 *
 * Width was a "Full" / "Half" button at the end of each customizer row,
 * and these tests pinned that button's draft path. It became
 * `ResearchLayoutEditor`, a modal that drew the fields as blocks. Then
 * `ResearchArrangeCanvas`, which drew the same blocks in the page instead
 * of above it. Both are deleted, and for the same reason twice over: what
 * you dragged was not what you were arranging. A block reading
 * "Investment Thesis" cannot show you that the thesis is four paragraphs
 * and the rating beside it is one line, which is the whole question.
 *
 * `ResearchArrange` draws no fields at all. `AssetTab` renders the real
 * page, and these components WRAP what it rendered — inert content, drag
 * chrome on top, widths from the draft. So the assertions below check
 * that there is no second renderer, rather than that two renderers agree.
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

  it('wraps the real sections rather than replacing them', () => {
    /* The provider sits around the SAME `displayedFieldsBySection` map the
       page always rendered. An `arrangingLayout ? <Canvas/> : <sections/>`
       branch would be the second renderer again. */
    /* `assetId={asset.id}` until the arrange stack was parameterized over
       `ResearchSubject` so a theme could use it. The gate is unchanged in
       what it guards — that the provider WRAPS the real page and is handed
       this asset — only in how the asset is named. */
    expect(TAB).toMatch(/<ResearchArrangeProvider subject=\{assetSubject\(asset\.id\)\} active=\{arrangingLayout\}>/)
    expect(TAB).toMatch(/<ArrangeableField\b/)
    expect(TAB).toMatch(/<ArrangeableFieldGrid\b/)
    expect(TAB).not.toMatch(/ResearchLayoutEditor|ResearchArrangeCanvas/)
    expect(TAB).not.toMatch(/arrangingLayout \? \(/)
  })

  it('renders no field of its own', () => {
    /* The whole point. If this module ever draws a field, it is a second
       renderer and free to disagree with the page about the layout the
       reader is arranging. */
    expect(CANVAS).not.toMatch(/ContributionSection|FieldRenderer|field_type/)
  })

  it('keeps the grid identical in and out of arrange mode', () => {
    /* The container is handed in as `className` and rendered unchanged in
       both branches. A different grid while arranging would change the
       very measurements being arranged against. */
    expect(CANVAS).toMatch(/if \(!arrangeable\) return <div className=\{className\}>\{children\}<\/div>/)
  })

  it('makes the real field inert while it is being arranged', () => {
    /* These are live editors. A press meant to move the field would
       otherwise land a caret in the thesis, and a drag from there would
       select prose instead of moving anything. `select-none` is as load
       bearing as the pointer events. */
    expect(CANVAS).toMatch(/pointer-events-none select-none/)
  })

  it('leaves the arrow keys to dnd-kit once a field is picked up', () => {
    /* Left and right resize a field at rest, and are how dnd-kit's
       keyboard sensor MOVES one that is in the air — in a grid, the
       direction that matters. Stealing them unconditionally made a
       picked-up field movable only vertically while it silently resized. */
    expect(CANVAS).toMatch(/if \(isDragging\) return/)
  })

  it('can be resized without a mouse', () => {
    /* A drag handle alone puts the whole feature out of reach of anyone
       on a keyboard, and there would be no other way to set a span. */
    expect(CANVAS).toMatch(/ArrowLeft/)
    expect(CANVAS).toMatch(/ArrowRight/)
    expect(CANVAS).toMatch(/stepSpan\(span, e\.key === 'ArrowRight' \? 1 : -1\)/)
    expect(CANVAS).toMatch(/KeyboardSensor/)
  })

  it('measures a resize against the row, not the field', () => {
    /* A span is a fraction of the ROW. Dividing by the field's own width
       makes every drag relative to the width it already had, so it creeps
       toward whatever it was instead of landing under the pointer. */
    expect(CANVAS).toMatch(/\(clientX - left\) \/ rowBox\.width/)
    expect(CANVAS).not.toMatch(/\/ host\.getBoundingClientRect\(\)\.width/)
  })

  it('does not change visibility as a side effect of changing width', () => {
    /* The override row carries both, so creating one with a defaulted
       `is_visible` would hide or reveal the field. */
    expect(CANVAS).toMatch(/is_visible: allFields\.find\(f => f\.field_id === fieldId\)\?\.is_visible \?\? true/)
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

  it('changes a field through the draft, never by a direct write', () => {
    /*
     * Adding, removing, hiding and re-sectioning a FIELD all go into the
     * draft and land in one `saveCustomization`. Calling the per-field
     * mutations from here would be a second answer to what the layout is,
     * and would write on every drag.
     *
     * `createSection` was in this list and has been taken out, with the
     * reason recorded rather than the test deleted: sections are not
     * fields. There is no header to put "add section" on until the
     * section exists, so it is the one section action that has to live in
     * the bar — and it cannot be a draft, because a section is a row in
     * the organisation's schema that other stocks can reuse. The
     * remaining three are still forbidden.
     */
    expect(CANVAS).not.toMatch(/addFieldToSection|removeFieldFromSection|toggleAssetFieldVisibility/)
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
    /* Declared in the lib, beside the spans it governs, so a surface that
       needs to know which sections ignore a span does not have to import
       a React module to find out. */
    expect(SPANLIB).toMatch(/SELF_ARRANGED_SECTIONS = new Set\(\['forecasts', 'supporting_docs'\]\)/)
    /* Checked in BOTH places: the grid must not become a drop target, and
       the field must not gain a resize grip. Either one alone leaves half
       a control that saves a value nothing reads. */
    expect(CANVAS).toMatch(/arrange\?\.active && !SELF_ARRANGED_SECTIONS\.has\(sectionSlug\)/)
    expect(CANVAS.match(/!SELF_ARRANGED_SECTIONS\.has\(sectionSlug\)/g)?.length ?? 0)
      .toBeGreaterThanOrEqual(2)
  })

  it('shows those fields rather than hiding them', () => {
    /* A reader looking for Price Targets should find it where it lives
       and see that it does not move, not conclude arrange mode lost it.
       Because this wraps the real page, that is now the DEFAULT: an
       unarrangeable field renders through the plain branch untouched,
       and there is no filter anywhere that could drop one. */
    expect(CANVAS).not.toMatch(/\.filter\([^)]*arrangeable/)
    expect(CANVAS).toMatch(/if \(!arrangeable\) \{/)
  })

  /*
   * ── Five tests used to live here ───────────────────────────────────────
   *
   * They pinned arrange mode's three save targets: "this stock", "all
   * stocks" (rewriting the active template) and "new template". They are
   * rewritten into the single assertion below rather than deleted,
   * because what they protected is now protected by the behaviour not
   * existing.
   *
   * Arrange mode is a per-stock tool. Writing a template from here put
   * two jobs on one bar — tweak the page in front of you, and change what
   * every other page looks like — and the second job already has a home
   * in the template editor. It also carried its own hazard: because
   * per-asset settings beat the template, a template save from here had
   * to delete this asset's overrides afterwards or the one stock you were
   * looking at would be the one that did not follow what you just saved.
   *
   * What went with it: `saveToTemplate`, `saveAsNewTemplate`,
   * `stopOverridingLocally`, `templateConfigFromPage`, the target radio
   * group, the new-template name box and the scope warning. All of it is
   * at d937e4c0 if the template editor wants it.
   */
  it('writes this stock and never a template', () => {
    /* The invariant that replaces all of the above. Arrange mode holds no
       route to a shared table: no template write, and not even the
       mutations that could perform one. A regression here would quietly
       re-expose every other stock to a one-stock edit. */
    expect(CANVAS).toMatch(/await saveToAsset\(\)/)
    expect(CANVAS).not.toMatch(/updateLayout\.mutateAsync/)
    expect(CANVAS).not.toMatch(/saveLayout\.mutateAsync/)
    expect(CANVAS).not.toMatch(/data-testid="arrange-target/)
    expect(CANVAS).not.toMatch(/data-testid="arrange-scope-warning"/)
    /* The template PICKER stays: choosing which template a stock follows
       writes that stock's selection row, not the template. */
    expect(CANVAS).toMatch(/data-testid="arrange-template-picker"/)
    expect(CANVAS).toMatch(/selectLayoutForAsset\.mutateAsync/)
  })

  it('says which stock it is about to write, on the button', () => {
    /* "Save layout" reads as saving THE layout — the shared thing every
       stock uses — which is the one thing it does not do. The scope note
       in the bar says so too, but three lines above the button; the
       label is what is read at the moment of the press. */
    /*
     * `assetName ?? 'this stock'` was spelled out at each of the three
     * places it appears until the bar was parameterized over
     * `ResearchSubject`; it is now `subjectLabel`, derived once from
     * `subjectName` and `subjectNoun`. The gate is unchanged in what it
     * guards — the button names the SUBJECT and never the layout — and
     * the derivation is pinned too, so the label cannot quietly become
     * something other than this subject's name.
     */
    expect(CANVAS).toMatch(/const subjectLabel = subjectName \?\? `this \$\{subjectNoun\}`/)
    expect(CANVAS).toMatch(/`Save to \$\{subjectLabel\}`/)
    expect(CANVAS).not.toMatch(/'Save layout'/)
    expect(CANVAS).toMatch(/data-testid="arrange-scope-note"/)
    expect(CANVAS).toMatch(/Saves to \{subjectLabel\} only/)
    /* The default keeps the asset page's own words, so parameterizing the
       bar did not quietly reword the surface that already shipped. */
    expect(CANVAS).toMatch(/subjectNoun = 'stock'/)
  })

  it('still stores sections per asset, now that templates are not written here', () => {
    /* The section_config column and the resolver's merge are unaffected —
       a template can still hold sections, it is just no longer written
       from this screen. */
    expect(CANVAS).toMatch(/sectionOverrides: assetSectionOverrides/)
    expect(RESOLVER).toMatch(/section_config\?: SectionOverride\[\] \| null/)
  })

  it('merges template sections under the asset, per key', () => {
    /*
     * Per KEY, not per section: an asset that renames a section must not
     * thereby discard the template's ORDER for it. And an override row
     * carrying `name_override: undefined` would erase the template's name
     * while claiming to say nothing, so undefined values are stripped
     * before the merge.
     */
    expect(RESOLVER).toMatch(/Object\.entries\(so\)\.filter\(\(\[, v\]\) => v !== undefined\)/)
    expect(RESOLVER).toMatch(/\.\.\.base,\s*\.\.\.defined,/)
  })

  it('keeps the asset layer unmerged for saving back', () => {
    /* The RPC replaces the array it is handed, so handing back the MERGED
       view would copy the template's sections down onto the asset and
       freeze them there — the same shadowing bug as the spans, one level
       up. */
    expect(RESOLVER).toMatch(/assetSectionOverrides,/)
    expect(RESOLVER).toMatch(/resolvedSectionOverrides: Array\.from\(sectionOverrideMap\.values\(\)\)/)
    expect(CANVAS).toMatch(/sectionOverrides: assetSectionOverrides/)
  })

  it('adds and removes fields where you can see the page', () => {
    /* Taking a field off the page is decided while looking at the page.
       Both write the same `is_visible` the field customizer writes, so the
       two screens cannot disagree about what is on a page. */
    expect(CANVAS).toMatch(/data-testid=\{`arrange-remove-\$\{fieldId\}`\}/)
    expect(CANVAS).toMatch(/data-testid="arrange-add-field"/)
    expect(CANVAS).toMatch(/draft\?\.visible\.forEach\(\(v, fieldId\) => \{ touch\(fieldId\)\.is_visible = v \}\)/)
  })

  it('hands arrange mode the hidden fields so one can be put back', () => {
    /* A field filtered out before the wrapper cannot be re-mounted by
       "Add field" at all. The filter stays for the normal page and opens
       up only while arranging; `ArrangeableField` — the one place that
       knows both the saved state AND the draft — decides what renders.
       While arranging the list is drawn from EVERY section's fields, not
       this section's, because a field dragged across sections has to be
       mountable under its new one. */
    expect(TAB).toMatch(
      /arrangingLayout\s*\? sectionsForArranging\.flatMap\(s => s\.fields\)\s*: section\.fields\.filter\(f => f\.is_visible\)/,
    )
    expect(TAB).toMatch(/savedVisible=\{field\.is_visible\}/)
    expect(CANVAS).toMatch(/!arrange\.visibleOf\(fieldId, savedVisible\)/)
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
    /* Bounded to the catch BLOCK, not to the end of the file: the Cancel
       button further down calls `onClose()` legitimately, and an
       unbounded slice failed on it rather than on the thing being
       pinned. */
    /* Re-anchored from `if (target === 'template')` when the save targets
       were removed; `await saveToAsset()` is now the whole try body. */
    const tryAt = CANVAS.indexOf('await saveToAsset()')
    const catchAt = CANVAS.indexOf('} catch (e)', tryAt)
    const finallyAt = CANVAS.indexOf('} finally {', catchAt)
    expect(tryAt).toBeGreaterThan(-1)
    expect(finallyAt).toBeGreaterThan(catchAt)
    /* onClose is the LAST thing in the try, after both awaits, so a throw
       from either save path skips it. */
    expect(CANVAS.slice(tryAt, catchAt)).toMatch(/onClose\(\)/)
    expect(CANVAS.slice(catchAt, finallyAt)).not.toMatch(/onClose\(\)/)
  })
})

/*
 * ── Why this block exists ──────────────────────────────────────────────
 *
 * The concurrency guard below shipped VACUOUS once. Every piece of it was
 * present and correct — the trigger on the table, the `.eq()` on the
 * update, the thrown CONFLICT — and it still never fired, because the
 * hook handed it `updated_at: ''` and an empty string is falsy, so the
 * condition was simply never applied. It was proven by experiment: the
 * template's `updated_at` was bumped in SQL behind the app's back, the
 * save was pressed, and the save succeeded, overwriting the other write.
 *
 * So these do not test "a guard exists". They test the three separate
 * things that each, alone, turn the guard back into decoration.
 */
describe('a template write cannot silently overwrite another one', () => {
  it('narrows the update by the version it read', () => {
    /* Without the `.eq`, the write lands on whatever the row now holds. */
    expect(HOOK).toMatch(/query\.eq\('updated_at', expectedUpdatedAt\)/)
  })

  it('asks which rows changed, so a miss is visible', () => {
    /* `.eq()` on a stale value matches nothing and Supabase reports no
       error for that — an update of zero rows is a successful update.
       `.select('id')` is the only thing that makes the miss observable,
       and the throw is what turns it into something the reader sees. */
    const at = HOOK.indexOf("query.eq('updated_at', expectedUpdatedAt)")
    const window = HOOK.slice(at, at + 700)
    expect(window).toMatch(/await query\.select\('id'\)/)
    expect(window).toMatch(/if \(expectedUpdatedAt && \(!changed \|\| changed\.length === 0\)\)/)
    expect(window).toMatch(/CONFLICT:/)
  })

  it('does not stub the version out of the active template', () => {
    /* This exact line is where the guard died. `activeLayout` is built by
       spreading the resolved template and blanking the fields the caller
       must not read; `updated_at` was blanked with them, and blanking it
       disarms everything above. */
    const at = HOOK.indexOf('const activeLayout = resolution?.activeTemplate')
    const window = HOOK.slice(at, at + 600)
    expect(at).toBeGreaterThan(-1)
    expect(window).toMatch(/updated_at: resolution\.activeTemplate\.updated_at/)
    expect(window).not.toMatch(/updated_at: ''/)
  })

  it('carries the version through every layer that builds a template', () => {
    /* `LayoutTemplate` is the shape the resolver returns and the only
       route the token travels. A mapping site that forgets it hands the
       bar an undefined token, and the refusal below would then block a
       legitimate save instead of a dangerous one. */
    expect(RESOLVER).toMatch(/updated_at\?: string/)
    const sites = HOOK.match(/updated_at: \w+(\.\w+)*\.updated_at/g) ?? []
    expect(sites.length).toBeGreaterThanOrEqual(3)
  })

  it('is actually reached by the screen that writes templates', () => {
    /*
     * A guard with no caller is the same as no guard, and this one lost
     * its caller: it was built for arrange mode's "All stocks" save,
     * which has since been removed. The template editor is now the only
     * place a template's field_config is rewritten, so the token has to
     * travel from there or every assertion above this one is theatre.
     *
     * Scoped to the full-config write. `handleSetDefault` flips one
     * boolean and is deliberately NOT guarded — failing "make this my
     * default" because someone else renamed a field would be a worse bug
     * than the one being prevented.
     */
    const at = MANAGER.indexOf('const handleSaveLayout')
    const window = MANAGER.slice(at, at + 1400)
    expect(at).toBeGreaterThan(-1)
    expect(window).toMatch(/expectedUpdatedAt: editingLayout\.updated_at/)
  })
})

describe('the bar reports what the reader actually did', () => {
  it('counts real differences, not that a control was touched', () => {
    /* Dragging a field back where it was, or widening and narrowing it
       again, leaves nothing to save. Counting entries in the draft maps
       would report changes that do not exist and offer to write them. */
    const at = CANVAS.indexOf('const changed = useMemo')
    const window = CANVAS.slice(at, at + 900)
    expect(at).toBeGreaterThan(-1)
    expect(window).toMatch(/span !== \(saved\.get\(id\)\?\.span \?\? FULL_SPAN\)/)
    expect(window).toMatch(/v !== \(saved\.get\(id\)\?\.is_visible \?\? true\)/)
  })

  it('counts a reordered section once, not once per field', () => {
    /* Moving one field past another changes the index of both. Counting
       per field would report "2 changes" for one drag. */
    const at = CANVAS.indexOf('const changed = useMemo')
    const window = CANVAS.slice(at, at + 900)
    expect(window).toMatch(/ids\.length !== current\.length \|\| ids\.some\(\(id, i\) => id !== current\[i\]\)/)
  })
})

describe('a field can cross between sections', () => {
  it('records the section it landed in', () => {
    const at = CANVAS.indexOf('const onDragEnd')
    const window = CANVAS.slice(at, at + 1200)
    expect(at).toBeGreaterThan(-1)
    expect(window).toMatch(/setMoved\(prev => new Map\(prev\)\.set\(fieldId, to\)\)/)
  })

  it('writes the order of BOTH sections, not just the one it landed in', () => {
    /* The source section's order changes too — a field left a gap in it.
       Recording only the destination leaves the source unstated, so the
       saved order refills the gap with whatever it used to say and the
       remaining fields jump. */
    const at = CANVAS.indexOf('const onDragEnd')
    const window = CANVAS.slice(at, at + 1200)
    expect(window).toMatch(/setOrder\(prev => new Map\(prev\)\.set\(from, fromIds\)\.set\(to, toIds\)\)/)
  })

  it('can drop into a section that has no fields left to drop onto', () => {
    /* Without a droppable for the section's own space, moving the last
       field out of a section makes that section unreachable — there is
       nothing left to aim at. The prefix keeps a section's droppable id
       from colliding with a field's. */
    expect(CANVAS).toMatch(/const SECTION_DROP_PREFIX = 'section:'/)
    expect(CANVAS).toMatch(/overId\.startsWith\(SECTION_DROP_PREFIX\)/)
  })
})

describe('an emptied section stays on the page while arranging', () => {
  it('shows sections the normal page has no reason to draw', () => {
    /* `displayedFieldsBySection` only knows sections that HAVE fields, so
       emptying one made it disappear mid-arrange and the move became
       one-way. `sectionsForArranging` adds the rest back from the section
       catalog — and only while arranging, so the page a reader reads is
       unchanged. */
    const at = HOOK.indexOf('const sectionsForArranging')
    const window = HOOK.slice(at, at + 1400)
    expect(at).toBeGreaterThan(-1)
    expect(window).toMatch(/const present = new Set\(displayedFieldsBySection\.map\(s => s\.section_id\)\)/)
    expect(window).toMatch(/\.filter\(s => !present\.has\(s\.id\)\)/)
    expect(window).toMatch(/fields: \[\]/)
    expect(window).toMatch(/\[\.\.\.displayedFieldsBySection, \.\.\.empties\]/)
  })

  it('applies the same section names and order the real page uses', () => {
    /* An empty section drawn from the raw catalog would show its original
       name and sort to its original place, so a renamed or reordered
       section would move the moment it was emptied. */
    const at = HOOK.indexOf('const sectionsForArranging')
    const window = HOOK.slice(at, at + 2000)
    expect(window).toMatch(/resolvedSectionOverrides\.find\(ov => ov\.section_id === s\.id\)/)
    expect(window).toMatch(/o\?\.name_override \|\| s\.name/)
    expect(window).toMatch(/o\?\.display_order \?\? s\.display_order/)
    expect(window).toMatch(/\.sort\(\(a, b\) => a\.section_display_order - b\.section_display_order\)/)
  })

  it('is used only while arranging', () => {
    expect(TAB).toMatch(/arrangingLayout \? sectionsForArranging : displayedFieldsBySection/)
  })
})

/*
 * ── The state the page was never in a position to tell you ─────────────
 *
 * A Research page is resolved from two layers: a template, and this
 * stock's own overrides on top of it. The page named neither, so this was
 * reachable and invisible: change one stock, set it back by hand, and
 * believe you are back on the default. You are not — you are on an
 * override that agrees with the default today and will stop agreeing the
 * moment the template changes, at which point this one stock silently
 * refuses to follow.
 *
 * Two halves fix it: stop MAKING no-op overrides, and say out loud which
 * state you are in.
 */
describe('an override that says nothing is not an override', () => {
  it('measures "no difference" against the real resolver, not a copy', () => {
    /* The baseline is the resolver run a second time with the override
       arrays emptied. Re-deriving "what the template says" by hand would
       be a second implementation of the span fallback and the visibility
       defaults, and the moment the two disagreed this would prune real
       settings away as if they were no-ops — deleting a reader's layout
       while calling it tidying. */
    expect(HOOK).toMatch(/const baselineResolution/)
    expect(HOOK).toMatch(/field_overrides: null, section_overrides: null/)
    expect(HOOK).toMatch(/templateBaselineFields/)
  })

  it('keeps layout_id out of the baseline strip', () => {
    /* Following a chosen template is a different thing from overriding
       one. Stripping layout_id too would make every stock deliberately
       put on a template read as permanently "customized". */
    const at = HOOK.indexOf('const baselineResolution')
    const window = HOOK.slice(at, at + 500)
    expect(window).toMatch(/\.\.\.resolverInput\.assetSelection,/)
    expect(window).not.toMatch(/layout_id: null/)
  })

  it('drops a field whose override matches the template', () => {
    /* What counts as a difference — unset keys, legacy widths, a span
       the template never stated — is asserted against the real function
       in `layout-resolver.test.ts`. Pinned here: that the save asks it,
       and asks it about the baseline rather than about anything else. */
    const at = CANVAS.indexOf('const kept =')
    expect(at).toBeGreaterThan(-1)
    expect(CANVAS.slice(at, at + 300)).toMatch(
      /overrideDiffersFromBaseline\(o, templateBaselineFields\.get\(o\.field_id\)\)/,
    )
  })

  it('removes the row when nothing is left to say', () => {
    /* An empty override list still counts as a customization, so saving
       a reverted page would leave the stock reading "Custom layout" with
       nothing in it. */
    const at = CANVAS.indexOf('if (kept.length === 0')
    expect(at).toBeGreaterThan(-1)
    /* The id comes off the draft's SUBJECT now, not a bare `assetId`
       field. The window is wider than the 300 it was because the line
       carries a note on why the mutation's parameter is still named
       `assetId`; the assertion itself is the same one. */
    expect(CANVAS.slice(at, at + 700))
      .toMatch(/clearAssetOverrides\.mutateAsync\(draft\.subject\.id\)/)
    /* Only when no template was deliberately chosen — otherwise the
       reset would also throw away which template the stock follows. */
    expect(CANVAS.slice(at, at + 700)).toMatch(/&& !activeLayout\?\.id/)
  })
})

/*
 * What the chip RENDERS in each state is asserted by rendering it, in
 * `src/components/research/__tests__/layout-status-chip.test.tsx`. Only
 * the wiring is pinned here — which state each caller feeds it, which
 * source text is the only place that shows.
 */
describe('the page says which layout it is drawing', () => {
  it('is on the page, not only inside the tool that changes it', () => {
    /* The override state and its reset already existed — buried in the
       Customize Layout modal, which is the screen arrange mode replaced.
       A control nobody opens is not a control. */
    expect(TAB).toMatch(/<LayoutStatusChip/)
    expect(TAB).toMatch(/onReset=\{\(\) => clearAssetOverrides\.mutate\(asset\.id\)\}/)
  })

  it('asks whether the page DIFFERS from its template, not whether a row exists', () => {
    /* `hasAssetCustomization` is true for a row that merely repeats what
       the template says — the state every stock arranged before no-op
       pruning is in. Labelling those "Custom layout" puts a warning and
       a Reset button on a page that is drawing its template exactly. */
    const chipAt = TAB.indexOf('<LayoutStatusChip')
    const chip = TAB.slice(chipAt, chipAt + 400)
    expect(chip).toMatch(/overridden=\{overridesTemplate\}/)
    expect(chip).not.toMatch(/overridden=\{hasAssetCustomization\}/)
  })

  it('tells the chip whether the template is the reader own default', () => {
    /* Without this the chip cannot stay quiet: following your default is
       the ordinary state and earns no label, while following some other
       template is worth naming. */
    const chipAt = TAB.indexOf('<LayoutStatusChip')
    expect(TAB.slice(chipAt, chipAt + 400)).toMatch(/isDefaultTemplate=\{activeLayout\?\.is_default/)
  })

  it('does not claim a layout on somebody else research', () => {
    /* The layout layer is the reader's own; asserting a template over a
       colleague's view would be false. */
    const at = TAB.indexOf('<LayoutStatusChip')
    expect(TAB.slice(Math.max(0, at - 260), at)).toMatch(/researchViewFilter === user\?\.id/)
  })

  it('reports the same state inside arrange mode, in the same words', () => {
    /* Arrange mode used to state the layout layer in its own vocabulary
       while the toolbar outside used another. Two names for one state is
       how the original confusion started. */
    expect(CANVAS).toMatch(/<LayoutStatusChip/)
    const at = CANVAS.indexOf('<LayoutStatusChip')
    const chip = CANVAS.slice(at, at + 300)
    expect(chip).toMatch(/overridden=\{overridesTemplate\}/)
    /* Read-only: Reset is a write, and discarding the override
       mid-arrangement would throw away the draft in progress. */
    expect(chip).not.toMatch(/onReset/)
  })

  it('derives "differs" from the one shared rule, in both the chip and the save', () => {
    /* The save prunes no-op overrides and the chip decides whether any
       remain. Two implementations of "is this a difference" would
       eventually disagree, and then a stock would either reset itself on
       save while claiming to be custom, or claim to be custom with
       nothing custom about it. */
    expect(RESOLVER).toMatch(/export function overrideDiffersFromBaseline\(/)
    expect(HOOK).toMatch(/overrideDiffersFromBaseline\(o, templateBaselineFields\.get\(o\.field_id\)\)/)
    expect(CANVAS).toMatch(/overrideDiffersFromBaseline\(o, templateBaselineFields\.get\(o\.field_id\)\)/)
  })

  it('does not count a chosen template as an override', () => {
    /* `layout_id` is kept in the BASELINE (so a stock on a template is
       measured against that template) and absent from the difference
       test (so following one is not itself a difference). Reversing
       either makes every stock on a named template read "Custom". */
    const at = HOOK.indexOf('const overridesTemplate')
    expect(at).toBeGreaterThan(-1)
    expect(HOOK.slice(at, at + 400)).not.toMatch(/layout_id/)
  })
})

describe('arranging manages sections, not only fields', () => {
  /*
   * What the header RENDERS and when it writes is asserted by rendering
   * it, in `src/components/research/__tests__/arrange-section-header.test.tsx`.
   * Pinned here: that the page actually uses it, and the rules that live
   * in the page and the hook rather than in the component.
   */
  it('puts the controls on the section while arranging', () => {
    expect(TAB).toMatch(/<ArrangeableSectionHeader/)
    expect(TAB).toMatch(/arrangingLayout \? arrangeSectionHeader\(section, sectionIdx\)/)
  })

  it('replaces the collapse toggle rather than sitting beside it', () => {
    /* Collapsing a section hides the fields being arranged. Both section
       renderers — Forecasts and the generic one — must swap. */
    const swaps = TAB.match(/arrangingLayout \? arrangeSectionHeader\(/g) ?? []
    expect(swaps.length).toBe(2)
  })

  it('draws hidden sections while arranging, so hiding is not a one-way door', () => {
    expect(TAB).toMatch(/if \(section\.section_is_hidden && !arrangingLayout\) return null/)
  })

  it('writes the whole section order, not just the one that moved', () => {
    /* `display_order` is an absolute position. Renumbering only the
       moved section puts two sections on the same number, and the tie
       then breaks however the sort happens to feel that render. */
    const at = TAB.indexOf('const moveSectionWhileArranging')
    expect(at).toBeGreaterThan(-1)
    const fn = TAB.slice(at, at + 700)
    expect(fn).toMatch(/sectionsForArranging\.map\(s => s\.section_id\)/)
    expect(fn).toMatch(/reorderSections\.mutate\(\{ orderedSectionIds: next \}\)/)
  })

  it('orders against the arranging list, not the reading list', () => {
    /* The reading list drops a section once it has nothing visible in
       it. Moving past one you cannot see would skip it silently. */
    const at = TAB.indexOf('const moveSectionWhileArranging')
    expect(TAB.slice(at, at + 700)).not.toMatch(/displayedFieldsBySection/)
  })

  it('offers removal only for a section the reader added', () => {
    const at = TAB.indexOf('onRemove={section.section_is_added')
    expect(at).toBeGreaterThan(-1)
    expect(TAB.slice(at, at + 200)).toMatch(/deleteAddedSection\.mutate/)
  })

  it('adds a section from the bar, since there is no header to add it on', () => {
    expect(CANVAS).toMatch(/data-testid="arrange-add-section"/)
    expect(CANVAS).toMatch(/createSection\.mutateAsync\(\{ name, addAsOverride: true \}\)/)
  })

  it('does not offer "Add section" to someone the database will refuse', () => {
    /*
     * `research_sections` has one FOR ALL policy with a null WITH CHECK,
     * so its USING clause applies to the INSERT: a non-admin member has
     * SELECT and nothing else, and the insert fails 42501. The desktop
     * field manager shows the button to everyone and swallows the
     * rejection in a console.error — tap, menu closes, nothing happens.
     *
     * `canAuthorCatalog` (not `isOrgAdmin`) because it is false while the
     * answer is still loading: a create button that appears and vanishes
     * reads as a bug, and can be tapped in the gap.
     */
    expect(CANVAS).toMatch(/canAuthorCatalog/)
    const at = CANVAS.indexOf('data-testid="arrange-add-section"')
    expect(CANVAS.slice(Math.max(0, at - 600), at)).toMatch(/\{canAuthorCatalog && \(/)
  })

  it('does not hide that a new section joins the org schema', () => {
    /* The rest of the bar promises that arranging leaves this stock
       alone. `createSection` writes a row in the organisation's
       `research_sections` as well, and that has to be said where the
       name is typed rather than discovered on another stock later. */
    const at = CANVAS.indexOf('data-testid="arrange-new-section-name"')
    expect(at).toBeGreaterThan(-1)
    expect(CANVAS.slice(at, at + 1400)).toMatch(/organisation's list/)
  })

  it('merges a section override instead of replacing it', () => {
    /* It used to build a whole override from the keys the caller named
       and overwrite whatever the section already said, so hiding a
       section that had been renamed and reordered threw the rename and
       the order away — and the name reverted on the next load, looking
       like it had never been changed. */
    const at = HOOK.indexOf('const updateSectionOverride')
    expect(at).toBeGreaterThan(-1)
    const fn = HOOK.slice(at, at + 4000)
    expect(fn).toMatch(/const merged: SectionOverride = \{ \.\.\.existingOverride, \.\.\.patch/)
    expect(fn).toMatch(/newOverrides\[existingIndex\] = merged/)
    /* And the insert path must write the same merged value — writing a
       bare patch there was the same bug one branch over. */
    expect(fn).toMatch(/section_overrides: \[merged\]/)
  })

  it('does not keep a section override that says nothing', () => {
    /* `is_hidden: false` against a template that does not hide the
       section repeats what the template already says, and would pin the
       stock to an empty override — the trap no-op field overrides set.
       The rule itself is tested against the real function in
       `layout-resolver.test.ts`; pinned here is that the write asks it,
       and passes the template's view rather than assuming one. */
    const at = HOOK.indexOf('const updateSectionOverride')
    const fn = HOOK.slice(at, at + 2600)
    expect(fn).toMatch(/sectionOverrideSaysSomething\(merged, \{/)
    expect(fn).toMatch(/templateHidesIt: templateHidesSection\(sectionId\)/)
  })

  it('decides a reorder through the one tested rule, not inline', () => {
    /*
     * What that rule DOES — clearing positions when the order is back at
     * the baseline, keeping them when it is not or cannot be
     * established, never dropping an off-screen override — is asserted
     * against the real function in `layout-resolver.test.ts`.
     *
     * Pinned here: that the write calls it, and hands it the baseline
     * and the template's hidden flags rather than assuming either. An
     * earlier version of this test matched the inline implementation's
     * variable names and passed happily with the branch short-circuited
     * to `if (true)`, which is exactly the vacuous gate this codebase
     * keeps producing.
     */
    const at = HOOK.indexOf('const reorderSections')
    expect(at).toBeGreaterThan(-1)
    const fn = HOOK.slice(at, at + 2600)
    expect(fn).toMatch(/newOverrides = reorderedSectionOverrides\(\{/)
    expect(fn).toMatch(/baselineOrderOf: sectionBaselineOrder/)
    expect(fn).toMatch(/templateHidesSection,/)
    /* And keeps no second copy of the decision beside the call — the
       optimistic update had its own, which always wrote explicit
       positions, so a reorder back to the template order flashed
       "Custom layout" until the refetch disagreed with it. */
    expect(fn).not.toMatch(/display_order: index/)
    expect((fn.match(/reorderedSectionOverrides\(\{/g) ?? []).length).toBe(2)
  })

  it('arranges the sections the layout has, not the whole org catalog', () => {
    /*
     * The rule was "every section in the catalog that is not already on
     * the page", which re-admitted everything the layout had left out.
     * On the system default — eight visible fields across three sections
     * — arranging drew five: Key References, whose fields the default
     * does not place, and an empty custom section nobody had added to
     * this stock. The layout editor disagreed with both the page and the
     * template it claimed to be editing.
     */
    const at = HOOK.indexOf('const sectionsForArranging')
    expect(at).toBeGreaterThan(-1)
    const fn = HOOK.slice(at, at + 2200)

    /*
     * Read the FILTER, not the whole block. An earlier version of this
     * test matched the helper's definition, and so passed happily with
     * the filter rewritten to let everything through and the helper left
     * dangling above it — the vacuous gate this codebase keeps
     * producing, caught by injecting exactly that.
     */
    const filterAt = fn.indexOf('.filter(s => {')
    expect(filterAt).toBeGreaterThan(-1)
    const filter = fn.slice(filterAt, fn.indexOf('.map(s => {', filterAt))

    /* A section this stock added. */
    expect(filter).toMatch(/is_added\) return true/)
    /*
     * Or one whose fields the layout, or this stock, actually mentions.
     * This clause is also what keeps the bug the list was built for
     * fixed: moving the last field out of a section used to make the
     * move permanent, and hiding that field writes a `field_override`
     * for it, so the section still qualifies and can be refilled.
     */
    expect(filter)
      .toMatch(/fieldsWithPreferences\.some\(f => f\.section_id === s\.id && layoutAddressesField\(f\)\)/)
    /* And never "is it custom", which is what let an empty section
       nobody had added appear on every asset in the org. */
    expect(filter).not.toMatch(/is_system/)

    expect(fn).toMatch(/isFieldInTemplate\(f\.field_id, f\.field_slug\)/)
    expect(fn).toMatch(/assetFieldOverrides\.some\(o => o\.field_id === f\.field_id\)/)
  })

  it('lets Key References be arranged, though it is read elsewhere', () => {
    /* Its contents live in the Key references view tab, so reading draws
       nothing — but the section is real and can be renamed, reordered
       and hidden. Skipping it outright made the one section a reader
       could not manage the one they had to leave the page to see. */
    /* `lastIndexOf`: an earlier `continue` on the same slug filters Our
       View's prose fields, and anchoring on the first match read that
       loop instead of the renderer. */
    const at = TAB.lastIndexOf("section.section_slug === 'supporting_docs'")
    expect(at).toBeGreaterThan(-1)
    const block = TAB.slice(at, at + 500)
    expect(block).toMatch(/if \(!arrangingLayout\) return null/)
    expect(block).toMatch(/arrangeSectionHeader\(section, sectionIdx\)/)
  })
})

/*
 * Arranging is parameterized over the SUBJECT, not written against assets.
 *
 * ── Why this needs a gate ─────────────────────────────────────────────────
 *
 * The arrange stack reads and writes seven things — the section catalogue,
 * the field catalogue, the selection row, the active template, the template
 * list, the per-subject overrides and the save RPC — and every one of them
 * is a DIFFERENT TABLE on a theme page. The failure mode of getting one
 * wrong is not a crash: `useUserAssetPagePreferences` left behind anywhere
 * in here would read the ASSET catalogue while the save wrote the THEME's
 * selection row, so the bar would offer an asset's fields and persist them
 * against a theme id. Nothing type-checks that (`src/types/database.ts`
 * holds none of these tables), so it is checked here.
 *
 * Every assertion below was confirmed to fail with its change reverted.
 */
describe('the arrange bar follows the subject it is handed', () => {
  it('reaches the layout stack through the subject-aware hooks only', () => {
    expect(CANVAS).toMatch(/useResearchPagePreferences\(subject\)/)
    expect(CANVAS).toMatch(/useResearchPageLayouts\(subject\)/)
    /*
     * The asset-shaped wrappers are the whole defect this guards against.
     * They take an id and pin the subject to `asset` internally, so one
     * left behind is an asset query on a theme page that reports no error.
     */
    /* The CALL, not the name: the hooks still live in a module spelled
       `hooks/useUserAssetPagePreferences`, and the import path is not the
       thing being guarded. */
    expect(CANVAS).not.toMatch(/useUserAssetPagePreferences\(/)
    expect(CANVAS).not.toMatch(/useUserAssetPageLayouts\(/)
  })

  it('takes a subject rather than an id, so it knows which tables to read', () => {
    expect(CANVAS).toMatch(/subject: ResearchSubject\n {2}active: boolean/)
    /* An `assetId` prop on either component would be an id with no way to
       say which kind of thing it identifies — asset ids and theme ids are
       both uuids, so nothing downstream could tell them apart. */
    expect(CANVAS).not.toMatch(/assetId: string/)
    expect(CANVAS).not.toMatch(/assetName\?: string/)
  })

  it('reads that subject from the draft, so there is exactly one source', () => {
    /*
     * The bar could equally have taken its own `subject` prop. It must
     * not: two props naming the same thing is how a bar comes to read one
     * subject's catalogue while saving to another's tables, and that
     * disagreement is invisible until data lands in the wrong table.
     */
    expect(CANVAS).toMatch(/const subject = draft\?\.subject \?\? EMPTY_SUBJECT/)
    expect(CANVAS).toMatch(/^const EMPTY_SUBJECT = assetSubject\(undefined\)$/m)
  })

  it('identifies the subject by kind and id, not by object identity', () => {
    /*
     * Hosts write `subject={assetSubject(asset.id)}` inline, which is a new
     * object every render. The draft is a `useMemo` keyed on the subject,
     * so keying on the object would rebuild the draft — and re-render the
     * bar and every wrapped field — on each parent render, in the middle
     * of a drag.
     */
    const at = CANVAS.indexOf('const subject = useMemo(')
    expect(at, 'the provider stopped normalizing its subject prop')
      .toBeGreaterThan(-1)
    expect(CANVAS.slice(at, at + 300))
      .toMatch(/\[subjectProp\.descriptor\.kind, subjectProp\.id\]/)
  })

  it('still carries the subject id into the two mutations named for assets', () => {
    /*
     * `selectLayoutForAsset` and `clearAssetOverrides` keep a parameter
     * spelled `assetId` while being subject-aware inside — they write
     * `S.tables.selections` keyed on `S.subjectColumn`. That mismatch is
     * deliberate and recorded, and this pins the value handed over so a
     * future rename cannot quietly drop back to an asset-only field.
     */
    expect(CANVAS).toMatch(/assetId: draft!\.subject\.id!/)
    expect(CANVAS).not.toMatch(/draft!\.assetId|draft\?\.assetId|draft\.assetId/)
  })
})
