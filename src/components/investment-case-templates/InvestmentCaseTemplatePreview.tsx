import { clsx } from 'clsx'
import { Image } from 'lucide-react'
import {
  InvestmentCaseTemplate,
  TemplatePreviewContext,
  DEFAULT_PREVIEW_CONTEXT,
  resolveTemplateVariables
} from '../../types/investmentCaseTemplates'

const HIGHLIGHT_CLASS = 'ring-2 ring-primary-400/60 ring-offset-1 rounded-sm transition-all duration-300'

interface Props {
  template: InvestmentCaseTemplate
  previewContext?: TemplatePreviewContext
  highlightArea?: string | null
  highlightBranding?: boolean
  showMarginGuides?: boolean
  /** @deprecated Use previewContext instead */
  symbol?: string
  /** @deprecated Use previewContext instead */
  companyName?: string
  /** @deprecated Use previewContext instead */
  currentPrice?: number
}

export function InvestmentCaseTemplatePreview({
  template,
  previewContext,
  highlightArea,
  highlightBranding,
  showMarginGuides,
  symbol,
  companyName,
  currentPrice
}: Props) {
  const { cover_config, style_config, branding_config, section_config, toc_config, header_footer_config } = template

  // Build context: prefer previewContext, fall back to legacy props, then defaults
  const ctx: TemplatePreviewContext = previewContext || {
    ...DEFAULT_PREVIEW_CONTEXT,
    ...(symbol ? { symbol } : {}),
    ...(companyName ? { companyName } : {}),
    ...(currentPrice != null ? { currentPrice } : {}),
    firmName: branding_config.firmName || '',
  }

  const enabledSections = section_config.filter(s => s.enabled)

  // Resolve title with template variables
  const defaultTitleText = ctx.mode === 'packet'
    ? `Investment Case Packet: ${ctx.symbol}`
    : `Investment Case: ${ctx.symbol}`
  const resolvedTitle = cover_config.customTitle
    ? resolveTemplateVariables(cover_config.customTitle, ctx)
    : defaultTitleText

  // Calculate page dimensions in px (fixed preview width, aspect ratio preserved)
  const PREVIEW_WIDTH = 280 // px — fits comfortably in the preview panel
  const scale = 0.5 // font scale factor
  const isLandscape = style_config.orientation === 'landscape'
  const baseW = style_config.pageFormat === 'letter' ? 216 : style_config.pageFormat === 'legal' ? 216 : 210
  const baseH = style_config.pageFormat === 'letter' ? 279 : style_config.pageFormat === 'legal' ? 356 : 297
  const pageW = isLandscape ? baseH : baseW
  const pageH = isLandscape ? baseW : baseH
  const aspectRatio = pageH / pageW
  const scaledWidth = PREVIEW_WIDTH
  const scaledHeight = Math.round(PREVIEW_WIDTH * aspectRatio)

  // Map jsPDF font family names to CSS font-family stacks
  const fontFamilyCss = (family: string) =>
    family === 'times' ? '"Times New Roman", Times, serif' :
    family === 'courier' ? '"Courier New", Courier, monospace' :
    'Helvetica, Arial, sans-serif'

  // Margin guides — scaled from mm to preview px
  const mmToPx = PREVIEW_WIDTH / pageW
  const marginGuides = {
    top: Math.round(style_config.margins.top * mmToPx),
    right: Math.round(style_config.margins.right * mmToPx),
    bottom: Math.round(style_config.margins.bottom * mmToPx),
    left: Math.round(style_config.margins.left * mmToPx),
  }

  return (
    <div className="space-y-3">
      <div className="space-y-3">
        {/* Cover Page Preview */}
        <div
          className={clsx(
            'bg-white rounded-sm shadow-[0_1px_4px_rgba(0,0,0,0.12),0_0_0_1px_rgba(0,0,0,0.04)] relative overflow-hidden mx-auto transition-all duration-300',
            highlightArea === 'margins' && 'ring-2 ring-primary-400/60'
          )}
          style={{
            width: `${scaledWidth}px`,
            minHeight: `${scaledHeight}px`,
            fontFamily: fontFamilyCss(style_config.fonts.body.family)
          }}
        >
          {/* Margin Guides Overlay */}
          {showMarginGuides && (
            <div className="absolute inset-0 pointer-events-none z-10">
              {/* Top margin */}
              <div className="absolute top-0 left-0 right-0 border-b border-dashed border-rose-400/50" style={{ height: `${marginGuides.top}px` }}>
                <span className="absolute right-1 bottom-0 text-[7px] text-rose-400">{style_config.margins.top}</span>
              </div>
              {/* Bottom margin */}
              <div className="absolute bottom-0 left-0 right-0 border-t border-dashed border-rose-400/50" style={{ height: `${marginGuides.bottom}px` }}>
                <span className="absolute right-1 top-0 text-[7px] text-rose-400">{style_config.margins.bottom}</span>
              </div>
              {/* Left margin */}
              <div className="absolute top-0 bottom-0 left-0 border-r border-dashed border-rose-400/50" style={{ width: `${marginGuides.left}px` }} />
              {/* Right margin */}
              <div className="absolute top-0 bottom-0 right-0 border-l border-dashed border-rose-400/50" style={{ width: `${marginGuides.right}px` }} />
            </div>
          )}
          {/* Header (if enabled and visible on cover) */}
          {header_footer_config.header.enabled && (header_footer_config.header.coverBehavior || 'hide') !== 'hide' && (
            (() => {
              const ha = header_footer_config.header.alignment || 'center'
              const hContent = ha === 'split'
                ? null
                : (header_footer_config.header.content || branding_config.firmName || 'Header Content')
              return (
                <div
                  className={clsx(
                    'absolute top-0 left-0 right-0 px-3 py-1 border-b',
                    highlightArea === 'header' && HIGHLIGHT_CLASS,
                    ha === 'split' ? 'flex justify-between' :
                    ha === 'right' ? 'text-right' :
                    ha === 'left' ? 'text-left' : 'text-center'
                  )}
                  style={{
                    fontSize: `${8 * scale}pt`,
                    color: style_config.colors.mutedText,
                    borderColor: style_config.colors.secondary + '40'
                  }}
                >
                  {ha === 'split' ? (
                    <>
                      <span>{header_footer_config.header.leftContent || branding_config.firmName || ''}</span>
                      <span>{header_footer_config.header.rightContent || ''}</span>
                    </>
                  ) : (
                    <span>{hContent}</span>
                  )}
                </div>
              )
            })()
          )}

          {/* Logo (if enabled) */}
          {cover_config.showLogo && (
            <div className={clsx(
              'absolute p-2',
              cover_config.logoPosition === 'top-left' && 'top-2 left-2',
              cover_config.logoPosition === 'top-center' && 'top-2 left-1/2 -translate-x-1/2',
              cover_config.logoPosition === 'top-right' && 'top-2 right-2',
              cover_config.logoPosition === 'bottom-left' && 'bottom-8 left-2',
              cover_config.logoPosition === 'bottom-center' && 'bottom-8 left-1/2 -translate-x-1/2',
              cover_config.logoPosition === 'bottom-right' && 'bottom-8 right-2',
              (highlightArea === 'logo' || highlightBranding) && HIGHLIGHT_CLASS
            )}>
              {branding_config.logoPath ? (
                <div
                  className="bg-gray-100 rounded flex items-center justify-center"
                  style={{
                    width: `${Math.round(branding_config.logoWidth * scale * 0.8 * 3.78)}px`,
                    height: `${Math.round((branding_config.logoHeight || branding_config.logoWidth * 0.5) * scale * 0.8 * 3.78)}px`
                  }}
                >
                  <Image className="w-4 h-4 text-gray-400" />
                </div>
              ) : branding_config.firmName ? (
                <span
                  className={clsx((highlightArea === 'firmName' || highlightBranding) && HIGHLIGHT_CLASS)}
                  style={{
                    fontSize: `${10 * scale}pt`,
                    fontWeight: 'bold',
                    color: style_config.colors.primary
                  }}
                >
                  {branding_config.firmName}
                </span>
              ) : (
                <div
                  className="bg-gray-100 rounded flex items-center justify-center"
                  style={{
                    width: `${Math.round(branding_config.logoWidth * scale * 0.8 * 3.78)}px`,
                    height: `${Math.round((branding_config.logoHeight || branding_config.logoWidth * 0.5) * scale * 0.8 * 3.78)}px`
                  }}
                >
                  <Image className="w-4 h-4 text-gray-300" />
                </div>
              )}
            </div>
          )}

          {/* Title Section */}
          <div
            className={clsx(
              'pt-16 px-4',
              cover_config.titlePosition === 'left' && 'text-left',
              cover_config.titlePosition === 'center' && 'text-center',
              cover_config.titlePosition === 'right' && 'text-right'
            )}
          >
            <h1
              className={highlightArea === 'title' ? HIGHLIGHT_CLASS : undefined}
              style={{
                fontSize: `${style_config.fonts.title.size * scale}pt`,
                fontWeight: style_config.fonts.title.weight === 'bold' ? 700 : 400,
                fontFamily: fontFamilyCss(style_config.fonts.title.family),
                color: style_config.colors.headingText
              }}
            >
              {resolvedTitle}
            </h1>

            {cover_config.showCompanyName && (
              <p
                className="mt-2"
                style={{
                  fontSize: `${style_config.fonts.heading.size * scale}pt`,
                  fontFamily: fontFamilyCss(style_config.fonts.heading.family),
                  color: style_config.colors.secondary
                }}
              >
                {ctx.companyName}
              </p>
            )}

            {cover_config.showCurrentPrice && (
              <p
                className="mt-1"
                style={{
                  fontSize: `${style_config.fonts.subheading.size * scale}pt`,
                  fontFamily: fontFamilyCss(style_config.fonts.subheading.family),
                  color: style_config.colors.text
                }}
              >
                Current Price: ${ctx.currentPrice.toFixed(2)}
              </p>
            )}
          </div>

          {/* Metadata */}
          <div className="absolute bottom-10 left-0 right-0 text-center space-y-0.5">
            {cover_config.includeDate && (
              <p
                style={{
                  fontSize: `${8 * scale}pt`,
                  color: style_config.colors.mutedText
                }}
              >
                As of: {ctx.asOfDate}
              </p>
            )}
            {cover_config.includeAuthor && (
              <p
                style={{
                  fontSize: `${8 * scale}pt`,
                  color: style_config.colors.mutedText
                }}
              >
                Prepared by: {ctx.author}
              </p>
            )}
            {cover_config.includeTimestamp && (
              <p
                style={{
                  fontSize: `${7 * scale}pt`,
                  color: style_config.colors.mutedText
                }}
              >
                Generated: {new Date().toLocaleDateString('en-US', {
                  year: 'numeric',
                  month: 'long',
                  day: 'numeric',
                  hour: '2-digit',
                  minute: '2-digit'
                })}
              </p>
            )}
          </div>

          {/* Disclaimer */}
          {cover_config.includeDisclaimer && (
            <div className="absolute bottom-3 left-0 right-0 px-4 text-center">
              <p
                style={{
                  fontSize: `${6 * scale}pt`,
                  color: style_config.colors.mutedText
                }}
              >
                {cover_config.disclaimerText.substring(0, 100)}...
              </p>
            </div>
          )}

          {/* Footer */}
          {header_footer_config.footer.enabled && (() => {
            const fa = header_footer_config.footer.alignment || 'center'
            const pageNum = header_footer_config.footer.showPageNumber
              ? header_footer_config.footer.pageNumberFormat.replace('{page}', '1').replace('{total}', '3')
              : null
            const pnPos = header_footer_config.footer.pageNumberPosition || 'center'
            const fContent = header_footer_config.footer.content
            return (
              <div
                className={clsx(
                  'absolute bottom-0 left-0 right-0 px-3 py-1 border-t',
                  highlightArea === 'footer' && HIGHLIGHT_CLASS,
                  fa === 'split' ? 'flex justify-between' :
                  fa === 'right' ? 'text-right' :
                  fa === 'left' ? 'text-left' : 'text-center'
                )}
                style={{
                  fontSize: `${8 * scale}pt`,
                  color: style_config.colors.mutedText,
                  borderColor: style_config.colors.secondary + '40'
                }}
              >
                {fa === 'split' ? (
                  <>
                    <span>{header_footer_config.footer.leftContent || fContent || ''}</span>
                    <span>{header_footer_config.footer.rightContent || (pageNum || '')}</span>
                  </>
                ) : pnPos === 'inline' ? (
                  <span>{fContent}{fContent && pageNum ? ' \u00B7 ' : ''}{pageNum}</span>
                ) : (
                  <div className="flex justify-between">
                    <span className={clsx(pnPos === 'left' && 'order-first')}>{pnPos === 'left' ? pageNum : (fa === 'left' ? (fContent || '') : '')}</span>
                    <span>{fa === 'center' ? (fContent || '') : ''}</span>
                    <span className={clsx(pnPos === 'right' && 'order-last')}>{pnPos === 'right' ? pageNum : (fa === 'right' ? (fContent || '') : '')}</span>
                  </div>
                )}
              </div>
            )
          })()}

          {/* Watermark */}
          {branding_config.watermarkEnabled && branding_config.watermarkText && (() => {
            const position = branding_config.watermarkPosition || 'diagonal'
            return (
              <div
                className={clsx(
                  'absolute pointer-events-none',
                  (highlightArea === 'watermark' || highlightBranding) && HIGHLIGHT_CLASS,
                  position === 'footer'
                    ? 'bottom-6 left-0 right-0 text-center'
                    : 'inset-0 flex items-center justify-center'
                )}
                style={{ opacity: branding_config.watermarkOpacity }}
              >
                <span
                  className={clsx(
                    'text-gray-400 font-bold',
                    position === 'diagonal' && 'rotate-[-30deg]'
                  )}
                  style={{
                    fontSize: `${(position === 'footer' ? 14 : 24) * scale}pt`
                  }}
                >
                  {branding_config.watermarkText}
                </span>
              </div>
            )
          })()}

          {/* Packet mode indicator */}
          {ctx.mode === 'packet' && (
            <div className="absolute top-1/2 left-0 right-0 mt-6 px-4 text-center space-y-1">
              <div className="border-t border-dashed border-gray-300 mx-4" />
              <p
                style={{
                  fontSize: `${7 * scale}pt`,
                  color: style_config.colors.mutedText
                }}
              >
                Includes: Investment Case + Attachments (2)
              </p>
            </div>
          )}
        </div>

        {/* TOC Preview (if enabled) */}
        {toc_config.enabled && (
          <div
            className="bg-white rounded-sm shadow-[0_1px_4px_rgba(0,0,0,0.12),0_0_0_1px_rgba(0,0,0,0.04)] relative overflow-hidden mx-auto p-4"
            style={{
              width: `${scaledWidth}px`,
              minHeight: `${Math.round(scaledHeight * 0.6)}px`,
              fontFamily: fontFamilyCss(style_config.fonts.body.family)
            }}
          >
            <h2
              style={{
                fontSize: `${style_config.fonts.heading.size * scale}pt`,
                fontWeight: 'bold',
                fontFamily: fontFamilyCss(style_config.fonts.heading.family),
                color: style_config.colors.headingText,
                marginBottom: '8px'
              }}
            >
              {toc_config.title}
            </h2>
            <div className="space-y-1">
              {enabledSections.map((section, index) => (
                <div key={section.id} className="flex items-center justify-between">
                  <span
                    style={{
                      fontSize: `${style_config.fonts.body.size * scale}pt`,
                      color: style_config.colors.text
                    }}
                  >
                    {index + 1}. {section.name}
                  </span>
                  {toc_config.showPageNumbers && (
                    <span
                      style={{
                        fontSize: `${style_config.fonts.body.size * scale}pt`,
                        color: style_config.colors.mutedText
                      }}
                    >
                      {index + 2}
                    </span>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Content Section Preview */}
        {enabledSections.length > 0 && (
          <div
            className="bg-white rounded-sm shadow-[0_1px_4px_rgba(0,0,0,0.12),0_0_0_1px_rgba(0,0,0,0.04)] relative overflow-hidden mx-auto p-4"
            style={{
              width: `${scaledWidth}px`,
              minHeight: `${Math.round(scaledHeight * 0.6)}px`,
              fontFamily: fontFamilyCss(style_config.fonts.body.family)
            }}
          >
            {/* Sample Section */}
            <div className="mb-4">
              <div
                className={clsx('pb-1 mb-2', highlightArea === 'primary' && HIGHLIGHT_CLASS)}
                style={{
                  borderBottomWidth: '1px',
                  borderBottomStyle: 'solid',
                  borderBottomColor: style_config.colors.primary
                }}
              >
                <h2
                  className={highlightArea === 'heading' ? HIGHLIGHT_CLASS : undefined}
                  style={{
                    fontSize: `${style_config.fonts.heading.size * scale}pt`,
                    fontWeight: 'bold',
                    fontFamily: fontFamilyCss(style_config.fonts.heading.family),
                    color: style_config.colors.primary
                  }}
                >
                  {enabledSections[0].name}
                </h2>
              </div>

              {enabledSections[0].fields.filter(f => f.enabled).slice(0, 2).map(field => (
                <div key={field.id} className="mb-2">
                  <h3
                    style={{
                      fontSize: `${style_config.fonts.subheading.size * scale}pt`,
                      fontWeight: style_config.fonts.subheading.weight === 'bold' ? 600 : 400,
                      fontFamily: fontFamilyCss(style_config.fonts.subheading.family),
                      color: style_config.colors.headingText,
                      marginBottom: '2px'
                    }}
                  >
                    {field.name}
                  </h3>
                  <p
                    className={highlightArea === 'body' ? HIGHLIGHT_CLASS : undefined}
                    style={{
                      fontSize: `${style_config.fonts.body.size * scale}pt`,
                      fontFamily: fontFamilyCss(style_config.fonts.body.family),
                      color: style_config.colors.text
                    }}
                  >
                    Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore.
                  </p>
                </div>
              ))}
            </div>

            {/* Footer */}
            {header_footer_config.footer.enabled && (() => {
              const fa = header_footer_config.footer.alignment || 'center'
              const pageNum = header_footer_config.footer.showPageNumber
                ? header_footer_config.footer.pageNumberFormat.replace('{page}', '2').replace('{total}', '3')
                : null
              const pnPos = header_footer_config.footer.pageNumberPosition || 'center'
              const fContent = header_footer_config.footer.content
              return (
                <div
                  className={clsx(
                    'absolute bottom-0 left-0 right-0 px-3 py-1 border-t',
                    fa === 'split' ? 'flex justify-between' :
                    fa === 'right' ? 'text-right' :
                    fa === 'left' ? 'text-left' : 'text-center'
                  )}
                  style={{
                    fontSize: `${8 * scale}pt`,
                    color: style_config.colors.mutedText,
                    borderColor: style_config.colors.secondary + '40'
                  }}
                >
                  {fa === 'split' ? (
                    <>
                      <span>{header_footer_config.footer.leftContent || fContent || ''}</span>
                      <span>{header_footer_config.footer.rightContent || (pageNum || '')}</span>
                    </>
                  ) : pnPos === 'inline' ? (
                    <span>{fContent}{fContent && pageNum ? ' \u00B7 ' : ''}{pageNum}</span>
                  ) : (
                    <div className="flex justify-between">
                      <span>{pnPos === 'left' ? pageNum : (fa === 'left' ? (fContent || '') : '')}</span>
                      <span>{fa === 'center' ? (fContent || '') : ''}</span>
                      <span>{pnPos === 'right' ? pageNum : (fa === 'right' ? (fContent || '') : '')}</span>
                    </div>
                  )}
                </div>
              )
            })()}
          </div>
        )}

        {/* Info */}
        <div className="text-[10px] text-gray-400 text-center pt-1">
          Scaled preview. Actual PDF renders at full size.
        </div>
      </div>
    </div>
  )
}
