import { useState, useCallback, useMemo, useEffect } from 'react'
import { clsx } from 'clsx'
import {
  FileText,
  Download,
  Eye,
  EyeOff,
  GripVertical,
  ChevronDown,
  ChevronRight,
  Loader2,
  CheckSquare,
  Square,
  Settings,
  Calendar,
  User,
  Building,
  TrendingUp,
  Target,
  FileStack,
  AlertCircle,
  X
} from 'lucide-react'
import { Card } from '../ui/Card'
import { Button } from '../ui/Button'
import { useUserAssetPagePreferences } from '../../hooks/useUserAssetPagePreferences'
import { useContributions } from '../../hooks/useContributions'
import { useInvestmentCaseTemplates } from '../../hooks/useInvestmentCaseTemplates'
import { InvestmentCaseTemplateSelector } from '../investment-case-templates'
import { InvestmentCaseTemplate, CoverPageConfig, DEFAULT_STYLE_CONFIG, DEFAULT_COVER_CONFIG, DEFAULT_HEADER_FOOTER_CONFIG, DEFAULT_TOC_CONFIG } from '../../types/investmentCaseTemplates'
import jsPDF from 'jspdf'

// ============================================================================
// TYPES
// ============================================================================

interface InvestmentCaseBuilderProps {
  assetId: string
  symbol: string
  companyName?: string
  currentPrice?: number
  onClose?: () => void
}

interface SectionConfig {
  id: string
  name: string
  enabled: boolean
  order: number
  fields?: FieldConfig[]
}

interface FieldConfig {
  id: string
  name: string
  slug: string
  enabled: boolean
  fieldType: string
}

// ============================================================================
// MAIN COMPONENT
// ============================================================================

