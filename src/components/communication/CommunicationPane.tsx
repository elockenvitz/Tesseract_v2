import React from 'react'
import { X, Minimize2, Maximize2, Mail, Bell, User, Lightbulb, MessageSquare } from 'lucide-react'
import { AISection } from './AISection'
import { DirectMessaging } from './DirectMessaging'
import { NotificationPane } from '../notifications/NotificationPane'
import { ThoughtsSection } from './ThoughtsSection'
import { EngagementThread } from './EngagementThread'
import { clsx } from 'clsx'
import type { SidebarMode, SelectedItem, InspectableItemType } from '../../stores/sidebarStore'
import { toAITags } from '../../lib/engagement'
import type { EngagementTarget } from '../../lib/engagement'

interface CommunicationPaneProps {
  /** Presents the pane as a bottom sheet instead of a fixed right rail. */
  isMobile?: boolean
  isOpen: boolean
  onToggle: () => void
  isFullscreen: boolean
  onToggleFullscreen: () => void
  view: 'notifications' | 'profile' | 'ai' | 'direct-messages' | 'thoughts' | 'discuss'
  onViewChange: (view: 'notifications' | 'profile' | 'ai' | 'direct-messages' | 'thoughts' | 'discuss') => void
  contextType?: string
  contextId?: string
  contextTitle?: string
  /**
   * Set when the pane was opened from the engagement seam rather than by
   * following the active tab. Carries the object AND the issue, which is
   * what contextType/contextId alone could never express.
   */
  engagementTarget?: EngagementTarget | null
  citedContent?: string
  fieldName?: string
  onCite?: (content: string, fieldName?: string) => void
  onContextChange?: (contextType: string, contextId: string, contextTitle: string, contextData?: any) => void
  onShowCoverageManager?: () => void
  onFocusMode?: (enable: boolean) => void
  isFocusMode?: boolean
  onNotificationClick?: (notification: any) => void
  onOpenSettings?: () => void
  // Sidebar store state for thoughts view
  sidebarMode?: SidebarMode
  selectedItem?: SelectedItem | null
  onBackToCapture?: () => void
  onOpenInspector?: (type: InspectableItemType, id: string) => void
}

