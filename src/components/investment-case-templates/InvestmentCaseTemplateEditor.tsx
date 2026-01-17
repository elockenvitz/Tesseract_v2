import { useState, useEffect } from 'react'
import { clsx } from 'clsx'
import {
  X,
  Save,
  Loader2,
  FileText,
  Palette,
  Building,
  Layout,
  List,
  BookOpen,
  Share2,
  ChevronDown,
  ChevronRight,
  GripVertical,
  CheckSquare,
  Square,
  Upload,
  Trash2,
  Image
} from 'lucide-react'
import { Button } from '../ui/Button'
import { useInvestmentCaseTemplates } from '../../hooks/useInvestmentCaseTemplates'
import { useUserResearchLayout } from '../../hooks/useResearchFields'
import {
  InvestmentCaseTemplate,
  CoverPageConfig,
  StyleConfig,
  BrandingConfig,
  HeaderFooterConfig,
  SectionTemplateConfig,
  TocConfig,
  COLOR_PRESETS,
  FONT_FAMILIES,
  PAGE_FORMATS,
  DEFAULT_COVER_CONFIG,
  DEFAULT_STYLE_CONFIG,
  DEFAULT_BRANDING_CONFIG,
  DEFAULT_HEADER_FOOTER_CONFIG,
  DEFAULT_TOC_CONFIG
} from '../../types/investmentCaseTemplates'
import { InvestmentCaseTemplatePreview } from './InvestmentCaseTemplatePreview'

type EditorTab = 'cover' | 'style' | 'branding' | 'sections' | 'header-footer'

interface Props {
  template: InvestmentCaseTemplate | null
  isCreateMode?: boolean
  onClose: () => void
}

