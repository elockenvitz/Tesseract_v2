// ============================================================================
// Investment Case Template Types - PDF Output Formatting
// ============================================================================

// Cover Page Configuration
export interface CoverPageConfig {
  includeDate: boolean
  includeAuthor: boolean
  includeDisclaimer: boolean
  customTitle: string | null
  disclaimerText: string
  showCompanyName: boolean
  showCurrentPrice: boolean
  showLogo: boolean
  titlePosition: 'left' | 'center' | 'right'
  logoPosition: 'top-left' | 'top-center' | 'top-right' | 'bottom-left' | 'bottom-center' | 'bottom-right'
  includeTimestamp: boolean
  useOrgBranding: boolean
  useOrgDisclaimer: boolean
}

// Font Configuration
export interface FontConfig {
  family: 'helvetica' | 'times' | 'courier'
  size: number
  weight: 'normal' | 'bold'
}

// Margin Configuration
export interface MarginConfig {
  top: number
  right: number
  bottom: number
  left: number
}

// Color Configuration
export interface ColorConfig {
  primary: string      // Main brand color
  secondary: string    // Secondary color
  text: string         // Body text color
  headingText: string  // Heading text color
  mutedText: string    // Muted/secondary text color
  accent: string       // Accent color for highlights
}

// Spacing Configuration
export interface SpacingConfig {
  sectionGap: number   // Gap between sections (mm)
  fieldGap: number     // Gap between fields (mm)
  paragraphGap: number // Gap between paragraphs (mm)
}

// Style Configuration
export interface StyleConfig {
  pageFormat: 'a4' | 'letter' | 'legal'
  orientation: 'portrait' | 'landscape'
  margins: MarginConfig
  fonts: {
    title: FontConfig
    heading: FontConfig
    subheading: FontConfig
    body: FontConfig
  }
  colors: ColorConfig
  spacing: SpacingConfig
}

// Branding Configuration
export interface BrandingConfig {
  logoPath: string | null
  logoWidth: number      // Width in mm
  logoHeight: number | null // Height in mm (auto if null)
  firmName: string | null
  tagline: string | null
  watermarkEnabled: boolean
  watermarkText: string | null
  watermarkOpacity: number
  watermarkPosition: 'diagonal' | 'center' | 'footer'
}

// Header/Footer alignment
export type HFAlignment = 'left' | 'center' | 'right' | 'split'

// Cover page behavior for header/footer
export type CoverBehavior = 'hide' | 'same' | 'custom'

// Page number position
export type PageNumberPosition = 'left' | 'center' | 'right' | 'inline'

// Header Configuration
export interface HeaderConfig {
  enabled: boolean
  content: string | null
  showOnFirstPage: boolean
  showPageNumber: boolean
  alignment: HFAlignment
  leftContent: string | null
  rightContent: string | null
  coverBehavior: CoverBehavior
}

// Footer Configuration
export interface FooterConfig {
  enabled: boolean
  content: string | null
  showPageNumber: boolean
  pageNumberFormat: string // e.g., "Page {page} of {total}"
  alignment: HFAlignment
  leftContent: string | null
  rightContent: string | null
  pageNumberPosition: PageNumberPosition
}

// Header/Footer Configuration
export interface HeaderFooterConfig {
  header: HeaderConfig
  footer: FooterConfig
}

// Section Field Configuration (for selecting which fields to include)
export interface SectionFieldConfig {
  id: string
  slug: string
  name: string
  enabled: boolean
}

// Section Configuration (ordering and per-section settings)
export interface SectionTemplateConfig {
  id: string
  name: string
  enabled: boolean
  order: number
  pageBreakBefore?: boolean
  fields: SectionFieldConfig[]
}

// Table of Contents Configuration
export interface TocConfig {
  enabled: boolean
  title: string
  showPageNumbers: boolean
}

// Default configurations
export const DEFAULT_COVER_CONFIG: CoverPageConfig = {
  includeDate: true,
  includeAuthor: true,
  includeDisclaimer: true,
  customTitle: null,
  disclaimerText: 'This document is for informational purposes only and does not constitute investment advice. Past performance is not indicative of future results.',
  showCompanyName: true,
  showCurrentPrice: true,
  showLogo: true,
  titlePosition: 'center',
  logoPosition: 'top-left',
  includeTimestamp: false,
  useOrgBranding: true,
  useOrgDisclaimer: true
}

