import { useMemo, useState } from 'react'
import { clsx } from 'clsx'
import { FileText, Plus } from 'lucide-react'
import { MobileTemplateShell } from './MobileTemplateShell'
import { useInvestmentCaseTemplates } from '../../../hooks/useInvestmentCaseTemplates'
import { InvestmentCaseTemplatePreview } from '../../investment-case-templates'
import {
  buildSavePayload,
  validateDraft,
  type InvestmentCaseDraft,
} from '../../../lib/templates/investment-case-payload'
import {
  DEFAULT_BRANDING_CONFIG,
  DEFAULT_COVER_CONFIG,
  DEFAULT_HEADER_FOOTER_CONFIG,
  DEFAULT_PREVIEW_CONTEXT,
  DEFAULT_STYLE_CONFIG,
  DEFAULT_TOC_CONFIG,
  type BrandingConfig,
  type CoverPageConfig,
  type HeaderFooterConfig,
  type InvestmentCaseTemplate,
  type StyleConfig,
  type TocConfig,
} from '../../../types/investmentCaseTemplates'
import {
  DENSITY_PRESETS,
  MARGIN_PRESETS,
  STYLE_PRESETS,
  TYPOGRAPHY_SCALES,
  detectDensity,
  detectMarginPreset,
  detectTypographyScale,
  deriveColorsFromPrimary,
  type LayoutDensity,
  type TypographyScale,
} from '../../investment-case-templates/stylePresets'

/**
 * Investment Case PDF, authored on a phone.
 *
 * ── Why steps instead of the desktop's three panes ─────────────────────────
 *
 * The desktop puts a tab rail, an editor and a live preview side by side.
 * There is no room for three panes on a phone, but the thing being edited is
 * a form, not a canvas — four config objects with a preview of the result.
 * A form splits into steps cleanly, and the preview becomes the last step
 * rather than a permanent third of the screen.
 *
 * The steps mirror the desktop's tabs exactly, in the same order, so the two
 * are the same product: Cover, Style, Branding, Header/Footer, then Preview.
 * Cover also owns the table of contents, as it does on desktop.
 *
 * ── Parity, and the two columns that stay omitted ──────────────────────────
 *
 * The payload is built by `buildSavePayload`, not assembled here, so what a
 * phone writes is pinned by a test rather than by this file's good intentions.
 * It sends the desktop's eight keys and leaves out `section_config` and
 * `is_default`:
 *
 *   section_config — the desktop computes one from the user's research layout
 *     and shows it in the preview, but never persists it. There is no Sections
 *     tab anywhere; on create the hook writes `[]`, and on update the key is
 *     absent entirely.
 *   is_default — owned by the separate setDefaultTemplate mutation behind the
 *     Manager's "Set as Default", which also depends on a DB trigger to unset
 *     the previous one.
 *
 * A phone writing either would be the only client doing so. There is
 * therefore no Sections step here, and no "make this my default" toggle.
 *
 * ── Presets over properties ────────────────────────────────────────────────
 *
 * Style is expressed as presets — base preset, margins, typography scale,
 * density, a single primary colour that derives the palette. Those helpers
 * already exist for the desktop; reusing them means a phone cannot produce a
 * style the desktop has no control for. Per-property spinners for four font
 * roles and four margins would be a worse form on any screen and an unusable
 * one on this screen.
 */

const STEPS = [
  { key: 'cover', label: 'Cover' },
  { key: 'style', label: 'Style' },
  { key: 'branding', label: 'Branding' },
  { key: 'header-footer', label: 'Header/Footer' },
  { key: 'preview', label: 'Preview' },
] as const

type StepKey = (typeof STEPS)[number]['key']

interface Props {
  onBack: () => void
}

export function MobileInvestmentCaseEditor({ onBack }: Props) {
  const [editing, setEditing] = useState<{ id: string | null } | null>(null)

  if (!editing) return <TemplateList onBack={onBack} onOpen={(id) => setEditing({ id })} />

  return (
    <CaseDraftEditor
      key={editing.id ?? 'new'}
      templateId={editing.id}
      onBack={() => setEditing(null)}
    />
  )
}

// ============================================================================
// The picker
// ============================================================================

