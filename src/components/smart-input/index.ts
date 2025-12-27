// Main component
export { UniversalSmartInput } from './UniversalSmartInput'
export type { UniversalSmartInputProps, UniversalSmartInputRef } from './UniversalSmartInput'

// Renderer for displaying saved content
export { SmartInputRenderer } from './SmartInputRenderer'
export type { SmartInputRendererProps } from './SmartInputRenderer'

// Dropdown components (for custom implementations)
export { SmartInputDropdown, SuggestionItem, SuggestionGroup, EmptyState, LoadingState } from './SmartInputDropdown'
export { MentionSuggestions } from './MentionSuggestions'
export { HashtagSuggestions } from './HashtagSuggestions'
export { TemplateSuggestions } from './TemplateSuggestions'
export { DataFunctionPicker } from './DataFunctionPicker'
export { AIPromptModal } from './AIPromptModal'

// Types
export * from './types'