export const DEFAULT_STYLE_CONFIG: StyleConfig = {
  pageFormat: 'a4',
  orientation: 'portrait',
  margins: { top: 20, right: 20, bottom: 20, left: 20 },
  fonts: {
    title: { family: 'helvetica', size: 28, weight: 'bold' },
    heading: { family: 'helvetica', size: 16, weight: 'bold' },
    subheading: { family: 'helvetica', size: 12, weight: 'bold' },
    body: { family: 'helvetica', size: 10, weight: 'normal' }
  },
  colors: {
    primary: '#3b82f6',
    secondary: '#6b7280',
    text: '#212121',
    headingText: '#212121',
    mutedText: '#808080',
    accent: '#3b82f6'
  },
  spacing: { sectionGap: 10, fieldGap: 5, paragraphGap: 2 }
}

export const DEFAULT_BRANDING_CONFIG: BrandingConfig = {
  logoPath: null,
  logoWidth: 40,
  logoHeight: null,
  firmName: null,
  tagline: null,
  watermarkEnabled: false,
  watermarkText: null,
  watermarkOpacity: 0.1,
  watermarkPosition: 'diagonal'
}

export const DEFAULT_HEADER_FOOTER_CONFIG: HeaderFooterConfig = {
  header: { enabled: false, content: null, showOnFirstPage: false, showPageNumber: false, alignment: 'center', leftContent: null, rightContent: null, coverBehavior: 'hide' },
  footer: { enabled: true, content: null, showPageNumber: true, pageNumberFormat: 'Page {page} of {total}', alignment: 'center', leftContent: null, rightContent: null, pageNumberPosition: 'center' }
}

export const DEFAULT_TOC_CONFIG: TocConfig = {
  enabled: true,
  title: 'Table of Contents',
  showPageNumbers: true
}

// Main Investment Case Template Interface
export interface InvestmentCaseTemplate {
  id: string
  name: string
  description: string | null
  user_id: string
  organization_id: string | null
  is_shared: boolean
  is_default: boolean
  usage_count: number
  last_used_at: string | null
  cover_config: CoverPageConfig
  style_config: StyleConfig
  branding_config: BrandingConfig
  header_footer_config: HeaderFooterConfig
  section_config: SectionTemplateConfig[]
  toc_config: TocConfig
  created_at: string
  updated_at: string
}

// Create/Update Data Types
export interface CreateInvestmentCaseTemplateData {
  name: string
  description?: string | null
  is_shared?: boolean
  is_default?: boolean
  cover_config?: Partial<CoverPageConfig>
  style_config?: Partial<StyleConfig>
  branding_config?: Partial<BrandingConfig>
  header_footer_config?: Partial<HeaderFooterConfig>
  section_config?: SectionTemplateConfig[]
  toc_config?: Partial<TocConfig>
}

export interface UpdateInvestmentCaseTemplateData {
  name?: string
  description?: string | null
  is_shared?: boolean
  is_default?: boolean
  cover_config?: Partial<CoverPageConfig>
  style_config?: Partial<StyleConfig>
  branding_config?: Partial<BrandingConfig>
  header_footer_config?: Partial<HeaderFooterConfig>
  section_config?: SectionTemplateConfig[]
  toc_config?: Partial<TocConfig>
}

// Helper to merge partial configs with defaults
export function mergeWithDefaults(template: Partial<InvestmentCaseTemplate>): InvestmentCaseTemplate {
  return {
    id: template.id || '',
    name: template.name || 'Untitled Template',
    description: template.description ?? null,
    user_id: template.user_id || '',
    organization_id: template.organization_id ?? null,
    is_shared: template.is_shared ?? false,
    is_default: template.is_default ?? false,
    usage_count: template.usage_count ?? 0,
    last_used_at: template.last_used_at ?? null,
    cover_config: { ...DEFAULT_COVER_CONFIG, ...template.cover_config },
    style_config: {
      ...DEFAULT_STYLE_CONFIG,
      ...template.style_config,
      margins: { ...DEFAULT_STYLE_CONFIG.margins, ...template.style_config?.margins },
      fonts: {
        title: { ...DEFAULT_STYLE_CONFIG.fonts.title, ...template.style_config?.fonts?.title },
        heading: { ...DEFAULT_STYLE_CONFIG.fonts.heading, ...template.style_config?.fonts?.heading },
        subheading: { ...DEFAULT_STYLE_CONFIG.fonts.subheading, ...template.style_config?.fonts?.subheading },
        body: { ...DEFAULT_STYLE_CONFIG.fonts.body, ...template.style_config?.fonts?.body }
      },
      colors: { ...DEFAULT_STYLE_CONFIG.colors, ...template.style_config?.colors },
      spacing: { ...DEFAULT_STYLE_CONFIG.spacing, ...template.style_config?.spacing }
    },
    branding_config: { ...DEFAULT_BRANDING_CONFIG, ...template.branding_config },
    header_footer_config: {
      header: { ...DEFAULT_HEADER_FOOTER_CONFIG.header, ...template.header_footer_config?.header },
      footer: { ...DEFAULT_HEADER_FOOTER_CONFIG.footer, ...template.header_footer_config?.footer }
    },
    section_config: template.section_config || [],
    toc_config: { ...DEFAULT_TOC_CONFIG, ...template.toc_config },
    created_at: template.created_at || new Date().toISOString(),
    updated_at: template.updated_at || new Date().toISOString()
  }
}

