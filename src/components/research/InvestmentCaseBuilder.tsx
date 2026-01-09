import { useState, useCallback, useMemo } from 'react'
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
import { useUserResearchLayout, type AccessibleField } from '../../hooks/useResearchFields'
import { useContributions } from '../../hooks/useContributions'
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

interface CoverPageConfig {
  includeDate: boolean
  includeAuthor: boolean
  includeDisclaimer: boolean
  customTitle?: string
  disclaimerText: string
}

// ============================================================================
// DEFAULT CONFIGURATIONS
// ============================================================================

const DEFAULT_COVER_CONFIG: CoverPageConfig = {
  includeDate: true,
  includeAuthor: true,
  includeDisclaimer: true,
  disclaimerText: 'This document is for informational purposes only and does not constitute investment advice. Past performance is not indicative of future results.'
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
  const { sections, fields, isLoading } = useUserResearchLayout()
  const { contributions } = useContributions(assetId)

  const [isGenerating, setIsGenerating] = useState(false)
  const [showPreview, setShowPreview] = useState(false)
  const [coverConfig, setCoverConfig] = useState<CoverPageConfig>(DEFAULT_COVER_CONFIG)
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set())

  // Build section configurations from user's accessible fields
  const [sectionConfigs, setSectionConfigs] = useState<SectionConfig[]>(() =>
    sections.map((ls, index) => ({
      id: ls.section.id,
      name: ls.section.name,
      enabled: true,
      order: index,
      fields: ls.fields.map(af => ({
        id: af.field.id,
        name: af.field.name,
        slug: af.field.slug,
        enabled: true,
        fieldType: af.field.field_type
      }))
    }))
  )

  // Update configs when sections load
  useMemo(() => {
    if (sections.length > 0 && sectionConfigs.length === 0) {
      setSectionConfigs(
        sections.map((ls, index) => ({
          id: ls.section.id,
          name: ls.section.name,
          enabled: true,
          order: index,
          fields: ls.fields.map(af => ({
            id: af.field.id,
            name: af.field.name,
            slug: af.field.slug,
            enabled: true,
            fieldType: af.field.field_type
          }))
        }))
      )
    }
  }, [sections])

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
      const pdf = new jsPDF({
        orientation: 'portrait',
        unit: 'mm',
        format: 'a4'
      })

      const pageWidth = pdf.internal.pageSize.getWidth()
      const pageHeight = pdf.internal.pageSize.getHeight()
      const margin = 20
      const contentWidth = pageWidth - margin * 2
      let yOffset = margin

      // Helper to add a new page if needed
      const checkNewPage = (requiredHeight: number) => {
        if (yOffset + requiredHeight > pageHeight - margin) {
          pdf.addPage()
          yOffset = margin
          return true
        }
        return false
      }

      // Helper to add text with wrapping
      const addWrappedText = (text: string, fontSize: number, isBold = false) => {
        pdf.setFontSize(fontSize)
        pdf.setFont('helvetica', isBold ? 'bold' : 'normal')
        const lines = pdf.splitTextToSize(text, contentWidth)
        const lineHeight = fontSize * 0.4

        for (const line of lines) {
          checkNewPage(lineHeight + 2)
          pdf.text(line, margin, yOffset)
          yOffset += lineHeight + 1
        }
        yOffset += 2
      }

      // ========== COVER PAGE ==========
      // Title
      yOffset = 60
      pdf.setFontSize(28)
      pdf.setFont('helvetica', 'bold')
      pdf.setTextColor(33, 33, 33)
      const title = coverConfig.customTitle || `Investment Case: ${symbol}`
      pdf.text(title, pageWidth / 2, yOffset, { align: 'center' })
      yOffset += 15

      // Company Name
      if (companyName) {
        pdf.setFontSize(16)
        pdf.setFont('helvetica', 'normal')
        pdf.setTextColor(100, 100, 100)
        pdf.text(companyName, pageWidth / 2, yOffset, { align: 'center' })
        yOffset += 10
      }

      // Current Price
      if (currentPrice) {
        pdf.setFontSize(14)
        pdf.text(`Current Price: $${currentPrice.toFixed(2)}`, pageWidth / 2, yOffset + 10, { align: 'center' })
        yOffset += 20
      }

      // Metadata
      yOffset = pageHeight - 60
      pdf.setFontSize(10)
      pdf.setTextColor(128, 128, 128)

      if (coverConfig.includeDate) {
        const dateStr = new Date().toLocaleDateString('en-US', {
          year: 'numeric',
          month: 'long',
          day: 'numeric'
        })
        pdf.text(`Generated: ${dateStr}`, pageWidth / 2, yOffset, { align: 'center' })
        yOffset += 6
      }

      if (coverConfig.includeAuthor) {
        pdf.text('Prepared using Tesseract Research Platform', pageWidth / 2, yOffset, { align: 'center' })
        yOffset += 6
      }

      // Disclaimer
      if (coverConfig.includeDisclaimer) {
        yOffset = pageHeight - 30
        pdf.setFontSize(8)
        pdf.setTextColor(150, 150, 150)
        const disclaimerLines = pdf.splitTextToSize(coverConfig.disclaimerText, contentWidth)
        for (const line of disclaimerLines) {
          pdf.text(line, pageWidth / 2, yOffset, { align: 'center' })
          yOffset += 4
        }
      }

      // ========== CONTENT PAGES ==========
      pdf.addPage()
      yOffset = margin

      // Table of Contents
      pdf.setFontSize(18)
      pdf.setFont('helvetica', 'bold')
      pdf.setTextColor(33, 33, 33)
      pdf.text('Table of Contents', margin, yOffset)
      yOffset += 12

      pdf.setFontSize(11)
      pdf.setFont('helvetica', 'normal')
      enabledSections.forEach((section, index) => {
        pdf.text(`${index + 1}. ${section.name}`, margin + 5, yOffset)
        yOffset += 6
      })

      yOffset += 10

      // Content Sections
      for (const section of enabledSections) {
        checkNewPage(30)

        // Section Header
        pdf.setFontSize(16)
        pdf.setFont('helvetica', 'bold')
        pdf.setTextColor(59, 130, 246) // Primary blue
        pdf.text(section.name, margin, yOffset)
        yOffset += 3

        // Underline
        pdf.setDrawColor(59, 130, 246)
        pdf.setLineWidth(0.5)
        pdf.line(margin, yOffset, pageWidth - margin, yOffset)
        yOffset += 10

        pdf.setTextColor(33, 33, 33)

        // Get content for each enabled field in this section
        const enabledFields = section.fields?.filter(f => f.enabled) || []

        for (const field of enabledFields) {
          checkNewPage(20)

          // Field Name
          pdf.setFontSize(12)
          pdf.setFont('helvetica', 'bold')
          pdf.text(field.name, margin, yOffset)
          yOffset += 6

          // Field Content - Get from contributions or show placeholder
          const fieldContent = getFieldContent(field, contributions)
          pdf.setFontSize(10)
          pdf.setFont('helvetica', 'normal')

          if (fieldContent) {
            addWrappedText(fieldContent, 10)
          } else {
            pdf.setTextColor(150, 150, 150)
            addWrappedText('No content available for this field.', 10)
            pdf.setTextColor(33, 33, 33)
          }

          yOffset += 5
        }

        yOffset += 10
      }

      // Save the PDF
      const filename = `${symbol}_Investment_Case_${new Date().toISOString().split('T')[0]}.pdf`
      pdf.save(filename)

    } catch (err) {
      console.error('Failed to generate PDF:', err)
    } finally {
      setIsGenerating(false)
    }
  }, [sectionConfigs, coverConfig, symbol, companyName, currentPrice, contributions])

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
