import type { StyleConfig } from '../../types/investmentCaseTemplates'

// ============================================================================
// Style Presets — full StyleConfig overrides for one-click application
// ============================================================================

export interface StylePreset {
  key: string
  label: string
  description: string
  config: StyleConfig
}

export const STYLE_PRESETS: StylePreset[] = [
  {
    key: 'professional',
    label: 'Professional',
    description: 'Clean, balanced layout for standard reports',
    config: {
      pageFormat: 'a4',
      orientation: 'portrait',
      margins: { top: 20, right: 20, bottom: 20, left: 20 },
      fonts: {
        title: { family: 'helvetica', size: 28, weight: 'bold' },
        heading: { family: 'helvetica', size: 16, weight: 'bold' },
        subheading: { family: 'helvetica', size: 12, weight: 'bold' },
        body: { family: 'helvetica', size: 10, weight: 'normal' },
      },
      colors: {
        primary: '#3b82f6',
        secondary: '#6b7280',
        text: '#212121',
        headingText: '#212121',
        mutedText: '#808080',
        accent: '#3b82f6',
      },
      spacing: { sectionGap: 10, fieldGap: 5, paragraphGap: 2 },
    },
  },
  {
    key: 'compact',
    label: 'Compact',
    description: 'Dense layout — fits more per page',
    config: {
      pageFormat: 'a4',
      orientation: 'portrait',
      margins: { top: 15, right: 15, bottom: 15, left: 15 },
      fonts: {
        title: { family: 'helvetica', size: 24, weight: 'bold' },
        heading: { family: 'helvetica', size: 13, weight: 'bold' },
        subheading: { family: 'helvetica', size: 10, weight: 'bold' },
        body: { family: 'helvetica', size: 9, weight: 'normal' },
      },
      colors: {
        primary: '#1e3a8a',
        secondary: '#4b5563',
        text: '#1f2937',
        headingText: '#111827',
        mutedText: '#9ca3af',
        accent: '#1e3a8a',
      },
      spacing: { sectionGap: 6, fieldGap: 3, paragraphGap: 1 },
    },
  },
  {
    key: 'presentation',
    label: 'Presentation',
    description: 'Large text, generous spacing — landscape-ready',
    config: {
      pageFormat: 'a4',
      orientation: 'portrait',
      margins: { top: 25, right: 25, bottom: 25, left: 25 },
      fonts: {
        title: { family: 'helvetica', size: 34, weight: 'bold' },
        heading: { family: 'helvetica', size: 20, weight: 'bold' },
        subheading: { family: 'helvetica', size: 14, weight: 'bold' },
        body: { family: 'helvetica', size: 12, weight: 'normal' },
      },
      colors: {
        primary: '#171717',
        secondary: '#525252',
        text: '#262626',
        headingText: '#171717',
        mutedText: '#a3a3a3',
        accent: '#171717',
      },
      spacing: { sectionGap: 14, fieldGap: 7, paragraphGap: 3 },
    },
  },
  {
    key: 'minimal',
    label: 'Minimal Accents',
    description: 'Subtle colors, serif typography',
    config: {
      pageFormat: 'a4',
      orientation: 'portrait',
      margins: { top: 22, right: 22, bottom: 22, left: 22 },
      fonts: {
        title: { family: 'times', size: 28, weight: 'bold' },
        heading: { family: 'times', size: 16, weight: 'bold' },
        subheading: { family: 'times', size: 12, weight: 'normal' },
        body: { family: 'times', size: 11, weight: 'normal' },
      },
      colors: {
        primary: '#374151',
        secondary: '#6b7280',
        text: '#1f2937',
        headingText: '#111827',
        mutedText: '#9ca3af',
        accent: '#374151',
      },
      spacing: { sectionGap: 10, fieldGap: 5, paragraphGap: 2 },
    },
  },
]

// ============================================================================
// Margin presets — map friendly labels → individual margin values
// ============================================================================

export type MarginPresetKey = 'compact' | 'normal' | 'wide'

export interface MarginPreset {
  key: MarginPresetKey
  label: string
  values: { top: number; right: number; bottom: number; left: number }
}

export const MARGIN_PRESETS: MarginPreset[] = [
  { key: 'compact', label: 'Compact', values: { top: 15, right: 15, bottom: 15, left: 15 } },
  { key: 'normal', label: 'Normal', values: { top: 20, right: 20, bottom: 20, left: 20 } },
  { key: 'wide', label: 'Wide', values: { top: 25, right: 25, bottom: 25, left: 25 } },
]

export function detectMarginPreset(m: { top: number; right: number; bottom: number; left: number }): MarginPresetKey | null {
  for (const p of MARGIN_PRESETS) {
    if (p.values.top === m.top && p.values.right === m.right && p.values.bottom === m.bottom && p.values.left === m.left) {
      return p.key
    }
  }
  return null
}

