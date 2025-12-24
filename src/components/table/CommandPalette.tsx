/**
 * CommandPalette - Spotlight-style command interface (Cmd+K)
 *
 * Features:
 * - Fuzzy search across assets, actions, views
 * - Command execution: /filter, /sort, /view, /ai
 * - Recent commands, contextual suggestions
 * - Categories: Navigate, Filter, Sort, Bulk, Views, AI
 */

import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { createPortal } from 'react-dom'
import clsx from 'clsx'
import {
  Search,
  Command,
  ArrowRight,
  Filter,
  ArrowUpDown,
  Eye,
  Sparkles,
  Clock,
  Hash,
  X,
  ChevronRight,
  Keyboard,
  Table2,
  Columns,
  LayoutGrid,
  CheckSquare,
  Trash2,
  Star,
  AlertTriangle,
  TrendingUp,
  Building2,
  Tag,
  Calendar
} from 'lucide-react'

// Command types and categories
type CommandCategory = 'navigate' | 'filter' | 'sort' | 'bulk' | 'view' | 'ai' | 'recent'

interface CommandItem {
  id: string
  label: string
  description?: string
  category: CommandCategory
  icon?: React.ReactNode
  keywords?: string[]
  shortcut?: string[]
  action: () => void
  disabled?: boolean
}

interface CommandGroup {
  category: CommandCategory
  label: string
  icon: React.ReactNode
  commands: CommandItem[]
}

interface CommandPaletteProps {
  isOpen: boolean
  onClose: () => void
  // Asset data for search
  assets?: Array<{ id: string; symbol: string; company_name?: string }>
  // Current table state
  columns?: Array<{ id: string; label: string; visible: boolean }>
  // Actions
  onNavigateToAsset?: (assetId: string) => void
  onApplyFilter?: (field: string, value: string) => void
  onApplySort?: (field: string, direction: 'asc' | 'desc') => void
  onToggleColumnVisibility?: (columnId: string) => void
  onSetDensity?: (density: 'comfortable' | 'compact' | 'ultra-compact') => void
  onSelectAll?: () => void
  onClearSelection?: () => void
  onBulkDelete?: () => void
  onBulkChangePriority?: (priority: string) => void
  onShowKeyboardShortcuts?: () => void
  onAnalyzeWithAI?: () => void
  selectedCount?: number
}

// Category icons
const CATEGORY_ICONS: Record<CommandCategory, React.ReactNode> = {
  navigate: <ArrowRight className="w-4 h-4" />,
  filter: <Filter className="w-4 h-4" />,
  sort: <ArrowUpDown className="w-4 h-4" />,
  bulk: <CheckSquare className="w-4 h-4" />,
  view: <Eye className="w-4 h-4" />,
  ai: <Sparkles className="w-4 h-4" />,
  recent: <Clock className="w-4 h-4" />
}

const CATEGORY_LABELS: Record<CommandCategory, string> = {
  navigate: 'Navigate',
  filter: 'Filter',
  sort: 'Sort',
  bulk: 'Bulk Actions',
  view: 'View',
  ai: 'AI',
  recent: 'Recent'
}

// Simple fuzzy search
function fuzzyMatch(pattern: string, str: string): boolean {
  const patternLower = pattern.toLowerCase()
  const strLower = str.toLowerCase()

  // Direct substring match
  if (strLower.includes(patternLower)) return true

  // Fuzzy match - each character in pattern appears in order in str
  let patternIdx = 0
  for (let i = 0; i < strLower.length && patternIdx < patternLower.length; i++) {
    if (strLower[i] === patternLower[patternIdx]) {
      patternIdx++
    }
  }

  return patternIdx === patternLower.length
}