function TemplateList({
  onBack,
  onOpen,
}: {
  onBack: () => void
  onOpen: (id: string | null) => void
}) {
  const { myTemplates = [], sharedTemplates = [], isLoading } = useInvestmentCaseTemplates()

  return (
    <MobileTemplateShell
      typeLabel="Investment Case PDF"
      name="Investment Case PDF"
      meta={isLoading ? undefined : `${myTemplates.length} saved`}
      onBack={onBack}
    >
      {isLoading ? (
        <p className="py-8 text-center text-[13px] text-gray-500 dark:text-gray-400">Loading…</p>
      ) : (
        <div className="space-y-2">
          <button
            type="button"
            onClick={() => onOpen(null)}
            className="no-touch-target flex w-full items-center gap-2 rounded-lg border border-dashed border-gray-300 px-3 py-2.5 text-left text-[13px] font-medium text-primary-600 dark:border-gray-600 dark:text-primary-400"
          >
            <Plus className="h-4 w-4 shrink-0" />
            New template
          </button>

          {myTemplates.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => onOpen(t.id)}
              className="no-touch-target flex w-full items-center gap-2.5 rounded-lg border border-gray-200 px-3 py-2.5 text-left dark:border-gray-700"
            >
              <FileText className="h-4 w-4 shrink-0 text-gray-400" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-medium text-gray-900 dark:text-white">
                  {t.name}
                </span>
                <span className="mt-0.5 block truncate text-[11px] text-gray-500 dark:text-gray-400">
                  {t.is_default && 'Default · '}
                  {t.is_shared ? 'Shared' : 'Private'}
                </span>
              </span>
            </button>
          ))}

          {sharedTemplates.length > 0 && (
            <>
              <h2 className="pt-2 text-[11px] font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                Shared with you
              </h2>
              {sharedTemplates.map((t) => (
                // Read-only: every write in the hook is scoped
                // `.eq('user_id', user.id)`, so someone else's template cannot
                // be saved from here however it is opened.
                <div
                  key={t.id}
                  className="flex items-center gap-2.5 rounded-lg border border-gray-200 px-3 py-2.5 dark:border-gray-700"
                >
                  <FileText className="h-4 w-4 shrink-0 text-gray-400" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] text-gray-900 dark:text-white">
                      {t.name}
                    </span>
                    <span className="mt-0.5 block text-[11px] text-gray-500 dark:text-gray-400">
                      View only
                    </span>
                  </span>
                </div>
              ))}
            </>
          )}

          {myTemplates.length === 0 && (
            <p className="py-8 text-center text-[13px] text-gray-500 dark:text-gray-400">
              No templates yet.
            </p>
          )}
        </div>
      )}
    </MobileTemplateShell>
  )
}

// ============================================================================
// The stepped editor
// ============================================================================

