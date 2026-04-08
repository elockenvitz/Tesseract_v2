import { useState, useCallback, useMemo, useEffect, useRef } from 'react'
import { clsx } from 'clsx'
import {
  FileText,
  Download,
  GripVertical,
  ChevronDown,
  ChevronRight,
  Loader2,
  CheckSquare,
  Square,
  FileStack,
  X,
  Calendar,
  Edit2,
  ChevronUp,
  Type,
  EyeOff,
  Palette,
  Paperclip,
  Link,
  BookOpen,
  RotateCcw,
  AlertTriangle
} from 'lucide-react'
import { Button } from '../ui/Button'
import { useUserAssetPagePreferences } from '../../hooks/useUserAssetPagePreferences'
import { useContributions } from '../../hooks/useContributions'
import { useInvestmentCaseTemplates } from '../../hooks/useInvestmentCaseTemplates'
import { useAuth } from '../../hooks/useAuth'
import { useAnalystRatings } from '../../hooks/useAnalystRatings'
import { useAnalystPriceTargets } from '../../hooks/useAnalystPriceTargets'
import { supabase } from '../../lib/supabase'
import { useQueryClient } from '@tanstack/react-query'
import { InvestmentCaseTemplateSelector, InvestmentCaseTemplateEditor } from '../investment-case-templates'
import { InvestmentCaseTemplate, DEFAULT_STYLE_CONFIG, DEFAULT_COVER_CONFIG, DEFAULT_HEADER_FOOTER_CONFIG, DEFAULT_TOC_CONFIG } from '../../types/investmentCaseTemplates'
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
// HELPERS
// ============================================================================

