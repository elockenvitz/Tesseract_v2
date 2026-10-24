/**
 * The Research page's shape, edited by looking at it.
 *
 * ── Why this is not part of the field customizer ────────────────────────
 *
 * The customizer answers "which fields exist, in what order, in which
 * section". That is a list, and a list is the right shape for it. How the
 * page LOOKS is a different question with a different natural shape — a
 * picture — and it was answered inside that list by a 10px button on each
 * row reading "Full" or "Half". To widen one field you opened a modal,
 * found its row among the others, read a word, and pressed it; nothing
 * showed you the page you were producing, so you closed the modal to find
 * out. Asked to change the layout, a reader could not tell that control was
 * the layout.
 *
 * So this is the same preference with the other shape: every visible field
 * drawn as a block in the grid the page actually uses, click one to change
 * its width, and the blocks reflow as the page will. Nothing here is new
 * state — it reads and writes `width` in the layout's existing
 * `field_config` / `field_overrides` jsonb, the same value the row button
 * wrote.
 *
 * ── What it deliberately cannot do ──────────────────────────────────────
 *
 * Add, remove, rename, reorder or re-section a field. Those are the
 * customizer's, and duplicating any of them would make two screens that
 * disagree about what the layout is. This one has exactly one verb.
 *
 * ── Why the save merges rather than replaces ────────────────────────────
 *
 * `save_asset_layout_customization` is a replace-all RPC: it writes the
 * `field_overrides` array it is handed and drops whatever it is not. An
 * editor that sent only the fields whose width it changed would delete
 * every visibility, section and order override the customizer had saved.
 * So the draft starts from the overrides that exist and adds width to them.
 */
import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { clsx } from 'clsx'
import { Columns2, Info, RectangleHorizontal, X } from 'lucide-react'
import {
  useUserAssetPagePreferences,
  type FieldOverride,
} from '../../hooks/useUserAssetPagePreferences'
import type { FieldWidth } from '../../lib/research/layout-resolver'

export interface ResearchLayoutEditorProps {
  isOpen: boolean
  onClose: () => void
  assetId: string
  assetName?: string | null
}

/**
 * Sections the Research page lays out itself, ignoring per-field width.
 *
 * `AssetTab` renders most sections into a two-column grid that reads each
 * field's `width`. These two take their own branch: `forecasts` draws its
 * fields as fixed tiles, and `supporting_docs` is lifted out to the Key
 * References tab entirely. Setting a width on a field in either saves a
 * value nothing reads.
 *
 * They are shown rather than hidden — a reader looking for Price Targets
 * should find it and be told why it cannot move, instead of concluding the
 * editor has lost it — and the blocks are inert so the control cannot lie.
 */
const SELF_ARRANGED_SECTIONS = new Set(['forecasts', 'supporting_docs'])

/** A field as this editor needs it: identity, a name, and how wide. */
interface Block {
  fieldId: string
  name: string
  width: FieldWidth
}

interface SectionBlocks {
  sectionId: string
  sectionName: string
  /** False when the page arranges this section's fields for itself. */
  arrangeable: boolean
  blocks: Block[]
}