function CaseDraftEditor({ templateId, onBack }: { templateId: string | null; onBack: () => void }) {
  const { myTemplates = [], createTemplate, updateTemplate } = useInvestmentCaseTemplates()
  const template = templateId ? myTemplates.find((t) => t.id === templateId) : undefined

  const [step, setStep] = useState<StepKey>('cover')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const [name, setName] = useState(template?.name ?? '')
  const [description, setDescription] = useState(template?.description ?? '')
  const [isShared, setIsShared] = useState(template?.is_shared ?? false)
  const [coverConfig, setCoverConfig] = useState<CoverPageConfig>({
    ...DEFAULT_COVER_CONFIG,
    ...template?.cover_config,
  })
  const [styleConfig, setStyleConfig] = useState<StyleConfig>(
    template?.style_config ?? DEFAULT_STYLE_CONFIG,
  )
  const [brandingConfig, setBrandingConfig] = useState<BrandingConfig>(
    template?.branding_config ?? DEFAULT_BRANDING_CONFIG,
  )
  const [headerFooterConfig, setHeaderFooterConfig] = useState<HeaderFooterConfig>(
    template?.header_footer_config ?? DEFAULT_HEADER_FOOTER_CONFIG,
  )
  const [tocConfig, setTocConfig] = useState<TocConfig>(
    template?.toc_config ?? DEFAULT_TOC_CONFIG,
  )

  const draft: InvestmentCaseDraft = {
    name,
    description,
    isShared,
    coverConfig,
    styleConfig,
    brandingConfig,
    headerFooterConfig,
    tocConfig,
  }

  const handleSave = async () => {
    setError(null)
    const invalid = validateDraft(draft)
    if (invalid) {
      setError(invalid)
      return
    }

    // Built centrally so the omitted columns stay omitted by construction.
    const payload = buildSavePayload(draft)
    setSaving(true)
    try {
      if (templateId) {
        await updateTemplate(templateId, payload)
      } else {
        await createTemplate(payload)
      }
      onBack()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save this template')
    } finally {
      setSaving(false)
    }
  }

  const stepIndex = STEPS.findIndex((s) => s.key === step)

  return (
    <MobileTemplateShell
      typeLabel="Investment Case PDF"
      name={name}
      onNameChange={setName}
      namePlaceholder="Untitled template"
      meta={STEPS[stepIndex].label}
      onBack={onBack}
      onSave={handleSave}
      saveLabel={templateId ? 'Save' : 'Create'}
      saving={saving}
      onPreview={step === 'preview' ? undefined : () => setStep('preview')}
    >
      {error && (
        <div
          role="alert"
          className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-[12px] text-red-700 dark:bg-red-900/20 dark:text-red-300"
        >
          {error}
        </div>
      )}

      {/* The steps are a strip of chips rather than a wizard that only moves
          forward: changing a colour and checking the cover again is the normal
          way to build one of these, and a one-way flow makes that five taps. */}
      <nav className="-mx-3 mb-3 flex gap-1 overflow-x-auto px-3 pb-1" aria-label="Editor steps">
        {STEPS.map((s, i) => (
          <button
            key={s.key}
            type="button"
            onClick={() => setStep(s.key)}
            aria-current={s.key === step ? 'step' : undefined}
            className={clsx(
              'no-touch-target shrink-0 rounded-full px-2.5 py-1 text-[12px] font-medium',
              s.key === step
                ? 'bg-primary-600 text-white'
                : 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300',
            )}
          >
            <span className="mr-1 opacity-60">{i + 1}</span>
            {s.label}
          </button>
        ))}
      </nav>

      {step === 'cover' && (
        <CoverStep
          config={coverConfig}
          onChange={setCoverConfig}
          toc={tocConfig}
          onTocChange={setTocConfig}
          isShared={isShared}
          onSharedChange={setIsShared}
          description={description}
          onDescriptionChange={setDescription}
        />
      )}
      {step === 'style' && <StyleStep config={styleConfig} onChange={setStyleConfig} />}
      {step === 'branding' && <BrandingStep config={brandingConfig} onChange={setBrandingConfig} />}
      {step === 'header-footer' && (
        <HeaderFooterStep config={headerFooterConfig} onChange={setHeaderFooterConfig} />
      )}
      {step === 'preview' && <PreviewStep draft={draft} template={template} />}

      {stepIndex < STEPS.length - 1 && (
        <button
          type="button"
          onClick={() => setStep(STEPS[stepIndex + 1].key)}
          className="no-touch-target mt-4 h-9 w-full rounded-lg border border-gray-300 text-[13px] font-medium text-gray-700 dark:border-gray-600 dark:text-gray-200"
        >
          Next: {STEPS[stepIndex + 1].label}
        </button>
      )}
    </MobileTemplateShell>
  )
}

// ============================================================================
// Shared controls
// ============================================================================

function Toggle({
  label,
  checked,
  onChange,
  hint,
}: {
  label: string
  checked: boolean
  onChange: (v: boolean) => void
  hint?: string
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className="no-touch-target flex w-full items-center justify-between gap-3 py-2 text-left"
    >
      <span className="min-w-0">
        <span className="block text-[13px] text-gray-900 dark:text-white">{label}</span>
        {hint && (
          <span className="mt-0.5 block text-[11px] text-gray-500 dark:text-gray-400">{hint}</span>
        )}
      </span>
      <span
        aria-hidden="true"
        className={clsx(
          'relative h-5 w-9 shrink-0 rounded-full transition-colors',
          checked ? 'bg-primary-600' : 'bg-gray-300 dark:bg-gray-600',
        )}
      >
        <span
          className={clsx(
            'absolute top-0.5 h-4 w-4 rounded-full bg-white transition-transform',
            checked ? 'translate-x-4.5 left-0.5' : 'left-0.5',
          )}
          style={checked ? { transform: 'translateX(1rem)' } : undefined}
        />
      </span>
    </button>
  )
}

