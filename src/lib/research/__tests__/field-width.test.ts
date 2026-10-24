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

describe('the customizer can set it, and saves it', () => {
  it('toggles through the same draft path as visibility', () => {
    expect(CUSTOMIZER).toMatch(/const handleSetFieldWidth = \(fieldId: string, width: FieldWidth\)/)
    expect(CUSTOMIZER).toMatch(/setDraftFieldOverrides/)
  })

  it('does not change visibility as a side effect of changing width', () => {
    /* The override row carries both fields, so writing one with a
       defaulted `is_visible` would hide or reveal the field. */
    const at = CUSTOMIZER.indexOf('const handleSetFieldWidth')
    expect(at).toBeGreaterThan(-1)
    expect(CUSTOMIZER.slice(at, at + 900))
      .toMatch(/is_visible: existing\?\.is_visible \?\? field\?\.is_visible \?\? true/)
  })

  it('writes the width into the saved layout', () => {
    /* Omitting it on save would reset every field to full width the
       next time the layout was loaded. */
    expect(CUSTOMIZER).toMatch(/width: f\.width \?\? 'full'/)
  })

  it('shows the unsaved width before it is written', () => {
    expect(CUSTOMIZER).toMatch(/width: draftOverride\?\.width \?\? config\.width \?\? 'full'/)
  })
})
