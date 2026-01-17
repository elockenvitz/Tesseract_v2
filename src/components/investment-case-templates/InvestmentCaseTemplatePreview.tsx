import { clsx } from 'clsx'
import { FileText, Building, Image } from 'lucide-react'
import { InvestmentCaseTemplate } from '../../types/investmentCaseTemplates'

interface Props {
  template: InvestmentCaseTemplate
  symbol?: string
  companyName?: string
  currentPrice?: number
}

export function InvestmentCaseTemplatePreview({
  template,
  symbol = 'AAPL',
  companyName = 'Apple Inc.',
  currentPrice = 185.50
}: Props) {
  const { cover_config, style_config, branding_config, section_config, toc_config, header_footer_config } = template

  const enabledSections = section_config.filter(s => s.enabled)

  // Calculate page dimensions (scaled down for preview)
  const scale = 0.5
  const pageWidth = style_config.pageFormat === 'letter' ? 216 : style_config.pageFormat === 'legal' ? 216 : 210
  const pageHeight = style_config.pageFormat === 'letter' ? 279 : style_config.pageFormat === 'legal' ? 356 : 297

  const scaledWidth = pageWidth * scale
  const scaledHeight = pageHeight * scale

  return (
    <div className="space-y-4">
      <h4 className="text-sm font-medium text-gray-700">Live Preview</h4>

      <div className="space-y-4">
        {/* Cover Page Preview */}
        <div
          className="bg-white rounded shadow-lg relative overflow-hidden mx-auto"
          style={{
            width: `${scaledWidth}mm`,
            minHeight: `${scaledHeight}mm`,
            fontFamily: style_config.fonts.body.family === 'times' ? 'Times New Roman' :
                       style_config.fonts.body.family === 'courier' ? 'Courier New' : 'Helvetica, Arial, sans-serif'
          }}
        >
          {/* Header (if enabled and showOnFirstPage) */}
          {header_footer_config.header.enabled && header_footer_config.header.showOnFirstPage && (
            <div
              className="absolute top-0 left-0 right-0 px-3 py-1 text-center border-b"
              style={{
                fontSize: `${8 * scale}pt`,
                color: style_config.colors.mutedText,
                borderColor: style_config.colors.secondary + '40'
              }}
            >
              {header_footer_config.header.content || branding_config.firmName || 'Header Content'}
            </div>
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
              cover_config.logoPosition === 'bottom-right' && 'bottom-8 right-2'
            )}>
              {branding_config.logoPath ? (
                <div
                  className="bg-gray-100 rounded flex items-center justify-center"
                  style={{
                    width: `${branding_config.logoWidth * scale * 0.8}mm`,
                    height: `${(branding_config.logoHeight || branding_config.logoWidth * 0.5) * scale * 0.8}mm`
                  }}
                >
                  <Image className="w-4 h-4 text-gray-400" />
                </div>
              ) : branding_config.firmName ? (
                <span
                  style={{
                    fontSize: `${10 * scale}pt`,
                    fontWeight: 'bold',
                    color: style_config.colors.primary
                  }}
                >
                  {branding_config.firmName}
                </span>
              ) : null}
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
              style={{
                fontSize: `${style_config.fonts.title.size * scale}pt`,
                fontWeight: style_config.fonts.title.weight === 'bold' ? 700 : 400,
                color: style_config.colors.headingText
              }}
            >
              {cover_config.customTitle || `Investment Case: ${symbol}`}
            </h1>

            {cover_config.showCompanyName && (
              <p
                className="mt-2"
                style={{
                  fontSize: `${style_config.fonts.heading.size * scale}pt`,
                  color: style_config.colors.secondary
                }}
              >
                {companyName}
              </p>
            )}

            {cover_config.showCurrentPrice && (
              <p
                className="mt-1"
                style={{
                  fontSize: `${style_config.fonts.subheading.size * scale}pt`,
                  color: style_config.colors.text
                }}
              >
                Current Price: ${currentPrice.toFixed(2)}
              </p>
            )}
          </div>

          {/* Metadata */}
          <div className="absolute bottom-10 left-0 right-0 text-center">
            {cover_config.includeDate && (
              <p
                style={{
                  fontSize: `${8 * scale}pt`,
                  color: style_config.colors.mutedText
                }}
              >
                Generated: {new Date().toLocaleDateString('en-US', {
                  year: 'numeric',
                  month: 'long',
                  day: 'numeric'
                })}
              </p>
            )}
            {cover_config.includeAuthor && (
              <p
                style={{
                  fontSize: `${8 * scale}pt`,
                  color: style_config.colors.mutedText
                }}
              >
                Prepared using Tesseract Research Platform
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
          {header_footer_config.footer.enabled && (
            <div
              className="absolute bottom-0 left-0 right-0 px-3 py-1 text-center border-t"
              style={{
                fontSize: `${8 * scale}pt`,
                color: style_config.colors.mutedText,
                borderColor: style_config.colors.secondary + '40'
              }}
            >
              {header_footer_config.footer.showPageNumber && (
                <span>{header_footer_config.footer.pageNumberFormat.replace('{page}', '1').replace('{total}', '3')}</span>
              )}
            </div>
          )}

          {/* Watermark */}
          {branding_config.watermarkEnabled && branding_config.watermarkText && (
            <div
              className="absolute inset-0 flex items-center justify-center pointer-events-none"
              style={{
                opacity: branding_config.watermarkOpacity
              }}
            >
              <span
                className="text-gray-400 font-bold rotate-[-30deg]"
                style={{
                  fontSize: `${24 * scale}pt`
                }}
              >
                {branding_config.watermarkText}
              </span>
            </div>
          )}
        </div>

        {/* TOC Preview (if enabled) */}
        {toc_config.enabled && (
          <div
            className="bg-white rounded shadow-lg relative overflow-hidden mx-auto p-4"
            style={{
              width: `${scaledWidth}mm`,
              minHeight: `${scaledHeight * 0.6}mm`
            }}
          >
            <h2
              style={{
                fontSize: `${style_config.fonts.heading.size * scale}pt`,
                fontWeight: 'bold',
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
            className="bg-white rounded shadow-lg relative overflow-hidden mx-auto p-4"
            style={{
              width: `${scaledWidth}mm`,
              minHeight: `${scaledHeight * 0.6}mm`
            }}
          >
            {/* Sample Section */}
            <div className="mb-4">
              <div
                className="pb-1 mb-2"
                style={{
                  borderBottomWidth: '1px',
                  borderBottomStyle: 'solid',
                  borderBottomColor: style_config.colors.primary
                }}
              >
                <h2
                  style={{
                    fontSize: `${style_config.fonts.heading.size * scale}pt`,
                    fontWeight: 'bold',
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
                      color: style_config.colors.headingText,
                      marginBottom: '2px'
                    }}
                  >
                    {field.name}
                  </h3>
                  <p
                    style={{
                      fontSize: `${style_config.fonts.body.size * scale}pt`,
                      color: style_config.colors.text
                    }}
                  >
                    Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore.
                  </p>
                </div>
              ))}
            </div>

            {/* Footer */}
            {header_footer_config.footer.enabled && (
              <div
                className="absolute bottom-0 left-0 right-0 px-3 py-1 text-center border-t"
                style={{
                  fontSize: `${8 * scale}pt`,
                  color: style_config.colors.mutedText,
                  borderColor: style_config.colors.secondary + '40'
                }}
              >
                {header_footer_config.footer.content && (
                  <span className="mr-2">{header_footer_config.footer.content}</span>
                )}
                {header_footer_config.footer.showPageNumber && (
                  <span>{header_footer_config.footer.pageNumberFormat.replace('{page}', '2').replace('{total}', '3')}</span>
                )}
              </div>
            )}
          </div>
        )}

        {/* Info */}
        <div className="text-xs text-gray-500 text-center">
          Preview is scaled. Actual PDF will be full size.
        </div>
      </div>
    </div>
  )
}