export function CommunicationPane({
  isMobile = false,
  isOpen,
  onToggle,
  isFullscreen,
  onToggleFullscreen,
  view,
  onViewChange,
  engagementTarget = null,
  contextType,
  contextId,
  contextTitle,
  citedContent,
  fieldName,
  onCite,
  onContextChange,
  onShowCoverageManager,
  onFocusMode,
  isFocusMode = false,
  onNotificationClick,
  onOpenSettings,
  sidebarMode = 'capture',
  selectedItem,
  onBackToCapture,
  onOpenInspector
}: CommunicationPaneProps) {

  const getViewTitle = () => {
    switch (view) {
      case 'ai':
        return 'Co-Analyst'
      case 'discuss':
        return 'Discussion'
      case 'direct-messages':
        return 'Direct Messages'
      case 'notifications':
        return 'Notifications'
      case 'profile':
        return 'Profile'
      case 'thoughts':
        return 'Quick Ideas'
      default:
        return 'Communication'
    }
  }

  const getViewIcon = () => {
    switch (view) {
      case 'ai':
        return (
          <div className="w-5 h-5 bg-gradient-to-r from-blue-500 to-purple-500 rounded flex items-center justify-center">
            <span className="text-white text-xs font-bold">AI</span>
          </div>
        )
      case 'discuss':
        return <MessageSquare className="h-5 w-5 text-gray-600 dark:text-gray-400" />
      case 'direct-messages':
        return <Mail className="h-5 w-5 text-gray-600 dark:text-gray-400" />
      case 'notifications':
        return <Bell className="h-5 w-5 text-gray-600 dark:text-gray-400" />
      case 'profile':
        return <User className="h-5 w-5 text-gray-600 dark:text-gray-400" />
      case 'thoughts':
        return <Lightbulb className="h-5 w-5 text-amber-500" />
      default:
        return <Lightbulb className="h-5 w-5 text-amber-500" />
    }
  }

  const renderContent = () => {
    switch (view) {
      case 'ai':
        return (
          <AISection
            isOpen={isOpen}
            onToggle={onToggle}
            isFullscreen={isFullscreen}
            onToggleFullscreen={onToggleFullscreen}
            // Context is now a tag — opening the AI panel from AAPL pre-tags
            // AAPL on new conversations and auto-loads the most recent
            // existing AAPL conversation. We pass `label` so the suggestion
            // strings render with the symbol/name on the very first paint
            // instead of flashing "asset" → "AAPL" once the label resolver
            // finishes a beat later.
            // When the seam bound an object, its tags win: they can express
            // "a research note about AMZN inside Growth Composite", which a
            // single contextType/contextId pair cannot. Falls back to the tab
            // derivation for every existing caller, unchanged.
            initialTags={
              engagementTarget
                ? toAITags(engagementTarget)
                : contextType && contextId
                  ? [{
                      type: contextType as 'asset' | 'theme' | 'portfolio' | 'note',
                      id: contextId,
                      label: contextTitle,
                    }]
                  : []
            }
            engagementTarget={engagementTarget}
            onOpenSettings={onOpenSettings}
          />
        )
      case 'discuss':
        return <EngagementThread target={engagementTarget} />
      case 'direct-messages':
        return (
          <DirectMessaging
            isOpen={true}
            onClose={onToggle}
          />
        )
      case 'notifications':
        return (
          <NotificationPane
            isOpen={isOpen}
            onToggle={onToggle}
            isFullscreen={isFullscreen}
            onToggleFullscreen={onToggleFullscreen}
            onNotificationClick={onNotificationClick}
          />
        )
      case 'thoughts':
        return (
          <ThoughtsSection
            initialContextType={contextType}
            initialContextId={contextId}
            initialContextTitle={contextTitle}
            onClose={onToggle}
            sidebarMode={sidebarMode}
            selectedItem={selectedItem}
            onBackToCapture={onBackToCapture}
            onOpenInspector={onOpenInspector}
          />
        )
      default:
        return (
          <div className="p-6 text-center text-gray-500 dark:text-gray-400">
            <p>Select a view from the tabs above</p>
          </div>
        )
    }
  }

  return (
    <div className={clsx(
      'fixed bg-white shadow-lg transform transition-transform duration-300 ease-in-out z-30 dark:bg-gray-800',
      // Phone: a bottom sheet that rises over the content, leaving the header
      // reachable. Desktop: the original right rail.
      isMobile
        ? clsx(
            'inset-x-0 bottom-0 top-16 w-full rounded-t-2xl border-t border-gray-200 dark:border-gray-700',
            isOpen ? 'translate-y-0' : 'translate-y-full'
          )
        : clsx(
            'right-0 top-16 bottom-0 border-l border-gray-200 dark:border-gray-700',
            isFullscreen ? 'left-0' : 'w-96',
            isOpen ? 'translate-x-0' : 'translate-x-full'
          )
    )}>
      <div className="flex flex-col h-full">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-gray-200 bg-gray-50 dark:border-gray-700 dark:bg-gray-900">
          <div className="flex items-center space-x-3">
            {getViewIcon()}
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white">{getViewTitle()}</h3>
          </div>
          <div className="flex items-center space-x-2">
            {/* Fullscreen only means something against the desktop rail, where
                it swaps a 384px panel for the full width. On a phone the pane
                is already edge-to-edge, so the control rendered but had nothing
                to toggle — every view (thoughts, AI, messages, notifications)
                showed a button that did nothing. */}
            {!isMobile && (
              <button
                onClick={onToggleFullscreen}
                className="p-1 text-gray-400 hover:text-gray-600 transition-colors dark:hover:text-gray-300"
                title={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
              >
                {isFullscreen ? (
                  <Minimize2 className="h-4 w-4" />
                ) : (
                  <Maximize2 className="h-4 w-4" />
                )}
              </button>
            )}
            <button
              onClick={onToggle}
              className="p-1 text-gray-400 hover:text-gray-600 transition-colors dark:hover:text-gray-300"
              title="Close communication panel"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Tab Navigation - Only show for non-AI views */}

        {/* Content */}
        <div className="flex-1 overflow-hidden">
          {renderContent()}
        </div>
      </div>
    </div>
  )
}