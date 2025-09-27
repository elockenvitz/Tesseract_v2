import React, { useState } from 'react'
import { X, Plus, TrendingUp, Briefcase, Tag, FileText, Home, File, List, User, Settings, Lightbulb, Workflow } from 'lucide-react'
import { clsx } from 'clsx'

export interface Tab {
  id: string
  title: string
  type: 'asset' | 'portfolio' | 'theme' | 'note' | 'dashboard' | 'assets-list'
  | 'portfolios-list' | 'themes-list' | 'notes-list' | 'lists' | 'list'
  | 'idea-generator' | 'workflows'
  data?: any
  isActive: boolean
  isBlank?: boolean
}

interface TabManagerProps {
  tabs: Tab[]
  activeTabId?: string
  onTabReorder: (fromIndex: number, toIndex: number) => void
  onTabChange: (tabId: string) => void
  onTabClose: (tabId: string) => void
  onNewTab: () => void
  onFocusSearch: () => void
}

export function TabManager({ tabs, onTabReorder, onTabChange, onTabClose, onNewTab, onFocusSearch }: TabManagerProps) {
  const [draggedTab, setDraggedTab] = useState<string | null>(null)
  const [draggedOverTab, setDraggedOverTab] = useState<string | null>(null)

  const handleDragStart = (e: React.DragEvent, tabId: string) => {
    // Don't allow dragging the dashboard tab
    if (tabId === 'dashboard') {
      e.preventDefault()
      return
    }
    
    setDraggedTab(tabId)
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', tabId)
  }

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
  }

  const handleDragEnter = (e: React.DragEvent, tabId: string) => {
    e.preventDefault()
    if (draggedTab && draggedTab !== tabId) {
      setDraggedOverTab(tabId)
    }
  }

  const handleDragLeave = (e: React.DragEvent) => {
    // Only clear if we're leaving the tab entirely
    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
      setDraggedOverTab(null)
    }
  }

  const handleDrop = (e: React.DragEvent, targetTabId: string) => {
    e.preventDefault()
    
    if (!draggedTab || draggedTab === targetTabId) {
      setDraggedTab(null)
      setDraggedOverTab(null)
      return
    }
    
    const fromIndex = tabs.findIndex(tab => tab.id === draggedTab)
    const toIndex = tabs.findIndex(tab => tab.id === targetTabId)
    
    if (fromIndex !== -1 && toIndex !== -1) {
      onTabReorder(fromIndex, toIndex)
    }
    
    setDraggedTab(null)
    setDraggedOverTab(null)
  }

  const handleDragEnd = () => {
    setDraggedTab(null)
    setDraggedOverTab(null)
  }

  const getTabIcon = (type: string) => {
    switch (type) {
      case 'asset': return <TrendingUp className="h-3.5 w-3.5" />
      case 'assets-list': return <TrendingUp className="h-3.5 w-3.5" />
      case 'portfolios-list': return <Briefcase className="h-3.5 w-3.5" />
      case 'themes-list': return <Tag className="h-3.5 w-3.5" />
      case 'notes-list': return <FileText className="h-3.5 w-3.5" />
      case 'lists': return <List className="h-3.5 w-3.5" />
      case 'list': return <List className="h-3.5 w-3.5" />
      case 'idea-generator': return <Lightbulb className="h-3.5 w-3.5" />
      case 'portfolio': return <Briefcase className="h-3.5 w-3.5" />
      case 'theme': return <Tag className="h-3.5 w-3.5" />
      case 'note': return <FileText className="h-3.5 w-3.5" />
      case 'workflows': return <Workflow className="h-3.5 w-3.5" />
      case 'dashboard': return <Home className="h-3.5 w-3.5" />
      case 'profile': return <User className="h-3.5 w-3.5" />
      case 'settings': return <Settings className="h-3.5 w-3.5" />
      default: return <File className="h-3.5 w-3.5" />
    }
  }

  const handleNewTabClick = () => {
    onNewTab()
    // Focus search after a brief delay to ensure the tab is created
    setTimeout(() => {
      onFocusSearch?.()
    }, 100)
  }

  return (
    <div className="bg-white border-b border-gray-200 px-4 sticky top-16 z-30">
      <div className="flex items-center space-x-1 overflow-x-auto custom-scrollbar">
        {tabs.map((tab) => (
          <div
            key={tab.id}
            draggable={tab.id !== 'dashboard'}
            onDragStart={(e) => handleDragStart(e, tab.id)}
            onDragOver={handleDragOver}
            onDragEnter={(e) => handleDragEnter(e, tab.id)}
            onDragLeave={handleDragLeave}
            onDrop={(e) => handleDrop(e, tab.id)}
            onDragEnd={handleDragEnd}
            className={clsx(
              'flex items-center space-x-2 px-4 py-3 border-b-2 cursor-pointer transition-all duration-200 min-w-0 max-w-xs group',
              tab.isActive
                ? 'border-primary-500 bg-primary-50 text-primary-700'
                : 'border-transparent hover:bg-gray-50 text-gray-600 hover:text-gray-900',
              draggedTab === tab.id && 'opacity-50',
              draggedOverTab === tab.id && 'bg-primary-100 border-primary-300',
              tab.id === 'dashboard' && 'cursor-default'
            )}
            onClick={() => onTabChange(tab.id)}
            style={{
              cursor: tab.id === 'dashboard' ? 'default' : draggedTab === tab.id ? 'grabbing' : 'grab'
            }}
          >
            <span className="text-gray-500">{getTabIcon(tab.type)}</span>
            <span className="text-sm font-medium truncate flex-1 min-w-0">
              {tab.isBlank ? 'New Tab' : tab.title}
            </span>
            {(tab.type !== 'dashboard' || tab.isBlank) && (
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  onTabClose(tab.id)
                }}
                className="opacity-0 group-hover:opacity-100 p-1 hover:bg-gray-200 rounded transition-opacity"
              >
                <X className="h-3 w-3" />
              </button>
            )}
          </div>
        ))}
        
        <button
          onClick={handleNewTabClick}
          className="flex items-center justify-center w-8 h-8 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded transition-colors ml-2"
          title="New tab"
        >
          <Plus className="h-4 w-4" />
        </button>
      </div>
    </div>
  )
}