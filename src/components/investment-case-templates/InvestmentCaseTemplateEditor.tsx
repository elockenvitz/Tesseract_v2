import { useState, useEffect, useRef } from 'react'
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
  ChevronDown,
  ChevronRight,
  CheckSquare,
  Square,
  Upload,
  Trash2,
  Image,
  MoreHorizontal,
  Copy,
  RotateCcw,
  Eye,
  EyeOff,
  Users,
  Lock,
  Globe,
  RefreshCw,
  Highlighter,
  AlignLeft,
  AlignCenter,
  AlignRight,
  Columns,
  Plus
} from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { Button } from '../ui/Button'
import { useInvestmentCaseTemplates } from '../../hooks/useInvestmentCaseTemplates'
import { useUserResearchLayout } from '../../hooks/useResearchFields'
import { useShareableEntities } from '../../hooks/useLayoutCollaborations'
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
  DEFAULT_TOC_CONFIG,
  TEMPLATE_VARIABLES,
  TemplatePreviewContext,
  DEFAULT_PREVIEW_CONTEXT,
  resolveTemplateVariables,
  TemplateShareScope,
  TemplateShareRecipient,
  HF_VARIABLES,
  HFAlignment,
  CoverBehavior,
  PageNumberPosition
} from '../../types/investmentCaseTemplates'
import { InvestmentCaseTemplatePreview } from './InvestmentCaseTemplatePreview'
import {
  STYLE_PRESETS,
  MARGIN_PRESETS,
  TYPOGRAPHY_SCALES,
  DENSITY_PRESETS,
  COLOR_USAGE,
  detectMarginPreset,
  detectTypographyScale,
  detectDensity,
  detectBasePreset,
  deriveColorsFromPrimary,
  contrastRatio,
  contrastLevel,
  getStyleWarnings,
  estimatePages,
  type StylePreset,
  type LayoutDensity,
} from './stylePresets'

type EditorTab = 'cover' | 'style' | 'branding' | 'header-footer'

interface Props {
  template: InvestmentCaseTemplate | null
  isCreateMode?: boolean
  onClose: () => void
  onDuplicate?: () => void
}