// Color presets for easy selection
export const COLOR_PRESETS = [
  { name: 'Blue', primary: '#3b82f6', accent: '#3b82f6' },
  { name: 'Green', primary: '#10b981', accent: '#10b981' },
  { name: 'Purple', primary: '#8b5cf6', accent: '#8b5cf6' },
  { name: 'Red', primary: '#ef4444', accent: '#ef4444' },
  { name: 'Orange', primary: '#f97316', accent: '#f97316' },
  { name: 'Teal', primary: '#14b8a6', accent: '#14b8a6' },
  { name: 'Navy', primary: '#1e3a8a', accent: '#1e3a8a' },
  { name: 'Black', primary: '#171717', accent: '#171717' }
]

// Font family options (jsPDF supported)
export const FONT_FAMILIES = [
  { value: 'helvetica', label: 'Helvetica' },
  { value: 'times', label: 'Times New Roman' },
  { value: 'courier', label: 'Courier' }
]

// Page format options
export const PAGE_FORMATS = [
  { value: 'a4', label: 'A4 (210mm x 297mm)' },
  { value: 'letter', label: 'Letter (8.5" x 11")' },
  { value: 'legal', label: 'Legal (8.5" x 14")' }
]

// Template variable tokens for dynamic title/content
export const TEMPLATE_VARIABLES = [
  { key: '{{symbol}}', label: 'Ticker Symbol', example: 'AAPL' },
  { key: '{{company_name}}', label: 'Company Name', example: 'Apple Inc.' },
  { key: '{{as_of_date}}', label: 'As-of Date', example: 'Feb 19, 2026' },
  { key: '{{author}}', label: 'Author', example: 'John Smith' },
  { key: '{{current_price}}', label: 'Current Price', example: '$185.50' },
  { key: '{{firm_name}}', label: 'Firm Name', example: 'Acme Capital' },
] as const

// Header/Footer variable tokens (superset — includes page tokens)
export const HF_VARIABLES = [
  { key: '{{firm_name}}', label: 'Firm Name' },
  { key: '{{symbol}}', label: 'Symbol' },
  { key: '{{company_name}}', label: 'Company Name' },
  { key: '{{as_of_date}}', label: 'Date' },
  { key: '{{author}}', label: 'Analyst' },
  { key: '{page}', label: 'Page' },
  { key: '{total}', label: 'Total Pages' },
] as const

export interface TemplatePreviewContext {
  symbol: string
  companyName: string
  currentPrice: number
  asOfDate: string
  author: string
  firmName: string
  mode: 'single' | 'packet'
}

export const DEFAULT_PREVIEW_CONTEXT: TemplatePreviewContext = {
  symbol: 'AAPL',
  companyName: 'Apple Inc.',
  currentPrice: 185.50,
  asOfDate: new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }),
  author: 'Analyst',
  firmName: '',
  mode: 'single',
}

// Template sharing
export type TemplateShareScope = 'private' | 'specific' | 'org'

export interface TemplateShareRecipient {
  id: string
  type: 'user' | 'team' | 'department'
  name: string
  email?: string
}

export function resolveTemplateVariables(text: string, ctx: TemplatePreviewContext): string {
  return text
    .replace(/\{\{symbol\}\}/g, ctx.symbol)
    .replace(/\{\{company_name\}\}/g, ctx.companyName)
    .replace(/\{\{as_of_date\}\}/g, ctx.asOfDate)
    .replace(/\{\{author\}\}/g, ctx.author)
    .replace(/\{\{current_price\}\}/g, `$${ctx.currentPrice.toFixed(2)}`)
    .replace(/\{\{firm_name\}\}/g, ctx.firmName)
}