export function CommandPalette({
  isOpen,
  onClose,
  assets = [],
  columns = [],
  onNavigateToAsset,
  onApplyFilter,
  onApplySort,
  onToggleColumnVisibility,
  onSetDensity,
  onSelectAll,
  onClearSelection,
  onBulkDelete,
  onBulkChangePriority,
  onShowKeyboardShortcuts,
  onAnalyzeWithAI,
  selectedCount = 0
}: CommandPaletteProps) {
  const [query, setQuery] = useState('')
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [recentCommands, setRecentCommands] = useState<string[]>([])
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  // Load recent commands from localStorage
  useEffect(() => {
    try {
      const stored = localStorage.getItem('commandPalette:recent')
      if (stored) {
        setRecentCommands(JSON.parse(stored))
      }
    } catch {
      // Ignore
    }
  }, [])

  // Save recent command
  const saveRecentCommand = useCallback((commandId: string) => {
    setRecentCommands(prev => {
      const updated = [commandId, ...prev.filter(id => id !== commandId)].slice(0, 5)
      localStorage.setItem('commandPalette:recent', JSON.stringify(updated))
      return updated
    })
  }, [])

  // Build command list
  const allCommands = useMemo((): CommandItem[] => {
    const commands: CommandItem[] = []

    // View commands
    commands.push({
      id: 'view:density:comfortable',
      label: 'Set Comfortable Density',
      description: 'Spacious rows with full information',
      category: 'view',
      icon: <LayoutGrid className="w-4 h-4" />,
      keywords: ['density', 'comfortable', 'spacious', 'large'],
      action: () => onSetDensity?.('comfortable')
    })

    commands.push({
      id: 'view:density:compact',
      label: 'Set Compact Density',
      description: 'Medium-sized rows',
      category: 'view',
      icon: <Table2 className="w-4 h-4" />,
      keywords: ['density', 'compact', 'medium'],
      action: () => onSetDensity?.('compact')
    })

    commands.push({
      id: 'view:density:ultra',
      label: 'Set Ultra-Compact Density',
      description: 'Minimal rows for data density',
      category: 'view',
      icon: <Columns className="w-4 h-4" />,
      keywords: ['density', 'ultra', 'compact', 'minimal', 'dense'],
      action: () => onSetDensity?.('ultra-compact')
    })

    commands.push({
      id: 'view:shortcuts',
      label: 'Show Keyboard Shortcuts',
      description: 'View all available keyboard shortcuts',
      category: 'view',
      icon: <Keyboard className="w-4 h-4" />,
      keywords: ['keyboard', 'shortcuts', 'help', 'keys'],
      shortcut: ['?'],
      action: () => onShowKeyboardShortcuts?.()
    })

    // Column visibility commands
    columns.forEach(col => {
      if (col.id === 'select') return
      commands.push({
        id: `view:column:${col.id}`,
        label: `${col.visible ? 'Hide' : 'Show'} ${col.label} Column`,
        description: col.visible ? 'Remove column from view' : 'Add column to view',
        category: 'view',
        icon: col.visible ? <Eye className="w-4 h-4" /> : <Eye className="w-4 h-4 opacity-50" />,
        keywords: ['column', col.label.toLowerCase(), col.visible ? 'hide' : 'show'],
        action: () => onToggleColumnVisibility?.(col.id)
      })
    })

    // Sort commands
    const sortableFields = [
      { id: 'symbol', label: 'Symbol', icon: <Hash className="w-4 h-4" /> },
      { id: 'company_name', label: 'Company Name', icon: <Building2 className="w-4 h-4" /> },
      { id: 'priority', label: 'Priority', icon: <Star className="w-4 h-4" /> },
      { id: 'price', label: 'Price', icon: <TrendingUp className="w-4 h-4" /> },
      { id: 'sector', label: 'Sector', icon: <Tag className="w-4 h-4" /> },
      { id: 'updated_at', label: 'Last Updated', icon: <Calendar className="w-4 h-4" /> }
    ]

    sortableFields.forEach(field => {
      commands.push({
        id: `sort:${field.id}:asc`,
        label: `Sort by ${field.label} (A-Z)`,
        description: 'Ascending order',
        category: 'sort',
        icon: field.icon,
        keywords: ['sort', field.label.toLowerCase(), 'ascending', 'asc'],
        action: () => onApplySort?.(field.id, 'asc')
      })

      commands.push({
        id: `sort:${field.id}:desc`,
        label: `Sort by ${field.label} (Z-A)`,
        description: 'Descending order',
        category: 'sort',
        icon: field.icon,
        keywords: ['sort', field.label.toLowerCase(), 'descending', 'desc'],
        action: () => onApplySort?.(field.id, 'desc')
      })
    })

    // Filter commands
    const priorities = ['high', 'medium', 'low']
    priorities.forEach(priority => {
      commands.push({
        id: `filter:priority:${priority}`,
        label: `Filter by ${priority.charAt(0).toUpperCase() + priority.slice(1)} Priority`,
        description: `Show only ${priority} priority assets`,
        category: 'filter',
        icon: <Star className="w-4 h-4" />,
        keywords: ['filter', 'priority', priority],
        action: () => onApplyFilter?.('priority', priority)
      })
    })

    commands.push({
      id: 'filter:clear',
      label: 'Clear All Filters',
      description: 'Remove all active filters',
      category: 'filter',
      icon: <X className="w-4 h-4" />,
      keywords: ['filter', 'clear', 'reset', 'remove'],
      action: () => onApplyFilter?.('', '')
    })

    // Bulk actions
    commands.push({
      id: 'bulk:select-all',
      label: 'Select All Assets',
      description: 'Select all visible assets',
      category: 'bulk',
      icon: <CheckSquare className="w-4 h-4" />,
      keywords: ['select', 'all', 'bulk'],
      shortcut: ['Ctrl', 'A'],
      action: () => onSelectAll?.()
    })

    if (selectedCount > 0) {
      commands.push({
        id: 'bulk:clear-selection',
        label: 'Clear Selection',
        description: `Deselect ${selectedCount} asset${selectedCount !== 1 ? 's' : ''}`,
        category: 'bulk',
        icon: <X className="w-4 h-4" />,
        keywords: ['clear', 'deselect', 'selection'],
        action: () => onClearSelection?.()
      })

      commands.push({
        id: 'bulk:delete',
        label: 'Delete Selected',
        description: `Delete ${selectedCount} selected asset${selectedCount !== 1 ? 's' : ''}`,
        category: 'bulk',
        icon: <Trash2 className="w-4 h-4 text-red-500" />,
        keywords: ['delete', 'remove', 'bulk'],
        action: () => onBulkDelete?.()
      })

      priorities.forEach(priority => {
        commands.push({
          id: `bulk:priority:${priority}`,
          label: `Set Priority to ${priority.charAt(0).toUpperCase() + priority.slice(1)}`,
          description: `Change priority of ${selectedCount} asset${selectedCount !== 1 ? 's' : ''}`,
          category: 'bulk',
          icon: <Star className="w-4 h-4" />,
          keywords: ['priority', priority, 'bulk', 'change'],
          action: () => onBulkChangePriority?.(priority)
        })
      })
    }

    // AI commands
    commands.push({
      id: 'ai:analyze',
      label: 'Analyze with AI',
      description: selectedCount > 0
        ? `Get AI insights on ${selectedCount} selected asset${selectedCount !== 1 ? 's' : ''}`
        : 'Get AI insights on focused asset',
      category: 'ai',
      icon: <Sparkles className="w-4 h-4 text-purple-500" />,
      keywords: ['ai', 'analyze', 'insights', 'claude'],
      action: () => onAnalyzeWithAI?.()
    })

    // Navigate commands (asset search)
    assets.slice(0, 50).forEach(asset => {
      commands.push({
        id: `navigate:asset:${asset.id}`,
        label: asset.symbol,
        description: asset.company_name || 'Navigate to asset',
        category: 'navigate',
        icon: <ArrowRight className="w-4 h-4" />,
        keywords: [asset.symbol.toLowerCase(), asset.company_name?.toLowerCase() || ''],
        action: () => onNavigateToAsset?.(asset.id)
      })
    })

    return commands
  }, [
    assets,
    columns,
    selectedCount,
    onSetDensity,
    onShowKeyboardShortcuts,
    onToggleColumnVisibility,
    onApplySort,
    onApplyFilter,
    onSelectAll,
    onClearSelection,
    onBulkDelete,
    onBulkChangePriority,
    onAnalyzeWithAI,
    onNavigateToAsset
  ])

  // Filter commands based on query
  const filteredCommands = useMemo(() => {
    if (!query.trim()) {
      // Show recent + popular commands when no query
      const recentItems = recentCommands
        .map(id => allCommands.find(c => c.id === id))
        .filter((c): c is CommandItem => c !== undefined)
        .map(c => ({ ...c, category: 'recent' as CommandCategory }))

      const popularCategories: CommandCategory[] = ['view', 'sort', 'filter']
      const popular = allCommands
        .filter(c => popularCategories.includes(c.category))
        .slice(0, 8)

      return [...recentItems, ...popular]
    }

    // Check for command prefix
    const lowerQuery = query.toLowerCase()

    // Filter matching commands
    return allCommands.filter(cmd => {
      // Match label
      if (fuzzyMatch(query, cmd.label)) return true

      // Match description
      if (cmd.description && fuzzyMatch(query, cmd.description)) return true

      // Match keywords
      if (cmd.keywords?.some(kw => fuzzyMatch(query, kw))) return true

      return false
    })
  }, [query, allCommands, recentCommands])

  // Group filtered commands by category
  const groupedCommands = useMemo((): CommandGroup[] => {
    const groups: Map<CommandCategory, CommandItem[]> = new Map()

    filteredCommands.forEach(cmd => {
      const existing = groups.get(cmd.category) || []
      groups.set(cmd.category, [...existing, cmd])
    })

    const categoryOrder: CommandCategory[] = ['recent', 'navigate', 'filter', 'sort', 'bulk', 'view', 'ai']

    return categoryOrder
      .filter(cat => groups.has(cat))
      .map(cat => ({
        category: cat,
        label: CATEGORY_LABELS[cat],
        icon: CATEGORY_ICONS[cat],
        commands: groups.get(cat)!
      }))
  }, [filteredCommands])

  // Flatten for keyboard navigation
  const flatCommands = useMemo(() => {
    return groupedCommands.flatMap(g => g.commands)
  }, [groupedCommands])

  // Reset selection when results change
  useEffect(() => {
    setSelectedIndex(0)
  }, [query])

  // Focus input when opened
  useEffect(() => {
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 0)
      setQuery('')
      setSelectedIndex(0)
    }
  }, [isOpen])

  // Scroll selected item into view
  useEffect(() => {
    if (listRef.current && flatCommands.length > 0) {
      const selectedElement = listRef.current.querySelector(`[data-index="${selectedIndex}"]`)
      selectedElement?.scrollIntoView({ block: 'nearest' })
    }
  }, [selectedIndex, flatCommands.length])

  // Execute selected command
  const executeCommand = useCallback((command: CommandItem) => {
    saveRecentCommand(command.id)
    command.action()
    onClose()
  }, [saveRecentCommand, onClose])

  // Keyboard handling
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault()
        setSelectedIndex(prev =>
          prev < flatCommands.length - 1 ? prev + 1 : 0
        )
        break

      case 'ArrowUp':
        e.preventDefault()
        setSelectedIndex(prev =>
          prev > 0 ? prev - 1 : flatCommands.length - 1
        )
        break

      case 'Enter':
        e.preventDefault()
        if (flatCommands[selectedIndex]) {
          executeCommand(flatCommands[selectedIndex])
        }
        break

      case 'Escape':
        e.preventDefault()
        onClose()
        break
    }
  }, [flatCommands, selectedIndex, executeCommand, onClose])

  // Global keyboard shortcut
  useEffect(() => {
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        if (isOpen) {
          onClose()
        }
      }
    }

    window.addEventListener('keydown', handleGlobalKeyDown)
    return () => window.removeEventListener('keydown', handleGlobalKeyDown)
  }, [isOpen, onClose])

  if (!isOpen) return null

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-[15vh]">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-sm animate-in fade-in duration-150"
        onClick={onClose}
      />

      {/* Palette */}
      <div
        className="relative w-full max-w-xl bg-white dark:bg-dark-card rounded-xl shadow-2xl border border-gray-200 dark:border-gray-700 overflow-hidden animate-in zoom-in-95 slide-in-from-top-4 duration-200"
        onKeyDown={handleKeyDown}
      >
        {/* Search input */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-200 dark:border-gray-700">
          <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-gray-100 dark:bg-gray-800">
            <Command className="w-4 h-4 text-gray-500" />
          </div>
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Type a command or search..."
            className="flex-1 bg-transparent text-gray-900 dark:text-gray-100 placeholder-gray-400 text-base outline-none"
          />
          <kbd className="hidden sm:inline-flex items-center gap-1 px-2 py-1 text-xs font-mono text-gray-400 bg-gray-100 dark:bg-gray-800 rounded">
            <span>Esc</span>
          </kbd>
        </div>

        {/* Results */}
        <div ref={listRef} className="max-h-[50vh] overflow-y-auto p-2">
          {groupedCommands.length === 0 ? (
            <div className="px-4 py-8 text-center text-gray-500">
              <Search className="w-8 h-8 mx-auto mb-2 opacity-50" />
              <p className="text-sm">No commands found</p>
              <p className="text-xs mt-1">Try a different search term</p>
            </div>
          ) : (
            <>
              {groupedCommands.map((group, groupIdx) => (
                <div key={group.category} className={clsx(groupIdx > 0 && 'mt-3')}>
                  {/* Group header */}
                  <div className="flex items-center gap-2 px-3 py-1.5 text-xs font-medium text-gray-400 uppercase tracking-wider">
                    {group.icon}
                    <span>{group.label}</span>
                  </div>

                  {/* Commands */}
                  {group.commands.map((command) => {
                    const globalIndex = flatCommands.indexOf(command)
                    const isSelected = globalIndex === selectedIndex

                    return (
                      <button
                        key={command.id}
                        data-index={globalIndex}
                        onClick={() => executeCommand(command)}
                        onMouseEnter={() => setSelectedIndex(globalIndex)}
                        disabled={command.disabled}
                        className={clsx(
                          'w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left transition-colors',
                          isSelected
                            ? 'bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300'
                            : 'hover:bg-gray-50 dark:hover:bg-gray-800/50',
                          command.disabled && 'opacity-50 cursor-not-allowed'
                        )}
                      >
                        {/* Icon */}
                        <div className={clsx(
                          'flex items-center justify-center w-8 h-8 rounded-lg shrink-0',
                          isSelected
                            ? 'bg-blue-100 dark:bg-blue-900/50'
                            : 'bg-gray-100 dark:bg-gray-800'
                        )}>
                          {command.icon || <ChevronRight className="w-4 h-4" />}
                        </div>

                        {/* Content */}
                        <div className="flex-1 min-w-0">
                          <div className="font-medium text-sm truncate">
                            {command.label}
                          </div>
                          {command.description && (
                            <div className="text-xs text-gray-500 dark:text-gray-400 truncate">
                              {command.description}
                            </div>
                          )}
                        </div>

                        {/* Shortcut */}
                        {command.shortcut && (
                          <div className="flex items-center gap-1 shrink-0">
                            {command.shortcut.map((key, idx) => (
                              <React.Fragment key={idx}>
                                {idx > 0 && <span className="text-xs text-gray-300">+</span>}
                                <kbd className="px-1.5 py-0.5 text-[10px] font-mono bg-gray-100 dark:bg-gray-800 text-gray-500 border border-gray-200 dark:border-gray-700 rounded">
                                  {key}
                                </kbd>
                              </React.Fragment>
                            ))}
                          </div>
                        )}
                      </button>
                    )
                  })}
                </div>
              ))}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-4 py-2 bg-gray-50 dark:bg-gray-900/50 border-t border-gray-200 dark:border-gray-700 text-xs text-gray-400">
          <div className="flex items-center gap-4">
            <span className="flex items-center gap-1">
              <kbd className="px-1.5 py-0.5 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded">↑</kbd>
              <kbd className="px-1.5 py-0.5 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded">↓</kbd>
              <span className="ml-1">navigate</span>
            </span>
            <span className="flex items-center gap-1">
              <kbd className="px-1.5 py-0.5 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded">↵</kbd>
              <span className="ml-1">select</span>
            </span>
          </div>
          <span>
            {flatCommands.length} command{flatCommands.length !== 1 ? 's' : ''}
          </span>
        </div>
      </div>
    </div>,
    document.body
  )
}

export default CommandPalette