export function InvestmentCaseTemplateEditor({ template, isCreateMode = false, onClose, onDuplicate }: Props) {
  const { createTemplate, updateTemplate, uploadLogo, deleteLogo, isCreating, isUpdating, isUploadingLogo } = useInvestmentCaseTemplates()
  const { sections: layoutSections } = useUserResearchLayout()

  // Fetch org branding for "Use org branding" / "Use org disclaimer" features
  const { data: orgBranding } = useQuery({
    queryKey: ['organization-branding'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('organizations')
        .select('logo_url, settings')
        .limit(1)
        .single()
      if (error && error.code !== 'PGRST116') throw error
      const branding = data?.settings?.branding || {}

      // Generate a signed URL for the logo if a storage path exists
      let logoSignedUrl: string | null = null
      if (data?.logo_url) {
        const { data: signedData } = await supabase.storage
          .from('template-branding')
          .createSignedUrl(data.logo_url, 3600)
        logoSignedUrl = signedData?.signedUrl || null
      }

      return {
        firmName: branding.firm_name || '',
        tagline: branding.tagline || '',
        defaultDisclaimer: branding.default_disclaimer || '',
        logoUrl: logoSignedUrl,
        logoPath: data?.logo_url || null,
      }
    },
  })

  const [activeTab, setActiveTab] = useState<EditorTab>('cover')
  const [name, setName] = useState(template?.name || '')
  const [description, setDescription] = useState(template?.description || '')
  const [shareScope, setShareScope] = useState<TemplateShareScope>(template?.is_shared ? 'org' : 'private')
  const [shareRecipients, setShareRecipients] = useState<TemplateShareRecipient[]>([])
  const isShared = shareScope !== 'private'
  const [coverConfig, setCoverConfig] = useState<CoverPageConfig>({ ...DEFAULT_COVER_CONFIG, ...template?.cover_config })
  const [styleConfig, setStyleConfig] = useState<StyleConfig>(template?.style_config || DEFAULT_STYLE_CONFIG)
  const [brandingConfig, setBrandingConfig] = useState<BrandingConfig>(template?.branding_config || DEFAULT_BRANDING_CONFIG)
  const [headerFooterConfig, setHeaderFooterConfig] = useState<HeaderFooterConfig>(template?.header_footer_config || DEFAULT_HEADER_FOOTER_CONFIG)
  const [sectionConfig, setSectionConfig] = useState<SectionTemplateConfig[]>(template?.section_config || [])
  const [tocConfig, setTocConfig] = useState<TocConfig>(template?.toc_config || DEFAULT_TOC_CONFIG)
  const [hasChanges, setHasChanges] = useState(isCreateMode)
  const [showPreview, setShowPreview] = useState(true)
  const [moreMenuOpen, setMoreMenuOpen] = useState(false)
  const [nameBlurred, setNameBlurred] = useState(false)
  const [previewHighlight, setPreviewHighlight] = useState<string | null>(null)
  const [showMarginGuides, setShowMarginGuides] = useState(false)
  const [draftLogoFile, setDraftLogoFile] = useState<File | null>(null)
  const [draftLogoPreview, setDraftLogoPreview] = useState<string | null>(null)
  const [highlightBranding, setHighlightBranding] = useState(false)
  const highlightTimerRef = useRef<ReturnType<typeof setTimeout>>(null)
  const moreMenuRef = useRef<HTMLDivElement>(null)

  const handleStyleHighlight = (area: string | null) => {
    if (highlightTimerRef.current) clearTimeout(highlightTimerRef.current)
    setPreviewHighlight(area)
    if (area) {
      highlightTimerRef.current = setTimeout(() => setPreviewHighlight(null), 1000)
    }
  }

  // Cleanup draft logo object URL
  useEffect(() => {
    return () => {
      if (draftLogoPreview) URL.revokeObjectURL(draftLogoPreview)
    }
  }, [draftLogoPreview])

  const handleDraftLogoSelect = (file: File) => {
    if (draftLogoPreview) URL.revokeObjectURL(draftLogoPreview)
    setDraftLogoFile(file)
    setDraftLogoPreview(URL.createObjectURL(file))
  }

  const handleDraftLogoClear = () => {
    if (draftLogoPreview) URL.revokeObjectURL(draftLogoPreview)
    setDraftLogoFile(null)
    setDraftLogoPreview(null)
  }

  // Close more menu on click outside
  useEffect(() => {
    if (!moreMenuOpen) return
    const handler = (e: MouseEvent) => {
      if (moreMenuRef.current && !moreMenuRef.current.contains(e.target as Node)) {
        setMoreMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [moreMenuOpen])

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
    if (isCreateMode) {
      setHasChanges(name.trim().length > 0)
      return
    }
    if (!template) return
    const changed =
      name !== template.name ||
      description !== (template.description || '') ||
      isShared !== template.is_shared ||
      JSON.stringify(coverConfig) !== JSON.stringify(template.cover_config) ||
      JSON.stringify(styleConfig) !== JSON.stringify(template.style_config) ||
      JSON.stringify(brandingConfig) !== JSON.stringify(template.branding_config) ||
      JSON.stringify(headerFooterConfig) !== JSON.stringify(template.header_footer_config) ||
      JSON.stringify(tocConfig) !== JSON.stringify(template.toc_config)
    setHasChanges(changed)
  }, [name, description, isShared, coverConfig, styleConfig, brandingConfig, headerFooterConfig, tocConfig, template, isCreateMode])

  const handleSave = async () => {
    try {
      if (isCreateMode) {
        const newTemplate = await createTemplate({
          name,
          description: description || null,
          is_shared: isShared,
          cover_config: coverConfig,
          style_config: styleConfig,
          branding_config: brandingConfig,
          header_footer_config: headerFooterConfig,
          toc_config: tocConfig
        })
        if (draftLogoFile && newTemplate?.id) {
          try {
            await uploadLogo({ templateId: newTemplate.id, file: draftLogoFile })
          } catch (err) {
            console.error('Failed to upload draft logo:', err)
          }
        }
      } else if (template) {
        await updateTemplate(template.id, {
          name,
          description: description || null,
          is_shared: isShared,
          cover_config: coverConfig,
          style_config: styleConfig,
          branding_config: brandingConfig,
          header_footer_config: headerFooterConfig,
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
    if (!file || !template) return
    try {
      const result = await uploadLogo({ templateId: template.id, file })
      setBrandingConfig(prev => ({ ...prev, logoPath: result.storagePath }))
    } catch (err) {
      console.error('Failed to upload logo:', err)
    }
  }

  const handleDeleteLogo = async () => {
    if (!template) return
    try {
      await deleteLogo(template.id)
      setBrandingConfig(prev => ({ ...prev, logoPath: null }))
    } catch (err) {
      console.error('Failed to delete logo:', err)
    }
  }

  const tabs = [
    { id: 'cover' as EditorTab, label: 'Cover Page', icon: FileText },
    { id: 'style' as EditorTab, label: 'Style', icon: Palette },
    { id: 'branding' as EditorTab, label: 'Branding', icon: Building },
    { id: 'header-footer' as EditorTab, label: 'Header/Footer', icon: Layout }
  ]

  // When "Use org branding" is on, merge org branding into the preview's branding config
  const effectiveBrandingConfig: BrandingConfig = coverConfig.useOrgBranding && orgBranding
    ? {
        ...brandingConfig,
        firmName: orgBranding.firmName || brandingConfig.firmName,
        logoPath: orgBranding.logoPath || orgBranding.logoUrl || brandingConfig.logoPath,
      }
    : brandingConfig

  // Ensure showLogo is true when org branding is on
  const effectiveCoverConfig: CoverPageConfig = coverConfig.useOrgBranding
    ? { ...coverConfig, showLogo: true }
    : coverConfig

  // Preview context — fixed sample data (AAPL, today's date)
  const previewContext: TemplatePreviewContext = {
    ...DEFAULT_PREVIEW_CONTEXT,
    firmName: effectiveBrandingConfig.firmName || '',
  }

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
    cover_config: effectiveCoverConfig,
    style_config: styleConfig,
    branding_config: effectiveBrandingConfig,
    header_footer_config: headerFooterConfig,
    section_config: sectionConfig,
    toc_config: tocConfig,
    created_at: template?.created_at || new Date().toISOString(),
    updated_at: template?.updated_at || new Date().toISOString()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-white rounded-xl shadow-2xl w-[95vw] h-[90vh] max-w-7xl flex flex-col">
        {/* Header: Template Identity + Actions */}
        <div className="flex items-start justify-between px-6 py-3 border-b border-gray-200 shrink-0">
          <div className="flex-1 min-w-0 space-y-1">
            <div className="flex items-center gap-3">
              <input
                type="text"
                value={name}
                onChange={e => setName(e.target.value)}
                onBlur={() => setNameBlurred(true)}
                className={clsx(
                  'text-lg font-semibold text-gray-900 border-0 border-b-2 focus:ring-0 w-full max-w-sm bg-transparent',
                  nameBlurred && !name.trim() ? 'border-red-400' : 'border-transparent focus:border-primary-500'
                )}
                placeholder="Template name"
              />
              {!isCreateMode && template && (
                <span className="text-xs text-gray-400 shrink-0">Owner: You</span>
              )}
            </div>
            {nameBlurred && !name.trim() && (
              <p className="text-xs text-red-500 pl-0.5">Template name is required.</p>
            )}
            <input
              type="text"
              value={description}
              onChange={e => setDescription(e.target.value)}
              className="text-sm text-gray-500 border-0 focus:ring-0 w-full max-w-lg bg-transparent"
              placeholder="Description (optional)"
            />
            <div className="flex items-center gap-4">
              <span className="text-xs font-medium text-gray-500 shrink-0">Sharing</span>
              <TemplateSharingControl
                scope={shareScope}
                onScopeChange={setShareScope}
                recipients={shareRecipients}
                onRecipientsChange={setShareRecipients}
              />
            </div>
            <p className="text-[11px] text-gray-400">Templates define how assets export into an Investment Case PDF.</p>
          </div>
          <div className="flex items-center gap-2 shrink-0 pt-1">
            {!isCreateMode && (
              <div className="relative" ref={moreMenuRef}>
                <button
                  onClick={() => setMoreMenuOpen(!moreMenuOpen)}
                  className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg"
                  title="More actions"
                >
                  <MoreHorizontal className="w-4 h-4" />
                </button>
                {moreMenuOpen && (
                  <div className="absolute right-0 top-full mt-1 w-52 bg-white border border-gray-200 rounded-lg shadow-lg py-1 z-10">
                    <button
                      onClick={() => { onDuplicate?.(); setMoreMenuOpen(false) }}
                      className="w-full flex items-center gap-2 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50"
                    >
                      <Copy className="w-4 h-4" />
                      Duplicate template
                    </button>
                    <p className="px-3 py-1 text-[10px] text-gray-400">Creates a new template copy.</p>
                  </div>
                )}
              </div>
            )}
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowPreview(!showPreview)}
            >
              {showPreview ? <EyeOff className="w-4 h-4 mr-1" /> : <Eye className="w-4 h-4 mr-1" />}
              {showPreview ? 'Hide' : 'Preview'}
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={handleSave}
              disabled={(isCreateMode ? isCreating : isUpdating) || !hasChanges || !name.trim()}
            >
              {(isCreateMode ? isCreating : isUpdating) ? (
                <Loader2 className="w-4 h-4 animate-spin mr-1" />
              ) : (
                <Save className="w-4 h-4 mr-1" />
              )}
              {isCreateMode ? 'Create Template' : 'Save Changes'}
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
        <div className="flex-1 flex min-h-0">
          {/* Sidebar Tabs */}
          <div className="w-48 border-r border-gray-200 bg-gray-50 p-2 space-y-1 shrink-0">
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
            'flex-1 overflow-y-auto p-5 min-h-0',
            showPreview ? 'max-w-[50%]' : 'w-full'
          )}>
            {activeTab === 'cover' && (
              <CoverPageEditor
                config={coverConfig}
                onChange={setCoverConfig}
                tocConfig={tocConfig}
                onTocChange={setTocConfig}
                brandingConfig={brandingConfig}
                orgBranding={orgBranding}
              />
            )}
            {activeTab === 'style' && (
              <StyleEditor
                config={styleConfig}
                onChange={setStyleConfig}
                onHighlight={handleStyleHighlight}
                sectionCount={sectionConfig.filter(s => s.enabled).length}
                orgBranding={orgBranding}
                showMarginGuides={showMarginGuides}
                onShowMarginGuides={setShowMarginGuides}
              />
            )}
            {activeTab === 'branding' && (
              <BrandingEditor
                config={brandingConfig}
                onChange={setBrandingConfig}
                onLogoUpload={handleLogoUpload}
                onLogoDelete={handleDeleteLogo}
                isUploading={isUploadingLogo}
                isCreateMode={isCreateMode}
                orgBranding={orgBranding}
                coverConfig={coverConfig}
                onCoverChange={setCoverConfig}
                onHighlight={handleStyleHighlight}
                draftLogoPreview={draftLogoPreview}
                onDraftLogoSelect={handleDraftLogoSelect}
                onDraftLogoClear={handleDraftLogoClear}
              />
            )}
            {activeTab === 'header-footer' && (
              <HeaderFooterEditor config={headerFooterConfig} onChange={setHeaderFooterConfig} onHighlight={handleStyleHighlight} />
            )}
          </div>

          {/* Preview Panel */}
          {showPreview && (
            <div className="w-1/2 border-l border-gray-200 bg-gray-100/80 flex flex-col min-h-0 shrink-0">
              {/* Preview Context Bar */}
              <div className="px-4 py-2 bg-gray-50 border-b border-gray-200 shrink-0">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-[10px] text-gray-400">Sample data &mdash; AAPL &middot; {previewContext.asOfDate}</p>
                    {activeTab === 'branding' && (
                      <p className="text-[10px] text-gray-400 mt-0.5">
                        Branding: {coverConfig.useOrgBranding ? (
                          <span className="text-primary-600">Organization</span>
                        ) : (
                          <span className="text-amber-600">Template Override</span>
                        )}
                      </p>
                    )}
                  </div>
                  {activeTab === 'branding' && (
                    <button
                      type="button"
                      onClick={() => setHighlightBranding(prev => !prev)}
                      className={clsx(
                        'flex items-center gap-1 px-2 py-1 rounded text-[10px] font-medium transition-colors',
                        highlightBranding
                          ? 'bg-primary-100 text-primary-700'
                          : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
                      )}
                      title="Highlight branding elements"
                    >
                      <Highlighter className="w-3 h-3" />
                      Branding
                    </button>
                  )}
                </div>
              </div>

              {/* Preview Content */}
              <div className="flex-1 overflow-y-auto p-4">
                <InvestmentCaseTemplatePreview
                  template={previewTemplate}
                  previewContext={previewContext}
                  highlightArea={previewHighlight}
                  highlightBranding={activeTab === 'branding' && highlightBranding}
                  showMarginGuides={showMarginGuides}
                />
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ============================================================================
// Collapsible Group
// ============================================================================

function CollapsibleGroup({
  title,
  defaultOpen = false,
  hint,
  children
}: {
  title: string
  defaultOpen?: boolean
  hint?: string
  children: React.ReactNode
}) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className="border border-gray-200 rounded-lg">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-4 py-2.5 text-left hover:bg-gray-50/80 rounded-lg"
        type="button"
      >
        <span className="text-[13px] font-semibold text-gray-800 tracking-tight">{title}</span>
        <ChevronRight className={clsx('w-4 h-4 text-gray-400 transition-transform', open && 'rotate-90')} />
      </button>
      {open && (
        <div className="px-4 pb-3.5 space-y-3 border-t border-gray-100">
          {hint && <p className="text-[11px] text-gray-500 pt-2">{hint}</p>}
          {children}
        </div>
      )}
    </div>
  )
}

// ============================================================================
// Template Sharing Control
// ============================================================================

const SCOPE_OPTIONS: Array<{ value: TemplateShareScope; label: string; icon: typeof Lock; description: string }> = [
  { value: 'private', label: 'Private', icon: Lock, description: 'Only you can view and use this template' },
  { value: 'specific', label: 'Specific people', icon: Users, description: 'Share with selected people or teams' },
  { value: 'org', label: 'Entire organization', icon: Globe, description: 'Everyone in your org can use this template' },
]

const NODE_TYPE_ICON_CLASSES: Record<string, string> = {
  division: 'text-blue-500',
  department: 'text-purple-500',
  team: 'text-green-500',
  portfolio: 'text-amber-500',
}

interface OrgTreeNode {
  id: string
  name: string
  node_type: string
  parent_id: string | null
  children: OrgTreeNode[]
}

function buildOrgTree(nodes: Array<{ id: string; name: string; node_type: string; parent_id: string | null }>): OrgTreeNode[] {
  const map = new Map<string, OrgTreeNode>()
  const roots: OrgTreeNode[] = []

  // Create nodes
  for (const n of nodes) {
    map.set(n.id, { ...n, children: [] })
  }

  // Wire parent → children
  for (const n of map.values()) {
    if (n.parent_id && map.has(n.parent_id)) {
      map.get(n.parent_id)!.children.push(n)
    } else {
      roots.push(n)
    }
  }

  return roots
}

function OrgTreeCheckbox({
  node,
  depth,
  selectedIds,
  onToggle
}: {
  node: OrgTreeNode
  depth: number
  selectedIds: Set<string>
  onToggle: (id: string, name: string, type: 'department') => void
}) {
  const [expanded, setExpanded] = useState(depth < 1)
  const hasChildren = node.children.length > 0
  const checked = selectedIds.has(node.id)

  return (
    <div>
      <label
        className={clsx(
          'flex items-center gap-2 py-1.5 hover:bg-gray-50 cursor-pointer select-none',
          checked && 'bg-primary-50/50'
        )}
        style={{ paddingLeft: `${12 + depth * 14}px`, paddingRight: 12 }}
      >
        {hasChildren ? (
          <button
            type="button"
            onClick={e => { e.preventDefault(); setExpanded(!expanded) }}
            className="p-0.5 text-gray-400 hover:text-gray-600 shrink-0"
          >
            <ChevronRight className={clsx('w-3 h-3 transition-transform', expanded && 'rotate-90')} />
          </button>
        ) : (
          <span className="w-4 shrink-0" />
        )}
        <input
          type="checkbox"
          checked={checked}
          onChange={() => onToggle(node.id, node.name, 'department')}
          className="rounded border-gray-300 text-primary-600 focus:ring-primary-500 w-3.5 h-3.5"
        />
        <Building className={clsx('w-3.5 h-3.5 shrink-0', NODE_TYPE_ICON_CLASSES[node.node_type] || 'text-gray-400')} />
        <span className="text-sm text-gray-700 truncate">{node.name}</span>
      </label>
      {expanded && hasChildren && node.children.map(child => (
        <OrgTreeCheckbox
          key={child.id}
          node={child}
          depth={depth + 1}
          selectedIds={selectedIds}
          onToggle={onToggle}
        />
      ))}
    </div>
  )
}

function TemplateSharingControl({
  scope,
  onScopeChange,
  recipients,
  onRecipientsChange
}: {
  scope: TemplateShareScope
  onScopeChange: (scope: TemplateShareScope) => void
  recipients: TemplateShareRecipient[]
  onRecipientsChange: (recipients: TemplateShareRecipient[]) => void
}) {
  const [dropdownOpen, setDropdownOpen] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)

  const { teams, orgNodes, orgUsers, isLoading: entitiesLoading } = useShareableEntities()

  useEffect(() => {
    if (!dropdownOpen) return
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [dropdownOpen])

  const currentScope = SCOPE_OPTIONS.find(s => s.value === scope) || SCOPE_OPTIONS[0]
  const selectedIds = new Set(recipients.map(r => r.id))
  const orgTree = buildOrgTree(orgNodes)

  const handleToggle = (id: string, name: string, type: TemplateShareRecipient['type'], email?: string) => {
    if (selectedIds.has(id)) {
      onRecipientsChange(recipients.filter(r => r.id !== id))
    } else {
      onRecipientsChange([...recipients, { id, name, type, ...(email ? { email } : {}) }])
    }
  }

  const handleScopeSelect = (value: TemplateShareScope) => {
    onScopeChange(value)
    if (value !== 'specific') {
      onRecipientsChange([])
    }
    // Keep dropdown open for 'specific' so user can pick recipients
    if (value !== 'specific') {
      setDropdownOpen(false)
    }
  }

  // Button label
  const buttonLabel = scope === 'specific' && recipients.length > 0
    ? `${recipients.length} people/teams`
    : currentScope.label

  return (
    <div className="flex items-center gap-3">
      <div className="relative" ref={dropdownRef}>
        <button
          type="button"
          onClick={() => setDropdownOpen(!dropdownOpen)}
          className="flex items-center gap-1.5 px-2.5 py-1 text-sm text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
        >
          <currentScope.icon className="w-3.5 h-3.5 text-gray-500" />
          <span>{buttonLabel}</span>
          <ChevronDown className={clsx('w-3 h-3 text-gray-400 transition-transform', dropdownOpen && 'rotate-180')} />
        </button>

        {dropdownOpen && (
          <div className="absolute left-0 top-full mt-1 w-56 bg-white border border-gray-200 rounded-lg shadow-lg z-20">
            {/* Scope options */}
            <div className="py-1">
              {SCOPE_OPTIONS.map(opt => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => handleScopeSelect(opt.value)}
                  className={clsx(
                    'w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-gray-50',
                    scope === opt.value && 'bg-primary-50'
                  )}
                >
                  <opt.icon className={clsx(
                    'w-3.5 h-3.5 shrink-0',
                    scope === opt.value ? 'text-primary-600' : 'text-gray-400'
                  )} />
                  <span className={clsx(
                    'text-sm',
                    scope === opt.value ? 'text-primary-700 font-medium' : 'text-gray-700'
                  )}>
                    {opt.label}
                  </span>
                </button>
              ))}
            </div>

            {/* Inline org tree when 'specific' is selected */}
            {scope === 'specific' && (
              <>
                <div className="border-t border-gray-200" />
                <div className="max-h-64 overflow-y-auto">
                  {entitiesLoading ? (
                    <div className="flex items-center justify-center py-6 text-sm text-gray-400">
                      <Loader2 className="w-4 h-4 animate-spin mr-2" />
                      Loading...
                    </div>
                  ) : (
                    <div className="py-1">
                      {/* Org Structure */}
                      {orgTree.length > 0 && (
                        <>
                          <div className="px-3 py-1 text-[10px] font-semibold text-gray-400 uppercase tracking-wider">
                            Groups
                          </div>
                          {orgTree.map(node => (
                            <OrgTreeCheckbox
                              key={node.id}
                              node={node}
                              depth={0}
                              selectedIds={selectedIds}
                              onToggle={(id, name) => handleToggle(id, name, 'department')}
                            />
                          ))}
                        </>
                      )}

                      {/* Teams */}
                      {teams.length > 0 && (
                        <>
                          <div className="px-3 py-1 mt-1 text-[10px] font-semibold text-gray-400 uppercase tracking-wider">
                            Teams
                          </div>
                          {teams.map(t => (
                            <label
                              key={t.id}
                              className={clsx(
                                'flex items-center gap-2 py-1.5 px-3 hover:bg-gray-50 cursor-pointer select-none',
                                selectedIds.has(t.id) && 'bg-primary-50/50'
                              )}
                            >
                              <input
                                type="checkbox"
                                checked={selectedIds.has(t.id)}
                                onChange={() => handleToggle(t.id, t.name, 'team')}
                                className="rounded border-gray-300 text-primary-600 focus:ring-primary-500 w-3.5 h-3.5"
                              />
                              <Users className="w-3.5 h-3.5 text-green-500 shrink-0" />
                              <span className="text-sm text-gray-700 truncate">{t.name}</span>
                            </label>
                          ))}
                        </>
                      )}

                      {/* People */}
                      {orgUsers.length > 0 && (
                        <>
                          <div className="px-3 py-1 mt-1 text-[10px] font-semibold text-gray-400 uppercase tracking-wider">
                            People
                          </div>
                          {orgUsers.map(u => (
                            <label
                              key={u.id}
                              className={clsx(
                                'flex items-center gap-2 py-1.5 px-3 hover:bg-gray-50 cursor-pointer select-none',
                                selectedIds.has(u.id) && 'bg-primary-50/50'
                              )}
                            >
                              <input
                                type="checkbox"
                                checked={selectedIds.has(u.id)}
                                onChange={() => handleToggle(u.id, u.full_name, 'user', u.email)}
                                className="rounded border-gray-300 text-primary-600 focus:ring-primary-500 w-3.5 h-3.5"
                              />
                              <div className="w-5 h-5 rounded-full bg-gray-100 shrink-0 flex items-center justify-center text-[9px] text-gray-500 font-medium">
                                {u.full_name.charAt(0).toUpperCase()}
                              </div>
                              <span className="text-sm text-gray-700 truncate">{u.full_name}</span>
                              <span className="text-[11px] text-gray-400 truncate ml-auto">{u.email}</span>
                            </label>
                          ))}
                        </>
                      )}

                      {orgTree.length === 0 && teams.length === 0 && orgUsers.length === 0 && (
                        <div className="py-4 text-center text-sm text-gray-400">
                          No org members found
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        )}
      </div>

      <span className="text-[11px] text-gray-400">
        {scope === 'private' ? 'Only you' : scope === 'org' ? 'All org members' : `${recipients.length} selected`} can use this template.
      </span>
    </div>
  )
}

// ============================================================================
// Cover Page Editor (reorganized into collapsible groups)
// ============================================================================

interface OrgBrandingData {
  firmName: string
  tagline: string
  defaultDisclaimer: string
  logoUrl: string | null   // Signed URL for display
  logoPath?: string | null // Raw storage path for branding config
}

interface CoverPageEditorProps {
  config: CoverPageConfig
  onChange: (config: CoverPageConfig) => void
  tocConfig: TocConfig
  onTocChange: (config: TocConfig) => void
  brandingConfig: BrandingConfig
  orgBranding?: OrgBrandingData | null
}

function CoverPageEditor({ config, onChange, tocConfig, onTocChange, brandingConfig, orgBranding }: CoverPageEditorProps) {
  const [variableDropdownOpen, setVariableDropdownOpen] = useState(false)
  const titleInputRef = useRef<HTMLInputElement>(null)
  const variableRef = useRef<HTMLDivElement>(null)

  // Close variable dropdown on click outside
  useEffect(() => {
    if (!variableDropdownOpen) return
    const handler = (e: MouseEvent) => {
      if (variableRef.current && !variableRef.current.contains(e.target as Node)) {
        setVariableDropdownOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [variableDropdownOpen])

  const insertVariable = (varKey: string) => {
    const input = titleInputRef.current
    if (!input) {
      onChange({ ...config, customTitle: (config.customTitle || '') + varKey })
      setVariableDropdownOpen(false)
      return
    }
    const start = input.selectionStart ?? (config.customTitle?.length ?? 0)
    const end = input.selectionEnd ?? start
    const current = config.customTitle || ''
    const newTitle = current.slice(0, start) + varKey + current.slice(end)
    onChange({ ...config, customTitle: newTitle })
    setVariableDropdownOpen(false)
    requestAnimationFrame(() => {
      input.focus()
      const newPos = start + varKey.length
      input.setSelectionRange(newPos, newPos)
    })
  }

  const defaultTitle = 'Investment Case: {{symbol}}'
  const isCustomTitle = config.customTitle !== null && config.customTitle !== '' && config.customTitle !== defaultTitle

  const [showAllVars, setShowAllVars] = useState(false)

  return (
    <div className="space-y-3">
      <h3 className="text-base font-semibold text-gray-900">Cover Page</h3>

      {/* 1. Title */}
      <CollapsibleGroup title="Title" defaultOpen>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Cover Title</label>
          <div className="flex gap-2">
            <input
              ref={titleInputRef}
              type="text"
              value={config.customTitle || ''}
              onChange={e => onChange({ ...config, customTitle: e.target.value || null })}
              placeholder={defaultTitle}
              className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 font-mono"
            />
            <div className="relative" ref={variableRef}>
              <button
                onClick={() => setVariableDropdownOpen(!variableDropdownOpen)}
                className={clsx(
                  'px-3 py-2 text-sm border rounded-lg whitespace-nowrap flex items-center gap-1.5',
                  variableDropdownOpen
                    ? 'border-primary-400 bg-primary-50 text-primary-700'
                    : 'border-gray-300 hover:bg-gray-50 text-gray-600'
                )}
                type="button"
              >
                <span className="font-mono text-xs">{'{ }'}</span>
                Insert variable
                <ChevronDown className="w-3 h-3" />
              </button>
              {variableDropdownOpen && (
                <div className="absolute right-0 top-full mt-1 w-64 bg-white border border-gray-200 rounded-lg shadow-lg py-1 z-10">
                  <div className="px-3 py-1.5 text-[10px] text-gray-400 font-semibold uppercase tracking-wider border-b border-gray-100">
                    Insert at cursor
                  </div>
                  {TEMPLATE_VARIABLES.map(v => (
                    <button
                      key={v.key}
                      onClick={() => insertVariable(v.key)}
                      className="w-full flex items-center justify-between px-3 py-1.5 text-sm hover:bg-gray-50 group"
                      type="button"
                    >
                      <span className="font-mono text-xs text-primary-600 group-hover:text-primary-700">{v.key}</span>
                      <span className="text-[11px] text-gray-400">{v.label}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Available variables helper */}
          <div className="mt-1.5">
            {!config.customTitle && (
              <p className="text-[11px] text-gray-400 mb-0.5">
                Default: <span className="font-mono">Investment Case: {'{{symbol}}'}</span>
              </p>
            )}
            <p className="text-[11px] text-gray-500 inline">
              Available: <span className="font-mono text-gray-400">{'{{symbol}}'}</span>, <span className="font-mono text-gray-400">{'{{company_name}}'}</span>, <span className="font-mono text-gray-400">{'{{as_of_date}}'}</span>
              {!showAllVars ? (
                <button
                  type="button"
                  onClick={() => setShowAllVars(true)}
                  className="text-primary-600 hover:text-primary-700 ml-1"
                >
                  Show all
                </button>
              ) : (
                <>
                  , <span className="font-mono text-gray-400">{'{{author}}'}</span>, <span className="font-mono text-gray-400">{'{{current_price}}'}</span>, <span className="font-mono text-gray-400">{'{{firm_name}}'}</span>
                  <button
                    type="button"
                    onClick={() => setShowAllVars(false)}
                    className="text-primary-600 hover:text-primary-700 ml-1"
                  >
                    Hide
                  </button>
                </>
              )}
            </p>
          </div>

          {isCustomTitle && (
            <button
              onClick={() => onChange({ ...config, customTitle: null })}
              className="flex items-center gap-1 text-xs text-primary-600 hover:text-primary-700 mt-1"
              type="button"
            >
              <RotateCcw className="w-3 h-3" />
              Reset to default
            </button>
          )}
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Title Position</label>
          <div className="flex rounded-lg border border-gray-300 overflow-hidden w-fit">
            {(['left', 'center', 'right'] as const).map(pos => (
              <button
                key={pos}
                onClick={() => onChange({ ...config, titlePosition: pos })}
                className={clsx(
                  'px-4 py-1.5 text-sm capitalize',
                  pos !== 'left' && 'border-l border-gray-300',
                  config.titlePosition === pos
                    ? 'bg-primary-100 text-primary-700 font-medium'
                    : 'bg-white text-gray-600 hover:bg-gray-50'
                )}
                type="button"
              >
                {pos}
              </button>
            ))}
          </div>
        </div>
      </CollapsibleGroup>

      {/* 2. Logo & Identity */}
      <CollapsibleGroup title="Logo & Identity" defaultOpen>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 select-none cursor-pointer">
            <input
              type="checkbox"
              checked={config.useOrgBranding}
              onChange={e => onChange({ ...config, useOrgBranding: e.target.checked, showLogo: e.target.checked || config.showLogo })}
              className="rounded border-gray-300 text-primary-600 focus:ring-primary-500"
            />
            <span className="text-sm text-gray-700">Use org logo &amp; firm name</span>
          </label>
          {config.useOrgBranding && (
            <span className="text-[10px] text-amber-600 bg-amber-50 px-1.5 py-0.5 rounded font-medium">Inherited from org</span>
          )}
        </div>

        {config.useOrgBranding && orgBranding && (
          <div className="bg-gray-50 border border-gray-200 rounded-lg p-3 text-xs text-gray-500 space-y-1">
            <div><span className="font-medium text-gray-600">Firm:</span> {orgBranding.firmName || <span className="italic text-gray-400">Not set</span>}</div>
            {orgBranding.logoUrl && <div><span className="font-medium text-gray-600">Logo:</span> Configured</div>}
            {!orgBranding.firmName && !orgBranding.logoUrl && (
              <p className="text-amber-600">No org branding configured yet. Set it up in Organization &rarr; Settings.</p>
            )}
          </div>
        )}

        {(config.useOrgBranding || config.showLogo) && (
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">
              Logo Position
            </label>
            <div className="flex rounded-lg border border-gray-300 overflow-hidden w-fit">
              {([
                { value: 'top-left' as const, label: 'Top Left' },
                { value: 'top-right' as const, label: 'Top Right' },
              ]).map((opt, idx) => (
                <button
                  key={opt.value}
                  onClick={() => onChange({ ...config, logoPosition: opt.value })}
                  className={clsx(
                    'px-3 py-1.5 text-sm',
                    idx > 0 && 'border-l border-gray-300',
                    config.logoPosition === opt.value
                      ? 'bg-primary-100 text-primary-700 font-medium'
                      : 'bg-white text-gray-600 hover:bg-gray-50'
                  )}
                  type="button"
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
        )}

        <label className="flex items-center gap-2 select-none cursor-pointer">
          <input
            type="checkbox"
            checked={config.showCompanyName}
            onChange={e => onChange({ ...config, showCompanyName: e.target.checked })}
            className="rounded border-gray-300 text-primary-600 focus:ring-primary-500"
          />
          <span className="text-sm text-gray-700">
            Show company name <span className="text-gray-400">(e.g., Apple Inc.)</span>
          </span>
        </label>
      </CollapsibleGroup>

      {/* 3. Attribution & Metadata */}
      <CollapsibleGroup title="Attribution & Metadata">
        <div className="space-y-2">
          <label className="flex items-center gap-2 select-none cursor-pointer">
            <input
              type="checkbox"
              checked={config.showCurrentPrice}
              onChange={e => onChange({ ...config, showCurrentPrice: e.target.checked })}
              className="rounded border-gray-300 text-primary-600 focus:ring-primary-500"
            />
            <span className="text-sm text-gray-700">Show current price</span>
          </label>
          <label className="flex items-center gap-2 select-none cursor-pointer">
            <input
              type="checkbox"
              checked={config.includeDate}
              onChange={e => onChange({ ...config, includeDate: e.target.checked })}
              className="rounded border-gray-300 text-primary-600 focus:ring-primary-500"
            />
            <span className="text-sm text-gray-700">Include as-of date</span>
          </label>
          <label className="flex items-center gap-2 select-none cursor-pointer">
            <input
              type="checkbox"
              checked={config.includeAuthor}
              onChange={e => onChange({ ...config, includeAuthor: e.target.checked })}
              className="rounded border-gray-300 text-primary-600 focus:ring-primary-500"
            />
            <span className="text-sm text-gray-700">Include author attribution</span>
          </label>
          <label className="flex items-center gap-2 select-none cursor-pointer">
            <input
              type="checkbox"
              checked={config.includeTimestamp}
              onChange={e => onChange({ ...config, includeTimestamp: e.target.checked })}
              className="rounded border-gray-300 text-primary-600 focus:ring-primary-500"
            />
            <span className="text-sm text-gray-700">Include generated timestamp</span>
          </label>
        </div>
        <p className="text-[11px] text-gray-400">Captured at export time.</p>
      </CollapsibleGroup>

      {/* 4. Disclaimer & Compliance */}
      <CollapsibleGroup title="Disclaimer & Compliance">
        <label className="flex items-center gap-2 select-none cursor-pointer">
          <input
            type="checkbox"
            checked={config.includeDisclaimer}
            onChange={e => onChange({ ...config, includeDisclaimer: e.target.checked })}
            className="rounded border-gray-300 text-primary-600 focus:ring-primary-500"
          />
          <span className="text-sm text-gray-700">Include disclaimer on cover</span>
        </label>

        {config.includeDisclaimer && (
          <>
            <div className="flex items-center gap-3">
              <label className="flex items-center gap-2 select-none cursor-pointer">
                <input
                  type="checkbox"
                  checked={config.useOrgDisclaimer}
                  onChange={e => onChange({ ...config, useOrgDisclaimer: e.target.checked })}
                  className="rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                />
                <span className="text-sm text-gray-700">Use org default disclaimer</span>
              </label>
              {config.useOrgDisclaimer && (
                <span className="text-[10px] text-amber-600 bg-amber-50 px-1.5 py-0.5 rounded font-medium">Inherited from org</span>
              )}
            </div>
            {config.useOrgDisclaimer ? (
              <div className="bg-gray-50 border border-gray-200 rounded-lg p-3">
                <p className="text-xs text-gray-500 italic leading-relaxed">
                  {orgBranding?.defaultDisclaimer || config.disclaimerText || DEFAULT_COVER_CONFIG.disclaimerText}
                </p>
                <p className="text-[10px] text-gray-400 mt-1.5">
                  Read-only &mdash; edit in Organization &rarr; Settings to change the default.
                </p>
                {!orgBranding?.defaultDisclaimer && (
                  <p className="text-[10px] text-amber-600 mt-1">No org disclaimer configured. Using template default.</p>
                )}
              </div>
            ) : (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Custom Disclaimer</label>
                <textarea
                  value={config.disclaimerText}
                  onChange={e => onChange({ ...config, disclaimerText: e.target.value })}
                  rows={3}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500"
                />
                <p className="text-[10px] text-amber-600 mt-1">Overrides org default.</p>
              </div>
            )}
          </>
        )}
      </CollapsibleGroup>

      {/* 5. Table of Contents */}
      <CollapsibleGroup title="Table of Contents" hint="TOC is generated from included sections.">
        <label className="flex items-center gap-2 select-none cursor-pointer">
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
              <label className="block text-sm font-medium text-gray-700 mb-1">TOC Title</label>
              <input
                type="text"
                value={tocConfig.title}
                onChange={e => onTocChange({ ...tocConfig, title: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500"
              />
            </div>
            <label className="flex items-center gap-2 select-none cursor-pointer">
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
      </CollapsibleGroup>
    </div>
  )
}

// ============================================================================
// Style Editor
// ============================================================================

interface StyleEditorProps {
  config: StyleConfig
  onChange: (config: StyleConfig) => void
  onHighlight?: (area: string | null) => void
  sectionCount?: number
  orgBranding?: { firmName: string; tagline: string; defaultDisclaimer: string; logoUrl: string | null; primaryColor?: string } | null
  onShowMarginGuides?: (show: boolean) => void
  showMarginGuides?: boolean
}

function StyleEditor({ config, onChange, onHighlight, sectionCount = 6, orgBranding, onShowMarginGuides, showMarginGuides }: StyleEditorProps) {
  const [advancedOpen, setAdvancedOpen] = useState(false)
  const advancedRef = useRef<HTMLDivElement>(null)
  const colorSystemRef = useRef<HTMLDivElement>(null)

  const emitHighlight = (area: string) => {
    onHighlight?.(area)
  }

  const updateColors = (colorKey: keyof StyleConfig['colors'], value: string) => {
    onChange({ ...config, colors: { ...config.colors, [colorKey]: value } })
    emitHighlight(colorKey === 'primary' ? 'primary' : colorKey === 'text' ? 'body' : colorKey === 'headingText' ? 'heading' : colorKey)
  }

  const updateMargins = (marginKey: keyof StyleConfig['margins'], value: number) => {
    onChange({ ...config, margins: { ...config.margins, [marginKey]: value } })
    emitHighlight('margins')
  }

  const updateFont = (fontKey: keyof StyleConfig['fonts'], property: string, value: any) => {
    onChange({
      ...config,
      fonts: { ...config.fonts, [fontKey]: { ...config.fonts[fontKey], [property]: value } }
    })
    emitHighlight(fontKey === 'body' ? 'body' : fontKey === 'heading' ? 'heading' : fontKey === 'title' ? 'title' : fontKey)
  }

  const applyPrimaryColor = (primary: string) => {
    const derived = deriveColorsFromPrimary(primary)
    onChange({ ...config, colors: derived })
    emitHighlight('primary')
  }

  const warnings = getStyleWarnings(config)
  const warningFor = (field: string) => warnings.find(w => w.field === field)

  const currentMarginPreset = detectMarginPreset(config.margins)
  const currentTypoScale = detectTypographyScale(config.fonts)
  const currentDensity = detectDensity(config.spacing)
  const baseStatus = detectBasePreset(config)

  const applyPreset = (preset: StylePreset) => {
    onChange(JSON.parse(JSON.stringify(preset.config)))
  }

  const scrollToAdvancedSection = (ref: React.RefObject<HTMLDivElement | null>) => {
    setAdvancedOpen(true)
    setTimeout(() => ref.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 100)
  }

  // Contrast level indicator helper
  const ContrastDot = ({ fg, bg = '#ffffff' }: { fg: string; bg?: string }) => {
    const level = contrastLevel(fg, bg)
    const ratio = contrastRatio(fg, bg)
    const color = level === 'good' ? 'bg-emerald-500' : level === 'low' ? 'bg-amber-500' : 'bg-red-500'
    const label = level === 'good' ? 'Good' : level === 'low' ? 'Low' : 'Poor'
    return (
      <span className="inline-flex items-center gap-1" title={`${ratio.toFixed(1)}:1 contrast — ${label}`}>
        <span className={clsx('w-2 h-2 rounded-full', color)} />
        <span className="text-[9px] text-gray-400">{ratio.toFixed(1)}:1</span>
      </span>
    )
  }

  return (
    <div className="space-y-6">
      {/* ── Style Presets ── */}
      <div>
        <div className="flex items-center justify-between mb-1">
          <h3 className="text-sm font-semibold text-gray-800">Style Presets</h3>
          {/* Base Style Status indicator */}
          <span className="text-[11px] text-gray-500">
            Base: <span className="font-medium text-gray-700">{baseStatus.label}</span>
          </span>
        </div>
        <p className="text-[11px] text-gray-500 mb-3">Apply a complete style in one click. You can fine-tune after.</p>
        <div className="flex flex-wrap gap-2">
          {STYLE_PRESETS.map(preset => {
            const isActive = JSON.stringify(config) === JSON.stringify(preset.config)
            return (
              <button
                key={preset.key}
                onClick={() => applyPreset(preset)}
                className={clsx(
                  'px-3 py-1.5 rounded-lg border text-sm transition-colors',
                  isActive
                    ? 'border-primary-400 bg-primary-50 text-primary-700 font-medium'
                    : 'border-gray-200 hover:border-gray-300 text-gray-700'
                )}
                title={preset.description}
              >
                {preset.label}
              </button>
            )
          })}
          <button
            onClick={() => applyPreset(STYLE_PRESETS[0])}
            className="px-3 py-1.5 rounded-lg border border-gray-200 text-sm text-gray-500 hover:border-gray-300 hover:text-gray-700"
          >
            <RotateCcw className="w-3.5 h-3.5 inline mr-1 -mt-px" />
            Reset
          </button>
        </div>
      </div>

      {/* ── Recommended Settings ── */}
      <div className="border border-gray-200 rounded-lg overflow-hidden">
        <div className="px-4 py-2.5 border-b border-gray-100">
          <span className="text-[13px] font-semibold text-gray-800 tracking-tight">Recommended</span>
          <span className="ml-2 text-[11px] text-gray-400">Most users only need these controls</span>
        </div>
        <div className="px-4 pb-4 pt-3 space-y-5">
          {/* Page Format (orientation moved to Advanced) */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Page Format</label>
            <select
              value={config.pageFormat}
              onChange={e => { onChange({ ...config, pageFormat: e.target.value as any }); emitHighlight('margins') }}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500"
            >
              {PAGE_FORMATS.map(f => (
                <option key={f.value} value={f.value}>{f.label}</option>
              ))}
            </select>
          </div>

          {/* Margin Size */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="block text-sm font-medium text-gray-700">Margin Size</label>
              <label className="inline-flex items-center gap-1.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={showMarginGuides || false}
                  onChange={e => onShowMarginGuides?.(e.target.checked)}
                  className="rounded border-gray-300 text-primary-600 focus:ring-primary-500 w-3.5 h-3.5"
                />
                <span className="text-[11px] text-gray-500">Show guides in preview</span>
              </label>
            </div>
            <div className="flex gap-2">
              {MARGIN_PRESETS.map(mp => (
                <button
                  key={mp.key}
                  onClick={() => {
                    onChange({ ...config, margins: { ...mp.values } })
                    emitHighlight('margins')
                  }}
                  className={clsx(
                    'flex-1 px-3 py-1.5 rounded-lg border text-sm transition-colors',
                    currentMarginPreset === mp.key
                      ? 'border-primary-400 bg-primary-50 text-primary-700 font-medium'
                      : 'border-gray-200 hover:border-gray-300 text-gray-600'
                  )}
                >
                  {mp.label}
                </button>
              ))}
            </div>
            {currentMarginPreset === null && (
              <p className="text-[11px] text-gray-400 mt-1">Custom margins — edit in Advanced below</p>
            )}
            {warnings.some(w => w.field.startsWith('margin-')) && (
              <p className="text-[11px] text-amber-600 mt-1">{warnings.find(w => w.field.startsWith('margin-'))!.message}</p>
            )}
          </div>

          {/* Primary Brand Color */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Primary Brand Color</label>
            <p className="text-[11px] text-gray-500 mb-2">Other color tokens are derived automatically.</p>
            {/* Branding Lock — inherit from org */}
            {orgBranding?.primaryColor && (
              <label className="flex items-center gap-2 mb-3 p-2 bg-blue-50/60 border border-blue-200/60 rounded-lg cursor-pointer">
                <input
                  type="checkbox"
                  checked={config.colors.primary === orgBranding.primaryColor}
                  onChange={e => {
                    if (e.target.checked && orgBranding.primaryColor) {
                      applyPrimaryColor(orgBranding.primaryColor)
                    }
                  }}
                  className="rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                />
                <Lock className="w-3.5 h-3.5 text-blue-500" />
                <span className="text-xs text-blue-700">Use org brand color ({orgBranding.primaryColor})</span>
                <span className="w-4 h-4 rounded-full border border-blue-200 ml-auto" style={{ backgroundColor: orgBranding.primaryColor }} />
              </label>
            )}
            <div className="flex flex-wrap gap-2 mb-3">
              {COLOR_PRESETS.map(preset => (
                <button
                  key={preset.name}
                  onClick={() => applyPrimaryColor(preset.primary)}
                  className={clsx(
                    'flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-xs',
                    config.colors.primary === preset.primary
                      ? 'border-gray-400 bg-gray-50 font-medium'
                      : 'border-gray-200 hover:border-gray-300'
                  )}
                >
                  <span className="w-3.5 h-3.5 rounded-full shrink-0" style={{ backgroundColor: preset.primary }} />
                  {preset.name}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  value={config.colors.primary}
                  onChange={e => applyPrimaryColor(e.target.value)}
                  className="w-8 h-8 rounded border border-gray-300 cursor-pointer shrink-0"
                />
                <input
                  type="text"
                  value={config.colors.primary}
                  onChange={e => {
                    const v = e.target.value
                    if (/^#[0-9a-fA-F]{6}$/.test(v)) applyPrimaryColor(v)
                    else onChange({ ...config, colors: { ...config.colors, primary: v } })
                  }}
                  className="w-24 px-2 py-1 border border-gray-300 rounded text-xs font-mono"
                />
              </div>
              <div className="flex items-center gap-2">
                {(['secondary', 'accent', 'mutedText'] as const).map(k => (
                  <div key={k} className="flex flex-col items-center">
                    <span className="w-4 h-4 rounded-full border border-gray-200 shrink-0" style={{ backgroundColor: config.colors[k] }} />
                    <span className="text-[9px] text-gray-400 mt-0.5">{k === 'mutedText' ? 'Muted' : k.charAt(0).toUpperCase() + k.slice(1)}</span>
                  </div>
                ))}
              </div>
            </div>
            <button
              onClick={() => scrollToAdvancedSection(colorSystemRef)}
              className="text-[11px] text-primary-600 hover:text-primary-700 mt-2"
            >
              Edit all 6 color tokens in Advanced &darr;
            </button>
          </div>

          {/* Typography */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Typography</label>
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Font Family</label>
                <select
                  value={config.fonts.body.family}
                  onChange={e => {
                    const fam = e.target.value as 'helvetica' | 'times' | 'courier'
                    onChange({
                      ...config,
                      fonts: {
                        title: { ...config.fonts.title, family: fam },
                        heading: { ...config.fonts.heading, family: fam },
                        subheading: { ...config.fonts.subheading, family: fam },
                        body: { ...config.fonts.body, family: fam },
                      }
                    })
                    emitHighlight('body')
                  }}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500"
                >
                  {FONT_FAMILIES.map(f => (
                    <option key={f.value} value={f.value}>{f.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Text Scale</label>
                <div className="flex gap-2">
                  {([
                    { key: 'compact', label: 'Compact' },
                    { key: 'comfortable', label: 'Comfortable' },
                    { key: 'large', label: 'Large' },
                  ] as const).map(s => (
                    <button
                      key={s.key}
                      onClick={() => {
                        const sizes = TYPOGRAPHY_SCALES[s.key]
                        onChange({
                          ...config,
                          fonts: {
                            title: { ...config.fonts.title, size: sizes.title },
                            heading: { ...config.fonts.heading, size: sizes.heading },
                            subheading: { ...config.fonts.subheading, size: sizes.subheading },
                            body: { ...config.fonts.body, size: sizes.body },
                          }
                        })
                        emitHighlight('body')
                      }}
                      className={clsx(
                        'flex-1 px-3 py-1.5 rounded-lg border text-sm transition-colors',
                        currentTypoScale === s.key
                          ? 'border-primary-400 bg-primary-50 text-primary-700 font-medium'
                          : 'border-gray-200 hover:border-gray-300 text-gray-600'
                      )}
                    >
                      {s.label}
                    </button>
                  ))}
                </div>
                {currentTypoScale === null && (
                  <p className="text-[10px] text-gray-400 mt-1">Custom sizes — edit in Advanced</p>
                )}
              </div>
            </div>
            {/* Typography guardrail */}
            {warningFor('title-size') && (
              <p className="text-[10px] text-amber-600 mt-1">{warningFor('title-size')!.message}</p>
            )}
          </div>

          {/* Layout Density */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Layout Density</label>
            <div className="flex gap-2">
              {([
                { key: 'compact' as LayoutDensity, label: 'Compact' },
                { key: 'balanced' as LayoutDensity, label: 'Balanced' },
                { key: 'spacious' as LayoutDensity, label: 'Spacious' },
              ]).map(d => (
                <button
                  key={d.key}
                  onClick={() => {
                    const sp = DENSITY_PRESETS[d.key]
                    onChange({ ...config, spacing: { ...sp } })
                    emitHighlight('body')
                  }}
                  className={clsx(
                    'flex-1 px-3 py-1.5 rounded-lg border text-sm transition-colors',
                    currentDensity === d.key
                      ? 'border-primary-400 bg-primary-50 text-primary-700 font-medium'
                      : 'border-gray-200 hover:border-gray-300 text-gray-600'
                  )}
                >
                  {d.label}
                </button>
              ))}
            </div>
            <div className="flex items-center justify-between mt-1">
              {currentDensity === null ? (
                <p className="text-[11px] text-gray-400">Custom spacing — edit in Advanced below</p>
              ) : (
                <span />
              )}
              <p className="text-[11px] text-gray-400">
                {estimatePages(sectionCount, currentDensity, config.fonts.body.size)}
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* ── Advanced Settings ── */}
      <div className="border border-gray-200 rounded-lg overflow-hidden" ref={advancedRef}>
        <button
          onClick={() => setAdvancedOpen(!advancedOpen)}
          className="w-full flex items-center justify-between px-4 py-2.5 text-left hover:bg-gray-50/80 rounded-lg"
          type="button"
        >
          <div>
            <span className="text-[13px] font-semibold text-gray-800 tracking-tight">Advanced</span>
            <span className="ml-2 text-[11px] text-gray-400">Page geometry, color system, typography, vertical rhythm</span>
          </div>
          <ChevronRight className={clsx('w-4 h-4 text-gray-400 transition-transform', advancedOpen && 'rotate-90')} />
        </button>
        {advancedOpen && (
          <div className="px-4 pb-4 space-y-5 border-t border-gray-100 pt-4">

            {/* ─── Page Geometry ─── */}
            <div className="bg-gray-50/60 rounded-lg p-3.5 space-y-3">
              <h4 className="text-xs font-semibold text-gray-700 uppercase tracking-wider">Page Geometry</h4>

              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Orientation</label>
                <select
                  value={config.orientation}
                  onChange={e => { onChange({ ...config, orientation: e.target.value as any }); emitHighlight('margins') }}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500"
                >
                  <option value="portrait">Portrait</option>
                  <option value="landscape">Landscape</option>
                </select>
                {config.orientation === 'landscape' && (
                  <p className="text-[11px] text-amber-600 mt-1">Landscape applies to all pages in the document.</p>
                )}
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1.5">Margins (mm)</label>
                <div className="grid grid-cols-4 gap-3">
                  {(['top', 'right', 'bottom', 'left'] as const).map(side => {
                    const w = warningFor(`margin-${side}`)
                    return (
                      <div key={side} className="min-w-0">
                        <label className="block text-[10px] text-gray-500 mb-0.5 capitalize">{side}</label>
                        <input
                          type="number"
                          value={config.margins[side]}
                          onChange={e => updateMargins(side, parseInt(e.target.value) || 0)}
                          min={5}
                          max={50}
                          className={clsx(
                            'w-full px-2.5 py-1.5 border rounded-lg text-sm focus:ring-2 focus:ring-primary-500',
                            w ? 'border-amber-400' : 'border-gray-300'
                          )}
                        />
                        {w && <p className="text-[10px] text-amber-600 mt-0.5">{w.message}</p>}
                      </div>
                    )
                  })}
                </div>
              </div>
            </div>

            {/* ─── Color System ─── */}
            <div className="bg-gray-50/60 rounded-lg p-3.5 space-y-3" ref={colorSystemRef}>
              <h4 className="text-xs font-semibold text-gray-700 uppercase tracking-wider">Color System</h4>
              <div className="grid grid-cols-2 gap-x-4 gap-y-3">
                {([
                  { key: 'primary', label: 'Primary' },
                  { key: 'secondary', label: 'Secondary' },
                  { key: 'accent', label: 'Accent' },
                  { key: 'text', label: 'Text' },
                  { key: 'headingText', label: 'Headings' },
                  { key: 'mutedText', label: 'Muted Text' }
                ] as const).map(({ key, label }) => {
                  const cw = warningFor(`color-${key}`)
                  return (
                    <div key={key} className="min-w-0">
                      <div className="flex items-center justify-between mb-1">
                        <label className="text-xs font-medium text-gray-600 truncate">{label}</label>
                        {(key === 'text' || key === 'headingText' || key === 'mutedText' || key === 'primary') && (
                          <ContrastDot fg={config.colors[key]} />
                        )}
                      </div>
                      <div className="flex items-center gap-1.5">
                        <input
                          type="color"
                          value={config.colors[key]}
                          onChange={e => updateColors(key, e.target.value)}
                          className="w-7 h-7 rounded border border-gray-300 cursor-pointer shrink-0"
                        />
                        <input
                          type="text"
                          value={config.colors[key]}
                          onChange={e => updateColors(key, e.target.value)}
                          className="flex-1 min-w-0 px-2 py-1 border border-gray-300 rounded text-xs font-mono"
                        />
                      </div>
                      <p className="text-[10px] text-gray-400 mt-0.5 truncate">{COLOR_USAGE[key]}</p>
                      {cw && <p className="text-[10px] text-amber-600 truncate">{cw.message}</p>}
                    </div>
                  )
                })}
              </div>
            </div>

            {/* ─── Typography System ─── */}
            <div className="bg-gray-50/60 rounded-lg p-3.5 space-y-3">
              <h4 className="text-xs font-semibold text-gray-700 uppercase tracking-wider">Typography System</h4>
              <div className="space-y-3">
                {([
                  { key: 'title', label: 'Title' },
                  { key: 'heading', label: 'Section Headings' },
                  { key: 'subheading', label: 'Field Names' },
                  { key: 'body', label: 'Body Text' }
                ] as const).map(({ key, label }) => {
                  const wField = key === 'body' ? 'body-size' : key === 'heading' ? 'heading-size' : key === 'title' ? 'title-size' : null
                  const w = wField ? warningFor(wField) : null
                  return (
                    <div key={key}>
                      <div className="grid grid-cols-3 gap-3">
                        <div className="min-w-0">
                          <label className="block text-[10px] text-gray-500 mb-0.5 truncate">{label}</label>
                          <select
                            value={config.fonts[key].family}
                            onChange={e => updateFont(key, 'family', e.target.value)}
                            className="w-full px-2 py-1.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500"
                          >
                            {FONT_FAMILIES.map(f => (
                              <option key={f.value} value={f.value}>{f.label}</option>
                            ))}
                          </select>
                        </div>
                        <div className="min-w-0">
                          <label className="block text-[10px] text-gray-500 mb-0.5">Size (pt)</label>
                          <input
                            type="number"
                            value={config.fonts[key].size}
                            onChange={e => updateFont(key, 'size', parseInt(e.target.value) || 10)}
                            min={6}
                            max={72}
                            className={clsx(
                              'w-full px-2 py-1.5 border rounded-lg text-sm focus:ring-2 focus:ring-primary-500',
                              w ? 'border-amber-400' : 'border-gray-300'
                            )}
                          />
                        </div>
                        <div className="min-w-0">
                          <label className="block text-[10px] text-gray-500 mb-0.5">Weight</label>
                          <select
                            value={config.fonts[key].weight}
                            onChange={e => updateFont(key, 'weight', e.target.value)}
                            className="w-full px-2 py-1.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500"
                          >
                            <option value="normal">Normal</option>
                            <option value="bold">Bold</option>
                          </select>
                        </div>
                      </div>
                      {w && <p className="text-[10px] text-amber-600 mt-1">{w.message}</p>}
                    </div>
                  )
                })}
              </div>
            </div>

            {/* ─── Vertical Rhythm ─── */}
            <div className="bg-gray-50/60 rounded-lg p-3.5 space-y-3">
              <h4 className="text-xs font-semibold text-gray-700 uppercase tracking-wider">Vertical Rhythm</h4>
              <div className="grid grid-cols-3 gap-3">
                {([
                  { key: 'sectionGap', label: 'Section Gap', max: 30 },
                  { key: 'fieldGap', label: 'Field Gap', max: 20 },
                  { key: 'paragraphGap', label: 'Paragraph Gap', max: 10 },
                ] as const).map(({ key, label, max }) => {
                  const w = key === 'paragraphGap' ? warningFor('paragraph-gap') : null
                  return (
                    <div key={key} className="min-w-0">
                      <label className="block text-[10px] text-gray-500 mb-0.5 truncate">{label} (mm)</label>
                      <input
                        type="number"
                        value={config.spacing[key]}
                        onChange={e => {
                          onChange({ ...config, spacing: { ...config.spacing, [key]: parseInt(e.target.value) || 0 } })
                          emitHighlight('body')
                        }}
                        min={0}
                        max={max}
                        className={clsx(
                          'w-full px-2 py-1.5 border rounded-lg text-sm focus:ring-2 focus:ring-primary-500',
                          w ? 'border-amber-400' : 'border-gray-300'
                        )}
                      />
                      {w && <p className="text-[10px] text-amber-600 mt-0.5">{w.message}</p>}
                    </div>
                  )
                })}
              </div>
            </div>

            {/* Revert to Professional Baseline */}
            <div className="pt-1">
              <button
                onClick={() => applyPreset(STYLE_PRESETS[0])}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-gray-500 hover:text-gray-700 border border-gray-200 rounded-lg hover:border-gray-300 transition-colors"
              >
                <RotateCcw className="w-3 h-3" />
                Revert to Professional Baseline
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ============================================================================
// Branding Editor
// ============================================================================

const LOGO_SIZE_PRESETS = [
  { key: 'small', label: 'Small', width: 25 },
  { key: 'medium', label: 'Medium', width: 40 },
  { key: 'large', label: 'Large', width: 60 },
] as const

const WATERMARK_PRESETS = ['Draft', 'Confidential', 'Internal Use Only'] as const

const WATERMARK_POSITIONS = [
  { key: 'diagonal' as const, label: 'Diagonal' },
  { key: 'center' as const, label: 'Center' },
  { key: 'footer' as const, label: 'Footer' },
]

interface BrandingEditorProps {
  config: BrandingConfig
  onChange: (config: BrandingConfig) => void
  onLogoUpload: (e: React.ChangeEvent<HTMLInputElement>) => void
  onLogoDelete: () => void
  isUploading: boolean
  isCreateMode?: boolean
  orgBranding?: OrgBrandingData | null
  coverConfig?: CoverPageConfig
  onCoverChange?: (config: CoverPageConfig) => void
  onHighlight?: (area: string | null) => void
  draftLogoPreview?: string | null
  onDraftLogoSelect?: (file: File) => void
  onDraftLogoClear?: () => void
}

function BrandingEditor({ config, onChange, onLogoUpload, onLogoDelete, isUploading, isCreateMode, orgBranding, coverConfig, onCoverChange, onHighlight, draftLogoPreview, onDraftLogoSelect, onDraftLogoClear }: BrandingEditorProps) {
  const useOrg = coverConfig?.useOrgBranding ?? false
  const hasOrgLogo = !!(orgBranding?.logoUrl || orgBranding?.logoPath)
  const hasOrgData = !!(orgBranding?.firmName || hasOrgLogo)
  const [logoError, setLogoError] = useState(false)
  const [customLogoSize, setCustomLogoSize] = useState(false)
  const logoReplaceRef = useRef<HTMLInputElement>(null)

  // Detect active logo size preset
  const activeLogoPreset = !customLogoSize
    ? LOGO_SIZE_PRESETS.find(p => p.width === config.logoWidth && config.logoHeight === null)?.key ?? null
    : null

  const hasLogo = !!(draftLogoPreview || config.logoPath)

  // Override indicator helper
  const OverrideBadge = ({ field, orgValue }: { field: 'logo' | 'firmName' | 'tagline'; orgValue: boolean }) => {
    if (!useOrg) return null
    const hasTemplateValue = field === 'logo'
      ? hasLogo
      : field === 'firmName'
        ? !!config.firmName
        : !!config.tagline
    if (hasTemplateValue) {
      return <span className="text-[10px] px-1.5 py-0.5 bg-primary-50 text-primary-600 rounded-full">Override</span>
    }
    if (orgValue) {
      return <span className="text-[10px] px-1.5 py-0.5 bg-gray-100 text-gray-500 rounded-full">Inherited</span>
    }
    return null
  }

  // Handle Replace logo action
  const handleReplaceLogo = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    if (isCreateMode && onDraftLogoSelect) {
      onDraftLogoSelect(file)
    } else {
      onLogoUpload(e)
    }
    // Reset input so the same file can be re-selected
    e.target.value = ''
  }

  return (
    <div className="space-y-6">
      {/* ── Branding Source Toggle ── */}
      {orgBranding && (
        <div className="space-y-3">
          <div className="flex items-center gap-2 mb-2">
            <Building className="w-4 h-4 text-gray-500" />
            <h3 className="text-sm font-semibold text-gray-800">Branding Source</h3>
          </div>
          <div className="flex rounded-lg border border-gray-200 overflow-hidden">
            <button
              type="button"
              onClick={() => {
                if (onCoverChange && coverConfig) {
                  onCoverChange({ ...coverConfig, useOrgBranding: true, showLogo: true })
                }
              }}
              className={clsx(
                'flex-1 px-3 py-2 text-xs font-medium transition-colors',
                useOrg
                  ? 'bg-primary-50 text-primary-700 border-r border-primary-200'
                  : 'bg-white text-gray-500 hover:bg-gray-50 border-r border-gray-200'
              )}
            >
              Inherit from Organization
            </button>
            <button
              type="button"
              onClick={() => {
                if (onCoverChange && coverConfig) {
                  onCoverChange({ ...coverConfig, useOrgBranding: false })
                }
              }}
              className={clsx(
                'flex-1 px-3 py-2 text-xs font-medium transition-colors',
                !useOrg
                  ? 'bg-primary-50 text-primary-700'
                  : 'bg-white text-gray-500 hover:bg-gray-50'
              )}
            >
              Customize for Template
            </button>
          </div>

          {/* ── Mode-specific banner ── */}
          {useOrg ? (
            <>
              {/* Org branding summary (read-only when inheriting) */}
              <div className="rounded-lg border border-primary-200 bg-primary-50/40 p-3 space-y-2">
                <div className="flex items-center gap-2">
                  <Lock className="w-3.5 h-3.5 text-primary-500" />
                  <span className="text-xs font-medium text-primary-700">Using Organization Branding</span>
                </div>
                {hasOrgData ? (
                  <div className="space-y-1.5 pl-5.5">
                    {hasOrgLogo && (
                      <div className="flex items-center gap-3">
                        <div className="w-20 h-12 bg-white rounded border border-gray-200 flex items-center justify-center overflow-hidden shrink-0">
                          {orgBranding.logoUrl && !logoError ? (
                            <img
                              src={orgBranding.logoUrl}
                              alt="Org logo"
                              className="max-w-full max-h-full object-contain p-1"
                              onError={() => setLogoError(true)}
                            />
                          ) : (
                            <Image className="w-5 h-5 text-gray-300" />
                          )}
                        </div>
                        <p className="text-[11px] text-gray-500">Organization Logo</p>
                      </div>
                    )}
                    {orgBranding.firmName && (
                      <div className="flex items-center gap-2">
                        <span className="text-[11px] font-medium text-gray-500">Firm:</span>
                        <span className="text-[11px] text-gray-700">{orgBranding.firmName}</span>
                      </div>
                    )}
                    {orgBranding.tagline && (
                      <div className="flex items-center gap-2">
                        <span className="text-[11px] font-medium text-gray-500">Tagline:</span>
                        <span className="text-[11px] text-gray-700">{orgBranding.tagline}</span>
                      </div>
                    )}
                    <p className="text-[10px] text-primary-600">
                      Edit in Settings &rarr; Organization. Template overrides below take precedence.
                    </p>
                  </div>
                ) : (
                  <p className="text-[11px] text-gray-400 pl-5.5">
                    No organization branding configured. Set it up in Settings &rarr; Organization.
                  </p>
                )}
              </div>
            </>
          ) : (
            <div className="rounded-lg border border-amber-200 bg-amber-50/40 px-3 py-2 space-y-1">
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-semibold px-1.5 py-0.5 bg-amber-100 text-amber-700 rounded">Template Branding Override</span>
              </div>
              <p className="text-[10px] text-amber-600/80">
                Template-specific branding may reduce cross-template consistency.
              </p>
            </div>
          )}
        </div>
      )}

      {/* Hidden file input for Replace action */}
      <input
        ref={logoReplaceRef}
        type="file"
        accept="image/png,image/jpeg"
        onChange={handleReplaceLogo}
        className="hidden"
      />

      {/* ── Firm Logo ── */}
      <div className={clsx(useOrg && 'opacity-60')}>
        <h3
          className="text-sm font-semibold text-gray-800 mb-1 flex items-center gap-2"
          onMouseEnter={() => onHighlight?.('logo')}
          onMouseLeave={() => onHighlight?.(null)}
        >
          {useOrg ? 'Template Logo Override' : 'Firm Logo'}
          <OverrideBadge field="logo" orgValue={hasOrgLogo} />
        </h3>
        {useOrg && orgBranding?.logoUrl && (
          <p className="text-[11px] text-gray-400 mb-3">Org logo is active. Upload here only if you need a different logo for this template.</p>
        )}

        <div className="space-y-4">
          {/* Draft logo preview (create mode with pending file) */}
          {draftLogoPreview ? (
            <div className="flex items-center gap-3 p-3 border border-gray-200 rounded-lg">
              <div className="w-14 h-14 bg-gray-100 rounded flex items-center justify-center shrink-0 overflow-hidden">
                <img src={draftLogoPreview} alt="Draft logo" className="max-w-full max-h-full object-contain" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm text-gray-600">Logo selected</p>
                <p className="text-xs text-gray-400">Will be uploaded on save</p>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <button
                  onClick={() => logoReplaceRef.current?.click()}
                  className="p-2 text-gray-500 hover:bg-gray-100 rounded-lg"
                  title="Replace logo"
                >
                  <RefreshCw className="w-4 h-4" />
                </button>
                <button
                  onClick={onDraftLogoClear}
                  className="p-2 text-red-500 hover:bg-red-50 rounded-lg"
                  title="Remove logo"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>
          ) : config.logoPath ? (
            <div className="flex items-center gap-3 p-3 border border-gray-200 rounded-lg">
              <div className="w-14 h-14 bg-gray-100 rounded flex items-center justify-center shrink-0">
                <Image className="w-6 h-6 text-gray-400" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm text-gray-600">Logo uploaded</p>
                <p className="text-xs text-gray-400 truncate">{config.logoPath}</p>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <button
                  onClick={() => logoReplaceRef.current?.click()}
                  className="p-2 text-gray-500 hover:bg-gray-100 rounded-lg"
                  title="Replace logo"
                >
                  <RefreshCw className="w-4 h-4" />
                </button>
                <button
                  onClick={onLogoDelete}
                  className="p-2 text-red-500 hover:bg-red-50 rounded-lg"
                  title="Remove logo"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>
          ) : (
            <label className="flex flex-col items-center justify-center p-6 border-2 border-dashed border-gray-300 rounded-lg hover:border-gray-400 cursor-pointer">
              {isUploading ? (
                <Loader2 className="w-6 h-6 text-gray-400 animate-spin" />
              ) : (
                <>
                  <Upload className="w-6 h-6 text-gray-400 mb-1" />
                  <span className="text-sm text-gray-600">Click to upload logo</span>
                  <span className="text-xs text-gray-400 mt-0.5">PNG, JPG up to 2MB</span>
                </>
              )}
              <input
                type="file"
                accept="image/png,image/jpeg"
                onChange={e => {
                  const file = e.target.files?.[0]
                  if (!file) return
                  if (isCreateMode && onDraftLogoSelect) {
                    onDraftLogoSelect(file)
                  } else {
                    onLogoUpload(e)
                  }
                }}
                className="hidden"
                disabled={isUploading}
              />
            </label>
          )}

          {/* Logo Size Presets */}
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1.5">Logo Size</label>
            <div className="flex gap-1.5">
              {LOGO_SIZE_PRESETS.map(preset => (
                <button
                  key={preset.key}
                  type="button"
                  onClick={() => {
                    setCustomLogoSize(false)
                    onChange({ ...config, logoWidth: preset.width, logoHeight: null })
                  }}
                  className={clsx(
                    'px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors',
                    activeLogoPreset === preset.key && !customLogoSize
                      ? 'bg-primary-50 border-primary-300 text-primary-700'
                      : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50'
                  )}
                >
                  {preset.label}
                </button>
              ))}
              <button
                type="button"
                onClick={() => setCustomLogoSize(true)}
                className={clsx(
                  'px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors',
                  customLogoSize || (!activeLogoPreset && !customLogoSize)
                    ? 'bg-primary-50 border-primary-300 text-primary-700'
                    : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50'
                )}
              >
                Custom
              </button>
            </div>

            {/* Custom size inputs */}
            {(customLogoSize || !activeLogoPreset) && (
              <div className="grid grid-cols-2 gap-3 mt-2">
                <div>
                  <label className="block text-[11px] text-gray-500 mb-0.5">Width (mm)</label>
                  <input
                    type="number"
                    value={config.logoWidth}
                    onChange={e => {
                      const v = parseInt(e.target.value) || 40
                      onChange({ ...config, logoWidth: Math.max(10, Math.min(100, v)) })
                    }}
                    min={10}
                    max={100}
                    className="w-full px-2.5 py-1.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500"
                  />
                </div>
                <div>
                  <label className="block text-[11px] text-gray-500 mb-0.5">Height (mm)</label>
                  <input
                    type="number"
                    value={config.logoHeight || ''}
                    onChange={e => {
                      const raw = e.target.value ? parseInt(e.target.value) : null
                      onChange({ ...config, logoHeight: raw ? Math.max(10, Math.min(100, raw)) : null })
                    }}
                    placeholder="Auto"
                    min={10}
                    max={100}
                    className="w-full px-2.5 py-1.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500"
                  />
                </div>
              </div>
            )}

            {/* Large logo warning */}
            {config.logoWidth > 60 && (
              <p className="text-[11px] text-amber-600 mt-1.5">Large logos may overlap content</p>
            )}
          </div>
        </div>
      </div>

      {/* ── Firm Information ── */}
      <div className={clsx('border-t border-gray-200 pt-6', useOrg && 'opacity-60')}>
        <h3
          className="text-sm font-semibold text-gray-800 mb-1"
          onMouseEnter={() => onHighlight?.('firmName')}
          onMouseLeave={() => onHighlight?.(null)}
        >
          {useOrg ? 'Template Overrides' : 'Firm Information'}
        </h3>

        <div className="space-y-4">
          <div>
            <label className="flex items-center gap-2 text-sm font-medium text-gray-700 mb-1">
              Firm Name
              <OverrideBadge field="firmName" orgValue={!!orgBranding?.firmName} />
            </label>
            <input
              type="text"
              value={config.firmName || ''}
              onChange={e => onChange({ ...config, firmName: e.target.value || null })}
              placeholder={useOrg && orgBranding?.firmName ? orgBranding.firmName : 'e.g., Acme Capital Partners'}
              className={clsx(
                'w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-primary-500',
                useOrg && orgBranding?.firmName && !config.firmName ? 'border-gray-200 bg-gray-50 text-gray-400' : 'border-gray-300'
              )}
            />
          </div>

          <div>
            <label className="flex items-center gap-2 text-sm font-medium text-gray-700 mb-1">
              Tagline
              <OverrideBadge field="tagline" orgValue={!!orgBranding?.tagline} />
            </label>
            <input
              type="text"
              value={config.tagline || ''}
              onChange={e => onChange({ ...config, tagline: e.target.value || null })}
              placeholder={useOrg && orgBranding?.tagline ? orgBranding.tagline : 'e.g., Investing in Tomorrow\'s Leaders'}
              className={clsx(
                'w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-primary-500',
                useOrg && orgBranding?.tagline && !config.tagline ? 'border-gray-200 bg-gray-50 text-gray-400' : 'border-gray-300'
              )}
            />
          </div>
        </div>
      </div>

      {/* ── Watermark ── */}
      <div className={clsx('border-t border-gray-200 pt-6', useOrg && 'opacity-60')}>
        <h3
          className="text-sm font-semibold text-gray-800 mb-4"
          onMouseEnter={() => onHighlight?.('watermark')}
          onMouseLeave={() => onHighlight?.(null)}
        >
          Watermark
        </h3>

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
              {/* Watermark text presets */}
              <div className="flex flex-wrap gap-1.5">
                {WATERMARK_PRESETS.map(preset => (
                  <button
                    key={preset}
                    type="button"
                    onClick={() => onChange({ ...config, watermarkText: preset })}
                    className={clsx(
                      'text-xs px-2.5 py-1 rounded-full border transition-colors',
                      config.watermarkText === preset
                        ? 'bg-primary-50 border-primary-300 text-primary-700'
                        : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50'
                    )}
                  >
                    {preset}
                  </button>
                ))}
              </div>

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

              {/* Watermark Position */}
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1.5">Position</label>
                <div className="flex gap-1.5">
                  {WATERMARK_POSITIONS.map(pos => (
                    <button
                      key={pos.key}
                      type="button"
                      onClick={() => onChange({ ...config, watermarkPosition: pos.key })}
                      className={clsx(
                        'px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors',
                        (config.watermarkPosition || 'diagonal') === pos.key
                          ? 'bg-primary-50 border-primary-300 text-primary-700'
                          : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50'
                      )}
                    >
                      {pos.label}
                    </button>
                  ))}
                </div>
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

const HEADER_PRESETS = [
  { label: 'Confidential', content: 'CONFIDENTIAL' },
  { label: 'Internal Draft', content: 'INTERNAL DRAFT' },
  { label: 'Investment Committee', content: 'Investment Committee Materials' },
] as const

const FOOTER_PRESETS = [
  { label: 'Internal Use', content: 'For Internal Use Only' },
  { label: 'Draft', content: 'Draft \u2013 Not for Distribution' },
  { label: 'Analyst', content: 'Prepared by {{author}}' },
] as const

const ALIGNMENT_OPTIONS: { key: HFAlignment; label: string; icon: typeof AlignLeft }[] = [
  { key: 'left', label: 'Left', icon: AlignLeft },
  { key: 'center', label: 'Center', icon: AlignCenter },
  { key: 'right', label: 'Right', icon: AlignRight },
  { key: 'split', label: 'Split', icon: Columns },
]

const COVER_BEHAVIOR_OPTIONS: { key: CoverBehavior; label: string }[] = [
  { key: 'hide', label: 'Hide on cover' },
  { key: 'same', label: 'Same as body' },
  { key: 'custom', label: 'Custom' },
]

const PAGE_NUMBER_POSITIONS: { key: PageNumberPosition; label: string }[] = [
  { key: 'left', label: 'Left' },
  { key: 'center', label: 'Center' },
  { key: 'right', label: 'Right' },
  { key: 'inline', label: 'Inline' },
]

// Insert Variable button + dropdown for a text input
function InsertVariableButton({ inputRef, onInsert }: { inputRef: React.RefObject<HTMLInputElement | null>; onInsert: (token: string) => void }) {
  const [open, setOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  return (
    <div className="relative" ref={menuRef}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1 px-2 py-1 text-[11px] font-medium text-primary-600 hover:bg-primary-50 rounded transition-colors"
      >
        <Plus className="w-3 h-3" />
        Insert Variable
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 w-44 bg-white border border-gray-200 rounded-lg shadow-lg py-1 z-20">
          {HF_VARIABLES.map(v => (
            <button
              key={v.key}
              type="button"
              onClick={() => {
                onInsert(v.key)
                setOpen(false)
              }}
              className="w-full text-left px-3 py-1.5 text-xs text-gray-700 hover:bg-gray-50 flex justify-between items-center"
            >
              <span>{v.label}</span>
              <span className="text-[10px] text-gray-400 font-mono">{v.key}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

interface HeaderFooterEditorProps {
  config: HeaderFooterConfig
  onChange: (config: HeaderFooterConfig) => void
  onHighlight?: (area: string | null) => void
}

function HeaderFooterEditor({ config, onChange, onHighlight }: HeaderFooterEditorProps) {
  const headerContentRef = useRef<HTMLInputElement>(null)
  const headerLeftRef = useRef<HTMLInputElement>(null)
  const headerRightRef = useRef<HTMLInputElement>(null)
  const footerContentRef = useRef<HTMLInputElement>(null)
  const footerLeftRef = useRef<HTMLInputElement>(null)
  const footerRightRef = useRef<HTMLInputElement>(null)

  const updateHeader = (updates: Partial<HeaderFooterConfig['header']>) => {
    onChange({ ...config, header: { ...config.header, ...updates } })
    onHighlight?.('header')
  }

  const updateFooter = (updates: Partial<HeaderFooterConfig['footer']>) => {
    onChange({ ...config, footer: { ...config.footer, ...updates } })
    onHighlight?.('footer')
  }

  // Insert token at cursor position (or end) in a given input
  const insertAtCursor = (ref: React.RefObject<HTMLInputElement | null>, currentValue: string | null, setter: (val: string) => void, token: string) => {
    const input = ref.current
    const val = currentValue || ''
    if (input) {
      const start = input.selectionStart ?? val.length
      const end = input.selectionEnd ?? val.length
      const newVal = val.slice(0, start) + token + val.slice(end)
      setter(newVal)
      // Restore cursor after the inserted token
      requestAnimationFrame(() => {
        input.focus()
        const pos = start + token.length
        input.setSelectionRange(pos, pos)
      })
    } else {
      setter(val + token)
    }
  }

  const hAlign = config.header.alignment || 'center'
  const fAlign = config.footer.alignment || 'center'
  const hCover = config.header.coverBehavior || 'hide'
  const pnPos = config.footer.pageNumberPosition || 'center'

  return (
    <div className="space-y-6">
      {/* ── Header ── */}
      <div>
        <h3
          className="text-sm font-semibold text-gray-800 mb-4"
          onMouseEnter={() => onHighlight?.('header')}
          onMouseLeave={() => onHighlight?.(null)}
        >
          Header
        </h3>

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
              {/* Quick presets */}
              <div>
                <label className="block text-[11px] font-medium text-gray-500 mb-1.5">Quick Presets</label>
                <div className="flex flex-wrap gap-1.5">
                  {HEADER_PRESETS.map(p => (
                    <button
                      key={p.label}
                      type="button"
                      onClick={() => updateHeader({ content: p.content })}
                      className={clsx(
                        'text-xs px-2.5 py-1 rounded-full border transition-colors',
                        config.header.content === p.content
                          ? 'bg-primary-50 border-primary-300 text-primary-700'
                          : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50'
                      )}
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Alignment */}
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1.5">Layout</label>
                <div className="flex gap-1">
                  {ALIGNMENT_OPTIONS.map(opt => (
                    <button
                      key={opt.key}
                      type="button"
                      onClick={() => updateHeader({ alignment: opt.key })}
                      className={clsx(
                        'flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium rounded-lg border transition-colors',
                        hAlign === opt.key
                          ? 'bg-primary-50 border-primary-300 text-primary-700'
                          : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50'
                      )}
                      title={opt.label}
                    >
                      <opt.icon className="w-3.5 h-3.5" />
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Content inputs */}
              {hAlign === 'split' ? (
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <label className="text-xs font-medium text-gray-600">Left Content</label>
                      <InsertVariableButton
                        inputRef={headerLeftRef}
                        onInsert={token => insertAtCursor(headerLeftRef, config.header.leftContent, v => updateHeader({ leftContent: v || null }), token)}
                      />
                    </div>
                    <input
                      ref={headerLeftRef}
                      type="text"
                      value={config.header.leftContent || ''}
                      onChange={e => updateHeader({ leftContent: e.target.value || null })}
                      placeholder="e.g., {{firm_name}}"
                      className="w-full px-2.5 py-1.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500"
                    />
                  </div>
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <label className="text-xs font-medium text-gray-600">Right Content</label>
                      <InsertVariableButton
                        inputRef={headerRightRef}
                        onInsert={token => insertAtCursor(headerRightRef, config.header.rightContent, v => updateHeader({ rightContent: v || null }), token)}
                      />
                    </div>
                    <input
                      ref={headerRightRef}
                      type="text"
                      value={config.header.rightContent || ''}
                      onChange={e => updateHeader({ rightContent: e.target.value || null })}
                      placeholder="e.g., {{as_of_date}}"
                      className="w-full px-2.5 py-1.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500"
                    />
                  </div>
                </div>
              ) : (
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="text-sm font-medium text-gray-700">Header Content</label>
                    <InsertVariableButton
                      inputRef={headerContentRef}
                      onInsert={token => insertAtCursor(headerContentRef, config.header.content, v => updateHeader({ content: v || null }), token)}
                    />
                  </div>
                  <input
                    ref={headerContentRef}
                    type="text"
                    value={config.header.content || ''}
                    onChange={e => updateHeader({ content: e.target.value || null })}
                    placeholder="e.g., {{firm_name}} - Confidential"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500"
                  />
                </div>
              )}

              {/* Cover behavior */}
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1.5">Cover Behavior</label>
                <div className="flex gap-1.5">
                  {COVER_BEHAVIOR_OPTIONS.map(opt => (
                    <button
                      key={opt.key}
                      type="button"
                      onClick={() => updateHeader({
                        coverBehavior: opt.key,
                        showOnFirstPage: opt.key !== 'hide'
                      })}
                      className={clsx(
                        'px-2.5 py-1.5 text-xs font-medium rounded-lg border transition-colors',
                        hCover === opt.key
                          ? 'bg-primary-50 border-primary-300 text-primary-700'
                          : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50',
                        opt.key === 'custom' && 'opacity-50 cursor-not-allowed'
                      )}
                      disabled={opt.key === 'custom'}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>

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

      {/* ── Footer ── */}
      <div className="border-t border-gray-200 pt-6">
        <h3
          className="text-sm font-semibold text-gray-800 mb-4"
          onMouseEnter={() => onHighlight?.('footer')}
          onMouseLeave={() => onHighlight?.(null)}
        >
          Footer
        </h3>

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
              {/* Quick presets */}
              <div>
                <label className="block text-[11px] font-medium text-gray-500 mb-1.5">Quick Presets</label>
                <div className="flex flex-wrap gap-1.5">
                  {FOOTER_PRESETS.map(p => (
                    <button
                      key={p.label}
                      type="button"
                      onClick={() => updateFooter({ content: p.content })}
                      className={clsx(
                        'text-xs px-2.5 py-1 rounded-full border transition-colors',
                        config.footer.content === p.content
                          ? 'bg-primary-50 border-primary-300 text-primary-700'
                          : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50'
                      )}
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Alignment */}
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1.5">Layout</label>
                <div className="flex gap-1">
                  {ALIGNMENT_OPTIONS.map(opt => (
                    <button
                      key={opt.key}
                      type="button"
                      onClick={() => updateFooter({ alignment: opt.key })}
                      className={clsx(
                        'flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium rounded-lg border transition-colors',
                        fAlign === opt.key
                          ? 'bg-primary-50 border-primary-300 text-primary-700'
                          : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50'
                      )}
                      title={opt.label}
                    >
                      <opt.icon className="w-3.5 h-3.5" />
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Content inputs */}
              {fAlign === 'split' ? (
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <label className="text-xs font-medium text-gray-600">Left Content</label>
                      <InsertVariableButton
                        inputRef={footerLeftRef}
                        onInsert={token => insertAtCursor(footerLeftRef, config.footer.leftContent, v => updateFooter({ leftContent: v || null }), token)}
                      />
                    </div>
                    <input
                      ref={footerLeftRef}
                      type="text"
                      value={config.footer.leftContent || ''}
                      onChange={e => updateFooter({ leftContent: e.target.value || null })}
                      placeholder="e.g., For internal use only"
                      className="w-full px-2.5 py-1.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500"
                    />
                  </div>
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <label className="text-xs font-medium text-gray-600">Right Content</label>
                      <InsertVariableButton
                        inputRef={footerRightRef}
                        onInsert={token => insertAtCursor(footerRightRef, config.footer.rightContent, v => updateFooter({ rightContent: v || null }), token)}
                      />
                    </div>
                    <input
                      ref={footerRightRef}
                      type="text"
                      value={config.footer.rightContent || ''}
                      onChange={e => updateFooter({ rightContent: e.target.value || null })}
                      placeholder="e.g., Page {page} of {total}"
                      className="w-full px-2.5 py-1.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500"
                    />
                  </div>
                </div>
              ) : (
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="text-sm font-medium text-gray-700">Footer Content</label>
                    <InsertVariableButton
                      inputRef={footerContentRef}
                      onInsert={token => insertAtCursor(footerContentRef, config.footer.content, v => updateFooter({ content: v || null }), token)}
                    />
                  </div>
                  <input
                    ref={footerContentRef}
                    type="text"
                    value={config.footer.content || ''}
                    onChange={e => updateFooter({ content: e.target.value || null })}
                    placeholder="e.g., For internal use only"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500"
                  />
                </div>
              )}

              {/* Page number */}
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
                <>
                  {/* Page number position */}
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1.5">Page Number Position</label>
                    <div className="flex gap-1.5">
                      {PAGE_NUMBER_POSITIONS.map(opt => (
                        <button
                          key={opt.key}
                          type="button"
                          onClick={() => updateFooter({ pageNumberPosition: opt.key })}
                          className={clsx(
                            'px-2.5 py-1.5 text-xs font-medium rounded-lg border transition-colors',
                            pnPos === opt.key
                              ? 'bg-primary-50 border-primary-300 text-primary-700'
                              : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50'
                          )}
                        >
                          {opt.label}
                        </button>
                      ))}
                    </div>
                    {pnPos === 'inline' && (
                      <p className="text-[11px] text-gray-400 mt-1">
                        Page number renders inline with content. Use {'{page}'} and {'{total}'} tokens in the content field for manual placement.
                      </p>
                    )}
                  </div>

                  {/* Page number format */}
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
                    <p className="text-[11px] text-gray-400 mt-1">
                      Use {'{page}'} for current page and {'{total}'} for total pages
                    </p>
                  </div>
                </>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
