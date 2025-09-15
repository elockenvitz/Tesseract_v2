import React from 'react'
import { X, Minimize2, Maximize2, MessageCircle, Mail, Bell, User } from 'lucide-react'
import { AISection } from './AISection'
import { DirectMessaging } from './DirectMessaging'
import { MessagingSection } from './MessagingSection'
import { NotificationPane } from '../notifications/NotificationPane'
import { clsx } from 'clsx'

interface CommunicationPaneProps {
  isOpen: boolean
  onToggle: () => void
  isFullscreen: boolean
  onToggleFullscreen: () => void
  view: 'messages' | 'notifications' | 'profile' | 'ai' | 'direct-messages'
  onViewChange: (view: 'messages' | 'notifications' | 'profile' | 'ai' | 'direct-messages') => void
  contextType?: string
  contextId?: string
  contextTitle?: string
  citedContent?: string
  fieldName?: string
  onCite?: (content: string, fieldName?: string) => void
  onContextChange?: (contextType: string, contextId: string, contextTitle: string) => void
  onShowCoverageManager?: () => void
}

export function CommunicationPane({
  isOpen,
  onToggle,
  isFullscreen,
  onToggleFullscreen,
  view,
  onViewChange,
  contextType,
  contextId,
  contextTitle,
  citedContent,
  fieldName,
  onCite,
  onContextChange,
  onShowCoverageManager
}: CommunicationPaneProps) {

  const handleBackToConversations = () => {
    // Clear the current context to go back to conversation selection
    if (onContextChange) {
      onContextChange('', '', '')
    }
  }
  const getViewTitle = () => {
    switch (view) {
      case 'ai':
        return 'AI Assistant'
      case 'direct-messages':
        return 'Direct Messages'
      case 'messages':
        return contextTitle ? `Discussion: ${contextTitle}` : 'Discussion'
      case 'notifications':
        return 'Notifications'
      case 'profile':
        return 'Profile'
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
      case 'direct-messages':
        return <Mail className="h-5 w-5 text-gray-600" />
      case 'messages':
        return <MessageCircle className="h-5 w-5 text-gray-600" />
      case 'notifications':
        return <Bell className="h-5 w-5 text-gray-600" />
      case 'profile':
        return <User className="h-5 w-5 text-gray-600" />
      default:
        return <MessageCircle className="h-5 w-5 text-gray-600" />
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
          />
        )
      case 'direct-messages':
        return (
          <DirectMessaging
            isOpen={true}
            onClose={onToggle}
          />
        )
      case 'messages':
        return (
          <MessagingSection
            contextType={contextType}
            contextId={contextId}
            contextTitle={contextTitle}
            citedContent={citedContent}
            fieldName={fieldName}
            onCite={onCite}
            onContextChange={onContextChange}
            onShowCoverageManager={onShowCoverageManager}
            onBack={handleBackToConversations}
          />
        )
      case 'notifications':
        return (
          <NotificationPane
            isOpen={isOpen}
            onToggle={onToggle}
            isFullscreen={isFullscreen}
            onToggleFullscreen={onToggleFullscreen}
          />
        )
      default:
        return (
          <div className="p-6 text-center text-gray-500">
            <p>Select a view from the tabs above</p>
          </div>
        )
    }
  }

  return (
    <div className={clsx(
      'fixed right-0 top-16 bottom-0 bg-white border-l border-gray-200 shadow-lg transform transition-transform duration-300 ease-in-out z-30',
      isFullscreen ? 'left-0' : 'w-96',
      isOpen ? 'translate-x-0' : 'translate-x-full'
    )}>
      <div className="flex flex-col h-full">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-gray-200 bg-gray-50">
          <div className="flex items-center space-x-3">
            {getViewIcon()}
            <h3 className="text-lg font-semibold text-gray-900">{getViewTitle()}</h3>
          </div>
          <div className="flex items-center space-x-2">
            <button
              onClick={onToggleFullscreen}
              className="p-1 text-gray-400 hover:text-gray-600 transition-colors"
              title={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
            >
              {isFullscreen ? (
                <Minimize2 className="h-4 w-4" />
              ) : (
                <Maximize2 className="h-4 w-4" />
              )}
            </button>
            <button
              onClick={onToggle}
              className="p-1 text-gray-400 hover:text-gray-600 transition-colors"
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