function buildSectionConfigs(displayedFieldsBySection: any[]): SectionConfig[] {
  return displayedFieldsBySection
    .filter(section => section.fields.some((f: any) => f.is_visible))
    .map((section, index) => ({
      id: section.section_id,
      name: section.section_name,
      enabled: true,
      order: index,
      fields: section.fields
        .filter((f: any) => f.is_visible)
        .map((f: any) => ({
          id: f.field_id,
          name: f.field_name,
          slug: f.field_slug,
          enabled: true,
          fieldType: f.field_type
        }))
    }))
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
  const { user } = useAuth()
  const queryClient = useQueryClient()
  const { displayedFieldsBySection, isLoading } = useUserAssetPagePreferences(assetId)
  const { contributions } = useContributions({ assetId })
  const { ratings } = useAnalystRatings({ assetId })
  const { priceTargets } = useAnalystPriceTargets({ assetId, userId: user?.id })
  const { recordUsage, getLogoUrl, defaultTemplate } = useInvestmentCaseTemplates()

  // Template
  const [selectedTemplate, setSelectedTemplate] = useState<InvestmentCaseTemplate | null>(null)
  const [showTemplateEditor, setShowTemplateEditor] = useState(false)
  const [logoDataUrl, setLogoDataUrl] = useState<string | null>(null)

  // Snapshot
  const [asOfDate, setAsOfDate] = useState(() => {
    const d = new Date()
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  })
  const [includeDraftChanges, setIncludeDraftChanges] = useState(false)

  // Content scope
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set())

  // Output
  const [filenameOverride, setFilenameOverride] = useState('')
  const [isGenerating, setIsGenerating] = useState(false)

  // Advanced overrides
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [customExportTitle, setCustomExportTitle] = useState('')
  const [tempWatermarkText, setTempWatermarkText] = useState('')
  const [hideCoverPage, setHideCoverPage] = useState(false)
  const [excludeHeaderFooter, setExcludeHeaderFooter] = useState(false)

  // Load logo when template changes
  useEffect(() => {
    if (selectedTemplate?.branding_config.logoPath) {
      getLogoUrl(selectedTemplate.branding_config.logoPath).then(url => {
        if (url) {
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
    buildSectionConfigs(displayedFieldsBySection)
  )

  // Track baseline for modification detection
  const baselineRef = useRef<SectionConfig[]>(sectionConfigs)

  // Update configs when layout loads
  useMemo(() => {
    if (displayedFieldsBySection.length > 0 && sectionConfigs.length === 0) {
      const configs = buildSectionConfigs(displayedFieldsBySection)
      setSectionConfigs(configs)
      baselineRef.current = configs
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

  // Modification detection
  const isSectionModified = (section: SectionConfig) => {
    if (!section.enabled) return true
    return section.fields?.some(f => !f.enabled) ?? false
  }

  const hasContentModifications = sectionConfigs.some(isSectionModified)

  const resetToTemplate = () => {
    setSectionConfigs(prev => prev
      .map((s, i) => ({
        ...s,
        enabled: true,
        order: i,
        fields: s.fields?.map(f => ({ ...f, enabled: true }))
      }))
      .sort((a, b) => a.order - b.order)
    )
  }

  const enabledSections = sectionConfigs.filter(s => s.enabled)
  const totalEnabledFields = enabledSections.reduce(
    (acc, s) => acc + (s.fields?.filter(f => f.enabled).length || 0),
    0
  )

  const defaultFilename = `${symbol}_Investment_Case_${asOfDate}.pdf`

  const formattedAsOfDate = useMemo(() => {
    try {
      return new Date(asOfDate + 'T00:00:00').toLocaleDateString('en-US', {
        year: 'numeric', month: 'short', day: 'numeric'
      })
    } catch {
      return asOfDate
    }
  }, [asOfDate])

  const effectiveTemplateName = selectedTemplate?.name || defaultTemplate?.name || 'Default'

  // ========================================================================
  // Generate PDF
  // ========================================================================
  const generatePDF = useCallback(async () => {
    setIsGenerating(true)

    try {
      const template = selectedTemplate
      const styleConfig = template?.style_config || DEFAULT_STYLE_CONFIG
      const coverCfg = template?.cover_config || DEFAULT_COVER_CONFIG
      const brandingConfig = template?.branding_config
      const headerFooterConfig = template?.header_footer_config || DEFAULT_HEADER_FOOTER_CONFIG
      const tocConfig = template?.toc_config || DEFAULT_TOC_CONFIG

      // Respect excludeHeaderFooter override
      const effectiveHF = excludeHeaderFooter
        ? { header: { ...headerFooterConfig.header, enabled: false }, footer: { ...headerFooterConfig.footer, enabled: false } }
        : headerFooterConfig

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

      const colors = styleConfig.colors
      const primaryRgb = hexToRgb(colors.primary)
      const textRgb = hexToRgb(colors.text)
      const headingRgb = hexToRgb(colors.headingText)
      const mutedRgb = hexToRgb(colors.mutedText)
      const secondaryRgb = hexToRgb(colors.secondary)

      const addHeader = (isFirstPage: boolean) => {
        if (effectiveHF.header.enabled && (!isFirstPage || effectiveHF.header.showOnFirstPage)) {
          pdf.setFontSize(8)
          pdf.setFont(styleConfig.fonts.body.family, 'normal')
          pdf.setTextColor(mutedRgb.r, mutedRgb.g, mutedRgb.b)

          let headerText = effectiveHF.header.content || ''
          headerText = headerText.replace('{{firmName}}', brandingConfig?.firmName || '')
          headerText = headerText.replace('{{symbol}}', symbol)
          headerText = headerText.replace('{{date}}', new Date(asOfDate).toLocaleDateString())

          if (headerText) {
            pdf.text(headerText, pageWidth / 2, 10, { align: 'center' })
          }
          if (effectiveHF.header.showPageNumber) {
            pdf.text(`Page ${currentPage}`, pageWidth - margins.right, 10, { align: 'right' })
          }
        }
      }

      const addFooter = () => {
        if (effectiveHF.footer.enabled) {
          pdf.setFontSize(8)
          pdf.setFont(styleConfig.fonts.body.family, 'normal')
          pdf.setTextColor(mutedRgb.r, mutedRgb.g, mutedRgb.b)

          const footerY = pageHeight - 10

          if (effectiveHF.footer.content) {
            pdf.text(effectiveHF.footer.content, margins.left, footerY)
          }

          if (effectiveHF.footer.showPageNumber) {
            const pageText = effectiveHF.footer.pageNumberFormat
              .replace('{page}', String(currentPage))
              .replace('{total}', '?')
            pdf.text(pageText, pageWidth - margins.right, footerY, { align: 'right' })
          }
        }
      }

      const checkNewPage = (requiredHeight: number) => {
        const footerSpace = effectiveHF.footer.enabled ? 15 : 0
        if (yOffset + requiredHeight > pageHeight - margins.bottom - footerSpace) {
          addFooter()
          pdf.addPage()
          currentPage++
          yOffset = margins.top + (effectiveHF.header.enabled ? 10 : 0)
          addHeader(false)
          return true
        }
        return false
      }

      const addWrappedText = (text: string, fontSize: number, fontWeight: 'normal' | 'bold' = 'normal') => {
        pdf.setFontSize(fontSize)
        pdf.setFont(styleConfig.fonts.body.family, fontWeight)
        const safe = sanitizeForPdf(text)
        const lines = pdf.splitTextToSize(safe, contentWidth)
        const lineHeight = fontSize * 0.4

        for (const line of lines) {
          checkNewPage(lineHeight + 2)
          pdf.text(line, margins.left, yOffset)
          yOffset += lineHeight + styleConfig.spacing.paragraphGap
        }
        yOffset += styleConfig.spacing.paragraphGap
      }

      /** Render rich content (markdown or HTML) into the PDF with proper formatting */
      const addRichText = (content: string, fontSize: number) => {
        const bodyFamily = styleConfig.fonts.body.family
        const lineHeight = fontSize * 0.4
        const paragraphGap = styleConfig.spacing.paragraphGap
        const bulletIndent = 8

        pdf.setFontSize(fontSize)
        pdf.setFont(bodyFamily, 'normal')

        // Detect if content is HTML (contains tags) or markdown-style
        const isHtml = /<[a-z][\s\S]*>/i.test(content)

        // Normalize to plain text with structure markers
        let text = content
        if (isHtml) {
          text = text
            .replace(/<br\s*\/?>/gi, '\n')
            .replace(/<\/p>/gi, '\n\n')
            .replace(/<\/div>/gi, '\n')
            .replace(/<\/h[1-6]>/gi, '\n\n')
            .replace(/<li[^>]*>/gi, '- ')
            .replace(/<\/li>/gi, '\n')
            .replace(/<[^>]*>/g, '')
        }

        // Sanitize Unicode for PDF font compatibility
        text = sanitizeForPdf(text)

        // Process line by line to handle mixed paragraph + list content
        const allLines = text.split('\n')
        let i = 0

        while (i < allLines.length) {
          const line = allLines[i].trim()

          // Skip empty lines (paragraph break)
          if (!line) {
            yOffset += paragraphGap
            i++
            continue
          }

          // Bullet line
          if (/^[-*]\s/.test(line)) {
            const itemText = line.replace(/^[-*]\s+/, '')
            checkNewPage(lineHeight + 2)

            // Render bullet marker
            pdf.setFont(bodyFamily, 'normal')
            pdf.setFontSize(fontSize)
            pdf.text('-', margins.left + 1, yOffset)

            // Render item text with inline bold
            renderLineWithBold(itemText, margins.left + bulletIndent, contentWidth - bulletIndent, fontSize, bodyFamily, lineHeight, paragraphGap)
            i++
            continue
          }

          // Regular text line
          checkNewPage(lineHeight + 2)
          renderLineWithBold(line, margins.left, contentWidth, fontSize, bodyFamily, lineHeight, paragraphGap)
          i++
        }

        // Reset font
        pdf.setFont(bodyFamily, 'normal')
      }

      /** Render a single line with **bold** markdown inline formatting */
      const renderLineWithBold = (
        rawText: string, x: number, maxWidth: number,
        fontSize: number, fontFamily: string,
        lineHeight: number, paragraphGap: number
      ) => {
        const text = sanitizeForPdf(rawText)

        // Parse into segments: [{text, bold}]
        const segments: { text: string; bold: boolean }[] = []
        const boldPattern = /\*\*(.+?)\*\*/g
        let lastIndex = 0
        let match: RegExpExecArray | null

        while ((match = boldPattern.exec(text)) !== null) {
          if (match.index > lastIndex) {
            segments.push({ text: text.slice(lastIndex, match.index), bold: false })
          }
          segments.push({ text: match[1], bold: true })
          lastIndex = match.index + match[0].length
        }
        if (lastIndex < text.length) {
          segments.push({ text: text.slice(lastIndex), bold: false })
        }

        // No bold — simple path
        if (segments.length <= 1 && !segments[0]?.bold) {
          const plain = segments[0]?.text || text
          pdf.setFont(fontFamily, 'normal')
          pdf.setFontSize(fontSize)
          const wrapped = pdf.splitTextToSize(plain, maxWidth)
          for (const wline of wrapped) {
            checkNewPage(lineHeight + 2)
            pdf.text(wline, x, yOffset)
            yOffset += lineHeight + paragraphGap
          }
          return
        }

        // Has bold — use jsPDF inline positioning per wrapped line
        const plainText = segments.map(s => s.text).join('')
        pdf.setFont(fontFamily, 'normal')
        pdf.setFontSize(fontSize)
        const wrapped = pdf.splitTextToSize(plainText, maxWidth)

        let charOffset = 0
        for (const wline of wrapped) {
          checkNewPage(lineHeight + 2)
          const lineEnd = charOffset + wline.length

          // Render segments that fall within this wrapped line
          let cursorX = x
          let segCharPos = 0

          for (const seg of segments) {
            const segStart = segCharPos
            const segEnd = segCharPos + seg.text.length
            segCharPos = segEnd

            // Find overlap with current wrapped line
            const overlapStart = Math.max(segStart, charOffset)
            const overlapEnd = Math.min(segEnd, lineEnd)

            if (overlapStart >= overlapEnd) continue

            const fragment = seg.text.slice(overlapStart - segStart, overlapEnd - segStart)
            if (!fragment) continue

            pdf.setFont(fontFamily, seg.bold ? 'bold' : 'normal')
            pdf.text(fragment, cursorX, yOffset)
            cursorX += pdf.getTextWidth(fragment)
          }

          pdf.setFont(fontFamily, 'normal')
          yOffset += lineHeight + paragraphGap
          charOffset = lineEnd
        }
      }

      // Determine effective watermark (template watermark OR temporary override)
      const effectiveWatermark = tempWatermarkText.trim()
        || (brandingConfig?.watermarkEnabled && brandingConfig.watermarkText ? brandingConfig.watermarkText : '')
      const watermarkOpacity = tempWatermarkText.trim()
        ? 0.1
        : (brandingConfig?.watermarkOpacity ?? 0.1)

      // ========== COVER PAGE ==========
      if (!hideCoverPage) {
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

        const title = customExportTitle.trim() || coverCfg.customTitle || `Investment Case: ${symbol}`
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
          const dateStr = new Date(asOfDate).toLocaleDateString('en-US', {
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
        if (effectiveWatermark) {
          pdf.setFontSize(48)
          pdf.setTextColor(200, 200, 200)
          pdf.setGState(new pdf.GState({ opacity: watermarkOpacity }))
          pdf.text(effectiveWatermark, pageWidth / 2, pageHeight / 2, {
            align: 'center',
            angle: 45
          })
          pdf.setGState(new pdf.GState({ opacity: 1 }))
        }

        addFooter()
      }

      // ========== TABLE OF CONTENTS (if enabled) ==========
      if (tocConfig.enabled) {
        if (!hideCoverPage) {
          pdf.addPage()
          currentPage++
        }
        yOffset = margins.top + (effectiveHF.header.enabled ? 10 : 0)
        addHeader(false)

        const fonts = styleConfig.fonts
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
      yOffset = margins.top + (effectiveHF.header.enabled ? 10 : 0)
      addHeader(false)

      const fonts = styleConfig.fonts
      for (const section of enabledSections) {
        checkNewPage(30)

        pdf.setFontSize(fonts.heading.size)
        pdf.setFont(fonts.heading.family, fonts.heading.weight)
        pdf.setTextColor(primaryRgb.r, primaryRgb.g, primaryRgb.b)
        pdf.text(section.name, margins.left, yOffset)
        yOffset += 3

        pdf.setDrawColor(primaryRgb.r, primaryRgb.g, primaryRgb.b)
        pdf.setLineWidth(0.5)
        pdf.line(margins.left, yOffset, pageWidth - margins.right, yOffset)
        yOffset += styleConfig.spacing.sectionGap

        pdf.setTextColor(textRgb.r, textRgb.g, textRgb.b)

        const enabledFields = section.fields?.filter(f => f.enabled) || []

        for (const field of enabledFields) {
          checkNewPage(20)

          pdf.setFontSize(fonts.subheading.size)
          pdf.setFont(fonts.subheading.family, fonts.subheading.weight)
          pdf.setTextColor(headingRgb.r, headingRgb.g, headingRgb.b)
          pdf.text(field.name, margins.left, yOffset)
          yOffset += styleConfig.spacing.fieldGap

          pdf.setFontSize(fonts.body.size)
          pdf.setFont(fonts.body.family, 'normal')
          pdf.setTextColor(textRgb.r, textRgb.g, textRgb.b)

          const normalizedSlug = field.slug.replace(/-/g, '_')

          // Special handling for rating field
          if (normalizedSlug === 'rating') {
            const userRating = ratings.find(r => r.user_id === user?.id)
            if (userRating) {
              const conviction = userRating.conviction ? `  \u00B7  ${userRating.conviction} conviction` : ''
              addWrappedText(`${userRating.rating_value}${conviction}`, fonts.body.size, 'bold')
              if (userRating.notes) {
                yOffset += 1
                addRichText(userRating.notes, fonts.body.size)
              }
            } else if (ratings.length > 0) {
              for (const r of ratings) {
                const name = r.user ? [r.user.first_name, r.user.last_name].filter(Boolean).join(' ') : 'Unknown'
                const conviction = r.conviction ? `  \u00B7  ${r.conviction}` : ''
                addWrappedText(`${name}: ${r.rating_value}${conviction}`, fonts.body.size)
              }
            } else {
              pdf.setTextColor(mutedRgb.r, mutedRgb.g, mutedRgb.b)
              addWrappedText('No rating set.', fonts.body.size)
              pdf.setTextColor(textRgb.r, textRgb.g, textRgb.b)
            }

          // Special handling for price targets field
          } else if (normalizedSlug === 'price_targets' || normalizedSlug === 'price_target') {
            const userTargets = priceTargets?.filter(t => t.user_id === user?.id) || []
            const targetsToShow = userTargets.length > 0 ? userTargets : (priceTargets || [])

            if (targetsToShow.length > 0) {
              for (const t of targetsToShow) {
                const scenario = t.scenario?.name || 'Unknown'
                const prob = t.probability != null ? `  \u00B7  ${Math.round(t.probability)}% prob` : ''
                const returnPct = currentPrice && currentPrice > 0
                  ? `  \u00B7  ${(((t.price - currentPrice) / currentPrice) * 100) >= 0 ? '+' : ''}${(((t.price - currentPrice) / currentPrice) * 100).toFixed(1)}%`
                  : ''
                addWrappedText(`${scenario}:  $${t.price.toFixed(2)}${prob}${returnPct}`, fonts.body.size)
              }

              // Add EV if we have probabilities
              const withProb = targetsToShow.filter(t => t.probability != null && t.probability > 0 && t.price > 0)
              const totalProb = withProb.reduce((sum, t) => sum + (t.probability ?? 0), 0)
              if (withProb.length > 0 && totalProb > 0 && currentPrice && currentPrice > 0) {
                const ev = withProb.reduce((sum, t) => sum + t.price * (t.probability ?? 0), 0) / totalProb
                const evReturn = ((ev - currentPrice) / currentPrice) * 100
                yOffset += 2
                addWrappedText(`Expected Value:  $${ev.toFixed(2)}  (${evReturn >= 0 ? '+' : ''}${evReturn.toFixed(1)}%)`, fonts.body.size, 'bold')
              }
            } else {
              pdf.setTextColor(mutedRgb.r, mutedRgb.g, mutedRgb.b)
              addWrappedText('No price targets set.', fonts.body.size)
              pdf.setTextColor(textRgb.r, textRgb.g, textRgb.b)
            }

          // Standard content field — render as rich text
          } else {
            const fieldContent = getFieldContent(field, contributions)
            if (fieldContent) {
              addRichText(fieldContent, fonts.body.size)
            } else {
              pdf.setTextColor(mutedRgb.r, mutedRgb.g, mutedRgb.b)
              addWrappedText('No content available for this field.', fonts.body.size)
              pdf.setTextColor(textRgb.r, textRgb.g, textRgb.b)
            }
          }

          yOffset += styleConfig.spacing.fieldGap
        }

        yOffset += styleConfig.spacing.sectionGap
      }

      // Watermark on content pages
      if (effectiveWatermark) {
        const totalPages = pdf.getNumberOfPages()
        const startPage = hideCoverPage ? 1 : 2
        for (let i = startPage; i <= totalPages; i++) {
          pdf.setPage(i)
          pdf.setFontSize(48)
          pdf.setTextColor(200, 200, 200)
          pdf.setGState(new pdf.GState({ opacity: watermarkOpacity }))
          pdf.text(effectiveWatermark, pageWidth / 2, pageHeight / 2, {
            align: 'center',
            angle: 45
          })
          pdf.setGState(new pdf.GState({ opacity: 1 }))
        }
      }

      addFooter()

      const filename = filenameOverride.trim() || defaultFilename
      const pdfFilename = filename.endsWith('.pdf') ? filename : `${filename}.pdf`
      pdf.save(pdfFilename)

      if (selectedTemplate) {
        recordUsage(selectedTemplate.id)
      }

      // Save a copy to Asset Library with export metadata
      if (user) {
        try {
          const blob = pdf.output('blob')
          const randomId = Math.random().toString(36).substring(2, 10)
          const storagePath = `documents/${assetId}/${Date.now()}_${randomId}.pdf`

          const { error: uploadError } = await supabase.storage
            .from('assets')
            .upload(storagePath, blob, { contentType: 'application/pdf' })

          if (!uploadError) {
            // Count enabled sections and fields
            const enabledSections = sectionConfigs.filter(s => s.enabled)
            const enabledFields = enabledSections.reduce((acc, s) =>
              acc + (s.fields?.filter(f => f.enabled).length || 0), 0)

            const userName = user.user_metadata?.first_name && user.user_metadata?.last_name
              ? `${user.user_metadata.first_name} ${user.user_metadata.last_name}`
              : user.email?.split('@')[0] || 'Unknown'

            const noteTitle = filename.replace(/\.pdf$/i, '')
            const { data: insertedNote } = await supabase.from('asset_notes').insert({
              asset_id: assetId,
              title: noteTitle,
              content: '',
              source_type: 'uploaded',
              file_path: storagePath,
              file_name: pdfFilename,
              file_size: blob.size,
              file_type: 'application/pdf',
              is_shared: false,
              created_by: user.id,
              metadata: {
                is_export: true,
                template_id: selectedTemplate?.id || null,
                template_name: selectedTemplate?.name || 'Default',
                as_of_date: asOfDate,
                sections_count: enabledSections.length,
                fields_count: enabledFields,
                generated_by_name: userName,
                generated_by_id: user.id,
                included_artifact_ids: []
              }
            }).select('id').single()

            // Also add as a key reference so it appears in Key References
            if (insertedNote?.id) {
              await supabase.from('user_asset_references').insert({
                asset_id: assetId,
                user_id: user.id,
                reference_type: 'note',
                target_id: insertedNote.id,
                target_table: 'asset_notes',
                title: noteTitle,
                description: `Investment case exported on ${new Date(asOfDate).toLocaleDateString()} using ${selectedTemplate?.name || 'Default'} template`,
                category: 'research',
                importance: 'normal'
              })
              queryClient.invalidateQueries({ queryKey: ['key-references', assetId, user.id] })
            }

            queryClient.invalidateQueries({ queryKey: ['asset-notes', assetId] })
          }
        } catch (saveErr) {
          // Non-blocking — PDF was already downloaded successfully
          console.error('Failed to save investment case to references:', saveErr)
        }
      }

    } catch (err) {
      console.error('Failed to generate PDF:', err)
    } finally {
      setIsGenerating(false)
    }
  }, [sectionConfigs, selectedTemplate, symbol, companyName, currentPrice, contributions, ratings, priceTargets, logoDataUrl, recordUsage, asOfDate, filenameOverride, defaultFilename, customExportTitle, tempWatermarkText, hideCoverPage, excludeHeaderFooter, assetId, user, queryClient])

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
      </div>
    )
  }

  return (
    <>
      <div className="space-y-5">
        {/* Header */}
        <div className="flex items-center justify-between pb-3 border-b border-gray-200">
          <div>
            <h3 className="text-lg font-semibold text-gray-900">Export Investment Case</h3>
            <p className="text-sm text-gray-500">
              Generate a PDF document from your {symbol} research
            </p>
          </div>
          {onClose && (
            <button
              onClick={onClose}
              className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg"
            >
              <X className="w-5 h-5" />
            </button>
          )}
        </div>

        {/* ============================================================ */}
        {/* A. Template                                                   */}
        {/* ============================================================ */}
        <section>
          <h4 className="text-sm font-medium text-gray-700 mb-2 flex items-center gap-2">
            <Palette className="w-4 h-4" />
            Template
          </h4>
          <div className="space-y-2">
            <InvestmentCaseTemplateSelector
              selectedTemplateId={selectedTemplate?.id || null}
              onSelect={setSelectedTemplate}
            />

            {selectedTemplate && (
              <div className="flex items-start justify-between p-3 bg-gray-50 rounded-lg border border-gray-200">
                <div className="min-w-0">
                  <div className="font-medium text-sm text-gray-900">{selectedTemplate.name}</div>
                  {selectedTemplate.description && (
                    <div className="text-xs text-gray-500 mt-0.5 truncate">{selectedTemplate.description}</div>
                  )}
                  <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
                    <span className="text-[10px] px-1.5 py-0.5 bg-gray-100 text-gray-500 rounded font-medium">
                      {selectedTemplate.style_config.pageFormat.toUpperCase()}
                    </span>
                    <span className="text-[10px] px-1.5 py-0.5 bg-gray-100 text-gray-500 rounded capitalize">
                      {selectedTemplate.style_config.fonts.body.family}
                    </span>
                    <span
                      className="text-[10px] px-1.5 py-0.5 rounded flex items-center gap-1"
                      style={{
                        backgroundColor: `${selectedTemplate.style_config.colors.primary}15`,
                        color: selectedTemplate.style_config.colors.primary
                      }}
                    >
                      <span
                        className="w-2 h-2 rounded-full"
                        style={{ backgroundColor: selectedTemplate.style_config.colors.primary }}
                      />
                      Theme
                    </span>
                    {selectedTemplate.branding_config.firmName && (
                      <span className="text-[10px] px-1.5 py-0.5 bg-purple-50 text-purple-600 rounded">
                        {selectedTemplate.branding_config.firmName}
                      </span>
                    )}
                    {selectedTemplate.header_footer_config.header.enabled && (
                      <span className="text-[10px] px-1.5 py-0.5 bg-blue-50 text-blue-600 rounded">Header</span>
                    )}
                    {selectedTemplate.header_footer_config.footer.enabled && (
                      <span className="text-[10px] px-1.5 py-0.5 bg-blue-50 text-blue-600 rounded">Footer</span>
                    )}
                  </div>
                </div>
                <button
                  onClick={() => setShowTemplateEditor(true)}
                  className="text-xs text-primary-600 hover:text-primary-700 flex items-center gap-1 ml-3 flex-shrink-0 pt-0.5"
                >
                  <Edit2 className="w-3 h-3" />
                  Edit
                </button>
              </div>
            )}

            {!selectedTemplate && defaultTemplate && (
              <p className="text-xs text-gray-400">
                Your default template &ldquo;{defaultTemplate.name}&rdquo; will be applied automatically.
              </p>
            )}
          </div>
        </section>

        {/* ============================================================ */}
        {/* B. Snapshot                                                    */}
        {/* ============================================================ */}
        <section>
          <h4 className="text-sm font-medium text-gray-700 mb-2 flex items-center gap-2">
            <Calendar className="w-4 h-4" />
            Snapshot
          </h4>
          <div className="space-y-2.5">
            <div>
              <label className="block text-xs text-gray-500 mb-1">As-of Date</label>
              <input
                type="date"
                value={asOfDate}
                onChange={e => setAsOfDate(e.target.value)}
                className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
              />
            </div>
            <label className="flex items-center gap-2 text-sm text-gray-600">
              <input
                type="checkbox"
                checked={includeDraftChanges}
                onChange={e => setIncludeDraftChanges(e.target.checked)}
                className="rounded border-gray-300 text-primary-600 focus:ring-primary-500"
              />
              <AlertTriangle className="w-3.5 h-3.5 text-amber-500" />
              Include draft changes
            </label>
            {includeDraftChanges && (
              <p className="text-[11px] text-amber-600 pl-7">
                Export will include unsaved edits in current session.
              </p>
            )}
          </div>
        </section>

        {/* ============================================================ */}
        {/* C. Content Scope                                              */}
        {/* ============================================================ */}
        <section>
          <div className="flex items-center gap-2 mb-2">
            <h4 className="text-sm font-medium text-gray-700 flex items-center gap-2">
              <FileStack className="w-4 h-4" />
              Content Scope
            </h4>
            <span className="text-xs text-gray-400">
              {enabledSections.length} sections &middot; {totalEnabledFields} fields
            </span>
            <div className="ml-auto">
              {hasContentModifications && (
                <button
                  onClick={resetToTemplate}
                  className="text-[11px] text-primary-600 hover:text-primary-700 flex items-center gap-1"
                >
                  <RotateCcw className="w-3 h-3" />
                  Reset to Template Structure
                </button>
              )}
            </div>
          </div>

          <p className="text-[11px] text-gray-400 mb-2">
            Using research layout structure &mdash; changes apply to this export only.
          </p>

          {/* Research Sections */}
          <div className="border border-gray-200 rounded-lg divide-y divide-gray-100">
            {sectionConfigs.map(section => {
              const isExpanded = expandedSections.has(section.id)
              const enabledFieldsCount = section.fields?.filter(f => f.enabled).length || 0
              const totalFieldsCount = section.fields?.length || 0
              const modified = isSectionModified(section)

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
                      className="flex-1 flex items-center gap-2 text-left min-w-0"
                    >
                      {isExpanded ? (
                        <ChevronDown className="w-4 h-4 text-gray-400 flex-shrink-0" />
                      ) : (
                        <ChevronRight className="w-4 h-4 text-gray-400 flex-shrink-0" />
                      )}
                      <span className={clsx(
                        'font-medium text-sm truncate',
                        section.enabled ? 'text-gray-900' : 'text-gray-400 line-through'
                      )}>
                        {section.name}
                      </span>
                      <span className="text-xs text-gray-400 flex-shrink-0">
                        ({enabledFieldsCount}/{totalFieldsCount})
                      </span>
                    </button>
                    {/* Modification badges */}
                    {!section.enabled && (
                      <span className="text-[10px] px-1.5 py-0.5 bg-gray-100 text-gray-500 rounded-full font-medium flex-shrink-0">
                        Excluded
                      </span>
                    )}
                    {section.enabled && modified && (
                      <span className="text-[10px] px-1.5 py-0.5 bg-amber-50 text-amber-600 rounded-full font-medium flex-shrink-0">
                        Modified
                      </span>
                    )}
                  </div>

                  {isExpanded && section.fields && (
                    <div className="pl-8 pb-2 space-y-0.5">
                      {section.fields.map(field => (
                        <div
                          key={field.id}
                          className={clsx(
                            'flex items-center gap-1.5 px-2 py-1.5 text-sm rounded hover:bg-gray-50',
                            !section.enabled && 'opacity-50'
                          )}
                        >
                          <GripVertical className="w-3.5 h-3.5 text-gray-300 cursor-grab flex-shrink-0" />
                          <button
                            onClick={() => toggleFieldEnabled(section.id, field.id)}
                            className="text-gray-400 hover:text-primary-600 flex-shrink-0"
                            disabled={!section.enabled}
                          >
                            {field.enabled ? (
                              <CheckSquare className="w-4 h-4 text-primary-600" />
                            ) : (
                              <Square className="w-4 h-4" />
                            )}
                          </button>
                          <span className={clsx(
                            'flex-1 truncate',
                            field.enabled ? 'text-gray-700' : 'text-gray-400'
                          )}>
                            {field.name}
                          </span>
                          <span className="text-[10px] text-gray-400 flex-shrink-0 capitalize">
                            {field.fieldType}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </section>

        {/* ============================================================ */}
        {/* Attachments (separate from research sections)                 */}
        {/* ============================================================ */}
        <section>
          <h4 className="text-sm font-medium text-gray-700 mb-2 flex items-center gap-2">
            <Paperclip className="w-4 h-4" />
            Attachments
          </h4>
          <div className="space-y-2 border border-gray-200 rounded-lg p-3">
            <label className="flex items-center gap-2 text-sm text-gray-400 cursor-not-allowed">
              <input type="checkbox" disabled className="rounded border-gray-300" />
              <Paperclip className="w-3.5 h-3.5" />
              Supporting documents
              <span className="text-[10px] text-gray-400">(0)</span>
              <span className="text-[10px] text-gray-400 ml-auto italic">Coming soon</span>
            </label>
            <label className="flex items-center gap-2 text-sm text-gray-400 cursor-not-allowed">
              <input type="checkbox" disabled className="rounded border-gray-300" />
              <Link className="w-3.5 h-3.5" />
              Linked research
              <span className="text-[10px] text-gray-400">(0)</span>
              <span className="text-[10px] text-gray-400 ml-auto italic">Coming soon</span>
            </label>
            <label className="flex items-center gap-2 text-sm text-gray-400 cursor-not-allowed">
              <input type="checkbox" disabled className="rounded border-gray-300" />
              <BookOpen className="w-3.5 h-3.5" />
              Appendix
              <span className="text-[10px] text-gray-400 ml-auto italic">Coming soon</span>
            </label>
          </div>
        </section>

        {/* ============================================================ */}
        {/* D. Output                                                     */}
        {/* ============================================================ */}
        <section>
          <h4 className="text-sm font-medium text-gray-700 mb-2 flex items-center gap-2">
            <Download className="w-4 h-4" />
            Output
          </h4>
          <div className="space-y-3">
            {/* Format */}
            <div className="grid grid-cols-2 gap-2">
              <button
                className="px-3 py-2 text-sm rounded-lg border border-primary-300 bg-primary-50 text-primary-700 text-center"
              >
                <FileText className="w-4 h-4 mx-auto mb-0.5" />
                Single PDF
              </button>
              <button
                disabled
                className="px-3 py-2 text-sm rounded-lg border border-gray-200 text-gray-400 text-center cursor-not-allowed"
              >
                <FileStack className="w-4 h-4 mx-auto mb-0.5 opacity-50" />
                <span className="opacity-50">Packet</span>
                <span className="text-[10px] block text-gray-400 mt-0.5">
                  Attachments &amp; linked research
                </span>
                <span className="text-[10px] block text-gray-400 italic">Available soon</span>
              </button>
            </div>

            {/* Filename */}
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-xs text-gray-500">Filename</label>
                {filenameOverride.trim() && (
                  <button
                    onClick={() => setFilenameOverride('')}
                    className="text-[11px] text-primary-600 hover:text-primary-700 flex items-center gap-1"
                  >
                    <RotateCcw className="w-3 h-3" />
                    Reset to suggested
                  </button>
                )}
              </div>
              <input
                type="text"
                value={filenameOverride}
                onChange={e => setFilenameOverride(e.target.value)}
                placeholder={defaultFilename}
                className="w-full px-3 py-1.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
              />
              {!filenameOverride.trim() && (
                <p className="text-[10px] text-gray-400 mt-1">
                  {'{{symbol}}_Investment_Case_{{asOfDate}}.pdf'}
                </p>
              )}
            </div>

            {/* Export Summary */}
            <div className="p-2.5 bg-gray-50 rounded-lg border border-gray-100">
              <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[11px]">
                <div className="text-gray-400">Template</div>
                <div className="text-gray-700 font-medium truncate">{effectiveTemplateName}</div>
                <div className="text-gray-400">Sections</div>
                <div className="text-gray-700 font-medium">{enabledSections.length}</div>
                <div className="text-gray-400">Fields</div>
                <div className="text-gray-700 font-medium">{totalEnabledFields}</div>
                <div className="text-gray-400">As-of</div>
                <div className="text-gray-700 font-medium">{formattedAsOfDate}</div>
                <div className="text-gray-400">Draft changes</div>
                <div className={clsx('font-medium', includeDraftChanges ? 'text-amber-600' : 'text-gray-700')}>
                  {includeDraftChanges ? 'Included' : 'Excluded'}
                </div>
                <div className="text-gray-400">Mode</div>
                <div className="text-gray-700 font-medium">Single PDF</div>
              </div>
            </div>

            {/* Generate */}
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
        </section>

        {/* ============================================================ */}
        {/* Advanced Overrides (collapsible)                              */}
        {/* ============================================================ */}
        <section className="border-t border-gray-200 pt-3">
          <button
            onClick={() => setShowAdvanced(!showAdvanced)}
            className="flex items-center gap-2 text-sm text-gray-500 hover:text-gray-700 w-full"
          >
            {showAdvanced ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            Advanced Overrides
          </button>

          {showAdvanced && (
            <div className="mt-3 p-3 border border-gray-200 rounded-lg space-y-3 bg-gray-50/50">
              <p className="text-[11px] text-gray-400 italic">
                These settings apply to this export only and do not modify your template.
              </p>

              {/* Custom export title */}
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1 flex items-center gap-1">
                  <Type className="w-3 h-3" />
                  Custom Export Title
                </label>
                <input
                  type="text"
                  value={customExportTitle}
                  onChange={e => setCustomExportTitle(e.target.value)}
                  placeholder={`Investment Case: ${symbol}`}
                  className="w-full px-3 py-1.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
                />
              </div>

              {/* Temporary watermark */}
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">
                  Temporary Watermark
                </label>
                <input
                  type="text"
                  value={tempWatermarkText}
                  onChange={e => setTempWatermarkText(e.target.value)}
                  placeholder="e.g., Draft, Confidential"
                  className="w-full px-3 py-1.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
                />
              </div>

              {/* Hide cover page */}
              <label className="flex items-center gap-2 text-sm text-gray-600">
                <input
                  type="checkbox"
                  checked={hideCoverPage}
                  onChange={e => setHideCoverPage(e.target.checked)}
                  className="rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                />
                <EyeOff className="w-3.5 h-3.5 text-gray-400" />
                Hide cover page
              </label>

              {/* Exclude header/footer */}
              <label className="flex items-center gap-2 text-sm text-gray-600">
                <input
                  type="checkbox"
                  checked={excludeHeaderFooter}
                  onChange={e => setExcludeHeaderFooter(e.target.checked)}
                  className="rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                />
                <EyeOff className="w-3.5 h-3.5 text-gray-400" />
                Exclude header &amp; footer
              </label>
            </div>
          )}
        </section>
      </div>

      {/* Template Editor Modal */}
      {showTemplateEditor && selectedTemplate && (
        <InvestmentCaseTemplateEditor
          template={selectedTemplate}
          onClose={() => setShowTemplateEditor(false)}
        />
      )}
    </>
  )
}

// ============================================================================
// HELPER: Get content for a field
// ============================================================================

// Map field slugs to contribution section keys
const SLUG_TO_SECTION: Record<string, string[]> = {
  'investment-thesis': ['thesis'],
  'thesis': ['thesis'],
  'where_different': ['where_different'],
  'where-different': ['where_different'],
  'risks_to_thesis': ['risks_to_thesis'],
  'risks-to-thesis': ['risks_to_thesis'],
  'key-risks': ['risks_to_thesis', 'risks'],
  'price_targets': ['price_target', 'price_targets'],
  'price-targets': ['price_target', 'price_targets'],
  'key_catalysts': ['catalysts', 'key_catalysts'],
  'catalysts': ['catalysts', 'key_catalysts'],
  'bull-case': ['bull_case'],
  'bull_case': ['bull_case'],
  'bear-case': ['bear_case'],
  'bear_case': ['bear_case'],
  'business_model': ['business_model'],
  'business-model': ['business_model'],
  'rating': ['rating'],
  'estimates': ['estimates'],
}

function getFieldContent(field: FieldConfig, contributions: any[]): string | null {
  // 1. Try known slug → section mapping
  const sectionKeys = SLUG_TO_SECTION[field.slug]
  if (sectionKeys) {
    for (const key of sectionKeys) {
      const contrib = contributions.find((c: any) => c.section === key)
      if (contrib?.content) return contrib.content
    }
  }

  // 2. Try direct match (slug === section)
  const direct = contributions.find((c: any) => c.section === field.slug)
  if (direct?.content) return direct.content

  // 3. Try normalized match (hyphens → underscores)
  const normalized = field.slug.replace(/-/g, '_')
  if (normalized !== field.slug) {
    const norm = contributions.find((c: any) => c.section === normalized)
    if (norm?.content) return norm.content
  }

  return null
}

// Convert HTML to formatted plain text, preserving list structure
function stripHtml(html: string): string {
  // Normalize line-break tags first
  let text = html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<\/h[1-6]>/gi, '\n')

  // Convert list items to bullet lines
  text = text.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, (_match, inner) => {
    const clean = inner.replace(/<[^>]*>/g, '').trim()
    return `- ${clean}\n`
  })

  // Remove remaining tags
  text = text.replace(/<[^>]*>/g, '')

  // Clean up whitespace: collapse multiple blank lines, trim each line
  text = text
    .split('\n')
    .map(line => line.trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()

  return text
}

/** Replace Unicode characters that jsPDF built-in fonts can't render */
function sanitizeForPdf(text: string): string {
  return text
    .replace(/\u2014/g, '--')       // em dash
    .replace(/\u2013/g, '-')        // en dash
    .replace(/\u2192/g, '->')       // right arrow
    .replace(/\u2190/g, '<-')       // left arrow
    .replace(/\u2022/g, '-')        // bullet (we render our own)
    .replace(/\u201C|\u201D/g, '"') // smart double quotes
    .replace(/\u2018|\u2019/g, "'") // smart single quotes
    .replace(/\u2026/g, '...')      // ellipsis
    .replace(/\u00B7/g, '.')        // middle dot
    .replace(/\u2011/g, '-')        // non-breaking hyphen
    .replace(/[^\x00-\x7F]/g, (ch) => {
      // Last resort: replace any remaining non-ASCII with a safe fallback
      // Keep common accented chars (Latin-1 Supplement range 0x80-0xFF)
      const code = ch.charCodeAt(0)
      if (code >= 0x80 && code <= 0xFF) return ch
      return ''
    })
}
