import { EntityType } from '../../hooks/useEntitySearch'

export type TriggerType = 'mention' | 'hashtag' | 'cashtag' | 'template' | 'data' | 'ai' | 'ai-model' | 'capture' | 'screenshot' | 'embed'

export interface TriggerInfo {
  type: TriggerType
  query: string
  position: number
  model?: string  // For AI triggers, the selected model (e.g., 'claude', 'gpt')
}

// AI Model definitions
export interface AIModel {
  id: string
  name: string
  provider: string
  description: string
}

export const AI_MODELS: AIModel[] = [
  { id: 'claude', name: 'Claude', provider: 'Anthropic', description: 'Claude 3.5 Sonnet - Best for analysis' },
  { id: 'gpt', name: 'GPT-4', provider: 'OpenAI', description: 'GPT-4o - Great for general tasks' },
  { id: 'gemini', name: 'Gemini', provider: 'Google', description: 'Gemini Pro - Fast responses' },
]

export interface MentionData {
  userId: string
  displayName: string
}

export interface ReferenceData {
  type: EntityType
  id: string
  display: string
}

export interface DataSnapshot {
  id: string
  assetId: string
  dataType: string
  value: string | number
  capturedAt: string
}

export interface AIGeneratedRange {
  prompt: string
  content: string
  startPos: number
  endPos: number
}

export interface SmartInputMetadata {
  mentions: MentionData[]
  references: ReferenceData[]
  dataSnapshots: DataSnapshot[]
  aiGeneratedRanges: AIGeneratedRange[]
}

export interface DropdownPosition {
  top: number
  left: number
}

// Data function types
export type DataFunctionType = 'price' | 'volume' | 'marketcap' | 'change' | 'pe_ratio' | 'dividend_yield'

export interface DataFunction {
  type: DataFunctionType
  label: string
  icon: string
  format: (value: number) => string
}

export const DATA_FUNCTIONS: DataFunction[] = [
  { type: 'price', label: 'Current Price', icon: 'DollarSign', format: (v) => `$${v.toFixed(2)}` },
  { type: 'change', label: 'Daily Change', icon: 'TrendingUp', format: (v) => `${v >= 0 ? '+' : ''}${v.toFixed(2)}%` },
  { type: 'volume', label: 'Volume', icon: 'BarChart3', format: (v) => formatLargeNumber(v) },
  { type: 'marketcap', label: 'Market Cap', icon: 'PieChart', format: (v) => formatLargeNumber(v) },
  { type: 'pe_ratio', label: 'P/E Ratio', icon: 'Calculator', format: (v) => v.toFixed(2) },
  { type: 'dividend_yield', label: 'Dividend Yield', icon: 'Percent', format: (v) => `${v.toFixed(2)}%` }
]

function formatLargeNumber(num: number): string {
  if (num >= 1e12) return `$${(num / 1e12).toFixed(2)}T`
  if (num >= 1e9) return `$${(num / 1e9).toFixed(2)}B`
  if (num >= 1e6) return `$${(num / 1e6).toFixed(2)}M`
  if (num >= 1e3) return `$${(num / 1e3).toFixed(2)}K`
  return num.toFixed(0)
}

// Regex patterns for parsing stored content
export const MENTION_REGEX = /@\[([^\]]+)\]\(user:([a-f0-9-]+)\)/g
export const REFERENCE_REGEX = /#\[([^\]]+)\]\((\w+):([a-f0-9-]+)\)/g
export const CASHTAG_REGEX = /\$\[([^\]]+)\]\(asset:([a-f0-9-]+)\)/g
export const DATA_SNAPSHOT_REGEX = /\.data\[(\w+):snapshot:([^:]+):([^\]]+)\]/g
export const DATA_LIVE_REGEX = /\.data\[(\w+):live:([a-f0-9-]+)\]/g
export const AI_CONTENT_REGEX = /\.AI\[([^\]]*)\]\{([^}]*)\}/g

// Format functions for creating stored content
export function formatMention(displayName: string, userId: string): string {
  return `@[${displayName}](user:${userId})`
}

export function formatReference(display: string, type: EntityType, id: string): string {
  return `#[${display}](${type}:${id})`
}

export function formatCashtag(symbol: string, id: string): string {
  return `$[${symbol}](asset:${id})`
}

export function formatDataSnapshot(dataType: DataFunctionType, value: string, date: string): string {
  return `.data[${dataType}:snapshot:${value}:${date}]`
}

export function formatDataLive(dataType: DataFunctionType, assetId: string): string {
  return `.data[${dataType}:live:${assetId}]`
}

export function formatAIContent(prompt: string, content: string): string {
  return `.AI[${prompt}]{${content}}`
}