export function InvestmentCaseBuilder({
  assetId,
  symbol,
  companyName,
  currentPrice,
  onClose
}: InvestmentCaseBuilderProps) {
  // Use the user's actual layout preferences for this asset
  const { displayedFieldsBySection, isLoading } = useUserAssetPagePreferences(assetId)
  const { contributions } = useContributions(assetId)
  const { recordUsage, getLogoUrl, defaultTemplate } = useInvestmentCaseTemplates()

  const [isGenerating, setIsGenerating] = useState(false)
  const [showPreview, setShowPreview] = useState(false)
  const [selectedTemplate, setSelectedTemplate] = useState<InvestmentCaseTemplate | null>(null)
  const [coverConfig, setCoverConfig] = useState<CoverPageConfig>(DEFAULT_COVER_CONFIG)
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set())
  const [logoDataUrl, setLogoDataUrl] = useState<string | null>(null)

  // Load logo when template changes
  useEffect(() => {
    if (selectedTemplate?.branding_config.logoPath) {
      getLogoUrl(selectedTemplate.branding_config.logoPath).then(url => {
        if (url) {
          // Convert to data URL for jsPDF
          fetch(url)
            .then(r => r.blob())
            .then(blob => {
              const reader = new FileReader()
              reader.onloadend = () => setLogoDataUrl(reader.result as string)
              reader.readAsDataURL(blob)
            })
            .catch(() => setLogoDataUrl(null))
        }
      }).catch(() => setLogoDataUrl(null))
    } else {
      setLogoDataUrl(null)
    }
  }, [selectedTemplate?.branding_config.logoPath, getLogoUrl])

  // Build section configurations from user's layout (only visible fields)
  const [sectionConfigs, setSectionConfigs] = useState<SectionConfig[]>(() =>
    displayedFieldsBySection
      .filter(section => section.fields.some(f => f.is_visible))
      .map((section, index) => ({
        id: section.section_id,
        name: section.section_name,
        enabled: true,
        order: index,
        fields: section.fields
          .filter(f => f.is_visible)
          .map(f => ({
            id: f.field_id,
            name: f.field_name,
            slug: f.field_slug,
            enabled: true,
            fieldType: f.field_type
          }))
      }))
  )

  // Update configs when layout loads
  useMemo(() => {
    if (displayedFieldsBySection.length > 0 && sectionConfigs.length === 0) {
      setSectionConfigs(
        displayedFieldsBySection
          .filter(section => section.fields.some(f => f.is_visible))
          .map((section, index) => ({
            id: section.section_id,
            name: section.section_name,
            enabled: true,
            order: index,
            fields: section.fields
              .filter(f => f.is_visible)
              .map(f => ({
                id: f.field_id,
                name: f.field_name,
                slug: f.field_slug,
                enabled: true,
                fieldType: f.field_type
              }))
          }))
      )
    }
  }, [displayedFieldsBySection])

  const toggleSection = (sectionId: string) => {
    setExpandedSections(prev => {
      const next = new Set(prev)
      if (next.has(sectionId)) next.delete(sectionId)
      else next.add(sectionId)
      return next
    })
  }

  const toggleSectionEnabled = (sectionId: string) => {
    setSectionConfigs(prev =>
      prev.map(s => s.id === sectionId ? { ...s, enabled: !s.enabled } : s)
    )
  }

  const toggleFieldEnabled = (sectionId: string, fieldId: string) => {
    setSectionConfigs(prev =>
      prev.map(s =>
        s.id === sectionId
          ? {
              ...s,
              fields: s.fields?.map(f =>
                f.id === fieldId ? { ...f, enabled: !f.enabled } : f
              )
            }
          : s
      )
    )
  }

  const enabledSections = sectionConfigs.filter(s => s.enabled)
  const totalEnabledFields = enabledSections.reduce(
    (acc, s) => acc + (s.fields?.filter(f => f.enabled).length || 0),
    0
  )

  // Generate PDF
  const generatePDF = useCallback(async () => {
    setIsGenerating(true)

    try {
      // Get template configs (use defaults if no template selected)
      const template = selectedTemplate
      const styleConfig = template?.style_config || DEFAULT_STYLE_CONFIG
      const coverCfg = template?.cover_config || coverConfig
      const brandingConfig = template?.branding_config
      const headerFooterConfig = template?.header_footer_config || DEFAULT_HEADER_FOOTER_CONFIG
      const tocConfig = template?.toc_config || DEFAULT_TOC_CONFIG

      // Convert hex color to RGB
      const hexToRgb = (hex: string) => {
        const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex)
        return result ? {
          r: parseInt(result[1], 16),
          g: parseInt(result[2], 16),
          b: parseInt(result[3], 16)
        } : { r: 0, g: 0, b: 0 }
      }

      const pdf = new jsPDF({
        orientation: styleConfig.orientation,
        unit: 'mm',
        format: styleConfig.pageFormat
      })

      const pageWidth = pdf.internal.pageSize.getWidth()
      const pageHeight = pdf.internal.pageSize.getHeight()
      const margins = styleConfig.margins
      const contentWidth = pageWidth - margins.left - margins.right
      let yOffset = margins.top
      let currentPage = 1

      // Colors
      const colors = styleConfig.colors
      const primaryRgb = hexToRgb(colors.primary)
      const textRgb = hexToRgb(colors.text)
      const headingRgb = hexToRgb(colors.headingText)
      const mutedRgb = hexToRgb(colors.mutedText)
      const secondaryRgb = hexToRgb(colors.secondary)

      // Helper to add header
      const addHeader = (isFirstPage: boolean) => {
        if (headerFooterConfig.header.enabled && (!isFirstPage || headerFooterConfig.header.showOnFirstPage)) {
          pdf.setFontSize(8)
          pdf.setFont(styleConfig.fonts.body.family, 'normal')
          pdf.setTextColor(mutedRgb.r, mutedRgb.g, mutedRgb.b)

          let headerText = headerFooterConfig.header.content || ''
          headerText = headerText.replace('{{firmName}}', brandingConfig?.firmName || '')
          headerText = headerText.replace('{{symbol}}', symbol)
          headerText = headerText.replace('{{date}}', new Date().toLocaleDateString())

          if (headerText) {
            pdf.text(headerText, pageWidth / 2, 10, { align: 'center' })
          }
          if (headerFooterConfig.header.showPageNumber) {
            pdf.text(`Page ${currentPage}`, pageWidth - margins.right, 10, { align: 'right' })
          }
        }
      }

      // Helper to add footer
      const addFooter = () => {
        if (headerFooterConfig.footer.enabled) {
          pdf.setFontSize(8)
          pdf.setFont(styleConfig.fonts.body.family, 'normal')
          pdf.setTextColor(mutedRgb.r, mutedRgb.g, mutedRgb.b)

          const footerY = pageHeight - 10

          if (headerFooterConfig.footer.content) {
            pdf.text(headerFooterConfig.footer.content, margins.left, footerY)
          }

          if (headerFooterConfig.footer.showPageNumber) {
            const pageText = headerFooterConfig.footer.pageNumberFormat
              .replace('{page}', String(currentPage))
              .replace('{total}', '?') // Will be updated later if possible
            pdf.text(pageText, pageWidth - margins.right, footerY, { align: 'right' })
          }
        }
      }

      // Helper to add a new page if needed
      const checkNewPage = (requiredHeight: number) => {
        const footerSpace = headerFooterConfig.footer.enabled ? 15 : 0
        if (yOffset + requiredHeight > pageHeight - margins.bottom - footerSpace) {
          addFooter()
          pdf.addPage()
          currentPage++
          yOffset = margins.top + (headerFooterConfig.header.enabled ? 10 : 0)
          addHeader(false)
          return true
        }
        return false
      }

      // Helper to add text with wrapping
      const addWrappedText = (text: string, fontSize: number, fontWeight: 'normal' | 'bold' = 'normal') => {
        pdf.setFontSize(fontSize)
        pdf.setFont(styleConfig.fonts.body.family, fontWeight)
        const lines = pdf.splitTextToSize(text, contentWidth)
        const lineHeight = fontSize * 0.4

        for (const line of lines) {
          checkNewPage(lineHeight + 2)
          pdf.text(line, margins.left, yOffset)
          yOffset += lineHeight + styleConfig.spacing.paragraphGap
        }
        yOffset += styleConfig.spacing.paragraphGap
      }

      // ========== COVER PAGE ==========
      addHeader(true)

      // Add logo if available
      if (coverCfg.showLogo && logoDataUrl && brandingConfig) {
        try {
          const logoX = coverCfg.logoPosition.includes('left') ? margins.left :
                       coverCfg.logoPosition.includes('right') ? pageWidth - margins.right - brandingConfig.logoWidth :
                       (pageWidth - brandingConfig.logoWidth) / 2
          const logoY = coverCfg.logoPosition.includes('top') ? margins.top + 5 :
                       pageHeight - margins.bottom - (brandingConfig.logoHeight || 20) - 20

          pdf.addImage(logoDataUrl, 'PNG', logoX, logoY, brandingConfig.logoWidth, brandingConfig.logoHeight || brandingConfig.logoWidth * 0.5)
        } catch (e) {
          console.error('Failed to add logo:', e)
        }
      }

      // Title
      yOffset = 60
      const fonts = styleConfig.fonts
      pdf.setFontSize(fonts.title.size)
      pdf.setFont(fonts.title.family, fonts.title.weight)
      pdf.setTextColor(headingRgb.r, headingRgb.g, headingRgb.b)

      const title = coverCfg.customTitle || `Investment Case: ${symbol}`
      const titleAlign = coverCfg.titlePosition === 'left' ? 'left' : coverCfg.titlePosition === 'right' ? 'right' : 'center'
      const titleX = titleAlign === 'left' ? margins.left : titleAlign === 'right' ? pageWidth - margins.right : pageWidth / 2
      pdf.text(title, titleX, yOffset, { align: titleAlign })
      yOffset += 15

      // Company Name
      if (coverCfg.showCompanyName && companyName) {
        pdf.setFontSize(fonts.heading.size)
        pdf.setFont(fonts.heading.family, 'normal')
        pdf.setTextColor(secondaryRgb.r, secondaryRgb.g, secondaryRgb.b)
        pdf.text(companyName, titleX, yOffset, { align: titleAlign })
        yOffset += 10
      }

      // Current Price
      if (coverCfg.showCurrentPrice && currentPrice) {
        pdf.setFontSize(fonts.subheading.size)
        pdf.text(`Current Price: $${currentPrice.toFixed(2)}`, titleX, yOffset + 10, { align: titleAlign })
        yOffset += 20
      }

      // Metadata
      yOffset = pageHeight - 60
      pdf.setFontSize(10)
      pdf.setTextColor(mutedRgb.r, mutedRgb.g, mutedRgb.b)

      if (coverCfg.includeDate) {
        const dateStr = new Date().toLocaleDateString('en-US', {
          year: 'numeric',
          month: 'long',
          day: 'numeric'
        })
        pdf.text(`Generated: ${dateStr}`, pageWidth / 2, yOffset, { align: 'center' })
        yOffset += 6
      }

      if (coverCfg.includeAuthor) {
        const authorText = brandingConfig?.firmName
          ? `Prepared by ${brandingConfig.firmName}`
          : 'Prepared using Tesseract Research Platform'
        pdf.text(authorText, pageWidth / 2, yOffset, { align: 'center' })
        yOffset += 6
      }

      // Disclaimer
      if (coverCfg.includeDisclaimer) {
        yOffset = pageHeight - 30
        pdf.setFontSize(8)
        pdf.setTextColor(mutedRgb.r, mutedRgb.g, mutedRgb.b)
        const disclaimerLines = pdf.splitTextToSize(coverCfg.disclaimerText, contentWidth)
        for (const line of disclaimerLines) {
          pdf.text(line, pageWidth / 2, yOffset, { align: 'center' })
          yOffset += 4
        }
      }

      // Watermark on cover
      if (brandingConfig?.watermarkEnabled && brandingConfig.watermarkText) {
        pdf.setFontSize(48)
        pdf.setTextColor(200, 200, 200)
        pdf.setGState(new pdf.GState({ opacity: brandingConfig.watermarkOpacity }))
        pdf.text(brandingConfig.watermarkText, pageWidth / 2, pageHeight / 2, {
          align: 'center',
          angle: 45
        })
        pdf.setGState(new pdf.GState({ opacity: 1 }))
      }

      addFooter()

      // ========== TABLE OF CONTENTS (if enabled) ==========
      if (tocConfig.enabled) {
        pdf.addPage()
        currentPage++
        yOffset = margins.top + (headerFooterConfig.header.enabled ? 10 : 0)
        addHeader(false)

        pdf.setFontSize(fonts.heading.size)
        pdf.setFont(fonts.heading.family, fonts.heading.weight)
        pdf.setTextColor(headingRgb.r, headingRgb.g, headingRgb.b)
        pdf.text(tocConfig.title, margins.left, yOffset)
        yOffset += 12

        pdf.setFontSize(fonts.body.size + 1)
        pdf.setFont(fonts.body.family, 'normal')
        pdf.setTextColor(textRgb.r, textRgb.g, textRgb.b)
        enabledSections.forEach((section, index) => {
          pdf.text(`${index + 1}. ${section.name}`, margins.left + 5, yOffset)
          yOffset += 6
        })

        addFooter()
      }

      // ========== CONTENT PAGES ==========
      pdf.addPage()
      currentPage++
      yOffset = margins.top + (headerFooterConfig.header.enabled ? 10 : 0)
      addHeader(false)

      // Content Sections
      for (const section of enabledSections) {
        checkNewPage(30)

        // Section Header
        pdf.setFontSize(fonts.heading.size)
        pdf.setFont(fonts.heading.family, fonts.heading.weight)
        pdf.setTextColor(primaryRgb.r, primaryRgb.g, primaryRgb.b)
        pdf.text(section.name, margins.left, yOffset)
        yOffset += 3

        // Underline
        pdf.setDrawColor(primaryRgb.r, primaryRgb.g, primaryRgb.b)
        pdf.setLineWidth(0.5)
        pdf.line(margins.left, yOffset, pageWidth - margins.right, yOffset)
        yOffset += styleConfig.spacing.sectionGap

        pdf.setTextColor(textRgb.r, textRgb.g, textRgb.b)

        // Get content for each enabled field in this section
        const enabledFields = section.fields?.filter(f => f.enabled) || []

        for (const field of enabledFields) {
          checkNewPage(20)

          // Field Name
          pdf.setFontSize(fonts.subheading.size)
          pdf.setFont(fonts.subheading.family, fonts.subheading.weight)
          pdf.setTextColor(headingRgb.r, headingRgb.g, headingRgb.b)
          pdf.text(field.name, margins.left, yOffset)
          yOffset += styleConfig.spacing.fieldGap

          // Field Content - Get from contributions or show placeholder
          const fieldContent = getFieldContent(field, contributions)
          pdf.setFontSize(fonts.body.size)
          pdf.setFont(fonts.body.family, 'normal')
          pdf.setTextColor(textRgb.r, textRgb.g, textRgb.b)

          if (fieldContent) {
            addWrappedText(fieldContent, fonts.body.size)
          } else {
            pdf.setTextColor(mutedRgb.r, mutedRgb.g, mutedRgb.b)
            addWrappedText('No content available for this field.', fonts.body.size)
            pdf.setTextColor(textRgb.r, textRgb.g, textRgb.b)
          }

          yOffset += styleConfig.spacing.fieldGap
        }

        yOffset += styleConfig.spacing.sectionGap
      }

      addFooter()

      // Save the PDF
      const filename = `${symbol}_Investment_Case_${new Date().toISOString().split('T')[0]}.pdf`
      pdf.save(filename)

      // Record template usage if one was selected
      if (selectedTemplate) {
        recordUsage(selectedTemplate.id)
      }

    } catch (err) {
      console.error('Failed to generate PDF:', err)
    } finally {
      setIsGenerating(false)
    }
  }, [sectionConfigs, coverConfig, selectedTemplate, symbol, companyName, currentPrice, contributions, logoDataUrl, recordUsage])

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold text-gray-900">Investment Case Builder</h3>
          <p className="text-sm text-gray-500">
            Create a professional PDF document from your research on {symbol}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <InvestmentCaseTemplateSelector
            selectedTemplateId={selectedTemplate?.id || null}
            onSelect={setSelectedTemplate}
          />
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowPreview(!showPreview)}
          >
            {showPreview ? <EyeOff className="w-4 h-4 mr-1" /> : <Eye className="w-4 h-4 mr-1" />}
            {showPreview ? 'Hide Preview' : 'Show Preview'}
          </Button>
          {onClose && (
            <button
              onClick={onClose}
              className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg"
            >
              <X className="w-5 h-5" />
            </button>
          )}
        </div>
      </div>

      <div className={clsx('grid gap-6', showPreview ? 'grid-cols-2' : 'grid-cols-1')}>
        {/* Configuration Panel */}
        <div className="space-y-4">
          {/* Cover Page Settings */}
          <Card>
            <div className="p-4 border-b border-gray-100">
              <h4 className="font-medium text-gray-900 flex items-center gap-2">
                <Settings className="w-4 h-4" />
                Cover Page Settings
              </h4>
            </div>
            <div className="p-4 space-y-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Custom Title (optional)
                </label>
                <input
                  type="text"
                  value={coverConfig.customTitle || ''}
                  onChange={e => setCoverConfig(prev => ({ ...prev, customTitle: e.target.value }))}
                  placeholder={`Investment Case: ${symbol}`}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500"
                />
              </div>

              <div className="flex flex-wrap gap-4">
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={coverConfig.includeDate}
                    onChange={e => setCoverConfig(prev => ({ ...prev, includeDate: e.target.checked }))}
                    className="rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                  />
                  <Calendar className="w-4 h-4 text-gray-400" />
                  Include date
                </label>

                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={coverConfig.includeAuthor}
                    onChange={e => setCoverConfig(prev => ({ ...prev, includeAuthor: e.target.checked }))}
                    className="rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                  />
                  <User className="w-4 h-4 text-gray-400" />
                  Include author
                </label>

                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={coverConfig.includeDisclaimer}
                    onChange={e => setCoverConfig(prev => ({ ...prev, includeDisclaimer: e.target.checked }))}
                    className="rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                  />
                  <AlertCircle className="w-4 h-4 text-gray-400" />
                  Include disclaimer
                </label>
              </div>

              {coverConfig.includeDisclaimer && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Disclaimer Text
                  </label>
                  <textarea
                    value={coverConfig.disclaimerText}
                    onChange={e => setCoverConfig(prev => ({ ...prev, disclaimerText: e.target.value }))}
                    rows={2}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500"
                  />
                </div>
              )}
            </div>
          </Card>

          {/* Section Selection */}
          <Card padding="none">
            <div className="p-4 border-b border-gray-100 flex items-center justify-between">
              <h4 className="font-medium text-gray-900 flex items-center gap-2">
                <FileStack className="w-4 h-4" />
                Content Sections
              </h4>
              <span className="text-xs text-gray-500">
                {enabledSections.length} sections, {totalEnabledFields} fields
              </span>
            </div>

            <div className="divide-y divide-gray-100">
              {sectionConfigs.map(section => {
                const isExpanded = expandedSections.has(section.id)
                const enabledFieldsCount = section.fields?.filter(f => f.enabled).length || 0

                return (
                  <div key={section.id}>
                    <div className="flex items-center gap-2 p-3 hover:bg-gray-50">
                      <GripVertical className="w-4 h-4 text-gray-300 cursor-grab" />
                      <button
                        onClick={() => toggleSectionEnabled(section.id)}
                        className="text-gray-400 hover:text-primary-600"
                      >
                        {section.enabled ? (
                          <CheckSquare className="w-5 h-5 text-primary-600" />
                        ) : (
                          <Square className="w-5 h-5" />
                        )}
                      </button>
                      <button
                        onClick={() => toggleSection(section.id)}
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
                          ({enabledFieldsCount}/{section.fields?.length || 0} fields)
                        </span>
                      </button>
                    </div>

                    {isExpanded && section.fields && (
                      <div className="pl-12 pb-2 space-y-1">
                        {section.fields.map(field => (
                          <button
                            key={field.id}
                            onClick={() => toggleFieldEnabled(section.id, field.id)}
                            className={clsx(
                              'w-full flex items-center gap-2 px-3 py-1.5 text-sm rounded hover:bg-gray-50 text-left',
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
          </Card>

          {/* Generate Button */}
          <Button
            variant="primary"
            className="w-full"
            onClick={generatePDF}
            disabled={isGenerating || enabledSections.length === 0}
          >
            {isGenerating ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin mr-2" />
                Generating PDF...
              </>
            ) : (
              <>
                <Download className="w-4 h-4 mr-2" />
                Generate Investment Case PDF
              </>
            )}
          </Button>
        </div>

        {/* Preview Panel */}
        {showPreview && (
          <Card className="bg-gray-50">
            <div className="p-4 border-b border-gray-200">
              <h4 className="font-medium text-gray-900">Document Preview</h4>
            </div>
            <div className="p-4">
              {/* Mini preview of the document structure */}
              <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4 space-y-4">
                {/* Cover Preview */}
                <div className="text-center pb-4 border-b border-gray-100">
                  <div className="text-lg font-bold text-gray-900">
                    {coverConfig.customTitle || `Investment Case: ${symbol}`}
                  </div>
                  {companyName && (
                    <div className="text-sm text-gray-500">{companyName}</div>
                  )}
                  {currentPrice && (
                    <div className="text-sm text-gray-600 mt-1">
                      Current Price: ${currentPrice.toFixed(2)}
                    </div>
                  )}
                </div>

                {/* Sections Preview */}
                <div className="space-y-3">
                  {enabledSections.map((section, index) => (
                    <div key={section.id} className="space-y-1">
                      <div className="flex items-center gap-2 text-sm">
                        <span className="font-medium text-primary-600">
                          {index + 1}. {section.name}
                        </span>
                      </div>
                      <div className="pl-4 space-y-0.5">
                        {section.fields?.filter(f => f.enabled).map(field => (
                          <div key={field.id} className="text-xs text-gray-500 flex items-center gap-1">
                            <span className="w-1 h-1 rounded-full bg-gray-300" />
                            {field.name}
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>

                {enabledSections.length === 0 && (
                  <div className="text-center text-sm text-gray-400 py-4">
                    Select at least one section to include
                  </div>
                )}
              </div>
            </div>
          </Card>
        )}
      </div>
    </div>
  )
}

// ============================================================================
// HELPER: Get content for a field
// ============================================================================

function getFieldContent(field: FieldConfig, contributions: any[]): string | null {
  // For thesis fields, look in contributions
  if (field.slug === 'investment-thesis' || field.slug === 'thesis') {
    const thesisContribution = contributions.find(
      c => c.section_type === 'thesis' || c.content_type === 'thesis'
    )
    if (thesisContribution?.content) {
      return stripHtml(thesisContribution.content)
    }
  }

  if (field.slug === 'bull-case') {
    const contrib = contributions.find(c => c.section_type === 'bull_case')
    if (contrib?.content) return stripHtml(contrib.content)
  }

  if (field.slug === 'bear-case') {
    const contrib = contributions.find(c => c.section_type === 'bear_case')
    if (contrib?.content) return stripHtml(contrib.content)
  }

  if (field.slug === 'key-risks') {
    const contrib = contributions.find(c => c.section_type === 'risks')
    if (contrib?.content) return stripHtml(contrib.content)
  }

  if (field.slug === 'catalysts') {
    const contrib = contributions.find(c => c.section_type === 'catalysts')
    if (contrib?.content) return stripHtml(contrib.content)
  }

  // For other field types, return placeholder for now
  // In a full implementation, this would query field_contributions table
  return null
}

// Helper to strip HTML tags for plain text export
function stripHtml(html: string): string {
  const tmp = document.createElement('div')
  tmp.innerHTML = html
  return tmp.textContent || tmp.innerText || ''
}