// ============================================================================
// Typography scale — maps a single slider to per-role font sizes
// ============================================================================

export type TypographyScale = 'compact' | 'comfortable' | 'large'

export const TYPOGRAPHY_SCALES: Record<TypographyScale, { title: number; heading: number; subheading: number; body: number }> = {
  compact: { title: 24, heading: 13, subheading: 10, body: 9 },
  comfortable: { title: 28, heading: 16, subheading: 12, body: 10 },
  large: { title: 34, heading: 20, subheading: 14, body: 12 },
}

export function detectTypographyScale(fonts: StyleConfig['fonts']): TypographyScale | null {
  for (const [key, sizes] of Object.entries(TYPOGRAPHY_SCALES) as [TypographyScale, typeof TYPOGRAPHY_SCALES['compact']][]) {
    if (
      fonts.title.size === sizes.title &&
      fonts.heading.size === sizes.heading &&
      fonts.subheading.size === sizes.subheading &&
      fonts.body.size === sizes.body
    ) {
      return key
    }
  }
  return null
}

// ============================================================================
// Layout Density — maps a single control to spacing values
// ============================================================================

export type LayoutDensity = 'compact' | 'balanced' | 'spacious'

export const DENSITY_PRESETS: Record<LayoutDensity, { sectionGap: number; fieldGap: number; paragraphGap: number }> = {
  compact: { sectionGap: 6, fieldGap: 3, paragraphGap: 1 },
  balanced: { sectionGap: 10, fieldGap: 5, paragraphGap: 2 },
  spacious: { sectionGap: 14, fieldGap: 7, paragraphGap: 3 },
}

export function detectDensity(spacing: StyleConfig['spacing']): LayoutDensity | null {
  for (const [key, vals] of Object.entries(DENSITY_PRESETS) as [LayoutDensity, typeof DENSITY_PRESETS['balanced']][]) {
    if (
      spacing.sectionGap === vals.sectionGap &&
      spacing.fieldGap === vals.fieldGap &&
      spacing.paragraphGap === vals.paragraphGap
    ) {
      return key
    }
  }
  return null
}

// ============================================================================
// Color derivation — auto-generate full palette from a single primary
// ============================================================================

/** Parse hex string to [r, g, b] */
function hexToRgb(hex: string): [number, number, number] {
  const c = hex.replace('#', '')
  const n = parseInt(c.length === 3 ? c.split('').map(x => x + x).join('') : c, 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

/** Convert [r, g, b] to hex string */
function rgbToHex(r: number, g: number, b: number): string {
  return '#' + [r, g, b].map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('')
}

/** Convert RGB to HSL (all 0-1) */
function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255; g /= 255; b /= 255
  const max = Math.max(r, g, b), min = Math.min(r, g, b)
  const l = (max + min) / 2
  if (max === min) return [0, 0, l]
  const d = max - min
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  let h = 0
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6
  else if (max === g) h = ((b - r) / d + 2) / 6
  else h = ((r - g) / d + 4) / 6
  return [h, s, l]
}

/** Convert HSL (0-1) to RGB (0-255) */
function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  if (s === 0) { const v = Math.round(l * 255); return [v, v, v] }
  const hue2rgb = (p: number, q: number, t: number) => {
    if (t < 0) t += 1; if (t > 1) t -= 1
    if (t < 1 / 6) return p + (q - p) * 6 * t
    if (t < 1 / 2) return q
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6
    return p
  }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s
  const p = 2 * l - q
  return [
    Math.round(hue2rgb(p, q, h + 1 / 3) * 255),
    Math.round(hue2rgb(p, q, h) * 255),
    Math.round(hue2rgb(p, q, h - 1 / 3) * 255),
  ]
}

/** Derive a full color palette from a single primary hex */
export function deriveColorsFromPrimary(primary: string): StyleConfig['colors'] {
  const [r, g, b] = hexToRgb(primary)
  const [h, s, l] = rgbToHsl(r, g, b)

  // Secondary: desaturated, darker
  const secondary = rgbToHex(...hslToRgb(h, Math.max(0, s * 0.3), Math.min(0.45, l * 0.8)))
  // Accent: slightly lighter, full sat
  const accent = rgbToHex(...hslToRgb(h, s, Math.min(0.65, l + 0.1)))

  return {
    primary,
    secondary,
    accent,
    text: '#212121',
    headingText: '#212121',
    mutedText: '#808080',
  }
}

// ============================================================================
// Contrast checking — WCAG relative luminance
// ============================================================================

function relativeLuminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map(v => {
    const s = v / 255
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4)
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

export function contrastRatio(fg: string, bg: string): number {
  const l1 = relativeLuminance(fg)
  const l2 = relativeLuminance(bg)
  const lighter = Math.max(l1, l2)
  const darker = Math.min(l1, l2)
  return (lighter + 0.05) / (darker + 0.05)
}

// ============================================================================
// Color usage legend
// ============================================================================

export const COLOR_USAGE: Record<string, string> = {
  primary: 'Section titles & dividers',
  secondary: 'Subheadings & TOC accents',
  accent: 'Badges & callouts',
  text: 'Body text',
  headingText: 'Heading text color',
  mutedText: 'Metadata & footnotes',
}

// ============================================================================
// Guardrail helpers
// ============================================================================

export interface StyleWarning {
  field: string
  message: string
}

// ============================================================================
// Base preset detection
// ============================================================================

export interface BasePresetStatus {
  preset: StylePreset | null
  customized: boolean
  label: string
}

/** Detect which base preset is closest and whether the config has been customized */
export function detectBasePreset(config: StyleConfig): BasePresetStatus {
  // Exact match
  for (const p of STYLE_PRESETS) {
    if (JSON.stringify(config) === JSON.stringify(p.config)) {
      return { preset: p, customized: false, label: p.label }
    }
  }
  // Check page format + font family + spacing to find closest base
  for (const p of STYLE_PRESETS) {
    const sameFamily = config.fonts.body.family === p.config.fonts.body.family
    const sameFormat = config.pageFormat === p.config.pageFormat
    const sameColors = config.colors.primary === p.config.colors.primary
    if (sameFamily && sameFormat && sameColors) {
      return { preset: p, customized: true, label: `${p.label} (Customized)` }
    }
  }
  return { preset: null, customized: true, label: 'Custom' }
}

// ============================================================================
// Contrast level helper
// ============================================================================

export type ContrastLevel = 'good' | 'low' | 'poor'

/** Classify contrast ratio into 3 levels */
export function contrastLevel(fg: string, bg: string = '#ffffff'): ContrastLevel {
  const ratio = contrastRatio(fg, bg)
  if (ratio >= 4.5) return 'good'
  if (ratio >= 3) return 'low'
  return 'poor'
}

// ============================================================================
// Density page estimate
// ============================================================================

/** Rough estimate of content pages based on section count and density */
export function estimatePages(sectionCount: number, density: LayoutDensity | null, bodySize: number): string {
  // Rough heuristic: larger text + more spacing = more pages
  const densityMultiplier = density === 'compact' ? 0.7 : density === 'spacious' ? 1.4 : 1.0
  const sizeMultiplier = bodySize <= 9 ? 0.85 : bodySize >= 12 ? 1.25 : 1.0
  const rawPages = Math.max(1, Math.ceil(sectionCount * 0.6 * densityMultiplier * sizeMultiplier))
  return `~${rawPages} page${rawPages !== 1 ? 's' : ''} of content`
}

export function getStyleWarnings(config: StyleConfig): StyleWarning[] {
  const warnings: StyleWarning[] = []

  if (config.fonts.body.size < 9) {
    warnings.push({ field: 'body-size', message: 'Body text below 9pt may be hard to read in print.' })
  }
  if (config.fonts.body.size > 14) {
    warnings.push({ field: 'body-size', message: 'Body text above 14pt is unusually large.' })
  }
  if (config.fonts.heading.size < config.fonts.body.size + 2) {
    warnings.push({ field: 'heading-size', message: 'Headings should be at least 2pt larger than body text.' })
  }
  if (config.fonts.title.size <= config.fonts.heading.size) {
    warnings.push({ field: 'title-size', message: 'Title should be larger than section headings.' })
  }
  for (const side of ['top', 'right', 'bottom', 'left'] as const) {
    if (config.margins[side] < 10) {
      warnings.push({ field: `margin-${side}`, message: `${side.charAt(0).toUpperCase() + side.slice(1)} margin <10mm may clip on print.` })
    }
  }
  if (config.spacing.paragraphGap === 0 && config.fonts.body.size >= 10) {
    warnings.push({ field: 'paragraph-gap', message: 'Zero paragraph gap may reduce readability.' })
  }

  // Contrast checks against white background
  const textContrast = contrastRatio(config.colors.text, '#ffffff')
  if (textContrast < 4.5) {
    warnings.push({ field: 'color-text', message: `Low contrast (${textContrast.toFixed(1)}:1). Body text may be hard to read.` })
  }
  const mutedContrast = contrastRatio(config.colors.mutedText, '#ffffff')
  if (mutedContrast < 3) {
    warnings.push({ field: 'color-mutedText', message: `Very low contrast (${mutedContrast.toFixed(1)}:1). Muted text may be invisible in print.` })
  }

  return warnings
}