export function ResearchLayoutEditor({
  isOpen, onClose, assetId, assetName,
}: ResearchLayoutEditorProps) {
  const {
    displayedFieldsBySection,
    assetFieldOverrides,
    assetSectionOverrides,
    activeLayout,
    isLoading,
    saveCustomization,
  } = useUserAssetPagePreferences(assetId)

  /** Widths the reader has changed but not saved, by field id. */
  const [draft, setDraft] = useState<Map<string, FieldWidth>>(new Map())
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  /*
   * Reopening is a fresh start.
   *
   * Without this, closing with unsaved widths and opening again showed
   * them as though they had been saved — the page behind said otherwise,
   * and the reader had no way to tell which was true.
   */
  useEffect(() => {
    if (isOpen) { setDraft(new Map()); setError(null) }
  }, [isOpen])

  const sections: SectionBlocks[] = useMemo(
    () => (displayedFieldsBySection ?? []).map(s => ({
      sectionId: s.section_id,
      sectionName: s.section_name,
      arrangeable: !SELF_ARRANGED_SECTIONS.has(s.section_slug),
      /* Hidden fields are not drawn, because they are not on the page.
         Their width is left untouched rather than reset — a field made
         visible again should come back the width it was. */
      blocks: s.fields
        .filter(f => f.is_visible)
        .map(f => ({
          fieldId: f.field_id,
          name: f.field_name,
          width: draft.get(f.field_id) ?? f.width ?? 'full',
        })),
    })).filter(s => s.blocks.length > 0),
    [displayedFieldsBySection, draft],
  )

  const dirty = draft.size > 0

  const toggle = (fieldId: string, current: FieldWidth) => {
    setDraft(prev => {
      const next = new Map(prev)
      next.set(fieldId, current === 'half' ? 'full' : 'half')
      return next
    })
  }

  const save = async () => {
    if (!dirty) { onClose(); return }
    setSaving(true)
    setError(null)
    try {
      /*
       * Start from what is already saved so nothing else is lost, then
       * apply the new widths. A field with a width change but no existing
       * override needs one created, and it must carry that field's CURRENT
       * visibility — defaulting it would hide or reveal the field as a
       * side effect of making it narrower.
       */
      const byId = new Map<string, FieldOverride>()
      for (const o of assetFieldOverrides) byId.set(o.field_id, { ...o })

      const visibilityOf = (fieldId: string): boolean =>
        (displayedFieldsBySection ?? [])
          .flatMap(s => s.fields)
          .find(f => f.field_id === fieldId)?.is_visible ?? true

      draft.forEach((width, fieldId) => {
        const existing = byId.get(fieldId)
        byId.set(fieldId, {
          field_id: fieldId,
          is_visible: existing?.is_visible ?? visibilityOf(fieldId),
          section_id: existing?.section_id,
          display_order: existing?.display_order,
          width,
        })
      })

      await saveCustomization.mutateAsync({
        layoutId: activeLayout?.id ?? null,
        fieldOverrides: Array.from(byId.values()),
        /* Not this editor's to change — but the RPC replaces what it is
           handed, so sending `[]` would DELETE every renamed, hidden or
           reordered section the customizer had saved. They are passed
           back exactly as they came. */
        sectionOverrides: assetSectionOverrides,
        newSections: [],
      })
      onClose()
    } catch (e) {
      /* Saving can genuinely fail — the RPC raises CONFLICT when the
         layout changed in another tab. Saying so beats closing as if it
         had worked. */
      setError(e instanceof Error ? e.message : 'Could not save the layout.')
    } finally {
      setSaving(false)
    }
  }

  if (!isOpen) return null

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="flex max-h-[88vh] w-full max-w-3xl flex-col overflow-hidden rounded-xl bg-white shadow-xl dark:bg-gray-800">
        <div className="flex items-start justify-between gap-4 border-b border-gray-200 px-5 py-3.5 dark:border-gray-700">
          <div className="min-w-0">
            <h2 className="text-[15px] font-semibold text-gray-900 dark:text-gray-100">
              Page layout
            </h2>
            <p className="mt-0.5 text-[12px] text-gray-500 dark:text-gray-400">
              How the Research page is arranged{assetName ? ` for ${assetName}` : ''}.
              Click a block to switch it between full and half width.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            data-testid="layout-editor-close"
            aria-label="Close"
            className="flex-none rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-700"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {isLoading ? (
            <div className="space-y-3" data-testid="layout-editor-loading">
              {[0, 1, 2].map(i => (
                <div key={i} className="h-20 animate-pulse rounded-lg bg-gray-100 dark:bg-gray-700" />
              ))}
            </div>
          ) : sections.length === 0 ? (
            <p className="text-[13px] text-gray-500 dark:text-gray-400" data-testid="layout-editor-empty">
              No fields are visible on this page yet. Add them in Customize
              fields, then arrange them here.
            </p>
          ) : (
            <div className="space-y-5" data-testid="layout-editor-canvas">
              {sections.map(s => (
                <section
                  key={s.sectionId}
                  data-testid={`layout-section-${s.sectionId}`}
                  data-arrangeable={s.arrangeable}
                >
                  <h3 className="mb-1.5 flex flex-wrap items-baseline gap-x-2 text-[10px] font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500">
                    {s.sectionName}
                    {!s.arrangeable && (
                      <span className="font-medium normal-case tracking-normal text-gray-400">
                        — the page arranges this section itself
                      </span>
                    )}
                  </h3>
                  {/*
                    The page's own grid, at a smaller size. Two columns with
                    a full-width field spanning both is exactly what
                    AssetTab renders, so what is drawn here is the layout
                    rather than a diagram of it — if these disagree, the
                    editor is lying.
                  */}
                  <div className="grid grid-cols-2 gap-2">
                    {s.blocks.map(b => (
                      <button
                        key={b.fieldId}
                        type="button"
                        data-testid={`layout-block-${b.fieldId}`}
                        data-width={b.width}
                        disabled={!s.arrangeable}
                        aria-pressed={s.arrangeable ? b.width === 'half' : undefined}
                        onClick={() => toggle(b.fieldId, b.width)}
                        title={!s.arrangeable
                          ? `${b.name} — the page places this field itself, so it has no width to set here.`
                          : b.width === 'half'
                            ? `${b.name} — half width. Click for full width.`
                            : `${b.name} — full width. Click for half width.`}
                        className={clsx(
                          'group flex min-h-[54px] flex-col justify-between rounded-lg border px-2.5 py-2 text-left transition-colors',
                          s.arrangeable
                            ? 'border-gray-200 bg-gray-50 hover:border-primary-400 hover:bg-primary-50/50 dark:border-gray-600 dark:bg-gray-900/40 dark:hover:border-primary-500'
                            : 'cursor-default border-dashed border-gray-200 bg-transparent dark:border-gray-700',
                          /* An unarrangeable section is drawn one per row:
                             showing it in two columns would claim a shape
                             the page does not use. */
                          (b.width === 'full' || !s.arrangeable) && 'col-span-2',
                        )}
                      >
                        <span className={clsx(
                          'line-clamp-2 text-[12px] font-medium',
                          s.arrangeable
                            ? 'text-gray-800 dark:text-gray-100'
                            : 'text-gray-400 dark:text-gray-500',
                        )}>
                          {b.name}
                        </span>
                        {s.arrangeable && (
                          <span className="mt-1 inline-flex items-center gap-1 text-[10px] uppercase tracking-wide text-gray-400 group-hover:text-primary-600 dark:text-gray-500">
                            {b.width === 'half' ? (
                              <><Columns2 className="h-3 w-3" aria-hidden="true" /> Half</>
                            ) : (
                              <><RectangleHorizontal className="h-3 w-3" aria-hidden="true" /> Full</>
                            )}
                          </span>
                        )}
                      </button>
                    ))}
                  </div>
                </section>
              ))}

              <p className="flex items-start gap-1.5 border-t border-gray-100 pt-3 text-[11px] text-gray-400 dark:border-gray-700">
                <Info className="h-3.5 w-3.5 flex-none translate-y-px" aria-hidden="true" />
                <span>
                  Two columns appear on wide screens. On a narrow window every
                  field is full width, whatever is set here. To add, remove,
                  rename or reorder fields, use Customize fields.
                </span>
              </p>
            </div>
          )}
        </div>

        {error && (
          <p
            data-testid="layout-editor-error"
            className="border-t border-amber-200 bg-amber-50 px-5 py-2 text-[12px] text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300"
          >
            {error}
          </p>
        )}

        <div className="flex items-center justify-between gap-3 border-t border-gray-200 bg-gray-50 px-5 py-3 dark:border-gray-700 dark:bg-gray-900">
          <span className="text-[11px] text-gray-500 dark:text-gray-400" data-testid="layout-editor-dirty">
            {dirty
              ? `${draft.size} field${draft.size === 1 ? '' : 's'} changed, not saved yet`
              : 'No changes'}
          </span>
          <span className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              data-testid="layout-editor-cancel"
              className="rounded-md px-3 py-1.5 text-[12px] font-medium text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={save}
              disabled={!dirty || saving}
              data-testid="layout-editor-save"
              className="rounded-md bg-primary-600 px-3 py-1.5 text-[12px] font-semibold text-white hover:bg-primary-700 disabled:opacity-50"
            >
              {saving ? 'Saving…' : 'Save layout'}
            </button>
          </span>
        </div>
      </div>
    </div>,
    document.body,
  )
}
