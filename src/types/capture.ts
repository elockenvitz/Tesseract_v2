/**
 * Capture System Types
 *
 * Supports capturing internal platform entities (live/static) and
 * external content (screenshots, URL embeds)
 */

// Capture types
export type CaptureType = 'entity_live' | 'entity_static' | 'screenshot' | 'embed'

// Entity types that can be captured
export type CaptureEntityType =
  | 'asset'
  | 'portfolio'
  | 'theme'
  | 'note'
  | 'list'
  | 'workflow'
  | 'project'
  | 'chart'
  | 'price_target'
  | 'workflow_item'

// Source types where captures can be embedded
export type CaptureSourceType = 'note' | 'contribution' | 'message' | 'comment'

// Database record
export interface Capture {
  id: string
  source_type: CaptureSourceType
  source_id: string
  capture_type: CaptureType

  // Entity reference (for entity captures)
  entity_type: CaptureEntityType | null
  entity_id: string | null
  entity_display: string | null

  // Static snapshot
  snapshot_data: Record<string, any> | null
  snapshot_at: string | null

  // External capture (embed)
  external_url: string | null
  external_title: string | null
  external_description: string | null
  external_image_url: string | null
  external_favicon_url: string | null
  external_metadata: Record<string, any> | null

  // Screenshot
  screenshot_storage_path: string | null
  screenshot_source_url: string | null
  screenshot_notes: string | null
  screenshot_tags: string[] | null

  // Display settings
  display_title: string | null
  is_expanded: boolean
  preview_width: number
  preview_height: number

  created_by: string
  created_at: string
  updated_at: string
}

// Insert type (without auto-generated fields)
export interface CaptureInsert {
  source_type: CaptureSourceType
  source_id: string
  capture_type: CaptureType

  entity_type?: CaptureEntityType | null
  entity_id?: string | null
  entity_display?: string | null

  snapshot_data?: Record<string, any> | null
  snapshot_at?: string | null

  external_url?: string | null
  external_title?: string | null
  external_description?: string | null
  external_image_url?: string | null
  external_favicon_url?: string | null
  external_metadata?: Record<string, any> | null

  screenshot_storage_path?: string | null
  screenshot_source_url?: string | null
  screenshot_notes?: string | null
  screenshot_tags?: string[] | null

  display_title?: string | null
  is_expanded?: boolean
  preview_width?: number
  preview_height?: number

  created_by: string
}

// Entity snapshot - data captured at a point in time
export interface EntitySnapshot<T = Record<string, any>> {
  type: CaptureEntityType
  id: string
  data: T
  capturedAt: string
}

// Specific entity snapshot types
export interface AssetSnapshot {
  symbol: string
  companyName: string | null
  currentPrice: number | null
  previousClose: number | null
  change: number | null
  changePercent: number | null
  marketCap: number | null
  volume: number | null
  sector: string | null
  industry: string | null
  priority: string | null
  processStage: string | null
  quickNote: string | null
}

export interface PortfolioSnapshot {
  name: string
  description: string | null
  holdingsCount: number
  totalValue: number | null
  performance: {
    daily: number | null
    weekly: number | null
    monthly: number | null
    ytd: number | null
  } | null
}

export interface ThemeSnapshot {
  name: string
  description: string | null
  assetCount: number
  thesis: string | null
  assets: Array<{ id: string; symbol: string; companyName: string | null }>
}

export interface NoteSnapshot {
  title: string
  contentPreview: string | null
  noteType: string | null
  charCount: number
  wordCount: number
}

export interface ListSnapshot {
  name: string
  description: string | null
  assetCount: number
  assets: Array<{ id: string; symbol: string; companyName: string | null }>
}

export interface PriceTargetSnapshot {
  assetSymbol: string
  assetName: string | null
  bullTarget: number | null
  baseTarget: number | null
  bearTarget: number | null
  timeframe: string | null
  createdBy: string | null
  createdAt: string
}

export interface WorkflowSnapshot {
  name: string
  status: string | null
  progress: number | null
  currentStage: string | null
  assignedTo: string[] | null
}

export interface WorkflowItemSnapshot {
  title: string
  description: string | null
  status: string | null
  isCompleted: boolean
  dueDate: string | null
  assignedTo: string | null
}

// URL metadata from external sources
export interface UrlMetadata {
  url: string
  title: string | null
  description: string | null
  image: string | null
  favicon: string | null
  siteName: string | null
  author: string | null
  publishedAt: string | null
  type: string | null // 'article', 'website', 'video', etc.
}

// Diff result for comparing static vs current
export interface DiffResult {
  field: string
  fieldLabel: string // Human-readable label
  snapshotValue: any
  currentValue: any
  changeType: 'added' | 'removed' | 'modified' | 'unchanged'
  isSignificant: boolean // e.g., price changes > 1%
}

// Capture node attributes for TipTap
export interface CaptureNodeAttrs {
  captureId: string | null
  captureType: CaptureType

  // Entity reference
  entityType: CaptureEntityType | null
  entityId: string | null
  entityDisplay: string

  // Static snapshot
  snapshotData: Record<string, any> | null
  snapshotAt: string | null

  // External
  externalUrl: string
  externalTitle: string
  externalDescription: string
  externalImageUrl: string
  externalFaviconUrl: string

  // Screenshot
  screenshotPath: string
  screenshotSourceUrl: string
  screenshotNotes: string
  screenshotTags: string[]

  // Display
  displayTitle: string
  isExpanded: boolean
  previewWidth: number
  previewHeight: number

  // Context
  contextType: string
  contextId: string
}

// Entity display info for capture cards
export interface EntityDisplayInfo {
  type: CaptureEntityType
  id: string
  title: string
  subtitle: string | null
  icon: string // Lucide icon name
  color: string // Tailwind color class
  href: string | null // Link to entity
}

// Capture mode for internal captures
export type CaptureMode = 'live' | 'static'

// Capture picker state
export interface CapturePickerState {
  isOpen: boolean
  mode: 'search' | 'overlay' | null
  selectedEntity: EntityDisplayInfo | null
  captureMode: CaptureMode | null
  position: { x: number; y: number } | null
}

// Screenshot capture state
export interface ScreenshotCaptureState {
  isCapturing: boolean
  imageBlob: Blob | null
  imageUrl: string | null
  sourceUrl: string
  title: string
  notes: string
  tags: string[]
  error: string | null
}

// Embed state
export interface EmbedState {
  url: string
  isLoading: boolean
  metadata: UrlMetadata | null
  error: string | null
}