export function InvestmentCaseTemplateEditor({ template, isCreateMode = false, onClose }: Props) {
  const { createTemplate, updateTemplate, uploadLogo, deleteLogo, isCreating, isUpdating, isUploadingLogo } = useInvestmentCaseTemplates()
  const { sections: layoutSections } = useUserResearchLayout()

  const [activeTab, setActiveTab] = useState<EditorTab>('cover')
  const [name, setName] = useState(template?.name || 'New Template')
  const [description, setDescription] = useState(template?.description || '')
  const [isShared, setIsShared] = useState(template?.is_shared || false)
  const [coverConfig, setCoverConfig] = useState<CoverPageConfig>(template?.cover_config || DEFAULT_COVER_CONFIG)
  const [styleConfig, setStyleConfig] = useState<StyleConfig>(template?.style_config || DEFAULT_STYLE_CONFIG)
  const [brandingConfig, setBrandingConfig] = useState<BrandingConfig>(template?.branding_config || DEFAULT_BRANDING_CONFIG)
  const [headerFooterConfig, setHeaderFooterConfig] = useState<HeaderFooterConfig>(template?.header_footer_config || DEFAULT_HEADER_FOOTER_CONFIG)
  const [sectionConfig, setSectionConfig] = useState<SectionTemplateConfig[]>(template?.section_config || [])
  const [tocConfig, setTocConfig] = useState<TocConfig>(template?.toc_config || DEFAULT_TOC_CONFIG)
  const [hasChanges, setHasChanges] = useState(isCreateMode) // In create mode, always allow save
  const [showPreview, setShowPreview] = useState(true)

  // Initialize section config from user's layout if empty
  useEffect(() => {
    if (sectionConfig.length === 0 && layoutSections.length > 0) {
      setSectionConfig(
        layoutSections.map((ls, index) => ({
          id: ls.section.id,
          name: ls.section.name,
          enabled: true,
          order: index,
          fields: ls.fields.map(af => ({
            id: af.field.id,
            slug: af.field.slug,
            name: af.field.name,
            enabled: true
          }))
        }))
      )
    }
  }, [layoutSections, sectionConfig.length])

  // Track changes
  useEffect(() => {
    // In create mode, always allow save if name is provided
    if (isCreateMode) {
      setHasChanges(name.trim().length > 0)
      return
    }

    // In edit mode, track actual changes
    if (!template) return

    const changed =
      name !== template.name ||
      description !== (template.description || '') ||
      isShared !== template.is_shared ||
      JSON.stringify(coverConfig) !== JSON.stringify(template.cover_config) ||
      JSON.stringify(styleConfig) !== JSON.stringify(template.style_config) ||
      JSON.stringify(brandingConfig) !== JSON.stringify(template.branding_config) ||
      JSON.stringify(headerFooterConfig) !== JSON.stringify(template.header_footer_config) ||
      JSON.stringify(sectionConfig) !== JSON.stringify(template.section_config) ||
      JSON.stringify(tocConfig) !== JSON.stringify(template.toc_config)
    setHasChanges(changed)
  }, [name, description, isShared, coverConfig, styleConfig, brandingConfig, headerFooterConfig, sectionConfig, tocConfig, template, isCreateMode])

  const handleSave = async () => {
    try {
      if (isCreateMode) {
        // Create new template
        await createTemplate({
          name,
          description: description || null,
          is_shared: isShared,
          cover_config: coverConfig,
          style_config: styleConfig,
          branding_config: brandingConfig,
          header_footer_config: headerFooterConfig,
          section_config: sectionConfig,
          toc_config: tocConfig
        })
      } else if (template) {
        // Update existing template
        await updateTemplate(template.id, {
          name,
          description: description || null,
          is_shared: isShared,
          cover_config: coverConfig,
          style_config: styleConfig,
          branding_config: brandingConfig,
          header_footer_config: headerFooterConfig,
          section_config: sectionConfig,
          toc_config: tocConfig
        })
      }
      onClose()
    } catch (err) {
      console.error('Failed to save template:', err)
    }
  }

  const handleLogoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file || !template) return // Can't upload logo in create mode

    try {
      const result = await uploadLogo({ templateId: template.id, file })
      setBrandingConfig(prev => ({
        ...prev,
        logoPath: result.storagePath
      }))
    } catch (err) {
      console.error('Failed to upload logo:', err)
    }
  }

  const handleDeleteLogo = async () => {
    if (!template) return // Can't delete logo in create mode

    try {
      await deleteLogo(template.id)
      setBrandingConfig(prev => ({
        ...prev,
        logoPath: null
      }))
    } catch (err) {
      console.error('Failed to delete logo:', err)
    }
  }

  const tabs = [
    { id: 'cover' as EditorTab, label: 'Cover Page', icon: FileText },
    { id: 'style' as EditorTab, label: 'Style', icon: Palette },
    { id: 'branding' as EditorTab, label: 'Branding', icon: Building },
    { id: 'sections' as EditorTab, label: 'Sections', icon: List },
    { id: 'header-footer' as EditorTab, label: 'Header/Footer', icon: Layout }
  ]

  // Build preview template
  const previewTemplate: InvestmentCaseTemplate = {
    id: template?.id || 'preview',
    name,
    description,
    user_id: template?.user_id || '',
    organization_id: template?.organization_id || null,
    is_shared: isShared,
    is_default: template?.is_default || false,
    usage_count: template?.usage_count || 0,
    last_used_at: template?.last_used_at || null,
    cover_config: coverConfig,
    style_config: styleConfig,
    branding_config: brandingConfig,
    header_footer_config: headerFooterConfig,
    section_config: sectionConfig,
    toc_config: tocConfig,
    created_at: template?.created_at || new Date().toISOString(),
    updated_at: template?.updated_at || new Date().toISOString()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-white rounded-xl shadow-2xl w-[95vw] h-[90vh] max-w-7xl flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
          <div className="flex-1">
            <input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              className="text-lg font-semibold text-gray-900 border-0 border-b-2 border-transparent focus:border-primary-500 focus:ring-0 w-full max-w-md"
              placeholder="Template name"
            />
            <input
              type="text"
              value={description}
              onChange={e => setDescription(e.target.value)}
              className="text-sm text-gray-500 border-0 focus:ring-0 w-full max-w-lg mt-1"
              placeholder="Add a description..."
            />
          </div>
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-2 text-sm text-gray-600">
              <input
                type="checkbox"
                checked={isShared}
                onChange={e => setIsShared(e.target.checked)}
                className="rounded border-gray-300 text-primary-600 focus:ring-primary-500"
              />
              <Share2 className="w-4 h-4" />
              Share with team
            </label>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowPreview(!showPreview)}
            >
              {showPreview ? 'Hide Preview' : 'Show Preview'}
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={handleSave}
              disabled={(isCreateMode ? isCreating : isUpdating) || !hasChanges}
            >
              {(isCreateMode ? isCreating : isUpdating) ? (
                <Loader2 className="w-4 h-4 animate-spin mr-1" />
              ) : (
                <Save className="w-4 h-4 mr-1" />
              )}
              {isCreateMode ? 'Create' : 'Save'}
            </Button>
            <button
              onClick={onClose}
              className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 flex overflow-hidden">
          {/* Sidebar Tabs */}
          <div className="w-48 border-r border-gray-200 bg-gray-50 p-2 space-y-1">
            {tabs.map(tab => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={clsx(
                  'w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors',
                  activeTab === tab.id
                    ? 'bg-primary-100 text-primary-700'
                    : 'text-gray-600 hover:bg-gray-100'
                )}
              >
                <tab.icon className="w-4 h-4" />
                {tab.label}
              </button>
            ))}
          </div>

          {/* Editor Panel */}
          <div className={clsx(
            'flex-1 overflow-auto p-6',
            showPreview ? 'w-1/2' : 'w-full'
          )}>
            {activeTab === 'cover' && (
              <CoverPageEditor
                config={coverConfig}
                onChange={setCoverConfig}
                tocConfig={tocConfig}
                onTocChange={setTocConfig}
              />
            )}
            {activeTab === 'style' && (
              <StyleEditor config={styleConfig} onChange={setStyleConfig} />
            )}
            {activeTab === 'branding' && (
              <BrandingEditor
                config={brandingConfig}
                onChange={setBrandingConfig}
                onLogoUpload={handleLogoUpload}
                onLogoDelete={handleDeleteLogo}
                isUploading={isUploadingLogo}
                isCreateMode={isCreateMode}
              />
            )}
            {activeTab === 'sections' && (
              <SectionConfigEditor
                config={sectionConfig}
                onChange={setSectionConfig}
                layoutSections={layoutSections}
              />
            )}
            {activeTab === 'header-footer' && (
              <HeaderFooterEditor config={headerFooterConfig} onChange={setHeaderFooterConfig} />
            )}
          </div>

          {/* Preview Panel */}
          {showPreview && (
            <div className="w-1/2 border-l border-gray-200 bg-gray-100 p-4 overflow-auto">
              <InvestmentCaseTemplatePreview template={previewTemplate} />
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ============================================================================
// Cover Page Editor
// ============================================================================

interface CoverPageEditorProps {
  config: CoverPageConfig
  onChange: (config: CoverPageConfig) => void
  tocConfig: TocConfig
  onTocChange: (config: TocConfig) => void
}

function CoverPageEditor({ config, onChange, tocConfig, onTocChange }: CoverPageEditorProps) {
  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-medium text-gray-900 mb-4">Cover Page Settings</h3>

        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Custom Title
            </label>
            <input
              type="text"
              value={config.customTitle || ''}
              onChange={e => onChange({ ...config, customTitle: e.target.value || null })}
              placeholder="e.g., Investment Case: {{symbol}}"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500"
            />
            <p className="text-xs text-gray-500 mt-1">Leave empty to use default title format</p>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Title Position
              </label>
              <select
                value={config.titlePosition}
                onChange={e => onChange({ ...config, titlePosition: e.target.value as any })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500"
              >
                <option value="left">Left</option>
                <option value="center">Center</option>
                <option value="right">Right</option>
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Logo Position
              </label>
              <select
                value={config.logoPosition}
                onChange={e => onChange({ ...config, logoPosition: e.target.value as any })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500"
              >
                <option value="top-left">Top Left</option>
                <option value="top-center">Top Center</option>
                <option value="top-right">Top Right</option>
                <option value="bottom-left">Bottom Left</option>
                <option value="bottom-center">Bottom Center</option>
                <option value="bottom-right">Bottom Right</option>
              </select>
            </div>
          </div>

          <div className="space-y-2">
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={config.showLogo}
                onChange={e => onChange({ ...config, showLogo: e.target.checked })}
                className="rounded border-gray-300 text-primary-600 focus:ring-primary-500"
              />
              <span className="text-sm text-gray-700">Show logo on cover</span>
            </label>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={config.showCompanyName}
                onChange={e => onChange({ ...config, showCompanyName: e.target.checked })}
                className="rounded border-gray-300 text-primary-600 focus:ring-primary-500"
              />
              <span className="text-sm text-gray-700">Show company name</span>
            </label>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={config.showCurrentPrice}
                onChange={e => onChange({ ...config, showCurrentPrice: e.target.checked })}
                className="rounded border-gray-300 text-primary-600 focus:ring-primary-500"
              />
              <span className="text-sm text-gray-700">Show current price</span>
            </label>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={config.includeDate}
                onChange={e => onChange({ ...config, includeDate: e.target.checked })}
                className="rounded border-gray-300 text-primary-600 focus:ring-primary-500"
              />
              <span className="text-sm text-gray-700">Include date</span>
            </label>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={config.includeAuthor}
                onChange={e => onChange({ ...config, includeAuthor: e.target.checked })}
                className="rounded border-gray-300 text-primary-600 focus:ring-primary-500"
              />
              <span className="text-sm text-gray-700">Include author attribution</span>
            </label>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={config.includeDisclaimer}
                onChange={e => onChange({ ...config, includeDisclaimer: e.target.checked })}
                className="rounded border-gray-300 text-primary-600 focus:ring-primary-500"
              />
              <span className="text-sm text-gray-700">Include disclaimer</span>
            </label>
          </div>

          {config.includeDisclaimer && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Disclaimer Text
              </label>
              <textarea
                value={config.disclaimerText}
                onChange={e => onChange({ ...config, disclaimerText: e.target.value })}
                rows={3}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500"
              />
            </div>
          )}
        </div>
      </div>

      <div className="border-t border-gray-200 pt-6">
        <h3 className="text-lg font-medium text-gray-900 mb-4">Table of Contents</h3>

        <div className="space-y-4">
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={tocConfig.enabled}
              onChange={e => onTocChange({ ...tocConfig, enabled: e.target.checked })}
              className="rounded border-gray-300 text-primary-600 focus:ring-primary-500"
            />
            <span className="text-sm text-gray-700">Include table of contents</span>
          </label>

          {tocConfig.enabled && (
            <>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  TOC Title
                </label>
                <input
                  type="text"
                  value={tocConfig.title}
                  onChange={e => onTocChange({ ...tocConfig, title: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500"
                />
              </div>

              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={tocConfig.showPageNumbers}
                  onChange={e => onTocChange({ ...tocConfig, showPageNumbers: e.target.checked })}
                  className="rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                />
                <span className="text-sm text-gray-700">Show page numbers</span>
              </label>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

// ============================================================================
// Style Editor
// ============================================================================

interface StyleEditorProps {
  config: StyleConfig
  onChange: (config: StyleConfig) => void
}

function StyleEditor({ config, onChange }: StyleEditorProps) {
  const updateColors = (colorKey: keyof StyleConfig['colors'], value: string) => {
    onChange({
      ...config,
      colors: { ...config.colors, [colorKey]: value }
    })
  }

  const updateMargins = (marginKey: keyof StyleConfig['margins'], value: number) => {
    onChange({
      ...config,
      margins: { ...config.margins, [marginKey]: value }
    })
  }

  const updateFont = (fontKey: keyof StyleConfig['fonts'], property: string, value: any) => {
    onChange({
      ...config,
      fonts: {
        ...config.fonts,
        [fontKey]: { ...config.fonts[fontKey], [property]: value }
      }
    })
  }

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-medium text-gray-900 mb-4">Page Setup</h3>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Page Format
            </label>
            <select
              value={config.pageFormat}
              onChange={e => onChange({ ...config, pageFormat: e.target.value as any })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500"
            >
              {PAGE_FORMATS.map(f => (
                <option key={f.value} value={f.value}>{f.label}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Orientation
            </label>
            <select
              value={config.orientation}
              onChange={e => onChange({ ...config, orientation: e.target.value as any })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500"
            >
              <option value="portrait">Portrait</option>
              <option value="landscape">Landscape</option>
            </select>
          </div>
        </div>
      </div>

      <div className="border-t border-gray-200 pt-6">
        <h3 className="text-lg font-medium text-gray-900 mb-4">Margins (mm)</h3>

        <div className="grid grid-cols-4 gap-4">
          {(['top', 'right', 'bottom', 'left'] as const).map(side => (
            <div key={side}>
              <label className="block text-sm font-medium text-gray-700 mb-1 capitalize">
                {side}
              </label>
              <input
                type="number"
                value={config.margins[side]}
                onChange={e => updateMargins(side, parseInt(e.target.value) || 0)}
                min={5}
                max={50}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500"
              />
            </div>
          ))}
        </div>
      </div>

      <div className="border-t border-gray-200 pt-6">
        <h3 className="text-lg font-medium text-gray-900 mb-4">Colors</h3>

        <div className="flex flex-wrap gap-2 mb-4">
          {COLOR_PRESETS.map(preset => (
            <button
              key={preset.name}
              onClick={() => onChange({
                ...config,
                colors: {
                  ...config.colors,
                  primary: preset.primary,
                  accent: preset.accent
                }
              })}
              className={clsx(
                'flex items-center gap-2 px-3 py-1.5 rounded-lg border text-sm',
                config.colors.primary === preset.primary
                  ? 'border-gray-400 bg-gray-50'
                  : 'border-gray-200 hover:border-gray-300'
              )}
            >
              <span
                className="w-4 h-4 rounded-full"
                style={{ backgroundColor: preset.primary }}
              />
              {preset.name}
            </button>
          ))}
        </div>

        <div className="grid grid-cols-3 gap-4">
          {([
            { key: 'primary', label: 'Primary' },
            { key: 'secondary', label: 'Secondary' },
            { key: 'accent', label: 'Accent' },
            { key: 'text', label: 'Text' },
            { key: 'headingText', label: 'Headings' },
            { key: 'mutedText', label: 'Muted Text' }
          ] as const).map(({ key, label }) => (
            <div key={key}>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                {label}
              </label>
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  value={config.colors[key]}
                  onChange={e => updateColors(key, e.target.value)}
                  className="w-8 h-8 rounded border border-gray-300 cursor-pointer"
                />
                <input
                  type="text"
                  value={config.colors[key]}
                  onChange={e => updateColors(key, e.target.value)}
                  className="flex-1 px-2 py-1 border border-gray-300 rounded text-sm font-mono"
                />
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="border-t border-gray-200 pt-6">
        <h3 className="text-lg font-medium text-gray-900 mb-4">Fonts</h3>

        <div className="space-y-4">
          {([
            { key: 'title', label: 'Title' },
            { key: 'heading', label: 'Section Headings' },
            { key: 'subheading', label: 'Field Names' },
            { key: 'body', label: 'Body Text' }
          ] as const).map(({ key, label }) => (
            <div key={key} className="grid grid-cols-3 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  {label}
                </label>
                <select
                  value={config.fonts[key].family}
                  onChange={e => updateFont(key, 'family', e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500"
                >
                  {FONT_FAMILIES.map(f => (
                    <option key={f.value} value={f.value}>{f.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Size (pt)
                </label>
                <input
                  type="number"
                  value={config.fonts[key].size}
                  onChange={e => updateFont(key, 'size', parseInt(e.target.value) || 10)}
                  min={6}
                  max={72}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Weight
                </label>
                <select
                  value={config.fonts[key].weight}
                  onChange={e => updateFont(key, 'weight', e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500"
                >
                  <option value="normal">Normal</option>
                  <option value="bold">Bold</option>
                </select>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="border-t border-gray-200 pt-6">
        <h3 className="text-lg font-medium text-gray-900 mb-4">Spacing (mm)</h3>

        <div className="grid grid-cols-3 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Section Gap
            </label>
            <input
              type="number"
              value={config.spacing.sectionGap}
              onChange={e => onChange({
                ...config,
                spacing: { ...config.spacing, sectionGap: parseInt(e.target.value) || 0 }
              })}
              min={0}
              max={30}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Field Gap
            </label>
            <input
              type="number"
              value={config.spacing.fieldGap}
              onChange={e => onChange({
                ...config,
                spacing: { ...config.spacing, fieldGap: parseInt(e.target.value) || 0 }
              })}
              min={0}
              max={20}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Paragraph Gap
            </label>
            <input
              type="number"
              value={config.spacing.paragraphGap}
              onChange={e => onChange({
                ...config,
                spacing: { ...config.spacing, paragraphGap: parseInt(e.target.value) || 0 }
              })}
              min={0}
              max={10}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500"
            />
          </div>
        </div>
      </div>
    </div>
  )
}

// ============================================================================
// Branding Editor
// ============================================================================

interface BrandingEditorProps {
  config: BrandingConfig
  onChange: (config: BrandingConfig) => void
  onLogoUpload: (e: React.ChangeEvent<HTMLInputElement>) => void
  onLogoDelete: () => void
  isUploading: boolean
  isCreateMode?: boolean
}

function BrandingEditor({ config, onChange, onLogoUpload, onLogoDelete, isUploading, isCreateMode }: BrandingEditorProps) {
  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-medium text-gray-900 mb-4">Firm Logo</h3>

        <div className="space-y-4">
          {isCreateMode ? (
            <div className="flex flex-col items-center justify-center p-8 border-2 border-dashed border-gray-300 rounded-lg bg-gray-50">
              <Upload className="w-8 h-8 text-gray-300 mb-2" />
              <span className="text-sm text-gray-500">Logo upload available after creating template</span>
              <span className="text-xs text-gray-400 mt-1">Create the template first, then upload your logo</span>
            </div>
          ) : config.logoPath ? (
            <div className="flex items-center gap-4 p-4 border border-gray-200 rounded-lg">
              <div className="w-20 h-20 bg-gray-100 rounded flex items-center justify-center">
                <Image className="w-8 h-8 text-gray-400" />
              </div>
              <div className="flex-1">
                <p className="text-sm text-gray-600">Logo uploaded</p>
                <p className="text-xs text-gray-400 truncate">{config.logoPath}</p>
              </div>
              <button
                onClick={onLogoDelete}
                className="p-2 text-red-500 hover:bg-red-50 rounded-lg"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          ) : (
            <label className="flex flex-col items-center justify-center p-8 border-2 border-dashed border-gray-300 rounded-lg hover:border-gray-400 cursor-pointer">
              {isUploading ? (
                <Loader2 className="w-8 h-8 text-gray-400 animate-spin" />
              ) : (
                <>
                  <Upload className="w-8 h-8 text-gray-400 mb-2" />
                  <span className="text-sm text-gray-600">Click to upload logo</span>
                  <span className="text-xs text-gray-400 mt-1">PNG, JPG up to 2MB</span>
                </>
              )}
              <input
                type="file"
                accept="image/png,image/jpeg"
                onChange={onLogoUpload}
                className="hidden"
                disabled={isUploading}
              />
            </label>
          )}

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Logo Width (mm)
              </label>
              <input
                type="number"
                value={config.logoWidth}
                onChange={e => onChange({ ...config, logoWidth: parseInt(e.target.value) || 40 })}
                min={10}
                max={100}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Logo Height (mm)
              </label>
              <input
                type="number"
                value={config.logoHeight || ''}
                onChange={e => onChange({ ...config, logoHeight: e.target.value ? parseInt(e.target.value) : null })}
                placeholder="Auto"
                min={10}
                max={100}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500"
              />
            </div>
          </div>
        </div>
      </div>

      <div className="border-t border-gray-200 pt-6">
        <h3 className="text-lg font-medium text-gray-900 mb-4">Firm Information</h3>

        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Firm Name
            </label>
            <input
              type="text"
              value={config.firmName || ''}
              onChange={e => onChange({ ...config, firmName: e.target.value || null })}
              placeholder="e.g., Acme Capital Partners"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Tagline
            </label>
            <input
              type="text"
              value={config.tagline || ''}
              onChange={e => onChange({ ...config, tagline: e.target.value || null })}
              placeholder="e.g., Investing in Tomorrow's Leaders"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500"
            />
          </div>
        </div>
      </div>

      <div className="border-t border-gray-200 pt-6">
        <h3 className="text-lg font-medium text-gray-900 mb-4">Watermark</h3>

        <div className="space-y-4">
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={config.watermarkEnabled}
              onChange={e => onChange({ ...config, watermarkEnabled: e.target.checked })}
              className="rounded border-gray-300 text-primary-600 focus:ring-primary-500"
            />
            <span className="text-sm text-gray-700">Enable watermark</span>
          </label>

          {config.watermarkEnabled && (
            <>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Watermark Text
                </label>
                <input
                  type="text"
                  value={config.watermarkText || ''}
                  onChange={e => onChange({ ...config, watermarkText: e.target.value || null })}
                  placeholder="e.g., CONFIDENTIAL"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Opacity ({Math.round(config.watermarkOpacity * 100)}%)
                </label>
                <input
                  type="range"
                  value={config.watermarkOpacity}
                  onChange={e => onChange({ ...config, watermarkOpacity: parseFloat(e.target.value) })}
                  min={0.05}
                  max={0.5}
                  step={0.05}
                  className="w-full"
                />
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

// ============================================================================
// Section Config Editor
// ============================================================================

interface SectionConfigEditorProps {
  config: SectionTemplateConfig[]
  onChange: (config: SectionTemplateConfig[]) => void
  layoutSections: any[]
}

function SectionConfigEditor({ config, onChange, layoutSections }: SectionConfigEditorProps) {
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set())

  const toggleExpanded = (sectionId: string) => {
    setExpandedSections(prev => {
      const next = new Set(prev)
      if (next.has(sectionId)) next.delete(sectionId)
      else next.add(sectionId)
      return next
    })
  }

  const toggleSection = (sectionId: string) => {
    onChange(
      config.map(s => s.id === sectionId ? { ...s, enabled: !s.enabled } : s)
    )
  }

  const toggleField = (sectionId: string, fieldId: string) => {
    onChange(
      config.map(s =>
        s.id === sectionId
          ? {
              ...s,
              fields: s.fields.map(f =>
                f.id === fieldId ? { ...f, enabled: !f.enabled } : f
              )
            }
          : s
      )
    )
  }

  const moveSection = (sectionId: string, direction: 'up' | 'down') => {
    const index = config.findIndex(s => s.id === sectionId)
    if (
      (direction === 'up' && index === 0) ||
      (direction === 'down' && index === config.length - 1)
    ) return

    const newConfig = [...config]
    const swapIndex = direction === 'up' ? index - 1 : index + 1
    const temp = newConfig[index]
    newConfig[index] = newConfig[swapIndex]
    newConfig[swapIndex] = temp

    // Update order values
    newConfig.forEach((s, i) => {
      s.order = i
    })

    onChange(newConfig)
  }

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-lg font-medium text-gray-900 mb-2">Content Sections</h3>
        <p className="text-sm text-gray-500 mb-4">
          Select which sections and fields to include, and reorder them as needed.
        </p>
      </div>

      <div className="space-y-2">
        {config.map((section, index) => {
          const isExpanded = expandedSections.has(section.id)
          const enabledFieldsCount = section.fields.filter(f => f.enabled).length

          return (
            <div key={section.id} className="border border-gray-200 rounded-lg">
              <div className="flex items-center gap-2 p-3 bg-gray-50">
                <div className="flex flex-col gap-1">
                  <button
                    onClick={() => moveSection(section.id, 'up')}
                    disabled={index === 0}
                    className="p-0.5 text-gray-400 hover:text-gray-600 disabled:opacity-30"
                  >
                    <ChevronDown className="w-3 h-3 rotate-180" />
                  </button>
                  <button
                    onClick={() => moveSection(section.id, 'down')}
                    disabled={index === config.length - 1}
                    className="p-0.5 text-gray-400 hover:text-gray-600 disabled:opacity-30"
                  >
                    <ChevronDown className="w-3 h-3" />
                  </button>
                </div>

                <button
                  onClick={() => toggleSection(section.id)}
                  className="text-gray-400 hover:text-primary-600"
                >
                  {section.enabled ? (
                    <CheckSquare className="w-5 h-5 text-primary-600" />
                  ) : (
                    <Square className="w-5 h-5" />
                  )}
                </button>

                <button
                  onClick={() => toggleExpanded(section.id)}
                  className="flex-1 flex items-center gap-2 text-left"
                >
                  {isExpanded ? (
                    <ChevronDown className="w-4 h-4 text-gray-400" />
                  ) : (
                    <ChevronRight className="w-4 h-4 text-gray-400" />
                  )}
                  <span className={clsx(
                    'font-medium',
                    section.enabled ? 'text-gray-900' : 'text-gray-400'
                  )}>
                    {section.name}
                  </span>
                  <span className="text-xs text-gray-400">
                    ({enabledFieldsCount}/{section.fields.length} fields)
                  </span>
                </button>
              </div>

              {isExpanded && (
                <div className="p-3 border-t border-gray-100 space-y-1">
                  {section.fields.map(field => (
                    <button
                      key={field.id}
                      onClick={() => toggleField(section.id, field.id)}
                      className={clsx(
                        'w-full flex items-center gap-2 px-3 py-2 text-sm rounded hover:bg-gray-50 text-left',
                        !section.enabled && 'opacity-50'
                      )}
                      disabled={!section.enabled}
                    >
                      {field.enabled ? (
                        <CheckSquare className="w-4 h-4 text-primary-600" />
                      ) : (
                        <Square className="w-4 h-4 text-gray-400" />
                      )}
                      <span className={field.enabled ? 'text-gray-700' : 'text-gray-400'}>
                        {field.name}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )
        })}
      </div>

      {config.length === 0 && (
        <div className="text-center py-8 border border-dashed border-gray-300 rounded-lg">
          <List className="w-8 h-8 text-gray-300 mx-auto mb-2" />
          <p className="text-sm text-gray-500">
            No sections configured. Sections will be loaded from your research layout.
          </p>
        </div>
      )}
    </div>
  )
}

// ============================================================================
// Header/Footer Editor
// ============================================================================

interface HeaderFooterEditorProps {
  config: HeaderFooterConfig
  onChange: (config: HeaderFooterConfig) => void
}

function HeaderFooterEditor({ config, onChange }: HeaderFooterEditorProps) {
  const updateHeader = (updates: Partial<HeaderFooterConfig['header']>) => {
    onChange({
      ...config,
      header: { ...config.header, ...updates }
    })
  }

  const updateFooter = (updates: Partial<HeaderFooterConfig['footer']>) => {
    onChange({
      ...config,
      footer: { ...config.footer, ...updates }
    })
  }

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-medium text-gray-900 mb-4">Header</h3>

        <div className="space-y-4">
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={config.header.enabled}
              onChange={e => updateHeader({ enabled: e.target.checked })}
              className="rounded border-gray-300 text-primary-600 focus:ring-primary-500"
            />
            <span className="text-sm text-gray-700">Enable header</span>
          </label>

          {config.header.enabled && (
            <>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Header Content
                </label>
                <input
                  type="text"
                  value={config.header.content || ''}
                  onChange={e => updateHeader({ content: e.target.value || null })}
                  placeholder="e.g., {{firmName}} - Confidential"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500"
                />
                <p className="text-xs text-gray-500 mt-1">
                  Use {'{{firmName}}'}, {'{{symbol}}'}, {'{{date}}'} for dynamic content
                </p>
              </div>

              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={config.header.showOnFirstPage}
                  onChange={e => updateHeader({ showOnFirstPage: e.target.checked })}
                  className="rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                />
                <span className="text-sm text-gray-700">Show on first page (cover)</span>
              </label>

              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={config.header.showPageNumber}
                  onChange={e => updateHeader({ showPageNumber: e.target.checked })}
                  className="rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                />
                <span className="text-sm text-gray-700">Show page number in header</span>
              </label>
            </>
          )}
        </div>
      </div>

      <div className="border-t border-gray-200 pt-6">
        <h3 className="text-lg font-medium text-gray-900 mb-4">Footer</h3>

        <div className="space-y-4">
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={config.footer.enabled}
              onChange={e => updateFooter({ enabled: e.target.checked })}
              className="rounded border-gray-300 text-primary-600 focus:ring-primary-500"
            />
            <span className="text-sm text-gray-700">Enable footer</span>
          </label>

          {config.footer.enabled && (
            <>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Footer Content
                </label>
                <input
                  type="text"
                  value={config.footer.content || ''}
                  onChange={e => updateFooter({ content: e.target.value || null })}
                  placeholder="e.g., For internal use only"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500"
                />
              </div>

              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={config.footer.showPageNumber}
                  onChange={e => updateFooter({ showPageNumber: e.target.checked })}
                  className="rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                />
                <span className="text-sm text-gray-700">Show page number</span>
              </label>

              {config.footer.showPageNumber && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Page Number Format
                  </label>
                  <input
                    type="text"
                    value={config.footer.pageNumberFormat}
                    onChange={e => updateFooter({ pageNumberFormat: e.target.value })}
                    placeholder="Page {page} of {total}"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500"
                  />
                  <p className="text-xs text-gray-500 mt-1">
                    Use {'{page}'} for current page and {'{total}'} for total pages
                  </p>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