function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string
  value: T | null
  options: { value: T; label: string }[]
  onChange: (v: T) => void
}) {
  return (
    <div className="py-2">
      <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">
        {label}
      </p>
      <div role="group" aria-label={label} className="flex flex-wrap gap-1">
        {options.map((o) => (
          <button
            key={o.value}
            type="button"
            onClick={() => onChange(o.value)}
            aria-pressed={value === o.value}
            className={clsx(
              'no-touch-target rounded-md px-2.5 py-1.5 text-[12px] font-medium',
              value === o.value
                ? 'bg-primary-50 text-primary-700 ring-1 ring-primary-500 dark:bg-primary-900/30 dark:text-primary-300'
                : 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300',
            )}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  )
}

function TextField({
  label,
  value,
  onChange,
  placeholder,
  multiline,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  placeholder?: string
  multiline?: boolean
}) {
  const shared =
    'mt-1 w-full rounded-lg border border-gray-300 bg-transparent px-2.5 py-1.5 text-[13px] text-gray-900 placeholder-gray-400 dark:border-gray-600 dark:text-white'
  return (
    <label className="block py-2">
      <span className="text-[11px] font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">
        {label}
      </span>
      {multiline ? (
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          rows={3}
          className={shared}
        />
      ) : (
        <input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className={shared}
        />
      )}
    </label>
  )
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="border-t border-gray-200 pt-2 first:border-t-0 first:pt-0 dark:border-gray-700">
      <h3 className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-gray-400">
        {title}
      </h3>
      {children}
    </section>
  )
}

// ============================================================================
// Steps
// ============================================================================

function CoverStep({
  config,
  onChange,
  toc,
  onTocChange,
  isShared,
  onSharedChange,
  description,
  onDescriptionChange,
}: {
  config: CoverPageConfig
  onChange: (c: CoverPageConfig) => void
  toc: TocConfig
  onTocChange: (c: TocConfig) => void
  isShared: boolean
  onSharedChange: (v: boolean) => void
  description: string
  onDescriptionChange: (v: string) => void
}) {
  const set = <K extends keyof CoverPageConfig>(key: K, value: CoverPageConfig[K]) =>
    onChange({ ...config, [key]: value })

  return (
    <div className="space-y-3">
      <Group title="Template">
        <TextField
          label="Description"
          value={description}
          onChange={onDescriptionChange}
          placeholder="What this template is for"
        />
        <Toggle
          label="Share with my organization"
          checked={isShared}
          onChange={onSharedChange}
          hint="Shared templates are visible to everyone in your org"
        />
      </Group>

      <Group title="Cover page">
        <TextField
          label="Custom title"
          value={config.customTitle ?? ''}
          // Empty means "use the default title", which is null in the config —
          // storing '' would render an empty heading instead.
          onChange={(v) => set('customTitle', v || null)}
          placeholder="Defaults to the company name"
        />
        <Segmented
          label="Title position"
          value={config.titlePosition}
          options={[
            { value: 'left', label: 'Left' },
            { value: 'center', label: 'Center' },
            { value: 'right', label: 'Right' },
          ]}
          onChange={(v) => set('titlePosition', v)}
        />
        <Toggle label="Company name" checked={config.showCompanyName} onChange={(v) => set('showCompanyName', v)} />
        <Toggle label="Current price" checked={config.showCurrentPrice} onChange={(v) => set('showCurrentPrice', v)} />
        <Toggle label="Author" checked={config.includeAuthor} onChange={(v) => set('includeAuthor', v)} />
        <Toggle label="Date" checked={config.includeDate} onChange={(v) => set('includeDate', v)} />
        <Toggle label="Timestamp" checked={config.includeTimestamp} onChange={(v) => set('includeTimestamp', v)} />
      </Group>

      <Group title="Logo">
        <Toggle label="Show logo" checked={config.showLogo} onChange={(v) => set('showLogo', v)} />
        {config.showLogo && (
          <Segmented
            label="Logo position"
            value={config.logoPosition}
            options={[
              { value: 'top-left', label: 'Top L' },
              { value: 'top-center', label: 'Top C' },
              { value: 'top-right', label: 'Top R' },
              { value: 'bottom-left', label: 'Bot L' },
              { value: 'bottom-center', label: 'Bot C' },
              { value: 'bottom-right', label: 'Bot R' },
            ]}
            onChange={(v) => set('logoPosition', v)}
          />
        )}
        <Toggle
          label="Use organization branding"
          checked={config.useOrgBranding}
          onChange={(v) => set('useOrgBranding', v)}
        />
      </Group>

      <Group title="Disclaimer">
        <Toggle
          label="Include disclaimer"
          checked={config.includeDisclaimer}
          onChange={(v) => set('includeDisclaimer', v)}
        />
        {config.includeDisclaimer && (
          <>
            <Toggle
              label="Use organization disclaimer"
              checked={config.useOrgDisclaimer}
              onChange={(v) => set('useOrgDisclaimer', v)}
            />
            {!config.useOrgDisclaimer && (
              <TextField
                label="Disclaimer text"
                value={config.disclaimerText}
                onChange={(v) => set('disclaimerText', v)}
                multiline
              />
            )}
          </>
        )}
      </Group>

      {/* Lives here because it lives on the desktop's Cover tab too. */}
      <Group title="Table of contents">
        <Toggle
          label="Include contents page"
          checked={toc.enabled}
          onChange={(v) => onTocChange({ ...toc, enabled: v })}
        />
        {toc.enabled && (
          <>
            <TextField
              label="Title"
              value={toc.title}
              onChange={(v) => onTocChange({ ...toc, title: v })}
            />
            <Toggle
              label="Show page numbers"
              checked={toc.showPageNumbers}
              onChange={(v) => onTocChange({ ...toc, showPageNumbers: v })}
            />
          </>
        )}
      </Group>
    </div>
  )
}

function StyleStep({
  config,
  onChange,
}: {
  config: StyleConfig
  onChange: (c: StyleConfig) => void
}) {
  // Detectors rather than stored keys: a config edited on desktop may not
  // correspond to any preset, and showing nothing selected is truthful where
  // guessing a nearest preset would silently change values on the next tap.
  const margin = detectMarginPreset(config.margins)
  const typography = detectTypographyScale(config.fonts)
  const density = detectDensity(config.spacing)

  const applyTypography = (scale: TypographyScale) => {
    const sizes = TYPOGRAPHY_SCALES[scale]
    onChange({
      ...config,
      fonts: {
        title: { ...config.fonts.title, size: sizes.title },
        heading: { ...config.fonts.heading, size: sizes.heading },
        subheading: { ...config.fonts.subheading, size: sizes.subheading },
        body: { ...config.fonts.body, size: sizes.body },
      },
    })
  }

  return (
    <div className="space-y-3">
      <Group title="Preset">
        <div className="space-y-1.5 py-1">
          {STYLE_PRESETS.map((preset) => (
            <button
              key={preset.key}
              type="button"
              onClick={() => onChange(preset.config)}
              className="no-touch-target block w-full rounded-lg border border-gray-200 px-3 py-2 text-left dark:border-gray-700"
            >
              <span className="block text-[13px] font-medium text-gray-900 dark:text-white">
                {preset.label}
              </span>
              <span className="mt-0.5 block text-[11px] text-gray-500 dark:text-gray-400">
                {preset.description}
              </span>
            </button>
          ))}
        </div>
      </Group>

      <Group title="Page">
        <Segmented
          label="Format"
          value={config.pageFormat}
          options={[
            { value: 'a4', label: 'A4' },
            { value: 'letter', label: 'Letter' },
            { value: 'legal', label: 'Legal' },
          ]}
          onChange={(v) => onChange({ ...config, pageFormat: v })}
        />
        <Segmented
          label="Orientation"
          value={config.orientation}
          options={[
            { value: 'portrait', label: 'Portrait' },
            { value: 'landscape', label: 'Landscape' },
          ]}
          onChange={(v) => onChange({ ...config, orientation: v })}
        />
        <Segmented
          label="Margins"
          value={margin}
          options={MARGIN_PRESETS.map((m) => ({ value: m.key, label: m.label }))}
          onChange={(v) => {
            const preset = MARGIN_PRESETS.find((m) => m.key === v)
            if (preset) onChange({ ...config, margins: preset.values })
          }}
        />
      </Group>

      <Group title="Type & spacing">
        <Segmented
          label="Text size"
          value={typography}
          options={[
            { value: 'compact', label: 'Compact' },
            { value: 'comfortable', label: 'Comfortable' },
            { value: 'large', label: 'Large' },
          ]}
          onChange={applyTypography}
        />
        <Segmented
          label="Density"
          value={density}
          options={[
            { value: 'compact', label: 'Compact' },
            { value: 'balanced', label: 'Balanced' },
            { value: 'spacious', label: 'Spacious' },
          ]}
          onChange={(v: LayoutDensity) => onChange({ ...config, spacing: DENSITY_PRESETS[v] })}
        />
      </Group>

      <Group title="Colour">
        <label className="flex items-center justify-between gap-3 py-2">
          <span className="text-[13px] text-gray-900 dark:text-white">Primary</span>
          <input
            type="color"
            aria-label="Primary colour"
            value={config.colors.primary}
            // Derives the rest of the palette, as the desktop does. Six
            // separate colour wells on a phone is how you get an unreadable
            // document nobody meant to build.
            onChange={(e) =>
              onChange({ ...config, colors: deriveColorsFromPrimary(e.target.value) })
            }
            className="no-touch-target h-8 w-14 rounded border border-gray-300 bg-transparent dark:border-gray-600"
          />
        </label>
      </Group>
    </div>
  )
}

function BrandingStep({
  config,
  onChange,
}: {
  config: BrandingConfig
  onChange: (c: BrandingConfig) => void
}) {
  const set = <K extends keyof BrandingConfig>(key: K, value: BrandingConfig[K]) =>
    onChange({ ...config, [key]: value })

  return (
    <div className="space-y-3">
      <Group title="Firm">
        <TextField
          label="Firm name"
          value={config.firmName ?? ''}
          onChange={(v) => set('firmName', v || null)}
          placeholder="Shown on the cover and footer"
        />
        <TextField
          label="Tagline"
          value={config.tagline ?? ''}
          onChange={(v) => set('tagline', v || null)}
        />
      </Group>

      <Group title="Logo">
        {/* Deliberately not an uploader. The logo is stored in a bucket and
            written through a separate mutation with its own failure and
            fallback path; adding a file picker here would be new behaviour,
            not parity. The existing logo is kept untouched by a mobile save. */}
        <p className="py-2 text-[12px] leading-relaxed text-gray-500 dark:text-gray-400">
          {config.logoPath
            ? 'A logo is set. Replacing it is done on desktop; saving here leaves it unchanged.'
            : 'No logo set. Uploading one is done on desktop.'}
        </p>
      </Group>

      <Group title="Watermark">
        <Toggle
          label="Enable watermark"
          checked={config.watermarkEnabled}
          onChange={(v) => set('watermarkEnabled', v)}
        />
        {config.watermarkEnabled && (
          <>
            <TextField
              label="Text"
              value={config.watermarkText ?? ''}
              onChange={(v) => set('watermarkText', v || null)}
              placeholder="DRAFT"
            />
            <Segmented
              label="Position"
              value={config.watermarkPosition}
              options={[
                { value: 'diagonal', label: 'Diagonal' },
                { value: 'center', label: 'Center' },
                { value: 'footer', label: 'Footer' },
              ]}
              onChange={(v) => set('watermarkPosition', v)}
            />
          </>
        )}
      </Group>
    </div>
  )
}

function HeaderFooterStep({
  config,
  onChange,
}: {
  config: HeaderFooterConfig
  onChange: (c: HeaderFooterConfig) => void
}) {
  const setHeader = <K extends keyof HeaderFooterConfig['header']>(
    key: K,
    value: HeaderFooterConfig['header'][K],
  ) => onChange({ ...config, header: { ...config.header, [key]: value } })

  const setFooter = <K extends keyof HeaderFooterConfig['footer']>(
    key: K,
    value: HeaderFooterConfig['footer'][K],
  ) => onChange({ ...config, footer: { ...config.footer, [key]: value } })

  const alignments = [
    { value: 'left' as const, label: 'Left' },
    { value: 'center' as const, label: 'Center' },
    { value: 'right' as const, label: 'Right' },
    { value: 'split' as const, label: 'Split' },
  ]

  return (
    <div className="space-y-3">
      <Group title="Header">
        <Toggle
          label="Enable header"
          checked={config.header.enabled}
          onChange={(v) => setHeader('enabled', v)}
        />
        {config.header.enabled && (
          <>
            <TextField
              label="Content"
              value={config.header.content ?? ''}
              onChange={(v) => setHeader('content', v || null)}
            />
            <Segmented
              label="Alignment"
              value={config.header.alignment}
              options={alignments}
              onChange={(v) => setHeader('alignment', v)}
            />
            {config.header.alignment === 'split' && (
              <>
                <TextField
                  label="Left content"
                  value={config.header.leftContent ?? ''}
                  onChange={(v) => setHeader('leftContent', v || null)}
                />
                <TextField
                  label="Right content"
                  value={config.header.rightContent ?? ''}
                  onChange={(v) => setHeader('rightContent', v || null)}
                />
              </>
            )}
            <Toggle
              label="Page number in header"
              checked={config.header.showPageNumber}
              onChange={(v) => setHeader('showPageNumber', v)}
            />
            <Segmented
              label="On the cover page"
              value={config.header.coverBehavior}
              options={[
                { value: 'hide', label: 'Hide' },
                { value: 'same', label: 'Same' },
                { value: 'custom', label: 'Custom' },
              ]}
              onChange={(v) => setHeader('coverBehavior', v)}
            />
          </>
        )}
      </Group>

      <Group title="Footer">
        <Toggle
          label="Enable footer"
          checked={config.footer.enabled}
          onChange={(v) => setFooter('enabled', v)}
        />
        {config.footer.enabled && (
          <>
            <TextField
              label="Content"
              value={config.footer.content ?? ''}
              onChange={(v) => setFooter('content', v || null)}
            />
            <Segmented
              label="Alignment"
              value={config.footer.alignment}
              options={alignments}
              onChange={(v) => setFooter('alignment', v)}
            />
            <Toggle
              label="Show page number"
              checked={config.footer.showPageNumber}
              onChange={(v) => setFooter('showPageNumber', v)}
            />
            {config.footer.showPageNumber && (
              <>
                <TextField
                  label="Page number format"
                  value={config.footer.pageNumberFormat}
                  onChange={(v) => setFooter('pageNumberFormat', v)}
                  placeholder="Page {page} of {total}"
                />
                <Segmented
                  label="Page number position"
                  value={config.footer.pageNumberPosition}
                  options={[
                    { value: 'left', label: 'Left' },
                    { value: 'center', label: 'Center' },
                    { value: 'right', label: 'Right' },
                    { value: 'inline', label: 'Inline' },
                  ]}
                  onChange={(v) => setFooter('pageNumberPosition', v)}
                />
              </>
            )}
          </>
        )}
      </Group>
    </div>
  )
}

function PreviewStep({
  draft,
  template,
}: {
  draft: InvestmentCaseDraft
  template?: InvestmentCaseTemplate
}) {
  /**
   * The same synthetic template the desktop builds to drive its live preview.
   *
   * `section_config` comes from the saved row and is otherwise `[]` — the
   * preview needs the key to exist because it filters over it, but this is
   * display only. Nothing here reaches a save; the payload is built from the
   * draft, not from this object.
   */
  const previewTemplate = useMemo<InvestmentCaseTemplate>(
    () => ({
      id: template?.id ?? 'preview',
      name: draft.name,
      description: draft.description || null,
      user_id: template?.user_id ?? '',
      organization_id: template?.organization_id ?? null,
      is_shared: draft.isShared,
      is_default: template?.is_default ?? false,
      usage_count: template?.usage_count ?? 0,
      last_used_at: template?.last_used_at ?? null,
      cover_config: draft.coverConfig,
      style_config: draft.styleConfig,
      branding_config: draft.brandingConfig,
      header_footer_config: draft.headerFooterConfig,
      section_config: template?.section_config ?? [],
      toc_config: draft.tocConfig,
      created_at: template?.created_at ?? new Date().toISOString(),
      updated_at: template?.updated_at ?? new Date().toISOString(),
    }),
    [draft, template],
  )

  return (
    <div>
      <p className="mb-2 text-[11px] text-gray-500 dark:text-gray-400">
        Sample data. Scaled to fit this screen.
      </p>
      {/* The preview is built for a page-width canvas. Rather than reflow it
          into something that is no longer a preview, it is scaled down and
          allowed to scroll sideways inside its own box — the page never
          scrolls horizontally. */}
      <div className="overflow-x-auto rounded-lg border border-gray-200 bg-gray-100 p-2 dark:border-gray-700 dark:bg-gray-800">
        <div className="origin-top-left scale-[0.42] [width:238%]">
          <InvestmentCaseTemplatePreview
            template={previewTemplate}
            previewContext={{
              ...DEFAULT_PREVIEW_CONTEXT,
              firmName: draft.brandingConfig.firmName || '',
            }}
          />
        </div>
      </div>
    </div>
  )
}
